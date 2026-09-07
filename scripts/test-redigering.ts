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
//   13. At billedforbeholdet ikke skubber kortets tekst en raekke ned.
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
import { alertMatches, crawlRuns, fetchFailures, hostBlocks, listingImages, listings, savedSearches, sources, users } from '../db/schema'
import { matchAlarmer } from '../lib/alarm'
import { byForPostnr } from '../lib/omraade'
import { laesBolig as dacasLaes } from '../adapters/dacas'
import { laesSag as homeLaes } from '../adapters/home'
import { laes as balderLaes } from '../adapters/balder'
import { findSearchResponse as cejFind, laes as cejLaes } from '../adapters/cej'
import {
  _nulstilBudgetAdvarsel, detaljesignatur as hsSignatur, heimstadenAdapter,
  laesDetalje as hsDetalje, laesDetaljeBudget, laesListe as hsListe,
  STANDARD_DETALJEBUDGET,
} from '../adapters/heimstaden'
import { cejAdapter } from '../adapters/cej'
import { birchAdapter } from '../adapters/birch'
import { laesDetalje as birchDetalje, laesFeed as birchFeed } from '../adapters/birch'
import { laesAvailabilityFacts } from '../lib/fakta'
import { koerKilde, skrivBolig } from '../lib/ingest'
import { findKilde, rigtigeKilder } from '../adapters'
import { _saetTakt, politeFetch, taktFor } from '../lib/fetch'
import {
  _nulstilBudgetAdvarsel as larosNulstilAdvarsel, detaljesignatur as larosSignatur,
  laesDetalje as larosDetalje, laesListe as larosListe, larosAdapter,
  STANDARD_DETALJEBUDGET_LAROS,
} from '../adapters/laros'
import {
  _nulstilAdvarsler as alabuNulstilAdvarsler, _nulstilBudgetAdvarsel as alabuNulstilBudgetAdvarsel,
  alabuAdapter, detaljesignatur as alabuSignatur, laesDetalje as alabuDetalje, laesListe as alabuListe,
  STANDARD_DETALJEBUDGET_ALABU,
} from '../adapters/alabu'
import {
  _aktivRunner, _cachetSvar, _goerCacheGammel, _nulstilCache, _saetRunner,
  laesRetryAfter, noterSkip, spaer, spaerretTil, VaertBlokeretFejl,
} from '../lib/vaertsspaerre'
import { normaliser } from '../lib/normalize'
import type { VasketAdresse } from '../lib/address'
import type { RawListing, SourceAdapter } from '../lib/adapter'
import { KILDEKONTRAKTER } from '../lib/kildekontrakt'
import { forklar, fortolkAvailability } from '../lib/availability'
import { isoDato, kalenderdag } from '../lib/dato'
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
  // ── Hvad cron'en faktisk kalder ──────────────────────────────
  // Railway koerer `npm run import` UDEN argumenter hver time, og den
  // koerer rigtigeKilder(). En kilde, der registreres uden at blive holdt
  // tilbage, begynder derfor at kalde ud i samme oejeblik, den er pushet.
  // Heimstadens CDN droevler vedvarende crawl, saa foerste genkontakt
  // skal vaere navngivet og bevidst — ikke en cron-runde efter et deploy.
  console.log('\n══ hvilke kilder cron\'en kalder ══')
  const automatiske = rigtigeKilder().map((k) => k.adapter.id)
  const forventede = [
    'findbolig', 'propstep', 'dacas', 'lokalbolig',
    'balder', 'home', 'cej', 'heimstaden', 'birch', 'laros', 'alabu',
  ]
  // Listen skrives ORDRET ud, ikke bare tjekket for medlemskab: en kilde,
  // der lydløst forsvinder fra cron'en, holder op med at levere boliger
  // uden at noget fejler nogen steder. Og en kilde, der lydløst dukker OP,
  // begynder at kalde ud til en fremmed vært, uden nogen besluttede det.
  tjek('cron kalder præcis de elleve kilder, vi tror',
    JSON.stringify(automatiske) === JSON.stringify(forventede), automatiske.join(', '))
  // Heimstaden kom med 7. sep. 2026 efter to kontrollerede prøver.
  // Detaljebudgettet er stadig skruet ned på Railway; se noten i
  // adapters/index.ts. Fuld høst er ikke godkendt.
  tjek('heimstaden er med i cron\'en — men budgettet står stadig lavt',
    automatiske.includes('heimstaden'))
  tjek('ingen testkilder i automatiske kørsler',
    !automatiske.some((k) => k.startsWith('dummy')), automatiske.join(', '))
  tjek('præmis: findKilde kan stadig slå en kilde op ved navn',
    findKilde('heimstaden') !== undefined)
  // Alabu kom med 7. sep. 2026 efter godkendt kontrolleret import (22 netto
  // nye, 18 i Aalborg, 0 overlap, 0 fejl). Standardtakt, budget 30.
  tjek('alabu er med i cron\'en efter godkendt måling 7/9',
    findKilde('alabu') !== undefined && automatiske.includes('alabu'))

  console.log('\n══ rettigheder i public ══')
  const aabne = await tjekRettigheder()
  tjek('intet i public er åbent for anon eller authenticated',
    aabne.length === 0,
    aabne.map((f) => `${f.slags} ${f.navn}: ${f.grund.split(' — ')[0]}`).join(' · '))

  // Navngivet med vilje oven i den generelle prøve. host_blocks styrer,
  // om crawleren overhovedet kalder ud: kunne anon skrive i den, kunne
  // enhver sætte blocked_until til år 2099 og standse hele importen.
  // Den generelle prøve ville også fange det — men ikke fortælle hvorfor
  // det er værre end for de andre tabeller.
  const rlsSvar = await db.execute(dsql`
    select relrowsecurity as rls from pg_class where relname = 'host_blocks'`)
  const [rlsHostBlocks] = ((rlsSvar as { rows?: { rls: boolean }[] }).rows
    ?? (rlsSvar as unknown as { rls: boolean }[]))
  tjek('host_blocks har RLS — spærretabellen må ikke kunne skrives udefra',
    rlsHostBlocks?.rls === true, JSON.stringify(rlsHostBlocks))

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
    availability: {
      timing: { nu: 0, senere: 0, unknown: 3, conflict: 0 },
      marked: { paa_markedet: 0, reserveret: 0, udlejet: 0, unknown: 3, conflict: 0 },
      ansoegning: { normal: 0, venteliste: 0, unknown: 3, conflict: 0 },
      adgang: { bopaelskrav: 0, medlemskrav: 0 },
      tidligstSenere: null, ensSenereDato: false,
    },
    ...o,
  } as unknown as Gruppe)

  const vis = (el: React.ReactElement) => renderToStaticMarkup(el)
  /** Kortenes referenceNow i proeverne — fast, aldrig maskinens ur. */
  const KORTNU = new Date('2026-09-05T12:00:00Z')

  // ── Kalenderdatoer: en dag er ikke et oejeblik ───────────────
  // «Kan overtages 5. september» skal gaelde HELE den 5. september i
  // DANMARK. Kl. 00:30 dansk tid skriver UTC stadig den 4. — en
  // UTC-baseret sammenligning ville sige «senere» en halv time inde i
  // den rigtige dag. Instanterne her er valgt, saa UTC-dagen og den
  // danske dag er FORSKELLIGE: bestaar proeven, kan implementeringen
  // hverken bruge UTC eller serverens lokale zone.
  const NU = new Date('2026-09-05T12:00:00Z')
  const D = (iso: string) => {
    const d = isoDato(iso)
    if (!d) throw new Error(`fixtur-dato er ikke en kalenderdag: ${iso}`)
    return d
  }
  console.log('\n══ kalenderdag: døgnskift i Europe/Copenhagen ══')
  tjek('isoDato: rigtig dag accepteres', isoDato('2026-09-05') === '2026-09-05')
  for (const daarlig of ['2026-02-31', '2026-13-01', '2026-09-05T00:00:00Z', 'i morgen', '05-09-2026']) {
    tjek(`isoDato afviser «${daarlig}»`, isoDato(daarlig) === null)
  }
  tjek('kalenderdag: 22:30Z den 4. ER den 5. i Danmark (sommertid)',
    kalenderdag(new Date('2026-09-04T22:30:00Z')) === '2026-09-05',
    kalenderdag(new Date('2026-09-04T22:30:00Z')))

  const timingVed = (dato: string, refIso: string) =>
    fortolkAvailability({ sourceAvailabilityDate: D(dato) },
      KILDEKONTRAKTER.native!, new Date(refIso)).timing.status
  // Hele den danske 5. september giver samme konklusion.
  for (const [ref, vent, note] of [
    ['2026-09-04T21:59:59Z', 'senere', '23:59:59 dansk, stadig d. 4.'],
    ['2026-09-04T22:00:01Z', 'nu', '00:00:01 dansk — dagen ER begyndt, UTC siger stadig d. 4.'],
    ['2026-09-05T12:00:00Z', 'nu', 'midt paa dagen'],
    ['2026-09-05T21:59:59Z', 'nu', '23:59:59 dansk, sidste sekund af d. 5.'],
  ] as const) {
    tjek(`5. sep. @ ${note}: ${vent}`, timingVed('2026-09-05', ref) === vent,
      timingVed('2026-09-05', ref))
  }
  // Vintertid: DK er UTC+1, saa doegnet skifter kl. 23:00Z.
  for (const [ref, vent] of [
    ['2026-11-30T22:59:59Z', 'senere'],
    ['2026-11-30T23:00:01Z', 'nu'],
  ] as const) {
    tjek(`1. dec. (vintertid) @ ${ref.slice(11, 19)}Z: ${vent}`,
      timingVed('2026-12-01', ref) === vent, timingVed('2026-12-01', ref))
  }

  // ── Parseren: laesning gaar ALDRIG gennem en cast ────────────
  console.log('\n══ availability_facts: parseren ══')
  const rt = laesAvailabilityFacts({
    rawStatus: 'Reserved', rentalAvailableNow: false,
    sourceAvailabilityDate: '2026-10-01', takeoverText: null,
  })
  tjek('round-trip: false OVERLEVER', rt?.rentalAvailableNow === false,
    String(rt?.rentalAvailableNow))
  tjek('round-trip: eksplicit null bevares', rt !== null && 'takeoverText' in rt && rt.takeoverText === null)
  tjek('round-trip: fravaerende nøgle forbliver fravaerende',
    rt !== null && !('rawApplicationType' in rt))
  tjek('round-trip: datoen er kalenderdag', rt?.sourceAvailabilityDate === '2026-10-01')
  tjek('misdannet KENDT felt kasserer hele objektet (fail closed)',
    laesAvailabilityFacts({ rawStatus: 'Ledig', sourceAvailabilityDate: '2026-02-31' }) === null)
  tjek('misdannet boolean kasserer også', laesAvailabilityFacts({ rentalAvailableNow: 'ja' }) === null)
  const medTypo = laesAvailabilityFacts({ rentalAvailbleNow: true, rawStatus: 'Ledig' })
  tjek('ukendt nøgle (typo) vælter IKKE objektet',
    medTypo !== null && medTypo.rawStatus === 'Ledig' && !('rentalAvailbleNow' in medTypo))
  tjek('ikke-objekt giver null', laesAvailabilityFacts('Ledig') === null
    && laesAvailabilityFacts([1]) === null && laesAvailabilityFacts(undefined) === null)

  // ── Balder-fixturen: fem frosne hits gennem parsningen ───────
  console.log('\n══ balder: acquisition_date som kalenderdag ══')
  const hit = (acq: unknown) => ({
    slug: 'proevevej-1-2300', id: 'a0TESTID', street: 'Prøvevej 1',
    postal_code: '2300', city: 'København S', gross_area: 70,
    number_of_rooms: 3, rent: 12000, status: 'Ledig', acquisition_date: acq,
  })
  const bAf = (acq: unknown) => balderLaes(hit(acq))?.availability
  tjek('fortidig dato læses', bAf('2026-08-01')?.sourceAvailabilityDate === '2026-08-01')
  tjek('dagens dato læses', bAf('2026-09-05')?.sourceAvailabilityDate === '2026-09-05')
  tjek('fremtidig dato læses', bAf('2026-12-15')?.sourceAvailabilityDate === '2026-12-15')
  tjek('eksplicit null bevares som null',
    bAf(null) !== undefined && bAf(null)!.sourceAvailabilityDate === null)
  const bMis = bAf('15. december 2026')
  tjek('misdannet dato udelades — opfindes ikke',
    bMis !== undefined && !('sourceAvailabilityDate' in bMis!))
  tjek('rawStatus er kildens eget ord', bAf('2026-08-01')?.rawStatus === 'Ledig')

  // ── Flip-punktet: dato ±1 dag × boolean ──────────────────────
  // Den empiriske maaling havde et 29-dages hul omkring graensen. Her
  // afgoeres den KONSTRUERET: enige signaler giver nu/senere, uenige
  // giver conflict. Ingen «boolean vinder», ingen «dato vinder».
  console.log('\n══ home: flip-punktet, konstrueret ══')
  const REFDAG = kalenderdag(NU)  // 2026-09-05 i Europe/Copenhagen
  const dagFoer = D('2026-09-04'), dagEfter = D('2026-09-06')
  for (const [navn, dato, bool, vent] of [
    ['dato i går   + true',  dagFoer, true, 'nu'],
    ['dato i dag   + true',  REFDAG, true, 'nu'],
    ['dato i morgen + true', dagEfter, true, 'conflict'],
    ['dato i går   + false', dagFoer, false, 'conflict'],
    ['dato i dag   + false', REFDAG, false, 'conflict'],
    ['dato i morgen + false', dagEfter, false, 'senere'],
  ] as const) {
    const r = fortolkAvailability(
      { rentalAvailableNow: bool, sourceAvailabilityDate: dato },
      KILDEKONTRAKTER.home!, NU)
    tjek(`flip: ${navn} → ${vent}`, r.timing.status === vent, r.timing.status)
  }

  // ── Dacas' datofelt: kildens egen «Overtagelsesdato:» ────────
  // Kontrakten giver nu datoen tidsevidens — belægget er kildens egen
  // etiket, samme ordklasse som Balders. «Snarest» bærer stadig sin
  // evidens gennem teksten, og en side har enten dato ELLER «Snarest»,
  // så de to veje kan ikke mødes i en falsk konflikt.
  console.log('\n══ dacas: datoen har tidsevidens ══')
  const dacasT = (fakta: Record<string, unknown>) =>
    fortolkAvailability(fakta, KILDEKONTRAKTER.dacas!, NU).timing.status
  tjek('dacas fortidig dato → nu',
    dacasT({ takeoverText: '15. august 2026', sourceAvailabilityDate: D('2026-08-15') }) === 'nu')
  tjek('dacas dags dato → nu',
    dacasT({ takeoverText: '5. september 2026', sourceAvailabilityDate: D('2026-09-05') }) === 'nu')
  tjek('dacas fremtidig dato → senere',
    dacasT({ takeoverText: '1. november 2026', sourceAvailabilityDate: D('2026-11-01') }) === 'senere')
  tjek('dacas «Snarest» uden dato → stadig nu, gennem teksten',
    dacasT({ takeoverText: 'Snarest' }) === 'nu')
  tjek('dacas tekstdato giver IKKE evidens gennem overtagelsestekst',
    fortolkAvailability({ takeoverText: '1. november 2026' },
      KILDEKONTRAKTER.dacas!, NU).timing.status === 'unknown')

  // ── home.dk: ledigdatoen skal vaere SAGENS, ikke naboens ─────
  // Payloaden er flad: hvert felt er et INDEKS ind i én liste, og
  // detaljesiden baerer de beslaegtede annoncers availability-objekter
  // med. Fixturen laegger NABOENS objekt FOERST i listen, saa en global
  // «foerste objekt med feltet»-laesning vaelger den forkerte dato —
  // praecis den gamle adfaerd.
  console.log('\n══ home.dk: ledigdato bundet til sagens id ══')
  const HJEM_FLAD: unknown[] = [
    'meta',                                              // 0
    { id: 2, offer: 3, availability: 5 },                // 1  NABOEN — foerst
    'NABO1',                                             // 2
    { rentalPricePerMonth: 4 },                          // 3
    { amount: 9000 },                                    // 4
    { rentalAvailableFrom: 6, isRentalAvailableNow: 7 }, // 5  naboens dato
    '2099-01-01T00:00:00',                               // 6
    false,                                               // 7
    { id: 9, offer: 10, availability: 12 },              // 8  SAGEN
    'SAG1',                                              // 9
    { rentalPricePerMonth: 11 },                         // 10
    { amount: 12000 },                                   // 11
    { rentalAvailableFrom: 13, isRentalAvailableNow: 14 }, // 12  sagens dato
    '2026-10-01T00:00:00',                               // 13
    false,                                               // 14
  ]
  const HJEM_G = {
    id: 'SAG1', url: 'https://home.dk/x', adresse: 'Prøvevej 1, 2300 København S',
    postnr: '2300', areal: 70, leje: undefined, type: 'lejlighed',
    billeder: ['https://alvis.b-cdn.net/x/1.jpg'],
  }
  const hjemSag = homeLaes(HJEM_FLAD, HJEM_G, 'https://home.dk/x')
  tjek('præmis: naboens dato står FØRST i den flade liste',
    JSON.stringify(HJEM_FLAD).indexOf('2099-01-01') < JSON.stringify(HJEM_FLAD).indexOf('2026-10-01'))
  tjek('ledigdatoen er sagens egen, ikke naboens',
    hjemSag.availableFrom === '2026-10-01', String(hjemSag.availableFrom))
  tjek('… og lejen er sagens egen', hjemSag.rentMonthly === 1200000,
    String(hjemSag.rentMonthly))

  // ── UI læser DOMÆNET — aldrig legacy ─────────────────────────
  // Fixturerne er bygget så legacy og domæne SIGER NOGET FORSKELLIGT.
  // Læser kortet igen available_from/application_type til availability,
  // vælger det den forkerte side, og prøven bliver rød.
  console.log('\n══ kortet følger domænet, ikke legacy ══')
  const legacySiger = bolig({
    kilde: 'native', kildetype: 'native',
    // LEGACY siger «ledig nu» (dato i fortiden) …
    ledigFra: new Date('2026-08-01T00:00:00Z'),
    // … men DOMÆNET siger senere (kildens dato er i fremtiden).
    availabilityFacts: { sourceAvailabilityDate: '2026-12-01' },
  })
  const h1 = vis(createElement(Kort, { nu: KORTNU, b: legacySiger }))
  tjek('timing fra domænet: «kan overtages fra», ikke legacy «ledig nu»',
    h1.includes('kan overtages fra 1. december 2026') && !h1.includes('ledig nu'))
  const h2 = vis(createElement(Kort, { nu: KORTNU, b: bolig({
    kilde: 'native', kildetype: 'native',
    ansoegning: 'waiting_list',      // legacy påstår venteliste
    availabilityFacts: {},           // domænet: ingen evidens
  }) }))
  tjek('ventelistemærkat kun fra domænet — legacy application_type ignoreres',
    !h2.includes('m-vent'))
  tjek('unknown har ORD, ikke tomhed', h2.includes('overtagelse ikke afklaret'))
  const h3 = vis(createElement(Kort, { nu: KORTNU, b: bolig({
    kilde: 'dacas', kildetype: 'spider',
    availabilityFacts: { takeoverText: 'Snarest' },
  }) }))
  tjek('Snarest vises evidensnært, ikke som klassifikationen',
    h3.includes('overtagelse: snarest') && !h3.includes('kan overtages nu'))

  // ── Gruppekortets sammenfatning: A–E ─────────────────────────
  console.log('\n══ gruppekortet sammenfatter som tællinger ══')
  const gAv = (o: Partial<ReturnType<typeof tomSammenfatning>>) =>
    ({ ...tomSammenfatning(), ...o })
  function tomSammenfatning() {
    return {
      timing: { nu: 0, senere: 0, unknown: 0, conflict: 0 },
      marked: { paa_markedet: 0, reserveret: 0, udlejet: 0, unknown: 0, conflict: 0 },
      ansoegning: { normal: 0, venteliste: 0, unknown: 0, conflict: 0 },
      adgang: { bopaelskrav: 0, medlemskrav: 0 },
      tidligstSenere: null as string | null, ensSenereDato: false,
    }
  }
  const gruppeHtml = (av: ReturnType<typeof tomSammenfatning>) =>
    vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({ availability: av }) }))
  const gA = gruppeHtml(gAv({ timing: { nu: 1, senere: 2, unknown: 0, conflict: 0 } }))
  tjek('A: 1 nu + 2 senere → tællinger, ikke én status',
    gA.includes('1 kan overtages nu · 2 senere'))
  const gB = gruppeHtml(gAv({ timing: { nu: 0, senere: 2, unknown: 1, conflict: 0 } }))
  tjek('B: unknown forsvinder ikke ud af en blandet linje',
    gB.includes('2 senere · 1 uden afklaret overtagelse'))
  const gC = gruppeHtml(gAv({ timing: { nu: 3, senere: 0, unknown: 0, conflict: 0 },
    marked: { paa_markedet: 2, reserveret: 1, udlejet: 0, unknown: 0, conflict: 0 } }))
  tjek('C: delvis reserveret vises som «1 af 3 reserveret»',
    gC.includes('1 af 3 reserveret'))
  const gD = gruppeHtml(gAv({ timing: { nu: 3, senere: 0, unknown: 0, conflict: 0 },
    ansoegning: { normal: 2, venteliste: 1, unknown: 0, conflict: 0 } }))
  tjek('D: blandet ansøgning vises som tal',
    gD.includes('1 venteliste · 2 almindelig'))
  const gE = gruppeHtml(gAv({ timing: { nu: 0, senere: 3, unknown: 0, conflict: 0 },
    tidligstSenere: '2026-10-01', ensSenereDato: false }))
  tjek('E: forskellige datoer → «tidligst fra», aldrig som alles dato',
    gE.includes('tidligst fra 1. oktober 2026') && !gE.includes('kan overtages fra'))
  const gE2 = gruppeHtml(gAv({ timing: { nu: 0, senere: 3, unknown: 0, conflict: 0 },
    tidligstSenere: '2026-11-01', ensSenereDato: true }))
  tjek('… og ens datoer → «kan overtages fra»',
    gE2.includes('kan overtages fra 1. november 2026'))
  const ALLE_NU = gruppeHtml(gAv({ timing: { nu: 3, senere: 0, unknown: 0, conflict: 0 } }))
  tjek('alle nu → én status er ærlig', ALLE_NU.includes('kan overtages nu'))

  // ── Availability: fakta, ikke stemmer ────────────────────────
  // Fast referenceNow. Funktionen kalder aldrig systemuret — samme lære
  // som Dacas-fejlen, hvor «Snarest» blev til vores eget ur.
  console.log('\n══ availability: de syv kilder ══')
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
    const html = vis(createElement(Kort, { nu: KORTNU, b: bolig(b2) }))
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
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: true }) })), true],
    ['enkeltkort, intet forbehold',
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: false }) })), false],
    ['gruppekort, forbehold + billede',
      vis(createElement(Gruppekort, { nu: KORTNU,
        g: gruppe({}, { ...medBillede, billedforbehold: true }),
      })), true],
    ['gruppekort, intet forbehold',
      vis(createElement(Gruppekort, { nu: KORTNU,
        g: gruppe({}, { ...medBillede, billedforbehold: false }),
      })), false],
    // Uden et billede er der intet at tage forbehold for.
    ['enkeltkort, forbehold men INTET billede',
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ forside: null, billedforbehold: true }) })), false],
  ] as const) {
    const har = html.includes(FORB_KORT)
    tjek(`${navn}: ${skal ? 'linjen står' : 'ingen linje'}`, har === skal,
      har ? 'linjen står' : 'ingen linje')
  }

  // ── Forbeholdet maa ikke skubbe teksten en raekke ned ────────
  // `.kort` er et gitter med to spalter, og felterne placeres af
  // raekkeflowet. Var forbeholdet et gitterfelt FOR SIG, maatte det
  // traekkes tilbage i spalte 1 med `grid-column: 1` — og spalte 1
  // ligger BAGUD for indsaetningspunktet, som stod i raekke 1 spalte 2
  // efter billedet. Flowet rykkede derfor en raekke ned for at faa plads
  // og efterlod punktet i raekke 2, hvor `.kort-krop` saa landede.
  // Raekke 1's hoejre felt stod tomt: maalt til krop-top 193 px mod 13 px
  // uden forbehold — ~180 px hvidt hul oeverst til hoejre, paa BEGGE
  // korttyper, og kun paa de kort der HAR et forbehold.
  //
  // Det var hverken align-items eller et row-span. Kroppen laa i den
  // forkerte RAEKKE, og raekkeantallet afhang af, om forbeholdet var der.
  // Derfor maaler proeven netop det: hvilke elementer der er DIREKTE
  // boern af kortet. Er de de samme med og uden forbehold, har gitteret
  // det samme antal raekker, og kroppen kan ikke skubbes ned.
  //
  // En proeve paa CSS-teksten ville ikke fange det. Begge regler var
  // hver for sig rigtige; det var sammenstillingen, der var forkert.
  console.log('\n══ forbeholdet må ikke skubbe teksten en række ned ══')

  /** Klasserne paa kortets DIREKTE boern, i orden. Statisk markup, saa en
   *  tag-taeller raekker — og den er uafhaengig af klassenavnene. */
  const TOMME_TAGS = new Set(['img', 'br', 'input', 'hr', 'meta', 'link'])
  const direkteBoern = (html: string): string[] => {
    const boern: string[] = []
    let dybde = 0
    for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>/g)) {
      const attr = m[3] ?? ''
      if (m[1] === '/') { dybde--; continue }
      if (dybde === 1) boern.push(/class="([^"]*)"/.exec(attr)?.[1] ?? '')
      if (!TOMME_TAGS.has(m[2]!) && !attr.trimEnd().endsWith('/')) dybde++
    }
    return boern
  }
  tjek('prøvens præmis: tag-tælleren finder kortets felter',
    direkteBoern(vis(createElement(Kort,
      { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: false }) })))
      .join('|') === 'kort-billedblok|kort-krop',
    direkteBoern(vis(createElement(Kort,
      { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: false }) }))).join('|'))

  for (const [navn, medHtml, udenHtml] of [
    ['enkeltkort',
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: true }) })),
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ ...medBillede, billedforbehold: false }) }))],
    ['gruppekort',
      vis(createElement(Gruppekort, { nu: KORTNU,
        g: gruppe({}, { ...medBillede, billedforbehold: true }) })),
      vis(createElement(Gruppekort, { nu: KORTNU,
        g: gruppe({}, { ...medBillede, billedforbehold: false }) }))],
  ] as const) {
    const med = direkteBoern(medHtml)
    const uden = direkteBoern(udenHtml)
    tjek(`${navn}: forbeholdet er ikke et gitterfelt for sig`,
      !med.some((k) => k.includes('billedforbehold')),
      med.join(' | '))
    tjek(`${navn}: samme gitterfelter med og uden forbehold`,
      med.join('|') === uden.join('|'),
      med.join('|') === uden.join('|') ? '' : `${med.join('|')} ≠ ${uden.join('|')}`)
    // Modstykket: proeven maa ikke kunne bestaas ved at fjerne linjen.
    // Den SKAL staa — inde i billedfeltet, foer kroppen.
    tjek(`${navn}: linjen står stadig, inde i billedfeltet`,
      new RegExp(`kort-billedblok[\\s\\S]*${FORB_KORT}[\\s\\S]*kort-krop`).test(medHtml))
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
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ total: null, poster: null }) }))],
    ['gruppekort, ingen total',
      vis(createElement(Gruppekort, { nu: KORTNU,
        g: gruppe({
          noegle: { kilde: 'proeve', postnr: '2200', vej: 'Prøvevej', vaerelser: 3, total: false },
          nogenUdenEl: true,
        } as Partial<Gruppe>, { total: null, poster: null }),
      }))],
    ['gruppekort, ingen total, samlet aconto',
      vis(createElement(Gruppekort, { nu: KORTNU,
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
    harElLinje(vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({ nogenUdenEl: true }) }))))

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
    ['enkeltkort, samlet aconto', vis(createElement(Kort, { nu: KORTNU, b: bolig(KLUMP) }))],
    ['gruppekort, én med samlet aconto',
      vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({ nogenUkendtDaekning: true }, KLUMP) }))],
  ] as const) {
    tjek(`${navn}: siger IKKE "El indgår ikke"`, !IKKE_MED.test(html),
      IKKE_MED.test(html) ? 'PÅSTÅR NOGET VI IKKE VED' : '')
    tjek(`${navn}: siger at beløbet er samlet`, UKENDT.test(html))
  }

  for (const [navn, html] of [
    ['enkeltkort, el ukendt', vis(createElement(Kort, { nu: KORTNU, b: bolig({}) }))],
    ['gruppekort, én uden el', vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({}) }))],
    ['gruppekort, alle uden el', vis(createElement(Gruppekort,
      { nu: KORTNU, g: gruppe({ nogenUdenEl: true }) }))],
  ] as const) {
    tjek(`${navn}: udspecificeret → "El indgår ikke"`, IKKE_MED.test(html))
    const groen = GROEN.test(html)
    tjek(`${navn}: grøn total`, groen)
    tjek(`${navn}: og el gjort rede for`, !groen || ELTEKST.test(html),
      groen && !ELTEKST.test(html) ? 'GRØN UDEN EL-LINJE' : '')
  }

  // Modstykket: er el faktisk oplyst, skal linjen IKKE staa — ellers ville
  // proeven kunne bestaa ved bare at skrive den paa alting.
  const medEl = vis(createElement(Kort, { nu: KORTNU,
    b: bolig({ el: 30000, poster: ['rent', 'heat', 'water', 'electricity'], total: 1330000 }),
  }))
  tjek('enkeltkort med el: ingen el-linje', !ELTEKST.test(medEl))
  const gruppeMedEl = vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({ nogenUdenEl: false }) }))
  tjek('gruppekort hvor alle har el: ingen el-linje', !ELTEKST.test(gruppeMedEl))

  // Og den staerkere formulering kun naar kilden selv siger det.
  const egen = vis(createElement(Gruppekort,
    { nu: KORTNU, g: gruppe({ nogenUdenEl: true, alleUdenElHarEgenMaaler: true }) }))
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
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ forside: FREMMED, billeder: 20 }) }))],
    ['gruppekort, fremmed vært',
      vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({}, { forside: FREMMED, billeder: 20 }) }))],
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
      vis(createElement(Kort, { nu: KORTNU, b: bolig({ forside: TILLADT, billeder: 3 }) }))],
    ['gruppekort, tilladt vært',
      vis(createElement(Gruppekort, { nu: KORTNU, g: gruppe({}, { forside: TILLADT, billeder: 3 }) }))],
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
      /ingen billeder/.test(vis(createElement(Kort, { nu: KORTNU, b: skjult }))))

    await saetBilleder([...Array.from({ length: 3 }, (_, i) => `${VIST_VAERT}/ok${i}.jpg`),
                        ...Array.from({ length: 2 }, (_, i) => `${SKJULT_VAERT}/nej${i}.jpg`)])
    const blandet = await kortet()
    tjek('blandede værter → kun de tilladte tælles', blandet.billeder === 3,
      String(blandet.billeder))
    tjek('… og forsiden er en tilladt URL',
      blandet.forside != null && blandet.forside.startsWith(VIST_VAERT), String(blandet.forside))
    tjek('… og kortet siger IKKE "ingen billeder"',
      !/ingen billeder/.test(vis(createElement(Kort, { nu: KORTNU, b: blandet }))))

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

    // ── availability_facts: snapshot, aldrig merge ───────────────
    console.log('\n══ availability_facts: snapshot og fuld pipeline ══')
    const VASK: VasketAdresse = {
      street: 'Snapshotvej', houseNumber: '1', floor: null, door: null,
      postalCode: '2300', city: 'København S',
      unitAddressUuid: crypto.randomUUID(), accessAddressUuid: null,
      addressMatchLevel: 'unit', lat: null, lng: null,
    }
    const [snapKilde] = await db.insert(sources).values({
      slug: `proeve-snap-${Date.now()}`, name: 'Prøve: snapshot',
      sourceType: 'feed', baseUrl: 'https://proeve.invalid', enabled: false,
    }).returning()
    ekstra.kilder.push(snapKilde!.id)
    const raaMed: RawListing = {
      externalKey: 'snap-1', sourceUrl: 'https://proeve.invalid/s1',
      address: 'Snapshotvej 1, 2300 København S', imageUrls: [],
      availability: { rentalAvailableNow: true, rawStatus: 'Ledig' },
    }
    const { id: snapId } = await skrivBolig(snapKilde!.id, 'feed',
      await normaliser(raaMed, VASK))
    ekstra.boliger.push(snapId)
    const hentFakta = async (bid: string) => {
      const [r] = await db.select({ f: listings.availabilityFacts })
        .from(listings).where(eq(listings.id, bid))
      return { raa: r!.f, laest: laesAvailabilityFacts(r!.f) }
    }
    const efterA = await hentFakta(snapId)
    tjek('import A: facten står der', efterA.laest?.rentalAvailableNow === true)

    // Import B: SAMME bolig — kilden siger ikke laengere noget.
    await skrivBolig(snapKilde!.id, 'feed',
      await normaliser({ ...raaMed, availability: {} }, VASK))
    const efterB = await hentFakta(snapId)
    tjek('import B: facten er VÆK — snapshot, ikke merge',
      efterB.laest !== null && !('rentalAvailableNow' in efterB.laest),
      JSON.stringify(efterB.raa))
    tjek('import B: {} og ikke NULL — behandlet, kilden gav intet',
      efterB.raa !== null && Object.keys(efterB.raa as object).length === 0)

    // NULL-tilstanden: en raekke, pipelinen aldrig har roert. Skabelon
    // fra snap-raekken selv, saa alle CHECK-begraensninger er opfyldt.
    const [snapRaekke] = await db.select().from(listings)
      .where(eq(listings.id, snapId))
    const { id: _sm, ...snapSkabelon } = snapRaekke!
    const [uroert] = await db.insert(listings).values({
      ...snapSkabelon,
      externalKey: `snap-nul-${Date.now()}`,
      sourceUrl: 'https://proeve.invalid/nul',
      unitAddressUuid: crypto.randomUUID(),
      availabilityFacts: null,
    }).returning({ id: listings.id })
    ekstra.boliger.push(uroert!.id)
    tjek('NULL betyder «aldrig høstet» og kan skelnes fra {}',
      (await hentFakta(uroert!.id)).raa === null)

    // ── deposit/prepaidRent: kildens egne beløb stilles igennem ────────
    // Kolonnerne fandtes kun for udlejerflowet; scrapede kilder skal kunne
    // bære dem samme vej som resten af økonomien. Beløbene er kildens egne
    // — de beregnes aldrig, og de følger kilden: forsvinder de i næste
    // import, forsvinder de her.
    const raaDep: RawListing = {
      externalKey: 'dep-1', sourceUrl: 'https://proeve.invalid/dep1',
      address: 'Snapshotvej 1, 2300 København S', imageUrls: [],
      rentMonthly: 1650000, deposit: 4950000, prepaidRent: 1650000,
    }
    const { id: depId } = await skrivBolig(snapKilde!.id, 'feed',
      await normaliser(raaDep, VASK))
    ekstra.boliger.push(depId)
    const hentDep = async (bid: string) => {
      const [r] = await db.select({ d: listings.deposit, f: listings.prepaidRent })
        .from(listings).where(eq(listings.id, bid))
      return r!
    }
    const depA = await hentDep(depId)
    tjek('deposit/prepaidRent: kildens beløb overlever pipeline → base',
      depA.d === 4950000 && depA.f === 1650000, JSON.stringify(depA))
    await skrivBolig(snapKilde!.id, 'feed',
      await normaliser({ ...raaDep, deposit: undefined, prepaidRent: undefined }, VASK))
    const depB = await hentDep(depId)
    tjek('deposit/prepaidRent: felter kilden ikke længere giver, bliver null',
      depB.d === null && depB.f === null, JSON.stringify(depB))

    // ── Fuld pipeline: adapter → normaliser → base → hydrering → domæne ──
    const pipelinen = async (raa: RawListing, kilde: string) => {
      const { id: bid } = await skrivBolig(snapKilde!.id, 'feed',
        await normaliser(raa, VASK))
      if (!ekstra.boliger.includes(bid)) ekstra.boliger.push(bid)
      const { laest } = await hentFakta(bid)
      return fortolkAvailability(laest ?? {}, KILDEKONTRAKTER[kilde]!, NU)
    }
    const bLedigSenere = balderLaes(hit('2026-12-15'))!
    const rBalder = await pipelinen({ ...bLedigSenere, externalKey: 'pipe-balder' }, 'balder')
    tjek('pipeline balder: Ledig + fremtidig dato → på markedet, senere',
      rBalder.marked.status === 'paa_markedet' && rBalder.timing.status === 'senere',
      `${rBalder.marked.status} · ${rBalder.timing.status}`)
    const rFind = await pipelinen({
      externalKey: 'pipe-find', sourceUrl: 'https://proeve.invalid/f',
      address: 'Snapshotvej 1, 2300', imageUrls: [],
      availability: { rawApplicationType: 'WaitingList' },
    }, 'findbolig')
    tjek('pipeline findbolig: WaitingList → venteliste',
      rFind.ansoegning.status === 'venteliste', rFind.ansoegning.status)
    const rProp = await pipelinen({
      externalKey: 'pipe-prop', sourceUrl: 'https://proeve.invalid/p',
      address: 'Snapshotvej 1, 2300', imageUrls: [],
      availability: { rawStatus: 'Available', sourceAvailabilityDate: D('2002-08-31') },
    }, 'propstep')
    tjek('pipeline propstep: Available + 2002-dato → på markedet, timing UNKNOWN',
      rProp.marked.status === 'paa_markedet' && rProp.timing.status === 'unknown',
      `${rProp.marked.status} · ${rProp.timing.status}`)
    const dacasRaa = dacasLaes(dacasSide('Snarest'), 'https://dacas.dk/bolig/pipe')!
    const rDacas = await pipelinen({ ...dacasRaa, externalKey: 'pipe-dacas' }, 'dacas')
    tjek('pipeline dacas: Snarest → timing nu, INGEN dato opstod',
      rDacas.timing.status === 'nu'
      && !rDacas.timing.evidens.some((e) => e.faktum === 'sourceAvailabilityDate'),
      rDacas.timing.status)
    // native: hendes egen annonce, skrevet af opretBolig tidligere.
    const hendesF = await hentFakta(id)
    const rNativ = fortolkAvailability(hendesF.laest ?? {}, KILDEKONTRAKTER.native!, NU)
    tjek('pipeline native: udlejerens ledigFra er facten',
      hendesF.laest?.sourceAvailabilityDate === FULDT.ledigFra,
      String(hendesF.laest?.sourceAvailabilityDate))
    tjek('pipeline native: → timing senere (ledig 1. dec.)',
      rNativ.timing.status === 'senere', rNativ.timing.status)

    // ── CEJ: allowlist, persondata og billedværter ───────────────
    // Kildens offentlige payload bærer persondata, der ikke vedkommer
    // annoncen (nuværende lejers navn/mail, boligsøgendes lead-data,
    // medarbejdere). Adapteren er derfor en eksplicit allowlist, og
    // prøven her beviser, at et OPDIGTET navn, en mail og et nummer
    // ikke overlever noget led: laes(), normaliseringen, databasen
    // eller konsollen. Fixturen er fri fantasi — ingen rigtige data.
    console.log('\n══ cej: allowlist — persondata må aldrig slippe igennem ══')
    const CEJ_VAERT = 'boligio-media-production.s3.eu-central-1.amazonaws.com'
    const PERSON = ['Test Person', 'test-person@example.invalid', '+45 00000000'] as const
    const cejItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      name: 'Prøvebolig', type: 'apartment', status: 'available',
      availableFrom: '2026-10-01', priceType: 'monthly',
      price: { amount: 16500 }, onAccountMonthly: { amount: 910 },
      securityDeposit: { amount: 49500 }, prepaidRent: { amount: 16500 },
      floorSize: 83, numberOfRooms: 3,
      location: {
        formatted: 'Snapshotvej 1, 2300 København S', zipCode: '2300',
        geo: { latitude: 55.65, longitude: 12.54 },
        dawa: { vejnavn: 'Snapshotvej', husnr: '1', postnr: '2300' },
      },
      media: {
        photos: [
          { url: `https://${CEJ_VAERT}/x/1.jpg` },
          { url: 'https://fremmed-vaert.example/x/2.jpg' },
        ],
        floorPlan: { url: `https://${CEJ_VAERT}/x/plan.jpg` },
      },
      amenities: ['elevator', 'petsAllowed', 'balconyOrTerrace'],
      appliances: ['dishwasher'],
      created: '2026-09-01T10:00:00.000Z', updated: '2026-09-05T22:00:00.000Z',
      description: '<p>Fin bolig.</p>',
      tenant: { id: '', name: PERSON[0], email: PERSON[1], phone: PERSON[2] },
      reservation: { lead: { firstName: 'Test', lastName: 'Person', email: PERSON[1], phone: PERSON[2] } },
      contacts: [{ type: 'caretaker', firstName: 'Test', lastName: 'Person', email: PERSON[1], phone: PERSON[2] }],
      assignees: [{ id: 'a1' }],
      vacatingAt: '2026-09-30', liableUntil: '2026-09-30', terminationNoticeDate: '2026-08-03',
      ...over,
    })

    const cb = cejLaes(cejItem())!
    tjek('cej laes: økonomi i øre — leje, aconto, depositum, forudbetalt',
      cb.rentMonthly === 1650000 && cb.utilitiesOther === 91000
      && cb.deposit === 4950000 && cb.prepaidRent === 1650000,
      JSON.stringify([cb.rentMonthly, cb.utilitiesOther, cb.deposit, cb.prepaidRent]))
    tjek('cej laes: kun egen vært overlever, plantegning holdes ude',
      cb.imageUrls.length === 1 && cb.imageUrls[0]!.endsWith('/x/1.jpg'),
      JSON.stringify(cb.imageUrls))
    tjek('cej laes: status og date-only dato som fakta',
      cb.availability?.rawStatus === 'available'
      && cb.availability?.sourceAvailabilityDate === isoDato('2026-10-01'),
      JSON.stringify(cb.availability))
    tjek('cej laes: eksplicit null-dato bevares som null',
      cejLaes(cejItem({ availableFrom: null }))!.availability!.sourceAvailabilityDate === null)
    tjek('cej laes: misdannet dato udelades — kan ikke være en kalenderdag',
      !('sourceAvailabilityDate' in cejLaes(cejItem({ availableFrom: 'snarest' }))!.availability!))
    tjek('cej laes: rækkehus oversættes, så det ikke ender som «hus»',
      cejLaes(cejItem({ type: 'terracedHouse' }))!.propertyType === 'rækkehus')
    tjek('cej laes: facilitetsord på dansk, samlet udeplads-ord',
      JSON.stringify(cb.amenities)
      === JSON.stringify(['elevator', 'kæledyr tilladt', 'altan eller terrasse', 'opvaskemaskine']),
      JSON.stringify(cb.amenities))

    const forbeholdstekster = [
      'OBS: Billederne i denne annonce er ikke nødvendigvis fra den pågældende bolig, men skal give et indtryk af stilen i boligen.',
      'OBS! billederne er ikke fra det præcise lejemål.',
      'Billederne er nødvendigvis ikke fra denne lejlighed, men en tilsvarende.',
    ]
    tjek('cej forbehold: alle tre målte varianter fanges',
      forbeholdstekster.every((t) => cejLaes(cejItem({ description: `<p>${t}</p>` }))!.imagesMayDiffer))
    tjek('cej forbehold: AI-sætningen alene er IKKE forbeholdet',
      !cejLaes(cejItem({ description: '<p>Billederne i annoncen er AI-redigerede.</p>' }))!.imagesMayDiffer)
    tjek('cej forbehold: almindelig beskrivelse udløser intet', cb.imagesMayDiffer === false)

    const indeholderPerson = (x: unknown) => {
      const tekst = JSON.stringify(x) ?? ''
      return PERSON.some((v) => tekst.includes(v))
    }
    tjek('cej persondata: præmis — fixturen BÆRER faktisk persondataene',
      indeholderPerson(cejItem()))
    tjek('cej persondata: RawListing er rent', !indeholderPerson(cb))
    const cbNorm = await normaliser({ ...cb, externalKey: 'cej-persontest' },
      { ...VASK, unitAddressUuid: crypto.randomUUID() })
    tjek('cej persondata: normaliseret bolig er ren', !indeholderPerson(cbNorm))
    // Konsollen overvåges under skrivningen — debugoutput tæller med.
    const skrevet: string[] = []
    const rigtigLog = console.log, rigtigWarn = console.warn, rigtigFejl = console.error
    console.log = (...a: unknown[]) => { skrevet.push(a.map(String).join(' ')) }
    console.warn = (...a: unknown[]) => { skrevet.push(a.map(String).join(' ')) }
    console.error = (...a: unknown[]) => { skrevet.push(a.map(String).join(' ')) }
    let cejRaekkeId = ''
    try {
      const { id } = await skrivBolig(snapKilde!.id, 'feed', cbNorm)
      cejRaekkeId = id
    } finally {
      console.log = rigtigLog; console.warn = rigtigWarn; console.error = rigtigFejl
    }
    ekstra.boliger.push(cejRaekkeId)
    const [cejRaekke] = await db.select().from(listings).where(eq(listings.id, cejRaekkeId))
    const cejBilleder = await db.select().from(listingImages)
      .where(eq(listingImages.listingId, cejRaekkeId))
    tjek('cej persondata: databaserækken er ren', !indeholderPerson(cejRaekke))
    tjek('cej persondata: intet persondata i konsollen under skrivningen',
      !indeholderPerson(skrevet))
    tjek('cej billeder: listen overlever adapter → normaliser → ingest',
      cejBilleder.length === 1 && cejBilleder[0]!.externalUrl === `https://${CEJ_VAERT}/x/1.jpg`,
      JSON.stringify(cejBilleder.map((x) => x.externalUrl)))
    tjek('cej billeder: værten er allowlistet — proxyen serverer',
      billedUrl(`https://${CEJ_VAERT}/x/1.jpg`) !== null)
    tjek('cej billeder: fremmed vært afvises af proxyen',
      billedUrl('https://fremmed-vaert.example/x/2.jpg') === null)
    tjek('cej økonomi: depositum og forudbetalt står i rækken',
      cejRaekke!.deposit === 4950000 && cejRaekke!.prepaidRent === 1650000,
      JSON.stringify([cejRaekke!.deposit, cejRaekke!.prepaidRent]))

    // Parseren: chunken i realistisk script-indpakning, og ærligt null
    // når den mangler — et gæt her ville blive til en tom import.
    const remixHtml = '<script>window.__remixContext={};'
      + "__remixContext.r('routes/search/layout','searchResponse',"
      + JSON.stringify({ size: 1, isFiltered: false, pages: [''], items: [cejItem()] })
      + ');</script>'
    const cejSvar = cejFind(remixHtml)
    tjek('cej parser: searchResponse findes og parses i script-indpakning',
      Array.isArray(cejSvar?.['items']) && (cejSvar!['items'] as unknown[]).length === 1)
    tjek('cej parser: HTML uden chunken giver null — ingen gæt',
      cejFind('<html><body>intet her</body></html>') === null)

    // ── Heimstaden: liste + detalje, naboimmunitet ───────────────
    // Detaljesiden bærer kort for ANDRE boliger med egne priser og
    // billeder — home.dk-fejlens mønster. Prøven beviser, at parseren
    // er bundet: økonomi kun fra Økonomi-udsnittet, billeder kun fra
    // galleriets slide-image, plantegning og naboer holdes ude.
    console.log('\n══ heimstaden: liste + detalje — naboer må ikke smitte ══')
    const hsRental = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      LejemaalNr: '9-000-01', slug: 'proevevej-1-2300-koebenhavn-s',
      Adresse1: 'Prøvevej 1', PostNr: '2300', ByNavn: 'København S',
      Areal: 107, Rum: 4, Leje: 12100, Status: 'Klar til udlejning',
      LedigPrDato: '01-11-2026', availableDate: '2026-11-01T00:00:00.000Z',
      UnikType: 'Bolig med aftalt leje',
      coordinates: { latitude: 55.7, longitude: 9.4 },
      facilities: { petsAllowed: true, studyHousing: false, seniorFriendly: false },
      image: { id: 1, urls: { full: 'https://boligspot.b-cdn.net/140903.jpg?width=1200' } },
      ...over,
    })
    const hb = hsListe(hsRental())!
    tjek('heimstaden liste: adresse, leje i øre, m2, koordinater',
      hb.address === 'Prøvevej 1, 2300 København S' && hb.rentMonthly === 1210000
      && hb.sizeM2 === 107 && hb.lat === 55.7,
      JSON.stringify([hb.address, hb.rentMonthly]))
    tjek('heimstaden liste: DD-MM-YYYY → kalenderdag som fakta',
      hb.availability?.rawStatus === 'Klar til udlejning'
      && hb.availability?.sourceAvailabilityDate === isoDato('2026-11-01')
      && !('takeoverText' in hb.availability!),
      JSON.stringify(hb.availability))
    const hbNu = hsListe(hsRental({ LedigPrDato: 'Ledig nu', availableDate: '0' }))!
    tjek('heimstaden liste: «Ledig nu» → takeoverText, INGEN dato opstår',
      hbNu.availability?.takeoverText === 'Ledig nu'
      && !('sourceAvailabilityDate' in hbNu.availability!),
      JSON.stringify(hbNu.availability))
    tjek('heimstaden liste: misdannet dato udelades — hverken dato eller tekst',
      (() => { const a = hsListe(hsRental({ LedigPrDato: '32-13-2026' }))!.availability!
        return !('sourceAvailabilityDate' in a) && !('takeoverText' in a) })())
    tjek('heimstaden liste: Studiebolig → studiebolig, ellers ingen type',
      hsListe(hsRental({ UnikType: 'Studiebolig' }))!.propertyType === 'studiebolig'
      && hb.propertyType === undefined)
    tjek('heimstaden liste: kæledyr fra enheds-boolean, ejendomsliste røres ikke',
      JSON.stringify(hb.amenities) === JSON.stringify(['kæledyr tilladt']))

    const hsSide = `<div class="data"><label>Overtagelse</label><span>Ledig fra 01-11-2026</span></div>
      <h3>Økonomi</h3>
      <div style="display: flex;"><label style="flex-grow: 1;">Husleje (pr. md.)</label><span>12.100,00 kr.</span></div>
      <div style="display: flex;"><label style="flex-grow: 1;">A/C vand (pr. md.)</label><span>260,00 kr.</span></div>
      <div style="display: flex;"><label style="flex-grow: 1;">A/C varme (pr. md.)</label><span>800,00 kr.</span></div>
      <div style="display: flex;"><label style="flex-grow: 1;">A/C fællesantenne (pr. md.)</label><span>50,00 kr.</span></div>
      <div id="moveinToggle"><label><span>Indflytningspris</span></label><span>61.560,00 kr.</span></div>
      <div id="moveinDetails">
        <div><label>- Husleje (første måned)</label><span>12.100,00 kr.</span></div>
        <div><label>- Aconto (første måned)</label><span>1.110,00 kr.</span></div>
        <div><label>- Forudbetalt leje (1 md.)</label><span>12.100,00 kr.</span></div>
        <div><label>- Depositum (3 mdr.)</label><span>36.300,00 kr.</span></div>
      </div>
      <div class="row"><div class="col-md-12"><div class="facilities">
        <div><span><label>Byggeår:</label> 2005</span></div>
      </div></div></div>
      <div class="swiper-wrapper">
        <div class="swiper-slide slide-image"> <img src="https://boligspot.b-cdn.net/1001.jpg?quality=80"></div>
        <div class="swiper-slide slide-image"> <img src="https://boligspot.b-cdn.net/1002.jpg?quality=80"></div>
        <div class="swiper-slide slide-plan contain"> <img src="https://boligspot.b-cdn.net/1003.jpg?quality=80"></div>
      </div>
      <a href="/lejebolig/nabovej-9/" title="Bolig på Nabovej 9, 4200 Slagelse">
        <img loading="lazy" src="https://boligspot.b-cdn.net/2001.jpg?width=500&aspect_ratio=3:2">
        <div class="info"><span class="rental-type">Rækkehus</span><h3>Nabovej 9</h3>
        <div class="details"><div><strong>13.400 kr./md.</strong></div>
        <div><label>- Depositum (3 mdr.)</label><span>99.999,00 kr.</span></div></div></div>
      </a>`
    const hd = hsDetalje(hsSide)
    tjek('heimstaden detalje: A/C-poster på hver sin akse, ukendt → other',
      hd.utilitiesWater === 26000 && hd.utilitiesHeat === 80000
      && hd.utilitiesOther === 5000 && hd.utilitiesElectricity === undefined,
      JSON.stringify(hd))
    tjek('heimstaden detalje: depositum, forudbetalt og kildens indflytningspris',
      hd.deposit === 3630000 && hd.prepaidRent === 1210000 && hd.moveInCost === 6156000,
      JSON.stringify([hd.deposit, hd.prepaidRent, hd.moveInCost]))
    tjek('heimstaden detalje: galleriet — kun slide-image, plantegning ude',
      JSON.stringify(hd.imageUrls) === JSON.stringify([
        'https://boligspot.b-cdn.net/1001.jpg?quality=80',
        'https://boligspot.b-cdn.net/1002.jpg?quality=80',
      ]), JSON.stringify(hd.imageUrls))
    tjek('heimstaden NABOIMMUNITET: naboens billede og depositum smitter ikke',
      !hd.imageUrls.some((u) => u.includes('2001'))
      && hd.deposit !== 9999900)
    tjek('heimstaden billeder: værten er allowlistet — proxyen serverer',
      billedUrl('https://boligspot.b-cdn.net/1001.jpg?quality=80') !== null)

    // ── Detaljebudgettet: env-overstyring til kontrollerede prøver ──
    // Budgettet bruges som splice(budget). Et negativt tal ville dér
    // betyde «fra enden» og hente ALT PÅ NÆR ét — altså det stik modsatte
    // af et loft, mod en vært der i forvejen drøvler os. Derfor afvises
    // alt, der ikke er et helt ikke-negativt tal.
    console.log('\n══ heimstaden: detaljebudget fra env ══')
    tjek('budget: ingen env → standarden 25',
      laesDetaljeBudget(undefined).budget === STANDARD_DETALJEBUDGET
      && laesDetaljeBudget('').budget === STANDARD_DETALJEBUDGET
      && laesDetaljeBudget('   ').budget === STANDARD_DETALJEBUDGET
      && STANDARD_DETALJEBUDGET === 25)
    tjek('budget: env=3 → 3',
      laesDetaljeBudget('3').budget === 3 && laesDetaljeBudget(' 3 ').budget === 3)
    tjek('budget: env=0 → 0, og 0 betyder INGEN hentninger — ikke ubegrænset',
      laesDetaljeBudget('0').budget === 0 && laesDetaljeBudget('0').afvist === undefined)
    for (const [raa, hvorfor] of [
      ['-1', 'negativ'], ['-25', 'negativ'], ['2.5', 'decimal'],
      ['1e9', 'eksponent'], ['Infinity', 'uendelig'], ['tre', 'tekst'],
      ['3 boliger', 'tekst efter tal'], ['0x10', 'hex'],
    ] as const) {
      const r = laesDetaljeBudget(raa)
      tjek(`budget: «${raa}» (${hvorfor}) afvises → standarden 25`,
        r.budget === STANDARD_DETALJEBUDGET && r.afvist !== undefined,
        `${r.budget} · ${r.afvist ?? 'INGEN begrundelse'}`)
    }
    tjek('budget: absurd stort tal afvises',
      laesDetaljeBudget('99999999999999999999').budget === STANDARD_DETALJEBUDGET)

    // Adapteren læser env ved HVER kørsel — og siger højt, når den ignorerer.
    const gemtBudgetEnv = process.env.HEIMSTADEN_DETALJEBUDGET
    const hsAd = heimstadenAdapter()
    try {
      delete process.env.HEIMSTADEN_DETALJEBUDGET
      tjek('budget: adapteren uden env giver 25', hsAd.detaljeBudgetPrKoersel === 25)
      process.env.HEIMSTADEN_DETALJEBUDGET = '3'
      tjek('budget: adapteren med env=3 giver 3', hsAd.detaljeBudgetPrKoersel === 3)
      process.env.HEIMSTADEN_DETALJEBUDGET = '-1'
      _nulstilBudgetAdvarsel()
      const advarsler: string[] = []
      const rigtigWarn = console.warn
      console.warn = (...a: unknown[]) => { advarsler.push(a.map(String).join(' ')) }
      let negativBudget: number | undefined
      try { negativBudget = hsAd.detaljeBudgetPrKoersel } finally { console.warn = rigtigWarn }
      tjek('budget: adapteren med env=-1 falder tilbage til 25',
        negativBudget === 25, String(negativBudget))
      tjek('budget: og den siger tydeligt, at værdien blev IGNORERET',
        advarsler.some((a) => a.includes('IGNORERET') && a.includes('-1')),
        JSON.stringify(advarsler))

      // Andre kilder må ikke kunne rammes af Heimstadens variabel.
      tjek('budget: env rører IKKE andre kilder',
        cejAdapter().detaljeBudgetPrKoersel === undefined
        && birchAdapter().detaljeBudgetPrKoersel === undefined)
    } finally {
      if (gemtBudgetEnv === undefined) delete process.env.HEIMSTADEN_DETALJEBUDGET
      else process.env.HEIMSTADEN_DETALJEBUDGET = gemtBudgetEnv
      _nulstilBudgetAdvarsel()
    }

    // Signaturen afgør, hvornår detaljesiden hentes igen. Et felt, der
    // mangler her, kan ændre sig uden at nogen opdager det — så prøven
    // navngiver både det, der SKAL udløse hentning, og det der ikke må.
    const sigBasis = hsSignatur(hb)
    tjek('heimstaden signatur: ændret status udløser genhentning',
      hsSignatur(hsListe(hsRental({ Status: 'Udlejet' }))!) !== sigBasis)
    tjek('heimstaden signatur: ændret overtagelse udløser genhentning',
      hsSignatur(hsListe(hsRental({ LedigPrDato: '01-12-2026' }))!) !== sigBasis
      && hsSignatur(hbNu) !== sigBasis)
    tjek('heimstaden signatur: ændret leje udløser genhentning',
      hsSignatur(hsListe(hsRental({ Leje: 12500 }))!) !== sigBasis)
    tjek('heimstaden signatur: uændret bolig giver samme signatur — ingen hentning',
      hsSignatur(hsListe(hsRental())!) === sigBasis)

    // Fuld pipeline med kontrakten: status, dato-flip og «Ledig nu».
    const rHsSenere = await pipelinen({ ...hb, externalKey: 'pipe-hs-sen' }, 'heimstaden')
    tjek('pipeline heimstaden: Klar til udlejning + fremtidig dato → på markedet, senere',
      rHsSenere.marked.status === 'paa_markedet' && rHsSenere.timing.status === 'senere',
      `${rHsSenere.marked.status} · ${rHsSenere.timing.status}`)
    const rHsNu = await pipelinen({ ...hbNu, externalKey: 'pipe-hs-nu' }, 'heimstaden')
    tjek('pipeline heimstaden: «Ledig nu» → timing nu, INGEN dato opstod',
      rHsNu.timing.status === 'nu'
      && !rHsNu.timing.evidens.some((e) => e.faktum === 'sourceAvailabilityDate'),
      rHsNu.timing.status)

    // ── Birch: feed + depositum fra faktatabellen ────────────────
    console.log('\n══ birch: feed og faktatabel ══')
    const birchRk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      ContentId: '44108', Link: '/omrader/aarhus/risskov/e-45-1-3/arresovej-5-st-1',
      Name: 'Arresøvej 5, st. 1', Street: 'Arresøvej', StreetNumber: '5, st., 1',
      City: 'Aarhus', Zipcode: '8000', Type: 'Lejlighed',
      Rent: '6800', AreaSize: '47', NoOfRooms: '1',
      Status: 'Ledig', StatusLabel: 'Ledig', StatusDateLabel: '01.02.2027',
      Vacancy: 'vacant', IsVacant: true,
      DomesticAnimalsAllowed: false, BalconyTerrace: true,
      PrivateParking: false, SharedParking: true,
      ResidenceImages: [
        { jpegCrop: 'https://birchejendomme.dk/media/a/1.jpg?w=625', jpegCropLarge: 'https://birchejendomme.dk/media/a/1.jpg?w=1600' },
        { jpegCrop: 'https://fremmed.example/2.jpg', jpegCropLarge: 'https://fremmed.example/2.jpg' },
      ],
      ...over,
    })
    const bi = birchFeed(birchRk())!
    tjek('birch feed: adresse, leje i øre (strengtal), m2, dato',
      bi.address === 'Arresøvej 5, st. 1, 8000 Aarhus' && bi.rentMonthly === 680000
      && bi.sizeM2 === 47
      && bi.availability?.sourceAvailabilityDate === isoDato('2027-02-01'),
      JSON.stringify([bi.address, bi.rentMonthly, bi.availability]))
    tjek('birch feed: status er kildens ord, misdannet dato udelades',
      bi.availability?.rawStatus === 'Ledig'
      && !('sourceAvailabilityDate' in birchFeed(birchRk({ StatusDateLabel: 'snarest' }))!.availability!))
    tjek('birch feed: kun egen vært overlever i galleriet',
      JSON.stringify(bi.imageUrls) === JSON.stringify(['https://birchejendomme.dk/media/a/1.jpg?w=1600']),
      JSON.stringify(bi.imageUrls))
    tjek('birch feed: samlet udeplads-ord og parkering, ingen kæledyrspåstand',
      JSON.stringify(bi.amenities) === JSON.stringify(['altan eller terrasse', 'parkering']))
    const birchSide = `<table class="table table-checkered"><tbody>
      <tr><th scope="col">Husleje</th> <td scope="col">6.800 DKK</td></tr>
      <tr><th scope="col">Depositum</th> <td scope="col">20.400 DKK</td></tr>
      <tr><th scope="col">A/C vand &amp; varme</th> <td scope="col">Afregnes med forsyningsselskab</td></tr>
      </tbody></table>`
    const bid2 = birchDetalje(birchSide)
    tjek('birch detalje: depositum-beløbet høstes, A/C-tekst giver INTET tal',
      bid2.deposit === 2040000 && Object.keys(bid2).length === 1,
      JSON.stringify(bid2))
    tjek('birch detalje: side uden tabel giver tomt — ingen gæt',
      Object.keys(birchDetalje('<html>intet</html>')).length === 0)
    tjek('birch billeder: værten er allowlistet — proxyen serverer',
      billedUrl('https://birchejendomme.dk/media/a/1.jpg?w=1600') !== null)
    const rBirch = await pipelinen({ ...bi, externalKey: 'pipe-birch' }, 'birch')
    tjek('pipeline birch: Ledig + fremtidig dato → på markedet, senere',
      rBirch.marked.status === 'paa_markedet' && rBirch.timing.status === 'senere',
      `${rBirch.marked.status} · ${rBirch.timing.status}`)

    // ── Detaljevagten og værtsspærren ────────────────────────────
    // Discovery skal kunne køre hyppigt uden at detaljesiderne hentes
    // hver gang — det var mønsteret, der fik Heimstadens CDN til at
    // spærre IP'en. Prøverne her driver koerKilde mod en kunstig
    // vagt-kilde og beviser hver regel enkeltvis.
    if (!MOD_PRODUKTION) {
      console.log('\n══ værtsspærren: Retry-After, GREATEST og TTL ══')
      // PGlite svarer {rows: [...]}, postgres.js et array. Samme mønster
      // som i backup-prøven ovenfor.
      const raaRaekker = <T>(r: unknown): T[] =>
        (r as { rows?: T[] }).rows ?? (r as T[])
      const sekTil = async (runner: string, host: string): Promise<number | null> => {
        const r = raaRaekker<{ sek: number }>(await db.execute(dsql`select
          extract(epoch from (blocked_until - now()))::int as sek from host_blocks
          where runner = ${runner} and host = ${host}`))
        return r[0]?.sek ?? null
      }
      const HOST_A = 'spaerre-a.invalid'
      const HOST_B = 'spaerre-b.invalid'
      const oprindeligRunner = _aktivRunner()
      const ryd = async () => {
        _nulstilCache()
        await db.delete(hostBlocks)
      }

      // ── Retry-After: begge standardformer, og aldrig en forkortelse ──
      tjek('Retry-After: delta-sekunder læses', laesRetryAfter('3600') === 3600)
      const nuMs = Date.parse('2026-09-06T12:00:00Z')
      tjek('Retry-After: HTTP-dato læses som sekunder frem',
        laesRetryAfter('Sun, 06 Sep 2026 13:00:00 GMT', nuMs) === 3600,
        String(laesRetryAfter('Sun, 06 Sep 2026 13:00:00 GMT', nuMs)))
      tjek('Retry-After: fortidig dato giver null — må ikke forkorte noget',
        laesRetryAfter('Sun, 06 Sep 2026 11:00:00 GMT', nuMs) === null)
      tjek('Retry-After: vrøvl, tom og 0 giver null',
        laesRetryAfter('snarest') === null && laesRetryAfter('') === null
        && laesRetryAfter(null) === null && laesRetryAfter('0') === null)

      // ── GREATEST: blokken forlænges opad, aldrig nedad ──
      await ryd()
      await spaer(HOST_A, 7200, 'prøve: lang blok')
      const efterLang = await db.select().from(hostBlocks)
        .where(and(eq(hostBlocks.runner, oprindeligRunner), eq(hostBlocks.host, HOST_A)))
      tjek('spær: rækken skrives på (runner, host) med blocked_until i fremtiden',
        efterLang.length === 1 && efterLang[0]!.blockedUntil > new Date(),
        JSON.stringify(efterLang.map((r) => [r.runner, r.host])))
      const langtTal = { sek: (await sekTil(oprindeligRunner, HOST_A))! }
      tjek('spær: varigheden regnes af DATABASENS ur — ca. 2 timer',
        langtTal.sek > 7100 && langtTal.sek < 7300, String(langtTal.sek))
      await spaer(HOST_A, 60, 'prøve: kort blok bagefter')
      const efterKort = { sek: (await sekTil(oprindeligRunner, HOST_A))! }
      tjek('GREATEST: en senere KORTERE blok forkorter ikke den lange',
        efterKort.sek > 7100, String(efterKort.sek))
      await spaer(HOST_A, 10800, 'prøve: længere blok')
      const efterLaengere = { sek: (await sekTil(oprindeligRunner, HOST_A))! }
      tjek('GREATEST: en LÆNGERE blok forlænger — begge veje målt',
        efterLaengere.sek > 10700, String(efterLaengere.sek))

      // ── Udløbet blok må ikke blokere ──
      await ryd()
      await db.insert(hostBlocks).values({
        runner: oprindeligRunner, host: HOST_A,
        blockedUntil: dsql`now() - interval '1 minute'`, reason: 'prøve: udløbet',
      })
      tjek('udløbet blok blokerer ikke', await spaerretTil(HOST_A) === null)

      // ── politeFetch: kast på selve udløsningskaldet ──
      await ryd()
      const rigtigFetch = globalThis.fetch
      const spaerreKald: string[] = []
      globalThis.fetch = (async (url: unknown) => {
        spaerreKald.push(String(url))
        return new Response('optaget', {
          status: 503, headers: { 'retry-after': '3600' },
        })
      }) as typeof fetch
      try {
        let kastetVedUdloesning: unknown = null
        try { await politeFetch(`https://${HOST_A}/x`) } catch (e) { kastetVedUdloesning = e }
        tjek('politeFetch: 503 kaster på UDLØSNINGSKALDET efter ét høfligt genforsøg',
          kastetVedUdloesning instanceof VaertBlokeretFejl && spaerreKald.length === 2,
          `${(kastetVedUdloesning as Error)?.name} · ${spaerreKald.length} kald`)
        const medRetry = { sek: (await sekTil(oprindeligRunner, HOST_A))! }
        tjek('politeFetch: kildens Retry-After (1 t) slår 30-min-standarden',
          medRetry.sek > 3400 && medRetry.sek < 3700, String(medRetry.sek))
        const foerB = spaerreKald.length
        await politeFetch(`https://${HOST_A}/y`).catch(() => {})
        tjek('politeFetch: næste kald mod samme vært rører ikke netværket',
          spaerreKald.length === foerB)
        await politeFetch(`https://${HOST_B}/z`).catch(() => {})
        tjek('politeFetch: spærren rammer kun den ene vært',
          spaerreKald.some((u) => u.includes(HOST_B)))
      } finally {
        globalThis.fetch = rigtigFetch
      }

      // ── Runner-isolation: Mac og Railway har hver sin egress ──
      await ryd()
      _saetRunner('railway')
      await spaer(HOST_A, 1800, 'prøve: railway blev throttlet')
      tjek('runner-isolation: railway ser sin egen blok',
        (await spaerretTil(HOST_A)) !== null)
      _saetRunner('lokal-mac')
      _nulstilCache()
      tjek('runner-isolation: lokal-mac er IKKE blokeret af railways blok',
        (await spaerretTil(HOST_A)) === null)
      _saetRunner('railway')
      _nulstilCache()
      tjek('runner-isolation: railway er stadig blokeret — præmissen holder',
        (await spaerretTil(HOST_A)) !== null)
      _saetRunner(oprindeligRunner)

      // ── Mid-run propagation mellem to PROCESSER ──────────────────
      // Proces A og B må ikke dele hukommelse. A efterlignes derfor som
      // REN DB-TILSTAND — en række skrevet udefra, præcis som en anden
      // Railway-container ville efterlade den. Så er databasen beviseligt
      // den eneste kanal mellem de to, og prøven kan ikke snyde ved at
      // lade dem dele modulets cache.
      await ryd()
      // B starter: læser DB (ingen blok) og cacher det negative svar.
      const bFoer = await spaerretTil(HOST_A)
      tjek('propagation: B har cachet «ikke blokeret»',
        bFoer === null && _cachetSvar(HOST_A) !== undefined
        && _cachetSvar(HOST_A)!.til === null)
      // A (en anden proces) rammer 503 og persisterer sin blok.
      await db.insert(hostBlocks).values({
        runner: oprindeligRunner, host: HOST_A,
        blockedUntil: dsql`now() + interval '30 minutes'`,
        reason: 'prøve: proces A fik 503',
      })
      // B har stadig sin FRISKE negative cache og bruger den. Ærligt:
      // propagationen tager op til ét TTL-vindue — det er prisen for at
      // undgå en DB-forespørgsel pr. request.
      tjek('propagation: B bruger sin friske cache indtil TTL udløber',
        (await spaerretTil(HOST_A)) === null)
      // B's cache gøres stale -> B genindlæser fra DB og ser A's blok.
      _goerCacheGammel()
      const bEfter = await spaerretTil(HOST_A)
      tjek('propagation: B genindlæser fra DB og ser A’s blok',
        bEfter !== null && bEfter > new Date(), String(bEfter))
      // Og derefter: 0 HTTP-kald.
      const bKald: string[] = []
      globalThis.fetch = (async (url: unknown) => {
        bKald.push(String(url)); return new Response('ok', { status: 200 })
      }) as typeof fetch
      try {
        let bFejl: unknown = null
        try { await politeFetch(`https://${HOST_A}/efter-propagation`) } catch (e) { bFejl = e }
        tjek('propagation: B laver 0 HTTP-kald efter genindlæsningen',
          bFejl instanceof VaertBlokeretFejl && bKald.length === 0, String(bKald.length))
      } finally {
        globalThis.fetch = rigtigFetch
      }

      // ── Genstart: en frisk proces uden hukommelse ser blokken ──
      _nulstilCache()
      tjek('genstart: frisk proces uden cache ser blokken i basen',
        (await spaerretTil(HOST_A)) !== null)
      await ryd()

      console.log('\n══ detaljevagten: hent kun nyt, ændret og forfaldent ══')
      type VagtBolig = { leje: number; status: string }
      const vagtListe = new Map<string, VagtBolig>()
      const hentninger: string[] = []
      let vagtBudget = 10
      let blokerFra: number | null = null
      const vagtUrl = (n: string) => `https://proeve-vagt.invalid/${n}`
      const vagtGrundlag = (n: string, b: VagtBolig): RawListing => ({
        externalKey: n, sourceUrl: vagtUrl(n),
        address: 'Snapshotvej 1, 2300 København S', imageUrls: [],
        rentMonthly: b.leje,
        availability: { rawStatus: b.status },
      })
      const vagtAdapter: SourceAdapter = {
        id: `proeve-vagt-${Date.now()}`, sourceType: 'spider', host: 'proeve-vagt.invalid',
        get detaljeBudgetPrKoersel() { return vagtBudget },
        async discover() {
          return [...vagtListe.keys()].map((n) => ({ externalKey: n, url: vagtUrl(n) }))
        },
        listeGrundlag(url: string) {
          const n = url.split('/').pop()!
          const b = vagtListe.get(n)
          return b
            ? { grundlag: vagtGrundlag(n, b), detaljesignatur: JSON.stringify([b.status, b.leje]) }
            : null
        },
        async extract(url: string) {
          if (blokerFra != null && hentninger.length >= blokerFra) {
            throw new VaertBlokeretFejl('proeve-vagt.invalid', new Date(Date.now() + 60_000))
          }
          hentninger.push(url)
          const n = url.split('/').pop()!
          // Detaljesiden lægger depositum til — beviset for at detaljer kom med.
          return { ...vagtGrundlag(n, vagtListe.get(n)!), deposit: 999900 }
        },
      }
      const koer = () => koerKilde(vagtAdapter, 'Prøve: detaljevagt')

      vagtListe.set('v1', { leje: 100000, status: 'Ledig' })
      vagtListe.set('v2', { leje: 110000, status: 'Ledig' })
      vagtListe.set('v3', { leje: 120000, status: 'Ledig' })
      const r1 = await koer()
      const [vagtKilde] = await db.select().from(sources)
        .where(eq(sources.slug, vagtAdapter.id))
      ekstra.kilder.push(vagtKilde!.id)
      tjek('vagt 1: første kørsel henter detaljer for alle nye',
        hentninger.length === 3 && r1.nye === 3, `${hentninger.length} · ${JSON.stringify(r1)}`)
      const vagtRk = async (n: string) => (await db.select().from(listings)
        .where(and(eq(listings.sourceId, vagtKilde!.id), eq(listings.externalKey, n))))[0]!
      tjek('vagt 1: detaljefelt og bogføring på plads',
        (await vagtRk('v1')).deposit === 999900 && (await vagtRk('v1')).detailFetchedAt != null)

      const r2 = await koer()
      tjek('vagt 2: kørsel straks efter henter 0 detaljer — alt bekræftes',
        hentninger.length === 3 && r2.bekraeftede === 3 && r2.nye === 0,
        `${hentninger.length} · ${JSON.stringify(r2)}`)

      vagtListe.set('v4', { leje: 130000, status: 'Ledig' })
      const r3 = await koer()
      tjek('vagt 3: ny bolig → præcis én hentning',
        hentninger.length === 4 && r3.nye === 1 && r3.bekraeftede === 3)

      vagtListe.set('v1', { leje: 105000, status: 'Ledig' })
      const r4 = await koer()
      tjek('vagt 4: ændret listefelt → præcis én hentning',
        hentninger.length === 5 && r4.opdaterede === 1 && r4.bekraeftede === 3)

      await db.update(listings)
        .set({ detailFetchedAt: new Date(Date.now() - 25 * 3600_000) })
        .where(and(eq(listings.sourceId, vagtKilde!.id), eq(listings.externalKey, 'v2')))
      const r5 = await koer()
      tjek('vagt 5: forfalden bolig → præcis én hentning',
        hentninger.length === 6 && r5.opdaterede === 1)

      vagtBudget = 2
      for (const n of ['v5', 'v6', 'v7', 'v8', 'v9']) vagtListe.set(n, { leje: 90000, status: 'Ledig' })
      const r6 = await koer()
      tjek('vagt 6: budgettet håndhæves — 2 hentet, resten skrevet fra listen',
        hentninger.length === 8 && r6.nye === 5, `${hentninger.length} · nye=${r6.nye}`)
      const udenDetalje = await db.select({ k: listings.externalKey, d: listings.deposit })
        .from(listings)
        .where(and(eq(listings.sourceId, vagtKilde!.id), dsql`${listings.detailFetchedAt} is null`))
      tjek('vagt 6: overløbet står med detail_fetched_at NULL og uden detaljefelter',
        udenDetalje.length === 3 && udenDetalje.every((r) => r.d === null),
        JSON.stringify(udenDetalje))
      const r7 = await koer()
      tjek('vagt 7: næste kørsel samler overløbet op inden for budgettet',
        // 2 hentet via detaljebudgettet + 1 skrevet fra listen igen = 3 opdaterede.
        hentninger.length === 10 && r7.opdaterede === 3, JSON.stringify(r7))
      vagtBudget = 10
      await koer()
      tjek('vagt 7b: sidste efternøler hentet — ingen NULL tilbage',
        hentninger.length === 11 && (await db.select().from(listings)
          .where(and(eq(listings.sourceId, vagtKilde!.id), dsql`${listings.detailFetchedAt} is null`))).length === 0)

      blokerFra = hentninger.length + 1
      for (const n of ['w1', 'w2', 'w3']) vagtListe.set(n, { leje: 80000, status: 'Ledig' })
      const r9 = await koer()
      tjek('vagt 8: værtsspærre stopper resten — 1 hentet, resten fra listen, 0 fejl, 0 afmeldt',
        hentninger.length === blokerFra && r9.fejl === 0 && r9.afmeldte === 0 && r9.nye === 3,
        JSON.stringify(r9))
      tjek('vagt 8: spærren efterlod en note og INGEN tilbagetrækning',
        r9.noter.some((n) => n.includes('værtsspærre'))
        && (await db.select().from(fetchFailures)
          .where(eq(fetchFailures.sourceId, vagtKilde!.id))).length === 0)
      blokerFra = null

      vagtBudget = 0
      vagtListe.set('x1', { leje: 70000, status: 'Ledig' })
      const foerX = hentninger.length
      const r10 = await koer()
      tjek('vagt 9: budget 0 — ren discovery-kørsel skriver nyt fra listen, 0 hentninger',
        hentninger.length === foerX && r10.nye === 1 && r10.fejl === 0,
        JSON.stringify(r10))

      // Selen i ingest: selv hvis en adapter skriver et negativt loft i
      // hånden, må splice(budget) aldrig komme til at betyde «hent alt
      // undtagen ét». Uden Math.max(0, …) ville netop det ske.
      vagtBudget = -1
      for (const n of ['neg1', 'neg2', 'neg3', 'neg4']) {
        vagtListe.set(n, { leje: 40000, status: 'Ledig' })
      }
      const foerNeg = hentninger.length
      const rNeg = await koer()
      tjek('negativt budget henter INGENTING — ikke alt på nær ét',
        hentninger.length === foerNeg && rNeg.nye === 4,
        `${hentninger.length - foerNeg} hentninger · ${rNeg.nye} nye`)
      vagtBudget = 10

      const antalKoersler = async () => (await db.select({ id: crawlRuns.id })
        .from(crawlRuns).where(eq(crawlRuns.sourceId, vagtKilde!.id))).length
      const foerLaas = await antalKoersler()
      const [kunstig] = await db.insert(crawlRuns)
        .values({ sourceId: vagtKilde!.id, status: 'running', runner: 'anden-proces' })
        .returning({ id: crawlRuns.id })
      const r11 = await koer()
      tjek('vagt 10: run-låsen — kørslen springes over, når en anden er i gang',
        r11.fundet === 0 && r11.noter.some((n) => n.includes('anden kørsel er i gang')),
        JSON.stringify(r11.noter))
      tjek('vagt 10: taberen skriver INGEN crawl_runs-række (median urørt)',
        await antalKoersler() === foerLaas + 1, `${await antalKoersler()} vs ${foerLaas + 1}`)

      // Det partielle unikke indeks er selve låsen. Fejler den rå dublet
      // ikke, findes indekset ikke — og så er alt herunder teater. Prøven
      // er samtidig vagt for en glemt journalpost til migration 0019.
      let dubletFejl: unknown = null
      try {
        await db.insert(crawlRuns)
          .values({ sourceId: vagtKilde!.id, status: 'running', runner: 'tredje-proces' })
      } catch (e) { dubletFejl = e }
      tjek('vagt 10: rå dublet-INSERT afvises af det partielle unikke indeks (23505)',
        !!dubletFejl && String((dubletFejl as { code?: string }).code ?? dubletFejl).includes('23505'),
        String((dubletFejl as { code?: string })?.code ?? dubletFejl))
      await db.update(crawlRuns).set({ status: 'failed', finishedAt: new Date() })
        .where(eq(crawlRuns.id, kunstig!.id))

      // ── Parløb: to kørsler startet samtidig ─────────────────────
      // Beviser ATOMICITETEN, ikke bare at guarden læser basen: den gamle
      // select-derefter-insert bestod prøven ovenfor, men ville her enten
      // lade begge løbe eller kaste 23505 ud gennem Promise.all.
      for (let runde = 0; runde < 5; runde++) {
        const foer = await antalKoersler()
        const [a, b] = await Promise.all([koer(), koer()])
        const skips = [a, b].filter((r) => r.noter.some((n) => n.includes('anden kørsel er i gang')))
        const nyeRaekker = await antalKoersler() - foer
        tjek(`vagt 11.${runde + 1}: parløb — højst én vinder, ingen 23505 slipper ud`,
          skips.length <= 1 && nyeRaekker <= 2 && nyeRaekker >= 1
          && a.status !== 'failed' && b.status !== 'failed',
          `skips=${skips.length} rækker=${nyeRaekker} ${a.status}/${b.status}`)
      }

      // ── Leasen: grænsen pindes fra BEGGE sider ──────────────────
      // Kun «31 min → tilladt» ville også bestås af en implementation, der
      // lukkede ALLE running-rækker uanset alder — altså ingen lås.
      const setLease = async (min: number) => {
        const [r] = await db.insert(crawlRuns).values({
          sourceId: vagtKilde!.id, status: 'running', runner: 'strandet-proces',
          startedAt: new Date(Date.now() - min * 60_000),
        }).returning({ id: crawlRuns.id })
        return r!.id
      }
      const ungId = await setLease(29)
      const r12 = await koer()
      const [ungEfter] = await db.select({ s: crawlRuns.status })
        .from(crawlRuns).where(eq(crawlRuns.id, ungId))
      tjek('vagt 12: lease 29 min — stadig afvist, og rækken står stadig running',
        r12.fundet === 0 && ungEfter!.s === 'running', `${r12.fundet} · ${ungEfter!.s}`)
      await db.update(crawlRuns).set({ status: 'failed', finishedAt: new Date() })
        .where(eq(crawlRuns.id, ungId))

      const gammelId = await setLease(31)
      const r13 = await koer()
      const [gammelEfter] = await db.select({ s: crawlRuns.status, n: crawlRuns.notes })
        .from(crawlRuns).where(eq(crawlRuns.id, gammelId))
      tjek('vagt 13: lease 31 min — tilladt, og den strandede lukkes som failed',
        r13.fundet > 0 && gammelEfter!.s === 'failed'
        && (gammelEfter!.n ?? '').includes('Aldrig afsluttet'),
        `${r13.fundet} · ${gammelEfter!.s}`)

      // ── Lease-tyveri midt i en kørsel ───────────────────────────
      // En kørsel, der overskrider leasen, får sin række lukket af en
      // anden proces. Den må hverken afmelde boliger (destruktivt) eller
      // overskrive lukningen med sit eget «ok».
      let tyveriKildeId = ''
      const tyveriAdapter: SourceAdapter = {
        ...vagtAdapter, id: `proeve-tyveri-${Date.now()}`,
        async discover() {
          const ud = await vagtAdapter.discover()
          // Imens «vi» arbejder, stjæler en anden proces leasen.
          await db.update(crawlRuns)
            .set({ status: 'failed', finishedAt: new Date(), notes: 'stjålet af anden proces' })
            .where(and(eq(crawlRuns.sourceId, tyveriKildeId), eq(crawlRuns.status, 'running')))
          return ud
        },
      }
      const r14foer = await koerKilde(tyveriAdapter, 'Prøve: lease-tyveri')
      const [tyveriKilde] = await db.select().from(sources)
        .where(eq(sources.slug, tyveriAdapter.id))
      ekstra.kilder.push(tyveriKilde!.id)
      tyveriKildeId = tyveriKilde!.id
      void r14foer
      // Kør igen, nu hvor tyveriKildeId er sat — og læg en bolig ind, som
      // en fejlagtig afmelding ville kunne tage.
      vagtListe.set('t1', { leje: 60000, status: 'Ledig' })
      const r14 = await koerKilde(tyveriAdapter, 'Prøve: lease-tyveri')
      tjek('vagt 14: lease-tyveri — afmelding sprunget over',
        r14.afmeldte === 0 && r14.noter.some((n) => n.includes('leasen er tabt')),
        JSON.stringify(r14.noter))
      tjek('vagt 14: lease-tyveri — afslut overskriver ikke den lukkede række',
        r14.status === 'failed' && r14.noter.some((n) => n.includes('LEASE TABT')),
        `${r14.status}`)
      const stjaalne = await db.select({ n: crawlRuns.notes }).from(crawlRuns)
        .where(and(eq(crawlRuns.sourceId, tyveriKilde!.id), eq(crawlRuns.status, 'failed')))
      tjek('vagt 14: tyvens note står stadig i basen — sporet er ikke slettet',
        stjaalne.some((r) => (r.n ?? '').includes('stjålet af anden proces')),
        JSON.stringify(stjaalne.map((r) => r.n?.slice(0, 40))))
      for (const r of await db.select({ id: listings.id }).from(listings)
        .where(eq(listings.sourceId, tyveriKilde!.id))) ekstra.boliger.push(r.id)

      // ── Værtsspærre midt i en kørsel: ingen afmelding, ingen fejl ──
      await db.delete(hostBlocks)
      _nulstilCache()
      const spaerreKildeSlug = `proeve-hostspaerre-${Date.now()}`
      // Budgettet stod på 0 fra vagt 9; uden hentninger ville extract
      // aldrig blive kaldt, og prøven ville måle ingenting.
      vagtBudget = 10
      const spaerreAdapter: SourceAdapter = {
        ...vagtAdapter, id: spaerreKildeSlug, host: 'spaerret-vaert.invalid',
        async extract(url: string) {
          const til = await spaer('spaerret-vaert.invalid', 1800, 'prøve: 503 midt i kørslen')
          throw new VaertBlokeretFejl('spaerret-vaert.invalid', til)
        },
      }
      vagtListe.set('h1', { leje: 50000, status: 'Ledig' })
      const r15 = await koerKilde(spaerreAdapter, 'Prøve: værtsspærre')
      const [spaerreKilde] = await db.select().from(sources)
        .where(eq(sources.slug, spaerreKildeSlug))
      ekstra.kilder.push(spaerreKilde!.id)
      tjek('vagt 15: værtsspærre midt i kørslen — 0 fejl, 0 afmeldt',
        r15.fejl === 0 && r15.afmeldte === 0
        && r15.noter.some((n) => n.includes('AFMELDNING SPRUNGET OVER — værten spærrede')),
        JSON.stringify(r15))
      tjek('vagt 15: udløsnings-boligen fik INGEN fetchFailure',
        (await db.select().from(fetchFailures)
          .where(eq(fetchFailures.sourceId, spaerreKilde!.id))).length === 0)
      const r16 = await koerKilde(spaerreAdapter, 'Prøve: værtsspærre')
      tjek('vagt 16: næste kørsel springes over, fordi værten er spærret i BASEN',
        r16.fundet === 0 && r16.noter.some((n) => n.includes('er spærret til')),
        JSON.stringify(r16.noter))
      const [blokRk] = await db.select().from(hostBlocks)
        .where(eq(hostBlocks.host, 'spaerret-vaert.invalid'))
      tjek('vagt 16: skippet bogføres på blok-rækken — «blokeret» ≠ «død»',
        blokRk!.skipCount >= 1 && blokRk!.lastSkippedAt != null,
        `skip=${blokRk!.skipCount}`)
      for (const r of await db.select({ id: listings.id }).from(listings)
        .where(eq(listings.sourceId, spaerreKilde!.id))) ekstra.boliger.push(r.id)
      await db.delete(hostBlocks)
      _nulstilCache()

      for (const r of await db.select({ id: listings.id }).from(listings)
        .where(eq(listings.sourceId, vagtKilde!.id))) ekstra.boliger.push(r.id)
    }

    // ── Laros: liste + detalje, takt og økonomi ──────────────────
    // Fixture er fri fantasi i Laros' egen opmærkning. Kortene 3 og 4 er
    // parkering og erhverv og SKAL falde fra; banneret på www.laros.dk er
    // ikke et boligbillede og SKAL falde fra.
    if (!MOD_PRODUKTION) {
      console.log('\n══ laros: liste, detalje, billeder og takt ══')
      const LK = (adr: string, id: string, type: string, leje: string, ledig: string, dep: string, m2 = '75', rum = '3') => `
        <li><div class="inner"><div class="address "><a class="link" href="https://www.laros.dk/ledige-detaljer/proeve-${id}/${id}"></a><span class="text">${adr}</span></div>
        <div id="myCarousel_${id}" class="carousel slide"><div class="carousel-inner">
          <div class="item image active" style="background-image:url('https://hos.laros.dk/lejere/billeder/resize.php?ejd=60001&lm=${id}&img=a&ext=jpg')"></div>
          <div class="item image " style="background-image:url('https://hos.laros.dk/lejere/billeder/resize.php?ejd=60001&lm=${id}&img=b&ext=jpg')"></div>
          <div class="item image " style="background-image:url('https://www.laros.dk/wp-content/uploads/2021/11/Banner-1.png')"></div>
        </div><a class="link" href="https://www.laros.dk/ledige-detaljer/proeve-${id}/${id}"></a></div>
        <div class="information"><ul>
          <li><label>TYPE</label><div class="value">${type}</div></li>
          <li><label>STØRRELSE</label><div class="value">${m2} m<sup>2</sup></div></li>
          <li class="hidemob"><label>VÆRELSER</label><div class="value">${rum}</div></li>
          <li><label>LEJE</label><div class="value">${leje}</div></li>
          <li><label>LEDIG</label><div class="value">${ledig}</div></li>
          <li class="hidemob"><label>DEPOSITUM</label><div class="value">${dep}</div></li>
        </ul></div></div></li>`
      const LISTE_HTML = '<html><body><ul class="list">'
        + LK('Prøvevej 12, 3. tv. , 8000 Aarhus C', '9001', 'Bolig', '9.500', '01-11-2026', '28.500 Kr.')
        + LK('Prøvevej 14 , 8381 Tilst', '9002', 'Rækkehus', '12.000', '01-01-2026', '36.000 Kr.', '110', '4')
        + LK('Prøvevej 16 , 8000 Aarhus C', '9003', 'Parkering', '600', '01-10-2026', '0 Kr.', '12', '0')
        + LK('Prøvevej 18 , 8000 Aarhus C', '9004', 'Erhverv', '25.000', '01-10-2026', '75.000 Kr.', '200', '0')
        + '</ul></body></html>'
      const DETALJE_HTML = `<html><head><title>Prøvevej 12, 3. tv  8000 Aarhus C - Laros</title></head><body>
        <div class="main-container"><div id="myCarousel_1" class="carousel slide"><div class="carousel-inner">
          <div class="item image active" style="background-image:url(https://hos.laros.dk/lejere/billeder/60001/9001/a.jpg)"><a href="https://hos.laros.dk/lejere/billeder/60001/9001/a.jpg" class="fancybox"></a></div>
          <div class="item image " style="background-image:url(https://hos.laros.dk/lejere/billeder/60001/9001/b.jpg)"><a href="https://hos.laros.dk/lejere/billeder/60001/9001/b.jpg" class="fancybox"></a></div>
          <div class="item image " style="background-image:url(https://hos.laros.dk/lejere/billeder/60001/9001/c.jpg)"><a href="https://hos.laros.dk/lejere/billeder/60001/9001/c.jpg" class="fancybox"></a></div>
        </div></div>
        <img src="https://www.laros.dk/wp-content/uploads/2021/11/Banner-1.png"><img src="https://hos.laros.dk/wp-content/uploads/2022/09/LB-partner-badge.png">
        <div class="address "><div class="text">Prøvevej 12, 3. tv 8000 Aarhus C</div>
          <div class="inquirybtn"><a href="https://www.boligportal.dk/lejligheder/aarhus/75m2-3-vaer-id-0000000" class="greenbutton">Ansøg via Boligportal</a></div></div>
        <ul>
          <li><label>TYPE</label><div class="value">Bolig</div></li>
          <li><label>STØRRELSE</label><div class="value">75 m2</div></li>
          <li><label>VÆRELSER</label><div class="value">3</div></li>
          <li><label>LEDIG PR.</label><div class="value">01-11-2026</div></li>
          <li><label>LEJE</label><div class="value">9.500 kr/pr. måned</div></li>
          <li><label>DEPOSITUM</label><div class="value">28.500 kr.</div></li>
          <li><label>FORUDBETALT</label><div class="value">9.500 kr.</div></li>
          <li><label>INDFLYTNINGSPRIS</label><div class="value">48.300 kr.</div></li>
          <li><label>VARME</label><div class="value">500 kr.</div></li>
          <li><label>VAND</label><div class="value">300 kr.</div></li>
          <li><label>DELEVENLIG</label><div class="value">Delevenlig for 3</div></li>
        </ul></div></body></html>`

      const liste = larosListe(LISTE_HTML)
      tjek('laros liste: parkering og erhverv falder fra — 2 boliger af 4 kort',
        liste.length === 2 && liste.map((b) => b.externalKey).join(',') === '9001,9002',
        liste.map((b) => `${b.externalKey}:${b.propertyType}`).join(' '))
      const l1 = liste[0]!, l2 = liste[1]!
      tjek('laros liste: adressen normaliseres til vaskeform',
        l1.address === 'Prøvevej 12, 3. tv., 8000 Aarhus C' && l1.postalCode === '8000', l1.address)
      tjek('laros liste: kortets tal i øre, m2 og værelser',
        l1.rentMonthly === 950000 && l1.deposit === 2850000 && l1.sizeM2 === 75 && l1.rooms === 3,
        JSON.stringify([l1.rentMonthly, l1.deposit, l1.sizeM2, l1.rooms]))
      tjek('laros liste: «Bolig» med etage → lejlighed; «Rækkehus» → rækkehus',
        l1.propertyType === 'lejlighed' && l2.propertyType === 'rækkehus', `${l1.propertyType} · ${l2.propertyType}`)
      tjek('laros liste: LEDIG-dato som date-only faktum + rawStatus LEDIG',
        l1.availability?.rawStatus === 'LEDIG' && l1.availability?.sourceAvailabilityDate === isoDato('2026-11-01')
        && l1.availableFrom === '2026-11-01', JSON.stringify(l1.availability))
      tjek('laros liste: kun boligbilleder fra hos.laros.dk — banneret på www.laros.dk falder fra',
        l1.imageUrls.length === 2 && l1.imageUrls.every((u) => u.startsWith('https://hos.laros.dk/lejere/billeder/')),
        JSON.stringify(l1.imageUrls))
      tjek('laros liste: sourceUrl ender med skråstreg (kilden omdirigerer dertil)',
        l1.sourceUrl === 'https://www.laros.dk/ledige-detaljer/proeve-9001/9001/')

      const d1 = larosDetalje(DETALJE_HTML, l1)
      tjek('laros detalje: aconto varme/vand, forudbetalt og kildens egen indflytningspris',
        d1.utilitiesHeat === 50000 && d1.utilitiesWater === 30000 && d1.prepaidRent === 950000 && d1.moveInCost === 4830000,
        JSON.stringify([d1.utilitiesHeat, d1.utilitiesWater, d1.prepaidRent, d1.moveInCost]))
      tjek('laros detalje: galleriet erstatter kortbillederne — kun /lejere/billeder/, ikke bannere eller badges',
        d1.imageUrls.length === 3 && d1.imageUrls.every((u) => /^https:\/\/hos\.laros\.dk\/lejere\/billeder\/60001\/9001\/[abc]\.jpg$/.test(u)),
        JSON.stringify(d1.imageUrls))
      tjek('laros detalje: BoligPortal-linket hentes ikke, delevenlig bliver et facilitetsord',
        !JSON.stringify(d1).includes('boligportal') && (d1.amenities ?? []).includes('delevenlig for 3'))
      tjek('laros detalje: grundlagets felter overlever (leje, depositum, adresse, dato)',
        d1.rentMonthly === 950000 && d1.deposit === 2850000 && d1.address === l1.address
        && d1.availability?.sourceAvailabilityDate === isoDato('2026-11-01'))

      // Availability gennem hele pipelinen — kontrakten afgør betydningen.
      const rL1 = await pipelinen({ ...d1, externalKey: 'laros-pipe-1' }, 'laros')
      tjek('pipeline laros: LEDIG + fremtidig dato → på markedet, senere',
        rL1.marked.status === 'paa_markedet' && rL1.timing.status === 'senere',
        `${rL1.marked.status} · ${rL1.timing.status}`)
      const rL2 = await pipelinen({ ...l2, externalKey: 'laros-pipe-2' }, 'laros')
      tjek('pipeline laros: LEDIG + fortidig dato → kan overtages nu',
        rL2.marked.status === 'paa_markedet' && rL2.timing.status === 'nu', `${rL2.marked.status} · ${rL2.timing.status}`)
      tjek('pipeline laros: ansøgning forbliver unknown, og der dokumenteres ingen adgangskrav',
        rL1.ansoegning.status === 'unknown' && rL1.adgang.krav.length === 0)

      // Økonomien i basen: totalen tæller husleje + de aconto-poster, kilden opgiver.
      const { id: larosId } = await skrivBolig(snapKilde!.id, 'spider',
        await normaliser({ ...d1, externalKey: 'laros-db-1' }, { ...VASK, unitAddressUuid: crypto.randomUUID() }))
      ekstra.boliger.push(larosId)
      const [larosRk] = await db.select().from(listings).where(eq(listings.id, larosId))
      tjek('laros i basen: depositum, forudbetalt og indflytningspris står i rækken',
        larosRk!.deposit === 2850000 && larosRk!.prepaidRent === 950000 && larosRk!.moveInCost === 4830000)
      tjek('laros i basen: total = husleje + varme + vand, komponenterne gemt',
        larosRk!.totalMonthly === 1030000
        && JSON.stringify(larosRk!.totalMonthlyComponents) === JSON.stringify(['rent', 'heat', 'water']),
        `${larosRk!.totalMonthly} ${JSON.stringify(larosRk!.totalMonthlyComponents)}`)
      const larosBilleder = await db.select().from(listingImages).where(eq(listingImages.listingId, larosId))
      tjek('laros billeder: tre galleribilleder overlever til listing_images',
        larosBilleder.length === 3)
      tjek('laros billeder: hos.laros.dk er allowlistet — proxyen serverer',
        TILLADTE_VAERTER.has('hos.laros.dk') && billedUrl('https://hos.laros.dk/lejere/billeder/60001/9001/a.jpg') !== null)
      tjek('laros billeder: www.laros.dk er med vilje IKKE allowlistet (bannere, ikke boliger)',
        billedUrl('https://www.laros.dk/wp-content/uploads/2021/11/Banner-1.png') === null)

      // Dedup: samme adresse fra en anden kilde → kun én repræsentant i søgningen.
      const [rivalKilde] = await db.insert(sources).values({
        slug: `proeve-laros-rival-${Date.now()}`, name: 'Prøve: rival', sourceType: 'feed',
        baseUrl: 'https://rival.invalid', enabled: false,
      }).returning()
      ekstra.kilder.push(rivalKilde!.id)
      const dubletUuid = crypto.randomUUID()
      const { id: dA } = await skrivBolig(snapKilde!.id, 'spider',
        await normaliser({ ...d1, externalKey: 'laros-dub-a' }, { ...VASK, unitAddressUuid: dubletUuid }))
      const { id: dB } = await skrivBolig(rivalKilde!.id, 'feed',
        await normaliser({ ...l1, externalKey: 'rival-dub-b', sourceUrl: 'https://rival.invalid/b', imageUrls: [] },
          { ...VASK, unitAddressUuid: dubletUuid }))
      ekstra.boliger.push(dA, dB)
      const synlige = await db.select({ id: listings.id }).from(listings)
        .where(and(udenDubletter(hvor({})), dsql`${listings.id} in (${dA}, ${dB})`))
      tjek('laros dedup: to kilder, samme enhed → én synlig repræsentant',
        synlige.length === 1, `${synlige.length} synlige af 2`)
      tjek('laros dedup: repræsentanten er den med billeder og total (Laros)',
        synlige[0]?.id === dA)

      // Detaljevagten: signaturen følger dato, leje og depositum — ikke m2.
      const sig = larosSignatur(l1)
      tjek('laros vagt: signatur ændres ved ny LEDIG-dato',
        larosSignatur({ ...l1, availability: { ...l1.availability, sourceAvailabilityDate: isoDato('2026-12-01')! } }) !== sig)
      tjek('laros vagt: signatur ændres ved ny leje eller nyt depositum',
        larosSignatur({ ...l1, rentMonthly: 960000 }) !== sig && larosSignatur({ ...l1, deposit: 1 }) !== sig)
      tjek('laros vagt: signatur er stabil for uændret bolig, og m2 er ikke med',
        larosSignatur({ ...l1 }) === sig && larosSignatur({ ...l1, sizeM2: 76 }) === sig)
      const la = larosAdapter()
      tjek('laros vagt: adapteren erklærer listeGrundlag, budget og host',
        typeof la.listeGrundlag === 'function' && la.listeGrundlag('https://www.laros.dk/x/') === null
        && la.host === 'www.laros.dk' && la.sourceType === 'spider')

      // Takten: Laros' egne 20 sekunder står i tabellen, og pacingen virker.
      tjek('laros takt: www.laros.dk har mindst 20 sekunder mellem kald',
        taktFor('www.laros.dk') >= 20000, String(taktFor('www.laros.dk')))
      tjek('laros takt: andre værter er upåvirkede (standard 1 s)',
        taktFor('proeve-anden-vaert.invalid') === 1000, String(taktFor('proeve-anden-vaert.invalid')))
      _saetTakt('proeve-takt.invalid', 400)
      const rigtigFetchT = globalThis.fetch
      globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch
      try {
        const t0 = Date.now()
        await politeFetch('https://proeve-takt.invalid/a')
        await politeFetch('https://proeve-takt.invalid/b')
        const brugt = Date.now() - t0
        tjek('laros takt: to kald mod samme vært holder takten (≥ 400 ms målt)', brugt >= 400, `${brugt} ms`)
      } finally { globalThis.fetch = rigtigFetchT }

      // Budgettet: eget env-navn, egen konservativ standard, rører ikke Heimstaden.
      const gemtL = process.env.LAROS_DETALJEBUDGET, gemtH = process.env.HEIMSTADEN_DETALJEBUDGET
      try {
        delete process.env.LAROS_DETALJEBUDGET; delete process.env.HEIMSTADEN_DETALJEBUDGET
        tjek('laros budget: standard 5 uden env', la.detaljeBudgetPrKoersel === 5 && STANDARD_DETALJEBUDGET_LAROS === 5)
        process.env.LAROS_DETALJEBUDGET = '3'
        tjek('laros budget: env=3 → 3, og Heimstaden er upåvirket (25)',
          la.detaljeBudgetPrKoersel === 3 && heimstadenAdapter().detaljeBudgetPrKoersel === 25)
        process.env.LAROS_DETALJEBUDGET = '-1'; larosNulstilAdvarsel()
        const adv: string[] = []; const w = console.warn
        console.warn = (...a: unknown[]) => { adv.push(a.map(String).join(' ')) }
        let neg: number | undefined
        try { neg = la.detaljeBudgetPrKoersel } finally { console.warn = w }
        tjek('laros budget: -1 afvises → 5, og det siges højt',
          neg === 5 && adv.some((a) => a.includes('LAROS_DETALJEBUDGET IGNORERET')), JSON.stringify(adv))
      } finally {
        if (gemtL === undefined) delete process.env.LAROS_DETALJEBUDGET; else process.env.LAROS_DETALJEBUDGET = gemtL
        if (gemtH === undefined) delete process.env.HEIMSTADEN_DETALJEBUDGET; else process.env.HEIMSTADEN_DETALJEBUDGET = gemtH
        larosNulstilAdvarsel()
      }
      tjek('laros cron: med i automatiske kørsler efter godkendt måling 7/9',
        findKilde('laros') !== undefined && rigtigeKilder().some((k) => k.adapter.id === 'laros'))
    }

    // ── Alabu Bolig: liste + detalje, nøgle, billeder og økonomi ──
    // Fixture er fri fantasi i Alabus egen payload-form. Bolig 2 deler
    // TenancyId med bolig 1 men ligger i en anden afdeling og SKAL blive
    // sin egen bolig; bolig 3 mangler postnummer og SKAL falde fra.
    // Afdelingsbilleder ligger på SAMME vært som boligbilleder og SKAL
    // falde fra på mappen — allowlisten kan ikke redde det.
    if (!MOD_PRODUKTION) {
      console.log('\n══ alabu: liste, detalje, nøgle, billeder og økonomi ══')
      const aBillede = (mappe: string, id: number, orden: number) => ({
        Id: id, Name: `Billede af prøvebolig ${id}`, Description: null,
        Url: `/Media/TempDepartmentImages/${mappe}/${id}.jpg`, SortOrder: orden, Photographer: null,
      })
      const aBolig = (dept: number, ten: number, sted: string, postnr: string, by: string,
        leje: number, indskud: number, dato: string, billeder: unknown[]) => ({
        CompanyId: 99, DepartmentId: dept, TenancyId: ten,
        Address: { Street: 'Prøvegade', Location: sted, ZipCode: postnr, City: by, LocalTown: null,
          Country: null, CoAddress: null, Coordinates: { Lat: 57.04, Lng: 9.93 } },
        Rooms: 3, Sqm: 84.6, RentNet: leje, Deposit: indskud,
        DepartmentUrl: '/selskabs-og-afdelingshjemmesider/alabu-bolig/afdelinger/proeve/?StepBack=true',
        DepartmentImages: [aBillede(`99_${dept}`, 900 + dept, 0)],
        TenancyImages: billeder, VideoUrl: null, MoveInDate: dato, TenancyType: 'Familieboliger',
        Description: '<p>Ring på 96 331 331 eller skriv til ledigelejeboliger@alabubolig.dk</p>',
      })
      const LISTE_JSON = { Data: { Tenancies: [
        aBolig(7, 501, '12, 3. tv', '9000', 'Aalborg', 6250.5, 24000, '2026-12-01T00:00:00',
          [aBillede('99_7_501', 11, 1), aBillede('99_7_501', 10, 0), aBillede('99_7', 12, 2)]),
        aBolig(9, 501, '28B', '9575', 'Terndrup', 4472, 18000, '2026-01-01T00:00:00', []),
        aBolig(9, 502, '30', '', 'Terndrup', 5000, 20000, '2026-10-01T00:00:00', []),
      ] }, PreventReload: false, FeedbackList: [], RedirectUrl: null }
      const DETALJE_JSON = { Data: {
        CompanyId: 99, DepartmentId: 7, TenancyId: 501,
        Rents: [{ Name: 'Husleje', Amount: 6250.5 }, { Name: 'Aconto varme', Amount: 565 }, { Name: 'Aconto vand', Amount: 285 }],
        RentTotal: 7100.5, Premises: ['Altan', 'Fællesvaskeri'], PetAllowedText: '1 lille hund',
        FloorPlanUrls: ['https://alabubolig.dk/media/1274/3-4.jpg'], ApartmentType: 'Etagebyggeri', TenancyType: 'Familieboliger',
      } }
      const DETALJE_UKENDT = { Data: {
        ...DETALJE_JSON.Data,
        Rents: [{ Name: 'Husleje', Amount: 6250.5 }, { Name: 'Aconto varme', Amount: 565 }, { Name: 'Antennebidrag', Amount: 45 }],
        RentTotal: 6860.5, ApartmentType: 'Tæt-lav', MinWaitTimeInMonths: 6, WaitTimeTypeText: 'ca. 6 måneder',
        FloorPlanUrls: ['https://cdn.fremmed.invalid/plan.jpg'],
      } }
      // Set i produktionen 7/9: rækkehusene i Terndrup og en bolig med el-aconto.
      const DETALJE_TERNDRUP = { Data: {
        ...DETALJE_JSON.Data, CompanyId: 99, DepartmentId: 9, TenancyId: 501, ApartmentType: 'Rækkehuse - 1 plan',
        Rents: [{ Name: 'Husleje', Amount: 4472 }, { Name: 'Aconto varme', Amount: 400 }, { Name: 'Aconto vand', Amount: 200 }, { Name: 'Aconto el', Amount: 150 }],
        RentTotal: 5222, FloorPlanUrls: [],
      } }

      alabuNulstilAdvarsler()
      const aListe = alabuListe(LISTE_JSON)
      tjek('alabu liste: 2 boliger af 3 — den uden postnummer falder fra',
        aListe.length === 2, aListe.map((b) => b.externalKey).join(','))
      const a1 = aListe[0]!, a2 = aListe[1]!
      tjek('alabu nøgle: selskab-afdeling-lejemål — samme TenancyId i to afdelinger er to boliger',
        a1.externalKey === '99-7-501' && a2.externalKey === '99-9-501')
      tjek('alabu liste: boligsiden linkes som ?ten=C_D_T',
        a1.sourceUrl === 'https://alabubolig.dk/se-og-soeg-bolig/soeg-ledig-lejebolig/?ten=99_7_501')
      tjek('alabu liste: adresse af Street + Location + postnr + by',
        a1.address === 'Prøvegade 12, 3. tv, 9000 Aalborg' && a1.postalCode === '9000'
        && a2.address === 'Prøvegade 28B, 9575 Terndrup', `${a1.address} · ${a2.address}`)
      tjek('alabu liste: kildens tal i øre — netto husleje med ører, indskud som depositum',
        a1.rentMonthly === 625050 && a1.deposit === 2400000 && a2.rentMonthly === 447200,
        JSON.stringify([a1.rentMonthly, a1.deposit]))
      tjek('alabu liste: m2 rundes til heltal (84,6 → 85); værelser og koordinater følger med',
        a1.sizeM2 === 85 && a1.rooms === 3 && a1.lat === 57.04 && a1.lng === 9.93)
      tjek('alabu liste: etage/dør i Location → lejlighed; «28B» alene → ingen type',
        a1.propertyType === 'lejlighed' && a2.propertyType === undefined)
      tjek('alabu liste: MoveInDate som date-only faktum; intet statusord opfindes',
        a1.availability?.sourceAvailabilityDate === isoDato('2026-12-01') && a1.availableFrom === '2026-12-01'
        && !('rawStatus' in (a1.availability ?? {})), JSON.stringify(a1.availability))
      tjek('alabu billeder: kun boligens egen mappe, sorteret efter SortOrder — afdelingsmappen falder fra på samme vært',
        JSON.stringify(a1.imageUrls) === JSON.stringify([
          'https://alabubolig.dk/Media/TempDepartmentImages/99_7_501/10.jpg',
          'https://alabubolig.dk/Media/TempDepartmentImages/99_7_501/11.jpg']), JSON.stringify(a1.imageUrls))
      tjek('alabu billeder: bolig uden TenancyImages får INGEN billeder — afdelingsbilledet træder ikke i stedet',
        a2.imageUrls.length === 0)
      tjek('alabu persondata/støj: Description, telefon, mail, afdelings-URL og billednavne kommer ikke med',
        !/96 331 331|ledigelejeboliger|Description|afdelinger\/proeve|Billede af/.test(JSON.stringify(aListe)))

      const ad1 = alabuDetalje(DETALJE_JSON, a1)
      tjek('alabu detalje: aconto varme/vand ved navn; husleje og indskud fra listen bevares',
        ad1.utilitiesHeat === 56500 && ad1.utilitiesWater === 28500 && ad1.rentMonthly === 625050
        && ad1.deposit === 2400000 && ad1.utilitiesOther === undefined,
        JSON.stringify([ad1.utilitiesHeat, ad1.utilitiesWater, ad1.utilitiesOther]))
      tjek('alabu detalje: Boligart «Etagebyggeri» → lejlighed; faciliteter som kildens egne ord',
        ad1.propertyType === 'lejlighed' && JSON.stringify(ad1.amenities) === JSON.stringify(['altan', 'fællesvaskeri']))
      tjek('alabu detalje: plantegningen kommer sidst efter boligbillederne',
        ad1.imageUrls.length === 3 && ad1.imageUrls[2] === 'https://alabubolig.dk/media/1274/3-4.jpg')
      tjek('alabu detalje: forudbetalt, indflytningspris og husdyrtekst opfindes/gemmes ikke',
        ad1.prepaidRent === undefined && ad1.moveInCost === undefined && !JSON.stringify(ad1).includes('hund'))
      const ad2 = alabuDetalje(DETALJE_TERNDRUP, a2)
      tjek('alabu detalje: «Rækkehuse - 1 plan» → rækkehus, og «Aconto el» er el — ikke uspecificeret',
        ad2.propertyType === 'rækkehus' && ad2.utilitiesElectricity === 15000 && ad2.utilitiesOther === undefined
        && ad2.utilitiesHeat === 40000 && ad2.utilitiesWater === 20000, JSON.stringify([ad2.propertyType, ad2.utilitiesElectricity, ad2.utilitiesOther]))

      // Det, kilden kan finde på, som vi ikke har plads til: siges højt, gemmes ikke.
      const advA: string[] = []; const wA = console.warn
      console.warn = (...a: unknown[]) => { advA.push(a.map(String).join(' ')) }
      let adU: RawListing
      try { adU = alabuDetalje(DETALJE_UKENDT, a1) } finally { console.warn = wA }
      tjek('alabu detalje: ukendt post → uspecificeret aconto (beløbet er kildens), og det siges højt',
        adU.utilitiesOther === 4500 && adU.utilitiesHeat === 56500 && adU.utilitiesWater === undefined
        && advA.some((a) => a.includes('Antennebidrag')), JSON.stringify(advA))
      tjek('alabu detalje: ukendt Boligart → typen fra listen står, og det siges højt',
        adU.propertyType === 'lejlighed' && advA.some((a) => a.includes('Tæt-lav')))
      tjek('alabu detalje: «Forventet ventetid» gemmes ikke, men siges højt',
        !/ventetid|WaitTime|måneder/i.test(JSON.stringify(adU)) && advA.some((a) => a.includes('Forventet ventetid')))
      tjek('alabu detalje: plantegning på fremmed vært falder fra', adU.imageUrls.length === 2)
      const advA2: string[] = []
      console.warn = (...a: unknown[]) => { advA2.push(a.map(String).join(' ')) }
      try { alabuDetalje(DETALJE_UKENDT, a1) } finally { console.warn = wA }
      tjek('alabu detalje: advarsler siges én gang pr. nøgle, ikke ved hvert kald',
        advA.length >= 3 && advA2.length === 0, `${advA.length} første gang, ${advA2.length} anden gang`)

      // Availability gennem hele pipelinen — kontrakten afgør betydningen.
      const rA1 = await pipelinen({ ...ad1, externalKey: 'alabu-pipe-1' }, 'alabu')
      tjek('pipeline alabu: fremtidig indflytningsdato → senere; markedsstatus forbliver unknown (intet statusord)',
        rA1.timing.status === 'senere' && rA1.marked.status === 'unknown', `${rA1.marked.status} · ${rA1.timing.status}`)
      const rA2 = await pipelinen({ ...a2, externalKey: 'alabu-pipe-2' }, 'alabu')
      tjek('pipeline alabu: fortidig indflytningsdato → kan overtages nu', rA2.timing.status === 'nu', rA2.timing.status)
      tjek('pipeline alabu: ansøgning unknown (kontaktformular er ikke en tildelingsregel), ingen adgangskrav dokumenteret',
        rA1.ansoegning.status === 'unknown' && rA1.adgang.krav.length === 0)

      // Økonomien i basen: totalen tæller husleje + de aconto-poster, kilden opgiver.
      const { id: alabuId } = await skrivBolig(snapKilde!.id, 'feed',
        await normaliser({ ...ad1, externalKey: 'alabu-db-1' }, { ...VASK, unitAddressUuid: crypto.randomUUID() }))
      ekstra.boliger.push(alabuId)
      const [alabuRk] = await db.select().from(listings).where(eq(listings.id, alabuId))
      tjek('alabu i basen: total = husleje + varme + vand = 7.100,50 kr med komponenter; depositum står, forudbetalt og indflytningspris er null',
        alabuRk!.totalMonthly === 710050
        && JSON.stringify(alabuRk!.totalMonthlyComponents) === JSON.stringify(['rent', 'heat', 'water'])
        && alabuRk!.deposit === 2400000 && alabuRk!.prepaidRent === null && alabuRk!.moveInCost === null,
        `${alabuRk!.totalMonthly} ${JSON.stringify(alabuRk!.totalMonthlyComponents)}`)
      tjek('alabu i basen: koordinater fra kilden, m2 som heltal',
        alabuRk!.lat != null && Number(alabuRk!.lat) === 57.04 && alabuRk!.sizeM2 === 85, `${alabuRk!.lat} ${alabuRk!.sizeM2}`)
      const { id: alabuListeId } = await skrivBolig(snapKilde!.id, 'feed',
        await normaliser({ ...a1, externalKey: 'alabu-db-2' }, { ...VASK, unitAddressUuid: crypto.randomUUID() }))
      ekstra.boliger.push(alabuListeId)
      const [alabuListeRk] = await db.select().from(listings).where(eq(listings.id, alabuListeId))
      tjek('alabu i basen: fra listen alene (ingen aconto endnu) er totalen null — ikke lig huslejen',
        alabuListeRk!.totalMonthly === null && alabuListeRk!.rentMonthly === 625050)
      const alabuBilleder = await db.select().from(listingImages).where(eq(listingImages.listingId, alabuId))
      tjek('alabu billeder: to boligbilleder + plantegning overlever til listing_images', alabuBilleder.length === 3)
      tjek('alabu billeder: alabubolig.dk er allowlistet — proxyen serverer',
        TILLADTE_VAERTER.has('alabubolig.dk')
        && billedUrl('https://alabubolig.dk/Media/TempDepartmentImages/99_7_501/10.jpg') !== null)

      // Dedup: samme adresse fra en anden kilde → kun én repræsentant i søgningen.
      const [alabuRival] = await db.insert(sources).values({
        slug: `proeve-alabu-rival-${Date.now()}`, name: 'Prøve: rival', sourceType: 'feed',
        baseUrl: 'https://rival.invalid', enabled: false,
      }).returning()
      ekstra.kilder.push(alabuRival!.id)
      const alabuDubUuid = crypto.randomUUID()
      const { id: aDA } = await skrivBolig(snapKilde!.id, 'feed',
        await normaliser({ ...ad1, externalKey: 'alabu-dub-a' }, { ...VASK, unitAddressUuid: alabuDubUuid }))
      const { id: aDB } = await skrivBolig(alabuRival!.id, 'feed',
        await normaliser({ ...a1, externalKey: 'rival-dub-b', sourceUrl: 'https://rival.invalid/b', imageUrls: [] },
          { ...VASK, unitAddressUuid: alabuDubUuid }))
      ekstra.boliger.push(aDA, aDB)
      const aSynlige = await db.select({ id: listings.id }).from(listings)
        .where(and(udenDubletter(hvor({})), dsql`${listings.id} in (${aDA}, ${aDB})`))
      tjek('alabu dedup: to kilder, samme enhed → én synlig repræsentant, og det er den med billeder og total',
        aSynlige.length === 1 && aSynlige[0]?.id === aDA, `${aSynlige.length} synlige af 2`)

      // Detaljevagten: signaturen følger dato, leje og indskud — ikke m2 eller billeder.
      const aSig = alabuSignatur(a1)
      tjek('alabu vagt: signatur ændres ved ny indflytningsdato, leje eller indskud',
        alabuSignatur({ ...a1, availability: { sourceAvailabilityDate: isoDato('2027-01-01')! } }) !== aSig
        && alabuSignatur({ ...a1, rentMonthly: 1 }) !== aSig && alabuSignatur({ ...a1, deposit: 1 }) !== aSig)
      tjek('alabu vagt: stabil for uændret bolig; m2 og billeder er ikke med',
        alabuSignatur({ ...a1 }) === aSig && alabuSignatur({ ...a1, sizeM2: 1, imageUrls: [] }) === aSig)
      const aa = alabuAdapter()
      tjek('alabu vagt: adapteren erklærer listeGrundlag, budget, vært og feed-type',
        typeof aa.listeGrundlag === 'function' && aa.listeGrundlag('https://alabubolig.dk/x') === null
        && aa.host === 'alabubolig.dk' && aa.sourceType === 'feed')

      // Takten: ingen crawl-delay hos Alabu → standarden, og ikke hurtigere.
      tjek('alabu takt: standardtakten 1 s pr. kald (robots har ingen crawl-delay)',
        taktFor('alabubolig.dk') === 1000, String(taktFor('alabubolig.dk')))

      // discover/extract mod en attrap: ét listekald, detaljekald med de tre id'er, JSON bedt om.
      const aKald: { url: string; accept: string | undefined }[] = []
      const rigtigFetchA = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const h = (init?.headers ?? {}) as Record<string, string>
        aKald.push({ url, accept: h['Accept'] ?? h['accept'] })
        const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
        if (url.includes('GetAllAvailableTenancies')) return json(LISTE_JSON)
        if (url.includes('GetInfoForTenancy')) return json(DETALJE_JSON)
        return new Response('nej', { status: 404 })
      }) as typeof fetch
      _saetTakt('alabubolig.dk', 20)
      try {
        const fundne = await aa.discover()
        tjek('alabu discover: ét listekald, 2 boliger med nøgle og boligside',
          fundne.length === 2 && aKald.length === 1 && fundne[0]!.externalKey === '99-7-501'
          && fundne[0]!.url.endsWith('?ten=99_7_501'), JSON.stringify(fundne))
        tjek('alabu discover: listekaldet beder om JSON — værten forhandler ellers XML',
          aKald[0]!.accept === 'application/json', String(aKald[0]!.accept))
        const g = aa.listeGrundlag!(fundne[0]!.url)
        tjek('alabu vagt: listeGrundlag giver grundlaget fra cachen med signatur',
          g !== null && g.grundlag.externalKey === '99-7-501' && g.detaljesignatur === aSig)
        const hentet = await aa.extract(fundne[0]!.url)
        tjek('alabu extract: detaljekaldet går til GetInfoForTenancy med de tre id\'er og bærer aconto hjem',
          aKald[1]!.url === 'https://alabubolig.dk/umbraco/api/AvailableTenanciesPage/GetInfoForTenancy?companyId=99&departmentId=7&tenancyId=501'
          && aKald[1]!.accept === 'application/json' && hentet.utilitiesHeat === 56500, aKald[1]!.url)
        let aFejl = ''
        try { await aa.extract('https://alabubolig.dk/ukendt') } catch (e) { aFejl = (e as Error).message }
        tjek('alabu extract: en URL uden discover kaster i stedet for at gætte', aFejl.includes('ikke i cachen'), aFejl)
        // Header-reglen generelt: standard-Accept uden egen, og User-Agent kan aldrig overskrives.
        await politeFetch('https://alabubolig.dk/uden-egen-accept').catch(() => {})
        tjek('politeFetch: uden egen Accept sendes standardhovedet stadig (Simply.com-reglen)',
          aKald.at(-1)!.accept?.startsWith('text/html') === true, String(aKald.at(-1)!.accept))
        const uaKald: string[] = []
        globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
          uaKald.push(((init?.headers ?? {}) as Record<string, string>)['User-Agent'] ?? '')
          return new Response('ok', { status: 200 })
        }) as typeof fetch
        await politeFetch('https://alabubolig.dk/ua', 1, { headers: { 'User-Agent': 'Mozilla/5.0 forklædt' } })
        tjek('politeFetch: et kald kan IKKE skifte User-Agent — vores navn er ikke en indstilling',
          uaKald[0]!.startsWith('BofindaBot/') && !uaKald[0]!.includes('forklædt'), uaKald[0])
      } finally {
        globalThis.fetch = rigtigFetchA
        _saetTakt('alabubolig.dk', 1000)
      }

      // Budgettet: eget env-navn, egen standard (30 = hele udbuddet), rører ikke de andre.
      const gemtAB = process.env.ALABU_DETALJEBUDGET
      try {
        delete process.env.ALABU_DETALJEBUDGET
        tjek('alabu budget: standard 30 uden env — hele udbuddet (22) i én kørsel',
          aa.detaljeBudgetPrKoersel === 30 && STANDARD_DETALJEBUDGET_ALABU === 30)
        process.env.ALABU_DETALJEBUDGET = '4'
        tjek('alabu budget: env=4 → 4, og Laros er upåvirket',
          aa.detaljeBudgetPrKoersel === 4 && larosAdapter().detaljeBudgetPrKoersel === STANDARD_DETALJEBUDGET_LAROS)
        process.env.ALABU_DETALJEBUDGET = 'abc'; alabuNulstilBudgetAdvarsel()
        const advB: string[] = []; const wB = console.warn
        console.warn = (...a: unknown[]) => { advB.push(a.map(String).join(' ')) }
        let ugyldigt: number | undefined
        try { ugyldigt = aa.detaljeBudgetPrKoersel } finally { console.warn = wB }
        tjek('alabu budget: «abc» afvises → 30, og det siges højt',
          ugyldigt === 30 && advB.some((a) => a.includes('ALABU_DETALJEBUDGET IGNORERET')), JSON.stringify(advB))
      } finally {
        if (gemtAB === undefined) delete process.env.ALABU_DETALJEBUDGET; else process.env.ALABU_DETALJEBUDGET = gemtAB
        alabuNulstilBudgetAdvarsel()
      }
      tjek('alabu cron: med i automatiske kørsler efter godkendt måling 7/9',
        findKilde('alabu') !== undefined && rigtigeKilder().some((k) => k.adapter.id === 'alabu'))
    }

    // ── Alarmen følger availability-domænet ──────────────────────
    // Samme postfilter-regel som søgningen. Kildeslugs med RIGTIGE
    // kontrakter (home/findbolig/propstep) kan kun oprettes frit i
    // PGlite — mod produktionen ville de kollidere med de ægte kilder.
    //
    // Sikkerheden hviler IKKE alene paa guarden: glemmes den, rammer
    // insert'en paa slug 'home' det UNIKKE indeks paa sources.slug i
    // produktionen og kaster — hoejt og uden at skrive noget. Baeltet er
    // indekset; guarden er selen.
    if (!MOD_PRODUKTION) {
      console.log('\n══ alarmen følger availability-domænet ══')
      const alarmKilde = async (slug: string) => {
        const [k] = await db.insert(sources).values({
          slug, name: `Prøve: ${slug}`, sourceType: 'feed',
          baseUrl: 'https://proeve.invalid', enabled: false,
        }).returning()
        ekstra.kilder.push(k!.id)
        // Indkørt for to døgn siden, så indkøringsvagten ikke afgør noget.
        await db.insert(crawlRuns).values({
          sourceId: k!.id, status: 'ok',
          startedAt: new Date(Date.now() - 48 * 3600_000),
        })
        return k!.id
      }
      const hjemK = await alarmKilde('home')
      const findK = await alarmKilde('findbolig')
      const propK = await alarmKilde('propstep')
      const alarmBolig = async (kildeId: string, noegle: string, facts: Record<string, unknown>) => {
        const { id: bid } = await skrivBolig(kildeId, 'feed', await normaliser({
          externalKey: noegle, sourceUrl: `https://proeve.invalid/${noegle}`,
          address: 'Snapshotvej 1, 2300 København S', rooms: 7, imageUrls: [],
          availability: facts,
        }, { ...VASK, unitAddressUuid: crypto.randomUUID() }))
        ekstra.boliger.push(bid)
        return bid
      }
      const bNu = await alarmBolig(hjemK, 'al-nu', { rentalAvailableNow: true, sourceAvailabilityDate: '2026-09-01' })
      const bSenere = await alarmBolig(hjemK, 'al-sen', { rentalAvailableNow: false, sourceAvailabilityDate: '2026-12-01' })
      const bUkendt = await alarmBolig(hjemK, 'al-uk', {})
      const bVente = await alarmBolig(findK, 'al-vent', { rawApplicationType: 'WaitingList' })
      const bNormal = await alarmBolig(findK, 'al-norm', { rawApplicationType: 'Regular' })
      const bReserv = await alarmBolig(propK, 'al-res', { rawStatus: 'Reserved' })
      const bLedigP = await alarmBolig(propK, 'al-avail', { rawStatus: 'Available' })

      const soegMed = async (navn: string, kriterier: Record<string, unknown>) => {
        const [gs] = await db.insert(savedSearches).values({
          userId: u!.id, name: navn, criteria: kriterier,
          createdAt: new Date(Date.now() - 3600_000),
          confirmedAt: new Date(Date.now() - 3600_000), notifyEmail: true,
        }).returning()
        await matchAlarmer([gs!.id])
        const traf = await db.select({ l: alertMatches.listingId })
          .from(alertMatches).where(eq(alertMatches.savedSearchId, gs!.id))
        await db.delete(alertMatches).where(eq(alertMatches.savedSearchId, gs!.id))
        await db.delete(savedSearches).where(eq(savedSearches.id, gs!.id))
        return new Set(traf.map((t) => t.l))
      }
      const BASIS = { postnr: '2300', vaerelserMin: 7 }
      const uden = await soegMed('alarm uden availability', BASIS)
      tjek('alarm UDEN availability-filter opfører sig som før — alle syv',
        [bNu, bSenere, bUkendt, bVente, bNormal, bReserv, bLedigP].every((x) => uden.has(x)),
        `${uden.size} træf`)
      const nuT = await soegMed('alarm: kan overtages nu', { ...BASIS, overtagelse: 'nu' })
      tjek('«kan overtages nu» matcher nu — ikke senere/unknown',
        nuT.has(bNu) && !nuT.has(bSenere) && !nuT.has(bUkendt), `${nuT.size} træf`)
      const senT = await soegMed('alarm: senere', { ...BASIS, overtagelse: 'senere' })
      tjek('«kan overtages senere» matcher senere — ikke nu/unknown',
        senT.has(bSenere) && !senT.has(bNu) && !senT.has(bUkendt), `${senT.size} træf`)
      const venT = await soegMed('alarm: venteliste', { ...BASIS, ansoegningsform: 'venteliste' })
      tjek('«venteliste» matcher venteliste — ikke normal, ikke unknown',
        venT.has(bVente) && !venT.has(bNormal) && !venT.has(bUkendt) && venT.size === 1,
        `${venT.size} træf`)
      const resT = await soegMed('alarm: reserveret', { ...BASIS, markedsstatus: 'reserveret' })
      tjek('«reserveret» følger søgningens semantik',
        resT.has(bReserv) && !resT.has(bLedigP) && resT.size === 1, `${resT.size} træf`)
    } else {
      console.log('\n  ⊘ alarmens availability-prøver — kildeslugs kan kun oprettes i PGlite')
    }

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
      // Pr. KILDE, ikke kun de id'er prøven nåede at samle op: en kørsel
      // kan skrive boliger, prøven aldrig så, og så vælter fremmednøglen
      // oprydningen — og dermed hele suiten, længe efter den rigtige fejl.
      for (const b of await db.select({ id: listings.id }).from(listings)
        .where(eq(listings.sourceId, k))) {
        await db.delete(listingImages).where(eq(listingImages.listingId, b.id))
        await db.delete(listings).where(eq(listings.id, b.id))
      }
      await db.delete(fetchFailures).where(eq(fetchFailures.sourceId, k))
      await db.delete(crawlRuns).where(eq(crawlRuns.sourceId, k))
      await db.delete(sources).where(eq(sources.id, k))
    }
    await db.delete(hostBlocks)
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
