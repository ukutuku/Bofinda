// ═══════════════════════════════════════════════════════════════
//  Sætter den gengivne markup ind i layoutets skal og lægger den rigtige
//  globals.css under — og forslagslaget ovenpå, hvis der er et.
//
//      node saml.mjs <arbejdsmappe> <globals.css> [forslag.css] [skrift]
//
//  Arbejdsmappen skal indeholde kort.json, side-kendt.html,
//  side-klump.html og gruppe.html fra markup.mjs, samt fonte.css.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [A, GLOBALS, FORSLAG, SKRIFT] = process.argv.slice(2)
if (!A || !GLOBALS) { console.error('brug: node saml.mjs <arbejdsmappe> <globals.css> [forslag.css] [skrift]'); process.exit(2) }
const ROD_REPO = resolve(new URL('../../..', import.meta.url).pathname)
copyFileSync(GLOBALS, join(A, 'globals.css'))
copyFileSync(join(ROD_REPO, 'public/hero-stue.jpg'), join(A, 'foto.jpg'))
if (FORSLAG) copyFileSync(FORSLAG, join(A, 'forslag.css'))
const MRK = FORSLAG ? 'efter' : 'foer'

// Billedproxyens adresser findes ikke uden server. Samme stemningsfoto
// overalt, med forskudt beskæring, så galleriet ikke er fire ens felter.
const billeder = (html) => {
  let n = 0
  return html
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/srcSet="[^"]*"/g, '').replace(/sizes="[^"]*"/g, '')
    .replace(/src="\/api\/billede[^"]*"/g, () => {
      const pos = ['50% 50%', '15% 60%', '85% 40%', '40% 80%', '70% 20%', '30% 30%'][n++ % 6]
      return `src="foto.jpg" style="object-position:${pos}"`
    })
}

const hoved = (titel, ekstra = '') => `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titel}</title>
<link rel="stylesheet" href="fonte.css"><style>:root{--font-sans:'Inter'}${ekstra}</style>
<link rel="stylesheet" href="globals.css">${FORSLAG ? '<link rel="stylesheet" href="forslag.css">' : ''}
${FORSLAG && SKRIFT ? `<style>:root{--skrift:'${SKRIFT}'}</style>` : ''}</head>`

// Layoutets bjælke og fod, som i app/layout.tsx.
const TOP = '<header class="top"><div class="ramme toplinje"><a class="maerke" href="/">BOFINDA</a><nav class="topnav" aria-label="Hovedmenu"><a href="/">Lejeboliger</a><a href="/udlejer">For udlejere</a></nav><div class="tophandlinger"><a class="nav-primaer" href="/udlejer/opret">Opret annonce</a></div></div></header>'
const FOD = '<footer class="sidefod"><div class="ramme"><a href="/udlejer">Udlej din bolig</a><a href="/privatliv">Privatlivspolitik</a><a href="/privatliv#statistik">Skift dit valg om statistik</a><span>Boliger hentet fra offentligt tilgængelige udlejningsportaler samt annoncer oprettet af udlejere selv. Henvendelse sker hos kilden eller direkte hos udlejeren.</span></div></footer>'

const side = (krop, titel) =>
  `${hoved(titel)}<body>${TOP}<div class="ramme">${billeder(krop)}</div>${FOD}</body></html>`

// Kortarket: tre kort à 420 px, som i listens tre kolonner ved 1440 px.
// Hvert kort får sin egen container, ligesom `.listeomraade` giver det.
const kort = JSON.parse(readFileSync(join(A, 'kort.json'), 'utf8'))
const ark = `${hoved('kort', '.ark{display:grid;grid-template-columns:repeat(3,420px);gap:28px;padding:32px;align-items:start}.celle{container-type:inline-size}')}
<body><div class="ark">${['kendt', 'ukendt', 'klump'].map((n) => `<div class="celle">${billeder(kort[n])}</div>`).join('')}</div></body></html>`

writeFileSync(join(A, `kort-${MRK}.html`), ark)
writeFileSync(join(A, `side-kendt-${MRK}.html`), side(readFileSync(join(A, 'side-kendt.html'), 'utf8'), 'boligside'))
writeFileSync(join(A, `side-klump-${MRK}.html`), side(readFileSync(join(A, 'side-klump.html'), 'utf8'), 'boligside'))
writeFileSync(join(A, `liste-${MRK}.html`), side(readFileSync(join(A, 'gruppe.html'), 'utf8'), 'listeside'))
console.log(`✓ ${MRK}-sider skrevet i ${A}`)
