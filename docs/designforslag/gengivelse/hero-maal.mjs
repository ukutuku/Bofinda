// ═══════════════════════════════════════════════════════════════
//  Målingerne på forsidens hero, delt af app-skud.mjs og maal-foto.mjs.
//  Alt måles mod de FAKTISKE pixels i den kørende side — ikke mod
//  farver læst i CSS'en og ikke mod et gennemsnit af fotoet.
// ═══════════════════════════════════════════════════════════════

// ─── Siden: samtykke, laget og mockuppen ─────────────────────────
// Next's udviklingsmarkør er ikke en del af siden. Skjult i alle varianter.
export const ALTID = 'nextjs-portal{display:none!important}'
export const HOEJDE = (w) => (w < 600 ? (w <= 360 ? 780 : 844) : 900)

/** Ny side i en kontekst med samtykket afgjort én gang. */
export async function aabn(c, base) {
  const p = await c.newPage()
  await p.goto(base + '/', { waitUntil: 'networkidle', timeout: 120000 })
  // Banneret tegnes af klienten EFTER networkidle; der ventes på det — en
  // optælling med det samme fandt det ikke, og så stod det midt i billedet.
  await p.getByRole('button', { name: 'Kun det nødvendige' }).first().waitFor({ timeout: 15000 }).catch(() => {})
  await samtykke(p)
  return p
}
async function samtykke(p) {
  const k = p.getByRole('button', { name: 'Kun det nødvendige' }).first()
  if (!(await k.isVisible().catch(() => false))) return false
  // Knappen gemmer valget og genindlæser. Klikket og genindlæsningen
  // afventes sammen; ellers afbryder genindlæsningen den næste goto.
  await Promise.all([p.waitForNavigation({ timeout: 10000 }).catch(() => {}), k.click()])
  await p.waitForLoadState('networkidle'); await p.waitForTimeout(800); return true
}
/** Gå til en side; står banneret alligevel, afgøres det og siden hentes igen. */
export async function gaaTil(p, url) {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
    .catch(async (e) => { if (!/interrupted by another navigation/.test(e.message)) throw e
      await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 }) })
  if (await samtykke(p)) await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
  if (await p.getByRole('button', { name: 'Kun det nødvendige' }).first().isVisible().catch(() => false)) throw new Error('samtykkebanneret står stadig: ' + url)
}

/**
 * Læg laget (css) og mockuppen (js + valg) på den åbne side.
 *
 * Mockuppen skal lægges på EFTER hydreringen. `next dev` hydrerer
 * undertiden efter networkidle, og en hydrering, der ikke stemmer, tegner
 * træet forfra og tager klasser og flyttede noder med sig (set på 360:
 * laget stod, mockuppen var væk). Derfor: læg på, vent, og efterprøv på
 * et mærke, kun mockuppen kan have sat.
 */
export async function laegPaa(p, { css = '', js = '', valg = {} } = {}) {
  await p.addStyleTag({ content: ALTID + '\n' + css })
  if (js) {
    await p.addScriptTag({ content: js })
    const virker = () => p.evaluate(() => !document.querySelector('.hero:not([data-forslag]), .maerkat.m-ny:not([data-forslag])'))
    for (let i = 0; i < 4; i++) {
      await p.evaluate((v) => { window.__bofindaForslag(v); document.querySelectorAll('.hero, .maerkat.m-ny').forEach((m) => m.setAttribute('data-forslag', '')) }, valg)
      await p.waitForTimeout(1500)
      if (await virker()) break
      if (i === 3) throw new Error('mockuppen blev ikke stående efter hydreringen')
    }
  }
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)) }
    window.scrollTo(0, 0); await document.fonts.ready
    // Højst 4 s: et skjult, lazy billede (galleriets lysbord) indlæses
    // aldrig, og decode() på det venter for evigt.
    await Promise.race([
      Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 4000)),
    ])
  })
  await p.waitForTimeout(400)
}

// Hvert tekstelement på heroen. Tærsklen er WCAG 2.x AA: 4,5:1, og 3:1
// for stor tekst (≥ 24 px, eller ≥ 18,66 px fed) — h1 er stor tekst.
export const HEROTEKSTER = [
  ['øjenbryn', '.hero-oejenbryn'],
  ['h1', '.hero h1'],
  ['manchet', '.hero-manchet'],
  ['håndskrift', '.hero-haand'],
]

