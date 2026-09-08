// ═══════════════════════════════════════════════════════════════
//  Prøver for produktanalytics.
//
//    1.  Forside vs. søgning skelnes på harFiltre(), ikke pathname
//    2.  INVARIANTEN: search = search_results_view + empty_results
//    3.  Ét event pr. request — dedup
//    4.  Impression-dedup pr. (session, listing, result_view)
//    5.  Impression-stikprøven er deterministisk pr. session
//    6.  sample_andel STEMPLES serverside — klienten sender den aldrig
//    7.  alert_created kun ved slags === 'sendt'
//    8.  alert_confirmed KUN ved den reelle DB-transition
//    9.  canonical city kun fra facetter()-allowlisten
//   10.  PII afvises: mail, telefon, token, fremmed URL, for lang tekst
//   11.  Ukendte properties droppes — eventet skrives
//   12.  Manglende påkrævet property afviser eventet
//   13.  Analytics-fejl bryder ikke produktflowet
//   14.  Samtykke = nej/uvalgt → ingen identifikatorer, ingen events
//   15.  Samtykke = ja → identifikatorer, og de holder
//   16.  Tilbagetrækning nulstiller — og et nyt ja giver et NYT id
//   17.  Sessionen udløber på det absolutte loft
//   18.  Miljøisolation: alt fra prøven er 'proeve'
//   19.  Miljø kan ikke bestemmes → intet skrives
//   20.  research_session tagging oven på helt normale events
//   21.  Filterdiffen mod Referer
//   22.  «Nulstil» kollapser til ét event
//   23.  Ingen Referer → ingen filterevents
//   24.  REFERER LÆKKER IKKE: fritekst når aldrig et event
//   25.  Retention: udløbne rækker slettes, fremtidige bliver
//   26.  Dagsaggregatet
//   27.  MAALING_AKTIV=0 → ingenting
//   28.  Server Action-revalidering tæller ikke som en sidevisning
//   29.  Paginering: valgfri metadata, heltalsværn, komplethedsreglen
//   30.  search_submitted: en observeret indsendelse, ikke en rendering
//
//  Deliberate break-tests: se docs/analytics-v1.md. Hver af dem laves
//  midlertidigt i koden, køres, ses rød og rulles tilbage. En prøve, der
//  ikke kan blive rød, er et grønt flueben uden dækning.
//
//    npm test
// ═══════════════════════════════════════════════════════════════

import { eq, sql as dsql } from 'drizzle-orm'
import { db } from '../db/client'
import { haendelser, haendelserDaglig, savedSearches, users } from '../db/schema'
import { bekraeft, tilmeld } from '../lib/alarm'
import {
  ALLOWLIST, KLIENTEVENTS, MILJOEER, RENDEREVENTS, RUTER, erGenrendering, iStikproeve, miljoe,
  rens, saetAktiv, saetMiljoe, udloeb, type Haendelse, type Kontekst,
} from '../lib/maaling'
import {
  _saetDedup, _saetHoveder, _saetKontekst, opdaterDagsaggregat, ryddHaendelser, spor,
} from '../lib/maaling-server'
import {
  C_ANONYM, C_SAMTYKKE, C_SESSION, SESSION_MAKS_MS,
  anonymFra, laesSamtykke, planFor, sessionFra, sessionVaerdi, type Laeser,
} from '../lib/samtykke'
import { antalFiltre, filterDiff, forrigeFiltre, uddrag } from '../lib/maalingsoeg'
import { antalAvancerede, erSorteret, sammenfatFlere } from '../lib/filterpanel'
import { filtreFraParametre, harFiltre, type Filtre } from '../lib/soeg'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const AID = '11111111-1111-4111-8111-111111111111'
const SID = '22222222-2222-4222-8222-222222222222'
const K = (ekstra: Partial<Kontekst> = {}): Kontekst => ({
  miljoe: 'proeve', anonymousId: AID, sessionId: SID,
  userId: null, researchSessionId: null, rute: '/', ...ekstra,
})

const cookies = (m: Record<string, string>): Laeser => (n) => m[n]
const raekker = () => db.select().from(haendelser)
const ryd = async () => { await db.delete(haendelser); _saetDedup(new Set()) }

console.log('\n── Produktanalytics ──────────────────────────────────\n')

saetAktiv(true)
_saetKontekst(K())
_saetDedup(new Set())

// ─── 1 · Forside vs. søgning ───────────────────────────────────
{
  const tom = filtreFraParametre({})
  const med = filtreFraParametre({ postnr: '2300' })
  tjek('1 · harFiltre skelner forside fra søgning',
    harFiltre(tom) === false && harFiltre(med) === true)
  tjek('1 · antalFiltre følger harFiltre',
    antalFiltre(tom) === 0 && antalFiltre(med) === 1)
}

