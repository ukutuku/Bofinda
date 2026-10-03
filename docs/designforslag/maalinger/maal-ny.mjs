// ═══════════════════════════════════════════════════════════════
//  Hvor mange kort bærer «ny» — og hvor mange ville hedde «Ny i dag»?
//  SKRIVEBESKYTTET: kun select. Under --base er forbindelsen desuden sat
//  til `default_transaction_read_only = on`, og det efterprøves med SHOW
//  før og efter målingen. Et skrivekald ville fejle i basen, ikke lande.
//
//  Går gennem sidens EGNE funktioner — soeg() og soegGrupperet() (begge
//  via hvorVist: aktive, ikke-fejlede, dedup'et), NYHEDSDATO fra
//  lib/soeg.ts, kalenderdag() fra lib/dato.ts — og læser mærkaten af det
//  RIGTIGE kort: Kort/Visningskort fra app/Boligkort.tsx gengives med
//  renderToStaticMarkup, og teksten i .m-ny tages ud af markuppen. Der er
//  intet eget SQL-prædikat for «synlig» eller «ny».
//
//      ROD=<checkout> npx tsx --tsconfig <checkout>/tsconfig.scripts.json \
//        [--env-file=<checkout>/.env] maal-ny.mjs --maal test|prod | --proeve
//
//  --proeve  rejser PGlite (scripts/testbase.ts), sår kendte tilfælde med
//            et FAST referencetidspunkt og tjekker facit. Exit 1 ved afvigelse.
//  --maal    test eller prod — NAVNGIVET, ingen standard (laast-base.mjs ›
//            kraevMaal). DATABASE_URL_DIRECT skal svare til navnet, ellers
//            exit 3; DATABASE_URL bruges ikke. Nægter transaction-pooleren
//            (:6543): den kan ikke holde en read-only-session.
//            Referencetidspunktet er nu.
//
//  Ét referencetidspunkt, NU, for alt: soeg/soegGrupperet får det som
//  referenceNow, og Date.now() fastfryses til det UNDER gengivelsen, fordi
//  Kort regner `nyligt` og siden() med Date.now() (app/Boligkort.tsx:77,154).
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'

const ROD = process.env.ROD
if (!ROD) { console.error('ROD mangler (stien til checkout\'et)'); process.exit(2) }
// Alt andet end --proeve går mod en base og dermed gennem kraevMaal: uden
// `--maal test|prod` afbrydes der med exit 3. Der er ingen standard.
const BASE = !process.argv.includes('--proeve')
const PROEVE = process.argv.includes('--proeve')
if (PROEVE && process.argv.includes('--maal')) { console.error('angiv præcis én af --maal test|prod og --proeve'); process.exit(2) }
if (PROEVE && (process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT)) {
  console.error('FEJL: --proeve med DATABASE_URL sat. Afbryder.'); process.exit(2)
}
// billedUrl() signerer billed-URL'er og kræver en hemmelighed. Markuppen
// bruges KUN til at læse mærkatens tekst og kasseres straks; ingen URL
// forlader processen. Findes den i miljøet, bruges den uændret.
if (!process.env.BILLED_HEMMELIGHED) process.env.BILLED_HEMMELIGHED = 'kun-til-gengivelse-kasseres-straks'

// ─── Basen ─────────────────────────────────────────────────────
let tb = null
let laast = async () => 'pglite (i hukommelsen)'
let baseNavn = 'PGlite i processen (prøvedata)'
let laas = null
if (PROEVE) {
  tb = await (await import(`${ROD}/scripts/testbase.ts`)).rejsTestbase()
} else {
  // Samme forbindelse som de andre målinger — laast-base.mjs, ikke en kopi.
  laas = await (await import('./laast-base.mjs')).laastBase(ROD)
  laast = laas.laast
  baseNavn = laas.navn
}