// Tekstens egen udstrækning, ikke elementets boks: et afsnit i fuld
// bredde ville ellers måle mod dele af fotoet, teksten aldrig rører.
// HVER LINJE FOR SIG. En linje, der brækker inde i et afsnit med anden
// tekst (fodnotens kreditering på 360), har en samlet kasse, der rummer
// afsnittets øvrige tekst i samme farve — målt dér, gav en læselig
// linje 1,0:1. Linjekasserne rummer kun teksten selv.
async function tekstboks(el) {
  return el.evaluate((e) => {
    const r = document.createRange(); r.selectNodeContents(e)
    const b = r.getBoundingClientRect()
    const linjer = []
    for (const x of r.getClientRects()) {
      if (x.width < 1 || x.height < 1) continue
      // Samme linje kan komme som flere stykker (et barn, et mellemrum):
      // slås sammen, når de deler lodret udstrækning.
      const l = linjer.find((y) => Math.abs(y.top - x.top) < 2 && Math.abs(y.bottom - x.bottom) < 2)
      if (l) { l.left = Math.min(l.left, x.left); l.right = Math.max(l.right, x.right) }
      else linjer.push({ left: x.left, right: x.right, top: x.top, bottom: x.bottom })
    }
    const cs = getComputedStyle(e)
    const px = parseFloat(cs.fontSize), vaegt = Number(cs.fontWeight) || 400
    return {
      x: b.x, y: b.y + scrollY, width: b.width, height: b.height,
      linjer: linjer.map((l) => ({ x: l.left, y: l.top + scrollY, width: l.right - l.left, height: l.bottom - l.top })),
      farve: cs.color, px, vaegt, stor: px >= 24 || (px >= 18.66 && vaegt >= 700),
    }
  })
}

// Pixelregning i siden selv (canvas), så ingen billedbibliotek kræves.
// `blandet(alfa)` genskaber, hvad browseren ville tegne med et ensartet
// slør af den givne tæthed over de RÅ fotopixels.
const REGN = async ({ raa, gengivet, farve, underlag, alfaer }) => {
  const laes = async (b64) => {
    if (!b64) return null
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    return g.getImageData(0, 0, c.width, c.height).data
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  // Farven kan være gennemsigtig (rgb(255 255 255 / .84)). Så er det,
  // øjet ser, blandingen af tekst og baggrund — pixel for pixel.
  const [ir, ig, ib, ia = 1] = farve.match(/[\d.]+/g).map(Number)
  const vaerst = (d, bg) => {
    let v = Infinity
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = bg ? bg(d[i], d[i + 1], d[i + 2]) : [d[i], d[i + 1], d[i + 2]]
      const tr = ia * ir + (1 - ia) * r, tg = ia * ig + (1 - ia) * g, tb = ia * ib + (1 - ia) * b
      v = Math.min(v, cr(L(tr, tg, tb), L(r, g, b)))
    }
    return v
  }
  const G = await laes(gengivet), R = await laes(raa)
  const ud = { gengivet: G ? +vaerst(G).toFixed(2) : null, raa: R ? +vaerst(R).toFixed(2) : null, vedAlfa: {} }
  if (R && underlag) {
    const [ur, ug, ub] = underlag
    for (const a of alfaer) {
      ud.vedAlfa[a] = +vaerst(R, (r, g, b) => [a * ur + (1 - a) * r, a * ug + (1 - a) * g, a * ub + (1 - a) * b]).toFixed(2)
    }
  }
  return ud
}

const ALFAER = Array.from({ length: 21 }, (_, i) => +(i * 0.05).toFixed(2))

/**
 * Værste kontrast for hver herotekst mod pixelene bag den — som siden
 * er tegnet, og mod det rå foto. Plus `alfaMin`: det tyndeste ensartede
 * slør (i trin af 0,05), hvormed teksten ville nå sin tærskel på netop
 * dette foto. Står teksten ikke på fotoet, er alfaMin null.
 */
