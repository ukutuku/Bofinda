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
      mobil ? { hasTouch: true, isMobile: true } : { hasTouch: true })
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

    // ── Svirp ──────────────────────────────────────────────────
    const kort = s.locator('.kort-hylster:has(.bladrepil)').first()
    await kort.scrollIntoViewIfNeeded()
    const boks = await kort.locator('.kort-billede').boundingBox()
    const t0 = await kort.locator('.kort-antal').innerText()
    const foerUrl = s.url()
    const y = boks.y + boks.height / 2
    // INTET VÆKKE-TRYK. Et tryk på billedet ÅBNER annoncen — det er dét,
    // 3E måler, at det skal. Svirpets eget `touchstart` udløser
    // hentningen, og `gaa()` venter på den, så bladringen sker, når
    // listen lander. Prøven skal derfor bare give den tid.
    // Vandret svirp: fra højre mod venstre = næste.
    await s.evaluate(([x0, x1, yy]) => {
      const el = document.elementFromPoint(x0, yy)
      const lav = (type, cx) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: cx, clientY: yy })],
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: cx, clientY: yy })],
      })
      el.dispatchEvent(lav('touchstart', x0))
      el.dispatchEvent(lav('touchmove', x0 - 20))
      el.dispatchEvent(lav('touchmove', x1))
      el.dispatchEvent(lav('touchend', x1))
      // KOORDINATERNE ER IKKE TILFÆLDIGE. Pilene er 44 px brede og ligger
      // 8 px inde fra hver kant — et svirp, der starter 20 px fra kanten,
      // rammer KNAPPEN, og `elementFromPoint` giver da et element uden
      // for billedfladen. Så hørte håndtereren intet, og prøven meldte
      // «svirpet virker ikke», selv om det gjorde. Der svirpes derfor
      // mellem pilene, som en tommel ville gøre det.
    }, [boks.x + boks.width * 0.75, boks.x + boks.width * 0.25, y])
    await vent(1800)
    tjek(`5 · ${bredde} px: et svirp skifter billede`,
      (await kort.locator('.kort-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.kort-antal').innerText()}`)
    tjek(`5 · ${bredde} px: og åbner IKKE annoncen`, s.url() === foerUrl,
      s.url().replace(BASE, ''))

    // ── Lodret rulning virker stadig ───────────────────────────
    // Et LODRET svirp over billedet må ikke skifte billede, og siden skal
    // stadig kunne rulle. Hjulet måler rulningen; det lodrette svirp
    // måler, at retningslåsen vælger rigtigt.
    const t1 = await kort.locator('.kort-antal').innerText()
    await s.evaluate(([x, yy]) => {
      const el = document.elementFromPoint(x, yy)
      const lav = (type, cy) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [new Touch({ identifier: 2, target: el, clientX: x, clientY: cy })],
        changedTouches: [new Touch({ identifier: 2, target: el, clientX: x, clientY: cy })],
      })
      el.dispatchEvent(lav('touchstart', yy))
      el.dispatchEvent(lav('touchmove', yy - 25))
      el.dispatchEvent(lav('touchmove', yy - 120))
      el.dispatchEvent(lav('touchend', yy - 120))
    }, [boks.x + boks.width / 2, y])
    await vent(900)
    tjek(`5 · ${bredde} px: et LODRET svirp skifter ikke billede`,
      (await kort.locator('.kort-antal').innerText()) === t1,
      `${t1} → ${await kort.locator('.kort-antal').innerText()}`)

    const y0 = await s.evaluate(() => window.scrollY)
    await s.mouse.move(boks.x + boks.width / 2, y)
    await s.mouse.wheel(0, 400)
    await vent(500)
    const y1 = await s.evaluate(() => window.scrollY)
    tjek(`5 · ${bredde} px: siden ruller stadig lodret over billedet`, y1 > y0, `${y0} → ${y1}`)

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
