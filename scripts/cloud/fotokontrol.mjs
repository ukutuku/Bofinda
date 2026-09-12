// ═══════════════════════════════════════════════════════════════
//  Fotokontrollen: baerer layoutet et RIGTIGT fotografi?
//
//      node scripts/cloud/fotokontrol.mjs <udmappe>
//
//  Alt andet i testmiljoeet bruger genererede baand i 800x600. De er
//  gode til at se, AT et billede er hentet og skaleret — og ubrugelige
//  til at afgoere, hvordan siden ser ud med et motiv, der har en anden
//  beskaering, en anden lysstyrke og et andet sideforhold.
//
//  ── HVOR FOTOGRAFIERNE KOMMER FRA ────────────────────────────
//  Fra `scripts/cloud/aktiver.mjs`, som serverer filerne i
//  BOFINDA_FOTOMAPPE (uden for repoet). Er mappen tom, kan
//  fotokontrollen IKKE koeres, og scriptet siger det og slutter med
//  status 2. Den maa aldrig kunne forveksles med en bestaaet kontrol.
//
//  ── HVAD DEN SAA GOER I STEDET ───────────────────────────────
//  Uden fotografier maaler den GEOMETRIEN med genererede former i
//  staaende og liggende format og i lys og moerk tone. Det svarer paa
//  beskaering, straek, hoejde og overloeb — men ikke paa, hvordan et
//  rigtigt motiv ser ud. De to ting holdes adskilt i udskriften.
//
//  Exit: 0 = fotokontrol bestaaet · 1 = noget fejlede
//        2 = ingen fotografier; kun geometri maalt
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import postgres from 'postgres'

const UD = process.argv[2] || 'skaermbilleder/foto'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const AKTIV = process.env.BOFINDA_AKTIV_BASE ?? 'http://127.0.0.1:55433'

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

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(url || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.'); process.exit(1)
  }
}

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

// ── Hvilke motiver har vi? ─────────────────────────────────────
const svar = await fetch(`${AKTIV}/foto`).then((r) => r.json()).catch(() => ({ filer: [] }))
const fotos = svar.filer ?? []
const RIGTIGE = fotos.length > 0

// Motiverne: enten fotografierne, eller de genererede former.
// «staaende»/«liggende» afgoeres for fotografier af filens egne maal,
// maalt i browseren — ikke gaettet ud fra filnavnet.
const MOTIVER = RIGTIGE
  ? fotos.map((f) => `${AKTIV}/foto/${f}`)
  : ['staaende', 'liggende', 'lys', 'moerk'].map((f) => `${AKTIV}/form-${f}.png`)

console.log(RIGTIGE
  ? `\n  FOTOKONTROL — ${fotos.length} fotografier fra ${svar.mappe}\n`
  : `\n  ⚠ INGEN FOTOGRAFIER i ${svar.mappe ?? '(ukendt mappe)'}.\n`
    + '    Fotokontrollen er IKKE koert. Nedenfor maales kun GEOMETRIEN\n'
    + '    med genererede former — det er ikke det samme.\n')

// Maerkatet paa hver testvisning. Med rigtige fotografier er det den
// paakraevede saetning ordret; uden dem maa der ikke staa «stockfotos»,
// for saa ville maerkatet selv vaere usandt.
const MAERKAT = RIGTIGE
  ? 'Stockfotos til layouttest — ikke en virkelig boligannonce.'
  : 'Genererede testmotiver til layouttest — ikke fotografier, ikke en virkelig boligannonce.'

const sql = postgres(url, { max: 1 })

mkdirSync(UD, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })

// ── Hvilke annoncer kan vi overhovedet SE? ─────────────────────
//  Foerste udgave valgte de to annoncer med flest billeder direkte i
//  basen. De laa ikke noedvendigvis paa forsidens foerste side, og en
//  af dem kunne vaere medlem af en GRUPPE, hvor kortet baerer
//  repraesentantens id — saa `a.kort[data-bolig=…]` fandt ingenting, og
//  kontrollen meldte «intet <img>» om et kort, der aldrig var der.
//  Nu spoerges siden foerst: hvilke ENKELTKORT staar der?
const IDS = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
  const ids = await p.evaluate(() =>
    [...document.querySelectorAll('a.kort[data-bolig]:not([data-gruppe])')]
      .map((a) => a.getAttribute('data-bolig')).slice(0, 2))
  await ctx.close()
  return ids
})()
if (IDS.length < 2) {
  console.error('FEJL: fandt ikke to enkeltkort paa forsiden.'); process.exit(1)
}
const oprindelige = await sql`
  select id, listing_id, external_url, position from listing_images
  where listing_id in ${sql(IDS)} order by listing_id, position`

