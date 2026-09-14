// ═══════════════════════════════════════════════════════════════
//  Kontrol af boligkortet og resultatlayoutet.
//
//  Måler det, designløftet lover, så en senere ændring ikke kan tage
//  det tilbage i tavshed:
//
//    · højst TO kolonner, én på mobil — målt på listeområdets bredde,
//      ikke på vinduets
//    · intet vandret overløb, og intet barn bredere end sit kort
//    · billedrammen er ÉN form: billedets kasse = rammens kasse, og
//      rammen er aldrig bredere end sin spalte
//    · et kort uden foto strækkes ikke til naboens højde
//    · økonomien er ikke afkortet — ingen ellipsis, ingen linjeklip,
//      ingen tekst der er bredere end sin kasse
//    · kortet er ét klikmål: ingen indlejrede interaktive elementer
//    · tastaturfokus giver en synlig ring
//    · gruppelinket bærer søgningens filtre videre
//    · højst én skillelinje per kort
//
//  Kører KUN mod det isolerede testmiljø på loopback. Uden
//  BOFINDA_APP peger den ingen steder hen — der er intet fald tilbage.
//
//  Brug:  node scripts/cloud/kortkontrol.mjs [mappe-til-skærmbilleder]
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP = process.env.BOFINDA_APP ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(APP)) {
  console.error(`FEJL: BOFINDA_APP skal være loopback, ikke ${APP}`)
  process.exit(1)
}
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })

const BREDDER = [390, 768, 1100, 1440]
const SIDER = [
  ['med-kort', '/?sted=Attrapby&kort=1'],
  ['uden-kort', '/?sted=Attrapby&kort=0'],
]

let fejl = 0
let kørte = 0
const prøve = (ok, tekst, detalje = '') => {
  kørte++
  if (!ok) fejl++
  console.log(`${ok ? '  ✓' : '  ✗'} ${tekst}${detalje ? ` — ${detalje}` : ''}`)
}

// ── EN PRØVE, DER IKKE KØRTE, ER IKKE EN BESTÅET PRØVE ──────────
//  En løkke over en tom liste kalder `prøve()` nul gange, og filen
//  slutter grønt på noget, der aldrig blev målt. Det skete: prøven for
//  billedformater valgte to boliger, der hverken stod på første side
//  eller som enkeltkort, og meldte sig bestået uden en eneste måling.
//
//  `blok()` tæller, hvad der faktisk blev kaldt indenfor, og kræver et
//  antal. Tallet er strukturelt — 2 bredder à 6 målinger — så en ny
//  kontrol et andet sted i filen ikke får det til at ryge. Et samlet
//  gulv for hele filen ville have netop den svaghed.
async function blok(navn, forventet, fn) {
  const før = kørte
  await fn()
  const antal = kørte - før
  if (antal !== forventet) {
    kørte++; fejl++
    console.log(`  ✗ ${navn}: ${antal} målinger kørte, ${forventet} forventet`
      + ' — noget blev sprunget over i tavshed')
  }
}

