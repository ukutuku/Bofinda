// ═══════════════════════════════════════════════════════════════
//  To ting, der er dyre at bryde uden at opdage det:
//
//    1. Rundturen — gem uden at ændre noget, og se om rækken overlever.
//    2. At en udlejerannonce ALDRIG havner i en alarmmail.
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
import { alertMatches, listingImages, listings, savedSearches, users } from '../db/schema'
import { matchAlarmer } from '../lib/alarm'
import { opdaterBolig, opretBolig, somFormular, type Boliginput } from '../lib/udlejer'

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
    const [soeg] = await db.insert(savedSearches).values({
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
    await db.delete(alertMatches).where(eq(alertMatches.savedSearchId, soeg!.id))
    await db.delete(savedSearches).where(eq(savedSearches.id, soeg!.id))

  } finally {
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
