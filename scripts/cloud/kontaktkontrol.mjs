// ═══════════════════════════════════════════════════════════════
//  Kontaktrejsen: fra boligannonce til kontakt og beskeder.
//
//      node scripts/cloud/kontaktkontrol.mjs [udmappe]
//
//  ── HVAD DEN MÅLER, OG HVAD DEN IKKE GØR ─────────────────────
//
//  Den måler BRUGERFLADEN mod prøvevisningen `/kontakt-ui/proeve`, som
//  svarer ud af hukommelsen med opdigtede annoncer, kontaktoplysninger
//  og samtaler. Der er ingen database, ingen konto, ingen betaling,
//  ingen adgangskontrol og ingen kontakt bag — og kontrollen påstår
//  derfor ingenting om nogen af delene.
//
//  ── DE TO VIGTIGSTE MÅLINGER ─────────────────────────────────
//
//  1 · LÅST INDHOLD SKAL VÆRE FRAVÆRENDE. Kontrollen læser den rå
//      `page.content()` — også det, `display: none` ville gemme — og
//      forlanger, at hverken mailadresse, telefonnummer eller
//      beskedtekst står i den, når adgangen er lukket.
//
//  2 · EN TEKNISK FEJL FØRER ALDRIG TIL BETALING. I begge fejlforløb
//      — et svar, der siger `fejl`, og en port, der KASTER — forlanger
//      kontrollen, at der hverken står en pris, en abonnementsknap
//      eller et link til abonnementsruten.
//
//  ⚠ Måling 1 måler prøvevisningens MARKUP, ikke et netværkssvar. Der
//  er ingen server her. At serverlaget skal kontrollere adgang og
//  ejerskab og bygge afviste svar uden private felter, er en opgave for
//  den integration — se app/kontakt-ui/SERVERINTEGRATION.md.
//
//  ── PROEVEN EJER SINE PROCESSER ──────────────────────────────
//
//  Portene ses efter FØRST, og der stoppes ingenting. Er en af dem
//  optaget, afvises der med exit 2 — en anden sessions app på samme
//  port må ikke blive stoppet af en kontrol, der ikke ved, hvad den er.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede · 2 = intet at måle på
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { connect as netConnect } from 'node:net'

const PORT = Number(process.env.KONTAKT_PORT ?? 3300)
const GUARDPORT = Number(process.env.KONTAKT_GUARDPORT ?? 3301)
const BASE = `http://127.0.0.1:${PORT}`
const STI = '/kontakt-ui/proeve'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
const CHROMIUM = process.env.CHROMIUM_STI
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

let fejl = 0
let proever = 0
const p = (s) => process.stdout.write(s + '\n')
function tjek(ok, navn, maalt = '') {
  proever++
  if (!ok) fejl++
  p(`  ${ok ? '✓' : '✗'} ${navn}${maalt ? `\n      ${maalt}` : ''}`)
}

/** Loggen skal selv sige, hvad den er maalt paa. Se beskedkontrol.mjs. */
function revision() {
  const g = (...a) => spawnSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim()
  const beskidt = g('status', '--porcelain')
  p(`revision:   ${g('rev-parse', 'HEAD')}`)
  p(`trae:       ${g('rev-parse', 'HEAD^{tree}')}`)
  p(beskidt ? `arbejdstrae: ÆNDRET —\n  ${beskidt.split('\n').join('\n  ')}` : 'arbejdstrae: rent')
  p('')
}

const ledig = (port) => new Promise((r) => {
  const s = netConnect({ host: '127.0.0.1', port })
  s.once('connect', () => { s.destroy(); r(false) })
  s.once('error', () => r(true))
  setTimeout(() => { s.destroy(); r(true) }, 800)
})

async function vent(url, sek = 90) {
  for (let i = 0; i < sek * 2; i++) {
    try { const r = await fetch(url); if (r.status !== 0) return r.status } catch { /* ikke oppe */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return 0
}

const mine = []
function byg() {
  // Bygget laeser IKKE flaget: ruten er `force-dynamic`, og miljoeet
  // afgoeres ved kaldet. Samme byg kan derfor baade svare 404 og 200.
  return spawnSync('npx', ['next', 'build'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: './certs/rapidssl-tls-rsa-ca-g1.pem' },
  }).status === 0
}
function start(port, medFlag) {
  const b = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: './certs/rapidssl-tls-rsa-ca-g1.pem',
      ...(medFlag ? { KONTAKT_PROEVE: '1' } : { KONTAKT_PROEVE: '' }),
    },
  })
  mine.push(b.pid)
}
function stopMine() {
  for (const pid of mine) {
    try { process.kill(-pid, 'SIGTERM') } catch { /* allerede væk */ }
    try { process.kill(pid, 'SIGTERM') } catch { /* allerede væk */ }
  }
}

