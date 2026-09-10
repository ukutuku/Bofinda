// ═══════════════════════════════════════════════════════════════
//  Skærmbilleder af Cloud-testmiljøet, til visuel gennemgang.
//
//  Måler også det, øjet ikke ser: vandret overløb, overlap mellem
//  faste elementer, og om billederne faktisk er dekodet. Et pænt
//  skærmbillede af et layout, der scroller vandret, er ikke en
//  godkendelse.
//
//      node scripts/cloud/skaerm.mjs <mappe>
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import postgres from 'postgres'

const UD = process.argv[2] || 'skaermbilleder/nu'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'

function findChromium() {
  if (process.env.BOFINDA_CHROMIUM) return process.env.BOFINDA_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const bud = [`${rod}/chromium`, `${rod}/chromium/chrome-linux/chrome`]
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      bud.push(`${rod}/${d}/chrome-linux/chrome`)
    }
  } catch { /* videre */ }
  for (const b of bud) { try { if (statSync(b).isFile()) return b } catch { /* næste */ } }
  console.error('FEJL: ingen Chromium fundet.'); process.exit(1)
}

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(url || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.'); process.exit(1)
  }
}
const sql = postgres(url, { max: 1 })

// To boliger med hver sin datamaengde: den rigeste og den fattigste.
// Detaljesiden skal se bevidst ud i BEGGE tilfaelde — en side, der kun
// er proevet paa fyldige data, falder fra hinanden paa de tomme.
// Rangeret paa hvor meget kilden FAKTISK oplyser, ikke paa et fast krav:
// testdataene har ikke depositum paa nogen bolig, og et haardt krav ville
// bare finde nul. «Rig» er den bedst oplyste, der findes.
const [rig] = await sql`
  select l.id,
    (case when l.total_monthly is not null then 1 else 0 end
     + case when l.deposit is not null then 1 else 0 end
     + case when l.size_m2 is not null then 1 else 0 end
     + case when l.rooms is not null then 1 else 0 end
     + case when l.description is not null then 1 else 0 end
     + case when jsonb_array_length(coalesce(l.amenities, '[]'::jsonb)) > 0 then 1 else 0 end
    ) as felter, count(i.id) as billeder
  from listings l left join listing_images i on i.listing_id = l.id
  where l.status = 'active'
  group by l.id order by felter desc, count(i.id) desc limit 1`
const [fattig] = await sql`
  select l.id,
    (case when l.total_monthly is not null then 1 else 0 end
     + case when l.size_m2 is not null then 1 else 0 end
     + case when l.rooms is not null then 1 else 0 end
     + case when l.description is not null then 1 else 0 end
    ) as felter, count(i.id) as billeder
  from listings l left join listing_images i on i.listing_id = l.id
  where l.status = 'active' and l.total_monthly is null
  group by l.id order by felter asc, count(i.id) asc limit 1`
await sql.end()
if (!rig || !fattig) { console.error('FEJL: fandt ikke to egnede boliger.'); process.exit(1) }

mkdirSync(UD, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const SIDER = [
  ['soegeside-desktop',   '/?sted=Attrapby',            1440, 2400],
  ['soegeside-mobil',     '/?sted=Attrapby',             390, 844],
  ['soegeside-side2',     '/?sted=Attrapby&side=2',     1440, 2400],
  ['forside-desktop',     '/',                          1440, 1800],
  ['detalje-rig-desktop', `/bolig/${rig.id}`,           1440, 2600],
  ['detalje-rig-mobil',   `/bolig/${rig.id}`,            390, 844],
  ['detalje-tynd-desktop',`/bolig/${fattig.id}`,        1440, 2000],
  ['detalje-tynd-mobil',  `/bolig/${fattig.id}`,         390, 844],
]

for (const [navn, sti, bredde, hoejde] of SIDER) {
  const ctx = await browser.newContext({ viewport: { width: bredde, height: hoejde },
    deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  await p.goto(BASE + sti, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)

  const maal = await p.evaluate(() => ({
    overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    billeder: [...document.images].filter((i) => i.naturalWidth > 0).length,
    billederIAlt: document.images.length,
    // Klippet tekst: et element hvis indhold er bredere end kassen og
    // ikke selv scroller.
    klippet: [...document.querySelectorAll('.adresse, .kort-pris, h1, .oek-tal, .noegletal li')]
      .filter((e) => e.scrollWidth > e.clientWidth + 2).length,
  }))
  tjek(`${navn} · intet vandret overløb`, maal.overloeb <= 0, `${maal.overloeb} px`)
  tjek(`${navn} · billeder dekodet`, maal.billederIAlt === 0 || maal.billeder > 0,
    `${maal.billeder}/${maal.billederIAlt}`)
  tjek(`${navn} · ingen klippet nøgletekst`, maal.klippet === 0, `${maal.klippet}`)

  // Mobilbillederne tages som SKÆRMEN, ikke som hele siden: en 390 px
  // side i fuld længde bliver 20.000 px høj og kan ikke bruges til at
  // vurdere noget. Desktop tages i fuld højde, hvor det giver mening.
  await p.screenshot({ path: `${UD}/${navn}.png`, fullPage: !navn.includes('mobil') })
  if (navn.includes('mobil')) {
    await p.screenshot({ path: `${UD}/${navn}-hele.png`, fullPage: true })
  }
  await ctx.close()
}

// Naerbillede af ét boligkort.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const p = await ctx.newPage()
  // Forsiden: den har hele bestanden og dermed ogsaa en pager.
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const kort = p.locator('a.kort[data-bolig]').first()
  if (await kort.count()) await kort.screenshot({ path: `${UD}/boligkort-naerbillede.png` })
  // Pagination nederst.
  const sider = p.locator('nav.sider')
  if (await sider.count()) await sider.screenshot({ path: `${UD}/pagination.png` })
  tjek('boligkort og pagination fanget', await kort.count() > 0 && await sider.count() > 0)
  await ctx.close()
}

await browser.close()
console.log(`\n  ${fejl === 0 ? '✓' : '✗'} skærmbilleder i ${UD}/  (bolig rig=${rig.id.slice(0,8)} tynd=${fattig.id.slice(0,8)})`)
process.exit(fejl === 0 ? 0 : 1)
