// ═══════════════════════════════════════════════════════════════
//  Berøring på kortkarrusellen — A2 og A5.
//
//    [A2]  et SELVSTÆNDIGT tryk kort efter et swipe udføres: Næste,
//          Forrige, Enter på en pil og et tryk/Enter på kortlinket. Det
//          klik, swipet SELV kan afføde, sluges stadig, så swipet ikke
//          åbner annoncen.
//    [A5]  en bevægelse med flere fingre — to fra start, én efterfulgt af
//          nr. 2 — og en afbrudt berøring (touchcancel) navigerer ikke,
//          heller ikke når en finger løftes igen. Enkeltfingerswipe,
//          lodret rulning og browserens knibezoom virker, også på et kort
//          med ét billede.
//
//  TRE SLAGS INPUT, OG DE SKAL HOLDES ADSKILT I UDSKRIFTEN:
//    (cdp)     browserstyret berøring: CDP `Input.dispatchTouchEvent` går
//              gennem Chromiums rigtige inputkæde — pointer-events,
//              `touch-action`, rulning og afledte klik.
//    (dom)     syntetiske TouchEvents, sendt med `dispatchEvent` i siden.
//              Når kun komponentens lyttere; ingen gestusgenkendelse.
//    (knib)    faktisk knibezoom: to RÅ CDP-fingre, der spredes, gennem
//              touch-inputkæden — målt på `visualViewport.scale`, altså
//              browserens egen zoom. `Input.synthesizePinchGesture` med
//              touch-kilde zoomede slet ikke i denne headless-browser
//              (målt: 1 → 1.00 også uden for kortet), og mus-kilden er
//              ctrl+hjul og går uden om `touch-action` — den kan ikke måle
//              reglen. Derfor de rå fingre.
//  Ingen af dem er en fysisk finger på en telefon.
//
//  Kun mod det isolerede testmiljø; basen åbnes gennem isoleret.mjs og
//  læses kun. Hver røde linje bærer [A2]/[A5]; et nedbrud er [nedbrud].
//
//  Brug:  node scripts/cloud/kortberoering.mjs [mappe-til-skærmbilleder]
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
const STI = '/?sted=9001'

let fejl = 0
let kørte = 0
const prøve = (mærke, ok, tekst, detalje = '') => {
  kørte++
  if (!ok) fejl++
  console.log(`${ok ? '  ✓' : '  ✗'} [${mærke}] ${tekst}${detalje ? ` — ${detalje}` : ''}`)
}

const sql = await aabnIsoleretEllerStop()
const rækker = await sql`
  select i.listing_id::text as id, i.external_url as url
  from listing_images i join listings l on l.id = i.listing_id
  where l.status = 'active'
  order by i.listing_id, i.position`
await sql.end()
const billederFor = new Map()
for (const r of rækker) {
  if (!billederFor.has(r.id)) billederFor.set(r.id, [])
  billederFor.get(r.id).push(r.url)
}
const antalFor = (id) => billederFor.get(id)?.length ?? 0

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const rammeSel = (href) => `.liste > .kortramme:has(a.kort[href="${href}"])`

const tilstand = (p, href) => p.$eval(rammeSel(href), async (r) => {
  const img = r.querySelector('.kort-billede img')
  let u = null
  try { u = new URL(img.currentSrc).searchParams.get('u') } catch {}
  let dekodet = false
  try { await img.decode(); dekodet = true } catch {}
  return {
    taeller: r.querySelector('.kb-taeller')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    live: r.querySelector('[aria-live]')?.textContent ?? '',
    u, indlaest: img.complete && img.naturalWidth > 0, dekodet,
  }
})

async function ventTil(p, href, pred, ms = 6000) {
  const slut = Date.now() + ms
  let t = await tilstand(p, href)
  while (!pred(t) && Date.now() < slut) { await p.waitForTimeout(100); t = await tilstand(p, href) }
  return t
}

/** En frisk 390 px-side med berøring. */
async function side() {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  await ctx.addCookies([{ name: 'bofinda_samtykke', value: 'nej', url: APP }])
  const p = await ctx.newPage()
  let nav = 0
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) nav++ })
  const svar = new Map()
  p.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/billede')) svar.set(u.searchParams.get('u'), r.status())
  })
  await p.goto(APP + STI, { waitUntil: 'networkidle' })
  await p.waitForFunction(() => document.readyState === 'complete')
  await p.waitForTimeout(300)
  const cdp = await ctx.newCDPSession(p)
  return { ctx, p, cdp, svar, nav: () => nav }
}

