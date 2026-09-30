// ═══════════════════════════════════════════════════════════════
//  KAN DETTE FOTO BÆRE TEKSTEN?  Måles, før et foto sættes ind.
//
//      node maal-foto.mjs <udmappe> <foto> [<foto> …]
//      node maal-foto.mjs <udmappe> --selvproeve
//
//  <foto> er en billedfil (jpg/png/webp) eller et fotoobjekt (.json i
//  samme form som ../heltefoto.json, med "fil": stien til billedet).
//  Ligger der en <foto>.json ved siden af en billedfil, bruges dens
//  felter (kredit, licens, fokus, slør); ellers heltefoto.json's.
//
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh). Rører hverken
//  appen, public/ eller basen: kandidaten serveres gennem en opsnappet
//  rute og lægges ind via fotoobjektet — samme vej, som et nyt foto
//  skal ind i appen (HERO_STANDARD i page.tsx).
//
//  For hver kandidat, i 1440, 390 og 360 og i begge telefonvarianter:
//    · værste kontrast for øjenbryn, h1 og manchet mod de FAKTISKE
//      pixels bag dem, med det slør objektet angiver;
//    · hvor meget slør fotoet KRÆVER (tyndeste ensartede slør, der
//      får teksten igennem på netop dette foto);
//    · hvor meget af fotoets egen tegning der står tilbage.
//
//  DOMMEN: AFVIST, hvis én tekst i én bredde falder under WCAG AA
//  (4,5:1; 3:1 for stor tekst) med objektets slør — eller hvis variant B
//  kun kan bære teksten med et slør over SLOER_LOFT. Over loftet er
//  fotoet bag teksten et mørkt felt med en anelse motiv; så er det
//  variant A eller et andet foto, ikke et tykkere slør.
//  Exit-kode 1 ved mindst ét AFVIST.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, basename, extname, resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { heroKontrast, fotoSynlig, aabn, gaaTil, laegPaa, HOEJDE } from './hero-maal.mjs'

export const SLOER_LOFT = 0.70
const BREDDER = [1440, 390, 360]
const VARIANTER = { 1440: [null], 390: ['baand', 'moerk'], 360: ['baand', 'moerk'] }

const [UD, ...kandidater] = process.argv.slice(2)
if (!UD || !kandidater.length) { console.error('brug: node maal-foto.mjs <udmappe> <foto|foto.json> … | --selvproeve'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const STANDARD = JSON.parse(readFileSync(join(FORSLAG, 'heltefoto.json'), 'utf8'))

const FONTE = join(UD, '.fonte')
if (!existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE], { stdio: 'inherit' })
}
const CSS = [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(FORSLAG, 'forslag.css'), 'utf8'), readFileSync(join(FORSLAG, 'greb.css'), 'utf8')].join('\n')
const JS = readFileSync(join(FORSLAG, 'greb.js'), 'utf8')

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

/** Fotoobjektet for en kandidat: fil + felter, standard for det, der mangler. */
function objekt(k) {
  if (extname(k) === '.json') {
    const o = JSON.parse(readFileSync(k, 'utf8'))
    return { ...STANDARD, ...o, fil: resolve(dirname(k), o.fil) }
  }
  const side = k.replace(/\.[^.]+$/, '.json')
  const o = existsSync(side) ? JSON.parse(readFileSync(side, 'utf8')) : {}
  return { ...STANDARD, kredit: null, licens: null, ...o, fil: resolve(k) }
}