/** Ligger elementet FAKTISK øverst dér, hvor det siger det ligger? */
/**
 * Er elementet faktisk synligt for et menneske?
 *
 * ⚠ TOLERANT MED VILJE. Findes elementet slet ikke, venter
 * `evaluate` sin timeout ud og KASTER — og saa afbrydes hele koerslen
 * i stedet for at melde én roed linje. Det kostede to modproever
 * deres maaling: regressionen blev fanget (exit 1), men resten af
 * kontrollen naaede aldrig at koere, saa man saa ét symptom i stedet
 * for sytten. Samme svaghed som `waitFor` havde foer `dukkerOp`.
 *
 * Et manglende element er et SVAR paa spoergsmaalet — nemlig «nej» —
 * og ikke en fejl i maaleudstyret.
 */
const iSyne = (l) => l.evaluate((el) => {
  if (!el.checkVisibility?.()) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 8))
  return Boolean(top && (top === el || el.contains(top) || top.contains(el)))
}, undefined, { timeout: 8000 }).then((v) => v, () => false)
const dukkerOp = (loc, ms = 8000) =>
  loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)

/**
 * Samme grund som ved `iSyne` og `dukkerOp`: et element, der ikke er
 * der, er et SVAR — ikke en undtagelse. Uden de to her ventede
 * `getAttribute` og `innerText` deres 30 sek. ud og afbroed koerslen,
 * saa alt EFTER det punkt aldrig blev maalt. Modproeverne viste det:
 * en regression gav ét symptom i stedet for sytten.
 */
const attr = (loc, navn, ms = 8000) =>
  loc.getAttribute(navn, { timeout: ms }).then((v) => v, () => null)
const tekst = (loc, ms = 8000) =>
  loc.innerText({ timeout: ms }).then((v) => v, () => null)

const vaelg = async (s, navn) => {
  await s.locator('label.proeve-valgknap', { hasText: navn }).click()
  await s.waitForTimeout(500)
  if (!(await s.getByRole('radio', { name: navn, exact: true }).isChecked())) {
    throw new Error(`scenariet «${navn}» blev ikke valgt`)
  }
}

async function skud(s, navn, bredder) {
  if (!UD) return
  const start = s.viewportSize()
  for (const b of bredder) {
    await s.setViewportSize({ width: b, height: b < 500 ? 900 : 1000 })
    await s.waitForTimeout(400)
    await s.screenshot({ path: `${UD}/${navn}-${b}.png`, fullPage: b < 500 })
  }
  if (start) await s.setViewportSize(start)
  await s.waitForTimeout(250)
}

// Tekststumper, der KUN findes i de syntetiske oplysninger. Staar én af
// dem i markuppen, mens adgangen er lukket, er indholdet udleveret.
const PRIVAT = [
  'mette@attrapudlejer.invalid',
  // Nummeret findes i TO former: som vist tekst og uden mellemrum i
  // `tel:`-href'en (`.replace(/\s/g, '')`). En liste med kun
  // visningsformen ville vaere groen paa et laek gennem href'en.
  '20 00 00 00', '+4520000000',
  // Beskedmodulets egne syntetiske samtaler.
  'Mette Attrup', 'fællesvaskeri', 'stadig ledig',
]
/** Alt, der peger mod betaling. Maa ikke staa i en fejlvisning. */
const BETALING = ['9 kr.', '349 kr.', 'abonnement', 'Abonnement']

/**
 * Markuppen for SELVE REJSEN — ikke for proevevisningens betjening.
 *
 * Foerste udgave maalte paa hele `page.content()`, og saa slog den ud
 * paa proevevisningens egne scenarieknapper: «4 · Betaling uden
 * adgang», «5 · Aktivt abonnement». Syv roede linjer, alle om
 * maaleudstyret og ingen om produktet.
 *
 * `innerHTML` og ikke `innerText`: det, `display: none` ville gemme,
 * staar stadig i innerHTML — og det er netop dét, maalingen skal fange.
 */
const rejseHtml = (s) => s.locator('.kui-rejse').innerHTML()

