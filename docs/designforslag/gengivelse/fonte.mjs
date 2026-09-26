// Henter de to skrifter fra Google Fonts (kun latin) og skriver fonte.css
// med vægtintervaller, så variable vægte som 640 og 690 tegnes rigtigt —
// ligesom next/font gør i appen.
//     node fonte.mjs <arbejdsmappe>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const A = process.argv[2]
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const FAMILIER = [
  ['Inter', 'Inter:wght@100..900', 'normal', '100 900'],
  ['IBM Plex Sans', 'IBM+Plex+Sans:wght@100..700', 'normal', '100 700'],
  ['IBM Plex Sans', 'IBM+Plex+Sans:ital,wght@1,100..700', 'italic', '100 700'],
]
const ud = []
for (const [navn, spec, stil, vaegt] of FAMILIER) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=block`, { headers: { 'user-agent': UA } })).text()
  const blok = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[\s\S]*?\})/g)].find((m) => m[1] === 'latin')
  if (!blok) throw new Error(`ingen latin-blok for ${navn}`)
  const url = blok[2].match(/url\((https:[^)]+)\)/)[1]
  const fil = `${navn.replace(/\W/g, '')}-${stil}.woff2`
  writeFileSync(join(A, fil), Buffer.from(await (await fetch(url)).arrayBuffer()))
  ud.push(`@font-face{font-family:'${navn}';font-style:${stil};font-weight:${vaegt};font-display:block;src:url(${fil}) format('woff2')}`)
}
writeFileSync(join(A, 'fonte.css'), ud.join('\n') + '\n')
console.log('✓ skrifter hentet')
