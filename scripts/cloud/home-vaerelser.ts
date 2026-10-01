// ═══════════════════════════════════════════════════════════════
//  Hvad sker der, når home.dk begynder at oplyse `rooms`?
//
//  PR #7 retter adapteren, så `stats.rooms` hentes. Feltet var null på
//  hver eneste home-bolig før. `rooms` indgår i TRE forskellige
//  mekanismer, og de skal skelnes — de trækker ikke samme vej:
//
//    1 · GRUPPEKORT.  `KAN_GRUPPERES` kræver `rooms is not null`.
//        Boliger, der før stod alene, kan nu blive ét gruppekort.
//        Færre kort, SAMME antal boliger.
//
//    2 · DEDUP VED OPGANGSMATCH (`access`).  Nøglen er
//        `access:<uuid>:<areal>:<værelser>:<husleje>`, og værelsestallet
//        indgår som `coalesce(rooms::text,'?')`. Her går det BEGGE veje:
//        et rigtigt tal kan få home til at matche en anden kildes
//        annonce (en bolig SKJULES) — og det kan få to home-annoncer,
//        der før begge var `?` og derfor blev dedupet mod hinanden, til
//        at skille sig ad igen (en bolig KOMMER FREM).
//
//    3 · DEDUP VED PRÆCIST BOLIGMATCH (`unit`).  Nøglen er
//        `unit:<boligadresse-uuid>` og INTET andet. Værelsestallet
//        indgår ikke. Her kan rettelsen per definition ikke ændre noget.
//
//  FØR-tilstanden modelleres raekke for raekke: KUN home-annoncerne har
//  `rooms = null`. De andre kilders vaerelsestal stod der hele tiden.
//  Saetter man ALLE kilder til null i FØR, maaler man noget andet —
//  «ingen havde vaerelsestal → alle fik det» — og dedup-tallene bliver
//  forkerte begge veje.
//
//  ⚠ MÅLINGEN ER ISOLERET OG SYNTETISK. Der er ingen læseadgang til
//    produktionsdata fra dette miljø, så tallene her siger, hvordan
//    mekanismerne opfører sig — ikke hvor mange rigtige boliger der
//    rammes. Tallet «~229» fra PR-teksten er IKKE efterprøvet og må
//    ikke gengives som et målt antal berørte boliger.
//
//  Værelsestallet 2 er DOKUMENTERET: begge kildeprøver i
//  scripts/kildeproever/home/ (hentet 15. sep. 2026) har `stats.rooms`
//  = 2. Alt andet nedenfor — adresser, arealer, huslejer, og
//  værelsestallet 3 — er OPDIGTET og mærket som sådan.
//
//      DATABASE_URL=… npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/cloud/home-vaerelser.ts
// ═══════════════════════════════════════════════════════════════
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { listings, sources } from '../../db/schema'
import { soeg, soegGrupperet, udenDubletter, hvor, antalBoliger, type Filtre } from '../../lib/soeg'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(url || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.')
    process.exit(1)
  }
}

/** Postnummeret er målingens eget. Ingen anden række må ligge der. */
const POSTNR = '9900'
const F: Filtre = { postnr: POSTNR }

/**
 * `--behold` lader EFTER-tilstanden staa i basen, saa gruppekortet kan
 * aabnes i en browser bagefter (adgang til gruppens boliger, og om
 * listen og landkortet viser det samme). Uden flaget ryddes der op.
 */
const BEHOLD = process.argv.includes('--behold')

/** Dokumenteret: begge kildeprøver har stats.rooms = 2. */
const DOK = 2
/** Opdigtet. Findes ikke i nogen kildeprøve. */
const SYNT = 3

const HOME = 'maaling-home'
const ANDEN = 'maaling-anden'

