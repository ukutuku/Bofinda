// ═══════════════════════════════════════════════════════════════
//  Forsidekontrollen: virker den NYE forsideformular?
//
//      node scripts/cloud/forsidekontrol.mjs <udmappe> --husdyr=ja|nej --byer=ja|nej
//
//  Filterkontrollen proever den SOEGTE side (/?sted=Prøveby N og videre).
//  Forsidens panel er en anden gren af formularen (`!soegt`): pris,
//  stoerrelse, indflytning og husdyr staar dér i panelet og IKKE i
//  vinduet. Det er den gren, der proeves her — med konkrete boliger.
//
//  ── TILSTANDEN ER ET ARGUMENT, IKKE ET GAET ─────────────────────
//  Om forsiden har et husdyrfelt og byforslag, afgoeres af bestanden,
//  og den er cachet i fem minutter (app/cache.ts). Proeven kan derfor
//  ikke selv skifte tilstand; den, der koerer den, saetter basen og
//  genstarter appen og siger, hvad der skal gaelde. Proeven maaler, om
//  siden ER i den tilstand, og fejler, hvis den ikke er — ellers kunne
//  en kontrol af «uden husdyr» staa groen paa en side med husdyr.
//
//      --husdyr=ja   mindst én bolig naevner «kæledyr tilladt»
//      --husdyr=nej  ingen goer; feltet og noten skal vaere vaek
//      --byer=ja     der er aktive boliger, altsaa byforslag
//      --byer=nej    ingen aktive boliger; ingen forslag, men «Flere
//                    filtre» og forklaringerne skal stadig vaere der
//
//  ── PROEVENS EGNE BOLIGER ────────────────────────────────────────
//  Med --byer=ja indsaettes seks boliger i det ubrugte postnummer 9097
//  «Formularby». De er kopier af syntetiske raekker, som siden selv
//  viser under «kan overtages nu» og «senere», saa overtagelsen tolkes
//  af den rigtige kode og ikke af proeven. Kilde og udlejer bevares,
//  fordi tolkningen er pr. kilde (i testbasen er de afklarede boliger
//  udlejerannoncer). Hver afviger fra «M» paa ét felt:
//
//      M  matcher alt                    P  pris 9.900 (over max)
//      E  husdyr, men ingen elevator     A  areal 55 m² (under min)
//      D  ingen husdyroplysning          T  kan overtages senere
//
//  De slettes igen i `finally`. Kun mod den isolerede testbase.
//
//  Exit: 0 = alt groent · 1 = noget fejlede · 2 = forudsaetning mangler
// ═══════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { aabnIsoleretEllerStop } from './isoleret.mjs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const UD = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'skaermbilleder/forside'
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const HUSDYR = arg('husdyr'), BYER = arg('byer')
if (!['ja', 'nej'].includes(HUSDYR) || !['ja', 'nej'].includes(BYER)) {
  console.error('FEJL: angiv --husdyr=ja|nej og --byer=ja|nej'); process.exit(2)
}

// Vagten ligger i isoleret.mjs — se noten dér om de tre signaler. Ingen
// egen forbindelse og ingen egen kopi af kravet.
const sql = await aabnIsoleretEllerStop()

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM
  const rod = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  for (const b of [`${rod}/chromium`, `${rod}/chromium/chrome-linux/chrome`]) {
    try { if (statSync(b).isFile()) return b } catch { /* naeste */ }
  }
  try {
    for (const d of readdirSync(rod).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      const b = `${rod}/${d}/chrome-linux/chrome`
      try { if (statSync(b).isFile()) return b } catch { /* naeste */ }
    }
  } catch { /* videre */ }
  console.error('FEJL: ingen Chromium fundet.'); process.exit(2)
}

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}
const sammeMaengde = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

mkdirSync(UD, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })

const POSTNR = '9097', BY = 'Formularby'
const PRAEFIKS = `forsidekontrol-${process.pid}-${Date.now()}`
const fixtures = {}            // navn → id
const navnFor = (id) => Object.entries(fixtures).find(([, v]) => v === id)?.[0] ?? `fremmed:${id.slice(0, 8)}`

