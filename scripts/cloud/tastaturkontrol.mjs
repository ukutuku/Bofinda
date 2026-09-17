// ═══════════════════════════════════════════════════════════════
//  Tastaturkontrollen: kan siden betjenes uden mus — og ved 200 % zoom?
//
//      DATABASE_URL=<testbasen> node scripts/cloud/tastaturkontrol.mjs [udmappe]
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  En gennemgang med tastatur og zoom fandt seks ting. Prøven her er
//  skrevet MOD den kode, fundene blev målt på, og den var rød på alle
//  seks, før noget blev rettet (91 røde linjer over fire scenarier):
//
//    ✗ kortmærkerne var 44 tabulatorstop, som Enter ikke kunne aktivere
//      (Leaflet saetter tabIndex og role=button, men binder kun Enter
//      gennem en popup — er der ingen popup, sker der ingenting)
//    ✗ gruppemærkernes tilgængelige navn var et bart tal: «3», «5»
//    ✗ sorteringsmenuen kunne åbnes, men hverken Escape, Tab væk eller
//      et klik udenfor lukkede den — den blev stående oven på indholdet
//    ✗ svaret på en gemt søgning stod 7.921 px nede, uden fokus og uden
//      beskedsemantik; formularen var væk, så en fejl ikke kunne rettes
//    ✗ gem-felterne havde kun en placeholder som ledetekst — den
//      forsvandt ved første tastetryk
//    ✗ samtykkebanneret lå sidst i tabulatorrækkefølgen (106 tryk) og
//      lukkede ikke på Escape
//    ✗ kortets zoomknapper hed «Zoom in» og «Zoom out»
//
//  ── HVAD DEN IKKE MÅ VÆRE ────────────────────────────────────
//  En prøve, der ikke kan blive rød, tæller ikke med. Derfor:
//
//    · ingen tavse spring. Rammer en selektor ingenting, skrives der
//      `tjek(false, …)` — ikke `if (findes) { … }`.
//    · `checkVisibility()` alene er IKKE «synlig». Den er sand for
//      `opacity: 0`, for `left: -9999px` og for skærmlæser-klippet.
//      Efterprøvet i den samme Chromium. Derfor spørger `iSyne()` også
//      `elementFromPoint`, hvad der FAKTISK ligger øverst.
//    · `[].every(…)` er sand. Antallet efterprøves før indholdet.
//    · et antal, der ikke ændrer sig af fejlen, måler ikke fejlen.
//      «Tegnes mærkerne om?» måles derfor på ELEMENTETS identitet, ikke
//      på hvor mange der er.
//
//  ── OM «200 % ZOOM» ──────────────────────────────────────────
//  Chromiums EGEN zoom (Ctrl +) bor i browserens ramme, ikke i siden.
//  Tre veje er PRØVET her, og de to første er ikke zoom:
//
//    --force-device-scale-factor=2 --window-size=1280,800
//        → innerWidth 1280, devicePixelRatio 2
//        Vinduet maales i DIP, saa layoutet er uaendret. Kun
//        rasterdensiteten skifter. Det er ikke zoom.
//    CDP Emulation.setPageScaleFactor(2)
//        → innerWidth 1280, devicePixelRatio 1
//        Det er knibezoom (pinch). Der ombrydes ingenting.
//    CDP Emulation.setDeviceMetricsOverride(640×400, dsf 2)
//        → innerWidth 640, devicePixelRatio 2
//        Det er praecis de to ting, browserzoom aendrer for en side, og
//        det er det, Playwrights `viewport` + `deviceScaleFactor` goer.
//
//  Scenariet herunder er altsaa den tredje, og det hedder det, det er:
//  EMULERET 200 % browserzoom — halveret layout-viewport (640×400
//  CSS-px) og devicePixelRatio 2. Ikke «200 % browserzoom».
//
//  Den ene maalbare forskel fra rigtig zoom er `screen.width`, som
//  bliver 640 her og ville staa paa 1280 ved rigtig zoom. Ingen af
//  vores regler laeser `screen`; kun `innerWidth` (gennem
//  medieforespoergsler og `@container`) og densiteten. Alle tre
//  vaerdier efterproeves i den fane, der maales i.
//
//  ── AFSENDELSE ───────────────────────────────────────────────
//  Formularprøven indsender rigtigt, men mailen er SIMULERET: appen
//  køres uden RESEND_API_KEY, så `maaSendeTil` lukker af, før der laves
//  noget netværkskald overhovedet. Beviset er udfaldet, og det skal
//  være `spaerret` PRÆCIS — `ugyldig-mail`, `for-mange` og
//  `for-hurtigt` vender tilbage FØR `sendMail` og beviser ingenting.
//  Adressen er ny for hver kørsel, så en efterladt række fra en tidligere
//  kørsel ikke kan gøre udfaldet til `for-hurtigt`. Oprydningen står i
//  `finally`.
//
//  Exit: 0 = alt groent · 1 = noget fejlede · 2 = intet at maale paa
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const MAILATTRAP = process.env.BOFINDA_MAILATTRAP ?? 'http://127.0.0.1:55434'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })

// ═══ VAERN ═══════════════════════════════════════════════════════
//
//  Proeven INDSENDER en formular og SLETTER raekker. Begge dele er
//  harmloese mod en attrapbase paa loopback og uacceptable mod alt
//  andet. Vaernene staar derfor foerst, de spoerger om det FAKTISKE —
//  ikke om formen paa en streng — og de afviser med exit 2 i stedet for
//  at maale videre.
//
//  ── HVORFOR PROEVEN EJER APPEN ───────────────────────────────
//
//  Foer maalte den mod «den app, der nu tilfaeldigvis svarede paa
//  porten», og efterviste kun, at en mailattrap FANDTES. Ingen af
//  delene siger, at DEN app bruger attrappen, eller at den laeser vores
//  base. En fremmed app paa 3100 — en anden gren, en gammel proces, et
//  helt andet projekt — ville blive maalt som vores, og formularen
//  ville blive indsendt ind i den.
//
//  Nu starter proeven appen selv:
//
//    1. `app-ned.sh` stopper KUN vores egne kendetegn (den scanner
//       /proc efter «next … -p 3100», aktiver.mjs og mailattrap.mjs).
//       En fremmed proces roeres ikke.
//    2. Svarer porten stadig, er den fremmedes — og saa afvises der.
//    3. `app-op.sh` starter appen med den verificerede base, attrappen
//       og en ATTRAPNOEGLE. Begge scripts er de eksisterende; der er
//       ikke bygget en ny opstartsvej ved siden af.
//    4. Miljoeet efterproeves paa den kørende proces gennem
//       /proc/<pid>/environ. Det er ikke et endpoint — ingenting
//       udstilles paa nettet — og det er det eneste sted, hvor det
//       FAKTISKE miljoe staar.
//
//  ── OG LAESER APPEN DEN SAMME BASE? ──────────────────────────
//
//  Et opslag paa en bolig, der findes i forvejen, beviser ingenting: en
//  KOPI af testdata har de samme id'er. Proeven skriver derfor en
//  raekke, der ikke kan findes i nogen kopi — egen kilde, eget
//  vejnavn, oprettet i dette sekund — og forlanger at faa den serveret
//  tilbage. Bagefter slettes den igen.
//
//  Kilden er proevens EGEN med sin egen slug, og `source_created_at`
//  staar null. Det er reglen fra CLAUDE.md: en proeve maa ikke laane en
//  rigtig kildes historik, for saa arver den kildens kørsler og
//  slipper forbi alarmens indkoeringsvagt.
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1']
const doed = (m) => { console.error(`FEJL: ${m}`); process.exit(2) }

/** `inet_server_addr()` svarer `127.0.0.1/32`. Masken skal af, foer der
 *  sammenlignes — ellers ville enhver adresse se forkert ud, og
 *  kontrollen ville vaere en linje, ingen turde stole paa. */
