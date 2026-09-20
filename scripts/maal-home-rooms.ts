// ═══════════════════════════════════════════════════════════════
//  Hvad kan Home-rettelsens `rooms` flytte i en rigtig bestand?
//
//  `scripts/cloud/home-vaerelser.ts` maaler MEKANISMERNE paa et
//  syntetisk saet og afviser per konstruktion enhver anden base end den
//  isolerede. Den siger derfor intet om antal. Den her fil er det
//  manglende led: en LAESENDE optaelling, der kan koere mod en rigtig
//  base og sige, hvor mange raekker der overhovedet staar i skudlinjen.
//
//  ── HVAD DEN KAN, OG HVAD DEN IKKE KAN ───────────────────────
//  Den kan IKKE forudsige udfaldet. Vi kender ikke de vaerelsestal,
//  kilden vil levere, og alle tre mekanismer afhaenger af, om tallene
//  STEMMER paa tvaers. Den taeller KANDIDATER: raekker, hvor et
//  vaerelsestal overhovedet kan aendre noget.
//
//  ⚠ TALLENE ER KANDIDATOPTAELLINGER, IKKE OEVRE GRAENSER.
//    En tidligere udgave kaldte dem oevre graenser. Det var forkert, og
//    fejlen er vaerd at holde fast i. `rooms` er en NOEGLEDEL i
//    gruppenoeglen (lib/soeg.ts:866) — ikke bare en betingelse. En
//    home-raekke, der ALLEREDE har et vaerelsestal og staar alene, bliver
//    trukket ind i et nyt gruppekort den dag en nabo faar det SAMME tal.
//    Den raekke er ikke kandidat til noget, og alligevel skifter dens
//    visning. Et tal, der kalder sig en oevre graense uden at vaere det,
//    er praecis den slags paastand, resten af projektet er bygget paa at
//    undgaa.
//
//  ── TO TRIN, IKKE ÉT ─────────────────────────────────────────
//    TRIN 1 · MATCH.  `DEDUPNOEGLE` afgoer, om to raekker er samme
//             bolig. Vaerelsestallet indgaar i access-grenen.
//    TRIN 2 · RANGERING. `ikkeRepraesentant` (lib/soeg.ts:231-238)
//             afgoer, HVEM af dem der vises:
//                 1. flest VISBARE billeder  2. kendt total  3. id
//             KILDEN INDGAAR IKKE. Home kan lige saa godt vinde som
//             tabe — den henter op til 19 billeder pr. bolig, og begge
//             dens billedvaerter er tilladte. Naar en noegle begynder at
//             kollidere, forsvinder ÉN af de to raekker — men ikke
//             noedvendigvis home-raekken.
//             Efterproevet i begge retninger:
//             `scripts/cloud/rooms-repraesentant.ts`.
//
//  ── REGLERNE SKRIVES IKKE AF ─────────────────────────────────
//  `hvor()` og `udenDubletter()` IMPORTERES fra lib/soeg.ts. En
//  tidligere udgave skrev dem af i raa SQL og kom til at maale noget
//  andet: gruppetaellingen manglede dedup (som koerer FOER grupperingen,
//  lib/soeg.ts:865), grundpraedikatet manglede
//  `address_match_level <> 'failed'`, og huslejen blev sammenlignet paa
//  to maader i samme fil. Svarer to udtryk paa det samme spoergsmaal,
//  skal de beregnes ét sted.
//
//  ── READ-ONLY OG ÉT SNAPSHOT — HAANDHAEVET ───────────────────
//  Alt koerer i ÉN transaktion med `accessMode: 'read only'` og
//  `isolationLevel: 'repeatable read'`. Det foerste goer read-only til
//  en mekanisme i stedet for et loefte i en kommentar; det andet giver
//  alle optaellinger det SAMME snapshot. Importen skriver i `listings`
//  hver time — og naar rettelsen er ude, skriver den netop `rooms` —
//  saa uden ét snapshot kan to tal, der udskrives som «heraf», stamme
//  fra hver sin bestand.
//
//      DATABASE_URL_DIRECT=… npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/maal-home-rooms.ts
// ═══════════════════════════════════════════════════════════════
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { db, luk } from '../db/client'
import { listings, savedSearches, sources } from '../db/schema'
import { hvor, udenDubletter } from '../lib/soeg'

const KILDE = process.env.HOME_SLUG ?? 'home'

