// ═══════════════════════════════════════════════════════════════
//  Importlaget. Ét sted, alle kilder.
//
//  Livsforloebet for en bolig:
//    foerste gang set   -> INSERT, first_seen_at saettes
//    set igen           -> UPDATE, kun last_seen_at flyttes
//    ikke set i en kk.  -> status 'delisted', delisted_at saettes
//    set igen bagefter  -> 'active' igen, first_seen_at UROERT
//
//  first_seen_at roeres aldrig efter indsaettelsen. Den baerer alarmen
//  "ny bolig", og en genudlejning er ikke en ny bolig.
// ═══════════════════════════════════════════════════════════════

import { hostname } from 'node:os'
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, fetchFailures, listingImages, listings, sources } from '../db/schema'
import type { SourceAdapter } from './adapter'
import { VaertBlokeretFejl } from './fetch'
import { normaliser } from './normalize'

/**
 * Skriv straks. console.log til et roer bufres, og bliver processen draebt,
 * gaar bufferen tabt — det var praecis det, der gjorde Railway-loggen tom.
 */
function log(linje: string) {
  process.stdout.write(linje + '\n')
}

export interface KoerselsResultat {
  kilde: string
  fundet: number
  nye: number
  opdaterede: number
  /** Set i discovery, men ikke hentet igen. Kun last_seen_at flyttet. */
  bekraeftede: number
  /** Sprunget over, fordi de er i tilbagetraekning. IKKE fejl. */
  iTilbagetraekning: number
  afmeldte: number
  fejl: number
  status: 'ok' | 'failed'
  noter: string[]
}

/**
 * Hvor mange kendte boliger vi genopfrisker pr. koersel, og hvor gammel en
 * hentning skal vaere foer den fornyes.
 *
 * Uden det her henter en timekoersel af Propstep 692 detaljesider hver time
 * — 17.000 kald i doegnet mod en lille udlejerplatform. Med det henter vi
 * discovery hver time (29 kald), nye boliger straks, og ruller resten
 * igennem over et doegn. Loftet pr. koersel forhindrer samtidig, at alt
 * forfalder paa én gang og giver et bjerg af kald i én time.
 */
// Begge er miljoevariable, og af samme grund: retter man en adapter, skal
// rettelsen kunne efterproeves uden at vente et doegn — og uden at skrive
// falske last_fetched_at i basen for at snyde reglen. Standarden er den
// samme som foer.
const GENOPFRISK_EFTER_TIMER = Number(process.env.GENOPFRISK_EFTER_TIMER ?? 24)
const GENOPFRISK_PR_KOERSEL = Number(process.env.GENOPFRISK_PR_KOERSEL ?? 60)

/**
 * Fejlprocenten maales af de hentninger, koerslen faktisk foretog — men den
 * siger kun noget, naar der er nok af dem. Med inkrementel import kan en
 * time have seks hentninger, og hvis de seks er de samme kendte 404-sider,
 * er andelen 100 % uden at kilden fejler noget: de oevrige 736 boliger blev
 * bekraeftet fint samme koersel.
 *
 * Under graensen her springes fejlandelen over som signal. De to andre
 * sikringer staar stadig — intet skrevet, og for faa fundet mod medianen —
 * og de maaler paa hele udbuddet i stedet for paa en tilfaeldig delmaengde.
 */
const MINDST_HENTNINGER_FOR_FEJLANDEL = 20

/**
 * Tilbagetraekning for detaljesider, der ikke kan hentes.
 * Se noten over `fetchFailures` i db/schema.ts for hvorfor.
 */
function naesteForsoeg(forsoeg: number): Date {
  const nu = Date.now()
  if (forsoeg >= 5) return new Date(nu + 7 * 24 * 3600_000)   // en uge
  if (forsoeg >= 3) return new Date(nu + 24 * 3600_000)       // et doegn
  return new Date(nu)                                          // naeste koersel
}

