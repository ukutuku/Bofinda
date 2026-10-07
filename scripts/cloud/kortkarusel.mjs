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
//    [K11] billedlisten hentes ÉN gang, og hvert skridt henter højst
//          det synlige billede og ÉN nabo — i den retning, der bladres.
//          Målt på EGNE prøvekort med 4, 5 og 8 billeder i kendt, unik
//          orden: første visning, hensigt og hvert trin hver for sig, kun
//          på målkortets egne billed-URL'er og dets eget listekald. Ved 8
//          billeder er nogle billeder forbudte hele forløbet. Det ene
//          listekald måles desuden på listens rigtige kort i hver bredde.
//    [K12] intet vandret overløb
//    [K13] tryk, mens billedlisten afventes, tabes ikke: listens første
//          svar holdes tilbage, to SEPARATE tryk sendes — med mus,
//          tastatur og swipe — og efter svaret står tælleren og det
//          FAKTISK INDLÆSTE billede (currentSrc, complete, decode, svar
//          200) dér, trykkene i rækkefølge fører hen. Stadig ét listekald.
//    [K14] en midlertidig listefejl (HTTP 500 og afbrudt forbindelse)
//          huskes ikke: forsidebilledet bliver stående; har nogen
//          trykket, står der en besked — synligt og i aria-live, og igen
//          ved en fejl mere — mens en fejl, der kun kom af en hensigt,
//          er tavs; intet forsøges af sig selv (heller ikke efter 10 min
//          på et falsk ur); den næste eksplicitte navigation — mus,
//          tastatur, touch — henter igen og blader. Et GYLDIGT tomt svar
//          og et svar med ét billede fjerner pilene, siger hvorfor, og
//          forsøger aldrig igen.
//
//  K13/K14 styrer billedlistens svar i BROWSEREN med `page.route` —
//  lokalt, ingen server eller base røres, og intet hostet.
//
//  Hver røde linje bærer sit [K…]-mærke, så en modprøve kan kræve, at
//  det var DETTE værn, der fangede den (`rød-af-en-anden-grund`).
//
//  Kører KUN mod det isolerede testmiljø. Basen åbnes gennem
//  isoleret.mjs. Scriptet skriver ét sted: K11 sår sine egne prøvekort
//  under et præfiks pr. kørsel og sletter dem på præfikset igen — samme
//  form som kortkontrol.mjs. Fremmede rækker røres ikke.
//
//  Brug:  node scripts/cloud/kortkarusel.mjs [mappe-til-skærmbilleder]
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  // Hvad billedruten SVAREDE pr. kildebillede — til K13/K14's «faktisk
  // indlæst», så et billede ikke kun er en skrevet src.
  const svar = new Map()
  p.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/billede')) svar.set(u.searchParams.get('u'), r.status())
  })
  return { ctx, p, net, svar, navigationer: () => navigationer }
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

    // ── K5/K6/K9 og K11's listekald på listens rigtige kort ────────
    // Et kort med mindst fire billeder at blade i. Det er data, der
    // vælger det — derfor måles HER kun det, der gælder ethvert kort:
    // listen hentes én gang.
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
          // K11 — efter hensigt og tre klik: listen ÉN gang. HVILKE
          // billeder der hentes, måles ikke her, men på egne prøvekort i
          // K11-afsnittet nederst (se dér, hvorfor et samlet tal ikke kan).
          const json = net.slice(start).filter((x) => x.t === 'json').length
          prøve('K11', json === 1, 'billedlisten hentet præcis én gang', `${json}`)
        }
      } else {
        const json = net.slice(start).filter((x) => x.t === 'json').length
        prøve('K11', json === 1, 'billedlisten hentet præcis én gang (swipe)', `${json}`)
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

// ═══ K13 / K14 · billedlisten afventer eller fejler ═════════════════
//
//  Billedlistens svar styres i BROWSEREN pr. kald, i den rækkefølge
//  kaldene kommer:
//
//    holdt       holdes, til prøven slipper det — så går det til appen
//    holdtFejl   holdes, og slippes som HTTP 500
//    holdtTom    holdes, og slippes som et gyldigt tomt svar
//    fejl500     HTTP 500 straks
//    netfejl     forbindelsen afbrydes (fetch afvises)
//    tom         gyldigt svar uden billeder
//    et          det rigtige svar, skåret til ét billede
//    videre      (og alt efter planen) appens eget svar
//
//  Hvert scenarie får en frisk side: billedlisten huskes pr. kort i
//  komponenten, og et scenarie må ikke arve et andets liste.
//
//  ── VENT PÅ EN TILSTAND, ALDRIG PÅ `networkidle` ──────────────
//  `waitForLoadState('networkidle')` svarer STRAKS, når siden allerede
//  har været i ro. Første udgave af disse prøver ventede sådan efter at
//  have sluppet svaret, aflæste kortet, før svaret var behandlet — og
//  «næste + forrige» (slutbillede = startbillede) var grøn på den GAMLE
//  komponent, som ender på 5/5. Modprøven mod 5bc170f viste det. Nu
//  ventes der på en POSITIV tilstand, der ikke kan være opfyldt før
//  svaret: billedet er basens forventede og indlæst, OG aria-live
//  annoncerer resultatet («Billede N af M»). Står tilstanden ikke efter
//  8 s, aflæses kortet alligevel, og påstandene er røde.
//
//  ── ET NEDBRUD ER IKKE ET FANGET VÆRN ─────────────────────────
//  Bryder et scenarie ned (fx fordi en pil mangler), skrives det som
//  `✗ [nedbrud]` — ikke under K13/K14 — og resten kører videre. En
//  modprøve, der kræver «✗ [K14]», tæller altså aldrig et nedbrud.
// Ordret de samme som i app/KortBilleder.tsx. Ændres den ene, er
// K14 rød, til den anden følger med.
const FEJLTEKST = 'De øvrige billeder kunne ikke hentes. Prøv igen med pilene.'
const INGEN_FLERE = 'Der er ikke flere billeder af denne bolig.'
const STI_K = '/?sted=9001'

async function styr(p, plan) {
  const kald = []
  await p.route('**/api/kortbilleder/**', async (route) => {
    const handling = plan.shift() ?? 'videre'
    const k = { handling, sluppet: false, afgjort: false }
    kald.push(k)
    try {
      if (handling === 'holdt' || handling === 'holdtFejl' || handling === 'holdtTom') {
        await new Promise((r) => { k.slip = r })
        k.sluppet = true
        if (handling === 'holdtFejl') {
          return await route.fulfill({ status: 500, contentType: 'text/plain', body: 'syntetisk fejl' })
        }
        if (handling === 'holdtTom') {
          return await route.fulfill({ status: 200, contentType: 'application/json', body: '{"billeder":[]}' })
        }
        return await route.continue()
      }
      if (handling === 'fejl500') {
        return await route.fulfill({ status: 500, contentType: 'text/plain', body: 'syntetisk fejl' })
      }
      if (handling === 'netfejl') return await route.abort('failed')
      if (handling === 'tom') {
        return await route.fulfill({ status: 200, contentType: 'application/json', body: '{"billeder":[]}' })
      }
      if (handling === 'et') {
        const r = await route.fetch()
        const j = await r.json()
        return await route.fulfill({ response: r, json: { billeder: j.billeder.slice(0, 1) } })
      }
      return await route.continue()
    } finally {
      k.afgjort = true
    }
  })
  const slip = async (i) => {
    for (let n = 0; n < 100 && !kald[i]?.slip; n++) await p.waitForTimeout(50)
    if (!kald[i]?.slip) throw new Error(`kald ${i + 1} kom aldrig — intet at slippe`)
    kald[i].slip()
  }
  /** Vent, til kald nr. n er afgjort i browseren, og giv siden tid til at
   *  behandle det. Bruges kun, hvor det forventede er, at INTET sker. */
  const afgjort = async (n) => {
    for (let i = 0; i < 160 && !(kald.length >= n && kald[n - 1].afgjort); i++) await p.waitForTimeout(50)
    await p.waitForTimeout(400)
  }
  return { kald, slip, afgjort }
}

const rammeSel = (href) => `.liste > .kortramme:has(a.kort[href="${href}"])`

/** Kortets tilstand som brugeren og skærmlæseren møder den. */
const tilstand = (p, href) => p.$eval(rammeSel(href), async (r) => {
  const img = r.querySelector('.kort-billede img')
  let u = null
  try { u = new URL(img.currentSrc).searchParams.get('u') } catch {}
  let dekodet = false
  try { await img.decode(); dekodet = true } catch {}
  const f = r.querySelector('.kb-fejl')
  const fb = f?.getBoundingClientRect()
  return {
    taeller: r.querySelector('.kb-taeller')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    pile: r.querySelectorAll('.kb-pil').length,
    fejltekst: f?.textContent ?? null,
    fejlSynlig: !!(f && fb.width > 0 && fb.height > 0 && getComputedStyle(f).visibility !== 'hidden'),
    live: r.querySelector('[aria-live]')?.textContent ?? '',
    u, indlaest: img.complete && img.naturalWidth > 0, dekodet,
  }
})

/** Vent på en POSITIV tilstand — højst `ms` — og returnér den aflæste. */
async function ventTil(p, href, pred, ms = 8000) {
  const slut = Date.now() + ms
  let t = await tilstand(p, href)
  while (!pred(t) && Date.now() < slut) {
    await p.waitForTimeout(100)
    t = await tilstand(p, href)
  }
  return t
}

/** Tæller, annoncering og billede: samme sted, og billedet er HENTET. */
async function slutbillede(mærke, s, kort, ønsket, i, tekst) {
  const N = ønsket.length
  const annonce = `Billede ${i + 1} af ${N}`
  const t = await ventTil(s.p, kort.href, (t) =>
    t.u === ønsket[i] && t.indlaest && t.live === annonce)
  prøve(mærke, t.taeller === `${i + 1} / ${N}`, `${tekst}: tælleren`, `${t.taeller}`)
  prøve(mærke, t.live === annonce, `${tekst}: skærmlæseren hører det samme`, `«${t.live}»`)
  prøve(mærke, t.u === ønsket[i] && t.indlaest && t.dekodet && s.svar.get(ønsket[i]) === 200,
    `${tekst}: det faktisk indlæste billede er basens nr. ${i + 1}`,
    `${t.u === ønsket[i] ? 'rigtigt' : `forkert (${String(t.u).slice(-28)})`} · complete+naturalWidth ${t.indlaest}`
    + ` · decode ${t.dekodet} · svar ${s.svar.get(ønsket[i]) ?? 'intet'}`)
  return t
}

const lister = (s) => s.net.filter((x) => x.t === 'json').length

/** Mus: peg på kortet (hensigt), klik så på pilens plads. */
async function musTryk(p, href, klasse) {
  const r = await p.$(rammeSel(href))
  await r.hover()
  const pil = await r.$(klasse)
  if (!pil) throw new Error(`pilen ${klasse} findes ikke på kortet`)
  const b = await pil.boundingBox()
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  // To SEPARATE tryk: hver får sin egen hændelse og sine mikroopgaver.
  await p.waitForTimeout(150)
}

/** Et scenarie på en frisk side. Bryder det ned, er det `[nedbrud]`. */
async function scenarie(navn, bredde, kort, fn, valg = {}) {
  const s = await nySide(bredde)
  try {
    // Et falskt ur skal installeres FØR siden indlæses.
    if (valg.ur) await s.p.clock.install()
    // Musen væk fra listen, FØR siden indlæses: en hensigt må ikke komme
    // af, at markøren tilfældigvis står over et kort.
    await s.p.mouse.move(2, 2)
    await s.p.goto(APP + (valg.sti ?? STI_K), { waitUntil: 'networkidle' })
    await hydreret(s.p)
    if (kort) {
      await (await s.p.$(rammeSel(kort.href))).scrollIntoViewIfNeeded()
      await ventTil(s.p, kort.href, (t) => t.u === billederFor.get(kort.id)[0] && t.indlaest)
      await s.p.waitForTimeout(200)
    }
    await fn(s)
  } catch (e) {
    kørte++; fejl++
    console.log(`  ✗ [nedbrud] ${navn}: ${String(e.message ?? e).split('\n')[0]}`)
  } finally {
    await s.ctx.close()
  }
}

/** Et enkeltkort med mindst fem billeder (som koordinatorens probe). */
let kort = null
await scenarie('kortvalg', 1440, null, async (s) => {
  const kandidater = await s.p.$$eval('.liste > .kortramme', (rs) => rs
    .map((r) => r.querySelector(':scope > a.kort[data-bolig]'))
    .filter((a) => a && a.closest('.kortramme').querySelector('.kb-naeste'))
    .map((a) => ({ id: a.dataset.bolig, href: a.getAttribute('href') })))
  kort = kandidater.find((k) => antalFor(k.id) >= 5) ?? kandidater.find((k) => antalFor(k.id) >= 3) ?? null
})
præmis(!!kort, `et enkeltkort med mindst tre billeder til K13/K14 (${kort ? antalFor(kort.id) : 0})`)

if (kort) {
  const ønsket = billederFor.get(kort.id)
  const N = ønsket.length

  console.log('\n══ K13 · tryk, mens billedlisten afventes ══')

  // ── mus: næste + næste og næste + forrige, listen holdt tilbage ──
  for (const [navn, tryk, slut] of [
    ['næste + næste', ['.kb-naeste', '.kb-naeste'], 2],
    ['næste + forrige', ['.kb-naeste', '.kb-forrige'], 0],
  ]) {
    await scenarie(`mus · ${navn}`, 1440, kort, async (s) => {
      const { kald, slip } = await styr(s.p, ['holdt'])
      for (const k of tryk) await musTryk(s.p, kort.href, k)
      const før = await tilstand(s.p, kort.href)
      prøve('K13', lister(s) === 1 && kald.length === 1 && !kald[0].sluppet,
        `mus · ${navn}: ét listekald, stadig holdt, da begge tryk var sendt`, `${lister(s)} kald`)
      prøve('K13', før.taeller === `1 / ${N}` && før.u === ønsket[0] && før.live === '',
        `mus · ${navn}: intet er flyttet eller annonceret, før listen er her`, `${før.taeller} · «${før.live}»`)
      await slip(0)
      await slutbillede('K13', s, kort, ønsket, slut, `mus · ${navn}`)
      prøve('K13', lister(s) === 1, `mus · ${navn}: stadig ét listekald`, `${lister(s)}`)
    })
  }

  // ── tastatur: Tab til pilene (fokus = hensigt), Enter, Enter ──
  await scenarie('tastatur · Enter + Enter', 1440, kort, async (s) => {
    const { kald, slip } = await styr(s.p, ['holdt'])
    await s.p.focus(`${rammeSel(kort.href)} > a.kort`)
    await s.p.keyboard.press('Tab')          // «forrige» — fokus starter listen
    await s.p.keyboard.press('Tab')          // «næste»
    await s.p.keyboard.press('Enter')
    await s.p.waitForTimeout(150)
    await s.p.keyboard.press('Enter')
    await s.p.waitForTimeout(150)
    prøve('K13', kald.length === 1 && !kald[0].sluppet,
      'tastatur · Enter + Enter: ét listekald, holdt', `${kald.length}`)
    const før = await tilstand(s.p, kort.href)
    prøve('K13', før.taeller === `1 / ${N}` && før.u === ønsket[0] && før.live === '',
      'tastatur: intet er flyttet eller annonceret, før listen er her', `${før.taeller} · «${før.live}»`)
    await slip(0)
    await slutbillede('K13', s, kort, ønsket, 2, 'tastatur · Enter + Enter')
    prøve('K13', lister(s) === 1, 'tastatur: stadig ét listekald', `${lister(s)}`)
  })

  // ── swipe på 390: to swipes mod venstre, listen holdt tilbage ──
  await scenarie('swipe · to swipes', 390, kort, async (s) => {
    const { kald, slip } = await styr(s.p, ['holdt'])
    const navFør = s.navigationer()
    const b = await (await s.p.$(`${rammeSel(kort.href)} .kort-billede`)).boundingBox()
    const cdp = await s.ctx.newCDPSession(s.p)
    const y = Math.round(b.y + b.height / 2)
    for (let n = 0; n < 2; n++) {
      const x0 = Math.round(b.x + b.width * 0.8)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 25, y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await s.p.waitForTimeout(150)
    }
    await cdp.detach()
    prøve('K13', kald.length === 1 && !kald[0].sluppet, 'swipe · to swipes: ét listekald, holdt', `${kald.length}`)
    const før = await tilstand(s.p, kort.href)
    prøve('K13', før.taeller === `1 / ${N}` && før.u === ønsket[0] && før.live === '',
      'swipe: intet er flyttet eller annonceret, før listen er her', `${før.taeller} · «${før.live}»`)
    await slip(0)
    await slutbillede('K13', s, kort, ønsket, 2, 'swipe · to swipes')
    prøve('K13', lister(s) === 1, 'swipe: stadig ét listekald', `${lister(s)}`)
    prøve('K13', new URL(s.p.url()).search === new URL(APP + STI_K).search && s.navigationer() === navFør,
      'swipe: åbnede ikke annoncen', s.p.url())
  })

  // ── den normale, færdighentede kontrol ──
  await scenarie('færdighentet', 1440, kort, async (s) => {
    const { kald, afgjort } = await styr(s.p, [])
    await s.p.hover(rammeSel(kort.href))
    await afgjort(1)
    prøve('K13', kald.length === 1 && lister(s) === 1, 'færdighentet: listen er her før første tryk', `${lister(s)}`)
    await musTryk(s.p, kort.href, '.kb-naeste')
    await slutbillede('K13', s, kort, ønsket, 1, 'færdighentet · næste')
    await musTryk(s.p, kort.href, '.kb-naeste')
    await slutbillede('K13', s, kort, ønsket, 2, 'færdighentet · næste igen')
    await musTryk(s.p, kort.href, '.kb-forrige')
    await slutbillede('K13', s, kort, ønsket, 1, 'færdighentet · forrige')
    prøve('K13', lister(s) === 1, 'færdighentet: stadig ét listekald', `${lister(s)}`)
  })

  // ── to tryk i SAMME opgave på en liste, der er her ──
  //  To `click()` i én og samme opgave: ingen mikroopgave og ingen render
  //  imellem. Det andet tryk må ikke regne fra en gammel render. På
  //  5bc170f var `indeks` en lukket værdi i `gaa`, og så giver det 2/5
  //  i stedet for 3/5. To SEPARATE klik ville ikke kunne se forskel —
  //  React når at rendere imellem — så scenariet er bygget, så det KAN
  //  blive rødt (koordinatorens probe, D1 mod D2).
  await scenarie('færdighentet · to tryk i samme opgave', 1440, kort, async (s) => {
    const { afgjort } = await styr(s.p, [])
    await s.p.hover(rammeSel(kort.href))
    await afgjort(1)
    await s.p.$eval(`${rammeSel(kort.href)} .kb-naeste`, (b) => { b.click(); b.click() })
    await slutbillede('K13', s, kort, ønsket, 2, 'færdighentet · to tryk i samme opgave')
  })

  console.log('\n══ K14 · en midlertidig listefejl ══')

  // ── mus: hensigt fejler, første tryk fejler, næste tryk lykkes ──
  for (const [navn, fejlform] of [['HTTP 500', 'fejl500'], ['netværksfejl', 'netfejl']]) {
    await scenarie(`K14 · ${navn}`, 1440, kort, async (s) => {
      const { kald, afgjort } = await styr(s.p, [fejlform, fejlform, 'videre'])
      await s.p.hover(rammeSel(kort.href))              // hensigt → kald 1, fejler
      await afgjort(1)
      const efterHensigt = await tilstand(s.p, kort.href)
      prøve('K14', kald.length === 1 && efterHensigt.pile === 2 && !efterHensigt.fejlSynlig,
        `${navn}: en fejlet hensigt er tavs — pilene står, ingen besked endnu`,
        `${kald.length} kald · ${efterHensigt.pile} pile · besked ${efterHensigt.fejlSynlig}`)
      await musTryk(s.p, kort.href, '.kb-naeste')       // eksplicit → kald 2, fejler
      const t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig)
      prøve('K14', kald.length === 2, `${navn}: et eksplicit tryk efter fejlen forsøger igen`, `${kald.length} kald`)
      prøve('K14', t.taeller === `1 / ${N}` && t.u === ønsket[0] && t.indlaest && t.dekodet,
        `${navn}: forsidebilledet og tælleren bliver stående`, `${t.taeller} · ${t.u === ønsket[0]}`)
      prøve('K14', t.fejlSynlig && t.fejltekst === FEJLTEKST && t.live === FEJLTEKST,
        `${navn}: beskeden står synligt og i aria-live`, `«${t.fejltekst}» · «${t.live}»`)
      prøve('K14', t.pile === 2, `${navn}: pilene står, så der kan forsøges igen`, `${t.pile}`)
      if (UD) await (await s.p.$(rammeSel(kort.href))).screenshot({ path: `${UD}/k14-fejl-${fejlform}-1440.png` })
      // Intet forsøges af sig selv — hverken af tid eller af en ny hensigt.
      await s.p.mouse.move(2, 2)
      await s.p.waitForTimeout(1500)
      await s.p.hover(rammeSel(kort.href))
      await s.p.waitForTimeout(400)
      prøve('K14', kald.length === 2, `${navn}: intet nyt kald af tid eller af musen alene`, `${kald.length} kald`)
      await musTryk(s.p, kort.href, '.kb-naeste')       // eksplicit → kald 3, lykkes
      const efter = await slutbillede('K14', s, kort, ønsket, 1, `${navn} · efter genforsøget`)
      prøve('K14', kald.length === 3, `${navn}: det næste eksplicitte tryk hentede igen`, `${kald.length} kald`)
      prøve('K14', !efter.fejlSynlig && efter.fejltekst === null, `${navn}: beskeden er væk igen`, `${efter.fejltekst}`)
    })
  }

  // ── touch på 390: netfejl → det næste tryk lykkes ──
  //  Et tryk på pilen FOKUSERER knappen (Chromium sender mousedown), og
  //  fokus er en hensigt — så det første kald kommer sandsynligvis fra
  //  den, og trykket venter på det. Det andet tryk er et rent eksplicit
  //  genforsøg: efter fejlen starter en hensigt intet.
  await scenarie('K14 · touch', 390, kort, async (s) => {
    const { kald } = await styr(s.p, ['netfejl', 'videre'])
    const tryk = async () => {
      const pil = await s.p.$(`${rammeSel(kort.href)} .kb-naeste`)
      if (!pil) throw new Error('pilen .kb-naeste findes ikke på kortet')
      const b = await pil.boundingBox()
      await s.p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    }
    await tryk()
    const t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig)
    prøve('K14', kald.length === 1 && t.fejlSynlig && t.taeller === `1 / ${N}` && t.u === ønsket[0],
      'touch · netværksfejl: besked, forsidebilledet står', `${kald.length} kald · ${t.taeller} · ${t.fejltekst}`)
    if (UD) await (await s.p.$(rammeSel(kort.href))).screenshot({ path: `${UD}/k14-fejl-touch-390.png` })
    await tryk()
    await slutbillede('K14', s, kort, ønsket, 1, 'touch · efter genforsøget')
    prøve('K14', kald.length === 2, 'touch: det næste tryk hentede igen', `${kald.length} kald`)
    prøve('K14', new URL(s.p.url()).search === new URL(APP + STI_K).search, 'touch: åbnede ikke annoncen', s.p.url())
  })

  // ── højst ét igangværende kald, også under genforsøget ──
  await scenarie('K14 · ét kald under genforsøget', 1440, kort, async (s) => {
    const { kald, slip, afgjort } = await styr(s.p, ['fejl500', 'holdt'])
    await s.p.hover(rammeSel(kort.href))
    await afgjort(1)
    await musTryk(s.p, kort.href, '.kb-naeste')       // kald 2, holdt
    await musTryk(s.p, kort.href, '.kb-naeste')       // venter på kald 2
    prøve('K14', kald.length === 2 && !kald[1].sluppet,
      'genforsøg: to tryk under det holdte kald giver ikke et tredje', `${kald.length} kald`)
    await slip(1)
    // At begge tryk udføres i rækkefølge, er K13's egenskab — derfor mærket.
    await slutbillede('K13', s, kort, ønsket, 2, 'genforsøg · begge tryk under det holdte kald udført')
    prøve('K14', kald.length === 2, 'genforsøg: stadig to kald i alt', `${kald.length} kald`)
  })

  // ── tryk, der ventede på et kald, der fejlede, genspilles ikke ──
  await scenarie('K14 · tabte tryk', 1440, kort, async (s) => {
    const { kald, slip } = await styr(s.p, ['holdtFejl', 'videre'])
    await musTryk(s.p, kort.href, '.kb-naeste')
    await musTryk(s.p, kort.href, '.kb-naeste')
    await slip(0)
    const t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig)
    await s.p.waitForTimeout(1000)
    prøve('K14', kald.length === 1 && t.fejlSynlig && t.taeller === `1 / ${N}`,
      'holdt kald fejler: én besked, tælleren står, intet automatisk genforsøg',
      `${kald.length} kald · ${t.taeller} · ${t.fejlSynlig}`)
    await musTryk(s.p, kort.href, '.kb-naeste')
    await slutbillede('K14', s, kort, ønsket, 1, 'de tabte tryk genspilles ikke — ét skridt')
    prøve('K14', kald.length === 2, 'det næste tryk hentede igen', `${kald.length} kald`)
  })

  // ── gyldigt tomt og gyldigt ét billede: ingen pile, intet genforsøg ──
  for (const [navn, svarform] of [['gyldigt tomt svar', 'tom'], ['gyldigt svar med ét billede', 'et']]) {
    await scenarie(`K14 · ${navn}`, 1440, kort, async (s) => {
      const { kald } = await styr(s.p, [svarform])
      await s.p.hover(rammeSel(kort.href))
      const t = await ventTil(s.p, kort.href, (t) => t.pile === 0)
      prøve('K14', t.pile === 0 && t.taeller === null && !t.fejlSynlig,
        `${navn}: pile og tæller forsvinder, ingen fejlbesked`, `${t.pile} pile · ${t.taeller} · ${t.fejltekst}`)
      prøve('K14', t.u === ønsket[0] && t.indlaest, `${navn}: forsidebilledet står`, `${t.u === ønsket[0]}`)
      await s.p.mouse.move(2, 2)
      await s.p.waitForTimeout(800)
      await s.p.hover(rammeSel(kort.href))
      await s.p.waitForTimeout(400)
      prøve('K14', kald.length === 1, `${navn}: gemt som gyldigt — intet nyt kald`, `${kald.length} kald`)
    })
  }

  // ── tastaturfokus på en pil, der forsvinder, lander på kortet ──
  await scenarie('K14 · fokus', 1440, kort, async (s) => {
    await styr(s.p, ['tom'])
    await s.p.focus(`${rammeSel(kort.href)} > a.kort`)
    await s.p.keyboard.press('Tab')                    // «forrige» → hensigt → tomt svar
    await ventTil(s.p, kort.href, (t) => t.pile === 0)
    const aktiv = await s.p.evaluate(() => {
      const a = document.activeElement
      return { tag: a?.tagName ?? null, href: a?.getAttribute('href') ?? null }
    })
    prøve('K14', aktiv.tag === 'A' && aktiv.href === kort.href,
      'pilen forsvinder under fokus: fokus flyttes til kortet, ikke til <body>', `${aktiv.tag} ${aktiv.href}`)
    const t = await ventTil(s.p, kort.href, (t) => t.live === INGEN_FLERE)
    prøve('K14', t.live === INGEN_FLERE, '… og springet forklares i aria-live', `«${t.live}»`)
  })

  // ── et tryk venter, og svaret er gyldigt tomt ──
  await scenarie('K14 · ventende tryk, gyldigt tomt svar', 1440, kort, async (s) => {
    const { kald, slip } = await styr(s.p, ['holdtTom'])
    await s.p.focus(`${rammeSel(kort.href)} > a.kort`)
    await s.p.keyboard.press('Tab')                    // «forrige» → hensigt → kald 1, holdt
    await s.p.keyboard.press('Tab')                    // «næste»
    await s.p.keyboard.press('Enter')
    await s.p.waitForTimeout(150)
    prøve('K14', kald.length === 1 && !kald[0].sluppet, 'ventende tryk + tomt svar: ét kald, holdt', `${kald.length}`)
    await slip(0)
    const t = await ventTil(s.p, kort.href, (t) => t.pile === 0 && t.live === INGEN_FLERE)
    const aktiv = await s.p.evaluate(() => document.activeElement?.getAttribute('href') ?? document.activeElement?.tagName)
    prøve('K14', t.pile === 0 && t.taeller === null && !t.fejlSynlig,
      'ventende tryk + gyldigt tomt svar: pilene forsvinder, ingen fejlbesked', `${t.pile} pile · ${t.fejltekst}`)
    prøve('K14', t.live === INGEN_FLERE, '… og der siges hvorfor', `«${t.live}»`)
    prøve('K14', aktiv === kort.href, '… og fokus står på kortet', `${aktiv}`)
    prøve('K14', t.u === ønsket[0] && t.indlaest, '… og forsidebilledet står', `${t.u === ønsket[0]}`)
    if (UD) await (await s.p.$(rammeSel(kort.href))).screenshot({ path: `${UD}/k14-gyldigt-tomt-1440.png` })
  })

  // ── tastatur: hensigten fejler, Enter fejler, Enter fejler IGEN, Enter lykkes ──
  await scenarie('K14 · tastatur, to fejl i træk', 1440, kort, async (s) => {
    const { kald, slip, afgjort } = await styr(s.p, ['fejl500', 'fejl500', 'holdtFejl', 'videre'])
    await s.p.focus(`${rammeSel(kort.href)} > a.kort`)
    await s.p.keyboard.press('Tab')                    // «forrige» → hensigt → kald 1, fejler tavst
    await afgjort(1)
    await s.p.keyboard.press('Tab')                    // «næste» — efter en fejl starter fokus intet
    await s.p.waitForTimeout(300)
    prøve('K14', kald.length === 1, 'tastatur: fokus efter en fejl starter intet nyt kald', `${kald.length} kald`)
    await s.p.keyboard.press('Enter')                  // kald 2, fejler
    let t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig && t.live === FEJLTEKST)
    prøve('K14', kald.length === 2 && t.fejlSynlig && t.live === FEJLTEKST,
      'tastatur · Enter efter fejlen: forsøger igen, fejler, siger det', `${kald.length} kald · «${t.live}»`)
    await s.p.keyboard.press('Enter')                  // kald 3, holdt
    t = await ventTil(s.p, kort.href, (t) => t.live === '' && !t.fejlSynlig)
    prøve('K14', kald.length === 3 && !kald[2].sluppet && t.live === '' && !t.fejlSynlig,
      'tastatur · genforsøget er i gang: den gamle besked er ryddet', `${kald.length} kald · «${t.live}» · ${t.fejlSynlig}`)
    await slip(2)                                      // … og fejler igen
    t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig && t.live === FEJLTEKST)
    prøve('K14', t.fejlSynlig && t.live === FEJLTEKST,
      'tastatur · anden fejl i træk: beskeden kommer IGEN, synligt og i aria-live', `«${t.live}» · ${t.fejlSynlig}`)
    prøve('K14', t.taeller === `1 / ${N}` && t.u === ønsket[0], 'tastatur: forsidebilledet og tælleren står stadig', `${t.taeller}`)
    await s.p.keyboard.press('Enter')                  // kald 4, lykkes
    await slutbillede('K14', s, kort, ønsket, 1, 'tastatur · efter genforsøget')
    prøve('K14', kald.length === 4, 'tastatur: fire kald i alt — ét pr. eksplicit forsøg og hensigten', `${kald.length}`)
  })

  // ── intet genforsøg af sig selv — heller ikke efter 10 minutter ──
  //  Et vindue på nogle sekunders rigtig tid ser ikke en timer, der først
  //  fyrer efter 5 s. Her kører siden på et falsk ur, og efter fejlen
  //  spoles 10 minutter frem: hver setTimeout og setInterval i den tid
  //  fyrer. Planen bliver ved med at fejle, så et genforsøg ville SES.
  await scenarie('K14 · falsk ur', 1440, kort, async (s) => {
    const { kald } = await styr(s.p, ['fejl500', 'fejl500', 'fejl500', 'fejl500', 'fejl500', 'fejl500'])
    await musTryk(s.p, kort.href, '.kb-naeste')
    const t = await ventTil(s.p, kort.href, (t) => t.fejlSynlig)
    prøve('K14', t.fejlSynlig, 'falsk ur: fejlen er vist', `${t.fejltekst}`)
    const før = kald.length
    await s.p.mouse.move(2, 2)
    await s.p.clock.runFor(10 * 60_000)
    await s.p.waitForTimeout(800)
    prøve('K14', kald.length === før, 'falsk ur: 10 minutter senere er der intet nyt kald', `${før} → ${kald.length} kald`)
  }, { ur: true })
}

