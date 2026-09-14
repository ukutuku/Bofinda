// ═══════════════════════════════════════════════════════════════
//  Kontrol af filtervinduet og den kompakte søgelinje.
//
//  Måler ADFÆRDEN, ikke reglerne. En dialog kan have den rigtige CSS og
//  stadig lade fokus slippe ud; en GET-formular kan se rigtig ud og
//  alligevel tabe et filter, når den indsendes.
//
//    · ingen dobbelte feltnavne i formularen
//    · vinduet åbner, lukker på Escape og på lukknappen
//    · fokus vender tilbage til knappen, der åbnede det
//    · fokus kan ikke forlade vinduet, mens det er åbent
//    · en ændring er KLADDE: lukning uden «Vis resultater» lader
//      søgningen stå, og kladden er væk næste gang vinduet åbnes
//    · «Vis resultater» skriver filtrene i URL'en
//    · URL, genindlæsning, tilbageknap, sortering, sidetal og
//      gruppelink bevarer filtrene
//    · uden JavaScript åbner `?flere=1` stadig vinduet
//
//  Kører KUN mod det isolerede testmiljø på loopback.
//  Brug:  node scripts/cloud/filterkontrol.mjs [mappe-til-skærmbilleder]
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.env.BOFINDA_APP ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(APP)) {
  console.error(`FEJL: BOFINDA_APP skal være loopback, ikke ${APP}`); process.exit(1)
}
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })

let fejl = 0, kørte = 0
const prøve = (ok, tekst, detalje = '') => {
  kørte++; if (!ok) fejl++
  console.log(`${ok ? '  ✓' : '  ✗'} ${tekst}${detalje ? ` — ${detalje}` : ''}`)
}
async function blok(navn, forventet, fn) {
  const før = kørte
  await fn()
  if (kørte - før !== forventet) {
    kørte++; fejl++
    console.log(`  ✗ ${navn}: ${kørte - før} målinger kørte, ${forventet} forventet`
      + ' — noget blev sprunget over i tavshed')
  }
}

const SØGNING = '/?sted=Pr%C3%B8veby%20N'
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

/** Ny fane med samtykket afklaret, så banneret ikke ligger over noget. */
async function fane(bredde, js = true) {
  const c = await br.newContext({ viewport: { width: bredde, height: 900 }, javaScriptEnabled: js })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  if (js) {
    const k = p.getByRole('button', { name: 'Kun det nødvendige' })
    if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  }
  return { c, p }
}

