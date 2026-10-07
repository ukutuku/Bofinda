// ═══════════════════════════════════════════════════════════════
//  Kontrol af de kompakte boligkort og bladringen i deres billeder.
//
//  Måler i en rigtig browser det, kortstramningen lover:
//
//    [K1]  den fjernede metadata står IKKE på fronten — adresse, by,
//          overtagelse, aconto-boks, el/varme/vand-poster, kilde,
//          «Se de N adresser», indflytning
//    [K2]  én titel og én prislinje pr. kort; titlen højst to linjer;
//          prislinjen siger «til udlejer» eller «husleje» i SAMME linje
//    [K3]  kortene i en række er lige høje, og prislinjen står samme sted
//    [K4]  ingen døde pile: pile og tæller kun ved ≥ 2 billeder — talt i
//          basen, ikke i DOM'en — og tælleren siger basens tal
//    [K5]  bladringen viser basens billeder i basens rækkefølge, rundt
//    [K6]  et klik på en pil — med MUSEN, på pilens plads — åbner ikke
//          annoncen og rører ikke historikken
//    [K7]  et klik på resten af kortet åbner annoncen; et gruppekort
//          åbner gruppesiden, og dér står de fulde kort med adresse
//    [K8]  tastaturet: Tab når pilene, de har et navn, en synlig ring,
//          og Enter blader uden at navigere
//    [K9]  swipe på 390 px blader, navigerer ikke, og klikket bagefter
//          sluges
//    [K10] lazy-loading: kun forsidebilledet må være eager, ingen
//          billedliste hentes ved sidevisning, og ved 390 px er ikke alle
//          billeder hentet, før der rulles
//    [K11] interaktion henter listen ÉN gang og kun naboerne
//    [K12] intet vandret overløb
//
//  Hver røde linje bærer sit [K…]-mærke, så en modprøve kan kræve, at
//  det var DETTE værn, der fangede den (`rød-af-en-anden-grund`).
//
//  Kører KUN mod det isolerede testmiljø. Basen åbnes gennem
//  isoleret.mjs og læses kun — scriptet skriver intet.
//
//  Brug:  node scripts/cloud/kortkarusel.mjs [mappe-til-skærmbilleder]
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { aabnIsoleretEllerStop } from './isoleret.mjs'

const APP = process.env.BOFINDA_APP ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(APP)) {
  console.error(`FEJL: BOFINDA_APP skal være loopback, ikke ${APP}`)
  process.exit(1)
}
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })

const SIDER = [['forside', '/'], ['soegning', '/?sted=9001']]
const BREDDER = [1440, 768, 390]

let fejl = 0
let kørte = 0
const prøve = (mærke, ok, tekst, detalje = '') => {
  kørte++
  if (!ok) fejl++
  console.log(`${ok ? '  ✓' : '  ✗'} [${mærke}] ${tekst}${detalje ? ` — ${detalje}` : ''}`)
}
/** En løkke over en tom liste måler ingenting. Kræv, at der VAR noget. */
const præmis = (ok, tekst) => {
  kørte++
  if (!ok) fejl++
  console.log(`${ok ? '  ✓' : '  ✗'} [præmis] ${tekst}`)
}

// ── Basen: hvor mange billeder har hver bolig, og i hvilken orden? ──
const sql = await aabnIsoleretEllerStop()
const billedrækker = await sql`
  select i.listing_id::text as id, i.external_url as url
  from listing_images i join listings l on l.id = i.listing_id
  where l.status = 'active'
  order by i.listing_id, i.position`
await sql.end()
const billederFor = new Map()
for (const r of billedrækker) {
  if (!billederFor.has(r.id)) billederFor.set(r.id, [])
  billederFor.get(r.id).push(r.url)
}
const antalFor = (id) => billederFor.get(id)?.length ?? 0

// Det, der IKKE må stå på fronten. Klasserne er det fulde korts egne —
// kommer en af dem tilbage på listen, er den fjernede række kommet
// tilbage. Teksten fanger den samme række, hvis den kommer under et
// andet klassenavn.
const FORBUDT_KLASSE = '.adresse, .kort-meta, .kilder, .m-kilde, .ukendt, .el, .poster, '
  + '.total, .oekonomi-linje, .kort-indflytning, .kort-fod, .afvig, .kort-titel, .kort-antal'
