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

import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, listingImages, listings, sources } from '../db/schema'
import type { SourceAdapter } from './adapter'
import { normaliser } from './normalize'

export interface KoerselsResultat {
  kilde: string
  fundet: number
  nye: number
  opdaterede: number
  afmeldte: number
  fejl: number
  status: 'ok' | 'failed'
  noter: string[]
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
      totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
      moveInCost: b.moveInCost, amenities: b.amenities, description: b.description,
      // Importerede boliger har aldrig kontakt i basen. Muren staar ved kilden.
      contactEmail: null, contactPhone: null, isBlurred: true,
      status: 'active', lastSeenAt: nu,
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
        totalMonthly: b.totalMonthly, totalMonthlyComponents: b.totalMonthlyComponents,
        moveInCost: b.moveInCost, amenities: b.amenities, description: b.description,
        // Dukker en afmeldt bolig op igen, er den ledig igen.
        status: 'active', delistedAt: null,
        lastSeenAt: nu,
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

  const [run] = await db.insert(crawlRuns)
    .values({ sourceId: kilde.id, status: 'running' })
    .returning({ id: crawlRuns.id, startedAt: crawlRuns.startedAt })
  const runId = run!.id
  const runStart = run!.startedAt

  const afslut = async (r: Omit<KoerselsResultat, 'kilde'>) => {
    await db.update(crawlRuns).set({
      finishedAt: sql`now()`,
      discoveredCount: r.fundet,
      extractedCount: r.nye + r.opdaterede,
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
    return afslut({ fundet: 0, nye: 0, opdaterede: 0, afmeldte: 0, fejl: 1, status: 'failed', noter })
  }

  let nye = 0, opdaterede = 0, fejl = 0
  for (const { url } of fundne) {
    try {
      const raa = await adapter.extract(url)
      const b = await normaliser(raa)
      const { ny } = await skrivBolig(kilde.id, adapter.sourceType, b)
      ny ? nye++ : opdaterede++
    } catch (e) {
      fejl++
      if (fejl <= 5) noter.push(`${url}: ${(e as Error).message}`)
    }
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
  const skrevet = nye + opdaterede
  const fejlandel = fundne.length ? fejl / fundne.length : 0

  const spring =
    fundne.length > 0 && skrevet === 0
      ? `intet kunne skrives: ${fundne.length} fundet, 0 skrevet, ${fejl} fejl`
    : fejlandel > 0.2
      ? `for mange udtraek fejlede: ${fejl} af ${fundne.length} `
        + `(${Math.round(fejlandel * 100)} %, graensen er 20 %)`
    : median != null && fundne.length < median * graense
      ? `for faa fundet: ${fundne.length} mod en median paa ${median} `
        + `(under ${Math.round(graense * 100)} %)`
    : null

  let afmeldte = 0
  if (spring) {
    noter.push(`AFMELDNING SPRUNGET OVER — ${spring}. Ingen boliger afmeldt.`)
    return afslut({ fundet: fundne.length, nye, opdaterede, afmeldte: 0, fejl, status: 'failed', noter })
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

  if (median != null && fundne.length < median * 0.7) {
    noter.push(`ALARM: fandt ${fundne.length}, median er ${median} — fald paa `
      + `${Math.round((1 - fundne.length / median) * 100)} %.`)
  }

  return afslut({ fundet: fundne.length, nye, opdaterede, afmeldte, fejl, status: 'ok', noter })
}
