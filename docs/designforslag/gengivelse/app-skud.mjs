// ═══════════════════════════════════════════════════════════════
//  Den RIGTIGE app i en rigtig browser — ikke komponenter enkeltvis.
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh: next dev mod den
//  isolerede lokale Postgres). Rører hverken base eller kode: laget og
//  mockuppen lægges på i browseren, kun til skærmbilledet.
//
//      node app-skud.mjs <udmappe> <variant> [png|jpeg] [dpr] [flag]
//
//  variant   foer         siden, som den er
//            efter        forslag.css + greb.css + greb.js
//            efter-haand  samme, med håndskriften
//  --mobil baand|moerk    telefonens hero-variant (greb.css § 6)
//  --lag <mappe>          tag forslag.css/greb.css/greb.js herfra i stedet
//                         (fx et tidligere lag, til sammenligning)
//  --foto <json>          fotoobjektet (standard: ../heltefoto.json)
//  --bredder 1440,390,360 --sider forside,soegning,bolig-billeder,bolig-uden
//
//  Skærmbilleder pr. side og bredde, forsidens bund, og maal.json:
//  billedforhold i nettet, korthøjder, første korts placering, og på
//  forsiden kontrasten mod det FAKTISKE foto, hvor meget af fotoet der
//  står tilbage, linjebruddet i «Populære søgninger» og krediteringen.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { heroKontrast, fotoSynlig, populaere, kreditering, tekstKontrast, aabn, gaaTil, laegPaa, HOEJDE } from './hero-maal.mjs'

const arg = process.argv.slice(2)
const flag = (n, d) => { const i = arg.indexOf(n); return i < 0 ? d : arg.splice(i, 2)[1] }
const MOBIL = flag('--mobil', null)
const LAGMAPPE = flag('--lag', null)
const BREDDER = flag('--bredder', '1440,390').split(',').map(Number)
const SIDENAVNE = flag('--sider', 'forside,soegning,bolig-billeder,bolig-uden').split(',')
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const FOTOFIL = flag('--foto', join(FORSLAG, 'heltefoto.json'))
const [UD, VARIANT = 'foer', FORMAT = 'png', DPR = '1'] = arg
if (!UD) { console.error('brug: node app-skud.mjs <udmappe> foer|efter|efter-haand [png|jpeg] [dpr] [--mobil baand|moerk] [--lag mappe] [--bredder …] [--sider …]'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const efter = VARIANT !== 'foer'
const LAG_FRA = LAGMAPPE ?? FORSLAG

// Skrifterne: hentes én gang og serveres gennem en opsnappet rute, så
// siden kan bruge dem uden at noget lægges i appens public/.
const FONTE = join(UD, '.fonte')
if (efter && !existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE, '--haand'], { stdio: 'inherit' })
}
const LAG = efter ? [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(LAG_FRA, 'forslag.css'), 'utf8'), readFileSync(join(LAG_FRA, 'greb.css'), 'utf8')].join('\n') : ''
const JS = efter ? readFileSync(join(LAG_FRA, 'greb.js'), 'utf8') : ''
// Et ældre lag kender ikke fotoobjektet; det får det heller ikke.
const FOTO = efter && !LAGMAPPE ? JSON.parse(readFileSync(FOTOFIL, 'utf8')) : null
const VALG = { haand: VARIANT === 'efter-haand', mobil: MOBIL, foto: FOTO }

// Boliger med og uden billeder slås op i den lokale base, ikke hardkodes.
const url = process.env.DATABASE_URL_DIRECT
if (!url) { console.error('DATABASE_URL_DIRECT mangler (source scripts/cloud/miljoe.sh; test_url)'); process.exit(2) }
const hent = (q) => execFileSync('psql', [url, '-Atc', q]).toString().trim()
const medBilleder = hent(`select l.id from listings l join listing_images i on i.listing_id=l.id where l.status='active' group by l.id order by count(*) desc, l.id limit 1`)
const udenBilleder = hent(`select l.id from listings l where l.status='active' and not exists(select 1 from listing_images i where i.listing_id=l.id) order by l.id limit 1`)
const by = hent(`select city from listings where status='active' group by 1 having count(*) >= 12 order by count(*) desc limit 1`)
const SIDER = [['forside', '/'], ['soegning', `/?sted=${encodeURIComponent(by)}`],
  ['bolig-billeder', `/bolig/${medBilleder}`], ['bolig-uden', `/bolig/${udenBilleder}`]].filter(([n]) => SIDENAVNE.includes(n))

