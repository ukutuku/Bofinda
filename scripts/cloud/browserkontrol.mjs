// ═══════════════════════════════════════════════════════════════
//  Browserkontrol af Cloud-testmiljøet.
//
//  Måler DOM'en, ikke statuskoden. En side kan svare 200 og være tom;
//  her tælles de kort, der faktisk står på skærmen, og der efterprøves,
//  at billederne er dekodet (naturalWidth > 0) — ikke bare at et
//  <img>-element findes.
//
//  INTET KALD UD AF MASKINEN. Alt uden for 127.0.0.1 afvises i en
//  route-handler og ville få kontrollen til at fejle, hvis en ekstern
//  tjeneste sneg sig ind som en skjult forudsætning.
//
//  Browseren er den præinstallerede Chromium. Der hentes ingen.
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync, readdirSync, statSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.env.BOFINDA_SKAERM ?? 'skaermbilleder'
// Den præinstallerede Chromium. Stien slås OP frem for at være skrevet
// ind: /opt/pw-browsers/chromium er et symlink til selve binæren i dag,
// men mappenavnet bærer et build-nummer, der skifter.
function findChromium() {
  if (process.env.BOFINDA_CHROMIUM) return process.env.BOFINDA_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const bud = [`${rod}/chromium`, `${rod}/chromium/chrome-linux/chrome`]
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      bud.push(`${rod}/${d}/chrome-linux/chrome`)
    }
  } catch { /* mappen findes ikke — buddene nedenfor fælder det */ }
  for (const b of bud) {
    try { if (statSync(b).isFile()) return b } catch { /* næste */ }
  }
  console.error(`FEJL: fandt ingen Chromium under ${rod}. Sæt BOFINDA_CHROMIUM.`)
  process.exit(1)
}
const EXE = findChromium()

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
const u = new URL(url ?? 'x://')
if (u.port !== '55432' || u.pathname !== '/bofinda_test') {
  console.error('FEJL: browserkontrollen kører kun mod den isolerede testbase.'); process.exit(1)
}
const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })

mkdirSync(UD, { recursive: true })
let fejl = 0
const kraev = (b, tekst, ekstra = '') => {
  console.log(`  ${b ? '✓' : '✗'} ${tekst}${ekstra ? `  — ${ekstra}` : ''}`)
  if (!b) fejl++
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

/** En kontekst, hvor ethvert kald ud af maskinen fælder kontrollen. */
async function kontekst(opt) {
  const c = await browser.newContext(opt)
  const udefra = []
  await c.route('**/*', (rute) => {
    const h = new URL(rute.request().url()).hostname
    if (['127.0.0.1', 'localhost', '::1'].includes(h)) return rute.continue()
    udefra.push(rute.request().url())
    return rute.abort()
  })
  return { c, udefra }
}

const maal = (side) => side.evaluate(() => ({
  kort: document.querySelectorAll('.liste article, .liste .kort').length,
  gruppekort: document.querySelectorAll('a[href^="/gruppe"]').length,
  billeder: [...document.images].filter((i) => i.naturalWidth > 0).length,
  billedElementer: document.images.length,
  sidetal: document.querySelectorAll('.side-tal li').length,
  aktuelSide: document.querySelector('.side-nu')?.textContent?.trim() ?? null,
  h1: document.querySelector('h1')?.textContent?.trim().slice(0, 70) ?? null,
  tomtekst: document.body.innerText.includes('Ingen boliger matcher'),
  // Hero-linjen om overtagelse — brudt op af tags i HTML'en, men samlet
  // i innerText. Derfor måles den her og ikke med et regex på kilden.
  overtagelse: (document.body.innerText
    .match(/\d+ kan overtages nu[^\n]*/) ?? [null])[0],
}))

// ═══ 1 · Desktop: første, anden og sidste side ═════════════════
console.log('\n═══ Desktop 1280×900 ═══')
{
  const { c, udefra } = await kontekst({ viewport: { width: 1280, height: 900 } })
  const s = await c.newPage()
  for (const [navn, sti] of [['side1', '/'], ['side2', '/?side=2'], ['side3', '/?side=3']]) {
    await s.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 90_000 })
    const m = await maal(s)
    await s.screenshot({ path: `${UD}/desktop-${navn}.png`, fullPage: false })
    kraev(m.kort > 0, `${navn}: kort renderet i DOM`, `${m.kort} kort, ${m.gruppekort} gruppelinks`)
    kraev(m.billeder > 0, `${navn}: billeder faktisk dekodet`,
      `${m.billeder}/${m.billedElementer} med naturalWidth>0`)
    kraev(m.sidetal >= 3, `${navn}: pageren har sidetal`, `${m.sidetal} tal, står på «${m.aktuelSide}»`)
    if (navn === 'side1') {
      kraev(m.overtagelse != null && !/^0 kan overtages nu . 0 /.test(m.overtagelse),
        'overtagelse: nu · senere · ukendt er alle repræsenteret', m.overtagelse ?? '(ingen linje)')
    }
  }
  // Gruppekort — mindst ét, og det skal kunne åbnes.
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  const gruppe = s.locator('a[href^="/gruppe"]').first()
  const harGruppe = await gruppe.count() > 0
  kraev(harGruppe, 'mindst ét gruppekort på side 1')
  if (harGruppe) {
    await gruppe.click()
    await s.waitForLoadState('networkidle')
    await s.screenshot({ path: `${UD}/desktop-gruppe.png` })
    kraev(s.url().includes('/gruppe'), 'gruppekortet åbner gruppesiden', s.url().replace(BASE, ''))
  }
  // Tom søgeresultatside
  await s.goto(BASE + '/?by=Findesikke', { waitUntil: 'networkidle' })
  const tom = await maal(s)
  await s.screenshot({ path: `${UD}/desktop-tom.png` })
  kraev(tom.kort === 0 && tom.tomtekst, 'tom søgning: nul kort og en forklaring')
  kraev(udefra.length === 0, 'ingen kald uden for 127.0.0.1',
    udefra.length ? udefra.slice(0, 3).join(', ') : 'alt lokalt')
  await c.close()
}