// En side med samtykket afvist som en bruger goer det — med cookien, der
// svarer til «Kun det nødvendige», ikke ved at skjule banneret med CSS.
async function nySide(bredde, hoejde) {
  const ctx = await browser.newContext({ viewport: { width: bredde, height: hoejde }, isMobile: bredde < 700, hasTouch: bredde < 700 })
  await ctx.addCookies([{ name: 'bofinda_samtykke', value: 'nej', url: BASE }])
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log(`    ! sidefejl: ${e.message.slice(0, 200)}`))
  return { ctx, p }
}
// Knappen holder kun navigationen tilbage, naar React har overtaget den
// (Filterdialog.tsx). Et klik foer det navigerer til ?flere=1 og taber
// det, der stod i panelet — det er ikke formularens fejl, men proevens.
// Hydreringen ses paa React-egenskaberne paa FORMULAREN, ikke paa
// knappen: proeven skal kunne melde en manglende knap som et fund, ikke
// som en side, der «ikke blev klar».
async function hydreret(p) {
  try {
    await p.waitForFunction(() => {
      const f = document.querySelector('form.filtre')
      return !!f && Object.keys(f).some((x) => x.startsWith('__reactProps'))
    }, null, { timeout: 30_000 })
    await p.waitForTimeout(150)   // effekterne efter hydreringen (`klar`)
  } catch {
    // Sig HVORFOR, ikke bare at tiden gik: en side uden knap er noget
    // andet end en knap, React aldrig overtog.
    const d = await p.evaluate(() => ({
      formular: !!document.querySelector('form.filtre'),
      knap: !!document.getElementById('filterknap'),
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 80) ?? null,
      fejl: document.body.innerText.match(/Application error[^\n]*|Something went wrong[^\n]*|Der skete en fejl[^\n]*/)?.[0] ?? null,
    }))
    throw new Error(`siden blev ikke klar (${p.url()}): ${JSON.stringify(d)}`)
  }
}
async function gaaTil(p, sti) {
  const svar = await p.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 90_000 })
  if (!svar || svar.status() !== 200) throw new Error(`${sti} svarede ${svar?.status()}`)
  await hydreret(p)
}
const kortIds = (p) => p.evaluate(() =>
  [...document.querySelectorAll('.liste a.kort[data-bolig]')].map((a) => a.getAttribute('data-bolig')))
// Felterne findes på NAVN i panelet, ikke på id: navnene er formularens
// kontrakt og er de samme i c0575bf, så prøven kan køres mod den gamle
// revision som modprøve uden at falde på en selektor.
const FP = (navn) => `.forsidepanel [name="${navn}"]`
const udfyldPanel = async (p, v) => {
  for (const n of ['sted', 'prisMin', 'prisMax', 'areal']) if (v[n] != null) await p.fill(FP(n), v[n])
  for (const n of ['overtagelse', 'kaeledyr']) if (v[n] != null) await p.selectOption(FP(n), v[n])
}
const panelVaerdier = (p) => p.evaluate(() => {
  const v = (n) => document.querySelector(`.forsidepanel [name="${n}"]`)?.value ?? null
  return { sted: v('sted'), prisMin: v('prisMin'), prisMax: v('prisMax'), areal: v('areal'),
    overtagelse: v('overtagelse'), kaeledyr: v('kaeledyr') }
})
// Afkrydsningerne er stylede piller; klik på etiketten som en bruger.
const kryds = (p, id) => p.click(`#filterdialog label:has(#${id})`)
const params = (p) => Object.fromEntries([...new URL(p.url()).searchParams.entries()])

