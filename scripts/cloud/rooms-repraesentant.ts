// ═══════════════════════════════════════════════════════════════
//  Dubletmatch og repraesentantvalg er TO TRIN — ikke ét.
//
//  ── HVORFOR DEN HER FIL FINDES ────────────────────────────────
//  En tidligere formulering sagde, at en home-annonce «skjules», naar
//  vaerelsestallet kommer til at stemme med en anden kildes annonce.
//  Det er forkert, og fejlen er vaerd at holde fast i, fordi den er
//  nem at gentage:
//
//    TRIN 1 · MATCH.   `DEDUPNOEGLE` afgoer, om to raekker er samme
//              bolig. Vaerelsestallet indgaar i access-grenen, saa
//              rettelsen kan skabe et match, der ikke var der foer.
//    TRIN 2 · RANGERING. `ikkeRepraesentant` afgoer, HVEM af de to der
//              vises. Vaerelsestallet indgaar IKKE. Raekkefoelgen er:
//                  1. flest VISBARE billeder   (desc)
//                  2. kendt total              (desc)
//                  3. id                       (stabilt led)
//
//  Trin 1 siger altsaa «de er den samme bolig». Trin 2 siger «og det er
//  DEN her, vi viser». Rettelsen kan kun paavirke trin 1. Hvem der
//  taber, afgoeres af kriterier, der ikke aendrer sig af et
//  vaerelsestal — og home kan ligesaa godt VINDE som tabe.
//
//  Det er ikke teoretisk: home henter op til 19 billeder pr. bolig fra
//  detaljesiden, og BEGGE dens billedvaerter (`alvis.b-cdn.net` og
//  `home.mindworking.eu`) staar i `TILLADTE_VAERTER`. Billederne
//  taeller derfor fuldt med i rangeringen.
//
//  Filen proever BEGGE retninger paa det samme grundlag.
//
//  ⚠ SYNTETISK OG ISOLERET. Datasaettet er opdigtet og siger intet om,
//    hvor ofte hver retning forekommer i produktionen.
//
//      scripts/cloud/db-op.sh && \
//      DATABASE_URL_DIRECT=… npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/cloud/rooms-repraesentant.ts
// ═══════════════════════════════════════════════════════════════
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { listingImages, listings, sources } from '../../db/schema'
import { hvor, udenDubletter, type Filtre } from '../../lib/soeg'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(url || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kun mod den isolerede testbase.')
    process.exit(1)
  }
}

const POSTNR = '9901'
const F: Filtre = { postnr: POSTNR }
const HOME = 'rep-home'
const ANDEN = 'rep-anden'
/** Dokumenteret i begge kildeproever (15. sep. 2026). */
const DOK = 2
/** En vaert fra TILLADTE_VAERTER, saa billedet taeller i rangeringen. */
const VAERT = 'https://alvis.b-cdn.net'

async function ryd() {
  const s = await db.select({ id: sources.id }).from(sources)
    .where(sql`${sources.slug} in (${HOME}, ${ANDEN})`)
  for (const x of s) {
    const l = await db.select({ id: listings.id }).from(listings)
      .where(eq(listings.sourceId, x.id))
    for (const y of l) await db.delete(listingImages).where(eq(listingImages.listingId, y.id))
    await db.delete(listings).where(eq(listings.sourceId, x.id))
  }
  await db.delete(sources).where(sql`${sources.slug} in (${HOME}, ${ANDEN})`)
}

async function kilde(slug: string) {
  const [r] = await db.insert(sources).values({
    slug, name: slug, sourceType: 'spider', baseUrl: 'http://127.0.0.1/rep',
  }).returning({ id: sources.id })
  return r!.id
}

interface Raekke {
  noegle: string
  kildeId: string
  uuid: string
  vej: string
  husnr: string
  /** Antal VISBARE billeder — foerste led i rangeringen. */
  billeder: number
  /** Andet led. */
  total: number | null
  vaerelser: number | null
}

async function saet(r: Raekke) {
  const [l] = await db.insert(listings).values({
    sourceId: r.kildeId, sourceType: 'spider', externalKey: r.noegle,
    sourceUrl: `http://127.0.0.1/rep/${r.noegle}`, status: 'active',
    street: r.vej, houseNumber: r.husnr, postalCode: POSTNR, city: 'Repby',
    addressRaw: `${r.vej} ${r.husnr}, ${POSTNR} Repby`,
    addressMatchLevel: 'access', accessAddressUuid: r.uuid,
    propertyType: 'lejlighed', sizeM2: 80, rooms: r.vaerelser,
    rentMonthly: 1200000, totalMonthly: r.total,
    totalMonthlyComponents: r.total != null ? ['heating'] : null,
    sourceCreatedAt: null,
  }).returning({ id: listings.id })
  for (let i = 0; i < r.billeder; i++) {
    await db.insert(listingImages).values({
      listingId: l!.id, externalUrl: `${VAERT}/${r.noegle}/${i}.jpg`, position: i,
    })
  }
  return l!.id
}