async function koer() {
  revision()
  for (const port of [PORT, GUARDPORT]) {
    if (!(await ledig(port))) {
      p(`AFVIST: port ${port} er optaget. Kontrollen stopper ikke andres processer.`)
      process.exit(2)
    }
  }

  p('══ Bygger ══')
  if (!byg()) { p('AFVIST: `next build` fejlede.'); process.exit(2) }
  p('  ✓ produktionsbyg\n')

  // ── 0 · Guarden ───────────────────────────────────────────
  p('══ 0 · Prøveruten findes ikke uden KONTAKT_PROEVE=1 ══')
  start(GUARDPORT, false)
  const g = await vent(`http://127.0.0.1:${GUARDPORT}${STI}`)
  tjek(g === 404, 'uden flaget svarer /kontakt-ui/proeve 404', `HTTP ${g}`)
  try { process.kill(-mine[0], 'SIGTERM') } catch { /* tom */ }
  await new Promise((r) => setTimeout(r, 1200))

  start(PORT, true)
  const status = await vent(`${BASE}${STI}`)
  if (status !== 200) { p(`AFVIST: prøveruten svarede ${status}`); stopMine(); process.exit(2) }
  tjek(true, 'med flaget svarer den 200')

  const br = await pw.chromium.launch({ executablePath: CHROMIUM })
  const k = await br.newContext({ viewport: { width: 1440, height: 1000 } })
  const s = await k.newPage()
  const konsol = []
  s.on('pageerror', (e) => konsol.push(`sidefejl: ${e.message}`))
  await s.goto(`${BASE}${STI}`, { waitUntil: 'networkidle' })
  await s.getByRole('button', { name: 'Kun det nødvendige' }).click({ timeout: 8000 }).catch(() => {})
  await s.waitForTimeout(700)

  // ── 1 · Udlejerens egen annonce ───────────────────────────
  p('\n══ 1 · Udlejerens egen annonce ══')
  await vaelg(s, '1 · Udlejerens egen annonce')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  const primaer = s.getByRole('button', { name: 'Skriv til udlejeren' })
  tjek(await iSyne(primaer), 'den primære handling er «Skriv til udlejeren»')
  const fyldte = await s.locator('.kui-panel .kui-handling').count()
  tjek(fyldte === 1, 'præcis ÉN primær handling i panelet', `${fyldte}`)
  const overskrift = (await s.locator('.kui-titel').innerText()).trim()
  tjek(overskrift === 'Kontakt udlejeren' && overskrift !== 'Skriv til udlejeren',
    'overskriften er ikke knappens ord — en skærmlæser skal ikke sige det to gange',
    `«${overskrift}»`)
  let html = await s.content()
  const foerKlik = PRIVAT.filter((t) => html.includes(t))
  tjek(foerKlik.length === 0,
    'kontaktoplysningerne staar IKKE i markuppen, foer der trykkes',
    foerKlik.length ? `LÆKKET: ${foerKlik.join(', ')}` : `ingen af de ${PRIVAT.length} stumper`)
  tjek((await s.locator('.kui-kilde').count()) === 0,
    'ingen kildemaerkat paa en udlejerannonce — der ER ingen kilde')
  await s.getByRole('button', { name: 'Vis kontaktoplysninger' }).click()
  await s.locator('.kontaktliste').waitFor({ timeout: 8000 })
  html = await s.content()
  tjek(html.includes('mette@attrapudlejer.invalid') && html.includes('20 00 00 00'),
    'efter trykket staar baade mail og telefon')
  tjek((await s.locator('.kontaktliste a[href^="mailto:"]').count()) === 1
    && (await s.locator('.kontaktliste a[href^="tel:"]').count()) === 1,
  'de er links, der kan bruges')
  await skud(s, '1-native', [390, 768, 1440])

  // Samtalen starter, og beskedmodulet — ikke en ny indbakke — vises.
  await primaer.click()
  tjek(await dukkerOp(s.locator('.bsk-modul'), 10000),
    'beskedmodulet vises, naar samtalen er startet')
  tjek((await s.locator('.kui-beskeder .bsk-liste').count()) === 1,
    'det er modulets EGEN liste — der er ikke bygget en ny indbakke')
  const fokus = await s.evaluate(() =>
    document.activeElement?.classList.contains('kui-afsnitstitel') ?? false)
  tjek(fokus, 'fokus foelger med ned til beskedafsnittet')
  await skud(s, '1b-samtale', [390, 768, 1440])

  // ── 2 · Ekstern annonce ───────────────────────────────────
  //
  // ⚠ DENNE DEL MAALTE FOER DEN FORKERTE REGEL. Den kraevede
  // UBETINGET, at en ekstern annonce hverken viste pris, abonnement
  // eller login — og cementerede dermed antagelsen om, at eksterne
  // annoncer altid er aabne. Nu maales det rigtige: at annoncen
  // gengiver ADAPTERENS svar, ligesom en native goer.
  p('\n══ 2 · Ekstern annonce · adgang givet ══')
  for (const [valg, kilde] of [
    ['2 · Ekstern (home.dk)', 'home.dk'],
    ['2b · Ekstern (CEJ)', 'CEJ'],
    ['2c · Ekstern (Propstep)', 'Propstep'],
  ]) {
    await vaelg(s, valg)
    await s.locator('.kui-panel').waitFor({ timeout: 10000 })
    const link = s.getByRole('link', { name: `Se annoncen hos ${kilde}` })
    tjek(await iSyne(link), `${kilde}: handlingen hedder «Se annoncen hos ${kilde}»`)
    const href = await attr(link, 'href')
    tjek(Boolean(href) && href.startsWith('/go/'),
      `${kilde}: den gaar gennem vores egen /go/<id>`, `«${href}»`)
    const rel = await attr(link, 'rel')
    tjek((rel ?? '').includes('noopener') && (rel ?? '').includes('noreferrer'),
      `${kilde}: rel er noopener noreferrer`, `«${rel}»`)
    tjek((await tekst(s.locator('.kui-kilde')))?.trim() === kilde,
      `${kilde}: kildemaerkatet staar paa annoncen`)
    const h = await rejseHtml(s)
    const salg = BETALING.filter((t) => h.includes(t))
    tjek(salg.length === 0, `${kilde}: adgang givet — saa ingen pris og ingen laas`,
      salg.length ? `FUNDET: ${salg.join(', ')}` : 'ingen')
    tjek((await s.locator('.bsk-modul').count()) === 0,
      `${kilde}: ingen beskeder — kontakten sker hos kilden`)
    tjek((await s.locator('.kui-handling').count()) === 1,
      `${kilde}: præcis ÉN handling`)
  }
  await vaelg(s, '2 · Ekstern (home.dk)')
  await skud(s, '2-ekstern', [390, 768, 1440])

  // ── 2b · Ekstern annonce UNDER DE OEVRIGE TILSTANDE ───────
  //
  // Kernen i rettelsen: naar adapteren siger nej, staar laasen — og
  // vejen ud til kilden er VAEK. Var linket der endnu, havde
  // brugerfladen stadig sin egen regel.
  p('\n══ 2b · Ekstern annonce · adapteren bestemmer ══')
  for (const [valg, navn, knap, pris] of [
    ['2d · Ekstern · abonnement kræves', 'abonnement kræves', 'Se abonnement', true],
    ['2e · Ekstern · udløbet', 'udløbet', 'Genaktivér', false],
    ['2f · Ekstern · login', 'login', 'Log ind', false],
  ]) {
    await vaelg(s, valg)
    const laastKom = await dukkerOp(s.locator('.kui-laast'), 8000)
    tjek(laastKom, `ekstern · ${navn}: laasen staar`,
      laastKom ? '' : 'ingen .kui-laast inden for 8 sek.')
    tjek((await s.getByRole('link', { name: /^Se annoncen hos/ }).count()) === 0,
      `ekstern · ${navn}: INGEN vej videre til kilden`)
    const h = await rejseHtml(s)
    tjek(!h.includes('/go/'),
      `ekstern · ${navn}: kildens adresse staar ikke i markuppen`)
    const knapper = await s.locator('.kui-laast a, .kui-laast button').count()
    tjek(knapper === 1, `ekstern · ${navn}: præcis ÉN handling`, `${knapper}`)
    const etiket = (await tekst(s.locator('.kui-handling')))?.trim() ?? '(ingen)'
    tjek(etiket === knap, `ekstern · ${navn}: handlingen hedder «${knap}»`, `«${etiket}»`)
    const prisVist = (await s.locator('.kui-pris').count()) === 1
    tjek(prisVist === pris,
      `ekstern · ${navn}: prisforloebet ${pris ? 'staar' : 'staar IKKE'}`,
      prisVist ? 'vist' : 'ikke vist')
    tjek((await s.locator('.bsk-modul').count()) === 0,
      `ekstern · ${navn}: ingen indbakke`)
  }

  // Billeddokumentation for selve rettelsen: den eksterne annonce UNDER
  // en laas. Det er her forskellen paa foer og efter kan ses.
  await vaelg(s, '2d · Ekstern · abonnement kræves')
  await dukkerOp(s.locator('.kui-laast'), 8000)
  await skud(s, '2d-ekstern-laast', [390, 768, 1440])

  // En teknisk fejl paa en ekstern annonce maa heller ikke blive til
  // en betalingsopfordring — samme regel, anden annoncetype.
  await vaelg(s, '2g · Ekstern · teknisk fejl')
  const eksternFejl = await dukkerOp(s.locator('.kui-fejl'), 8000)
  tjek(eksternFejl, 'ekstern · teknisk fejl: den neutrale fejlvisning',
    eksternFejl ? '' : 'ingen .kui-fejl inden for 8 sek.')
  const hEksternFejl = await rejseHtml(s)
  const salgEksternFejl = BETALING.filter((t) => hEksternFejl.includes(t))
  tjek(salgEksternFejl.length === 0,
    'ekstern · teknisk fejl: INGEN vej til betaling',
    salgEksternFejl.length ? `FUNDET: ${salgEksternFejl.join(', ')}` : 'ingen')
  tjek(!hEksternFejl.includes('/go/'),
    'ekstern · teknisk fejl: heller ikke vejen ud til kilden')
  tjek(await dukkerOp(s.getByRole('button', { name: 'Prøv igen' }), 3000),
    'ekstern · teknisk fejl: der er et genforsøg')

  await skud(s, '2g-ekstern-fejl', [390, 768, 1440])

  // Opsagt, men betalt: vejen videre er aaben, og datoen staar.
  await vaelg(s, '2h · Ekstern · opsagt')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  tjek(await dukkerOp(s.getByRole('link', { name: /^Se annoncen hos/ }), 5000),
    'ekstern · opsagt: vejen videre er aaben indtil datoen')
  const opsagtNote = await tekst(s.locator('.kui-note[role="status"]').first())
  tjek(/Du har adgang til \d/.test(opsagtNote ?? ''),
    'ekstern · opsagt: der staar hvornaar adgangen ophoerer',
    opsagtNote ? `«${opsagtNote.trim()}»` : '(ingen ophoerslinje)')
  // ⚠ MAALES STRUKTURELT, IKKE PAA ORD. Ordlisten BETALING duer ikke
  // her: den aerlige saetning «Dit abonnement er opsagt» indeholder selv
  // ordet «abonnement», og en tekstsoegning ville derfor doemme den
  // rigtige formulering ude. Paastanden er «det er en oplysning, ikke et
  // salg» — altsaa ingen pris og ingen laas — og dét kan maales direkte.
  const prisOpsagt = await s.locator('.kui-pris').count()
  const laastOpsagt = await s.locator('.kui-laast').count()
  tjek(prisOpsagt === 0 && laastOpsagt === 0,
    'ekstern · opsagt: hverken pris eller laas — det er en oplysning',
    `pris ${prisOpsagt} · laast ${laastOpsagt}`)
  const handlingerOpsagt = await s.locator('.kui-handling').count()
  tjek(handlingerOpsagt === 1, 'ekstern · opsagt: stadig præcis ÉN handling',
    `${handlingerOpsagt}`)

  // ── 3 · Gratis tilstand ───────────────────────────────────
  p('\n══ 3 · Gratis tilstand ══')
  await vaelg(s, '3 · Gratis tilstand')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  const gratisHtml = await rejseHtml(s)
  const gratisSalg = BETALING.filter((t) => gratisHtml.includes(t))
  tjek(gratisSalg.length === 0, 'INGEN betalingsopfordring i gratis tilstand',
    gratisSalg.length ? `FUNDET: ${gratisSalg.join(', ')}` : 'ingen')
  const login = s.getByRole('link', { name: 'Log ind for at skrive' })
  tjek(await iSyne(login), 'login staar dér, hvor funktionen kræver en konto')
  tjek((await login.getAttribute('href')) === '/min-side', 'og den peger paa login')
  tjek(await iSyne(s.getByRole('button', { name: 'Vis kontaktoplysninger' })),
    'kontaktoplysningerne er stadig aabne — login staar KUN ved samtalen')

  // ═══ LOGIN SKAL STAA ALENE ═══
  //
  // Kravet er, at login kun vises dér, hvor funktionen kraever en konto.
  // Uden de tre her var afsnittet groent, selv om panelet viste BAADE et
  // login OG en fungerende «Skriv til udlejeren» ved siden af — altsaa
  // stik imod det, tilstanden skal vise. Maalingen er den samme, som
  // tilstand 1 og afsnit 2 allerede bruger.
  const fyldte3 = await s.locator('.kui-panel .kui-handling').count()
  tjek(fyldte3 === 1,
    'gratis: præcis ÉN fyldt handling — login staar ALENE', `${fyldte3}`)
  tjek((await s.getByRole('button', { name: 'Skriv til udlejeren' }).count()) === 0,
    'gratis: samtalen kan ikke startes uden konto')
  tjek((await s.locator('.bsk-modul').count()) === 0,
    'gratis: ingen indbakke uden konto')
  await skud(s, '3-gratis', [390, 768, 1440])

  // ── 4 · Betaling uden adgang ──────────────────────────────
  p('\n══ 4 · Betaling uden adgang ══')
  await vaelg(s, '4 · Betaling uden adgang')
  await s.locator('.kui-laast').waitFor({ timeout: 10000 })
  const pris = (await s.locator('.kui-pris').innerText()).trim()
  tjek(pris === '9 kr. de første 24 timer. Derefter 349 kr. hver 28. dag.',
    'hele prisforløbet staar i ÉN sætning, ordret', `«${pris}»`)
  const knapper4 = await s.locator('.kui-laast a, .kui-laast button').count()
  tjek(knapper4 === 1, 'præcis ÉN handling', `${knapper4}`)
  tjek((await s.locator('.kui-handling').innerText()).trim() === 'Se abonnement',
    'og den hedder «Se abonnement»')
  html = await s.content()
  const laek4 = PRIVAT.filter((t) => html.includes(t))
  tjek(laek4.length === 0, 'intet privat indhold i markuppen',
    laek4.length ? `LÆKKET: ${laek4.join(', ')}` : `ingen af de ${PRIVAT.length} stumper`)
  tjek((await s.locator('.bsk-modul').count()) === 0, 'og ingen indbakke')
  await skud(s, '4-betaling', [390, 768, 1440])

  // ── 5 · Aktivt abonnement ─────────────────────────────────
  p('\n══ 5 · Aktivt abonnement ══')
  await vaelg(s, '5 · Aktivt abonnement')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  const aabn = s.getByRole('button', { name: 'Åbn beskeder' })
  // «Åbn beskeder» og ikke «Åbn samtalen»: modulet aabner indbakken,
  // ikke den enkelte traad. Knappen lover dét, den goer.
  tjek(await iSyne(aabn), 'samtalen er i gang — handlingen er «Åbn beskeder»')
  await aabn.click()
  tjek(await dukkerOp(s.locator('.bsk-modul'), 10000), 'beskedmodulet vises')
  tjek(await iSyne(s.getByRole('button', { name: 'Vis kontaktoplysninger' })),
    'og kontaktmuligheden er der ogsaa')
  await skud(s, '5-aktivt', [390, 768, 1440])

  // ── 6 · Opsagt med resterende adgang ──────────────────────
  p('\n══ 6 · Opsagt, adgang tilbage ══')
  await vaelg(s, '6 · Opsagt, adgang tilbage')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  tjek(await iSyne(s.getByRole('button', { name: 'Skriv til udlejeren' })),
    'adgangen fortsætter — handlingen er der endnu')
  const noter = await s.locator('.kui-note').allInnerTexts()
  const opsagt = noter.find((t) => t.includes('opsagt'))
  tjek(Boolean(opsagt) && /\d{1,2}\. \w+ \d{4}/.test(opsagt ?? ''),
    'der staar hvornaar adgangen ophoerer, med en dato', `«${(opsagt ?? '').trim()}»`)
  const opsagtHtml = await rejseHtml(s)
  tjek(!opsagtHtml.includes('9 kr.') && !opsagtHtml.includes('349 kr.'),
    'og ingen pris — det er en oplysning, ikke et salg')
  await skud(s, '6-opsagt', [390, 768, 1440])

  // ── 7 · Udløbet adgang ────────────────────────────────────
  p('\n══ 7 · Udløbet adgang ══')
  await vaelg(s, '7 · Udløbet adgang')
  await s.locator('.kui-laast').waitFor({ timeout: 10000 })
  html = await s.content()
  const laek7 = PRIVAT.filter((t) => html.includes(t))
  tjek(laek7.length === 0,
    'hverken kontaktoplysninger eller beskeder i den raa markup',
    laek7.length ? `LÆKKET: ${laek7.join(', ')}` : `ingen af de ${PRIVAT.length} stumper`)
  tjek((await s.locator('.bsk-modul, .bsk-liste, .bsk-boble, #bsk-felt').count()) === 0,
    'ingen beskedfelter overhovedet — de kan hverken læses eller sendes')
  tjek((await s.locator('.kui-handling').innerText()).trim() === 'Genaktivér',
    'ÉN handling: «Genaktivér»')
  tjek((await s.locator('.kui-laast a, .kui-laast button').count()) === 1,
    'og kun den ene')
  await skud(s, '7-udloebet', [390, 768, 1440])

  // ── 8 · Teknisk fejl ──────────────────────────────────────
  p('\n══ 8 · Teknisk fejl ══')
  for (const [valg, navn] of [
    ['8 · Teknisk fejl', 'svar: fejl'],
    ['8b · Porten kaster', 'afvist Promise'],
  ]) {
    await vaelg(s, valg)
    // Tolerant: er fejlvisningen der IKKE, er dét maalingen — en
    // kastende `waitFor` ville afbryde hele koerslen i stedet for at
    // melde en roed linje, og saa faar man hverken fundet eller resten.
    const fejlKom = await dukkerOp(s.locator('.kui-fejl'), 8000)
    tjek(fejlKom, `${navn}: fejlvisningen vises`,
      fejlKom ? '' : 'ingen .kui-fejl inden for 8 sek.')
    const tekst = fejlKom
      ? (await s.locator('.kui-fejl').innerText()).replace(/\s+/g, ' ').trim()
      : '(ingen fejlvisning)'
    tjek(tekst.includes('ikke noget med din adgang'),
      `${navn}: teksten siger, at det er vores fejl`, `«${tekst}»`)
    const h = await rejseHtml(s)
    const salg = BETALING.filter((t) => h.includes(t))
    tjek(salg.length === 0,
      `${navn}: INGEN vej til betaling paa en teknisk fejl`,
      salg.length ? `FUNDET: ${salg.join(', ')}` : 'hverken pris, abonnementsord eller knap')
    tjek(await dukkerOp(s.getByRole('button', { name: 'Prøv igen' }), 3000),
      `${navn}: der er et genforsøg`)
  }
  await vaelg(s, '8 · Teknisk fejl')
  await skud(s, '8-fejl', [390, 768, 1440])

  // ── 8b · Kapløb: hvis svar taeller? ───────────────────────
  //
  // ═══ DEN HER MAALER EN RAEKKEFOELGE, IKKE EN TILSTAND ═══
  //
  // Alle de foregaaende maalinger stiller ÉN tilstand op og ser paa
  // den. Fejlen her opstaar kun, naar to svar er undervejs samtidig og
  // det AELDSTE lander sidst. En statisk maaling kan ikke se den:
  // panelet er groent i alle enkelttilstande og forkert alligevel.
  //
  // Attrappen svarer `fejl`, indtil kaploebet er armeret paa TID (se
  // ARMERET_EFTER i attrap.ts) — derfor ventetiden foer trykkene.
  // Grunden er StrictMode: monteringen kalder hent() to gange, og et
  // kaploeb, der talte kald, ville maale React i stedet for produktet.
  p('\n══ 8b · Kapløb gennem «Prøv igen» ══')
  for (const [valg, navn, slut] of [
    ['Kapløb · gammelt svar sidst', 'gammelt svar sidst', 'laast'],
    ['Kapløb · ordnet levering', 'ordnet levering', 'laast'],
  ]) {
    await vaelg(s, valg)
    const fejlKom = await dukkerOp(s.locator('.kui-fejl'), 8000)
    tjek(fejlKom, `kapløb · ${navn}: fejlvisningen staar, saa der er en knap at trykke paa`,
      fejlKom ? '' : 'ingen .kui-fejl inden for 8 sek.')
    if (!fejlKom) continue

    // Vent til doeren er aaben, saa det er TRYKKENE der danner kaploebet.
    await s.waitForTimeout(1000)
    const knap = s.getByRole('button', { name: 'Prøv igen' })
    await knap.click()            // → langsomt «adgang»
    await s.waitForTimeout(120)
    await knap.click()            // → hurtigt «udløbet»

    // Laasen skal komme foerst …
    const laastKom = await dukkerOp(s.locator('.kui-laast'), 6000)
    tjek(laastKom, `kapløb · ${navn}: den nyere lås lander`,
      laastKom ? '' : 'ingen .kui-laast inden for 6 sek.')

    // … og den skal STAA, ogsaa efter at det gamle svar er landet.
    await s.waitForTimeout(2200)
    const stadigLaast = (await s.locator('.kui-laast').count()) === 1
    tjek(stadigLaast === (slut === 'laast'),
      `kapløb · ${navn}: det gamle «adgang» ophaever IKKE laasen`,
      stadigLaast ? 'stadig laast' : 'LAASEN BLEV OPHAEVET af et forældet svar')

    // Og det laaste panel maa stadig ikke baere noget privat.
    const hK = await rejseHtml(s)
    const laekK = PRIVAT.filter((t) => hK.includes(t))
    tjek(laekK.length === 0, `kapløb · ${navn}: intet privat indhold efter kaploebet`,
      laekK.length ? `LÆKKET: ${laekK.join(', ')}` : 'ingen af stumperne')
    tjek((await s.locator('.bsk-modul').count()) === 0,
      `kapløb · ${navn}: og ingen indbakke`)
  }

  // ── 9 · Login, indlæsning, ingen oplysninger ──────────────
  p('\n══ 9 · Login, indlæsning og tomme felter ══')
  await vaelg(s, 'Login påkrævet')
  await s.locator('.kui-laast').waitFor({ timeout: 10000 })
  tjek((await s.locator('.kui-handling').innerText()).trim() === 'Log ind',
    'login: ÉN handling, «Log ind»')
  const loginHtml = await rejseHtml(s)
  tjek(!loginHtml.includes('9 kr.') && !loginHtml.includes('349 kr.'),
    'login: ingen pris — det er ikke et betalingsspørgsmaal')

  await vaelg(s, 'Indlæsning')
  const skelet = s.locator('.kui-skelet')
  tjek(await dukkerOp(skelet, 3000), 'indlæsning: skelettet vises')
  tjek((await skelet.getAttribute('aria-hidden')) === 'true',
    'og det er aria-hidden — beskeden staar i live-omraadet')
  await s.waitForTimeout(2200)

  await vaelg(s, 'Ingen kontaktoplysninger')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  tjek((await s.locator('.kui-panel').innerText()).includes('ikke oplyst mail eller telefon'),
    'tomme felter: det siges, i stedet for en knap der ikke kan noget')
  tjek((await s.getByRole('button', { name: 'Vis kontaktoplysninger' }).count()) === 0,
    'og der er ingen knap til noget, der ikke findes')

  // ── 10 · Start fejler og start laaser ─────────────────────
  p('\n══ 10 · Når selve starten går galt ══')
  await vaelg(s, 'Start fejler')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  await s.getByRole('button', { name: 'Skriv til udlejeren' }).click()
  tjek(await dukkerOp(s.locator('.kui-linjefejl'), 8000), 'start fejler: fejlen vises')
  const startHtml = await rejseHtml(s)
  const salgStart = BETALING.filter((t) => startHtml.includes(t))
  tjek(salgStart.length === 0, 'og heller ikke her en vej til betaling',
    salgStart.length ? `FUNDET: ${salgStart.join(', ')}` : 'ingen')
  tjek(await iSyne(s.getByRole('button', { name: 'Skriv til udlejeren' })),
    'knappen kan bruges igen')

  // ═══ OVERGANGSMÅLINGEN ═══
  //
  // Den maaler ikke en statisk tilstand, men et SKIFT: oplysningerne er
  // allerede afsloeret, og saa lukker adgangen. En visning, der beholder
  // det, den allerede har hentet, er groen i alle de statiske maalinger
  // og roed her. Det er den eneste, der fanger den.
  await vaelg(s, 'Adgang ændret under start')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  await s.getByRole('button', { name: 'Vis kontaktoplysninger' }).click()
  await s.locator('.kontaktliste').waitFor({ timeout: 8000 })
  html = await s.content()
  tjek(html.includes('mette@attrapudlejer.invalid'),
    'foer laasningen ER oplysningerne afsloeret — ellers maaler skiftet ingenting')
  await s.getByRole('button', { name: 'Skriv til udlejeren' }).click()
  tjek(await dukkerOp(s.locator('.kui-laast'), 8000),
    'adgang aendret under start: hele panelet laases')
  html = await s.content()
  const laek10 = PRIVAT.filter((t) => html.includes(t))
  tjek(laek10.length === 0,
    'og de AFSLOEREDE oplysninger er vaek igen — ikke bare skjult',
    laek10.length ? `LÆKKET: ${laek10.join(', ')}` : 'ingen af de seks stumper')
  tjek((await s.locator('.bsk-modul').count()) === 0, 'beskedafsnittet er lukket')

  // ── 11 · Tastatur ─────────────────────────────────────────
  p('\n══ 11 · Tastaturbetjening ══')
  await vaelg(s, '1 · Udlejerens egen annonce')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  await s.locator('.proeve-titel').click()
  let hop = 0
  let paa = false
  while (hop < 30 && !paa) {
    await s.keyboard.press('Tab')
    hop++
    paa = await s.evaluate(() =>
      document.activeElement?.textContent?.trim() === 'Skriv til udlejeren')
  }
  tjek(paa, 'den primære handling naas med tabulator', `${hop} tryk`)
  const ring = await s.evaluate(() => {
    const e = document.activeElement
    const c = e ? getComputedStyle(e) : null
    return c ? `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` : 'intet'
  })
  tjek(!ring.startsWith('none') && ring !== 'intet', 'fokus er synligt', ring)
  await s.keyboard.press('Enter')
  tjek(await dukkerOp(s.locator('.bsk-modul'), 10000), 'Enter aabner samtalen')

  // ── 12 · 390, 768 og 1440 px ──────────────────────────────
  p('\n══ 12 · Bredder ══')
  for (const valg of ['1 · Udlejerens egen annonce', 'Lange tekster', '4 · Betaling uden adgang']) {
    await vaelg(s, valg)
    await s.locator('.kui-panel, .kui-laast').first().waitFor({ timeout: 10000 })
    for (const b of [390, 768, 1440]) {
      await s.setViewportSize({ width: b, height: b < 500 ? 900 : 1000 })
      await s.waitForTimeout(350)
      const o = await s.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        klient: document.documentElement.clientWidth,
      }))
      tjek(o.doc <= o.klient + 1, `«${valg}» ved ${b} px: ingen vandret rulning`,
        `scrollWidth ${o.doc} · clientWidth ${o.klient}`)
    }
  }
  await vaelg(s, 'Lange tekster')
  await skud(s, '9-lange-tekster', [390, 768, 1440])

  await s.setViewportSize({ width: 390, height: 900 })
  await s.waitForTimeout(400)
  await vaelg(s, '1 · Udlejerens egen annonce')
  await s.locator('.kui-panel').waitFor({ timeout: 10000 })
  const maal = await s.getByRole('button', { name: 'Skriv til udlejeren' }).boundingBox()
  tjek(maal.height >= 44, 'den primære handling er mindst 44 px hoej ved 390 px',
    `${Math.round(maal.height)} px`)
  const maal2 = await s.getByRole('button', { name: 'Vis kontaktoplysninger' }).boundingBox()
  tjek(maal2.height >= 44, 'og det er den sekundære ogsaa', `${Math.round(maal2.height)} px`)
  await s.setViewportSize({ width: 1440, height: 1000 })

  tjek(konsol.length === 0, 'ingen sidefejl i browseren', konsol.join(' · ') || 'ingen')

  await br.close()
  p(`\n── ${proever - fejl}/${proever} kontroller bestået ──`)
}

koer()
  .catch((e) => { p(`\n✗ AFBRUDT: ${e.message}\n${e.stack}`); fejl++ })
  .finally(() => { stopMine(); setTimeout(() => process.exit(fejl ? 1 : 0), 700) })