// ─── 1b · Filterpanelets sammenfatning ─────────────────────────
//  Naar panelet er lukket, er `<summary>` det eneste, der er tilbage af
//  filtrene paa skaermen. Siger den forkert, er et aktivt filter usynligt.
//  Tallet er udledt af `antalFiltre` ved subtraktion — proeverne her
//  holder de to sammen, saa summary og `antal_filtre` ikke kan drive fra
//  hinanden.
{
  const F = (sp: Record<string, string | string[]>) => filtreFraParametre(sp)

  // Stedet er ikke et avanceret filter. Det staar i det store felt over
  // panelet, uanset hvilket af de tre felter det kom fra.
  tjek('1b · sted alene giver 0 avancerede',
    antalAvancerede(F({ sted: '2300' })) === 0
    && antalAvancerede(F({ sted: 'Aarhus' })) === 0
    && antalAvancerede(F({ by: 'Aarhus' })) === 0
    && antalAvancerede(F({ postnr: '2300' })) === 0
    && antalAvancerede(F({ by: 'Aarhus', postnr: '2300' })) === 0)

  // ... men det taeller stadig med i analytics' antal_filtre. De to tal
  // svarer paa hver sit spoergsmaal og skal blive ved med det.
  tjek('1b · og stedet taelles stadig i antal_filtre',
    antalFiltre(F({ postnr: '2300' })) === 1
    && antalFiltre(F({ by: 'Aarhus', postnr: '2300' })) === 2)

  tjek('1b · hvert avanceret filter taeller ét',
    antalAvancerede(F({ postnr: '2300', elevator: '1' })) === 1
    && antalAvancerede(F({ postnr: '2300', elevator: '1', kaeledyr: '1' })) === 2
    && antalAvancerede(F({ sted: 'Aarhus', prisMax: '12000', vaerelser: '3', fuld: '1' })) === 3)

  // Aldrig negativ: `antalFiltre` bruger samme praedikat som fratraekket.
  const alle: Record<string, string>[] = [
    {}, { sted: '2300' }, { by: 'x' }, { postnr: '2300' }, { by: 'x', postnr: '2300' },
    { sted: 'Aarhus', by: 'x', postnr: '2300' }, { sorter: 'pris_op' },
  ]
  tjek('1b · tallet kan ikke blive negativt',
    alle.every((sp) => antalAvancerede(F(sp)) >= 0))

  // Sorteringen er ikke et filter og maa ikke puste tallet op — men den
  // bor inde i panelet og ville ellers vaere usynlig, naar det er lukket.
  tjek('1b · sortering taelles ikke som filter',
    antalAvancerede(F({ postnr: '2300', sorter: 'pris_ned' })) === 0
    && antalFiltre(F({ postnr: '2300', sorter: 'pris_ned' })) === 1)
  tjek('1b · men sorteringen naevnes for sig',
    erSorteret(F({ sorter: 'pris_ned' })) === true
    && erSorteret(F({ sorter: 'nyeste' })) === false
    && erSorteret(F({})) === false)

  // En ukendt sortering kasseres af filtreFraParametre og er altsaa
  // standarden — saa maa sammenfatningen heller ikke sige «sorteret».
  tjek('1b · ukendt sortering er ikke «sorteret»',
    erSorteret(F({ sorter: 'fis' })) === false)

  const s = (sp: Record<string, string | string[]>) => sammenfatFlere(F(sp)).join(' · ')
  tjek('1b · sammenfatningens ordlyd',
    s({}) === 'Flere filtre'
    && s({ sted: '2300' }) === 'Flere filtre'
    && s({ sted: '2300', elevator: '1' }) === 'Flere filtre · 1 aktivt'
    && s({ elevator: '1', kaeledyr: '1' }) === 'Flere filtre · 2 aktive'
    && s({ sorter: 'pris_op' }) === 'Flere filtre · sorteret'
    && s({ elevator: '1', sorter: 'pris_op' }) === 'Flere filtre · 1 aktivt · sorteret',
    s({ elevator: '1', sorter: 'pris_op' }))

  // Foerste led er altid navnet — markuppen saetter kun mærkat-klassen paa
  // resten, saa et skift her ville farve overskriften groen.
  tjek('1b · foerste led er altid navnet',
    alle.every((sp) => sammenfatFlere(F(sp))[0] === 'Flere filtre'))
}

// ─── 2 · Invarianten ───────────────────────────────────────────
{
  await ryd()
  const u = { sted_slags: 'postnr' as const, postnr: '2300' }
  // To søgninger med træf, én uden.
  for (const n of [3, 7]) {
    _saetDedup(new Set())
    await spor({ navn: 'search', props: { ...u, result_count: n, antal_filtre: 1, sorter: 'nyeste' } }, '/')
    await spor({
      navn: 'search_results_view',
      props: { ...u, result_count: n, viste_antal: n, viste_pr_kilde: { propstep: n }, result_view_id: 'v' + n },
    }, '/')
  }
  _saetDedup(new Set())
  await spor({ navn: 'search', props: { ...u, result_count: 0, antal_filtre: 1, sorter: 'nyeste' } }, '/')
  await spor({ navn: 'empty_results', props: { ...u, antal_filtre: 1 } }, '/')

  const alle = await raekker()
  const n = (navn: string) => alle.filter((r) => r.eventName === navn).length
  tjek('2 · count(search) = count(search_results_view) + count(empty_results)',
    n('search') === n('search_results_view') + n('empty_results') && n('search') === 3,
    `${n('search')} = ${n('search_results_view')} + ${n('empty_results')}`)
}

// ─── 3 · Ét event pr. request ──────────────────────────────────
{
  await ryd()
  const h: Haendelse = { navn: 'homepage_view', props: { boliger_i_alt: 10 } }
  await spor(h, '/')
  await spor(h, '/') // samme "request" — samme dedup-hukommelse
  tjek('3 · to identiske kald i én request giver ÉN række',
    (await raekker()).length === 1)

  _saetDedup(new Set()) // ny request
  await spor(h, '/')
  tjek('3 · næste request giver en ny række',
    (await raekker()).length === 2)
}

// ─── 4-6 · Impressions ─────────────────────────────────────────
{
  await ryd()
  const BOLIG = '33333333-3333-4333-8333-333333333333'
  const imp = (visning: string): Haendelse => ({
    navn: 'listing_impression', listingId: BOLIG, sourceSlug: 'propstep',
    props: { result_view_id: visning, position: 3, sample_andel: 1 },
  })
  // Stikproeven styres eksplicit. Uden det ville proeven afhaenge af, om
  // netop denne sessions hash tilfaeldigvis rammer under 25 — og saa
  // maalte den noget andet, end den paastod.
  const pctFoer = process.env.MAALING_IMPRESSION_PCT
  process.env.MAALING_IMPRESSION_PCT = '100'

  await spor(imp('v1'), '/')
  await spor(imp('v1'), '/')
  tjek('4 · samme (session, listing, result_view) giver ÉN impression',
    (await raekker()).length === 1)
  await spor(imp('v2'), '/')
  tjek('4 · en ny resultatvisning giver en ny impression',
    (await raekker()).length === 2)

  // Og den anden vej: en session UDEN for stikproeven bidrager slet ikke.
  await ryd()
  process.env.MAALING_IMPRESSION_PCT = '0'
  await spor(imp('v3'), '/')
  tjek('4 · en session uden for stikprøven skriver ingen impressions',
    (await raekker()).length === 0)
  // Alt andet end impressions er upaavirket af stikproeven.
  _saetDedup(new Set())
  await spor({ navn: 'homepage_view', props: {} }, '/')
  tjek('4 · stikprøven rammer KUN impressions', (await raekker()).length === 1)
  process.env.MAALING_IMPRESSION_PCT = pctFoer

  tjek('5 · stikprøven er deterministisk pr. session',
    iStikproeve(SID, 50) === iStikproeve(SID, 50)
    && iStikproeve(SID, 0) === false && iStikproeve(SID, 100) === true)
  // Fordelingen skal faktisk ramme omkring andelen, ellers er hashen skæv.
  let traf = 0
  for (let i = 0; i < 2000; i++) traf += iStikproeve(`${AID.slice(0, 24)}${String(i).padStart(12, '0')}`, 25) ? 1 : 0
  tjek('5 · 25 % rammer omkring en fjerdedel', traf > 400 && traf < 600, `${traf}/2000`)

  const uden = rens(
    { navn: 'listing_impression', listingId: BOLIG, props: { result_view_id: 'v', position: 1 } } as unknown as Haendelse,
    K(),
  )
  tjek('6 · impression uden sample_andel afvises',
    !uden.ok && uden.fejl.grund === 'manglende-property')
}