const FORBUDT_TEKST = [
  [/\b\d{4} [A-ZÆØÅ]/, 'postnummer og by'],
  [/overtag|ledig nu|ledigdato/i, 'overtagelse'],
  [/Udlejer oplyser ikke aconto|spørg om varme/, 'aconto-boksen'],
  [/husleje \+|varme \+|\+ vand|\+ el\b/, 'aconto-posterne'],
  [/Se (de|alle) \d+ adresser/, '«Se de N adresser»'],
  [/indflytning/i, 'indflytning'],
]

/** Den signerede billed-URL tilbage til kildens URL. */
const kildeUrl = (src) => {
  try { return new URL(src, APP).searchParams.get('u') } catch { return null }
}

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

async function nySide(bredde) {
  const mobil = bredde < 700
  const ctx = await br.newContext({
    viewport: { width: bredde, height: mobil ? 844 : 1000 },
    deviceScaleFactor: 1, isMobile: mobil, hasTouch: mobil,
  })
  await ctx.addCookies([{ name: 'bofinda_samtykke', value: 'nej', url: APP }])
  const p = await ctx.newPage()
  const net = []
  p.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/billede')) net.push({ t: 'billede', u: u.searchParams.get('u') })
    else if (u.pathname.startsWith('/api/kortbilleder')) net.push({ t: 'json', u: u.pathname })
  })
  let navigationer = 0
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigationer++ })
  return { ctx, p, net, navigationer: () => navigationer }
}

// Hydrering: KortRamme er en klientkomponent. Et klik før React har
// overtaget, rammer en knap uden handler. Vi venter på Next's egen
// markering og derefter et øjeblik — ikke på det element, der prøves.
async function hydreret(p) {
  await p.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 })
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(300)
}

const tæller = (ramme) => ramme.$eval('.kb-taeller', (e) => e.textContent.replace(/\s+/g, ' ').trim())
  .catch(() => null)

