// ═══════════════════════════════════════════════════════════════
//  To ting, der er dyre at bryde uden at opdage det:
//
//    1. Rundturen — gem uden at ændre noget, og se om rækken overlever.
//    2. At en udlejerannonce ALDRIG havner i en alarmmail.
//    3. At maerkatet paa Mine annoncer siger sandheden om synlighed.
//    4. At usynlige tegn ikke kan give en adressenoegle uden vejnavn.
//    5. At vej, husnummer og doer ikke kan degenerere noeglen.
//    6. At udlejerens faciliteter naar frem til filtrene.
//    7. At facilitetsfiltrene oplyser deres eget grundlag rigtigt.
//    8. At billedraekkefoelgen overlever hele vejen til soegeresultatet.
//    9. At en groen total ALDRIG kan staa uden at el er gjort rede for.
//   10. At et kort uden VISBART billede faar klassen uden-billede.
//   11. At en samlet aconto ALDRIG faar saetningen "El indgaar ikke".
//   12. At to udlejere paa samme vej bliver to kort, ikke ét.
//
//  Fejlen den fanger: redigér-formularen indlæste ikke alle felter, og et
//  gem skrev tomme værdier hen over de gemte. En udlejer, der rettede en
//  stavefejl, mistede sin indflytningspris uden at få det at vide.
//
//  Testen er billig og fanger hele klassen: hvert felt fyldes med en
//  værdi, rækken læses tilbage gennem SAMME afbildning som siden bruger,
//  gemmes uændret — og sammenlignes kolonne for kolonne.
//
//    npm test
// ═══════════════════════════════════════════════════════════════

import { and, eq, sql as dsql } from 'drizzle-orm'
import { db, luk } from '../db/client'
import { alertMatches, crawlRuns, listingImages, listings, savedSearches, sources, users } from '../db/schema'
import { matchAlarmer } from '../lib/alarm'
import { byForPostnr } from '../lib/omraade'
import { laesBolig as dacasLaes } from '../adapters/dacas'
import { KILDEKONTRAKTER } from '../lib/kildekontrakt'
import { forklar, fortolkAvailability } from '../lib/availability'
import type { AvailabilityFacts } from '../lib/adapter'
import { tjekRettigheder } from './tjek-rettigheder'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Gruppekort, Kort } from '../app/Boligkort'
import { billedUrl, TILLADTE_VAERTER } from '../lib/billede'
import { eltilstand } from '../lib/eloplysning'
import type { Bolig, Filtre, Gruppe } from '../lib/soeg'
import {
  facilitetsgrundlag, hvor, NYHEDSDATO, oekonomigrundlag, opsummering, soeg,
  soegGrupperet, tavseKilder, udenDubletter,
} from '../lib/soeg'
import { FACILITET } from '../lib/faciliteter'
import {
  mineBoliger, opdaterBolig, opretBolig, renTekst, somFormular, tjekAdresse,
  type Boliginput,
} from '../lib/udlejer'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

/**
 * Proever, der maaler forhold i det RIGTIGE udbud — at postnumre har
 * bynavne, at der findes tavse kilder, at de ukendte falder ud af et
 * filter. De forhold findes ikke paa en tom testbase.
 *
 * De SPRINGES OVER, de laves ikke om. En proeve, der bestaar paa en tom
 * base, er ikke en proeve — den er et groent flueben uden daekning, og det
 * er vaerre end ingenting, fordi nogen tror, den holder. Derfor skrives
 * hver overspringning ud, og antallet staar i bunden.
 */
const MOD_PRODUKTION = process.env.BOFINDA_PROEV_PRODUKTION === '1'
let sprunget = 0
const tjekProd = async (
  navn: string, kald: () => boolean | Promise<boolean>, note?: () => string | Promise<string>,
) => {
  if (!MOD_PRODUKTION) {
    sprunget++
    console.log(`  ⊘ ${navn}  — kræver rigtige data (npm run test:prod)`)
    return
  }
  tjek(navn, await kald(), note ? await note() : '')
}

/** En vaert vi FAKTISK kan vise fra, og en vi ikke kan. */
const VIST_VAERT = 'https://app.propstep.com/api/image/find-public'
const SKJULT_VAERT = 'https://ikke-i-allowlisten.invalid'

/** Alt udfyldt. Et felt der er tomt i proeven, tester ingenting. */
const FULDT: Boliginput = {
  vej: 'Prøvevej', husnr: '12 B', etage: '3', doer: 'tv',
  postnr: '2200', by: 'København N',
  boligtype: 'lejlighed', areal: 78, vaerelser: 3,
  husleje: 1200000, varme: 100000, vand: 50000, el: 20000, oevrig: 15000,
  depositum: 2500000, forudbetalt: 2000000,
  ledigFra: '2026-12-01',
  beskrivelse: 'Udlejerens egen tekst, som ikke må blive skrevet om.',
  kontaktMail: 'udlejer@example.com', kontaktTlf: '12345678',
  faciliteter: ['elevator', 'altan'],
  // Vaerten SKAL staa i TILLADTE_VAERTER. Ligger billederne et sted, vi
  // ikke kan vise fra, taeller de nu nul — se VISBAR_VAERT i lib/soeg.ts.
  billeder: [`${VIST_VAERT}/1.jpg`, `${VIST_VAERT}/2.jpg`],
}

/** Kolonner en redigering ikke må røre, og som derfor skal være ens. */
const SAMMENLIGN = [
  'addressRaw', 'street', 'houseNumber', 'floor', 'door', 'postalCode', 'city',
  'unitAddressUuid', 'accessAddressUuid', 'addressMatchLevel',
  'propertyType', 'sizeM2', 'rooms', 'availableFrom',
  'rentMonthly', 'utilitiesHeat', 'utilitiesWater', 'utilitiesElectricity',
  'utilitiesOther', 'totalMonthly', 'totalMonthlyComponents',
  'deposit', 'prepaidRent', 'moveInCost',
  'description', 'contactEmail', 'contactPhone',
  'sourceType', 'landlordId', 'sourceId', 'externalKey', 'sourceUrl',
  'isBlurred', 'status', 'firstSeenAt', 'amenities', 'lat', 'lng',
] as const

