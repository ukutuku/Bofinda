// ═══════════════════════════════════════════════════════════════
//  Vejen tilbage til søgningen — og hvem kortet siger boligen er fra.
//
//  To fund fra den samme gennemgang af previewet, og de har nøjagtig
//  samme form: ét spørgsmål besvaret af to udtryk, som drev fra
//  hinanden. De prøves i samme fil, fordi de måles på det samme — hvad
//  kortet siger, og hvor det fører.
//
//  ═══ 1 · TILBAGEVEJEN ═══
//
//  Søgningen fandtes i to repræsentationer: de rå `Soegeparametre`
//  (tabsfri — `sideUrl` og `kortLink` kopierer dem ordret) og `Filtre`
//  (en projektion til SQL, uden `kort` og `side`). Kortenes links blev
//  bygget af den tabsgivende, og `/bolig/[id]` fik slet ingen. Klikkede
//  hun ind på en bolig, var sortering og listevisning væk, og der var
//  ingen synlig vej tilbage til hele søgningen.
//
//  Prøven følger HELE kæden gennem den rigtige kode: søgning → kortets
//  href → gruppesiden → dens korts href → returadressen igen. Et led,
//  der taber noget, kan ikke skjule sig i en prøve, der måler hvert led
//  for sig — det var netop dét, fejlen levede af.
//
//  Og den prøver det modsatte: at en adresse udefra ikke kan blive til
//  et link ud af huset. Uddata bygges af en literal sti og en hvidliste,
//  så `//fremmed.example` og `/udlejer` aldrig kan komme igennem.
//
//  ═══ 2 · KILDEANGIVELSEN ═══
//
//  Boligsiden spurgte «er det udlejerens egen annonce?» og skrev
//  «Udlejeren selv». Kortet spurgte ikke og skrev `sources.name`. Om
//  den SAMME annonce stod der derfor «Bofinda» ét sted og «Udlejeren
//  selv» et andet. I previewet blev det synligt i en skarpere form,
//  fordi demodataene ligger under deres egen kilderække med typen
//  `native`: «DEMO · fiktive boliger» mod «Udlejeren selv».
//
//  Prøven sår begge former — den rigtige native-kilde og previewets
//  form, en kilde med typen `native` og sin egen slug — og kræver at
//  alle fire flader svarer det samme.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { favorites, listings, sources, users } from '../db/schema'
import { Kort, Visningskort } from '../app/Boligkort'
import Gruppeside from '../app/gruppe/page'
import { gemFavorit, hentFavoritter } from '../lib/favoritter'
import { erEgenAnnonce, kildeetiket } from '../lib/kilde'
import { RETUR_PARAM, medRetur, returUrl, returVaerdi } from '../lib/retur'
import {
  hentBolig, repraesentantFor, soegGrupperet, type Soegeparametre,
} from '../lib/soeg'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const STEMPEL = Date.now()
const SLUG = `test-tilbagevej-${STEMPEL}`
/** Previewets form: typen er `native`, men slug'en er kildens egen. */
const DEMOSLUG = `test-demo-${STEMPEL}`

/** Den synlige tekst — det, brugeren faktisk læser. */
const tekst = (markup: string) =>
  markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

