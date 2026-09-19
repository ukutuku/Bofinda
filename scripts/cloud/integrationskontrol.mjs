// ═══════════════════════════════════════════════════════════════
//  Det, der KUN kan gå galt, når frontendredesignet og brugerområdet
//  står sammen.
//
//  ═══ HVORFOR DEN FINDES VED SIDEN AF DE ANDRE ═══
//
//  Hver gren har sine egne kontroller, og begge var grønne hver for sig.
//  De to fejl nedenfor kunne ingen af dem finde, fordi de ikke opstår i
//  én gren — de opstår i mødet:
//
//    · Kortet fik et løft på 2 px ved hover (redesignet). Favoritknappen
//      er absolut placeret på `.kort-hylster`, som ligger UDEN OM kortet
//      og derfor ikke løfter sig (brugerområdet). Sat sammen glider
//      kortet op under et hjerte, der bliver stående.
//    · `.raek1` blev slettet fra globals.css i redesignet, men «Mine
//      annoncer» bruger den stadig — og den side ser man kun, når man er
//      logget ind, altså kun når brugerområdet er med.
//
//  Kontrollen MÅLER den beregnede stil i browseren. En kildekontrol ville
//  finde ordet `.raek1` i filen og sige god for det, uden at vide om
//  reglen faktisk rammer elementet.
//
//      node scripts/cloud/integrationskontrol.mjs
// ═══════════════════════════════════════════════════════════════
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'

let pw
try {
  const m = await import(process.env.PLAYWRIGHT_MODUL ?? 'playwright')
  pw = m.chromium ?? m.default?.chromium
  if (!pw) throw new Error('ingen chromium')
} catch {
  console.log('\n  ⚠ playwright kunne ikke indlæses — kontrollen kræver en browser.\n')
  process.exit(2)
}

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const browser = await pw.launch({
  executablePath: process.env.CHROMIUM_STI || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
})

// ═══ 1 · Hjertet følger kortet ══════════════════════════════════
console.log('\n══ 1 · favoritknappen og kortets hover ══')
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/?by=Pr%C3%B8veby`, { waitUntil: 'networkidle' })

  const hylster = p.locator('.kort-hylster').first()
  tjek('1A · kortet ligger i et hylster', await hylster.count() > 0)

  // Knappen vises kun for en indlogget bruger. Pladsen og hylsteret er
  // der altid — og det er GEOMETRIEN, fejlen sad i.
  const maal = async () => p.evaluate(() => {
    const h = document.querySelector('.kort-hylster')
    if (!h) return null
    const k = h.querySelector('.kort')
    const cs = getComputedStyle(k)
    return { kort: cs.transform, hylster: getComputedStyle(h).transform }
  })

  const foer = await maal()
  tjek('1B · uden hover står kortet stille', foer && foer.kort === 'none', String(foer?.kort))

  await hylster.hover()
  await p.waitForTimeout(400)
  const efter = await maal()
  const loefter = efter && efter.kort !== 'none'
  tjek('1C · kortet løfter sig ved hover', loefter, String(efter?.kort))

  // Selve fundet: reglen, der får hjertet med. Den måles på CSSOM, fordi
  // knappen ikke er i DOM uden en session — men reglen SKAL være der, og
  // den skal pege på .favoritknap inde i et hylster, der hoveres.
  const regel = await p.evaluate(() => {
    for (const ss of document.styleSheets) {
      let r
      try { r = ss.cssRules } catch { continue }
      for (const x of r) {
        if (x.selectorText && x.selectorText.includes('.kort-hylster:hover')
            && x.selectorText.includes('.favoritknap')) {
          return { selektor: x.selectorText, transform: x.style.transform }
        }
      }
    }
    return null
  })
  tjek('1D · en regel flytter hjertet sammen med kortet',
    Boolean(regel && regel.transform && regel.transform !== 'none'),
    regel ? `${regel.selektor} → ${regel.transform}` : 'INGEN REGEL')

  // Og den skal give efter for reduced motion, ligesom kortets eget løft.
  const daempet = await p.evaluate(() => {
    for (const ss of document.styleSheets) {
      let r
      try { r = ss.cssRules } catch { continue }
      for (const x of r) {
        if (x.media && String(x.media).includes('reduced-motion')) {
          for (const y of x.cssRules) {
            if (y.selectorText && y.selectorText.includes('.favoritknap')) return true
          }
        }
      }
    }
    return false
  })
  tjek('1E · og den er slået fra ved «reduced motion»', daempet)

  await ctx.close()
}

// ═══ 2 · «Mine annoncer»-rækken er stadig en række ══════════════
console.log('\n══ 2 · .raek1 på Mine annoncer ══')
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const p = await ctx.newPage()
  // Siden kræver login. Reglen kan måles uden: vi indsætter et element
  // med klassen i en tom side fra SAMME oprindelse, så stylesheetet er
  // det samme, appen leverer.
  await p.goto(`${BASE}/privatliv`, { waitUntil: 'networkidle' })
  const stil = await p.evaluate(() => {
    const d = document.createElement('div')
    d.className = 'raek1'
    d.innerHTML = '<span>a</span><span>b</span>'
    document.body.appendChild(d)
    const cs = getComputedStyle(d)
    const svar = { display: cs.display, justify: cs.justifyContent }
    d.remove()
    return svar
  })
  tjek('2A · .raek1 er en flexrække', stil.display === 'flex', stil.display)
  tjek('2B · med mærkatet ud til højre', stil.justify === 'space-between', stil.justify)
  await ctx.close()
}

// ═══ 3 · «Min side» i toppen, på alle bredder ═══════════════════
console.log('\n══ 3 · adgangen til brugerområdet i brandbjælken ══')
for (const [navn, w] of [['1440', 1440], ['1100', 1100], ['768', 768], ['390', 390], ['320', 320]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'networkidle' })
  const m = await p.evaluate(() => {
    const a = document.querySelector('header .topmin')
    if (!a) return null
    const r = a.getBoundingClientRect()
    const cs = getComputedStyle(a)
    return {
      synlig: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0,
      hoejde: Math.round(r.height),
      linjehoejde: Math.round(parseFloat(cs.lineHeight) || 0),
      hoejre: Math.round(r.right),
      vindue: window.innerWidth,
    }
  })
  tjek(`3 · ${navn} px · «Min side» er synlig`, Boolean(m && m.synlig), m ? '' : 'IKKE I DOM')
  if (m) {
    tjek(`3 · ${navn} px · den bliver på én linje`,
      m.linjehoejde === 0 || m.hoejde <= m.linjehoejde * 1.6,
      `h=${m.hoejde} lh=${m.linjehoejde}`)
    tjek(`3 · ${navn} px · og inden for skærmen`, m.hoejre <= m.vindue,
      `højre=${m.hoejre} vindue=${m.vindue}`)
  }
  await ctx.close()
}

await browser.close()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