const { db } = await import(`${ROD}/db/client.ts`)
const { listings, sources, crawlRuns } = await import(`${ROD}/db/schema.ts`)
const { soeg, soegGrupperet, filtreFraParametre, NYHEDSDATO } = await import(`${ROD}/lib/soeg.ts`)
const { kalenderdag, KALENDERZONE } = await import(`${ROD}/lib/dato.ts`)
const { Kort, Visningskort } = await import(`${ROD}/app/Boligkort.tsx`)
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { sql, eq, inArray } = await import('drizzle-orm')

// Forsidens kort pr. side står ét sted, app/page.tsx. Læses derfra, så
// målingen ikke kan drive fra siden. Findes linjen ikke, stopper vi.
const PR_SIDE = Number((/const PR_SIDE = (\d+)/.exec(readFileSync(`${ROD}/app/page.tsx`, 'utf8')) ?? [])[1])
if (!PR_SIDE) { console.error('FEJL: fandt ikke PR_SIDE i app/page.tsx'); process.exit(1) }

const T = 3600_000
const DOEGN = 24 * T
// Kortets egen grænse: app/Boligkort.tsx:154 og :396 (1000*60*60*24*3).
const TRE_DOEGN = 3 * DOEGN
const NU = PROEVE ? new Date('2026-09-30T06:00:00Z') : new Date()

// ─── Kortet, som det faktisk tegnes ────────────────────────────
function gengiv(el) {
  const aegte = Date.now
  Date.now = () => NU.getTime()
  try { return renderToStaticMarkup(el) } finally { Date.now = aegte }
}
const maerkatAf = (html) => {
  const m = /class="maerkat m-ny">([^<]*)</.exec(html)
  return m ? m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null
}

// ─── Designlagets omdøbning, ORDRET fra runde2-lag/greb.js:44-50 ──
// (browser-mockup, kan ikke importeres; tre linjer gengivet uændret)
function greb(t) {
  const d = /(\d+) dag/.exec(t)
  return /min\.|time|lige nu/.test(t) ? 'Ny i dag' : d ? (d[1] === '1' ? 'Ny i går' : `Ny · ${d[1]} dage`) : t
}

// ─── Kalenderen, Europe/Copenhagen, via lib/dato.ts ────────────
const dagNr = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DOEGN
const kalenderdage = (d) => dagNr(kalenderdag(NU)) - dagNr(kalenderdag(d))
const kalenderNavn = (d) => { const n = kalenderdage(d); return n <= 0 ? 'Ny i dag' : n === 1 ? 'Ny i går' : `Ny · ${n} dage` }

/** Ét kort eller én bolig. `dato` er det, kortet selv regner alderen af. */
function klassificer(dato, maerkat) {
  const alder = NU - dato
  const har = maerkat != null
  const design = har ? greb(maerkat) : null
  const kal = kalenderNavn(dato)
  return {
    har, forventet: alder < TRE_DOEGN, maerkat, design, kal,
    d1: design === 'Ny i dag',             // designlaget: siden() sagde min./time/lige nu
    d2: alder < DOEGN,                     // rullende: under 24 t
    d3: kalenderdage(dato) <= 0,           // samme kalenderdag i København
    uenig: har && design !== kal,          // designlagets ord ≠ kalenderens
  }
}

const pct = (a, n) => n ? `${(100 * a / n).toFixed(1).replace('.', ',')} %` : '—'
const tael = (xs, k) => xs.filter((x) => x[k]).length
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const snit = (xs) => xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null
const p = (x) => x == null ? '—' : `${(100 * x).toFixed(1).replace('.', ',')} %`
const klokke = new Intl.DateTimeFormat('da-DK', { timeZone: KALENDERZONE, dateStyle: 'short', timeStyle: 'short' })