const ext = FORMAT === 'jpeg' ? 'jpg' : 'png'
const opt = FORMAT === 'jpeg' ? { type: 'jpeg', quality: 84 } : { type: 'png' }
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

const maal = {}
for (const w of BREDDER) {
  const c = await br.newContext({ viewport: { width: w, height: HOEJDE(w) }, deviceScaleFactor: Number(DPR) })
  if (efter) await c.route('**/_forslag/**', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
  const p = await aabn(c, BASE)
  for (const [navn, sti] of SIDER) {
    await gaaTil(p, BASE + sti)
    await laegPaa(p, { css: LAG, js: JS, valg: VALG })
    await p.screenshot({ path: join(UD, `${navn}-${w}.${ext}`), ...opt })
    const m = await p.evaluate(() => {
      const kort = [...document.querySelectorAll('a.kort')].slice(0, 12)
      const img = kort.map((k) => k.querySelector('.kort-billede img')).filter(Boolean)
      const f = (e) => { const b = e.getBoundingClientRect(); return b.height ? +(b.width / b.height).toFixed(3) : null }
      return {
        kort: kort.length, medFoto: img.length,
        rammeForhold: [...new Set(img.map((i) => f(i.parentElement)))],
        kildeForhold: [...new Set(img.map((i) => (i.naturalHeight ? +(i.naturalWidth / i.naturalHeight).toFixed(3) : null)))],
        objectFit: [...new Set(img.map((i) => getComputedStyle(i).objectFit))],
        korthoejder: kort.map((k) => Math.round(k.getBoundingClientRect().height)),
        foersteKortY: kort[0] ? Math.round(kort[0].getBoundingClientRect().top + scrollY) : null,
        overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    if (navn === 'forside') {
      m.kontrast = await heroKontrast(p)
      m.foto = await fotoSynlig(p)
      m.kreditering = await kreditering(p)
      if (m.kreditering.findes) m.kreditering.kontrast = (await tekstKontrast(p, m.kreditering.hvor === 'fodnote' ? '.fotokredit' : '.hero-kredit'))?.vaerst ?? null
      m.populaere = await populaere(p)
      // Forsidens bund: talstribe, sektioner, båndet og fodnoten.
      const top = await p.evaluate(() => { const e = document.querySelector('.sider') || document.querySelector('.talstribe'); return e ? e.getBoundingClientRect().top + scrollY - 40 : 0 })
      const h = await p.evaluate(() => document.documentElement.scrollHeight)
      await p.screenshot({ path: join(UD, `forside-${w}-bund.${ext}`), fullPage: true, clip: { x: 0, y: top, width: w, height: h - top }, ...opt })
      // Søgekortet med seks lange bynavne: en belastningsprøve af
      // linjebruddet (seedets byer er for korte til at vise det).
      m.populaereBelastet = await populaere(p, true)
      const kb = await p.evaluate(() => { const e = document.querySelector('.hero-soeg'); const r = e.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: r.height + 16 } })
      await p.screenshot({ path: join(UD, `soegekort-belastet-${w}.${ext}`), clip: kb, fullPage: true, ...opt })
    }
    maal[`${navn}-${w}`] = m
  }
  await c.close()
}
writeFileSync(join(UD, 'maal.json'), JSON.stringify({ variant: VARIANT, mobil: MOBIL, lag: LAGMAPPE ? 'andet lag' : 'dette lag', foto: FOTO, maal }, null, 1))
for (const [k, v] of Object.entries(maal)) console.log(k, JSON.stringify(v))
await br.close()