// ─── 6 · sample_andel stemples SERVERSIDE ──────────────────────
//
// Fejlen, der holdt Analytics v1 aaben: app/Maaling.tsx bygger KUN
// result_view_id, position, er_gruppe og gruppe_antal. sample_andel er
// `kraevet` i allowlisten, saa hver eneste impression fra en rigtig
// browser blev afvist med «manglende-property» — 0 raekker i produktionen
// i tre uger, mens `npm test` var groen.
//
// Groen, fordi proeven ovenfor SELV leverer feltet. Blokken her bruger
// derfor ordret klientens payload og tilfoejer ingenting. Det er hele
// forskellen mellem en proeve, der maaler koden, og en der maaler sig selv.
{
  const BOLIG = '33333333-3333-4333-8333-333333333333'
  const pctFoer = process.env.MAALING_IMPRESSION_PCT

  /** Ordret det, app/Maaling.tsx laegger i koeen. Ingen sample_andel. */
  const somKlienten = (visning: string, ekstra: Record<string, unknown> = {}) => ({
    navn: 'listing_impression', listingId: BOLIG, sourceSlug: 'propstep',
    props: { result_view_id: visning, position: 3, er_gruppe: false, ...ekstra },
  } as unknown as Haendelse)

  // Sessionerne udpeges af stikproeven selv. Haandplukkede id'er ville
  // goere proeven afhaengig af, at netop SID tilfaeldigvis rammer under 25.
  const findSession = (med: boolean) => {
    for (let i = 0; i < 5000; i++) {
      const id = `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`
      if (iStikproeve(id, 25) === med) return id
    }
    throw new Error('ingen session fundet')
  }
  const SID_MED = findSession(true)
  const SID_UDEN = findSession(false)
  const andel = async () => {
    const r = await raekker()
    return (r[0]?.properties as Record<string, unknown> | undefined)?.sample_andel
  }

  // ── A + C · sampled session, klientens payload UDEN sample_andel ──
  await ryd()
  process.env.MAALING_IMPRESSION_PCT = '25'
  await spor(somKlienten('va'), '/', { kontekst: K({ sessionId: SID_MED }) })
  const a = await raekker()
  tjek('6A · klientens payload uden sample_andel skrives nu',
    a.length === 1, `${a.length} raekke(r)`)
  const a0 = await andel()
  tjek('6A · serveren stempler den faktiske andel som BROEKDEL', a0 === 0.25, String(a0))
  tjek('6C · og klienten sendte den beviseligt ikke selv',
    !('sample_andel' in (somKlienten('x') as unknown as { props: object }).props))

  // Andelen foelger pct — den er ikke en konstant, der tilfaeldigvis er 0.25.
  await ryd()
  process.env.MAALING_IMPRESSION_PCT = '100'
  await spor(somKlienten('vb'), '/', { kontekst: K({ sessionId: SID_UDEN }) })
  const a1 = await andel()
  tjek('6A · andelen foelger pct — ved 100 % er den 1', a1 === 1, String(a1))

  // ── B · uden for stikproeven skrives der intet ──
  await ryd()
  process.env.MAALING_IMPRESSION_PCT = '25'
  await spor(somKlienten('vc'), '/', { kontekst: K({ sessionId: SID_UDEN }) })
  tjek('6B · session uden for stikprøven skriver ingen impression',
    (await raekker()).length === 0)

  await ryd()
  await spor(somKlienten('vd', { sample_andel: 1 }), '/', { kontekst: K({ sessionId: SID_UDEN }) })
  tjek('6B · porten kan ikke omgaas ved selv at sende feltet med',
    (await raekker()).length === 0)

  // ── D · klientens egen andel er ikke autoritativ ──
  await ryd()
  await spor(somKlienten('ve', { sample_andel: 1 }), '/', { kontekst: K({ sessionId: SID_MED }) })
  const d0 = await andel()
  tjek('6D · en paastaaet 1 overskrives med den sande 0.25', d0 === 0.25, String(d0))

  await ryd()
  await spor(somKlienten('vf', { sample_andel: 0.0001 }), '/', { kontekst: K({ sessionId: SID_MED }) })
  const d1 = await andel()
  tjek('6D · ogsaa en andel, der ville puste tallet 2500× op, overskrives',
    d1 === 0.25, String(d1))

  // ── F · stemplet tilfoejer ÉN kendt noegle og intet andet ──
  await ryd()
  await spor(somKlienten('vg'), '/', { kontekst: K({ sessionId: SID_MED }) })
  const [imp] = await raekker()
  const noegler = Object.keys((imp?.properties ?? {}) as object).sort()
  tjek('6F · properties er praecis de forventede noegler — intet er laekket ind',
    JSON.stringify(noegler)
      === JSON.stringify(['er_gruppe', 'position', 'result_view_id', 'sample_andel']),
    noegler.join(','))
  const f0 = (imp?.properties as Record<string, unknown>)?.sample_andel
  tjek('6F · andelen er et TAL i (0,1] — den kan rummes i numeric(5,4)',
    typeof f0 === 'number' && f0 > 0 && f0 <= 1, String(f0))

  // ── E · de oevrige klient-events er uroerte ──
  await ryd()
  for (const h of [
    { navn: 'filter_opened', props: {} },
    { navn: 'map_interaction', props: { slags: 'zoom' } },
    { navn: 'alert_started', props: {} },
    { navn: 'contact_click', listingId: BOLIG, props: { maal: 'mail' } },
  ] as Haendelse[]) {
    _saetDedup(new Set())
    // SID_UDEN med vilje: stikproeven maa kun raamme impressions.
    await spor(h, '/', { kontekst: K({ sessionId: SID_UDEN }) })
  }
  const oevrige = await raekker()
  tjek('6E · de fire oevrige klient-events skrives uaendret',
    oevrige.length === 4, `${oevrige.length}/4`)
  tjek('6E · og ingen af dem har faaet et sample_andel',
    oevrige.every((r) => !('sample_andel' in (r.properties as object))))

  if (pctFoer === undefined) delete process.env.MAALING_IMPRESSION_PCT
  else process.env.MAALING_IMPRESSION_PCT = pctFoer
  await ryd()
}