// ── Målingen i browseren ────────────────────────────────────────
// Én passage gennem DOM'en per visning. Alt måles på kasserne, ikke på
// reglerne: en regel kan være der uden at virke.
const MAAL = () => {
  const omraade = document.querySelector('.listeomraade')
  const liste = document.querySelector('.liste')
  if (!liste) return null
  const boks = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.width), h: Math.round(r.height) } }
  const kort = [...liste.querySelectorAll('a.kort')]

  // Kolonner: hvor mange kort deler den øverste rækkes top.
  const top0 = kort.length ? boks(kort[0]).y : 0
  const kolonner = kort.filter((e) => Math.abs(boks(e).y - top0) < 4).length

  // Billedrammen. Rammen og billedet skal være samme kasse: er de ikke,
  // er billedet enten strakt eller løbet ud over sin spalte.
  // LAYOUTKASSEN, ikke den tegnede. `getBoundingClientRect()` regner
  // transformer med, og `.kort:hover .kort-billede img` skalerer 1,025.
  // Museplaceringen fra et tidligere klik lå tilfældigt over et kort, og
  // så meldte kontrollen 463x261 ≠ 452x254 om et billede, der sad
  // præcist — 452 · 1,025 = 463,3. Musen flyttes væk før målingen, og
  // her læses `offsetWidth`/`clientWidth`, som ingen transform rører.
  const billeder = kort.filter((e) => e.querySelector('.kort-billede img')).map((e) => {
    const ram = e.querySelector('.kort-billede')
    const img = ram.querySelector('img')
    return {
      ramme: { b: ram.clientWidth, h: ram.clientHeight },
      billede: { b: img.offsetWidth, h: img.offsetHeight },
      spalte: e.clientWidth,
      objectFit: getComputedStyle(img).objectFit,
      naturlig: `${img.naturalWidth}x${img.naturalHeight}`,
      indlæst: img.naturalWidth > 0,
    }
  })

  // Strækkes et kort uden foto til naboens højde? Kun målbart når de to
  // slags deler en række.
  const rækker = new Map()
  for (const e of kort) {
    const y = Math.round(boks(e).y / 4) * 4
    if (!rækker.has(y)) rækker.set(y, [])
    rækker.get(y).push(e)
  }
  const blandede = [...rækker.values()].filter((r) =>
    r.length > 1 && r.some((e) => e.classList.contains('uden-billede'))
                 && r.some((e) => !e.classList.contains('uden-billede')))
    .map((r) => r.map((e) => ({ uden: e.classList.contains('uden-billede'), h: boks(e).h })))

  // Afkortning i økonomien. `.ukendt`, `.el`, `.poster`, prisen og
  // indflytningsprisen må aldrig klippes: de bærer de forbehold, hele
  // kortets troværdighed hviler på.
  const ØKO = '.kort-pris, .kort-indflytning, .ukendt, .el, .poster, .gruppe-match, .gruppe-flere'
  const klippet = []
  for (const e of liste.querySelectorAll(ØKO)) {
    const s = getComputedStyle(e)
    const overflydende = e.scrollWidth > e.clientWidth + 1
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || overflydende) {
      klippet.push({ klasse: e.className, textOverflow: s.textOverflow, clamp: s.webkitLineClamp, overflydende })
    }
  }

  // Børn bredere end deres kort — det er sådan et billede uden for sin
  // spalte viser sig, også når kortets `overflow: hidden` skjuler det.
  const forBrede = []
  for (const e of kort) {
    const k = e.clientWidth
    for (const barn of e.querySelectorAll('*')) {
      if (barn.offsetWidth > k + 1) forBrede.push({ kort: e.id, klasse: barn.className, kortbredde: k, barn: barn.offsetWidth })
    }
  }

  // Indlejrede interaktive elementer i kortlinket.
  const indlejret = kort.flatMap((e) =>
    [...e.querySelectorAll('a, button, input, select, textarea, [tabindex], [role="button"]')]
      .map((x) => `${e.id}: ${x.tagName.toLowerCase()}.${x.className}`))

  // Skillelinjer inde i kortet. Foden har én; flere er dekoration.
  const streger = kort.map((e) =>
    [...e.querySelectorAll('*')].filter((x) => {
      const s = getComputedStyle(x)
      return (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none')
          || (parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== 'none')
    }).filter((x) => !x.classList.contains('fakta-chip')).length)

  const grupper = kort.filter((e) => e.dataset.gruppe).map((e) => e.getAttribute('href'))

  return {
    omraade: omraade ? boks(omraade).b : null,
    // Under 901 px er kort og liste et SKIFT, ikke to spalter: er kortet
    // valgt, er listen skjult. Målingen skal vide det — ellers rapporterer
    // den 42 «kolonner» à 0 px om en liste, ingen kan se, og fejler på et
    // layout, der gør præcis det, den skal.
    listeSkjult: getComputedStyle(liste.parentElement).display === 'none',
    kortboks: document.querySelector('.kortboks')
      ? Math.round(document.querySelector('.kortboks').getBoundingClientRect().width) : null,
    liste: boks(liste).b,
    // Gitterets eget mellemrum, laest af CSS'en og ikke skrevet af: det
    // indgaar i regnestykket for, om der er plads til en kolonne mere.
    gab: parseFloat(getComputedStyle(liste).columnGap) || 0,
    kolonner,
    kortbredde: kort.length ? boks(kort[0]).b : 0,
    antal: kort.length,
    vandretOverløb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    billeder, blandede, klippet, forBrede, indlejret,
    maxStreger: streger.length ? Math.max(...streger) : 0,
    grupper: grupper.slice(0, 3),
    udenFoto: kort.filter((e) => e.classList.contains('uden-billede')).length,
  }
}

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