async function ryd() {
  const s = await db.select({ id: sources.id }).from(sources)
    .where(sql`${sources.slug} in (${HOME}, ${ANDEN})`)
  for (const x of s) await db.delete(listings).where(eq(listings.sourceId, x.id))
  await db.delete(sources).where(sql`${sources.slug} in (${HOME}, ${ANDEN})`)
}

async function kilde(slug: string, navn: string) {
  const [r] = await db.insert(sources)
    .values({ slug, name: navn, sourceType: 'spider', baseUrl: 'http://127.0.0.1/maaling' })
    .returning({ id: sources.id })
  if (!r) throw new Error('kunne ikke oprette kilden')
  return r.id
}

interface Sag {
  id: string
  kilde: string
  niveau: 'access' | 'unit'
  uuid: string
  vej: string
  husnr: string
  areal: number
  leje: number
  total: number | null
  vaerelser: number | null
  /** Opdigtede koordinater. Uden dem faar raekken intet maerke paa kortet. */
  lat: string
  lng: string
  note: string
}

async function saet(sag: Sag, kildeId: string) {
  await db.insert(listings).values({
    sourceId: kildeId,
    sourceType: 'spider',
    externalKey: sag.id,
    sourceUrl: `http://127.0.0.1/maaling/${sag.id}`,
    status: 'active',
    street: sag.vej,
    houseNumber: sag.husnr,
    postalCode: POSTNR,
    city: 'Måleby',
    addressMatchLevel: sag.niveau,
    lat: sag.lat,
    lng: sag.lng,
    unitAddressUuid: sag.niveau === 'unit' ? sag.uuid : null,
    accessAddressUuid: sag.niveau === 'access' ? sag.uuid : null,
    addressRaw: `${sag.vej} ${sag.husnr}, ${POSTNR} Måleby`,
    propertyType: 'lejlighed',
    sizeM2: sag.areal,
    // FØR-tilstanden modelleres raekke for raekke, ikke over én kam:
    // KUN home manglede `rooms`. Satte vi alle kilder til null, målte vi
    // «ingen havde værelsestal → alle fik det», og det er ikke den
    // ændring, PR #7 laver. De andre kilders tal stod der hele tiden.
    rooms: sag.kilde === HOME ? null : sag.vaerelser,
    rentMonthly: sag.leje,
    totalMonthly: sag.total,
    totalMonthlyComponents: sag.total != null ? ['heating'] : null,
    sourceCreatedAt: null,       // alarmens indkoeringsvagt skal ikke omgaas
  })
}

