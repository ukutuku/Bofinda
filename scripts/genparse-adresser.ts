// ═══════════════════════════════════════════════════════════════
//  Genparsning af gemte adresser.
//
//  Naar adressevasken laerer en ny form, staar de gamle raekker tilbage
//  med den gamle laesning. De skal IKKE hentes hjem igen: kildens streng
//  er den samme, det er kun vores forstaaelse af den, der er blevet
//  bedre. At hente 43 sider for at faa det samme svar ville belaste
//  kilden for ingenting.
//
//  Scriptet laeser `address_raw` fra basen, koerer den gennem vasken igen
//  og skriver kun de raekker, hvor noget faktisk aendrer sig.
//
//    npm run genparse           viser hvad der ville ske
//    npm run genparse -- --skriv  skriver
//
//  CLAUDE.md naevner det samme behov for skiftet til DAR: de gamle
//  noegler kan findes praecist paa INTERN_PRAEFIKS.
// ═══════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm'
import { db, sql as raw } from '../db/client'
import { listings } from '../db/schema'
import { SimpelAdressevask } from '../lib/address'

const skriv = process.argv.includes('--skriv')
const vask = new SimpelAdressevask()

const ens = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

async function main() {
  const raekker = await db
    .select({
      id: listings.id,
      raa: listings.addressRaw,
      street: listings.street,
      houseNumber: listings.houseNumber,
      floor: listings.floor,
      door: listings.door,
      postalCode: listings.postalCode,
      city: listings.city,
      unit: listings.unitAddressUuid,
      access: listings.accessAddressUuid,
      niveau: listings.addressMatchLevel,
    })
    .from(listings)

  let uaendret = 0
  const aendringer: { id: string; raa: string; foer: string; efter: string; ny: typeof raekker[number] }[] = []

  for (const r of raekker) {
    const v = await vask.vask(r.raa, { postalCode: r.postalCode })
    const forskel = !ens(v.street, r.street) || !ens(v.houseNumber, r.houseNumber)
      || !ens(v.floor, r.floor) || !ens(v.door, r.door)
      || !ens(v.postalCode, r.postalCode) || !ens(v.city, r.city)
      || !ens(v.unitAddressUuid, r.unit) || !ens(v.accessAddressUuid, r.access)
      || v.addressMatchLevel !== r.niveau
    if (!forskel) { uaendret++; continue }
    aendringer.push({
      id: r.id, raa: r.raa,
      foer: `${r.niveau} etage=${r.floor ?? '—'} dør=${r.door ?? '—'}`,
      efter: `${v.addressMatchLevel} etage=${v.floor ?? '—'} dør=${v.door ?? '—'}`,
      ny: { ...r, ...v } as typeof raekker[number],
    })
    if (skriv) {
      await db.update(listings).set({
        street: v.street, houseNumber: v.houseNumber, floor: v.floor, door: v.door,
        postalCode: v.postalCode, city: v.city,
        unitAddressUuid: v.unitAddressUuid, accessAddressUuid: v.accessAddressUuid,
        addressMatchLevel: v.addressMatchLevel,
      }).where(eq(listings.id, r.id))
    }
  }

  console.log(`${raekker.length} adresser · ${uaendret} uændret · ${aendringer.length} ændret`)
  for (const a of aendringer.slice(0, 20)) {
    console.log(`  ${a.raa}\n     ${a.foer}  →  ${a.efter}`)
  }
  if (aendringer.length > 20) console.log(`  … og ${aendringer.length - 20} mere`)
  console.log(skriv ? '\nSKREVET.' : '\nIntet skrevet. Kør med --skriv.')
  await raw.end()
}

await main()