// ═══ 2 · Mobil 390 px ══════════════════════════════════════════
console.log('\n═══ Mobil 390×844 ═══')
{
  const { c, udefra } = await kontekst({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2,
  })
  const s = await c.newPage()
  for (const [navn, sti] of [['side1', '/'], ['side2', '/?side=2'], ['side3', '/?side=3']]) {
    await s.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 90_000 })
    const m = await maal(s)
    // Rul til listen. Uden det viser alle tre skærmbilleder den samme
    // hero-sektion, og de tre sider kan ikke skelnes fra hinanden.
    await s.locator('.liste').first().scrollIntoViewIfNeeded()
    await s.waitForTimeout(600)
    await s.screenshot({ path: `${UD}/mobil-${navn}.png` })
    kraev(m.kort > 0, `${navn}: kort renderet`, `${m.kort} kort`)
    // Ingen vandret scroll: kortene brydes efter deres egen bredde.
    const overloeb = await s.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    kraev(overloeb <= 1, `${navn}: intet vandret overløb`, `${overloeb} px`)
  }
  // Pageren i bunden på mobil — den skal kunne nås med tommelfingeren.
  await s.goto(BASE + '/?side=2', { waitUntil: 'networkidle' })
  await s.locator('nav.sider').first().scrollIntoViewIfNeeded()
  await s.waitForTimeout(400)
  await s.screenshot({ path: `${UD}/mobil-pager.png` })
  const pagerSynlig = await s.locator('nav.sider .side-nu').first().isVisible()
  kraev(pagerSynlig, 'pageren er synlig på 390 px')

  await s.goto(BASE + '/?by=Findesikke', { waitUntil: 'networkidle' })
  await s.screenshot({ path: `${UD}/mobil-tom.png` })
  kraev(udefra.length === 0, 'ingen kald uden for 127.0.0.1')
  await c.close()
}

// ═══ 3 · Analytics: uden samtykke skrives der intet ════════════
console.log('\n═══ Analytics ═══')
const taelHaendelser = async () => {
  const [{ n }] = await sql`select count(*)::int n from haendelser`
  return n
}
await sql`delete from haendelser`
kraev(await taelHaendelser() === 0, 'udgangspunkt: tabellen er tom')

{
  const { c } = await kontekst({ viewport: { width: 1280, height: 900 } })
  const s = await c.newPage()
  // Flere sidevisninger og en navigation — uden at røre banneret.
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  await s.goto(BASE + '/?by=Attrapby', { waitUntil: 'networkidle' })
  await s.goto(BASE + '/?side=2', { waitUntil: 'networkidle' })
  await s.waitForTimeout(1500)
  await s.screenshot({ path: `${UD}/samtykke-banner.png` })
  const uden = await taelHaendelser()
  kraev(uden === 0, 'UDEN samtykke: ingen analytics-rækker', `${uden} rækker`)
  await c.close()
}

{
  const { c } = await kontekst({ viewport: { width: 1280, height: 900 } })
  const s = await c.newPage()
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  const knap = s.getByRole('button', { name: /Tillad statistik/i })
  const fandt = await knap.count() > 0
  kraev(fandt, 'samtykkebanneret er på skærmen')
  if (fandt) {
    await knap.click()
    await s.waitForTimeout(1200)
    // Den efterfølgende navigation: middleware sætter aid/sid på næste
    // request, og først dér kan en sidevisning måles. Se
    // docs/analytics-v1.md, «Afleveringskontrakt til Frontend».
    await s.goto(BASE + '/?by=Attrapby', { waitUntil: 'networkidle' })
    await s.goto(BASE + '/?by=Attrapby&side=1', { waitUntil: 'networkidle' })
    await s.waitForTimeout(2500)
    await s.screenshot({ path: `${UD}/efter-samtykke.png` })
  }
  const med = await taelHaendelser()
  kraev(med > 0, 'MED samtykke: analytics skriver til testbasen', `${med} rækker`)
  const raekker = await sql`
    select event_name, environment, count(*)::int n from haendelser
    group by 1,2 order by 3 desc`
  for (const r of raekker) console.log(`      · ${r.event_name} [${r.environment}] ×${r.n}`)
  const [{ udvikling }] = await sql`
    select count(*)::int udvikling from haendelser where environment = 'udvikling'`
  kraev(med > 0 && udvikling === med, 'alle rækker er stemplet «udvikling»',
    'ingen kan forveksles med produktion')
  await c.close()
}

await browser.close()
await sql.end()
console.log(`\n${fejl === 0 ? '✓ ALT GRØNT' : `✗ ${fejl} kontroller fejlede`}  — skærmbilleder i ${UD}/\n`)
process.exit(fejl === 0 ? 0 : 1)
