// Efterprøver, at de to genererede blokke PARSER og KØRER mod rigtig
// Postgres (PGlite), og at tallene stemmer med et kendt facit.
import { readFileSync } from 'node:fs'
import { rejsTestbase } from '../testbase'
const tb = await rejsTestbase()
const { db } = await import('../../db/client')
const { listings, sources } = await import('../../db/schema')
const { sql } = await import('drizzle-orm')

const [k] = await db.insert(sources).values({ slug: 'maal-proeve', name: 'Prøve',
  sourceType: 'feed', baseUrl: 'https://proeve.invalid', enabled: false }).returning()
let n = 0
const saa = async (postnr: string, by: string, leje: number | null, total: number | null) =>
  db.insert(listings).values({
    sourceId: k!.id, sourceType: 'feed', externalKey: `m-${++n}`,
    sourceUrl: `https://proeve.invalid/${n}`, addressRaw: `Prøvevej ${n}, ${postnr} ${by}`,
    street: 'Prøvevej', houseNumber: String(n), postalCode: postnr, city: by,
    rooms: 2, sizeM2: 60, rentMonthly: leje, totalMonthly: total,
    addressMatchLevel: 'unit', unitAddressUuid: `intern:m:${n}`, status: 'active',
  })

// 9001: tre kendte totaler                       → begge endepunkter 'total'
await saa('9001', 'Prøveby', 900000, 1000000)
await saa('9001', 'Prøveby', 1100000, 1200000)
await saa('9001', 'Prøveby', 1000000, 1100000)
// 9002: tre rene huslejer                        → begge 'ren husleje', 0 totaler
await saa('9002', 'Prøveby', 700000, null)
await saa('9002', 'Prøveby', 800000, null)
await saa('9002', 'Prøveby', 900000, null)
// 9003: nedre er en husleje, øvre er en total    → 'ren husleje' / 'total'
await saa('9003', 'Attrapby', 611000, null)
await saa('9003', 'Attrapby', 2300000, 2401000)
await saa('9003', 'Attrapby', 900000, 1000000)
// 9004: alle tre samme beløb                     → spænd_er_ét_beløb = true
await saa('9004', 'Fiktivby', 1032000, null)
await saa('9004', 'Fiktivby', 1032000, null)
await saa('9004', 'Fiktivby', 1032000, null)

const tekst = readFileSync('/tmp/claude-0/-home-user-Bofinda/0f61addf-d183-522a-b0ac-34f7b0ebe8e0/scratchpad/okt/maal.sql', 'utf8')
const blokke = tekst.split(/\n\n\n/)

// Én afmeldt række, så BLOK 3 har noget at tælle.
await db.update(listings).set({ status: 'delisted', delistedAt: new Date() })
  .where(sql`${listings.externalKey} = 'm-12'`)

for (const [i, blok] of blokke.entries()) {
  const navn = `BLOK ${i + 1}`
  const r = await db.execute(sql.raw(blok.replace(/;\s*$/, '')))
  console.log(`\n─── ${navn} ───`)
  console.table((r as any).rows ?? r)
}
await tb.luk()
