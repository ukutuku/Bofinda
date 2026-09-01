// ═══════════════════════════════════════════════════════════════
//  Alarmer: gemte søgninger matchet mod nye boliger.
//
//  Matchning og afsendelse er ADSKILT. Her skabes kun køen. Intet
//  sendes, før træfsikkerheden er efterset — en mail kan ikke kaldes
//  tilbage.
// ═══════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { alertMatches, crawlRuns, listings, savedSearches, sources, users } from '../db/schema'
import { hvor, type Filtre } from './soeg'

/** Kriterierne gemmes som `Filtre`. Læses tilbage med samme form. */
const somFiltre = (c: Record<string, unknown>): Filtre => c as Filtre

export interface MatchResultat {
  soegning: string
  nyeTraef: number
}

/** Hvor længe en kilde skal have været overvåget, før en bolig uden
 *  dato fra kilden kan regnes som ny. */
const INDKOERING_TIMER = 24

/**
 * Finder nye træf for hver gemt søgning og lægger dem i køen.
 *
 * "Ny" er IKKE bare "vi så den efter søgningen blev oprettet". Ved den
 * første import af en kilde får hele dens bagkatalog `first_seen_at = nu`,
 * og så ville hver gemt søgning fyre på måneder gamle annoncer. En
 * prøvekørsel viste 68 falske varsler ud af 87, med en medianalder på 37
 * dage ved første syn.
 *
 * En bolig regnes derfor som ny, når vi så den efter søgningen blev
 * oprettet, OG
 *   · kilden siger, den er oprettet efter søgningen, ELLER
 *   · kilden oplyser ingen dato, men vi har overvåget den kilde i mindst
 *     et døgn — så er boligen dukket op MENS vi kiggede.
 *
 * Indsættelsen er `on conflict do nothing` på (søgning, bolig), så
 * matchningen kan køre igen og igen uden at varsle det samme to gange.
 */
export async function matchAlarmer(): Promise<MatchResultat[]> {
  const soegninger = await db
    .select({
      id: savedSearches.id,
      navn: savedSearches.name,
      kriterier: savedSearches.criteria,
      oprettet: savedSearches.createdAt,
    })
    .from(savedSearches)

  // Hvornaar begyndte vi at kigge paa hver kilde? Bruges til kilder uden
  // egen dato: en bolig der dukker op efter indkoeringen, er ny.
  const foersteKoersel = new Map(
    (await db
      .select({ id: crawlRuns.sourceId, foerst: sql<Date>`min(${crawlRuns.startedAt})` })
      .from(crawlRuns).groupBy(crawlRuns.sourceId))
      .map((r) => [r.id, r.foerst]),
  )

  const ud: MatchResultat[] = []
  for (const s of soegninger) {
    // SQL luger det meste: set efter søgningen, og enten oprettet hos
    // kilden efter søgningen eller uden dato overhovedet.
    const traef = await db
      .select({
        id: listings.id,
        kilde: listings.sourceId,
        foerstSet: listings.firstSeenAt,
        hosKilden: listings.sourceCreatedAt,
      })
      .from(listings)
      .innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(
        hvor(somFiltre(s.kriterier)),
        gt(listings.firstSeenAt, s.oprettet),
        or(
          gt(listings.sourceCreatedAt, s.oprettet),
          isNull(listings.sourceCreatedAt),
        ),
      ))

    // Kilder uden egen dato kan SQL ikke afgøre. Her kræves i stedet, at
    // boligen dukkede op, efter kilden havde været overvåget et døgn —
    // ellers er det bagkataloget fra første import.
    const gyldige = traef.filter((t) => {
      if (t.hosKilden) return true
      const foerst = foersteKoersel.get(t.kilde)
      if (!foerst) return false
      return +t.foerstSet > +new Date(foerst) + INDKOERING_TIMER * 3600_000
    })

    let nye = 0
    for (let i = 0; i < gyldige.length; i += 500) {
      const r = await db.insert(alertMatches)
        .values(gyldige.slice(i, i + 500).map((t) => ({ savedSearchId: s.id, listingId: t.id })))
        .onConflictDoNothing()
        .returning({ id: alertMatches.id })
      nye += r.length
    }
    if (nye) ud.push({ soegning: s.navn ?? s.id.slice(0, 8), nyeTraef: nye })
  }
  return ud
}

