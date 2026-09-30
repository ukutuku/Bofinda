// ═══════════════════════════════════════════════════════════════
//  Chiprækkens to tællende chips — fordelingen af nuller og små tal.
//  SKRIVEBESKYTTET: kun select. Syntetiske data (lokal testbase).
//
//  Samme vej som søgesiden: filtreFraParametre() → opsummering().
//  Rækken tegnes kun, når harFiltre(f) og der er kort (app/page.tsx:1044);
//  her tilnærmet med sum.antal > 0.
//
//      source scripts/cloud/miljoe.sh; export DATABASE_URL_DIRECT="$(test_url)"
//      ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json docs/designforslag/maalinger/maal-chips.mjs
//
//  --prod  tillader en anden base end den isolerede testbase. Kun til den,
//          der har adgang og vælger det med vilje. Scriptet laver kun
//          select og skriver kun den JSON-fil, --json peger på. IKKE kørt mod produktionen.
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs'
const ROD = process.env.ROD
const PROD = process.argv.includes('--prod')
const url = process.env.DATABASE_URL_DIRECT ?? ''
if (!PROD && !/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):55432\//.test(url)) {
  console.error('FEJL: ikke den isolerede testbase (brug --prod med vilje)'); process.exit(2)
}
const { db } = await import(`${ROD}/db/client.ts`)
const { listings, sources } = await import(`${ROD}/db/schema.ts`)
const { opsummering, filtreFraParametre, harFiltre } = await import(`${ROD}/lib/soeg.ts`)
const { BOLIGTYPER } = await import(`${ROD}/lib/soeg.ts`)
const { eq, sql } = await import('drizzle-orm')

const nu = new Date()

// ─── Rå dækning i basen ────────────────────────────────────────
const daekning = await db.select({
  kilde: sources.slug, type: sources.sourceType,
  antal: sql`count(*)::int`, medTotal: sql`count(${listings.totalMonthly})::int`,
  medIndflytning: sql`count(${listings.moveInCost})::int`,
  medDepositum: sql`count(${listings.deposit})::int`, medForudbetalt: sql`count(${listings.prepaidRent})::int`,
}).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
  .where(eq(listings.status, 'active')).groupBy(sources.slug, sources.sourceType).orderBy(sources.slug)

// ─── Universet ─────────────────────────────────────────────────
const steder = await db.selectDistinct({ postnr: listings.postalCode, by: listings.city })
  .from(listings).where(eq(listings.status, 'active'))
const postnumre = [...new Set(steder.map((s) => s.postnr).filter(Boolean))].sort()
const byer = [...new Set(steder.map((s) => s.by).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'da'))
const kilder = daekning.map((d) => d.kilde)

async function maal(sp) {
  const f = filtreFraParametre(sp)
  if (!harFiltre(f)) return null
  const s = await opsummering(f, nu)
  return { sp, antal: s.antal, medTotal: s.medTotal, medIndflytning: s.medIndflytning,
    billigst: s.billigst, dyrest: s.dyrest }
}

const A = [] // stedet alene — det, en søgning fra forsiden giver
for (const p of postnumre) A.push(await maal({ sted: p }))
for (const b of byer) A.push(await maal({ sted: b }))

const B = [] // stedet × ét ekstra filter — det, en bruger klikker sig til
const ekstra = [
  ...[1, 2, 3, 4, 5].map((v) => ({ vaerelser: String(v) })),
  ...kilder.map((k) => ({ kilde: k })),
  ...BOLIGTYPER.map((t) => ({ type: t })),
  ...[6000, 8000, 10000, 12000, 15000].map((p) => ({ prisMax: String(p) })),
  ...[50, 70, 90].map((a) => ({ areal: String(a) })),
  { fuld: '1' }, { overtagelse: 'nu' }, { overtagelse: 'senere' },
  { elevator: '1' }, { kaeledyr: '1' }, { udeplads: '1' },
]
for (const sted of [...postnumre, ...byer]) for (const e of ekstra) B.push(await maal({ sted, ...e }))
for (const e of ekstra) B.push(await maal(e)) // uden sted

