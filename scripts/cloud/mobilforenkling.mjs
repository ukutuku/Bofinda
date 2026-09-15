// ═══════════════════════════════════════════════════════════════
//  Regressionsprøve for mobilforenklingen.
//
//      node scripts/cloud/mobilforenkling.mjs [udmappe]
//
//  Fire ændringer, fire afsnit. Hver af dem er skrevet, så den kan
//  FEJLE mod koden fra før — det står ved hvert afsnit, hvad der gjorde
//  den rød.
//
//    A · Boliglisten er udgangspunktet på mobil
//    B · Valget overlever filtrering, sortering, paginering og tilbage
//    C · Berøringsmål og «Sådan beregner vi»
//    D · Ordvalget om månedsbeløbet
//
//  ── HVORFOR JAVASCRIPT SLÅS FRA I AFSNIT A OG C ──────────────
//  «Undgå, at siden først viser landkortet og derefter springer til
//  listen» er et krav om, hvad der sker FØR hydrering. Den stærkeste
//  prøve, der kan skrives på en side som denne, er at slå JavaScript
//  helt fra: står den rigtige visning der alligevel, er der ingen
//  klientkode at springe med. Det samme gælder udfoldningen — et
//  `<details>`, der kun virker med JavaScript, består ikke.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede · 2 = intet at måle på
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
if (!process.env.DATABASE_URL) {
  console.error('FEJL: DATABASE_URL mangler — prøven kan ikke vælge en bolig.'); process.exit(2)
}

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

// ── Boliger til afsnit C og D ────────────────────────────────
//  Én MED kendt total og areal (så kvadratmeterblokken kan optræde) og
//  én UDEN total. De vælges i basen, ikke skrevet ind: et id i en prøve
//  bliver forkert, næste gang datasættet bygges.
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
const [medTotal] = await sql`
  select id, postal_code from listings
  where status = 'active' and total_monthly is not null and size_m2 is not null
  order by postal_code limit 1`
const [udenTotal] = await sql`
  select id from listings
  where status = 'active' and total_monthly is null and rent_monthly is not null limit 1`
// En bolig i et postnummer med mindst fem sammenlignelige — ellers vises
// kvadratmeterblokken slet ikke, og afsnit C ville måle på en tom side.
const [tilKvm] = await sql`
  select l.id from listings l
  where l.status = 'active' and l.total_monthly is not null and l.size_m2 is not null
    and (select count(*) from listings x
         where x.status = 'active' and x.postal_code = l.postal_code
           and x.total_monthly is not null and x.size_m2 is not null) >= 5
  limit 1`
await sql.end()
if (!medTotal) {
  console.error('FEJL: ingen aktiv bolig med kendt total og areal.'); process.exit(2)
}
console.log(`med total: ${medTotal.id}\nuden total: ${udenTotal ? udenTotal.id : '(ingen)'}`)
console.log(`til kvadratmeterblok: ${tilKvm ? tilKvm.id : '(ingen — afsnit C springes over)'}\n`)

const SOEGNING = '/?sted=Attrapby'
const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

