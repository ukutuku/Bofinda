// ═══════════════════════════════════════════════════════════════
//  Rundturen: gem uden at ændre noget, og se om rækken overlever.
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
import { listingImages, listings, users } from '../db/schema'
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