/** Hvilke annoncer overlever dubletbehandlingen — kildens slug pr. id. */
async function synlige(): Promise<Map<string, string>> {
  const r = await db.select({
    noegle: listings.externalKey, slug: sources.slug,
  }).from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(udenDubletter(hvor(F)))
  return new Map(r.map((x) => [x.noegle, x.slug]))
}

async function koer() {
  await ryd()
  const hId = await kilde(HOME), aId = await kilde(ANDEN)

  console.log(`\n══ Datagrundlag — SYNTETISK, isoleret base, postnr ${POSTNR} ══`)
  console.log(`  To par. Begge deler opgang, areal og husleje, saa kun`)
  console.log(`  vaerelsestallet staar mellem dem og et dubletmatch.`)
  console.log(`  Kun \`rooms\` aendres mellem FOER og EFTER — billeder,`)
  console.log(`  total og id er de samme raekker hele vejen.\n`)

  // PAR A — home har FLEST visbare billeder og VINDER rangeringen.
  //   Det er ikke et konstrueret saertilfaelde: home henter op til 19
  //   billeder fra detaljesiden, og begge dens vaerter er tilladte.
  await saet({ noegle: 'A-home', kildeId: hId, uuid: 'U-A', vej: 'Vindervej', husnr: '1',
    billeder: 5, total: null, vaerelser: null })
  await saet({ noegle: 'A-anden', kildeId: aId, uuid: 'U-A', vej: 'Vindervej', husnr: '1',
    billeder: 2, total: 1300000, vaerelser: DOK })

  // PAR B — home har FAERREST billeder og TABER rangeringen.
  await saet({ noegle: 'B-home', kildeId: hId, uuid: 'U-B', vej: 'Tabervej', husnr: '2',
    billeder: 1, total: null, vaerelser: null })
  await saet({ noegle: 'B-anden', kildeId: aId, uuid: 'U-B', vej: 'Tabervej', husnr: '2',
    billeder: 4, total: 1300000, vaerelser: DOK })

  const foer = await synlige()
  console.log(`══ FOER — home har rooms = null ══`)
  console.log(`  Noeglerne er 'access:U-x:80:?:120' mod 'access:U-x:80:2:120'.`)
  console.log(`  De er FORSKELLIGE, saa der er intet match: begge vises.`)
  for (const n of ['A-home', 'A-anden', 'B-home', 'B-anden'])
    console.log(`    ${n.padEnd(9)} ${foer.has(n) ? 'vist' : 'SKJULT'}`)
  const foerAntal = foer.size

  // Kun `rooms` aendres. Intet andet roeres.
  for (const n of ['A-home', 'B-home'])
    await db.update(listings).set({ rooms: DOK }).where(eq(listings.externalKey, n))

  const efter = await synlige()
  console.log(`\n══ EFTER — home oplyser 2 vaerelser ══`)
  console.log(`  Noeglerne er nu ENS i hvert par. TRIN 1 (match) siger:`)
  console.log(`  samme bolig. TRIN 2 (rangering) afgoer hvem der vises.`)
  for (const n of ['A-home', 'A-anden', 'B-home', 'B-anden'])
    console.log(`    ${n.padEnd(9)} ${efter.has(n) ? 'vist' : 'SKJULT'}`)

  console.log(`\n══ De to retninger ══`)
  const aVinder = efter.has('A-home') && !efter.has('A-anden')
  const bTaber = !efter.has('B-home') && efter.has('B-anden')
  console.log(`  PAR A · home 5 billeder mod 2 → home VINDER, den anden kildes`)
  console.log(`          annonce skjules:            ${aVinder ? 'JA' : 'NEJ — efterse'}`)
  console.log(`  PAR B · home 1 billede mod 4  → home TABER og skjules:`)
  console.log(`          ${' '.repeat(26)}${bTaber ? 'JA' : 'NEJ — efterse'}`)
  console.log(`\n  · Et match skjuler ALTID én af de to — men ikke altid home.`)
  console.log(`    Rangeringen er flest visbare billeder, saa kendt total, saa id;`)
  console.log(`    ingen af delene aendrer sig af et vaerelsestal.`)
  console.log(`  · Annoncer: 4 foer og efter. Synlige: ${foerAntal} → ${efter.size}.`)
  console.log(`    Boligerne er der stadig — den skjulte vises bag den andens kort.`)

  const ok = aVinder && bTaber && foerAntal === 4 && efter.size === 2
  await ryd()
  console.log(`\n  ${ok ? 'BEGGE RETNINGER EFTERPROEVET' : 'AFVIGELSE — se ovenfor'}`)
  if (!ok) process.exit(1)
}

await koer()
