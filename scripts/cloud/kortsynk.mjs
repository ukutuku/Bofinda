// ═══════════════════════════════════════════════════════════════
//  Viser landkortet DE SAMME boliger som listen?
//
//      node scripts/cloud/kortsynk.mjs [udmappe]
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Kortet og listen er to visninger af ét resultat, bygget af hver sin
//  løkke i app/page.tsx: `maerker` og `visninger`. To udtryk for det
//  samme spørgsmål — og det er præcis den slags, der driver fra
//  hinanden uden at nogen ser det, fordi begge ser rigtige ud hver for
//  sig. Filtrerer man, skal begge følge med.
//
//  Reglen er: ét mærke pr. KORT, ikke pr. bolig. En gruppe er ét mærke
//  med sit antal, og en bolig uden koordinat får intet mærke — den står
//  i listen og nævnes i `.kortnote`.
//
//  Invarianten er derfor:
//     antal mærker            ≤ antal kort
//     sum(mærkernes antal)    ≤ sum(kortenes antal)
//  og med et snævrere filter må ingen af dem vokse.
//
//  ── DEMODATAENE ──────────────────────────────────────────────
//  De 16 demoboliger har eksakte forventninger, fordi vi ved præcis,
//  hvem der har koordinater: se docs/frontend-lancering-v2/demo/
//  staging-demo-koordinater.sql. Springes over, hvis demokilden ikke
//  findes i basen — det siges, det meldes ikke grønt.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
const DEMOKILDE = 'demo-design-20260913'

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

// Findes demodataene i den her base?
let harDemo = false
let demotal = { n: 0, med: 0 }
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
  const [r] = await sql`
    select count(*)::int as n, count(l.lat)::int as med
    from listings l join sources s on s.id = l.source_id
    where s.slug = ${DEMOKILDE} and l.status = 'active'`
  harDemo = (r?.n ?? 0) > 0
  if (harDemo) { demotal = r; console.log(`demokilden fundet: ${r.n} boliger, ${r.med} med koordinat\n`) }
  await sql.end()
}

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

/** Læser listen og kortet af DOM'en, som brugeren ser dem. */
const maal = (p) => p.evaluate(() => {
  // Gruppekortets overskrift begynder med sit antal («4 lejligheder»);
  // et enkeltkort gør ikke. Det er den samme udledning som siden selv
  // bruger — men læst af det, der STÅR på skærmen.
  const kort = [...document.querySelectorAll('.liste a.kort')].map((e) => {
    const t = e.querySelector('.kort-titel')?.textContent?.trim() ?? ''
    const m = e.dataset.gruppe ? t.match(/^(\d+)/) : null
    return { gruppe: !!e.dataset.gruppe, antal: m ? Number(m[1]) : 1, titel: t.slice(0, 40) }
  })
  const maerker = [...document.querySelectorAll('.maerke-boble')].map((e) => {
    const n = (e.textContent ?? '').trim()
    return n === '' ? 1 : Number(n)
  })
  // ── Resultatets tal, ikke sidens ────────────────────────────
  //  Taellelinjen staar kun, naar der ER mere end én side; er den der
  //  ikke, ER siden hele resultatet, og sidens egne tal er de rigtige.
  //  Linjen siger «Viser 48 af 88 kort — 146 boliger matcher soegningen».
  const linje = document.querySelector('.begraensning')?.textContent ?? ''
  const tal = [...linje.matchAll(/([\d.]+)/g)].map((m) => Number(m[1].replace(/\./g, '')))
  return {
    kort, maerker,
    kortAntal: kort.reduce((a, k) => a + k.antal, 0),
    maerkeAntal: maerker.reduce((a, n) => a + n, 0),
    // tal = [vist, kortIAlt, boligerIAlt]
    kortIAlt: tal.length >= 3 ? tal[1] : kort.length,
    boligerIAlt: tal.length >= 3 ? tal[2] : kort.reduce((a, k) => a + k.antal, 0),
    taellelinje: linje.trim().slice(0, 120) || null,
    kortboks: !!document.querySelector('.kortboks'),
    kortmangler: document.querySelector('.kortmangler')?.textContent?.trim().slice(0, 90) ?? null,
    kortnote: document.querySelector('.kortnote')?.textContent?.trim().slice(0, 90) ?? null,
    listeSkjult: (() => {
      const l = document.querySelector('.liste')
      return l ? getComputedStyle(l.parentElement).display === 'none' : null
    })(),
  }
})

