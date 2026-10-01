// ═══════════════════════════════════════════════════════════════
//  Prøven af vagten mod kildebilleder (hero-maal.mjs › skaermbillede).
//
//      node proev-kildebilleder.mjs
//
//  Kræver appen på 127.0.0.1:3100 med testbasen (scripts/cloud/op.sh).
//  Testbasens sider skal kunne skrives: heltefotoet og de syntetiske
//  mønstre er vores. Lægges et kildebillede ind på siden — direkte, gennem
//  billedproxyen, som CSS-baggrund eller i <picture> — må filen IKKE
//  skrives. Exit 1 ved afvigelse. Intet uden for /tmp skrives.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { aabn, gaaTil, skaermbillede, fremmedeBilleder } from './hero-maal.mjs'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = mkdtempSync(join(tmpdir(), 'kildebilleder-'))
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const p = await aabn(await br.newContext({ viewport: { width: 390, height: 844 } }), BASE)
const indsaet = (html) => p.evaluate((h) => document.body.insertAdjacentHTML('afterbegin', h), html)
const TILFAELDE = [
  ['forsiden som den er (heltefoto og syntetiske mønstre)', null, true],
  ['kildens billede direkte', '<img src="https://images.ctfassets.net/x/y.jpg" width="10" height="10">', false],
  ['kildens billede gennem /api/billede', '<img src="/api/billede?u=https%3A%2F%2Fapp.propstep.com%2Fbillede.jpg&b=800&s=x" width="10" height="10">', false],
  ['kildens billede som CSS-baggrund', '<div style="width:10px;height:10px;background-image:url(https://www.balder.dk/a.jpg)"></div>', false],
  ['kildens billede i <picture>', '<picture><source srcset="https://dacas.dk/a.webp"><img src="https://dacas.dk/a.jpg" width="10" height="10"></picture>', false],
]
let fejl = 0
for (const [navn, html, skalSkrives] of TILFAELDE) {
  await gaaTil(p, BASE + '/')
  if (html) { await indsaet(html); await p.waitForTimeout(300) }
  const fil = join(UD, `${fejl}-${navn.length}.png`)
  const afviste = []
  const skrev = await skaermbillede(p, { path: fil }, afviste)
  const ok = skrev === skalSkrives && existsSync(fil) === skalSkrives
  if (!ok) fejl++
  console.log(`${ok ? '✓' : '✗'} ${navn}: ${skrev ? 'skrevet' : 'afvist'} (forventet ${skalSkrives ? 'skrevet' : 'afvist'})${afviste.length ? ' · ' + afviste[0].kilder[0] : ''}`)
  if (!html && skrev) console.log(`    fremmede billeder på testbasens forside: ${(await fremmedeBilleder(p)).length}`)
}
await br.close()
rmSync(UD, { recursive: true, force: true })
console.log(fejl ? `\n${fejl} AFVIGELSE(R)` : `\nAlle ${TILFAELDE.length} tilfælde gav det forventede.`)
process.exit(fejl ? 1 : 0)