async function scenarie(navn, fn) {
  let s
  try {
    s = await side()
    await fn(s)
  } catch (e) {
    kørte++; fejl++
    console.log(`  ✗ [nedbrud] ${navn}: ${String(e.message ?? e).split('\n')[0]}`)
  } finally {
    await s?.ctx.close()
  }
}

/** Kortet i visningen, dets liste hentet (hensigt via mus), og klar. */
async function forbered(s, kort) {
  await (await s.p.$(rammeSel(kort.href))).scrollIntoViewIfNeeded()
  const listeSvar = s.p.waitForResponse((r) => r.url().includes(`/api/kortbilleder/${kort.id}`), { timeout: 8000 })
  await s.p.hover(`${rammeSel(kort.href)} .kort-billede`)
  await listeSvar
  await s.p.mouse.move(2, 2)
  await ventTil(s.p, kort.href, (t) => t.u === billederFor.get(kort.id)[0] && t.indlaest)
  await s.p.waitForTimeout(250)
}

const boks = async (s, sel) => {
  const e = await s.p.$(sel)
  if (!e) throw new Error(`${sel} findes ikke`)
  return e.boundingBox()
}

/** (cdp) Et vandret swipe på billedet: mod venstre = næste.
 *
 *  Fingeren står STILLE et øjeblik, før den løftes. Slippes et hurtigt
 *  swipe i fart, starter Chromium en fling, og et tryk lige efter går til
 *  at stoppe den: pointerdown/touchstart/pointerup/touchend kommer frem,
 *  men browseren afleder intet mousedown/klik. Målt i denne harness med en
 *  hændelseslog på kortet (`touch/diag/`). Det er browserens egen
 *  tap-undertrykkelse, ikke komponentens, og den rammer begge revisioner
 *  ens — en prøve med et sluppet-i-fart-swipe ville derfor være rød af en
 *  anden grund og kunne ikke skelne før fra efter. */
async function swipe(s, kort, retning = 'venstre') {
  const b = await boks(s, `${rammeSel(kort.href)} .kort-billede`)
  const y = Math.round(b.y + b.height / 2)
  const x0 = Math.round(b.x + b.width * (retning === 'venstre' ? 0.8 : 0.2))
  const d = retning === 'venstre' ? -25 : 25
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }] })
  for (let i = 1; i <= 6; i++) {
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * d, y, id: 1 }] })
  }
  for (let i = 0; i < 4; i++) {
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + 6 * d, y, id: 1 }] })
    await s.p.waitForTimeout(40)
  }
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/** (knib) To rå fingre spredes vandret om et punkt. */
async function knib(s, x, y) {
  const send = (type, touchPoints) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
  await send('touchStart', [{ x: x - 20, y, id: 1 }, { x: x + 20, y, id: 2 }])
  for (let i = 1; i <= 12; i++) {
    await send('touchMove', [{ x: x - 20 - i * 8, y, id: 1 }, { x: x + 20 + i * 8, y, id: 2 }])
    await s.p.waitForTimeout(16)
  }
  await send('touchEnd', [])
}

/** (cdp) Et tryk — Chromium afleder selv pointerdown, mousedown og klik. */
async function tryk(s, sel) {
  const b = await boks(s, sel)
  await s.p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
}

async function slutbillede(mærke, s, kort, i, tekst) {
  const ø = billederFor.get(kort.id)
  const N = ø.length
  const t = await ventTil(s.p, kort.href, (t) => t.u === ø[i] && t.indlaest && t.live === `Billede ${i + 1} af ${N}`)
  prøve(mærke, t.taeller === `${i + 1} / ${N}` && t.live === `Billede ${i + 1} af ${N}`,
    `${tekst}: tæller og annoncering`, `${t.taeller} · «${t.live}»`)
  prøve(mærke, t.u === ø[i] && t.indlaest && t.dekodet && s.svar.get(ø[i]) === 200,
    `${tekst}: det faktisk indlæste billede er basens nr. ${i + 1}`,
    `${t.u === ø[i] ? 'rigtigt' : 'forkert'} · indlæst ${t.indlaest} · decode ${t.dekodet} · svar ${s.svar.get(ø[i]) ?? 'intet'}`)
}

