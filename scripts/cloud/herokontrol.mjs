// ═══════════════════════════════════════════════════════════════
//  Forsidens hero — fotoet, beskaeringen og laesbarheden.
//
//      node scripts/cloud/herokontrol.mjs <udmappe>
//
//  Koeres UDEN `NEXT_PUBLIC_HERO_FOTO`: pointen er netop, at det
//  lokale `public/hero-stue.jpg` er standarden og virker uden nogen
//  miljoevariabel. Er variablen sat i processen, stopper kontrollen.
//
//  Laesbarheden maales paa TO maader, og begge skal holde:
//
//  · FAKTISK — de rigtige pixels bag overskriften. Siden gengives én
//    gang med teksten skjult, og fladen i overskriftens kasse laeses
//    derfra. Det er det, brugeren ser med netop dette foto.
//
//  · VAERST TAENKELIGE — det samme sloer over et HELT SORT billede,
//    maalt i overskriftens egen kasse. Holder den, holder overskriften
//    for ethvert foto, ogsaa et moerkt sat ind via miljoevariablen.
//
//  Den anden maaling er den vigtige. Den foerste kan vaere groen, fordi
//  netop dette foto er lyst; den anden er groen, fordi CSS'en er rigtig.
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { mkdirSync, readdirSync, statSync } from 'node:fs'

const UD = process.argv[2] || 'skaermbilleder/hero'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const BREDDER = [390, 768, 1440, 1920]

if (process.env.NEXT_PUBLIC_HERO_FOTO) {
  console.error('FEJL: NEXT_PUBLIC_HERO_FOTO er sat. Kontrollen maaler standardfotoet.')
  process.exit(1)
}

function findChromium() {
  if (process.env.BOFINDA_CHROMIUM) return process.env.BOFINDA_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const bud = [`${rod}/chromium`, `${rod}/chromium/chrome-linux/chrome`]
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      bud.push(`${rod}/${d}/chrome-linux/chrome`)
    }
  } catch { /* videre */ }
  for (const b of bud) { try { if (statSync(b).isFile()) return b } catch { /* naeste */ } }
  console.error('FEJL: ingen Chromium fundet.'); process.exit(1)
}

const kanal = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b)
const forhold = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const tal = (s) => (s.match(/[\d.]+/g) || []).map(Number)

mkdirSync(UD, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })
let fejl = 0
const tjek = (n, ok, note = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++ }

