// Kør: MAPPE=<udmappe> MED=<bolig-id med billeder> UDEN=<bolig-id uden> node maal-farver-fejning.mjs
// (appen på 127.0.0.1:3100). Skriver raa3.json i MAPPE. Skrevet af verifikatoren 30.09.
// Skeptikerens farvefejning på RUNDE 3. Samme metode som
// scratchpad/r3/farver/maal.mjs (getComputedStyle + CDP-kaskade), men:
//  · laget er docs/designforslag/{forslag.css,greb.css,greb.js} (runde 3),
//  · mockuppen lægges på med hero-maal.mjs' laegPaa (efter hydreringen),
//  · valg = { mobil: 'baand', foto: heltefoto.json } (+ 'moerk' på forsiden i 390/360),
//  · bredder 1440, 390, 360,
//  · fejningen tager ALLE kulører (ikke kun h 130–200) og også
//    baggrundsgradienter, box-shadow, accent-color og ::placeholder.
// Rører ingen fil i repoet. Skriver kun i denne mappe.
import pw from '/home/user/Bofinda/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { aabn, gaaTil, laegPaa, HOEJDE } from '/home/user/Bofinda/docs/designforslag/gengivelse/hero-maal.mjs'

const MAPPE = process.env.MAPPE ?? process.cwd()
const ROD = '/home/user/Bofinda'
const LAG = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const BASE = 'http://127.0.0.1:3100'
const MED = process.env.MED, UDEN = process.env.UDEN
if (!MED || !UDEN) { console.error('MED og UDEN skal sættes'); process.exit(2) }
const FOTO = JSON.parse(fs.readFileSync(`${LAG}/heltefoto.json`, 'utf8'))
const JS = fs.readFileSync(`${LAG}/greb.js`, 'utf8')

const SIDER = [
  ['forside', '/'],
  ['soeg', '/?sted=Attrapby'],
  ['bolig-med-billeder', `/bolig/${MED}`],
  ['bolig-uden-billeder', `/bolig/${UDEN}`],
]
const EKSTRA_SMAL = [['soeg-kort-valgt', '/?sted=Attrapby&kort=1']]

const MAAL = [
  { id: 'opret', navn: '«Opret annonce» i headeren', sel: 'header.top .tophandlinger .nav-primaer' },
  { id: 'soeg', navn: '«Søg»-knappen', sel: 'button.soegeknap' },
  { id: 'ordmaerke', navn: 'Ordmærket BOFINDA', sel: 'header.top .maerke' },
  { id: 'naal-a', navn: 'Nål a: ikonet i «By eller område»', sel: '.soegefelt.sf-sted', pseudo: 'before' },
  { id: 'naal-b', navn: 'Nål b: ved postnummer/by på boligsiden', sel: '.detalje-hoved .sted', pseudo: 'before' },
  { id: 'naal-c', navn: 'Nål c: markør på kortet (ikke valgt)', sel: '.maerke-boble:not(.valgt)' },
  { id: 'naal-d', navn: 'Nål d: ikonet i «Vis kort»', sel: '.soegebar .kortvalg .kv-ikon' },
  { id: 'se-annoncen', navn: '«Se annoncen» i railen', sel: '.oek-kort .knap' },
]
const EGENSKABER = ['color', 'background-color', 'border-top-color', 'opacity']
const KORT = {
  'color': ['color'],
  'background-color': ['background-color', 'background'],
  'background-image': ['background-image', 'background'],
  'border-top-color': ['border-top-color', 'border-color', 'border-top', 'border'],
  'border-right-color': ['border-right-color', 'border-color', 'border-right', 'border'],
  'border-bottom-color': ['border-bottom-color', 'border-color', 'border-bottom', 'border'],
  'border-left-color': ['border-left-color', 'border-color', 'border-left', 'border'],
  'outline-color': ['outline-color', 'outline'],
  'text-decoration-color': ['text-decoration-color', 'text-decoration'],
  'box-shadow': ['box-shadow'],
  'fill': ['fill'], 'stroke': ['stroke'], 'accent-color': ['accent-color'],
  'opacity': ['opacity'],
}

