// ═══════════════════════════════════════════════════════════════
//  Områdesider: hvilke findes, og hvad ved vi om dem.
//
//  Alt herunder er talt af de boliger, vi faktisk har. Der staar ingen
//  paastande om markedet, kun tal vi kan pege paa raekkerne bag.
// ═══════════════════════════════════════════════════════════════

import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { udenDubletter } from './soeg'
import { listings } from '../db/schema'
import { MINDST_BOLIGER, slug } from './slug'

export interface Omraade {
  slags: 'by' | 'postnummer'
  slug: string
  /** Som det skrives paa siden: "København S" eller "2300 København S". */
  navn: string
  /** Vaerdien der filtreres paa i basen. */
  vaerdi: string
  antal: number
}

// Dedupet, ligesom soegesiden. Tallene i broedteksten staar over listen
// paa samme side — taller de to forskelligt, er den ene forkert.
const synlig = udenDubletter(
  and(eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed')),
)

/**
 * Alle omraader med nok boliger til at fortjene en side.
 *
 * Slug'en beregnes i JS og ikke i SQL. Reglen ville ellers findes to
 * steder, og to steder driver fra hinanden.
 */
export async function alleOmraader(): Promise<Omraade[]> {
  const byer = await db
    .select({ by: listings.city, antal: sql<number>`count(*)::int` })
    .from(listings).where(synlig).groupBy(listings.city)
  const postnumre = await db
    .select({
      postnr: listings.postalCode,
      by: sql<string>`mode() within group (order by ${listings.city})`,
      antal: sql<number>`count(*)::int`,
    })
    .from(listings).where(synlig).groupBy(listings.postalCode)

  const ud: Omraade[] = []
  for (const b of byer) {
    if (!b.by || b.antal < MINDST_BOLIGER) continue
    ud.push({ slags: 'by', slug: slug(b.by), navn: b.by, vaerdi: b.by, antal: b.antal })
  }
  for (const p of postnumre) {
    if (!p.postnr || p.antal < MINDST_BOLIGER) continue
    ud.push({
      slags: 'postnummer', slug: p.postnr,
      navn: `${p.postnr} ${p.by ?? ''}`.trim(), vaerdi: p.postnr, antal: p.antal,
    })
  }

  // To byer kan slugge ens ("Aarhus C" findes kun én gang, men reglen skal
  // holde uanset). Den med flest boliger vinder — resten faar ingen side.
  const bedste = new Map<string, Omraade>()
  for (const o of ud) {
    const haves = bedste.get(o.slug)
    if (!haves || o.antal > haves.antal) bedste.set(o.slug, o)
  }
  return [...bedste.values()].sort((a, b) => b.antal - a.antal)
}

export async function findOmraade(s: string): Promise<Omraade | null> {
  return (await alleOmraader()).find((o) => o.slug === s) ?? null
}

const filterFor = (o: Omraade) =>
  and(synlig, o.slags === 'by'
    ? eq(listings.city, o.vaerdi)
    : eq(listings.postalCode, o.vaerdi))

export interface Statistik {
  antal: number
  medTotal: number
  gennemsnitLeje: number | null
  billigst: number | null
  dyrest: number | null
  medianIndflytning: number | null
  medianAreal: number | null
  typer: { type: string; antal: number }[]
}

export async function statistik(o: Omraade): Promise<Statistik> {
  const [r] = await db
    .select({
      antal: sql<number>`count(*)::int`,
      medTotal: sql<number>`count(${listings.totalMonthly})::int`,
      // Samme tal som soegesiden filtrerer og sorterer paa: den reelle
      // maanedlige udgift naar den kendes, ellers huslejen. Ellers ville
      // omraadesidens prisinterval sige noget andet end filteret.
      gennemsnitLeje: sql<number | null>`round(avg(coalesce(${listings.totalMonthly}, ${listings.rentMonthly})))::int`,
      billigst: sql<number | null>`min(coalesce(${listings.totalMonthly}, ${listings.rentMonthly}))`,
      dyrest: sql<number | null>`max(coalesce(${listings.totalMonthly}, ${listings.rentMonthly}))`,
      // Median og ikke gennemsnit: én dyr bolig maa ikke flytte "typisk".
      medianIndflytning: sql<number | null>`
        percentile_cont(0.5) within group (order by ${listings.moveInCost})::int`,
      medianAreal: sql<number | null>`
        percentile_cont(0.5) within group (order by ${listings.sizeM2})::int`,
    })
    .from(listings).where(filterFor(o))

  const typer = await db
    .select({ type: sql<string>`coalesce(${listings.propertyType}::text, 'ukendt')`,
      antal: sql<number>`count(*)::int` })
    .from(listings).where(filterFor(o))
    .groupBy(listings.propertyType).orderBy(sql`count(*) desc`)

  return { ...r!, typer }
}

/**
 * Tilgraensende omraader, saa siderne binder sammen.
 *
 * Vi har hverken kommune eller region i basen, saa naerhed maales paa
 * postnummeret. Det er groft, men det er en oplysning vi HAR — modsat en
 * geografisk naerhed vi ville skulle opfinde.
 */
export async function naboer(o: Omraade, antal = 8): Promise<Omraade[]> {
  const alle = await alleOmraader()

  if (o.slags === 'postnummer') {
    const mit = Number(o.vaerdi)
    const [r] = await db.select({ by: sql<string | null>`mode() within group (order by ${listings.city})` })
      .from(listings).where(filterFor(o))
    const minBy = r?.by ?? null
    return alle
      .filter((a) => a.slug !== o.slug)
      // Byen postnummeret ligger i, foerst — derefter de naermeste postnumre.
      .map((a) => ({
        a,
        vaegt: a.slags === 'by' && a.navn === minBy ? -1
          : a.slags === 'postnummer' ? Math.abs(Number(a.vaerdi) - mit)
          : Number.POSITIVE_INFINITY,
      }))
      .filter((x) => Number.isFinite(x.vaegt))
      .sort((x, y) => x.vaegt - y.vaegt)
      .slice(0, antal).map((x) => x.a)
  }

  // For en by: dens egne postnumre foerst, saa de stoerste nabobyer.
  const egne = await db
    .select({ postnr: listings.postalCode, antal: sql<number>`count(*)::int` })
    .from(listings).where(filterFor(o)).groupBy(listings.postalCode)
    .orderBy(sql`count(*) desc`)
  const egneSlugs = new Set(egne.map((e) => e.postnr).filter(Boolean) as string[])

  const mine = alle.filter((a) => a.slags === 'postnummer' && egneSlugs.has(a.slug))
  const andre = alle.filter((a) => a.slags === 'by' && a.slug !== o.slug)
  return [...mine, ...andre].slice(0, antal)
}
