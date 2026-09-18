// ═══════════════════════════════════════════════════════════════
//  Billedbladring på boligkortene, UDFØRT i en rigtig browser.
//
//  Markup-prøverne i scripts/test-redigering.ts måler, at pilene ligger
//  uden for linket, at tælleren står der, og at ruten svarer med den
//  rigtige boligs billeder. Ingen af dem kan svare på, om et svirp
//  ÅBNER annoncen, om den lodrette rulning stadig virker, om fokus kan
//  ses, eller hvornår billederne faktisk bliver hentet over netværket.
//  Det måles her.
//
//      BOFINDA_APP_BASE=http://127.0.0.1:3100 \
//      DATABASE_URL_DIRECT=… node scripts/cloud/bladrekontrol.mjs [skaermmappe]
//
//  ═══ VÆRNENE ER DE SAMME SOM DE ØVRIGE KONTROLLERS ═══
//
//  Kun loopback, kun den isolerede testbase, og kun den app, miljøet
//  allerede har rejst. Prøven SKRIVER ikke i basen — den læser, hvad
//  `saa.mjs` har sået, og rører ikke en række.
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import postgres from 'postgres'
import { knib, nulstilZoom, svirp, touchsession, tryk, zoom } from './touch.mjs'
import { fokusinfo, scriptetRute } from './fokus.mjs'

const UD = process.argv[2] || null
if (UD) mkdirSync(UD, { recursive: true })
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']

function findChromium() {
  if (process.env.BOFINDA_CHROMIUM) return process.env.BOFINDA_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const bud = [`${rod}/chromium`, `${rod}/chromium/chrome-linux/chrome`]
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      bud.push(`${rod}/${d}/chrome-linux/chrome`)
    }
  } catch { /* videre */ }
  for (const b of bud) { try { if (statSync(b).isFile()) return b } catch { /* naeste */ } }
  console.error('FEJL: ingen Chromium fundet.'); process.exit(1)
}

// ─── Vagt 1: appadressen ───────────────────────────────────────
{
  let u
  try { u = new URL(BASE) } catch { console.error('FEJL: BOFINDA_APP_BASE er ikke en URL.'); process.exit(2) }
  if (!LOOPBACK.includes(u.hostname)) {
    console.error(`FEJL: appen peger paa ${u.hostname} — proeven koerer kun mod loopback.`)
    process.exit(2)
  }
}

// ─── Vagt 2: DATABASE_URL'ens form ─────────────────────────────
const DBURL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(DBURL || 'x://')
  if (!LOOPBACK.includes(u.hostname) || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.'); process.exit(2)
  }
}
const sql = postgres(DBURL, { ssl: false, max: 2, onnotice: () => {} })

// ─── Vagt 3: DEN FAKTISKE FORBINDELSE ──────────────────────────
// Formen på en URL er ikke et bevis — en tunnel kan ende et andet sted.
// Samme greb som `minsidekontrol.mjs`, `app-op.sh` og
// `rooms-repraesentant.ts`; de fire er kopier af ét udtryk, og ændres
// den ene, skal de andre med.
const LOKALE_ADRESSER = new Set(['loopback', '127.0.0.1', '::1'])
const udenPraefiks = (a) => String(a).split('/')[0] ?? String(a)
const erIsoleret = (d, a, p) =>
  d === 'bofinda_test' && Number(p) === 55432 && LOKALE_ADRESSER.has(udenPraefiks(a))

let fejl = 0, groenne = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (ok) groenne++; else fejl++
}
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