// ─── Prøvedata med kendt facit ─────────────────────────────────
const MAERKE = new Map()   // id → navn, kun i prøven
if (PROEVE) {
  const kilde = async (slug, foersteKoersel) => {
    const [s] = await db.insert(sources).values({ slug, name: slug, sourceType: 'feed', baseUrl: 'https://proeve.invalid' }).returning()
    await db.insert(crawlRuns).values({ sourceId: s.id, startedAt: foersteKoersel, finishedAt: foersteKoersel, status: 'ok', newCount: 1 })
    return s
  }
  const kA = await kilde('maal-ny-a', new Date(NU - 30 * DOEGN))
  const kB = await kilde('maal-ny-b', new Date(NU - 10 * T))   // i indkøring: alt er bagkatalog
  const kC = await kilde('maal-ny-c', new Date(NU - 30 * DOEGN))
  let n = 0
  const saa = async (navn, { k = kA, postnr = '9101', by = 'Prøveby', vej, vaer = 2, foerstT, kildeT = null,
    status = 'active', uuid } = {}) => {
    n++
    const [r] = await db.insert(listings).values({
      sourceId: k.id, sourceType: 'feed', externalKey: `mn-${n}`, sourceUrl: `https://proeve.invalid/${n}`,
      addressRaw: `${vej ?? `Prøvevej ${n}`} 1, ${postnr} ${by}`, street: vej ?? `Prøvevej ${n}`, houseNumber: '1',
      postalCode: postnr, city: by, rooms: vaer, sizeM2: 60, rentMonthly: 800000,
      addressMatchLevel: 'unit', unitAddressUuid: uuid ?? `intern:maal-ny:${n}`, status,
      firstSeenAt: new Date(NU - foerstT * T), lastSeenAt: NU,
      sourceCreatedAt: kildeT == null ? null : new Date(NU - kildeT * T),
    }).returning({ id: listings.id })
    MAERKE.set(r.id, navn)
  }
  // NU = 2026-09-30 06:00 UTC = 08:00 i København (sommertid).
  await saa('r1-2t',       { foerstT: 2 })            // 06:00 i dag
  await saa('r2-20t',      { foerstT: 20 })           // 12:00 i går  → siden: «20 timer» → designlaget «Ny i dag»
  await saa('r3-23t40',    { foerstT: 23 + 40 / 60 }) // 08:20 i går  → siden runder til «1 dag»
  await saa('r4-34t',      { foerstT: 34 })           // 22:00 i forgårs → «1 dag» → designlaget «Ny i går»
  await saa('r5-50t',      { foerstT: 50 })           // → «2 dage»
  await saa('r6-70t',      { foerstT: 70 })           // → «3 dage», stadig under 72 t
  await saa('r7-80t',      { foerstT: 80 })           // ingen mærkat
  await saa('r8-10d',      { foerstT: 240 })          // ingen mærkat
  await saa('r9-kilde100d', { foerstT: 1, kildeT: 2400 }) // kildens dato vinder → ingen mærkat
  await saa('r10-kilde5t', { foerstT: 1, kildeT: 5 })   // 03:00 i dag
  await saa('r11-bagkat',  { k: kB, foerstT: 9 })      // 23:00 i går, bagkatalog → NYHEDSDATO null
  // Tvillingerne deler navn: hvem der vinder repræsentantvalget, afgøres
  // til sidst af id'et, og det er tilfældigt. Kun ÉN må tælle.
  await saa('r12-tvilling', { foerstT: 3, uuid: 'intern:maal-ny:tvilling' })
  await saa('r12-tvilling', { k: kC, foerstT: 3, uuid: 'intern:maal-ny:tvilling' })
  await saa('r14-afmeldt', { foerstT: 1, status: 'delisted' })
  await saa('r15-gruppe6t', { postnr: '9102', by: 'Attrapby', vej: 'Gruppevej', vaer: 3, foerstT: 6 })
  await saa('r16-gruppe100t', { postnr: '9102', by: 'Attrapby', vej: 'Gruppevej', vaer: 3, foerstT: 100 })
  await saa('r17-200t',    { postnr: '9102', by: 'Attrapby', foerstT: 200 })
  // 23:30 UTC den 29. = 01:30 i København den 30.: «i dag» i København,
  // «i går» i UTC. Fanger en kalender regnet i serverens eller UTC's zone.
  await saa('r18-6t30',    { foerstT: 6.5 })
}
const navn = (id) => MAERKE.get(id) ?? id.slice(0, 8)