// ─── 7-8 · Alarmen ─────────────────────────────────────────────
{
  await ryd()
  // tilmeld() fejler paa mailen foer noget andet sker — og maa ikke fyre.
  const r = await tilmeld('ikke-en-mail', 'prøve', { postnr: '2300' } as Filtre)
  tjek('7 · alert_created fyrer ikke ved ugyldig mail',
    r.slags === 'ugyldig-mail' && (await raekker()).length === 0)

  // En rigtig soegning med et bekraeftelsestoken.
  const [u] = await db.insert(users).values({ email: 'proeve@bofinda.dk' }).returning()
  const [s] = await db.insert(savedSearches)
    .values({ userId: u!.id, name: 'prøve', criteria: { postnr: '2300', prisMax: 1200000 } })
    .returning({ id: savedSearches.id, token: savedSearches.confirmToken })

  await ryd()
  await bekraeft(s!.token!)
  const efter1 = (await raekker()).filter((x) => x.eventName === 'alert_confirmed')
  tjek('8 · alert_confirmed fyrer ved den reelle transition', efter1.length === 1)
  tjek('8 · filtertyper er NAVNE, ikke værdier',
    JSON.stringify(efter1[0]?.properties).includes('postnr')
    && !JSON.stringify(efter1[0]?.properties).includes('2300'))

  _saetDedup(new Set())
  await bekraeft(s!.token!) // mailscanneren aabner linket igen
  const efter2 = (await raekker()).filter((x) => x.eventName === 'alert_confirmed')
  tjek('8 · genåbning af et bekræftet link giver 0 nye events', efter2.length === 1,
    `${efter2.length} event(er)`)

  await db.delete(savedSearches).where(eq(savedSearches.id, s!.id))
  await db.delete(users).where(eq(users.id, u!.id))
}

// ─── 9 · canonical city ────────────────────────────────────────
{
  const kender = (by: string) => ['København S', 'Aarhus C'].includes(by)
  const kendt = uddrag({ by: 'København S' } as Filtre, kender)
  const ukendt = uddrag({ by: 'Hobbitton' } as Filtre, kender)
  tjek('9 · kendt by gemmes kanonisk',
    kendt.canonical_city === 'København S' && kendt.sted_slags === 'by_kendt')
  tjek('9 · ukendt by gemmes IKKE',
    ukendt.canonical_city === undefined && ukendt.sted_slags === 'by_ukendt')
  const kunPost = uddrag({ postnr: '2300' } as Filtre, kender)
  tjek('9 · postnummer vinder over by', kunPost.sted_slags === 'postnr')
}

// ─── 10-12 · Værnet ────────────────────────────────────────────
{
  const farlige: [string, unknown][] = [
    ['mailadresse', 'anna.hansen@example.dk'],
    ['telefonnummer', '+45 20 12 34 56'],
    ['JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'],
    ['Bearer-token', 'Bearer sk-hemmelig'],
    ['fremmed URL', 'https://www.propstep.com/da-DK/bolig/123'],
    ['for lang tekst', 'x'.repeat(121)],
  ]
  for (const [navn, v] of farlige) {
    const r = rens({ navn: 'homepage_view', props: { referrer_vaert: v } } as unknown as Haendelse, K())
    tjek(`10 · ${navn} afviser hele eventet`, !r.ok && r.fejl.grund === 'pii')
  }
  const egen = rens({ navn: 'homepage_view', props: { referrer_vaert: 'https://bofinda.dk/x' } } as unknown as Haendelse, K())
  tjek('10 · vores eget domæne er ikke en fremmed URL', egen.ok)

  // ── De to falske positiver, en rigtig koersel afsloerede ──────
  // Uden uuid-undtagelsen blev result_view_id laest som et telefonnummer,
  // og saa faldt search, search_results_view OG listing_impression alle
  // tre — hver eneste gang. Vaernet var saa strengt, at det slog hele
  // maalingen ihjel uden en fejl nogen steder.
  const medVisning = rens({
    navn: 'search',
    props: {
      result_count: 3, antal_filtre: 1, sorter: 'nyeste', sted_slags: 'postnr',
      result_view_id: 'f00dcafe-0000-4000-8000-000000000003',
    },
  }, K())
  tjek('10 · en uuid er ikke et telefonnummer', medVisning.ok,
    medVisning.ok ? '' : `${medVisning.fejl.grund}: ${medVisning.fejl.detalje}`)

  // Og et beloeb i oere maa heller ikke laeses som et nummer — derfor er
  // til/fra 'skalar' og baerer TAL, ikke strenge.
  const beloeb = rens({
    navn: 'filter_applied', props: { felt: 'prisMax', til: 12000000, fra: 20000000 },
  }, K())
  tjek('10 · et beløb i øre er ikke et telefonnummer', beloeb.ok)

  // Men et rigtigt nummer skal stadig fanges, ogsaa med adskillere.
  for (const nr of ['+45 20 12 34 56', '20123456', '(+45) 20-12-34-56']) {
    const r = rens({ navn: 'filter_applied', props: { felt: 'by', til: nr } }, K())
    tjek(`10 · «${nr}» fanges stadig`, !r.ok && r.fejl.grund === 'pii')
  }
  // Et postnummer er fire cifre og skal slippe igennem.
  tjek('10 · et postnummer er ikke et telefonnummer',
    rens({ navn: 'listing_view', props: { postnr: '2300' } }, K()).ok)

  // sted_slags skal med paa ALLE tre soegeevents — ellers kan
  // «hvor giver soegningen aldrig noget» ikke besvares paa empty_results.
  const tom = rens({ navn: 'empty_results', props: { antal_filtre: 2, sted_slags: 'by_ukendt' } }, K())
  tjek('10 · empty_results bærer sted_slags',
    tom.ok && tom.renset.raekke.properties.sted_slags === 'by_ukendt')

  const ukendt = rens(
    { navn: 'homepage_view', props: { boliger_i_alt: 5, hemmelighed: 'noget' } } as unknown as Haendelse, K())
  tjek('11 · ukendt property droppes, eventet skrives',
    ukendt.ok && ukendt.renset.droppedeNoegler.includes('hemmelighed')
    && !('hemmelighed' in ukendt.renset.raekke.properties)
    && ukendt.renset.raekke.properties.boliger_i_alt === 5)

  const mangler = rens({ navn: 'sort_changed', props: { til: 'pris_op' } } as unknown as Haendelse, K())
  tjek('12 · manglende påkrævet property afviser eventet',
    !mangler.ok && mangler.fejl.grund === 'manglende-property')

  const ukendtNavn = rens({ navn: 'favorite', props: {} } as unknown as Haendelse, K())
  tjek('12 · ukendt eventnavn afvises', !ukendtNavn.ok && ukendtNavn.fejl.grund === 'ukendt-event')

  const daarligRute = rens({ navn: 'homepage_view', props: {} }, K({ rute: '/hemmelig' as never }))
  tjek('12 · rute uden for RUTER afvises', !daarligRute.ok)

  tjek('12 · ingen allowlist-post hedder sted, by, mail eller navn',
    !Object.values(ALLOWLIST).some((s) =>
      ['sted', 'by', 'mail', 'email', 'navn', 'telefon', 'q'].some((k) => k in s)))
}

