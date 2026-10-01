// ═══════════════════════════════════════════════════════════════
//  Prøven af vagten mod kildebilleder (hero-maal.mjs › skaermbillede).
//
//      node proev-kildebilleder.mjs
//
//  Kræver appen på 127.0.0.1:3100 med testbasen (scripts/cloud/op.sh).
//  Testbasens sider skal kunne skrives: heltefotoet og de syntetiske
//  mønstre er vores. Lægges et kildebillede ind på siden — direkte, gennem
//  billedproxyen, som CSS-baggrund eller -maske, i <picture> — må filen
//  IKKE skrives. Det samme gælder billeder UDEN vært (data:-raster, blob:,
//  en SVG med indlejret raster): deres herkomst kan ikke afgøres, og den
//  dom er valgt, ikke arvet. Ikonerne (data:-SVG i mask-image) er vores.
//  Bagefter: kontroller-billeder.mjs skal godkende det skrevne billede og
//  afvise et billede uden kvittering og et, der er ændret efter vagten.
//  Exit 1 ved afvigelse. Intet uden for /tmp skrives.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { existsSync, mkdtempSync, rmSync, copyFileSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { aabn, gaaTil, skaermbillede, fremmedeBilleder } from './hero-maal.mjs'
import { PRAEDIKAT } from './billedkontrol.mjs'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = mkdtempSync(join(tmpdir(), 'kildebilleder-'))
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const p = await aabn(await br.newContext({ viewport: { width: 390, height: 844 } }), BASE)
// 1×1 PNG: et rasterbillede uden vært.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const indsaet = (html) => p.evaluate((h) => document.body.insertAdjacentHTML('afterbegin', h), html)
const TILFAELDE = [
  ['forsiden som den er (heltefoto og syntetiske mønstre)', null, true],
  ['kildens billede direkte', '<img src="https://images.ctfassets.net/x/y.jpg" width="10" height="10">', false],
  ['kildens billede gennem /api/billede', '<img src="/api/billede?u=https%3A%2F%2Fapp.propstep.com%2Fbillede.jpg&b=800&s=x" width="10" height="10">', false],
  ['kildens billede som CSS-baggrund', '<div style="width:10px;height:10px;background-image:url(https://www.balder.dk/a.jpg)"></div>', false],
  ['kildens billede i <picture>', '<picture><source srcset="https://dacas.dk/a.webp"><img src="https://dacas.dk/a.jpg" width="10" height="10"></picture>', false],
  ['kildens billede som CSS-maske', '<div style="width:10px;height:10px;background:#000;mask-image:url(https://images.ctfassets.net/m.png)"></div>', false],
  ['et rasterbillede uden vært (data:image/png)', `<img src="data:image/png;base64,${PNG}" width="10" height="10">`, false],
  ['en SVG med indlejret rasterbillede', `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><image href='data:image/png;base64,${PNG}' width='10' height='10'/></svg>`)}" width="10" height="10">`, false],
  ['et blob:-billede', null, false, async () => p.evaluate(async (b64) => {
    const b = await (await fetch('data:image/png;base64,' + b64)).blob()
    const i = new Image(10, 10); i.src = URL.createObjectURL(b); document.body.prepend(i); await i.decode()
  }, PNG)],
  ['en ren SVG uden raster (som ikonerne)', `<img src="data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10'/></svg>")}" width="10" height="10">`, true],
]
let fejl = 0
let skrevet = null
for (const [navn, html, skalSkrives, goer] of TILFAELDE) {
  await gaaTil(p, BASE + '/')
  if (html) { await indsaet(html); await p.waitForTimeout(300) }
  if (goer) await goer()
  const fil = join(UD, `${fejl}-${navn.length}.png`)
  const afviste = []
  const skrev = await skaermbillede(p, { path: fil }, afviste)
  const ok = skrev === skalSkrives && existsSync(fil) === skalSkrives
  if (!ok) fejl++
  if (skrev && !html && !goer) skrevet = fil
  console.log(`${ok ? '✓' : '✗'} ${navn}: ${skrev ? 'skrevet' : 'afvist'} (forventet ${skalSkrives ? 'skrevet' : 'afvist'})${afviste.length ? ' · ' + afviste[0].kilder[0] : ''}`)
  if (!html && skrev) console.log(`    fremmede billeder på testbasens forside: ${(await fremmedeBilleder(p)).length}`)
}
await br.close()

// ── Udgivelsen: kontroller-billeder.mjs på det, en bygger ville samle ──
const kontrol = (...a) => spawnSync(process.execPath, [new URL('./kontroller-billeder.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' }).status
const uden = join(UD, 'uden-kvittering.png'); copyFileSync(skrevet, uden)        // et billede, vagten ikke skrev
const aendret = join(UD, 'aendret.png'); copyFileSync(skrevet, aendret)
appendFileSync(join(UD, '.billedkontrol.jsonl'), JSON.stringify({ fil: 'aendret.png', sha256: '0'.repeat(64), praedikat: PRAEDIKAT.version }) + '\n')   // kvittering for andre bytes
for (const [navn, sti, forventet] of [
  ['billedet, vagten skrev', skrevet, 0],
  ['et billede uden kvittering', uden, 1],
  ['et billede ændret efter kvitteringen', aendret, 1],
  ['mappen med alle tre', UD, 1],
]) {
  const s = kontrol(sti), ok = s === forventet
  if (!ok) fejl++
  console.log(`${ok ? '✓' : '✗'} kontroller-billeder: ${navn}: exit ${s} (forventet ${forventet})`)
}
rmSync(UD, { recursive: true, force: true })
console.log(fejl ? `\n${fejl} AFVIGELSE(R)` : `\nAlle ${TILFAELDE.length + 4} tilfælde gav det forventede.`)
process.exit(fejl ? 1 : 0)