/** Intet må være sket: samme side, samme billede, samme tæller. */
async function uroert(mærke, s, kort, tekst, navFør) {
  await s.p.waitForTimeout(700)
  const t = await tilstand(s.p, kort.href)
  const ø = billederFor.get(kort.id)
  prøve(mærke, new URL(s.p.url()).search === new URL(APP + STI).search && s.nav() === navFør,
    `${tekst}: ingen navigation`, s.p.url())
  prøve(mærke, t.taeller === `1 / ${ø.length}` && t.u === ø[0],
    `${tekst}: kortet står stadig på billede 1`, `${t.taeller}`)
}

// ── Kortene ─────────────────────────────────────────────────────
let kort = null
let etBillede = null
await scenarie('kortvalg', async (s) => {
  const alle = await s.p.$$eval('.liste > .kortramme', (rs) => rs.map((r) => {
    const a = r.querySelector(':scope > a.kort[data-bolig]')
    return a && { id: a.dataset.bolig, href: a.getAttribute('href'), pile: !!r.querySelector('.kb-naeste'),
      foto: !!r.querySelector('.kort-billede img') }
  }).filter(Boolean))
  kort = alle.find((k) => k.pile && antalFor(k.id) >= 5) ?? null
  etBillede = alle.find((k) => !k.pile && k.foto && antalFor(k.id) === 1) ?? null
})
prøve('præmis', !!kort, `et kort med mindst fem billeder (${kort ? antalFor(kort.id) : 0})`)
prøve('præmis', !!etBillede, 'et kort med præcis ét billede og ingen pile')

