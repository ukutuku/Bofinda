// ═══════════════════════════════════════════════════════════════
//  Pagination- og analytics-kontrol i rigtig browser.
//
//  SEPARAT fra scripts/cloud/browserkontrol.mjs med vilje: den er den
//  generelle kontrol af miljøet og skal blive, som den er. Den her måler
//  pagineringen og den ene analytics-kontrakt, pagineringen indførte.
//
//  HVAD DEN IKKE GENTAGER: sidevinduets algebra — at alle sider tilsammen
//  giver præcis det filtrerede sæt, at en gruppe ikke deles, at hver side
//  har højst 48 kort, at `side` aldrig når `Filtre` — måles allerede af
//  scripts/test-soegning.ts mod databasen. Her måles kun det, en browser
//  kan afgøre, og en dataprøve ikke kan.
//
//  «Side 2 svarede 48 kort» er IKKE en bestået kontrol. Der efterprøves,
//  at det er det RIGTIGE udsnit: ingen bolig går igen fra side 1, og
//  rækkefølgen er den, sorteringen lover.
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.env.BOFINDA_SKAERM ?? 'skaermbilleder'
const PR_SIDE = 48

function findChromium() {
  if (process.env.BOFINDA_CHROMIUM) return process.env.BOFINDA_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const bud = [`${rod}/chromium`]
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse())
      bud.push(`${rod}/${d}/chrome-linux/chrome`)
  } catch { /* fælles fejl nedenfor */ }
  for (const b of bud) { try { if (statSync(b).isFile()) return b } catch { /* næste */ } }
  console.error(`FEJL: fandt ingen Chromium under ${rod}.`); process.exit(1)
}

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
const u = new URL(url ?? 'x://')
if (u.port !== '55432' || u.pathname !== '/bofinda_test') {
  console.error('FEJL: kontrollen kører kun mod den isolerede testbase.'); process.exit(1)
}
const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })

mkdirSync(UD, { recursive: true })
let fejl = 0
const kraev = (b, tekst, ekstra = '') => {
  console.log(`  ${b ? '✓' : '✗'} ${tekst}${ekstra ? `  — ${ekstra}` : ''}`)
  if (!b) fejl++
}
/**
 * Tællingen er afgrænset til DENNE browserkontekst' anonyme id, når det
 * er sat. Uden afgrænsningen kunne en række fra et tidligere afsnit —
 * eller fra en tidligere kørsel — gøre kontrollen grøn, uden at
 * handlingen i den her nogensinde blev registreret.
 */
let _aid = null
const saetIdentitet = (aid) => { _aid = aid ?? null }
const tael = async (navn) => (_aid
  ? (await sql`select count(*)::int c from haendelser
       where event_name = ${navn} and anonymous_id = ${_aid}::uuid`)[0].c
  : (await sql`select count(*)::int c from haendelser
       where event_name = ${navn}`)[0].c)

/**
 * Vent til tællingen NÅR et tal — poll, aldrig en fast pause.
 *
 * Klienten lægger events i en kø, tømmer den med `sendBeacon` på
 * `pagehide`, og serveren skriver i `after()`, altså EFTER svaret. Der er
 * ingen ventetid, der både er kort nok til at være rimelig og lang nok
 * til altid at holde: kontrollen var grøn og bagefter rød på den samme
 * kode, alene fordi dev-serveren lige havde genkompileret. En prøve, der
 * afhænger af, hvor hurtig maskinen var, måler maskinen.
 */
async function ventPaa(navn, mindst, ms = 15000) {
  const slut = Date.now() + ms
  for (;;) {
    const n = await tael(navn)
    if (n >= mindst) return n
    if (Date.now() > slut) return n
    await new Promise((r) => setTimeout(r, 250))
  }
}

/** Vent til en tælling holder op med at stige, og bliv ved med at være.
 *  Til de kontroller, der skal vise, at der IKKE kommer noget. */
async function iRo(navn, ms = 4000) {
  await new Promise((r) => setTimeout(r, ms))
  return tael(navn)
}
const alle = async () => (await sql`select count(*)::int c from haendelser`)[0].c