console.log(`\n══ «NY»-MÆRKATEN · ${PROEVE ? 'PRØVE (syntetiske, kendte tilfælde)' : 'MÅLING'}`)
console.log(`   base: ${baseNavn}`)
console.log(`   referencetidspunkt: ${NU.toISOString()}  =  ${klokke.format(NU)} i ${KALENDERZONE}`)
console.log(`   read-only: ${await laast()}`)
console.log(`   forsidens kort pr. side (app/page.tsx PR_SIDE): ${PR_SIDE}`)

// ─── a) Alle synlige boliger, dedup'et som listen ──────────────
const f0 = filtreFraParametre({})           // præcis forsidens filtre
const alle = await soeg(f0, 1_000_000, NU)   // hvorVist, sorteret som «nyeste»
const a = alle.map((b) => {
  const k = klassificer(b.hosKilden ?? b.foerstSet, maerkatAf(gengiv(createElement(Kort, { b, nu: NU }))))
  return { id: b.id, kilde: b.kilde, ...k }
})
const afvigA = a.filter((x) => x.har !== x.forventet)
console.log(`\n── a) Alle synlige boliger (soeg → hvorVist, dubletter fjernet): ${a.length}`)
console.log(`   mærkat på kortet i dag (< 72 t efter hosKilden ?? foerstSet): ${tael(a, 'har')}  ${pct(tael(a, 'har'), a.length)}`)
console.log(`   «Ny i dag» · designlaget (siden() sagde min./time/lige nu): ${tael(a, 'd1')}  ${pct(tael(a, 'd1'), a.length)}`)
console.log(`   «Ny i dag» · under 24 t:                                    ${tael(a, 'd2')}  ${pct(tael(a, 'd2'), a.length)}`)
console.log(`   «Ny i dag» · samme kalenderdag i København:                 ${tael(a, 'd3')}  ${pct(tael(a, 'd3'), a.length)}`)
console.log(`   designlagets ord ≠ kalenderens, blandt kort med mærkat:     ${tael(a, 'uenig')} af ${tael(a, 'har')}`)
console.log(`   krydstjek, gengivet kort mod 72-t-reglen: ${afvigA.length ? 'AFVIGER for ' + afvigA.map((x) => navn(x.id)).join(', ') : 'alle stemmer'}`)

// ─── b) Samme, men med NYHEDSDATO (indkøringsvagten) ───────────
const nyhed = new Map()
for (let i = 0; i < alle.length; i += 500) {
  const ider = alle.slice(i, i + 500).map((b) => b.id)
  for (const r of await db.select({ id: listings.id, ny: sql`${NYHEDSDATO}` }).from(listings).where(inArray(listings.id, ider)))
    nyhed.set(r.id, r.ny == null ? null : new Date(r.ny))
}
const b = alle.map((x) => {
  const d = nyhed.get(x.id)
  if (d == null) return { id: x.id, kilde: x.kilde, bagkatalog: true, har: false, d2: false, d3: false }
  return { id: x.id, kilde: x.kilde, bagkatalog: false, har: NU - d < TRE_DOEGN, d2: NU - d < DOEGN, d3: kalenderdage(d) <= 0 }
})
const hulB = a.filter((x, i) => x.har && !b[i].har)
console.log(`\n── b) Samme boliger, alder regnet af NYHEDSDATO (lib/soeg.ts) i stedet`)
console.log(`   bagkatalog (NYHEDSDATO null): ${tael(b, 'bagkatalog')}`)
console.log(`   ville have mærkat (< 72 t):   ${tael(b, 'har')}  ${pct(tael(b, 'har'), b.length)}`)
console.log(`   «Ny i dag» · under 24 t:      ${tael(b, 'd2')}  ${pct(tael(b, 'd2'), b.length)}`)
console.log(`   «Ny i dag» · kalenderdag:     ${tael(b, 'd3')}  ${pct(tael(b, 'd3'), b.length)}`)
console.log(`   bærer «ny» på kortet i dag, men er bagkatalog/ældre efter NYHEDSDATO: ${hulB.length}`
  + (hulB.length ? `  (${[...new Set(hulB.map((x) => x.kilde))].join(', ')})` : ''))

