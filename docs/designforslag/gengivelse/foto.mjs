// ═══════════════════════════════════════════════════════════════
//  Skærmbilleder af de samlede sider. file://, ingen server.
//
//      node foto.mjs <arbejdsmappe> <foer|efter> <udmappe> [png|jpeg] [dpr]
//
//  Melder også de indlæste skrifter og vandret overløb: et pænt billede
//  med en stille faldet-tilbage-skrift eller vandret rul er ikke et
//  før/efter, der kan stoles på.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [A, MRK, UD, FORMAT = 'png', DPR = '1'] = process.argv.slice(2)
if (!A || !MRK || !UD) { console.error('brug: node foto.mjs <arbejdsmappe> <foer|efter> <udmappe> [png|jpeg] [dpr]'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const ext = FORMAT === 'jpeg' ? 'jpg' : 'png'
const opt = FORMAT === 'jpeg' ? { type: 'jpeg', quality: 84 } : { type: 'png' }

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})
const OPGAVER = [
  ['kort', 1400, 900, 'element'],
  ['side-kendt', 1440, 1000, 'fold'], ['side-kendt', 390, 844, 'fold'],
  ['side-klump', 1440, 1000, 'fold'], ['side-klump', 390, 844, 'fold'],
  ['side-kendt', 1440, 1000, 'hele'],
  ['liste', 1440, 1000, 'fold'], ['liste', 390, 844, 'fold'],
]
for (const [navn, w, h, slags] of OPGAVER) {
  const c = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(DPR) })
  const p = await c.newPage()
  await p.goto('file://' + join(A, `${navn}-${MRK}.html`), { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(150)
  const fil = join(UD, `${navn}-${w}${slags === 'hele' ? '-hele' : ''}.${ext}`)
  if (slags === 'element') await p.locator('.ark').screenshot({ path: fil, ...opt })
  else await p.screenshot({ path: fil, fullPage: slags === 'hele', ...opt })
  const fonte = await p.evaluate(() => [...new Set([...document.fonts]
    .filter((f) => f.status === 'loaded').map((f) => f.family))].join(', '))
  const overloeb = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(`${navn} ${w} ${slags}: skrift ${fonte || 'INGEN'} · overløb ${overloeb} px`)
  await c.close()
}
await br.close()