export function loopbackAdresse(raa) {
  if (raa == null) return { ok: false, adresse: null, grund: 'ingen adresse fra serveren' }
  const a = String(raa).trim().replace(/\/(32|128)$/, '')
  return LOOPBACK.includes(a)
    ? { ok: true, adresse: a }
    : { ok: false, adresse: a, grund: `${a} er ikke loopback` }
}

{
  let u
  try { u = new URL(BASE) } catch { doed(`BOFINDA_APP_BASE er ikke en URL: ${BASE}`) }
  if (!LOOPBACK.includes(u.hostname)) {
    doed(`appadressen peger paa ${u.hostname} — proeven koerer kun mod loopback.`)
  }
}
const VAERT = new URL(BASE).hostname
const APPPORT = new URL(BASE).port || '80'

if (!process.env.DATABASE_URL) {
  doed('DATABASE_URL mangler — proeven kan ikke vaelge data eller rydde op.')
}
{
  const u = new URL(process.env.DATABASE_URL)
  if (!LOOPBACK.includes(u.hostname) || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    doed(`DATABASE_URL peger paa ${u.hostname}:${u.port}${u.pathname} — ikke den isolerede testbase.`)
  }
}

const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })

// Ikke kun formen paa strengen: SPOERG basen, hvem den er — og LAD
// SVARET AFGOERE. Adressen kommer fra den FAKTISKE forbindelse, saa en
// loopback-adresse i URL'en, der i virkeligheden ender et andet sted
// (en tunnel, en videresendelse), fanges her og ikke senere.
{
  const [id] = await sql`select current_database() d, inet_server_addr()::text a,
    inet_server_port() p, current_user u`
  const adr = loopbackAdresse(id.a)
  if (id.d !== 'bofinda_test' || Number(id.p) !== 55432 || !adr.ok) {
    await sql.end()
    doed(`forbindelsen er ${id.d} paa ${adr.adresse ?? '?'}:${id.p}`
      + `${adr.ok ? '' : ` — ${adr.grund}`} — ikke den isolerede testbase.`)
  }
  console.log(`base: ${id.d} paa ${adr.adresse}:${id.p} som ${id.u} (adressen efterprøvet)`)
}