const ens = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
  const [u] = await db.insert(users)
    .values({ email: `test-redigering-${Date.now()}@example.com`, role: 'landlord' })
    .returning()
  const udlejer = { id: u!.id, authUserId: 'test', email: u!.email, navn: null }
  let id = ''
  let rivalId = ''
  let proevekildeId = ''
  const ekstra: { boliger: string[]; brugere: string[]; kilder: string[] } =
    { boliger: [], brugere: [], kilder: [] }

  // ── Usynlige tegn ────────────────────────────────────────────
  // trim() fjerner mellemrum, ogsaa NBSP, men ikke tegn der er nul
  // enheder brede. Et vejnavn paa ét zero-width space slap foer igennem
  // valideringen og gav noeglen `intern:v3:2200::30` — uden vejnavn. To
  // saadanne annoncer blev den samme bolig.
  console.log('\n══ usynlige tegn må ikke overleve som vejnavn ══')
  tjek('zero-width space bliver tom', renTekst('\u200b') === '')
  tjek('BOM bliver tom', renTekst('\ufeff') === '')
  tjek('blødt bindestreg bliver tomt', renTekst('\u00ad') === '')
  tjek('retningsmarkør bliver tom', renTekst('\u202e') === '')
  tjek('NBSP bliver tom (trim tog den i forvejen)', renTekst('\u00a0') === '')
  tjek('tegn inde i et ord fjernes', renTekst('Nørre\u200bbrogade') === 'Nørrebrogade')
  tjek('et rigtigt vejnavn røres ikke', renTekst('  Nørrebrogade  ') === 'Nørrebrogade')
  tjek('bindestreg i vejnavn overlever', renTekst('Ryesgade-Nord') === 'Ryesgade-Nord')

  // ── Vej, husnummer og doer ───────────────────────────────────
  // Alle tre kan degenerere adressenoeglen, og en degenereret noegle
  // slaar to forskellige boliger sammen til én. Reglen skal maale paa
  // det SAMME som noeglen, ikke paa noget der ligner.
  console.log('\n══ adressefelter der ville ødelægge nøglen ══')
  const ok = (n: string, i: Partial<Parameters<typeof tjekAdresse>[0]>) =>
    tjekAdresse({ vej: 'Prøvevej', husnr: '12', postnr: '2200', doer: null, ...i }) === null
  tjek('almindelig adresse går igennem', ok('', {}))
  tjek('Ø som vejnavn går igennem (ét bogstav, æøå)', ok('', { vej: 'Ø' }))
  tjek('Østerbrogade går igennem', ok('', { vej: 'Østerbrogade' }))
  tjek('🏠 afvises som vejnavn', !ok('', { vej: '🏠' }))
  tjek('--- afvises som vejnavn', !ok('', { vej: '---' }))
  tjek('... afvises som vejnavn', !ok('', { vej: '...' }))
  tjek('kyrillisk vejnavn afvises (tomt i nøglen)', !ok('', { vej: 'Улица' }))
  tjek('husnr 56 B går igennem', ok('', { husnr: '56 B' }))
  tjek('husnr - afvises', !ok('', { husnr: '-' }))
  tjek('husnr . afvises', !ok('', { husnr: '.' }))
  tjek('husnr "ukendt" afvises', !ok('', { husnr: 'ukendt' }))
  tjek('dør tv går igennem', ok('', { doer: 'tv' }))
  tjek('dør t.v. går igennem', ok('', { doer: 't.v.' }))
  tjek('dør 3 går igennem', ok('', { doer: '3' }))
  tjek('dør a går igennem', ok('', { doer: 'a' }))
  tjek('tom dør går igennem', ok('', { doer: null }))
  tjek('dør - afvises', !ok('', { doer: '-' }))
  tjek('dør "for enden af gangen" afvises', !ok('', { doer: 'for enden af gangen' }))

  // ── Byen udledes af postnummeret ─────────────────────────────
  // ── Ingen tabel maa staa aaben ───────────────────────────────
  // Supabase giver anon og authenticated arwdDxtm paa FREMTIDIGE
  // tabeller i public, og pgrst_ddl_watch eksponerer dem uden
  // forsinkelse. De 12, der findes, er kun daekket, fordi tre
  // migrationer huskede revoke. Her maales basen, ikke filerne.
  console.log('\n══ rettigheder i public ══')
  const aabne = await tjekRettigheder()
  tjek('intet i public er åbent for anon eller authenticated',
    aabne.length === 0,
    aabne.map((f) => `${f.slags} ${f.navn}: ${f.grund.split(' — ')[0]}`).join(' · '))

  // ── En ukendt billedvaert forsvinder tavst ───────────────────
  // Har en aktiv bolig billedraekker, men ingen af dem paa en vaert i
  // TILLADTE_VAERTER, returnerer billedUrl() null, og billederne
  // forsvinder uden en fejl nogen steder. Det er sket tre gange:
  // dacas.dk (177 billeder), Balder (Contentful), og home.dk, hvor
  // kilden brugte TO vaerter og gennemgangen fandt kun den ene —
  // 25 boliger med 249 billeder stod uden.
  //
  // Kraever rigtige data: paa en tom testbase er der ingen boliger at
  // maale paa, og proeven ville bestaa uden at have set noget.
  console.log('\n══ ingen bolig må have billeder på en ukendt vært ══')
  // Raa SQL med vores egne aliaser: forespoergslen skal naevne den samme
  // tabel to gange — én gang for at faa vaertsnavnet frem, og én gang i
  // `not exists` for at afgoere, om boligen har NOGEN visbar vaert.
  let tabte: { vaert: string; boliger: number }[] = []
  await tjekProd('ingen aktiv bolig har billeder på en ukendt vært',
    async () => {
      const r = await db.execute(dsql`
        select substring(li.external_url from '^https?://([^/?#]+)') as vaert,
               count(distinct l.id)::int as boliger
        from listings l
        join listing_images li on li.listing_id = l.id
        where l.status = 'active'
          and not exists (
            select 1 from listing_images i2
            where i2.listing_id = l.id
              and substring(i2.external_url from '^https?://([^/?#]+)') = any(${
                dsql`array[${dsql.join([...TILLADTE_VAERTER].map((v) => dsql`${v}`), dsql`, `)}]::text[]`}))
        group by 1 order by 2 desc`)
      tabte = ((r as unknown as { rows?: typeof tabte }).rows ?? (r as unknown as typeof tabte))
      return tabte.length === 0
    },
    () => tabte.map((t) => `${t.vaert}: ${t.boliger} boliger`).join(' · '))

  // Den bogstavelige udgave, som kun giver mening med et rigtigt udbud:
  // ingen enkelt kilde maa tage hele forsiden. Det gjorde home.dk — 48 af
  // 48 — den dag den blev koblet paa.
  console.log('\n══ ingen enkelt kilde må tage hele forsiden ══')
  let fordeling: [string, number][] = []
  await tjekProd('ingen kilde har alle 48 kort på forsiden',
    async () => {
      const m = new Map<string, number>()
      for (const v of await soegGrupperet({})) {
        const bo = v.slags === 'gruppe' ? v.gruppe.repraesentant : v.bolig
        const k = String((bo as Record<string, unknown>).kilde ?? '?')
        m.set(k, (m.get(k) ?? 0) + 1)
      }
      fordeling = [...m].sort((x, y) => y[1] - x[1])
      return fordeling.length > 1
    },
    () => fordeling.map(([k, n]) => `${k} ${n}`).join(' · '))

  console.log('\n══ byen udledes af postnummeret ══')
  await tjekProd('2200 giver et bynavn',
    async () => (await byForPostnr('2200')) !== null,
    async () => String(await byForPostnr('2200')))
  tjek('et ukendt postnummer giver null', (await byForPostnr('0001')) === null)

  // ── En grøn total må aldrig staa uden el-forbehold ───────────
  // Prisblokken bliver GROEN (.kort-pris uden .kun-leje), saa snart
  // `total` er sat — uanset hvad totalen daekker. Er el ikke med i den,
  // SKAL kortet sige det. Enkeltkortet gjorde det; gruppekortet gjorde
  // ikke, og det stod 171 steder over 675 boliger uden at nogen saa det.
  //
  // Proeven gengiver de rigtige komponenter frem for at laese koden. En
  // test paa betingelsen ville bestaa, selv om linjen blev flyttet ud af
  // det groenne korts gren.
  console.log('\n══ grøn total kræver el-forbehold ══')
  const ELTEKST = /El indgår ikke|el afregnes direkte/
  const GROEN = /class="kort-pris"/

  const bolig = (o: Partial<Bolig>): Bolig => ({
    id: 'b1', adresse: 'Prøvevej 1, 2. tv, 2200 København N', vej: 'Prøvevej',
    husnr: '1', etage: '2', doer: 'tv', postnr: '2200', by: 'København N',
    type: 'lejlighed', areal: 80, vaerelser: 3, ledigFra: null,
    leje: 1200000, varme: 60000, vand: 40000, el: null, elEgenMaaler: null,
    oevrig: null, total: 1300000, poster: ['rent', 'heat', 'water'],
    indflytning: null, ansoegning: null, match: 'unit', lat: null, lng: null,
    foerstSet: new Date(), hosKilden: null, url: 'https://eksempel.invalid/1',
    kilde: 'proeve', kildeNavn: 'Prøve', kildetype: 'feed',
    ogsaaHos: [], billeder: 0, forside: null,
    ...o,
  } as unknown as Bolig)

  const gruppe = (o: Partial<Gruppe>, n: Partial<Bolig> = {}): Gruppe => ({
    noegle: { kilde: 'proeve', postnr: '2200', vej: 'Prøvevej', vaerelser: 3, total: true },
    antal: 3, repraesentant: bolig(n), prisMin: 1300000, prisMax: 1500000,
    arealMin: 70, arealMax: 90, type: 'lejlighed', ledigMin: null, ledigMax: null,
    ledigUkendte: 0, indflytningMin: null, indflytningMax: null,
    ensPoster: true, alleOgsaaAndetsteds: false, nyesteMarkedet: new Date(),
    nogenUdenEl: true, alleUdenElHarEgenMaaler: false, nogenUkendtDaekning: false,
    ...o,
  } as unknown as Gruppe)

  const vis = (el: React.ReactElement) => renderToStaticMarkup(el)

  // ── Availability: fakta, ikke stemmer ────────────────────────
  // Fast referenceNow. Funktionen kalder aldrig systemuret — samme lære
  // som Dacas-fejlen, hvor «Snarest» blev til vores eget ur.
  console.log('\n══ availability: de syv kilder ══')
  const NU = new Date('2026-09-05T12:00:00Z')
  const D = (iso: string) => new Date(iso)
  type Sag = {
    navn: string; kilde: string; fakta: AvailabilityFacts
    marked?: string; timing?: string; ansoegning?: string; adgang?: string[]
  }
  const SAGER: Sag[] = [
    // ── Balder: «Ledig» alene betyder IKKE «nu» ──
    { navn: 'A balder Ledig + dato i fortiden', kilde: 'balder',
      fakta: { rawStatus: 'Ledig', sourceAvailabilityDate: D('2026-08-01') },
      marked: 'paa_markedet', timing: 'nu' },
    { navn: 'B balder Ledig + dato i fremtiden', kilde: 'balder',
      fakta: { rawStatus: 'Ledig', sourceAvailabilityDate: D('2026-12-15') },
      marked: 'paa_markedet', timing: 'senere' },
    { navn: 'C balder Reserveret uden dato', kilde: 'balder',
      fakta: { rawStatus: 'Reserveret' },
      marked: 'reserveret', timing: 'unknown' },
    // ── Propstep: den gamle dato maa ALDRIG paavirke timing ──
    { navn: 'D propstep Available + dato fra 2002', kilde: 'propstep',
      fakta: { rawStatus: 'Available', sourceAvailabilityDate: D('2002-08-31') },
      marked: 'paa_markedet', timing: 'unknown' },
    { navn: 'E propstep Reserved', kilde: 'propstep',
      fakta: { rawStatus: 'Reserved' }, marked: 'reserveret', timing: 'unknown' },
    { navn: 'F propstep Unknown', kilde: 'propstep',
      fakta: { rawStatus: 'Unknown' },
      marked: 'unknown', timing: 'unknown', ansoegning: 'unknown' },
    { navn: 'G propstep uden ansøgningsform', kilde: 'propstep',
      fakta: { rawStatus: 'Available' }, ansoegning: 'unknown' },
    // ── home.dk: to enige signaler er ÉN konklusion ──
    { navn: 'H home nu-boolean + dato passeret', kilde: 'home',
      fakta: { rentalAvailableNow: true, sourceAvailabilityDate: D('2026-09-01') },
      timing: 'nu' },
    { navn: 'I home falsk boolean + dato i fremtiden', kilde: 'home',
      fakta: { rentalAvailableNow: false, sourceAvailabilityDate: D('2026-10-01') },
      timing: 'senere' },
    // ── KERNEPRØVEN: uenige signaler bliver conflict, ikke et valg ──
    { navn: 'J home KONFLIKT: boolean sand, dato i fremtiden', kilde: 'home',
      fakta: { rentalAvailableNow: true, sourceAvailabilityDate: D('2026-12-01') },
      timing: 'conflict' },
    { navn: 'home bopælskrav', kilde: 'home',
      fakta: { residencyRequired: true }, adgang: ['bopaelskrav'] },
    // ── findbolig: den eneste kilde med ansoegningsform ──
    { navn: 'K findbolig Regular', kilde: 'findbolig',
      fakta: { rawApplicationType: 'Regular', sourceAvailabilityDate: D('2026-08-01') },
      ansoegning: 'normal', timing: 'unknown' },
    { navn: 'L findbolig WaitingList', kilde: 'findbolig',
      fakta: { rawApplicationType: 'WaitingList', sourceAvailabilityDate: D('2026-08-01') },
      ansoegning: 'venteliste', timing: 'unknown' },
    // ── Dacas: teksten giver timing, ingen dato opstaar ──
    { navn: 'M dacas Snarest', kilde: 'dacas',
      fakta: { takeoverText: 'Snarest' }, timing: 'nu' },
    // ── LokalBolig: tomt statusobjekt, uafklaret dato ──
    { navn: 'N lokalbolig tomt + uafklaret dato', kilde: 'lokalbolig',
      fakta: { rawStatus: '', sourceAvailabilityDate: D('2026-08-01') },
      marked: 'unknown', timing: 'unknown', ansoegning: 'unknown' },
    // ── Bofinda: udlejerens egen dato ──
    { navn: 'O native dato passeret', kilde: 'native',
      fakta: { sourceAvailabilityDate: D('2026-08-01') },
      timing: 'nu', ansoegning: 'unknown' },
    { navn: 'P native dato i fremtiden', kilde: 'native',
      fakta: { sourceAvailabilityDate: D('2027-01-01') },
      timing: 'senere', ansoegning: 'unknown' },
  ]
  for (const sag of SAGER) {
    const r = fortolkAvailability(sag.fakta, KILDEKONTRAKTER[sag.kilde]!, NU)
    const dele: string[] = []
    if (sag.marked) dele.push(`marked ${r.marked.status}`)
    if (sag.timing) dele.push(`timing ${r.timing.status}`)
    if (sag.ansoegning) dele.push(`ansøgning ${r.ansoegning.status}`)
    if (sag.adgang) dele.push(`adgang ${r.adgang.krav.join('+') || '—'}`)
    const ok = (!sag.marked || r.marked.status === sag.marked)
      && (!sag.timing || r.timing.status === sag.timing)
      && (!sag.ansoegning || r.ansoegning.status === sag.ansoegning)
      && (!sag.adgang || JSON.stringify([...r.adgang.krav].sort()) === JSON.stringify([...sag.adgang].sort()))
    tjek(sag.navn, ok, dele.join(' · '))
  }

  // To ENIGE signaler er ÉN konklusion, ikke en staerkere.
  const enige = fortolkAvailability(
    { rentalAvailableNow: true, sourceAvailabilityDate: D('2026-09-01') },
    KILDEKONTRAKTER.home!, NU)
  tjek('to enige signaler → én konklusion, to spor',
    enige.timing.status === 'nu' && enige.timing.evidens.length === 2,
    `${enige.timing.status} · ${enige.timing.evidens.length} spor`)
  tjek('… og ingen uenighed noteres', enige.timing.uenighed === undefined)

  // Konflikten skal BEVARE begge sider.
  const kon = fortolkAvailability(
    { rentalAvailableNow: true, sourceAvailabilityDate: D('2026-12-01') },
    KILDEKONTRAKTER.home!, NU)
  const linjer = forklar(kon.timing)
  tjek('konflikten viser begge modstridende signaler',
    kon.timing.status === 'conflict'
    && linjer.some((l) => l.includes('rentalAvailableNow = true') && l.includes('kan_overtages_nu'))
    && linjer.some((l) => l.includes('sourceAvailabilityDate = 2026-12-01') && l.includes('kan_ikke_overtages_nu')),
    linjer.join(' | '))
  console.log('\n  evidensspor, konflikt:')
  for (const l of linjer) console.log(`      ${l}`)
  console.log('  evidensspor, normal (to enige signaler):')
  for (const l of forklar(enige.timing)) console.log(`      ${l}`)
  console.log('')

  // ── Dacas «Snarest» maa ikke blive til en dato ─────────────
  // Kilden skriver enten en dansk tekstdato eller ordet «Snarest».
  // «Snarest» gav foer `new Date().toISOString()` — VORES ur — og seks
  // raekker stod med klokkeslaet og millisekunder fra natkoerslen, mens
  // datoen rykkede en dag frem hver nat.
  //
  // Proeven maaler ADFAERD, ikke kodeform: den samme raa side koeres med
  // uret sat to steder. Er der en skjult afhaengighed af systemtiden,
  // giver de to koersler forskellige svar.
  console.log('\n══ Dacas: «Snarest» er ikke en dato ══')
  // `postid-…` er kildens egen bodyklasse og parserens gyldighedstjek.
  // Uden den returnerer laesBolig null — og den foerste udgave af den her
  // fixtur gjorde netop det, saa proeven maalte ingenting. Praemis-linjen
  // nedenfor fangede det; den staar derfor.
  const dacasSide = (overtagelse: string) => `
    <html><body class="postid-12345">
      <h1 class="entry-title">Prøvevej 1, 8000 Aarhus C</h1>
      <div class="et_pb_text_inner">Adresse: Prøvevej 1, 8000 Aarhus C</div>
      <div class="et_pb_text_inner">Overtagelsesdato: ${overtagelse}</div>
      <div class="et_pb_text_inner">Husleje: 7.500 kr.</div>
      <div class="et_pb_text_inner">Værelser: 3</div>
      <div class="et_pb_text_inner">54 m 2</div>
    </body></html>`
  const medUret = <T>(iso: string, f: () => T): T => {
    const Rigtig = globalThis.Date
    const fast = new Rigtig(iso).getTime()
    class Frossen extends Rigtig {
      constructor(...a: ConstructorParameters<typeof Rigtig>) {
        super(...(a.length ? a : [fast]) as ConstructorParameters<typeof Rigtig>)
      }
      static override now() { return fast }
    }
    globalThis.Date = Frossen as unknown as DateConstructor
    try { return f() } finally { globalThis.Date = Rigtig }
  }
  const koer = (overtagelse: string, iso: string) =>
    medUret(iso, () => dacasLaes(dacasSide(overtagelse), 'https://dacas.dk/bolig/proeve'))

  const URE = ['2026-03-01T09:00:00Z', '2027-11-20T22:15:00Z']
  const snarest = URE.map((u) => koer('Snarest', u))
  tjek('præmis: siden kunne overhovedet parses', snarest.every((b) => b !== null))
  tjek('«Snarest» giver INGEN dato', snarest.every((b) => b?.availableFrom == null),
    snarest.map((b) => String(b?.availableFrom)).join(' · '))
  tjek('«Snarest» giver samme svar uanset systemtid',
    snarest[0]?.availableFrom === snarest[1]?.availableFrom)
  tjek('ordet bevares som takeoverText',
    snarest.every((b) => b?.availability?.takeoverText === 'Snarest'),
    String(snarest[0]?.availability?.takeoverText))

  const rigtig = URE.map((u) => koer('1. november 2026', u))
  tjek('en rigtig dato parses stadig',
    rigtig.every((b) => b?.availableFrom?.startsWith('2026-11-01')),
    String(rigtig[0]?.availableFrom))
  tjek('… og den er den samme uanset systemtid',
    rigtig[0]?.availableFrom === rigtig[1]?.availableFrom)

  // ── «kilden skriver» maa aldrig staa paa en udlejerannonce ──
  // Linjen betyder "kilden skrev noget andet, end vi kunne parse". For en
  // udlejerannonce ER udlejeren kilden, og `address_raw` er ikke hendes
  // tekst — VI bygger den af hendes fire felter. Der er ingen fremmed
  // originaltekst at tilskrive.
  //
  // Fixturen har produktionens EGEN form: raa-strengen mangler byen, fordi
  // den blev sat af os bagefter. Netop derfor udloestes linjen.
  console.log('\n══ «kilden skriver» og native ══')
  const KILDELINJE = 'kilden skriver'
  const NATIV = {
    kildetype: 'native' as const,
    adresse: 'Nørrebrogade 30, 2200',
    vej: 'Nørrebrogade', husnr: '30', etage: null, doer: null,
    postnr: '2200', by: 'København N',
  }
  // En IMPORTERET bolig med en aegte afvigelse: kilden skriver et
  // stednavn, vi ikke har et felt til. Uden den her ville proeven bestaa
  // ved at fjerne linjen helt.
  const IMPORTERET = { ...NATIV, kildetype: 'feed' as const,
    adresse: 'Nørrebrogade 30, Kældercafeen, 2200 København N' }
  for (const [navn, b2, skal] of [
    ['native, samme form som i produktionen', NATIV, false],
    ['importeret med reel afvigelse', IMPORTERET, true],
    // Og en native, hvor raa-strengen ER identisk: den skal heller ikke
    // vise linjen, saa proeven ikke bare maaler afvigelsen.
    ['native uden afvigelse', { ...NATIV, adresse: 'Nørrebrogade 30, 2200 København N' }, false],
  ] as const) {
    const html = vis(createElement(Kort, { b: bolig(b2) }))
    const har = html.includes(KILDELINJE)
    tjek(`${navn}: ${skal ? 'linjen står' : 'ingen linje'}`, har === skal,
      har ? 'linjen står' : 'ingen linje')
  }

  // ── Billedforbeholdet ────────────────────────────────────────
  // Kilden skriver selv, at billederne kan vaere fra en anden bolig.
  // Foer kasserede vi billederne; nu vises de MED forbeholdet. Den ene
  // kombination, der ville vaere vaerre end foer, er billeder UDEN linjen
  // — saa paastaar kortet, at billedet er af boligen. Den anden fejl er
  // lige saa gal den anden vej: en linje paa en bolig, kilden ikke har
  // taget forbehold for, er vores egen paastand om deres billeder.
  console.log('\n══ billedforbeholdet følger billederne ══')
  const FORB_KORT = 'billederne kan være fra en anden bolig'
  const medBillede = { forside: `${VIST_VAERT}/1.jpg`, billeder: 3 }
  for (const [navn, html, skal] of [
    ['enkeltkort, forbehold + billede',
      vis(createElement(Kort, { b: bolig({ ...medBillede, billedforbehold: true }) })), true],
    ['enkeltkort, intet forbehold',
      vis(createElement(Kort, { b: bolig({ ...medBillede, billedforbehold: false }) })), false],
    ['gruppekort, forbehold + billede',
      vis(createElement(Gruppekort, {
        g: gruppe({}, { ...medBillede, billedforbehold: true }),
      })), true],
    ['gruppekort, intet forbehold',
      vis(createElement(Gruppekort, {
        g: gruppe({}, { ...medBillede, billedforbehold: false }),
      })), false],
    // Uden et billede er der intet at tage forbehold for.
    ['enkeltkort, forbehold men INTET billede',
      vis(createElement(Kort, { b: bolig({ forside: null, billedforbehold: true }) })), false],
  ] as const) {
    const har = html.includes(FORB_KORT)
    tjek(`${navn}: ${skal ? 'linjen står' : 'ingen linje'}`, har === skal,
      har ? 'linjen står' : 'ingen linje')
  }

  // ── Ukendt total: SLET ingen el-linje ────────────────────────
  // Kender vi ikke acontoen, kan vi ikke sige noget om, hvad den ikke
  // indeholder. De to udsagn modsagde hinanden paa 47 gruppekort.
  //
  // Proeven daekker BEGGE korttyper. Enkeltkortet gjorde det rigtigt i
  // forvejen — men intet holdt det fast, og det er praecis saadan de to
  // korttyper drev fra hinanden sidst.
  console.log('\n══ ukendt total → ingen el-linje ══')
  const EL_TEKSTER = [
    'El indgår ikke',
    'Aconto er ét samlet beløb',
    'el afregnes direkte',
  ]
  const harElLinje = (html: string) => EL_TEKSTER.some((t) => html.includes(t))
  for (const [navn, html] of [
    ['enkeltkort, ingen total',
      vis(createElement(Kort, { b: bolig({ total: null, poster: null }) }))],
    ['gruppekort, ingen total',
      vis(createElement(Gruppekort, {
        g: gruppe({
          noegle: { kilde: 'proeve', postnr: '2200', vej: 'Prøvevej', vaerelser: 3, total: false },
          nogenUdenEl: true,
        } as Partial<Gruppe>, { total: null, poster: null }),
      }))],
    ['gruppekort, ingen total, samlet aconto',
      vis(createElement(Gruppekort, {
        g: gruppe({
          noegle: { kilde: 'proeve', postnr: '2200', vej: 'Prøvevej', vaerelser: 3, total: false },
          nogenUdenEl: true, nogenUkendtDaekning: true,
        } as Partial<Gruppe>, { total: null, poster: null }),
      }))],
  ] as const) {
    tjek(`${navn}: ingen el-linje`, !harElLinje(html),
      EL_TEKSTER.filter((t) => html.includes(t)).join(' + '))
    tjek(`${navn}: men manglen siges`, html.includes('Udlejer oplyser ikke aconto'))
  }
  // Praemissen: med en KENDT total skal el-linjen stadig komme. Ellers
  // ville proeven ovenfor bestaa ved at fjerne linjen helt.
  tjek('præmis: med kendt total kommer el-linjen stadig',
    harElLinje(vis(createElement(Gruppekort, { g: gruppe({ nogenUdenEl: true }) }))))

  // ── Den fjerde tilstand ──────────────────────────────────────
  // "El er ikke med i tallet" og "vi ved ikke hvad der er i tallet" er to
  // forskellige udsagn. Kun det foerste kan aflaeses af udspecificerede
  // poster. Er acontoen ét samlet beloeb, KAN el ligge i klumpen — og saa
  // er "El indgår ikke" en paastand, vi ikke har daekning for.
  //
  // Det er de 254 boliger fra LokalBolig, Propstep og Dacas.
  const IKKE_MED = /El indgår ikke/
  const UKENDT = /ét samlet beløb/
  const KLUMP = { poster: ['rent', 'other'], el: null, elEgenMaaler: null }

  tjek('udledningen: klump uden navngiven post → ukendt-daekning',
    eltilstand({ total: 100, ...KLUMP }) === 'ukendt-daekning')
  tjek('udledningen: udspecificeret uden el → ikke-med',
    eltilstand({ total: 100, poster: ['rent', 'heat', 'water'], el: null, elEgenMaaler: null }) === 'ikke-med')
  tjek('udledningen: egen måler slår klumpen',
    eltilstand({ total: 100, ...KLUMP, elEgenMaaler: true }) === 'egen-maaler')
  tjek('udledningen: el oplyst → ingen linje',
    eltilstand({ total: 100, poster: ['rent', 'electricity'], el: 500, elEgenMaaler: null }) === 'med')

  for (const [navn, html] of [
    ['enkeltkort, samlet aconto', vis(createElement(Kort, { b: bolig(KLUMP) }))],
    ['gruppekort, én med samlet aconto',
      vis(createElement(Gruppekort, { g: gruppe({ nogenUkendtDaekning: true }, KLUMP) }))],
  ] as const) {
    tjek(`${navn}: siger IKKE "El indgår ikke"`, !IKKE_MED.test(html),
      IKKE_MED.test(html) ? 'PÅSTÅR NOGET VI IKKE VED' : '')
    tjek(`${navn}: siger at beløbet er samlet`, UKENDT.test(html))
  }

  for (const [navn, html] of [
    ['enkeltkort, el ukendt', vis(createElement(Kort, { b: bolig({}) }))],
    ['gruppekort, én uden el', vis(createElement(Gruppekort, { g: gruppe({}) }))],
    ['gruppekort, alle uden el', vis(createElement(Gruppekort,
      { g: gruppe({ nogenUdenEl: true }) }))],
  ] as const) {
    tjek(`${navn}: udspecificeret → "El indgår ikke"`, IKKE_MED.test(html))
    const groen = GROEN.test(html)
    tjek(`${navn}: grøn total`, groen)
    tjek(`${navn}: og el gjort rede for`, !groen || ELTEKST.test(html),
      groen && !ELTEKST.test(html) ? 'GRØN UDEN EL-LINJE' : '')
  }

  // Modstykket: er el faktisk oplyst, skal linjen IKKE staa — ellers ville
  // proeven kunne bestaa ved bare at skrive den paa alting.
  const medEl = vis(createElement(Kort, {
    b: bolig({ el: 30000, poster: ['rent', 'heat', 'water', 'electricity'], total: 1330000 }),
  }))
  tjek('enkeltkort med el: ingen el-linje', !ELTEKST.test(medEl))
  const gruppeMedEl = vis(createElement(Gruppekort, { g: gruppe({ nogenUdenEl: false }) }))
  tjek('gruppekort hvor alle har el: ingen el-linje', !ELTEKST.test(gruppeMedEl))

  // Og den staerkere formulering kun naar kilden selv siger det.
  const egen = vis(createElement(Gruppekort,
    { g: gruppe({ nogenUdenEl: true, alleUdenElHarEgenMaaler: true }) }))
  tjek('gruppekort med egen elmåler: kildens egen formulering',
    /el afregnes direkte/.test(egen))

  // ── Layoutet skal foelge det VISBARE billede ────────────────
  // Kortets gitter har en 216px billedkolonne, og klassen `uden-billede`
  // fjerner den. Foer afgjorde `b.forside` klassen og
  // `b.forside && billedUrl(...)` billedet. Er URL'en der, men vaerten
  // ikke i TILLADTE_VAERTER, giver billedUrl null — saa blev klassen ikke
  // sat, kolonnen blev staaende tom, og adressen braekkede ét ord per
  // linje i den klemte tekstkolonne.
  //
  // Det er Dacas-fejlen i visuel form: en manglende allowlist-post fejler
  // ikke, den viser ingenting. Proeven gengiver kortene og maaler paa det,
  // en bruger ser.
  console.log('\n══ manglende allowlist-post må ikke ødelægge layoutet ══')
  const FREMMED = `${SKJULT_VAERT}/a.jpg`
  const TILLADT = `${VIST_VAERT}/a.jpg`
  tjek('prøvens præmis: den fremmede vært er IKKE tilladt',
    !TILLADTE_VAERTER.has(new URL(SKJULT_VAERT).host) && billedUrl(FREMMED, 400) == null)
  tjek('prøvens præmis: den tilladte vært ER tilladt', billedUrl(TILLADT, 400) != null)

  for (const [navn, html] of [
    ['enkeltkort, fremmed vært',
      vis(createElement(Kort, { b: bolig({ forside: FREMMED, billeder: 20 }) }))],
    ['gruppekort, fremmed vært',
      vis(createElement(Gruppekort, { g: gruppe({}, { forside: FREMMED, billeder: 20 }) }))],
  ] as const) {
    tjek(`${navn}: klassen uden-billede sættes`, /uden-billede/.test(html),
      /uden-billede/.test(html) ? '' : 'TOM BILLEDKOLONNE — teksten klemmes')
    tjek(`${navn}: og der tegnes intet billede`, !/<img/.test(html))
  }

  // Modstykket: en tilladt vært skal STADIG give et billede og ingen
  // uden-billede-klasse. Ellers kunne proeven bestaa ved bare at saette
  // klassen paa alting.
  for (const [navn, html] of [
    ['enkeltkort, tilladt vært',
      vis(createElement(Kort, { b: bolig({ forside: TILLADT, billeder: 3 }) }))],
    ['gruppekort, tilladt vært',
      vis(createElement(Gruppekort, { g: gruppe({}, { forside: TILLADT, billeder: 3 }) }))],
  ] as const) {
    tjek(`${navn}: INGEN uden-billede`, !/uden-billede/.test(html))
    tjek(`${navn}: og billedet tegnes`, /<img[^>]+\/api\/billede/.test(html))
  }

  try {
    id = await opretBolig(udlejer, FULDT)
    const [foer] = await db.select().from(listings).where(eq(listings.id, id))

    console.log('\n══ alle felter kom i basen ══')
    tjek('depositum', foer!.deposit === FULDT.depositum, `${foer!.deposit}`)
    tjek('forudbetalt', foer!.prepaidRent === FULDT.forudbetalt, `${foer!.prepaidRent}`)
    // husleje 12.000 + aconto (1000+500+200+150) + depositum 25.000
    // + forudbetalt 20.000 = 58.850 kr.
    tjek('indflytningspris', foer!.moveInCost === 5885000, `${foer!.moveInCost}`)
    tjek('øvrig aconto', foer!.utilitiesOther === FULDT.oevrig, `${foer!.utilitiesOther}`)
    tjek('etage og dør', foer!.floor === '3' && foer!.door === 'tv')
    tjek('udlejerens egen tekst', foer!.description === FULDT.beskrivelse)
    tjek('faciliteterne kom med', JSON.stringify(foer!.amenities) === JSON.stringify(FULDT.faciliteter),
      JSON.stringify(foer!.amenities))

    // ── Rundturen ────────────────────────────────────────────────
    // Præcis som siden gør det: læs rækken ind i formularen, gem uændret.
    const billeder = await db.select({ url: listingImages.externalUrl })
      .from(listingImages).where(eq(listingImages.listingId, id))
      .orderBy(listingImages.position)
    const somSiden: Boliginput = {
      ...somFormular(foer!),
      billeder: billeder.map((x) => x.url),
    }
    await opdaterBolig(udlejer, id, somSiden)
    const [efter] = await db.select().from(listings).where(eq(listings.id, id))

    console.log('\n══ gem uden ændringer — rækken skal være identisk ══')
    const aendret = SAMMENLIGN.filter(
      (k) => !ens(foer![k as keyof typeof foer], efter![k as keyof typeof efter]),
    )
    for (const k of aendret) {
      console.log(`  ✗ ${k}: ${JSON.stringify(foer![k as keyof typeof foer])}`
        + ` → ${JSON.stringify(efter![k as keyof typeof efter])}`)
    }
    tjek(`${SAMMENLIGN.length} kolonner uændret`, aendret.length === 0,
      aendret.length ? `${aendret.length} ændrede` : '')

    const bilEfter = await db.select().from(listingImages).where(eq(listingImages.listingId, id))
    tjek('billederne er der stadig', bilEfter.length === FULDT.billeder.length,
      `${bilEfter.length} af ${FULDT.billeder.length}`)
    // ── Maerkatet skal sige sandheden ────────────────────────────
    // Dedup er en visning, men for den udlejer der taber valget, er
    // forskellen ikke til at se: annoncen stod som "udgivet" og kunne
    // aabnes paa sit eget link, mens den ikke fandtes i soegningen.
    //
    // Proeven binder maerkatet til det, soegningen FAKTISK returnerer.
    // Ellers ville den bestaa, selv om de to kom fra hinanden.
    console.log('\n══ mærkatet skal følge søgningen ══')
    const iSoegningen = async () =>
      (await soeg({ postnr: FULDT.postnr }, 500)).some((b) => b.id === id)
    const maerkat = async () =>
      (await mineBoliger(udlejer)).find((b) => b.id === id)!.synlighed

    tjek('alene: mærkatet siger udgivet', (await maerkat()).slags === 'udgivet')
    tjek('alene: og hun ER i søgningen', await iSoegningen())

    // ── Faciliteterne skal virke som filter ──────────────────────
    // Foer spurgte formularen ikke om dem, saa `amenities` var tom, og
    // elevator-, altan- og kaeledyrsfiltrene skjulte HVER eneste
    // udlejerannonce — for altid, uden at nogen kunne se hvorfor.
    console.log('\n══ faciliteterne skal nå frem til filtrene ══')
    const medFilter = async (f: Record<string, boolean>) =>
      (await soeg({ postnr: FULDT.postnr, ...f }, 500)).some((b) => b.id === id)
    tjek('elevator-filteret finder hende', await medFilter({ elevator: true }))

    // ── Filtrenes grundlag ───────────────────────────────────────
    // Tallene under afkrydsningerne skal beskrive soegningen UDEN
    // facilitetsfiltrene. Gjorde de ikke det, ville der staa "0 tier"
    // under et filter, der lige havde skjult flere hundrede boliger.
    const g = await facilitetsgrundlag({})
    const alt = await opsummering({})
    // Her stod «oplyser + tier er hele søgningen». Den kunne ikke fejle:
    // begge tal er `count(*) filter` over det SAMME praedikat i den samme
    // raekke (lib/soeg.ts:755-756), og `OPLYST` kan aldrig vaere null, saa
    // X og not X deler count(*) udtoemmende. Postgres' aritmetik blev
    // proevet, ikke vores kode. Og `oplyser` laeses ingen steder: forsiden
    // regner mellemgruppen som `antal - tier - facilitet`, saa linjen var
    // det eneste kaldssted for feltet — og den sammenlignede det med sig
    // selv. Det, kommentaren ovenfor lover, proeves paa de naeste linjer.
    const gFiltreret = await facilitetsgrundlag({ elevator: true })
    tjek('grundlaget ændrer sig IKKE af et facilitetsfilter',
      gFiltreret.tier === g.tier && gFiltreret.elevator === g.elevator,
      `tier ${gFiltreret.tier} vs ${g.tier}`)
    await tjekProd('men søgningen gør — filteret udelukker stadig de ukendte',
      async () => (await opsummering({ elevator: true })).antal < alt.antal)
    tjek('hendes elevator tælles med i grundlaget',
      (await facilitetsgrundlag({ postnr: FULDT.postnr })).elevator >= 1)

    // Grundlagslinjen nævner TRE grupper, og de skal dække alle boliger:
    // dem der har faciliteten, dem der oplyser faciliteter uden den, og
    // dem der intet oplyser. Går de ikke op, mangler brugeren en gruppe
    // uden at kunne se hvilken — det gjorde de før, hvor kun to blev nævnt.
    // Tallene tælles UAFHÆNGIGT her. Regnede prøven mellemgruppen som
    // `antal - tier - har`, ville summen gå op per definition, og prøven
    // ville ikke kunne fejle. De tre grupper skal måles hver for sig og
    // tilsammen dække alle boliger.
    const OPLYST = dsql`jsonb_array_length(coalesce(${listings.amenities}, '[]'::jsonb)) > 0`
    const harSql = (navne: readonly string[]) => dsql`jsonb_exists_any(
      coalesce(${listings.amenities}, '[]'::jsonb),
      array[${dsql.join(navne.map((n) => dsql`${n}`), dsql`, `)}]::text[])`
    for (const nøgle of ['kaeledyr', 'elevator', 'udeplads'] as const) {
      const [m] = await db.select({
        alle: dsql<number>`count(*)::int`,
        har: dsql<number>`count(*) filter (where ${harSql(FACILITET[nøgle])})::int`,
        uden: dsql<number>`count(*) filter (where ${OPLYST}
          and not ${harSql(FACILITET[nøgle])})::int`,
        tier: dsql<number>`count(*) filter (where not ${OPLYST})::int`,
      }).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
        .where(udenDubletter(hvor({})))
      const { alle, har, uden, tier } = m!
      // To paastande, der foer stod i én linje og skjulte hinanden.
      //
      // DEN FOERSTE: at de tre praedikater deler saettet uden overlap og
      // uden hul. Maales i SAMME forespoergsel, mod dens egen count(*).
      // Ikke tautologisk: `uden` har sit eget praedikat (`OPLYST and not
      // har`), ikke `alle - tier - har`. Overlapper to praedikater, eller
      // opstaar der et hul, brister summen.
      tjek(`${nøgle}: de tre grupper dækker alle boliger`,
        har + uden + tier === alle,
        `${har} + ${uden} + ${tier} = ${har + uden + tier}, i alt ${alle}`)
      // DEN ANDEN: at grundlaget beskriver netop DET saet. Foer stod den
      // gemt inde i summen ovenfor — mod `g.antal` fra en anden
      // forespoergsel — og saa var det eneste, der kunne gaa galt, netop
      // det her. Nu staar det for sig, med sin egen fejlbesked.
      tjek(`${nøgle}: grundlaget beskriver samme sæt`, alle === g.antal,
        `${g.antal} mod ${alle}`)
      tjek(`${nøgle}: linjens tal er det målte`, har === g[nøgle], `${g[nøgle]} mod ${har}`)
      // Navnet lovede foer mere end det maaler: det er ikke boligerne, der
      // proeves, men at grundlagets `tier` er det samme tal, proeven selv
      // taeller. Den KAN fejle — den binder lib/soeg.ts' `OPLYST` til
      // proevens egen kopi — og den bliver staaende.
      tjek(`${nøgle}: grundlagets tavse er de målte tavse`, tier === g.tier,
        `${g.tier} mod ${tier}`)
    }

    // ── Tællingen skal tælle VISBARE billeder ────────────────────
    // `b.billeder` var `count(*) from listing_images` — rækker, ikke
    // billeder vi kan vise. Et kort med tyve billeder på en vært uden
    // allowlist-post viste derfor intet billede OG tav om det: "ingen
    // billeder"-linjen udløses af billeder === 0, og tallet var tyve.
    // Nu filtreres der i selve underforespørgslen, fra samme konstant
    // som billedUrl() bruger.
    console.log('\n══ b.billeder skal tælle visbare billeder ══')
    const kortet = async () =>
      (await soeg({ postnr: FULDT.postnr }, 500)).find((x) => x.id === id)!
    const saetBilleder = async (urler: string[]) => {
      await db.delete(listingImages).where(eq(listingImages.listingId, id))
      if (urler.length) await db.insert(listingImages).values(
        urler.map((u, i) => ({ listingId: id, externalUrl: u, position: i })))
    }

    await saetBilleder(Array.from({ length: 20 }, (_, i) => `${SKJULT_VAERT}/${i}.jpg`))
    const skjult = await kortet()
    tjek('20 billeder på en ikke-tilladt vært → billeder = 0', skjult.billeder === 0,
      String(skjult.billeder))
    tjek('… og forsiden er null', skjult.forside == null, String(skjult.forside))
    tjek('… og kortet SIGER "ingen billeder"',
      /ingen billeder/.test(vis(createElement(Kort, { b: skjult }))))

    await saetBilleder([...Array.from({ length: 3 }, (_, i) => `${VIST_VAERT}/ok${i}.jpg`),
                        ...Array.from({ length: 2 }, (_, i) => `${SKJULT_VAERT}/nej${i}.jpg`)])
    const blandet = await kortet()
    tjek('blandede værter → kun de tilladte tælles', blandet.billeder === 3,
      String(blandet.billeder))
    tjek('… og forsiden er en tilladt URL',
      blandet.forside != null && blandet.forside.startsWith(VIST_VAERT), String(blandet.forside))
    tjek('… og kortet siger IKKE "ingen billeder"',
      !/ingen billeder/.test(vis(createElement(Kort, { b: blandet }))))

    // Tilbage til udgangspunktet, saa de foelgende proever ser det de forventer.
    await saetBilleder(FULDT.billeder)

    // ── Billedrækkefølgen ────────────────────────────────────────
    // Udlejeren bestemmer forsidebilledet ved at trække det først i
    // formularen. Rækkefølgen i `billeder`-arrayet ER `position` i basen,
    // og `position` er det, både boligsiden og søgekortet sorterer på.
    // Uden den her prøve kunne et af de tre led falde fra uden at nogen så det.
    console.log('\n══ billedrækkefølgen skal overleve ══')
    const positioner = async () => (await db
      .select({ url: listingImages.externalUrl, pos: listingImages.position })
      .from(listingImages).where(eq(listingImages.listingId, id))
      .orderBy(listingImages.position)).map((x) => x.url)
    const forsiden = async () =>
      (await soeg({ postnr: FULDT.postnr }, 500)).find((b) => b.id === id)?.forside

    tjek('gemt i den rækkefølge de blev sendt',
      JSON.stringify(await positioner()) === JSON.stringify(FULDT.billeder))
    tjek('kortets forside er det første billede', (await forsiden()) === FULDT.billeder[0])

    // Byt om, som et træk i formularen ville gøre det.
    const byttet = [...FULDT.billeder].reverse()
    await opdaterBolig(udlejer, id, { ...somFormular(foer!), billeder: byttet })
    tjek('efter ombytning står de i den nye rækkefølge',
      JSON.stringify(await positioner()) === JSON.stringify(byttet))
    tjek('og kortets forside følger med', (await forsiden()) === byttet[0],
      String(await forsiden()))
    tjek('position er 0,1,2 … og ikke huller',
      JSON.stringify((await db.select({ pos: listingImages.position }).from(listingImages)
        .where(eq(listingImages.listingId, id)).orderBy(listingImages.position))
        .map((x) => x.pos)) === JSON.stringify(byttet.map((_, i) => i)))
    // Tilbage til udgangspunktet, saa de foelgende proever ser det de forventer.
    await opdaterBolig(udlejer, id, { ...somFormular(foer!), billeder: FULDT.billeder })
    tjek('udeplads-filteret finder hende (altan)', await medFilter({ udeplads: true }))
    tjek('kæledyrsfilteret gør IKKE — hun sagde det ikke', !(await medFilter({ kaeledyr: true })))

    // En anden kilde annoncerer den samme bolig — samme enhedsnoegle — og
    // har flere billeder. Saa vinder den repraesentantvalget.
    // Rivalen SKAL vaere ikke-native — det er den vej dedup og
    // repraesentantvalg gaar, og det er det, proeven maaler. Men den maa
    // ikke laane en RIGTIG kilde.
    //
    // Laante den findbolig.nu's kilde-id, arvede raekken ogsaa kildens
    // historik i crawl_runs, og saa passerede den alarmens indkoeringsvagt.
    // Regnestykket gik op hele vejen: native-spaerringen paa lib/alarm.ts:99
    // rammer ikke en 'feed'-raekke, prisen laa under en rigtig brugers
    // bekraeftede alarm, og scripts/import.ts matcher og SENDER i samme
    // koersel. En mail om en bolig, der ikke findes, var kun et spoergsmaal
    // om, at koerslen blev afbrudt i det rigtige sekund. En lokal database
    // havde ikke lukket det: RESEND_API_KEY ligger i samme .env.
    //
    // En kilde, proeven selv opretter, har ingen koersler. `foersteKoersel`
    // i lib/alarm.ts giver undefined for den, og filteret kaster raekken
    // vaek. Egen slug pr. koersel, som resten af filen goer det, saa en
    // afbrudt koersel ikke spaerrer den naeste paa slug'ens unikke indeks.
    const [fremmed] = await db.insert(sources).values({
      slug: `proevekilde-${Date.now()}`,
      name: 'Prøvekilde (kun til prøver)',
      sourceType: 'feed',
      baseUrl: 'https://proeve.invalid',
      enabled: false,
    }).returning()
    proevekildeId = fremmed!.id
    const [hendes] = await db.select().from(listings).where(eq(listings.id, id))
    const { id: _glem, ...resten } = hendes!
    const [rival] = await db.insert(listings).values({
      ...resten,
      sourceId: fremmed!.id,
      sourceType: 'feed',
      // Udtrykkeligt, ikke arvet. Er datoen sat, springer alarmen
      // indkoeringsvagten helt over og ser kun paa alderen — praecis den
      // faelde, kommentaren i lib/alarm.ts advarer om. At den er null i dag,
      // fordi opretBolig ikke saetter den, er et tilfaelde. Her staar det.
      sourceCreatedAt: null,
      externalKey: `proeve-dublet-${Date.now()}`,
      sourceUrl: 'https://eksempel.invalid/dublet',
      landlordId: null, contactEmail: null, contactPhone: null,
    }).returning()
    rivalId = rival!.id
    await db.insert(listingImages).values(
      [0, 1, 2, 3].map((n) => ({
        listingId: rivalId, externalUrl: `${VIST_VAERT}/r${n}.jpg`, position: n,
      })))

    const efterRival = await maerkat()
    tjek('med dublet: mærkatet siger IKKE udgivet', efterRival.slags === 'dublet',
      efterRival.slags)
    tjek('med dublet: den peger på den rigtige annonce',
      efterRival.slags === 'dublet' && efterRival.af.id === rivalId)
    tjek('med dublet: og begrundelsen passer — flere billeder',
      efterRival.slags === 'dublet' && efterRival.af.billeder === 4)
    tjek('med dublet: hun er FAKTISK ude af søgningen', !(await iSoegningen()))

    // Rangeringen skal ogsaa taelle VISBARE billeder. Giver vi rivalen
    // sine fire billeder paa en vaert, vi ikke kan vise fra, har den nul —
    // og saa skal HUN vinde med sine to. Uden filtreringen i
    // `ikkeRepraesentant` ville rivalens fire raa raekker slaa hendes to.
    await db.delete(listingImages).where(eq(listingImages.listingId, rivalId))
    await db.insert(listingImages).values(
      [0, 1, 2, 3].map((n) => ({
        listingId: rivalId, externalUrl: `${SKJULT_VAERT}/r${n}.jpg`, position: n,
      })))
    const usynligRival = await maerkat()
    tjek('rival med billeder vi ikke kan vise taber valget',
      usynligRival.slags === 'udgivet', usynligRival.slags)
    tjek('… og så er HUN i søgningen', await iSoegningen())

    // Og tilbage igen, saa proeven ikke bare maaler at noget forsvandt.
    await db.delete(listingImages).where(eq(listingImages.listingId, rivalId))
    await db.delete(listings).where(eq(listings.id, rivalId))
    rivalId = ''
    tjek('uden dublet: mærkatet siger udgivet igen', (await maerkat()).slags === 'udgivet')
    tjek('uden dublet: og hun er i søgningen igen', await iSoegningen())

    // ── Grundlaget under "Fuld økonomi kendt" ────────────────────
    // Tre grupper: fuld, kun samlet aconto, ingen total. De kommer alle
    // fra ét `opsummering`-kald, saa "de gaar op" ville vaere sandt per
    // definition. Det, der KAN gaa galt, er rangordenen — og den maales
    // uafhaengigt her.
    console.log('\n══ grundlaget under "Fuld økonomi kendt" ══')
    const oek = await oekonomigrundlag({})
    // Her stod «fuld ≤ kendt total» og «kendt total ≤ alle». Ingen af dem
    // kunne fejle: alle tre tal er aggregater i ÉN select over ÉT saet
    // (lib/soeg.ts:746-749), og hvert praedikat indeholder det naeste
    // ordret — `fuld` kraever `total is not null` PLUS sammensaetningen.
    // `count(kolonne) <= count(*)` er sandt i Postgres uanset data.
    // Rangordenen maales rigtigt tre linjer nede, mod en uafhaengig
    // optaelling, og DEN kan fejle.
    const [uaf] = await db.select({
      alle: dsql<number>`count(*)::int`,
      medTotal: dsql<number>`count(*) filter (where ${listings.totalMonthly} is not null)::int`,
      fuld: dsql<number>`count(*) filter (where ${listings.totalMonthly} is not null
        and ${listings.totalMonthlyComponents}
          && array['heat','water','electricity']::text[])::int`,
    }).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(udenDubletter(hvor({})))
    tjek('linjens tre tal er de målte',
      uaf!.fuld === oek.fuld && uaf!.medTotal === oek.medTotal && uaf!.alle === oek.antal,
      `${uaf!.fuld}/${uaf!.medTotal}/${uaf!.alle} mod ${oek.fuld}/${oek.medTotal}/${oek.antal}`)
    // Filteret maa ikke paavirke sit eget grundlag.
    tjek('grundlaget ændrer sig ikke af filteret',
      (await oekonomigrundlag({ fuldOekonomi: true })).antal === oek.antal,
      `${(await oekonomigrundlag({ fuldOekonomi: true })).antal} mod ${oek.antal}`)

    // ── Linjen om tavse kilder ───────────────────────────────────
    // Frafaldet i et facilitetsfilter er ikke jaevnt: nogle kilder oplyser
    // ALDRIG faciliteter, saa et kryds fjerner dem helt. Navnene beregnes,
    // saa linjen retter sig selv — men saa skal den ogsaa vaere sand.
    console.log('\n══ tavse kilder ══')
    const tk = await tavseKilder({})
    await tjekProd('der findes tavse kilder at nævne',
      () => tk.navne.length > 0, () => tk.navne.join(', '))
    await tjekProd('de dækker et positivt antal boliger',
      () => tk.antal > 0, () => String(tk.antal))
    // Vores EGEN kilde maa ikke nævnes: formularen SPOERGER om faciliteter,
    // saa "oplyser aldrig" ville vaere faktuelt forkert om den.
    //
    // Prøven skal måle det RIGTIGE: uden det her ville testens egen annonce
    // (der HAR faciliteter) gøre vores kilde ikke-tavs, og så bestod prøven,
    // selv om spærringen var fjernet. Vi tager faciliteterne af annoncen
    // imens, så kilden faktisk ER tavs.
    const facFoer = (await db.select({ a: listings.amenities })
      .from(listings).where(eq(listings.id, id)))[0]!.a
    await db.update(listings).set({ amenities: [] }).where(eq(listings.id, id))
    const tkTavs = await tavseKilder({})
    await db.update(listings).set({ amenities: facFoer }).where(eq(listings.id, id))
    tjek('vores egen kilde nævnes ikke, heller ikke når den ER tavs',
      !tkTavs.navne.includes('Bofinda'), tkTavs.navne.join(', '))
    // En navngiven kilde skal FAKTISK vaere tavs — ikke bare have faa.
    const oplysende = await db.select({ navn: sources.name })
      .from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(udenDubletter(hvor({})),
        dsql`jsonb_array_length(coalesce(${listings.amenities}, '[]'::jsonb)) > 0`))
      .groupBy(sources.name)
    const forkert = tk.navne.filter((n) => oplysende.some((o) => o.navn === n))
    tjek('ingen af de nævnte oplyser faciliteter nogen steder',
      forkert.length === 0, forkert.join(', '))

    // ── Gruppering maa ikke slaa to udlejere sammen ──────────────
    // `sources.slug` er 'native' for ALLE udlejerannoncer. Uden ejeren i
    // noeglen ville to forskellige udlejere med hver sin lejlighed paa
    // samme vej, samme postnummer og samme vaerelsestal blive ét kort,
    // der paastod, at det var samme udbud.
    //
    // Modproeven er lige saa vigtig: ÉN udlejer med fem ens lejligheder
    // paa samme vej SKAL stadig blive ét kort. Det er den situation,
    // gruppering findes for.
    console.log('\n══ gruppering: ejeren skal skille udlejere ad ══')
    const VEJ = 'Gruppeprøvevej'
    const POSTNR = '2450'
    const nyUdlejer = async (n: number) => {
      const [x] = await db.insert(users)
        .values({ email: `test-gruppe-${n}-${Date.now()}@example.com`, role: 'landlord' })
        .returning()
      ekstra.brugere.push(x!.id)
      return { id: x!.id, authUserId: 'test', email: x!.email, navn: null }
    }
    const nyBolig = async (u: typeof udlejer, husnr: string) => {
      const b = await opretBolig(u, { ...FULDT, vej: VEJ, husnr, postnr: POSTNR, by: 'København SV' })
      ekstra.boliger.push(b)
      return b
    }
    const kortPaaVejen = async () => {
      const v = await soegGrupperet({ postnr: POSTNR }, 500)
      return v.filter((x) => (x.slags === 'gruppe'
        ? x.gruppe.noegle.vej : x.bolig.vej) === VEJ)
    }

    const a = await nyUdlejer(1)
    const b2 = await nyUdlejer(2)
    await nyBolig(a, '1')
    await nyBolig(b2, '3')
    const toEjere = await kortPaaVejen()
    tjek('to udlejere på samme vej → to kort', toEjere.length === 2,
      `${toEjere.length} kort` + (toEjere.length === 1 ? ' — SLÅET SAMMEN' : ''))
    tjek('… og ingen af dem er en gruppe',
      toEjere.every((x) => x.slags === 'bolig'), toEjere.map((x) => x.slags).join(','))

    // Samme udlejer, fem ens lejligheder: ét kort.
    for (const h of ['5', '7', '9', '11']) await nyBolig(a, h)
    const femHosEn = (await kortPaaVejen()).filter(
      (x) => x.slags === 'gruppe' && x.gruppe.antal === 5)
    tjek('samme udlejer med fem → ét kort med fem adresser', femHosEn.length === 1,
      `${femHosEn.length} gruppe(r) med fem`)
    const alle = await kortPaaVejen()
    tjek('… og den anden udlejer står stadig for sig', alle.length === 2,
      `${alle.length} kort i alt`)

    // ── En ny kildes bagkatalog maa ikke tage forsiden ──────────
    // Ved den FOERSTE import af en kilde faar hele bestanden
    // `first_seen_at = nu`. Uden indkoeringsreglen sorterer «nyeste» dem
    // alle oeverst, og kilden tager hele forsiden den dag, den kobles paa.
    // home.dk tog 48 af 48 kort.
    console.log('\n══ en ny kildes bagkatalog må ikke tage forsiden ══')
    const nyKilde = async (navn: string, koerselFor: number) => {
      const [k] = await db.insert(sources).values({
        slug: `proeve-${navn}-${Date.now()}`, name: `Prøve: ${navn}`,
        sourceType: 'feed', baseUrl: 'https://proeve.invalid', enabled: false,
      }).returning()
      ekstra.kilder.push(k!.id)
      await db.insert(crawlRuns).values({
        sourceId: k!.id, status: 'ok',
        startedAt: new Date(Date.now() - koerselFor * 3600_000),
      })
      return k!.id
    }
    // Én kilde vi har set i to doegn, én der lige er koblet paa.
    const indkoert = await nyKilde('indkoert', 48)
    const netopKoblet = await nyKilde('netop-koblet', 0.02)

    // Samme greb som rivalen: kopiér hendes raekke, saa alle CHECK-
    // begraensninger er opfyldt uden at gaette paa felter.
    const [skabelon] = await db.select().from(listings).where(eq(listings.id, id))
    const { id: _udenId, ...skabelonen } = skabelon!
    const nyBoligPaa = async (kildeId: string, vej: string) => {
      const [b] = await db.insert(listings).values({
        ...skabelonen,
        sourceId: kildeId, sourceType: 'feed',
        externalKey: `proeve-${vej}-${Date.now()}`,
        sourceUrl: 'https://proeve.invalid/x',
        addressRaw: `${vej} 1, 2200 København N`,
        // Egen enhedsnoegle, ellers dedupliseres de mod hinanden.
        unitAddressUuid: crypto.randomUUID(),
        sourceCreatedAt: null,
        landlordId: null, contactEmail: null, contactPhone: null,
      }).returning()
      ekstra.boliger.push(b!.id)
      return b!.id
    }
    const fraIndkoert = await nyBoligPaa(indkoert, 'Indkørtvej')
    const fraNy: string[] = []
    for (const n of [1, 2, 3]) fraNy.push(await nyBoligPaa(netopKoblet, `Bagkatalogvej${n}`))

    const raekkefoelge = (await soeg({}, 500)).map((b) => b.id)
    const plads = (id: string) => raekkefoelge.indexOf(id)
    tjek('den indkørte kildes bolig er med i søgningen', plads(fraIndkoert) >= 0)
    tjek('… og den står FØR den nye kildes bagkatalog',
      fraNy.every((id) => plads(id) === -1 || plads(id) > plads(fraIndkoert)),
      `indkørt på ${plads(fraIndkoert)}, bagkatalog på ${fraNy.map(plads).join(', ')}`)
    // Den EGENTLIGE invariant. Bemaerk at den IKKE er «bagkatalog sidst»:
    // en bagkatalogbolig, hvis kilde selv oplyser en dato, beholder sin
    // plads efter DEN dato — det er praecis forskellen paa at bruge
    // kildedatoen og at lade vaere. Det, der skal ligge sidst, er de
    // DATOLOESE: bagkatalog uden en dato fra kilden.
    //
    // Foerste udgave af den her proeve maalte «bagkatalog sidst» og bestod
    // paa testbasen, hvor ingen fixtur har en kildedato. Mod produktionen
    // faldt den straks — foerste bagkatalog paa 75, sidste ikke-bagkatalog
    // paa 253 — fordi Propstep, LokalBolig og findbolig.nu ALLE oplyser
    // datoer. Proeven var forkert, ikke sorteringen.
    //
    // Bundet til `NYHEDSDATO` fra lib/soeg.ts, ikke til en kopi: to
    // definitioner af det samme driver fra hinanden.
    const bagIder = new Set((await db.select({ id: listings.id })
      .from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(udenDubletter(hvor({})), dsql`${NYHEDSDATO} is null`))).map((r) => r.id))
    const flag = raekkefoelge.map((x) => bagIder.has(x))
    const foersteBag = flag.indexOf(true)
    const sidsteIkkeBag = flag.lastIndexOf(false)
    tjek('ingen datoløs bagkatalogbolig står før en med en dato',
      foersteBag === -1 || foersteBag > sidsteIkkeBag,
      `første datoløse på ${foersteBag}, sidste med dato på ${sidsteIkkeBag}`)
    // Og undtagelsen: HENDES annonce er native og har ingen koersler i
    // crawl_runs. Uden undtagelsen ville hun regnes som bagkatalog og
    // ligge permanent begravet under enhver importkoersel.
    tjek('en udlejerannonce regnes IKKE som bagkatalog',
      plads(id) >= 0 && plads(id) < plads(fraNy[0]!) || plads(fraNy[0]!) === -1,
      `hun på ${plads(id)}, bagkatalog på ${plads(fraNy[0]!)}`)

    // ── Udlejerannoncer maa ikke gaa ud i alarmmails ────────────
    // De faldt foer ud ved et tilfaelde, fordi `native` ikke har nogen
    // koersel i crawl_runs. Nu staar det udtrykkeligt i matchAlarmer, og
    // her staar proeven, saa det ikke kan glide tilbage.
    console.log('\n══ en udlejerannonce må ikke i en alarmmail ══')
    // Boligen faar en kilde-dato. Uden den ville proeven bestaa af den
    // FORKERTE grund: matchAlarmer springer boliger over, hvis kilden
    // ikke har nogen koersel i crawl_runs, og det har `native` ikke.
    // Med datoen slipper den forbi det filter, og saa er det kun den
    // udtrykkelige spaerring, der holder den ude — som er den, vi tester.
    await db.update(listings)
      .set({ sourceCreatedAt: new Date() })
      .where(eq(listings.id, id))
    const [boligNu] = await db.select({
      set: listings.firstSeenAt, hosKilden: listings.sourceCreatedAt,
    }).from(listings).where(eq(listings.id, id))

    // Soegningen skal vaere AELDRE end boligen. `gt(firstSeenAt, s.oprettet)`
    // i matchAlarmer betyder, at en gemt soegning aldrig ser boliger, der
    // fandtes foer den — gulvet for hvad der er "nyt".
    //
    // Proeven oprettede foer sin soegning EFTER boligen, med `criteria: {}`
    // og oprettelsestidspunktet nu. Den kunne derfor aldrig se hendes bolig,
    // og `!traf` var sandt af den grund alene. Det eneste, der fik proeven
    // til at bide, var en RIGTIG brugers aeldre soegning, der laa i
    // produktionen — «alt nyt», oprettet 1. september. Proeven maalte altsaa
    // noget, den hverken ejede eller kendte, og paa en ren base ville den
    // bestaa, ogsaa hvis spaerringen blev slettet.
    const foerBoligen = new Date(+boligNu!.set - 3600_000)
    const [gemtSoegning] = await db.insert(savedSearches).values({
      userId: u!.id,
      name: 'proeve: udlejerannonce i alarm',
      // Kriterier proeven selv kender, og saa snaevre som de kan vaere og
      // stadig ramme hende. `{}` ville ramme hver eneste bolig i basen.
      criteria: { postnr: FULDT.postnr, vaerelserMin: FULDT.vaerelser, arealMin: FULDT.areal },
      createdAt: foerBoligen,
      confirmedAt: foerBoligen,
      notifyEmail: true,
    }).returning()

    // ── Praemisserne, foer selve proeven ─────────────────────────
    // Uden dem er `!traf` intetsigende. Tre ting skal holde, for at
    // native-spaerringen er den ENESTE tilbagevaerende grund til, at hendes
    // bolig ikke bliver et traef. Holder de ikke, siger proeven ingenting.
    tjek('præmis: søgningen er ældre end boligen',
      +gemtSoegning!.createdAt < +boligNu!.set,
      `${gemtSoegning!.createdAt.toISOString()} < ${boligNu!.set.toISOString()}`)
    tjek('præmis: kilde-datoen er sat, så indkøringsvagten ikke afgør det',
      boligNu!.hosKilden !== null)
    const [rammer] = await db.select({ n: dsql<number>`count(*)::int` })
      .from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(hvor(gemtSoegning!.criteria as Filtre), eq(listings.id, id)))
    tjek('præmis: kriterierne rammer faktisk hendes bolig', rammer!.n === 1)

    // Afgraenset til proevens EGEN soegning. Uden `kun` skriver kaldet
    // alert_matches for alle fem rigtige brugersoegninger — og det er ikke
    // teoretisk vigtigt her: fjerner man spaerringen for at efterproeve
    // proeven, ville hendes bolig blive et traef paa en FREMMED soegning
    // med `sent_at = null`, og naeste import ville sende mailen.
    await matchAlarmer([gemtSoegning!.id])
    const [traf] = await db.select().from(alertMatches)
      .where(eq(alertMatches.listingId, id)).limit(1)
    tjek('native bolig er IKKE et alarmtræf', !traf)

    // Der staar bevidst INGEN positiv kontrol her — altsaa ingen
    // ikke-native bolig, der beviser at soegningen ville have ramt. En
    // saadan raekke skal passere indkoeringsvagten for at kunne rammes af
    // proevens egen soegning, og saa kan den ogsaa rammes af Railways
    // ualgraensede matchAlarmer i de sekunder, den findes. Praemisserne
    // ovenfor daekker det samme uden at lave raekken. At proeven FAKTISK
    // fejler uden spaerringen, er efterproevet i haanden ved at fjerne
    // linjen i lib/alarm.ts og koere — se commit-beskeden.
    await db.delete(alertMatches).where(eq(alertMatches.savedSearchId, gemtSoegning!.id))
    await db.delete(savedSearches).where(eq(savedSearches.id, gemtSoegning!.id))

  } finally {
    for (const b of ekstra.boliger) {
      await db.delete(listingImages).where(eq(listingImages.listingId, b))
      await db.delete(listings).where(eq(listings.id, b))
    }
    for (const u2 of ekstra.brugere) await db.delete(users).where(eq(users.id, u2))
    for (const k of ekstra.kilder) {
      await db.delete(crawlRuns).where(eq(crawlRuns.sourceId, k))
      await db.delete(sources).where(eq(sources.id, k))
    }
    if (rivalId) {
      await db.delete(listingImages).where(eq(listingImages.listingId, rivalId))
      await db.delete(listings).where(eq(listings.id, rivalId))
    }
    // Efter rivalen: boligerne peger paa kilden.
    if (proevekildeId) await db.delete(sources).where(eq(sources.id, proevekildeId))
    if (id) {
      await db.delete(listingImages).where(eq(listingImages.listingId, id))
      await db.delete(listings).where(eq(listings.id, id))
    }
    await db.delete(users).where(eq(users.id, u!.id))
  }

  if (sprunget) {
    console.log(`\n  ${sprunget} sprunget over — de måler det rigtige udbud`
      + ' og kan kun køre mod produktion: npm run test:prod')
  }
  console.log(fejl ? `\n  ${fejl} fejl.` : '\n  Alt bestod.')
  await luk()
  process.exit(fejl ? 1 : 0)
}

await main()
