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
  await blok('uden JS', 4, async () => {
    await p.goto(APP + SØGNING + '&flere=1', { waitUntil: 'domcontentloaded' })
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
    prøve((d.luk ?? '').includes('sted=') && !(d.luk ?? '').includes('flere='),
      'lukknappen er et link tilbage til den samme søgning', d.luk ?? 'intet')
    prøve((d.ryd ?? '').includes('sted='), '«Ryd filtre» beholder området', d.ryd ?? 'intet')
  })
  if (UD) await p.screenshot({ path: `${UD}/uden-js.png`, fullPage: false })
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