// ── Proevens egne boliger ──────────────────────────────────────────
async function laegFixtures() {
  const { p, ctx } = await nySide(1440, 1000)
  const baser = {}
  for (const [tid, sti] of [['nu', '/?overtagelse=nu'], ['senere', '/?overtagelse=senere']]) {
    await p.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 90_000 })
    const ids = await p.evaluate(() =>
      [...document.querySelectorAll('.liste a.kort[data-bolig]:not([data-gruppe])')].map((a) => a.getAttribute('data-bolig')))
    if (!ids.length) { await ctx.close(); return `ingen enkeltkort under ${sti}` }
    const [b] = await sql`
      select id from listings where id = any(${ids}::uuid[])
        and total_monthly is not null and rent_monthly is not null and rooms is not null
      order by array_position(${ids}::uuid[], id) limit 1`
    if (!b) { await ctx.close(); return `ingen egnet basisrække under ${sti}` }
    baser[tid] = b.id
  }
  await ctx.close()

  const kolonner = (await sql`
    select column_name, data_type, udt_name from information_schema.columns
    where table_schema = 'public' and table_name = 'listings' and column_name <> 'id'
    order by ordinal_position`)
  const dyr = HUSDYR === 'ja' ? ['kæledyr tilladt'] : []
  const SPEC = {
    M: { tid: 'nu', kr: 9100, m2: 77, faciliteter: [...dyr, 'elevator'] },
    E: { tid: 'nu', kr: 9100, m2: 77, faciliteter: [...dyr] },
    D: { tid: 'nu', kr: 9100, m2: 77, faciliteter: ['elevator'] },
    P: { tid: 'nu', kr: 9900, m2: 77, faciliteter: [...dyr, 'elevator'] },
    A: { tid: 'nu', kr: 9100, m2: 55, faciliteter: [...dyr, 'elevator'] },
    T: { tid: 'senere', kr: 9100, m2: 77, faciliteter: [...dyr, 'elevator'] },
  }
  for (const [navn, s] of Object.entries(SPEC)) {
    const [b] = await sql`select total_monthly, rent_monthly from listings where id = ${baser[s.tid]}`
    const total = s.kr * 100
    const vej = `Formular ${navn}-vej`
    const saet = {
      external_key: `${PRAEFIKS}-${navn}`,
      source_url: `http://127.0.0.1:9/${PRAEFIKS}/${navn}`,
      address_raw: `${vej} 1, ${POSTNR} ${BY}`, street: vej, house_number: '1',
      floor: null, door: null, postal_code: POSTNR, city: BY,
      unit_address_uuid: null, access_address_uuid: `intern:forsidekontrol:${PRAEFIKS}:${navn}`,
      address_match_level: 'access', size_m2: s.m2,
      rent_monthly: b.rent_monthly + (total - b.total_monthly), total_monthly: total,
      // Selve arrayet, ikke en JSON-streng: `postgres` koder jsonb-
      // parametre selv, og en forudkodet streng blev til en jsonb-SKALAR,
      // som `jsonb_array_length` i søgningen fejler på (siden svarede 500).
      amenities: s.faciliteter, status: 'active',
      contact_email: null, contact_phone: null, delisted_at: null,
    }
    const vaerdier = []
    const udtryk = kolonner.map((k) => {
      if (!(k.column_name in saet)) return `"${k.column_name}"`
      vaerdier.push(saet[k.column_name])
      const cast = k.data_type === 'USER-DEFINED' ? `::${k.udt_name}` : k.data_type === 'jsonb' ? '::jsonb' : ''
      return `$${vaerdier.length}${cast}`
    })
    vaerdier.push(baser[s.tid])
    const [r] = await sql.unsafe(
      `insert into listings (${kolonner.map((k) => `"${k.column_name}"`).join(', ')})
       select ${udtryk.join(', ')} from listings where id = $${vaerdier.length} returning id`, vaerdier)
    fixtures[navn] = r.id
  }
  console.log(`  · proevens boliger i ${POSTNR} ${BY}: `
    + Object.entries(fixtures).map(([n, id]) => `${n}=${id.slice(0, 8)}`).join(' · ')
    + `  (baser: nu ${baser.nu.slice(0, 8)}, senere ${baser.senere.slice(0, 8)})`)
  return null
}

