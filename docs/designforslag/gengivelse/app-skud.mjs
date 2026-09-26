// ═══════════════════════════════════════════════════════════════
//  Den RIGTIGE app i en rigtig browser — ikke komponenter enkeltvis.
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh: next dev mod den
//  isolerede lokale Postgres). Rører hverken base eller kode: laget og
//  mockuppen lægges på i browseren, kun til skærmbilledet.
//
//      node app-skud.mjs <udmappe> foer|efter|efter-haand [png|jpeg] [dpr]
//
//  Otte billeder (fire sider × 390/1440) plus forsidens bund, og målinger:
//  billedforhold i nettet, korthøjder, det første korts placering og
//  kontrasten på heroens tekst mod det FAKTISKE foto bag den.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const [UD, VARIANT = 'foer', FORMAT = 'png', DPR = '1'] = process.argv.slice(2)
if (!UD) { console.error('brug: node app-skud.mjs <udmappe> foer|efter|efter-haand [png|jpeg] [dpr]'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const efter = VARIANT !== 'foer'

// Skrifterne: hentes én gang og serveres gennem en opsnappet rute, så
// siden kan bruge dem uden at noget lægges i appens public/.
const FONTE = join(UD, '.fonte')
if (efter && !existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE, '--haand'], { stdio: 'inherit' })
}
const LAG = efter ? [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(FORSLAG, 'forslag.css'), 'utf8'), readFileSync(join(FORSLAG, 'greb.css'), 'utf8')].join('\n') : ''
const JS = efter ? readFileSync(join(FORSLAG, 'greb.js'), 'utf8') : ''
// Next's udviklingsmarkør er ikke en del af siden. Skjult i begge varianter.
const ALTID = 'nextjs-portal{display:none!important}'

// Boliger med og uden billeder slås op i den lokale base, ikke hardkodes.
const url = process.env.DATABASE_URL_DIRECT
const hent = (q) => execFileSync('psql', [url, '-Atc', q]).toString().trim()
const medBilleder = hent(`select l.id from listings l join listing_images i on i.listing_id=l.id where l.status='active' group by l.id order by count(*) desc, l.id limit 1`)
const udenBilleder = hent(`select l.id from listings l where l.status='active' and not exists(select 1 from listing_images i where i.listing_id=l.id) order by l.id limit 1`)
const by = hent(`select city from listings where status='active' group by 1 having count(*) >= 12 order by count(*) desc limit 1`)
const SIDER = [['forside', '/'], ['soegning', `/?sted=${encodeURIComponent(by)}`],
  ['bolig-billeder', `/bolig/${medBilleder}`], ['bolig-uden', `/bolig/${udenBilleder}`]]

const ext = FORMAT === 'jpeg' ? 'jpg' : 'png'
const opt = FORMAT === 'jpeg' ? { type: 'jpeg', quality: 84 } : { type: 'png' }
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

async function kontrast(p, sel) {
  const el = p.locator(sel).first()
  if (!(await el.count())) return null
  // Tekstens egen udstrækning, ikke afsnittets boks: et afsnit i fuld
  // bredde ville ellers måle mod dele af fotoet, teksten aldrig rører.
  const box = await el.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e)
    const b = r.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, width: b.width, height: b.height } })
  const farve = await el.evaluate((e) => getComputedStyle(e).color)
  await el.evaluate((e) => { e.dataset.f = e.style.color; e.style.color = 'transparent' })
  const png = await p.screenshot({ clip: box, type: 'png', fullPage: true })
  await el.evaluate((e) => { e.style.color = e.dataset.f })
  return p.evaluate(async ({ b64, farve }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const L = (r, gg, bb) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(bb)
    const [tr, tg, tb] = farve.match(/\d+/g).map(Number); const lt = L(tr, tg, tb)
    let lo = 1, hi = 0
    for (let i = 0; i < d.length; i += 4) { const l = L(d[i], d[i + 1], d[i + 2]); lo = Math.min(lo, l); hi = Math.max(hi, l) }
    const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return +Math.min(cr(lt, lo), cr(lt, hi)).toFixed(2)
  }, { b64: png.toString('base64'), farve })
}

const maal = {}
for (const w of [1440, 390]) {
  const c = await br.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: Number(DPR) })
  if (efter) await c.route('**/_forslag/**', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
  const p = await c.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120000 })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForLoadState('networkidle'); await p.waitForTimeout(800) }
  for (const [navn, sti] of SIDER) {
    await p.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 120000 })
    await p.addStyleTag({ content: ALTID + '\n' + LAG })
    if (efter) { await p.addScriptTag({ content: JS }); await p.evaluate((h) => window.__bofindaForslag({ haand: h }), VARIANT === 'efter-haand') }
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)) }
      window.scrollTo(0, 0); await document.fonts.ready
    })
    await p.waitForTimeout(400)
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
      m.kontrast = {}
      for (const s of ['.hero-oejenbryn', '.hero h1', '.hero-manchet', '.hero-haand']) m.kontrast[s] = await kontrast(p, s)
      // Forsidens bund: talstribe, sektioner og båndet.
      const top = await p.evaluate(() => { const e = document.querySelector('.sider') || document.querySelector('.talstribe'); return e ? e.getBoundingClientRect().top + scrollY - 40 : 0 })
      const h = await p.evaluate(() => document.documentElement.scrollHeight)
      await p.screenshot({ path: join(UD, `forside-${w}-bund.${ext}`), fullPage: true, clip: { x: 0, y: top, width: w, height: h - top }, ...opt })
    }
    maal[`${navn}-${w}`] = m
  }
  await c.close()
}
writeFileSync(join(UD, 'maal.json'), JSON.stringify(maal, null, 1))
for (const [k, v] of Object.entries(maal)) console.log(k, JSON.stringify(v))
await br.close()
