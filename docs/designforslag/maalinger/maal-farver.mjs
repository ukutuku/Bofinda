// ═══════════════════════════════════════════════════════════════
//  Farverevision: hvilke farver STÅR på skærmen — målt i browseren med
//  getComputedStyle, ikke læst i CSS'en. To tilstande (før / runde 2),
//  fire sider (+ søgesiden med kortet valgt i 390), bredderne 1440 og 390.
//  Syntetiske data fra den isolerede testbase. Rører ingen fil i repoet.
//
//  Kilden til hver farve findes med Chromes egen kaskade
//  (CDP CSS.getMatchedStylesForNode): den vindende deklaration, og så
//  var()-kæden fulgt til en bogstavelig værdi. Linjenummeret findes ved at
//  slå reglens selektor + deklaration op i de rigtige filer.
// ═══════════════════════════════════════════════════════════════
import pw from '/home/user/Bofinda/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import crypto from 'node:crypto'

// Kørt 30.09 fra en arbejdsmappe. Igen:
//   MAPPE=<udmappe> LAG=<mappe med runde 2-lagets forslag.css/greb.css/greb.js>
//   MED=<bolig-id med billeder> UDEN=<bolig-id uden> node maal-farver.mjs
// (runde3.sh lægger runde 2-laget i <udmappe>/.runde2-lag.)
const MAPPE = process.env.MAPPE ?? 'farver-ud'
const LAG = process.env.LAG ?? '.runde2-lag'
const ROD = '/home/user/Bofinda'
const BASE = 'http://127.0.0.1:3100'
const MED = process.env.MED, UDEN = process.env.UDEN
if (!MED || !UDEN) { console.error('MED og UDEN skal sættes'); process.exit(2) }

const SIDER = [
  ['forside', '/'],
  ['soeg', '/?sted=Attrapby'],
  ['bolig-med-billeder', `/bolig/${MED}`],
  ['bolig-uden-billeder', `/bolig/${UDEN}`],
]
// Kortet vises ikke i 390 uden at være valgt («på en smal ses listen»).
// For at kunne svare på markørernes farve i 390 måles én ekstra side dér.
const EKSTRA_390 = [['soeg-kort-valgt', '/?sted=Attrapby&kort=1']]

const MAAL = [
  { id: 'opret', navn: '«Opret annonce» i headeren', sel: 'header.top .tophandlinger .nav-primaer' },
  { id: 'soeg', navn: '«Søg»-knappen', sel: 'button.soegeknap' },
  { id: 'soeg-pil', navn: '«Søg»-knappens pil (→)', sel: 'button.soegeknap .sk-pil' },
  { id: 'ordmaerke', navn: 'Ordmærket BOFINDA', sel: 'header.top .maerke' },
  { id: 'naal-a', navn: 'Nål a: ikonet i «By eller område»', sel: '.soegefelt.sf-sted', pseudo: 'before' },
  { id: 'naal-b', navn: 'Nål b: ved postnummer/by på boligsiden', sel: '.detalje-hoved .sted', pseudo: 'before' },
  { id: 'naal-c', navn: 'Nål c: markør på kortet (ikke valgt)', sel: '.maerke-boble:not(.valgt)' },
  { id: 'naal-d', navn: 'Nål d: ikonet i «Vis kort»/«Vis liste» (ekstra)', sel: '.soegebar .kortvalg .kv-ikon' },
]
const EGENSKABER = ['color', 'background-color', 'border-top-color', 'opacity']
const KORT = {
  'color': ['color'],
  'background-color': ['background-color', 'background'],
  'border-top-color': ['border-top-color', 'border-color', 'border-top', 'border'],
  'opacity': ['opacity'],
}

