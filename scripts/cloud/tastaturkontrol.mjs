// ═══════════════════════════════════════════════════════════════
//  Tastaturkontrollen: kan siden betjenes uden mus — og ved 200 % zoom?
//
//      DATABASE_URL=<testbasen> node scripts/cloud/tastaturkontrol.mjs [udmappe]
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  En gennemgang med tastatur og zoom fandt seks ting. Prøven her er
//  skrevet MOD den kode, fundene blev målt på, og den var rød på alle
//  seks, før noget blev rettet (91 røde linjer over fire scenarier):
//
//    ✗ kortmærkerne var 44 tabulatorstop, som Enter ikke kunne aktivere
//      (Leaflet saetter tabIndex og role=button, men binder kun Enter
//      gennem en popup — er der ingen popup, sker der ingenting)
//    ✗ gruppemærkernes tilgængelige navn var et bart tal: «3», «5»
//    ✗ sorteringsmenuen kunne åbnes, men hverken Escape, Tab væk eller
//      et klik udenfor lukkede den — den blev stående oven på indholdet
//    ✗ svaret på en gemt søgning stod 7.921 px nede, uden fokus og uden
//      beskedsemantik; formularen var væk, så en fejl ikke kunne rettes
//    ✗ gem-felterne havde kun en placeholder som ledetekst — den
//      forsvandt ved første tastetryk
//    ✗ samtykkebanneret lå sidst i tabulatorrækkefølgen (106 tryk) og
//      lukkede ikke på Escape
//    ✗ kortets zoomknapper hed «Zoom in» og «Zoom out»
//
//  ── HVAD DEN IKKE MÅ VÆRE ────────────────────────────────────
//  En prøve, der ikke kan blive rød, tæller ikke med. Derfor:
//
//    · ingen tavse spring. Rammer en selektor ingenting, skrives der
//      `tjek(false, …)` — ikke `if (findes) { … }`.
//    · `checkVisibility()` alene er IKKE «synlig». Den er sand for
//      `opacity: 0`, for `left: -9999px` og for skærmlæser-klippet.
//      Efterprøvet i den samme Chromium. Derfor spørger `iSyne()` også
//      `elementFromPoint`, hvad der FAKTISK ligger øverst.
//    · `[].every(…)` er sand. Antallet efterprøves før indholdet.
//    · et antal, der ikke ændrer sig af fejlen, måler ikke fejlen.
//      «Tegnes mærkerne om?» måles derfor på ELEMENTETS identitet, ikke
//      på hvor mange der er.
//
//  ── OM «200 % ZOOM» ──────────────────────────────────────────
//  Chromiums EGEN zoom (Ctrl +) bor i browserens ramme, ikke i siden.
//  Tre veje er PRØVET her, og de to første er ikke zoom:
//
//    --force-device-scale-factor=2 --window-size=1280,800
//        → innerWidth 1280, devicePixelRatio 2
//        Vinduet maales i DIP, saa layoutet er uaendret. Kun
//        rasterdensiteten skifter. Det er ikke zoom.
//    CDP Emulation.setPageScaleFactor(2)
//        → innerWidth 1280, devicePixelRatio 1
//        Det er knibezoom (pinch). Der ombrydes ingenting.
//    CDP Emulation.setDeviceMetricsOverride(640×400, dsf 2)
//        → innerWidth 640, devicePixelRatio 2
//        Det er praecis de to ting, browserzoom aendrer for en side, og
//        det er det, Playwrights `viewport` + `deviceScaleFactor` goer.
//
//  Scenariet herunder er altsaa den tredje, og det hedder det, det er:
//  EMULERET 200 % browserzoom — halveret layout-viewport (640×400
//  CSS-px) og devicePixelRatio 2. Ikke «200 % browserzoom».
//
//  Den ene maalbare forskel fra rigtig zoom er `screen.width`, som
//  bliver 640 her og ville staa paa 1280 ved rigtig zoom. Ingen af
//  vores regler laeser `screen`; kun `innerWidth` (gennem
//  medieforespoergsler og `@container`) og densiteten. Alle tre
//  vaerdier efterproeves i den fane, der maales i.
//
//  ── AFSENDELSE ───────────────────────────────────────────────
//  Formularprøven indsender rigtigt, men mailen er SIMULERET: appen
//  køres uden RESEND_API_KEY, så `maaSendeTil` lukker af, før der laves
//  noget netværkskald overhovedet. Beviset er udfaldet, og det skal
//  være `spaerret` PRÆCIS — `ugyldig-mail`, `for-mange` og
//  `for-hurtigt` vender tilbage FØR `sendMail` og beviser ingenting.
//  Adressen er ny for hver kørsel, så en efterladt række fra en tidligere
//  kørsel ikke kan gøre udfaldet til `for-hurtigt`. Oprydningen står i
//  `finally`.
//
//  Exit: 0 = alt groent · 1 = noget fejlede · 2 = intet at maale paa
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const VAERT = new URL(BASE).hostname
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
if (!process.env.DATABASE_URL) {
  console.error('FEJL: DATABASE_URL mangler — proeven kan ikke vaelge data eller rydde op.')
  process.exit(2)
}