for (const bredde of BREDDER) {
  const c = await br.newContext({ viewport: { width: bredde, height: 1000 }, deviceScaleFactor: 1 })
  const p = await c.newPage()
  // Samtykkebanneret ligger over listen og ville forfalske både
  // skærmbillede og måling.
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(800) }

  for (const [navn, sti] of SIDER) {
    await p.goto(APP + sti, { waitUntil: 'networkidle' })
    // Musen ud af listen: hover skalerer billedet, og en måling med den
    // over et kort er en måling af noget andet end layoutet.
    await p.mouse.move(bredde - 2, 2)
    await p.waitForTimeout(500)
    const m = await p.evaluate(MAAL)
    console.log(`\n${bredde} px · ${navn} — listeområde ${m.omraade} px, liste ${m.liste} px, `
      + `${m.kolonner} kolonne(r) à ${m.kortbredde} px, ${m.antal} kort (${m.udenFoto} uden foto)`
      + (m.listeSkjult ? ' · LISTEN ER SKJULT, kortet vises i stedet' : ''))

    // ── To flader, to sæt påstande ──────────────────────────────
    // Er listen skjult, er dette KORTVISNINGEN, og så er der ingen
    // kolonner at tælle. At måle dem alligevel gav «42 kolonner à 0 px»
    // og tre røde linjer om et layout, der gjorde nøjagtig det, det
    // skulle. Grenen er ikke en undtagelse, den er den anden flade —
    // og den har sine egne påstande, så ingen af de to kan slippe
    // igennem umålt.
    if (m.listeSkjult) {
      prøve(bredde <= 900, 'listen skjules kun på smal skærm', `${bredde} px`)
      prøve(navn === 'med-kort', 'listen skjules kun, når kortet er valgt', navn)
      prøve(m.kortboks != null && m.kortboks > bredde * 0.8,
        'kortet fylder bredden i stedet', `${m.kortboks} px af ${bredde}`)
      prøve(m.vandretOverløb === 0, 'intet vandret overløb', `${m.vandretOverløb} px`)
      if (UD) {
        await p.screenshot({ path: `${UD}/${navn}-${bredde}.png` })
        await p.screenshot({ path: `${UD}/${navn}-${bredde}-hele.png`, fullPage: true })
      }
      continue
    }

    // ── Kolonnetallet ────────────────────────────────────────
    // Påstanden var «højst to kolonner». Den holdt ikke: to kolonner på
    // 1440 px uden landkort gav 640 px brede kort med 360 px høje fotos,
    // hvor billedet fylder mere end oplysningerne.
    //
    // Reglen er ikke et fast tal. Den er: læg en kolonne til, så længe
    // hvert kort bliver mindst GULV bredt — og aldrig flere end LOFT.
    // Prøven må ikke skrive breakpointsene af fra CSS'en; så ville den
    // samme regel stå to steder og kunne drive fra hinanden. Den måler
    // EGENSKABEN i stedet: er tallet det højeste, gulvet tillader?
    //
    // Den kan fejle. Sættes breakpointet til 1400 px, står 1440 px uden
    // kort tilbage på to kolonner, og «én mere ville give 420 px» er
    // over gulvet — altså rødt, hvilket er præcis den fejl, der blev
    // meldt ind.
    const GULV = 380
    const LOFT = 3
    prøve(m.kolonner >= 1 && m.kolonner <= LOFT, `mellem 1 og ${LOFT} kolonner`, `${m.kolonner}`)
    if (bredde === 390) prøve(m.kolonner === 1, 'én kolonne på mobil', `${m.kolonner}`)
    const enMere = (m.liste - m.kolonner * m.gab) / (m.kolonner + 1)
    prøve(m.kolonner === LOFT || enMere < GULV,
      'kolonnetallet er det højeste, gulvet tillader',
      `${m.kolonner} kol à ${m.kortbredde} px i en liste på ${m.liste} px`
      + ` · én mere ville give ${Math.round(enMere)} px (gulv ${GULV})`)
    prøve(m.vandretOverløb === 0, 'intet vandret overløb', `${m.vandretOverløb} px`)
    prøve(m.forBrede.length === 0, 'intet barn bredere end sit kort',
      m.forBrede.slice(0, 2).map((f) => `${f.klasse} ${f.barn} > ${f.kortbredde}`).join(' · '))

    const skæve = m.billeder.filter((b) => Math.abs(b.billede.b - b.ramme.b) > 1 || Math.abs(b.billede.h - b.ramme.h) > 1)
    prøve(skæve.length === 0, `billedet fylder rammen præcist (${m.billeder.length} fotos)`,
      skæve.slice(0, 2).map((b) => `${b.billede.b}x${b.billede.h} ≠ ${b.ramme.b}x${b.ramme.h}`).join(' · '))
    prøve(m.billeder.every((b) => b.objectFit === 'cover'), 'object-fit: cover på alle billeder')
    prøve(m.billeder.every((b) => b.indlæst), `alle billeder er hentet`,
      `${m.billeder.filter((b) => !b.indlæst).length} tomme`)

    const strakt = m.blandede.flatMap((r) => {
      const medFoto = Math.max(...r.filter((x) => !x.uden).map((x) => x.h))
      return r.filter((x) => x.uden && Math.abs(x.h - medFoto) < 2)
    })
    prøve(strakt.length === 0,
      `kort uden foto strækkes ikke (${m.blandede.length} blandede rækker)`, `${strakt.length} strakte`)

    prøve(m.klippet.length === 0, 'ingen afkortning i økonomi og forbehold',
      m.klippet.slice(0, 2).map((x) => x.klasse).join(' · '))
    prøve(m.indlejret.length === 0, 'kortet er ét klikmål', m.indlejret.slice(0, 2).join(' · '))
    prøve(m.maxStreger <= 1, 'højst én skillelinje per kort', `${m.maxStreger}`)
    // `by=`, ikke `sted=`: gruppeUrl() serialiserer Filtre, og byfilteret
    // hedder `by` dér. Nøglen bæres ikke i adressen — den udledes af
    // repræsentantens bolig-id, så en udlejers konto-id aldrig havner i
    // en delbar URL.
    prøve(m.grupper.every((h) => h.startsWith('/gruppe?b=') && h.includes('by=Attrapby')),
      'gruppelinket bærer filtrene videre', m.grupper[0] ?? 'ingen grupper')

    if (UD) {
      await p.screenshot({ path: `${UD}/${navn}-${bredde}.png` })
      await p.screenshot({ path: `${UD}/${navn}-${bredde}-hele.png`, fullPage: true })
    }
  }

  // ── Tastaturfokus ────────────────────────────────────────────
  // Kortet er et link; fokusringen er den eneste måde at se hvor man er.
  await p.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
  const fokus = await p.evaluate(() => {
    const k = document.querySelector('a.kort')
    k.focus()
    const s = getComputedStyle(k)
    return { erFokus: document.activeElement === k, outline: s.outlineWidth, stil: s.outlineStyle, href: k.getAttribute('href') }
  })
  prøve(fokus.erFokus && parseFloat(fokus.outline) >= 2 && fokus.stil !== 'none',
    'kortet kan fokuseres og viser en ring', `${fokus.outline} ${fokus.stil}`)

  await c.close()
}