/**
 * Hvem er vi FAKTISK forbundet til?
 *
 * En tidligere udgave laeste `DATABASE_URL_DIRECT` og skrev den ud. Det
 * er ikke det samme spoergsmaal: `forbindelse()` i db/client.ts vaelger
 * `DATABASE_URL`, naar `NEXT_RUNTIME` eller `VERCEL` er sat
 * (db/client.ts:32, 51-55), saa udskriften kunne navngive én base, mens
 * tallene kom fra en anden. Og et stagingtal, der staar under et
 * produktionsnavn, er vaerre end intet tal.
 *
 * Derfor spoerges SERVEREN — samme greb som `scripts/cloud/app-op.sh`.
 */
async function hvilkenBase(tx: Tx): Promise<string> {
  const svar = (await tx.execute(sql`select current_database() as d,
    coalesce(inet_server_addr()::text, 'loopback') as a,
    inet_server_port() as p,
    current_setting('transaction_read_only') as ro`)
  ) as unknown as { d: string; a: string; p: number; ro: string }[]
  const r = svar[0]
  return `${r?.d} paa ${r?.a}:${r?.p} · read_only=${r?.ro}`
}

/** Grundlaget er soegningens eget — ikke en afskrift. */
const SYNLIG = hvor({})
const VIST = udenDubletter(hvor({}))
const ER_HOME = eq(sources.slug, KILDE)