const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
// Byen skal have MANGE maerker, ellers maaler «kortet kan springes over»
// ingenting: med tre maerker er 44 stop og 3 stop lige gode.
const [by] = await sql`
  select city as navn, count(*)::int as n from listings
  where status = 'active' and city is not null and lat is not null
  group by 1 order by 2 desc limit 1`
const [bolig] = await sql`
  select id from listings where status = 'active' and lat is not null limit 1`
if (!by || by.n < 20) {
  console.error(`FEJL: ingen by med mindst 20 placerede boliger (bedste: ${by?.navn ?? 'ingen'} ${by?.n ?? 0}).`)
  await sql.end(); process.exit(2)
}
const STED = encodeURIComponent(by.navn)
console.log(`maaler paa «${by.navn}» — ${by.n} placerede boliger\n`)

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

const SCENARIER = [
  { navn: 'desktop 1440', w: 1440, h: 900, dpr: 1 },
  { navn: 'tablet 768', w: 768, h: 1024, dpr: 1 },
  { navn: 'mobil 390', w: 390, h: 844, dpr: 1 },
  { navn: 'emuleret 200 % zoom (640×400 @ dpr 2)', w: 640, h: 400, dpr: 2 },
]

/**
 * «Kan man SE det?» — ikke «er det tegnet?».
 *
 * `checkVisibility()` svarer kun paa display og content-visibility.
 * Efterproevet i den her Chromium: den er sand for `opacity: 0`, for
 * `position:absolute; left:-9999px` og for skaermlaeser-klippet
 * (`width:1px;height:1px;clip-path:inset(50%)`). Derfor ogsaa
 * `elementFromPoint` paa midten: ligger noget andet oeverst — bjaelken,
 * kortets fliser, en dialogs backdrop — er svaret nej.
 */
const I_SYNE = `(el) => {
  if (!el || !el.checkVisibility()) return false
  const cs = getComputedStyle(el)
  if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.1) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
  // pointer-events:none er rigtigt for en tekst, der ligger oven paa
  // kortet — men saa svarer traefproeven det, der ligger UNDER. Den
  // slaas fra i det ene oejeblik, maalingen tager, og saettes tilbage.
  const gemt = el.style.pointerEvents
  el.style.pointerEvents = 'auto'
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
  const o = document.elementFromPoint(x, y)
  el.style.pointerEvents = gemt
  return !!o && (o === el || el.contains(o) || o.contains(el))
}`

/**
 * «Kan den ses, naar man ruller derhen?» — for ting, der ikke
 * noedvendigvis er i billedet lige nu: en ledetekst over et felt langt
 * nede paa siden.
 *
 * Den maaler det, checkVisibility() ikke gider — gennemsigtighed,
 * visibility, stoerrelse og skaermlaeser-klippet — ruller derefter
 * elementet frem og spoerger, hvad der ligger oeverst. Uden den sidste
 * del ville en ledetekst bag den klaebende bjaelke staa groen.
 */
const KAN_SES = `(el) => {
  if (!el || !el.checkVisibility()) return false
  const cs = getComputedStyle(el)
  if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.1) return false
  if (cs.clipPath && cs.clipPath !== 'none') return false
  const r0 = el.getBoundingClientRect()
  if (r0.width < 8 || r0.height < 8) return false
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
  const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
  const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)
  const o = document.elementFromPoint(x, y)
  return !!o && (o === el || el.contains(o) || o.contains(el))
}`

/** Ny fane. `samtykke: false` lader banneret staa. */
async function aabn(s, sti, { samtykke = true } = {}) {
  const c = await br.newContext({
    viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr,
  })
  // Valget saettes som COOKIE og ikke ved at klikke: knappen genindlaeser
  // siden, og en goto oven i den genindlaesning giver ERR_ABORTED i ny og
  // uae. Cookien er den samme, knappen saetter — `nej`, altsaa ingen
  // maaling — og den er ikke HttpOnly netop for at kunne laeses i browseren.
  // Vaerten kommer fra BASE: en cookie for et andet domaene end sidens
  // sendes aldrig, og saa ville hvert scenarie blive maalt med banneret
  // fremme, uden at nogen fik det at vide.
  if (samtykke) {
    await c.addCookies([{ name: 'bofinda_samtykke', value: 'nej', domain: VAERT, path: '/' }])
  }
  const p = await c.newPage()
  const maalinger = []
  p.on('request', (r) => { if (r.url().includes('/api/maaling')) maalinger.push(r.url()) })
  await p.goto(BASE + sti, { waitUntil: 'networkidle' })
  await p.waitForTimeout(350)
  return { c, p, maalinger }
}

/** Det tilgaengelige navn, regnet som browseren gør det for vores tilfaelde. */
const NAVN = `(e) => (e.getAttribute('aria-label')
  || (e.textContent || '').trim().replace(/\\s+/g, ' ')
  || e.getAttribute('title') || '').slice(0, 60)`

