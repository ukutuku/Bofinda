// ═══════════════════════════════════════════════════════════════
//  Beliggenhedskortet paa boligdetaljen — uden WebGL.
//
//      node scripts/cloud/beliggenhedkontrol.mjs [udmappe]
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  «Beliggenhed» var en `<iframe>` til
//  `openstreetmap.org/export/embed.html`. OSM's egen indlejring
//  renderer i dag med WebGL, og i en browser uden WebGL viste
//  beliggenheden en fejl — mens soegeresultaternes kort paa den samme
//  side virkede, fordi det er Leaflet med RASTERfliser.
//
//  Proeven koeres med WebGL SLAAET FRA i browseren. Det er hele
//  pointen: et kort, der kun virker med WebGL, skal fejle her.
//
//  Den maaler tre ting, og de er tre forskellige spoergsmaal:
//    1. Er der overhovedet et kort? (flisebilleder, der er DEKODET)
//    2. Kommer fliserne fra den samme kilde som SOEGEKORTETS — altsaa
//       fra den konfigurerede vaert og ikke fra en hardkodet?
//    3. Blev der forsoegt oprettet en WebGL-kontekst?
//
//  Den tredje maales i VORES eget dokument. En krydsoprindelig
//  `iframe` er uigennemsigtig — vi kan hverken se eller styre, hvad
//  den goer, og det er netop derfor kortet ikke maa vaere en fremmed
//  indlejring. Detektoren for DEN fejl er punkt 1's `iframes === 0`;
//  punkt 3 fanger et tilbagefald til en GL-baseret kortloesning i
//  vores egen kode, ogsaa hvis den tilfaeldigvis virkede i en browser
//  MED WebGL.
//
//  Exit: 0 = alt groent · 1 = noget fejlede · 2 = intet at maale paa
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
if (!process.env.DATABASE_URL) {
  console.error('FEJL: DATABASE_URL mangler — proeven kan ikke vaelge en bolig.'); process.exit(2)
}

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}
/** Vaerten i en flise-URL. Ét udtryk, saa de to maalinger laeser ens. */
const vaert = (u) => { try { return new URL(u).host } catch { return u } }

// En bolig MED koordinat, og en UDEN — begge tilstande skal maales.
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
const [med] = await sql`
  select id, address_raw, postal_code from listings
  where status = 'active' and lat is not null and lng is not null limit 1`
const [uden] = await sql`
  select id, address_raw from listings
  where status = 'active' and lat is null limit 1`
await sql.end()
if (!med) {
  console.error('FEJL: ingen aktiv bolig med koordinat — der er intet kort at maale paa.')
  process.exit(2)
}
console.log(`med koordinat: ${med.id}\nuden koordinat: ${uden ? uden.id : '(ingen)'}\n`)

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
  // WebGL slaas fra. Et kort, der KRAEVER WebGL, skal fejle her.
  args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'],
})