// ─── Filerne, som reglerne slås op i ──────────────────────────
const FILER = {
  globals: `${ROD}/app/globals.css`,
  leaflet: `${ROD}/node_modules/leaflet/dist/leaflet.css`,
  forslag: `${LAG}/forslag.css`,
  greb: `${LAG}/greb.css`,
}
function parsRegler(fil) {
  const raa = fs.readFileSync(fil, 'utf8')
  const t = raa.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const linjeStart = [0]; for (let i = 0; i < t.length; i++) if (t[i] === '\n') linjeStart.push(i + 1)
  const linjeAf = (idx) => { let lo = 0, hi = linjeStart.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (linjeStart[m] <= idx) lo = m; else hi = m - 1 } return lo + 1 }
  const ud = [], stak = []
  let selStart = -1, selSlut = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '{') {
      const sel = t.slice(selSlut, i).trim()
      stak.push({ sel, linje: linjeAf(selStart >= 0 ? selStart : i), krop: i + 1 })
      selSlut = i + 1; selStart = -1
    } else if (c === '}') {
      const top = stak.pop()
      if (top && !top.sel.startsWith('@')) {
        const krop = t.slice(top.krop, i)
        const dekl = []
        let off = 0
        for (const del of krop.split(';')) {
          const lead = del.length - del.trimStart().length
          const d = del.trim()
          if (d && d.includes(':')) {
            const k = d.indexOf(':')
            dekl.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim().replace(/\s+/g, ' '), linjeAf(top.krop + off + lead)])
          }
          off += del.length + 1
        }
        ud.push({ fil, linje: top.linje, selektor: top.sel.replace(/\s+/g, ' '), dekl })
      }
      selSlut = i + 1; selStart = -1
    } else if (c === ';' && (!stak.length || stak[stak.length - 1].sel.startsWith('@'))) {
      selSlut = i + 1; selStart = -1
    } else if (selStart < 0 && !/\s/.test(c) && (!stak.length || stak[stak.length - 1].sel.startsWith('@'))) {
      selStart = i
    }
  }
  return ud
}
const REGLER = Object.fromEntries(Object.entries(FILER).map(([k, f]) => [k, parsRegler(f)]))
const normSel = (s) => s.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).sort().join(', ')
const normV = (v) => String(v).trim().replace(/\s+/g, ' ').replace(/\s*!important$/, '')
function slaaOp(arkURL, selektor, navn, vaerdi) {
  let kand
  if (/forslag\.css/.test(arkURL)) kand = ['forslag']
  else if (/greb\.css/.test(arkURL)) kand = ['greb']
  else if (/_next\/static\/css/.test(arkURL)) kand = ['globals', 'leaflet']
  else return []
  const s = normSel(selektor), v = normV(vaerdi)
  const hits = []
  for (const k of kand) for (const r of REGLER[k]) {
    if (normSel(r.selektor) !== s) continue
    for (const [p, x, l] of r.dekl) if (p === navn && normV(x) === v) hits.push(`${FILER[k].replace(ROD + '/', '').replace(/.*scratchpad\//, 'scratchpad/')}:${l}`)
  }
  return hits
}

// ─── CDP: den vindende deklaration og var()-kæden ─────────────
function vinder(regler, navne) {
  // regler i stigende kaskadeorden; sidste ikke-important taber til enhver important.
  let bedst = null
  for (const rm of regler) {
    const rule = rm.rule
    const props = rule.style?.cssProperties ?? []
    const kand = props.filter((p) => !p.disabled && p.parsedOk !== false && navne.includes(p.name))
    if (!kand.length) continue
    // Udfoldede longhands uden range er kaskadens egen udfoldning af en
    // shorthand i samme regel; den forfattede deklaration står også i listen.
    const forfattet = kand.filter((p) => p.range)
    const fund = (forfattet.length ? forfattet : kand).at(-1)
    if (!fund) continue
    const imp = !!fund.important
    if (!bedst || imp || !bedst.important) bedst = { ...fund, important: imp, rule }
  }
  return bedst
}

async function hentMatch(cdp, sel) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel })
  if (!nodeId) return null
  return cdp.send('CSS.getMatchedStylesForNode', { nodeId })
}