for (const [navn, sti] of SIDER) {
  for (const bredde of BREDDER) {
    console.log(`\n══ ${navn} · ${bredde} px ══`)
    const { ctx, p, net, navigationer } = await nySide(bredde)
    await p.goto(APP + sti, { waitUntil: 'networkidle' })
    await hydreret(p)

    // ── K10 · lazy-loading ved sidevisning, FØR noget rulles ──────
    const før = await p.evaluate(() => {
      const imgs = [...document.querySelectorAll('.liste a.kort .kort-billede img')]
      return {
        billeder: imgs.length,
        eager: imgs.filter((i) => i.loading !== 'lazy').length,
        førsteEager: imgs.length > 0 && imgs[0].loading === 'eager',
      }
    })
    const indledende = net.filter((x) => x.t === 'billede').length
    præmis(før.billeder >= 10, `listen har kortbilleder at måle på (${før.billeder})`)
    prøve('K10', før.eager <= 1, 'højst ét eager billede (Performances første)',
      `${før.eager} eager af ${før.billeder}`)
    prøve('K10', net.every((x) => x.t !== 'json'), 'ingen billedliste hentet ved sidevisning',
      `${net.filter((x) => x.t === 'json').length} kald`)
    if (bredde === 390) {
      prøve('K10', indledende < før.billeder,
        'ved 390 px er ikke alle kortbilleder hentet, før der rulles',
        `${indledende} af ${før.billeder} hentet`)
    }

    // ── Hele listen målt i én passage ────────────────────────────
    const m = await p.evaluate(({ FORBUDT_KLASSE, FORBUDT_TEKST }) => {
      const forbudt = FORBUDT_TEKST.map(([k, f, n]) => [new RegExp(k, f), n])
      const rammer = [...document.querySelectorAll('.liste > .kortramme')]
      const kort = rammer.map((r) => {
        const a = r.querySelector(':scope > a.kort')
        const tekst = a ? a.innerText.replace(/\s+/g, ' ').trim() : ''
        const titel = a?.querySelector('.kort-overskrift')
        const pris = a?.querySelectorAll('.kort-prislinje') ?? []
        const lh = titel ? parseFloat(getComputedStyle(titel).lineHeight) : 0
        const rb = r.getBoundingClientRect()
        const pl = pris[0]?.getBoundingClientRect()
        const prisSelv = pris[0]?.querySelector('.kort-pris')?.getBoundingClientRect()
        const betyder = pris[0]?.querySelector('.kp-betyder')
        const bb = betyder?.getBoundingClientRect()
        return {
          id: a?.dataset.bolig ?? null,
          gruppe: a?.dataset.gruppe === '1',
          gruppeAntal: a ? Number(a.dataset.gruppeAntal ?? 0) : 0,
          href: a?.getAttribute('href') ?? '',
          kompakt: !!a?.classList.contains('kompakt'),
          udenBillede: !!a?.classList.contains('uden-billede'),
          forbudteKlasser: a ? [...a.querySelectorAll(FORBUDT_KLASSE)].map((e) => e.className) : [],
          forbudtTekst: forbudt.filter(([re]) => re.test(tekst)).map(([, n]) => n),
          titler: a ? a.querySelectorAll('.kort-overskrift').length : 0,
          titelLinjer: titel && lh ? Math.round(titel.clientHeight / lh) : 0,
          titelKlippet: titel ? getComputedStyle(titel).webkitLineClamp : null,
          prislinjer: pris.length,
          betydning: betyder?.textContent ?? '',
          // Samme linje: betydningens grundlinje ligger inden for
          // prisens kasse — eller, er der ikke plads, lige under den.
          sammeLinje: !!(prisSelv && bb) && bb.top < prisSelv.bottom,
          top: Math.round(rb.top + scrollY), h: Math.round(rb.height),
          prisBund: pl ? Math.round(rb.bottom - pl.bottom) : null,
          pile: r.querySelectorAll('.kb-pil').length,
          pileILink: a ? a.querySelectorAll('button, .kb-pil').length : 0,
          taeller: r.querySelector('.kb-taeller')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
          pilenavne: [...r.querySelectorAll('.kb-pil')].map((b) => b.getAttribute('aria-label')),
        }
      })
      return { kort, overløb: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    }, {
      FORBUDT_KLASSE,
      FORBUDT_TEKST: FORBUDT_TEKST.map(([re, n]) => [re.source, re.flags, n]),
    })
    præmis(m.kort.length >= 10, `${m.kort.length} kort i listen`)
    præmis(m.kort.every((k) => k.kompakt), 'alle listens kort er kompakte')

    // ── K1 · fjernet metadata ────────────────────────────────────
    const medKlasse = m.kort.filter((k) => k.forbudteKlasser.length)
    prøve('K1', medKlasse.length === 0, 'ingen fjernet metadatarække på fronten (klasser)',
      medKlasse.slice(0, 2).map((k) => `${k.id ?? k.href}: ${k.forbudteKlasser.join(',')}`).join(' · '))
    const medTekst = m.kort.filter((k) => k.forbudtTekst.length)
    prøve('K1', medTekst.length === 0, 'ingen fjernet metadata på fronten (tekst)',
      medTekst.slice(0, 2).map((k) => `${k.id ?? k.href}: ${k.forbudtTekst.join(',')}`).join(' · '))

    // ── K2 · titel og prislinje ──────────────────────────────────
    prøve('K2', m.kort.every((k) => k.titler === 1 && k.prislinjer === 1),
      'præcis én titel og én prislinje pr. kort')
    const lange = m.kort.filter((k) => k.titelLinjer > 2 || k.titelKlippet !== '2')
    prøve('K2', lange.length === 0, 'titlen er højst to linjer (klippet ved to)',
      lange.slice(0, 2).map((k) => `${k.titelLinjer} linjer, clamp ${k.titelKlippet}`).join(' · '))
    const uden = m.kort.filter((k) => !/^(til udlejer|husleje)$/.test(k.betydning))
    prøve('K2', uden.length === 0, 'prislinjen siger «til udlejer» eller «husleje»',
      uden.slice(0, 2).map((k) => k.betydning || '(tom)').join(' · '))
    const brudt = m.kort.filter((k) => !k.sammeLinje)
    prøve('K2', brudt.length === 0, 'betydningen står i samme linje som beløbet', `${brudt.length} brudt`)

    // ── K3 · lige høje kort pr. række ────────────────────────────
    const rækker = new Map()
    for (const k of m.kort) {
      const y = Math.round(k.top / 4) * 4
      if (!rækker.has(y)) rækker.set(y, [])
      rækker.get(y).push(k)
    }
    const flere = [...rækker.values()].filter((r) => r.length > 1)
    if (bredde >= 768) præmis(flere.length > 0, `der er rækker med flere kort (${flere.length})`)
    const skæve = flere.filter((r) => Math.max(...r.map((k) => k.h)) - Math.min(...r.map((k) => k.h)) > 1)
    prøve('K3', skæve.length === 0, `kortene i en række er lige høje (${flere.length} rækker)`,
      skæve.slice(0, 2).map((r) => r.map((k) => k.h).join('/')).join(' · '))
    const prisSkæv = flere.filter((r) => Math.max(...r.map((k) => k.prisBund)) - Math.min(...r.map((k) => k.prisBund)) > 1)
    prøve('K3', prisSkæv.length === 0, 'prislinjen står samme sted i rækken',
      prisSkæv.slice(0, 2).map((r) => r.map((k) => k.prisBund).join('/')).join(' · '))

    // ── K4 · ingen døde pile, tælleren siger basens tal ──────────
    const vurderet = m.kort.map((k) => {
      const id = k.id ?? new URL(k.href, APP).searchParams.get('b')
      return { ...k, bid: id, n: k.udenBillede ? 0 : antalFor(id) }
    })
    præmis(vurderet.some((k) => k.n >= 2) && vurderet.some((k) => k.n <= 1),
      'listen har kort med både ét og flere billeder')
    const døde = vurderet.filter((k) => (k.n >= 2) !== (k.pile === 2))
    prøve('K4', døde.length === 0, 'pile præcis ved ≥ 2 billeder — talt i basen',
      døde.slice(0, 3).map((k) => `${k.bid}: ${k.n} billeder, ${k.pile} pile`).join(' · '))
    const forkerteTal = vurderet.filter((k) => k.n >= 2 && k.taeller !== `1 / ${k.n}`)
    prøve('K4', forkerteTal.length === 0, 'tælleren siger «1 / N» med basens N',
      forkerteTal.slice(0, 2).map((k) => `${k.taeller} ≠ 1 / ${k.n}`).join(' · '))
    prøve('K4', vurderet.every((k) => k.pileILink === 0), 'ingen knap inde i kortlinket')
    prøve('K4', vurderet.filter((k) => k.pile).every((k) =>
      k.pilenavne.join('|') === 'Forrige billede|Næste billede'), 'pilene har et tilgængeligt navn')

    prøve('K12', m.overløb === 0, 'intet vandret overløb', `${m.overløb} px`)

    if (UD) await p.screenshot({ path: `${UD}/${navn}-${bredde}.png` })

    // ── K11 · interaktion: listen én gang, kun naboerne ──────────
    // Et kort med mindst fire billeder, så «kun naboerne» kan skelnes
    // fra «alle».
    const mål = vurderet.find((k) => k.n >= 4 && !k.gruppe) ?? vurderet.find((k) => k.n >= 3)
    præmis(!!mål, 'der er et kort med mindst tre billeder at blade i')
    if (mål) {
      const ramme = await p.$(`.liste > .kortramme:has(a.kort[href="${mål.href}"])`)
      await ramme.scrollIntoViewIfNeeded()
      await p.waitForLoadState('networkidle')
      await p.waitForTimeout(300)
      const start = net.length
      const urlFør = p.url()
      const navFør = navigationer()
      const histFør = await p.evaluate(() => history.length)
      const ønsket = billederFor.get(mål.bid)
      const vist = () => ramme.$eval('.kort-billede img', (i) => i.getAttribute('src'))

      if (bredde === 390) {
        // ── K9 · swipe ────────────────────────────────────────────
        const img = await ramme.$('.kort-billede')
        const b = await img.boundingBox()
        const cdp = await ctx.newCDPSession(p)
        const y = Math.round(b.y + b.height / 2)
        const x0 = Math.round(b.x + b.width * 0.8)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
        for (let i = 1; i <= 6; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 25, y }] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        // Det klik, en browser kan sende efter en berøring.
        await img.evaluate((e) => e.click())
        await p.waitForTimeout(700)
        prøve('K9', (await tæller(ramme)) === `2 / ${mål.n}`, 'swipe mod venstre blader frem',
          `${await tæller(ramme)}`)
        prøve('K9', kildeUrl(await vist()) === ønsket[1], 'og viser basens andet billede')
        prøve('K9', p.url() === urlFør && navigationer() === navFør, 'swipet åbnede ikke annoncen', p.url())
        prøve('K9', (await p.evaluate(() => history.length)) === histFør, 'og rørte ikke historikken')
        // Tilbage, så de næste målinger starter fra billede 1.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(b.x + b.width * 0.2), y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(b.x + b.width * 0.7), y }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await p.waitForTimeout(500)
        prøve('K9', (await tæller(ramme)) === `1 / ${mål.n}`, 'swipe mod højre blader tilbage')
        await cdp.detach()
      } else {
        // Hensigt med musen.
        await ramme.hover()
        await p.waitForLoadState('networkidle')
        await p.waitForTimeout(300)
      }

      // ── K6 · pileklik med MUSEN på pilens plads ──────────────────
      // `page.mouse` og ikke `locator.click()`: Playwright venter, til
      // knappen modtager klikket, og ville dermed skjule netop den fejl,
      // hvor klikket falder igennem til linket nedenunder.
      const klikPil = async (klasse) => {
        await ramme.hover().catch(() => {})
        const k = await (await ramme.$(klasse)).boundingBox()
        await p.mouse.click(k.x + k.width / 2, k.y + k.height / 2)
        await p.waitForTimeout(500)
      }
      if (bredde !== 390) {
        await klikPil('.kb-naeste')
        prøve('K6', p.url() === urlFør && navigationer() === navFør,
          'klik på «næste» åbnede ikke annoncen', p.url())
        if (p.url() !== urlFør) {
          await p.goto(APP + sti, { waitUntil: 'networkidle' })
          await hydreret(p)
        } else {
          prøve('K5', (await tæller(ramme)) === `2 / ${mål.n}`, '«næste» blader frem', await tæller(ramme))
          prøve('K5', kildeUrl(await vist()) === ønsket[1], 'og viser basens andet billede')
          await klikPil('.kb-forrige')
          await klikPil('.kb-forrige')
          prøve('K5', (await tæller(ramme)) === `${mål.n} / ${mål.n}`, '«forrige» fra første går rundt til sidste',
            await tæller(ramme))
          prøve('K5', kildeUrl(await vist()) === ønsket[mål.n - 1], 'og viser basens sidste billede')
          prøve('K6', p.url() === urlFør && navigationer() === navFør, 'tre pileklik, ingen navigation')
          prøve('K6', (await p.evaluate(() => history.length)) === histFør, 'og historikken er urørt')
          // K11 — efter hensigt og tre klik.
          const efter = net.slice(start)
          const json = efter.filter((x) => x.t === 'json').length
          const billeder = new Set(efter.filter((x) => x.t === 'billede').map((x) => x.u))
          prøve('K11', json === 1, 'billedlisten hentet præcis én gang', `${json}`)
          prøve('K11', billeder.size <= 3 && billeder.size < mål.n,
            'kun naboerne hentet, ikke hele listen', `${billeder.size} af ${mål.n}`)
        }
      } else {
        const efter = net.slice(start)
        const json = efter.filter((x) => x.t === 'json').length
        const billeder = new Set(efter.filter((x) => x.t === 'billede').map((x) => x.u))
        prøve('K11', json === 1, 'billedlisten hentet præcis én gang (swipe)', `${json}`)
        prøve('K11', billeder.size <= 3 && billeder.size < mål.n,
          'kun naboerne hentet (swipe)', `${billeder.size} af ${mål.n}`)
      }
    }

    // ── K8 · tastaturet ────────────────────────────────────────────
    if (bredde === 1440 && mål) {
      await p.goto(APP + sti, { waitUntil: 'networkidle' })
      await hydreret(p)
      await p.mouse.move(2, 2)
      const urlFør = p.url()
      const sel = `.liste > .kortramme:has(a.kort[href="${mål.href}"])`
      await p.focus(`${sel} > a.kort`)
      await p.keyboard.press('Tab')
      await p.waitForTimeout(400)   // pilens indtoning er 0,15 s
      const f1 = await p.evaluate(() => {
        const e = document.activeElement
        const s = getComputedStyle(e)
        return { klasse: e.className, navn: e.getAttribute('aria-label'),
          synlig: e.matches(':focus-visible'), ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2,
          opacity: s.opacity }
      })
      prøve('K8', /kb-forrige/.test(f1.klasse), 'Tab fra kortet når «forrige»', f1.klasse)
      prøve('K8', f1.synlig && f1.ring, 'med synlig fokusring', `${f1.synlig} · ${f1.ring}`)
      prøve('K8', f1.opacity === '1', 'og pilen er synlig, når den har fokus', f1.opacity)
      await p.keyboard.press('Tab')
      await p.keyboard.press('Enter')
      await p.waitForTimeout(500)
      const r = await p.$(sel)
      prøve('K8', (await tæller(r)) === `2 / ${mål.n}`, 'Enter på «næste» blader', await tæller(r))
      prøve('K8', p.url() === urlFør, 'og navigerer ikke', p.url())
    }

    // ── K7 · kortklik åbner annoncen / gruppesiden ────────────────
    if (bredde === 1440 || bredde === 390) {
      await p.goto(APP + sti, { waitUntil: 'networkidle' })
      await hydreret(p)
      const enkel = vurderet.find((k) => !k.gruppe && k.n >= 2)
      if (enkel) {
        const t = await p.$(`.liste a.kort[href="${enkel.href}"] .kort-overskrift`)
        await t.scrollIntoViewIfNeeded()
        await Promise.all([p.waitForURL(/\/bolig\//, { timeout: 15000 }).catch(() => {}), t.click()])
        prøve('K7', new URL(p.url()).pathname === enkel.href, 'klik på kortets titel åbner annoncen', p.url())
        await p.goto(APP + sti, { waitUntil: 'networkidle' })
        await hydreret(p)
      }
      const gruppe = vurderet.find((k) => k.gruppe)
      if (navn === 'soegning') præmis(!!gruppe, 'søgningen har et gruppekort')
      if (gruppe) {
        const g = await p.$(`.liste a.kort[href="${gruppe.href}"] .kort-krop`)
        await g.scrollIntoViewIfNeeded()
        await Promise.all([p.waitForURL(/\/gruppe\?/, { timeout: 15000 }).catch(() => {}), g.click()])
        prøve('K7', p.url().startsWith(APP + '/gruppe?b='), 'gruppekortet åbner gruppesiden', p.url())
        const side = await p.evaluate(() => ({
          boliger: document.querySelectorAll('[data-bolig]').length,
          adresser: document.querySelectorAll('[data-bolig] .adresse').length,
        }))
        prøve('K7', side.boliger === gruppe.gruppeAntal && side.adresser === side.boliger,
          'gruppesiden viser alle medlemmer som fulde kort — med adresse',
          `${side.boliger} boliger, ${side.adresser} adresser, kortet sagde ${gruppe.gruppeAntal}`)
      }
    }
    await ctx.close()
  }
}
await br.close()

console.log(`\n${fejl === 0 ? 'KORTKARUSEL GRØN' : `KORTKARUSEL RØD — ${fejl} fejl`} · ${kørte} målinger`)
process.exit(fejl ? 1 : 0)
