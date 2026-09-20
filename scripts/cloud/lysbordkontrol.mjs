// ═══════════════════════════════════════════════════════════════
//  Lysbordkontrollen: er galleriets lysbord en RIGTIG modal?
//
//      node scripts/cloud/lysbordkontrol.mjs
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Lysbordet var et `<div role="dialog" aria-modal="true">`. Attributten
//  lover tre ting, et div ikke kan holde. Maalt mod den kode, paa en
//  bolig med fem billeder, paa BEGGE bredder:
//
//    ✗ fokus flyttes ind ved aabning     — fokus blev paa BUTTON.flere
//    ✗ Tab kan ikke forlade lysbordet    — 21 af 30 tryk landede udenfor,
//                                          bl.a. «Boligen», «Faciliteter»
//    ✗ fokus vender tilbage ved lukning  — fokus faldt til <body>
//
//  Med `showModal()` giver browseren alle tre. Prøven er skrevet FØR
//  rettelsen og fejlede paa netop de tre linjer; den er altsaa vist at
//  kunne fejle, og ikke bare grøn.
//
//  ── HVAD DEN OGSAA MAALER ────────────────────────────────────
//  De tre ting, der skulle BEVARES: at lysbordet aabner paa det foerste
//  billede, at piletasten skifter, og at en miniature skifter. En
//  fokusrettelse, der braekker bladringen, er ikke en rettelse.
//
//  Boligen vaelges i basen som den med flest billeder — proeven skal
//  ikke kende et id, og et datasaet uden billeder skal sige det, ikke
//  melde sig groent.
//
//  Exit: 0 = alt groent · 1 = noget fejlede · 2 = intet at maale paa
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2] ?? null
if (!process.env.DATABASE_URL) {
  console.error('FEJL: DATABASE_URL mangler — proeven kan ikke vaelge en bolig.'); process.exit(2)
}
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
const [b] = await sql`
  select l.id, count(i.*)::int as n from listings l
  join listing_images i on i.listing_id = l.id
  where l.status = 'active' group by l.id having count(i.*) >= 3 order by count(i.*) desc limit 1`
