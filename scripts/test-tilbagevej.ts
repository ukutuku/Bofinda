// ═══════════════════════════════════════════════════════════════
//  Vejen tilbage til søgningen.
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
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import { Visningskort } from '../app/Boligkort'
import Gruppeside from '../app/gruppe/page'
import { RETUR_PARAM, medRetur, returUrl, returVaerdi } from '../lib/retur'
import { soegGrupperet, type Soegeparametre } from '../lib/soeg'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const STEMPEL = Date.now()
const SLUG = `test-tilbagevej-${STEMPEL}`

async function koer() {
  // ─── Grundlag ────────────────────────────────────────────────
  // Egen kilde pr. kørsel, og den slettes igen. En prøve må aldrig låne
  // en rigtig kildes historik — se noten i CLAUDE.md om test-redigering
  // og alarmen.
  const [fremmed] = await db.insert(sources)
    .values({ slug: SLUG, name: 'Prøvekilde Tilbagevej', sourceType: 'spider' })
    .returning()
  const kildeId = fremmed!.id

  const nu = new Date()
  const lav = async (noegle: string, husnr: string, vej = 'Returvej') => {
    const [r] = await db.insert(listings).values({
      sourceId: kildeId, sourceType: 'spider', externalKey: `${SLUG}-${noegle}`,
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
  // To ens paa samme vej giver et GRUPPEkort; den tredje staar alene
  // paa sin egen vej og giver et ENKELTkort. Begge veje ind paa en
  // bolig skal baere returadressen.
  const a = await lav('a', '1')
  const b = await lav('b', '2')
  const solo = await lav('s', '5', 'Enevej')
  const saaede = [a, b, solo]

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

  // ─── Oprydning ───────────────────────────────────────────────
  await db.delete(listings).where(inArray(listings.id, saaede))
  await db.delete(sources).where(eq(sources.id, kildeId))

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