// ─── 13 · Fail-open ────────────────────────────────────────────
{
  await ryd()
  const rigtig = db.insert
  // En skriver, der altid kaster. Produktet maa ikke maerke det.
  ;(db as unknown as { insert: unknown }).insert = ((t: unknown) => {
    if (t === haendelser) throw new Error('analytics nede')
    return rigtig.call(db, t as never)
  }) as unknown as typeof db.insert
  let kastede = false
  try {
    await spor({ navn: 'homepage_view', props: {} }, '/')
    const r = await tilmeld('fejl@bofinda.dk', 'prøve', { postnr: '2300' } as Filtre)
    tjek('13 · produktet fortsætter, når analytics kaster',
      r.slags === 'sendt' || r.slags === 'spaerret', r.slags)
  } catch {
    kastede = true
  } finally {
    ;(db as unknown as { insert: unknown }).insert = rigtig
  }
  tjek('13 · spor() kaster aldrig videre', !kastede)
  await db.delete(users).where(eq(users.email, 'fejl@bofinda.dk'))
}

// ─── 14-17 · Samtykke og identitet ─────────────────────────────
{
  tjek('14 · uvalgt samtykke giver ingen plan', planFor(cookies({}), new Date()) === null)
  tjek('14 · nej giver ingen plan',
    planFor(cookies({ [C_SAMTYKKE]: 'nej' }), new Date()) === null)
  tjek('14 · laesSamtykke kender de tre tilstande',
    laesSamtykke(cookies({})) === 'uvalgt'
    && laesSamtykke(cookies({ [C_SAMTYKKE]: 'ja' })) === 'ja'
    && laesSamtykke(cookies({ [C_SAMTYKKE]: 'nej' })) === 'nej')

  const nu = new Date()
  const p1 = planFor(cookies({ [C_SAMTYKKE]: 'ja' }), nu)!
  tjek('15 · ja giver både anonymt id og session',
    Boolean(p1.anonymId) && Boolean(p1.sessionId) && p1.saet.length === 2)
  const p2 = planFor(cookies({
    [C_SAMTYKKE]: 'ja', [C_ANONYM]: p1.anonymId,
    [C_SESSION]: sessionVaerdi({ id: p1.sessionId, startMs: nu.getTime(), ny: false }),
  }), nu)!
  tjek('15 · identifikatorerne holder på tværs af requests',
    p2.anonymId === p1.anonymId && p2.sessionId === p1.sessionId)
  tjek('15 · kun sessionen fornys, ikke det anonyme id',
    p2.saet.length === 1 && p2.saet[0]!.navn === C_SESSION)

  // Tilbagetrækning: cookien er væk, og et nyt ja giver et NYT id.
  const efterNej = planFor(cookies({ [C_SAMTYKKE]: 'nej' }), nu)
  const nytJa = planFor(cookies({ [C_SAMTYKKE]: 'ja' }), nu)!
  tjek('16 · efter tilbagetrækning er der ingen plan', efterNej === null)
  tjek('16 · et nyt ja giver et ANDET anonymt id', nytJa.anonymId !== p1.anonymId)

  const gammel = sessionVaerdi({ id: p1.sessionId, startMs: nu.getTime() - SESSION_MAKS_MS - 1, ny: false })
  const fornyet = sessionFra(gammel, nu)
  tjek('17 · sessionen skifter på det absolutte loft (12 t)',
    fornyet.ny && fornyet.id !== p1.sessionId)
  const indenfor = sessionFra(
    sessionVaerdi({ id: p1.sessionId, startMs: nu.getTime() - 3600_000, ny: false }), nu)
  tjek('17 · en session inden for loftet består',
    !indenfor.ny && indenfor.id === p1.sessionId)
  tjek('17 · en ødelagt cookieværdi giver en ny session',
    sessionFra('noget-vaas', nu).ny && anonymFra('ikke-en-uuid').ny)
}

// ─── 18-19 · Miljø ─────────────────────────────────────────────
{
  await ryd()
  await spor({ navn: 'homepage_view', props: {} }, '/')
  const alle = await raekker()
  tjek('18 · alle rækker fra prøven er environment=proeve',
    alle.length > 0 && alle.every((r) => r.environment === 'proeve'))
  tjek('18 · ingen række er produktion',
    !alle.some((r) => r.environment === 'produktion'))
  tjek('18 · testbasen satte miljøet, prøven behøvede ikke huske det',
    miljoe() === 'proeve')

  const daarligt = rens({ navn: 'homepage_view', props: {} }, K({ miljoe: 'staging' as never }))
  tjek('19 · et miljø uden for enum\'en afviser eventet', !daarligt.ok)
  tjek('19 · enum\'en har præcis fire værdier', MILJOEER.length === 4)
}

// ─── 20 · Research-tagging ─────────────────────────────────────
{
  await ryd()
  _saetKontekst(K({ researchSessionId: 'p07' }))
  await spor({ navn: 'homepage_view', props: { boliger_i_alt: 3 } }, '/')
  const [r] = await raekker()
  tjek('20 · taggen følger med', r?.researchSessionId === 'p07')
  tjek('20 · eventet er ellers HELT normalt — ikke en parallel verden',
    r?.eventName === 'homepage_view' && r?.anonymousId === AID
    && r?.sessionId === SID && r?.environment === 'proeve')
  const forkert = rens({ navn: 'homepage_view', props: {} },
    K({ researchSessionId: 'anna hansen <anna@example.dk>' }))
  tjek('20 · et holdnummer med fritekst afvises', !forkert.ok)
  _saetKontekst(K())
}

