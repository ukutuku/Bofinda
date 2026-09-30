// Tilstande hovedfejningen ikke nåede: filterchips og åbent filterpanel.
import pw from '/home/user/Bofinda/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import { aabn, gaaTil, laegPaa, HOEJDE } from '/home/user/Bofinda/docs/designforslag/gengivelse/hero-maal.mjs'
const LAG = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const FOTO = JSON.parse(fs.readFileSync(`${LAG}/heltefoto.json`, 'utf8'))
const src = fs.readFileSync(new URL('./maal-farver-fejning.mjs', import.meta.url), 'utf8')
const I_SIDEN = eval('(' + src.slice(src.indexOf('const I_SIDEN = ') + 'const I_SIDEN = '.length, src.indexOf('\n// ─── Kørsel')) + ')')
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ud = []
for (const w of [1440, 390]) {
  const c = await b.newContext({ viewport: { width: w, height: HOEJDE(w) } })
  const p = await aabn(c, 'http://127.0.0.1:3100')
  for (const sti of ['/?sted=Attrapby&prisMax=20000&type=lejlighed&elevator=1&fuld=1', '/?sted=Attrapby&prisMax=20000&type=lejlighed&flere=1', '/?flere=1']) {
    await gaaTil(p, 'http://127.0.0.1:3100' + sti)
    await p.addStyleTag({ path: `${LAG}/forslag.css` }); await p.addStyleTag({ path: `${LAG}/greb.css` })
    await laegPaa(p, { css: '', js: fs.readFileSync(`${LAG}/greb.js`, 'utf8'), valg: { mobil: 'baand', foto: FOTO } })
    await p.evaluate(I_SIDEN)
    const info = await p.evaluate(() => ({ chips: document.querySelectorAll('.filterchips .chip').length, panelAabent: !!document.querySelector('details[open]'), afkryds: document.querySelectorAll('input[type=checkbox]').length }))
    const f = await p.evaluate(() => window.__farve.fej())
    for (const x of f) ud.push({ w, sti, ...x })
    process.stdout.write(`${w} ${sti} ${JSON.stringify(info)} fund ${f.length}\n`)
    await p.screenshot({ path: `beskaar/_ekstra-${w}-${sti.replace(/\W+/g, '_')}.png`, fullPage: false })
  }
  await c.close()
}
await b.close()
fs.writeFileSync((process.env.MAPPE ?? '.') + '/farver-chips.json', JSON.stringify(ud, null, 1))