// Tilstrømningen pr. kilde, som input til skønnet. KUN boliger, der er
// synlige NU — det, der kom og gik inden for vinduet, er ikke med.
const kilder = [...new Set(a.map((x) => x.kilde))].sort()
console.log(`\n   pr. kilde (synlige nu) · alder efter hosKilden ?? foerstSet | efter NYHEDSDATO`)
console.log(`   ${'kilde'.padEnd(14)}${'synlige'.padStart(8)}${'<24t'.padStart(7)}${'<72t'.padStart(7)}${'<7d'.padStart(6)}${'  7d/7'.padStart(8)}  |${'<24t'.padStart(6)}${'<72t'.padStart(6)}${'<7d'.padStart(6)}${'bagkat'.padStart(8)}`)
for (const k of kilder) {
  const rk = alle.filter((x) => x.kilde === k)
  const al = rk.map((x) => NU - (x.hosKilden ?? x.foerstSet))
  const ny = rk.map((x) => nyhed.get(x.id)).map((d) => d == null ? null : NU - d)
  const u = (xs, g) => xs.filter((v) => v != null && v < g).length
  console.log(`   ${k.padEnd(14)}${String(rk.length).padStart(8)}${String(u(al, DOEGN)).padStart(7)}${String(u(al, TRE_DOEGN)).padStart(7)}`
    + `${String(u(al, 7 * DOEGN)).padStart(6)}${(u(al, 7 * DOEGN) / 7).toFixed(1).replace('.', ',').padStart(8)}  |`
    + `${String(u(ny, DOEGN)).padStart(6)}${String(u(ny, TRE_DOEGN)).padStart(6)}${String(u(ny, 7 * DOEGN)).padStart(6)}${String(ny.filter((v) => v == null).length).padStart(8)}`)
}

// ─── c) Forsidens første side, som den faktisk tegnes ──────────
async function side1(f) {
  const { visninger } = await soegGrupperet(f, PR_SIDE, NU, 1)
  return visninger.map((v, i) => {
    const html = gengiv(createElement(Visningskort, { v, nu: NU, filtre: f, position: i + 1 }))
    const dato = v.slags === 'gruppe' ? v.gruppe.nyesteMarkedet : (v.bolig.hosKilden ?? v.bolig.foerstSet)
    const id = v.slags === 'gruppe' ? v.gruppe.repraesentant.id : v.bolig.id
    return { id, slags: v.slags, kilde: v.slags === 'gruppe' ? v.gruppe.repraesentant.kilde : v.bolig.kilde, ...klassificer(dato, maerkatAf(html)) }
  })
}
const forside = await side1(f0)
const afvigC = forside.filter((x) => x.har !== x.forventet)
const top = (n) => forside.slice(0, n)
console.log(`\n── c) Forsiden, side 1 (soegGrupperet, «nyeste», ${PR_SIDE} kort): ${forside.length} kort`)
for (const [lbl, xs] of [['første 3 kort', top(3)], ['første 12 kort', top(12)], [`alle ${forside.length}`, forside]]) {
  console.log(`   ${lbl.padEnd(15)} mærkat ${tael(xs, 'har')}/${xs.length} ${pct(tael(xs, 'har'), xs.length).padStart(8)} · «Ny i dag» design ${tael(xs, 'd1')}, <24 t ${tael(xs, 'd2')}, kalender ${tael(xs, 'd3')} · ord ≠ kalender ${tael(xs, 'uenig')}`)
}
console.log(`   krydstjek, gengivet kort mod 72-t-reglen: ${afvigC.length ? 'AFVIGER for ' + afvigC.map((x) => navn(x.id)).join(', ') : 'alle stemmer'}`)
console.log(`   de første 12, som de står:`)
for (const [i, x] of top(12).entries()) {
  console.log(`   ${String(i + 1).padStart(3)}. ${(x.slags === 'gruppe' ? 'gruppe' : 'bolig').padEnd(7)}${x.kilde.padEnd(14)}`
    + `kortet: ${(x.maerkat ?? '—').padEnd(26)} designlaget: ${(x.design ?? '—').padEnd(13)} kalenderen: ${x.har ? x.kal : '—'}`)
}

