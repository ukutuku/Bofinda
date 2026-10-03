// ═══════════════════════════════════════════════════════════════
//  Beskedmodulet under React StrictMode.
//
//      node scripts/cloud/strictmodekontrol.mjs
//
//  ── HVORFOR DEN FINDES VED SIDEN AF beskedkontrol.mjs ────────
//
//  `beskedkontrol.mjs` måler et PRODUKTIONSBYG. Det er det rigtige valg
//  dér — det er den kode, kunderne møder, og StrictMode dobbeltkalder
//  ikke i produktion. Men netop derfor kan den ikke se en hel klasse af
//  fejl, og én af dem var der:
//
//      useEffect(() => () => { levende.current = false }, [])
//
//  StrictMode kalder setup → cleanup → setup på SAMME instans. Uden et
//  `true` i setup stod ref'en tilbage på `false`, og `afsend()` ignorerede
//  derefter både sit ja og sit nej: `setSender(false)` blev sprunget
//  over, og knappen sad fast i travl.
//
//  ── DEN FORMODER IKKE STRICTMODE — DEN MÅLER DET ─────────────
//
//  At starte `next dev` beviser INTET om StrictMode. To ting blev målt,
//  og begge ændrede prøven:
//
//   1 · Projektet har ikke `reactStrictMode` i `next.config.ts`, og
//       Next 15 slår den ikke til af sig selv. Prøvevisningen slår den
//       derfor til i sit EGET træ — se app/beskeder/proeve/Proeve.tsx.
//       `next.config.ts` hører til opsætningen og ikke til denne opgave.
//
//   2 · React 19 dobbeltkalder IKKE effekter, når træet HYDRERES — kun
//       når en komponent monteres bagefter. Ved første indlæsning stod
//       tælleren på 1, selv om StrictMode var aktiv (renderen VAR
//       dobbelt; efterprøvet med en tæller). Prøven måler derfor efter
//       et scenarieskift, som monterer både mærket og modulet på ny.
//
//  Er tallet ikke 2 dér, afvises der med exit 2 — så en grøn linje
//  aldrig kan komme fra et miljø, der ikke var det, den sagde.
//
//  Fejlen ovenfor bider altså ikke i produktionsbygget. Den bider i
//  udvikling, så snart StrictMode er slået til — og en livscyklus, der
//  kun rydder op og aldrig sætter op igen, er forkert uanset hvad der
//  fanger den.
//
//  ── HVAD DEN MÅLER ──────────────────────────────────────────
//
//   1 · StrictMode ER aktiv (effekten kørte to gange).
//   2 · En vellykket afsendelse: beskeden lander, travlheden slutter,
//       feltet ryddes.
//   3 · En AFVIST Promise: fejlen vises, travlheden slutter, kladden
//       bliver stående, og der er en vej videre.
//   4 · Reel afmontering under afsendelse: man går tilbage til listen,
//       mens den sender. Ingen sidefejl, og beskeden er der, når man
//       kommer tilbage — præcis én gang.
//
//  ⚠ ALT MÅLES MOD EN ATTRAP. Der er ingen database, ingen konto, ingen
//  adgangskontrol og ingen beskedlevering bag. Det her siger noget om
//  BRUGERFLADEN under StrictMode, og intet om et serverlag.
//
//  Egen, ledig port (3202). Er den optaget, afvises der — der stoppes
//  aldrig andres processer.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede · 2 = intet at måle på
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { connect as netConnect } from 'node:net'

const PORT = Number(process.env.STRICT_PORT ?? 3202)
const BASE = `http://127.0.0.1:${PORT}`
const STI = '/beskeder/proeve'
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

