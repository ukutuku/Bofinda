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
//                  3. LAVESTE kendte total     (asc, nulls last)
//                  4. id                       (stabilt led)
//
//              Trin 3 kom til efter denne fil blev skrevet. Den stod
//              med tre trin og var dermed en beskrivelse af en regel,
//              der ikke laengere fandtes. Vaerelsestallet indgaar
//              fortsat IKKE i nogen af de fire.
//
//  Trin 1 siger «de er den samme bolig». Trin 2 siger «og det er DEN
//  her, vi viser». Rettelsen kan kun paavirke trin 1. Hvem der taber,
//  afgoeres af kriterier, der ikke aendrer sig af et vaerelsestal — og
//  home kan ligesaa godt VINDE som tabe.
//
//  Det er ikke teoretisk: home henter op til 19 billeder pr. bolig fra
//  detaljesiden, og BEGGE dens billedvaerter (`alvis.b-cdn.net` og
//  `home.mindworking.eu`) staar i `TILLADTE_VAERTER`. Billederne
//  taeller derfor fuldt med i rangeringen.
//
//  Filen proever BEGGE retninger paa det samme grundlag.
//
//  ── SPAERRINGEN SPOERGER BASEN, IKKE MILJOEET ────────────────
//  En tidligere udgave laeste `DATABASE_URL_DIRECT || DATABASE_URL` og
//  godkendte den lokale streng. Men `forbindelse()` i db/client.ts
//  vaelger `DATABASE_URL`, naar `NEXT_RUNTIME` eller `VERCEL` er sat
//  (db/client.ts:32, 51-55) — saa vagten kunne godkende den ene URL,
//  mens SKRIVNINGERNE gik til den anden. Filen her skriver, saa det er
//  ikke en teoretisk fejl.
//
//  Nu goeres to ting FOER foerste skrivning, i den raekkefoelge:
//    1. `NEXT_RUNTIME`/`VERCEL` afvises, saa klientens valg er entydigt.
//    2. Basen SPOERGES, hvem den er — `current_database()`,
//       `inet_server_addr()`, `inet_server_port()` — praecis som
//       `scripts/cloud/app-op.sh` goer det. En URL kan pege paa det
//       rigtige og alligevel ramme noget andet.
//
//  ── PROEVEN ROERER KUN SINE EGNE RAEKKER ─────────────────────
//  Kilderne faar en slug med et unikt suffiks pr. koersel, og der
//  slettes ALDRIG paa et fast slug-navn foerst: en tidligere udgave
//  ryddede `rep-home`/`rep-anden` indledningsvis og kunne dermed have
//  taget rigtige raekker, hvis nogen havde oprettet en kilde med det
//  navn. Opdateringen rammer de INDSATTE id'er — ikke `externalKey`,
//  som kun er unik sammen med `sourceId`. En fremmed raekke med samme
//  `externalKey` saaes med vilje og efterproeves uaendret til sidst.
//  Oprydning og lukning sker i `finally`, ogsaa naar noget fejler.
//
//  ⚠ SYNTETISK OG ISOLERET. Datasaettet er opdigtet og siger intet om,
//    hvor ofte hver retning forekommer i produktionen.
//
//      scripts/cloud/db-op.sh && \
//      DATABASE_URL_DIRECT=… npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/cloud/rooms-repraesentant.ts
// ═══════════════════════════════════════════════════════════════
import { eq, inArray, sql } from 'drizzle-orm'
import { db, luk } from '../../db/client'
import { listingImages, listings, sources } from '../../db/schema'
import { hvor, udenDubletter, type Filtre } from '../../lib/soeg'

// ── Spaerring, trin 1: klientens valg skal vaere entydigt ──────
// `forbindelse()` skifter til DATABASE_URL, naar en af de to er sat.
// Saa ville vi validere én streng og skrive gennem en anden.
if (process.env.NEXT_RUNTIME || process.env.VERCEL) {
  console.error('FEJL: NEXT_RUNTIME/VERCEL er sat. db/client.ts ville da vaelge')
  console.error('      DATABASE_URL, og spaerringen kan ikke vide hvilken base')
  console.error('      skrivningerne rammer. Koer uden dem.')
  process.exit(1)
}