// ── Datasættet ─────────────────────────────────────────────────
const SAGER: Sag[] = [
  // 1 · Gruppekort: tre home-annoncer, samme vej og postnummer, hver
  //     sin opgang (så de aldrig dedupes mod hinanden).
  { id: 'g1', kilde: HOME, niveau: 'access', uuid: 'U-G1', vej: 'Målevej', husnr: '1',
    areal: 70, leje: 1000000, total: 1100000, lat: '57.0480000', lng: '9.9200000',
    vaerelser: DOK, note: 'gruppe, dokumenteret 2 vær.' },
  { id: 'g2', kilde: HOME, niveau: 'access', uuid: 'U-G2', vej: 'Målevej', husnr: '3',
    areal: 72, leje: 1010000, total: 1110000, lat: '57.0482000', lng: '9.9203000',
    vaerelser: DOK, note: 'gruppe, dokumenteret 2 vær.' },
  { id: 'g3', kilde: HOME, niveau: 'access', uuid: 'U-G3', vej: 'Målevej', husnr: '5',
    areal: 74, leje: 1020000, total: 1120000, lat: '57.0484000', lng: '9.9206000',
    vaerelser: DOK, note: 'gruppe, dokumenteret 2 vær.' },

  // 2 · Opgangsmatch på tværs af kilder, hvor værelsestallet STEMMER.
  //     Den anden kilde har en kendt total og vinder derfor
  //     repræsentantvalget — home-annoncen skjules.
  { id: 'd1', kilde: HOME, niveau: 'access', uuid: 'U-D', vej: 'Dubletvej', husnr: '2',
    areal: 80, leje: 1200000, total: null, lat: '57.0500000', lng: '9.9250000',
    vaerelser: DOK, note: 'opgangsmatch, dokumenteret 2 vær.' },
  { id: 'd2', kilde: ANDEN, niveau: 'access', uuid: 'U-D', vej: 'Dubletvej', husnr: '2',
    areal: 80, leje: 1200000, total: 1300000, lat: '57.0500000', lng: '9.9250000',
    vaerelser: DOK, note: 'anden kilde, samme opgang' },

  // 3 · Kontrolgruppe: opgangsmatch hvor værelsestallet IKKE stemmer.
  { id: 'k1', kilde: HOME, niveau: 'access', uuid: 'U-K', vej: 'Kontrolvej', husnr: '4',
    areal: 85, leje: 1400000, total: null, lat: '57.0520000', lng: '9.9300000',
    vaerelser: DOK, note: 'kontrol, dokumenteret 2 vær.' },
  { id: 'k2', kilde: ANDEN, niveau: 'access', uuid: 'U-K', vej: 'Kontrolvej', husnr: '4',
    areal: 85, leje: 1400000, total: 1500000, lat: '57.0520000', lng: '9.9300000',
    vaerelser: SYNT, note: 'anden kilde, OPDIGTET 3 vær.' },

  // 4 · To home-annoncer paa SAMME opgang, som foer begge var «?» og
  //     derfor blev dedupet mod hinanden. Med rigtige tal skilles de ad.
  { id: 's1', kilde: HOME, niveau: 'access', uuid: 'U-S', vej: 'Splitvej', husnr: '6',
    areal: 90, leje: 1600000, total: 1700000, lat: '57.0540000', lng: '9.9350000',
    vaerelser: DOK, note: 'split, dokumenteret 2 vær.' },
  { id: 's2', kilde: HOME, niveau: 'access', uuid: 'U-S', vej: 'Splitvej', husnr: '6',
    areal: 90, leje: 1600000, total: 1700000, lat: '57.0540000', lng: '9.9350000',
    vaerelser: SYNT, note: 'split, OPDIGTET 3 vær.' },

  // 5 · Praecist boligmatch. Noeglen er boligadresse-id'et alene.
  { id: 'u1', kilde: HOME, niveau: 'unit', uuid: 'U-UNIT', vej: 'Enhedsvej', husnr: '8',
    areal: 95, leje: 1800000, total: null, lat: '57.0560000', lng: '9.9400000',
    vaerelser: DOK, note: 'unit, dokumenteret 2 vær.' },
  { id: 'u2', kilde: ANDEN, niveau: 'unit', uuid: 'U-UNIT', vej: 'Enhedsvej', husnr: '8',
    areal: 95, leje: 1800000, total: 1900000, lat: '57.0560000', lng: '9.9400000',
    vaerelser: DOK, note: 'anden kilde, samme bolig' },
]