const browser = await chromium.launch({
  executablePath: findChromium(), args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

/**
 * Kontekst hvor ethvert kald ud af maskinen fælder kontrollen.
 *
 * TO TILSTANDE, og forskellen er ikke kosmetisk:
 *
 *  · `bloker: true` — en route-handler afviser ikke-loopback. Bruges dér,
 *    hvor der måles layout og markup.
 *
 *  · `bloker: false` — requests OBSERVERES i stedet. Bruges i
 *    analytics-afsnittene, fordi det at REGISTRERE en route overhovedet
 *    slår CDP-interception til for ALLE requests. Den ekstra rundtur
 *    gennem Playwright er nok til at æde `sendBeacon`s vindue under
 *    `pagehide`, og så forsvandt hver eneste klient-event, mens serverens
 *    egne kom igennem. Kontrollen målte sin egen instrumentering — den
 *    var skiftevis grøn og rød på uændret kode.
 *
 *    Et eksternt kald bliver altså udført her i stedet for afvist. Det
 *    er stadig en fejl, og kontrollen fælder på det: appen har ingen
 *    eksterne afhængigheder i dette miljø, så listen skal være tom.
 */
const IKKE_LOOPBACK = /^(?!https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/)/
const erLokal = (u) => {
  try { return ['127.0.0.1', 'localhost', '::1'].includes(new URL(u).hostname) }
  catch { return false }
}
async function kontekst({ bloker = true, ...opt } = {}) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opt })
  const udefra = []
  if (bloker) {
    await c.route(IKKE_LOOPBACK, (r) => { udefra.push(r.request().url()); return r.abort() })
  } else {
    c.on('request', (r) => { if (!erLokal(r.url())) udefra.push(r.url()) })
  }
  return { c, udefra }
}

const felt = (s) => s.locator('form.filtre input[name="sted"]').first()
const knap = (s) => s.locator('form.filtre button[type="submit"]').first()
/**
 * Vent til siden er klar til NÆSTE brugerhandling.
 *
 * Et modtaget svar er ikke bevis for det. `search_submitted` udsendes af
 * en `submit`-lytter, som `Maaling` kobler på i en `useEffect` — altså
 * efter hydrering. Klikkes der før det, findes lytteren ikke, og
 * indsendelsen er tabt uden at nogen kan se hvorfor.
 *
 * Signalet er Reacts egen: et hydreret DOM-element bærer en
 * `__reactFiber$…`-nøgle. Er den på formularen, har hydreringen nået
 * netop det træ, effekterne er kørt, og lytteren er der.
 */
async function klar(s) {
  await s.waitForLoadState('domcontentloaded')
  await s.waitForFunction(() => {
    const f = document.querySelector('form.filtre')
    return !!f && Object.keys(f).some((k) => k.startsWith('__reactFiber$'))
  }, null, { timeout: 20000 })
  await s.waitForLoadState('networkidle')
}

/**
 * Indsend formularen og vent på det NYE dokument.
 *
 * Der ventes på `load` — ikke på at adressen ændrer sig. En gentagen
 * indsendelse med præcis de samme filtre navigerer til præcis den samme
 * adresse, og den handling er stadig en ny indsendelse, som SKAL tælle.
 * Et krav om URL-forskel ville lade netop det tilfælde falde igennem, og
 * en URL-regex, der allerede er opfyldt, returnerer med det samme og
 * beviser ingenting.
 *
 * Ventningen sættes op FØR klikket. Ellers kan dokumentet nå at være
 * skiftet, inden der lyttes.
 */
async function indsend(s, vaerdi, medEnter = false) {
  await klar(s)
  const foer = s.url()
  await felt(s).fill(vaerdi)
  const nav = s.waitForEvent('load', { timeout: 20000 })
  if (medEnter) await felt(s).press('Enter')
  else await knap(s).click()
  await nav
  await klar(s)
  return { uaendretUrl: s.url() === foer, url: s.url() }
}

/** Bolig-id'erne på siden, i DOM-orden. Rækkefølgen er en del af svaret. */
const kortPaaSiden = (s) => s.evaluate(() =>
  [...document.querySelectorAll('a.kort[data-bolig]')].map((e) => e.dataset.bolig))