/** Access-grenens krav, ordret som DEDUPNOEGLE stiller dem. */
const ER_ACCESS = sql`${listings.addressMatchLevel} = 'access'
  and ${listings.accessAddressUuid} is not null
  and ${listings.houseNumber} is not null`

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const taelKilde = async (tx: Tx, hvorNoget: ReturnType<typeof and>) => {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` })
    .from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvorNoget)
  return Number(r?.n ?? 0)
}

async function koer() {
  await db.transaction(async (tx) => {
    // Navngivningen sker INDE i transaktionen, saa den beskriver praecis
    // den forbindelse, tallene kommer fra — ikke en miljoevariabel.
    console.log(`\n══ Datagrundlag ══`)
    console.log(`  base:        ${await hvilkenBase(tx)}`)
    console.log(`  kilde-slug:  ${KILDE}`)
    console.log(`  grundlag:    hvor({}) og udenDubletter() IMPORTERET fra lib/soeg.ts\n`)
    // ── 1 · Fordelingen af vaerelsestal, MAALT ────────────────
    // Det er en ANTAGELSE, at alle home-raekker har rooms = null.
    // Antagelsen bygger paa, at `listings.rooms` kun skrives fra
    // adapterens eget felt, og at home-adapteren foerst satte det i
    // 85c230a. Det er en slutning fra koden, ikke en maaling — saa her
    // maales fordelingen i ÉN saetning i stedet for at blive paastaaet.
    const [fordeling] = await tx.select({
      ialt: sql<number>`count(*)::int`,
      uden: sql<number>`count(*) filter (where ${listings.rooms} is null)::int`,
      med: sql<number>`count(*) filter (where ${listings.rooms} is not null)::int`,
    }).from(listings).innerJoin(sources, eq(sources.id, listings.sourceId))
      .where(and(SYNLIG, ER_HOME))
    const ialt = Number(fordeling?.ialt ?? 0)
    const uden = Number(fordeling?.uden ?? 0)
    const med = Number(fordeling?.med ?? 0)

    console.log(`══ 1 · Fordeling af vaerelsestal i dag (MAALT, ikke antaget) ══`)
    console.log(`  synlige ${KILDE}-annoncer:        ${ialt}`)
    console.log(`    uden vaerelsestal:            ${uden}`)
    console.log(`    MED vaerelsestal:             ${med}`)
    if (med > 0) {
      console.log(`  ⚠ ${med} raekker har ALLEREDE et vaerelsestal. Antagelsen om, at`)
      console.log(`    feltet er tomt overalt, holder altsaa ikke — og de raekker kan`)
      console.log(`    traekkes ind i nye grupper, uden at vaere kandidat til noget.`)
    }
    console.log(`  · «Synlige» er hvor({}): status aktiv og adressematch ikke 'failed'.`)
    console.log(`  · Hvor mange af de ${uden} der FAAR et tal, afhaenger af kilden.`)
    console.log(`    Begge kildeproever (15. sep. 2026) har stats.rooms — begge med`)
    console.log(`    vaerdien 2. To sager dokumenterer feltets tilstedevaerelse,`)
    console.log(`    ikke nogen spredning.\n`)

    // ── 2 · Gruppekort ───────────────────────────────────────
    // Dedup koerer FOER grupperingen (lib/soeg.ts:865 filtrerer paa
    // hvorVist = udenDubletter(hvor(f))), saa en raekke, der i dag taber
    // repraesentantvalget, kan aldrig blive medlem af en gruppe.
    // Gruppenoeglen er (slug, postnr, vej, rooms, landlord, TOTALKENDT).
    const grKand = await taelKilde(tx, and(VIST, ER_HOME,
      isNull(listings.rooms),
      isNotNull(listings.street), isNotNull(listings.postalCode),
      sql`coalesce(${listings.totalMonthly}, ${listings.rentMonthly}) is not null`))

    // Faellesskabet maa omfatte BAADE raekker uden vaerelsestal og dem,
    // der allerede har et: en enlig kandidat kan danne gruppe med en
    // nabo, der har tallet i forvejen.
    const [faelles] = await tx.execute(sql`
      select coalesce(sum(kand), 0)::int as n from (
        select count(*) filter (where ${listings.rooms} is null)::int as kand
        from ${listings}
        inner join ${sources} on ${sources.id} = ${listings.sourceId}
        where ${VIST} and ${ER_HOME}
          and ${listings.street} is not null and ${listings.postalCode} is not null
          and coalesce(${listings.totalMonthly}, ${listings.rentMonthly}) is not null
        group by ${sources.slug}, ${listings.postalCode}, ${listings.street},
                 ${listings.landlordId}, (${listings.totalMonthly} is not null)
        having count(*) > 1) t`) as unknown as { n: number }[]
    const grFaelles = Number((faelles as { n?: number })?.n ?? 0)

    console.log(`══ 2 · Gruppekort — KANDIDATOPTAELLING ══`)
    console.log(`  uden vaerelsestal, alt andet opfyldt:   ${grKand}`)
    console.log(`  heraf paa en noegle med mindst én anden: ${grFaelles}`)
    console.log(`  · Taellingen gaar gennem udenDubletter(): en raekke, der i dag`)
    console.log(`    taber repraesentantvalget, kan ikke blive gruppemedlem.`)
    console.log(`  · IKKE en oevre graense. \`rooms\` er en NOEGLEDEL: en home-raekke,`)
    console.log(`    der allerede HAR et tal og staar alene, traekkes ind i en ny`)
    console.log(`    gruppe, hvis en nabo faar det samme tal. Den er ikke talt her.`)
    console.log(`  · Faerre KORT, samme antal BOLIGER — et gruppekort daekker dem,`)
    console.log(`    det taler for.\n`)

    // ── 3 · Access-dedup, de to retninger holdt ADSKILT ───────
    // a) Modparten HAR et tal: noeglerne er forskellige i dag ('?' mod
    //    tallet). Faar home samme tal, opstaar et NYT match.
    const nytMatch = await taelKilde(tx, and(SYNLIG, ER_HOME, ER_ACCESS,
      isNull(listings.rooms),
      sql`exists (
        select 1 from ${listings} a
        inner join ${sources} sa on sa.id = a.source_id
        where sa.slug <> ${KILDE}
          and a.status = 'active' and a.address_match_level <> 'failed'
          and a.address_match_level = 'access' and a.house_number is not null
          and a.access_address_uuid = ${listings.accessAddressUuid}
          and a.rooms is not null
          and a.size_m2 is not distinct from ${listings.sizeM2}
          and round(a.rent_monthly / 10000.0)
              is not distinct from round(${listings.rentMonthly} / 10000.0))`))

    // b) Modparten har INTET tal: de deler noeglen ALLEREDE ('?' = '?')
    //    og er dedupet i dag. Faar home et tal, SPLITTES de.
    const splittes = await taelKilde(tx, and(SYNLIG, ER_HOME, ER_ACCESS,
      isNull(listings.rooms),
      sql`exists (
        select 1 from ${listings} a
        inner join ${sources} sa on sa.id = a.source_id
        where a.id <> ${listings.id}
          and a.status = 'active' and a.address_match_level <> 'failed'
          and a.address_match_level = 'access' and a.house_number is not null
          and a.access_address_uuid = ${listings.accessAddressUuid}
          and a.rooms is null
          and a.size_m2 is not distinct from ${listings.sizeM2}
          and round(a.rent_monthly / 10000.0)
              is not distinct from round(${listings.rentMonthly} / 10000.0))`))

    console.log(`══ 3 · Dedup paa access-noeglen — KANDIDATOPTAELLINGER ══`)
    console.log(`  ENHEDEN ER ${KILDE}-RAEKKER, IKKE PAR. Begge tal er`)
    console.log(`  \`count(*)\` over raekker med mindst én modpart (\`exists\`), saa en`)
    console.log(`  raekke med TO modparter taeller ÉN gang. De er hverken et antal`)
    console.log(`  par, et antal skjulte annoncer eller et antal boliger.\n`)
    console.log(`  a) ${KILDE}-raekker der kan faa et NYT match:  ${nytMatch}`)
    console.log(`     · deler opgang, areal og husleje med mindst én anden kildes`)
    console.log(`       annonce, som HAR et vaerelsestal. Stemmer tallene, bliver de`)
    console.log(`       dubletter.`)
    console.log(`     · SAA forsvinder ÉN af hvert par — og rangeringen afgoer hvem.`)
    console.log(`       Kilden indgaar ikke i valget, saa det kan vaere modparten,`)
    console.log(`       der skjules. Tallet siger intet om retningen.`)
    console.log(`  b) ${KILDE}-raekker i et match der kan SPLITTES: ${splittes}`)
    console.log(`     · deler noeglen i dag, fordi begge er '?'. Faar de forskellige`)
    console.log(`       tal — eller faar den ene et og den anden ikke — skilles de ad.`)
    console.log(`     · Tallet er IKKE antallet af boliger, der kommer frem. Hvor`)
    console.log(`       mange der bliver synlige, afhaenger af, hvor mange raekker`)
    console.log(`       hver noegle samler, og hvem der er repraesentant i dag.`)
    console.log(`  · De to traekker hver sin vej. Et uaendret nettotal kan daekke`)
    console.log(`    over, at det ikke er de samme boliger, der vises.\n`)

    // ── 4 · Unit-noeglen ─────────────────────────────────────
    const unit = await taelKilde(tx, and(SYNLIG, ER_HOME,
      eq(listings.addressMatchLevel, 'unit'), isNotNull(listings.unitAddressUuid)))
    console.log(`══ 4 · Praecist boligmatch (unit) ══`)
    console.log(`  ${KILDE}-annoncer paa unit-niveau:      ${unit}`)
    console.log(`  · Noeglen er 'unit:<uuid>' og intet andet, saa ingen af dem kan`)
    console.log(`    skifte DEDUP-plads.`)
    console.log(`  · Men de kan godt skifte KORTTYPE: KAN_GRUPPERES spoerger ikke om`)
    console.log(`    adressematch-niveau, saa en unit-raekke med vej, postnummer og`)
    console.log(`    pris taelles ogsaa i afsnit 2. De to afsnit overlapper.\n`)

    // ── 5 · Overlap ──────────────────────────────────────────
    console.log(`══ 5 · Overlap — tallene maa IKKE laegges sammen ══`)
    console.log(`  Den samme raekke kan vaere baade gruppekandidat og dublet-`)
    console.log(`  kandidat, og en unit-raekke taelles i baade afsnit 2 og 4.`)
    console.log(`  Mekanismerne er desuden SEKVENTIELLE: dedup koerer foer`)
    console.log(`  gruppering, saa en raekke, der bliver skjult, falder ud af sin`)
    console.log(`  gruppe og aendrer gruppens antal, prisspaend og arealspaend.\n`)

    // ── 6 · Virkningen uden for visningen: ALARMEN ───────────
    // Den eneste virkning, der ikke kan kaldes tilbage.
    // Kolonne og noegle kommer fra SKEMAET, ikke fra en afskrift:
    // kolonnen hedder `criteria`, og kriterierne gemmes som `Filtre`,
    // hvis vaerelsesfelt hedder `vaerelserMin` (lib/soeg.ts:27).
    const [alarm] = await tx.select({ n: sql<number>`count(*)::int` })
      .from(savedSearches)
      .where(and(
        isNotNull(savedSearches.confirmedAt),
        isNull(savedSearches.unsubscribedAt),
        sql`${savedSearches.criteria} ->> 'vaerelserMin' is not null`))
    const medVaerelseskrav = Number(alarm?.n ?? 0)
    console.log(`══ 6 · Uden for visningen: BOLIGALARMEN ══`)
    console.log(`  bekraeftede gemte soegninger med vaerelseskrav: ${medVaerelseskrav}`)
    console.log(`  · DET ER ET ANTAL SOEGNINGER — ikke et antal beroerte soegninger,`)
    console.log(`    og slet ikke et antal mails. Ingen af delene er maalt her.`)
    console.log(`  · \`matchAlarmer\` bruger hvor() (lib/alarm.ts:95), og hvor() har`)
    console.log(`    \`gte(listings.rooms, f.vaerelserMin)\` (lib/soeg.ts:137). En`)
    console.log(`    ${KILDE}-raekke uden vaerelsestal kan i dag ALDRIG opfylde det led.`)
    console.log(`    Faar den et tal, kan den — men det AABNER kun ÉT led af mange.`)
    console.log(`  · Et traef kraever ogsaa: at boligen er NY efter soegningens egne`)
    console.log(`    regler (first_seen_at, kildens dato og indkoeringsvagten pr.`)
    console.log(`    kilde), at ALLE soegningens oevrige kriterier passer, og at`)
    console.log(`    afsendelsesbetingelserne holder. Intet af det er opgjort her.`)
    console.log(`  · Det er naevnt, fordi det er den eneste virkning uden for`)
    console.log(`    visningen: scripts/import.ts matcher OG SENDER i samme koersel,`)
    console.log(`    og en mail kan ikke kaldes tilbage. En egentlig opgoerelse`)
    console.log(`    kraever sin egen maaling.\n`)

    // ── 7 · Eksempler ────────────────────────────────────────
    // `distinct on (l.id)` — ellers er en raekke med to modparter to
    // linjer. Native udelades: modparten ville vaere en udlejerannonce,
    // og de to deler per konstruktion opgangsadresse, saa den printede
    // adresse ville ogsaa vaere hendes.
    const eks = await tx.execute(sql`
      select distinct on (${listings.id})
        ${listings.street} as vej, ${listings.houseNumber} as husnr,
        ${listings.postalCode} as postnr, ${listings.sizeM2} as areal,
        sa.slug as modpart, a.rooms as modpart_vaerelser
      from ${listings}
      inner join ${sources} on ${sources.id} = ${listings.sourceId}
      inner join ${listings} a on a.access_address_uuid = ${listings.accessAddressUuid}
        and a.address_match_level = 'access' and a.house_number is not null
        and a.status = 'active' and a.address_match_level <> 'failed'
        and a.size_m2 is not distinct from ${listings.sizeM2}
        and round(a.rent_monthly / 10000.0)
            is not distinct from round(${listings.rentMonthly} / 10000.0)
      inner join ${sources} sa on sa.id = a.source_id
        and sa.slug <> ${KILDE} and sa.slug <> 'native'
      where ${SYNLIG} and ${ER_HOME} and ${ER_ACCESS} and ${listings.rooms} is null
      limit 10`) as unknown as Record<string, unknown>[]
    const raekker = (eks as { rows?: Record<string, unknown>[] }).rows ?? eks
    console.log(`══ 7 · Eksempler paa beroerte par (hoejst 10, native udeladt) ══`)
    if (!raekker.length) console.log(`  (ingen)`)
    for (const r of raekker) {
      console.log(`  ${String(r.vej)} ${String(r.husnr)}, ${String(r.postnr)}`
        + ` · ${String(r.areal)} m² · modpart ${String(r.modpart)}`
        + ` med ${r.modpart_vaerelser ?? 'intet'} vaer.`)
    }
    console.log(`  · Modpart MED et tal → nyt match kan opstaa (afsnit 3a).`)
    console.log(`    Modpart UDEN → de er dubletter i dag og kan splittes (3b).\n`)

    console.log(`══ Hvad tallene IKKE siger ══`)
    console.log(`  Ingen af dem er en oevre graense for «boliger der skifter plads».`)
    console.log(`  Den faktiske virkning kan foerst maales som FOER/EFTER paa de`)
    console.log(`  SAMME raekker, naar importen har koert med den nye kode — og en`)
    console.log(`  almindelig import aendrer ogsaa priser, status og billeder, saa`)
    console.log(`  en isoleret maaling skal holde alt andet fast.\n`)
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

await koer()
await luk()