async function vent(url, sek = 90) {
  for (let i = 0; i < sek * 2; i++) {
    try { const r = await fetch(url); if (r.status !== 0) return r.status } catch { /* ikke oppe */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  return 0
}

const mine = []
function start() {
  // `next dev` og ikke `next start`: StrictMode dobbeltkalder kun i
  // udvikling, og det er dét, proeven findes for at ramme.
  const b = spawn('npx', ['next', 'dev', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      BESKEDER_PROEVE: '1',
      NODE_EXTRA_CA_CERTS: './certs/rapidssl-tls-rsa-ca-g1.pem',
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

const vaelg = async (s, navn) => {
  await s.locator('label.proeve-valgknap', { hasText: navn }).click()
  await s.waitForTimeout(500)
  if (!(await s.getByRole('radio', { name: navn, exact: true }).isChecked())) {
    throw new Error(`scenariet «${navn}» blev ikke valgt`)
  }
}
const ventTilSendTaendt = (s, ms = 10000) => s.waitForFunction(() => {
  const b = document.querySelector('.bsk-send')
  return Boolean(b) && b.getAttribute('aria-disabled') === null
}, null, { timeout: ms }).then(() => true, () => false)
const dukkerOp = (loc, ms = 8000) =>
  loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)

async function koer() {
  revision(p)
  if (!(await ledig(PORT))) {
    p(`AFVIST: port ${PORT} er optaget. Kontrollen stopper ikke andres processer.`)
    process.exit(2)
  }
  start()
  const status = await vent(`${BASE}${STI}`)
  if (status !== 200) { p(`AFVIST: prøvevisningen svarede ${status}`); stopMine(); process.exit(2) }

  const br = await pw.chromium.launch({ executablePath: CHROMIUM })
  const k = await br.newContext({ viewport: { width: 1280, height: 900 } })
  const s = await k.newPage()
  const konsol = []
  s.on('pageerror', (e) => konsol.push(`sidefejl: ${e.message}`))
  await s.goto(`${BASE}${STI}`, { waitUntil: 'networkidle' })
  await s.getByRole('button', { name: 'Kun det nødvendige' }).click({ timeout: 8000 }).catch(() => {})
  await s.waitForTimeout(1200)

  // ── 1 · Er StrictMode overhovedet aktiv? ──────────────────
  p('\n══ 1 · StrictMode dobbeltkalder faktisk ══')
  const vedHydrering = await s.locator('[data-effektkoersler]')
    .getAttribute('data-effektkoersler')
  // Et scenarieskift monterer baade maerket og modulet paa ny. Det er
  // FOERST dér, React 19 dobbeltkalder — se noten i hovedet. Og det skal
  // vaere et ANDET scenarie end det, der staar: «Adgang» er allerede
  // valgt ved indlaesning, saa nøglen ville ikke skifte, og maalingen
  // ville laese hydreringens tal igen. (Maalt: 1 i stedet for 2.)
  await vaelg(s, 'Tom indbakke')
  await s.waitForTimeout(800)
  const koersler = await s.locator('[data-effektkoersler]')
    .getAttribute('data-effektkoersler')
  p(`  · ved hydrering: ${vedHydrering} · efter montering: ${koersler}`)
  tjek(koersler === '2', 'effekten blev sat op TO gange efter en montering',
    `data-effektkoersler = «${koersler}»`)
  if (koersler !== '2') {
    p('AFVIST: uden dobbeltkald maaler proeven ikke det, den siger.')
    await br.close(); stopMine(); process.exit(2)
  }

  // ── 2 · Vellykket afsendelse ──────────────────────────────
  p('\n══ 2 · Vellykket afsendelse under StrictMode ══')
  await vaelg(s, 'Adgang')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 15000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 15000 })
  const foer = await s.locator('.bsk-boble').count()
  await s.locator('#bsk-felt').fill('Virker den under StrictMode?')
  await ventTilSendTaendt(s)
  const send = s.getByRole('button', { name: 'Send', exact: true })
  await send.click()
  await s.waitForTimeout(2000)
  tjek((await s.locator('.bsk-boble').count()) === foer + 1, 'beskeden landede i traaden',
    `${foer} → ${await s.locator('.bsk-boble').count()}`)
  tjek((await send.getAttribute('aria-busy')) === null,
    'travlheden er slut — knappen haenger ikke i «sender»')
  tjek((await s.locator('#bsk-felt').inputValue()) === '', 'feltet er ryddet',
    `«${await s.locator('#bsk-felt').inputValue()}»`)

  // ── 3 · Afvist Promise ────────────────────────────────────
  p('\n══ 3 · Afvist Promise under StrictMode ══')
  await vaelg(s, 'Afsendelse kaster')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 15000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 15000 })
  const kladde = 'Den her skal staa der endnu.'
  await s.locator('#bsk-felt').fill(kladde)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  tjek(await dukkerOp(s.locator('.bsk-fejl')), 'fejlen vises')
  const send3 = s.getByRole('button', { name: 'Send', exact: true })
  tjek((await send3.getAttribute('aria-busy')) === null, 'travlheden er slut')
  tjek((await send3.getAttribute('aria-disabled')) === null, 'og knappen kan bruges igen')
  tjek((await s.locator('#bsk-felt').inputValue()) === kladde, 'kladden er bevaret',
    `«${await s.locator('#bsk-felt').inputValue()}»`)
  tjek(await dukkerOp(s.getByRole('button', { name: 'Prøv igen' }), 3000),
    'der er en vej videre')

  // ── 4 · Reel afmontering under afsendelse ─────────────────
  //
  // 390 px, saa traaden ERSTATTER listen og «Alle samtaler» faktisk
  // afmonterer `Samtalevisning` midt i afsendelsen.
  p('\n══ 4 · Afmontering under afsendelse ══')
  await s.setViewportSize({ width: 390, height: 844 })
  await s.waitForTimeout(500)
  await vaelg(s, 'Langsom afsendelse')
  await s.locator('button.bsk-raekke').first().waitFor({ timeout: 15000 })
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('#bsk-felt').waitFor({ timeout: 15000 })
  const tekst4 = 'Sendt lige foer jeg gik tilbage.'
  await s.locator('#bsk-felt').fill(tekst4)
  await ventTilSendTaendt(s)
  await s.getByRole('button', { name: 'Send', exact: true }).click()
  await s.getByRole('button', { name: /Alle samtaler/ }).click()
  await s.waitForTimeout(2600)
  tjek((await s.locator('.bsk-listepanel').count()) === 1,
    'listen vises — afmonteringen midt i afsendelsen gik igennem')
  tjek(konsol.length === 0, 'ingen sidefejl ved afmontering under afsendelse',
    konsol.join(' · ') || 'ingen')
  await s.locator('button.bsk-raekke').nth(0).click()
  await s.locator('.bsk-boble').first().waitFor({ timeout: 15000 })
  await s.waitForTimeout(1200)
  const tekster = await s.locator('.bsk-boble-tekst').allInnerTexts()
  const antal = tekster.filter((t) => t.trim() === tekst4).length
  tjek(antal === 1, 'beskeden er der — præcis én gang — naar man kommer tilbage',
    `fundet ${antal} gang(e)`)

  await br.close()
  p(`\n── ${proever - fejl}/${proever} kontroller bestået ──`)
}

koer()
  .catch((e) => { p(`\n✗ AFBRUDT: ${e.message}\n${e.stack}`); fejl++ })
  .finally(() => { stopMine(); setTimeout(() => process.exit(fejl ? 1 : 0), 700) })