// ── Navigationen fra et filtreret gruppekort ────────────────────
{
  const c = await br.newContext({ viewport: { width: 1100, height: 1000 } })
  const p = await c.newPage()
  await p.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
  const href = await p.evaluate(() => document.querySelector('a.kort[data-gruppe]')?.getAttribute('href') ?? null)
  if (!href) { prøve(false, 'et gruppekort at navigere fra'); }
  else {
    await p.goto(APP + href, { waitUntil: 'networkidle' })
    const g = await p.evaluate(() => ({
      kort: document.querySelectorAll('.liste a.kort').length,
      omraade: !!document.querySelector('.listeomraade'),
      titel: document.querySelector('h1')?.textContent?.trim() ?? '',
      // Brødkrummen fører til POSTNUMMERET, ikke til den søgning man kom
      // fra: `/?sted=9003`. Det er med vilje — byen kan skifte navn i
      // kildernes data, postnummeret gør ikke.
      tilbage: [...document.querySelectorAll('.broedkrumme a')].map((a) => a.getAttribute('href')),
    }))
    console.log(`\nGruppesiden ${href}`)
    prøve(g.kort > 1, 'gruppen viser sine enkelte boliger', `${g.kort} kort`)
    prøve(g.omraade, 'gruppesiden har samme listeområde')
    prøve(g.tilbage.includes('/') && g.tilbage.some((h) => h.startsWith('/?sted=')),
      'brødkrummen fører til forsiden og til postnummeret', g.tilbage.join(' · '))
  }
  await c.close()
}