/** Alt der ligger og venter — grupperet, så det kan læses som den besked,
 *  der ville være sendt. */
export async function ventende() {
  const raekker = await db
    .select({
      soegningId: savedSearches.id,
      soegning: savedSearches.name,
      kriterier: savedSearches.criteria,
      modtager: users.email,
      paaMail: savedSearches.notifyEmail,
      matchetKl: alertMatches.matchedAt,
      adresse: listings.addressRaw,
      postnr: listings.postalCode,
      by: listings.city,
      areal: listings.sizeM2,
      vaerelser: listings.rooms,
      leje: listings.rentMonthly,
      total: listings.totalMonthly,
      indflytning: listings.moveInCost,
      boligId: listings.id,
      kilde: sources.name,
      foerstSet: listings.firstSeenAt,
      hosKilden: listings.sourceCreatedAt,
      status: listings.status,
    })
    .from(alertMatches)
    .innerJoin(savedSearches, eq(savedSearches.id, alertMatches.savedSearchId))
    .innerJoin(users, eq(users.id, savedSearches.userId))
    .innerJoin(listings, eq(listings.id, alertMatches.listingId))
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(isNull(alertMatches.sentAt))
    .orderBy(savedSearches.name, desc(alertMatches.matchedAt))

  const grupper = new Map<string, typeof raekker>()
  for (const r of raekker) {
    const n = grupper.get(r.soegningId) ?? []
    n.push(r)
    grupper.set(r.soegningId, n)
  }
  return [...grupper.values()]
}

/** Kriterierne som en linje, så det kan ses hvad søgningen faktisk beder om. */
export function beskrivFiltre(c: Record<string, unknown>): string {
  const f = somFiltre(c)
  const d: string[] = []
  if (f.by) d.push(`by ${f.by}`)
  if (f.postnr) d.push(`postnr ${f.postnr}`)
  if (f.prisMin != null) d.push(`fra ${(f.prisMin / 100).toLocaleString('da-DK')} kr.`)
  if (f.prisMax != null) d.push(`til ${(f.prisMax / 100).toLocaleString('da-DK')} kr.`)
  if (f.vaerelserMin != null) d.push(`mindst ${f.vaerelserMin} vær.`)
  if (f.arealMin != null) d.push(`mindst ${f.arealMin} m²`)
  if (f.kilder?.length) d.push(`kilder: ${f.kilder.join(', ')}`)
  if (f.fuldOekonomi) d.push('fuld økonomi kendt')
  return d.length ? d.join(' · ') : 'ingen filtre — alle boliger'
}

/** Opret en søgning. Brugeren oprettes efter behov på mailadressen. */
export async function opretSoegning(
  mail: string, navn: string, kriterier: Filtre,
): Promise<string> {
  const [u] = await db.insert(users)
    .values({ email: mail })
    .onConflictDoUpdate({ target: users.email, set: { email: mail } })
    .returning({ id: users.id })
  const [s] = await db.insert(savedSearches)
    .values({ userId: u!.id, name: navn, criteria: kriterier as Record<string, unknown> })
    .returning({ id: savedSearches.id })
  return s!.id
}

export async function soegninger() {
  return db
    .select({
      id: savedSearches.id,
      navn: savedSearches.name,
      mail: users.email,
      kriterier: savedSearches.criteria,
      oprettet: savedSearches.createdAt,
      ventende: sql<number>`(select count(*)::int from alert_matches m
        where m.saved_search_id = ${savedSearches.id} and m.sent_at is null)`,
    })
    .from(savedSearches)
    .innerJoin(users, eq(users.id, savedSearches.userId))
    .orderBy(asc(savedSearches.createdAt))
}
