// ═══════════════════════════════════════════════════════════════
//  Supply-baseline — kør med `tsx scripts/supply-baseline.ts`.
//
//  REPRODUCÉRBAR definition: hver ny kilde skal senere måles mod PRÆCIS
//  de her begreber, ikke mod et øjebliksbillede i et chatvindue.
//
//    aktive     status='active' (rå source-records)
//    synlige    hvor({}) — aktiv + adressevask ≠ failed
//    unikke     udenDubletter(hvor({})) — det, brugeren ser. HOVED-KPI.
//
//  Geografi (dokumenteret bucket-definition, postnummer-intervaller):
//    kbh_frb    1000–2499   (København + Frederiksberg)
//    stor_kbh   2500–2999   (øvrige Storkøbenhavn)
//    aarhus     8000–8399
//    odense     5000–5299
//    aalborg    9000–9299
//    rest       alt andet
// ═══════════════════════════════════════════════════════════════
import { db } from '@/db/client'
import { listings, sources } from '@/db/schema'
import { eq, sql as d } from 'drizzle-orm'
import { hvor, udenDubletter, availabilityFor, VISBAR_VAERT } from '@/lib/soeg'

const rows = <T>(r: unknown): T[] => (r as { rows?: T[] }).rows ?? (r as T[])
const REF = new Date()
const GEO = d`case
  when postal_code ~ '^[12]' and postal_code::int between 1000 and 2499 then 'kbh_frb'
  when postal_code::int between 2500 and 2999 then 'stor_kbh'
  when postal_code::int between 8000 and 8399 then 'aarhus'
  when postal_code::int between 5000 and 5299 then 'odense'
  when postal_code::int between 9000 and 9299 then 'aalborg'
  else 'rest' end`

const pr = await db.select({
  slug: sources.slug,
  aktive: d<number>`count(*) filter (where ${listings.status} = 'active')::int`,
  synlige: d<number>`count(*) filter (where ${hvor({})})::int`,
  unikke: d<number>`count(*) filter (where ${udenDubletter(hvor({}))})::int`,
  kbh: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'kbh_frb')::int`,
  storkbh: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'stor_kbh')::int`,
  aarhus: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'aarhus')::int`,
  odense: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'odense')::int`,
  aalborg: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'aalborg')::int`,
  rest: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${GEO} = 'rest')::int`,
  billeder: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and exists (
    select 1 from listing_images i where i.listing_id = ${listings.id} and ${VISBAR_VAERT}))::int`,
  husleje: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${listings.rentMonthly} is not null)::int`,
  aconto: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and (
    ${listings.utilitiesHeat} is not null or ${listings.utilitiesWater} is not null
    or ${listings.utilitiesElectricity} is not null or ${listings.utilitiesOther} is not null))::int`,
  depositum: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${listings.deposit} is not null)::int`,
  forudbetalt: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${listings.prepaidRent} is not null)::int`,
  facts: d<number>`count(*) filter (where ${udenDubletter(hvor({}))} and ${listings.availabilityFacts} is not null)::int`,
}).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
  .groupBy(sources.slug).orderBy(d`count(*) filter (where ${udenDubletter(hvor({}))}) desc`)

// Availability-dækning kræver domænet — hentes og fortolkes i JS.
const alle = await db.select({
  slug: sources.slug, availabilityFacts: listings.availabilityFacts, kilde: sources.slug,
}).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
  .where(udenDubletter(hvor({})))
const av = new Map<string, { marked: number; timing: number; ansoeg: number; n: number }>()
for (const r of alle) {
  const a = availabilityFor(r, REF)
  const e = av.get(r.slug) ?? { marked: 0, timing: 0, ansoeg: 0, n: 0 }
  e.n++
  if (a.marked.status !== 'unknown') e.marked++
  if (a.timing.status !== 'unknown') e.timing++
  if (a.ansoegning.status !== 'unknown') e.ansoeg++
  av.set(r.slug, e)
}
const drift = rows<{ slug: string; sidst: string | null; fejlrate: string }>(await db.execute(d`
  select so.slug, max(c.started_at) filter (where c.status = 'ok')::text as sidst,
    round(100.0 * count(*) filter (where c.status <> 'ok' and c.id in (
      select c2.id from crawl_runs c2 where c2.source_id = so.id
      order by c2.started_at desc limit 20))
      / greatest(least(count(*), 20), 1), 1)::text as fejlrate
  from sources so left join crawl_runs c on c.source_id = so.id group by so.id, so.slug`))

const pct = (x: number, n: number) => n ? `${Math.round(100 * x / n)} %` : '—'
console.log(`# Supply-baseline · ${REF.toISOString()}\n`)
console.log('| source | aktive | synlige | unikke | kbh+frb | storkbh | aarhus | odense | aalborg | rest | billeder | husleje | aconto | depositum | forudbet. | facts | marked | timing | ansøgn. | seneste ok | fejlrate |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
const sum = { aktive: 0, synlige: 0, unikke: 0, kbh: 0, storkbh: 0, aarhus: 0, odense: 0, aalborg: 0, rest: 0 }
for (const r of pr) {
  const a = av.get(r.slug) ?? { marked: 0, timing: 0, ansoeg: 0, n: r.unikke }
  const dr = drift.find((x) => x.slug === r.slug)
  sum.aktive += r.aktive; sum.synlige += r.synlige; sum.unikke += r.unikke
  sum.kbh += r.kbh; sum.storkbh += r.storkbh; sum.aarhus += r.aarhus
  sum.odense += r.odense; sum.aalborg += r.aalborg; sum.rest += r.rest
  console.log(`| ${r.slug} | ${r.aktive} | ${r.synlige} | ${r.unikke} | ${r.kbh} | ${r.storkbh} | ${r.aarhus} | ${r.odense} | ${r.aalborg} | ${r.rest} | ${pct(r.billeder, r.unikke)} | ${pct(r.husleje, r.unikke)} | ${pct(r.aconto, r.unikke)} | ${pct(r.depositum, r.unikke)} | ${pct(r.forudbetalt, r.unikke)} | ${pct(r.facts, r.unikke)} | ${pct(a.marked, a.n)} | ${pct(a.timing, a.n)} | ${pct(a.ansoeg, a.n)} | ${dr?.sidst?.slice(0, 16) ?? '—'} | ${dr?.fejlrate ?? '—'} % |`)
}
console.log(`| **I ALT** | **${sum.aktive}** | **${sum.synlige}** | **${sum.unikke}** | **${sum.kbh}** | **${sum.storkbh}** | **${sum.aarhus}** | **${sum.odense}** | **${sum.aalborg}** | **${sum.rest}** | | | | | | | | | | | |`)
console.log(`\nDedup-reduktion: ${sum.synlige} synlige → ${sum.unikke} unikke (${sum.synlige - sum.unikke} dubletter på tværs af kilder).`)
process.exit(0)