export async function heroKontrast(p) {
  const ud = {}
  const moerk = await lysTekst(p)
  const underlag = moerk ? [20, 22, 26] : [247, 245, 241]
  for (const [navn, sel] of HEROTEKSTER) {
    const m = await tekstKontrast(p, sel, underlag)
    if (m) ud[navn] = m
  }
  return ud
}

/**
 * Står heroens tekst lyst på et mørkt slør (B), eller mørkt på et lyst?
 * Læst af overskriftens BEREGNEDE farve — ikke af en klasse. I runde 3
 * hed B `.m-moerk`; nu er B standarden uden klasse, og et ældre lag
 * (runde 2, runde 3) skal måles med samme kode.
 */
export async function lysTekst(p) {
  return p.evaluate(() => {
    const h = document.querySelector('.hero h1'); if (!h) return false
    const [r, g, b] = getComputedStyle(h).color.match(/[\d.]+/g).map(Number)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128
  })
}

/**
 * VÆRST TÆNKELIGE FOTO. Fotoet byttes ud med en helt hvid flade (lys
 * tekst) eller en helt sort (mørk tekst), og teksten måles mod det, siden
 * så tegner — med lagets eget slør og gradient. Holder det, holder teksten
 * over ETHVERT foto; det er en egenskab ved laget, ikke ved fotoet.
 * Samme greb som scripts/cloud/herokontrol.mjs' «værst tænkelige».
 *
 * `gulv` er det tyndeste ensartede slør (trin af 0,05), hvormed al tekst
 * holder sin tærskel over den flade — regnet af de samme rå pixels som
 * alfaMin. Det er ÉT tal for «hvor tykt skal B's slør mindst være», og
 * maal-foto.mjs bruger det både i dommen og i anvisningen.
 */
export async function vaerstTaenkelige(p) {
  const lys = await lysTekst(p)
  const flade = lys ? '#fff' : '#000'
  const ok = await p.evaluate(async (flade) => {
    const i = document.querySelector('.hero-billede img'); if (!i) return false
    const c = document.createElement('canvas'); c.width = 64; c.height = 64
    const g = c.getContext('2d'); g.fillStyle = flade; g.fillRect(0, 0, 64, 64)
    i.dataset.foer = i.getAttribute('src'); i.dataset.foerSrcset = i.getAttribute('srcset') ?? ''; i.removeAttribute('srcset')
    i.src = c.toDataURL('image/png'); await i.decode().catch(() => {})
    return true
  }, flade)
  if (!ok) return null
  const ud = { flade: lys ? 'hvid' : 'sort', gulv: null }
  const underlag = lys ? [20, 22, 26] : [247, 245, 241]
  for (const [navn, sel] of HEROTEKSTER) {
    const m = await tekstKontrast(p, sel, underlag)
    if (m && m.paaFoto) {
      ud[navn] = { vaerst: m.vaerst, taerskel: m.taerskel, bestaar: m.bestaar, alfaMin: m.alfaMin }
      ud.gulv = ud.gulv === '>1' || m.alfaMin === '>1' ? '>1' : Math.max(ud.gulv ?? 0, m.alfaMin ?? 0)
    }
  }
  await p.evaluate(async () => {
    const i = document.querySelector('.hero-billede img')
    if (i.dataset.foerSrcset) i.setAttribute('srcset', i.dataset.foerSrcset)
    i.src = i.dataset.foer; await i.decode().catch(() => {})
  })
  return ud
}

/**
 * Det, siden er til for: hvor meget af det FØRSTE BOLIGKORT står over
 * folden? Målt ved indlæsning (scrollY = 0) mod vinduets højde.
 *
 * `andel` er den synlige del af kortets højde. `dele` siger for hver del
 * af kortet, om den står HELT over folden — en andel på 0,5 er noget
 * andet, når den halve er billedet, end når den er pris og adresse.
 * `foldFor` er den vindueshøjde, hver del kræver: tallet, der kan holdes
 * op mod en anden telefon end den, der er målt på.
 */
