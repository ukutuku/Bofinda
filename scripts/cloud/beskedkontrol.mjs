// ═══════════════════════════════════════════════════════════════
//  Beskedmodulets kontrol: tilstandene, tastaturet og mobilvisningen.
//
//      node scripts/cloud/beskedkontrol.mjs [udmappe]
//
//  ── HVAD DEN MÅLER, OG HVAD DEN IKKE GØR ─────────────────────
//
//  Den måler BRUGERFLADEN mod prøvevisningen `/beskeder/proeve`, som
//  svarer ud af hukommelsen med opdigtede samtaler. Der er ingen
//  database, ingen konto, ingen adgangskontrol og ingen beskedlevering
//  bag — og kontrollen påstår derfor ingenting om nogen af delene.
//
//  ── DEN VIGTIGSTE MÅLING, OG HVAD DEN IKKE BEVISER ───────────
//
//  I de tre låste tilstande skal beskedindholdet være FRAVÆRENDE, ikke
//  skjult. Kontrollen læser derfor den rå `page.content()` — hele
//  HTML-teksten, også det `display: none` ville gemme — og forlanger,
//  at hverken adresser, navne eller beskedtekster står i den. En prøve,
//  der kun spurgte `isVisible()`, ville være grøn på præcis den fejl,
//  kravet findes for at forhindre.
//
//  ⚠ Men den måler PRØVEVISNINGENS MARKUP, og intet andet. Den siger
//  ikke, at private data ikke forlader en server: der er ingen server
//  her, porten er en attrap i hukommelsen, og et netværkssvar er ikke
//  en DOM. At serverlaget skal kontrollere adgang og ejerskab og
//  EKSPLICIT bygge et svar uden private felter ved afvisning, er en
//  opgave for den integration — ikke noget, denne prøve kan udtale sig
//  om. Se DATAKONTRAKT.md afsnit 6.
//
//  ── KAPLØB MÅLES MED STYREDE FORSINKELSER ────────────────────
//
//  Attrappen har scenarier, hvis eneste formål er at lade et langsomt
//  svar lande efter et hurtigt: «omvendt», «langsom-afsendelse» og
//  «laas-under-skift». Uden dem kan man ikke skelne kode, der binder
//  svar til den rigtige samtale, fra kode, der bare plejer at være
//  heldig med rækkefølgen.
//
//  ── DEN MÅLER ET PRODUKTIONSBYG ──────────────────────────────
//
//  `next build` + `next start`, ikke `next dev`. Tre grunde: dev-mærket
//  i hjørnet er hverken produkt eller prøve og ville stå på hvert
//  eneste skærmbillede; StrictMode kører effekter to gange og gør en
//  optælling af afsendte beskeder til et gæt; og det er
//  produktionsbygget, kunderne møder. Bygget kræver ingen database —
//  efterprøvet: alle ruter er `ƒ` (server-renderet ved kald).
//
//  ── PROEVEN EJER SINE PROCESSER ──────────────────────────────
//
//  Portene ses efter FØRST, og der stoppes ingenting. Er en af dem
//  optaget, afvises der med exit 2 — en anden sessions app på samme
//  port må ikke blive stoppet af en kontrol, der ikke ved, hvad den er.
//  Oprydningen rammer kun de pid'er, denne kørsel selv noterede.
//
//  ── GUARDEN MÅLES, IKKE FORMODES ─────────────────────────────
//
//  Prøvevisningen skal svare 404 uden `BESKEDER_PROEVE=1`. Det kan ikke
//  måles i den samme proces som den, der har variablen sat, så
//  kontrollen starter kortvarigt en server UDEN den, henter ruten og
//  lukker den igen.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede · 2 = intet at måle på
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { connect as netConnect } from 'node:net'

const PORT = Number(process.env.BESKED_PORT ?? 3200)
const GUARDPORT = Number(process.env.BESKED_GUARDPORT ?? 3201)
const BASE = `http://127.0.0.1:${PORT}`
const STI = '/beskeder/proeve'
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

/**
 * Loggen skal selv sige, hvad den er maalt paa.
 *
 * ═══ HVORFOR DEN FINDES ═══
 *
 * En tidligere leverance sagde «koert paa 6c94f5d» i rapporten, mens
 * logget begyndte med `baseline: a0651f8`. Begge dele var sande — det
 * var en amend af samme aendring — men det kunne ikke efterproeves fra
 * logget, og saa er en revisionsangivelse ikke vaerd noget.
 *
 * Derfor skriver kontrollen nu revisionen, TRAEETS hash og om
 * arbejdstraeet er rent. Traeets hash er det, der taeller: en amend, der
 * kun aendrer commit-beskeden, giver en ny commit-hash og NOEJAGTIG det
 * samme trae. Og er der aendringer i arbejdstraeet — som under en
 * negativ koersel, hvor en sikring med vilje er fjernet — staar det med
 * filnavne, saa ingen kan forveksle den med en ren maaling.
 */