const saetMotiver = async (id, urls) => {
  await sql`delete from listing_images where listing_id = ${id}`
  for (const [p, u] of urls.entries()) {
    await sql`insert into listing_images (listing_id, external_url, position)
              values (${id}, ${u}, ${p})`
  }
}

try {
  // Annonce 1 faar ALLE motiver, saa galleriet og lysbordet kan proeves.
  // Annonce 2 faar det foerste motiv alene — kortets forsidebillede.
  await saetMotiver(IDS[0], MOTIVER)
  await saetMotiver(IDS[1], [MOTIVER[0]])

  for (const bredde of [1440, 390]) {
    const merke = bredde === 390 ? 'mobil' : 'desktop'
    const ctx = await browser.newContext({
      viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    })
    const p = await ctx.newPage()

    // Samtykket afvises med den rigtige knap — aldrig skjult med CSS.
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
    const knap = p.getByRole('button', { name: 'Kun det nødvendige' })
    if (await knap.count()) {
      await knap.first().click()
      for (let i = 0; i < 160; i++) {
        await p.waitForTimeout(250)
        try { if (await p.locator('.samtykke').count() === 0) break } catch { /* navigerer */ }
      }
      await p.waitForLoadState('networkidle').catch(() => {})
    }

    // Maerkatet indsaettes af KONTROLLEN, ikke af appen. Appkoden er
    // uroert; det her er en proevevisning og skal staa som det.
    const saetMaerkat = async () => p.evaluate((tekst) => {
      document.getElementById('testmaerkat')?.remove()
      const d = document.createElement('div')
      d.id = 'testmaerkat'
      d.textContent = tekst
      // NEDERST, ikke oeverst: et maerkat i toppen daekkede brandbjaelken,
      // og bjaelken er en del af det layout, billedet skal vise.
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;'
        + 'background:#8a5300;color:#fff;font:600 13px/1.5 system-ui,sans-serif;'
        + 'padding:7px 14px;text-align:center;letter-spacing:.01em'
      document.body.appendChild(d)
    }, MAERKAT)

    // ── Kortet: det foerste motiv som forsidebillede ────────────
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
    await p.waitForTimeout(400)
    await saetMaerkat()
    const kort = await p.evaluate((ids) => {
      const ud = []
      for (const id of ids) {
        const a = document.querySelector(`a.kort[data-bolig="${id}"]`)
        const img = a && a.querySelector('.kort-billede img')
        if (!img) { ud.push({ id, fandt: false }); continue }
        const r = img.getBoundingClientRect()
        const s = getComputedStyle(img)
        const ramme = img.parentElement.getBoundingClientRect()
        ud.push({
          id, fandt: true,
          nat: [img.naturalWidth, img.naturalHeight],
          vist: [Math.round(r.width), Math.round(r.height)],
          rammeForhold: +(ramme.width / ramme.height).toFixed(3),
          objectFit: s.objectFit,
          dekodet: img.naturalWidth > 0,
          kortHoejde: Math.round(a.getBoundingClientRect().height),
        })
      }
      return ud
    }, IDS)

    for (const k of kort) {
      const maerke = `${merke} · kort ${k.id.slice(0, 8)}`
      if (!k.fandt) { tjek(`${maerke} · billedet er i kortet`, false, 'intet <img>'); continue }
      tjek(`${maerke} · motivet er dekodet`, k.dekodet, `${k.nat[0]}×${k.nat[1]} px`)
      // `cover` beskaerer; `fill` ville STRAEKKE. Det er forskellen
      // mellem et beskaaret motiv og et forvraenget.
      tjek(`${maerke} · beskæres (cover), strækkes ikke`, k.objectFit === 'cover', k.objectFit)
      // Billedet fylder hele rammen, og rammen har sit eget forhold —
      // saa hoejden kan ikke loebe loebsk med et staaende motiv.
      tjek(`${maerke} · billedet fylder rammen uden at sprænge kortet`,
        k.vist[0] > 0 && k.vist[1] > 0 && k.kortHoejde < (merke === 'mobil' ? 900 : 520),
        `vist ${k.vist[0]}×${k.vist[1]} · kort ${k.kortHoejde} px høj`)
    }

    const overloeb = () => p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    tjek(`${merke} · listen med motiverne har intet vandret overløb`, await overloeb() <= 0)
    await p.screenshot({ path: `${UD}/kort-${merke}.png` })

    // ── Galleriet og lysbordet ──────────────────────────────────
    await p.goto(`${BASE}/bolig/${IDS[0]}`, { waitUntil: 'networkidle', timeout: 90_000 })
    await p.waitForTimeout(500)
    await saetMaerkat()
    const g = await p.evaluate(() => {
      const gal = document.querySelector('.galleri')
      if (!gal) return { fandt: false }
      const r = gal.getBoundingClientRect()
      // KUN de synlige. Under 720 px skjuler galleriet alt andet end
      // foerste billede (`display: none`), og et skjult billede bliver
      // aldrig dekodet. Et krav om at ALLE var dekodet ville derfor
      // melde en fejl om en bevidst besparelse paa mobil.
      const billeder = [...gal.querySelectorAll('img')]
        .filter((i) => i.getBoundingClientRect().width > 0)
        .map((i) => ({
          nat: [i.naturalWidth, i.naturalHeight],
          vist: [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)],
          fit: getComputedStyle(i).objectFit,
          dekodet: i.naturalWidth > 0,
        }))
      const flere = gal.querySelector('.flere')
      const fr = flere && flere.getBoundingClientRect()
      return {
        fandt: true, hoejde: Math.round(r.height), bredde: Math.round(r.width), billeder,
        flereInde: fr ? (fr.left >= r.left - 1 && fr.right <= r.right + 1
          && fr.top >= r.top - 1 && fr.bottom <= r.bottom + 1) : null,
      }
    })
    if (g.fandt) {
      tjek(`${merke} · galleriet holder sig under 400 px`, g.hoejde <= 400, `${g.hoejde} px`)
      tjek(`${merke} · galleriets SYNLIGE motiver er dekodet`,
        g.billeder.length > 0 && g.billeder.every((b) => b.dekodet),
        g.billeder.map((b) => `${b.nat[0]}×${b.nat[1]}`).join(' · '))
      tjek(`${merke} · galleriet beskærer (cover), strækker ikke`,
        g.billeder.every((b) => b.fit === 'cover'))
      if (g.flereInde !== null) {
        tjek(`${merke} · «+N billeder» ligger inde i galleriet (intet overlap ud)`, g.flereInde)
      }
    } else {
      tjek(`${merke} · galleriet findes`, false)
    }
    tjek(`${merke} · boligsiden har intet vandret overløb`, await overloeb() <= 0)
    await p.screenshot({ path: `${UD}/galleri-${merke}.png` })

    // Lysbordet: hele motivet skal kunne ses, ikke et beskaaret udsnit.
    const aabnet = await p.evaluate(async () => {
      const b = document.querySelector('.galleri > button')
      if (!b) return { fandt: false }
      b.click()
      await new Promise((r) => setTimeout(r, 400))
      const img = document.querySelector('.lys-billede')
      if (!img) return { fandt: false, aabnede: false }
      const r = img.getBoundingClientRect()
      return {
        fandt: true, aabnede: true,
        fit: getComputedStyle(img).objectFit,
        nat: [img.naturalWidth, img.naturalHeight],
        vist: [Math.round(r.width), Math.round(r.height)],
      }
    })
    if (aabnet.fandt && aabnet.aabnede) {
      tjek(`${merke} · lysbordet åbner`, true)
      tjek(`${merke} · lysbordet viser HELE motivet (contain)`, aabnet.fit === 'contain', aabnet.fit)
      // Med `contain` skal det viste forhold svare til motivets eget.
      const a1 = aabnet.nat[0] / aabnet.nat[1]
      const a2 = aabnet.vist[0] / aabnet.vist[1]
      tjek(`${merke} · motivet er ikke forvrænget i lysbordet`,
        Math.abs(a1 - a2) / a1 < 0.02,
        `motiv ${a1.toFixed(2)} · vist ${a2.toFixed(2)}`)
      await saetMaerkat()
      await p.screenshot({ path: `${UD}/lysbord-${merke}.png` })
      await p.keyboard.press('Escape')
      await p.waitForTimeout(250)
      tjek(`${merke} · lysbordet lukker igen med Escape`,
        await p.locator('.lysbord').count() === 0)
    } else {
      tjek(`${merke} · lysbordet åbner`, false, 'ingen .lys-billede')
    }

    // ── «+N billeder» mod et MOERKT motiv ───────────────────────
    //  Knappen sidder nederst til hoejre, altsaa over det SIDSTE synlige
    //  motiv. I foerste omgang var det den lyse form. Rekkefoelgen
    //  byttes, saa den ogsaa proeves mod det moerkeste, vi har.
    //  Selve kontrasten er regnet analytisk i lancering.mjs mod baade
    //  helt hvidt og helt sort underlag; det her er billedet til oejet.
    if (MOTIVER.length >= 3) {
      const byttet = [...MOTIVER]
      const sidst = byttet.length - 1
      ;[byttet[2], byttet[sidst]] = [byttet[sidst], byttet[2]]
      await saetMotiver(IDS[0], byttet)
      await p.goto(`${BASE}/bolig/${IDS[0]}`, { waitUntil: 'networkidle', timeout: 90_000 })
      await p.waitForTimeout(500)
      await saetMaerkat()
      const k = await p.evaluate(() => {
        const gal = document.querySelector('.galleri')
        const flere = gal && gal.querySelector('.flere')
        if (!flere) return { fandt: false }
        const r = gal.getBoundingClientRect()
        const fr = flere.getBoundingClientRect()
        return {
          fandt: true,
          inde: fr.left >= r.left - 1 && fr.right <= r.right + 1
            && fr.top >= r.top - 1 && fr.bottom <= r.bottom + 1,
          farve: getComputedStyle(flere).color,
          bund: getComputedStyle(flere).backgroundColor,
        }
      })
      tjek(`${merke} · knappen ligger stadig inde i galleriet med byttet orden`,
        !k.fandt || k.inde)
      tjek(`${merke} · knappens egne farver er uændrede af motivet`,
        !k.fandt || (k.bund === 'rgba(255, 255, 255, 0.94)' && k.farve === 'rgb(20, 22, 26)'),
        k.fandt ? `${k.farve} paa ${k.bund}` : 'ingen knap')
      await p.screenshot({ path: `${UD}/galleri-${merke}-moerkt-motiv.png` })
      await saetMotiver(IDS[0], MOTIVER)
    }

    await ctx.close()
  }
} finally {
  // Basen skal se ud praecis som foer — ogsaa hvis noget faldt om.
  for (const id of IDS) await sql`delete from listing_images where listing_id = ${id}`
  for (const r of oprindelige) {
    await sql`insert into listing_images (id, listing_id, external_url, position)
              values (${r.id}, ${r.listing_id}, ${r.external_url}, ${r.position})`
  }
  const [{ n }] = await sql`select count(*)::int as n from listing_images
                            where listing_id in ${sql(IDS)}`
  console.log(`\n  · testannoncerne sat tilbage (${n} af ${oprindelige.length} billedrækker)`)
  await sql.end()
  await browser.close()
}

console.log(`\n  ${fejl === 0 ? '✓' : '✗'} ${fejl === 0 ? 'alt grønt' : `${fejl} fejlede`}`
  + ` · billeder i ${UD}/`)
if (fejl) process.exit(1)
if (!RIGTIGE) {
  console.log('\n  ⚠ FOTOKONTROLLEN ER IKKE GENNEMFØRT — der var ingen fotografier.')
  console.log('    Ovenstående er geometri målt med genererede former.')
  process.exit(2)
}