// ─── 21-24 · Filterdiffen og referer-fælden ────────────────────
{
  const kender = (by: string) => by === 'Aarhus C'
  const parse = filtreFraParametre
  const base = 'https://bofinda.dk'
  const foer = forrigeFiltre(`${base}/?by=Aarhus+C`, base, parse)
  const nu = parse({ by: 'Aarhus C', prisMax: '12000' })
  const d = filterDiff(foer, nu, kender)
  tjek('21 · et tilføjet filter giver ét filter_applied',
    d.length === 1 && d[0]!.navn === 'filter_applied'
    && (d[0]!.props as { felt: string }).felt === 'prisMax')

  const tilbage = filterDiff(nu, parse({ by: 'Aarhus C' }), kender)
  tjek('21 · et fjernet filter giver ét filter_cleared',
    tilbage.length === 1 && tilbage[0]!.navn === 'filter_cleared')

  const sort = filterDiff(parse({ postnr: '2300' }), parse({ postnr: '2300', sorter: 'pris_op' }), kender)
  tjek('21 · en ændret sortering giver sort_changed',
    sort.length === 1 && sort[0]!.navn === 'sort_changed')

  // Panelets egen parameter maa ALDRIG kunne ses af filterevents. Den er
  // ren visning; udloeste den et filter_applied, ville et klik paa
  // «Søg» i det aabne panel ligne en filtrering, brugeren ikke foretog.
  tjek('21b · ?flere=1 er ikke et filter og giver ingen events',
    filterDiff(parse({ postnr: '2300' }), parse({ postnr: '2300', flere: '1' }), kender).length === 0
    && filterDiff(parse({ postnr: '2300', flere: '1' }), parse({ postnr: '2300' }), kender).length === 0)
  tjek('21b · ?flere=1 aendrer hverken harFiltre eller antal_filtre',
    harFiltre(parse({ flere: '1' })) === false
    && antalFiltre(parse({ postnr: '2300', flere: '1' })) === antalFiltre(parse({ postnr: '2300' })))
  tjek('21b · og heller ikke sammenfatningens tal',
    antalAvancerede(parse({ postnr: '2300', flere: '1' })) === 0)
  // Referer-vejen: en forrige side med ?flere=1 maa ikke give et cleared.
  tjek('21b · ?flere=1 i Referer giver ingen events',
    filterDiff(
      forrigeFiltre(`${base}/?postnr=2300&flere=1`, base, parse),
      parse({ postnr: '2300' }), kender).length === 0)

  const nulstil = filterDiff(
    parse({ by: 'Aarhus C', prisMax: '12000', vaerelser: '3', areal: '60', fuld: '1' }),
    parse({}), kender)
  tjek('22 · «Nulstil» kollapser til ÉT event',
    nulstil.length === 1 && nulstil[0]!.navn === 'filter_cleared'
    && (nulstil[0]!.props as { felt: string }).felt === 'alle'
    && (nulstil[0]!.props as { antal_ryddet: number }).antal_ryddet === 5)

  tjek('23 · ingen Referer → ingen filterevents',
    filterDiff(forrigeFiltre(null, base, parse), nu, kender).length === 0)
  tjek('23 · en fremmed oprindelse tæller ikke som forrige side',
    forrigeFiltre('https://www.google.com/search?q=lejebolig', base, parse) === null)
  tjek('23 · en anden sti end / tæller ikke',
    forrigeFiltre(`${base}/bolig/abc`, base, parse) === null)

  // ── Den vigtigste proeve i filen ──────────────────────────────
  // Vores egen URL baerer brugerens raa sted- og by-fritekst. Kommer den
  // ud i et event, er vaernet det eneste tilbage — og det skal den ikke
  // vaere afhaengig af.
  // Byen skal AENDRE SIG mellem de to URL'er. Ellers danner diffen intet
  // by-event, og saa er der ingenting at laekke igennem — proeven ville
  // vaere groen, uanset hvor galt det stod til. Det var praecis den fejl,
  // det bevidste brud «referer-fritekst i filter_applied.fra» afsloerede.
  const HEMMELIGT = 'Anna Hansen, Vestergade 12'
  const OGSAA_HEMMELIGT = 'Bo Jensen, Nørrebrogade 44'
  // Fra INGEN by til en ukendt by. To forskellige ukendte byer ville
  // begge blive til 'by_ukendt' og dermed ikke give en diff — og saa var
  // der stadig ingenting at laekke igennem.
  const medFritekst = forrigeFiltre(`${base}/?prisMax=9000`, base, parse)
  const events = filterDiff(
    medFritekst, parse({ sted: HEMMELIGT, prisMax: '9000' }), kender)
  void OGSAA_HEMMELIGT
  tjek('24 · diffen danner faktisk et by-event at prøve på',
    events.some((e) => (e.props as { felt?: string }).felt === 'by'),
    `${events.length} event(er)`)

  const tekst = JSON.stringify(events)
  const ord = ['Anna', 'Hansen', 'Vestergade', 'Bo', 'Jensen', 'Nørrebrogade']
  const laekker = ord.filter((x) => tekst.includes(x))
  tjek('24 · REFERER LÆKKER IKKE fritekst ind i et event',
    laekker.length === 0, laekker.length ? `fandt ${laekker.join(', ')} i ${tekst}` : '')
  tjek('24 · byen bliver til en kategori, ikke til teksten',
    tekst.includes('by_ukendt'))

  const u = uddrag(parse({ sted: HEMMELIGT }), kender)
  tjek('24 · uddrag() sender aldrig rå sted videre',
    !JSON.stringify(u).includes('Anna'))
  // Og hele vejen igennem vaernet, ikke kun i diffen.
  for (const e of events) {
    const r = rens(e, K())
    tjek(`24 · ${e.navn} med fritekst bag sig passerer værnet rent`,
      r.ok && !JSON.stringify(r.renset.raekke.properties).match(/Anna|Hansen|Jensen/))
  }
}

// ─── 25-26 · Retention og aggregat ─────────────────────────────
{
  await ryd()
  const gammel = new Date(Date.now() - 400 * 24 * 3600 * 1000)
  const iMorgen = new Date(Date.now() + 24 * 3600 * 1000)
  const basis = {
    eventName: 'homepage_view', environment: 'proeve', anonymousId: AID,
    sessionId: SID, route: '/', properties: {},
  }
  await db.insert(haendelser).values([
    { ...basis, occurredAt: gammel, expiresAt: gammel },
    { ...basis, occurredAt: new Date(), expiresAt: iMorgen },
  ])
  const slettet = await ryddHaendelser()
  const tilbage = await raekker()
  tjek('25 · udløbne rækker slettes faktisk', slettet === 1 && tilbage.length === 1)
  tjek('25 · rækker med fremtidig udløbsdato bliver',
    tilbage[0]!.expiresAt.getTime() === iMorgen.getTime())

  tjek('25 · udløbsklassen er den KORTESTE frist',
    Math.round((udloeb('listing_impression', null, new Date()).getTime() - Date.now()) / 86400000) === 60
    && Math.round((udloeb('search', 'p07', new Date()).getTime() - Date.now()) / 86400000) === 90
    && Math.round((udloeb('listing_impression', 'p07', new Date()).getTime() - Date.now()) / 86400000) === 60
    && Math.round((udloeb('search', null, new Date()).getTime() - Date.now()) / 86400000) === 365)

  await ryd()
  _saetDedup(new Set())
  await spor({ navn: 'listing_view', listingId: '44444444-4444-4444-8444-444444444444', sourceSlug: 'cej', props: {} }, '/bolig/[id]')
  const n = await opdaterDagsaggregat()
  const [agg] = await db.select().from(haendelserDaglig)
  tjek('26 · dagsaggregatet skrives', n >= 1 && agg?.eventName === 'listing_view')
  tjek('26 · aggregatet bærer kilden og andelen',
    agg?.sourceSlug === 'cej' && Number(agg?.sampleAndel) === 1)
  await db.delete(haendelserDaglig)
}