async function maalEt(o, navn) {
  const mappe = join(UD, navn); mkdirSync(mappe, { recursive: true })
  const foto = { ...o, url: `/_forslag/foto/${encodeURIComponent(basename(o.fil))}` }
  const raekker = []
  for (const w of BREDDER) {
    const c = await br.newContext({ viewport: { width: w, height: HOEJDE(w) } })
    await c.route('**/_forslag/foto/**', (r) => r.fulfill({ path: o.fil }))
    await c.route('**/_forslag/*.woff2', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
    const p = await aabn(c, BASE)
    for (const mobil of VARIANTER[w]) {
      await gaaTil(p, BASE + '/')
      await laegPaa(p, { css: CSS, js: JS, valg: { mobil, foto } })
      // Fotoet er skiftet i browseren; der måles først, når det er tegnet.
      await p.waitForFunction(() => { const i = document.querySelector('.hero-billede img'); return i && i.complete && i.naturalWidth > 0 && i.src.includes('/_forslag/foto/') }, null, { timeout: 30000 })
      const k = await heroKontrast(p)
      const f = await fotoSynlig(p)
      const hero = await p.evaluate(() => { const h = document.querySelector('.hero'); const r = h.getBoundingClientRect(); return Math.round(r.bottom + scrollY + 60) })
      const fil = `${mobil ?? 'bred'}-${w}.jpg`
      await p.screenshot({ path: join(mappe, fil), type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: w, height: Math.min(hero, HOEJDE(w)) } })
      const tekster = Object.fromEntries(['øjenbryn', 'h1', 'manchet'].map((t) => [t, k[t]]))
      const kraevet = Object.values(tekster).map((t) => t?.alfaMin).filter((a) => typeof a === 'number')
      const kraevetMax = kraevet.length ? Math.max(...kraevet) : null
      const konfig = mobil === 'moerk' ? o.sloerSmal : mobil === 'baand' ? null : o.sloer
      const grunde = []
      for (const [t, m] of Object.entries(tekster)) if (m && !m.bestaar) grunde.push(`${t} ${m.vaerst}:1 < ${m.taerskel}:1`)
      if (Object.values(tekster).some((m) => m?.alfaMin === '>1')) grunde.push('ingen slørtæthed får teksten igennem')
      if (mobil === 'moerk' && kraevetMax != null && kraevetMax > SLOER_LOFT) grunde.push(`kræver slør ${kraevetMax} > loftet ${SLOER_LOFT}`)
      raekker.push({ bredde: w, variant: mobil ?? 'bred', fil, tekster, sloerKonfig: konfig, sloerKraevet: kraevetMax,
        tegningBevaret: f.tegningBevaret, frihoejde: f.frihoejde, dom: grunde.length ? 'AFVIST' : 'BESTÅET', grunde })
    }
    await c.close()
  }
  const noter = []
  if (!o.kredit) noter.push('Ingen kreditering i fotoobjektet. Kreditering er et krav — udfyld «kredit».')
  if (!o.licens) noter.push('Ingen licens i fotoobjektet. Uden licens bruges fotoet ikke.')
  if (o.kreditVedBilledet) noter.push('Licensen kræver kreditering VED billedet. Laget sætter den i fodnoten; det skal ændres, før fotoet kan bruges.')
  return { navn, fil: basename(o.fil), kredit: o.kredit, licens: o.licens, dom: raekker.some((r) => r.dom === 'AFVIST') ? 'AFVIST' : 'BESTÅET', raekker, noter }
}

function rapport(res) {
  const t = (m) => (m ? `${String(m.vaerst).replace('.', ',')}${m.bestaar ? '' : ' ✗'}` : '–')
  const a = (x) => (x == null ? '–' : String(x).replace('.', ','))
  let md = `# Fotomåling\n\nVærste kontrast mod de faktiske pixels bag teksten. Tærskel 4,5:1, for h1 3:1. «Slør krævet» er det tyndeste ensartede slør, der får al tekst igennem på netop dette foto. «Tegning tilbage» er fotoets egen luminansspredning, som siden tegner det, delt med det rå fotos, over den del, der står fri af søgekortet.\n`
  for (const r of res) {
    md += `\n## ${r.navn} — **${r.dom}**\n\n${r.kredit ?? '(ingen kreditering)'} · ${r.licens ?? '(ingen licens)'}\n\n`
    md += '| Bredde | Variant | Øjenbryn | h1 | Manchet | Slør (objekt) | Slør krævet | Tegning tilbage | Dom |\n|---|---|---|---|---|---|---|---|---|\n'
    for (const x of r.raekker) {
      md += `| ${x.bredde} | ${x.variant} | ${t(x.tekster['øjenbryn'])} | ${t(x.tekster.h1)} | ${t(x.tekster.manchet)} | ${a(x.sloerKonfig)} | ${a(x.sloerKraevet)} | ${a(x.tegningBevaret)} | ${x.dom}${x.grunde.length ? ': ' + x.grunde.join('; ') : ''} |\n`
    }
    for (const n of r.noter) md += `\n- ${n}`
    md += '\n'
  }
  return md
}