/** Hvad står der faktisk på skærmen? Synlighed, ikke tilstedeværelse. */
const visning = (p) => p.evaluate(() => {
  const synlig = (e) => {
    if (!e) return false
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const kortvalg = [...document.querySelectorAll('.kortvalg')]
  return {
    liste: synlig(document.querySelector('.liste')),
    kortboks: synlig(document.querySelector('.kortboks')),
    // Flere end ét synligt kortvalg ville betyde to knapper, der siger
    // hver sit om den samme visning.
    kortvalgSynlige: kortvalg.filter(synlig).map((a) => ({
      tekst: a.textContent.trim(), href: a.getAttribute('href'),
    })),
    kortvalgIAlt: kortvalg.length,
    overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

// ══════════════════════════════════════════════════════════════
//  A · Boliglisten er udgangspunktet på mobil
//
//  Mod koden fra før: `kortValgt = soegt && kort !== '0'` gjorde
//  fraværet af parameteren til et ja, og `@media (max-width: 900px)`
//  skjulte listen. Alle «liste er synlig»-linjerne herunder var røde
//  på 390 og 768 px, og etiketten sagde «Vis liste» over en liste, der
//  ikke stod der.
// ══════════════════════════════════════════════════════════════
console.log('═══ A · standardvisning, eksplicit kortlink og fravalg ═══')
for (const medJS of [true, false]) {
  console.log(`\n── JavaScript ${medJS ? 'til' : 'FRA'} ──`)
  for (const bredde of [1440, 768, 390]) {
    const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
    const smal = bredde <= 900          // samme grænse som @media i globals.css
    const c = await br.newContext({
      viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
      javaScriptEnabled: medJS,
    })
    const p = await c.newPage()
    if (medJS) {
      await p.goto(BASE + '/', { waitUntil: 'networkidle' })
      const k = p.getByRole('button', { name: 'Kun det nødvendige' })
      if (await k.count()) { await k.first().click(); await p.waitForTimeout(600) }
    }

    // 1 · Ingen parameter: mobil viser listen, desktop viser begge.
    await p.goto(BASE + SOEGNING, { waitUntil: medJS ? 'networkidle' : 'load' })
    await p.waitForTimeout(medJS ? 700 : 200)
    const u = await visning(p)
    tjek(u.liste, `${merke} · uden valg: boliglisten står der`)
    tjek(u.kortboks === !smal, `${merke} · uden valg: landkortet ${smal ? 'venter' : 'står ved siden af'}`,
      `kortboks=${u.kortboks}`)
    tjek(u.kortvalgSynlige.length === 1,
      `${merke} · uden valg: præcis ét synligt kortvalg`,
      `${u.kortvalgSynlige.length} af ${u.kortvalgIAlt}`)
    const etiket = u.kortvalgSynlige[0]?.tekst ?? ''
    tjek(etiket === (smal ? 'Vis kort' : 'Vis liste'),
      `${merke} · uden valg: knappen tilbyder det, man ikke ser`, `«${etiket}»`)
    // Knappen skal føre et sted hen, hvor noget ÆNDRER sig.
    tjek((u.kortvalgSynlige[0]?.href ?? '').includes(smal ? 'kort=1' : 'kort=0'),
      `${merke} · uden valg: knappens adresse er eksplicit`, u.kortvalgSynlige[0]?.href ?? '—')
    if (UD && medJS) await p.screenshot({ path: `${UD}/a-uden-valg-${merke}.png` })

    // 2 · Eksplicit kortlink: kortet skal åbne, også på mobil.
    await p.goto(`${BASE}${SOEGNING}&kort=1`, { waitUntil: medJS ? 'networkidle' : 'load' })
    await p.waitForTimeout(medJS ? 900 : 200)
    const j = await visning(p)
    tjek(j.kortboks, `${merke} · ?kort=1: landkortet åbner`)
    tjek(j.liste === !smal, `${merke} · ?kort=1: listen ${smal ? 'viger' : 'bliver stående'}`,
      `liste=${j.liste}`)
    tjek((j.kortvalgSynlige[0]?.tekst ?? '') === 'Vis liste',
      `${merke} · ?kort=1: knappen tilbyder listen`, `«${j.kortvalgSynlige[0]?.tekst ?? ''}»`)
    if (UD && medJS) await p.screenshot({ path: `${UD}/a-kort1-${merke}.png` })

    // 3 · Fravalg: intet kort nogen steder.
    await p.goto(`${BASE}${SOEGNING}&kort=0`, { waitUntil: medJS ? 'networkidle' : 'load' })
    await p.waitForTimeout(medJS ? 700 : 200)
    const n = await visning(p)
    tjek(n.liste && !n.kortboks, `${merke} · ?kort=0: kun listen`,
      `liste=${n.liste}, kortboks=${n.kortboks}`)
    tjek((n.kortvalgSynlige[0]?.tekst ?? '') === 'Vis kort',
      `${merke} · ?kort=0: knappen tilbyder kortet`, `«${n.kortvalgSynlige[0]?.tekst ?? ''}»`)

    tjek(u.overloeb <= 0 && j.overloeb <= 0 && n.overloeb <= 0,
      `${merke} · intet vandret overløb i nogen af de tre tilstande`,
      `${u.overloeb} · ${j.overloeb} · ${n.overloeb} px`)
    await c.close()
  }
}

// ══════════════════════════════════════════════════════════════
//  B · HELE søgeforløbet, gennem faktiske klik
//
//  Mod koden fra før: `kortLink` udelod parameteren, når kortet blev
//  slået til, så «Vis kort» førte til en adresse uden `kort` — altså
//  tilbage til standardvisningen. Og GET-formularen bar ikke `kort`
//  med, så det første filterklik nulstillede valget.
//
//  ── HVORFOR DEN BLEV SKREVET OM ──────────────────────────────
//  Den første udgave brød forløbet midtvejs: den gik med `p.goto()` til
//  `/?kort=1&prisMin=5000`, fordi Attrapby kun fylder én side og der
//  ikke var en «næste side» at klikke på. Det var et bevidst skift af
//  søgning — men det betød, at sideskiftet kun beviste, at `kort`
//  overlevede, og intet sagde om `sted` og `sorter`. I loggen så det ud
//  som om forløbet tabte to parametre mellem sortering og paginering.
//  Det gjorde produktet ikke; prøven skiftede søgning.
//
//  Nu er der ÉN søgning hele vejen. `sted=Prøveby` er valgt, fordi den
//  fylder to sider (88 kort) OG bærer et rigtigt stedfilter — begge dele
//  skal være opfyldt, for at et sideskift kan måles på noget. Hvert
//  skridt er et KLIK, og efter hvert skridt kræves alle fire dele:
//  sted, filter, sortering og det eksplicitte visningsvalg.
//
//  Det eksplicitte valg aflæses af klikket i stedet for at være skrevet
//  ind: over 900 px viser den uvalgte tilstand kortet, så knappen fører
//  til `kort=0`; under fører den til `kort=1`. Prøven kræver, at netop
//  den værdi, klikket gav, står der hele vejen.
// ══════════════════════════════════════════════════════════════
console.log('\n═══ B · hele søgeforløbet gennem faktiske klik ═══')
// Søgningen skal fylde MERE END ÉN SIDE, ellers er der ingen
// «næste side» at klikke på, og et sideskift kan ikke måles.
const FORLOEB_STED = 'Prøveby'
for (const bredde of [1440, 768, 390]) {
  const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
  console.log(`\n── ${merke} (${bredde} px) ──`)
  const c = await br.newContext({
    viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
  })
  const p = await c.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(600) }

  /** Alle fire dele af søgningen, læst af adressen. */
  const q = () => Object.fromEntries(new URL(p.url()).searchParams)
  /** Kræver, at de dele, der ER sat, står uændret. */
  const staar = (navn, ventet) => {
    const a = q()
    const mangler = Object.entries(ventet)
      .filter(([nk, nv]) => a[nk] !== nv)
      .map(([nk, nv]) => `${nk}: ${a[nk] ?? '(væk)'} ≠ ${nv}`)
    tjek(mangler.length === 0, `${merke} · ${navn}`,
      mangler.join(' · ') || p.url().replace(BASE, ''))
  }

  // 1 · Søg, som en bruger gør: skriv i feltet og tryk Søg.
  await p.locator('.soegebar input[name="sted"]').first().fill(FORLOEB_STED)
  await p.locator('.soegeknap').first().click()
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(500)
  staar('søgningen står i adressen', { sted: FORLOEB_STED })
  tjek(await p.locator('nav.sider a[rel="next"]').count() > 0,
    `${merke} · søgningen fylder mere end én side`,
    `${await p.locator('a.kort[data-bolig]').count()} kort på side 1`)

  // 2 · Vælg visning ved at KLIKKE på kortvalget. Hvad klikket giver,
  //     afhænger af bredden — og netop den værdi skal bæres videre.
  await p.locator('.kortvalg:visible').first().click()
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(800)
  const VALG = q().kort ?? null
  tjek(VALG === '1' || VALG === '0',
    `${merke} · klikket skriver et eksplicit visningsvalg`, `kort=${VALG}`)
  staar('og søgningen er stadig i behold', { sted: FORLOEB_STED, kort: VALG })
  const efterValg = await visning(p)
  tjek(VALG === '1' ? efterValg.kortboks : !efterValg.kortboks,
    `${merke} · visningen svarer til valget`,
    `kort=${VALG}, kortboks=${efterValg.kortboks}`)

  // 3 · Filtrér gennem filtervinduet.
  await p.locator('.filterknap').first().click()
  await p.waitForLoadState('networkidle')
  await p.locator('input[name="prisMin"]').first().fill('5000')
  await p.locator('form.filtre button[type="submit"]:visible').last().click()
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(600)
  staar('filtrering bevarer sted og visningsvalg',
    { sted: FORLOEB_STED, prisMin: '5000', kort: VALG })

  // 4 · Sortér — ved at åbne menuen og klikke, ikke ved at gå til en
  //     adresse. Et link, der ser rigtigt ud, er ikke et klik.
  const menu = p.locator('details.sortering')
  if (await menu.count()) {
    await menu.locator('summary').first().click()
    await p.waitForTimeout(200)
    await menu.locator('a.sort-pille:not(.valgt)').first().click()
    await p.waitForLoadState('networkidle')
    await p.waitForTimeout(600)
    tjek(q().sorter != null, `${merke} · sorteringen står i adressen`, `sorter=${q().sorter}`)
    staar('sortering bevarer sted, filter og visningsvalg',
      { sted: FORLOEB_STED, prisMin: '5000', kort: VALG, sorter: q().sorter })
  } else {
    tjek(false, `${merke} · sorteringsmenuen findes`)
  }
  const SORT = q().sorter
  const SIDE1 = p.url().replace(BASE, '')

  // 5 · Skift side — i den SAMME søgning.
  const naeste = p.locator('nav.sider a[rel="next"]').first()
  if (await naeste.count()) {
    await naeste.click()
    await p.waitForLoadState('networkidle')
    await p.waitForTimeout(600)
    staar('sideskift bevarer sted, filter, sortering og visningsvalg',
      { sted: FORLOEB_STED, prisMin: '5000', kort: VALG, sorter: SORT, side: '2' })
    const paaSide2 = await visning(p)
    tjek(VALG === '1' ? paaSide2.kortboks : paaSide2.liste,
      `${merke} · og visningen er den samme på side 2`,
      `kort=${VALG}, kortboks=${paaSide2.kortboks}, liste=${paaSide2.liste}`)
  } else {
    tjek(false, `${merke} · der var en «næste side» at klikke på`)
  }

  // 6 · Tilbage — browserens egen knap, gennem det forløb vi lige gik.
  await p.goBack({ waitUntil: 'networkidle' })
  await p.waitForTimeout(700)
  tjek(p.url().replace(BASE, '') === SIDE1,
    `${merke} · tilbage fører til præcis den side, man kom fra`,
    `${p.url().replace(BASE, '')} — ventet ${SIDE1}`)
  staar('og hele søgningen er intakt efter tilbage',
    { sted: FORLOEB_STED, prisMin: '5000', kort: VALG, sorter: SORT })
  const efterTilbage = await visning(p)
  tjek(VALG === '1' ? efterTilbage.kortboks : efterTilbage.liste,
    `${merke} · visningen er den samme efter tilbage`,
    `kortboks=${efterTilbage.kortboks}, liste=${efterTilbage.liste}`)

  // 7 · Ét skridt mere tilbage: før sorteringen. Historikken skal bære
  //     hele forløbet, ikke kun det sidste skridt.
  await p.goBack({ waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  staar('to skridt tilbage: sted, filter og visningsvalg står endnu',
    { sted: FORLOEB_STED, prisMin: '5000', kort: VALG })

  if (UD && bredde === 390) await p.screenshot({ path: `${UD}/b-forloeb-mobil.png` })
  await c.close()
}

// ══════════════════════════════════════════════════════════════
//  C · «Sådan beregner vi» og berøringsmålene
//
//  Mod koden fra før: der var intet `details.metode` — metodeteksten
//  stod åben som et `<p class="note">`. Linjerne om udfoldning, tastatur
//  og «uden JavaScript» var alle røde.
// ══════════════════════════════════════════════════════════════
console.log('\n═══ C · udfoldelig metodeforklaring og berøringsmål ═══')
if (!tilKvm) {
  console.log('  · SPRUNGET OVER — ingen bolig med nok sammenligningsgrundlag')
} else {
  for (const bredde of [1440, 768, 390]) {
    const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
    for (const medJS of [true, false]) {
      const c = await br.newContext({
        viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
        javaScriptEnabled: medJS,
      })
      const p = await c.newPage()
      await p.goto(`${BASE}/bolig/${tilKvm.id}`, { waitUntil: medJS ? 'networkidle' : 'load' })
      await p.waitForTimeout(300)

      const m = await p.evaluate(() => {
        const blok = document.querySelector('#kvadratmeterpris')
        const d = blok?.querySelector('details.metode')
        const synlig = (e) => !!e && getComputedStyle(e).display !== 'none'
          && e.getBoundingClientRect().height > 0
        // ── En lukket <details> kan IKKE måles med en kasse ────────
        //  Chromium skjuler indholdet med `content-visibility: hidden`
        //  på `::details-content`, og i den tilstand bliver
        //  `getBoundingClientRect()` ved med at svare med en kasse.
        //  Efterprøvet på et RENT `<details>` uden vores CSS i samme
        //  browser: 374×18 på et barn af en lukket details. En prøve
        //  bygget på kassen ville altså melde «står åben» om enhver
        //  lukket details i verden — og gjorde det.
        //
        //  `checkVisibility()` er lavet til netop det spørgsmål og
        //  svarer nej. `innerText` er det andet vidne: det er den
        //  tekst, der faktisk gengives, og det er den, brugeren læser.
        return {
          blok: !!blok,
          dom: (blok?.querySelector('.sml-dom')?.textContent ?? '').trim(),
          grundlag: (blok?.querySelector('.sml-grundlag')?.textContent ?? '').trim(),
          talSynlige: synlig(blok?.querySelector('.sml-tal')),
          antalTal: blok?.querySelectorAll('.sml-tal dd').length ?? 0,
          forbehold: (blok?.querySelector('.note')?.textContent ?? '').trim(),
          forbeholdSynligt: synlig(blok?.querySelector('.note')),
          harDetails: !!d,
          aaben: d?.open ?? null,
          summary: (d?.querySelector('summary')?.textContent ?? '').trim(),
          kropSynlig: d?.querySelector('.metode-krop')?.checkVisibility() ?? null,
          blokTekst: (blok?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          kropTekst: (d?.querySelector('.metode-krop')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        }
      })

      if (medJS) {
        tjek(m.blok, `${merke} · «Pris pr. kvadratmeter» findes`)
        tjek(m.dom.length > 0 && /median/i.test(m.dom),
          `${merke} · sammenligningen står synligt`, m.dom.slice(0, 70))
        tjek(/\d/.test(m.grundlag),
          `${merke} · antal sammenligningsboliger står synligt`, `«${m.grundlag}»`)
        tjek(m.talSynlige && m.antalTal === 2,
          `${merke} · begge beløb står synligt`, `${m.antalTal} beløb`)
        tjek(m.forbeholdSynligt && /ikke et udtryk for hele markedet/.test(m.forbehold),
          `${merke} · forbeholdet om datagrundlaget står synligt`, m.forbehold.slice(0, 60))
        tjek(m.harDetails && m.summary === 'Sådan beregner vi',
          `${merke} · metoden ligger under «Sådan beregner vi»`, `«${m.summary}»`)
        tjek(m.aaben === false && m.kropSynlig === false
          && !/regnet af/i.test(m.blokTekst),
          `${merke} · den er foldet sammen fra start`,
          `open=${m.aaben}, checkVisibility=${m.kropSynlig},`
          + ` metodetekst gengivet=${/regnet af/i.test(m.blokTekst)}`)
        // Hele forklaringen skal VÆRE der, ikke kun en overskrift.
        tjek(/median.*regnet af/i.test(m.kropTekst) && /kun huslejen er kendt/i.test(m.kropTekst)
          && /dedupet/i.test(m.kropTekst) && /delt med/i.test(m.kropTekst),
          `${merke} · og hele forklaringen og beregningen er med`,
          `${m.kropTekst.length} tegn`)
      }

      // Udfoldning. Uden JavaScript er det browserens egen — virker den
      // ikke der, er det ikke en <details>.
      const sum = p.locator('details.metode > summary')
      if (await sum.count()) {
        if (medJS) {
          // Tastatur: Tab derhen og tryk Enter. Ikke et klik — kravet er,
          // at den kan åbnes MED TASTATUR.
          await sum.focus()
          const harFokus = await p.evaluate(() =>
            document.activeElement?.tagName === 'SUMMARY')
          tjek(harFokus, `${merke} · summary kan få tastaturfokus`)
          await p.keyboard.press('Enter')
          await p.waitForTimeout(250)
          const aabenNu = await p.evaluate(() => {
            const d = document.querySelector('details.metode')
            const k = d?.querySelector('.metode-krop')
            return { open: d?.open, hoejde: k ? Math.round(k.getBoundingClientRect().height) : 0 }
          })
          tjek(aabenNu.open === true && aabenNu.hoejde > 0,
            `${merke} · Enter folder den ud`, `open=${aabenNu.open}, ${aabenNu.hoejde} px`)
          await p.keyboard.press('Enter')
          await p.waitForTimeout(200)
          tjek(await p.evaluate(() => document.querySelector('details.metode')?.open) === false,
            `${merke} · og Enter igen folder den sammen`)
          if (UD) {
            await p.keyboard.press('Enter'); await p.waitForTimeout(250)
            await p.locator('#kvadratmeterpris').screenshot({ path: `${UD}/c-metode-aaben-${merke}.png` })
          }
        } else {
          await sum.click()
          await p.waitForTimeout(250)
          const aabenNu = await p.evaluate(() => {
            const d = document.querySelector('details.metode')
            const k = d?.querySelector('.metode-krop')
            return { open: d?.open, hoejde: k ? Math.round(k.getBoundingClientRect().height) : 0 }
          })
          tjek(aabenNu.open === true && aabenNu.hoejde > 0,
            `${merke} · UDEN JavaScript: den folder stadig ud`,
            `open=${aabenNu.open}, ${aabenNu.hoejde} px`)
        }
      } else if (medJS) {
        tjek(false, `${merke} · summary findes`)
      }

      // ── Berøringsmål ────────────────────────────────────────
      if (medJS) {
        const maal = await p.evaluate(() => {
          const ud = []
          for (const s of ['details.metode > summary']) {
            for (const e of document.querySelectorAll(s)) {
              const r = e.getBoundingClientRect()
              ud.push({ s, w: Math.round(r.width), h: Math.round(r.height) })
            }
          }
          return ud
        })
        const smaa = maal.filter((x) => x.w < 44 || x.h < 44)
        tjek(smaa.length === 0, `${merke} · «Sådan beregner vi» er mindst 44×44`,
          smaa.map((x) => `${x.s} ${x.w}×${x.h}`).join(' · ')
            || maal.map((x) => `${x.w}×${x.h}`).join(' · '))

        const overloeb = await p.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth)
        tjek(overloeb <= 0, `${merke} · boligsiden har intet vandret overløb`, `${overloeb} px`)
      }
      await c.close()
    }
  }

  // Søgesidens egne berøringsmål — knapperne i søgelinjen.
  for (const bredde of [1440, 768, 390]) {
    const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
    const c = await br.newContext({
      viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
    })
    const p = await c.newPage()
    await p.goto(BASE + SOEGNING, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const m = await p.evaluate(() => {
      const synlig = (e) => getComputedStyle(e).display !== 'none'
        && e.getBoundingClientRect().height > 0
      const ud = []
      for (const s of ['.kortvalg', '.filterknap', '.soegeknap']) {
        for (const e of document.querySelectorAll(s)) {
          if (!synlig(e)) continue
          const r = e.getBoundingClientRect()
          ud.push({ s, w: Math.round(r.width), h: Math.round(r.height) })
        }
      }
      return ud
    })
    const smaa = m.filter((x) => x.w < 44 || x.h < 44)
    tjek(smaa.length === 0, `${merke} · søgelinjens knapper er mindst 44×44`,
      smaa.map((x) => `${x.s} ${x.w}×${x.h}`).join(' · ') || `${m.length} knapper`)
    const knap = m.find((x) => x.s === '.soegeknap')
    tjek(knap != null && knap.h >= 48, `${merke} · søgeknappen er mindst 48 px høj`,
      knap ? `${knap.h} px` : 'ikke fundet')
    await c.close()
  }
}

// ══════════════════════════════════════════════════════════════
//  D · Ordvalget om månedsbeløbet
//
//  Mod koden fra før: etiketten hed «Reel månedlig udgift», og
//  rent-only-tilfældet hed «Månedlig udgift». Begge linjer var røde.
// ══════════════════════════════════════════════════════════════
console.log('\n═══ D · «Månedlig betaling til udlejer» ═══')
{
  const c = await br.newContext({ viewport: { width: 390, height: 844 } })
  const p = await c.newPage()

  await p.goto(`${BASE}/bolig/${medTotal.id}`, { waitUntil: 'networkidle' })
  const a = await p.evaluate(() => {
    const k = document.querySelector('.oek-kort')
    return {
      etiket: (k?.querySelector('.oek-etiket')?.textContent ?? '').trim(),
      poster: [...(k?.querySelectorAll('.oek-poster li span') ?? [])].map((e) => e.textContent.trim()),
      note: (k?.querySelector('.oek-note')?.textContent ?? '').trim(),
      tal: (k?.querySelector('.oek-tal')?.textContent ?? '').trim(),
      side: document.body.innerText,
    }
  })
  tjek(a.etiket === 'Månedlig betaling til udlejer',
    'med total · etiketten er præcis', `«${a.etiket}»`)
  tjek(a.poster.includes('Husleje'), 'med total · posterne står stadig', a.poster.join(' · '))
  tjek(/\d/.test(a.tal), 'med total · beløbet er uændret og står der', a.tal)
  // `/i` er ikke pynt. `.oek-etiket` har `text-transform: uppercase`, og
  // Chromiums `innerText` giver den GENGIVNE tekst — altså versaler. En
  // versalfølsom prøve her bestod, mens den gamle etiket stod på siden:
  // målt i den negative kontrol, hvor «etiketten er præcis» blev rød og
  // den her blev grøn om den samme streng.
  tjek(!/reel\s+månedlig\s+udgift/i.test(a.side),
    'med total · den gamle betegnelse findes ikke længere på siden')
  if (UD) await p.locator('.oek-kort').first().screenshot({ path: `${UD}/d-med-total.png` })

  if (udenTotal) {
    await p.goto(`${BASE}/bolig/${udenTotal.id}`, { waitUntil: 'networkidle' })
    const b = await p.evaluate(() => {
      const k = document.querySelector('.oek-kort')
      return {
        etiket: (k?.querySelector('.oek-etiket')?.textContent ?? '').trim(),
        under: (k?.querySelector('.oek-etiket-under')?.textContent ?? '').trim(),
        mangler: (k?.querySelector('.oek-mangler')?.textContent ?? '').trim(),
      }
    })
    tjek(/husleje/i.test(b.etiket), 'uden total · beløbet betegnes som husleje', `«${b.etiket}»`)
    tjek(/Udlejer oplyser ikke aconto/.test(b.mangler),
      'uden total · forbeholdet om det, der betales separat, står der', b.mangler.slice(0, 60))
    tjek(b.under !== b.etiket && b.under.length > 0,
      'uden total · underlinjen gentager ikke overskriften', `«${b.under}»`)
    if (UD) await p.locator('.oek-kort').first().screenshot({ path: `${UD}/d-uden-total.png` })
  }

  // Gruppesiden: ingen gentagelser af det, der allerede står.
  await p.goto(BASE + SOEGNING, { waitUntil: 'networkidle' })
  const gruppelink = await p.evaluate(() => {
    const a2 = document.querySelector('a[href^="/gruppe"]')
    return a2 ? a2.getAttribute('href') : null
  })
  if (gruppelink) {
    await p.goto(BASE + gruppelink, { waitUntil: 'networkidle' })
    const g = await p.evaluate(() => ({
      h1: (document.querySelector('.sidetitel h1')?.textContent ?? '').trim(),
      p: (document.querySelector('.sidetitel p')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      optaelling: document.querySelectorAll('.optaelling').length,
      broedkrumme: (document.querySelector('.broedkrumme')?.textContent ?? '').trim(),
      kort: document.querySelectorAll('a.kort[data-bolig]').length,
    }))
    tjek(g.h1.length > 0 && g.kort > 0, 'gruppe · titel og boligkort står der',
      `«${g.h1}» · ${g.kort} kort`)
    tjek(g.optaelling === 0, 'gruppe · den gentagende optællingsstribe er væk',
      `${g.optaelling} striber`)
    tjek(/\d/.test(g.p) && /kr\/md/.test(g.p),
      'gruppe · antal, værelser og prisspænd står i forklaringen', g.p.slice(0, 110))
    tjek(g.p.length < 220, 'gruppe · forklaringen er kort', `${g.p.length} tegn`)
  } else {
    tjek(false, 'gruppe · der var et gruppekort at følge')
  }
  await c.close()
}

await br.close()
console.log(fejl === 0 ? '\n✓ mobilforenklingen står' : `\n✗ ${fejl} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
