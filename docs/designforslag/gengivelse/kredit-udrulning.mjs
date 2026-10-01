// ═══════════════════════════════════════════════════════════════
//  KAN EN DELVIS UDRULNING GIVE EN SIDE UDEN KREDITERING?
//
//      node kredit-udrulning.mjs <udmappe>
//
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh). Rører hverken
//  appen eller basen: laget og markupændringerne lægges på i browseren.
//
//  Hver tilstand, en udrulning kan efterlade siden i, gengives i seks
//  bredder (1440, 768, 390, 360, 320, 280), og krediteringen måles med
//  hero-maal.mjs › kreditering():
//  præcis ÉN synlig, ikke-dækket og læselig (≥ 4,5:1) kreditering.
//
//    i-dag                    appen, som den er
//    kun-css                  laget (forslag.css + greb.css) uden markup
//    kun-greb                 greb.css UDEN forslag.css (som definerer --l-*)
//    foldet                   laget, og EFTER det globals.css' egne regler
//                             for .hero og .hero-soeg — som når laget foldes
//                             ind i globals.css, og globals' senere
//                             ≤760-regler kommer efter. Reglerne læses af
//                             den rigtige app/globals.css, når prøven kører.
//    lag-og-mockup            laget + greb.js — som skærmbillederne
//    markup-flyttet           runde 3's markupflytning (til footer.bund)
//                             uden laget — hvis nogen byggede den alligevel
//    markup-flyttet-og-css    samme, med laget
//
//  MODPRØVERNE skal blive røde. Fejlen indføres i LAGET — dér, hvor appen
//  læser — ikke i målingen. Bliver en modprøve grøn, måler kontrollen
//  ikke det, den påstår, og så er hele kørslen rød:
//    modproeve-skjult     .hero-kredit { display: none }
//    modproeve-daekket    linjen lagt op under søgekortet
//    modproeve-bleg       teksten i en farve, der ikke kan læses
//    modproeve-to         en ekstra kreditering i fodnoten (to steder)
//    modproeve-overlap    linjen lagt oven på overskriften: øverst og
//                         «synlig», men to tekster i hinanden
//    modproeve-kun-greb-uden-reserve  greb.css alene, reserveværdierne
//                         fjernet (sådan var laget før efterprøvningen)
//    modproeve-foldet-gammel-spec     foldet, med `.hero` i stedet for
//                         `.hero.fuldbredde` (sådan var laget før)
//    modproeve-env-uden-kredit  page.tsx med NEXT_PUBLIC_HERO_FOTO sat og
//                         NEXT_PUBLIC_HERO_FOTO_KREDIT tom: fotoet står, og
//                         page.tsx tegner ingen kreditering (`kredit: … ||
//                         null`). Ikke en udrulning af laget, men den samme
//                         slags side — og kontrollen skal se den.
//
//  Exit 1, hvis en tilstand fejler, eller en modprøve ikke gør.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { kreditering, aabn, gaaTil, laegPaa, skaermbillede, HOEJDE } from './hero-maal.mjs'

const [UD] = process.argv.slice(2)
if (!UD) { console.error('brug: node kredit-udrulning.mjs <udmappe>'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const BREDDER = [1440, 768, 390, 360, 320, 280]

const FONTE = join(UD, '.fonte')
if (!existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE], { stdio: 'inherit' })
}
const LAG = [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(FORSLAG, 'forslag.css'), 'utf8'), readFileSync(join(FORSLAG, 'greb.css'), 'utf8')].join('\n')
const GREB = readFileSync(join(FORSLAG, 'greb.js'), 'utf8')
const FONTCSS = readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)')
const KUN_GREB = [FONTCSS, readFileSync(join(FORSLAG, 'greb.css'), 'utf8')].join('\n')