const POSTNR = '9901'
const F: Filtre = { postnr: POSTNR }
/** Unikt pr. koersel: proeven maa aldrig kunne rydde en fremmed kildes raekker. */
const STEMPEL = `${Date.now().toString(36)}`
const HOME = `rep-home-${STEMPEL}`
const ANDEN = `rep-anden-${STEMPEL}`
const FREMMED = `rep-fremmed-${STEMPEL}`
/** Dokumenteret i begge kildeproever (15. sep. 2026). */
const DOK = 2
/** En vaert fra TILLADTE_VAERTER, saa billedet taeller i rangeringen. */
const VAERT = 'https://alvis.b-cdn.net'

/**
 * De adresser, en isoleret testforbindelse maa komme fra.
 *
 * NULL fra `inet_server_addr()` betyder unix-domaene-socket. Den er per
 * definition lokal og kan ikke naa en fremmed vaert, saa den godkendes
 * som 'loopback'.
 */
const LOKALE_ADRESSER = new Set(['loopback', '127.0.0.1', '::1'])

/**
 * `127.0.0.1/32` → `127.0.0.1`.
 *
 * `inet_server_addr()` er af typen `inet` og baerer praefikslaengden med,
 * naar den castes til text. Masken hoerer til typen, ikke til vaerten.
 */
export const udenPraefiks = (a: string) => a.split('/')[0] ?? a

/**
 * Efterproever databasenavn, port OG vaert paa den faktiske forbindelse.
 *
 * Adressen blev i en tidligere udgave kun UDSKREVET. Saa kunne en base
 * med det rigtige navn og den rigtige port paa en FREMMED vaert slippe
 * igennem — og proeven her SKRIVER. Udskilt fra kaldet nedenfor, saa
 * den kan proeves med simulerede vaerdier: der findes ingen fremmed
 * base at forbinde til. Se `rooms-adressevagt.ts`.
 */
export function erIsoleret(d: string, a: string, p: number) {
  return d === 'bofinda_test' && p === 55432 && LOKALE_ADRESSER.has(udenPraefiks(a))
}

/**
 * Spaerring, trin 2: spoerg basen, hvem den er. Samme greb som
 * `scripts/cloud/app-op.sh` — en URL kan pege paa det rigtige og
 * alligevel ramme noget andet. Kaldes FOER foerste indsaettelse.
 */