await sql.end()
if (!b) {
  console.error('FEJL: ingen aktiv bolig med mindst 3 billeder — der er intet at maale paa.')
  process.exit(2)
}
console.log(`bolig ${b.id} med ${b.n} billeder\n`)
import { mkdirSync } from 'node:fs'
if (UD) mkdirSync(UD, { recursive: true })
const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})
let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}
for (const bredde of [1440, 768, 390]) {
  const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
  console.log(`── ${merke} (${bredde} px) ──`)
  const c = await br.newContext({ viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 } })
  const p = await c.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  await p.goto(`${BASE}/bolig/${b.id}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)

  // 1. Aabn via knappen — og husk hvad udloeseren var.
  const udloeser = p.locator('.galleri .flere')
  if (!(await udloeser.count())) { tjek(false, 'galleriknappen findes'); await c.close(); continue }
  await udloeser.focus()
  await udloeser.click()
  await p.waitForTimeout(400)

  // 2. Fokus skal staa INDE i lysbordet.
  const veAabning = await p.evaluate(() => {
    const d = document.querySelector('.lysbord')
    const a = document.activeElement
    return {
      aaben: !!d,
      inde: !!(d && a && d.contains(a)),
      hvor: a ? `${a.tagName}.${(a.className || '').toString().split(' ')[0] || '(ingen klasse)'}` : 'intet',
    }
  })
  tjek(veAabning.aaben, `${merke} · lysbordet åbner`)
  tjek(veAabning.inde, `${merke} · fokus flyttes ind i lysbordet ved åbning`, `fokus stod på ${veAabning.hvor}`)

  // 3. Vaelg sidste miniature, og tab rundt.
  const minier = p.locator('.lysbord .minier button')
  const antal = await minier.count()
  await minier.nth(antal - 1).click()
  await p.waitForTimeout(250)
  const slap = []
  for (let i = 0; i < 30; i++) {
    await p.keyboard.press('Tab')
    const ude = await p.evaluate(() => {
      const d = document.querySelector('.lysbord')
      const a = document.activeElement
      if (!d || !a || d.contains(a)) return null
      // <body>/<html> er Chromiums eget ombrydningspunkt, ikke en laekage.
      if (a === document.body || a === document.documentElement) return null
      return `${a.tagName}.${(a.className || '').toString().split(' ')[0] || '(ingen klasse)'}`
        + ` «${(a.textContent || '').trim().slice(0, 30)}»`
    })
    if (ude) slap.push(ude)
  }
  tjek(slap.length === 0, `${merke} · Tab kan ikke forlade lysbordet`,
    slap.length ? `${slap.length} af 30 — bl.a. ${slap.slice(0, 2).join(', ')}` : '0 af 30 tab-tryk')

  // Shift+Tab den anden vej.
  const slapBag = []
  for (let i = 0; i < 30; i++) {
    await p.keyboard.press('Shift+Tab')
    const ude = await p.evaluate(() => {
      const d = document.querySelector('.lysbord')
      const a = document.activeElement
      if (!d || !a || d.contains(a)) return null
      if (a === document.body || a === document.documentElement) return null
      return `${a.tagName}.${(a.className || '').toString().split(' ')[0] || '(ingen klasse)'}`
    })
    if (ude) slapBag.push(ude)
  }
  tjek(slapBag.length === 0, `${merke} · Shift+Tab kan heller ikke forlade lysbordet`,
    slapBag.length ? `${slapBag.length} af 30 — bl.a. ${slapBag.slice(0, 2).join(', ')}` : '0 af 30')

  // 4. Escape lukker, og fokus vender tilbage til udloeseren.
  await p.keyboard.press('Escape')
  await p.waitForTimeout(350)
  // «Findes ikke i DOM'en» er IKKE maalet paa, om den er lukket. Dialogen
  // er monteret bestandigt — det er netop dét, der gor, at browseren naar
  // at give fokus tilbage. Det, der skal maales, er `open` og at den
  // faktisk er usynlig.
  const veLukning = await p.evaluate(() => {
    const d = document.querySelector('.lysbord')
    const a = document.activeElement
    return {
      lukket: !!d && !d.open && getComputedStyle(d).display === 'none',
      open: d ? d.open : null,
      display: d ? getComputedStyle(d).display : null,
      paaUdloeser: a?.classList.contains('flere') ?? false,
      hvor: `${a?.tagName}.${(a?.className || '').toString().split(' ')[0] || '(ingen)'}`,
    }
  })
  tjek(veLukning.lukket, `${merke} · Escape lukker lysbordet`,
    `open=${veLukning.open} display=${veLukning.display}`)
  tjek(veLukning.paaUdloeser, `${merke} · fokus vender tilbage til udløseren`, `fokus står på ${veLukning.hvor}`)

  // 5. Det, der skal BEVARES: aabning paa foerste billede og billedskift.
  await udloeser.click()
  await p.waitForTimeout(350)
  const foerste = await p.evaluate(() => document.querySelector('.lysbord .taeller')?.textContent?.trim())
  tjek(foerste === `1 / ${antal}`, `${merke} · åbner stadig på det første billede`, `«${foerste}»`)
  await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(300)
  const efterPil = await p.evaluate(() => document.querySelector('.lysbord .taeller')?.textContent?.trim())
  tjek(efterPil === `2 / ${antal}`, `${merke} · pil til højre skifter billede`, `«${efterPil}»`)
  await p.locator('.lysbord .minier button').first().click()
  await p.waitForTimeout(300)
  const efterMini = await p.evaluate(() => document.querySelector('.lysbord .taeller')?.textContent?.trim())
  tjek(efterMini === `1 / ${antal}`, `${merke} · miniature skifter billede`, `«${efterMini}»`)
  if (UD) {
    await p.locator('.lysbord .minier button').last().click()
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${UD}/lysbord-fokus-${merke}.png` })
  }
  await p.keyboard.press('Escape').catch(() => {})
  await c.close()
  console.log('')
}
await br.close()
console.log(fejl === 0 ? '✓ alle fokuskontroller bestået' : `✗ ${fejl} fokuskontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