// ── Billedformaterne ────────────────────────────────────────────
//  Kilderne leverer hvad de har: 600x900 staaende, 1800x600 liggende.
//  Rammen skal vaere ÉN form uanset hvad der lægges i den, og billedet
//  skal fylde den ud uden at blive strakt. Ruderne i testaktiverne er
//  kvadratiske — bliver de rektangler, er noget strakt.
//
//  Prøven SKRIVER i testbasen og skriver tilbage igen. Den kører kun
//  mod den isolerede base på 55432; uden DATABASE_URL springes den over
//  frem for at pege et andet sted hen.
if (!process.env.DATABASE_URL) {
  console.log('\n· billedformater: sprunget over (ingen DATABASE_URL)')
} else {
  const u = new URL(process.env.DATABASE_URL)
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.port !== '55432' || !u.pathname.endsWith('bofinda_test')) {
    console.error(`FEJL: DATABASE_URL peger ikke på testbasen (${u.hostname}:${u.port}${u.pathname})`)
    process.exit(1)
  }
  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
  const aktiv = `http://127.0.0.1:${process.env.BOFINDA_AKTIVPORT ?? 55433}`

  // Boligerne vælges fra SIDEN, ikke fra basen. Et `order by id limit 2`
  // ramte to rækker, der hverken var på første side eller stod som
  // enkeltkort — og så målte prøven ingenting og meldte sig grøn på de
  // kontroller, der aldrig kørte.
  const vælg = await br.newContext({ viewport: { width: 1440, height: 1200 } })
  const vp = await vælg.newPage()
  await vp.goto(APP + '/', { waitUntil: 'networkidle' })
  const vk = vp.getByRole('button', { name: 'Kun det nødvendige' })
  if (await vk.count()) { await vk.first().click(); await vp.waitForTimeout(600) }
  await vp.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
  const kandidater = await vp.evaluate(() => [...document.querySelectorAll('.liste a.kort:not([data-gruppe])')]
    .filter((k) => k.querySelector('.kort-billede img')).slice(0, 2).map((k) => k.dataset.bolig))
  await vælg.close()
  if (kandidater.length < 2) { console.error('FEJL: fandt ikke to enkeltkort med foto'); process.exit(1) }

  const raa = await sql`
    select l.id, i.id as billed_id, i.external_url
    from listings l join listing_images i on i.listing_id = l.id and i.position = 0
    where l.id in ${sql(kandidater)}`
  // Rækkefølgen bestemmes her, ikke i SQL: den skal følge kandidaterne,
  // så stående og liggende lander på de kort, prøven kigger efter.
  const emner = kandidater.map((id) => raa.find((r) => r.id === id)).filter(Boolean)
  if (emner.length !== 2) {
    console.error(`FEJL: ${emner.length} af 2 prøveboliger har et billede i basen`); process.exit(1)
  }
  const før = emner.map((e) => ({ id: e.billed_id, url: e.external_url }))
  const former = ['staaende', 'liggende']
  try {
    for (const [i, e] of emner.entries()) {
      await sql`update listing_images set external_url = ${`${aktiv}/form-${former[i]}.png`} where id = ${e.billed_id}`
    }
    const c = await br.newContext({ viewport: { width: 1440, height: 1200 } })
    const p = await c.newPage()
    await p.goto(APP + '/', { waitUntil: 'networkidle' })
    const bk = p.getByRole('button', { name: 'Kun det nødvendige' })
    if (await bk.count()) { await bk.first().click(); await p.waitForTimeout(600) }
    console.log('\nBilledformater (600x900 stående · 1800x600 liggende)')
    for (const [navn, bredde] of [['smalt kort', 390], ['bredt kort', 1440]]) {
      await p.setViewportSize({ width: bredde, height: 1200 })
      await p.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
      await p.mouse.move(bredde - 2, 2)
      await p.waitForTimeout(400)
      const r = await p.evaluate((ider) => [...document.querySelectorAll('.liste a.kort')]
        .filter((k) => ider.includes(k.dataset.bolig))
        .map((k) => {
          const ram = k.querySelector('.kort-billede'); const img = ram?.querySelector('img')
          if (!img) return null
          return {
            id: k.dataset.bolig,
            ramme: `${ram.clientWidth}x${ram.clientHeight}`,
            billede: `${img.offsetWidth}x${img.offsetHeight}`,
            naturlig: `${img.naturalWidth}x${img.naturalHeight}`,
            fit: getComputedStyle(img).objectFit,
          }
        }).filter(Boolean), emner.map((e) => e.id))

      // 6 målinger per bredde: at begge boliger står der, og for hver
      // af dem at fotoet nåede browseren og fylder rammen — plus at
      // rammen har én form. Går én af dem tabt, siger `blok()` det.
      await blok(navn, 6, async () => {
        // PRØVEN SKAL KUNNE FEJLE PAA SIT EGET FRAVAER.
        // `for (const x of r)` kører nul gange, når `r` er tom — nul
        // påstande og en grøn rapport om noget, der aldrig blev målt. Det
        // er nøjagtig den fejl, valget af boliger allerede kostede én gang.
        // Antallet er derfor en påstand for sig, FØR løkken.
        // `r.length === emner.length` stod her først, og den er værdiløs:
        // er begge tomme, er den sand. Afprøvet ved at pege prøven på to
        // bolig-id'er, der ikke findes — påstanden meldte «0 af 0» og gik
        // grøn, og kun blok()-tællingen fangede det. To udtryk, der begge
        // kan falde bort på én gang, kan ikke holde hinanden i ørerne.
        // Tallet er derfor skrevet ud: der ER to prøveboliger.
        prøve(r.length === 2,
          `${navn}: begge prøveboliger står på siden`, `${r.length} af 2 fundet`)

        // Og at det swappede foto faktisk nåede browseren. Proxyen leverer
        // 400 px bredt, så formen aflæses på forholdet: 600x900 bliver
        // 400x600 (0,67) og 1800x600 bliver 400x133 (3,0). Rammer den 4/3
        // som de såede bolig-N.png, er opdateringen ikke slået igennem, og
        // prøven måler standardbilledet i stedet for det, den bad om.
        const FORVENTET = [{ navn: 'stående', f: 2 / 3 }, { navn: 'liggende', f: 3 }]
        for (const [i, x] of r.entries()) {
          const [nb, nh] = x.naturlig.split('x').map(Number)
          const f = FORVENTET[i]
          prøve(nh > 0 && Math.abs(nb / nh - f.f) < 0.1,
            `${navn}: ${f.navn} foto nåede browseren`, `${x.naturlig} → ${(nb / nh).toFixed(2)}, ventet ${f.f.toFixed(2)}`)
          prøve(x.ramme === x.billede && x.fit === 'cover',
            `${navn}: ${x.naturlig} fylder rammen ${x.ramme}`, `billede ${x.billede}, ${x.fit}`)
        }
        // Alle rammer på siden skal have SAMME form — det er hele pointen
        // med en ramme. Ét udfald, uanset hvad kilden leverede.
        const forhold = await p.evaluate(() => [...document.querySelectorAll('.liste .kort-billede')]
          .map((e) => Math.round((e.clientWidth / e.clientHeight) * 100) / 100))
        const unikke = [...new Set(forhold)].sort((a, b) => a - b)
        const spænd = unikke.length ? unikke[unikke.length - 1] - unikke[0] : 0
        prøve(spænd <= 0.02, `${navn}: rammen har ÉN form`,
          `${unikke.length} forhold, spænd ${spænd.toFixed(2)} — ${unikke.join(' · ')}`)
      })
      if (UD) await p.screenshot({ path: `${UD}/former-${bredde}.png`, fullPage: false })
    }
    await c.close()
  } finally {
    for (const f of før) await sql`update listing_images set external_url = ${f.url} where id = ${f.id}`
    const tilbage = await sql`
      select count(*)::int as n from listing_images where external_url like '%form-%'`
    console.log(`  · testdata gendannet (${tilbage[0].n} rækker peger stadig på form-*)`)
    await sql.end()
  }
}