// ─── d) Første side af hver postnummer- og bysøgning ───────────
const steder = await db.selectDistinct({ postnr: listings.postalCode, by: listings.city })
  .from(listings).where(eq(listings.status, 'active'))
const postnumre = [...new Set(steder.map((s) => s.postnr).filter(Boolean))].sort()
const byer = [...new Set(steder.map((s) => s.by).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'da'))
const D = { postnr: [], by: [] }
for (const [univers, liste] of [['postnr', postnumre], ['by', byer]]) {
  for (const sted of liste) {
    const kort = await side1(filtreFraParametre({ sted }))
    if (!kort.length) continue
    D[univers].push({ sted, n: kort.length, m: tael(kort, 'har'), d1: tael(kort, 'd1'), d2: tael(kort, 'd2'), d3: tael(kort, 'd3'),
      afvig: kort.filter((x) => x.har !== x.forventet).length })
  }
}
console.log(`\n── d) Første side af hver søgning (andel af søgningens kort; uvægtet over søgninger)`)
for (const [univers, xs] of [['postnumre', D.postnr], ['byer', D.by], ['begge', [...D.postnr, ...D.by]]]) {
  const andel = (k) => xs.map((x) => x[k] / x.n)
  const alleKort = xs.reduce((s, x) => s + x.n, 0)
  console.log(`   ${univers.padEnd(10)} ${String(xs.length).padStart(4)} søgninger · ${alleKort} kort i alt`)
  for (const [k, lbl] of [['m', 'mærkat'], ['d1', '«Ny i dag» design'], ['d2', '«Ny i dag» <24 t'], ['d3', '«Ny i dag» kalender']]) {
    console.log(`      ${lbl.padEnd(20)} snit ${p(snit(andel(k))).padStart(8)} · median ${p(median(andel(k))).padStart(8)} · samlet ${pct(xs.reduce((s, x) => s + x[k], 0), alleKort).padStart(8)}`
      + (k === 'm' ? ` · søgninger hvor HVERT kort har mærkat: ${xs.filter((x) => x.m === x.n).length}` : ''))
  }
  const af = xs.reduce((s, x) => s + x.afvig, 0)
  if (af) console.log(`      krydstjek: ${af} kort AFVIGER fra 72-t-reglen`)
}
console.log(`\n   read-only til sidst${laas ? ', samme forbindelse' : ''}: ${laas ? await laas.afslut() : await laast()}`)

