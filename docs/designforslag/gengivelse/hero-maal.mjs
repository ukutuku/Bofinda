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
async function tekstboks(el) {
  return el.evaluate((e) => {
    const r = document.createRange(); r.selectNodeContents(e)
    const b = r.getBoundingClientRect()
    const cs = getComputedStyle(e)
    const px = parseFloat(cs.fontSize), vaegt = Number(cs.fontWeight) || 400
    return {
      x: b.x, y: b.y + scrollY, width: b.width, height: b.height,
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
  const moerk = await p.evaluate(() => !!document.querySelector('.hero.m-moerk'))
  const underlag = moerk ? [20, 22, 26] : [247, 245, 241]
  for (const [navn, sel] of HEROTEKSTER) {
    const m = await tekstKontrast(p, sel, underlag)
    if (m) ud[navn] = m
  }
  return ud
}

/** Værste kontrast for ét tekstelement; med `underlag` også alfaMin. */
export async function tekstKontrast(p, sel, underlag = null) {
  const el = p.locator(sel).first()
  if (!(await el.count())) return null
  const b = await tekstboks(el)
  if (!b.width || !b.height) return null
  const clip = { x: b.x, y: b.y, width: b.width, height: b.height }
  const paaFoto = await p.evaluate(({ y, h }) => {
    const f = document.querySelector('.hero-billede'); if (!f) return false
    const r = f.getBoundingClientRect(); const top = r.top + scrollY
    return y < top + r.height && y + h > top
  }, { y: b.y, h: b.height })
  const maalRaa = paaFoto && underlag
  await el.evaluate((e) => { e.dataset.f = e.style.color; e.style.color = 'transparent' })
  const gengivet = (await p.screenshot({ clip, type: 'png', fullPage: true })).toString('base64')
  let raa = null
  if (maalRaa) {
    const h = await p.addStyleTag({ content: '.hero.har-foto::after{opacity:0!important} .hero{background:none!important}' })
    raa = (await p.screenshot({ clip, type: 'png', fullPage: true })).toString('base64')
    await h.evaluate((s) => s.remove())
  }
  await el.evaluate((e) => { e.style.color = e.dataset.f })
  const r = await p.evaluate(REGN, { raa, gengivet, farve: b.farve, underlag: maalRaa ? underlag : null, alfaer: ALFAER })
  const taerskel = b.stor ? 3 : 4.5
  const alfaMin = maalRaa ? (ALFAER.find((a) => r.vedAlfa[a] >= taerskel) ?? '>1') : null
  return { vaerst: r.gengivet, taerskel, bestaar: r.gengivet >= taerskel, paaFoto, raa: r.raa, alfaMin, farve: b.farve, px: b.px }
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

/** Hvor står krediteringen, hvor stor er den, og kan den læses? */
export async function kreditering(p) {
  return p.evaluate(() => {
    const e = document.querySelector('.hero-kredit') || document.querySelector('.fotokredit')
    if (!e || !e.getClientRects().length) return { findes: false }
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
    return {
      findes: true, hvor: e.classList.contains('fotokredit') ? 'fodnote' : 'hero',
      y: Math.round(r.top + scrollY), iFoersteVisning: r.top + scrollY < innerHeight,
      px: parseFloat(cs.fontSize), farve: cs.color, baggrund: cs.backgroundColor,
    }
  })
}