export async function foersteKort(p, { samtykke = false } = {}) {
  return p.evaluate((samtykke) => {
    const k = document.querySelector('a.kort'); if (!k) return null
    // FØRSTE BESØG: samtykkebanneret står fast i bunden af vinduet, og
    // folden er dér, hvor det begynder. Findes banneret ikke, er det en fejl
    // i målingen, ikke en fold på hele skærmen.
    let fold = innerHeight, banner = null
    if (samtykke) {
      const knap = [...document.querySelectorAll('button')].find((b) => /Kun det nødvendige/.test(b.textContent))
      for (let e = knap; e && e !== document.body; e = e.parentElement) {
        if (getComputedStyle(e).position === 'fixed') { banner = e; break }
      }
      if (!banner) return { fejl: 'samtykkebanneret blev ikke fundet' }
      fold = Math.min(innerHeight, Math.round(banner.getBoundingClientRect().top))
    }
    const r = k.getBoundingClientRect(), top = r.top + scrollY
    const DELE = { billede: '.kort-billede', antalBilleder: '.kort-antal', titel: '.kort-overskrift',
      adresse: '.adresse', overtagelse: '.kort-meta', pris: '.kort-pris' }
    const dele = {}, foldFor = {}
    for (const [n, s] of Object.entries(DELE)) {
      const e = k.querySelector(s); if (!e) { dele[n] = null; continue }
      const b = e.getBoundingClientRect(), bund = b.bottom + scrollY
      dele[n] = bund <= fold
      foldFor[n] = Math.ceil(bund)
    }
    foldFor.helt = Math.ceil(r.bottom + scrollY)
    // Hvad kortets højde består af — så en forskel kan forklares med tal.
    const hh = (s) => { const e = k.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : null }
    const krop = k.querySelector('.kort-krop')
    const hoejder = { billedblok: hh('.kort-billedblok'), krop: hh('.kort-krop'), oekonomi: hh('.oekonomi-linje'),
      kropPadding: krop ? getComputedStyle(krop).padding : null }
    return {
      hoejder,
      titel: (k.querySelector('.kort-overskrift')?.textContent || '').trim(),
      top: Math.round(top), hoejde: Math.round(r.height), fold,
      synligPx: Math.round(Math.max(0, Math.min(r.height, fold - top))),
      andel: +Math.max(0, Math.min(1, (fold - top) / r.height)).toFixed(2),
      dele, foldFor, foldVed: samtykke ? 'samtykkebanneret' : 'vinduets bund',
    }
  }, samtykke)
}

/** Værste kontrast for ét tekstelement; med `underlag` også alfaMin. */
export async function tekstKontrast(p, sel, underlag = null) {
  const el = p.locator(sel).first()
  if (!(await el.count())) return null
  const b = await tekstboks(el)
  if (!b.width || !b.height || !b.linjer.length) return null
  const paaFoto = await p.evaluate(({ y, h }) => {
    const f = document.querySelector('.hero-billede'); if (!f) return false
    const r = f.getBoundingClientRect(); const top = r.top + scrollY
    return y < top + r.height && y + h > top
  }, { y: b.y, h: b.height })
  const maalRaa = paaFoto && underlag
  await el.evaluate((e) => { e.dataset.f = e.style.color; e.style.color = 'transparent' })
  const klip = b.linjer.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }))
  const gengivet = []
  for (const clip of klip) gengivet.push((await p.screenshot({ clip, type: 'png', fullPage: true })).toString('base64'))
  const raa = []
  if (maalRaa) {
    const h = await p.addStyleTag({ content: '.hero.har-foto::after{opacity:0!important} .hero{background:none!important}' })
    for (const clip of klip) raa.push((await p.screenshot({ clip, type: 'png', fullPage: true })).toString('base64'))
    await h.evaluate((s) => s.remove())
  }
  await el.evaluate((e) => { e.style.color = e.dataset.f })
  // Værst over alle linjer: mindst af hver linjes værste.
  const pr = []
  for (let i = 0; i < klip.length; i++) {
    pr.push(await p.evaluate(REGN, { raa: raa[i] ?? null, gengivet: gengivet[i], farve: b.farve, underlag: maalRaa ? underlag : null, alfaer: ALFAER }))
  }
  const min = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.min(...v) : null }
  const r = { gengivet: min(pr.map((x) => x.gengivet)), raa: min(pr.map((x) => x.raa)), vedAlfa: {} }
  for (const a of ALFAER) r.vedAlfa[a] = min(pr.map((x) => x.vedAlfa[a]))
  const taerskel = b.stor ? 3 : 4.5
  const alfaMin = maalRaa ? (ALFAER.find((a) => r.vedAlfa[a] >= taerskel) ?? '>1') : null
  return { vaerst: r.gengivet, taerskel, bestaar: r.gengivet >= taerskel, paaFoto, raa: r.raa, alfaMin, farve: b.farve, px: b.px, linjer: klip.length }
}

