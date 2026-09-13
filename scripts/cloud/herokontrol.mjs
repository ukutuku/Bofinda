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
/** Acceptkravet. WCAG AA for almindelig tekst. */
const KRAV = 4.5

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
    const soeg = document.querySelector('.soegeknap')
    const kredit = document.querySelector('.hero-kredit')
    const hr = hero.getBoundingClientRect()
    const sr = soeg.getBoundingClientRect()
    return {
      src: img && img.getAttribute('src'),
      dekodet: img ? img.complete && img.naturalWidth > 0 : false,
      nat: img ? `${img.naturalWidth}×${img.naturalHeight}` : null,
      fit: img && getComputedStyle(img).objectFit,
      pos: img && getComputedStyle(img).objectPosition,
      harFoto: hero.classList.contains('har-foto'),
      heroBoks: `${Math.round(hr.width)}×${Math.round(hr.height)}`,
      // Hver tekst paa hero'en, med sin egen kasse og sin egen farve.
      // Kontrollen maalte foer KUN h1. De andre staar over det samme
      // foto, i lysere farver, og en overskrift der holder siger intet
      // om broedteksten under den.
      tekster: [
        ['den lille overskrift', '.hero-oejenbryn'],
        ['overskriften', '.hero h1'],
        ['brødteksten', '.hero-manchet'],
        ['fotokrediteringen', '.hero-kredit'],
      ].map(([navn, vaelger]) => {
        const e = document.querySelector(vaelger)
        if (!e) return null
        const cs = getComputedStyle(e)
        // LINJEKASSERNE, ikke elementets kasse. `.hero-oejenbryn` er et
        // <p> i fuld indholdsbredde — 1300 px — mens teksten fylder 160.
        // Maalte vi elementets kasse, maalte vi fladen et halvt tusinde
        // pixels fra naermeste bogstav, og paa en bred skaerm er dét
        // fotoet uden sloer. Foerste koersel meldte 1,0:1 om en groen
        // tekst paa en naesten hvid flade af netop den grund.
        // En Range om indholdet giver kasserne om de faktiske linjer.
        const r = document.createRange()
        r.selectNodeContents(e)
        const linjer = [...r.getClientRects()]
          .filter((b) => b.width >= 2 && b.height >= 2)
          .map((b) => ({
            x: Math.floor(b.left), y: Math.floor(b.top),
            width: Math.ceil(b.width), height: Math.ceil(b.height),
          }))
        return {
          navn, vaelger, farve: cs.color, stoerrelse: cs.fontSize, vaegt: cs.fontWeight,
          linjer,
        }
      }).filter((t) => t && t.linjer.length > 0),
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
   * Fladen bag EN tekst, maalt i tekstens egen kasse.
   *
   * `motiv` = 'foto'  — som brugeren ser det med standardfotoet.
   * `motiv` = 'sort'  — det samme sloer over et HELT SORT billede.
   *
   * Teksten skjules med `color: transparent`, IKKE med
   * `visibility: hidden`. Forskellen betyder noget for
   * fotokrediteringen: den har sin egen moerke pille bag sig, og
   * `visibility: hidden` ville skjule pillen med, saa vi maalte hvid
   * tekst mod fotoet i stedet for mod pillen. Med gennemsigtig farve
   * bliver alt andet staaende, ogsaa `backdrop-filter`.
   *
   * FOERSTE UDGAVE AF DEN HER KONTROL MAALTE FORKERT PAA EN ANDEN MAADE.
   * Den laeste den laveste alfa i hele gradienten og regnede paa den.
   * Paa en bred skaerm er gradienten VANDRET, og dens laveste stop (.18)
   * ligger yderst til hoejre — flere hundrede pixels fra overskriften,
   * som staar i venstre side over .62–.97. Kontrollen meldte roedt om en
   * flade, teksten aldrig rammer. Nu maales der dér, hvor teksten er,
   * og sloerets form er ligegyldig.
   */
  const bagTeksten = async (t, motiv) => {
    await p.evaluate(([vaelger, m2]) => {
      const s = document.createElement('style'); s.id = 'hero-maaling'
      s.textContent = `${vaelger}{color:transparent!important;text-shadow:none!important}`
        + (m2 === 'sort' ? '.hero-billede{background:#000!important}.hero-billede img{visibility:hidden!important}' : '')
      document.head.appendChild(s)
    }, [t.vaelger, motiv])
    await p.waitForTimeout(200)
    const farve = tal(t.farve)
    let vaerst = Infinity, sum = 0, n = 0
    for (const linje of t.linjer) {
      const buf = await p.screenshot({ clip: linje })
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      for (let i = 0; i < data.length; i += info.channels * 3) {
        const r = forhold(farve, [data[i], data[i + 1], data[i + 2]])
        if (r < vaerst) vaerst = r
        sum += r; n++
      }
    }
    await p.evaluate(() => document.getElementById('hero-maaling')?.remove())
    return { vaerst, middel: sum / n }
  }

  for (const t of m.tekster) {
    // Rækkefølgen er med vilje: det værst tænkelige først. Den faktiske
    // måling kan være grøn, fordi NETOP dette foto er lyst; den anden er
    // grøn, fordi sløret og farven er rigtige.
    const sort = await bagTeksten(t, 'sort')
    tjek(`${bredde} px · ${t.navn} holder 4,5:1 over ETHVERT motiv`,
      sort.vaerst >= KRAV, `${sort.vaerst.toFixed(1)}:1 over et helt sort billede · ${t.farve} ${t.stoerrelse}`)
    const foto = await bagTeksten(t, 'foto')
    tjek(`${bredde} px · ${t.navn} mod den faktiske flade`,
      foto.vaerst >= KRAV, `dårligste ${foto.vaerst.toFixed(1)}:1 · middel ${foto.middel.toFixed(1)}:1`)
  }

  await p.screenshot({ path: `${UD}/forside-${bredde}.png` })
  await p.screenshot({ path: `${UD}/forside-${bredde}-hele.png`, fullPage: true })
  console.log(`      hero ${m.heroBoks} px`)
  await ctx.close()
}

await browser.close()
console.log(`\n  ${fejl === 0 ? '✓ alt grønt' : `✗ ${fejl} fejlede`} · billeder i ${UD}/`)
process.exit(fejl === 0 ? 0 : 1)