// ═══ K11 · listen ÉN gang — og pr. trin kun det synlige billede og ÉN nabo ═══
//
//  Den gamle K11 talte de NYE billeder efter hensigt, næste, forrige og
//  forrige på et kort, data valgte, og krævede højst tre. Grænsen var
//  forkert begge veje:
//
//    · FOR STRENG på 5 billeder. Hvert trin forhenter lovligt én nabo:
//      hensigt → nr. 2, næste → nr. 3, forrige → nr. 5, forrige → nr. 4.
//      Fire nye af fem er rigtig adfærd. Efter en ny såning havde det
//      valgte kort fem billeder, og K11 var rød på både 9ec440a og
//      cd5749e med de samme linjer.
//    · BLIND på 4 billeder. Tællingen begyndte, EFTER forsidebilledet
//      var hentet, så en komponent, der forhentede HELE listen allerede
//      ved hensigten, gav nr. 2–4 — tre nye, under grænsen (koordinatorens
//      fund; modprøven `kortkarusel-forhent-hele-listen.mjs` er netop den).
//
//  Et samlet tal for hele forløbet kan ikke skelne de to. Her prøves hvert
//  trin for sig mod billedernes IDENTITET:
//
//    første visning  kun forsidebilledet (nr. 1) er hentet; ingen liste
//    hensigt         listen hentes ÉN gang; nyt er højst naboen nr. 2 —
//                    der er ingen retning endnu, og den ene tilladte nabo
//                    er den, «næste» vil vise
//    hvert trin      det synlige billede er det forventede og FAKTISK
//                    indlæst (currentSrc, complete, decode, svar 200); nyt
//                    er højst det synlige og ÉN nabo i trinnets retning;
//                    naboen ER hentet — nu eller tidligere — så en
//                    observation, der intet ser, ikke bliver grøn
//    hele forløbet   præcis de forventede billeder; ved 8 er nogle
//                    FORBUDTE og må aldrig hentes
//
//  Det «tilladte» er kontraktens (det synlige og ÉN nabo i retningen),
//  regnet af handlingerne alene — ikke af komponentens kode.
//
//  FORSIDEBILLEDET OG CACHEN. Forsidebilledet hentes ved første visning og
//  tælles dér. Et billede, der allerede er hentet (forsidebilledet eller
//  en tidligere nabo), giver ingen NY identitet, når det vises eller
//  forhentes igen — Chromium tager det fra hukommelsen, og en
//  hukommelsestræffer når ofte slet ikke `request`-hændelsen. Derfor
//  regnes «nyt» som en identitet, kortet ikke havde hentet FØR trinnet, og
//  en gentaget forespørgsel på et kendt billede skrives ud, men er ikke en
//  overtrædelse. Det synlige billede kræves indlæst uanset vej.
//
//  KUN MÅLKORTET. Observationerne filtreres på målkortets egne billed-URL'er
//  og dets eget `/api/kortbilleder/<id>`. Siden viser kun prøvekortene, men
//  de andre kort henter deres forsidebilleder lazy, og dem må målingen
//  ikke tælle.
//
//  EGNE PRØVEKORT, fordi data ikke kan bære prøven: den såede base har
//  højst 5 billeder pr. bolig, og hvilket kort sideløkken vælger, skifter
//  med såningen — det var dét, der gjorde den gamle K11 rød. Kortene sås
//  på et postnummer, ingen anden bolig har, hver på sin egen vej (ingen
//  gruppe), med billed-URL'er, der er unikke og bærer deres plads
//  (`?k11=<N>-<plads>`). De slettes på præfikset i `finally`.
const K11_POSTNR = '9005'
const K11_STI = `/?sted=${K11_POSTNR}&kort=0`
const K11_FORLØB = [
  // [navn, bredde, billeder, handlinger]
  ['4 billeder · mus', 1440, 4, ['hensigt', 'næste', 'forrige', 'forrige']],
  ['5 billeder · mus', 1440, 5, ['hensigt', 'næste', 'forrige', 'forrige']],
  ['8 billeder · mus', 1440, 8, ['hensigt', 'næste', 'næste', 'forrige', 'forrige', 'forrige']],
  ['8 billeder · berøring', 390, 8, ['hensigt', 'næste', 'forrige', 'forrige']],
]
const K11_N = [...new Set(K11_FORLØB.map(([, , n]) => n))]