async function kraevIsoleretForbindelse() {
  const [r] = await db.execute(sql`select current_database() as d,
    coalesce(inet_server_addr()::text, 'loopback') as a,
    inet_server_port() as p`) as unknown as { d: string; a: string; p: number }[]
  const d = String(r?.d ?? ''), a = String(r?.a ?? ''), p = Number(r?.p ?? 0)
  if (!erIsoleret(d, a, p)) {
    console.error(`FEJL: forbundet til ${d} paa ${a}:${p} — ikke den isolerede testbase.`)
    console.error('      Kravet er databasen bofinda_test, porten 55432 OG en lokal')
    console.error('      adresse (loopback, 127.0.0.1 eller ::1). Proeven SKRIVER.')
    await luk()
    process.exit(1)
  }
  console.log(`  forbindelse efterproevet: ${d} paa ${a}:${p} (vaert, navn og port)`)
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

/** Indsaetter og returnerer raekkens id. Alt oprydning sker paa id. */
async function saet(r: Raekke, spor: string[]): Promise<string> {
  const [l] = await db.insert(listings).values({
    sourceId: r.kildeId, sourceType: 'spider', externalKey: r.noegle,
    sourceUrl: `http://127.0.0.1/rep/${r.noegle}`, status: 'active',
    street: r.vej, houseNumber: r.husnr, postalCode: POSTNR, city: 'Repby',
    addressRaw: `${r.vej} ${r.husnr}, ${POSTNR} Repby`,
    addressMatchLevel: 'access', accessAddressUuid: r.uuid,
    propertyType: 'lejlighed', sizeM2: 80, rooms: r.vaerelser,
    rentMonthly: 1200000, totalMonthly: r.total,
    totalMonthlyComponents: r.total != null ? ['heat'] : null,
    sourceCreatedAt: null,
  }).returning({ id: listings.id })
  spor.push(l!.id)
  for (let i = 0; i < r.billeder; i++) {
    await db.insert(listingImages).values({
      listingId: l!.id, externalUrl: `${VAERT}/${r.noegle}/${i}.jpg`, position: i,
    })
  }
  return l!.id
}

/** Hvilke af proevens egne raekker overlever dubletbehandlingen. */
async function synlige(ider: string[]): Promise<Set<string>> {
  if (!ider.length) return new Set()
  const r = await db.select({ noegle: listings.externalKey })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(sql`${udenDubletter(hvor(F))} and ${listings.id} in ${ider}`)
  return new Set(r.map((x) => x.noegle))
}

async function koer() {
  const spor: string[] = []
  const kilder: string[] = []
  let fejl = 0
  try {
    await kraevIsoleretForbindelse()

    const kilde = async (slug: string) => {
      const [r] = await db.insert(sources).values({
        slug, name: slug, sourceType: 'spider', baseUrl: 'http://127.0.0.1/rep',
      }).returning({ id: sources.id })
      kilder.push(r!.id)
      return r!.id
    }
    const hId = await kilde(HOME), aId = await kilde(ANDEN), fId = await kilde(FREMMED)

    console.log(`\n══ Datagrundlag — SYNTETISK, isoleret base, postnr ${POSTNR} ══`)
    console.log(`  To par. Begge deler opgang, areal og husleje, saa kun`)
    console.log(`  vaerelsestallet staar mellem dem og et dubletmatch.`)
    console.log(`  Kun \`rooms\` aendres mellem FOER og EFTER — billeder,`)
    console.log(`  total og id er de samme raekker hele vejen.\n`)

    // PAR A — home har FLEST visbare billeder og VINDER rangeringen.
    const aHome = await saet({ noegle: 'A-home', kildeId: hId, uuid: 'U-A',
      vej: 'Vindervej', husnr: '1', billeder: 5, total: null, vaerelser: null }, spor)
    await saet({ noegle: 'A-anden', kildeId: aId, uuid: 'U-A', vej: 'Vindervej',
      husnr: '1', billeder: 2, total: 1300000, vaerelser: DOK }, spor)

    // PAR B — home har FAERREST billeder og TABER rangeringen.
    const bHome = await saet({ noegle: 'B-home', kildeId: hId, uuid: 'U-B',
      vej: 'Tabervej', husnr: '2', billeder: 1, total: null, vaerelser: null }, spor)
    await saet({ noegle: 'B-anden', kildeId: aId, uuid: 'U-B', vej: 'Tabervej',
      husnr: '2', billeder: 4, total: 1300000, vaerelser: DOK }, spor)

    // FREMMED raekke med SAMME externalKey som par A's home-raekke, men
    // en anden kilde. `externalKey` er kun unik sammen med `sourceId`, saa
    // en opdatering paa noeglen alene ville ramme den her. Den ligger i et
    // andet postnummer, saa den ikke blander sig i maalingen.
    const fremmedId = (await db.insert(listings).values({
      sourceId: fId, sourceType: 'spider', externalKey: 'A-home',
      sourceUrl: 'http://127.0.0.1/rep/fremmed', status: 'active',
      street: 'Fremmedvej', houseNumber: '9', postalCode: '9999', city: 'Andenby',
      addressRaw: 'Fremmedvej 9, 9999 Andenby', addressMatchLevel: 'access',
      accessAddressUuid: 'U-FREMMED', propertyType: 'lejlighed', sizeM2: 55,
      rooms: 9, rentMonthly: 700000, sourceCreatedAt: null,
    }).returning({ id: listings.id }))[0]!.id
    spor.push(fremmedId)

    const maalte = [aHome, bHome, spor[1]!, spor[3]!]
    const ALLE = ['A-home', 'A-anden', 'B-home', 'B-anden'] as const
    const foer = await synlige(maalte)
    console.log(`══ FOER — home har rooms = null ══`)
    console.log(`  Noeglerne er 'access:U-x:80:?:120' mod 'access:U-x:80:2:120'.`)
    console.log(`  De er FORSKELLIGE, saa der er intet match: begge vises.`)
    for (const n of ALLE)
      console.log(`    ${n.padEnd(9)} ${foer.has(n) ? 'vist' : 'SKJULT'}`)

    // BINDENDE. Uden den her maaler proeven ingenting: var parrene
    // allerede dedupet FOER opdateringen — fordi noeglen var ens af en
    // anden grund, eller fordi en fixture var skrevet forkert — ville
    // EFTER-tilstanden se rigtig ud, uden at vaerelsestallet havde
    // gjort noget som helst. Praemissen skal derfor fejle hoejt.
    const manglerFoer = ALLE.filter((n) => !foer.has(n))
    const praemisOk = manglerFoer.length === 0 && foer.size === 4
    console.log(`  praemis: alle fire synlige FOER opdateringen: ${praemisOk ? 'JA' : 'NEJ'}`)
    if (!praemisOk) {
      console.log(`  ✗ ${manglerFoer.join(', ') || '(antal: ' + foer.size + ')'} var`)
      console.log(`    allerede skjult. Parrene er dedupet af en anden grund end`)
      console.log(`    vaerelsestallet, saa proeven maaler ikke det, den paastaar.`)
      fejl++
    }

    // Kun `rooms`, og kun paa de INDSATTE id'er. Ikke paa externalKey:
    // feltet er kun unikt sammen med sourceId.
    await db.update(listings).set({ rooms: DOK })
      .where(inArray(listings.id, [aHome, bHome]))

    const efter = await synlige(maalte)
    console.log(`\n══ EFTER — home oplyser 2 vaerelser ══`)
    console.log(`  Noeglerne er nu ENS i hvert par. TRIN 1 (match) siger:`)
    console.log(`  samme bolig. TRIN 2 (rangering) afgoer hvem der vises.`)
    for (const n of ALLE)
      console.log(`    ${n.padEnd(9)} ${efter.has(n) ? 'vist' : 'SKJULT'}`)

    // BINDENDE. PRAECIS de to forventede repraesentanter — hverken
    // flere eller faerre. En proeve, der kun spurgte «er A-home vist?»,
    // ville bestaa, hvis ingen blev skjult overhovedet.
    const VENTET = ['A-home', 'B-anden']
    const setEfter = [...efter].sort().join(',')
    const ventet = [...VENTET].sort().join(',')
    const efterOk = setEfter === ventet
    console.log(`  praecis de ventede repraesentanter EFTER: ${efterOk ? 'JA' : 'NEJ'}`)
    if (!efterOk) {
      console.log(`  ✗ ventet [${ventet}] · faktisk [${setEfter || '(ingen)'}]`)
      fejl++
    }

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
    if (!aVinder) fejl++
    if (!bTaber) fejl++

    // ── Den fremmede raekke skal vaere UROERT ──────────────────
    const [fremmed] = await db.select({
      rooms: listings.rooms, vej: listings.street, postnr: listings.postalCode,
    }).from(listings).where(eq(listings.id, fremmedId))
    const uroert = fremmed?.rooms === 9 && fremmed?.vej === 'Fremmedvej'
      && fremmed?.postnr === '9999'
    console.log(`\n══ Fremmed raekke med SAMME externalKey ('A-home') ══`)
    console.log(`  uroert efter opdateringen: ${uroert ? 'JA' : 'NEJ — PROEVEN SKREV I FREMMEDE DATA'}`)
    console.log(`    rooms ${fremmed?.rooms} (forventet 9) · ${fremmed?.vej} ${fremmed?.postnr}`)
    console.log(`  · Havde opdateringen filtreret paa externalKey alene, var den`)
    console.log(`    her raekke blevet aendret. Den rammer id'erne i stedet.`)
    if (!uroert) fejl++

    console.log(fejl === 0
      ? `\n  BEGGE RETNINGER EFTERPROEVET · FREMMED RAEKKE UROERT\n`
      : `\n  ${fejl} AFVIGELSER — se ovenfor\n`)
  } finally {
    // Oprydning paa ID, ogsaa naar noget fejlede undervejs. Aldrig paa et
    // fast slug-navn: proeven maa ikke kunne rydde en fremmed kildes data.
    if (spor.length) {
      await db.delete(listingImages).where(inArray(listingImages.listingId, spor))
      await db.delete(listings).where(inArray(listings.id, spor))
    }
    if (kilder.length) await db.delete(sources).where(inArray(sources.id, kilder))
    await luk()
  }
  if (fejl) process.exit(1)
}

// Samme moenster som `home-felter.ts` og `testbase.ts`: kroppen koerer kun,
// naar filen er startlinjen. Ellers kunne en proeve ikke importere
// `erIsoleret` uden at rejse en testbase og skrive i den.
if (process.argv[1]?.endsWith('rooms-repraesentant.ts')) {
  await koer()
}
