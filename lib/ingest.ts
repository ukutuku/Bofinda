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
import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, listingImages, listings, sources } from '../db/schema'
import type { SourceAdapter } from './adapter'
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
const GENOPFRISK_EFTER_TIMER = 24
const GENOPFRISK_PR_KOERSEL = 60

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

/** Skriver én normaliseret bolig. Returnerer om den var ny. */
async function skrivBolig(
  sourceId: string,
  sourceType: 'feed' | 'spider' | 'native',
  b: Awaited<ReturnType<typeof normaliser>>,
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
      totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
      moveInCost: b.moveInCost, applicationType: b.applicationType,
      rentModel: b.rentModel, openHouseAt: b.openHouseAt,
      sourceCreatedAt: b.sourceCreatedAt, sourceUpdatedAt: b.sourceUpdatedAt,
      amenities: b.amenities, description: b.description,
      // Importerede boliger har aldrig kontakt i basen. Muren staar ved kilden.
      contactEmail: null, contactPhone: null, isBlurred: true,
      status: 'active', lastSeenAt: nu, lastFetchedAt: nu,
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
        totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
        moveInCost: b.moveInCost, applicationType: b.applicationType,
        rentModel: b.rentModel, openHouseAt: b.openHouseAt,
        sourceCreatedAt: b.sourceCreatedAt, sourceUpdatedAt: b.sourceUpdatedAt,
        amenities: b.amenities, description: b.description,
        // Dukker en afmeldt bolig op igen, er den ledig igen.
        status: 'active', delistedAt: null,
        lastSeenAt: nu, lastFetchedAt: nu,
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
    return afslut({ fundet: 0, nye: 0, opdaterede: 0, bekraeftede: 0, afmeldte: 0, fejl: 1, status: 'failed', noter })
  }

  // ── Hvad skal hentes? ────────────────────────────────────────────────
  // Kendte boliger hentes ikke igen hver gang. De faar last_seen_at flyttet,
  // saa afmeldningen ved at de stadig findes, og hentes paa tur.
  const kendte = new Map(
    (await db.select({
      key: listings.externalKey,
      hentet: listings.lastFetchedAt,
      status: listings.status,
    }).from(listings).where(eq(listings.sourceId, kilde.id)))
      .map((r) => [r.key, r]),
  )

  const forfaldenFoer = new Date(Date.now() - GENOPFRISK_EFTER_TIMER * 3600_000)
  const skalHentes: typeof fundne = []
  const bekraeftes: string[] = []
  const forfaldne: { externalKey: string; url: string; hentet: Date }[] = []

  for (const f of fundne) {
    const k = kendte.get(f.externalKey)
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
  for (const f of forfaldne.slice(0, GENOPFRISK_PR_KOERSEL)) {
    skalHentes.push({ externalKey: f.externalKey, url: f.url })
  }
  for (const f of forfaldne.slice(GENOPFRISK_PR_KOERSEL)) {
    bekraeftes.push(fundne.find((x) => x.url === f.url)!.externalKey)
  }

  if (skalHentes.length) {
    log(`[${adapter.id}] henter ${skalHentes.length} af ${fundne.length}`)
  }
  let nye = 0, opdaterede = 0, fejl = 0
  let i = 0
  const fejledeNoegler: string[] = []
  for (const { url, externalKey } of skalHentes) {
    if (++i % 20 === 0) log(`[${adapter.id}] ${i}/${skalHentes.length} hentet`)
    try {
      const raa = await adapter.extract(url)
      const b = await normaliser(raa)
      const { ny } = await skrivBolig(kilde.id, adapter.sourceType, b)
      ny ? nye++ : opdaterede++
    } catch (e) {
      fejl++
      // Alle poster i skalHentes baerer nu deres noegle — baade nye og
      // forfaldne — saa den kan altid slaas op.
      if (externalKey) fejledeNoegler.push(externalKey)
      if (fejl <= 5) noter.push(`${url}: ${(e as Error).message}`)
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
    return afslut({ fundet: fundne.length, nye, opdaterede, bekraeftede, afmeldte: 0, fejl, status: 'failed', noter })
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

  return afslut({ fundet: fundne.length, nye, opdaterede, bekraeftede, afmeldte, fejl, status: 'ok', noter })
}