function revision(p) {
  const g = (...a) => spawnSync('git', a, { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim()
  const beskidt = g('status', '--porcelain')
  p(`revision:   ${g('rev-parse', 'HEAD')}`)
  p(`trae:       ${g('rev-parse', 'HEAD^{tree}')}`)
  p(beskidt
    ? `arbejdstrae: ÆNDRET —\n  ${beskidt.split('\n').join('\n  ')}`
    : 'arbejdstrae: rent')
  p('')
}

const ledig = (port) => new Promise((r) => {
  const s = netConnect({ host: '127.0.0.1', port })
  s.once('connect', () => { s.destroy(); r(false) })
  s.once('error', () => r(true))
  setTimeout(() => { s.destroy(); r(true) }, 800)
})

async function vent(url, sek = 60) {
  for (let i = 0; i < sek * 2; i++) {
    try {
      const r = await fetch(url)
      if (r.status !== 0) return r.status
    } catch { /* ikke oppe endnu */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return 0
}

const mine = []
function byg() {
  // Bygget laeser IKKE flaget: `/beskeder/proeve` er `force-dynamic`, og
  // miljoeet afgoeres ved kaldet. Derfor kan det samme byg baade svare
  // 404 og 200 — alt efter hvad serveren startes med.
  const r = spawnSync('npx', ['next', 'build'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: './certs/rapidssl-tls-rsa-ca-g1.pem' },
  })
  return r.status === 0
}
function start(port, medFlag) {
  const b = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: './certs/rapidssl-tls-rsa-ca-g1.pem',
      ...(medFlag ? { BESKEDER_PROEVE: '1' } : { BESKEDER_PROEVE: '' }),
    },
  })
  mine.push(b.pid)
  return b
}
function stopMine() {
  for (const pid of mine) {
    try { process.kill(-pid, 'SIGTERM') } catch { /* allerede væk */ }
    try { process.kill(pid, 'SIGTERM') } catch { /* allerede væk */ }
  }
}

/** Ligger elementet FAKTISK øverst dér, hvor det siger det ligger? */
const iSyne = (l) => l.evaluate((el) => {
  if (!el.checkVisibility?.()) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const x = r.left + r.width / 2
  const y = r.top + Math.min(r.height / 2, 8)
  const top = document.elementFromPoint(x, y)
  return Boolean(top && (top === el || el.contains(top) || top.contains(el)))
})

/**
 * Vælger et scenarie, som et menneske gør det: ved at trykke paa
 * ETIKETTEN. Radioknappen er visuelt skjult (den skal blive — uden den
 * er der hverken gruppenavn eller piletastbetjening), saa et klik paa
 * selve inputtet opsnappes af etiketten ovenpaa.
 *
 * Der efterproeves bagefter, at knappen FAKTISK blev valgt. Ellers
 * ville en etiket uden `for`/indlejring give en tavst gron proeve.
 */
/**
 * Venter, til «Send» faktisk er taendt.
 *
 * `fill()` saetter vaerdien, men React skal gengive, foer knappens
 * `aria-disabled` falder vaek — og et klik imellem de to bliver slugt
 * af knappens egen vagt. Uden den her ventede proeven paa en fejl, der
 * aldrig kom, og fejlede en gang imellem uden at noget var galt.
 */
const ventTilSendTaendt = (s, ms = 8000) => s.waitForFunction(() => {
  const b = document.querySelector('.bsk-send')
  return Boolean(b) && b.getAttribute('aria-disabled') === null
}, null, { timeout: ms }).then(() => true, () => false)

/**
 * Dukker elementet op inden for fristen?
 *
 * Som boolean og ikke som en kastende `waitFor`. En manglende ting er
 * dét, proeven MAALER — og en `waitFor`, der kaster, afbryder hele
 * koerslen, saa man hverken faar en roed linje eller resten af
 * maalingerne. Maalt: tre negative koersler meldte «afbrudt» dér, hvor
 * de skulle have meldt en roed linje.
 */
const dukkerOp = (loc, ms = 6000) =>
  loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)

const vaelg = async (s, navn) => {
  await s.locator('label.proeve-valgknap', { hasText: navn }).click()
  await s.waitForTimeout(400)
  const sat = await s.getByRole('radio', { name: navn, exact: true }).isChecked()
  if (!sat) throw new Error(`scenariet «${navn}» blev ikke valgt`)
}

async function skud(s, navn, bredder) {
  if (!UD) return
  const start = s.viewportSize()
  for (const b of bredder) {
    await s.setViewportSize({ width: b, height: b < 500 ? 844 : 900 })
    await s.waitForTimeout(350)
    await s.screenshot({ path: `${UD}/${navn}-${b}.png`, fullPage: b < 500 })
  }
  if (start) await s.setViewportSize(start)
  await s.waitForTimeout(250)
}

// Tekststumper, der KUN findes i de syntetiske samtaler. Står én af dem
// i markuppen, mens modulet er låst, er indholdet udleveret.
const HEMMELIGT = [
  'Prøvegade 12', 'Mette Attrup', 'fællesvaskeri', 'Ejendomsattrappen',
  'Attrapvej 3', 'Fiktivvej 44',
]