// ═══ 1 · Analytics ende-til-ende ═══════════════════════════════
console.log('\n═══ 1 · search_submitted, ende til ende ═══')
await sql`delete from haendelser`
{
  const { c, udefra } = await kontekst({ bloker: false })
  const s = await c.newPage()

  // ── Frisk browser uden samtykke ──
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  await indsend(s, 'Attrapby')
  await s.goto(BASE + '/?side=2', { waitUntil: 'networkidle' })
  await s.waitForTimeout(1200)
  kraev(await alle() === 0, 'uden samtykke: ingen analytics-rækker overhovedet',
    `${await alle()} rækker`)

  // ── Tillad statistik → FØRSTE indsendelse ──
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  await klar(s)
  // Samtykket genindlæser ruten. Vent på DET NYE DOKUMENT og på at det er
  // hydreret — ikke på at cookien dukker op. Cookien kommer først, og en
  // indsendelse i mellemrummet blev tabt: målt til 500-1000 ms, da
  // rettelsen var en RSC-genhentning. Et signal, der kommer for tidligt,
  // er ikke et readiness-signal.
  const genindlaest = s.waitForEvent('load', { timeout: 20000 })
  await s.getByRole('button', { name: /Tillad statistik/i }).click()
  await genindlaest
  await klar(s)
  const aid = (await c.cookies()).find((x) => x.name === 'bofinda_aid')?.value ?? null
  const cookies = (await c.cookies()).map((x) => x.name)
  kraev(!!aid && cookies.includes('bofinda_sid'),
    'efter samtykkets genindlæsning er identiteten på plads', cookies.sort().join(', '))
  // Nulpunktet: alt tælles herefter kun for DENNE identitet, og tabellen
  // er tom. En gammel række kan ikke gøre noget grønt.
  saetIdentitet(aid)
  kraev(await tael('search_submitted') === 0, 'nulpunkt: ingen indsendelser for denne identitet')

  // De tre indsendelser bruger PRÆCIS SAMME værdi. Det er med vilje: fra
  // og med den anden lander de på den samme adresse, og en gentagen
  // indsendelse til en uændret URL er stadig en ny indsendelse.
  const i1 = await indsend(s, 'Attrapby')
  kraev(await ventPaa('search_submitted', 1) === 1,
    'FØRSTE søgeindsendelse efter samtykke registreres', `${await tael('search_submitted')}`)

  const i2 = await indsend(s, 'Attrapby')
  kraev(await ventPaa('search_submitted', 2) === 2,
    'samme filtre igen er stadig en indsendelse', `${await tael('search_submitted')}`)

  const i3 = await indsend(s, 'Attrapby', true)   // Enter, samme filtre
  kraev(await ventPaa('search_submitted', 3) === 3,
    'Enter med de samme filtre tæller som en tredje indsendelse',
    `${await tael('search_submitted')}`)

  // Blev tilfældet «samme adresse» faktisk udøvet? Ellers har kontrollen
  // ikke prøvet det, den påstår at prøve.
  kraev(i2.uaendretUrl || i3.uaendretUrl,
    'mindst én af gentagelserne gik til en UÆNDRET adresse',
    `2: ${i2.uaendretUrl ? 'uændret' : 'ændret'} · 3: ${i3.uaendretUrl ? 'uændret' : 'ændret'}`)
  void i1

  // ── Sideskift, reload og tilbage må IKKE tælle ──
  const foer = await tael('search_submitted')
  const pagerlink = s.locator('nav.sider a[rel="next"]').first()
  if (await pagerlink.count()) { await pagerlink.click(); await s.waitForLoadState('networkidle') }
  else { await s.goto(BASE + '/?side=2', { waitUntil: 'networkidle' }) }
  await s.reload({ waitUntil: 'networkidle' })
  await s.goBack({ waitUntil: 'networkidle' }).catch(() => {})
  await s.goForward({ waitUntil: 'networkidle' }).catch(() => {})
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  kraev(await iRo('search_submitted') === foer,
    'sideskift, reload og tilbage/frem giver INGEN indsendelse',
    `${foer} → ${await tael('search_submitted')}`)

  // ── Afvist HTML-validering ──
  // `submit` fyrer slet ikke, når browseren afviser feltet. Kravet måles
  // på browserens egen adfærd, ikke på en efterligning af den.
  const foer2 = await tael('search_submitted')
  await s.evaluate(() => {
    const f = document.querySelector('form.filtre input[name="sted"]')
    f.setAttribute('required', ''); f.value = ''
  })
  await knap(s).click()
  kraev(await iRo('search_submitted') === foer2,
    'afvist formularvalidering giver ingen indsendelse',
    `${foer2} → ${await tael('search_submitted')}`)

  // ── En anden handler kalder preventDefault ──
  await s.evaluate(() => {
    document.querySelector('form.filtre input[name="sted"]').removeAttribute('required')
    document.addEventListener('submit', (e) => e.preventDefault(), true)
  })
  const foer3 = await tael('search_submitted')
  await felt(s).fill('Attrapby')
  await knap(s).click()
  kraev(await iRo('search_submitted') === foer3,
    'annulleret indsendelse (preventDefault) tæller ikke',
    `${foer3} → ${await tael('search_submitted')}`)

  kraev(udefra.length === 0, 'ingen kald uden for 127.0.0.1')
  saetIdentitet(null)     // afgrænsningen gælder KUN dette afsnit
  await c.close()
}

