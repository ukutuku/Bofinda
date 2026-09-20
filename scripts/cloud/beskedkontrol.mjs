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
//  ── DEN VIGTIGSTE MÅLING ─────────────────────────────────────
//
//  I de tre låste tilstande skal beskedindholdet være FRAVÆRENDE, ikke
//  skjult. Kontrollen læser derfor den rå `page.content()` — hele
//  HTML-teksten, også det `display: none` ville gemme — og forlanger,
//  at hverken adresser, navne eller beskedtekster står i den. En prøve,
//  der kun spurgte `isVisible()`, ville være grøn på præcis den fejl,
//  kravet findes for at forhindre.
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
  await s.locator('.bsk-raekke').first().waitFor({ timeout: 8000 })
  const raekker = await s.locator('.bsk-raekke').count()
  tjek(raekker === 3, 'tre samtaler i listen', `${raekker} rækker`)

  const foerste = s.locator('.bsk-raekke').first()
  const navn = await foerste.getAttribute('aria-label')
  tjek(Boolean(navn) && navn.includes('Prøvegade 12') && navn.includes('2 ulæste beskeder')
    && navn.includes('sidst for'),
  'rækkens navn siger bolig, modpart, ulæste og hvornår', `«${navn}»`)

  const badge = s.locator('.bsk-raekke').first().locator('.bsk-ulaest')
  tjek(await iSyne(badge), 'ulæst-markeringen er synlig')
  tjek((await badge.innerText()).trim() === '2', 'markeringen er et TAL, ikke kun en prik',
    `«${(await badge.innerText()).trim()}»`)
  const fed = await foerste.locator('.bsk-raekke-bolig').evaluate((e) =>
    Number(getComputedStyle(e).fontWeight))
  const fedNormal = await s.locator('.bsk-raekke').nth(1).locator('.bsk-raekke-bolig')
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
  await s.locator('.bsk-raekke').first().click()
  await s.locator('#bsk-felt').waitFor({ timeout: 8000 })
  const kladde = 'Den her skal helst ikke forsvinde.'
  await s.locator('#bsk-felt').fill(kladde)
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
    tjek((await s.locator('.bsk-raekke').count()) === 0
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

  // ── 6 · Skrivebeskyttet historik ──────────────────────────
  p('\n══ 6 · Skrivebeskyttet ══')
  await vaelg(s, 'Skrivebeskyttet')
  await s.locator('.bsk-raekke').first().click()
  await s.locator('.bsk-skrivespaerre').waitFor({ timeout: 8000 })
  tjek((await s.locator('#bsk-felt').count()) === 0, 'der er intet skrivefelt')
  tjek((await s.locator('.bsk-boble').count()) > 0, 'historikken kan stadig læses')
  const sp = await s.locator('.bsk-skrivespaerre a').count()
  tjek(sp === 1, 'én knap til genaktivering', `${sp}`)
  await skud(s, '6-skrivebeskyttet', [390, 768, 1440])

  // ── 7 · Tom indbakke og hentefejl ─────────────────────────
  p('\n══ 7 · Tom indbakke og hentefejl ══')
  await vaelg(s, 'Tom indbakke')
  await s.locator('.bsk-tom').waitFor({ timeout: 8000 })
  tjek((await s.locator('.bsk-raekke').count()) === 0, 'ingen rækker i en tom indbakke')
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
  await s.locator('.bsk-raekke').first().waitFor({ timeout: 8000 })
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
  const raekkeMaal = await s.locator('.bsk-raekke').first().boundingBox()
  tjek(raekkeMaal.height >= 44, 'en samtalerække er mindst 44 px høj',
    `${Math.round(raekkeMaal.height)} px`)

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