const aabn = async (bredde) => {
  const c = await br.newContext({ viewport: { width: bredde, height: bredde === 390 ? 844 : 1100 } })
  const p = await c.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(700) }
  return { c, p }
}
const gaaTil = async (p, sti) => {
  await p.goto(BASE + sti, { waitUntil: 'networkidle' })
  await p.waitForTimeout(900)   // Leaflet skal naa at saette maerkerne
  return maal(p)
}

// ═══ Skiftet som brugeren goer det: et KLIK, ikke en adresse ═══
//
//  Foer gik proeven direkte til `&kort=1`. Det maaler visningen, men
//  ikke selve skiftet — og det er dér, filtre plejer at falde paa
//  gulvet: knappen er et link, og et link, der glemmer at baere
//  soegningen med, ser rigtigt ud lige indtil man klikker paa det.
//
//  ÉN funktion, kaldt ved alle tre bredder. Skrevet ud tre steder ville
//  det vaere tre udtryk for det samme spoergsmaal — og de driver fra
//  hinanden, som CLAUDE.md siger. Det eneste, der ER breddeafhaengigt,
//  er om listen skjules: under 900 px er kort og liste et skift, over
//  staar de ved siden af hinanden. Det udledes af bredden, ikke skrevet
//  ind pr. kald.
const MED_FILTRE = '/?sted=Pr%C3%B8veby&prisMin=9000&vaerelser=2&kort=0'
const tilstand = (p) => p.evaluate(() => ({
  url: location.search,
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent?.trim()).filter(Boolean),
  kortboks: !!document.querySelector('.kortboks'),
  listeSkjult: (() => {
    const l = document.querySelector('.liste')
    return l ? getComputedStyle(l.parentElement).display === 'none' : null
  })(),
}))

