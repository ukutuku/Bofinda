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

import { eq } from 'drizzle-orm'
import { db, sql } from '../db/client'
import { alertMatches, listingImages, listings, savedSearches, sources, users } from '../db/schema'
import { matchAlarmer } from '../lib/alarm'
import { byForPostnr } from '../lib/omraade'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Gruppekort, Kort } from '../app/Boligkort'
import type { Bolig, Gruppe } from '../lib/soeg'
import { facilitetsgrundlag, opsummering, soeg } from '../lib/soeg'
import {
  mineBoliger, opdaterBolig, opretBolig, renTekst, somFormular, tjekAdresse,
  type Boliginput,
} from '../lib/udlejer'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

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
  billeder: ['https://eksempel.invalid/1.jpg', 'https://eksempel.invalid/2.jpg'],
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
  console.log('\n══ byen udledes af postnummeret ══')
  tjek('2200 giver et bynavn', (await byForPostnr('2200')) !== null,
    String(await byForPostnr('2200')))
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
    kilde: 'proeve', kildeNavn: 'Prøve', ogsaaHos: [], billeder: 0, forside: null,
    ...o,
  } as unknown as Bolig)

  const gruppe = (o: Partial<Gruppe>, n: Partial<Bolig> = {}): Gruppe => ({
    noegle: { kilde: 'proeve', postnr: '2200', vej: 'Prøvevej', vaerelser: 3, total: true },
    antal: 3, repraesentant: bolig(n), prisMin: 1300000, prisMax: 1500000,
    arealMin: 70, arealMax: 90, type: 'lejlighed', ledigMin: null, ledigMax: null,
    ledigUkendte: 0, indflytningMin: null, indflytningMax: null,
    ensPoster: true, alleOgsaaAndetsteds: false, nyesteMarkedet: new Date(),
    nogenUdenEl: true, alleUdenElHarEgenMaaler: false,
    ...o,
  } as unknown as Gruppe)

  const vis = (el: React.ReactElement) => renderToStaticMarkup(el)

  for (const [navn, html] of [
    ['enkeltkort, el ukendt', vis(createElement(Kort, { b: bolig({}) }))],
    ['gruppekort, én uden el', vis(createElement(Gruppekort, { g: gruppe({}) }))],
    ['gruppekort, alle uden el', vis(createElement(Gruppekort,
      { g: gruppe({ nogenUdenEl: true }) }))],
  ] as const) {
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
    tjek('oplyser + tier er hele søgningen', g.oplyser + g.tier === alt.antal,
      `${g.oplyser} + ${g.tier} = ${g.oplyser + g.tier}, listen har ${alt.antal}`)
    const gFiltreret = await facilitetsgrundlag({ elevator: true })
    tjek('grundlaget ændrer sig IKKE af et facilitetsfilter',
      gFiltreret.tier === g.tier && gFiltreret.elevator === g.elevator,
      `tier ${gFiltreret.tier} vs ${g.tier}`)
    tjek('men søgningen gør — filteret udelukker stadig de ukendte',
      (await opsummering({ elevator: true })).antal < alt.antal)
    tjek('hendes elevator tælles med i grundlaget',
      (await facilitetsgrundlag({ postnr: FULDT.postnr })).elevator >= 1)

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
    const [fremmed] = await db.select().from(sources).where(eq(sources.slug, 'findbolig')).limit(1)
    const [hendes] = await db.select().from(listings).where(eq(listings.id, id))
    const { id: _glem, ...resten } = hendes!
    const [rival] = await db.insert(listings).values({
      ...resten,
      sourceId: fremmed!.id,
      sourceType: 'feed',
      externalKey: `proeve-dublet-${Date.now()}`,
      sourceUrl: 'https://eksempel.invalid/dublet',
      landlordId: null, contactEmail: null, contactPhone: null,
    }).returning()
    rivalId = rival!.id
    await db.insert(listingImages).values(
      [0, 1, 2, 3].map((n) => ({
        listingId: rivalId, externalUrl: `https://eksempel.invalid/r${n}.jpg`, position: n,
      })))

    const efterRival = await maerkat()
    tjek('med dublet: mærkatet siger IKKE udgivet', efterRival.slags === 'dublet',
      efterRival.slags)
    tjek('med dublet: den peger på den rigtige annonce',
      efterRival.slags === 'dublet' && efterRival.af.id === rivalId)
    tjek('med dublet: og begrundelsen passer — flere billeder',
      efterRival.slags === 'dublet' && efterRival.af.billeder === 4)
    tjek('med dublet: hun er FAKTISK ude af søgningen', !(await iSoegningen()))

    // Og tilbage igen, saa proeven ikke bare maaler at noget forsvandt.
    await db.delete(listingImages).where(eq(listingImages.listingId, rivalId))
    await db.delete(listings).where(eq(listings.id, rivalId))
    rivalId = ''
    tjek('uden dublet: mærkatet siger udgivet igen', (await maerkat()).slags === 'udgivet')
    tjek('uden dublet: og hun er i søgningen igen', await iSoegningen())

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
    const [gemtSoegning] = await db.insert(savedSearches).values({
      userId: u!.id,
      name: 'proeve: alt',
      criteria: {},
      confirmedAt: new Date(),
      notifyEmail: true,
    }).returning()
    await matchAlarmer()
    const [traf] = await db.select().from(alertMatches)
      .where(eq(alertMatches.listingId, id)).limit(1)
    tjek('native bolig er IKKE et alarmtræf', !traf)
    await db.delete(alertMatches).where(eq(alertMatches.savedSearchId, gemtSoegning!.id))
    await db.delete(savedSearches).where(eq(savedSearches.id, gemtSoegning!.id))

  } finally {
    if (rivalId) {
      await db.delete(listingImages).where(eq(listingImages.listingId, rivalId))
      await db.delete(listings).where(eq(listings.id, rivalId))
    }
    if (id) {
      await db.delete(listingImages).where(eq(listingImages.listingId, id))
      await db.delete(listings).where(eq(listings.id, id))
    }
    await db.delete(users).where(eq(users.id, u!.id))
  }

  console.log(fejl ? `\n  ${fejl} fejl.` : '\n  Alt bestod.')
  await sql.end()
  process.exit(fejl ? 1 : 0)
}

await main()