for (const bredde of [1440, 768, 390]) {
  const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
  console.log(`── ${merke} (${bredde} px) ──`)
  const c = await br.newContext({ viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 } })
  const p = await c.newPage()

  // Alt, browseren beder om, og alt den klager over.
  const flisekald = []
  const konsolfejl = []
  p.on('request', (r) => {
    if (r.resourceType() === 'image' && /\/\d+\/\d+\/\d+\.(png|jpe?g|webp)/.test(r.url())) {
      flisekald.push(r.url())
    }
  })
  p.on('console', (m) => { if (m.type() === 'error') konsolfejl.push(m.text()) })
  p.on('pageerror', (e) => konsolfejl.push(String(e)))

  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }

  // ── Referencen: soegeresultaternes kort ──────────────────────
  //  Det er DET kort, der virkede, mens beliggenheden fejlede. Vi maaler
  //  hvilke vaerter DET henter fliser fra, og kraever bagefter, at
  //  beliggenheden henter fra de samme.
  //
  //  Hvorfor ikke bare sammenligne med `NEXT_PUBLIC_FLISE_URL`? Fordi
  //  den variabel bages ind i klientbundtet ved BYG. Proevens egen
  //  proces har den ikke noedvendigvis, og et fald tilbage til
  //  OpenStreetMaps standard ville goere kontrollen roed, naar rettelsen
  //  virker — eller groen, naar den ikke goer, hvis nogen satte
  //  variablen «rigtigt» uden at bygge med den. Den var altsaa et andet
  //  udtryk for det samme spoergsmaal, og de to kunne drive fra hinanden.
  //  De to kort i APPEN skal svare ens; det er paastanden, og den kan
  //  maales uden at kende svaret paa forhaand.
  await p.goto(`${BASE}/?sted=${encodeURIComponent(med.postal_code ?? '')}&kort=1`,
    { waitUntil: 'networkidle' })
  await p.waitForTimeout(2500)
  const referencefliser = [...new Set(flisekald.map(vaert))]
  flisekald.length = 0

  // Taeller forsoeg paa at oprette en WebGL-kontekst — FOER siden loader.
  await p.addInitScript(() => {
    window.__glForsoeg = []
    const ae = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (t, ...r) {
      if (typeof t === 'string' && /webgl/i.test(t)) window.__glForsoeg.push(t)
      return ae.call(this, t, ...r)
    }
  })

  await p.goto(`${BASE}/bolig/${med.id}`, { waitUntil: 'networkidle' })
  // Kortet indlaeses foerst naar det er synligt — rul derned.
  await p.evaluate(() => document.querySelector('#beliggenhed')?.scrollIntoView({ block: 'center' }))
  await p.waitForTimeout(2500)

  const m = await p.evaluate(() => {
    const blok = document.querySelector('#beliggenhed')
    const flade = blok?.querySelector('.landkort-flade')
    const r = flade?.getBoundingClientRect()
    const fliser = [...(blok?.querySelectorAll('img.leaflet-tile') ?? [])]
    return {
      findes: !!blok,
      iframes: blok ? blok.querySelectorAll('iframe').length : -1,
      flade: !!flade,
      etiket: flade?.getAttribute('aria-label') ?? null,
      maal: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : null,
      fliser: fliser.length,
      dekodet: fliser.filter((i) => i.naturalWidth > 0).length,
      maerker: (blok?.querySelectorAll('.maerke-boble') ?? []).length,
      kredit: blok?.querySelector('.leaflet-control-attribution')?.textContent?.trim().slice(0, 80) ?? null,
      canvas: blok ? blok.querySelectorAll('canvas').length : -1,
      glForsoeg: window.__glForsoeg ?? [],
      overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  tjek(m.findes, `${merke} · «Beliggenhed» findes`)
  tjek(m.iframes === 0, `${merke} · ingen <iframe> — kortet er vores eget`, `${m.iframes} iframes`)
  tjek(m.flade, `${merke} · Leaflet-fladen er rejst`, m.maal ?? 'ingen flade')
  tjek(m.dekodet > 0, `${merke} · rasterfliser er DEKODET uden WebGL`,
    `${m.dekodet} af ${m.fliser} fliser`)
  tjek(m.maerker === 1, `${merke} · præcis ét mærke for boligen`, `${m.maerker} mærker`)
  tjek((m.kredit ?? '').length > 0, `${merke} · krediteringen er synlig og vores`, `«${m.kredit}»`)
  tjek((m.etiket ?? '').length > 0 && m.etiket !== 'Kort over boligerne',
    `${merke} · kortet har et navn, der passer til siden`, `«${m.etiket}»`)
  // VORES eget dokument. En krydsoprindelig `iframe` er uigennemsigtig —
  // vi kan hverken maale eller styre, hvad den goer, og det er i sig selv
  // grunden til, at kortet ikke maa vaere en fremmed indlejring. Den
  // detektor er `iframes === 0` ovenfor; den her fanger et tilbagefald
  // til en GL-baseret kortloesning i vores egen kode.
  tjek(m.glForsoeg.length === 0,
    `${merke} · vores eget dokument beder ikke om en WebGL-kontekst`,
    m.glForsoeg.join(', ') || 'ingen')
  tjek(m.overloeb === 0, `${merke} · intet vandret overløb`, `${m.overloeb} px`)

  // Fliserne skal komme fra den samme kilde som soegekortets, ikke fra en
  // hardkodet vaert. Det er den hardkodning, der var fejlen.
  const vaerter = [...new Set(flisekald.map(vaert))]
  tjek(vaerter.length > 0, `${merke} · der blev hentet fliser`, vaerter.join(', ') || 'ingen')
  // `referencefliser.length > 0` og `vaerter.length > 0` SKAL med:
  // `[].every(...)` er `true`, saa uden dem ville paastanden bestaa netop
  // naar der slet ikke blev hentet fliser — altsaa i det tilfaelde, den er
  // skrevet for at fange.
  tjek(referencefliser.length > 0 && vaerter.length > 0
    && vaerter.every((v) => referencefliser.includes(v)),
    `${merke} · samme fliskilde som søgeresultaternes kort`,
    `beliggenhed: ${vaerter.join(', ') || 'ingen'} · søgekort: ${referencefliser.join(', ') || 'ingen'}`)

  // Konsollen maa ikke klage over WebGL.
  const gl = konsolfejl.filter((t) => /webgl|WebGL|GPU|context lost/i.test(t))
  tjek(gl.length === 0, `${merke} · ingen WebGL-fejl i konsollen`,
    gl.slice(0, 2).join(' · ') || 'ingen')

  if (UD) await p.screenshot({ path: `${UD}/beliggenhed-${merke}.png` })

  // Boligen UDEN koordinat: ingen kort, men en forklaring.
  if (uden) {
    await p.goto(`${BASE}/bolig/${uden.id}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(500)
    const u = await p.evaluate(() => {
      const blok = document.querySelector('#beliggenhed')
      return {
        flade: !!blok?.querySelector('.landkort-flade'),
        mangler: blok?.querySelector('.mangler')?.textContent?.trim() ?? null,
      }
    })
    tjek(!u.flade, `${merke} · uden koordinat: intet kort rejses`)
    tjek((u.mangler ?? '').length > 0, `${merke} · uden koordinat: siden siger hvorfor`,
      `«${u.mangler}»`)
  }
  await c.close()
  console.log('')
}

await br.close()
console.log(fejl === 0 ? '✓ beliggenhedskortet virker uden WebGL' : `✗ ${fejl} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