// ═══ 2 · result_view_id og globale positioner ══════════════════
console.log('\n═══ 2 · result_view_id og impression-positioner ═══')
await sql`delete from haendelser`
{
  const { c } = await kontekst({ bloker: false })
  await c.addCookies([{ name: 'bofinda_samtykke', value: 'ja', domain: '127.0.0.1', path: '/' }])
  const s = await c.newPage()
  // En impression kræver ≥50 % synlig i ≥1000 ms SAMMENHÆNGENDE. Ruller
  // man hurtigere end det, når intet kort tærsklen, og kontrollen måler
  // sin egen rullehastighed i stedet for produktet.
  const rul = async () => {
    for (let y = 0; y < 6; y++) {
      await s.evaluate((n) => window.scrollTo(0, n * 900), y)
      await s.waitForTimeout(1600)
    }
  }
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  await s.reload({ waitUntil: 'networkidle' })       // identitet på plads
  await rul()
  // Navigationen tømmer køen for side 1. Vent på at den ER tømt, før
  // side 2 måles — ellers kan de to sidevisninger ikke skelnes.
  await s.goto(BASE + '/?side=2', { waitUntil: 'networkidle' })
  await ventPaa('listing_impression', 1)
  await rul()
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })  // tøm køen
  // Vent på at BEGGE sidevisninger har afleveret. Ventes der bare på «én
  // impression», måles side 1 alene, og den globale positionering — hele
  // pointen — bliver aldrig prøvet.
  for (let i = 0; i < 60; i++) {
    const [{ n }] = await sql`
      select count(distinct properties->>'result_view_id')::int n
      from haendelser where event_name = 'listing_impression'`
    if (n >= 2) break
    await new Promise((r) => setTimeout(r, 250))
  }

  const imp = await sql`
    select (properties->>'result_view_id') vid, (properties->>'position')::int pos
    from haendelser where event_name = 'listing_impression' order by pos`
  kraev(imp.length > 0, 'der er impressions at måle på', `${imp.length} stk.`)
  const vids = new Set(imp.map((r) => r.vid))
  kraev(vids.size >= 2 && [...vids].every(Boolean),
    'hver sidevisning har sit eget result_view_id', `${vids.size} forskellige`)
  // Positionerne er GLOBALE: side 2 begynder ved 49, ikke ved 1.
  const maks = Math.max(...imp.map((r) => r.pos))
  kraev(maks > PR_SIDE, 'positioner fra side 2 er globale, ikke 1-baserede pr. side',
    `højeste position ${maks} (> ${PR_SIDE})`)
  kraev(imp.length > 0 && imp.every((r) => r.pos >= 1 && r.pos <= 2 * PR_SIDE),
    'alle positioner ligger inden for de to viste sider', `1–${maks}`)
  await c.close()
}

// ═══ 3 · Side 2 er det RIGTIGE udsnit ══════════════════════════
console.log('\n═══ 3 · sideudsnit, ikke bare 48 kort ═══')
{
  const { c } = await kontekst()
  const s = await c.newPage()
  const sider = {}
  for (const n of [1, 2, 3]) {
    await s.goto(`${BASE}/?side=${n}`, { waitUntil: 'networkidle' })
    sider[n] = await kortPaaSiden(s)
    await s.screenshot({ path: `${UD}/pag-desktop-side${n}.png` })
  }
  kraev(sider[1].length > 0 && sider[2].length > 0, 'der er kort på side 1 og 2',
    `${sider[1].length} / ${sider[2].length}`)
  const snit = (a, b) => a.filter((x) => b.includes(x))
  kraev(snit(sider[1], sider[2]).length === 0, 'side 2 gentager INGEN bolig fra side 1',
    `${snit(sider[1], sider[2]).length} fælles`)
  kraev(snit(sider[2], sider[3]).length === 0, 'side 3 gentager ingen bolig fra side 2')
  kraev(new Set(sider[2]).size === sider[2].length, 'ingen bolig optræder to gange på side 2')

  // Filtre og sortering skal overleve et sideskift.
  await s.goto(`${BASE}/?by=Attrapby&sorter=pris_op&kort=0`, { waitUntil: 'networkidle' })
  const naeste = s.locator('nav.sider a[rel="next"]').first()
  if (await naeste.count()) {
    await naeste.click(); await s.waitForLoadState('networkidle')
    const q = new URL(s.url()).searchParams
    kraev(q.get('by') === 'Attrapby' && q.get('sorter') === 'pris_op' && q.get('kort') === '0'
      && q.get('side') === '2', 'filtre og sortering overlever et sideskift',
      s.url().replace(BASE, ''))
  } else {
    // Attrapby fylder ikke to sider — så prøv uden stedfilter.
    await s.goto(`${BASE}/?sorter=pris_op&kort=0`, { waitUntil: 'networkidle' })
    await s.locator('nav.sider a[rel="next"]').first().click()
    await s.waitForLoadState('networkidle')
    const q = new URL(s.url()).searchParams
    kraev(q.get('sorter') === 'pris_op' && q.get('kort') === '0' && q.get('side') === '2',
      'sortering og kortvalg overlever et sideskift', s.url().replace(BASE, ''))
  }

  // En NY indsendelse skal begynde forfra på side 1.
  await s.goto(`${BASE}/?side=3`, { waitUntil: 'networkidle' })
  await indsend(s, 'Attrapby')
  kraev(!new URL(s.url()).searchParams.has('side'),
    'en ny søgning starter på side 1 — `side` er ude af adressen',
    s.url().replace(BASE, ''))
  await c.close()
}