/**
 * Hvor meget af fotoets egen TEGNING er tilbage? Tegning er kanter og
 * detaljer: den gennemsnitlige lokale luminansforskel mellem nabopixels,
 * som siden tegner fotoet, delt med den samme i det rå foto, over den del
 * af fotoet, der står FRI af søgekortet. 1 = urørt; 0,1 = et slør har
 * visket ni tiendedele af detaljen ud.
 *
 * Ikke spredningen i luminans: et slør, der løber fra 95 % til 35 %,
 * tilføjer selv en stor spredning (et jævnt fald fra lyst til mørkt), og
 * så målte et foto, der næsten var væk, som om det stod. En glat gradient
 * har næsten ingen lokal forskel mellem nabopixels; fotoets kanter har.
 * Teksten gøres gennemsigtig i begge billeder, så bogstaverne ikke tæller.
 *
 * NULPUNKTET. «Næsten ingen» er ikke ingen: et slør, der dækker fotoet
 * helt, målte 0,10–0,13, fordi gradientens dithering selv har lokale
 * forskelle. Derfor måles sløret også over en flad flade (fotoet skjult),
 * og den støj trækkes fra: (gengivet − slørets egen) / rå, klippet til
 * 0–1. `stoej` rapporterer, hvor stort nulpunktet var.
 */
export async function fotoSynlig(p) {
  const r = await p.evaluate(() => {
    const f = document.querySelector('.hero-billede'), k = document.querySelector('.hero-soeg form') || document.querySelector('.hero-soeg')
    if (!f) return null
    const fr = f.getBoundingClientRect(), kr = k ? k.getBoundingClientRect() : { top: Infinity }
    const y0 = Math.max(fr.top, 0) + scrollY, y1 = Math.min(fr.bottom, kr.top) + scrollY
    return { x: Math.max(fr.left, 0), y: y0, width: Math.min(fr.width, innerWidth), height: Math.max(0, y1 - y0) }
  })
  if (!r || r.height < 4) return { frihoejde: r ? Math.round(r.height) : 0, tegningBevaret: null }
  const skjul = await p.addStyleTag({ content: '.hero, .hero * { color: transparent !important; text-shadow: none !important }' })
  const gengivet = (await p.screenshot({ clip: r, type: 'png', fullPage: true })).toString('base64')
  const raaStil = await p.addStyleTag({ content: '.hero.har-foto::after{opacity:0!important}' })
  const raa = (await p.screenshot({ clip: r, type: 'png', fullPage: true })).toString('base64')
  await raaStil.evaluate((s) => s.remove())
  const fladStil = await p.addStyleTag({ content: '.hero-billede img{visibility:hidden!important}' })
  const flad = (await p.screenshot({ clip: r, type: 'png', fullPage: true })).toString('base64')
  await fladStil.evaluate((s) => s.remove()); await skjul.evaluate((s) => s.remove())
  const s = await p.evaluate(async ([a, b, c]) => {
    const kant = async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height
      const L = (x, y) => { const k = (y * w + x) * 4; return 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2] }
      let sum = 0, n = 0
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const l = L(x, y); sum += Math.abs(L(x + 1, y) - l) + Math.abs(L(x, y + 1) - l); n++
      }
      return n ? sum / n : 0
    }
    return [await kant(a), await kant(b), await kant(c)]
  }, [gengivet, raa, flad])
  const [g, raaK, stoej] = s
  const bevaret = raaK ? Math.min(1, Math.max(0, (g - stoej) / raaK)) : null
  return { frihoejde: Math.round(r.height), tegningBevaret: bevaret == null ? null : +bevaret.toFixed(2),
    stoej: raaK ? +(stoej / raaK).toFixed(2) : null }
}