for (const bredde of [390, 768, 1100, 1440]) {
  console.log(`\n═══ ${bredde} px ═══`)
  const { c, p } = await fane(bredde)
  await p.goto(APP + SØGNING, { waitUntil: 'networkidle' })

  await blok(`${bredde} px · formularen`, 2, async () => {
    const d = await p.evaluate(() => {
      const form = document.querySelector('form.filtre')
      const tael = {}
      for (const e of form.querySelectorAll('input[name],select[name],textarea[name]')) {
        if (e.type === 'checkbox' || e.type === 'radio') continue
        tael[e.name] = (tael[e.name] ?? 0) + 1
      }
      return {
        dubletter: Object.entries(tael).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`),
        felter: Object.keys(tael).length,
      }
    })
    prøve(d.dubletter.length === 0, 'ingen dobbelte feltnavne', d.dubletter.join(', ') || `${d.felter} navngivne felter`)
    prøve(d.felter >= 6, 'formularen bærer stadig filtrene', `${d.felter} navngivne felter`)
  })

  await blok(`${bredde} px · vinduet`, 6, async () => {
    const knap = p.locator('.filterknap')
    await knap.click()
    await p.waitForTimeout(250)
    const aaben = await p.evaluate(() => {
      const d = document.querySelector('.filterdialog')
      return { open: d.open, modal: d.matches(':modal'), fokusInde: d.contains(document.activeElement) }
    })
    prøve(aaben.open, 'knappen åbner vinduet')
    prøve(aaben.modal, 'det er modalt — Escape og fokusfælde er browserens')
    prøve(aaben.fokusInde, 'fokus står inde i vinduet ved åbning')
    if (UD) await p.screenshot({ path: `${UD}/dialog-${bredde}.png` })

    // Fokusfælden: Tab rundt og se, at intet uden for vinduet får fokus.
    // Et ELEMENT uden for vinduet må ikke få fokus. `<body>` tæller ikke:
    // Chromium lader fokus gå ud af dokumentet og tilbage igen ved
    // ombrydningen i en modal, og `document.activeElement` er `<body>` i
    // det sekund. Målt: præcis ét af 25 tab-tryk, altid `BODY`, uden
    // klasse og uden id. Det er browserens egen vej rundt, ikke en
    // lækage — og en prøve, der kalder det en fejl, lærer den næste at
    // se bort fra en rød linje.
    const slap = []
    for (let i = 0; i < 25; i++) {
      await p.keyboard.press('Tab')
      const ude = await p.evaluate(() => {
        const d = document.querySelector('.filterdialog')
        const a = document.activeElement
        if (!a || d.contains(a)) return null
        if (a === document.body || a === document.documentElement) return null
        return `${a.tagName}.${a.className || '(ingen klasse)'}`
      })
      if (ude) slap.push(ude)
    }
    prøve(slap.length === 0, 'fokus kan ikke forlade vinduet', slap.slice(0, 3).join(', ') || '0 af 25 tab-tryk')

    await p.keyboard.press('Escape')
    await p.waitForTimeout(250)
    const lukket = await p.evaluate(() => ({
      open: document.querySelector('.filterdialog').open,
      paaKnappen: document.activeElement?.classList.contains('filterknap'),
    }))
    prøve(!lukket.open, 'Escape lukker vinduet')
    prøve(lukket.paaKnappen, 'fokus vender tilbage til knappen', String(lukket.paaKnappen))
  })

  await blok(`${bredde} px · kladden`, 5, async () => {
    const url0 = p.url()
    await p.locator('.filterknap').click()
    await p.waitForTimeout(200)
    await p.locator('#prisMin').fill('9999')
    // Luk UDEN at anvende.
    await p.locator('.fd-luk').click()
    await p.waitForTimeout(250)
    prøve(p.url() === url0, 'lukning uden «Vis resultater» lader søgningen stå', p.url().slice(-40))
    const stadig = await p.evaluate(() => document.querySelectorAll('.liste a.kort').length)
    prøve(stadig > 0, 'resultaterne er uændrede', `${stadig} kort`)

    await p.locator('.filterknap').click()
    await p.waitForTimeout(200)
    const kladde = await p.locator('#prisMin').inputValue()
    prøve(kladde === '', 'den forladte kladde er væk ved næste åbning', `«${kladde}»`)

    // Anvend for alvor.
    await p.locator('#prisMin').fill('9000')
    await p.locator('.fd-vis').click()
    await p.waitForURL(/prisMin=9000/, { timeout: 8000 }).catch(() => {})
    prøve(/prisMin=9000/.test(p.url()) && !/flere=/.test(p.url()),
      '«Vis resultater» skriver filteret i URL\'en og lukker vinduet', p.url().slice(-52))
    // Tomme felter må ikke ende i adressen. En GET-formular sender dem
    // alle, og uden oprydningen bliver der otte adresser for det samme
    // indhold — på en side uden canonical og uden noindex.
    const tomme = [...new URL(p.url()).searchParams.entries()].filter(([, v]) => v === '')
    prøve(tomme.length === 0, 'ingen tomme parametre i adressen',
      tomme.map(([k]) => k).join(', ') || new URL(p.url()).search)
  })

  await blok(`${bredde} px · URL og navigation`, 4, async () => {
    const medFilter = p.url()
    await p.reload({ waitUntil: 'networkidle' })
    const efterReload = await p.evaluate(() =>
      [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim()).join(' | '))
    prøve(efterReload.includes('9.000'), 'genindlæsning bevarer filteret', efterReload.slice(0, 60))

    // Sortering: et link, som skal bære filtrene med.
    const sorteret = await p.locator('.sort-pille').nth(1).getAttribute('href')
    prøve((sorteret ?? '').includes('prisMin=9000'), 'sortering bevarer filtrene', sorteret ?? 'intet link')

    // Gruppelink: skal bære filtrene med, jf. gruppeUrl().
    const gruppe = await p.evaluate(() =>
      document.querySelector('a.kort[data-gruppe]')?.getAttribute('href') ?? null)
    prøve(gruppe == null || gruppe.includes('prisMin=9000'),
      'gruppelinket bærer filtrene', gruppe ?? 'ingen gruppe i udsnittet')

    await p.goBack({ waitUntil: 'networkidle' })
    await p.goForward({ waitUntil: 'networkidle' })
    prøve(p.url() === medFilter, 'tilbage og frem lander på den samme søgning', p.url().slice(-40))
  })

  await c.close()
}

// ── Uden JavaScript ─────────────────────────────────────────────
// `?flere=1` er den eneste vej ind, når der ikke er noget at opgradere
// med. Den skal stadig virke — ellers er filtrene utilgængelige for den,
// der har slået JavaScript fra eller sidder bag en fejlet indlæsning.
{
  console.log('\n═══ uden JavaScript ═══')
  const { c, p } = await fane(1100, false)
  // Søgningen SKAL bære filtre her. Med et bart «?sted=…» ville
  // «Ryd filtre» pege på præcis den adresse, den kom fra, og prøven
  // ville bestå, uanset om den ryddede noget — en kontrol, der ikke kan
  // fejle. Filtrene nedenfor er dem, den skal af med.
  const MED_FILTRE = SØGNING + '&prisMin=9000&vaerelser=2&areal=40&sorter=pris_op'
  // `sted` er området, som knappen lover at beholde; `sorter` er en
  // orden, ikke et filter, og holdes uden for, så den dag nogen vil lade
  // ordenen overleve en nulstilling, fejler prøven ikke for en rigtig
  // ændring. Alt andet ER et filter og skal væk.
  const BEVARES = ['sted', 'sorter']
  const restFiltre = (href) =>
    [...new URL(href, APP).searchParams.keys()].filter((k) => !BEVARES.includes(k))
  await blok('uden JS', 6, async () => {
    await p.goto(APP + MED_FILTRE + '&flere=1', { waitUntil: 'domcontentloaded' })
    const d = await p.evaluate(() => {
      const dl = document.querySelector('.filterdialog')
      return {
        findes: !!dl, open: dl?.open ?? false,
        synlig: dl ? getComputedStyle(dl).display !== 'none' : false,
        luk: document.querySelector('.fd-luk')?.getAttribute('href') ?? null,
        ryd: document.querySelector('.fd-ryd')?.getAttribute('href') ?? null,
      }
    })
    prøve(d.findes && d.open, '`?flere=1` åbner vinduet uden JavaScript')
    prøve(d.synlig, 'vinduets indhold er synligt')
    // Billedet tages HER, mens vinduet staar aabent — ikke nederst i
    // blokken. Dér laa det foer, altsaa EFTER at nulstillingsproeven
    // havde navigeret videre, og filen «uden-js.png» viste derfor en
    // almindelig resultatliste. Paastanden var groen og billedet viste
    // noget andet; det er praecis den slags, en gennemgang skal kunne
    // stole paa.
    if (UD) await p.screenshot({ path: `${UD}/uden-js.png`, fullPage: false })
    prøve((d.luk ?? '').includes('prisMin=9000') && !(d.luk ?? '').includes('flere='),
      'lukknappen fører tilbage til den samme søgning med filtrene i behold',
      d.luk ?? 'intet')
    prøve((d.ryd ?? '').includes('sted='), '«Ryd filtre» beholder området', d.ryd ?? 'intet')

    // Selve nulstillingen. `restFiltre` er detektoren, og den er delt
    // med den negative kontrol nedenfor — ellers ville prøven her måle
    // sig selv.
    const tilbage = d.ryd == null ? ['intet link'] : restFiltre(d.ryd)
    prøve(tilbage.length === 0, '«Ryd filtre» fjerner hvert eneste filter',
      tilbage.join(', ') || `kun ${[...new URL(d.ryd, APP).searchParams.keys()].join(', ')} tilbage`)

    // Og den skal virke uden JavaScript: linket følges, og søgningen
    // står tilbage uden filtre, men med området og med resultater.
    await p.goto(new URL(d.ryd, APP).href, { waitUntil: 'domcontentloaded' })
    const efter = restFiltre(p.url())
    const m = await p.evaluate(() => ({
      kort: document.querySelectorAll('.liste a.kort').length,
      chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim()),
    }))
    prøve(efter.length === 0 && m.kort > 0 && m.chips.length === 0,
      'efter «Ryd filtre» står søgningen uden filtre og med resultater',
      `${efter.join(', ') || 'ingen filterparametre'} · ${m.kort} kort · ${m.chips.length} chips`)
  })

  // ── KAN NULSTILLINGSPRØVEN OVERHOVEDET FEJLE? ─────────────────
  //  Den forrige udgave kørte på «?sted=Prøveby N» uden filtre. Dér
  //  peger «Ryd filtre» på præcis den adresse, den kom fra, så prøven
  //  bestod, uanset om knappen ryddede noget. Den kunne ikke fejle.
  //
  //  Her fodres den SAMME detektor med et link, der ikke har ryddet
  //  noget — søgningens egen adresse. Opdager den ikke det, måler den
  //  intet, og så skal den røde linje stå her og ikke i produktionen.
  await blok('negativ nulstillingskontrol', 2, async () => {
    const ikkeRyddet = APP + MED_FILTRE
    const fundet = restFiltre(ikkeRyddet)
    prøve(fundet.length > 0,
      'detektoren fanger et «Ryd filtre», der ikke har ryddet noget',
      fundet.join(', ') || 'INTET FUNDET — prøven kan ikke fejle')
    // Og den må ikke råbe op om selve området og ordenen: de to SKAL
    // overleve, og en detektor der kalder dem filtre, er lige så ubrugelig.
    prøve(restFiltre(`${APP}/?sted=Pr%C3%B8veby%20N&sorter=pris_op`).length === 0,
      'området og ordenen tæller ikke med som filtre',
      restFiltre(`${APP}/?sted=Pr%C3%B8veby%20N&sorter=pris_op`).join(', ') || 'ingen')
  })

  await c.close()
}

// ── Boligtypernes tal ───────────────────────────────────────────
//  Tallene paa typeknapperne kom fra `facetter()`, som taeller HELE
//  bestanden og er cachet i fem minutter. Paa en soegning med 76 boliger
//  stod der 75 · 58 · 54 · 53 · 34 · 6 = 280 ved siden af et resultattal
//  paa 76 og facilitetslinjer, der summerede til 76. Knapperne lignede
//  facetter og var det ikke.
//
//  Invarianten er IKKE «summen er hoejst resultatantallet». Den ville
//  vaere forkert i det ene tilfaelde, der betyder noget: med et typefilter
//  sat taelles de andre typer paa soegningen UDEN det filter — ellers
//  stod hver anden type paa 0, og knapperne kunne kun fravaelges, aldrig
//  bruges til at skifte type.
//
//  Invarianten er: summen er lig resultatantallet for den SAMME soegning
//  uden `type`, minus de boliger hvis type kilden ikke oplyser. Den
//  maales ved at hente begge sider.
{
  console.log('\n═══ Boligtypernes tal ═══')
  const c = await br.newContext({ viewport: { width: 1440, height: 1000 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const kn = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await kn.count()) { await kn.first().click(); await p.waitForTimeout(700) }

  // To geografier og tre kombinationer af filtre.
  const SAGER = [
    ['Prøveby N', '/?sted=Pr%C3%B8veby%20N'],
    ['Attrapby', '/?sted=Attrapby'],
    ['Prøveby N + pris', '/?sted=Pr%C3%B8veby%20N&prisMin=9000'],
    ['Attrapby + vær. + areal', '/?sted=Attrapby&vaerelser=2&areal=40'],
    ['Prøveby N + type=hus', '/?sted=Pr%C3%B8veby%20N&type=hus'],
  ]
  for (const [navn, sti] of SAGER) {
    await blok(`typetal · ${navn}`, 2, async () => {
      await p.goto(APP + sti + '&flere=1', { waitUntil: 'networkidle' })
      const typer = await p.evaluate(() =>
        [...document.querySelectorAll('.fd-afsnit .valgknapper input[name="type"]')]
          .map((i) => ({
            type: i.value,
            antal: Number(i.closest('label')?.querySelector('b')?.textContent?.replace(/\./g, '') ?? -1),
          })))
      // Grundlaget: den samme soegning UDEN typefilteret.
      const uden = new URL(APP + sti)
      uden.searchParams.delete('type')
      await p.goto(uden.href, { waitUntil: 'networkidle' })
      const m = await p.evaluate(() => ({
        antal: Number(document.querySelector('.titeltal')?.textContent?.replace(/[^\d]/g, '') ?? -1),
        udenType: [...document.querySelectorAll('.liste a.kort')].length,
      }))
      const sum = typer.reduce((a, t) => a + t.antal, 0)
      prøve(typer.length > 0 && typer.every((t) => t.antal >= 0),
        'hver type har et tal', typer.map((t) => `${t.type} ${t.antal}`).join(' · '))
      // «<=» og ikke «===»: boliger uden oplyst type taelles ikke i nogen
      // af grupperne. Forskellen er dem, og den maa ikke vaere negativ.
      prøve(sum <= m.antal && sum > 0,
        'typerne summerer til søgningen uden typefilter, aldrig over',
        `sum ${sum} mod ${m.antal} boliger (uden type-filter)`)
    })
  }
  await c.close()
}

// ── Sorteringsmenuen ────────────────────────────────────────────
//  Sorteringen var seks piller på en linje; den er nu én menu. Formen
//  er skiftet, så adfærden skal måles på ny: et `<details>` åbner uden
//  JavaScript, og valgene er almindelige links — men det er præcis den
//  slags, der kan se rigtigt ud og alligevel tabe filtrene eller lande
//  på et sidetal fra det gamle sæt.
{
  console.log('\n═══ Sorteringsmenuen ═══')
  const c = await br.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  await blok('sorteringsmenu', 8, async () => {
    // Et filter OG et sidetal, så begge dele kan efterprøves. Uden et
    // filter, der lader mere end én side tilbage, er side 2 tom — og så
    // findes menuen slet ikke, fordi den kun vises med resultater.
    // `?areal=1` og ikke en bysøgning: gruppering skærer 76 boliger i
    // Prøveby N ned til under 48 KORT, så den søgning har kun én side, og
    // side 2 er tom — og menuen vises kun med resultater. `areal=1`
    // rammer hele bestanden og har flere sider.
    await p.goto(APP + '/?areal=1&side=2', { waitUntil: 'networkidle' })
    const lukket = await p.evaluate(() => {
      const d = document.querySelector('details.sortering')
      return { findes: !!d, open: d?.open ?? null, etiket: d?.querySelector('summary')?.textContent?.trim() ?? null }
    })
    prøve(lukket.findes && lukket.open === false,
      'menuen er lukket som udgangspunkt', `open=${lukket.open}`)
    prøve((lukket.etiket ?? '').startsWith('Sortér:'),
      'knappen siger, hvad der er valgt', lukket.etiket ?? 'ingen')

    // Berøringsmålet på selve knappen.
    const maal = await p.evaluate(() => {
      const r = document.querySelector('details.sortering summary').getBoundingClientRect()
      return { h: Math.round(r.height), b: Math.round(r.width) }
    })
    prøve(maal.h >= 44, 'knappen er mindst 44 px høj', `${maal.b}×${maal.h}`)

    await p.locator('details.sortering summary').click()
    await p.waitForTimeout(200)
    const aaben = await p.evaluate(() => {
      const d = document.querySelector('details.sortering')
      const valg = [...d.querySelectorAll('.sort-pille')]
      const r = (e) => e.getBoundingClientRect()
      return {
        open: d.open,
        antal: valg.length,
        lave: valg.filter((e) => r(e).height < 44).length,
        udenforSkaerm: valg.filter((e) => r(e).right > innerWidth + 1 || r(e).left < -1).length,
        valgt: valg.filter((e) => e.getAttribute('aria-current') === 'true').map((e) => e.textContent.trim()),
        href: valg.find((e) => e.getAttribute('aria-current') !== 'true')?.getAttribute('href') ?? null,
      }
    })
    prøve(aaben.open && aaben.antal >= 5, 'menuen åbner med alle ordener', `${aaben.antal} valg`)
    prøve(aaben.lave === 0 && aaben.udenforSkaerm === 0,
      'valgene er mindst 44 px høje og inden for skærmen',
      `${aaben.lave} for lave, ${aaben.udenforSkaerm} uden for`)
    prøve(aaben.valgt.length === 1, 'præcis ét valg er markeret', aaben.valgt.join(', '))
    // Linket skal bære filteret og LADE SIDETALLET FALDE: en anden orden
    // lægger andre boliger på side 2, og et sidetal fra det gamle sæt
    // peger ingen steder i det nye.
    prøve((aaben.href ?? '').includes('areal=1') && !/[?&]side=/.test(aaben.href ?? ''),
      'valget bærer filteret og nulstiller sidetallet', aaben.href ?? 'intet link')

    await p.locator('details.sortering .sort-pille:not([aria-current])').first().click()
    await p.waitForLoadState('networkidle')
    const efter = await p.evaluate(() => ({
      url: location.search,
      etiket: document.querySelector('details.sortering summary')?.textContent?.trim() ?? null,
      chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim()).join(' | '),
    }))
    prøve(efter.url.includes('areal=1') && efter.url.includes('sorter=')
      && !/[?&]side=/.test(efter.url),
      'efter valget: filteret står, sidetallet er væk, ordenen er i adressen',
      `${efter.url} · ${efter.etiket}`)
    if (UD) await p.screenshot({ path: `${UD}/sortering-1440.png` })
  })

  // ── Ordenen overlever «Vis resultater» ────────────────────────
  //  Sorteringen bor nu ÉT sted: menuen over listen. Vinduet har intet
  //  sorteringsfelt mere — og et vindue uden felt er en GET-formular,
  //  der ikke sender parameteren. Uden det skjulte felt ville hvert
  //  eneste filtertryk stille søgningen tilbage til «nyeste», uden at
  //  nogen rørte sorteringen. Det er den fejl, denne blok måler.
  await blok('ordenen overlever et filtertryk', 4, async () => {
    await p.goto(APP + '/?areal=1&sorter=pris_op', { waitUntil: 'networkidle' })
    const før = await p.evaluate(() =>
      document.querySelector('details.sortering summary')?.textContent?.trim() ?? null)
    prøve((før ?? '').includes('Billigst'), 'søgningen står på den valgte orden', før ?? 'ingen')

    // Vinduet må ikke have sit eget sorteringsfelt: to menuer for den
    // samme indstilling er to steder at lede og to steder at rette.
    await p.locator('.filterknap').click()
    await p.waitForTimeout(250)
    const ifeltet = await p.evaluate(() => {
      const d = document.querySelector('.filterdialog')
      return {
        synlige: [...d.querySelectorAll('select[name="sorter"], input[name="sorter"]:not([type="hidden"])')].length,
        skjult: d.querySelector('input[type="hidden"][name="sorter"]')?.value ?? null,
      }
    })
    prøve(ifeltet.synlige === 0, 'vinduet har ingen anden sorteringsmenu',
      `${ifeltet.synlige} synlige sorteringsfelter`)
    prøve(ifeltet.skjult === 'pris_op', 'ordenen bæres med som et skjult felt',
      String(ifeltet.skjult))

    // Og så det, der faktisk betyder noget: ret et filter, tryk «Vis
    // resultater», og se at ordenen stadig står.
    await p.locator('#prisMin').fill('7000')
    await p.locator('.fd-vis').click()
    await p.waitForURL(/prisMin=7000/, { timeout: 8000 }).catch(() => {})
    const efterVis = await p.evaluate(() => ({
      url: location.search,
      etiket: document.querySelector('details.sortering summary')?.textContent?.trim() ?? null,
    }))
    prøve(/sorter=pris_op/.test(efterVis.url) && (efterVis.etiket ?? '').includes('Billigst'),
      '«Vis resultater» taber ikke den valgte orden',
      `${efterVis.url} · ${efterVis.etiket}`)
  })
  await c.close()
}

// ── KAN FOKUSPRØVEN OVERHOVEDET FEJLE? ──────────────────────────
//  En prøve, der altid består, ser ud som en kontrol og er det ikke.
//  Fokusfælden er browserens, ikke vores — så påstanden «fokus kan ikke
//  forlade vinduet» ville stå grøn, selv om vores egen detektor var i
//  stykker, og ingen ville opdage det.
//
//  Her tvinges den situation frem: vinduet åbnes med `show()` i stedet
//  for `showModal()`. Det er den ENESTE forskel — samme markup, samme
//  CSS, samme indhold — og et ikke-modalt <dialog> har ingen fælde.
//  Tabulator skal derfor nå kontrollerne BAG vinduet, og detektoren skal
//  se dem.
//
//  Består den her, er den grønne linje ovenfor et udsagn om vinduet og
//  ikke om prøven.
{
  console.log('\n═══ Negativ kontrol: fokusprøven skal kunne fejle ═══')
  const c = await br.newContext({ viewport: { width: 1100, height: 900 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  await blok('negativ fokuskontrol', 3, async () => {
    await p.goto(APP + SØGNING, { waitUntil: 'networkidle' })
    // Ikke-modal: <dialog open> uden top-lag, uden backdrop, uden fælde.
    const ikkeModal = await p.evaluate(() => {
      const d = document.querySelector('.filterdialog')
      d.close(); d.show()
      return { open: d.open, modal: d.matches(':modal') }
    })
    prøve(ikkeModal.open && !ikkeModal.modal,
      'vinduet er åbnet UDEN fælde', `open=${ikkeModal.open} modal=${ikkeModal.modal}`)

    // Samme måling, ord for ord, som den positive påstand ovenfor.
    await p.evaluate(() => document.querySelector('.filterdialog input, .filterdialog a')?.focus())
    const slap = []
    for (let i = 0; i < 25; i++) {
      await p.keyboard.press('Tab')
      const ude = await p.evaluate(() => {
        const d = document.querySelector('.filterdialog')
        const a = document.activeElement
        if (!a || d.contains(a)) return null
        if (a === document.body || a === document.documentElement) return null
        return `${a.tagName}.${a.className || '(ingen klasse)'}`
      })
      if (ude) slap.push(ude)
    }
    // OMVENDT påstand: her SKAL der slippe noget ud.
    prøve(slap.length > 0,
      'uden fælde slipper fokus ud — detektoren ser det',
      slap.length ? `${slap.length} af 25, bl.a. ${[...new Set(slap)].slice(0, 3).join(', ')}` : 'INTET set — detektoren er i stykker')
    // Og det skal være rigtige kontroller bag vinduet, ikke tilfældig støj.
    const bag = [...new Set(slap)].filter((x) => /filterknap|soegeknap|kortvalg|^INPUT|^A\./)
    prøve(bag.length > 0, 'og det er kontroller bag vinduet', bag.slice(0, 3).join(', ') || 'ingen')
    if (UD) await p.screenshot({ path: `${UD}/negativ-fokus.png` })
  })
  await c.close()
}

// ── Med tastaturet oppe ─────────────────────────────────────────
//  Et blødt tastatur tager typisk 45-60 % af en telefons højde. Vinduet
//  er fuldskærm dér, så hoved og bund skal blive stående: ruller
//  «Vis resultater» ud af skærmen, når man står i et felt, er vinduet
//  en blindgyde.
//
//  Højden skrues ned i stedet for at åbne et rigtigt tastatur —
//  headless Chromium har ingen. Det måler det samme: om den faste bund
//  overlever, at der er mindre plads.
{
  console.log('\n═══ 390 px med tastatur oppe (340 px høj) ═══')
  const c = await br.newContext({ viewport: { width: 390, height: 340 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  await blok('tastatur', 4, async () => {
    await p.goto(APP + SØGNING, { waitUntil: 'networkidle' })
    await p.locator('.filterknap').click()
    await p.waitForTimeout(250)
    await p.locator('#prisMin').focus()
    await p.waitForTimeout(200)
    const m = await p.evaluate(() => {
      const b = (s) => { const e = document.querySelector(s); if (!e) return null
        const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bund: Math.round(r.bottom), h: Math.round(r.height) } }
      const vis = b('.fd-vis'), hoved = b('.fd-hoved'), krop = document.querySelector('.fd-krop')
      return { vis, hoved, ruller: krop ? krop.scrollHeight > krop.clientHeight : false, vh: innerHeight }
    })
    prøve(m.hoved != null && m.hoved.top >= 0 && m.hoved.top < 20,
      'overskriften står fast i toppen', `top ${m.hoved?.top}`)
    prøve(m.vis != null && m.vis.bund <= m.vh + 1 && m.vis.top >= 0,
      '«Vis resultater» er inden for skærmen', `${m.vis?.top}–${m.vis?.bund} af ${m.vh}`)
    prøve(m.vis != null && m.vis.h >= 44, 'knappen er stadig mindst 44 px høj', `${m.vis?.h} px`)
    prøve(m.ruller, 'indholdet ruller i midten', String(m.ruller))
    if (UD) await p.screenshot({ path: `${UD}/tastatur-390.png` })
  })
  await c.close()
}

// ── Nul resultater, lange tekster og de svære datatilfælde ──────
{
  console.log('\n═══ Datatilfælde ═══')
  const c = await br.newContext({ viewport: { width: 390, height: 900 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }

  await blok('nul resultater', 3, async () => {
    await p.goto(APP + '/?sted=Findesikkeby', { waitUntil: 'networkidle' })
    const m = await p.evaluate(() => ({
      tom: !!document.querySelector('.tom'),
      kort: document.querySelectorAll('.liste a.kort').length,
      filterknap: !!document.querySelector('.filterknap'),
      overløb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    prøve(m.tom && m.kort === 0, 'nul resultater giver en forklaring, ikke en tom side')
    prøve(m.filterknap, 'filtrene kan stadig nås', String(m.filterknap))
    prøve(m.overløb === 0, 'intet vandret overløb', `${m.overløb} px`)
  })

  for (const bredde of [390, 1440]) {
    await p.setViewportSize({ width: bredde, height: 900 })
    await blok(`datatilfælde ${bredde}`, 6, async () => {
      await p.goto(APP + '/?sted=Pr%C3%B8veby%20N&kort=0', { waitUntil: 'networkidle' })
      await p.mouse.move(bredde - 2, 2)
      await p.waitForTimeout(400)
      const m = await p.evaluate(() => {
        const kort = [...document.querySelectorAll('.liste a.kort')]
        const tekst = (e, s) => e.querySelector(s)?.textContent?.trim() ?? null
        const klippet = (e) => e.scrollWidth > e.clientWidth + 1
        const overskrifter = kort.map((e) => tekst(e, '.kort-overskrift'))
        const laengste = kort.map((e) => tekst(e, '.adresse') ?? '').sort((a, b) => b.length - a.length)[0]
        return {
          kort: kort.length,
          udenOverskrift: overskrifter.filter((t) => !t).length,
          // Ingen overskrift må være tom, og ingen tekst i kortet må klippes.
          klippede: kort.flatMap((e) => [...e.querySelectorAll('.kort-overskrift, .adresse, .sted, .kort-meta, .kort-pris, .kort-indflytning, .ukendt, .el')])
            .filter(klippet).map((e) => e.className).slice(0, 3),
          laengste,
          udenFoto: kort.filter((e) => e.classList.contains('uden-billede')).length,
          medFoto: kort.filter((e) => !e.classList.contains('uden-billede')).length,
          grupper: kort.filter((e) => e.dataset.gruppe).length,
          ukendtPris: kort.filter((e) => e.querySelector('.kort-pris.kun-leje')).length,
          ukendtUdenForbehold: kort.filter((e) =>
            e.querySelector('.kort-pris.kun-leje') && !e.querySelector('.ukendt')).length,
          overløb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      prøve(m.udenOverskrift === 0, 'hvert kort har en overskrift', `${m.udenOverskrift} uden`)
      prøve(m.klippede.length === 0, 'ingen klippet tekst i kortene', m.klippede.join(', '))
      // Den længste i det såede udsnit er 18 tegn. Det er ikke en prøve
      // af lang tekst, det er en prøve af, at der står noget. Den rigtige
      // sættes ind nedenfor og skrives tilbage igen.
      prøve(m.laengste != null && m.laengste.length > 0,
        'adressen står på hvert kort', `længste i udsnittet: «${m.laengste}» (${m.laengste?.length} tegn)`)
      prøve(m.medFoto > 0 && m.udenFoto > 0,
        'både kort med og uden foto er med', `${m.medFoto} med · ${m.udenFoto} uden`)
      prøve(m.grupper > 0, 'gruppekort er med i udsnittet', `${m.grupper} grupper`)
      // Den vigtigste: en ukendt total må ALDRIG stå uden forbeholdet.
      prøve(m.ukendtPris > 0 && m.ukendtUdenForbehold === 0,
        'ukendt aconto står altid med sit forbehold',
        `${m.ukendtPris} uden kendt total, ${m.ukendtUdenForbehold} uden forbehold`)
      if (UD) await p.screenshot({ path: `${UD}/datatilfaelde-${bredde}.png`, fullPage: false })
    })
  }
  await c.close()
}

// ── En rigtig lang adresse ──────────────────────────────────────
//  De såede adresser er højst 18 tegn. En vej kan hedde
//  «Stenlængegårdens Kvarter» — 24 tegn før husnummer, etage og dør —
//  og på et 346 px kort er det dér, en overskrift og en adresse enten
//  bryder pænt eller skubber siden ud i vandret rul.
//
//  Skrives tilbage igen. Kører kun mod testbasen; uden DATABASE_URL
//  springes den over med et ord, ikke i tavshed.
if (!process.env.DATABASE_URL) {
  console.log('\n· lang adresse: sprunget over (ingen DATABASE_URL)')
} else {
  const u = new URL(process.env.DATABASE_URL)
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55432'
      || !u.pathname.endsWith('bofinda_test')) {
    console.error(`FEJL: DATABASE_URL peger ikke på testbasen (${u.hostname}:${u.port}${u.pathname})`)
    process.exit(1)
  }
  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
  const c = await br.newContext({ viewport: { width: 390, height: 900 } })
  const p = await c.newPage()
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const kn = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await kn.count()) { await kn.first().click(); await p.waitForTimeout(700) }
  await p.goto(APP + '/?sted=Pr%C3%B8veby%20N&kort=0', { waitUntil: 'networkidle' })
  const id = await p.evaluate(() =>
    document.querySelector('.liste a.kort:not([data-gruppe])')?.dataset.bolig ?? null)
  if (!id) { console.error('FEJL: fandt intet enkeltkort at give en lang adresse'); process.exit(1) }
  const [før] = await sql`select street, house_number, floor, door from listings where id = ${id}`
  if (!før) { console.error('FEJL: boligen findes ikke i basen'); process.exit(1) }
  const VEJ = 'Stenlængegårdens Kvarter Nordre Sidevej'
  try {
    console.log(`\n═══ Lang adresse (${VEJ.length} tegn i vejnavnet) ═══`)
    await sql`update listings set street = ${VEJ}, house_number = '188', floor = '12', door = 'tv'
              where id = ${id}`
    for (const bredde of [390, 768, 1440]) {
      await p.setViewportSize({ width: bredde, height: 900 })
      await blok(`lang adresse ${bredde}`, 3, async () => {
        await p.goto(APP + '/?sted=Pr%C3%B8veby%20N&kort=0', { waitUntil: 'networkidle' })
        await p.mouse.move(bredde - 2, 2)
        await p.waitForTimeout(400)
        const m = await p.evaluate((id) => {
          const e = document.querySelector(`.liste a.kort[data-bolig="${id}"]`)
          if (!e) return null
          const k = e.clientWidth
          const forBrede = [...e.querySelectorAll('*')].filter((x) => x.offsetWidth > k + 1)
            .map((x) => `${x.className}:${x.offsetWidth}>${k}`)
          const adr = e.querySelector('.adresse')
          return {
            fundet: true, adresse: adr?.textContent?.trim() ?? null,
            klippet: adr ? adr.scrollWidth > adr.clientWidth + 1 : null,
            forBrede: forBrede.slice(0, 3),
            overløb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          }
        }, id)
        prøve(m?.fundet === true && (m.adresse ?? '').includes('Stenlængegårdens'),
          `${bredde} px · den lange adresse står på kortet`, m?.adresse ?? 'kortet blev ikke fundet')
        prøve(m?.klippet === false && m.forBrede.length === 0,
          `${bredde} px · den brydes i stedet for at klippes eller flyde ud`,
          m?.forBrede.join(', ') || 'intet for bredt')
        prøve(m?.overløb === 0, `${bredde} px · intet vandret overløb`, `${m?.overløb} px`)
        if (UD && bredde === 390) await p.screenshot({ path: `${UD}/lang-adresse-390.png` })
      })
    }
  } finally {
    await sql`update listings set street = ${før.street}, house_number = ${før.house_number},
              floor = ${før.floor}, door = ${før.door} where id = ${id}`
    const [{ n }] = await sql`select count(*)::int as n from listings where street = ${VEJ}`
    console.log(`  · testdata gendannet (${n} rækker har stadig den lange vej)`)
    await sql.end()
  }
  await c.close()
}

await br.close()
console.log(fejl === 0 ? `\n✓ alle ${kørte} kontroller bestået` : `\n✗ ${fejl} af ${kørte} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