/** Kontraktens grænse: pr. trin det synlige billede og ÉN nabo. */
function k11Plan(N, handlinger) {
  let nu = 0
  const trin = handlinger.map((h) => {
    if (h === 'næste') nu = (nu + 1) % N
    if (h === 'forrige') nu = (nu - 1 + N) % N
    const nabo = h === 'forrige' ? (nu - 1 + N) % N : (nu + 1) % N
    return { h, vist: nu, nabo }
  })
  const forventet = new Set([0, ...trin.flatMap((t) => [t.vist, t.nabo])])
  const forbudt = [...Array(N).keys()].filter((i) => !forventet.has(i))
  return { trin, forventet, forbudt }
}
const nr = (xs) => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length ? a.map((i) => `nr. ${i + 1}`).join(', ') : 'ingen'
}
const sammeMængde = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

async function k11Forløb(navn, bredde, kort, handlinger) {
  const { id, urls } = kort
  const N = urls.length
  const { trin, forventet, forbudt } = k11Plan(N, handlinger)
  if (N >= 8) {
    præmis(forbudt.length > 0, `K11 · ${navn}: forløbet har billeder, der aldrig må hentes (${nr(forbudt)})`)
  }
  await scenarie(`K11 · ${navn}`, bredde, null, async (s) => {
    const { p } = s
    const hentet = (fra = 0) => new Set(s.net.slice(fra)
      .filter((x) => x.t === 'billede' && urls.includes(x.u)).map((x) => urls.indexOf(x.u)))
    const lister = () => s.net.filter((x) => x.t === 'json' && x.u === `/api/kortbilleder/${id}`).length
    const vent = async (pred, ms = 8000) => {
      const slut = Date.now() + ms
      while (!pred() && Date.now() < slut) await p.waitForTimeout(50)
    }
    const a = await p.$(`.liste > .kortramme > a.kort[data-bolig="${id}"]`)
    if (!a) throw new Error(`prøvekortet med ${N} billeder står ikke på ${K11_STI}`)
    const href = await a.getAttribute('href')
    const sel = rammeSel(href)
    await (await p.$(sel)).scrollIntoViewIfNeeded()
    const urlFør = p.url()
    const navFør = s.navigationer()

    /** Det synlige billede: identitet, indlæst, dekodet, billedrutens svar 200. */
    const synligt = (t, i, tekst) => prøve('K11',
      t.u === urls[i] && t.indlaest && t.dekodet && s.svar.get(urls[i]) === 200,
      `${navn} · ${tekst}: det synlige billede er nr. ${i + 1}, indlæst`,
      `${t.u === urls[i] ? 'rigtigt' : `forkert (nr. ${urls.indexOf(t.u) + 1})`} · complete+naturalWidth ${t.indlaest}`
      + ` · decode ${t.dekodet} · svar ${s.svar.get(urls[i]) ?? 'intet'} · tæller ${t.taeller}`)

    // ── første visning ─────────────────────────────────────────────
    const t0 = await ventTil(p, href, (t) => t.u === urls[0] && t.indlaest)
    await p.waitForTimeout(600)
    const h0 = hentet()
    console.log(`  · ${navn} · første visning: hentet ${nr(h0)} · ${lister()} listekald`)
    synligt(t0, 0, 'første visning')
    prøve('K11', sammeMængde(h0, new Set([0])), `${navn} · første visning: kun forsidebilledet er hentet`,
      `hentet ${nr(h0)}`)
    prøve('K11', lister() === 0, `${navn} · første visning: ingen billedliste hentet`, `${lister()} kald`)

    // ── hensigt og hvert navigationstrin ───────────────────────────
    const cdp = bredde < 700 ? await s.ctx.newCDPSession(p) : null
    const midt = async () => {
      const e = await p.$(`${sel} .kort-billede`)
      if (!e) throw new Error('billedfeltet findes ikke')
      const b = await e.boundingBox()
      return { b, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
    }
    const berør = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    // Som kortberoering.mjs: fingeren står stille, før den løftes — et
    // swipe sluppet i fart starter en fling, og det er browserens sag.
    const swipe = async (retning) => {
      const { b, y } = await midt()
      const x0 = Math.round(b.x + b.width * (retning === 'venstre' ? 0.8 : 0.2))
      const d = retning === 'venstre' ? -25 : 25
      await berør('touchStart', [{ x: x0, y, id: 1 }])
      for (let i = 1; i <= 6; i++) await berør('touchMove', [{ x: x0 + i * d, y, id: 1 }])
      for (let i = 0; i < 4; i++) {
        await berør('touchMove', [{ x: x0 + 6 * d, y, id: 1 }])
        await p.waitForTimeout(40)
      }
      await berør('touchEnd', [])
    }
    const gør = cdp ? {
      // En finger på billedet ER hensigten; den afbrydes, så intet tryk
      // og intet swipe følger med — trinnet er hensigten alene.
      hensigt: async () => {
        const { x, y } = await midt()
        await berør('touchStart', [{ x, y, id: 1 }])
        await p.waitForTimeout(50)
        await berør('touchCancel', [])
      },
      næste: () => swipe('venstre'),
      forrige: () => swipe('højre'),
    } : {
      hensigt: async () => { await (await p.$(sel)).hover() },
      næste: () => musTryk(p, href, '.kb-naeste'),
      forrige: () => musTryk(p, href, '.kb-forrige'),
    }

    for (const [k, { h, vist, nabo }] of trin.entries()) {
      const tekst = `trin ${k + 1} · ${h}`
      const før = hentet()
      const start = s.net.length
      await gør[h]()
      // Vent på en POSITIV tilstand, aldrig på `networkidle`.
      if (h !== 'hensigt') {
        await ventTil(p, href, (t) => t.u === urls[vist] && t.indlaest && t.live === `Billede ${vist + 1} af ${N}`)
      } else {
        await vent(() => lister() >= 1)
      }
      await vent(() => hentet().has(nabo))
      // Et ekstra kald udløses i samme opgave som naboens; 600 ms mere er
      // rigeligt til, at det står i loggen.
      await p.waitForTimeout(600)
      const t = await tilstand(p, href)
      const iTrin = hentet(start)
      const nye = [...iTrin].filter((i) => !før.has(i))
      const igen = [...iTrin].filter((i) => før.has(i))
      const tilladt = new Set([vist, nabo])
      console.log(`  · ${navn} · ${tekst}: synligt nr. ${vist + 1} · nyt ${nr(nye)} · igen ${nr(igen)}`
        + ` · i alt ${nr(hentet())} · ${lister()} listekald`)
      synligt(t, vist, tekst)
      prøve('K11', nye.every((i) => tilladt.has(i)),
        `${navn} · ${tekst}: nyt hentet er højst det synlige og naboen (${nr(tilladt)})`,
        `nyt ${nr(nye)}`)
      prøve('K11', hentet().has(nabo), `${navn} · ${tekst}: naboen nr. ${nabo + 1} er hentet — nu eller før`,
        `i alt ${nr(hentet())}`)
      prøve('K11', lister() === 1, `${navn} · ${tekst}: billedlisten er hentet præcis én gang`, `${lister()} kald`)
    }

    // ── hele forløbet ──────────────────────────────────────────────
    const alt = hentet()
    prøve('K11', sammeMængde(alt, forventet), `${navn} · hele forløbet: hentet præcis ${nr(forventet)}`,
      `hentet ${nr(alt)}`)
    if (forbudt.length) {
      prøve('K11', forbudt.every((i) => !alt.has(i)), `${navn} · hele forløbet: ${nr(forbudt)} blev aldrig hentet`,
        `hentet ${nr(alt)}`)
    }
    præmis(p.url() === urlFør && s.navigationer() === navFør, `K11 · ${navn}: forløbet blev på siden`)
    await cdp?.detach()
  }, { sti: K11_STI })
}

console.log(`\n══ K11 · egne prøvekort med ${K11_N.join(', ')} billeder ══`)
{
  const k11sql = await aabnIsoleretEllerStop()
  const K11_PRAEFIKS = `kortkarusel-k11-${Date.now()}-${randomUUID()}-`
  const koersel = randomUUID().slice(0, 8)
  const aktiv = `http://127.0.0.1:${process.env.BOFINDA_AKTIVPORT ?? 55433}`
  const k11 = new Map()
  try {
    try {
      const [kilde] = await k11sql`select id from sources where slug = 'test-alfa'`
      if (!kilde) throw new Error('Kilden test-alfa findes ikke — kør scripts/cloud/op.sh først.')
      const [{ fremmede }] = await k11sql`
        select count(*)::int as fremmede from listings where postal_code = ${K11_POSTNR}`
      præmis(fremmede === 0, `K11: postnummer ${K11_POSTNR} har ingen andre boliger (${fremmede})`)
      let foto = 1
      for (const N of K11_N) {
        const noegle = `${K11_PRAEFIKS}${N}`
        const vej = `Bladrevej ${N}`
        const [r] = await k11sql`
          insert into listings (source_id, source_type, external_key, source_url, address_raw,
            street, house_number, postal_code, city, unit_address_uuid, address_match_level,
            property_type, size_m2, rooms, rent_monthly, utilities_heat,
            total_monthly, total_monthly_components, images_may_differ,
            status, first_seen_at, last_seen_at)
          values (${kilde.id}, 'spider', ${noegle}, ${'https://eksempel.invalid/' + noegle},
            ${`${vej} 1, ${K11_POSTNR} Bladreby`}, ${vej}, '1',
            ${K11_POSTNR}, 'Bladreby', ${'intern:v3:kortkarusel:' + randomUUID()}, 'unit',
            'lejlighed', 72, 3, 1000000, 100000,
            1100000, ${k11sql.array(['rent', 'heat'])}, false,
            'active', now(), now())
          returning id`
        const urls = Array.from({ length: N }, (_, i) =>
          `${aktiv}/foto/maal-${String(foto++).padStart(2, '0')}.jpg?k11=${N}-${i}&koersel=${koersel}`)
        for (const [i, u] of urls.entries()) {
          await k11sql`insert into listing_images (listing_id, external_url, position) values (${r.id}, ${u}, ${i})`
        }
        // Læst tilbage i basens orden: listen ER kendt, ordnet og unik.
        const tilbage = (await k11sql`
          select external_url from listing_images where listing_id = ${r.id} order by position`)
          .map((x) => x.external_url)
        præmis(tilbage.length === N && tilbage.every((u, i) => u === urls[i]) && new Set(tilbage).size === N,
          `K11: prøvekortet med ${N} billeder har ${N} unikke billeder i kendt orden`)
        k11.set(N, { id: r.id, urls })
      }
    } catch (e) {
      kørte++; fejl++
      console.log(`  ✗ [nedbrud] K11 · såning: ${String(e.message ?? e).split('\n')[0]}`)
    }
    console.log(`  · sået ${k11.size} prøvekort under «${K11_PRAEFIKS}»`)
    for (const [navn, bredde, N, handlinger] of K11_FORLØB) {
      const kort = k11.get(N)
      præmis(!!kort, `K11 · ${navn}: prøvekortet findes`)
      if (kort) await k11Forløb(navn, bredde, kort, handlinger)
    }
  } finally {
    try {
      const slettede = await k11sql`
        delete from listings where external_key like ${K11_PRAEFIKS + '%'} returning id`
      const [{ rest }] = await k11sql`
        select count(*)::int as rest from listing_images
        where listing_id = any(${slettede.map((r) => r.id)}::uuid[])`
      console.log(`  · ${slettede.length} af ${K11_N.length} prøvekort slettet igen`
        + `${rest ? ` — ADVARSEL: ${rest} forældreløse billedrækker` : ''}`)
    } finally {
      await k11sql.end()
    }
  }
}

await br.close()

console.log(`\n${fejl === 0 ? 'KORTKARUSEL GRØN' : `KORTKARUSEL RØD — ${fejl} fejl`} · ${kørte} målinger`)
process.exit(fejl ? 1 : 0)