if (kort) {
  console.log('\n══ A2 · et selvstændigt tryk efter et swipe ══')

  await scenarie('A2 næste', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.waitForTimeout(300 - 100)
    await tryk(s, `${rammeSel(kort.href)} .kb-naeste`)
    await slutbillede('A2', s, kort, 2, '(cdp) swipe, så Næste ~300 ms efter')
    prøve('A2', s.nav() === navFør, '(cdp) swipe + Næste: ingen navigation', s.p.url())
  })

  await scenarie('A2 forrige', async (s) => {
    await forbered(s, kort)
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.waitForTimeout(200)
    await tryk(s, `${rammeSel(kort.href)} .kb-forrige`)
    await slutbillede('A2', s, kort, 0, '(cdp) swipe, så Forrige ~300 ms efter')
  })

  await scenarie('A2 tastatur på pilen', async (s) => {
    await forbered(s, kort)
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.focus(`${rammeSel(kort.href)} .kb-naeste`)
    await s.p.keyboard.press('Enter')
    await slutbillede('A2', s, kort, 2, 'swipe, så Enter på Næste inden for 500 ms')
  })

  await scenarie('A2 tryk på kortlinket', async (s) => {
    await forbered(s, kort)
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.waitForTimeout(200)
    await Promise.all([
      s.p.waitForURL(/\/bolig\//, { timeout: 8000 }).catch(() => {}),
      tryk(s, `${rammeSel(kort.href)} .kort-overskrift`),
    ])
    prøve('A2', new URL(s.p.url()).pathname === kort.href,
      '(cdp) swipe, så et tryk på kortets titel ~300 ms efter: annoncen åbnes', s.p.url())
  })

  // Et selvstændigt tryk på BILLEDET efter et swipe er et ønske om at
  // åbne annoncen — og billedfeltet er netop dér, hvor swipets eget klik
  // skal sluges. Kun en ny pointerdown skiller de to.
  await scenarie('A2 tryk på billedet', async (s) => {
    await forbered(s, kort)
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.waitForTimeout(200)
    await Promise.all([
      s.p.waitForURL(/\/bolig\//, { timeout: 8000 }).catch(() => {}),
      tryk(s, `${rammeSel(kort.href)} .kort-billede`),
    ])
    prøve('A2', new URL(s.p.url()).pathname === kort.href,
      '(cdp) swipe, så et tryk på billedet ~300 ms efter: annoncen åbnes', s.p.url())
  })

  await scenarie('A2 Enter på kortlinket', async (s) => {
    await forbered(s, kort)
    await swipe(s, kort, 'venstre')
    await slutbillede('A2', s, kort, 1, '(cdp) swipe mod venstre')
    await s.p.focus(`${rammeSel(kort.href)} > a.kort`)
    await Promise.all([
      s.p.waitForURL(/\/bolig\//, { timeout: 8000 }).catch(() => {}),
      s.p.keyboard.press('Enter'),
    ])
    prøve('A2', new URL(s.p.url()).pathname === kort.href,
      'swipe, så Enter på kortlinket inden for 500 ms: annoncen åbnes', s.p.url())
  })

  // Beskyttelsen skal blive: det klik, swipet SELV afføder, kommer UDEN
  // et nyt pointerdown. Chromium afleder ikke et klik fra en bevægelse
  // over tærsklen, så det sendes her som et syntetisk klik (detail 1),
  // præcis som en browser, der gør det, ville sende det.
  await scenarie('A2 swipets eget klik', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    await swipe(s, kort, 'venstre')
    await s.p.$eval(`${rammeSel(kort.href)} .kort-billede img`, (img) => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, view: window }))
    })
    await slutbillede('A2', s, kort, 1, '(dom) swipe + dets afledte klik')
    await s.p.waitForTimeout(500)
    prøve('A2', new URL(s.p.url()).search === new URL(APP + STI).search && s.nav() === navFør,
      '(dom) swipets eget klik sluges stadig: annoncen åbnes ikke', s.p.url())
  })

  console.log('\n══ A5 · flere fingre, afbrudt berøring, rulning og zoom ══')

  await scenarie('A5 to fingre fra start', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    const b = await boks(s, `${rammeSel(kort.href)} .kort-billede`)
    const y = Math.round(b.y + b.height / 2)
    const p1 = Math.round(b.x + b.width * 0.75), p2 = Math.round(b.x + b.width * 0.4)
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p1, y, id: 1 }, { x: p2, y, id: 2 }] })
    for (let i = 1; i <= 6; i++) {
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p1 - i * 15, y, id: 1 }, { x: p2 + i * 5, y, id: 2 }] })
    }
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await uroert('A5', s, kort, '(cdp) to fingre fra start, nr. 1 flyttes 90 px', navFør)
  })

  await scenarie('A5 én finger, så nr. 2', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    const b = await boks(s, `${rammeSel(kort.href)} .kort-billede`)
    const y = Math.round(b.y + b.height / 2)
    const p1 = Math.round(b.x + b.width * 0.8), p2 = Math.round(b.x + b.width * 0.3)
    const send = (type, touchPoints) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    await send('touchStart', [{ x: p1, y, id: 1 }])
    await send('touchMove', [{ x: p1 - 5, y, id: 1 }])
    await send('touchStart', [{ x: p1 - 5, y, id: 1 }, { x: p2, y, id: 2 }])   // finger nr. 2 ned
    for (let i = 1; i <= 6; i++) await send('touchMove', [{ x: p1 - 5 - i * 15, y, id: 1 }, { x: p2, y, id: 2 }])
    await send('touchMove', [{ x: p1 - 100, y, id: 1 }])                       // nr. 2 løftes
    await send('touchMove', [{ x: p1 - 110, y, id: 1 }])
    await send('touchEnd', [])                                                  // nr. 1 løftes
    await uroert('A5', s, kort, '(cdp) én finger, så nr. 2, så løftes de én ad gangen', navFør)
  })

  await scenarie('A5 touchcancel', async (s) => {
    await forbered(s, kort)
    const b = await boks(s, `${rammeSel(kort.href)} .kort-billede`)
    const y = Math.round(b.y + b.height / 2)
    const x0 = Math.round(b.x + b.width * 0.8)
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y, id: 1 }] })
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - 20, y, id: 1 }] })
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    // Et senere, selvstændigt tryk på Forrige må ikke arve den afbrudte
    // berørings start: Forrige fra billede 1 er billede 5.
    await s.p.waitForTimeout(200)
    await tryk(s, `${rammeSel(kort.href)} .kb-forrige`)
    await slutbillede('A5', s, kort, antalFor(kort.id) - 1, '(cdp) afbrudt berøring, så Forrige')
  })

  await scenarie('A5 dom-sekvens', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    // (dom) finger 1 ned på billedet, finger 2 ned, finger 2 op, finger 1
    // flyttet 120 px og op. Kun komponentens lyttere ser det.
    await s.p.$eval(`${rammeSel(kort.href)} .kort-billede img`, (img) => {
      const r = img.getBoundingClientRect()
      const y = r.top + r.height / 2
      const t = (id, x) => new Touch({ identifier: id, target: img, clientX: x, clientY: y })
      const ev = (type, touches, changed) => img.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed,
      }))
      const a0 = t(1, r.left + r.width * 0.8), b0 = t(2, r.left + r.width * 0.3)
      const a1 = t(1, r.left + r.width * 0.8 - 120)
      ev('touchstart', [a0], [a0])
      ev('touchstart', [a0, b0], [b0])
      ev('touchend', [a0], [b0])
      ev('touchend', [], [a1])
    })
    await uroert('A5', s, kort, '(dom) to fingre, løftet én ad gangen', navFør)
  })

  await scenarie('A5 lodret rulning', async (s) => {
    await forbered(s, kort)
    const navFør = s.nav()
    const før = await s.p.evaluate(() => scrollY)
    const b = await boks(s, `${rammeSel(kort.href)} .kort-billede`)
    const x = Math.round(b.x + b.width / 2), y0 = Math.round(b.y + b.height * 0.8)
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] })
    for (let i = 1; i <= 10; i++) {
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - i * 15, id: 1 }] })
    }
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await s.p.waitForTimeout(400)
    const efter = await s.p.evaluate(() => scrollY)
    prøve('A5', efter - før > 50, '(cdp) en lodret bevægelse på billedet ruller siden', `${før} → ${efter}`)
    await uroert('A5', s, kort, '(cdp) lodret rulning', navFør)
  })

  // KONTROL for selve værktøjet: knib på kortets TEKSTFELT, hvor ingen
  // `touch-action` nogensinde har stået. Zoomer browseren dér, men ikke på
  // billedet, er det reglen på billedet, der spærrer — ikke at syntetisk
  // knib er virkningsløst i denne browser.
  await scenarie('A5 knibezoom · kontrol', async (s) => {
    await (await s.p.$(rammeSel(kort.href))).scrollIntoViewIfNeeded()
    const b = await boks(s, `${rammeSel(kort.href)} .kort-krop`)
    const før = await s.p.evaluate(() => visualViewport.scale)
    await knib(s, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
    await s.p.waitForTimeout(600)
    const efter = await s.p.evaluate(() => visualViewport.scale)
    console.log(`  · [kontrol] (knib) kortets tekstfelt: visualViewport.scale ${før} → ${efter.toFixed(2)}`)
    prøve('præmis', efter > før * 1.2, '(knib) to rå fingre zoomer i denne browser (kortets tekstfelt)',
      `${før} → ${efter.toFixed(2)}`)
  })

  for (const [navn, k] of [['kort med fem billeder', kort], ['kort med ét billede', etBillede]]) {
    if (!k) continue
    await scenarie(`A5 knibezoom · ${navn}`, async (s) => {
      if (k === kort) await forbered(s, k)
      else await (await s.p.$(rammeSel(k.href))).scrollIntoViewIfNeeded()
      const navFør = s.nav()
      const b = await boks(s, `${rammeSel(k.href)} .kort-billede`)
      const før = await s.p.evaluate(() => visualViewport.scale)
      await knib(s, Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2))
      await s.p.waitForTimeout(600)
      const efter = await s.p.evaluate(() => visualViewport.scale)
      prøve('A5', efter > før * 1.2, `(knib) ${navn}: browseren zoomer, når der knibes på billedet`,
        `visualViewport.scale ${før} → ${efter.toFixed(2)}`)
      if (UD && k === etBillede) await s.p.screenshot({ path: `${UD}/a5-knibezoom-et-billede-390.png` })
      prøve('A5', new URL(s.p.url()).search === new URL(APP + STI).search && s.nav() === navFør,
        `(knib) ${navn}: ingen navigation`, s.p.url())
      if (k === kort) {
        const t = await tilstand(s.p, k.href)
        prøve('A5', t.taeller === `1 / ${antalFor(k.id)}`, `(knib) ${navn}: karrusellen står stille`, `${t.taeller}`)
      }
    })
  }
}

await br.close()
console.log(`\n${fejl === 0 ? 'KORTBERØRING GRØN' : `KORTBERØRING RØD — ${fejl} fejl`} · ${kørte} målinger`)
process.exit(fejl ? 1 : 0)