async function maal(navn: string) {
  const [a] = await db.select({ n: sql<number>`count(*)::int` })
    .from(listings).where(hvor(F))
  const [e] = await db.select({ n: sql<number>`count(*)::int` })
    .from(listings).where(udenDubletter(hvor(F)))
  const g = await soegGrupperet(F, 48)
  const kort = g.visninger.length
  const boligerPaaKort = antalBoliger(g.visninger)

  const synlige = await soeg(F, 96)
  const synligeIds = new Set(synlige.map((b) => b.id))
  const alle = await db.select({ noegle: listings.externalKey, id: listings.id })
    .from(listings).where(hvor(F))
  const skjulte = alle.filter((x) => !synligeIds.has(x.id)).map((x) => x.noegle)

  // Raekke for raekke: noeglen og om den overlevede dubletbehandlingen.
  // Uden den her kan et samlet tal ikke forklares, kun gengives.
  const detalje = await db.execute(sql`
    select l.external_key as k, l.rooms,
      case
        when l.address_match_level = 'unit' and l.unit_address_uuid is not null
          then 'unit:' || l.unit_address_uuid
        when l.address_match_level = 'access' and l.access_address_uuid is not null
             and l.house_number is not null
          then 'access:' || l.access_address_uuid
            || ':' || coalesce(l.size_m2::text, '?')
            || ':' || coalesce(l.rooms::text, '?')
            || ':' || coalesce(round(l.rent_monthly / 10000.0)::text, '?')
        else null
      end as noegle,
      (l.id in (select id from listings where ${udenDubletter(hvor(F))})) as vist
    from listings l where l.postal_code = ${POSTNR} order by l.external_key`)

  return {
    navn,
    detalje,
    annoncer: a?.n ?? 0,
    efterDedup: e?.n ?? 0,
    kort,
    boligerPaaKort,
    synlige: synlige.length,
    grupper: g.visninger.filter((v) => v.slags === 'gruppe').length,
    synligeIds,
    skjulte,
  }
}

const ret = (n: number, f: number) => {
  const d = n - f
  return d === 0 ? '  =' : (d > 0 ? `  +${d}` : `  ${d}`)
}

// ─── Kør ───────────────────────────────────────────────────────
await ryd()
const [fr] = await db.select({ n: sql<number>`count(*)::int` })
  .from(listings).where(eq(listings.postalCode, POSTNR))
const fremmede = fr?.n ?? 0
if (fremmede > 0) {
  console.error(`FEJL: ${fremmede} fremmede raekker i ${POSTNR}. Maalingen ville blande sig.`)
  process.exit(1)
}

if (process.argv.includes('--ryd')) {
  console.log(`  · ryddet — ${fremmede} rækker fandtes i ${POSTNR} efter oprydning`)
  process.exit(0)
}

const idHome = await kilde(HOME, 'Måling home (syntetisk)')
const idAnden = await kilde(ANDEN, 'Måling anden kilde (syntetisk)')
for (const s of SAGER) await saet(s, s.kilde === HOME ? idHome : idAnden)

console.log('\n══ Datagrundlag ══')
console.log(`  isoleret testbase · postnummer ${POSTNR} · ${SAGER.length} syntetiske annoncer`)
console.log(`  samme rækker og samme annonce-id'er i FØR og EFTER — kun \`rooms\` ændres`)
console.log('  FØR: kun home-annoncerne har rooms = null. De andre kilders')
console.log('       værelsestal stod der hele tiden og røres ikke.')
console.log('  værelsestallet 2 er DOKUMENTERET (begge kildeprøver, 15. sep. 2026)')
console.log('  værelsestallet 3 og alle adresser/beløb er OPDIGTEDE')

const foer = await maal('FØR — rooms = null på alle home-annoncer')

// EFTER: samme raekker, samme id'er. KUN `rooms` aendres.
for (const s of SAGER) {
  await db.update(listings).set({ rooms: s.vaerelser })
    .where(and(eq(listings.externalKey, s.id),
      eq(listings.sourceId, s.kilde === HOME ? idHome : idAnden)))
}
const efter = await maal('EFTER — rooms sat')

console.log('\n══ Opgørelse — tre tal, holdt adskilt ══')
console.log('                                        FØR   EFTER   ændring')
console.log(`  annoncer (raekker i listings)         ${String(foer.annoncer).padStart(4)}    ${String(efter.annoncer).padStart(4)}   ${ret(efter.annoncer, foer.annoncer)}`)
console.log(`  boliger efter dubletbehandling       ${String(foer.efterDedup).padStart(4)}    ${String(efter.efterDedup).padStart(4)}   ${ret(efter.efterDedup, foer.efterDedup)}`)
console.log(`  viste kort                           ${String(foer.kort).padStart(4)}    ${String(efter.kort).padStart(4)}   ${ret(efter.kort, foer.kort)}`)
console.log(`    heraf gruppekort                   ${String(foer.grupper).padStart(4)}    ${String(efter.grupper).padStart(4)}   ${ret(efter.grupper, foer.grupper)}`)
console.log(`  boliger dækket af kortene            ${String(foer.boligerPaaKort).padStart(4)}    ${String(efter.boligerPaaKort).padStart(4)}   ${ret(efter.boligerPaaKort, foer.boligerPaaKort)}`)