/**
 * «Populære søgninger»: rækker, venstrekanter og mellemrum. En række,
 * der begynder et andet sted end de andre, eller et mellemrum, der er
 * større end gap'en, er det, der læses som skævt.
 *
 * `belast` erstatter byerne med seks lange danske bynavne — en
 * BELASTNINGSPRØVE af linjebruddet, ikke produktionens liste. Seedets fire
 * korte byer brækker også (i dag og i runde 2 på to rækker), men de lange
 * navne viser, hvordan det ser ud med rigtige, længere bynavne.
 */
export const LANGE_BYER = ['København NV', 'Frederiksberg C', 'København S', 'Aarhus C', 'Odense C', 'Kongens Lyngby']
export async function populaere(p, belast = false) {
  return p.evaluate(({ belast, byer }) => {
    const c = document.querySelector('.hero .populaere'); if (!c) return null
    if (belast) {
      const a = [...c.querySelectorAll('a')]
      while (a.length < byer.length) { const n = a[0].cloneNode(true); c.append(n); a.push(n) }
      a.forEach((x, i) => { x.textContent = byer[i] })
    }
    const cr = c.getBoundingClientRect()
    const led = [...c.children].map((e) => ({ by: e.tagName === 'A', r: e.getBoundingClientRect() }))
    const raekker = []
    for (const l of led) {
      const r = raekker.find((x) => Math.abs(x.top - l.r.top) < 4)
      r ? r.led.push(l) : raekker.push({ top: l.r.top, led: [l] })
    }
    const mell = []
    for (const r of raekker) for (let i = 1; i < r.led.length; i++) mell.push(Math.round(r.led[i].r.left - r.led[i - 1].r.right))
    // Venstrekanten, hvor hver rækkes første BY står.
    const kanter = raekker.map((r) => r.led.find((l) => l.by)).filter(Boolean).map((l) => Math.round(l.r.left - cr.left))
    return {
      raekker: raekker.length,
      byKanter: [...new Set(kanter)],
      mellemrum: [...new Set(mell)].sort((a, b) => a - b),
      hoejde: Math.round(cr.height),
      overloeb: led.some((l) => l.r.right > cr.right + 0.5),
    }
  }, { belast, byer: LANGE_BYER })
}

/** Hvor langt nede står heroens nederste tekstlinje, i % af heroens højde?
 *  B's gradient har fuld tæthed til 58 % (greb.css § 6). */
export async function tekstBund(p) {
  return p.evaluate((sel) => {
    const h = document.querySelector('.hero'); if (!h) return null
    const hr = h.getBoundingClientRect(); let bund = 0
    for (const s of sel) {
      const e = document.querySelector(s); if (!e) continue
      const r = document.createRange(); r.selectNodeContents(e)
      for (const q of r.getClientRects()) if (q.width > 1) bund = Math.max(bund, q.bottom)
    }
    return +(((bund - hr.top) / hr.height) * 100).toFixed(1)
  }, ['.hero-oejenbryn', '.hero h1', '.hero-manchet'])
}

/**
 * Hvor står krediteringen, hvor stor er den, og kan den SES?
 *
 * Alle kandidater tælles — `.hero-kredit` (page.tsx i dag) og
 * `.fotokredit` (en markupflytning til fodnoten). «Synlig» kræver alt
 * dette, ellers tæller elementet ikke:
 *   · det har en kasse, der ikke er nul, og ligger inden for siden;
 *   · display, visibility og opacity skjuler det ikke (heller ikke via
 *     en forælder);
 *   · det er ikke DÆKKET: elementFromPoint i tre punkter langs HVER linjes
 *     kasse rammer elementet selv — ikke søgekortet ovenpå;
 *   · det står ikke OVEN PÅ anden tekst (elementsFromPoint i de samme
 *     punkter rammer ingen anden tekstknudes linjekasse);
 *   · teksten er ikke tom.
 * Kontrasten måles bagefter mod de faktiske pixels (tekstKontrast).
 */