// ─── Kaskadeopslag (fra maal.mjs) ─────────────────────────────
function vinder(regler, navne) {
  let bedst = null
  for (const rm of regler) {
    const rule = rm.rule
    const props = rule.style?.cssProperties ?? []
    const kand = props.filter((p) => !p.disabled && p.parsedOk !== false && navne.includes(p.name))
    if (!kand.length) continue
    const forfattet = kand.filter((p) => p.range)
    const fund = (forfattet.length ? forfattet : kand).at(-1)
    if (!fund) continue
    const imp = !!fund.important
    if (!bedst || imp || !bedst.important) bedst = { ...fund, important: imp, rule }
  }
  return bedst
}
function kaede(m, pseudo) {
  const k = []
  if (pseudo) { const pm = (m.pseudoElements || []).find((p) => p.pseudoType === pseudo); k.push(pm ? pm.matches : []) }
  k.push(m.matchedCSSRules || [])
  for (const inh of m.inherited || []) k.push(inh.matchedCSSRules || [])
  return k
}
function findDekl(k, navn, arves) {
  for (let i = 0; i < k.length; i++) {
    const d = vinder(k[i], KORT[navn] || [navn])
    if (d) return { d, led: i }
    if (!arves) return null
  }
  return null
}
function beskriv(ark, dekl) {
  if (!dekl) return null
  const h = ark.get(dekl.rule.styleSheetId) || {}
  const url = h.sourceURL || (dekl.rule.origin === 'user-agent' ? 'user-agent' : (dekl.rule.origin === 'inline' ? 'style-attribut' : ''))
  let fil = url.replace(/\?v=\d+$/, '')
  if (/forslag\.css/.test(fil)) fil = 'docs/designforslag/forslag.css'
  else if (/greb\.css/.test(fil)) fil = 'docs/designforslag/greb.css'
  else if (/_next\/static\/css/.test(fil)) fil = 'app/globals.css (bundt)'
  const linje = dekl.range ? dekl.range.startLine + 1 : null
  return { selektor: dekl.rule.selectorList?.text ?? '', egenskab: dekl.name, vaerdi: dekl.value + (dekl.important ? ' !important' : ''), fil, linjeIArk: linje, oprindelse: dekl.rule.origin }
}
function varKaede(k, ark, vaerdi, dybde = 0) {
  const ud = []
  const m = /var\(\s*(--[\w-]+)/.exec(vaerdi || '')
  if (!m || dybde > 8) return ud
  for (let i = 0; i < k.length; i++) {
    const d = vinder(k[i], [m[1]])
    if (d) { ud.push({ token: m[1], ...beskriv(ark, d) }); ud.push(...varKaede(k.slice(i), ark, d.value, dybde + 1)); return ud }
  }
  ud.push({ token: m[1], vaerdi: '(ikke defineret)' })
  return ud
}
async function kildeFor(cdp, ark, sel, pseudo, egenskab) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel })
  if (!nodeId) return null
  // Inline style-attribut tæller også (greb.js sætter --hero-* dér).
  const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
  const inl = m.inlineStyle ? [{ rule: { style: m.inlineStyle, origin: 'inline', selectorList: { text: 'style=""' } } }] : []
  const k = kaede({ ...m, matchedCSSRules: [...(m.matchedCSSRules || []), ...inl] }, pseudo)
  const f = findDekl(k, egenskab, egenskab === 'color')
  if (!f) return { vaerdi: '(ingen regel / initial)' }
  const b = beskriv(ark, f.d); b.arvetFraLed = f.led; b.tokens = varKaede(k.slice(f.led), ark, f.d.value)
  if (/currentcolor/i.test(f.d.value) && egenskab !== 'color') {
    const c = findDekl(k, 'color', true)
    if (c) { b.currentColor = beskriv(ark, c.d); b.currentColor.tokens = varKaede(k.slice(c.led), ark, c.d.value) }
  }
  return b
}

