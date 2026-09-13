// ═══════════════════════════════════════════════════════════════
//  Kontrol af lanceringskandidaten — samme maal foer og efter.
//
//      node scripts/cloud/lancering.mjs <udmappe>
//
//  Den maaler tre ting, opgaven staar og falder med, og som et
//  skaermbillede ikke kan afgoere paa egen haand:
//
//  · HVOR LANGT NEDE det foerste boligkort ligger. «Boligerne skal komme
//    tidligere frem» er et tal, ikke en fornemmelse.
//  · Vandret overloeb og klippet noegletekst paa 390 og 1440 px.
//  · At tastaturfokus ikke forsvinder ind under den klaebende bjaelke.
//
//  Samtykket afvises med den RIGTIGE knap («Kun det noedvendige»), én
//  gang pr. browserkontekst. Banneret skjules aldrig med CSS: et
//  skaermbillede, hvor noget er skjult for at se paent ud, dokumenterer
//  ikke den side, brugeren faar.
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import postgres from 'postgres'

const UD = process.argv[2] || 'skaermbilleder/lancering'
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
  for (const b of bud) { try { if (statSync(b).isFile()) return b } catch { /* naeste */ } }
  console.error('FEJL: ingen Chromium fundet.'); process.exit(1)
}

// ── Vaernet: kun den isolerede testbase ────────────────────────
const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(url || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.'); process.exit(1)
  }
}
const sql = postgres(url, { max: 1 })

// Fire boliger, valgt paa hvad de kan STRESSE i layoutet.
const [rig] = await sql`
  select l.id from listings l left join listing_images i on i.listing_id = l.id
  where l.status = 'active' and l.total_monthly is not null
  group by l.id order by count(i.id) desc, length(l.address_raw) desc limit 1`
const [tynd] = await sql`
  select l.id from listings l
  where l.status = 'active' and l.total_monthly is null limit 1`
const [lang] = await sql`
  select l.id, l.address_raw from listings l
  where l.status = 'active' order by length(l.address_raw) desc limit 1`
const [udenFoto] = await sql`
  select l.id from listings l left join listing_images i on i.listing_id = l.id
  where l.status = 'active' group by l.id having count(i.id) = 0 limit 1`
await sql.end()
if (!rig || !tynd) { console.error('FEJL: fandt ikke egnede boliger.'); process.exit(1) }

mkdirSync(UD, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })

let fejl = 0
const tal = {}
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

// ── Kontrast, maalt og ikke skoennet ───────────────────────────
//  En baggrund med alfa ligger oven paa et BOLIGFOTO, som vi ikke
//  kender. Derfor regnes kontrasten mod begge yderpunkter — helt hvidt
//  og helt sort motiv — og det DAARLIGSTE af de to taeller. Holder den
//  dér, holder den for alt derimellem.
const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number)
const lum = ([r, g, b]) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const paa = ([r, g, b, a = 1], u) => [r * a + u * (1 - a), g * a + u * (1 - a), b * a + u * (1 - a)]
const forhold = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
/** Mindste kontrast mellem tekst og en gennemsigtig bund over ethvert motiv. */
const mindsteKontrast = (farve, bund) => {
  const t = rgb(farve)
  const b = rgb(bund)
  return Math.min(forhold(t, paa(b, 255)), forhold(t, paa(b, 0)))
}

/**
 * Samtykket afvises med den rigtige knap.
 *
 * Handlingen saetter cookien paa serveren og kalder DEREFTER
 * `location.reload()`. Der er altsaa to skift at vente paa, og et
 * `waitForLoadState` alene rammer det forkerte: foerste forsoeg saa
 * banneret staa endnu, og den efterfoelgende navigation blev afbrudt af
 * genindlaesningen (`ERR_ABORTED`). Vi venter derfor paa RESULTATET —
 * at banneret faktisk er vaek — og lader siden falde til ro bagefter.
 */