/** Hvem koerer. Uden det kan to importoerer ikke skelnes i basen. */
export const RUNNER = process.env.RUNNER ?? hostname()

/**
 * Koersler der aldrig blev afsluttet, staar som 'running' for evigt. Det
 * sker, naar processen bliver draebt midt i — fx en container der lukkes.
 * De lukkes her, saa de ikke ligner noget der stadig arbejder, og saa man
 * kan se HVOR mange gange det er sket.
 */
async function lukStrandede(sourceId: string, aeldreEndMin = 30) {
  const graense = new Date(Date.now() - aeldreEndMin * 60_000)
  const r = await db.update(crawlRuns)
    .set({
      status: 'failed',
      finishedAt: sql`now()`,
      notes: 'Aldrig afsluttet — processen blev sandsynligvis dræbt midt i kørslen.',
    })
    .where(and(
      eq(crawlRuns.sourceId, sourceId),
      eq(crawlRuns.status, 'running'),
      lt(crawlRuns.startedAt, graense),
    ))
    .returning({ id: crawlRuns.id })
  return r.length
}

/** Opretter kilden hvis den mangler, ellers holder navn og type ajour. */
export async function sikreKilde(a: SourceAdapter, navn: string, baseUrl?: string) {
  const [r] = await db.insert(sources)
    .values({ slug: a.id, name: navn, sourceType: a.sourceType, baseUrl: baseUrl ?? null })
    .onConflictDoUpdate({
      target: sources.slug,
      set: { name: navn, sourceType: a.sourceType, baseUrl: baseUrl ?? null },
    })
    .returning({ id: sources.id, enabled: sources.enabled })
  return r!
}

/**
 * Medianen af discovered_count for de seneste `n` FAERDIGE koersler.
 * Bevidst median og ikke sidste koersel: én daarlig koersel skal ikke kunne
 * flytte referencen og dermed skjule, at kilden er ved at doe.
 */
export async function medianFund(sourceId: string, n = 10): Promise<number | null> {
  const r = await db.select({ c: crawlRuns.discoveredCount })
    .from(crawlRuns)
    .where(and(eq(crawlRuns.sourceId, sourceId), eq(crawlRuns.status, 'ok')))
    .orderBy(desc(crawlRuns.startedAt))
    .limit(n)
  const tal = r.map((x) => x.c).filter((x): x is number => x != null).sort((a, b) => a - b)
  if (!tal.length) return null
  const m = Math.floor(tal.length / 2)
  return tal.length % 2 ? tal[m]! : Math.round((tal[m - 1]! + tal[m]!) / 2)
}

/** Skriver én normaliseret bolig. Returnerer om den var ny.
 *  Eksporteret KUN til proeven: snapshot-semantikken skal kunne bevises. */