function beskriv(ark, dekl) {
  if (!dekl) return null
  const h = ark.get(dekl.rule.styleSheetId) || {}
  const url = h.sourceURL || (dekl.rule.origin === 'user-agent' ? 'user-agent' : '')
  const selektor = dekl.rule.selectorList?.text ?? ''
  return {
    selektor, egenskab: dekl.name, vaerdi: dekl.value + (dekl.important ? ' !important' : ''),
    ark: url.replace(/\?v=\d+$/, '').replace(/.*scratchpad\//, 'scratchpad/'),
    oprindelse: dekl.rule.origin,
    filLinje: dekl.rule.origin === 'user-agent' ? ['user-agent-stylesheet'] : slaaOp(url, selektor, dekl.name, dekl.value),
  }
}

// Kæde af stilarter: egne regler → (for pseudo: værtens) → forfædre.
function kaede(m, pseudo) {
  const k = []
  if (pseudo) {
    const pm = (m.pseudoElements || []).find((p) => p.pseudoType === pseudo)
    k.push(pm ? pm.matches : [])
  }
  k.push(m.matchedCSSRules || [])
  for (const inh of m.inherited || []) k.push(inh.matchedCSSRules || [])
  return k
}
function findDekl(k, navn, arves) {
  // Første led med en deklaration vinder (arv); for ikke-arvede kun led 0.
  for (let i = 0; i < k.length; i++) {
    const d = vinder(k[i], KORT[navn] || [navn])
    if (d) return { d, led: i }
    if (!arves) return null
  }
  return null
}
function varKaede(k, ark, vaerdi, dybde = 0) {
  const ud = []
  const m = /var\(\s*(--[\w-]+)/.exec(vaerdi || '')
  if (!m || dybde > 8) return ud
  const navn = m[1]
  for (let i = 0; i < k.length; i++) {
    const d = vinder(k[i], [navn])
    if (d) {
      ud.push({ token: navn, ...beskriv(ark, d) })
      ud.push(...varKaede(k.slice(i), ark, d.value, dybde + 1))
      return ud
    }
  }
  ud.push({ token: navn, vaerdi: '(ikke defineret)' })
  return ud
}

async function kilder(cdp, ark, maal) {
  const m = await hentMatch(cdp, maal.sel)
  if (!m) return null
  const k = kaede(m, maal.pseudo)
  const ud = {}
  for (const e of EGENSKABER) {
    const arves = e === 'color'
    const f = findDekl(k, e, arves)
    if (!f) { ud[e] = { vaerdi: '(initial/ingen regel)' }; continue }
    const b = beskriv(ark, f.d)
    b.arvetFraLed = f.led // 0 = elementet selv (eller pseudo), >0 = arvet
    b.tokens = varKaede(k.slice(f.led), ark, f.d.value)
    // currentColor/inherit: følg color-kæden
    if (/currentcolor|inherit/i.test(f.d.value) && e !== 'color') {
      const c = findDekl(k, 'color', true)
      if (c) { b.currentColor = beskriv(ark, c.d); b.currentColor.tokens = varKaede(k.slice(c.led), ark, c.d.value) }
    }
    ud[e] = b
  }
  return ud
}

// ─── I siden: farver, synlighed, fejning ──────────────────────
const I_SIDEN = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const parse = (s) => {
    if (!s || s === 'none') return null
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s)
    if (m) {
      let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
      return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a]
    }
    if (/^(url|linear|radial)/.test(s)) return null
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255, 'canvas']
  }
  const hex = (c) => c ? '#' + c.slice(0, 3).map((x) => x.toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0') : '') : null
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
    let h = 0, s = 0
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1))
      h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      h *= 60; if (h < 0) h += 360
    }
    return { h, s, l }
  }
  const groen = (c) => {
    if (!c || c[3] <= 0.1) return false
    const { h, s, l } = hsl(c)
    return h >= 130 && h <= 200 && s >= 0.12 && l >= 0.05 && l <= 0.90
  }
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
    if (lc && lc !== el) {
      const c = lc.getBoundingClientRect()
      if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) return false
    }
    return true
  }
  const egenTekst = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()
  const kortSel = (el, pseudo) => {
    const en = (e) => {
      if (!e || e === document.documentElement) return ''
      const kl = [...(e.classList || [])].filter((c) => !/^(__|jsx-|leaflet-(zoom|interactive|marker-icon))/.test(c)).slice(0, 3)
      return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + kl.map((c) => '.' + c).join('')
    }
    let s = en(el)
    if (!el.id && !(el.classList && el.classList.length)) s = `${en(el.parentElement)} > ${s}`
    return s + (pseudo ? '::' + pseudo : '')
  }
  const KENDT = '.kort-pris:not(.kun-leje), .oek-tal:not(.ukendt-tal), .gemt-pris:not(.kun-leje)'
  const KENDT_ANTAL = '.ub-kort dt.kendt' // et ANTAL boliger med kendt beløb, ikke et beløb
  const FORMER = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'tspan', 'use'])

  window.__farve = {
    parse, hex, hsl, groen,
    // Ét målelement: rå computed-værdier + den farve, der faktisk tegnes.
    element(sel, pseudo) {
      const alle = [...document.querySelectorAll(sel)]
      if (!alle.length) return { findes: false, antal: 0 }
      const el = alle.find((e) => synlig(e)) || alle[0]
      const antal = alle.length
      const cs = getComputedStyle(el, pseudo ? '::' + pseudo : null)
      const ud = { findes: true, antal, synlig: synlig(el) }
      if (pseudo) ud.pseudoContent = cs.content
      for (const p of ['color', 'background-color', 'border-top-color', 'border-top-width', 'border-top-style', 'opacity', 'fill', 'stroke', 'mask-image']) {
        const v = cs.getPropertyValue(p)
        ud[p] = p === 'mask-image' ? (v && v !== 'none' ? 'svg-maske' : 'none') : v
        const c = /color|fill|stroke/.test(p) ? parse(v) : null
        if (c) ud[p + '-hex'] = hex(c)
      }
      // Pseudo: egen opacitet × værtens kæde. Element: kæden (som starter i elementet selv).
      const op = pseudo ? parseFloat(cs.opacity) * effOpacitet(el) : effOpacitet(el)
      ud['effektiv-opacitet'] = +op.toFixed(3)
      // Hvad tegnes: for en maske-nål er det baggrunden (× opacitet) oven på
      // det, der ligger bagved; for tekst er det color.
      const bg = parse(cs.backgroundColor), fg = parse(cs.color)
      const under = pseudo ? bagved(el, true) : bagved(el)
      if (bg && bg[3] > 0) ud['tegnet-flade'] = '#' + bland(bg, bg[3] * op, under).map((x) => x.toString(16).padStart(2, '0')).join('')
      const fladeUnderTekst = bg && bg[3] > 0.99 ? bg : under
      if (fg) ud['tegnet-tekst'] = '#' + bland(fg, fg[3] * op, fladeUnderTekst).map((x) => x.toString(16).padStart(2, '0')).join('')
      ud.bagvedHex = hex(under)
      const r = el.getBoundingClientRect(); ud.rekt = [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)]
      ud.tekst = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      return ud
    },
    tokens() {
      const cs = getComputedStyle(document.documentElement)
      return Object.fromEntries(['--kendt', '--accent', '--accent-mrk', '--accent-lys', '--flade-groen', '--flade-groen-hover', '--blaek', '--blaek-hover', '--tekst']
        .map((t) => [t, cs.getPropertyValue(t).trim() || null]))
    },
    fej() {
      const fund = []
      const alle = [...document.querySelectorAll('body *')]
      for (const el of alle) {
        if (!synlig(el)) continue
        const erSvg = el instanceof SVGElement
        const form = erSvg && FORMER.has(el.tagName.toLowerCase())
        for (const pseudo of [null, 'before', 'after']) {
          const cs = getComputedStyle(el, pseudo ? '::' + pseudo : null)
          if (pseudo) {
            if (!cs.content || cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue
            if (parseFloat(cs.opacity) === 0) continue
          }
          const op = effOpacitet(el) * (pseudo ? parseFloat(cs.opacity) : 1)
          if (op < 0.02) continue
          const tekst = pseudo ? cs.content.replace(/^["']|["']$/g, '').trim() : egenTekst(el)
          const inputTekst = !pseudo && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value ? el.value : ''
          const tjek = []
          const fillV = cs.fill, strokeV = cs.stroke
          if ((tekst || inputTekst) || (form && (fillV === cs.color || strokeV === cs.color))) tjek.push('color')
          tjek.push('background-color')
          for (const side of ['top', 'right', 'bottom', 'left']) {
            if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0 && !/none|hidden/.test(cs.getPropertyValue(`border-${side}-style`))) tjek.push(`border-${side}-color`)
          }
          if (form) {
            if (fillV && fillV !== 'none') tjek.push('fill')
            if (strokeV && strokeV !== 'none' && parseFloat(cs.strokeWidth) > 0) tjek.push('stroke')
          }
          if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) tjek.push('outline-color')
          if (cs.textDecorationLine && cs.textDecorationLine !== 'none' && (tekst || (el.textContent || '').trim())) tjek.push('text-decoration-color')
          for (const p of tjek) {
            const v = cs.getPropertyValue(p)
            const c = parse(v)
            if (!groen(c)) continue
            const h = hsl(c)
            const a = c[3] * op
            const under = p === 'color' ? (() => { const b = parse(cs.backgroundColor); return b && b[3] > 0.99 ? b : bagved(el, !pseudo ? false : true) })() : bagved(el, !!pseudo)
            const tegnet = a < 0.999 ? '#' + bland(c, a, under).map((x) => x.toString(16).padStart(2, '0')).join('') : hex(c).slice(0, 7)
            fund.push({
              tegnetHex: tegnet, bagvedHex: hex(under),
              egenskab: p, hex: hex(c), hsl: [Math.round(h.h), +h.s.toFixed(3), +h.l.toFixed(3)],
              selektor: kortSel(el, pseudo),
              tekst: (tekst || inputTekst || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 40),
              effektivOpacitet: +op.toFixed(2),
              kendtBeloeb: !!el.closest(KENDT),
              kendtAntal: !!el.closest(KENDT_ANTAL),
              maskeIkon: !!(cs.maskImage && cs.maskImage !== 'none') || !!(cs.webkitMaskImage && cs.webkitMaskImage !== 'none'),
            })
          }
        }
      }
      return fund
    },
  }
}