let browser
try {
  const [id] = await sql`select current_database() d,
    coalesce(inet_server_addr()::text, 'loopback') a, inet_server_port() p`
  if (!erIsoleret(id.d, id.a, id.p)) {
    console.error(`FEJL: forbundet til ${id.d} paa ${id.a}:${id.p} — ikke testbasen.`)
    await sql.end(); process.exit(2)
  }
  console.log(`\n  · base: ${id.d} paa ${id.a}:${id.p} (efterprøvet)`)

  browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  })

  /**
   * En kontekst med netværksmåling.
   *
   * Billedhentninger tælles pr. adresse. Det er dét, kravet om «efter
   * behov» handler om: hvor mange BILLEDER browseren faktisk henter, og
   * hvornår. Alt uden for loopback afvises — intet forlader maskinen.
   */
  const nyKontekst = async (bredde, hoejde, ekstra = {}) => {
    const c = await browser.newContext({ viewport: { width: bredde, height: hoejde }, ...ekstra })
    const billeder = []
    const lister = []
    let udefra = 0
    await c.route('**/*', async (rute) => {
      const u = new URL(rute.request().url())
      if (!LOOPBACK.includes(u.hostname)) { udefra++; return rute.abort() }
      if (u.pathname === '/api/billede') billeder.push(u.searchParams.get('u') ?? '')
      if (u.pathname === '/api/boligbilleder') lister.push(u.searchParams.get('b') ?? '')
      return rute.continue()
    })
    const p = await c.newPage()
    // Samtykkebanneret ligger oven på og dækker både kort og
    // skærmbilleder. Det afvises på hver side, prøven åbner — valget
    // gemmes i en cookie, og en cookie, der ikke blev sat, ses først,
    // når et kort er dækket på et billede.
    p.afvisBanner = async () => {
      const k = p.getByRole('button', { name: 'Kun det nødvendige' })
      if (await k.count()) { await k.first().click().catch(() => {}); await vent(350) }
    }
    await p.goto(`${BASE}/privatliv`, { waitUntil: 'domcontentloaded' })
    await p.afvisBanner()
    return { c, p, billeder, lister, udefra: () => udefra }
  }

  const SOEG = `${BASE}/?postnr=9001`

  // ═══ 1 · Pilene findes, og kun hvor der er noget at bladre i ═══
  console.log('\n══ 1 · pilene ══')
  const { c: c1, p, billeder, lister, udefra } = await nyKontekst(1440, 1000)
  await p.goto(SOEG, { waitUntil: 'networkidle' })
  await p.afvisBanner()
  await vent(900)

  const grundlag = await p.evaluate(() => {
    const ud = []
    for (const h of document.querySelectorAll('.kort-hylster')) {
      const a = h.querySelector('a.kort')
      const t = h.querySelector('.kort-antal')?.textContent ?? ''
      ud.push({
        id: a?.getAttribute('data-bolig') ?? '',
        gruppe: a?.hasAttribute('data-gruppe') ?? false,
        pile: h.querySelectorAll('.bladrepil').length,
        taeller: t,
        billeder: h.querySelectorAll('.kort-billede img').length,
        udenBillede: a?.classList.contains('uden-billede') ?? false,
      })
    }
    return ud
  })
  const medPile = grundlag.filter((k) => k.pile === 2)
  tjek('1A · der ER kort med bladring at måle på', medPile.length >= 3, `${medPile.length} af ${grundlag.length}`)
  tjek('1B · hvert af dem har PRÆCIS to pile og ét billede',
    medPile.every((k) => k.pile === 2 && k.billeder === 1),
    medPile.map((k) => `${k.pile}/${k.billeder}`).join(' ') || '(ingen)')
  tjek('1C · og en tæller, der starter på billede 1',
    medPile.every((k) => /^1\/(\d+)$/.test(k.taeller) && Number(k.taeller.split('/')[1]) > 1),
    [...new Set(medPile.map((k) => k.taeller))].join(' '))
  // Ét billede: ingen pile. Målt på kortene uden pile — de må ikke have
  // en tæller, der lover mere end ét.
  const udenPile = grundlag.filter((k) => k.pile === 0)
  tjek('1D · der er OGSÅ kort uden bladring — ellers måler 1E intet',
    udenPile.length > 0, `${udenPile.length}`)
  tjek('1E · og ingen af dem har en tæller',
    udenPile.every((k) => k.taeller === ''), udenPile.map((k) => k.taeller).filter(Boolean).join(' '))
  tjek('1F · et kort uden billede har heller ingen pile',
    grundlag.filter((k) => k.udenBillede).every((k) => k.pile === 0))
  tjek('1G · intet forlod maskinen', udefra() === 0, `${udefra()}`)

  // ═══ 2 · Intet hentes før der er behov ═════════════════════════
  console.log('\n══ 2 · ekstra billeder hentes efter behov ══')
  {
    const foerHentede = billeder.length
    const foerLister = lister.length
    tjek('2A · ingen billedlister blev hentet ved sideindlæsning',
      foerLister === 0, `${foerLister} kald`)
    // Der er hentet ÉT billede pr. synligt kort — forsiderne. Havde vi
    // lagt hele billedlisten i HTML'en, ville tallet have været summen
    // af alle kortenes tællere.
    const lovet = grundlag.reduce((a, k) => a + (Number(k.taeller.split('/')[1]) || 0), 0)
    tjek('2B · og langt færre billeder end kortene tilsammen tilbyder',
      foerHentede < lovet, `${foerHentede} hentet, ${lovet} tilbudt`)

    const kort = p.locator('.kort-hylster:has(.bladrepil)').first()
    await kort.scrollIntoViewIfNeeded()
    // MÅLINGEN NULSTILLES EFTER SCROLLET. At rulle kortet frem får
    // nabokortenes dovne forsider til at blive hentet, og de er ikke
    // bladring — de er sideindlæsning, bare senere. Uden nulstillingen
    // talte prøven dem med og sagde «4 billeder, hvoraf 3 er boligens».
    await vent(900)
    const foerKlik = billeder.length
    const boligId = await kort.locator('a.kort').getAttribute('data-bolig')
    await kort.locator('.bladrepil-naeste').click()
    await vent(1200)
    tjek('2C · først ved bladring hentes listen — og kun for DET kort',
      lister.length === 1 && lister[0] === boligId,
      `${lister.length} kald: ${lister.join(', ')}`)
    // Hvor mange billeder ét klik koster. Det viste billede plus de to
    // naboer, der hentes på forhånd, så næste tryk ikke blinker — altså
    // højst tre, og aldrig hele listen for de øvrige kort. Grænsen er
    // MÅLT og ikke gættet: forhåndshentningen er `[nr + 1, nr - 1]` i
    // app/Billedbladring.tsx, og den kører først EFTER første bladring.
    // DER TÆLLES BILLEDER, IKKE KALD.
    // `saa.mjs` sår de samme fire filer på tværs af ALLE boliger, og et
    // nabokort kan have den samme fil som forside. Et kald mere om den
    // samme fil er derfor ikke et billede mere — og et krav om, at
    // «alle annoncers billeder ikke må hentes», handler om hvilke
    // billeder der hentes. Det rå kaldtal står i noten, så en stigning
    // kan ses.
    const nye = [...new Set(billeder.slice(foerKlik))]
    tjek('2D · ét klik koster det viste billede plus naboerne — ikke mere',
      nye.length >= 1 && nye.length <= 3,
      `${nye.length} billeder (${billeder.length - foerKlik} kald)`)
    tjek('2E · tælleren fulgte med til billede 2',
      (await kort.locator('.kort-antal').innerText()).startsWith('2/'),
      await kort.locator('.kort-antal').innerText())

    // Billederne skal tilhøre den rigtige bolig. Målt mod basen, ikke
    // mod kortet: kortet er dét, der prøves.
    const [r] = await sql`select count(distinct external_url)::int n from listing_images
      where listing_id = ${boligId} and external_url = any(${nye})`
    tjek('2F · og hvert af dem står på netop den bolig i basen',
      r.n === nye.length, `${r.n} af ${nye.length}`)
    const [ialt] = await sql`select count(*)::int n from listing_images
      where listing_id = ${boligId}`
    tjek('2F · præmis: boligen har mere end ét billede, så 2F måler noget',
      ialt.n > 1, `${ialt.n} billeder`)
    // Modstykket: ingen ANDEN bolig fik hentet billeder af den bladring.
    // `saa.mjs` sår de samme fire filer på tværs af alle boliger, så
    // adressen alene kan ikke afgøre det — der tælles på, at hver hentet
    // adresse OGSÅ står på den bolig, der blev bladret i.
    tjek('2G · og ingen andre kort hentede noget',
      lister.length === 1, `${lister.length} lister hentet`)
  }

  // ═══ 3 · Pilen åbner ikke annoncen og rører ikke hjertet ═══════
  console.log('\n══ 3 · pile, klik og hjerte gør hver sit ══')
  {
    const foer = p.url()
    const kort = p.locator('.kort-hylster:has(.bladrepil)').nth(1)
    await kort.scrollIntoViewIfNeeded()
    const t0 = await kort.locator('.kort-antal').innerText()
    await kort.locator('.bladrepil-naeste').click()
    await vent(800)
    tjek('3A · et pileklik åbner IKKE annoncen', p.url() === foer, p.url().replace(BASE, ''))
    tjek('3B · men det skifter billede',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    // Hjertet er ikke logget ind her; det er et LINK til Min side. Det
    // afgørende er, at pilen ikke ramte det, og at det stadig kan rammes.
    const hjerte = kort.locator('.favoritknap')
    tjek('3C · hjertet er der endnu og kan rammes',
      await hjerte.count() === 1 && await hjerte.isVisible())
    const boks = await hjerte.boundingBox()
    const pil = await kort.locator('.bladrepil-naeste').boundingBox()
    const overlap = boks && pil
      && boks.x < pil.x + pil.width && pil.x < boks.x + boks.width
      && boks.y < pil.y + pil.height && pil.y < boks.y + boks.height
    tjek('3D · og pilen ligger ikke oven på det', !overlap,
      overlap ? 'PILEN DÆKKER HJERTET' : '')

    // Et almindeligt billedklik SKAL stadig åbne boligen.
    const id = await kort.locator('a.kort').getAttribute('data-bolig')
    await kort.locator('.kort-billede').click({ position: { x: 20, y: 20 } })
    await p.waitForLoadState('networkidle').catch(() => {})
    await vent(900)
    tjek('3E · et almindeligt billedklik åbner boligen',
      p.url().includes(`/bolig/${id}`) || p.url().includes('/gruppe'),
      p.url().replace(BASE, ''))
    await p.goBack({ waitUntil: 'networkidle' }).catch(() => {})
    await vent(700)
  }

  // ═══ 4 · Tastatur og fokus ═════════════════════════════════════
  console.log('\n══ 4 · tastatur, fokus og 44 × 44 ══')
  {
    await p.goto(SOEG, { waitUntil: 'networkidle' })
    await p.afvisBanner()
    await vent(900)
    const kort = p.locator('.kort-hylster:has(.bladrepil)').first()
    await kort.scrollIntoViewIfNeeded()
    const t0 = await kort.locator('.kort-antal').innerText()
    await kort.locator('.bladrepil-naeste').focus()
    const f = await p.evaluate(() => {
      const e = document.activeElement
      const s = e ? getComputedStyle(e) : null
      const r = e?.getBoundingClientRect()
      return {
        klasse: e?.className ?? '', navn: e?.getAttribute('aria-label') ?? '',
        ring: Boolean(s && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0),
        bredde: s?.outlineWidth ?? '', str: r ? [Math.round(r.width), Math.round(r.height)] : null,
      }
    })
    tjek('4A · pilen kan få fokus', f.klasse.includes('bladrepil'), f.klasse)
    tjek('4B · fokus kan SES', f.ring, f.bredde)
    tjek('4C · knappen er mindst 44 × 44 px',
      (f.str?.[0] ?? 0) >= 44 && (f.str?.[1] ?? 0) >= 44, f.str?.join('×') ?? '')
    tjek('4D · og etiketten navngiver boligen', f.navn.length > 20, f.navn)

    await p.keyboard.press('Enter')
    await vent(1200)
    tjek('4E · Enter skifter billede',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    // KERNEN: knappen må ikke slå sig selv fra under trykket. Gør den
    // det, ryger fokus til <body>, og tastaturbrugeren er smidt ud af
    // kortet, netop fordi hun brugte knappen.
    const efter = await p.evaluate(() => document.activeElement?.className ?? '(body)')
    tjek('4F · og fokus BLIVER på pilen', String(efter).includes('bladrepil'), String(efter))
    tjek('4G · Enter åbnede ikke annoncen', !p.url().includes('/bolig/'), p.url().replace(BASE, ''))
    if (UD) await p.screenshot({ path: `${UD}/bladring-fokus-1440.png`, clip: await kort.boundingBox() })
  }
  await c1.close()

  // ═══ 5 · Tre bredder: layout, swipe og lodret rulning ══════════
  console.log('\n══ 5 · 390, 768 og 1440 px ══')
  for (const bredde of [390, 768, 1440]) {
    const mobil = bredde === 390
    const { c, p: s } = await nyKontekst(bredde, mobil ? 844 : 1000,
      // `isMobile` giver mobil-viewporten OG den visuelle viewport, som
      // knib-zoom måles på. `deviceScaleFactor: 2` er en telefons.
      mobil ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { hasTouch: true })
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(1000)

    const m = await s.evaluate(() => {
      const h = [...document.querySelectorAll('.kort-hylster')].find((x) => x.querySelector('.bladrepil'))
      if (!h) return null
      const ramme = h.querySelector('.kort-billede').getBoundingClientRect()
      const pile = [...h.querySelectorAll('.bladrepil')].map((b) => b.getBoundingClientRect())
      return {
        // Pilene skal ligge PÅ billedet — de er søskende til linket og
        // positioneres mod hylsteret, så en forkert aspect-ratio ville
        // lægge dem ved siden af det, de handler om.
        paaBilledet: pile.every((r) =>
          r.top >= ramme.top - 1 && r.bottom <= ramme.bottom + 1
          && r.left >= ramme.left - 1 && r.right <= ramme.right + 1),
        str: pile.map((r) => [Math.round(r.width), Math.round(r.height)]),
        touch: getComputedStyle(h.querySelector('.kort-billede')).touchAction,
        vandret: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })
    tjek(`5 · ${bredde} px: der er et kort med pile at måle på`, m !== null)
    if (m) {
      tjek(`5 · ${bredde} px: pilene ligger på billedet`, m.paaBilledet,
        m.paaBilledet ? '' : 'PILENE ER UDEN FOR BILLEDFELTET')
      tjek(`5 · ${bredde} px: begge er mindst 44 × 44`,
        m.str.every(([w, h2]) => w >= 44 && h2 >= 44), m.str.map((x) => x.join('×')).join(' '))
      tjek(`5 · ${bredde} px: lodret rulning og zoom er browserens`,
        /pan-y/.test(m.touch) && /pinch-zoom/.test(m.touch), m.touch)
      tjek(`5 · ${bredde} px: ingen vandret rulning`, !m.vandret)
    }

    // ── SYNTETISKE HÆNDELSER MÅLER IKKE ET TOUCHFORLØB ─────────
    // Her stod `dispatchEvent(new TouchEvent(…))` og et `mouse.wheel`.
    // Det første er en DOM-hændelse, JavaScript selv laver: den springer
    // træfprøven, `touch-action`, gestus-genkendelsen, rulningen og det
    // syntetiske klik over, så den kan kun vise, at VORES lyttere sidder
    // rigtigt. Det andet er et musehjul og har aldrig været en touchprøve.
    // Nu går alt gennem browserens egen inputkø — se scripts/cloud/touch.mjs.
    const ts = await touchsession(s)
    const kort = s.locator('.kort-hylster:has(.bladrepil)').first()
    await kort.scrollIntoViewIfNeeded()
    await vent(600)
    const boks = await kort.locator('.kort-billede').boundingBox()
    const y = boks.y + boks.height / 2
    const midt = { x: boks.x + boks.width / 2, y }
    const foerUrl = s.url()

    // 1 · Vandret svirp skifter billede uden at åbne annoncen.
    // Der svirpes MELLEM pilene: de er 44 px brede og ligger 8 px inde
    // fra hver kant, så et svirp, der starter ved kanten, ville lande på
    // en knap — som en tommel også ville.
    const t0 = await kort.locator('.kort-antal').innerText()
    await svirp(ts, { x: boks.x + boks.width * 0.78, y }, { x: boks.x + boks.width * 0.22, y })
    await vent(1800)
    tjek(`5 · ${bredde} px: vandret swipe (rigtigt touch) skifter billede`,
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    tjek(`5 · ${bredde} px: og åbner IKKE annoncen`, s.url() === foerUrl,
      s.url().replace(BASE, ''))

    // 2 · Lodret fingerbevægelse over billedet ruller siden — og skifter
    //     ikke billede. Det er retningslåsen OG `touch-action: pan-y`,
    //     der prøves her, og kun rigtigt touchinput kan vise begge dele:
    //     en syntetisk hændelse ruller ingenting.
    const t1 = await kort.locator('.kort-antal').innerText()
    const y0 = await s.evaluate(() => window.scrollY)
    await svirp(ts, { x: midt.x, y: y + 60 }, { x: midt.x, y: y - 120 })
    await vent(900)
    const y1 = await s.evaluate(() => window.scrollY)
    tjek(`5 · ${bredde} px: lodret fingerbevægelse RULLER siden`, y1 > y0, `${y0} → ${y1}`)
    tjek(`5 · ${bredde} px: og skifter ikke billede`,
      (await kort.locator('.kort-antal').innerText()) === t1,
      `${t1} → ${await kort.locator('.kort-antal').innerText()}`)

    // 3 · Knib-zoom er bevaret. `touch-action: pan-y pinch-zoom` er
    //     erklæringen; det her er målingen af, at browseren faktisk gør
    //     det. Zoomen sættes tilbage bagefter, så de næste målinger
    //     starter et kendt sted.
    await s.evaluate(() => window.scrollTo(0, 0))
    await vent(400)
    const kortEfterRul = await kort.locator('.kort-billede').boundingBox()
    const knibMidt = kortEfterRul
      ? { x: kortEfterRul.x + kortEfterRul.width / 2, y: kortEfterRul.y + kortEfterRul.height / 2 }
      : midt
    const zoomFoer = await zoom(s)
    await knib(ts, knibMidt)
    await vent(800)
    const zoomEfter = await zoom(s)
    tjek(`5 · ${bredde} px: knib-zoom er bevaret`, zoomEfter > zoomFoer * 1.3,
      `${zoomFoer.toFixed(2)} → ${zoomEfter.toFixed(2)}`)
    await nulstilZoom(ts, knibMidt)

    // 4 · Et almindeligt tryk åbner det rigtige mål. Gruppekort peger på
    //     /gruppe, enkeltkort på /bolig/<id> — begge dele er rigtigt, og
    //     prøven læser kortets eget link frem for at gætte.
    await s.evaluate(() => window.scrollTo(0, 0))
    await vent(500)
    const maal = await kort.locator('a.kort').getAttribute('href')
    const trykBoks = await kort.locator('.kort-billede').boundingBox()
    await tryk(ts, trykBoks.x + trykBoks.width * 0.5, trykBoks.y + trykBoks.height * 0.8)
    await s.waitForLoadState('networkidle').catch(() => {})
    await vent(1200)
    tjek(`5 · ${bredde} px: et almindeligt tryk åbner det rigtige mål`,
      s.url().endsWith(maal) || s.url().includes(maal.split('?')[0]),
      `${s.url().replace(BASE, '')} · ventet ${maal}`)
    await s.goBack({ waitUntil: 'networkidle' }).catch(() => {})
    await s.afvisBanner()
    await vent(700)

    if (UD) {
      await s.evaluate(() => window.scrollTo(0, 0))
      await vent(300)
      await s.screenshot({ path: `${UD}/bladring-${bredde}.png`, fullPage: false })
    }
    await c.close()
  }

  // ═══ 6 · Søgefiltre, sideplacering og gruppekort ═══════════════
  console.log('\n══ 6 · filtre, sideplacering og gruppekort ══')
  {
    const { c, p: s, lister: l6 } = await nyKontekst(1440, 1000)
    // Parameternavnene er sidens egne — `vaerelser`, ikke `vaerelserMin`.
    // Se `filtreFraParametre` i lib/soeg.ts. Og der filtreres IKKE på
    // postnummer her: 9001 har ikke 48 boliger, så `side=2` ville være
    // tom, og prøven ville måle på ingenting.
    const MED_FILTER = `${BASE}/?vaerelser=2&side=2`
    await s.goto(MED_FILTER, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const kort = s.locator('.kort-hylster:has(.bladrepil)').first()
    const harKort = await kort.count() > 0
    tjek('6A · der er et kort med bladring på side 2 med filtre', harKort,
      harKort ? '' : `${await s.locator('.kort-hylster').count()} kort i alt på siden`)
    // Præmissen: vi er FAKTISK på side 2 med et filter. Uden den kunne
    // 6B bestå på side 1 uden filtre, hvor der ikke er noget at bevare.
    tjek('6A · og siden er side 2 med filteret i adressen',
      s.url().includes('side=2') && s.url().includes('vaerelser=2'), s.url().replace(BASE, ''))
    if (harKort) {
      await kort.scrollIntoViewIfNeeded()
      await kort.locator('.bladrepil-naeste').click()
      await vent(1100)
      tjek('6B · bladring ændrer ikke adressen — filtre og side står fast',
        s.url() === MED_FILTER, s.url().replace(BASE, ''))
    }

    // Gruppekortet: listen hentes for REPRÆSENTANTEN, og kun for ham.
    await s.goto(`${BASE}/?postnr=9002`, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const gruppe = s.locator('.kort-hylster:has(a.kort[data-gruppe]):has(.bladrepil)').first()
    const harGruppe = await gruppe.count() > 0
    tjek('6C · der er et gruppekort med bladring', harGruppe)
    if (harGruppe) {
      await gruppe.scrollIntoViewIfNeeded()
      const rep = await gruppe.locator('a.kort').getAttribute('data-bolig')
      const foer = l6.length
      await gruppe.locator('.bladrepil-naeste').click()
      await vent(1200)
      const bedt = l6.slice(foer)
      tjek('6D · gruppekortet henter KUN repræsentantens billeder',
        bedt.length === 1 && bedt[0] === rep, `bad om: ${bedt.join(', ')} · repræsentant: ${rep}`)
      // Og basen skal være enig i, at det er repræsentantens billeder.
      const [g] = await sql`select count(*)::int n from listing_images where listing_id = ${rep}`
      tjek('6E · og repræsentanten har faktisk de billeder i basen', g.n > 1, `${g.n}`)
    }
    await c.close()
  }

  // ═══ 7 · Når listen ikke kan hentes ════════════════════════════
  //
  // Ruten kan svare nej. Før blev kortet lukket for resten af sin
  // levetid, mens pile og tæller blev stående og lovede otte billeder —
  // en knap, der ikke virker, er værre end ingen knap.
  console.log('\n══ 7 · fejl, besked og prøv igen ══')
  {
    // Det FØRSTE kald fejler, resten går igennem. Ruten afvises i
    // browseren, så appen og basen er urørte.
    let kald = 0
    const { c, p: s } = await nyKontekst(1440, 1000)
    await s.route('**/api/boligbilleder*', (rute) => {
      kald++
      return kald === 1 ? rute.fulfill({ status: 503, body: 'nej' }) : rute.continue()
    })
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const kort = s.locator('.kort-hylster:has(.bladrepil)').first()
    await kort.scrollIntoViewIfNeeded()
    await vent(600)

    const url0 = s.url()
    const t0 = await kort.locator('.kort-antal').innerText()
    // Favoritten skal være upåvirket hele vejen. Uden login er hjertet
    // et LINK til Min side; det er dets adresse og tilstand, der måles.
    const hjerteFoer = await kort.locator('.favoritknap').getAttribute('href')
      ?? await kort.locator('.favoritknap').getAttribute('aria-pressed')

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('7A · en fejlet hentning siger det — diskret og på kortet',
      await kort.locator('.bladrefejl').count() === 1)
    tjek('7B · og der er en udtrykkelig vej til at prøve igen',
      await kort.locator('.bladreigen').count() === 1)
    tjek('7C · billedet står stadig, og annoncen blev ikke åbnet',
      s.url() === url0 && (await kort.locator('.kort-billede img').count()) === 1,
      s.url().replace(BASE, ''))
    tjek('7D · der prøves IKKE igen af sig selv', kald === 1, `${kald} kald`)
    // Et sekund mere uden at nogen rører noget: stadig ét kald.
    await vent(1500)
    tjek('7E · heller ikke efter halvanden sekund', kald === 1, `${kald} kald`)

    // Knappen er en handling som alle andre i projektet.
    const knap = await kort.locator('.bladreigen').boundingBox()
    tjek('7F · «Prøv igen» er mindst 44 px høj', (knap?.height ?? 0) >= 44,
      `${Math.round(knap?.width ?? 0)}×${Math.round(knap?.height ?? 0)}`)
    if (UD) await kort.screenshot({ path: `${UD}/bladring-fejl-og-proev-igen.png` })

    await kort.locator('.bladreigen').click()
    await vent(1600)
    tjek('7G · det brugerinitierede forsøg lykkes', kald === 2, `${kald} kald`)
    tjek('7H · og beskeden forsvinder igen',
      await kort.locator('.bladrefejl').count() === 0)

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('7I · derefter kan kortet bladre',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    tjek('7J · uden at åbne annoncen', s.url() === url0, s.url().replace(BASE, ''))
    const hjerteEfter = await kort.locator('.favoritknap').getAttribute('href')
      ?? await kort.locator('.favoritknap').getAttribute('aria-pressed')
    tjek('7K · og favoritten er urørt', hjerteEfter === hjerteFoer,
      `${hjerteFoer} → ${hjerteEfter}`)
    await c.close()
  }

  // ═══ 8 · Et svar med nul eller ét billede ══════════════════════
  //
  // SQL-tallet på kortet kan være forældet. Svarer ruten med ét billede,
  // er det ikke en fejl — og så skal tælleren og pilene holde op med at
  // love mere i stedet for at blive stående.
  console.log('\n══ 8 · ruten svarer «der er ikke mere» ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000)
    await s.route('**/api/boligbilleder*', (rute) =>
      rute.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ billeder: [{ lille: '/api/billede?x', stor: null }] }) }))
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    // KORTET PINDES TIL SIN EGEN ID, ikke til «det første med pile».
    // Playwright genopløser en locator ved hver brug, og dét er præcis
    // det, prøven her måler væk: når pilene forsvinder fra kortet,
    // holder `:has(.bladrepil)` op med at matche det, og `.first()`
    // ville pege videre på NÆSTE kort — som selvfølgelig har to pile.
    // Så ville en rigtig rettelse blive målt som en fejl.
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    tjek('8A · præmis: kortet lovede flere, før ruten svarede',
      /^1\/[2-9]/.test(await kort.locator('.kort-antal').innerText()),
      await kort.locator('.kort-antal').innerText())
    await kort.locator('.bladrepil-naeste').click()
    await vent(1500)
    tjek('8B · pilene forsvinder fra DET kort', await kort.locator('.bladrepil').count() === 0,
      `${await kort.locator('.bladrepil').count()} pile · ${id}`)
    tjek('8C · og tælleren lover ikke længere flere',
      await kort.locator('.kort-antal').count() === 0)
    tjek('8D · det er IKKE en fejlbesked — ruten svarede jo',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('8E · forsiden står der endnu',
      await kort.locator('.kort-billede img').count() === 1)
    // Klikket gav pilen fokus (Chromium fokuserer en <button> på
    // mousedown), og et øjeblik efter fandtes pilen ikke længere. Uden
    // en overdragelse står brugeren på <body> — uden for kortet, netop
    // fordi hun brugte det. Der er ingen fejl i det her forløb: ruten
    // svarede pænt. Det er derfor, fejlbeskedens knap ikke kan være det
    // eneste, fokusvagten spørger efter.
    const f8 = await fokusinfo(s)
    tjek('8F · fokus faldt ikke til <body>, da pilen forsvandt under den',
      f8.klasse !== '(body)', f8.klasse)
    tjek('8G · den gik til kortets egen indgang',
      f8.klasse.split(' ')[0] === 'kort' && f8.kort === id, `${f8.klasse} · ${f8.kort}`)
    await c.close()
  }

  // ═══ 9 · Tastaturforløbet efter en fejl ═══════════════════════
  //
  // ═══ HVORFOR DET HER AFSNIT FINDES ═══
  //
  // To ting kunne starte et genforsøg, uden at nogen havde bedt om det:
  // fokus og en berøring. Og beskeden — og dermed knappen — blev ryddet
  // i det øjeblik, hentningen gik af sted, så «Prøv igen» forsvandt
  // under den finger, der lige havde trykket på den. Fokus faldt til
  // <body>, og et nyt Enter ramte ingenting.
  //
  // Begge dele måles her, på det forløb, en tastaturbruger faktisk går
  // igennem. Svaret er FORSINKET med vilje: uden en ventetid er der
  // intet vindue at aflæse fokus i, mens hentningen er undervejs, og
  // så ville prøven kun kunne se et resultat, aldrig et forløb.
  console.log('\n══ 9 · tastatur: fejl, Tab, Enter og fokus ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000, { hasTouch: true })
    const r = await scriptetRute(s, ['fejl', 'ok'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)

    const url0 = s.url()
    const hjerteFoer = await kort.locator('.favoritknap').getAttribute('href')
      ?? await kort.locator('.favoritknap').getAttribute('aria-pressed')

    // Fejlen fremkaldes med et pileklik — en bladringshandling, ikke en
    // hensigt. Det er den vej, en bruger rammer den på.
    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('9A · præmis: hentningen fejlede, og beskeden står',
      await kort.locator('.bladrefejl').count() === 1 && await kort.locator('.bladreigen').count() === 1)
    tjek('9B · præmis: ét kald er brugt', r.kald === 1, `${r.kald} kald`)

    // ── TAB IND I KORTET MÅ IKKE PRØVE IGEN ────────────────────
    // På søgekortet ligger pilene UDEN FOR linket, så fokus i dem bobler
    // ikke ind i billedfladen — vagten er derfor ikke det eneste, der
    // holder her. Prøven står alligevel: den er den regression, der
    // fanger det, hvis pilene en dag flyttes ind i fladen, sådan som de
    // ligger på Gemte boliger. DÉR er vagten det eneste værn, og dét
    // måles i minsidekontrol 3F.
    await kort.locator('a.kort').focus()
    const stop = []
    for (let i = 0; i < 3; i++) {
      await s.keyboard.press('Tab')
      await vent(250)
      stop.push((await fokusinfo(s)).klasse)
    }
    tjek('9C · Tab går fra kortet gennem «Prøv igen» og begge pile',
      stop.join(' → ') === 'bladreigen → bladrepil bladrepil-foer → bladrepil bladrepil-naeste',
      stop.join(' → '))
    // NAVNET SIGER, HVAD DEN MÅLER. Den måler IKKE vagten i `hent()`:
    // på søgekortet ligger pilene uden for billedfladen, så fokus i dem
    // når aldrig lytteren, og kontrollen er grøn med og uden vagten.
    // Vagtens eneste værn på DENNE flade er 9E nedenfor (berøring);
    // fokusvejen kan kun måles på Gemte boliger — minsidekontrol 3F.
    tjek('9D · Tab rører ikke netværket — pilene ligger uden for billedfladen',
      r.kald === 1, `${r.kald} kald`)

    // ── EN ALMINDELIG BERØRING MÅ HELLER IKKE ──────────────────
    // Her er vagten det eneste værn: `onTouchStart` ligger PÅ
    // billedfladen, og en finger på billedet rammer den hver gang.
    // Bevægelsen er lodret, så den ruller siden i stedet for at blive et
    // svirp — et svirp ER en bladringshandling og må gerne prøve igen.
    const ts = await touchsession(s)
    const boks = await kort.locator('.kort-billede').boundingBox()
    const my = boks.y + boks.height / 2
    await svirp(ts, { x: boks.x + boks.width / 2, y: my + 50 }, { x: boks.x + boks.width / 2, y: my - 90 })
    await vent(900)
    tjek('9E · en lodret fingerbevægelse over billedet prøver ikke igen',
      r.kald === 1, `${r.kald} kald`)
    tjek('9F · og beskeden står der endnu',
      await kort.locator('.bladrefejl').count() === 1)

    // ── ENTER PÅ KNAPPEN ER DET, DER PRØVER IGEN ───────────────
    await s.evaluate(() => window.scrollTo(0, 0))
    await kort.scrollIntoViewIfNeeded()
    await vent(400)
    await kort.locator('.bladreigen').focus()
    const foerTryk = await fokusinfo(s)
    tjek('9G · præmis: fokus står på «Prøv igen»', foerTryk.klasse === 'bladreigen', foerTryk.klasse)
    await s.keyboard.press('Enter')
    await vent(350)
    tjek('9H · Enter starter genforsøget', r.kald === 2, `${r.kald} kald`)

    // MIDT I HENTNINGEN. Ruten holder svaret tilbage, så det her er et
    // rigtigt øjebliksbillede af forløbet — ikke af resultatet.
    const under = await fokusinfo(s)
    tjek('9I · knappen står der stadig, mens der hentes',
      await kort.locator('.bladreigen').count() === 1)
    tjek('9J · og den har stadig fokus — på DET kort',
      under.klasse === 'bladreigen' && under.kort === id,
      `${under.klasse} · ${under.kort}`)
    tjek('9K · og den siger, at den er i gang', under.busy === 'true', String(under.busy))
    // HJÆLPEMIDLET FÅR DET OGSÅ AT VIDE. Live-området står altid, så
    // teksten kan skifte i et område, der allerede fandtes — et område,
    // der indsættes sammen med sin tekst, bliver typisk ikke annonceret.
    tjek('9K · og live-området siger, at der prøves igen',
      (await kort.locator('.bladrepile [role="status"]').innerText()).trim() === 'Prøver igen …',
      (await kort.locator('.bladrepile [role="status"]').innerText()).trim() || '(tomt)')

    // ── SVARET LANDER ──────────────────────────────────────────
    await vent(2200)
    tjek('9L · beskeden forsvinder, når hentningen lykkes',
      await kort.locator('.bladrefejl').count() === 0)
    const efter = await fokusinfo(s)
    tjek('9M · og fokus er ført til næste-pilen på samme kort',
      efter.klasse === 'bladrepil bladrepil-naeste' && efter.kort === id,
      `${efter.klasse} · ${efter.kort}`)
    tjek('9N · fokus faldt altså ALDRIG til <body>', efter.klasse !== '(body)', efter.klasse)
    // Og derfra virker tastaturet: ét Enter mere viser billede 2.
    const t0 = await kort.locator('.kort-antal').innerText()
    await s.keyboard.press('Enter')
    await vent(900)
    tjek('9O · og et tryk mere bladrer',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    tjek('9P · annoncen blev aldrig åbnet', s.url() === url0, s.url().replace(BASE, ''))
    const hjerteEfter = await kort.locator('.favoritknap').getAttribute('href')
      ?? await kort.locator('.favoritknap').getAttribute('aria-pressed')
    tjek('9Q · og favoritten er urørt', hjerteEfter === hjerteFoer, `${hjerteFoer} → ${hjerteEfter}`)
    if (UD) await kort.screenshot({ path: `${UD}/bladring-fokus-under-genforsoeg.png` })
    await c.close()
  }

  // ═══ 10 · Endnu en fejl, og fokus der IKKE skal flyttes ════════
  console.log('\n══ 10 · anden fejl, Mellemrum, og intet fokustyveri ══')
  {
    // Tre kald: fejl, fejl, ok. Første fejl sætter tilstanden, anden
    // fejl er den, kravet handler om — kan hun prøve igen med
    // tastaturet, når forsøget også fejlede?
    const { c, p: s } = await nyKontekst(1440, 1000)
    const r = await scriptetRute(s, ['fejl', 'fejl', 'ok'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const url0 = s.url()

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('10A · præmis: første hentning fejlede', r.kald === 1 &&
      await kort.locator('.bladreigen').count() === 1, `${r.kald} kald`)

    await kort.locator('.bladreigen').focus()
    await s.keyboard.press('Space')
    await vent(350)
    tjek('10B · Mellemrum prøver også igen', r.kald === 2, `${r.kald} kald`)
    // To hurtige tryk må ikke blive til to hentninger. Vagten er den
    // samme `igang`-ref som før rettelsen.
    await s.keyboard.press('Space')
    await s.keyboard.press('Enter')
    await vent(400)
    tjek('10C · og to tryk mere under hentningen bliver ikke til flere kald',
      r.kald === 2, `${r.kald} kald`)

    await vent(2200)
    tjek('10D · forsøget fejlede igen, og beskeden står stadig',
      await kort.locator('.bladrefejl').count() === 1)
    const efterAndenFejl = await fokusinfo(s)
    tjek('10E · fokus er stadig på knappen — hun blev ikke smidt ud',
      efterAndenFejl.klasse === 'bladreigen' && efterAndenFejl.kort === id,
      `${efterAndenFejl.klasse} · ${efterAndenFejl.kort}`)
    tjek('10F · og knappen er ikke længere «i gang»',
      efterAndenFejl.busy !== 'true', String(efterAndenFejl.busy))
    // ANDEN fejl skal også annonceres. Var beskeden selv live-området,
    // ville teksten være uændret fra første fejl — og et uændret
    // live-område siger ingenting. Fordi området sagde «Prøver igen …»
    // undervejs, ER der en ændring at annoncere nu.
    tjek('10F · og live-området siger fejlen igen — ikke «prøver igen»',
      (await kort.locator('.bladrepile [role="status"]').innerText()).trim()
        === 'Billederne kunne ikke hentes',
      (await kort.locator('.bladrepile [role="status"]').innerText()).trim() || '(tomt)')

    // ── DET TREDJE FORSØG: HUN GÅR SELV VIDERE ─────────────────
    // Fokus må ikke springe tilbage, fordi et svar tilfældigvis lander.
    // Det sted, hun selv har valgt, er hendes.
    await s.keyboard.press('Enter')
    await vent(300)
    tjek('10G · tredje forsøg går af sted', r.kald === 3, `${r.kald} kald`)
    // BAGLÆNS, ikke fremad. Går hun til næste-pilen, står hun præcis
    // dér, hvor en fokustyveri-fejl ville flytte hende hen — og så kan
    // prøven ikke længere fejle, uanset hvad koden gør. Målet skal være
    // et element, kodens fokusflytning ALDRIG kunne vælge.
    await s.keyboard.press('Shift+Tab')
    await vent(200)
    const valgt = await fokusinfo(s)
    tjek('10H · præmis: hun står nu et sted, koden aldrig ville vælge',
      valgt.klasse.split(' ')[0] === 'kort', valgt.klasse)
    await vent(2400)
    const tilSidst = await fokusinfo(s)
    tjek('10I · svaret landede, og fokus blev IKKE flyttet fra hende',
      tilSidst.klasse === valgt.klasse && tilSidst.kort === valgt.kort,
      `${valgt.klasse} → ${tilSidst.klasse}`)
    tjek('10J · beskeden er væk, for hentningen lykkedes',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('10K · annoncen blev aldrig åbnet', s.url() === url0, s.url().replace(BASE, ''))
    await c.close()
  }

  // ═══ 11 · Når hele feltet forsvinder ved et lykket genforsøg ═══
  //
  // Genforsøget lykkes, men ruten svarer, at der alligevel kun er ét
  // billede: SQL-tallet på kortet var forældet. Så forsvinder beskeden,
  // pilene OG tælleren på én gang — næste-pilen, det normale mål for
  // fokus, er væk sammen med resten. Fokus skal et sted hen, der bliver
  // stående, og på søgekortet er det kortets eget link.
  console.log('\n══ 11 · fokus når pilene også forsvinder ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000)
    const r = await scriptetRute(s, ['fejl', 'tom'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const url0 = s.url()

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('11A · præmis: første hentning fejlede', r.kald === 1 &&
      await kort.locator('.bladreigen').count() === 1, `${r.kald} kald`)
    await kort.locator('.bladreigen').focus()
    await s.keyboard.press('Enter')
    await vent(2400)
    tjek('11B · hele bladringen forsvandt — ruten sagde jo, der ikke er mere',
      await kort.locator('.bladrepil').count() === 0
      && await kort.locator('.kort-antal').count() === 0
      && await kort.locator('.bladrefejl').count() === 0)
    const efter = await fokusinfo(s)
    tjek('11C · og fokus faldt ikke til <body>', efter.klasse !== '(body)', efter.klasse)
    tjek('11D · den gik til kortets egen indgang', efter.klasse.split(' ')[0] === 'kort'
      && efter.kort === id, `${efter.klasse} · ${efter.kort}`)
    tjek('11E · annoncen blev ikke åbnet', s.url() === url0, s.url().replace(BASE, ''))
    await c.close()
  }

  // ═══ 12 · Hentningen, der aldrig svarer ═══════════════════════
  //
  // Forbindelsen tages imod, og der kommer aldrig noget. Uden en
  // tidsgrænse bliver det hverken et svar eller en fejl: `.catch` fyrer
  // ikke, `igang` bliver stående, og hvert tryk på «Prøv igen» slugt af
  // samtidighedsvagten. Knappen står med fokus og `aria-busy` og gør
  // ingenting — den knap, der ikke virker, brugt i nødsituationen.
  console.log('\n══ 12 · et kald, der aldrig svarer ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000)
    const r = await scriptetRute(s, ['haeng', 'ok'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const url0 = s.url()

    await kort.locator('.bladrepil-naeste').click()
    await vent(1500)
    tjek('12A · præmis: kaldet er gået af sted og hænger', r.kald === 1, `${r.kald} kald`)
    tjek('12B · og der er endnu hverken besked eller svar',
      await kort.locator('.bladrefejl').count() === 0)

    // Tidsgrænsen er 20 sekunder (HENTEFRIST). Her ventes der længere
    // end det — prøven må ikke kunne bestå, fordi den kiggede for
    // tidligt, og 12B ovenfor viser, at den heller ikke bestod for sent.
    await vent(21000)
    tjek('12C · efter tidsgrænsen er det blevet til en almindelig fejl',
      await kort.locator('.bladrefejl').count() === 1)
    tjek('12D · og knappen er ikke «i gang» længere',
      await kort.locator('.bladreigen').getAttribute('aria-busy') === null,
      String(await kort.locator('.bladreigen').getAttribute('aria-busy')))

    // Og så virker den igen — det er hele pointen med grænsen.
    await kort.locator('.bladreigen').focus()
    await s.keyboard.press('Enter')
    await vent(2400)
    tjek('12E · et nyt forsøg går af sted og lykkes', r.kald === 2, `${r.kald} kald`)
    tjek('12F · beskeden er væk', await kort.locator('.bladrefejl').count() === 0)
    const f12 = await fokusinfo(s)
    tjek('12G · og fokus blev ført videre, ikke tabt',
      f12.klasse === 'bladrepil bladrepil-naeste' && f12.kort === id,
      `${f12.klasse} · ${f12.kort}`)
    tjek('12H · annoncen blev ikke åbnet', s.url() === url0, s.url().replace(BASE, ''))
    await c.close()
  }

  // ═══ 13 · Et langsomt svar er ikke en fejl ════════════════════
  //
  // `HENTEFRIST` afbryder en hentning, der hænger. Grænsen skelner ikke
  // af sig selv mellem «svarer aldrig» og «er langsom», så her måles
  // den anden side: et svar, der er længe undervejs, men kommer, skal
  // stadig blive til billeder — ikke til «Billederne kunne ikke hentes».
  console.log('\n══ 13 · et langsomt svar er ikke en fejl ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000)
    const r = await scriptetRute(s, ['langsom'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const t0 = await kort.locator('.kort-antal').innerText()
    await kort.locator('.bladrepil-naeste').click()
    await vent(2000)
    tjek('13A · præmis: svaret er stadig undervejs efter to sekunder',
      r.kald === 1 && await kort.locator('.bladrefejl').count() === 0, `${r.kald} kald`)
    await vent(6000)
    tjek('13B · det langsomme svar blev til billeder, ikke til en fejl',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('13C · og kortet bladrede',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    await c.close()
  }

  // ═══ 14 · Den ANDEN vej tilbage: en bladringshandling ═════════
  //
  // Krav 1 nævner to veje ud af fejltilstanden — «Prøv igen» ELLER en
  // bladringshandling. Afsnit 7, 9, 10 og 12 bruger alle knappen. Her
  // røres knappen slet ikke.
  console.log('\n══ 14 · et pileklik prøver også igen ══')
  {
    const { c, p: s } = await nyKontekst(1440, 1000)
    const r = await scriptetRute(s, ['fejl', 'ok'])
    await s.goto(SOEG, { waitUntil: 'networkidle' })
    await s.afvisBanner()
    await vent(900)
    const id = await s.locator('.kort-hylster:has(.bladrepil) a.kort').first().getAttribute('id')
    const kort = s.locator(`.kort-hylster:has(a.kort[id="${id}"])`)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const url0 = s.url()
    const t0 = await kort.locator('.kort-antal').innerText()

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('14A · præmis: hentningen fejlede, og beskeden står', r.kald === 1
      && await kort.locator('.bladrefejl').count() === 1, `${r.kald} kald`)
    await kort.locator('.bladrepil-naeste').click()
    await vent(2600)
    tjek('14B · et pileklik prøver igen — uden at «Prøv igen» blev rørt',
      r.kald === 2, `${r.kald} kald`)
    tjek('14C · og beskeden forsvandt, fordi det lykkedes',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('14D · og kortet bladrede',
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    tjek('14E · annoncen blev ikke åbnet', s.url() === url0, s.url().replace(BASE, ''))
    await c.close()
  }

} catch (e) {
  console.log(`\n  ✗ PRØVEN BRØD SAMMEN — ${e.message}`)
  fejl++
} finally {
  try { await browser?.close() } catch { /* lukket */ }
  await sql.end()
}

console.log(fejl === 0
  ? `\n  ALT GRØNT — ${groenne} kontroller\n`
  : `\n  ${fejl} FEJLEDE af ${groenne + fejl} kontroller\n`)
process.exit(fejl ? 1 : 0)