// ─── Facit (kun prøven) ────────────────────────────────────────
if (PROEVE) {
  const fejl = []
  const skal = (lbl, faktisk, facit) => { if (JSON.stringify(faktisk) !== JSON.stringify(facit)) fejl.push(`${lbl}: ${JSON.stringify(faktisk)}, facit ${JSON.stringify(facit)}`) }
  const sat = (xs, k) => xs.filter((x) => x[k]).map((x) => navn(x.id)).sort()
  // a) 18 sået − 1 afmeldt − 1 tvilling = 16 synlige
  skal('a.antal', a.length, 16)
  skal('a.mærkat', sat(a, 'har'), ['r1-2t', 'r10-kilde5t', 'r11-bagkat', 'r12-tvilling', 'r15-gruppe6t', 'r18-6t30', 'r2-20t', 'r3-23t40', 'r4-34t', 'r5-50t', 'r6-70t'])
  skal('a.design-i-dag', sat(a, 'd1'), ['r1-2t', 'r10-kilde5t', 'r11-bagkat', 'r12-tvilling', 'r15-gruppe6t', 'r18-6t30', 'r2-20t'])
  skal('a.under-24t', sat(a, 'd2'), ['r1-2t', 'r10-kilde5t', 'r11-bagkat', 'r12-tvilling', 'r15-gruppe6t', 'r18-6t30', 'r2-20t', 'r3-23t40'])
  skal('a.kalender-i-dag', sat(a, 'd3'), ['r1-2t', 'r10-kilde5t', 'r12-tvilling', 'r15-gruppe6t', 'r18-6t30'])
  skal('a.uenig', sat(a, 'uenig'), ['r11-bagkat', 'r2-20t', 'r4-34t'])
  skal('a.krydstjek', afvigA.length, 0)
  // siden()'s egne ord på de fire grænsetilfælde
  const tekst = Object.fromEntries(a.map((x) => [navn(x.id), x.maerkat]))
  skal('tekst r2', tekst['r2-20t'], 'ny for 20 timer siden')
  skal('tekst r3', tekst['r3-23t40'], 'ny for 1 dag siden')
  skal('tekst r4', tekst['r4-34t'], 'ny for 1 dag siden')
  skal('tekst r6', tekst['r6-70t'], 'ny for 3 dage siden')
  skal('tekst r18', tekst['r18-6t30'], 'ny for 7 timer siden')
  // b) bagkatalog-rækken mister mærkaten
  skal('b.bagkatalog', sat(b, 'bagkatalog'), ['r11-bagkat'])
  skal('b.mærkat', tael(b, 'har'), 10)
  skal('b.under-24t', tael(b, 'd2'), 7)
  skal('b.kalender', tael(b, 'd3'), 5)
  skal('b.hul', hulB.map((x) => navn(x.id)), ['r11-bagkat'])
  // c) 15 kort: 12 enkelte + tvilling + gruppe + r17
  skal('c.antal', forside.length, 15)
  skal('c.første 3', top(3).map((x) => navn(x.id)), ['r1-2t', 'r12-tvilling', 'r10-kilde5t'])
  skal('c.mærkat', tael(forside, 'har'), 11)
  skal('c.design/24t/kalender', [tael(forside, 'd1'), tael(forside, 'd2'), tael(forside, 'd3')], [7, 8, 5])
  skal('c.gruppekort', forside.filter((x) => x.slags === 'gruppe').map((x) => x.maerkat), ['ny bolig for 6 timer siden'])
  skal('c.krydstjek', afvigC.length, 0)
  // d) 9101: 13 kort, 10 mærkat, 6/7/4 · 9102: 2 kort, 1 mærkat, 1/1/1 — byerne er de samme sæt
  const kort = (xs) => xs.map(({ sted, n, m, d1, d2, d3 }) => [sted, n, m, d1, d2, d3])
  skal('d.postnr', kort(D.postnr), [['9101', 13, 10, 6, 7, 4], ['9102', 2, 1, 1, 1, 1]])
  skal('d.by', kort(D.by), [['Attrapby', 2, 1, 1, 1, 1], ['Prøveby', 13, 10, 6, 7, 4]])
  const sn = snit(D.postnr.map((x) => x.m / x.n))
  if (Math.abs(sn - (10 / 13 + 1 / 2) / 2) > 1e-12) fejl.push(`d.snit mærkat postnr: ${sn}, facit ${(10 / 13 + 1 / 2) / 2}`)
  console.log(`\n══ PRØVE: ${fejl.length ? 'FEJL\n   ' + fejl.join('\n   ') : 'alle facit stemmer (a, b, c, d og siden()s fire grænsetilfælde)'}`)
  await tb.luk()
  process.exitCode = fejl.length ? 1 : 0
} else {
  const { luk } = await import(`${ROD}/db/client.ts`)
  await luk()
  process.exit(0)
}