// ── Indflytningsprisen og billedforbeholdet ─────────────────────
//  Ingen af delene findes i de såede data — `move_in_cost` og
//  `images_may_differ` er null på alle 264 rækker — så to af kortets
//  oplysninger stod utestede. De sættes her og skrives tilbage igen.
//
//  Begge er forbehold, ikke pynt: indflytningsprisen er det tal, der
//  afgør om boligen kan betales, og billedforbeholdet er kildens eget
//  «billederne kan være fra en anden bolig». Et layout, der taber dem
//  på en bredde, taber dem i tavshed.
if (process.env.DATABASE_URL) {
  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
  const c = await br.newContext({ viewport: { width: 1440, height: 1200 } })
  const p = await c.newPage()
  // Samtykkebanneret ligger over listen og ville staa hen over de kort,
  // skaermbillederne skal dokumentere.
  await p.goto(APP + '/', { waitUntil: 'networkidle' })
  const kn = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await kn.count()) { await kn.first().click(); await p.waitForTimeout(600) }
  await p.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
  const ider = await p.evaluate(() => [...document.querySelectorAll('.liste a.kort:not([data-gruppe])')]
    .filter((k) => k.querySelector('.kort-billede img')).slice(0, 2).map((k) => k.dataset.bolig))
  try {
    // 34.500 kr. i indflytning og kildens billedforbehold — på hver sit
    // kort, så de to kan ses hver for sig.
    await sql`update listings set move_in_cost = 3450000 where id = ${ider[0]}`
    await sql`update listings set images_may_differ = true where id = ${ider[1]}`
    console.log('\nIndflytningspris og billedforbehold')
    for (const bredde of BREDDER) {
      await p.setViewportSize({ width: bredde, height: 1200 })
      await p.goto(APP + '/?sted=Attrapby&kort=0', { waitUntil: 'networkidle' })
      await p.mouse.move(bredde - 2, 2)
      await p.waitForTimeout(400)
      const r = await p.evaluate((ids) => {
        const kort = (id) => document.querySelector(`.liste a.kort[data-bolig="${id}"]`)
        const a = kort(ids[0]), b = kort(ids[1])
        const ind = a?.querySelector('.kort-indflytning')
        const forb = b?.querySelector('.billedforbehold')
        const bil = b?.querySelector('.kort-billede')
        return {
          fundet: [a, b].filter(Boolean).length,
          indflytning: ind?.textContent?.trim() ?? null,
          indKlippet: ind ? ind.scrollWidth > ind.clientWidth + 1 : null,
          // Hierarkiet mellem sidens to beloeb. Maanedsprisen er det
          // store groenne tal; indflytningsprisen er det andet beloeb —
          // egen raekke, mindre vaegt. Maales, fordi begge er «et tal i
          // en prisblok», og den dag de faar samme stoerrelse, er der
          // ingen forskel at se for den, der skimmer.
          hierarki: (() => {
            const pris = a?.querySelector('.kort-pris')
            const bel = ind?.querySelector('b')
            if (!pris || !bel || !ind) return null
            const px = (e) => parseFloat(getComputedStyle(e).fontSize)
            // Prisblokkens egen stoerrelse staar paa dens foerste
            // tekstknude, ikke paa <small>-enheden ved siden af.
            return {
              maaned: Math.round(px(pris)),
              indflytning: Math.round(px(bel)),
              egenRaekke: Math.round(ind.getBoundingClientRect().top
                - pris.getBoundingClientRect().bottom),
            }
          })(),
          // Står den under fotoet, den handler om? Afstanden måles fra
          // billedets underkant, ikke fra kortets.
          forbehold: forb?.textContent?.trim() ?? null,
          afstand: forb && bil
            ? Math.round(forb.getBoundingClientRect().top - bil.getBoundingClientRect().bottom) : null,
          forbKlippet: forb ? forb.scrollWidth > forb.clientWidth + 1 : null,
          overløb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }, ider)
      await blok(`${bredde} px`, 6, async () => {
        // Samme værn som ovenfor, men her er det gratis: findes kortet
        // ikke, er `indflytning` null, og påstanden fejler af sig selv.
        // `fundet` gør grunden synlig i stedet for at lade den gætte.
        prøve(r.fundet === 2, `${bredde} px · begge prøveboliger står på siden`, `${r.fundet} af 2`)
        prøve(r.indflytning?.includes('34.500') && r.indKlippet === false,
          `${bredde} px · indflytningsprisen står og klippes ikke`, r.indflytning ?? 'mangler')
        prøve(r.hierarki != null && r.hierarki.indflytning < r.hierarki.maaned
          && r.hierarki.egenRaekke >= 0,
          `${bredde} px · månedsprisen vejer tungest, indflytningsprisen står under den`,
          r.hierarki
            ? `måned ${r.hierarki.maaned} px · indflytning ${r.hierarki.indflytning} px`
              + ` · ${r.hierarki.egenRaekke} px under prisblokken`
            : 'prisblok eller indflytningslinje mangler')
        prøve(r.forbehold?.includes('anden bolig') && r.forbKlippet === false,
          `${bredde} px · billedforbeholdet står og klippes ikke`, r.forbehold ?? 'mangler')
        prøve(r.afstand != null && r.afstand >= 0 && r.afstand <= 24,
          `${bredde} px · billedforbeholdet står ved sit foto`, `${r.afstand} px under billedet`)
        prøve(r.overløb === 0, `${bredde} px · intet vandret overløb`, `${r.overløb} px`)
      })
      if (UD && (bredde === 390 || bredde === 1440)) {
        for (const [navn, id] of [['indflytning', ider[0]], ['billedforbehold', ider[1]]]) {
          await p.locator(`[data-bolig="${id}"]`).first().screenshot({ path: `${UD}/${navn}-${bredde}.png` })
        }
      }
    }
  } finally {
    await sql`update listings set move_in_cost = null where id = ${ider[0]}`
    await sql`update listings set images_may_differ = false where id = ${ider[1]}`
    const [{ n }] = await sql`select count(*)::int as n from listings
      where move_in_cost is not null or images_may_differ`
    console.log(`  · testdata gendannet (${n} rækker har stadig indflytning eller forbehold)`)
    await sql.end()
  }
  await c.close()
}

await br.close()
console.log(fejl === 0 ? `\n✓ alle ${kørte} kontroller bestået` : `\n✗ ${fejl} af ${kørte} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