async function koer() {
  // ─── Grundlag ────────────────────────────────────────────────
  // Egen kilde pr. kørsel, og den slettes igen. En prøve må aldrig låne
  // en rigtig kildes historik — se noten i CLAUDE.md om test-redigering
  // og alarmen.
  const [fremmed] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde Tilbagevej', sourceType: 'spider' })
    .returning()
  const [demo] = await db.insert(sources)
    .values({ slug: DEMOSLUG, name: 'DEMO · prøvekilde', sourceType: 'native' })
    .returning()
  const [egen] = await db.select().from(sources).where(eq(sources.slug, 'native')).limit(1)

  const nu = new Date()
  const lav = async (
    kilde: { id: string }, type: 'spider' | 'native', noegle: string, husnr: string,
    vej = 'Returvej',
  ) => {
    const [r] = await db.insert(listings).values({
      sourceId: kilde.id, sourceType: type, externalKey: `${SLUG}-${noegle}`,
      sourceUrl: `https://eksempel.invalid/${noegle}`,
      addressRaw: `${vej} ${husnr}, 9007 Returby`,
      street: vej, houseNumber: husnr,
      postalCode: '9007', city: 'Returby',
      // Uden et adressematch vises boligen ikke — `hvor()` kasserer
      // `failed`. Hver raekke faar sin EGEN enhedsnoegle, saa de to ens
      // boliger GRUPPERES (samme kilde, vej, postnr og vaerelser) og
      // ikke dedupes vaek som den samme bolig to steder.
      addressMatchLevel: 'unit',
      unitAddressUuid: `intern:v3:proeve:${SLUG}-${noegle}`,
      propertyType: 'lejlighed', rooms: 2, sizeM2: 60,
      rentMonthly: 800000, totalMonthly: 900000,
      totalMonthlyComponents: ['rent', 'heat', 'water'],
      electricityOwnMeter: true,
      status: 'active', firstSeenAt: nu, lastSeenAt: nu,
    }).returning()
    return r!.id
  }
  // To ens boliger fra samme kilde paa samme vej: det giver et gruppekort.
  const a = await lav(fremmed!, 'spider', 'a', '1')
  const b = await lav(fremmed!, 'spider', 'b', '2')
  const nativeId = await lav(egen!, 'native', 'n', '3')
  const demoId = await lav(demo!, 'native', 'd', '4')
  // Alene paa sin egen vej, saa den bliver et ENKELTkort og ikke en del
  // af gruppen ovenfor. Modstykket i afsnit 3 skal maales paa den form,
  // kortets kildemaerkat faktisk har.
  const soloId = await lav(fremmed!, 'spider', 's', '5', 'Enevej')
  const saaede = [a, b, nativeId, demoId, soloId]

  // ═══ 1 · Returadressen bygges og genopbygges ét sted ═══
  console.log('\n══ 1 · returadressen: bygget, aldrig ekkoet ══')
  {
    const sp: Soegeparametre = {
      sted: 'Returby', type: 'lejlighed', prisMax: '15000',
      kort: '0', sorter: 'pris_op', side: '2',
    }
    const v = returVaerdi('/', sp)
    tjek('1A · sorteringen overlever', Boolean(v?.includes('sorter=pris_op')), String(v))
    tjek('1B · listevisningen overlever', Boolean(v?.includes('kort=0')), String(v))
    tjek('1C · sidetallet overlever', Boolean(v?.includes('side=2')), String(v))
    // Præcis dét, `gruppeUrl` ikke kunne: den skriver hverken sorter,
    // kort eller side.
    tjek('1D · og filtrene er der stadig',
      Boolean(v?.includes('sted=Returby') && v?.includes('type=lejlighed')
        && v?.includes('prisMax=15000')), String(v))
    tjek('1E · den genopbyggede adresse er den samme', returUrl(v) === v, `${returUrl(v)}`)

    // Forsiden uden filtre er ikke en søgning at vende tilbage til — og
    // et tomt `fra=` ville desuden udløse «én adresse pr. søgning».
    tjek('1F · en tom forside giver ingen returadresse', returVaerdi('/', {}) === null)
    tjek('1G · en områdeside gør, også uden filtre',
      returVaerdi('/lejeboliger/koebenhavn-s', {}) === '/lejeboliger/koebenhavn-s')

    // Ukendte nøgler falder væk. `gemt` er forsidens besked om en fejlet
    // gemning; bar vi den tilbage, stod en gammel fejl der igen.
    tjek('1H · ukendte parametre bæres ikke med',
      returVaerdi('/', { sted: 'Returby', gemt: 'ugyldig-mail', xyz: '1' })
        === '/?sted=Returby')
    tjek('1I · og de overlever heller ikke en genopbygning',
      returUrl('/?sted=Returby&gemt=ugyldig-mail') === '/?sted=Returby')
  }

  console.log('\n══ 1J–1O · adressen kan ikke pege ud af huset ══')
  {
    // En præfikskontrol ville ikke være nok: `//fremmed.example` består
    // `startsWith('/')` og er en absolut adresse til en anden vært.
    for (const ond of [
      '//fremmed.example/', 'https://fremmed.example/', '/\\fremmed.example',
      '/udlejer/opret', '/min-side?gem=x', 'javascript:alert(1)',
      '/lejeboliger/../udlejer', '/lejeboliger/KØBENHAVN',
    ]) {
      tjek(`1J · «${ond}» giver ingen returadresse`, returUrl(ond) === null, String(returUrl(ond)))
    }
    tjek('1K · en for lang adresse giver null, aldrig en afkortet',
      returUrl('/?sted=' + 'a'.repeat(600)) === null)
    tjek('1L · en kendt områdeslug slipper igennem',
      returUrl('/lejeboliger/koebenhavn-s?side=3') === '/lejeboliger/koebenhavn-s?side=3')
    tjek('1M · ingen returadresse: linket er uændret',
      medRetur('/bolig/x', null) === '/bolig/x')
  }

  // ═══ 2 · Hele kæden: søgning → gruppe → bolig ═══
  console.log('\n══ 2 · kæden holder hele vejen ══')
  {
    const sp: Soegeparametre = {
      sted: 'Returby', type: 'lejlighed', kort: '0', sorter: 'pris_op',
    }
    const retur = returVaerdi('/', sp)
    const { visninger } = await soegGrupperet(
      { by: 'Returby', boligtyper: ['lejlighed'], sorter: 'pris_op' }, 48, nu)
    const gruppe = visninger.find((v) => v.slags === 'gruppe')
    tjek('2A · de to ens boliger blev ét gruppekort', Boolean(gruppe))
    if (gruppe) {
      const markup = renderToStaticMarkup(
        createElement(Visningskort, { v: gruppe, nu, retur }))
      const href = markup.match(/href="(\/gruppe\?[^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
      tjek('2B · gruppekortets link bærer returadressen',
        Boolean(href?.includes(`${RETUR_PARAM}=`)), String(href))
      if (href) {
        // Ind i den rigtige serverfunktion med kortets EGEN adresse.
        const parametre = new URL(href, 'https://proeve.invalid').searchParams
        const klik: Soegeparametre = {}
        for (const k of new Set(parametre.keys())) klik[k] = parametre.getAll(k)
        const side = renderToStaticMarkup(
          await Gruppeside({ searchParams: Promise.resolve(klik) }))
        tjek('2C · gruppesidens første led fører tilbage til søgningen',
          side.includes(`href="${retur!.replace(/&/g, '&amp;')}"`)
          && side.includes('Tilbage til søgeresultaterne'),
          retur!)
        // Og videre: kortene PÅ gruppesiden bærer den samme adresse —
        // gruppesiden pakker ikke sin egen ind i sig selv, for så ville
        // strengen vokse for hvert hop.
        const videre = [...side.matchAll(/href="(\/bolig\/[^"]+)"/g)]
          .map((m) => m[1]!.replace(/&amp;/g, '&'))
        tjek('2D · boligkortene på gruppesiden bærer den videre',
          videre.length > 0 && videre.every((h) => h.includes(`${RETUR_PARAM}=`)),
          videre[0] ?? 'ingen')
        const baaret = videre[0]
          ? new URL(videre[0], 'https://proeve.invalid').searchParams.get(RETUR_PARAM)
          : null
        tjek('2E · og det er søgningen, ikke gruppesiden',
          baaret === retur, `${baaret}`)
      }
    }
    // Enkeltkortet er den anden vej ind på en bolig.
    const enkelt = visninger.find((v) => v.slags === 'bolig')
    if (enkelt) {
      const markup = renderToStaticMarkup(
        createElement(Visningskort, { v: enkelt, nu, retur }))
      const href = markup.match(/href="(\/bolig\/[^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
      tjek('2F · enkeltkortets link bærer den også',
        Boolean(href?.includes(`${RETUR_PARAM}=`)), String(href))
    }
    // Uden returadresse er linkene bit for bit, som de altid har været.
    const uden = enkelt
      ? renderToStaticMarkup(createElement(Visningskort, { v: enkelt, nu }))
      : ''
    tjek('2G · uden returadresse er kortets link uændret',
      Boolean(uden) && !uden.includes(`${RETUR_PARAM}=`))
  }

  // ═══ 3 · Kildeangivelsen: ét udtryk, fire flader ═══
  console.log('\n══ 3 · kortet og boligsiden siger det samme ══')
  {
    const hent = async (id: string) => {
      const d = await hentBolig(id)
      if (!d) throw new Error(`ingen bolig ${id}`)
      return d
    }
    const kortFor = async (id: string) => {
      const { visninger } = await soegGrupperet({ by: 'Returby' }, 48, nu)
      const v = visninger.find((x) => x.slags === 'bolig' && x.bolig.id === id)
      if (!v || v.slags !== 'bolig') return null
      return tekst(renderToStaticMarkup(createElement(Kort, { b: v.bolig, nu })))
    }

    // ── Udlejerens egen annonce ──
    const n = await hent(nativeId)
    const nKort = await kortFor(nativeId)
    tjek('3A · boligsiden: udlejerens egen annonce', kildeetiket(n) === 'Udlejeren selv')
    tjek('3B · kortet siger det samme', Boolean(nKort?.includes('Udlejeren selv')), nKort ?? '')
    // Dét, fejlen bestod i: kortet skrev kildens navn om en annonce,
    // der ikke er hentet nogen steder.
    tjek('3C · og kortet skriver IKKE kildens navn',
      Boolean(nKort) && !nKort!.includes(egen!.name), nKort ?? '')

    // ── Previewets form: typen native, men kildens egen slug ──
    const d = await hent(demoId)
    const dKort = await kortFor(demoId)
    tjek('3D · en kilde med typen native regnes også som egen annonce',
      erEgenAnnonce(d) && kildeetiket(d) === 'Udlejeren selv')
    tjek('3E · og de to flader er enige om den', Boolean(dKort?.includes('Udlejeren selv')),
      dKort ?? '')
    tjek('3F · modstriden fra gennemgangen kan ikke opstå igen',
      Boolean(dKort) && !dKort!.includes('DEMO · prøvekilde')
      && kildeetiket(d) !== demo!.name, dKort ?? '')

    // ── Modstykket: en rigtig kilde skal stadig navngives ──
    const f = await hent(soloId)
    const fKort = await kortFor(soloId)
    tjek('3G · en hentet bolig navngiver sin kilde',
      !erEgenAnnonce(f) && kildeetiket(f) === fremmed!.name)
    tjek('3H · også på kortet', Boolean(fKort?.includes(fremmed!.name)), fKort ?? '')
    // Uden den her kunne rettelsen «bestå» ved at skrive «Udlejeren
    // selv» på alting.
    tjek('3I · og den siger ikke «Udlejeren selv»',
      Boolean(fKort) && !fKort!.includes('Udlejeren selv'), fKort ?? '')

    // ── Min side er den tredje flade, og den blev overset i
    //    gennemgangen. En gemt udlejerannonce stod som «· Bofinda».
    const [bruger] = await db.insert(users)
      .values({ email: `t-${SLUG}@example.invalid`, role: 'tenant' }).returning()
    await gemFavorit(bruger!.id, nativeId)
    await gemFavorit(bruger!.id, soloId)
    const gemte = await hentFavoritter(bruger!.id)
    const gemtEgen = gemte.find((g) => g.listingId === nativeId)
    const gemtHentet = gemte.find((g) => g.listingId === soloId)
    tjek('3J · Min side siger også «Udlejeren selv»',
      gemtEgen?.kilde === 'Udlejeren selv', String(gemtEgen?.kilde))
    tjek('3K · og navngiver stadig en rigtig kilde',
      gemtHentet?.kilde === fremmed!.name, String(gemtHentet?.kilde))
    await db.delete(favorites).where(eq(favorites.userId, bruger!.id))
    await db.delete(users).where(eq(users.id, bruger!.id))

    // ── Og den fjerde flade: Mine annoncer. Taber en udlejer
    //    repraesentantvalget til en ANDEN udlejerannonce, stod der
    //    «viser den i stedet: … hos Bofinda».
    const [taber] = await db.insert(listings).values({
      sourceId: egen!.id, sourceType: 'native', externalKey: `${SLUG}-taber`,
      sourceUrl: 'https://eksempel.invalid/taber',
      addressRaw: 'Dubletvej 9, 9007 Returby', street: 'Dubletvej', houseNumber: '9',
      postalCode: '9007', city: 'Returby', addressMatchLevel: 'unit',
      unitAddressUuid: `intern:v3:proeve:${SLUG}-dublet`,
      propertyType: 'lejlighed', rooms: 2, sizeM2: 60, rentMonthly: 800000,
      status: 'active', firstSeenAt: nu, lastSeenAt: nu,
    }).returning()
    const [vinder] = await db.insert(listings).values({
      sourceId: egen!.id, sourceType: 'native', externalKey: `${SLUG}-vinder`,
      sourceUrl: 'https://eksempel.invalid/vinder',
      addressRaw: 'Dubletvej 9, 9007 Returby', street: 'Dubletvej', houseNumber: '9',
      postalCode: '9007', city: 'Returby', addressMatchLevel: 'unit',
      unitAddressUuid: `intern:v3:proeve:${SLUG}-dublet`,
      propertyType: 'lejlighed', rooms: 2, sizeM2: 60, rentMonthly: 800000,
      // Kendt total slaar ukendt, naar billedantallet er det samme.
      totalMonthly: 900000, totalMonthlyComponents: ['rent', 'heat', 'water'],
      status: 'active', firstSeenAt: nu, lastSeenAt: nu,
    }).returning()
    const kort = await repraesentantFor([taber!.id])
    const af = kort.get(taber!.id)
    tjek('3L · den tabende udlejerannonce får en repræsentant',
      af?.id === vinder!.id, String(af?.id))
    tjek('3M · og Mine annoncer siger «udlejeren selv», ikke «Bofinda»',
      Boolean(af) && erEgenAnnonce(af!) && af!.kildeNavn === egen!.name,
      `${af?.kildeNavn} / ${af?.kildetype}`)
    await db.delete(listings).where(inArray(listings.id, [taber!.id, vinder!.id]))
  }

  // ─── Oprydning ───────────────────────────────────────────────
  await db.delete(listings).where(inArray(listings.id, saaede))
  await db.delete(sources).where(inArray(sources.id, [fremmed!.id, demo!.id]))

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