// ── Appen: stop vores egen, afvis en fremmed, start vores ────────
const TESTROD = process.env.BOFINDA_TEST_ROD ?? '/var/lib/bofinda-test'
const TILSTAND = process.env.BOFINDA_APP_TILSTAND ?? 'dev'
const koer = (kmd, args) => {
  const r = spawnSync(kmd, args, { encoding: 'utf8' })
  return { kode: r.status, ud: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}
const svarerPort = async () => {
  try { await fetch(BASE, { signal: AbortSignal.timeout(2500) }); return true } catch { return false }
}

{
  // 1 · Stop KUN vores egne. Scriptet scanner /proc efter vores egne
  //     kendetegn og roerer ikke en fremmed proces.
  koer('bash', ['scripts/cloud/app-ned.sh'])
  await new Promise((r) => setTimeout(r, 1200))

  // 2 · Svarer porten stadig, er den ikke vores.
  if (await svarerPort()) {
    await sql.end()
    doed(`noget svarer allerede paa ${BASE}, og det er ikke en proces, dette miljoe har startet.`
      + `\n      Proeven indsender en formular — den goer det ikke ind i en app, den ikke kender.`
      + `\n      Stop den, eller frigiv port ${APPPORT}.`)
  }

  // 3 · Start vores egen, med de eksisterende scripts.
  const op = koer('bash', ['scripts/cloud/app-op.sh', ...(TILSTAND === 'produktion' ? ['--produktion'] : [])])
  if (op.kode !== 0) {
    await sql.end()
    doed(`app-op.sh fejlede (${op.kode}):\n${op.ud.split('\n').slice(-8).join('\n')}`)
  }
  console.log(`app: startet af proeven (${TILSTAND}) paa ${BASE}`)
}

// 4 · Og hvad koerer den saa med? Aflaest paa PROCESSEN, ikke paa et
//     endpoint: der udstilles ingenting, og det er det eneste sted,
//     hvor det faktiske miljoe staar.
let apppid = null
{
  try { apppid = readFileSync(`${TESTROD}/app.pid`, 'utf8').trim() } catch { /* under */ }
  if (!apppid) { await sql.end(); doed(`fandt ingen ${TESTROD}/app.pid — appens miljoe kan ikke efterproeves.`) }
  let miljoe
  try {
    miljoe = Object.fromEntries(readFileSync(`/proc/${apppid}/environ`, 'utf8')
      .split('\0').filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  } catch (e) {
    await sql.end()
    doed(`kunne ikke laese /proc/${apppid}/environ (${e.message}) — appens miljoe kan ikke efterproeves.`)
  }
  const krav = []
  if (miljoe.DATABASE_URL !== process.env.DATABASE_URL) {
    krav.push('appen koerer med en ANDEN DATABASE_URL end proeven')
  }
  const m = miljoe.MAIL_API_BASE
  if (!m) krav.push('appen har ingen MAIL_API_BASE — en indsendelse ville gaa til Resend')
  else {
    try {
      const mu = new URL(m)
      if (!LOOPBACK.includes(mu.hostname)) krav.push(`MAIL_API_BASE peger paa ${mu.hostname}, ikke loopback`)
    } catch { krav.push('MAIL_API_BASE er ikke en URL') }
  }
  if (!miljoe.RESEND_API_KEY) krav.push('ingen RESEND_API_KEY — afsendelsen ville blive spaerret i stedet for maalt')
  if (!miljoe.ALARM_AFSENDER) krav.push('ingen ALARM_AFSENDER')
  if (krav.length) { await sql.end(); doed(`appens miljoe holder ikke:\n      · ${krav.join('\n      · ')}`) }
  console.log(`app-miljoe: samme DATABASE_URL · mail → ${m} · attrapnoegle sat`)
}

// 5 · Mailattrappen svarer — og den er paa loopback.
{
  let u
  try { u = new URL(MAILATTRAP) } catch { await sql.end(); doed('BOFINDA_MAILATTRAP er ikke en URL') }
  if (!LOOPBACK.includes(u.hostname)) {
    await sql.end(); doed(`mailattrappen peger paa ${u.hostname} — kun loopback.`)
  }
  const r = await fetch(`${MAILATTRAP}/sund`).catch(() => null)
  if (!r?.ok) { await sql.end(); doed(`mailattrappen svarer ikke paa ${MAILATTRAP}.`) }
  console.log(`mail: attrap paa ${MAILATTRAP}`)
}

// 6 · LAESER APPEN DEN SAMME BASE? Ikke «findes boligen» — den findes
//     ogsaa i en kopi, med samme id. En raekke, der blev til for et
//     sekund siden, findes kun det ene sted.
{
  const slug = `tastaturproeve-${randomUUID().slice(0, 8)}`
  const vej = `Proevevej ${randomUUID().slice(0, 8)}`
  const [kilde] = await sql`
    insert into sources (slug, name, source_type) values (${slug}, ${slug}, 'spider')
    returning id`
  let boligId = null
  try {
    const [b] = await sql`
      insert into listings (source_id, source_type, external_key, source_url, address_raw,
                            street, postal_code, city, status, source_created_at)
      values (${kilde.id}, 'spider', ${slug}, ${'https://eksempel.invalid/' + slug},
              ${vej + ' 1, 9999 Proevestad'}, ${vej}, '9999', 'Proevestad', 'active', null)
      returning id`
    boligId = b.id
    const r = await fetch(`${BASE}/bolig/${boligId}`).catch((e) => ({ ok: false, status: String(e) }))
    const html = r.ok ? await r.text() : ''
    if (!r.ok || !html.includes(vej)) {
      await sql`delete from listings where id = ${boligId}`
      await sql`delete from sources where id = ${kilde.id}`
      await sql.end()
      doed(`appen serverede ikke den raekke, proeven lige skrev (svar ${r.status}).`
        + `\n      Den laeser en ANDEN base — eller en kopi. Der skrives ikke videre.`)
    }
    console.log(`base-bevis: appen serverede «${vej}», skrevet for et oejeblik siden`)
  } finally {
    if (boligId) await sql`delete from listings where id = ${boligId}`
    await sql`delete from sources where id = ${kilde.id}`
  }
}

// ── Data at maale paa ────────────────────────────────────────────
const [by] = await sql`
  select city as navn, count(*)::int as n from listings
  where status = 'active' and city is not null and lat is not null
  group by 1 order by 2 desc limit 1`
const [bolig] = await sql`
  select id from listings where status = 'active' and lat is not null limit 1`
if (!by || by.n < 20) {
  await sql.end()
  doed(`ingen by med mindst 20 placerede boliger (bedste: ${by?.navn ?? 'ingen'} ${by?.n ?? 0}).`)
}
const STED = encodeURIComponent(by.navn)
console.log(`maaler paa «${by.navn}» — ${by.n} placerede boliger\n`)

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

// ── Luk altid ned ───────────────────────────────────────────────
//
//  Browseren og forbindelsen skal lukkes ogsaa naar noget kaster. Ikke
//  et try/finally om hele koerslen: en top-level `await`, der kaster,
//  bliver en unhandled rejection, og den fanges kun her. Foer stod en
//  afbrudt koersel tilbage med en Chromium og en aaben forbindelse —
//  og et forkert exitnummer oveni.
let lukket = false
const lukNed = async () => {
  if (lukket) return
  lukket = true
  await sql.end().catch(() => {})
  await br.close().catch(() => {})
  // Proeven startede appen; saa rydder den den ogsaa op. Scriptet
  // stopper kun vores egne kendetegn, saa en fremmed proces, der maatte
  // vaere startet imens, roeres ikke.
  koer('bash', ['scripts/cloud/app-ned.sh'])
}
for (const slags of ['uncaughtException', 'unhandledRejection']) {
  process.on(slags, async (e) => {
    console.error(`\nAFBRUDT (${slags}):`, e)
    await lukNed()
    process.exit(1)
  })
}

let fejl = 0
let koert = 0
const tjek = (ok, navn, note = '') => {
  koert++
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

const SCENARIER = [
  { navn: 'desktop 1440', w: 1440, h: 900, dpr: 1 },
  { navn: 'tablet 768', w: 768, h: 1024, dpr: 1 },
  { navn: 'mobil 390', w: 390, h: 844, dpr: 1 },
  { navn: 'emuleret 200 % zoom (640×400 @ dpr 2)', w: 640, h: 400, dpr: 2 },
]

/**
 * «Kan man SE det?» — ikke «er det tegnet?».
 *
 * `checkVisibility()` svarer kun paa display og content-visibility.
 * Efterproevet i den her Chromium: den er sand for `opacity: 0`, for
 * `position:absolute; left:-9999px` og for skaermlaeser-klippet
 * (`width:1px;height:1px;clip-path:inset(50%)`). Derfor ogsaa
 * `elementFromPoint` paa midten: ligger noget andet oeverst — bjaelken,
 * kortets fliser, en dialogs backdrop — er svaret nej.
 */
const I_SYNE = `(el) => {
  if (!el || !el.checkVisibility()) return false
  const cs = getComputedStyle(el)
  if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.1) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
  // pointer-events:none er rigtigt for en tekst, der ligger oven paa
  // kortet — men saa svarer traefproeven det, der ligger UNDER. Den
  // slaas fra i det ene oejeblik, maalingen tager, og saettes tilbage.
  const gemt = el.style.pointerEvents
  el.style.pointerEvents = 'auto'
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
  const o = document.elementFromPoint(x, y)
  el.style.pointerEvents = gemt
  return !!o && (o === el || el.contains(o) || o.contains(el))
}`

/**
 * «Kan den ses, naar man ruller derhen?» — for ting, der ikke
 * noedvendigvis er i billedet lige nu: en ledetekst over et felt langt
 * nede paa siden.
 *
 * Den maaler det, checkVisibility() ikke gider — gennemsigtighed,
 * visibility, stoerrelse og skaermlaeser-klippet — ruller derefter
 * elementet frem og spoerger, hvad der ligger oeverst. Uden den sidste
 * del ville en ledetekst bag den klaebende bjaelke staa groen.
 */
const KAN_SES = `(el) => {
  if (!el || !el.checkVisibility()) return false
  const cs = getComputedStyle(el)
  if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.1) return false
  if (cs.clipPath && cs.clipPath !== 'none') return false
  const r0 = el.getBoundingClientRect()
  if (r0.width < 8 || r0.height < 8) return false
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
  const o = document.elementFromPoint(x, y)
  return !!o && (o === el || el.contains(o) || o.contains(el))
}`

/** Ny fane. `samtykke: false` lader banneret staa. */
async function aabn(s, sti, { samtykke = true } = {}) {
  const c = await br.newContext({
    viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr,
  })
  // Valget saettes som COOKIE og ikke ved at klikke: knappen genindlaeser
  // siden, og en goto oven i den genindlaesning giver ERR_ABORTED i ny og
  // uae. Cookien er den samme, knappen saetter — `nej`, altsaa ingen
  // maaling — og den er ikke HttpOnly netop for at kunne laeses i browseren.
  // Vaerten kommer fra BASE: en cookie for et andet domaene end sidens
  // sendes aldrig, og saa ville hvert scenarie blive maalt med banneret
  // fremme, uden at nogen fik det at vide.
  if (samtykke) {
    await c.addCookies([{ name: 'bofinda_samtykke', value: 'nej', domain: VAERT, path: '/' }])
  }
  const p = await c.newPage()
  const maalinger = []
  p.on('request', (r) => { if (r.url().includes('/api/maaling')) maalinger.push(r.url()) })
  await p.goto(BASE + sti, { waitUntil: 'networkidle' })
  await p.waitForTimeout(350)
  return { c, p, maalinger }
}

/** Det tilgaengelige navn, regnet som browseren gør det for vores tilfaelde. */
const NAVN = `(e) => (e.getAttribute('aria-label')
  || (e.textContent || '').trim().replace(/\\s+/g, ' ')
  || e.getAttribute('title') || '').slice(0, 60)`

for (const s of SCENARIER) {
  console.log(`\n═══ ${s.navn} ═══`)

  // ── 1 · KORTET ────────────────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}&kort=1`)
    await p.waitForTimeout(1800)

    // Scenariet skal vaere det, det hedder — maalt i DEN fane, der
    // maales i, ikke i en engangsfane ved siden af.
    const sc = await p.evaluate(() => ({
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio, skaerm: screen.width,
    }))
    tjek(sc.w === s.w && sc.h === s.h && sc.dpr === s.dpr,
      'scenariet er sat, som det hedder',
      `${sc.w}×${sc.h} CSS-px, devicePixelRatio ${sc.dpr}, screen.width ${sc.skaerm}`)
    if (s.dpr === 2) {
      tjek(sc.skaerm === s.w,
        'zoom · `screen.width` foelger emuleringen — den ENE forskel fra rigtig zoom',
        `${sc.skaerm} (rigtig 200 % zoom ville vise 1280)`)
    }

    const maerker = await p.locator('.leaflet-marker-icon').count()
    // Er listen overhovedet fremme? Under 900 px er listen og kortet
    // hinandens alternativer, og med kortet valgt er listen
    // `display: none`. Saa er der intet at fremhaeve — og maerkerne maa
    // derfor hverken vaere knapper eller ligge i tabulatorraekkefoelgen.
    // Kravene er ikke de samme paa de to sider af den graense, og en
    // proeve, der maalte det samme begge steder, ville kraeve noget
    // forkert det ene sted.
    const listeFremme = await p.evaluate(() =>
      [...document.querySelectorAll('a.kort[data-bolig]')].some((e) => e.checkVisibility()))
    console.log(`  · listen er ${listeFremme ? 'FREMME' : 'skjult'} — maerkerne maales derefter`)
    if (!maerker) {
      tjek(false, 'kort · der er maerker at maale paa', 'ingen maerker tegnet')
    } else {
      // 1a · navnene
      const navne = await p.$$eval('.leaflet-marker-icon',
        (els, f) => els.map(new Function('e', `return (${f})(e)`)), NAVN)
      const bare = navne.filter((n) => /^\d+$/.test(n.trim()))
      tjek(bare.length === 0, 'kort · intet maerke hedder kun et tal',
        bare.length ? `${bare.length} af ${navne.length}: ${JSON.stringify(bare.slice(0, 3))}` : `${navne.length} maerker`)
      // Positivt, ikke negativt: et navn skal indeholde bogstaver og et
      // postnummer eller et antal — «afvis tre engelske forstavelser»
      // lod «3 homes» slippe igennem.
      const daarlige = navne.filter((n) => !/\p{L}/u.test(n) || n.trim().length < 4)
      tjek(daarlige.length === 0, 'kort · hvert maerke har et navn med ord i',
        daarlige.length ? JSON.stringify(daarlige.slice(0, 3)) : navne[0])
      // Gruppemaerkerne: dem MED en tekstboble skal sige «N boliger».
      const gruppeNavne = await p.$$eval('.leaflet-marker-icon', (els) => els
        .filter((e) => /^\d+$/.test((e.querySelector('.maerke-boble')?.textContent || '').trim()))
        .map((e) => e.getAttribute('aria-label') || ''))
      tjek(gruppeNavne.length > 0, 'kort · datasaettet har gruppemaerker at maale paa',
        `${gruppeNavne.length} gruppebobler`)
      tjek(gruppeNavne.length > 0 && gruppeNavne.every((n) => /\d+\s*boliger/i.test(n)),
        'kort · hvert gruppemaerke siger, hvor mange boliger det daekker',
        JSON.stringify(gruppeNavne.slice(0, 2)))
      // Navnet og musens tooltip er ÉN streng, ikke to der holdes ens.
      const ensNavne = await p.$$eval('.leaflet-marker-icon',
        (els) => els.every((e) => e.getAttribute('title') === e.getAttribute('aria-label')))
      tjek(ensNavne, 'kort · `title` og `aria-label` er den samme streng')
      // Og navnet lover ikke en handling, layoutet kan tage tilbage.
      tjek(navne.every((n) => !/vis (dem|boligen|den) i listen/i.test(n)),
        'kort · navnet lover ikke noget, det ikke altid kan holde')

      // 1b · zoomknapperne
      const zoom = await p.$$eval('.leaflet-control-zoom a',
        (els, f) => els.map(new Function('e', `return (${f})(e)`)), NAVN)
      tjek(zoom.length === 2 && zoom.includes('Zoom ind') && zoom.includes('Zoom ud'),
        'kort · zoomknapperne har danske navne', JSON.stringify(zoom))

      // 1c · kan kortet forlades uden at gennemloebe alle maerker?
      const foersteIKortet = await p.evaluate(() => {
        const f = document.querySelector('.kortspalte a, .kortspalte button, .kortspalte [tabindex]')
        if (!f) return false
        f.focus(); return true
      })
      if (!foersteIKortet) {
        tjek(false, 'kort · der er noget fokuserbart i kortspalten')
      } else {
        let n = 0
        for (let i = 0; i < 80; i++) {
          const inde = await p.evaluate(() => !!document.activeElement?.closest?.('.kortspalte'))
          if (!inde) break
          n++
          await p.keyboard.press('Tab')
        }
        tjek(n > 0 && n <= 8,
          'kort · kortet kan forlades uden at gennemloebe hvert maerke',
          `${n} tabulatorstop i kortspalten ved ${maerker} maerker`)
      }

      // 1c2 · springlinket
      const harSpring = await p.locator('.springkort').count()
      tjek(harSpring === 1, 'kort · der er ét springlink over kortet', String(harSpring))
      if (harSpring) {
        const spring = await p.evaluate((f) => {
          const a = document.querySelector('.springkort')
          a.focus()
          const synlig = new Function('el', `return (${f})(el)`)(a)
          a.click()
          return { synlig, maal: a.getAttribute('href') }
        }, I_SYNE)
        await p.waitForTimeout(250)
        tjek(spring.synlig, 'kort · springlinket kan SES, naar det har fokus')
        const efter = await p.evaluate(() => ({
          id: document.activeElement?.id ?? '',
          rolle: document.activeElement?.getAttribute('role'),
          navn: document.activeElement?.getAttribute('aria-label'),
          iKortet: !!document.activeElement?.closest?.('.kortspalte'),
        }))
        tjek(efter.id === 'efter-kortet' && !efter.iKortet,
          'kort · springlinket flytter fokus forbi kortet', `fokus paa «${efter.id}»`)
        tjek(!!efter.navn && efter.rolle === 'group',
          'kort · springets maal har et navn, en skaermlaeser kan laese op',
          `role=${efter.rolle} navn=«${efter.navn}»`)
      }

      // 1c2b · og kortets kontroller er der stadig, naar siden er RULLET
      await p.evaluate(() => window.scrollTo(0, 600))
      await p.waitForTimeout(350)
      const SELS = ['.springkort', '.leaflet-control-zoom-in', '.leaflet-control-zoom-out']
      const bag = await p.evaluate(({ sels, f }) => sels.map((sel) => {
        const e = document.querySelector(sel)
        if (!e) return { sel, findes: false, fri: false, oeverst: 'findes ikke' }
        e.focus()
        const r = e.getBoundingClientRect()
        const o = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return {
          sel, findes: true, fri: new Function('el', `return (${f})(el)`)(e),
          oeverst: o ? (o.className?.toString?.().slice(0, 24) || o.tagName) : 'intet',
        }
      }), { sels: SELS, f: I_SYNE })
      tjek(bag.length === SELS.length && bag.every((x) => x.findes && x.fri),
        'kort · kortets kontroller ligger ikke bag bjaelken, naar siden er rullet',
        bag.map((x) => `${x.sel}: ${x.oeverst}`).join(' · '))
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.waitForTimeout(250)

      if (listeFremme) {
        // 1c3 · hjaelpelinjen: bundet til maerket OG synlig ved fokus
        const hjaelp = await p.evaluate((f) => {
          const m = document.querySelector('.leaflet-marker-icon')
          m.focus()
          const id = m.getAttribute('aria-describedby')
          const h = id ? document.getElementById(id) : null
          return {
            id, findes: !!h,
            synlig: h ? new Function('el', `return (${f})(el)`)(h) : false,
            tekst: (h?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
          }
        }, I_SYNE)
        tjek(hjaelp.findes && /piletast/i.test(hjaelp.tekst),
          'kort · maerket peger paa en linje, der siger, hvordan man naar de andre',
          `«${hjaelp.tekst}»`)
        tjek(hjaelp.synlig, 'kort · den linje kan ogsaa SES, naar fokus er i kortet')

        // 1c4 · piletasterne flytter mellem maerkerne
        const pil = await (async () => {
          await p.locator('.leaflet-marker-icon').first().focus()
          const a = await p.evaluate(() => document.activeElement?.dataset?.maerke ?? null)
          await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
          const b2 = await p.evaluate(() => ({
            id: document.activeElement?.dataset?.maerke ?? null,
            tab: document.activeElement?.tabIndex,
          }))
          return { a, b2 }
        })()
        tjek(pil.a != null && pil.b2.id != null && pil.a !== pil.b2.id && pil.b2.tab === 0,
          'kort · piletast flytter til naeste maerke',
          `${pil.a} → ${pil.b2.id} (tabIndex ${pil.b2.tab})`)
      } else {
        // Uden en liste: ingen knap, intet tabulatorstop, ingen
        // piletast-hjaelp — men oplysningen skal stadig kunne laeses.
        const uden = await p.evaluate(() => {
          const els = [...document.querySelectorAll('.leaflet-marker-icon')]
          return {
            roller: [...new Set(els.map((e) => e.getAttribute('role')))],
            medTabindex: els.filter((e) => e.hasAttribute('tabindex')).length,
            medBeskrivelse: els.filter((e) => e.hasAttribute('aria-describedby')).length,
            navne: els.filter((e) => (e.getAttribute('aria-label') || '').length > 3).length,
            hjaelp: !!document.querySelector('.korthjaelp'),
            antal: els.length,
          }
        })
        tjek(uden.roller.length === 1 && uden.roller[0] === 'img',
          'kort · uden en liste fremstaar maerket ikke som en knap',
          `roller: ${JSON.stringify(uden.roller)}`)
        tjek(uden.medTabindex === 0, 'kort · uden en liste ligger maerkerne ikke i tabulatorraekkefoelgen',
          `${uden.medTabindex} af ${uden.antal} har tabindex`)
        tjek(uden.navne === uden.antal,
          'kort · men oplysningen kan stadig laeses — hvert maerke har sit navn',
          `${uden.navne} af ${uden.antal}`)
        tjek(uden.medBeskrivelse === 0 && !uden.hjaelp,
          'kort · og der loves ingen piletaster, hvor der intet er at flytte mellem')
        // Tabulering maa ikke kunne lande i maerkerne overhovedet.
        await p.evaluate(() => document.body.focus())
        let ramt = 0
        for (let i = 0; i < 40; i++) {
          await p.keyboard.press('Tab')
          if (await p.evaluate(() => !!document.activeElement?.closest?.('.leaflet-marker-pane'))) ramt++
        }
        tjek(ramt === 0, 'kort · 40 tabulaturtryk rammer ikke ét eneste maerke', `${ramt} ramt`)
      }

      // 1d · en opdatering af valget maa ikke rive det fokuserede maerke ned
      //
      // Det er DEN vej, gentegningen kunne udloeses uden en navigation:
      // `valgt` laa i afhaengighedslisten, og listens `mouseover` saetter
      // `valgt`. Maalt paa elementets IDENTITET — et antal er det samme
      // foer og efter en gentegning og maaler derfor ingenting.
      const overlever = await p.evaluate(() => {
        const m = document.querySelector('.leaflet-marker-icon')
        m.focus()
        m.dataset.proeve = 'foer'
        const kort = document.querySelector('a.kort[data-bolig]')
        if (!kort) return { muligt: false }
        kort.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        return { muligt: true }
      })
      await p.waitForTimeout(600)
      const efterOpdatering = await p.evaluate(() => {
        const m = document.querySelector('.leaflet-marker-icon[data-proeve="foer"]')
        return {
          samme: !!m && m.isConnected,
          harFokus: !!m && document.activeElement === m,
        }
      })
      if (!overlever.muligt) {
        tjek(false, 'kort · der er et boligkort at udloese en opdatering med')
      } else {
        tjek(efterOpdatering.samme,
          'kort · en opdatering af valget tegner ikke maerket forfra',
          efterOpdatering.samme ? 'samme element' : 'elementet blev erstattet')
        // Fokus kan kun bevares paa noget, der KAN have fokus. Uden en
        // liste er maerket ikke fokuserbart, og saa maaler den her
        // ingenting — den ville vaere groen per definition.
        if (listeFremme) {
          tjek(efterOpdatering.harFokus,
            'kort · og fokus bliver staaende paa det maerke, der havde det')
        }
      }

      // 1e · Enter og Mellemrum gør det samme som et klik
      const tilstand = `() => ({
        fremhaevet: [...document.querySelectorAll('.fremhaevet')].map((e) => e.id).sort(),
        valgt: document.querySelector('.maerke-boble.valgt')
          ?.closest('.leaflet-marker-icon')?.getAttribute('data-maerke') ?? null,
      })`
      const virkning = async (maade) => {
        const { c: c2, p: p2 } = await aabn(s, `/?sted=${STED}&kort=1`)
        await p2.waitForTimeout(1800)
        const m = p2.locator('.leaflet-marker-icon').nth(1)
        const foer = await p2.evaluate(new Function(`return (${tilstand})()`))
        if (maade === 'klik') await m.click()
        else { await m.focus(); await p2.keyboard.press(maade) }
        await p2.waitForTimeout(900)
        const efter = await p2.evaluate(new Function(`return (${tilstand})()`))
        const f2 = await p2.evaluate(() => ({
          tag: document.activeElement?.tagName ?? 'INGEN',
          haenger: !!document.activeElement?.isConnected && document.activeElement !== document.body,
          paaBoligkort: !!document.activeElement?.matches?.('a.kort[data-bolig]'),
          // `checkVisibility()` og ikke bare `querySelector`: kortene
          // STAAR i markuppen under 900 px, de er bare `display: none`.
          // Et element, der ikke tegnes, kan ikke faa fokus.
          listeSynlig: [...document.querySelectorAll('a.kort[data-bolig]')]
            .some((e) => e.checkVisibility()),
        }))
        await c2.close()
        return { foer, efter, ...f2 }
      }
      const klik = await virkning('klik')
      const enter = await virkning('Enter')
      const mellem = await virkning('Space')
      const ens = (a, b) => JSON.stringify(a.efter.fremhaevet) === JSON.stringify(b.efter.fremhaevet)
        && a.efter.valgt === b.efter.valgt
      tjek(klik.efter.valgt != null, 'kort · et klik vaelger boligen',
        JSON.stringify(klik.efter))
      if (listeFremme) {
        tjek(ens(enter, klik), 'kort · Enter goer det samme som et klik',
          `Enter: ${JSON.stringify(enter.efter)} · klik: ${JSON.stringify(klik.efter)}`)
        tjek(ens(mellem, klik), 'kort · Mellemrum goer det samme som et klik',
          `Mellemrum: ${JSON.stringify(mellem.efter)}`)
      }
      if (enter.listeSynlig) {
        tjek(enter.paaBoligkort, 'kort · Enter giver fokus til boligkortet i listen',
          `fokus paa ${enter.tag}`)
      }
    }
    if (UD) await p.screenshot({ path: `${UD}/kort-${s.w}.png` })
    await c.close()
  }

  // ── 2 · SORTERINGSMENUEN ──────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}`)
    const sum = p.locator('details.sortering > summary')
    if (!(await sum.count())) {
      tjek(false, 'sortering · menuen findes', 'ingen details.sortering')
    } else {
      const aabenNu = () => p.evaluate(() => !!document.querySelector('details.sortering[open]'))
      const fokusNu = () => p.evaluate(() =>
        document.activeElement?.tagName === 'SUMMARY' ? 'summary'
          : document.activeElement?.closest?.('details.sortering') ? 'inde i menuen'
            : (document.activeElement?.tagName ?? 'ingen'))
      // Hver deltest begynder fra LUKKET. Uden nulstillingen aabner det
      // naeste Enter ikke menuen — det lukker den, fordi <summary> er en
      // vippe — og saa melder «lukkede den?» groent uden at have maalt
      // noget. Den fejl stod i proeven foerst; den er rettet her.
      const nulstil = async () => {
        await p.evaluate(() => {
          const d = document.querySelector('details.sortering')
          if (d) d.open = false
        })
        await p.waitForTimeout(120)
      }
      const aabnMenu = async () => {
        await nulstil()
        await sum.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
        return aabenNu()
      }

      tjek(await aabnMenu(), 'sortering · Enter aabner menuen')

      await p.keyboard.press('Escape'); await p.waitForTimeout(250)
      tjek(!(await aabenNu()), 'sortering · Escape lukker menuen')
      tjek((await fokusNu()) === 'summary', 'sortering · Escape giver fokus tilbage til udloeseren',
        `fokus: ${await fokusNu()}`)

      tjek(await aabnMenu(), 'sortering · menuen er aaben foer klikket udenfor')
      await p.mouse.click(8, Math.round(s.h / 2)); await p.waitForTimeout(300)
      tjek(!(await aabenNu()), 'sortering · et klik udenfor lukker menuen')
      tjek((await fokusNu()) !== 'summary', 'sortering · et klik udenfor traekker ikke fokus tilbage',
        `fokus: ${await fokusNu()}`)

      tjek(await aabnMenu(), 'sortering · menuen er aaben foer Tab ud')
      for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(40) }
      tjek(!(await aabenNu()), 'sortering · menuen lukker, naar fokus forlader den')
      tjek((await fokusNu()) !== 'summary', 'sortering · Tab ud traekker ikke fokus tilbage',
        `fokus: ${await fokusNu()}`)

      await aabnMenu()
      const valg = p.locator('.sortering-valg a').nth(1)
      const navn = (await valg.textContent())?.trim()
      await valg.click({ timeout: 8000 }).catch(() => {})
      await p.waitForTimeout(700)
      tjek(/[?&]sorter=/.test(p.url()), `sortering · valget «${navn}» virker stadig`,
        p.url().split('?')[1] ?? '')
    }
    await c.close()
  }

  // ── 3 · GEM SOEGNING ──────────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2`)
    const antalFelter = await p.locator('form.gem input[name="navn"], form.gem input[name="mail"]').count()
    tjek(antalFelter === 2, 'gem · begge felter findes', String(antalFelter))
    if (antalFelter === 2) {
      const felter = await p.evaluate((f) =>
        [...document.querySelectorAll('form.gem input[name="navn"], form.gem input[name="mail"]')]
          .map((i) => {
            const lab = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null
            const om = i.closest('label')
            const l = lab || om
            return {
              navn: i.name, id: i.id || null, koblet: !!l,
              // «Synlig» maales som synlig — ikke som «findes i DOM'en».
              // `checkVisibility()` alene ville melde groent paa en
              // skaermlaeser-kun-ledetekst.
              synlig: !!l && new Function('el', `return (${f})(el)`)(l)
                && (l.textContent || '').trim().length > 1,
              tekst: (l?.textContent || '').trim().slice(0, 40),
            }
          }), KAN_SES)
      tjek(felter.length === 2 && felter.every((x) => x.koblet && x.synlig),
        'gem · begge felter har en synlig ledetekst koblet til feltet', JSON.stringify(felter))
      await p.fill('form.gem input[name="mail"]', 'abc')
      const bliver = await p.evaluate((f) =>
        [...document.querySelectorAll('form.gem input[name="navn"], form.gem input[name="mail"]')]
          .every((i) => {
            const l = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : i.closest('label')
            return !!l && new Function('el', `return (${f})(el)`)(l)
          }), KAN_SES)
      tjek(bliver, 'gem · ledeteksten bliver staaende, naar der tastes')
      if (UD) await p.locator('form.gem').screenshot({ path: `${UD}/gem-${s.w}.png` }).catch(() => {})
    }
    await c.close()
  }

  // Svaret: fejl og kvittering. En VISNINGSPROEVE — adressen saettes
  // direkte, og der indsendes ingenting. Den siger, at markuppen er
  // rigtig; at forloebet virker, maales i sidste afsnit.
  for (const [slags, rolle] of [['ugyldig-mail', 'alert'], ['sendt', 'status']]) {
    const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2&gemt=${slags}`)
    await p.waitForTimeout(700)
    const m = await p.evaluate((f) => {
      const e = document.querySelector('.gem-svar')
      if (!e) return null
      return {
        rolle: e.getAttribute('role'), live: e.getAttribute('aria-live'),
        iSyne: new Function('el', `return (${f})(el)`)(e),
        harFokus: document.activeElement === e || e.contains(document.activeElement),
        formular: !!document.querySelector('form.gem'),
        filtre: document.querySelector('form.gem input[name="filtre"]')?.value ?? null,
      }
    }, I_SYNE)
    if (!m) { tjek(false, `gem · svaret «${slags}» vises`); await c.close(); continue }
    tjek(m.iSyne, `visning · «${slags}» kan SES ved indlaesning`)
    tjek(m.harFokus, `visning · fokus staar paa «${slags}»`)
    // Den RIGTIGE rolle, ikke «en eller anden». `aria-live="off"` ville
    // ellers kunne baere linjen igennem.
    tjek(m.rolle === rolle, `visning · «${slags}» har rollen «${rolle}»`,
      `role=${m.rolle} aria-live=${m.live}`)
    if (slags === 'ugyldig-mail') {
      tjek(m.formular, 'visning · formularen kan stadig bruges efter en fejl')
      tjek(!!m.filtre && m.filtre.includes('vaerelser'),
        'visning · filtrene er bevaret efter en fejl', String(m.filtre).slice(0, 60))
      tjek(/vaerelser=2/.test(p.url()), 'visning · filtrene staar stadig i adressen')
    }
    if (UD) await p.screenshot({ path: `${UD}/gem-${slags}-${s.w}.png` })
    await c.close()
  }

  // ── 4 · SAMTYKKEBANNERET ──────────────────────────────────────
  {
    const { c, p, maalinger } = await aabn(s, `/?sted=${STED}`, { samtykke: false })
    await p.waitForTimeout(1200)
    if (!(await p.locator('.samtykke').count())) {
      tjek(false, 'samtykke · banneret vises')
    } else {
      await p.evaluate(() => document.body.focus())
      let n = -1
      for (let i = 1; i <= 40; i++) {
        await p.keyboard.press('Tab')
        if (await p.evaluate(() => !!document.activeElement?.closest?.('.samtykke'))) { n = i; break }
      }
      tjek(n > 0 && n <= 5, 'samtykke · banneret naas inden for 5 tabulaturtryk forfra',
        n < 0 ? 'ikke naaet paa 40' : `${n} tryk`)
      const knapper = await p.$$eval('.samtykke-knapper button', (els) => els.map((b) => {
        const cs = getComputedStyle(b); const r = b.getBoundingClientRect()
        return { h: Math.round(r.height), vaegt: cs.fontWeight, str: cs.fontSize, farve: cs.color, bag: cs.backgroundColor }
      }))
      tjek(knapper.length === 2 && knapper[0].vaegt === knapper[1].vaegt
        && knapper[0].str === knapper[1].str && knapper[0].farve === knapper[1].farve
        && knapper[0].bag === knapper[1].bag && Math.abs(knapper[0].h - knapper[1].h) <= 1,
      'samtykke · de to valg er lige tydelige', JSON.stringify(knapper))
      // Escape MED fokus inde i boksen: den skal lukke, og fokus skal et
      // defineret sted hen — ikke til <body>, hvor naeste Tab begynder
      // forfra i toppen af dokumentet.
      await p.evaluate(() => document.querySelector('.samtykke button')?.focus())
      await p.keyboard.press('Escape'); await p.waitForTimeout(500)
      const vaek = (await p.locator('.samtykke').count()) === 0
      tjek(vaek, 'samtykke · Escape lukker banneret')
      const efterEsc = await p.evaluate(() => ({
        tag: document.activeElement?.tagName ?? 'INGEN',
        navn: (document.activeElement?.textContent || '').trim().slice(0, 20),
      }))
      tjek(efterEsc.tag !== 'BODY' && efterEsc.tag !== 'INGEN',
        'samtykke · fokus falder ikke til <body>, naar boksen lukkes',
        `fokus paa ${efterEsc.tag} «${efterEsc.navn}»`)
      const kager = (await p.context().cookies()).map((k) => k.name)
      tjek(!kager.includes('bofinda_samtykke'), 'samtykke · lukning uden valg saetter ingen samtykkecookie',
        JSON.stringify(kager))
      tjek(!kager.includes('bofinda_aid') && !kager.includes('bofinda_sid'),
        'samtykke · lukning uden valg saetter ingen identifikator')
      await p.waitForTimeout(400)
      tjek(maalinger.length === 0, 'samtykke · lukning uden valg sender ingen maaling',
        `${maalinger.length} kald til /api/maaling`)
      await p.goto(BASE + `/?sted=${STED}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
      tjek((await p.locator('.samtykke').count()) > 0, 'samtykke · banneret kommer igen naeste besoeg')
    }
    if (UD) await p.screenshot({ path: `${UD}/samtykke-${s.w}.png` })
    await c.close()
  }

  // Escape maa ikke tages fra et aabent panel. Mangler panelet, er det en
  // FEJL i proeven — ikke noget, der bare springes over.
  {
    const { c, p } = await aabn(s, `/?sted=${STED}`, { samtykke: false })
    await p.waitForTimeout(900)
    const f = p.getByRole('link', { name: /^Filtre/ }).first()
    if (!(await f.count())) {
      tjek(false, 'samtykke · filterknappen findes, saa konflikten kan maales')
    } else {
      await f.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(800)
      tjek(await p.evaluate(() => !!document.querySelector('dialog[open]')),
        'samtykke · filtervinduet er aabent foer Escape')
      await p.keyboard.press('Escape'); await p.waitForTimeout(500)
      const dialogAaben = await p.evaluate(() => !!document.querySelector('dialog[open]'))
      const bannerTilbage = (await p.locator('.samtykke').count()) > 0
      tjek(!dialogAaben && bannerTilbage,
        'samtykke · Escape lukker filtervinduet og IKKE banneret',
        `dialog aaben: ${dialogAaben} · banner tilbage: ${bannerTilbage}`)
    }
    const sum = p.locator('details.sortering > summary')
    if (!(await sum.count())) {
      tjek(false, 'samtykke · sorteringsmenuen findes, saa konflikten kan maales')
    } else {
      await p.evaluate(() => {
        const d = document.querySelector('details.sortering')
        if (d) d.open = false
      })
      await sum.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
      tjek(await p.evaluate(() => !!document.querySelector('details.sortering[open]')),
        'samtykke · sorteringsmenuen er aaben foer Escape')
      await p.keyboard.press('Escape'); await p.waitForTimeout(400)
      const menuAaben = await p.evaluate(() => !!document.querySelector('details.sortering[open]'))
      const bannerTilbage = (await p.locator('.samtykke').count()) > 0
      tjek(!menuAaben && bannerTilbage,
        'samtykke · Escape lukker sorteringsmenuen og IKKE banneret',
        `menu aaben: ${menuAaben} · banner tilbage: ${bannerTilbage}`)
    }
    await c.close()
  }
}