export async function skrivBolig(
  sourceId: string,
  sourceType: 'feed' | 'spider' | 'native',
  b: Awaited<ReturnType<typeof normaliser>>,
  /**
   * Detaljevagtens bogfoering — kun for kilder med listeGrundlag.
   * `hentet: false` betyder «skrevet fra listen alene»: detail_fetched_at
   * saettes til NULL, og en senere koersel samler boligen op. Udeladt
   * argument roerer ikke kolonnerne (kilder uden vagt).
   */
  detalje?: { signatur: string; hentet: boolean },
): Promise<{ id: string; ny: boolean }> {
  // ALLE tidsstempler kommer fra databasens ur, aldrig fra maskinens.
  // first_seen_at saettes af default now() i Postgres; saetter vi last_seen_at
  // fra en JS-Date, sammenligner afmeldningen to forskellige ure. Gaar
  // workerens ur bare et sekund bagud, ser boliger vi lige har opdateret
  // aeldre ud end koerslen — og bliver afmeldt.
  const nu = sql`now()`
  const [row] = await db.insert(listings)
    .values({
      sourceId, sourceType,
      externalKey: b.externalKey, sourceUrl: b.sourceUrl,
      addressRaw: b.addressRaw, street: b.street, houseNumber: b.houseNumber,
      floor: b.floor, door: b.door, postalCode: b.postalCode, city: b.city,
      unitAddressUuid: b.unitAddressUuid, accessAddressUuid: b.accessAddressUuid,
      addressMatchLevel: b.addressMatchLevel, lat: b.lat, lng: b.lng,
      propertyType: b.propertyType, sizeM2: b.sizeM2, rooms: b.rooms,
      availableFrom: b.availableFrom,
      rentMonthly: b.rentMonthly, utilitiesHeat: b.utilitiesHeat,
      utilitiesWater: b.utilitiesWater, utilitiesElectricity: b.utilitiesElectricity,
      utilitiesOther: b.utilitiesOther,
      electricityOwnMeter: b.electricityOwnMeter,
      totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
      moveInCost: b.moveInCost, deposit: b.deposit, prepaidRent: b.prepaidRent,
      applicationType: b.applicationType,
      rentModel: b.rentModel, openHouseAt: b.openHouseAt,
      sourceCreatedAt: b.sourceCreatedAt, sourceUpdatedAt: b.sourceUpdatedAt,
      amenities: b.amenities, description: b.description,
      imagesMayDiffer: b.imagesMayDiffer,
      // SNAPSHOT, aldrig merge: kolonnen ERSTATTES helt, saa et fact, der
      // forsvinder fra kildens naeste svar, ogsaa forsvinder her.
      // {} = behandlet, kilden gav ingen facts. NULL findes kun paa raekker,
      // pipelinen aldrig har roert.
      // Cast paa SKRIVNING er ok: det er vores egen typede vaerdi, der
      // serialiseres. LAESNING gaar altid gennem laesAvailabilityFacts.
      availabilityFacts: (b.availability ?? {}) as Record<string, unknown>,
      // Importerede boliger har aldrig kontakt i basen. Muren staar ved kilden.
      contactEmail: null, contactPhone: null, isBlurred: true,
      status: 'active', lastSeenAt: nu, lastFetchedAt: nu,
      ...(detalje ? {
        detailSignature: detalje.signatur,
        detailFetchedAt: detalje.hentet ? nu : null,
      } : {}),
    })
    .onConflictDoUpdate({
      target: [listings.sourceId, listings.externalKey],
      set: {
        sourceUrl: b.sourceUrl,
        addressRaw: b.addressRaw, street: b.street, houseNumber: b.houseNumber,
        floor: b.floor, door: b.door, postalCode: b.postalCode, city: b.city,
        unitAddressUuid: b.unitAddressUuid, accessAddressUuid: b.accessAddressUuid,
        addressMatchLevel: b.addressMatchLevel, lat: b.lat, lng: b.lng,
        propertyType: b.propertyType, sizeM2: b.sizeM2, rooms: b.rooms,
        availableFrom: b.availableFrom,
        rentMonthly: b.rentMonthly, utilitiesHeat: b.utilitiesHeat,
        utilitiesWater: b.utilitiesWater, utilitiesElectricity: b.utilitiesElectricity,
        utilitiesOther: b.utilitiesOther,
        electricityOwnMeter: b.electricityOwnMeter,
        totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
        moveInCost: b.moveInCost, deposit: b.deposit, prepaidRent: b.prepaidRent,
        applicationType: b.applicationType,
        rentModel: b.rentModel, openHouseAt: b.openHouseAt,
        sourceCreatedAt: b.sourceCreatedAt, sourceUpdatedAt: b.sourceUpdatedAt,
        amenities: b.amenities, description: b.description,
        imagesMayDiffer: b.imagesMayDiffer,
        // Cast paa SKRIVNING er ok: det er vores egen typede vaerdi, der
      // serialiseres. LAESNING gaar altid gennem laesAvailabilityFacts.
      availabilityFacts: (b.availability ?? {}) as Record<string, unknown>,
        // Dukker en afmeldt bolig op igen, er den ledig igen.
        status: 'active', delistedAt: null,
        lastSeenAt: nu, lastFetchedAt: nu,
        ...(detalje ? {
          detailSignature: detalje.signatur,
          detailFetchedAt: detalje.hentet ? nu : null,
        } : {}),
        // first_seen_at staar med vilje IKKE her.
      },
    })
    // xmax = 0 er sandt praecis naar raekken blev indsat, ikke opdateret.
    .returning({ id: listings.id, ny: sql<boolean>`(xmax = 0)` })

  const { id, ny } = row!

  // Billeder erstattes helt: kilder omordner og udskifter dem loebende.
  await db.delete(listingImages).where(eq(listingImages.listingId, id))
  if (b.imageUrls.length) {
    await db.insert(listingImages).values(
      b.imageUrls.map((externalUrl, position) => ({ listingId: id, externalUrl, position })),
    )
  }
  return { id, ny }
}