// ── Selvprøven: målingen skal kunne sige nej ─────────────────────
// Et foto, der altid består, beviser ingenting om målingen. Tre
// tilfælde med kendt facit: det nuværende foto med sit objekt (består),
// samme foto med variant B's slør sat ned til 0,20 (hvid tekst på et
// hvidt foto — skal afvises), og en mørklagt udgave af samme foto med
// bred skærms underlag sat ned til 0,20 (mørk tekst på mørkt — skal
// afvises). Mørklægningen er en prøveattrap, ikke en kandidat.
async function selvproeve() {
  const std = resolve(FORSLAG, '../../public/hero-stue.jpg')
  const mappe = join(UD, '_attrapper'); mkdirSync(mappe, { recursive: true })
  const p = await (await br.newContext()).newPage()
  const moerk = await p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.filter = 'brightness(0.22)'; g.drawImage(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]
  }, readFileSync(std).toString('base64'))
  const moerkFil = join(mappe, 'moerklagt-attrap.jpg'); writeFileSync(moerkFil, Buffer.from(moerk, 'base64'))
  const lysFil = join(mappe, 'hero-stue.jpg'); copyFileSync(std, lysFil)
  const tilfaelde = [
    { navn: 'nuvaerende', o: { ...STANDARD, fil: lysFil }, facit: 'BESTÅET' },
    { navn: 'tyndt-moerkt-sloer', o: { ...STANDARD, fil: lysFil, sloerSmal: 0.2 }, facit: 'AFVIST', skal: (r) => r.variant === 'moerk' },
    { navn: 'moerkt-foto-tyndt-underlag', o: { ...STANDARD, fil: moerkFil, sloer: 0.2 }, facit: 'AFVIST', skal: (r) => r.variant === 'bred' },
  ]
  const res = [], fejl = []
  for (const x of tilfaelde) {
    const r = await maalEt(x.o, x.navn); res.push(r)
    if (r.dom !== x.facit) fejl.push(`${x.navn}: ${r.dom}, facit ${x.facit}`)
    if (x.skal && !r.raekker.some((y) => x.skal(y) && y.dom === 'AFVIST')) fejl.push(`${x.navn}: afvist, men ikke i den variant, der skulle fejle`)
  }
  return { res, fejl }
}

let res = [], fejl = []
if (kandidater[0] === '--selvproeve') ({ res, fejl } = await selvproeve())
else for (const k of kandidater) res.push(await maalEt(objekt(k), basename(k).replace(/\.[^.]+$/, '')))
await br.close()
writeFileSync(join(UD, 'fotomaaling.json'), JSON.stringify(res, null, 1))
writeFileSync(join(UD, 'fotomaaling.md'), rapport(res))
process.stdout.write(rapport(res))
if (kandidater[0] === '--selvproeve') {
  process.stdout.write(`\nSELVPRØVE: ${fejl.length ? 'FEJL\n  ' + fejl.join('\n  ') : 'alle tre tilfælde fik deres facit — målingen kan både bestå og afvise'}\n`)
  process.exit(fejl.length ? 1 : 0)
}
process.exit(res.some((r) => r.dom === 'AFVIST') ? 1 : 0)