// ─── 27 · Tændknappen ──────────────────────────────────────────
{
  await ryd()
  saetAktiv(false)
  await spor({ navn: 'homepage_view', props: {} }, '/')
  tjek('27 · MAALING_AKTIV slået fra → ingenting skrives',
    (await raekker()).length === 0)
  saetAktiv(true)
  _saetDedup(new Set())
  await spor({ navn: 'homepage_view', props: {} }, '/')
  tjek('27 · slået til → der skrives igen', (await raekker()).length === 1)
}

// ─── 28 · Server Action-revalidering maa ikke tælle som visning ─
//
//  Fejlen, den fanger, er maalt i produktion 7. september 2026: ét besoeg
//  paa en native bolig plus ét klik paa «Vis kontaktoplysninger» gav TO
//  listing_view. Next koerer sidekomponenten igen som del af svaret paa
//  en Server Action, og den rendering er ikke en sidevisning.
//
//  Headerne er maalt med en sonde mod en rigtig Next-server:
//    navigation                 GET,  next-action: null
//    Server Action-revalidering POST, next-action: 4042a2540e1ee29a68…
{
  const INGEN: Record<string, string> = {}
  const ACTION = { 'next-action': '4042a2540e1ee29a68e80f9d41c0' }
  const PREFETCH = { 'next-router-prefetch': '1' }
  const RSC = { rsc: '1' }
  const laeser = (m: Record<string, string>) => (n: string) => m[n]

  tjek('28 · en almindelig navigation er en visning',
    erGenrendering(laeser(INGEN)) === false)
  tjek('28 · Server Action-revalidering er det IKKE',
    erGenrendering(laeser(ACTION)) === true)
  tjek('28 · prefetch er det heller ikke',
    erGenrendering(laeser(PREFETCH)) === true)
  tjek('28 · en klientside-navigation (rsc) ER en visning',
    erGenrendering(laeser(RSC)) === false,
    'ellers ville next/link en dag tie hele listing_view ihjel')

  // ── REGRESSIONEN ──────────────────────────────────────────────
  // Hele forloebet: brugeren navigerer til boligsiden, og trykker saa
  // paa knappen. Handlingen fyrer contact_reveal OG faar siden renderet
  // igen — den anden rendering maa ikke give et listing_view mere.
  const BOLIG = '55555555-5555-4555-8555-555555555555'
  const visning = (): Haendelse => ({
    navn: 'listing_view', listingId: BOLIG, sourceSlug: 'native',
    props: { postnr: '2200', egen_annonce: true },
  })

  await ryd()
  _saetHoveder(laeser(INGEN))            // 1. rigtig navigation
  await spor(visning(), '/bolig/[id]')

  _saetDedup(new Set())
  _saetHoveder(laeser(ACTION))           // 2. klik paa knappen
  await spor(visning(), '/bolig/[id]')                    // sidens genrendering
  await spor({ navn: 'contact_reveal', listingId: BOLIG,
    props: { har_mail: true, har_telefon: false } }, '/bolig/[id]')

  const efter = await raekker()
  const antal = (n: string) => efter.filter((x) => x.eventName === n).length
  tjek('28 · ét besøg + ét kontaktklik = ÉN listing_view',
    antal('listing_view') === 1, antal('listing_view') + ' listing_view')
  tjek('28 · contact_reveal fyrer stadig fra handlingen',
    antal('contact_reveal') === 1, antal('contact_reveal') + ' contact_reveal')

  // Et reload er en rigtig visning og skal stadig taelle.
  _saetDedup(new Set())
  _saetHoveder(laeser(INGEN))
  await spor(visning(), '/bolig/[id]')
  tjek('28 · reload tæller stadig som en visning',
    (await raekker()).filter((x) => x.eventName === 'listing_view').length === 2)

  // Handlingsevents maa ALDRIG staa paa render-listen.
  const handlinger = ['contact_reveal', 'contact_click', 'alert_created',
    'alert_confirmed', 'signup_started', 'signup_completed', 'login_completed',
    'server_action_failed'] as const
  tjek('28 · ingen handlingsevents på render-listen',
    !handlinger.some((n) => (RENDEREVENTS as readonly string[]).includes(n)))

  // Og source_click er uroert: den er sin egen rute, ikke en rendering.
  await ryd()
  _saetHoveder(laeser(ACTION))
  await spor({ navn: 'source_click', listingId: BOLIG, sourceSlug: 'home',
    props: { maal: 'kilde' } }, '/go/[id]')
  tjek('28 · source_click rammes ikke af vagten',
    (await raekker()).length === 1)

  _saetHoveder(null)
}