// ── 4b · SKIFTET mellem mobil- og desktopbredde ─────────────────
//
//  Graensen er ikke en indstilling, man vaelger én gang. Man drejer
//  telefonen, aabner en delt skaerm, zoomer. Maerkerne skal foelge med i
//  BEGGE retninger — og desktopens tastaturaktivering skal stadig virke
//  bagefter. Maales i ÉN fane, hvor bredden skifter under foedderne paa
//  siden; to separate faner ville aldrig se selve skiftet.
console.log('\n═══ skift mellem mobil- og desktopbredde ═══')
{
  const { c, p } = await aabn({ w: 390, h: 844, dpr: 1 }, `/?sted=${STED}&kort=1`)
  await p.waitForTimeout(2200)
  const maal = () => p.evaluate(() => {
    const els = [...document.querySelectorAll('.leaflet-marker-icon')]
    return {
      antal: els.length,
      roller: [...new Set(els.map((e) => e.getAttribute('role')))],
      medTabindex: els.filter((e) => e.hasAttribute('tabindex')).length,
      indgange: els.filter((e) => e.tabIndex === 0 && e.hasAttribute('tabindex')).length,
      navne: els.filter((e) => (e.getAttribute('aria-label') || '').length > 3).length,
      hjaelp: !!document.querySelector('.korthjaelp'),
      listeFremme: [...document.querySelectorAll('a.kort[data-bolig]')].some((e) => e.checkVisibility()),
    }
  })
  const mobil = await maal()
  tjek(!mobil.listeFremme && mobil.roller.length === 1 && mobil.roller[0] === 'img'
    && mobil.medTabindex === 0 && mobil.navne === mobil.antal && !mobil.hjaelp,
  'skift · 390 px: oplysning, ikke knap', JSON.stringify(mobil))

  await p.setViewportSize({ width: 1440, height: 900 })
  await p.waitForTimeout(900)
  const desktop = await maal()
  tjek(desktop.listeFremme && desktop.roller.length === 1 && desktop.roller[0] === 'button'
    && desktop.medTabindex === desktop.antal && desktop.indgange === 1 && desktop.hjaelp,
  'skift · → 1440 px: knapper igen, med præcis ÉN indgang', JSON.stringify(desktop))

  // Og virker tastaturet saa? Det er hele pointen med at skifte tilbage.
  await p.locator('.leaflet-marker-icon[tabindex="0"]').first().focus()
  await p.keyboard.press('Enter')
  await p.waitForTimeout(1000)
  const virker = await p.evaluate(() => ({
    fremhaevet: [...document.querySelectorAll('.fremhaevet')].map((e) => e.id),
    paaBoligkort: !!document.activeElement?.matches?.('a.kort[data-bolig]'),
  }))
  tjek(virker.fremhaevet.length > 0 && virker.paaBoligkort,
    'skift · og Enter virker stadig efter skiftet', JSON.stringify(virker))

  await p.setViewportSize({ width: 390, height: 844 })
  await p.waitForTimeout(900)
  const tilbage = await maal()
  tjek(!tilbage.listeFremme && tilbage.roller[0] === 'img' && tilbage.medTabindex === 0,
    'skift · → 390 px igen: tilbage til oplysning', JSON.stringify(tilbage))
  if (UD) await p.screenshot({ path: `${UD}/skift-tilbage-390.png` })
  await c.close()
}