for (const s of SCENARIER) {
  console.log(`\n═══ ${s.navn} ═══`)

  // ── 1 · KORTET ────────────────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}&kort=1`)
    await p.waitForTimeout(1800)

    // Scenariet skal vaere det, det hedder — maalt i DEN fane, der
    // maales i, ikke i en engangsfane ved siden af.
    const sc = await p.evaluate(() => ({
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio, skaerm: screen.width,
    }))
    tjek(sc.w === s.w && sc.h === s.h && sc.dpr === s.dpr,
      'scenariet er sat, som det hedder',
      `${sc.w}×${sc.h} CSS-px, devicePixelRatio ${sc.dpr}, screen.width ${sc.skaerm}`)
    if (s.dpr === 2) {
      tjek(sc.skaerm === s.w,
        'zoom · `screen.width` foelger emuleringen — den ENE forskel fra rigtig zoom',
        `${sc.skaerm} (rigtig 200 % zoom ville vise 1280)`)
    }

    const maerker = await p.locator('.leaflet-marker-icon').count()
    if (!maerker) {
      tjek(false, 'kort · der er maerker at maale paa', 'ingen maerker tegnet')
    } else {
      // 1a · navnene
      const navne = await p.$$eval('.leaflet-marker-icon',
        (els, f) => els.map(new Function('e', `return (${f})(e)`)), NAVN)
      const bare = navne.filter((n) => /^\d+$/.test(n.trim()))
      tjek(bare.length === 0, 'kort · intet maerke hedder kun et tal',
        bare.length ? `${bare.length} af ${navne.length}: ${JSON.stringify(bare.slice(0, 3))}` : `${navne.length} maerker`)
      // Positivt, ikke negativt: et navn skal indeholde bogstaver og et
      // postnummer eller et antal — «afvis tre engelske forstavelser»
      // lod «3 homes» slippe igennem.
      const daarlige = navne.filter((n) => !/\p{L}/u.test(n) || n.trim().length < 4)
      tjek(daarlige.length === 0, 'kort · hvert maerke har et navn med ord i',
        daarlige.length ? JSON.stringify(daarlige.slice(0, 3)) : navne[0])
      // Gruppemaerkerne: dem MED en tekstboble skal sige «N boliger».
      const gruppeNavne = await p.$$eval('.leaflet-marker-icon', (els) => els
        .filter((e) => /^\d+$/.test((e.querySelector('.maerke-boble')?.textContent || '').trim()))
        .map((e) => e.getAttribute('aria-label') || ''))
      tjek(gruppeNavne.length > 0, 'kort · datasaettet har gruppemaerker at maale paa',
        `${gruppeNavne.length} gruppebobler`)
      tjek(gruppeNavne.length > 0 && gruppeNavne.every((n) => /\d+\s*boliger/i.test(n)),
        'kort · hvert gruppemaerke siger, hvor mange boliger det daekker',
        JSON.stringify(gruppeNavne.slice(0, 2)))
      // Navnet og musens tooltip er ÉN streng, ikke to der holdes ens.
      const ensNavne = await p.$$eval('.leaflet-marker-icon',
        (els) => els.every((e) => e.getAttribute('title') === e.getAttribute('aria-label')))
      tjek(ensNavne, 'kort · `title` og `aria-label` er den samme streng')
      // Og navnet lover ikke en handling, layoutet kan tage tilbage.
      tjek(navne.every((n) => !/vis (dem|boligen|den) i listen/i.test(n)),
        'kort · navnet lover ikke noget, det ikke altid kan holde')

      // 1b · zoomknapperne
      const zoom = await p.$$eval('.leaflet-control-zoom a',
        (els, f) => els.map(new Function('e', `return (${f})(e)`)), NAVN)
      tjek(zoom.length === 2 && zoom.includes('Zoom ind') && zoom.includes('Zoom ud'),
        'kort · zoomknapperne har danske navne', JSON.stringify(zoom))

      // 1c · kan kortet forlades uden at gennemloebe alle maerker?
      const foersteIKortet = await p.evaluate(() => {
        const f = document.querySelector('.kortspalte a, .kortspalte button, .kortspalte [tabindex]')
        if (!f) return false
        f.focus(); return true
      })
      if (!foersteIKortet) {
        tjek(false, 'kort · der er noget fokuserbart i kortspalten')
      } else {
        let n = 0
        for (let i = 0; i < 80; i++) {
          const inde = await p.evaluate(() => !!document.activeElement?.closest?.('.kortspalte'))
          if (!inde) break
          n++
          await p.keyboard.press('Tab')
        }
        tjek(n > 0 && n <= 8,
          'kort · kortet kan forlades uden at gennemloebe hvert maerke',
          `${n} tabulatorstop i kortspalten ved ${maerker} maerker`)
      }

      // 1c2 · springlinket
      const harSpring = await p.locator('.springkort').count()
      tjek(harSpring === 1, 'kort · der er ét springlink over kortet', String(harSpring))
      if (harSpring) {
        const spring = await p.evaluate((f) => {
          const a = document.querySelector('.springkort')
          a.focus()
          const synlig = new Function('el', `return (${f})(el)`)(a)
          a.click()
          return { synlig, maal: a.getAttribute('href') }
        }, I_SYNE)
        await p.waitForTimeout(250)
        tjek(spring.synlig, 'kort · springlinket kan SES, naar det har fokus')
        const efter = await p.evaluate(() => ({
          id: document.activeElement?.id ?? '',
          rolle: document.activeElement?.getAttribute('role'),
          navn: document.activeElement?.getAttribute('aria-label'),
          iKortet: !!document.activeElement?.closest?.('.kortspalte'),
        }))
        tjek(efter.id === 'efter-kortet' && !efter.iKortet,
          'kort · springlinket flytter fokus forbi kortet', `fokus paa «${efter.id}»`)
        tjek(!!efter.navn && efter.rolle === 'group',
          'kort · springets maal har et navn, en skaermlaeser kan laese op',
          `role=${efter.rolle} navn=«${efter.navn}»`)
      }

      // 1c2b · og kortets kontroller er der stadig, naar siden er RULLET
      await p.evaluate(() => window.scrollTo(0, 600))
      await p.waitForTimeout(350)
      const SELS = ['.springkort', '.leaflet-control-zoom-in', '.leaflet-control-zoom-out']
      const bag = await p.evaluate(({ sels, f }) => sels.map((sel) => {
        const e = document.querySelector(sel)
        if (!e) return { sel, findes: false, fri: false, oeverst: 'findes ikke' }
        e.focus()
        const r = e.getBoundingClientRect()
        const o = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return {
          sel, findes: true, fri: new Function('el', `return (${f})(el)`)(e),
          oeverst: o ? (o.className?.toString?.().slice(0, 24) || o.tagName) : 'intet',
        }
      }), { sels: SELS, f: I_SYNE })
      tjek(bag.length === SELS.length && bag.every((x) => x.findes && x.fri),
        'kort · kortets kontroller ligger ikke bag bjaelken, naar siden er rullet',
        bag.map((x) => `${x.sel}: ${x.oeverst}`).join(' · '))
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.waitForTimeout(250)

      // 1c3 · hjaelpelinjen: bundet til maerket OG synlig ved fokus
      const hjaelp = await p.evaluate((f) => {
        const m = document.querySelector('.leaflet-marker-icon')
        m.focus()
        const id = m.getAttribute('aria-describedby')
        const h = id ? document.getElementById(id) : null
        return {
          id, findes: !!h,
          synlig: h ? new Function('el', `return (${f})(el)`)(h) : false,
          tekst: (h?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
        }
      }, I_SYNE)
      tjek(hjaelp.findes && /piletast/i.test(hjaelp.tekst),
        'kort · maerket peger paa en linje, der siger, hvordan man naar de andre',
        `«${hjaelp.tekst}»`)
      tjek(hjaelp.synlig, 'kort · den linje kan ogsaa SES, naar fokus er i kortet')

      // 1c4 · piletasterne flytter mellem maerkerne
      const pil = await (async () => {
        await p.locator('.leaflet-marker-icon').first().focus()
        const a = await p.evaluate(() => document.activeElement?.dataset?.maerke ?? null)
        await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
        const b2 = await p.evaluate(() => ({
          id: document.activeElement?.dataset?.maerke ?? null,
          tab: document.activeElement?.tabIndex,
        }))
        return { a, b2 }
      })()
      tjek(pil.a != null && pil.b2.id != null && pil.a !== pil.b2.id && pil.b2.tab === 0,
        'kort · piletast flytter til naeste maerke',
        `${pil.a} → ${pil.b2.id} (tabIndex ${pil.b2.tab})`)

      // 1d · en opdatering af valget maa ikke rive det fokuserede maerke ned
      //
      // Det er DEN vej, gentegningen kunne udloeses uden en navigation:
      // `valgt` laa i afhaengighedslisten, og listens `mouseover` saetter
      // `valgt`. Maalt paa elementets IDENTITET — et antal er det samme
      // foer og efter en gentegning og maaler derfor ingenting.
      const overlever = await p.evaluate(() => {
        const m = document.querySelector('.leaflet-marker-icon')
        m.focus()
        m.dataset.proeve = 'foer'
        const kort = document.querySelector('a.kort[data-bolig]')
        if (!kort) return { muligt: false }
        kort.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        return { muligt: true }
      })
      await p.waitForTimeout(600)
      const efterOpdatering = await p.evaluate(() => {
        const m = document.querySelector('.leaflet-marker-icon[data-proeve="foer"]')
        return {
          samme: !!m && m.isConnected,
          harFokus: !!m && document.activeElement === m,
        }
      })
      if (!overlever.muligt) {
        tjek(false, 'kort · der er et boligkort at udloese en opdatering med')
      } else {
        tjek(efterOpdatering.samme,
          'kort · en opdatering af valget tegner ikke maerket forfra',
          efterOpdatering.samme ? 'samme element' : 'elementet blev erstattet')
        tjek(efterOpdatering.harFokus,
          'kort · og fokus bliver staaende paa det maerke, der havde det')
      }

      // 1e · Enter og Mellemrum gør det samme som et klik
      const tilstand = `() => ({
        fremhaevet: [...document.querySelectorAll('.fremhaevet')].map((e) => e.id).sort(),
        valgt: document.querySelector('.maerke-boble.valgt')
          ?.closest('.leaflet-marker-icon')?.getAttribute('data-maerke') ?? null,
      })`
      const virkning = async (maade) => {
        const { c: c2, p: p2 } = await aabn(s, `/?sted=${STED}&kort=1`)
        await p2.waitForTimeout(1800)
        const m = p2.locator('.leaflet-marker-icon').nth(1)
        const foer = await p2.evaluate(new Function(`return (${tilstand})()`))
        if (maade === 'klik') await m.click()
        else { await m.focus(); await p2.keyboard.press(maade) }
        await p2.waitForTimeout(900)
        const efter = await p2.evaluate(new Function(`return (${tilstand})()`))
        const f2 = await p2.evaluate(() => ({
          tag: document.activeElement?.tagName ?? 'INGEN',
          haenger: !!document.activeElement?.isConnected && document.activeElement !== document.body,
          paaBoligkort: !!document.activeElement?.matches?.('a.kort[data-bolig]'),
          // `checkVisibility()` og ikke bare `querySelector`: kortene
          // STAAR i markuppen under 900 px, de er bare `display: none`.
          // Et element, der ikke tegnes, kan ikke faa fokus.
          listeSynlig: [...document.querySelectorAll('a.kort[data-bolig]')]
            .some((e) => e.checkVisibility()),
        }))
        await c2.close()
        return { foer, efter, ...f2 }
      }
      const klik = await virkning('klik')
      const enter = await virkning('Enter')
      const mellem = await virkning('Space')
      const ens = (a, b) => JSON.stringify(a.efter.fremhaevet) === JSON.stringify(b.efter.fremhaevet)
        && a.efter.valgt === b.efter.valgt
      tjek(klik.efter.valgt != null, 'kort · et klik vaelger boligen',
        JSON.stringify(klik.efter))
      tjek(ens(enter, klik), 'kort · Enter goer det samme som et klik',
        `Enter: ${JSON.stringify(enter.efter)} · klik: ${JSON.stringify(klik.efter)}`)
      tjek(ens(mellem, klik), 'kort · Mellemrum goer det samme som et klik',
        `Mellemrum: ${JSON.stringify(mellem.efter)}`)
      tjek(enter.listeSynlig ? enter.paaBoligkort : (enter.fokus !== 'BODY' && enter.haenger),
        enter.listeSynlig
          ? 'kort · Enter giver fokus til boligkortet i listen'
          : 'kort · Enter beholder fokus paa maerket, naar listen ikke er fremme',
        `fokus paa ${enter.tag}, liste fremme: ${enter.listeSynlig}`)
    }
    if (UD) await p.screenshot({ path: `${UD}/kort-${s.w}.png` })
    await c.close()
  }

  // ── 2 · SORTERINGSMENUEN ──────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}`)
    const sum = p.locator('details.sortering > summary')
    if (!(await sum.count())) {
      tjek(false, 'sortering · menuen findes', 'ingen details.sortering')
    } else {
      const aabenNu = () => p.evaluate(() => !!document.querySelector('details.sortering[open]'))
      const fokusNu = () => p.evaluate(() =>
        document.activeElement?.tagName === 'SUMMARY' ? 'summary'
          : document.activeElement?.closest?.('details.sortering') ? 'inde i menuen'
            : (document.activeElement?.tagName ?? 'ingen'))
      // Hver deltest begynder fra LUKKET. Uden nulstillingen aabner det
      // naeste Enter ikke menuen — det lukker den, fordi <summary> er en
      // vippe — og saa melder «lukkede den?» groent uden at have maalt
      // noget. Den fejl stod i proeven foerst; den er rettet her.
      const nulstil = async () => {
        await p.evaluate(() => {
          const d = document.querySelector('details.sortering')
          if (d) d.open = false
        })
        await p.waitForTimeout(120)
      }
      const aabnMenu = async () => {
        await nulstil()
        await sum.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
        return aabenNu()
      }

      tjek(await aabnMenu(), 'sortering · Enter aabner menuen')

      await p.keyboard.press('Escape'); await p.waitForTimeout(250)
      tjek(!(await aabenNu()), 'sortering · Escape lukker menuen')
      tjek((await fokusNu()) === 'summary', 'sortering · Escape giver fokus tilbage til udloeseren',
        `fokus: ${await fokusNu()}`)

      tjek(await aabnMenu(), 'sortering · menuen er aaben foer klikket udenfor')
      await p.mouse.click(8, Math.round(s.h / 2)); await p.waitForTimeout(300)
      tjek(!(await aabenNu()), 'sortering · et klik udenfor lukker menuen')
      tjek((await fokusNu()) !== 'summary', 'sortering · et klik udenfor traekker ikke fokus tilbage',
        `fokus: ${await fokusNu()}`)

      tjek(await aabnMenu(), 'sortering · menuen er aaben foer Tab ud')
      for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); await p.waitForTimeout(40) }
      tjek(!(await aabenNu()), 'sortering · menuen lukker, naar fokus forlader den')
      tjek((await fokusNu()) !== 'summary', 'sortering · Tab ud traekker ikke fokus tilbage',
        `fokus: ${await fokusNu()}`)

      await aabnMenu()
      const valg = p.locator('.sortering-valg a').nth(1)
      const navn = (await valg.textContent())?.trim()
      await valg.click({ timeout: 8000 }).catch(() => {})
      await p.waitForTimeout(700)
      tjek(/[?&]sorter=/.test(p.url()), `sortering · valget «${navn}» virker stadig`,
        p.url().split('?')[1] ?? '')
    }
    await c.close()
  }

  // ── 3 · GEM SOEGNING ──────────────────────────────────────────
  {
    const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2`)
    const antalFelter = await p.locator('form.gem input[name="navn"], form.gem input[name="mail"]').count()
    tjek(antalFelter === 2, 'gem · begge felter findes', String(antalFelter))
    if (antalFelter === 2) {
      const felter = await p.evaluate((f) =>
        [...document.querySelectorAll('form.gem input[name="navn"], form.gem input[name="mail"]')]
          .map((i) => {
            const lab = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null
            const om = i.closest('label')
            const l = lab || om
            return {
              navn: i.name, id: i.id || null, koblet: !!l,
              // «Synlig» maales som synlig — ikke som «findes i DOM'en».
              // `checkVisibility()` alene ville melde groent paa en
              // skaermlaeser-kun-ledetekst.
              synlig: !!l && new Function('el', `return (${f})(el)`)(l)
                && (l.textContent || '').trim().length > 1,
              tekst: (l?.textContent || '').trim().slice(0, 40),
            }
          }), KAN_SES)
      tjek(felter.length === 2 && felter.every((x) => x.koblet && x.synlig),
        'gem · begge felter har en synlig ledetekst koblet til feltet', JSON.stringify(felter))
      await p.fill('form.gem input[name="mail"]', 'abc')
      const bliver = await p.evaluate((f) =>
        [...document.querySelectorAll('form.gem input[name="navn"], form.gem input[name="mail"]')]
          .every((i) => {
            const l = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : i.closest('label')
            return !!l && new Function('el', `return (${f})(el)`)(l)
          }), KAN_SES)
      tjek(bliver, 'gem · ledeteksten bliver staaende, naar der tastes')
      if (UD) await p.locator('form.gem').screenshot({ path: `${UD}/gem-${s.w}.png` }).catch(() => {})
    }
    await c.close()
  }

  // Svaret: fejl og kvittering. Laeses af URL'en — intet indsendes her.
  for (const [slags, rolle] of [['ugyldig-mail', 'alert'], ['sendt', 'status']]) {
    const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2&gemt=${slags}`)
    await p.waitForTimeout(700)
    const m = await p.evaluate((f) => {
      const e = document.querySelector('.gem-svar')
      if (!e) return null
      return {
        rolle: e.getAttribute('role'), live: e.getAttribute('aria-live'),
        iSyne: new Function('el', `return (${f})(el)`)(e),
        harFokus: document.activeElement === e || e.contains(document.activeElement),
        formular: !!document.querySelector('form.gem'),
        filtre: document.querySelector('form.gem input[name="filtre"]')?.value ?? null,
      }
    }, I_SYNE)
    if (!m) { tjek(false, `gem · svaret «${slags}» vises`); await c.close(); continue }
    tjek(m.iSyne, `gem · «${slags}» kan SES ved indlaesning`)
    tjek(m.harFokus, `gem · fokus staar paa «${slags}»`)
    // Den RIGTIGE rolle, ikke «en eller anden». `aria-live="off"` ville
    // ellers kunne baere linjen igennem.
    tjek(m.rolle === rolle, `gem · «${slags}» har rollen «${rolle}»`,
      `role=${m.rolle} aria-live=${m.live}`)
    if (slags === 'ugyldig-mail') {
      tjek(m.formular, 'gem · formularen kan stadig bruges efter en fejl')
      tjek(!!m.filtre && m.filtre.includes('vaerelser'),
        'gem · filtrene er bevaret efter en fejl', String(m.filtre).slice(0, 60))
      tjek(/vaerelser=2/.test(p.url()), 'gem · filtrene staar stadig i adressen')
    }
    if (UD) await p.screenshot({ path: `${UD}/gem-${slags}-${s.w}.png` })
    await c.close()
  }

  // ── 4 · SAMTYKKEBANNERET ──────────────────────────────────────
  {
    const { c, p, maalinger } = await aabn(s, `/?sted=${STED}`, { samtykke: false })
    await p.waitForTimeout(1200)
    if (!(await p.locator('.samtykke').count())) {
      tjek(false, 'samtykke · banneret vises')
    } else {
      await p.evaluate(() => document.body.focus())
      let n = -1
      for (let i = 1; i <= 40; i++) {
        await p.keyboard.press('Tab')
        if (await p.evaluate(() => !!document.activeElement?.closest?.('.samtykke'))) { n = i; break }
      }
      tjek(n > 0 && n <= 5, 'samtykke · banneret naas inden for 5 tabulaturtryk forfra',
        n < 0 ? 'ikke naaet paa 40' : `${n} tryk`)
      const knapper = await p.$$eval('.samtykke-knapper button', (els) => els.map((b) => {
        const cs = getComputedStyle(b); const r = b.getBoundingClientRect()
        return { h: Math.round(r.height), vaegt: cs.fontWeight, str: cs.fontSize, farve: cs.color, bag: cs.backgroundColor }
      }))
      tjek(knapper.length === 2 && knapper[0].vaegt === knapper[1].vaegt
        && knapper[0].str === knapper[1].str && knapper[0].farve === knapper[1].farve
        && knapper[0].bag === knapper[1].bag && Math.abs(knapper[0].h - knapper[1].h) <= 1,
      'samtykke · de to valg er lige tydelige', JSON.stringify(knapper))
      // Escape MED fokus inde i boksen: den skal lukke, og fokus skal et
      // defineret sted hen — ikke til <body>, hvor naeste Tab begynder
      // forfra i toppen af dokumentet.
      await p.evaluate(() => document.querySelector('.samtykke button')?.focus())
      await p.keyboard.press('Escape'); await p.waitForTimeout(500)
      const vaek = (await p.locator('.samtykke').count()) === 0
      tjek(vaek, 'samtykke · Escape lukker banneret')
      const efterEsc = await p.evaluate(() => ({
        tag: document.activeElement?.tagName ?? 'INGEN',
        navn: (document.activeElement?.textContent || '').trim().slice(0, 20),
      }))
      tjek(efterEsc.tag !== 'BODY' && efterEsc.tag !== 'INGEN',
        'samtykke · fokus falder ikke til <body>, naar boksen lukkes',
        `fokus paa ${efterEsc.tag} «${efterEsc.navn}»`)
      const kager = (await p.context().cookies()).map((k) => k.name)
      tjek(!kager.includes('bofinda_samtykke'), 'samtykke · lukning uden valg saetter ingen samtykkecookie',
        JSON.stringify(kager))
      tjek(!kager.includes('bofinda_aid') && !kager.includes('bofinda_sid'),
        'samtykke · lukning uden valg saetter ingen identifikator')
      await p.waitForTimeout(400)
      tjek(maalinger.length === 0, 'samtykke · lukning uden valg sender ingen maaling',
        `${maalinger.length} kald til /api/maaling`)
      await p.goto(BASE + `/?sted=${STED}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(900)
      tjek((await p.locator('.samtykke').count()) > 0, 'samtykke · banneret kommer igen naeste besoeg')
    }
    if (UD) await p.screenshot({ path: `${UD}/samtykke-${s.w}.png` })
    await c.close()
  }

  // Escape maa ikke tages fra et aabent panel. Mangler panelet, er det en
  // FEJL i proeven — ikke noget, der bare springes over.
  {
    const { c, p } = await aabn(s, `/?sted=${STED}`, { samtykke: false })
    await p.waitForTimeout(900)
    const f = p.getByRole('link', { name: /^Filtre/ }).first()
    if (!(await f.count())) {
      tjek(false, 'samtykke · filterknappen findes, saa konflikten kan maales')
    } else {
      await f.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(800)
      tjek(await p.evaluate(() => !!document.querySelector('dialog[open]')),
        'samtykke · filtervinduet er aabent foer Escape')
      await p.keyboard.press('Escape'); await p.waitForTimeout(500)
      const dialogAaben = await p.evaluate(() => !!document.querySelector('dialog[open]'))
      const bannerTilbage = (await p.locator('.samtykke').count()) > 0
      tjek(!dialogAaben && bannerTilbage,
        'samtykke · Escape lukker filtervinduet og IKKE banneret',
        `dialog aaben: ${dialogAaben} · banner tilbage: ${bannerTilbage}`)
    }
    const sum = p.locator('details.sortering > summary')
    if (!(await sum.count())) {
      tjek(false, 'samtykke · sorteringsmenuen findes, saa konflikten kan maales')
    } else {
      await p.evaluate(() => {
        const d = document.querySelector('details.sortering')
        if (d) d.open = false
      })
      await sum.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
      tjek(await p.evaluate(() => !!document.querySelector('details.sortering[open]')),
        'samtykke · sorteringsmenuen er aaben foer Escape')
      await p.keyboard.press('Escape'); await p.waitForTimeout(400)
      const menuAaben = await p.evaluate(() => !!document.querySelector('details.sortering[open]'))
      const bannerTilbage = (await p.locator('.samtykke').count()) > 0
      tjek(!menuAaben && bannerTilbage,
        'samtykke · Escape lukker sorteringsmenuen og IKKE banneret',
        `menu aaben: ${menuAaben} · banner tilbage: ${bannerTilbage}`)
    }
    await c.close()
  }
}

// ── 5 · BOLIGSIDENS KORT: ingen knap uden en handling ───────────
console.log('\n═══ boligsidens kort ═══')
if (!bolig) {
  tjek(false, 'boligside · der er en bolig med koordinater at maale paa')
} else {
  const { c, p } = await aabn(SCENARIER[0], `/bolig/${bolig.id}`)
  await p.evaluate(() => document.querySelector('#beliggenhed')?.scrollIntoView())
  await p.waitForTimeout(2500)
  const m = await p.evaluate(() => {
    const e = document.querySelector('.leaflet-marker-icon')
    if (!e) return null
    return {
      rolle: e.getAttribute('role'), tab: e.tabIndex,
      navn: e.getAttribute('aria-label'),
      hjaelp: !!document.querySelector('.korthjaelp'),
    }
  })
  if (!m) tjek(false, 'boligside · kortet har et maerke')
  else {
    // Her er der ingen liste at pege paa. Et tabulatorstop med
    // `role="button"`, hvor Enter intet goer, er praecis den fejl, hele
    // aendringen handler om — saa maerket maa ikke vaere en knap.
    tjek(m.rolle == null && m.tab !== 0,
      'boligside · maerket er ikke en knap, for der er ingen liste at vise noget i',
      `role=${m.rolle} tabIndex=${m.tab}`)
    tjek(!!m.navn && !/vis (den|boligen) i listen/i.test(m.navn),
      'boligside · maerket lover ikke en liste, der ikke findes', `«${m.navn}»`)
    tjek(!m.hjaelp, 'boligside · der staar ingen piletast-hjaelp, hvor der intet er at flytte mellem')
  }
  await c.close()
}

// ── 6 · INDSENDELSE MED SIMULERET MAIL ──────────────────────────
console.log('\n═══ indsendelse med simuleret mailafsendelse ═══')
{
  // Ny adresse for hver koersel. Ellers kan en raekke fra en tidligere
  // koersel goere udfaldet til `for-hurtigt` — og saa maaler proeven
  // ratebegraensningen i stedet for mailspaerringen.
  const MAIL = `tastaturproeve-${Date.now()}@eksempel.invalid`
  const NAVN = 'Proevens eget navn paa soegningen'
  const [{ n: foer }] = await sql`select count(*)::int n from saved_searches`
  const s = SCENARIER[0]
  const { c, p } = await aabn(s, `/?sted=${STED}&vaerelser=2`)
  try {
    await p.fill('form.gem input[name="navn"]', NAVN)
    await p.fill('form.gem input[name="mail"]', MAIL)
    await p.locator('form.gem button[type="submit"]').click()
    // Vent paa SVARET, ikke paa uret. Adressen skifter, foer siden bag
    // den er gengivet.
    await p.waitForURL(/[?&]gemt=/, { timeout: 20000 }).catch(() => {})
    await p.waitForSelector('.gem-svar', { timeout: 20000 }).catch(() => {})
    await p.waitForTimeout(400)
    const u = new URL(p.url())
    const slags = u.searchParams.get('gemt')
    // PRÆCIS `spaerret`. `ugyldig-mail`, `for-mange` og `for-hurtigt`
    // vender tilbage FOER `sendMail` og beviser intet om spaerringen.
    tjek(slags === 'spaerret',
      'indsendelse · afsendelsen blev spaerret, foer der blev kaldt ud',
      `gemt=${slags}`)
    tjek(u.searchParams.get('vaerelser') === '2' && u.searchParams.get('sted') === by.navn,
      'indsendelse · filtrene er bevaret i adressen', u.search)
    const m = await p.evaluate((f) => {
      const e = document.querySelector('.gem-svar'); if (!e) return null
      return {
        iSyne: new Function('el', `return (${f})(el)`)(e),
        harFokus: document.activeElement === e || e.contains(document.activeElement),
        tekst: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      }
    }, I_SYNE)
    tjek(!!m?.iSyne, 'indsendelse · svaret kan SES')
    tjek(!!m?.harFokus, 'indsendelse · fokus staar paa svaret', `«${m?.tekst ?? ''}»`)

    // Fejlen skal kunne RETTES, ikke skrives forfra. React kalder selv
    // `form.reset()` efter en indsendelse, saa det indtastede kan kun
    // overleve som indholdsattribut — det er derfor det baeres tilbage.
    const felter = await p.evaluate(() => ({
      navn: document.querySelector('#gem-navn')?.value ?? null,
      mail: document.querySelector('#gem-mail')?.value ?? null,
      invalid: document.querySelector('#gem-mail')?.getAttribute('aria-invalid'),
    }))
    tjek(felter.navn === NAVN && felter.mail === MAIL,
      'indsendelse · det indtastede staar der stadig, saa fejlen kan rettes',
      JSON.stringify(felter))
    const kage = (await p.context().cookies()).find((k) => k.name === 'bofinda_gemudkast')
    tjek(!!kage && kage.httpOnly === true,
      'indsendelse · udkastet ligger i en httpOnly-cookie, ikke i adressen',
      kage ? `maxAge-ish udloeb om ${Math.round((kage.expires * 1000 - Date.now()) / 1000)} s` : 'ingen cookie')
    tjek(!/[?&](mail|navn)=/.test(p.url()),
      'indsendelse · hverken mail eller navn staar i adressen', p.url().split('?')[1] ?? '')

    // ANDEN indsendelse. Omdirigeringen fra en server action er en BLOED
    // navigation: komponenten genmonteres ikke, og en fokuseffekt med
    // en tom afhaengighedsliste ville ikke koere igen. Maalt foer
    // rettelsen: fokus blev staaende paa «Send mig besked».
    await p.evaluate(() => window.scrollTo(0, 0))
    await p.fill('form.gem input[name="mail"]', MAIL)
    await p.locator('form.gem button[type="submit"]').click()
    await p.waitForTimeout(4000)
    const m2 = await p.evaluate((f) => {
      const e = document.querySelector('.gem-svar'); if (!e) return null
      return {
        iSyne: new Function('el', `return (${f})(el)`)(e),
        harFokus: document.activeElement === e || e.contains(document.activeElement),
      }
    }, I_SYNE)
    tjek(!!m2?.harFokus && !!m2?.iSyne,
      'indsendelse · ogsaa ANDEN indsendelse flytter fokus til svaret',
      JSON.stringify(m2))
    if (UD) await p.screenshot({ path: `${UD}/indsendelse.png` })
  } finally {
    await c.close().catch(() => {})
    const slettet = await sql`delete from users where email = ${MAIL} returning id`
    const [{ n: efter }] = await sql`select count(*)::int n from saved_searches`
    tjek(efter === foer, 'indsendelse · proevens raekker er ryddet op igen',
      `${slettet.length} bruger(e) slettet, ${efter} soegninger tilbage (var ${foer})`)
  }
}

await sql.end()
await br.close()
console.log(`\n${fejl === 0 ? '✓ alt groent' : `✗ ${fejl} fejlede`}`)
process.exit(fejl === 0 ? 0 : 1)