// ─── 29 · Pagineringens valgfri metadata ───────────────────────
//
// Felterne er VALGFRI, og det er kontrakten, ikke sjusk: et `kraevet`-felt,
// som en afsender ikke sender, draeber eventet lydloest. Det kostede hver
// eneste listing_impression i tre uger, og en halvt udrullet frontend ville
// koste det samme igen.
{
  const RVI = '1f6e6c5a-38d4-4e6e-b807-ec0ed55f140a'
  const P = (ekstra: Record<string, unknown>): Haendelse => ({
    navn: 'search_results_view',
    props: {
      result_count: 412, viste_antal: 48, viste_pr_kilde: { propstep: 30 },
      result_view_id: RVI, sted_slags: 'ingen', ...ekstra,
    },
  } as unknown as Haendelse)

  const gammel = rens(P({}), K())
  tjek('29 · en payload UDEN de nye felter accepteres uændret',
    gammel.ok && gammel.renset.raekke.properties.side === undefined
    && gammel.renset.ufuldstaendigeNoegler.length === 0)

  const god = rens(P({ side: 2, sider_i_alt: 9, komplet: true }), K())
  tjek('29 · gyldige pagineringsfelter accepteres',
    god.ok && god.renset.raekke.properties.side === 2
    && god.renset.raekke.properties.sider_i_alt === 9
    && god.renset.raekke.properties.komplet === true)

  // En `Number('abc')` er NaN, en `Number('')` er 0, og begge ville slippe
  // igennem et blot `typeof === 'number'`. Derfor heltal og nedre graense.
  const ugyldige: Record<string, unknown>[] = [
    { side: 0 }, { side: -1 }, { side: 1.5 }, { side: Number.NaN },
    { side: Number.POSITIVE_INFINITY }, { side: '2' }, { side: true },
    { sider_i_alt: -1, komplet: true }, { sider_i_alt: 2.5, komplet: true },
    { sider_i_alt: '9', komplet: true },
    { komplet: 'true' }, { komplet: 1 },
  ]
  let afvist = 0
  for (const props of ugyldige) {
    const r = rens(P(props), K())
    if (!r.ok && r.fejl.grund === 'forkert-type') afvist++
  }
  tjek('29 · alle tolv ugyldige værdier afvises som forkert-type',
    afvist === ugyldige.length, `${afvist}/${ugyldige.length}`)

  // Komplethedsreglen. Et afkortet kortantal giver ikke et eksakt sideantal.
  for (const [navn, ekstra] of [
    ['komplet er false', { side: 2, sider_i_alt: 9, komplet: false }],
    ['komplet er slet ikke oplyst', { side: 2, sider_i_alt: 9 }],
  ] as [string, Record<string, unknown>][]) {
    const r = rens(P(ekstra), K())
    tjek(`29 · sider_i_alt droppes, når ${navn}`,
      r.ok && r.renset.raekke.properties.sider_i_alt === undefined
      && r.renset.raekke.properties.side === 2
      && r.renset.ufuldstaendigeNoegler.includes('sider_i_alt')
      && r.renset.droppedeNoegler.length === 0)
  }

  // En side uden kort er ikke en søgning uden boliger. Formen SKAL forblive
  // lovlig, ellers «retter» nogen den ved at kræve viste_antal > 0.
  const udenfor = rens(P({
    side: 99, sider_i_alt: 9, komplet: true, viste_antal: 0, viste_pr_kilde: {},
  }), K())
  tjek('29 · side uden for rækkevidde er en LOVLIG resultatvisning',
    udenfor.ok && udenfor.renset.raekke.properties.viste_antal === 0
    && udenfor.renset.raekke.properties.result_count === 412
    && udenfor.renset.raekke.properties.side === 99)

  // Alle tre søgeevents skal kunne bære dem — ellers ville side 2 med nul
  // resultater tabe sit sidetal.
  const treEvents: Haendelse[] = [
    { navn: 'search', props: { result_count: 0, antal_filtre: 1, sorter: 'nyeste',
      sted_slags: 'ingen', side: 3, sider_i_alt: 0, komplet: true } },
    { navn: 'search_results_view', props: { result_count: 412, viste_antal: 48,
      viste_pr_kilde: { propstep: 30 }, result_view_id: RVI, side: 3,
      sider_i_alt: 9, komplet: true } },
    { navn: 'empty_results', props: { antal_filtre: 1, side: 3, sider_i_alt: 0,
      komplet: true } },
  ] as unknown as Haendelse[]
  tjek('29 · search, search_results_view og empty_results bærer alle tre felter',
    treEvents.every((h) => {
      const r = rens(h, K())
      return r.ok && r.renset.raekke.properties.side === 3
        && r.renset.raekke.properties.komplet === true
    }))
}

// ─── 30 · search_submitted ─────────────────────────────────────
//
// En OBSERVERET indsendelse af søgeformularen. Serveren kan ikke se forskel
// på en formularindsendelse og et klik på «Næste» — begge er en
// GET-navigation med de samme headere — så den observeres i browseren
// eller slet ikke.
{
  await ryd()
  _saetDedup(new Set())
  await spor({ navn: 'search_submitted', props: {} }, '/')
  const [ss] = await raekker()
  tjek('30 · search_submitted skrives', ss?.eventName === 'search_submitted')
  tjek('30 · og bærer INGEN properties — heller ikke et filterantal',
    JSON.stringify(ss?.properties) === '{}')

  tjek('30 · den er et KLIENTevent, så /api/maaling lukker den ind',
    (KLIENTEVENTS as readonly string[]).includes('search_submitted'))
  tjek('30 · den er IKKE et renderevent — vagten mod genrendering rammer den ikke',
    !(RENDEREVENTS as readonly string[]).includes('search_submitted'))

  // Fremmed indhold fra en beacon naar aldrig raekken.
  const stray = rens({ navn: 'search_submitted',
    props: { sted: 'Anna Hansen, Vestergade 12' } } as unknown as Haendelse, K())
  tjek('30 · en fritekst-property droppes, og teksten når ikke rækken',
    stray.ok && JSON.stringify(stray.renset.raekke.properties) === '{}'
    && stray.renset.droppedeNoegler.includes('sted'))

  // Stikproeven er impressionernes, ikke handlingernes.
  const pctFoer = process.env.MAALING_IMPRESSION_PCT
  process.env.MAALING_IMPRESSION_PCT = '0'
  await ryd()
  _saetDedup(new Set())
  await spor({ navn: 'search_submitted', props: {} }, '/')
  tjek('30 · en stikprøve på 0 % rammer IKKE search_submitted',
    (await raekker()).length === 1)
  if (pctFoer === undefined) delete process.env.MAALING_IMPRESSION_PCT
  else process.env.MAALING_IMPRESSION_PCT = pctFoer

  // Uden kontekst — intet samtykke, ingen identifikatorer — skrives intet.
  await ryd()
  _saetKontekst(null)
  _saetDedup(new Set())
  await spor({ navn: 'search_submitted', props: {} }, '/')
  tjek('30 · uden samtykke/kontekst skrives der ingenting',
    (await raekker()).length === 0)
  _saetKontekst(K())

  // Dagsaggregatet skal kunne baere den UDEN en schemaaendring.
  await ryd()
  _saetDedup(new Set())
  await spor({ navn: 'search_submitted', props: {} }, '/')
  await opdaterDagsaggregat()
  const agg = (await db.select().from(haendelserDaglig))
    .find((r) => r.eventName === 'search_submitted')
  tjek('30 · dagsaggregatet dækker det nye event uden skemaændring',
    Boolean(agg) && agg?.antal === 1 && Number(agg?.sampleAndel) === 1,
    agg ? `antal=${agg.antal} andel=${agg.sampleAndel}` : 'ingen række')
  await db.delete(haendelserDaglig)

  // Retention: en handling, ikke en impression. 365 dage, ikke 60.
  tjek('30 · udløbsklassen er produktets, ikke impressionernes',
    Math.round((udloeb('search_submitted', null, new Date()).getTime() - Date.now())
      / 86400000) === 365)
}

// ─── Oprydning ─────────────────────────────────────────────────
await ryd()
_saetHoveder(null)
_saetKontekst(null)
saetAktiv(null)
saetMiljoe(null)

console.log(`\n${fejl === 0 ? '  ALT GRØNT' : `  ${fejl} FEJL`}\n`)
if (fejl) process.exit(1)