// ─── I siden ──────────────────────────────────────────────────
const I_SIDEN = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const parse = (s) => {
    if (!s || s === 'none' || s === 'transparent') return null
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s.trim())
    if (m) { const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a] }
    if (/^(url|linear|radial|conic)/.test(s)) return null
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const alleFarver = (s) => (String(s).match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) || []).map(parse).filter(Boolean)
  const hex = (c) => '#' + c.slice(0, 3).map((x) => x.toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '')
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
    let h = 0, s = 0
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360 }
    return { h, s, l }
  }
  const kroma = (c) => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255
  const kuloert = (c) => c && c[3] > 0.02 && kroma(c) >= 0.025
  const effOpacitet = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o }
  const bagved = (el, medSelv = false) => {
    for (let e = medSelv ? el : el.parentElement; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor)
      if (c && c[3] > 0.99) return c
    }
    return [255, 255, 255, 1]
  }
  const bland = (fg, a, bg) => fg.slice(0, 3).map((x, i) => Math.round(x * a + bg[i] * (1 - a)))
  const synlig = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 1 || r.height <= 1) return false
    const cs = getComputedStyle(el)
    if (/rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)') return false
    const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight
    const x0 = r.left + scrollX, y0 = r.top + scrollY
    if (x0 + r.width <= 0 || y0 + r.height <= 0 || x0 >= W || y0 >= H) return false
    const lc = el.closest('.leaflet-container')
    if (lc && lc !== el) { const c = lc.getBoundingClientRect(); if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) return false }
    // Klippet af en forfader med overflow (fx en lukket details)?
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (s.overflow !== 'visible' || s.overflowX !== 'visible') {
        const q = e.getBoundingClientRect()
        if (r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom) return false
      }
    }
    return true
  }
  const egenTekst = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()
  const kortSel = (el, pseudo) => {
    const en = (e) => {
      if (!e || e === document.documentElement) return ''
      const kl = [...(e.classList || [])].filter((c) => !/^(__|jsx-|leaflet-(zoom|interactive|marker-icon))/.test(c)).slice(0, 3)
      return e.tagName.toLowerCase() + (e.id && !/^kort-/.test(e.id) ? '#' + e.id : '') + kl.map((c) => '.' + c).join('')
    }
    let s = en(el)
    if (!(el.classList && el.classList.length)) s = `${en(el.parentElement)} > ${s}`
    return s + (pseudo ? '::' + pseudo : '')
  }
  const KENDT = '.kort-pris:not(.kun-leje), .oek-tal:not(.ukendt-tal), .gemt-pris:not(.kun-leje)'
  const FORMER = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'tspan', 'use'])
  let nr = 0
  window.__farve = {
    element(sel, pseudo) {
      const alle = [...document.querySelectorAll(sel)]
      if (!alle.length) return { findes: false, antal: 0 }
      const el = alle.find((e) => synlig(e)) || alle[0]
      const cs = getComputedStyle(el, pseudo ? '::' + pseudo : null)
      const ud = { findes: true, antal: alle.length, synlig: synlig(el) }
      for (const p of ['color', 'background-color', 'border-top-color', 'opacity']) {
        const v = cs.getPropertyValue(p); ud[p] = v
        const c = /color/.test(p) ? parse(v) : null
        if (c) ud[p + '-hex'] = hex(c)
      }
      const op = pseudo ? parseFloat(cs.opacity) * effOpacitet(el) : effOpacitet(el)
      ud['effektiv-opacitet'] = +op.toFixed(3)
      const bg = parse(cs.backgroundColor), fg = parse(cs.color)
      const under = pseudo ? bagved(el, true) : bagved(el)
      if (bg && bg[3] > 0) ud['tegnet-flade'] = '#' + bland(bg, bg[3] * op, under).map((x) => x.toString(16).padStart(2, '0')).join('')
      const fladeUnderTekst = bg && bg[3] > 0.99 ? bg : under
      if (fg) ud['tegnet-tekst'] = '#' + bland(fg, fg[3] * op, fladeUnderTekst).map((x) => x.toString(16).padStart(2, '0')).join('')
      ud.tekst = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      el.setAttribute('data-maal', sel)
      return ud
    },
    tokens() {
      const cs = getComputedStyle(document.documentElement)
      return Object.fromEntries(['--kendt', '--handlingsflade', '--handlingsflade-hover', '--accent', '--accent-mrk', '--accent-lys', '--blaek', '--blaek-hover', '--daempet', '--advarsel', '--advarsel-lys', '--fokus']
        .map((t) => [t, cs.getPropertyValue(t).trim() || null]))
    },
    fej() {
      const fund = []
      for (const el of document.querySelectorAll('body *')) {
        if (!synlig(el)) continue
        const erSvg = el instanceof SVGElement
        const form = erSvg && FORMER.has(el.tagName.toLowerCase())
        for (const pseudo of [null, 'before', 'after', 'placeholder']) {
          if (pseudo === 'placeholder' && !(/^(INPUT|TEXTAREA)$/.test(el.tagName) && el.placeholder && !el.value)) continue
          const cs = getComputedStyle(el, pseudo ? '::' + pseudo : null)
          if (pseudo === 'before' || pseudo === 'after') {
            if (!cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue
            if (parseFloat(cs.opacity) === 0) continue
          }
          const op = effOpacitet(el) * (pseudo === 'before' || pseudo === 'after' ? parseFloat(cs.opacity) : 1)
          if (op < 0.02) continue
          const tekst = pseudo === 'placeholder' ? el.placeholder : pseudo ? cs.content.replace(/^["']|["']$/g, '').trim() : egenTekst(el)
          const inputTekst = !pseudo && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value ? el.value : ''
          const tjek = []
          if (tekst || inputTekst || (form && (cs.fill === cs.color || cs.stroke === cs.color))) tjek.push('color')
          if (pseudo !== 'placeholder') {
            tjek.push('background-color', 'background-image')
            for (const side of ['top', 'right', 'bottom', 'left']) {
              if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && !/none|hidden/.test(cs.getPropertyValue(`border-${side}-style`))) tjek.push(`border-${side}-color`)
            }
            if (form) {
              if (cs.fill && cs.fill !== 'none') tjek.push('fill')
              if (cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) tjek.push('stroke')
            }
            if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) tjek.push('outline-color')
            if (cs.textDecorationLine && cs.textDecorationLine !== 'none' && (tekst || (el.textContent || '').trim())) tjek.push('text-decoration-color')
            if (cs.boxShadow && cs.boxShadow !== 'none') tjek.push('box-shadow')
            if (el.tagName === 'INPUT' && /checkbox|radio|range/.test(el.type) && cs.accentColor !== 'auto') tjek.push('accent-color')
          }
          for (const p of tjek) {
            const v = cs.getPropertyValue(p)
            const farver = p === 'background-image' || p === 'box-shadow' ? alleFarver(v) : [parse(v)].filter(Boolean)
            for (const c of farver) {
              if (!kuloert(c)) continue
              const h = hsl(c), a = c[3] * op
              const under = p === 'color' ? (() => { const b = parse(cs.backgroundColor); return b && b[3] > 0.99 ? b : bagved(el, !!pseudo) })() : bagved(el, !!pseudo)
              const tegnet = a < 0.999 ? '#' + bland(c, a, under).map((x) => x.toString(16).padStart(2, '0')).join('') : hex(c).slice(0, 7)
              if (!el.dataset.fej) el.dataset.fej = String(++nr)
              fund.push({
                fejNr: el.dataset.fej, pseudo, egenskab: p, hex: hex(c), tegnetHex: tegnet, bagvedHex: hex(under),
                hsl: [Math.round(h.h), +h.s.toFixed(3), +h.l.toFixed(3)], kroma: +kroma(c).toFixed(3), alfa: +a.toFixed(3),
                selektor: kortSel(el, pseudo),
                tekst: (tekst || inputTekst || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 50),
                kendtBeloeb: !!el.closest(KENDT),
                iHero: !!el.closest('.hero'), iBaand: !!el.closest('.udlejerbaand'),
                maskeIkon: !!(cs.maskImage && cs.maskImage !== 'none') || !!(cs.webkitMaskImage && cs.webkitMaskImage !== 'none'),
                rekt: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)] })(),
              })
            }
          }
        }
      }
      return fund
    },
  }
}