// ═══ 4 · Mobil 390 px ══════════════════════════════════════════
console.log('\n═══ 4 · mobil 390 px ═══')
{
  const { c } = await kontekst({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const s = await c.newPage()
  for (const n of [1, 2, 3]) {
    await s.goto(`${BASE}/?side=${n}`, { waitUntil: 'networkidle' })
    await s.locator('.liste').first().scrollIntoViewIfNeeded()
    await s.waitForTimeout(500)
    await s.screenshot({ path: `${UD}/pag-mobil-side${n}.png` })
    const overloeb = await s.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const kort = (await kortPaaSiden(s)).length
    kraev(kort > 0 && overloeb <= 1, `side ${n}: kort renderet, intet vandret overløb`,
      `${kort} kort, ${overloeb} px`)
  }
  await s.locator('nav.sider').first().scrollIntoViewIfNeeded()
  await s.screenshot({ path: `${UD}/pag-mobil-pager.png` })
  await c.close()
}

// ═══ 5 · Uden for rækkevidde: HTTP, robots, canonical ══════════
console.log('\n═══ 5 · sidetal uden for rækkevidde ═══')
{
  const { c } = await kontekst()
  const s = await c.newPage()
  const meta = async (sti) => {
    const svar = await s.goto(BASE + sti, { waitUntil: 'networkidle' })
    return {
      status: svar.status(),
      canonical: await s.locator('link[rel="canonical"]').first()
        .getAttribute('href').catch(() => null),
      robots: await s.locator('meta[name="robots"]').first()
        .getAttribute('content').catch(() => null),
      tekst: await s.evaluate(() => document.body.innerText),
    }
  }

  const gyldig = await meta('/lejeboliger/9001')
  kraev(gyldig.status === 200 && gyldig.canonical?.endsWith('/lejeboliger/9001')
    && !gyldig.robots?.includes('noindex'),
    'gyldig områdeside: 200, self-canonical, indekserbar',
    `${gyldig.status} · ${gyldig.canonical} · robots=${gyldig.robots ?? '(ingen)'}`)

  const ude = await meta('/lejeboliger/9001?side=99')
  kraev(ude.status === 200, 'uden for rækkevidde svarer 200 med en forklaring', `${ude.status}`)
  kraev(ude.robots?.includes('noindex'), 'uden for rækkevidde er noindex',
    ude.robots ?? '(ingen robots-meta)')
  kraev(ude.canonical == null,
    'uden for rækkevidde har INGEN canonical — hverken sig selv eller side 1',
    ude.canonical ?? '(ingen)')
  kraev(/Side 99 findes ikke/.test(ude.tekst),
    'siden siger hvad der skete, ikke «ingen boliger matcher»')
  kraev(!/Ingen boliger/.test(ude.tekst),
    'et sidetal uden for rækkevidde forveksles ikke med et nulresultat')
  await s.screenshot({ path: `${UD}/pag-udenfor-raekkevidde.png` })

  // De tre tilstande skal kunne skelnes fra hinanden.
  const nul = await meta('/?by=Findesikke')
  kraev(/Ingen boliger matcher/.test(nul.tekst),
    'ægte nulresultat siger «Ingen boliger matcher»')
  const forHoej = await meta('/?side=99')
  kraev(/Side 99 findes ikke/.test(forHoej.tekst) && !/Ingen boliger matcher/.test(forHoej.tekst),
    'søgesiden skelner også de to fra hinanden')
  await c.close()
}

// ═══ 6 · empty_results ved tomt sideudsnit ═════════════════════
console.log('\n═══ 6 · et tomt sideudsnit er ikke et nulresultat ═══')
await sql`delete from haendelser`
{
  const { c } = await kontekst({ bloker: false })
  await c.addCookies([{ name: 'bofinda_samtykke', value: 'ja', domain: '127.0.0.1', path: '/' }])
  const s = await c.newPage()
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  await s.reload({ waitUntil: 'networkidle' })
  await klar(s)
  // Denne kontekst' EGEN identitet. Uden den tælles der på et id fra et
  // andet afsnit, og så er «ingen empty_results» grøn, fordi vi kigger
  // det forkerte sted — ikke fordi produktet opfører sig rigtigt.
  saetIdentitet((await c.cookies()).find((x) => x.name === 'bofinda_aid')?.value ?? null)
  await sql`delete from haendelser`
  // Et gyldigt filter, men et sidetal langt uden for rækkevidde.
  await s.goto(BASE + '/?by=Attrapby&side=99', { waitUntil: 'networkidle' })
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })   // tøm køen
  kraev(await iRo('empty_results') === 0,
    'tomt sideudsnit med træf > 0 giver INGEN empty_results',
    `${await tael('empty_results')} rækker`)
  // Til sammenligning: et ægte nul SKAL give empty_results.
  await sql`delete from haendelser`
  await s.goto(BASE + '/?by=Findesikke', { waitUntil: 'networkidle' })
  await s.goto(BASE + '/', { waitUntil: 'networkidle' })
  kraev(await ventPaa('empty_results', 1) === 1,
    'et ægte nulresultat giver præcis ét empty_results',
    `${await tael('empty_results')} rækker`)
  saetIdentitet(null)
  await c.close()
}