for (const bredde of BREDDER) {
  const ctx = await browser.newContext({
    viewport: { width: bredde, height: bredde >= 1440 ? 1000 : 900 }, deviceScaleFactor: 1,
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
  const knap = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await knap.count()) {
    await knap.first().click()
    for (let i = 0; i < 80; i++) {
      await p.waitForTimeout(200)
      if (!(await p.locator('.samtykke').count())) break
    }
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
  }
  // DEKODET, ikke bare «har en src». Et billede der 404'er har ogsaa en src.
  await p.waitForFunction(() => {
    const i = document.querySelector('.hero-billede img')
    return i && i.complete && i.naturalWidth > 0
  }, null, { timeout: 30_000 }).catch(() => {})
  await p.waitForTimeout(400)

  const m = await p.evaluate(() => {
    const img = document.querySelector('.hero-billede img')
    const hero = document.querySelector('.hero')
    const h1 = document.querySelector('.hero h1')
    const soeg = document.querySelector('.soegeknap')
    const kredit = document.querySelector('.hero-kredit')
    const hr = hero.getBoundingClientRect()
    const tr = h1.getBoundingClientRect()
    const sr = soeg.getBoundingClientRect()
    return {
      src: img && img.getAttribute('src'),
      dekodet: img ? img.complete && img.naturalWidth > 0 : false,
      nat: img ? `${img.naturalWidth}×${img.naturalHeight}` : null,
      fit: img && getComputedStyle(img).objectFit,
      pos: img && getComputedStyle(img).objectPosition,
      harFoto: hero.classList.contains('har-foto'),
      heroBoks: `${Math.round(hr.width)}×${Math.round(hr.height)}`,
      h1: { x: Math.round(tr.left), y: Math.round(tr.top), w: Math.round(tr.width), h: Math.round(tr.height) },
      h1Farve: getComputedStyle(h1).color,
      knapH: Math.round(sr.height),
      kredit: kredit && kredit.textContent.trim(),
      overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  tjek(`${bredde} px · standardfotoet bruges uden miljøvariabel`, m.src === '/hero-stue.jpg', String(m.src))
  tjek(`${bredde} px · billedet er dekodet i browseren`, m.dekodet, `${m.nat}`)
  tjek(`${bredde} px · proportionerne bevares — cover, ingen stræk`, m.fit === 'cover', `${m.fit} · ${m.pos}`)
  tjek(`${bredde} px · krediteringen står på skærmen`,
    m.kredit === 'Stemningsfoto: Taryn Elliott / Pexels', String(m.kredit))
  tjek(`${bredde} px · søgeknappen er mindst 48 px høj`, m.knapH >= 48, `${m.knapH} px`)
  tjek(`${bredde} px · intet vandret overløb`, m.overloeb <= 0, `${m.overloeb} px`)

  /**
   * Fladen bag overskriften, maalt i selve overskriftens kasse.
   *
   * `motiv` = 'foto'  — som brugeren ser det med standardfotoet.
   * `motiv` = 'sort'  — det samme sloer over et HELT SORT billede.
   *
   * FOERSTE UDGAVE AF DEN HER KONTROL MAALTE FORKERT. Den laeste den
   * laveste alfa i hele gradienten og regnede paa den. Paa en bred
   * skaerm er gradienten VANDRET, og dens laveste stop (.18) ligger
   * yderst til hoejre — flere hundrede pixels fra overskriften, som
   * staar i venstre side over .62–.97. Kontrollen meldte roedt om en
   * flade, teksten aldrig rammer. Nu maales der dér, hvor teksten er,
   * og sloerets form er ligegyldig.
   */
  const bagTeksten = async (motiv) => {
    await p.evaluate((m2) => {
      const s = document.createElement('style'); s.id = 'hero-maaling'
      s.textContent = '.hero-indhold,.hero-soeg,.hero-kredit{visibility:hidden!important}'
        + (m2 === 'sort' ? '.hero-billede{background:#000!important}.hero-billede img{visibility:hidden!important}' : '')
      document.head.appendChild(s)
    }, motiv)
    await p.waitForTimeout(200)
    const buf = await p.screenshot({ clip: { x: m.h1.x, y: m.h1.y, width: m.h1.w, height: m.h1.h } })
    await p.evaluate(() => document.getElementById('hero-maaling')?.remove())
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const t = tal(m.h1Farve)
    let vaerst = Infinity, sum = 0, n = 0
    for (let i = 0; i < data.length; i += info.channels * 7) {
      const r = forhold(t, [data[i], data[i + 1], data[i + 2]])
      if (r < vaerst) vaerst = r
      sum += r; n++
    }
    return { vaerst, middel: sum / n }
  }

  const sort = await bagTeksten('sort')
  tjek(`${bredde} px · overskriften holder 4,5:1 over ETHVERT motiv`,
    sort.vaerst >= 4.5, `dårligste ${sort.vaerst.toFixed(1)}:1 over et helt sort billede`)

  const foto = await bagTeksten('foto')
  tjek(`${bredde} px · overskriften mod den faktiske flade bag den`,
    foto.vaerst >= 4.5, `dårligste ${foto.vaerst.toFixed(1)}:1 · middel ${foto.middel.toFixed(1)}:1`)

  await p.screenshot({ path: `${UD}/forside-${bredde}.png` })
  await p.screenshot({ path: `${UD}/forside-${bredde}-hele.png`, fullPage: true })
  console.log(`      hero ${m.heroBoks} px`)
  await ctx.close()
}

await browser.close()
console.log(`\n  ${fejl === 0 ? '✓ alt grønt' : `✗ ${fejl} fejlede`} · billeder i ${UD}/`)
process.exit(fejl === 0 ? 0 : 1)