try {
  console.log(`\n  FORSIDEKONTROL — husdyr=${HUSDYR} · byer=${BYER} · ${BASE}\n`)

  // ═══ 1 · Tilstanden: er siden den, argumenterne siger? ═══════════
  console.log('═══ 1 · Tilstanden ═══')
  {
    const { p, ctx } = await nySide(1440, 1000)
    await gaaTil(p, '/')
    const m = await p.evaluate(() => {
      const form = document.querySelector('.hero form.filtre')
      const navne = form ? [...form.elements].map((e) => e.name).filter(Boolean) : []
      const taelling = {}
      for (const n of navne) taelling[n] = (taelling[n] ?? 0) + 1
      return {
        panel: !!document.querySelector('.hero .forsidepanel'),
        husdyrFelt: !!document.querySelector('.forsidepanel [name="kaeledyr"]'),
        husdyrNote: document.querySelector('#fp-kaeledyr-note')?.textContent?.trim() ?? null,
        dialogHusdyr: !!document.querySelector('#filterdialog input[name="kaeledyr"]'),
        byForslag: document.querySelectorAll('#byer option[value]:not([value=""])').length,
        popByer: [...document.querySelectorAll('.pop-liste a')].filter((a) => a.getAttribute('href')?.startsWith('/?sted=')).length,
        popListe: !!document.querySelector('.pop-liste'),
        filterknap: !!document.querySelector('.hero form.filtre #filterknap'),
        filterknapTekst: document.querySelector('#filterknap')?.textContent?.trim() ?? null,
        taelling,
      }
    })
    tjek('forsidens panel findes', m.panel)
    tjek(`siden er i tilstanden husdyr=${HUSDYR}`, m.husdyrFelt === (HUSDYR === 'ja'),
      m.husdyrFelt ? 'husdyrfeltet står i panelet' : 'intet husdyrfelt i panelet')
    tjek(`siden er i tilstanden byer=${BYER}`, (m.byForslag > 0) === (BYER === 'ja'),
      `${m.byForslag} byforslag i datalisten · ${m.popByer} by-genveje`)
    tjek('«Flere filtre» står i forsidens formular — uanset byforslag', m.filterknap,
      `«${m.filterknapTekst}»`)
    if (BYER === 'nej') tjek('uden byforslag: ingen by-genveje i panelet', m.popByer === 0)
    // Samme `name` to gange i én GET-formular sender værdien to gange, og
    // `filtreFraParametre` læser den første. Gruppefelterne (radioknapper
    // og typeafkrydsninger) deler navn med vilje og er ikke med her.
    for (const n of ['sted', 'prisMin', 'prisMax', 'areal', 'overtagelse', 'kaeledyr']) {
      const ventet = n === 'kaeledyr' && HUSDYR === 'nej' ? 0 : 1
      tjek(`«${n}» står ${ventet} gang i formularen`, (m.taelling[n] ?? 0) === ventet, `${m.taelling[n] ?? 0}`)
    }
    if (HUSDYR === 'nej') {
      tjek('uden husdyroplysninger: ingen husdyrnote og ingen afkrydsning i vinduet',
        m.husdyrNote == null && !m.dialogHusdyr)
    }
    await p.screenshot({ path: `${UD}/1-tilstand-1440.png` })
    await ctx.close()
  }

  // ═══ 2 · Forklaringerne ved felterne ════════════════════════════
  console.log('\n═══ 2 · Forklaringerne ved felterne ═══')
  for (const [bredde, hoejde] of [[1440, 900], [390, 844]]) {
    const { p, ctx } = await nySide(bredde, hoejde)
    await gaaTil(p, '/')
    const n = await p.evaluate(() => {
      const beskrivelse = (sel) => {
        const e = document.querySelector(sel)
        if (!e) return { findes: false }
        const ids = (e.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        const tekst = ids.map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' | ')
        const note = ids.length ? document.getElementById(ids[0]) : null
        const r = note?.getBoundingClientRect()
        const s = note ? getComputedStyle(note) : null
        return {
          findes: true, ids, tekst,
          synlig: !!note && r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none',
          skrift: s ? parseFloat(s.fontSize) : 0,
          farve: s?.color ?? null,
          iPanelet: !!note?.closest('.forsidepanel'),
        }
      }
      const g = document.querySelector('.grundlagsnote')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      return {
        prisMin: beskrivelse('.forsidepanel [name="prisMin"]'), prisMax: beskrivelse('.forsidepanel [name="prisMax"]'),
        overtagelse: beskrivelse('.forsidepanel [name="overtagelse"]'), kaeledyr: beskrivelse('.forsidepanel [name="kaeledyr"]'),
        grundlag: g,
        dialogHusdyrLinje: [...document.querySelectorAll('#faciliteter-note p')]
          .map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((t) => t.startsWith('Kæledyr')) ?? null,
      }
    })
    const lille = (b) => `${b.skrift} px`
    for (const [felt, b] of [['prisMin', n.prisMin], ['prisMax', n.prisMax]]) {
      tjek(`${bredde} px · ${felt}: forklaringen er bundet (aria-describedby) og synlig`,
        b.findes && b.synlig && b.iPanelet && b.skrift >= 12, `${b.ids?.join(',')} · ${lille(b)}`)
      tjek(`${bredde} px · ${felt}: husleje plus aconto, og husleje alene hvor resten ikke kendes`,
        /husleje plus den aconto, kilden opkræver/.test(b.tekst ?? '') && /kun kender huslejen, måles på den/.test(b.tekst ?? ''),
        b.tekst?.slice(0, 110))
    }
    {
      const b = n.overtagelse
      tjek(`${bredde} px · indflytning: forklaringen er bundet og synlig`,
        b.findes && b.synlig && b.iPanelet && b.skrift >= 12, `${b.ids?.join(',')} · ${lille(b)}`)
      const tal = (b.tekst ?? '').match(/(\d[\d.]*) kan overtages nu · (\d[\d.]*) senere · (\d[\d.]*) uden oplyst dato/)
      tjek(`${bredde} px · indflytning: tre grupper og at de ukendte udelades`,
        !!tal && /de vises ikke, hvis du vælger et tidspunkt/.test(b.tekst ?? ''), b.tekst?.slice(0, 120))
      // Samme tre tal som grundlagslinjen under tallene — begge regnes af
      // `availabilityGrundlag` for den samme (tomme) søgning.
      const g = n.grundlag.match(/(\d[\d.]*) kan overtages nu · (\d[\d.]*) kan overtages senere · (\d[\d.]*) uden/)
      tjek(`${bredde} px · indflytning: tallene er grundlagslinjens`,
        !!tal && !!g && tal[1] === g[1] && tal[2] === g[2] && tal[3] === g[3],
        tal && g ? `${tal.slice(1).join('/')} = ${g.slice(1).join('/')}` : 'mangler')
    }
    if (HUSDYR === 'ja') {
      const b = n.kaeledyr
      tjek(`${bredde} px · husdyr: forklaringen er bundet og synlig`,
        b.findes && b.synlig && b.iPanelet && b.skrift >= 12, `${b.ids?.join(',')} · ${lille(b)}`)
      tjek(`${bredde} px · husdyr: positivt filter — tre grupper, de tavse vises ikke`,
        /\d[\d.]* nævner det · \d[\d.]* nævner andre faciliteter · \d[\d.]* mangler oplysninger og vises ikke/.test(b.tekst ?? ''),
        b.tekst?.slice(0, 120))
      tjek(`${bredde} px · husdyr: samme linje som i filtervinduet`, b.tekst === n.dialogHusdyrLinje,
        `${b.tekst?.slice(0, 40)}… / ${n.dialogHusdyrLinje?.slice(0, 40)}…`)
    }
    if (await p.locator('.fp-noter').count()) await p.locator('.fp-noter').scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${UD}/2-forklaringer-${bredde}.png` })
    await ctx.close()
  }

  if (BYER === 'ja') {
    const problem = await laegFixtures()
    if (problem) { console.error(`FEJL: ${problem} — forudsætningen mangler`); process.exitCode = 2; throw new Error('forudsaetning') }

    // Forventningerne. Uden husdyrfelt kan D (ingen husdyroplysning) ikke
    // sorteres fra, og E og M er ens på husdyr.
    const FILTER = { sted: BY, prisMin: '9000', prisMax: '9500', areal: '70', overtagelse: 'nu',
      ...(HUSDYR === 'ja' ? { kaeledyr: '1' } : {}) }
    const VENTET = HUSDYR === 'ja' ? ['M', 'E'] : ['M', 'E', 'D']
    const VENTET_ELEVATOR = HUSDYR === 'ja' ? ['M'] : ['M', 'D']
    const id = (navne) => navne.map((x) => fixtures[x])
    const vis = (ids) => ids.map(navnFor).join(',') || '(ingen)'

    // ═══ 3 · Indsendelse med hovedknappen og med Enter ═════════════
    console.log('\n═══ 3 · Hovedknappen og Enter ═══')
    for (const [bredde, hoejde] of [[1440, 900], [390, 844]]) {
      const { p, ctx } = await nySide(bredde, hoejde)
      await gaaTil(p, '/')
      const knap = p.locator('.hero button[type="submit"]').first()
      const kb = await knap.boundingBox()
      await udfyldPanel(p, FILTER)
      if (bredde === 390) {
        tjek('390 px · «Søg boliger» står i første skærmbillede', kb && kb.y + kb.height <= hoejde,
          kb ? `bund ${Math.round(kb.y + kb.height)} px af ${hoejde}` : 'ingen knap')
        tjek('390 px · knappen er mindst 44 px høj', kb && kb.height >= 44, kb ? `${Math.round(kb.height)} px` : '')
      }
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), knap.click()])
      const q = params(p)
      tjek(`${bredde} px · hovedknap: adressen bærer panelets felter`,
        Object.entries(FILTER).every(([k, v]) => q[k] === v), JSON.stringify(q))
      const ids = await kortIds(p)
      tjek(`${bredde} px · hovedknap: præcis de forventede boliger`, sammeMaengde(ids, id(VENTET)),
        `vist ${vis(ids)} · ventet ${VENTET.join(',')}`)
      await p.screenshot({ path: `${UD}/3-hovedknap-${bredde}.png` })
      await ctx.close()
    }
    {
      const { p, ctx } = await nySide(1440, 900)
      await gaaTil(p, '/')
      await udfyldPanel(p, FILTER)
      await p.focus('#sted')
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.keyboard.press('Enter')])
      const ids = await kortIds(p)
      tjek('Enter i «By eller område» indsender den samme søgning',
        Object.entries(FILTER).every(([k, v]) => params(p)[k] === v) && sammeMaengde(ids, id(VENTET)),
        `vist ${vis(ids)}`)
      await ctx.close()
    }

    // ═══ 4 · Hvert felt udelukker sin egen bolig ════════════════════
    //  Fjern ét filter ad gangen: så skal netop den bolig, feltet holdt
    //  ude, komme frem. Det beviser, at det er FELTET, der virker — og
    //  ikke et tilfældigt tomt resultat.
    console.log('\n═══ 4 · Hvert felt udelukker sin egen bolig ═══')
    {
      const { p, ctx } = await nySide(1440, 900)
      const uden = { prisMax: 'P', areal: 'A', overtagelse: 'T', ...(HUSDYR === 'ja' ? { kaeledyr: 'D' } : {}) }
      for (const [felt, navn] of Object.entries(uden)) {
        const q = new URLSearchParams(Object.entries(FILTER).filter(([k]) => k !== felt))
        await gaaTil(p, `/?${q}`)
        const ids = await kortIds(p)
        tjek(`uden «${felt}»: ${navn} kommer frem, resten som før`,
          sammeMaengde(ids, id([...VENTET, navn])), `vist ${vis(ids)}`)
      }
      await ctx.close()
    }

    // ═══ 5 · Vinduet: åbn, luk, bevar, Vis resultater ═══════════════
    console.log('\n═══ 5 · Filtervinduet fra forsiden ═══')
    {
      const { p, ctx } = await nySide(1440, 900)
      await gaaTil(p, '/')
      await udfyldPanel(p, FILTER)
      const foer = await panelVaerdier(p)
      const url0 = p.url()
      for (const [maade, luk] of [
        ['«Luk filtre»', async () => p.click('#filterdialog .fd-luk')],
        ['Escape', async () => p.keyboard.press('Escape')],
      ]) {
        await p.click('#filterknap')
        const aaben = await p.evaluate(() => document.getElementById('filterdialog')?.open === true)
        tjek(`${maade}: «Flere filtre» åbner vinduet uden at navigere`, aaben && p.url() === url0, p.url())
        await kryds(p, 'elevator')
        tjek(`${maade}: afkrydsningen i vinduet tager`,
          await p.evaluate(() => document.querySelector('#filterdialog #elevator')?.checked === true))
        await luk()
        await p.waitForTimeout(200)
        const m = await p.evaluate(() => ({
          aaben: document.getElementById('filterdialog')?.open === true,
          elevator: document.querySelector('#filterdialog #elevator')?.checked ?? null,
          fokus: document.activeElement?.id ?? null,
        }))
        const efter = await panelVaerdier(p)
        tjek(`${maade}: vinduet lukker`, !m.aaben)
        tjek(`${maade}: vinduets kladde nulstilles (elevator ikke længere afkrydset)`, m.elevator === false)
        tjek(`${maade}: panelets værdier BEVARES`, JSON.stringify(efter) === JSON.stringify(foer),
          JSON.stringify(efter))
        tjek(`${maade}: fokus tilbage på «Flere filtre»`, m.fokus === 'filterknap', String(m.fokus))
      }
      // Og nu igennem vinduet: panelets felter + elevator, sendt med «Vis resultater».
      await p.click('#filterknap')
      await kryds(p, 'elevator')
      await p.screenshot({ path: `${UD}/5-vindue-aabent-1440.png` })
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.click('#filterdialog .fd-vis')])
      const q = params(p)
      tjek('«Vis resultater»: adressen bærer BÅDE panelets felter og vinduets',
        Object.entries(FILTER).every(([k, v]) => q[k] === v) && q.elevator === '1', JSON.stringify(q))
      const ids = await kortIds(p)
      tjek('«Vis resultater»: præcis de forventede boliger (E falder fra på elevator)',
        sammeMaengde(ids, id(VENTET_ELEVATOR)), `vist ${vis(ids)} · ventet ${VENTET_ELEVATOR.join(',')}`)

      // ═══ 6 · Bevaring på resultatsiden ════════════════════════════
      console.log('\n═══ 6 · Værdierne følger med til resultatsiden ═══')
      const r = await p.evaluate(() => {
        const v = (s) => document.querySelector(s)
        return {
          sted: v('#sted')?.value, prisMin: v('#prisMin')?.value, prisMax: v('#prisMax')?.value,
          areal: v('#areal')?.value, overtagelse: v('#overtagelse')?.value,
          kaeledyr: v('#filterdialog #kaeledyr')?.checked ?? null, elevator: v('#filterdialog #elevator')?.checked ?? null,
          chips: [...document.querySelectorAll('.filterchips .chip:not(.chip-ryd)')].map((c) => c.textContent.replace('×', '').trim()),
        }
      })
      tjek('resultatsiden: felterne står med de indsendte værdier',
        r.sted === BY && r.prisMin === '9000' && r.prisMax === '9500' && r.areal === '70' && r.overtagelse === 'nu'
        && r.elevator === true && (HUSDYR === 'nej' || r.kaeledyr === true), JSON.stringify(r))
      tjek('resultatsiden: hvert filter står som en chip', r.chips.length >= (HUSDYR === 'ja' ? 5 : 4),
        r.chips.join(' · '))

      // ═══ 7 · Nulstilling ══════════════════════════════════════════
      console.log('\n═══ 7 · Nulstilling ═══')
      await p.click('#filterknap')
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.click('#filterdialog .fd-ryd')])
      tjek('«Ryd filtre» beholder området og intet andet',
        JSON.stringify(params(p)) === JSON.stringify({ sted: BY }), p.url())
      const ids2 = await kortIds(p)
      tjek('«Ryd filtre»: alle seks af prøvens boliger i området kommer frem',
        sammeMaengde(ids2, Object.values(fixtures)), `vist ${vis(ids2)}`)
      await gaaTil(p, `/?${new URLSearchParams(FILTER)}`)
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), p.click('.filterchips .chip-ryd')])
      await hydreret(p)
      const tom = await panelVaerdier(p)
      tjek('«Ryd alle» fører til forsiden med et tomt panel',
        new URL(p.url()).search === '' && Object.values(tom).every((x) => x === '' || x === null),
        JSON.stringify(tom))
      await ctx.close()
    }
  } else {
    // ═══ 3 · Uden aktive boliger: formularen virker stadig ══════════
    console.log('\n═══ 3 · Uden byforslag ═══')
    const { p, ctx } = await nySide(1440, 900)
    await gaaTil(p, '/')
    const url0 = p.url()
    if (!(await p.locator('#filterknap').count())) throw new Error('«Flere filtre» findes ikke i forsidens formular')
    await p.click('#filterknap')
    tjek('«Flere filtre» åbner vinduet, også uden byforslag',
      await p.evaluate(() => document.getElementById('filterdialog')?.open === true) && p.url() === url0)
    await p.keyboard.press('Escape')
    await udfyldPanel(p, { sted: 'Hvorsomhelst', prisMax: '9500', overtagelse: 'nu' })
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }),
      p.locator('.hero button[type="submit"]').first().click()])
    const q = params(p)
    tjek('panelet indsender, også uden byforslag',
      q.sted === 'Hvorsomhelst' && q.prisMax === '9500' && q.overtagelse === 'nu', JSON.stringify(q))
    await p.screenshot({ path: `${UD}/3-uden-byer-resultat-1440.png` })
    await ctx.close()
  }
} catch (e) {
  if (e.message !== 'forudsaetning') { console.error(e); fejl++ }
} finally {
  if (Object.keys(fixtures).length) {
    const slettet = await sql`delete from listings where external_key like ${PRAEFIKS + '-%'} returning id`
    console.log(`\n  · prøvens ${slettet.length} boliger slettet igen`)
  }
  await sql.end()
  await browser.close()
}

if (process.exitCode === 2) process.exit(2)
console.log(fejl ? `\n✗ ${fejl} kontrol(ler) fejlede` : '\n✓ ALT GRØNT')
process.exit(fejl ? 1 : 0)