const synlig = (xs) => xs.filter((x) => x && x.antal > 0)
function fordeling(xs, felt) {
  const v = synlig(xs)
  const nul = v.filter((x) => x[felt] === 0).length
  const alle = v.filter((x) => x[felt] === x.antal).length
  const smaa = v.filter((x) => x[felt] > 0 && x[felt] < 3).length
  const andele = v.map((x) => x[felt] / x.antal).sort((a, b) => a - b)
  const q = (p) => andele.length ? +andele[Math.min(andele.length - 1, Math.floor(p * andele.length))].toFixed(3) : null
  return { soegninger_med_chiprække: v.length, lig_nul: nul, en_eller_to: smaa, lig_antal: alle,
    andel_min: q(0), andel_median: q(0.5), andel_max: andele.length ? +andele.at(-1).toFixed(3) : null }
}

const ud = {
  note: PROD ? 'PRODUKTION (--prod), kun select.'
    : 'SYNTETISKE data: isoleret lokal testbase (seed med 280 boliger; Attrapby, Prøveby N, Prøveby S, Fiktivby). Ikke produktionstal.',
  maalt: nu.toISOString(),
  vej: 'filtreFraParametre(sp) → harFiltre(f) → opsummering(f, nu) i lib/soeg.ts — samme vej som app/page.tsx:190/224',
  daekning_pr_kilde: daekning,
  stedet_alene: {
    fordeling_medTotal: fordeling(A, 'medTotal'),
    fordeling_medIndflytning: fordeling(A, 'medIndflytning'),
    soegninger: synlig(A),
  },
  sted_eller_intet_plus_et_filter: {
    antal_kombinationer: B.length,
    fordeling_medTotal: fordeling(B, 'medTotal'),
    fordeling_medIndflytning: fordeling(B, 'medIndflytning'),
    nul_total_eksempler: synlig(B).filter((x) => x.medTotal === 0).slice(0, 12),
    // Ved medTotal = 0 er hver pris i spændet coalesce(total, husleje) = husleje.
    nul_total_med_spaend: synlig(B).filter((x) => x.medTotal === 0 && x.billigst != null).length,
    nul_total_spaend_af_en_pris: synlig(B).filter((x) => x.medTotal === 0 && x.billigst != null && x.billigst === x.dyrest).length,
    spaend_af_en_pris_i_alt: synlig(B).filter((x) => x.billigst != null && x.billigst === x.dyrest).length,
    smaa_total_eksempler: synlig(B).filter((x) => x.medTotal > 0 && x.medTotal < 3)
      .map((x) => ({ sp: x.sp, antal: x.antal, medTotal: x.medTotal })),
    kilde_alene: synlig(B).filter((x) => x.sp.kilde && !x.sp.sted)
      .map((x) => ({ kilde: x.sp.kilde, antal: x.antal, medTotal: x.medTotal, medIndflytning: x.medIndflytning })),
    lav_total_andel_eksempler: synlig(B).filter((x) => x.medTotal > 0 && x.medTotal / x.antal < 0.5)
      .sort((a, b) => a.medTotal / a.antal - b.medTotal / b.antal).slice(0, 8),
  },
}
// Kun med --json <sti>: et script i repoet må ikke lægge filer ved siden af sig selv.
const ji = process.argv.indexOf('--json')
if (ji > 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(ud, null, 2))
console.log(JSON.stringify({ daekning: ud.daekning_pr_kilde, A: ud.stedet_alene.fordeling_medTotal,
  Aind: ud.stedet_alene.fordeling_medIndflytning, B: ud.sted_eller_intet_plus_et_filter.fordeling_medTotal,
  Bind: ud.sted_eller_intet_plus_et_filter.fordeling_medIndflytning,
  nul: ud.sted_eller_intet_plus_et_filter.nul_total_eksempler.map((x) => [x.sp, x.antal]),
  lav: ud.sted_eller_intet_plus_et_filter.lav_total_andel_eksempler.map((x) => [x.sp, x.medTotal, x.antal]),
  soegA: ud.stedet_alene.soegninger.map((x) => [x.sp.sted, x.antal, x.medTotal, x.medIndflytning]) }, null, 1))
process.exit(0)
