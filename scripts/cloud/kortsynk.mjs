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
  return {
    kort, maerker,
    kortAntal: kort.reduce((a, k) => a + k.antal, 0),
    maerkeAntal: maerker.reduce((a, n) => a + n, 0),
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
    // Et snaevrere filter maa ikke give MERE.
    if (forrige) {
      tjek(m.kortAntal <= forrige.kortAntal && m.maerkeAntal <= forrige.maerkeAntal,
        `${navn} · et snævrere filter giver hverken flere kort eller flere mærker`,
        `liste ${forrige.kortAntal}→${m.kortAntal}, kort ${forrige.maerkeAntal}→${m.maerkeAntal}`)
    }
    forrige = m
    if (UD) await p.screenshot({ path: `${UD}/desktop-${navn.replace(/[^a-z0-9]+/gi, '-')}.png` })
  }
  await c.close()
}

// ── 2. Mobil: skiftet mellem liste og kort ──────────────────────
{
  console.log('\n═══ Mobil: skiftet mellem liste og kort ═══')
  const { c, p } = await aabn(390)
  const liste = await gaaTil(p, '/?sted=Pr%C3%B8veby&kort=0')
  tjek(liste.listeSkjult === false, 'mobil · listevisning: listen er synlig')
  tjek(!liste.kortboks, 'mobil · listevisning: kortet vises ikke')
  if (UD) await p.screenshot({ path: `${UD}/mobil-liste.png` })

  const kortvis = await gaaTil(p, '/?sted=Pr%C3%B8veby&kort=1')
  tjek(kortvis.listeSkjult === true, 'mobil · kortvisning: listen er skjult')
  tjek(kortvis.kortboks, 'mobil · kortvisning: kortet fylder pladsen')
  tjek(kortvis.maerker.length > 0, 'mobil · kortvisning: der er mærker på kortet',
    `${kortvis.maerker.length} mærker`)
  // Det samme resultat — kun visningen skifter.
  tjek(kortvis.kortAntal === liste.kortAntal,
    'mobil · skiftet ændrer ikke resultatet', `${liste.kortAntal} boliger begge veje`)
  if (UD) await p.screenshot({ path: `${UD}/mobil-kort.png` })
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