export async function kreditering(p) {
  const r = await p.evaluate(() => {
    const alle = [...document.querySelectorAll('.hero-kredit, .fotokredit')]
    const ud = alle.map((e, i) => {
      e.dataset.kreditNr = String(i)
      const tekst = (e.textContent || '').trim()
      const rr = e.getBoundingClientRect(), cs = getComputedStyle(e)
      let skjult = !e.getClientRects().length || !tekst
      for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
        const s = getComputedStyle(x)
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) skjult = true
      }
      const yTop = rr.top + scrollY, yBund = rr.bottom + scrollY
      const iSiden = rr.width > 1 && rr.height > 1 && rr.left >= -0.5 && rr.right <= document.documentElement.clientWidth + 0.5 &&
        yTop >= 0 && yBund <= document.documentElement.scrollHeight + 0.5
      // Dækket? Rul elementet ind i vinduet, og spørg, hvad der ligger
      // øverst — i HVER LINJES egen kasse. En linje, der brækker, har en
      // samlet kasse, hvis midte ligger mellem linjerne og ved siden af
      // teksten; prøvet dér, meldte en læselig fodnote sig «dækket» (360).
      let daekket = 0, proever = 0
      const range = document.createRange(); range.selectNodeContents(e)
      const gemY = scrollY; window.scrollTo(0, Math.max(0, yTop - innerHeight / 2))
      // OG står den OVEN PÅ anden tekst? Så er den øverst og «synlig», men
      // to tekster oven i hinanden kan ingen læse. Under hvert punkt
      // gennemgås stakken (elementsFromPoint): rammer punktet en anden
      // tekstknudes egen linjekasse, overlapper krediteringen tekst.
      let overlap = 0
      const tekstUnder = (x, y) => {
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === e || e.contains(el) || el.contains(e)) continue
          for (const n of el.childNodes) {
            if (n.nodeType !== 3 || !n.textContent.trim()) continue
            const r = document.createRange(); r.selectNodeContents(n)
            for (const q of r.getClientRects()) if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return true
          }
        }
        return false
      }
      for (const lr of [...range.getClientRects()].filter((x) => x.width > 2 && x.height > 2)) {
        for (const f of [0.1, 0.5, 0.9]) {
          proever++
          const x = lr.left + f * lr.width, y = lr.top + lr.height / 2
          const top = document.elementFromPoint(x, y)
          if (!top || !(top === e || e.contains(top))) daekket++
          else if (tekstUnder(x, y)) overlap++
        }
      }
      if (!proever) daekket = 1
      window.scrollTo(0, gemY)
      const linjer = new Set([...range.getClientRects()].filter((x) => x.width > 2 && x.height > 2).map((x) => Math.round(x.top))).size
      return {
        nr: i, linjer, hvor: e.classList.contains('fotokredit') ? 'fodnote' : (e.closest('.hero') ? 'hero' : 'andet'),
        tekst, y: Math.round(yTop), iFoersteVisning: yTop < innerHeight,
        px: parseFloat(cs.fontSize), farve: cs.color, baggrund: cs.backgroundColor,
        skjult, iSiden, daekket: `${daekket}/${proever}`, overlap: `${overlap}/${proever}`,
        synlig: !skjult && iSiden && daekket === 0 && overlap === 0,
      }
    })
    return ud
  })
  for (const k of r) {
    if (k.synlig) {
      const m = await tekstKontrast(p, `[data-kredit-nr="${k.nr}"]`)
      k.kontrast = m?.vaerst ?? null
      k.laeselig = k.kontrast != null && k.kontrast >= 4.5
    }
  }
  const synlige = r.filter((k) => k.synlig && k.laeselig)
  // Bagudkompatibelt med runde 3's maal.json: findes/hvor/y for den første.
  const f = synlige[0] || r[0]
  return {
    findes: !!f, hvor: f?.hvor ?? null, y: f?.y ?? null, iFoersteVisning: f?.iFoersteVisning ?? null,
    px: f?.px ?? null, farve: f?.farve ?? null, kontrast: f?.kontrast ?? null, linjer: f?.linjer ?? null,
    antalSynlige: synlige.length, kandidater: r,
    dom: synlige.length === 1 ? 'OK' : synlige.length === 0 ? 'INGEN SYNLIG KREDITERING' : `${synlige.length} KREDITERINGER`,
  }
}