async function koer() {
  revision(p)
  for (const port of [PORT, GUARDPORT]) {
    if (!(await ledig(port))) {
      p(`AFVIST: port ${port} er optaget. Kontrollen stopper ikke andres processer.`)
      process.exit(2)
    }
  }

  p('\n══ Bygger ══')
  if (!byg()) {
    p('AFVIST: `next build` fejlede. Kør den selv for at se hvorfor.')
    process.exit(2)
  }
  p('  ✓ produktionsbyg')

  // ── 0 · Guarden ───────────────────────────────────────────
  p('\n══ 0 · Prøvevisningen findes ikke uden BESKEDER_PROEVE=1 ══')
  start(GUARDPORT, false)
  const gstatus = await vent(`http://127.0.0.1:${GUARDPORT}${STI}`)
  tjek(gstatus === 404, 'uden flaget svarer /beskeder/proeve 404',
    `HTTP ${gstatus}`)
  try { process.kill(-mine[0], 'SIGTERM') } catch { /* tom */ }
  await new Promise((r) => setTimeout(r, 1200))

  start(PORT, true)
  const status = await vent(`${BASE}${STI}`)
  if (status !== 200) {
    p(`AFVIST: prøvevisningen svarede ${status}`)
    stopMine()
    process.exit(2)
  }
  tjek(true, 'med flaget svarer den 200')

  const br = await pw.chromium.launch({ executablePath: CHROMIUM })
  const k = await br.newContext({ viewport: { width: 1440, height: 900 } })
  const s = await k.newPage()
  const konsol = []
  s.on('pageerror', (e) => konsol.push(`sidefejl: ${e.message}`))
  await s.goto(`${BASE}${STI}`, { waitUntil: 'networkidle' })
  // Samtykkeboksen ligger fast i bunden af vinduet og ville daekke
  // skrivefeltet paa hvert eneste skaermbillede. Den lukkes som en
  // bruger ville goere det — med «Kun det noedvendige».
  await s.getByRole('button', { name: 'Kun det nødvendige' }).click({ timeout: 6000 })
  await s.waitForTimeout(600)

  // ── 1 · Adgang: oversigten ────────────────────────────────
  p('\n══ 1 · Samtaleoversigt ══')
  await vaelg(s, 'Adgang')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  const raekker = await s.locator('button.bsk-raekke').count()
  tjek(raekker === 3, 'tre samtaler i listen', `${raekker} rækker`)

  const foerste = s.locator('button.bsk-raekke').first()
  const navn = await foerste.getAttribute('aria-label')
  tjek(Boolean(navn) && navn.includes('Prøvegade 12') && navn.includes('2 ulæste beskeder')
    && navn.includes('sidst for'),
  'rækkens navn siger bolig, modpart, ulæste og hvornår', `«${navn}»`)

  const badge = s.locator('button.bsk-raekke').first().locator('.bsk-ulaest')
  tjek(await iSyne(badge), 'ulæst-markeringen er synlig')
  tjek((await badge.innerText()).trim() === '2', 'markeringen er et TAL, ikke kun en prik',
    `«${(await badge.innerText()).trim()}»`)
  const fed = await foerste.locator('.bsk-raekke-bolig').evaluate((e) =>
    Number(getComputedStyle(e).fontWeight))
  const fedNormal = await s.locator('button.bsk-raekke').nth(1).locator('.bsk-raekke-bolig')
    .evaluate((e) => Number(getComputedStyle(e).fontWeight))
  tjek(fed > fedNormal, 'ulæst rækkes bolig er federe end en læst', `${fed} mod ${fedNormal}`)

  const ialt = await s.locator('.bsk-ulaest-i-alt').innerText()
  tjek(ialt.trim() === '2 ulæste', 'panelet tæller ulæste i alt', `«${ialt.trim()}»`)

  const spalter = await s.locator('.bsk-modul').evaluate((e) =>
    getComputedStyle(e).gridTemplateColumns.split(' ').length)
  tjek(spalter === 2, 'to paneler ved 1440 px', `${spalter} spalte(r)`)
  await skud(s, '1-oversigt', [390, 768, 1440])

  // ── 2 · Samtalen ──────────────────────────────────────────
  p('\n══ 2 · Samtalevisning ══')
  await foerste.click()
  await s.locator('.bsk-boble').first().waitFor({ timeout: 8000 })
  const bobler = await s.locator('.bsk-boble').count()
  tjek(bobler === 4, 'fire beskeder i tråden', `${bobler}`)
  const afsendere = await s.locator('.bsk-afsender').allInnerTexts()
  tjek(afsendere.join('|') === 'Dig|Mette Attrup|Dig|Mette Attrup',
    'hver boble har et SKREVET afsendernavn', afsendere.join(' · '))
  const tider = await s.locator('.bsk-klokken').count()
  tjek(tider === bobler, 'hver boble har et tidspunkt', `${tider} af ${bobler}`)
  const dagskel = await s.locator('.bsk-dagskel').count()
  tjek(dagskel >= 2, 'dagene er skilt ad', `${dagskel} skel`)
  const valgtNu = await s.locator('.bsk-raekke.er-valgt').getAttribute('aria-current')
  tjek(valgtNu === 'true', 'den valgte række bærer aria-current', `«${valgtNu}»`)
  await skud(s, '2-samtale', [390, 768, 1440])

  // ── 3 · Afsendelse ────────────────────────────────────────
  p('\n══ 3 · Afsendelse ══')
  const felt = s.locator('#bsk-felt')
  const send = s.getByRole('button', { name: 'Send', exact: true })
  tjek(await send.getAttribute('aria-disabled') === 'true',
    'Send er slukket, når feltet er tomt')
  await felt.fill('Tak. Torsdag kl. 16 passer fint.')
  await ventTilSendTaendt(s)
  tjek(await send.getAttribute('aria-disabled') === null,
    'Send tændes, når der står noget')
  await felt.press('Control+Enter')
  await s.waitForTimeout(1200)
  const efter = await s.locator('.bsk-boble').count()
  tjek(efter === bobler + 1, 'Ctrl+Enter sender beskeden', `${bobler} → ${efter}`)
  tjek((await felt.inputValue()) === '', 'feltet ryddes FØRST når den er sendt',
    `«${await felt.inputValue()}»`)
  const sidste = await s.locator('.bsk-boble').last().locator('.bsk-boble-tekst').innerText()
  tjek(sidste.includes('Torsdag kl. 16'), 'beskeden står nederst i tråden', `«${sidste}»`)

  // ── 4 · Afsendelsesfejl med bevaret kladde ────────────────
  p('\n══ 4 · Afsendelsesfejl ══')
  await vaelg(s, 'Afsendelsesfejl')
  await s.locator('button.bsk-raekke').first().click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const kladde = 'Den her skal helst ikke forsvinde.'
  await s.locator('#bsk-felt').fill(kladde)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.waitForTimeout(1400)
  const fejllinje = s.locator('.bsk-fejl')
  tjek(await iSyne(fejllinje), 'fejlen er synlig')
  tjek((await fejllinje.innerText()).includes('Din tekst står der stadig'),
    'fejlen siger, at teksten er bevaret', `«${(await fejllinje.innerText()).trim()}»`)
  tjek((await s.locator('#bsk-felt').inputValue()) === kladde,
    'kladden er uændret efter fejlen', `«${await s.locator('#bsk-felt').inputValue()}»`)
  const igen = s.getByRole('button', { name: 'Prøv igen' })
  tjek(await iSyne(igen), 'der er en Prøv igen-knap')
  const live = await s.locator('span.skjult-for-oejet[role=status]').last().innerText()
  tjek(live.includes('blev ikke sendt'), 'fejlen annonceres i live-området', `«${live}»`)
  await skud(s, '4-sendefejl', [390, 768, 1440])

  // ── 5 · Låst adgang: indholdet er FRAVÆRENDE ──────────────
  p('\n══ 5 · Låst adgang ══')
  for (const [valg, grund, knap] of [
    ['Login påkrævet', 'login-kraevet', 'Log ind'],
    ['Abonnement påkrævet', 'abonnement-kraevet', 'Se abonnement'],
    ['Abonnement udløbet', 'abonnement-udloebet', 'Genaktivér'],
  ]) {
    await vaelg(s, valg)
    await s.locator('.bsk-laast').waitFor({ timeout: 8000 })
    const html = await s.content()
    const laekket = HEMMELIGT.filter((h) => html.includes(h))
    tjek(laekket.length === 0,
      `${grund}: intet beskedindhold i markuppen`,
      laekket.length ? `LÆKKET: ${laekket.join(', ')}` : 'ingen af de seks stumper')
    tjek((await s.locator('button.bsk-raekke').count()) === 0
      && (await s.locator('.bsk-boble').count()) === 0,
    `${grund}: hverken rækker eller bobler findes`)
    const knapper = await s.locator('.bsk-laast a, .bsk-laast button').count()
    tjek(knapper === 1, `${grund}: præcis ÉN knap`, `${knapper}`)
    const t = (await s.locator('.bsk-laast-knap').innerText()).trim()
    tjek(t === knap, `${grund}: knappen hedder «${knap}»`, `«${t}»`)
    const forklaring = (await s.locator('.bsk-laast-tekst').innerText()).trim()
    tjek(forklaring.length > 0 && forklaring.length < 120,
      `${grund}: forklaringen er kort`, `${forklaring.length} tegn: «${forklaring}»`)
    if (grund === 'abonnement-udloebet') await skud(s, '5-laast', [390, 768, 1440])
  }

  // ── 6 · Kapløb: svaret skal høre til den viste samtale ────
  p('\n══ 6 · Kapløb mellem samtaler ══')
  await vaelg(s, 'Omvendt rækkefølge')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  // A svarer 1,5 sek. senere end B. Klik A, saa B — A's svar lander sidst.
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('button.bsk-raekke').nth(1).click()
  await s.waitForTimeout(2600)
  const titelNu = (await s.locator('.bsk-samtale-titel').innerText()).trim()
  tjek(titelNu === 'Attrapvej 3, st.',
    'B bliver staaende, selv om A svarer sidst', `«${titelNu}»`)
  const htmlEfterSkift = await s.content()
  // Kun TRAADPANELET maales. A's navn staar med rette i listen ved siden
  // af — det er hendes raekke. Det, der ikke maa ske, er at A's BESKEDER
  // staar i den traad, der handler om B.
  const traadHtml = await s.locator('.bsk-traadpanel').innerHTML()
  const aSpor = ['fællesvaskeri', 'Prøvegade 12', 'stadig ledig']
    .filter((t) => traadHtml.includes(t))
  tjek(aSpor.length === 0, 'A\u2019s beskeder staar ikke i traaden',
    aSpor.length ? `A-tekst fundet: ${aSpor.join(', ')}` : 'ingen A-tekst')
  const boblerB = await s.locator('.bsk-boble').count()
  tjek(boblerB === 2, 'traaden viser B\u2019s to beskeder', `${boblerB}`)

  // ── 6b · Kvittering fra en samtale, brugeren har forladt ──
  p('\n══ 6b · Kvittering fra en forladt samtale ══')
  await vaelg(s, 'Langsom afsendelse')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const boblerA = await s.locator('.bsk-boble').count()
  await s.locator('#bsk-felt').fill('Denne hoerer til A.')
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.locator('button.bsk-raekke').nth(1).click()          // vaek, mens den sender
  await s.locator('.bsk-samtale-titel').waitFor({ timeout: 8000 })
  await s.waitForTimeout(2200)                            // kvitteringen fra A lander her
  const titelB = (await s.locator('.bsk-samtale-titel').innerText()).trim()
  tjek(titelB === 'Attrapvej 3, st.', 'B er stadig den viste samtale', `«${titelB}»`)
  const boblerBEfter = await s.locator('.bsk-boble').count()
  tjek(boblerBEfter === 2, 'B har ikke faaet A\u2019s besked', `${boblerBEfter} bobler`)
  const htmlB = await s.content()
  tjek(!htmlB.includes('Denne hoerer til A'), 'A\u2019s tekst staar ingen steder i B')
  tjek((await s.locator('#bsk-felt').inputValue()) === '',
    'B\u2019s skrivefelt er tomt — kvitteringen ryddede ikke en fremmed kladde',
    `«${await s.locator('#bsk-felt').inputValue()}»`)
  const fokusEfterKvittering = await s.evaluate(() => document.activeElement?.id ?? '')
  tjek(fokusEfterKvittering !== 'bsk-felt',
    'kvitteringen springer ikke fokus til den samtale, brugeren gik til',
    `aktivt element: «${fokusEfterKvittering || 'ikke feltet'}»`)
  // Og beskeden er ikke tabt: A’s raekke i listen har faaet ny aktivitet.
  const aRaekke = await s.locator('button.bsk-raekke').nth(0).innerText()
  tjek(/lige nu|for 0 min/.test(aRaekke),
    'A\u2019s raekke viser den nye aktivitet — kvitteringen blev bundet, ikke smidt vaek',
    aRaekke.replace(/\s+/g, ' ').slice(0, 90))

  // ── 6c · Tekst skrevet EFTER afsendelsen er startet ───────
  p('\n══ 6c · Videre skrivning under afsendelse ══')
  await vaelg(s, 'Langsom afsendelse')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const foerSkrivning = await s.locator('.bsk-boble').count()
  await s.locator('#bsk-felt').fill('hej')
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.locator('#bsk-felt').fill('hej igen')          // skriver videre imens
  await s.waitForTimeout(2200)
  tjek((await s.locator('#bsk-felt').inputValue()) === ' igen',
    'kun den sendte tekst ryddes — resten staar der endnu',
    `«${await s.locator('#bsk-felt').inputValue()}»`)
  const sidsteTekst = await s.locator('.bsk-boble').last().locator('.bsk-boble-tekst').innerText()
  tjek(sidsteTekst.trim() === 'hej', 'det var «hej», der blev sendt', `«${sidsteTekst.trim()}»`)
  tjek((await s.locator('.bsk-boble').count()) === foerSkrivning + 1,
    'praecis én besked kom til')

  // ── 6d · To klik i samme tik maa ikke sende to gange ──────
  p('\n══ 6d · Dobbeltafsendelse ══')
  const foerDobbelt = await s.locator('.bsk-boble').count()
  await s.locator('#bsk-felt').fill('')
  await s.locator('#bsk-felt').fill('Kun én gang, tak.')
  tjek(await ventTilSendTaendt(s), 'Send er taendt igen efter forrige afsendelse')
  // Begge klik afsendes SYNKRONT, foer React naar at gengive. Det er
  // dét, en ref-laas skal fange — `sender` som tilstand er endnu falsk.
  await s.evaluate(() => {
    const b = document.querySelector('.bsk-send')
    b.click(); b.click()
  })
  await s.waitForTimeout(2400)
  tjek((await s.locator('.bsk-boble').count()) === foerDobbelt + 1,
    'to klik i samme tik giver ÉN besked',
    `${foerDobbelt} → ${await s.locator('.bsk-boble').count()}`)

  // ── 6e · Porten AFVISER sit loefte ────────────────────────
  p('\n══ 6e · Afsendelsen kaster ══')
  await vaelg(s, 'Afsendelse kaster')
  await s.locator('button.bsk-raekke').first().click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const kastKladde = 'Den her maa ikke forsvinde i en exception.'
  await s.locator('#bsk-felt').fill(kastKladde)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  const fejlKom = await dukkerOp(s.locator('.bsk-fejl'))
  tjek(fejlKom, 'en kastet Promise giver en synlig fejl',
    fejlKom ? '' : 'ingen .bsk-fejl inden for 6 sek.')
  tjek((await s.locator('#bsk-felt').inputValue()) === kastKladde,
    'kladden er bevaret efter en exception',
    `«${await s.locator('#bsk-felt').inputValue()}»`)
  const sendEfterKast = s.getByRole('button', { name: 'Send', exact: true })
  tjek((await sendEfterKast.getAttribute('aria-busy')) === null,
    'travlheden er slut — knappen haenger ikke i «sender»')
  tjek((await sendEfterKast.getAttribute('aria-disabled')) === null,
    'og den kan bruges igen')
  tjek(await dukkerOp(s.getByRole('button', { name: 'Prøv igen' }), 2000),
    'der er en vej videre')
  await skud(s, '6-afsendelse-kaster', [390, 768, 1440])

  // ── 6f · Laas ved afsendelse, med en samtale aaben ────────
  p('\n══ 6f · Låsning med en samtale åben ══')
  await vaelg(s, 'Lås ved afsendelse')
  await s.locator('button.bsk-raekke').first().click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  await s.locator('#bsk-felt').fill('Skriver lige videre …')
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  tjek(await dukkerOp(s.locator('.bsk-laast'), 8000),
    'et «laast»-svar lukker modulet ned')
  const htmlLaas = await s.content()
  const laekLaas = HEMMELIGT.filter((h) => htmlLaas.includes(h))
  tjek(laekLaas.length === 0,
    'hele modulet laases — listen og beskederne er VAEK, ikke skjult',
    laekLaas.length ? `LÆKKET: ${laekLaas.join(', ')}` : 'ingen af de seks stumper')
  tjek((await s.locator('button.bsk-raekke').count()) === 0
    && (await s.locator('.bsk-boble').count()) === 0
    && (await s.locator('#bsk-felt').count()) === 0,
  'hverken raekker, bobler eller skrivefelt findes')
  // Tolerant: er modulet IKKE laast, findes knappen ikke, og en
  // kastende `innerText` ville afbryde koerslen i stedet for at melde
  // en roed linje. Samme grund som `dukkerOp`.
  const laastKnap = (await s.locator('.bsk-laast-knap').innerText()
    .catch(() => '(ingen laast visning)')).trim()
  tjek(laastKnap === 'Genaktivér', 'og der staar den rigtige knap', `«${laastKnap}»`)
  await skud(s, '6-laas-ved-afsendelse', [390, 768, 1440])

  // ── 6g · Et forsinket «adgang» maa ikke laase op igen ─────
  p('\n══ 6g · Forsinket svar efter en låsning ══')
  await vaelg(s, 'Lås under skift')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(1).click()   // svarer «adgang» om 1,5 sek.
  await s.locator('button.bsk-raekke').nth(0).click()   // svarer «laast» om 0,2 sek.
  tjek(await dukkerOp(s.locator('.bsk-laast'), 8000), 'traadens «laast»-svar lukker modulet ned')
  await s.waitForTimeout(2400)                    // det sene «adgang» lander her
  const htmlSent = await s.content()
  const laekSent = HEMMELIGT.filter((h) => htmlSent.includes(h))
  tjek((await s.locator('.bsk-laast').count()) === 1 && laekSent.length === 0,
    'laasen holder — det forsinkede svar aabner ikke indholdet igen',
    laekSent.length ? `LÆKKET: ${laekSent.join(', ')}` : 'stadig laast, intet indhold')

  // ── 6h · Kvittering EFTER en genlaesning, der allerede har beskeden ──
  //
  // Serveren gemmer straks og kvitterer 2,2 sek. senere. Gaar man vaek og
  // tilbage imellem, har genlaesningen beskeden MED — og en kvittering,
  // der bare laegger den i, giver den samme besked to gange med samme id.
  p('\n══ 6h · Kvittering efter genlæsning ══')
  await vaelg(s, 'Kvittering efter genlæsning')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const foerH = await s.locator('.bsk-boble').count()
  const tekstH = 'Kun én gang, selv om den hentes imellem.'
  await s.locator('#bsk-felt').fill(tekstH)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.locator('button.bsk-raekke').nth(1).click()      // vaek …
  await s.locator('.bsk-samtale-titel').waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()      // … og tilbage
  await s.waitForTimeout(3400)                             // kvitteringen lander her
  const tekstenH = await s.locator('.bsk-boble-tekst').allInnerTexts()
  const antalH = tekstenH.filter((t) => t.trim() === tekstH).length
  tjek(antalH === 1, 'beskeden staar præcis ÉN gang efter genlæsning + kvittering',
    `fundet ${antalH} gang(e)`)
  tjek((await s.locator('.bsk-boble').count()) === foerH + 1,
    'og traaden er vokset med præcis én',
    `${foerH} → ${await s.locator('.bsk-boble').count()}`)

  // ── 6i · Kvittering, mens et ÆLDRE snapshot er undervejs ──
  //
  // Laesningen tager sit oejebliksbillede FOER skrivningen lander og
  // svarer 1,8 sek. senere. Kvitteringen kommer, mens traaden henter —
  // og foer rettelsen blev den smidt vaek, hvorefter det gamle billede
  // erstattede visningen og beskeden forsvandt.
  p('\n══ 6i · Gammelt snapshot under afsendelse ══')
  await vaelg(s, 'Gammelt snapshot')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 12000 })
  const foerI = await s.locator('.bsk-boble').count()
  const tekstI = 'Den her maa ikke forsvinde i en gammel laesning.'
  await s.locator('#bsk-felt').fill(tekstI)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.locator('button.bsk-raekke').nth(1).click()      // vaek …
  await s.locator('button.bsk-raekke').nth(0).click()      // … og straks tilbage
  await s.waitForTimeout(4200)                             // begge svar er landet her
  const tekstenI = await s.locator('.bsk-boble-tekst').allInnerTexts()
  const antalI = tekstenI.filter((t) => t.trim() === tekstI).length
  tjek(antalI === 1, 'den bekraeftede besked staar der — uden at brugeren genindlaeser',
    `fundet ${antalI} gang(e)`)
  tjek((await s.locator('.bsk-boble').count()) === foerI + 1,
    'og traaden er vokset med præcis én',
    `${foerI} → ${await s.locator('.bsk-boble').count()}`)
  tjek((await s.locator('.bsk-samtale-titel').innerText()).trim() === 'Prøvegade 12, 2. th',
    'og det er stadig A, der vises')
  await skud(s, '6-gammelt-snapshot', [1440])

  // ── 7 · Tom indbakke og hentefejl ─────────────────────────
  p('\n══ 7 · Tom indbakke og hentefejl ══')
  await vaelg(s, 'Tom indbakke')
  await s.locator('.bsk-tom').waitFor({ timeout: 8000 })
  tjek((await s.locator('button.bsk-raekke').count()) === 0, 'ingen rækker i en tom indbakke')
  tjek((await s.locator('.bsk-tom-link').count()) === 1, 'én vej videre fra en tom indbakke')
  await skud(s, '7-tom', [390, 768, 1440])

  await vaelg(s, 'Hentefejl')
  await s.locator('.bsk-hentefejl').waitFor({ timeout: 8000 })
  tjek(await iSyne(s.locator('.bsk-hentefejl button')), 'hentefejlen har en Prøv igen-knap')
  await s.locator('.bsk-hentefejl button').click()
  await s.waitForTimeout(900)
  tjek((await s.locator('.bsk-hentefejl').count()) === 1,
    'genforsøget kører og fejler igen — knappen bliver stående')
  await skud(s, '8-hentefejl', [390, 768, 1440])

  // ── 8 · Indlæsning ────────────────────────────────────────
  p('\n══ 8 · Indlæsning ══')
  await vaelg(s, 'Indlæsning')
  const skelet = await s.locator('.bsk-skelet').count()
  tjek(skelet === 1, 'skelettet vises, mens der hentes', `${skelet}`)
  const skjult = await s.locator('.bsk-skelet').getAttribute('aria-hidden')
  tjek(skjult === 'true', 'skelettet er aria-hidden — beskeden står i live-området')
  if (UD) {
    await s.setViewportSize({ width: 1440, height: 900 })
    await s.screenshot({ path: `${UD}/9-indlaesning-1440.png` })
  }
  await s.waitForTimeout(1800)

  // ── 9 · Tastatur ──────────────────────────────────────────
  p('\n══ 9 · Tastaturbetjening ══')
  await vaelg(s, 'Adgang')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('.proeve-titel').click()   // fokus ud af radiogruppen
  await s.keyboard.press('Tab')
  let hop = 0
  let paaRaekke = false
  while (hop < 20 && !paaRaekke) {
    paaRaekke = await s.evaluate(() =>
      document.activeElement?.classList.contains('bsk-raekke') ?? false)
    if (!paaRaekke) { await s.keyboard.press('Tab'); hop++ }
  }
  tjek(paaRaekke, 'første samtale nås med tabulator', `${hop + 1} tryk`)
  const ring = await s.evaluate(() => {
    const e = document.activeElement
    const c = e ? getComputedStyle(e) : null
    return c ? `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}` : 'intet'
  })
  tjek(!ring.startsWith('none') && ring !== 'intet', 'fokus er synligt på rækken', ring)
  await s.keyboard.press('Enter')
  await s.locator('.bsk-boble').first().waitFor({ timeout: 8000 })
  tjek(true, 'Enter åbner samtalen')

  let naaetFelt = false
  for (let i = 0; i < 20 && !naaetFelt; i++) {
    await s.keyboard.press('Tab')
    naaetFelt = await s.evaluate(() => document.activeElement?.id === 'bsk-felt')
  }
  tjek(naaetFelt, 'skrivefeltet nås med tabulator')
  const ledetekst = await s.locator('label[for=bsk-felt]').innerText()
  tjek(ledetekst.startsWith('Skriv en besked til'), 'feltet har en ledetekst', `«${ledetekst}»`)
  // Feltet er TOMT her med vilje. En `disabled`-knap falder ud af
  // tabulatorrækkefølgen, og så ville den, der betjener med tastatur,
  // tabulere forbi «Send» og ned i sidefoden. Det er præcis den fejl,
  // `aria-disabled` i Samtalevisning.tsx findes for at lukke, og den
  // kan kun måles med et tomt felt.
  tjek((await s.locator('#bsk-felt').inputValue()) === '',
    'skrivefeltet er tomt, når rækkefølgen måles')
  await s.keyboard.press('Tab')
  const sendFokus = await s.evaluate(() => document.activeElement?.textContent?.trim())
  tjek(sendFokus === 'Send', 'Send står lige efter feltet — også slukket', `«${sendFokus}»`)
  const sendSlukket = await s.evaluate(() =>
    document.activeElement?.getAttribute('aria-disabled'))
  tjek(sendSlukket === 'true', 'og den siger selv, at den er slukket', `«${sendSlukket}»`)

  // ── 10 · 390 px ───────────────────────────────────────────
  p('\n══ 10 · Mobilvisning, 390 px ══')
  await s.setViewportSize({ width: 390, height: 844 })
  await s.waitForTimeout(500)
  const overloeb = await s.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    klient: document.documentElement.clientWidth,
  }))
  tjek(overloeb.doc <= overloeb.klient + 1, 'ingen vandret rulning ved 390 px',
    `scrollWidth ${overloeb.doc} · clientWidth ${overloeb.klient}`)
  const traadSynlig = await s.locator('.bsk-traadpanel').count()
  const listeSynlig = await s.locator('.bsk-listepanel').count()
  tjek(traadSynlig === 1 && listeSynlig === 0,
    'kun tråden vises, når en samtale er åben', `tråd ${traadSynlig} · liste ${listeSynlig}`)
  const tilbage = s.getByRole('button', { name: /Alle samtaler/ })
  tjek(await iSyne(tilbage), 'tilbageknappen findes på en telefon')
  const maal = await tilbage.boundingBox()
  tjek(maal.height >= 44, 'tilbageknappen er mindst 44 px høj', `${Math.round(maal.height)} px`)
  const sendMaal = await s.getByRole('button', { name: 'Send', exact: true }).boundingBox()
  tjek(sendMaal.height >= 44, 'Send er mindst 44 px høj', `${Math.round(sendMaal.height)} px`)
  await tilbage.click()
  await s.waitForTimeout(500)
  tjek((await s.locator('.bsk-listepanel').count()) === 1, 'tilbage fører til listen')
  const fokusEfter = await s.evaluate(() =>
    document.activeElement?.classList.contains('bsk-paneltitel') ?? false)
  tjek(fokusEfter, 'fokus følger med tilbage til listen')
  const raekkeMaal = await s.locator('button.bsk-raekke').first().boundingBox()
  tjek(raekkeMaal.height >= 44, 'en samtalerække er mindst 44 px høj',
    `${Math.round(raekkeMaal.height)} px`)

  // ── 11 · Vejen tilbage findes i ALLE trådens tilstande ────
  //
  // Tilbageknappen laa foer inde i `Samtalevisning`, og den gengives kun,
  // naar traaden ER hentet. Paa en telefon betoed det, at der ingen vej
  // tilbage var under indlaesning, efter en hentefejl eller paa en samtale,
  // der ikke findes — netop de tre steder, hvor man helst vil vaek igen.
  p('\n══ 11 · Tilbagevejen ved 390 px i alle tilstande ══')
  await s.setViewportSize({ width: 390, height: 844 })
  await s.waitForTimeout(400)

  for (const [valg, navn, vent] of [
    ['Indlæsning', 'under indlæsning', 300],
    ['Trådfejl', 'efter hentefejl', 900],
    ['Findes ikke', 'når samtalen ikke findes', 900],
  ]) {
    await vaelg(s, valg)
    await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
    await s.locator('button.bsk-raekke').nth(0).click()
    await s.waitForTimeout(vent)
    const knap = s.getByRole('button', { name: /Alle samtaler/ })
    // Rulles i syne foerst: `iSyne` spoerger `elementFromPoint`, og den
    // klaebende brandbjaelke ligger oeverst. Maalingen er «findes og er
    // ikke daekket», ikke «staar over folden».
    if (await knap.count()) await knap.scrollIntoViewIfNeeded()
    const findes = (await knap.count()) === 1 && await iSyne(knap)
    tjek(findes, `tilbageknappen findes ${navn}`)
    if (!findes) continue
    const h = await knap.boundingBox()
    tjek(h.height >= 44, `og den er mindst 44 px høj ${navn}`, `${Math.round(h.height)} px`)
    await knap.click()
    await s.waitForTimeout(600)
    tjek((await s.locator('.bsk-listepanel').count()) === 1,
      `og den fører tilbage til listen ${navn}`)
  }

  // Og tilbagevejen skal AFBRYDE det, der er undervejs: et svar, der
  // lander efter, maa ikke skubbe traaden frem igen.
  p('\n══ 11b · Tilbage afbryder et svar undervejs ══')
  await vaelg(s, 'Indlæsning')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 8000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.waitForTimeout(250)
  await s.getByRole('button', { name: /Alle samtaler/ }).click()
  await s.waitForTimeout(2200)   // det langsomme svar lander her
  tjek((await s.locator('.bsk-listepanel').count()) === 1
    && (await s.locator('.bsk-samtale').count()) === 0,
  'listen bliver staaende — det sene svar overtager ikke visningen',
  `liste ${await s.locator('.bsk-listepanel').count()} · samtale ${await s.locator('.bsk-samtale').count()}`)
  await skud(s, '11-tilbagevej', [390])

  await s.setViewportSize({ width: 1440, height: 900 })
  await s.waitForTimeout(300)

  tjek(konsol.length === 0, 'ingen sidefejl i browseren', konsol.join(' · ') || 'ingen')

  await br.close()
  p(`\n── ${proever - fejl}/${proever} kontroller bestået ──`)
}

koer()
  .catch((e) => { p(`\n✗ AFBRUDT: ${e.message}\n${e.stack}`); fejl++ })
  .finally(() => {
    stopMine()
    setTimeout(() => process.exit(fejl ? 1 : 0), 700)
  })