/**
 * Koerer én kilde fra ende til anden.
 *
 * Den vigtigste linje i filen er sikringen mod afmeldning: en kilde, der
 * pludselig finder langt faerre boliger, er langt oftere en knaekket parser
 * end et tomt marked. Afmelder vi paa den, toemmer én daarlig eftermiddag
 * hele basen — og vi opdager det foerst, naar brugerne er væk.
 */
export async function koerKilde(
  adapter: SourceAdapter,
  navn: string,
  opts: { baseUrl?: string; afmeldGraense?: number } = {},
): Promise<KoerselsResultat> {
  const graense = opts.afmeldGraense ?? 0.5
  const noter: string[] = []
  const kilde = await sikreKilde(adapter, navn, opts.baseUrl)

  const strandede = await lukStrandede(kilde.id)
  if (strandede) noter.push(`${strandede} tidligere kørsel(er) stod som 'running' og er lukket som fejlet.`)

  // ── Overlap-vaern ────────────────────────────────────────────────────
  // To koersler mod samme kilde maa ikke crawle i munden paa hinanden —
  // en lokal import og Railway-workeren ville kappes om afmeldningen og
  // dobbeltbelaste kildens vaert. lukStrandede har netop lukket alt over
  // 30 minutter, saa en tilbagevaerende 'running' er frisk og aegte.
  // Der skrives ingen crawl_runs-raekke for det oversprungne: median og
  // fejlrate skal ikke forurenes af et velopdragent nej.
  const [iGang] = await db.select({ startet: crawlRuns.startedAt, runner: crawlRuns.runner })
    .from(crawlRuns)
    .where(and(eq(crawlRuns.sourceId, kilde.id), eq(crawlRuns.status, 'running')))
    .limit(1)
  if (iGang) {
    return {
      kilde: adapter.id, fundet: 0, nye: 0, opdaterede: 0, bekraeftede: 0,
      iTilbagetraekning: 0, afmeldte: 0, fejl: 0, status: 'ok',
      noter: [`sprunget over: en anden kørsel er i gang (${iGang.runner ?? 'ukendt'}, `
        + `startet ${iGang.startet.toISOString().slice(0, 16).replace('T', ' ')})`],
    }
  }

  const [run] = await db.insert(crawlRuns)
    .values({ sourceId: kilde.id, status: 'running', runner: RUNNER })
    .returning({ id: crawlRuns.id, startedAt: crawlRuns.startedAt })
  const runId = run!.id
  const runStart = run!.startedAt

  const afslut = async (r: Omit<KoerselsResultat, 'kilde'>) => {
    await db.update(crawlRuns).set({
      finishedAt: sql`now()`,
      discoveredCount: r.fundet,
      extractedCount: r.nye + r.opdaterede,
      newCount: r.nye,
      updatedCount: r.opdaterede,
      touchedCount: r.bekraeftede,
      skippedCount: r.iTilbagetraekning,
      delistedCount: r.afmeldte,
      errorCount: r.fejl,
      status: r.status,
      notes: r.noter.length ? r.noter.join('\n') : null,
    }).where(eq(crawlRuns.id, runId))
    return { kilde: adapter.id, ...r }
  }

  let fundne: Awaited<ReturnType<SourceAdapter['discover']>>
  try {
    fundne = await adapter.discover()
  } catch (e) {
    noter.push(`discovery fejlede: ${(e as Error).message}`)
    return afslut({ fundet: 0, nye: 0, opdaterede: 0, bekraeftede: 0, iTilbagetraekning: 0, afmeldte: 0, fejl: 1, status: 'failed', noter })
  }

  // ── Hvad skal hentes? ────────────────────────────────────────────────
  // Kendte boliger hentes ikke igen hver gang. De faar last_seen_at flyttet,
  // saa afmeldningen ved at de stadig findes, og hentes paa tur.
  const kendte = new Map(
    (await db.select({
      key: listings.externalKey,
      hentet: listings.lastFetchedAt,
      status: listings.status,
      detaljeSignatur: listings.detailSignature,
      detaljerHentet: listings.detailFetchedAt,
    }).from(listings).where(eq(listings.sourceId, kilde.id)))
      .map((r) => [r.key, r]),
  )

  // Noegler der ikke maa forsoeges endnu. Hentes foer udvaelgelsen, saa de
  // hverken koster et kald eller taeller som fejl.
  const tilbagetrukne = new Set(
    (await db.select({ key: fetchFailures.externalKey })
      .from(fetchFailures)
      .where(and(
        eq(fetchFailures.sourceId, kilde.id),
        gt(fetchFailures.retryAfter, sql`now()`),
      )))
      .map((r) => r.key),
  )

  const forfaldenFoer = new Date(Date.now() - GENOPFRISK_EFTER_TIMER * 3600_000)
  const skalHentes: typeof fundne = []
  const bekraeftes: string[] = []
  const forfaldne: { externalKey: string; url: string; hentet: Date }[] = []

  // ── Detaljevagten ────────────────────────────────────────────────────
  // Kilder med listeGrundlag faar detaljesiden hentet KUN naar boligen er
  // ny, naar signaturen af de relevante listefelter har aendret sig (eller
  // detaljer aldrig er hentet), eller naar detaljerne er forfaldne — under
  // et budget pr. koersel, prioriteret i den raekkefoelge. Overloeb af nye
  // og aendrede skrives FRA LISTEN med detail_fetched_at = NULL, som en
  // senere koersel samler op; forfaldne uden budget bekraeftes blot.
  // Staleness maales paa detail_fetched_at — last_fetched_at flyttes ogsaa
  // af grundlags-skrivninger og ville skjule, at detaljerne mangler.
  const opslag = adapter.listeGrundlag?.bind(adapter)
  const budget = opslag ? (adapter.detaljeBudgetPrKoersel ?? Infinity) : Infinity
  /** Vagt-kilder: skrives fra listen uden detaljehentning. */
  const fraListen: { externalKey: string; url: string }[] = []
  /** Noegler der er nye/aendrede — bruges naar vaertsspaerren afbryder. */
  const nyeEllerAendrede = new Set<string>()

  let iTilbagetraekning = 0
  for (const f of fundne) {
    const k = kendte.get(f.externalKey)

    if (tilbagetrukne.has(f.externalKey)) {
      iTilbagetraekning++
      // Kender vi boligen i forvejen, skal den stadig bekraeftes — discovery
      // saa den, og saa maa afmeldningen ikke tage den.
      if (k) bekraeftes.push(f.externalKey)
      continue
    }

    if (opslag) {
      const o = opslag(f.url)
      if (!k || k.status === 'delisted') {
        nyeEllerAendrede.add(f.externalKey)
        skalHentes.push(f)
      } else if (!o) {
        // Listen kunne ikke laeses for netop denne — bekraeft og lad den
        // ligge; et gaet her ville overskrive gode data med ingenting.
        bekraeftes.push(f.externalKey)
      } else if (k.detaljerHentet == null || k.detaljeSignatur !== o.detaljesignatur) {
        nyeEllerAendrede.add(f.externalKey)
        skalHentes.push(f)
      } else if (k.detaljerHentet < forfaldenFoer) {
        forfaldne.push({ externalKey: f.externalKey, url: f.url, hentet: k.detaljerHentet })
      } else {
        bekraeftes.push(f.externalKey)
      }
      continue
    }

    if (!k || k.status === 'delisted') {
      // Ny, eller vendt tilbage efter afmeldning. Hentes altid.
      skalHentes.push(f)
    } else if (!k.hentet || k.hentet < forfaldenFoer) {
      forfaldne.push({ externalKey: f.externalKey, url: f.url, hentet: k.hentet ?? new Date(0) })
    } else {
      bekraeftes.push(f.externalKey)
    }
  }

  // AEldste foerst, saa alle kommer igennem over et doegn.
  forfaldne.sort((a, b) => +a.hentet - +b.hentet)
  const forfaldnePlads = opslag
    ? Math.max(0, Math.min(budget - skalHentes.length, GENOPFRISK_PR_KOERSEL))
    : GENOPFRISK_PR_KOERSEL
  for (const f of forfaldne.slice(0, forfaldnePlads)) {
    skalHentes.push({ externalKey: f.externalKey, url: f.url })
  }
  for (const f of forfaldne.slice(forfaldnePlads)) {
    bekraeftes.push(fundne.find((x) => x.url === f.url)!.externalKey)
  }

  // Budgettet: nye foerst, saa aendrede, saa forfaldne — overloebet af
  // nye og aendrede gaar til grundlags-skrivning.
  if (opslag && skalHentes.length > budget) {
    skalHentes.sort((a, b) =>
      Number(kendte.has(a.externalKey)) - Number(kendte.has(b.externalKey)))
    for (const f of skalHentes.splice(budget)) {
      fraListen.push({ externalKey: f.externalKey, url: f.url })
    }
  }

  if (skalHentes.length) {
    log(`[${adapter.id}] henter ${skalHentes.length} af ${fundne.length}`)
  }
  let nye = 0, opdaterede = 0, fejl = 0
  let i = 0
  const fejledeNoegler: string[] = []
  for (const [idx, { url, externalKey }] of skalHentes.entries()) {
    if (++i % 20 === 0) log(`[${adapter.id}] ${i}/${skalHentes.length} hentet`)
    try {
      const raa = await adapter.extract(url)
      const b = await normaliser(raa)
      const o = opslag?.(url)
      const { ny } = await skrivBolig(kilde.id, adapter.sourceType, b,
        o ? { signatur: o.detaljesignatur, hentet: true } : undefined)
      ny ? nye++ : opdaterede++
      // Foerste succes nulstiller: en midlertidig fejl maa ikke haenge ved.
      if (externalKey) {
        await db.delete(fetchFailures).where(and(
          eq(fetchFailures.sourceId, kilde.id),
          eq(fetchFailures.externalKey, externalKey),
        ))
      }
    } catch (e) {
      // Vaertsspaerren er ikke boligens fejl: den maa hverken taelle som
      // udtraeksfejl eller eskalere tilbagetraekning. Resten af koerslens
      // detaljehentninger opgives — nye/aendrede skrives fra listen, kendte
      // bekraeftes, og ingen afmeldes. Naeste koersel proever forfra.
      if (e instanceof VaertBlokeretFejl) {
        const rest = skalHentes.slice(idx)
        noter.push(`værtsspærre: ${e.message} — ${rest.length} detaljehentning(er) udskudt`)
        for (const r of rest) {
          if (opslag && nyeEllerAendrede.has(r.externalKey)) {
            fraListen.push({ externalKey: r.externalKey, url: r.url })
          } else if (kendte.has(r.externalKey)) {
            bekraeftes.push(r.externalKey)
          }
          // En ny bolig hos en kilde UDEN listeGrundlag kan intet skrives
          // for — den findes foerst ved naeste koersel. Det er vagtens pris,
          // og derfor er listeGrundlag en forudsaetning for budgettet.
        }
        break
      }
      fejl++
      // Alle poster i skalHentes baerer nu deres noegle — baade nye og
      // forfaldne — saa den kan altid slaas op.
      if (externalKey) {
        fejledeNoegler.push(externalKey)
        const [r] = await db.insert(fetchFailures)
          .values({
            sourceId: kilde.id, externalKey, url,
            attempts: 1, retryAfter: naesteForsoeg(1),
            lastError: (e as Error).message.slice(0, 500),
          })
          .onConflictDoUpdate({
            target: [fetchFailures.sourceId, fetchFailures.externalKey],
            set: {
              attempts: sql`${fetchFailures.attempts} + 1`,
              lastFailedAt: sql`now()`,
              lastError: (e as Error).message.slice(0, 500),
              url,
              // Naeste forsoeg beregnes af det NYE forsoegstal.
              retryAfter: sql`case
                when ${fetchFailures.attempts} + 1 >= 5 then now() + interval '7 days'
                when ${fetchFailures.attempts} + 1 >= 3 then now() + interval '1 day'
                else now() end`,
            },
          })
          .returning({ forsoeg: fetchFailures.attempts, naeste: fetchFailures.retryAfter })
        if (r && r.forsoeg >= 3) {
          noter.push(`${url}: fejlet ${r.forsoeg} gange — prøves tidligst `
            + `${r.naeste.toISOString().slice(0, 16).replace('T', ' ')}`)
        }
      }
      if (fejl <= 5) noter.push(`${url}: ${(e as Error).message}`)
    }
  }

  // Vagt-kilder: nye og aendrede uden detaljebudget skrives fra listen.
  // detail_fetched_at saettes IKKE (NULL = «detaljer mangler»), saa en
  // senere koersel samler dem op — og signaturen gemmes, saa en aendring
  // imens stadig opdages.
  for (const f of fraListen) {
    try {
      const o = opslag!(f.url)
      if (!o) continue
      const b = await normaliser(o.grundlag)
      const { ny } = await skrivBolig(kilde.id, adapter.sourceType, b,
        { signatur: o.detaljesignatur, hentet: false })
      ny ? nye++ : opdaterede++
    } catch (e) {
      fejl++
      if (fejl <= 5) noter.push(`${f.url} (fra listen): ${(e as Error).message}`)
    }
  }

  // En bolig, VI ALLEREDE KENDER, hvis detaljeside pludselig fejler, faar
  // alligevel begge tidsstempler flyttet:
  //
  //   last_seen_at    discovery SAA den — den staar stadig i kildens liste,
  //                   og saa maa afmeldningen ikke tage den.
  //   last_fetched_at vi FORSOEGTE at hente den.
  //
  // Uden det sidste kom den aldrig ud af genopfriskningskoeen: den sorteres
  // aeldst foerst, og et forsoeg der fejler, opdaterede ingenting.
  //
  // BEMAERK at det ikke hjaelper paa boliger, der ALDRIG er blevet skrevet.
  // Propsteps seks 404-sider staar i gitteret men har ingen raekke i
  // listings, saa der er intet at opdatere — de bliver forsoegt hentet hver
  // time. Det koster seks kald i timen og staar som fejl i hver koersel.
  // En rigtig loesning kraever et sted at huske mislykkede noegler.
  if (fejledeNoegler.length) {
    for (let n = 0; n < fejledeNoegler.length; n += 500) {
      await db.update(listings)
        .set({ lastSeenAt: sql`now()`, lastFetchedAt: sql`now()` })
        .where(and(
          eq(listings.sourceId, kilde.id),
          inArray(listings.externalKey, fejledeNoegler.slice(n, n + 500)),
        ))
    }
  }

  // Bekraeftede: kun last_seen_at flyttes. Ingen netvaerkskald.
  let bekraeftede = 0
  for (let i = 0; i < bekraeftes.length; i += 500) {
    const batch = bekraeftes.slice(i, i + 500)
    const r = await db.update(listings)
      .set({ lastSeenAt: sql`now()`, status: 'active', delistedAt: null })
      .where(and(eq(listings.sourceId, kilde.id), inArray(listings.externalKey, batch)))
      .returning({ id: listings.id })
    bekraeftede += r.length
  }

  // ── Afmeldning, med sikring ──────────────────────────────────────────
  //
  // Tre uafhaengige grunde til IKKE at afmelde. En kilde der pludselig
  // leverer mindre, er langt oftere en knaekket parser end et tomt marked
  // — og afmelder vi paa den, toemmer én daarlig eftermiddag hele basen.
  //
  // Bemaerk at de tre daekker forskellige nedbrud. Discovery kan virke
  // perfekt, mens hvert eneste udtraek fejler (fx fordi adressevasken er
  // nede). Saa er discovered_count helt normalt, ingenting blev skrevet,
  // og en sikring der kun kiggede paa discovery ville afmelde alt.
  const median = await medianFund(kilde.id, 10)
  const skrevet = nye + opdaterede + bekraeftede
  const fejlandel = skalHentes.length ? fejl / skalHentes.length : 0

  const spring =
    fundne.length > 0 && skrevet === 0
      ? `intet kunne skrives: ${fundne.length} fundet, 0 skrevet, ${fejl} fejl`
    : skalHentes.length >= MINDST_HENTNINGER_FOR_FEJLANDEL && fejlandel > 0.2
      ? `for mange udtraek fejlede: ${fejl} af ${skalHentes.length} `
        + `(${Math.round(fejlandel * 100)} %, graensen er 20 %)`
    : median != null && fundne.length < median * graense
      ? `for faa fundet: ${fundne.length} mod en median paa ${median} `
        + `(under ${Math.round(graense * 100)} %)`
    : null

  let afmeldte = 0
  if (spring) {
    noter.push(`AFMELDNING SPRUNGET OVER — ${spring}. Ingen boliger afmeldt.`)
    return afslut({ fundet: fundne.length, nye, opdaterede, bekraeftede, iTilbagetraekning, afmeldte: 0, fejl, status: 'failed', noter })
  }

  const afmeldt = await db.update(listings)
    .set({ status: 'delisted', delistedAt: sql`now()` })
    .where(and(
      eq(listings.sourceId, kilde.id),
      eq(listings.status, 'active'),
      lt(listings.lastSeenAt, runStart),
    ))
    .returning({ id: listings.id })
  afmeldte = afmeldt.length

  if (fejl && skalHentes.length < MINDST_HENTNINGER_FOR_FEJLANDEL) {
    noter.push(`${fejl} af ${skalHentes.length} hentninger fejlede. For faa `
      + `hentninger til at fejlandelen siger noget — afmeldning ikke sprunget over.`)
  }
  if (median != null && fundne.length < median * 0.7) {
    noter.push(`ALARM: fandt ${fundne.length}, median er ${median} — fald paa `
      + `${Math.round((1 - fundne.length / median) * 100)} %.`)
  }

  return afslut({ fundet: fundne.length, nye, opdaterede, bekraeftede, iTilbagetraekning, afmeldte, fejl, status: 'ok', noter })
}