// ── 5 · BOLIGSIDENS KORT: ingen knap uden en handling ───────────
console.log('\n═══ boligsidens kort ═══')
if (!bolig) {
  tjek(false, 'boligside · der er en bolig med koordinater at maale paa')
} else {
  const { c, p } = await aabn(SCENARIER[0], `/bolig/${bolig.id}`)
  await p.evaluate(() => document.querySelector('#beliggenhed')?.scrollIntoView())
  await p.waitForTimeout(2500)
  const m = await p.evaluate(() => {
    const e = document.querySelector('.leaflet-marker-icon')
    if (!e) return null
    return {
      rolle: e.getAttribute('role'), harTabindex: e.hasAttribute('tabindex'),
      navn: e.getAttribute('aria-label'),
      hjaelp: !!document.querySelector('.korthjaelp'),
    }
  })
  if (!m) tjek(false, 'boligside · kortet har et maerke')
  else {
    // Her er der ingen liste at pege paa. Et tabulatorstop med
    // `role="button"`, hvor Enter intet goer, er praecis den fejl, hele
    // aendringen handler om — saa maerket maa ikke vaere en knap.
    tjek(m.rolle === 'img' && !m.harTabindex,
      'boligside · maerket er ikke en knap, for der er ingen liste at vise noget i',
      `role=${m.rolle} tabindex-attribut: ${m.harTabindex}`)
    tjek(!!m.navn && !/vis (den|boligen) i listen/i.test(m.navn),
      'boligside · maerket lover ikke en liste, der ikke findes', `«${m.navn}»`)
    tjek(!m.hjaelp, 'boligside · der staar ingen piletast-hjaelp, hvor der intet er at flytte mellem')
  }
  await c.close()
}