async function afvisSamtykke(p) {
  const knap = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await knap.count() === 0) return false
  await knap.first().click()
  for (let i = 0; i < 160; i++) {
    await p.waitForTimeout(250)
    try { if (await p.locator('.samtykke').count() === 0) break } catch { /* navigerer */ }
  }
  await p.waitForLoadState('networkidle').catch(() => {})
  return await p.locator('.samtykke').count() === 0
}

const MAAL = (bredde) => [
  ['forside', '/'],
  ['resultater', '/?sted=Attrapby'],
  // Med flere filtre sat: chipperne i resultathovedet og den aktive
  // sortering kan kun ses, naar der ER noget at vise.
  ['resultater-filtreret',
    '/?sted=Attrapby&prisMin=8000&prisMax=20000&vaerelser=2&areal=40&sorter=pris_op'],
  ['detalje-rig', `/bolig/${rig.id}`],
  ['detalje-tynd', `/bolig/${tynd.id}`],
].map(([n, s]) => [`${n}-${bredde === 390 ? 'mobil' : 'desktop'}`, s])

for (const bredde of [1440, 390]) {
  const ctx = await browser.newContext({
    viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
    deviceScaleFactor: 1,
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
  const afvist = await afvisSamtykke(p)
  tjek(`${bredde} px · samtykket afvist med den normale knap`, afvist,
    afvist ? '«Kun det nødvendige»' : 'banneret blev ikke fundet')
  tjek(`${bredde} px · banneret er VÆK bagefter (ikke skjult med CSS)`,
    await p.locator('.samtykke').count() === 0)

  for (const [navn, sti] of MAAL(bredde)) {
    await p.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 90_000 })
    await p.waitForTimeout(400)

    const m = await p.evaluate(() => {
      const doc = document.documentElement
      const kort = document.querySelector('a.kort[data-bolig]')
      const hero = document.querySelector('.hero')
      const top = document.querySelector('header.top')
      const sel = '.adresse, .kort-pris, h1, .oek-tal, .oek-tal2, .noegletal li,'
        + ' .fakta-chip, .resultat-tal, .punkter span, .manchet'
      return {
        overloeb: doc.scrollWidth - doc.clientWidth,
        billeder: [...document.images].filter((i) => i.naturalWidth > 0).length,
        billederIAlt: document.images.length,
        klippet: [...document.querySelectorAll(sel)]
          .filter((e) => e.scrollWidth > e.clientWidth + 2)
          .map((e) => `${e.className || e.tagName}:${e.scrollWidth}>${e.clientWidth}`),
        foersteKort: kort ? Math.round(kort.getBoundingClientRect().top + window.scrollY) : null,
        heroHoejde: hero ? Math.round(hero.getBoundingClientRect().height) : null,
        topHoejde: top ? Math.round(top.getBoundingClientRect().height) : null,
        antalKort: document.querySelectorAll('a.kort[data-bolig]').length,
      }
    })
    tal[navn] = m

    tjek(`${navn} · intet vandret overløb`, m.overloeb <= 0, `${m.overloeb} px`)
    tjek(`${navn} · ingen klippet nøgletekst`, m.klippet.length === 0,
      m.klippet.slice(0, 3).join(' · ') || '0')
    tjek(`${navn} · billeder dekodet`, m.billederIAlt === 0 || m.billeder > 0,
      `${m.billeder}/${m.billederIAlt}`)
    if (m.foersteKort != null) {
      console.log(`      første boligkort: ${m.foersteKort} px fra toppen`
        + (m.heroHoejde ? ` · hero ${m.heroHoejde} px` : '')
        + ` · ${m.antalKort} kort`)
    }

    // To billeder pr. visning, og de svarer paa hvert sit spoergsmaal.
    // Et fuldsides skaermbillede af en liste med 48 kort er 13.000 px
    // hoejt og kan ikke bruges til at vurdere noget — men det er det
    // eneste, der viser hele siden. Derfor begge: `-fold` er det, en
    // bruger ser uden at scrolle, `-hele` er resten.
    await p.screenshot({ path: `${UD}/${navn}-fold.png` })
    await p.screenshot({ path: `${UD}/${navn}-hele.png`, fullPage: true })
  }

  // ── Tastatur: fokus maa ikke gemme sig under den klaebende bjaelke ──
  await p.goto(`${BASE}/?sted=Attrapby`, { waitUntil: 'networkidle', timeout: 90_000 })
  const fokus = await p.evaluate(() => {
    const felt = document.querySelector('.storsoeg input')
    if (!felt) return { fandt: false }
    felt.focus()
    // Ringen ligger paa BAANDET, ikke paa feltet: `.storsoeg` bruger
    // `:focus-within`, og feltet selv har `outline: none`. Foerste udgave
    // maalte kun feltet og meldte roedt om en ring, der var der — den
    // maalte det forkerte element, ikke en mangel i produktet.
    const baand = felt.closest('.storsoeg') ?? felt
    const sf = getComputedStyle(felt)
    const sb = getComputedStyle(baand)
    const ring = (x) => x.outlineStyle !== 'none' || (x.boxShadow && x.boxShadow !== 'none')
    const r = felt.getBoundingClientRect()
    const top = document.querySelector('header.top')
    const th = top ? top.getBoundingClientRect().bottom : 0
    return {
      fandt: true,
      ring: ring(sf) || ring(sb),
      fri: r.top >= th - 1,
      erAktiv: document.activeElement === felt,
    }
  })
  tjek(`${bredde} px · søgefeltet kan fokuseres og har en synlig ring`,
    fokus.fandt && fokus.erAktiv && fokus.ring)
  tjek(`${bredde} px · det fokuserede søgefelt dækkes ikke af bjælken`,
    fokus.fandt && fokus.fri)

  // ══ De tre CSS-forhold fra gennemgangen af 8d7b51d ═══════════
  //
  //  Alle tre var det samme slags fejl: en regel, der var SKREVET, men
  //  aldrig fyrede, fordi en anden stod senere i filen. Det kan ikke
  //  ses i en diff og ikke paa et skaermbillede — kun ved at spoerge
  //  browseren, hvad der faktisk gaelder. Derfor computed styles.
  {
    // ── A · galleriets «+N billeder» ──────────────────────────
    await p.goto(`${BASE}/bolig/${rig.id}`, { waitUntil: 'networkidle', timeout: 90_000 })
    const flere = p.locator('.galleri .flere')
    if (await flere.count() > 0) {
      const stil = () => p.evaluate(() => {
        const e = document.querySelector('.galleri .flere')
        const s = getComputedStyle(e)
        return { farve: s.color, bund: s.backgroundColor, fokusring: s.outlineStyle !== 'none' }
      })

      const normal = await stil()
      tjek(`${bredde} px · billedknap, normal: tekst mod bund er læsbar`,
        mindsteKontrast(normal.farve, normal.bund) >= 4.5,
        `${mindsteKontrast(normal.farve, normal.bund).toFixed(1)}:1 · ${normal.bund}`)

      await flere.first().hover()
      await p.waitForTimeout(160)
      const hover = await stil()
      tjek(`${bredde} px · billedknap, hover: tekst mod bund er læsbar`,
        mindsteKontrast(hover.farve, hover.bund) >= 4.5,
        `${mindsteKontrast(hover.farve, hover.bund).toFixed(1)}:1 · ${hover.bund}`)
      // Selve fejlen, navngivet: den moerke bund under den moerke tekst.
      tjek(`${bredde} px · hover er IKKE den mørke rgba(20,22,26,.88)`,
        !/^rgba?\(2[01], ?2[12], ?2[56]/.test(hover.bund), hover.bund)

      // Fokus skal vaere KEYBOARD-fokus. En programmatisk .focus() paa en
      // <button> matcher ikke :focus-visible i Chromium, saa den ville
      // maale den forkerte tilstand og melde groent uden daekning.
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.keyboard.press('Tab')
      let fandtFokus = false
      for (let i = 0; i < 40; i++) {
        fandtFokus = await p.evaluate(() =>
          document.activeElement === document.querySelector('.galleri .flere'))
        if (fandtFokus) break
        await p.keyboard.press('Tab')
      }
      if (fandtFokus) {
        const fokus = await stil()
        tjek(`${bredde} px · billedknap, tastaturfokus: tekst mod bund er læsbar`,
          mindsteKontrast(fokus.farve, fokus.bund) >= 4.5,
          `${mindsteKontrast(fokus.farve, fokus.bund).toFixed(1)}:1 · ${fokus.bund}`)
        tjek(`${bredde} px · og fokus har en synlig ring`, fokus.fokusring)
      } else {
        tjek(`${bredde} px · billedknappen kan nås med Tab`, false, 'ikke fundet på 40 tab')
      }
    } else {
      tjek(`${bredde} px · en bolig med «+N billeder» i udsnittet`, false,
        'ingen .flere-knap — kontrollen kunne ikke køres')
    }

    // ── B · resultatoptællingen og C · søgefeltet ─────────────
    await p.goto(`${BASE}/?sted=Attrapby`, { waitUntil: 'networkidle', timeout: 90_000 })
    const m = await p.evaluate(() => {
      const sp = document.querySelector('.resultathoved .optaelling > span')
      const felt = document.querySelector('form.filtre.soegt .storsoeg input')
      const doc = document.documentElement
      const s = sp ? getComputedStyle(sp) : null
      const foer = sp ? getComputedStyle(sp, '::before') : null
      return {
        fandtSpan: Boolean(sp),
        bund: s?.backgroundColor, kant: s?.borderTopWidth,
        radius: s?.borderTopLeftRadius, polstring: s?.paddingTop + ' ' + s?.paddingLeft,
        ikon: foer?.display,
        antal: document.querySelectorAll('.resultathoved .optaelling > span').length,
        feltStoerrelse: felt ? getComputedStyle(felt).fontSize : null,
        overloeb: doc.scrollWidth - doc.clientWidth,
      }
    })

    if (bredde === 390) {
      tjek('390 px · optællingen står som tekst — ingen flade',
        m.bund === 'rgba(0, 0, 0, 0)', String(m.bund))
      tjek('390 px · ingen ramme og ingen pilleradius',
        m.kant === '0px' && m.radius === '0px', `kant ${m.kant} · radius ${m.radius}`)
      tjek('390 px · ingen polstring', m.polstring === '0px 0px', m.polstring)
      tjek('390 px · møntikonet er væk', m.ikon === 'none', String(m.ikon))
      tjek('390 px · søgefeltet er 16 px (ingen iOS-zoom ved fokus)',
        m.feltStoerrelse === '16px', String(m.feltStoerrelse))
    } else {
      tjek('1440 px · optællingen er stadig chips med flade',
        m.bund !== 'rgba(0, 0, 0, 0)', String(m.bund))
      tjek('1440 px · pilleradius og polstring er bevaret',
        m.radius !== '0px' && m.polstring !== '0px 0px',
        `radius ${m.radius} · polstring ${m.polstring}`)
      tjek('1440 px · møntikonet står stadig', m.ikon !== 'none', String(m.ikon))
      tjek('1440 px · søgefeltet beholder sine bevidste 15 px',
        m.feltStoerrelse === '15px', String(m.feltStoerrelse))
    }
    // Alle tre tal skal stadig staa der — det var aldrig meningen at
    // fjerne en oplysning, kun fladen omkring den.
    tjek(`${bredde} px · alle optællingens oplysninger står der endnu`,
      m.fandtSpan && m.antal >= 2, `${m.antal} led`)
    tjek(`${bredde} px · rettelserne giver intet vandret overløb`,
      m.overloeb <= 0, `${m.overloeb} px`)
  }

  // ── Gruppesiden ───────────────────────────────────────────────
  //  Adressen bygges ikke her: den hentes fra et gruppekort i listen,
  //  saa kontrollen bruger det samme link som en bruger ville klikke.
  {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 90_000 })
    const href = await p.evaluate(() => {
      const g = document.querySelector('a.kort[data-gruppe]')
      return g ? g.getAttribute('href') : null
    })
    if (href) {
      await p.goto(BASE + href, { waitUntil: 'networkidle', timeout: 90_000 })
      await p.waitForTimeout(300)
      const m = await p.evaluate(() => {
        const doc = document.documentElement
        const sel = '.adresse, .kort-pris, h1, .kort-indflytning, .fakta-chip'
        return {
          overloeb: doc.scrollWidth - doc.clientWidth,
          klippet: [...document.querySelectorAll(sel)]
            .filter((e) => e.scrollWidth > e.clientWidth + 2).length,
          kort: document.querySelectorAll('a.kort[data-bolig]').length,
        }
      })
      const navn = `gruppe-${bredde === 390 ? 'mobil' : 'desktop'}`
      tjek(`${navn} · intet vandret overløb`, m.overloeb <= 0, `${m.overloeb} px`)
      tjek(`${navn} · ingen klippet nøgletekst`, m.klippet === 0, `${m.klippet}`)
      tjek(`${navn} · siden viser boligerne`, m.kort > 0, `${m.kort} kort`)
      await p.screenshot({ path: `${UD}/${navn}-fold.png` })
      await p.screenshot({ path: `${UD}/${navn}-hele.png`, fullPage: true })
    } else {
      tjek(`${bredde} px · gruppekort fundet i listen`, false, 'ingen gruppe i udsnittet')
    }
  }

  // ── Det klaebende oekonomikort maa kunne naas helt ────────────
  //  `.oekonomi` er `position: sticky`. Bliver kortet hoejere end
  //  vinduet, pinnes toppen, og bunden — hvor knappen til kilden staar —
  //  kan aldrig naas: siden scroller, kortet goer ikke. Maalt i dag til
  //  369 px mod 760-1000 px vindue, altsaa rigelig plads. Kontrollen
  //  staar, fordi kortet vokser den dag der kommer en post mere i det,
  //  og fejlen ville ellers vaere usynlig.
  {
    await p.goto(`${BASE}/bolig/${rig.id}`, { waitUntil: 'networkidle', timeout: 90_000 })
    const m = await p.evaluate(async () => {
      const kort = document.querySelector('.oek-kort')
      const cta = document.querySelector('.oek-kort .knap, .oek-kort .kontaktboks')
      if (!cta) return { hoejde: null, vindue: window.innerHeight, cta: null }
      // Rul hen til handlingen, som en browser goer ved et ankerspring
      // eller et tastaturfokus. Det er DEN vej, den skal kunne naas —
      // ikke ved at rulle til bunden: paa mobil staar kortet oeverst, og
      // bunden af siden siger ingenting om det.
      cta.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 300))
      const r = cta.getBoundingClientRect()
      const top = document.querySelector('header.top')
      const th = top ? top.getBoundingClientRect().bottom : 0
      return {
        hoejde: kort ? Math.round(kort.getBoundingClientRect().height) : null,
        vindue: window.innerHeight,
        cta: {
          iBillede: r.top >= 0 && r.bottom <= window.innerHeight,
          friAfBjaelken: r.top >= th - 1,
          top: Math.round(r.top), bund: Math.round(r.bottom), bjaelke: Math.round(th),
        },
      }
    })
    tjek(`${bredde} px · økonomikortet er lavere end vinduet (klæber uden at låse)`,
      m.hoejde != null && m.hoejde < m.vindue, `${m.hoejde} px mod ${m.vindue} px`)
    tjek(`${bredde} px · handlingen videre til kilden kan nås`,
      m.cta == null || m.cta.iBillede,
      m.cta == null ? 'ingen CTA på denne bolig' : `${m.cta.top}–${m.cta.bund} px`)
    tjek(`${bredde} px · og den dækkes ikke af den klæbende bjælke`,
      m.cta == null || m.cta.friAfBjaelken,
      m.cta == null ? 'ingen CTA' : `top ${m.cta.top} mod bjælke ${m.cta.bjaelke}`)
  }

  // ── Stresstest: en lang adresse og et kort uden foto ──────────
  //  Testdataenes laengste adresse er 34 tegn, saa bestanden kan ikke
  //  selv stresse kortet. Teksten saettes derfor i BROWSEREN paa et
  //  rigtigt kort — ingen raekke roeres, intet opdigtes i basen — og
  //  layoutet maales med den. Det maaler brydning, ikke data.
  await p.goto(`${BASE}/?sted=Attrapby`, { waitUntil: 'networkidle', timeout: 90_000 })
  const stress = await p.evaluate(() => {
    const kort = document.querySelector('a.kort[data-bolig]')
    const adr = kort && kort.querySelector('.adresse')
    if (!adr) return { fandt: false }
    adr.textContent = 'Frederiksborgvej-Sønderjyllands Allé 248 B, 4. th, opgang 12'
    const doc = document.documentElement
    return {
      fandt: true,
      overloeb: doc.scrollWidth - doc.clientWidth,
      klippet: adr.scrollWidth > adr.clientWidth + 2,
      linjer: Math.round(adr.getBoundingClientRect().height),
    }
  })
  tjek(`${bredde} px · lang adresse giver intet vandret overløb`,
    stress.fandt && stress.overloeb <= 0, `${stress.overloeb} px · ${stress.linjer} px høj`)
  tjek(`${bredde} px · lang adresse klippes ikke`, stress.fandt && !stress.klippet)

  const udenBillede = await p.evaluate(() => {
    const k = [...document.querySelectorAll('a.kort[data-bolig]')]
      .find((x) => x.classList.contains('uden-billede'))
    if (!k) return { fandt: false }
    const kolonner = getComputedStyle(k).gridTemplateColumns.split(' ').length
    const adr = k.querySelector('.adresse')
    return {
      fandt: true, kolonner,
      klippet: adr ? adr.scrollWidth > adr.clientWidth + 2 : false,
      bredde: Math.round(k.getBoundingClientRect().width),
    }
  })
  tjek(`${bredde} px · kort uden foto har ÉN kolonne (ingen tom billedspalte)`,
    !udenBillede.fandt || udenBillede.kolonner === 1,
    udenBillede.fandt ? `${udenBillede.kolonner} kolonne(r)` : 'intet kort uden foto i udsnittet')

  // Tabulator gennem de fem foerste kontroller — ingen maa ende usynlig.
  const tabs = await p.evaluate(async () => {
    const ud = []
    // Start paa det foerste fokuserbare element. Foer begyndte loekken
    // paa `document.activeElement`, som efter en navigation er <body> —
    // saa brood den med det samme og maalte nul uden at fejle paa det.
    const foerste = [...document.querySelectorAll('a[href],button,input,select,summary')]
      .find((x) => x.offsetParent !== null)
    if (foerste) foerste.focus()
    for (let i = 0; i < 5; i++) {
      const e = document.activeElement
      if (!e || e === document.body) break
      const r = e.getBoundingClientRect()
      ud.push({ tag: e.tagName, h: Math.round(r.height), synlig: r.height > 0 && r.width > 0 })
      const f = [...document.querySelectorAll('a[href],button,input,select,summary')]
        .filter((x) => x.offsetParent !== null)
      const n = f[f.indexOf(e) + 1]
      if (!n) break
      n.focus()
    }
    return ud
  })
  tjek(`${bredde} px · de fem første fokuserbare elementer har en kasse`,
    tabs.length > 0 && tabs.every((t) => t.synlig), `${tabs.length} målt`)

  await ctx.close()
}

await browser.close()
console.log(`\n  ${fejl === 0 ? '✓' : '✗'} ${fejl === 0 ? 'alt grønt' : `${fejl} fejlede`} · billeder i ${UD}/`)
console.log(`  bolig rig=${rig.id.slice(0, 8)} tynd=${tynd.id.slice(0, 8)}`
  + (udenFoto ? ` udenFoto=${udenFoto.id.slice(0, 8)}` : ' udenFoto=(ingen)')
  + (lang ? ` længste adresse=${lang.address_raw.length} tegn` : ''))
process.exit(fejl === 0 ? 0 : 1)