// globals.css' egne regler for netop disse selektorer, med deres
// @media-indpakning, læst af den rigtige fil — ikke skrevet af her.
function regler(css, navne) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const ud = [], stak = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { stak.push(css.slice(start, i).trim()); start = i + 1 }
    else if (css[i] === '}') {
      const forspil = stak.pop(), krop = css.slice(start, i)
      if (forspil && !forspil.startsWith('@') && forspil.split(',').map((x) => x.trim()).some((x) => navne.includes(x))) {
        let r = `${forspil} {${krop}}`
        for (const m of stak.filter((x) => x.startsWith('@')).reverse()) r = `${m} { ${r} }`
        ud.push(r)
      }
      start = i + 1
    }
  }
  return ud
}
const GLOBALS_HERO = regler(readFileSync(join(FORSLAG, '../../app/globals.css'), 'utf8'), ['.hero', '.hero-soeg'])
if (GLOBALS_HERO.length < 4) { console.error(`FEJL: fandt kun ${GLOBALS_HERO.length} regler for .hero/.hero-soeg i globals.css — prøven ville ikke folde noget`); process.exit(2) }
const FOLDET = LAG + '\n/* indfoldet: globals.css\' egne regler, EFTER laget */\n' + GLOBALS_HERO.join('\n')
// Modprøverne genindfører netop de to fejl, efterprøvningen fandt — i det
// lag, appen ville læse: reserveværdierne fjernet, og specificiteten sat
// tilbage til `.hero`.
const GREB_CSS = readFileSync(join(FORSLAG, 'greb.css'), 'utf8')
const UDEN_RESERVE = GREB_CSS.replace(/var\((--[a-z0-9-]+),\s*[^)]+\)/g, 'var($1)')
const GAMMEL_SPEC = GREB_CSS.replaceAll('.hero.fuldbredde', '.hero')
if (UDEN_RESERVE === GREB_CSS || GAMMEL_SPEC === GREB_CSS) { console.error('FEJL: modprøverne ændrede ikke laget'); process.exit(2) }
const KUN_GREB_UDEN_RESERVE = [FONTCSS, UDEN_RESERVE].join('\n')
const FOLDET_GAMMEL = LAG.replace(GREB_CSS, GAMMEL_SPEC) + '\n' + GLOBALS_HERO.join('\n')

// Runde 3's markupflytning, som page.tsx ville have gjort den: væk fra
// heroen, ind i footer.bund som en sætning.
// Idempotent: en hydrering kan tegne heroen forfra efter første kald, og
// så skal den gendannede .hero-kredit væk igen — page.tsx ville ikke
// tegne den i denne tilstand.
const FLYT = `window.__bofindaForslag = () => {
  const kr = document.querySelector('.hero-kredit'), bund = document.querySelector('footer.bund')
  if (!bund) return
  if (kr && !bund.querySelector('.fotokredit')) {
    const s = document.createElement('span'); s.className = 'fotokredit'; s.textContent = kr.textContent.trim() + '.'
    bund.append(' ', s)
  }
  if (kr) kr.remove()
}`
const EKSTRA_I_FODNOTE = `window.__bofindaForslag = () => {
  const bund = document.querySelector('footer.bund'), kr = document.querySelector('.hero-kredit')
  if (!bund || !kr || bund.querySelector('.fotokredit')) return
  const s = document.createElement('span'); s.className = 'fotokredit'; s.textContent = kr.textContent.trim() + '.'
  bund.append(' ', s)
}`

// Lægges oven på h1 med en stil på elementet — i laget, dér hvor appen
// læser (elementets position), ikke i målingen.
const OVER_H1 = `window.__bofindaForslag = () => {
  const kr = document.querySelector('.hero-kredit'), h = document.querySelector('.hero h1'), he = document.querySelector('.hero')
  if (!kr || !h || !he) return
  const a = h.getBoundingClientRect(), b = he.getBoundingClientRect()
  Object.assign(kr.style, { top: (a.top - b.top + a.height / 4) + 'px', left: (a.left - b.left) + 'px', right: 'auto' })
}`
const UDEN_KREDIT = `window.__bofindaForslag = () => { document.querySelector('.hero-kredit')?.remove() }`