// ── 6 · FORMULARREGRESSIONEN: fejl → rettelse → succes ──────────
//
//  Hele forloebet gennem den RIGTIGE serverhandling, med mailen fanget
//  af attrappen paa loopback. Det er forskellen fra foer: dengang kunne
//  proeven kun vise, at afsendelsen blev SPAERRET (appen koerte uden
//  noegle), og kvitteringen, rydningen af udkastet og fokus paa «Tjek
//  din mail» var aldrig maalt paa andet end en URL-parameter.
//
//  Et direkte besoeg paa `?gemt=sendt` staar stadig laengere oppe. Det
//  er en VISNINGSPROEVE — den siger, at markuppen er rigtig, ikke at
//  forloebet virker.
console.log('\n═══ formularregression: fejl → rettelse → succes ═══')
{
  // Egen adresse pr. koersel: en efterladt raekke fra en tidligere
  // koersel maa ikke kunne goere udfaldet til `for-hurtigt`.
  const MAIL = `tastaturproeve-${Date.now()}@eksempel.invalid`
  const NAVN = 'Proevens eget navn paa soegningen'
  const [{ n: foerBrugere }] = await sql`select count(*)::int n from users`
  const [{ n: foerSoegninger }] = await sql`select count(*)::int n from saved_searches`
  await fetch(`${MAILATTRAP}/post`, { method: 'DELETE' })
  const s = SCENARIER[0]
  const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2`)
  try {
    const svarNu = async () => p.evaluate((f) => {
      const e = document.querySelector('.gem-svar')
      return {
        findes: !!e,
        rolle: e?.getAttribute('role') ?? null,
        iSyne: e ? new Function('el', `return (${f})(el)`)(e) : false,
        harFokus: !!e && (document.activeElement === e || e.contains(document.activeElement)),
        tekst: (e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        formular: !!document.querySelector('form.gem'),
        navn: document.querySelector('#gem-navn')?.value ?? null,
        mail: document.querySelector('#gem-mail')?.value ?? null,
        filtre: document.querySelector('form.gem input[name="filtre"]')?.value ?? null,
      }
    }, I_SYNE)
    const indsend = async () => {
      await p.locator('form.gem button[type="submit"]').click()
      await p.waitForURL(/[?&]gemt=/, { timeout: 20000 }).catch(() => {})
      await p.waitForSelector('.gem-svar', { timeout: 20000 }).catch(() => {})
      await p.waitForTimeout(600)
    }

    // ── 1 · FEJL. `anna@mail` slipper forbi browserens egen
    //        type=email-kontrol (den kraever ikke et punktum efter @) og
    //        afvises af serveren. Altsaa en rigtig serverfejl.
    await p.fill('form.gem input[name="navn"]', NAVN)
    await p.fill('form.gem input[name="mail"]', 'anna@mail')
    await indsend()
    const fejlUdfald = new URL(p.url()).searchParams.get('gemt')
    tjek(fejlUdfald === 'ugyldig-mail', 'forloeb · serveren afviser den ugyldige adresse',
      `gemt=${fejlUdfald}`)
    const f1 = await svarNu()
    tjek(f1.findes && f1.rolle === 'alert' && f1.iSyne && f1.harFokus,
      'forloeb · fejlen er i syne, har rollen «alert» og fokus', JSON.stringify({
        rolle: f1.rolle, iSyne: f1.iSyne, harFokus: f1.harFokus, tekst: f1.tekst,
      }))
    tjek(f1.formular, 'forloeb · formularen staar der stadig, saa fejlen kan rettes')
    tjek(f1.navn === NAVN && f1.mail === 'anna@mail',
      'forloeb · begge felter bar det indtastede med over',
      JSON.stringify({ navn: f1.navn, mail: f1.mail }))
    tjek(!!f1.filtre && f1.filtre.includes('vaerelser') && /vaerelser=2/.test(p.url()),
      'forloeb · filtrene er bevaret — baade i feltet og i adressen')
    const efterFejl = await (await fetch(`${MAILATTRAP}/post`)).json()
    tjek(efterFejl.length === 0, 'forloeb · en afvist adresse sender ingen mail',
      `${efterFejl.length} i attrappen`)
    const [{ n: brugereEfterFejl }] = await sql`select count(*)::int n from users`
    tjek(brugereEfterFejl === foerBrugere,
      'forloeb · en afvist adresse opretter ingen bruger', `${brugereEfterFejl} mod ${foerBrugere}`)

    // ── 2 · RETTELSEN. Kun mailfeltet roeres — navnet skal overleve.
    await p.fill('form.gem input[name="mail"]', MAIL)
    await indsend()
    const okUdfald = new URL(p.url()).searchParams.get('gemt')
    tjek(okUdfald === 'sendt', 'forloeb · rettelsen gaar igennem', `gemt=${okUdfald}`)
    const f2 = await svarNu()
    tjek(f2.findes && f2.rolle === 'status' && f2.iSyne && f2.harFokus,
      'forloeb · kvitteringen er i syne, har rollen «status» og fokus', JSON.stringify({
        rolle: f2.rolle, iSyne: f2.iSyne, harFokus: f2.harFokus, tekst: f2.tekst,
      }))
    tjek(!f2.formular, 'forloeb · formularen er vaek, naar der ikke er mere at goere')
    tjek(/vaerelser=2/.test(p.url()) && new URL(p.url()).searchParams.get('sted') === by.navn,
      'forloeb · filtrene er stadig i adressen efter succes', p.url().split('?')[1] ?? '')

    // ── 3 · MAILEN. Præcis én, til præcis den adresse, i attrappen.
    const post = await (await fetch(`${MAILATTRAP}/post`)).json()
    tjek(post.length === 1, 'forloeb · der blev sendt PRAECIS én mail', `${post.length} i attrappen`)
    tjek(post[0]?.til?.includes(MAIL),
      'forloeb · og den gik til den rettede adresse', JSON.stringify(post[0]?.til))
    tjek(typeof post[0]?.tekst === 'string' && post[0].tekst.includes('/bekraeft/'),
      'forloeb · mailen baerer bekraeftelseslinket — dobbelt tilmelding er intakt')

    // ── 4 · UDKASTET er ryddet, naar der ikke er mere at rette.
    const kager = await p.context().cookies()
    const udkast = kager.find((k) => k.name === 'bofinda_gemudkast')
    tjek(!udkast, 'forloeb · udkastcookien er ryddet ved succes',
      udkast ? `staar endnu: ${udkast.value.slice(0, 30)}` : 'vaek')

    // ── 5 · Raekken er der, og den er UBEKRAEFTET.
    const [r] = await sql`select s.id, s.confirmed_at from saved_searches s
      join users u on u.id = s.user_id where u.email = ${MAIL}`
    tjek(!!r && r.confirmed_at === null,
      'forloeb · soegningen er gemt som UBEKRAEFTET, som dobbelt tilmelding kraever',
      r ? `confirmed_at=${r.confirmed_at}` : 'ingen raekke')
    if (UD) await p.screenshot({ path: `${UD}/forloeb-kvittering.png` })
  } catch (e) {
    // Afsnittet skal kunne MELDE, at det ikke kunne gennemfoeres — ikke
    // rive hele koerslen ned. Mod kode uden rettelserne findes
    // formularen ikke efter en fejl, og saa gaar `p.fill` i timeout;
    // uden den her stoppede koerslen dér, og resten af afsnittet stod
    // hverken groent eller roedt. Det gjorde en «foer»-log ulaeselig
    // som bevis.
    tjek(false, 'forloeb · afsnittet kunne gennemfoeres',
      String(e).split('\n')[0].slice(0, 140))
  } finally {
    await c.close().catch(() => {})
    // KUN proevens egne raekker. Adressen er unik for denne koersel, og
    // der slettes paa den — ikke paa et postnummer, en kilde eller et
    // tidsrum, som kunne tage en andens raekke med.
    const brugere = await sql`select id from users where email = ${MAIL}`
    for (const u of brugere) {
      await sql`delete from saved_searches where user_id = ${u.id}`
      await sql`delete from users where id = ${u.id}`
    }
    await fetch(`${MAILATTRAP}/post`, { method: 'DELETE' }).catch(() => {})
    const [{ n: efterBrugere }] = await sql`select count(*)::int n from users`
    const [{ n: efterSoegninger }] = await sql`select count(*)::int n from saved_searches`
    tjek(efterBrugere === foerBrugere && efterSoegninger === foerSoegninger,
      'forloeb · proevens egne raekker er ryddet op igen — og kun dem',
      `brugere ${foerBrugere}→${efterBrugere}, soegninger ${foerSoegninger}→${efterSoegninger}`)
  }
}

await lukNed()
// Tallet staar HER og skal ikke taelles i loggen bagefter. En optaelling
// med `grep -c ✓` tager afslutningslinjen med og giver én for meget —
// den fejl stod i en aflevering, foer linjen fandtes.
console.log(`\n${koert} kontroller koert · ${koert - fejl} groenne · ${fejl} roede`)
console.log(fejl === 0 ? 'ALT GROENT' : 'NOGET FEJLEDE')
process.exit(fejl === 0 ? 0 : 1)