// ═══ 7 · Self-canonical på en GYLDIG side 2 ════════════════════
// Det delte datasæt fylder ikke to sider i ét område. Kontrollen laver
// derfor sine egne rækker med et eget nøglepræfiks og fjerner dem igen —
// den rører aldrig scripts/cloud/saa.mjs' data.
console.log('\n═══ 7 · self-canonical på en gyldig side 2 ═══')
{
  const [kilde] = await sql`select id from sources where slug = 'test-alfa'`
  const noegler = []
  try {
    for (let i = 0; i < 60; i++) {
      const n = `canonical-proeve-${i}`
      noegler.push(n)
      await sql`
        insert into listings (source_id, source_type, external_key, source_url, address_raw,
          street, house_number, postal_code, city, unit_address_uuid, address_match_level,
          property_type, size_m2, rooms, rent_monthly, status, first_seen_at, last_seen_at)
        values (${kilde.id}, 'spider', ${n}, ${'https://eksempel.invalid/' + n},
          ${`Canonicalvej ${i}, 9003 Attrapby`}, ${`Canonicalvej ${i}`}, '1', '9003', 'Attrapby',
          ${'intern:v3:proeve:' + randomUUID()}, 'unit', 'lejlighed', 70, 3, 900000,
          'active', now(), now())`
    }
    const { c } = await kontekst()
    const s = await c.newPage()
    await s.goto(BASE + '/lejeboliger/9003?side=2', { waitUntil: 'networkidle' })
    const can = await s.locator('link[rel="canonical"]').first().getAttribute('href').catch(() => null)
    const rob = await s.locator('meta[name="robots"]').first().getAttribute('content').catch(() => null)
    kraev(can === '/lejeboliger/9003?side=2',
      'gyldig side 2 beholder sin SELF-canonical', can ?? '(ingen)')
    kraev(!rob?.includes('noindex'), 'gyldig side 2 er indekserbar', rob ?? '(ingen robots-meta)')
    await c.close()
  } finally {
    const v = await sql`delete from listings where external_key in ${sql(noegler)}`
    console.log(`     (ryddet ${v.count} midlertidige prøverækker)`)
  }
}

await browser.close()
await sql.end()
console.log(`\n${fejl === 0 ? '✓ ALT GRØNT' : `✗ ${fejl} kontroller fejlede`} — skærmbilleder i ${UD}/\n`)
process.exit(fejl === 0 ? 0 : 1)