async function proevSkift(p, merke, bredde) {
  const skifter = bredde <= 900   // samme graense som @media i globals.css
  await p.goto(BASE + MED_FILTRE, { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const foer = await tilstand(p)

  await p.locator('.kortvalg').first().click()
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(900)
  const efter = await tilstand(p)

  tjek(efter.kortboks, `${merke} · klik på kortvalget viser landkortet`)
  tjek(efter.listeSkjult === skifter,
    `${merke} · ${skifter ? 'listen viger for kortet' : 'listen bliver stående ved siden af'}`,
    `listeSkjult=${efter.listeSkjult}`)
  tjek(/prisMin=9000/.test(efter.url) && /vaerelser=2/.test(efter.url) && /sted=/.test(efter.url),
    `${merke} · skiftet bevarer filtrene i adressen`, efter.url)
  tjek(efter.chips.length === foer.chips.length && efter.chips.length > 0,
    `${merke} · og chipperne står uændret`,
    `${foer.chips.join(' | ')} → ${efter.chips.join(' | ')}`)

  // Og tilbage igen. En vej, der kun virker den ene retning, er ikke et skift.
  await p.locator('.kortvalg').first().click()
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(400)
  const tilbage = await tilstand(p)
  tjek(tilbage.listeSkjult === false && !tilbage.kortboks,
    `${merke} · og tilbage til listen igen`,
    `listeSkjult=${tilbage.listeSkjult}, kortboks=${tilbage.kortboks}`)
  tjek(/prisMin=9000/.test(tilbage.url) && /vaerelser=2/.test(tilbage.url),
    `${merke} · filtrene overlever også vejen tilbage`, tilbage.url)
}

// ── 1. Desktop: liste OG landkort side om side ──────────────────
{
  console.log('═══ Desktop: liste og landkort ═══')
  const { c, p } = await aabn(1440)
  const SØGNINGER = [
    ['alle boliger', '/?sted=Pr%C3%B8veby'],
    ['+ prisfilter', '/?sted=Pr%C3%B8veby&prisMin=9000'],
    ['+ areal', '/?sted=Pr%C3%B8veby&prisMin=9000&areal=60'],
  ]
  let forrige = null
  for (const [navn, sti] of SØGNINGER) {
    const m = await gaaTil(p, sti)
    console.log(`\n── ${navn}`)
    tjek(m.kort.length > 0, `${navn} · der er kort i listen`, `${m.kort.length} kort`)
    tjek(m.kortboks, `${navn} · landkortet vises ved siden af listen`)
    // Ét maerke pr. kort — aldrig flere.
    tjek(m.maerker.length <= m.kort.length,
      `${navn} · aldrig flere mærker end kort`, `${m.maerker.length} mærker, ${m.kort.length} kort`)
    // Kortet maa ikke paastaa flere boliger end listen viser.
    tjek(m.maerkeAntal <= m.kortAntal,
      `${navn} · kortet dækker aldrig flere boliger end listen`,
      `${m.maerkeAntal} på kortet, ${m.kortAntal} i listen`)
    // Boligerne uden maerke skal naevnes, ikke bare mangle.
    const udenMaerke = m.kortAntal - m.maerkeAntal
    tjek(udenMaerke === 0 || m.kortnote != null,
      `${navn} · boliger uden mærke er nævnt under kortet`,
      udenMaerke === 0 ? 'alle har mærke' : `${udenMaerke} uden mærke · «${m.kortnote}»`)
    // ── Et snaevrere filter maa ikke give MERE ────────────────
    //  Maalt paa RESULTATET, ikke paa side 1.
    //
    //  Her stod `m.kortAntal <= forrige.kortAntal` — altsaa summen af de
    //  48 korts boligtal. Det er side 1's DAEKNING, ikke resultatet, og
    //  den kan godt vokse af et snaevrere filter: siden rummer 48 KORT,
    //  ikke 48 boliger, saa naar filteret blander om paa, hvilke 48 der
    //  naar side 1, kan der komme flere gruppekort med — og dermed flere
    //  boliger bag de samme 48 kort. Maalt paa denne base:
    //  side 1 daekkede 96 → 98 → 74 boliger, mens resultatet faldt
    //  146 → 135 → 86, som det skal. Paastanden var altsaa sand om
    //  resultatet og falsk om det, den maalte.
    //
    //  Samme fejl som filens egen overskrift advarer imod: to udtryk for
    //  ét spoergsmaal. Taellelinjen ER svaret paa «hvor mange matcher»;
    //  side 1 svarer paa noget andet.
    if (forrige) {
      tjek(m.kortIAlt <= forrige.kortIAlt && m.boligerIAlt <= forrige.boligerIAlt,
        `${navn} · et snævrere filter giver hverken flere kort eller flere boliger`,
        `kort ${forrige.kortIAlt}→${m.kortIAlt}, boliger ${forrige.boligerIAlt}→${m.boligerIAlt}`)
    }
    // Og side 1 er stadig side 1: den maa aldrig paastaa mere end resultatet.
    tjek(m.kort.length <= m.kortIAlt && m.kortAntal <= m.boligerIAlt,
      `${navn} · side 1 lover ikke mere end hele resultatet`,
      `side 1: ${m.kort.length} kort / ${m.kortAntal} boliger · i alt: ${m.kortIAlt} / ${m.boligerIAlt}`)
    forrige = m
    if (UD) await p.screenshot({ path: `${UD}/desktop-${navn.replace(/[^a-z0-9]+/gi, '-')}.png` })
  }
  // Skiftet maales OGSAA her. Over 900 px betyder «Vis liste» ikke, at
  // listen kommer FREM — den staar der hele tiden — men at kortspalten
  // gaar vaek. Filtrene skal overleve begge veje, ligesom paa mobil.
  console.log('')
  await proevSkift(p, 'desktop', 1440)
  await c.close()
}

// ── 2. Under 900 px: skiftet mellem liste og kort ───────────────
//  Grænsen er @media (max-width: 900px) i globals.css: derunder er liste
//  og kort et SKIFT, ikke to spalter. Derfor hører BÅDE 768 og 390 til
//  her. 768 var ikke målt før — og det er netop den bredde, hvor man
//  kunne tro, at spalterne stadig står ved siden af hinanden, fordi
//  skærmen er bred nok til at ligne en lille bærbar.
for (const bredde of [768, 390]) {
  const merke = bredde === 390 ? 'mobil' : 'tablet'
  console.log(`\n═══ ${merke} (${bredde} px): skiftet mellem liste og kort ═══`)
  const { c, p } = await aabn(bredde)
  const liste = await gaaTil(p, '/?sted=Pr%C3%B8veby&kort=0')
  tjek(liste.listeSkjult === false, `${merke} · listevisning: listen er synlig`)
  tjek(!liste.kortboks, `${merke} · listevisning: kortet vises ikke`)
  if (UD) await p.screenshot({ path: `${UD}/${merke}-liste.png` })

  await proevSkift(p, merke, bredde)

  const kortvis = await gaaTil(p, '/?sted=Pr%C3%B8veby&kort=1')
  tjek(kortvis.listeSkjult === true, `${merke} · kortvisning: listen er skjult`)
  tjek(kortvis.kortboks, `${merke} · kortvisning: kortet fylder pladsen`)
  tjek(kortvis.maerker.length > 0, `${merke} · kortvisning: der er mærker på kortet`,
    `${kortvis.maerker.length} mærker`)
  // Det samme resultat — kun visningen skifter. Baade hele resultatet og
  // den side, brugeren staar paa: et skift, der beholder totalen men
  // bytter om paa side 1, ville ogsaa vaere et skift, der aendrer noget.
  tjek(kortvis.boligerIAlt === liste.boligerIAlt && kortvis.kortIAlt === liste.kortIAlt,
    `${merke} · skiftet ændrer ikke resultatet`,
    `${liste.kortIAlt} kort / ${liste.boligerIAlt} boliger begge veje`)
  tjek(kortvis.kortAntal === liste.kortAntal,
    `${merke} · og heller ikke den side, man står på`,
    `${liste.kortAntal} boliger på side 1 begge veje`)
  if (UD) await p.screenshot({ path: `${UD}/${merke}-kort.png` })
  await c.close()
}

// ── 3. Demodataene: eksakte tal ─────────────────────────────────
if (!harDemo) {
  console.log('\n· demodataene: SPRUNGET OVER — demokilden findes ikke i basen')
} else {
  // Tallene er de MAALTE, ikke skrevet ind: er koordinaterne rullet
  // tilbage, skal overskriften sige det, ikke lyve om 8.
  console.log(`\n═══ Demodataene (${demotal.n} boliger, ${demotal.med} med koordinat) ═══`)
  // Og hvis de mangler, siges det foer paastandene — saa en roed blok
  // ikke laeses som «kortet er i stykker», naar den er «koordinaterne
  // er ikke indsat».
  if (demotal.med === 0) {
    console.log('  ⚠ INGEN af demoboligerne har koordinat. Kor staging-demo-koordinater.sql.')
  }
  const { c, p } = await aabn(1440)
  const kilde = `kilde=${DEMOKILDE}`
  // Hele demosættet: to grupper med koordinat, to uden.
  const alle = await gaaTil(p, `/?${kilde}`)
  tjek(alle.kortAntal === 16, 'demo · listen dækker alle 16 boliger', `${alle.kortAntal}`)
  tjek(alle.kort.length === 4, 'demo · de 16 bliver til fire gruppekort', `${alle.kort.length} kort`)
  tjek(alle.maerker.length === 2, 'demo · to af kortene har koordinat', `${alle.maerker.length} mærker`)
  tjek(alle.maerkeAntal === 8, 'demo · mærkerne dækker de 8 med koordinat', `${alle.maerkeAntal}`)
  tjek(alle.kortnote != null, 'demo · de 8 uden koordinat er nævnt under kortet', `«${alle.kortnote}»`)
  if (UD) await p.screenshot({ path: `${UD}/demo-alle.png` })

  // Kun lejlighederne: begge grupper HAR koordinat.
  const lejl = await gaaTil(p, `/?${kilde}&type=lejlighed`)
  tjek(lejl.kortAntal === 8, 'demo · filter «lejlighed» giver 8 boliger', `${lejl.kortAntal}`)
  tjek(lejl.maerkeAntal === 8, 'demo · og alle 8 står på kortet', `${lejl.maerkeAntal}`)
  tjek(lejl.kortnote == null, 'demo · ingen note, når alle har koordinat', lejl.kortnote ?? 'ingen note')
  if (UD) await p.screenshot({ path: `${UD}/demo-lejligheder.png` })

  // Kun vaerelserne: INGEN har koordinat — kortet kan ikke vise noget.
  const vaer = await gaaTil(p, `/?${kilde}&type=vaerelse`)
  tjek(vaer.kortAntal === 4, 'demo · filter «værelse» giver 4 boliger', `${vaer.kortAntal}`)
  tjek(vaer.maerker.length === 0, 'demo · ingen af dem har koordinat', `${vaer.maerker.length} mærker`)
  tjek(vaer.kortmangler != null, 'demo · og siden siger hvorfor kortet er tomt', `«${vaer.kortmangler}»`)
  tjek(vaer.kort.length === 1, 'demo · boligerne står stadig i listen', `${vaer.kort.length} kort`)
  if (UD) await p.screenshot({ path: `${UD}/demo-uden-koordinat.png` })
  await c.close()
}

await br.close()
console.log(fejl === 0 ? '\n✓ liste og kort siger det samme' : `\n✗ ${fejl} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