const TILSTANDE = [
  { navn: 'i-dag', css: '', js: '' },
  { navn: 'kun-css', css: LAG, js: '' },
  { navn: 'kun-greb', css: KUN_GREB, js: '' },
  { navn: 'foldet', css: FOLDET, js: '' },
  { navn: 'lag-og-mockup', css: LAG, js: GREB },
  { navn: 'markup-flyttet', css: '', js: FLYT },
  { navn: 'markup-flyttet-og-css', css: LAG, js: FLYT },
  { navn: 'modproeve-skjult', css: LAG + '\n.hero .hero-kredit{display:none}', js: '', modproeve: true },
  // Linjen lagt op under kortets nederste kant OG bag det (z-index −1 i
  // heroens stablingskontekst). Uden z-index tegnes den OVEN PÅ kortet —
  // så er den synlig, og modprøven ville måle noget andet end dækning.
  { navn: 'modproeve-daekket', css: LAG + '\n.hero.har-foto .hero-kredit{top:calc(100% - 6px); z-index:-1}', js: '', modproeve: true },
  { navn: 'modproeve-bleg', css: LAG + '\n.hero.har-foto .hero-kredit{color:#d9d6cf}', js: '', modproeve: true },
  { navn: 'modproeve-to', css: LAG, js: EKSTRA_I_FODNOTE, modproeve: true },
  { navn: 'modproeve-overlap', css: LAG, js: OVER_H1, modproeve: true },
  // Kun i de bredder, hvor efterprøvningen målte fejlen.
  { navn: 'modproeve-kun-greb-uden-reserve', css: KUN_GREB_UDEN_RESERVE, js: '', modproeve: true, kunBredder: [1440, 390, 360, 320] },
  { navn: 'modproeve-foldet-gammel-spec', css: FOLDET_GAMMEL, js: '', modproeve: true, kunBredder: [390, 360] },
  { navn: 'modproeve-env-uden-kredit', css: LAG, js: UDEN_KREDIT, modproeve: true },
]

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const res = [], fejl = []
for (const w of BREDDER) {
  const c = await br.newContext({ viewport: { width: w, height: HOEJDE(w) } })
  await c.route('**/_forslag/*.woff2', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
  const p = await aabn(c, BASE)
  for (const t of TILSTANDE) {
    if (t.kunBredder && !t.kunBredder.includes(w)) continue
    await gaaTil(p, BASE + '/')
    await laegPaa(p, { css: t.css, js: t.js, valg: {} })
    const k = await kreditering(p)
    const ok = k.dom === 'OK'
    // Et udsnit omkring den synlige kreditering — eller toppen, hvis ingen.
    const y = k.y ?? 0
    await skaermbillede(p, { path: join(UD, `${t.navn}-${w}.png`), fullPage: true,
      clip: { x: 0, y: Math.max(0, y - 120), width: w, height: 200 } })
    res.push({ bredde: w, tilstand: t.navn, modproeve: !!t.modproeve, dom: k.dom,
      hvor: k.hvor, kontrast: k.kontrast, kandidater: k.kandidater.map(({ hvor, synlig, laeselig, kontrast, daekket, overlap, skjult, iSiden }) => ({ hvor, synlig, laeselig, kontrast, daekket, overlap, skjult, iSiden })) })
    if (t.modproeve ? ok : !ok) fejl.push(`${w} ${t.navn}: ${k.dom}${t.modproeve ? ' — modprøven blev GRØN' : ''}`)
    process.stdout.write(`${String(w).padStart(4)}  ${t.navn.padEnd(24)} ${k.dom.padEnd(26)} ${k.hvor ?? '–'}  ${k.kontrast ?? '–'}${t.modproeve ? '  (modprøve: skal fejle)' : ''}\n`)
  }
  await c.close()
}
await br.close()
writeFileSync(join(UD, 'kredit-udrulning.json'), JSON.stringify(res, null, 1))
process.stdout.write(fejl.length ? `\nFEJL\n  ${fejl.join('\n  ')}\n` : '\nALLE TILSTANDE har præcis én synlig, læselig kreditering, og alle modprøver blev røde.\n')
process.exit(fejl.length ? 1 : 0)