// ─── Kørsel ───────────────────────────────────────────────────
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const resultat = { elementer: [], tokens: [], fejning: [], hover: [], kontrol: [], kilder: {} }

async function forbered(p, mobil) {
  // Laget som filer (sourceURL = stien), så kaskadeopslaget kan navngive filen.
  await p.addStyleTag({ path: `${LAG}/forslag.css` })
  await p.addStyleTag({ path: `${LAG}/greb.css` })
  await laegPaa(p, { css: '', js: JS, valg: { mobil, foto: FOTO } })
  await p.evaluate(I_SIDEN)
  if (await p.$('.landkort-flade')) {
    const vises = await p.evaluate(() => { const e = document.querySelector('.landkort-flade'); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' })
    if (vises) {
      await p.evaluate(() => document.querySelector('.landkort-flade').scrollIntoView({ block: 'center' }))
      try { await p.waitForSelector('.maerke-boble', { timeout: 30000 }) } catch {}
      await p.waitForTimeout(800); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300)
    }
  }
}

const KOERSLER = []
for (const w of [1440, 390, 360]) {
  const sider = w === 1440 ? SIDER : [...SIDER, ...EKSTRA_SMAL]
  for (const [side, sti] of sider) KOERSLER.push({ w, side, sti, mobil: 'baand' })
  if (w !== 1440) KOERSLER.push({ w, side: 'forside', sti: '/', mobil: 'moerk' })
}

for (const w of [1440, 390, 360]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: HOEJDE(w) }, deviceScaleFactor: 1 })
  const p = await aabn(ctx, BASE)
  const cdp = await ctx.newCDPSession(p)
  const ark = new Map()
  cdp.on('CSS.styleSheetAdded', (e) => ark.set(e.header.styleSheetId, e.header))
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
  for (const k of KOERSLER.filter((x) => x.w === w)) {
    await gaaTil(p, BASE + k.sti)
    await forbered(p, k.mobil)
    const tag = `${k.mobil}/${w}/${k.side}`
    process.stdout.write(tag + '\n')
    resultat.tokens.push({ tag, ...(await p.evaluate(() => window.__farve.tokens())) })
    resultat.kontrol.push({ tag, ...(await p.evaluate(() => ({
      heroKlasse: document.querySelector('.hero')?.className ?? null,
      heroStil: document.querySelector('.hero')?.getAttribute('style') ?? null,
      fotoSrc: document.querySelector('.hero-billede img')?.getAttribute('src') ?? null,
      soegFaner: !!document.querySelector('.soeg-faner'), ubKort: !!document.querySelector('.ub-kort'),
      fotokredit: document.querySelector('.fotokredit')?.textContent ?? null, heroKredit: !!document.querySelector('.hero-kredit'),
      samtykke: !!document.querySelector('.samtykke-knapper'),
      stilark: [...document.styleSheets].map((s) => s.href || (s.ownerNode?.textContent || '').slice(-80).replace(/\s+/g, ' ')).filter((x) => /forslag|greb/.test(x)),
    }))) })
    for (const m of MAAL) {
      const maalt = await p.evaluate(([s, ps]) => window.__farve.element(s, ps), [m.sel, m.pseudo || null])
      let kilde = null
      if (maalt.findes) {
        kilde = {}
        for (const e of ['color', 'background-color', 'border-top-color']) kilde[e] = await kildeFor(cdp, ark, `[data-maal="${m.sel.replace(/"/g, '\\"')}"]`, m.pseudo, e)
      }
      resultat.elementer.push({ tag, bredde: w, side: k.side, mobil: k.mobil, id: m.id, navn: m.navn, ...maalt, kilde })
    }
    if (k.side !== 'soeg-kort-valgt') {
      const f = await p.evaluate(() => window.__farve.fej())
      // Kilde for hver (selektor, egenskab)-gruppes første forekomst.
      const set = new Set()
      for (const x of f) {
        const nk = `${x.selektor}|${x.egenskab}|${x.hex}`
        if (!set.has(nk) && !resultat.kilder[nk]) {
          set.add(nk)
          const ps = x.pseudo === 'before' || x.pseudo === 'after' ? x.pseudo : null
          const eg = x.egenskab === 'color' && x.pseudo === 'placeholder' ? 'color' : x.egenskab
          resultat.kilder[nk] = x.pseudo === 'placeholder' ? { note: '::placeholder (ikke slået op)' } : await kildeFor(cdp, ark, `[data-fej="${x.fejNr}"]`, ps, eg).catch((e) => ({ fejl: String(e) }))
        }
        resultat.fejning.push({ tag, bredde: w, side: k.side, mobil: k.mobil, ...x })
      }
    }
    // Valgt markør
    if (/^soeg/.test(k.side) && await p.$('.maerke-boble')) {
      await p.locator('.maerke-boble').first().click({ force: true }).catch(() => {})
      await p.waitForTimeout(900)
      const maalt = await p.evaluate(() => window.__farve.element('.maerke-boble.valgt', null))
      resultat.elementer.push({ tag, bredde: w, side: k.side, mobil: k.mobil, id: 'naal-c-valgt', navn: 'markør valgt', ...maalt })
      if (k.side === 'soeg') {
        const f = await p.evaluate(() => window.__farve.fej())
        for (const x of f) resultat.fejning.push({ tag: tag + '+valgt', bredde: w, side: k.side + '+valgt', mobil: k.mobil, ...x })
      }
      await p.evaluate(() => scrollTo(0, 0))
    }
    // Hover og fokus på det, der kan trykkes på (kun 1440 + 390 forside/bolig).
    if (w !== 360 && k.mobil === 'baand') {
      const HOV = [['opret', 'header.top .tophandlinger .nav-primaer'], ['soeg', 'button.soegeknap'], ['ordmaerke', 'header.top .maerke'],
        ['se-annoncen', '.oek-kort .knap'], ['fane', '.soeg-faner a:not([aria-current])'], ['populaer', '.hero .populaere a'],
        ['kortvalg', '.soegebar .kortvalg'], ['side-link', '.sider a'], ['filterknap', '.filterknap'], ['ub-knap', '.ub-knap'],
        ['chip', '.filterchips .chip'], ['galleri-flere', 'button.flere'], ['sti-tilbage', '.sti-tilbage'], ['kort', 'a.kort']]
      for (const [id, sel] of HOV) {
        const loc = p.locator(sel).first()
        if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) continue
        await loc.scrollIntoViewIfNeeded().catch(() => {})
        await loc.hover({ force: true }).catch(() => {}); await p.waitForTimeout(500)
        const hov = await p.evaluate((s) => {
          const el = document.querySelector(s); const cs = getComputedStyle(el)
          return { color: cs.color, bg: cs.backgroundColor, bgImg: cs.backgroundImage, kant: cs.borderTopColor, deko: cs.textDecorationColor, skygge: cs.boxShadow, outline: cs.outlineStyle === 'none' ? null : cs.outlineColor }
        }, sel)
        await p.mouse.move(1, 1); await p.waitForTimeout(200)
        await loc.focus().catch(() => {}); await p.keyboard.press('Shift'); await p.waitForTimeout(200)
        const fok = await p.evaluate((s) => { const el = document.activeElement; const cs = getComputedStyle(el); return { aktiv: el.matches(s), outline: cs.outlineStyle === 'none' ? null : `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`, skygge: cs.boxShadow } }, sel)
        await p.evaluate(() => document.activeElement?.blur())
        resultat.hover.push({ tag, id, sel, hover: hov, fokus: fok })
      }
      await p.evaluate(() => scrollTo(0, 0))
    }
    // Beskårne billeder
    for (const [id, sel] of [['header', 'header.top'], ['hero', '.hero'], ['soegebar', '.soegebar'], ['sted', '.detalje-hoved .sted'], ['kort', '.landkort-flade'], ['baand', '.udlejerbaand'], ['rail', '.oek-kort']]) {
      const el = await p.$(sel); if (!el) continue
      const box = await el.boundingBox(); if (!box || box.width < 2) continue
      await el.screenshot({ path: `${MAPPE}/beskaar/${k.mobil}-${w}-${k.side}-${id}.png` }).catch(() => {})
    }
    await p.screenshot({ path: `${MAPPE}/beskaar/_hel-${k.mobil}-${w}-${k.side}.png`, fullPage: true }).catch(() => {})
  }
  await ctx.close()
}
await browser.close()
resultat.meta = {
  maalt: new Date().toISOString(), base: BASE, data: 'SYNTETISK seed, isoleret lokal Postgres',
  boliger: { MED, UDEN },
  lag: Object.fromEntries(['forslag.css', 'greb.css', 'greb.js', 'heltefoto.json'].map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(`${LAG}/${f}`)).digest('hex').slice(0, 16)])),
  globalsSha: crypto.createHash('sha256').update(fs.readFileSync(`${ROD}/app/globals.css`)).digest('hex').slice(0, 16),
}
fs.writeFileSync(`${MAPPE}/raa3.json`, JSON.stringify(resultat, null, 1))
process.stdout.write('FÆRDIG\n')