// ─── Kørsel ────────────────────────────────────────────────────
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const resultat = { elementer: [], tokens: [], fejning: [], hover: [], ark: [] }

async function gaaTil(page, sti) {
  for (let f = 0; ; f++) {
    try { await page.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 180000 }); return }
    catch (e) { if (f >= 3 || !/ERR_ABORTED|Timeout/.test(String(e))) throw e; await page.waitForTimeout(2000) }
  }
}
async function forbered(page, tilstand) {
  await page.waitForTimeout(1500) // lad hydreringen blive færdig, før DOM'en røres
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  if (tilstand === 'runde2') {
    await page.addStyleTag({ path: `${LAG}/forslag.css` })
    await page.addStyleTag({ path: `${LAG}/greb.css` })
    await page.addScriptTag({ path: `${LAG}/greb.js` })
    await page.evaluate(() => window.__bofindaForslag({}))
    // Hydreringen kan nå at tegne en sektion om efter mockuppen; så står
    // de indsatte elementer ikke længere. Kald igen, til de står.
    for (let f = 0; f < 5; f++) {
      await page.waitForTimeout(700)
      const mangler = await page.evaluate(() => (!!document.querySelector('.udlejerbaand') && !document.querySelector('.ub-kort'))
        || (!!document.querySelector('.hero-soeg form.filtre') && !document.querySelector('.soeg-faner')))
      if (!mangler) break
      await page.evaluate(() => window.__bofindaForslag({}))
    }
  }
  await page.evaluate(I_SIDEN)
  // Kortet indlæses først, når det er synligt: rul det frem og vent på mærkerne.
  if (await page.$('.landkort-flade')) {
    const vises = await page.evaluate(() => { const e = document.querySelector('.landkort-flade'); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' })
    if (vises) {
      await page.evaluate(() => document.querySelector('.landkort-flade').scrollIntoView({ block: 'center' }))
      try { await page.waitForSelector('.maerke-boble', { timeout: 30000 }) } catch { /* registreres som manglende */ }
      await page.waitForTimeout(800)
      await page.evaluate(() => scrollTo(0, 0))
      await page.waitForTimeout(300)
    }
  }
  await page.waitForTimeout(300)
}

for (const bredde of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: bredde, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const ark = new Map()
  cdp.on('CSS.styleSheetAdded', (e) => ark.set(e.header.styleSheetId, e.header))
  await gaaTil(page, '/')
  // Samtykket: klik, og efterprøv at cookien faktisk blev sat (et klik før
  // hydreringen gør ingenting, og så står banneret på hver side).
  for (let f = 0; f < 6; f++) {
    if ((await ctx.cookies()).some((c) => c.name === 'bofinda_samtykke')) break
    await page.waitForTimeout(1500)
    const knap = page.getByRole('button', { name: 'Kun det nødvendige' })
    if (await knap.count()) { await knap.first().click().catch(() => {}); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500) }
  }
  const samtykke = (await ctx.cookies()).find((c) => c.name === 'bofinda_samtykke')
  process.stdout.write(`samtykkecookie ${bredde}: ${samtykke ? samtykke.value : 'MANGLER'}\n`)
  resultat.samtykke = { ...(resultat.samtykke || {}), [bredde]: samtykke ? samtykke.value : null }
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')

  const sider = bredde === 390 ? [...SIDER, ...EKSTRA_390] : SIDER
  for (const tilstand of ['foer', 'runde2']) {
    for (const [side, sti] of sider) {
      await gaaTil(page, sti)
      await forbered(page, tilstand)
      process.stdout.write(`${tilstand} ${bredde} ${side}\n`)
      resultat.tokens.push({ tilstand, bredde, side, ...(await page.evaluate(() => window.__farve.tokens())) })
      resultat.lagKontrol = resultat.lagKontrol || []
      resultat.lagKontrol.push({ tilstand, bredde, side, ...(await page.evaluate(() => ({
        soegFaner: !!document.querySelector('.soeg-faner'), ubKort: !!document.querySelector('.ub-kort'),
        soegefeltEkstra: document.querySelectorAll('.soegefelt-ekstra').length, udlejerbaand: !!document.querySelector('.udlejerbaand'),
        samtykkeBanner: !!document.querySelector('.samtykke-knapper'),
        forslagCss: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes('--flade-groen')) } catch { return false } }),
      }))) })
      for (const m of MAAL) {
        const maalt = await page.evaluate(([s, p]) => window.__farve.element(s, p), [m.sel, m.pseudo || null])
        const kilde = maalt.findes ? await kilder(cdp, ark, m) : null
        resultat.elementer.push({ tilstand, bredde, side, id: m.id, navn: m.navn, selektor: m.sel + (m.pseudo ? '::' + m.pseudo : ''), ...maalt, kilde })
      }
      if (side !== 'soeg-kort-valgt') {
        const f = await page.evaluate(() => window.__farve.fej())
        for (const x of f) resultat.fejning.push({ tilstand, bredde, side, ...x })
      }
      // Valgt markør: klik det første mærke (efter fejningen, så den måler hviletilstanden).
      if (/^soeg/.test(side) && await page.$('.maerke-boble')) {
        const m = { id: 'naal-c-valgt', navn: 'Nål c: markør på kortet (valgt, efter klik)', sel: '.maerke-boble.valgt' }
        await page.locator('.maerke-boble').first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(900)
        const maalt = await page.evaluate(([s]) => window.__farve.element(s, null), [m.sel])
        const kilde = maalt.findes ? await kilder(cdp, ark, m) : null
        resultat.elementer.push({ tilstand, bredde, side, id: m.id, navn: m.navn, selektor: m.sel, ...maalt, kilde })
        await page.evaluate(() => scrollTo(0, 0))
      }
      // Hover: kun på forsiden i 1440, for de to knapper.
      if (side === 'forside' && bredde === 1440) {
        for (const m of MAAL.filter((x) => x.id === 'opret' || x.id === 'soeg')) {
          await page.hover(m.sel); await page.waitForTimeout(600)
          const maalt = await page.evaluate(([s]) => window.__farve.element(s, null), [m.sel])
          resultat.hover.push({ tilstand, id: m.id, navn: m.navn, color: maalt['color-hex'], baggrund: maalt['background-color-hex'], kant: maalt['border-top-color-hex'] })
          await page.mouse.move(2, 890); await page.waitForTimeout(300)
        }
      }
      // Beskårne billeder af de fire elementer, så tallene kan ses efter.
      if (side === 'forside' || side === 'bolig-med-billeder' || side === 'soeg') {
        for (const [id, sel] of [['header', 'header.top'], ['soegebar', '.soegebar'], ['sted', '.detalje-hoved .sted'], ['kort', '.landkort-flade']]) {
          const el = await page.$(sel)
          if (!el) continue
          const box = await el.boundingBox()
          if (!box || box.width < 2) continue
          await el.screenshot({ path: `${MAPPE}/beskaar/${tilstand}-${bredde}-${side}-${id}.png` }).catch(() => {})
        }
      }
    }
  }
  resultat.ark.push({ bredde, ark: [...ark.values()].map((h) => ({ id: h.styleSheetId, url: h.sourceURL, origin: h.origin, inline: h.isInline, startLine: h.startLine })) })
  await ctx.close()
}
await browser.close()

resultat.meta = {
  maalt: new Date().toISOString(), base: BASE, data: 'SYNTETISK seed i isoleret lokal Postgres (280 boliger)',
  boliger: { medBilleder: MED, udenBilleder: UDEN },
  lag: Object.fromEntries(['forslag.css', 'greb.css', 'greb.js'].map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(`${LAG}/${f}`)).digest('hex').slice(0, 16)])),
  globalsSha: crypto.createHash('sha256').update(fs.readFileSync(FILER.globals)).digest('hex').slice(0, 16),
}
fs.writeFileSync(`${MAPPE}/raa.json`, JSON.stringify(resultat, null, 1))
process.stdout.write('FÆRDIG\n')