console.log('\n══ Række for række — nøgle og om den overlevede dubletbehandlingen ══')
console.log('  annonce  kilde   FØR                                  EFTER')
for (const f of foer.detalje as unknown as Array<Record<string, unknown>>) {
  const e = (efter.detalje as unknown as Array<Record<string, unknown>>)
    .find((x) => x.k === f.k)
  const sag = SAGER.find((x) => x.id === f.k)
  const vis = (r: Record<string, unknown> | undefined) =>
    r ? `${String(r.vist ? 'vist  ' : 'SKJULT')} ${String(r.noegle)}` : '?'
  const skiftet = e && (f.vist !== e.vist)
  const k = sag?.kilde === HOME ? 'home ' : 'anden'
  console.log(`  ${String(f.k).padEnd(4)}     ${k}   ${vis(f).padEnd(38)} ${vis(e)}${skiftet ? '   ← ÆNDRET' : ''}`)
}

// Nettotallet kan staa stille, mens sammensaetningen skifter. Den
// forskel skal staa, ellers laeses «=» som «ingen aendring».
{
  const f = foer.detalje as unknown as Array<Record<string, unknown>>
  const e = efter.detalje as unknown as Array<Record<string, unknown>>
  const ud = f.filter((x) => x.vist && !e.find((y) => y.k === x.k)?.vist).map((x) => x.k)
  const ind = f.filter((x) => !x.vist && e.find((y) => y.k === x.k)?.vist).map((x) => x.k)
  console.log('\n══ Sammensætning — hvilke annoncer skiftede plads ══')
  console.log(`  forsvandt som dublet:  ${ud.length ? ud.join(', ') : 'ingen'}`)
  console.log(`  kom frem igen:         ${ind.length ? ind.join(', ') : 'ingen'}`)
  if (foer.efterDedup === efter.efterDedup && (ud.length || ind.length)) {
    console.log('  · nettotallet er uændret, men det er IKKE de samme boliger.')
  }
}

console.log('\n══ Mekanisme for mekanisme ══')
const g = await soegGrupperet(F, 48)
for (const v of g.visninger) {
  if (v.slags === 'gruppe') {
    console.log(`  GRUPPEKORT  ${v.gruppe.noegle.vej} · ${v.gruppe.noegle.vaerelser} vær. · ${v.gruppe.antal} boliger`)
    console.log(`              repræsentant-id: ${v.gruppe.repraesentant.id}`)
  } else {
    console.log(`  enkeltkort  ${v.bolig.adresse} · ${v.bolig.vaerelser ?? '?'} vær.`)
  }
}

if (BEHOLD) {
  const grp = g.visninger.find((v) => v.slags === 'gruppe')
  console.log('\n  · --behold: EFTER-tilstanden staar i basen.')
  if (grp && grp.slags === 'gruppe') {
    console.log(`    liste:  /?postnr=${POSTNR}`)
    console.log(`    gruppe: /gruppe?b=${grp.gruppe.repraesentant.id}&postnr=${POSTNR}`)
  }
  console.log(`    ryd op med:  npx tsx --tsconfig tsconfig.scripts.json ${'scripts/cloud/home-vaerelser.ts'} --ryd\n`)
  process.exit(0)
}

await ryd()
const [re_] = await db.select({ n: sql<number>`count(*)::int` })
  .from(listings).where(eq(listings.postalCode, POSTNR))
console.log(`\n  · ryddet op — ${re_?.n ?? 0} rækker tilbage i ${POSTNR}\n`)
process.exit(0)
