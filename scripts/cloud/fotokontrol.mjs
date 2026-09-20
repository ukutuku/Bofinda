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
// Galleriet viser tre ruder plus «Se alle N billeder». Er der faerre motiver
// end det, gentages de — ellers staar galleriet som ét billede (`.g1`),
// og saa kan hverken de tre ruder eller knappen proeves. Gentagelsen
// staar i udskriften: det er det SAMME fotografi, ikke fire forskellige.
const fyld = (liste) => {
  const ud = []
  for (let i = 0; i < 4; i++) ud.push(liste[i % liste.length])
  return ud
}
const MOTIVER = RIGTIGE
  ? fyld(fotos.map((f) => `${AKTIV}/foto/${f}`))
  : ['staaende', 'liggende', 'lys', 'moerk'].map((f) => `${AKTIV}/form-${f}.png`)

console.log(RIGTIGE
  ? `\n  FOTOKONTROL — ${fotos.length} fotografi(er) fra ${svar.mappe}\n`
    + `    ${fotos.join(', ')}\n`
    + (fotos.length < 4
      ? `    Bemaerk: der er ${fotos.length}, ikke fire. Motivet gentages i galleriet,\n`
        + '    saa de tre ruder og «Se alle N billeder» kan proeves — det er det SAMME\n'
        + '    fotografi flere gange, ikke flere forskellige.\n'
      : '')
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

  for (const bredde of [1440, 768, 390]) {
    const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
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
          kortBredde: Math.round(a.getBoundingClientRect().width),
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
      // Graensen foelger kortets EGEN bredde, ikke vinduets. Kortet
      // bryder paa `@container boligkort (max-width: 460px)`, hvor
      // billedet gaar fra at staa ved siden af teksten til at ligge
      // over den — og saa er kortet naturligt hoejere. Paa 768 px er
      // listen to spalter à ~350 px, altsaa den STABLEDE form, selv om
      // vinduet er bredt. En graense bundet til `merke === 'mobil'`
      // ville derfor maale den forkerte form ved netop den bredde.
      const loft = k.kortBredde <= 460 ? 900 : 520
      tjek(`${maerke} · billedet fylder rammen uden at sprænge kortet`,
        k.vist[0] > 0 && k.vist[1] > 0 && k.kortHoejde < loft,
        `vist ${k.vist[0]}×${k.vist[1]} · kort ${k.kortBredde}×${k.kortHoejde} px (loft ${loft})`)
    }

    const overloeb = () => p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    tjek(`${merke} · listen med motiverne har intet vandret overløb`, await overloeb() <= 0)
    // Rul hen til kortet FOER billedet tages. Paa 390 px ligger det
    // foerste kort under foldet, og et skaermbillede af toppen viser
    // ikke det, kontrollen handler om.
    await p.evaluate((id) => {
      const a = document.querySelector(`a.kort[data-bolig="${id}"]`)
      if (a) a.scrollIntoView({ block: 'center' })
    }, IDS[0])
    await p.waitForTimeout(400)
    await saetMaerkat()
    await p.screenshot({ path: `${UD}/kort-${merke}.png` })

    // ── Og hvert kort for sig ───────────────────────────────────
    // Sideskaermbilledet viser toppen af listen, og paa 390 px ligger
    // det ene af de to motiver uden for udsnittet. Et billede, der ikke
    // viser den tilstand, det er navngivet efter, dokumenterer ingenting
    // — saa hvert kort tages ogsaa for sig, med selve elementet som
    // ramme. Saa kan der ikke vaere tvivl om, hvad man ser paa.
    for (const [i, id] of IDS.entries()) {
      const e = p.locator(`a.kort[data-bolig="${id}"]`).first()
      if (!(await e.count())) continue
      await e.scrollIntoViewIfNeeded()
      await p.mouse.move(2, 2)
      await p.waitForTimeout(250)
      await e.screenshot({ path: `${UD}/motiv${i + 1}-${merke}.png` })
    }

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
        // Navnet sagde «+N billeder» efter at knappen var doebt om. En
        // rapportlinje, der ikke svarer til virkeligheden, er vaerre end
        // ingen linje — samme regel som startlinjen, der printede hele
        // kilderegistret, mens `koerAlle` filtrerede.
        tjek(`${merke} · «Se alle N billeder» ligger inde i galleriet (intet overlap ud)`, g.flereInde)
      }
    } else {
      tjek(`${merke} · galleriet findes`, false)
    }
    tjek(`${merke} · boligsiden har intet vandret overløb`, await overloeb() <= 0)
    await p.screenshot({ path: `${UD}/galleri-${merke}.png` })

    // ── Galleriknappen: siger den det RIGTIGE tal? ───────────────
    //  Den sagde «+N billeder», hvor N var `billeder.length - 3` — altsaa
    //  hvor mange der laa ud over de tre ruder, komponenten lægger i
    //  gitteret. Men under 720 px skjuler CSS'en alle ruder paa naer den
    //  foerste. Med fire motiver saa en telefonbruger derfor ÉT foto og
    //  fik at vide, at der var «+1 billeder» — to i alt, ikke fire.
    //
    //  Forventningen regnes af MOTIVER.length, ikke skrevet af. Skifter
    //  proeven antal motiver, foelger paastanden med; og staar der et
    //  hardcodet «4» i koden, fejler den, naar tallet aendres.
    const galknap = await p.evaluate(() => {
      const gal = document.querySelector('.galleri')
      const f = gal && gal.querySelector('.flere')
      if (!f) return { fandt: false }
      const r = f.getBoundingClientRect()
      return {
        fandt: true,
        tekst: (f.textContent ?? '').replace(/\s+/g, ' ').trim(),
        navn: f.getAttribute('aria-label') || (f.textContent ?? '').trim(),
        b: Math.round(r.width), h: Math.round(r.height),
        galBredde: Math.round(gal.getBoundingClientRect().width),
        klippet: f.scrollWidth > f.clientWidth + 1,
        // Hvor mange ruder ser man FAKTISK ved den her bredde?
        synligeRuder: [...gal.querySelectorAll('button:not(.flere)')]
          .filter((e) => e.getBoundingClientRect().width > 0).length,
      }
    })
    const VENTET = `Se alle ${MOTIVER.length} billeder`
    tjek(`${merke} · galleriknappen findes`, galknap.fandt)
    if (galknap.fandt) {
      tjek(`${merke} · knappen siger det SAMLEDE antal, ikke resten`,
        galknap.tekst === VENTET, `«${galknap.tekst}» — ventet «${VENTET}»`)
      // Selve fejlen, sat paa skrift. Den forrige paastand fulgte allerede
      // af den foerste og sagde intet om ruder; den her binder de to tal
      // sammen. Knappen sagde «+1 billeder», fordi tallet var regnet af
      // tre RUDER — saa paastanden skal vaere: uanset hvor mange ruder der
      // vises, naevner knappen det SAMLEDE antal og ikke ruderne.
      //
      // Den fejler, hvis nogen regner tallet af ruderne igen: paa mobil
      // ville knappen saa sige 1 eller 3, ikke 4. Og den fejler, hvis
      // nogen fjerner `display: none` i globals.css, saa mobil pludselig
      // viser tre ruder — for saa er `synligeRuder` ikke 1 laengere, og
      // linjen siger det.
      // Graensen er `@media (max-width: 720px)` i globals.css, ikke
      // ordet «mobil». Ved 768 px er vinduet OVER graensen, saa der
      // vises tre ruder — og en betingelse skrevet paa etiketten ville
      // tilfaeldigvis ramme rigtigt her og forkert ved den naeste
      // bredde, nogen tilfoejer. Reglen staar ét sted; proeven laeser
      // den samme graense.
      const VENTEDE_RUDER = bredde <= 720 ? 1 : Math.min(3, MOTIVER.length)
      tjek(`${merke} · ${VENTEDE_RUDER} rude(r) vises, og knappen siger stadig ${MOTIVER.length}`,
        galknap.synligeRuder === VENTEDE_RUDER
        && Number((galknap.tekst.match(/\d+/) ?? [])[0]) === MOTIVER.length,
        `${galknap.synligeRuder} synlig(e) rude(r) — knappen siger «${galknap.tekst}»`)
      // «scrollWidth > clientWidth» kan ikke fejle her: pillen har ingen
      // breddebegraensning og vokser med sin tekst, saa tallet er altid 0.
      // En proeve, der ikke kan fejle, er ikke en proeve. To ting, der
      // FAKTISK kan gaa galt med en laengere tekst, maales i stedet:
      // at knappen ikke bliver hoejere end én linje, og at den bliver
      // inde i galleriet. Begge fejler, hvis teksten en dag ikke kan vaere.
      tjek(`${merke} · teksten står på én linje`,
        galknap.h <= 52, `${galknap.b}×${galknap.h} px (over 52 ⇒ brudt)`)
      tjek(`${merke} · knappen er smallere end galleriet`,
        galknap.b < galknap.galBredde, `knap ${galknap.b} px i galleri ${galknap.galBredde} px`)
      tjek(`${merke} · berøringsmålet er mindst 44×44`,
        galknap.h >= 44 && galknap.b >= 44, `${galknap.b}×${galknap.h} px`)
      tjek(`${merke} · knappen har et brugbart tilgængeligt navn`,
        /\d/.test(galknap.navn) && galknap.navn.length > 3, `«${galknap.navn}»`)

      // Og den skal aabne lysbordet paa det FOERSTE billede. Den aabnede
      // foer paa nr. 4 — `setAaben(vist.length)`, altsaa den samme
      // antagelse om tre synlige ruder. Paa en telefon sprang den de to
      // over, brugeren aldrig havde set.
      const viaKnap = await p.evaluate(async () => {
        document.querySelector('.galleri .flere')?.click()
        await new Promise((r) => setTimeout(r, 400))
        const t = document.querySelector('.lysbord .taeller')
        const d = document.querySelector('.lysbord')
        return { aaben: !!d && d.open, taeller: t?.textContent?.trim() ?? null }
      })
      tjek(`${merke} · knappen åbner lysbordet`, viaKnap.aaben)
      tjek(`${merke} · lysbordet åbner på det FØRSTE billede`,
        viaKnap.taeller === `1 / ${MOTIVER.length}`,
        `tælleren siger «${viaKnap.taeller}», ventet «1 / ${MOTIVER.length}»`)
      if (viaKnap.aaben) {
        await saetMaerkat()
        await p.screenshot({ path: `${UD}/knap-lysbord-${merke}.png` })
        await p.keyboard.press('Escape')
        await p.waitForTimeout(250)
      }
    }

    // ── Ét billede: ingen knap, men stadig en vej ind ────────────
    //  Annonce 2 har præcis ét motiv. «Se alle 1 billeder» er hverken
    //  dansk eller en handling, saa knappen skal være væk — og saa skal
    //  det ene foto selv kunne aabne lysbordet, ellers er der ingen vej
    //  ind overhovedet.
    {
      await p.goto(`${BASE}/bolig/${IDS[1]}`, { waitUntil: 'networkidle', timeout: 90_000 })
      await p.waitForTimeout(400)
      const en = await p.evaluate(async () => {
        const gal = document.querySelector('.galleri')
        if (!gal) return { fandt: false }
        const ruder = [...gal.querySelectorAll('button:not(.flere)')]
        const f = gal.querySelector('.flere')
        ruder[0]?.click()
        await new Promise((r) => setTimeout(r, 400))
        const t = document.querySelector('.lysbord .taeller')
        return {
          fandt: true, ruder: ruder.length, harKnap: !!f,
          knaptekst: f?.textContent?.trim() ?? null,
          aaben: (() => { const d = document.querySelector('.lysbord'); return !!d && d.open })(),
          taeller: t?.textContent?.trim() ?? null,
        }
      })
      tjek(`${merke} · ét billede: galleriet findes`, en.fandt, `${en.ruder} rude(r)`)
      tjek(`${merke} · ét billede: ingen «Se alle»-knap`,
        en.harKnap === false, en.knaptekst ?? 'ingen knap')
      tjek(`${merke} · ét billede: fotoet åbner selv lysbordet`, en.aaben === true)
      tjek(`${merke} · ét billede: tælleren siger 1 / 1`, en.taeller === '1 / 1', String(en.taeller))
      await p.keyboard.press('Escape').catch(() => {})
      await p.waitForTimeout(200)
      await p.goto(`${BASE}/bolig/${IDS[0]}`, { waitUntil: 'networkidle', timeout: 90_000 })
      await p.waitForTimeout(400)
      await saetMaerkat()
    }

    // Lysbordet: hele motivet skal kunne ses, ikke et beskaaret udsnit.
    const aabnet = await p.evaluate(async () => {
      const b = document.querySelector('.galleri > button')
      if (!b) return { fandt: false }
      b.click()
      await new Promise((r) => setTimeout(r, 400))
      const img = document.querySelector('.lys-billede')
      if (!img) return { fandt: false, aabnede: false }
      // VENT paa dekodningen, ikke paa et fast tidsrum. Lysbordet henter
      // motivet i fuld bredde, og et fotografi paa 841 kB naar ikke at
      // blive dekodet paa 400 ms paa 1440 px — saa var naturalWidth 0, og
      // forholdet blev NaN. Paa 390 px var billedet mindre og naaede det,
      // saa fejlen sad kun paa den ene bredde: den slags maa en proeve
      // ikke rapportere som en forvraengning.
      for (let i = 0; i < 100 && !(img.complete && img.naturalWidth > 0); i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
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
      // Dialogen er monteret bestandigt (se Galleri.tsx), saa «findes ikke»
      // er ikke laengere maalet paa, om den er lukket. `open` og `display`
      // er, og de er skrappere: de fanger ogsaa en dialog, der er lukket
      // men blevet staaende synlig.
      const lukket = await p.evaluate(() => {
        const d = document.querySelector('.lysbord')
        return { findes: !!d, open: d ? d.open : null, display: d ? getComputedStyle(d).display : null }
      })
      tjek(`${merke} · lysbordet lukker igen med Escape`,
        lukket.findes && lukket.open === false && lukket.display === 'none',
        `open=${lukket.open} display=${lukket.display}`)

      // ── Og det STAAENDE motiv i lysbordet ─────────────────────
      //  Lysbordet skal vise hele motivet, ogsaa naar det er hoejere end
      //  bredt. Et liggende foto fylder rammen; et staaende efterlader
      //  luft i siderne, og det er dér, en `cover` i stedet for `contain`
      //  ville klippe toppen og bunden af uden at nogen saa det.
      //
      //  Motivet findes paa sine EGNE maal i browseren, ikke paa filnavnet
      //  — samme regel som resten af filen. Er der ingen staaende motiver,
      //  siges det; en oversprunget maaling maa ikke taelle groent.
      const staaende = await p.evaluate(async (antal) => {
        // IKKE `a?.click() ?? b?.click()`: `click()` giver `undefined`,
        // saa `??` falder igennem OGSAA naar det foerste klik er fyret,
        // og begge ville ramme. Her skal kun ét af dem.
        const aabner = document.querySelector('.galleri .flere')
          ?? document.querySelector('.galleri > button')
        aabner?.click()
        await new Promise((r) => setTimeout(r, 400))
        const minier = [...document.querySelectorAll('.lysbord .minier button')]
        for (let i = 0; i < minier.length && i < antal; i++) {
          minier[i].click()
          await new Promise((r) => setTimeout(r, 350))
          const img = document.querySelector('.lys-billede')
          for (let k = 0; k < 100 && !(img?.complete && img.naturalWidth > 0); k++) {
            await new Promise((r) => setTimeout(r, 100))
          }
          if (img && img.naturalHeight > img.naturalWidth) {
            const r = img.getBoundingClientRect()
            return {
              fandt: true, indeks: i,
              nat: [img.naturalWidth, img.naturalHeight],
              vist: [Math.round(r.width), Math.round(r.height)],
              fit: getComputedStyle(img).objectFit,
              taeller: document.querySelector('.lysbord .taeller')?.textContent?.trim() ?? null,
              indenfor: r.top >= -1 && r.bottom <= innerHeight + 1,
            }
          }
        }
        return { fandt: false }
      }, MOTIVER.length)
      if (staaende.fandt) {
        const f1 = staaende.nat[0] / staaende.nat[1]
        const f2 = staaende.vist[0] / staaende.vist[1]
        tjek(`${merke} · staaende motiv: hele billedet vises (contain)`,
          staaende.fit === 'contain', staaende.fit)
        tjek(`${merke} · staaende motiv: ikke forvrænget`,
          Math.abs(f1 - f2) / f1 < 0.02,
          `motiv ${f1.toFixed(2)} · vist ${f2.toFixed(2)} (${staaende.nat.join('×')})`)
        tjek(`${merke} · staaende motiv: hele højden er inden for skærmen`,
          staaende.indenfor, `vist ${staaende.vist.join('×')} i ${bredde} px`)
        await saetMaerkat()
        await p.screenshot({ path: `${UD}/lysbord-staaende-${merke}.png` })
        await p.keyboard.press('Escape')
        await p.waitForTimeout(250)
      } else {
        tjek(`${merke} · der ER et staaende motiv at prøve lysbordet med`, false,
          'ingen af motiverne er højere end brede — prøven blev IKKE kørt')
      }
    } else {
      tjek(`${merke} · lysbordet åbner`, false, 'ingen .lys-billede')
    }

    // ── «Se alle N billeder» mod et MOERKT motiv ────────────────
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
