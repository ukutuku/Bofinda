// ═══════════════════════════════════════════════════════════════
//  Soegningen. Ét sted, saa baade siden og et senere API spoerger ens.
//
//  Kontaktfelter hentes IKKE. Ikke fordi der staar noget i dem paa
//  importerede boliger, men fordi den dag muren kommer, skal den staa i
//  query'en — ikke i skabelonen.
// ═══════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { listingImages, listings, sources } from '../db/schema'

export interface Filtre {
  by?: string
  postnr?: string
  prisMin?: number      // oere
  prisMax?: number
  vaerelserMin?: number
  arealMin?: number
  kilder?: string[]
  fuldOekonomi?: boolean
  /** Normaliserede boligtyper. Typen kommer fra enum'en i skemaet, så
   *  filteret og kolonnen ikke kan komme fra hinanden. */
  boligtyper?: Boligtype[]
  kaeledyr?: boolean
  elevator?: boolean
  /** Altan ELLER terrasse. To ord for den samme slags plads udenfor. */
  udeplads?: boolean
  sorter?: Sortering
}

export type Boligtype = (typeof listings.propertyType.enumValues)[number]
export const BOLIGTYPER = listings.propertyType.enumValues

export const SORTERINGER = [
  'nyeste', 'pris_op', 'pris_ned', 'areal_ned', 'indflytning_op', 'indflytning_ned',
] as const
export type Sortering = (typeof SORTERINGER)[number]

/**
 * Faciliteter er en POSITIV liste. Står 'elevator' ikke der, betyder det
 * "ikke oplyst" — ikke "ingen elevator". Et filter på dem skjuler derfor
 * boliger, hvis kilde bare ikke fortæller det, og det SKAL stå på skærmen,
 * når filteret er slået til. Se noten på søgesiden.
 */
const FACILITET = {
  kaeledyr: ['kæledyr tilladt'],
  elevator: ['elevator'],
  udeplads: ['altan', 'terrasse'],
} as const

const harFacilitet = (navne: readonly string[]) =>
  sql`jsonb_exists_any(coalesce(${listings.amenities}, '[]'::jsonb),
    array[${sql.join(navne.map((n) => sql`${n}`), sql`, `)}]::text[])`

/**
 * Fuld oekonomi: huslejen og mindst én NAVNGIVEN aconto-post.
 *
 * Ikke det samme som "total kendt". En kilde, der kun skriver
 * "Aconto pr. md.: 900 kr.", giver os en rigtig total — den staar paa
 * kortet som "i alt" — men ikke hvad acontoen daekker. At kalde det "hele
 * oekonomien oplyst" ville vaere en paastand om noget, vi ikke har faaet.
 *
 * SKAL vaere samme regel som erFuldOekonomi i normalize.ts. To
 * definitioner ville betyde, at filteret og importen var uenige om, hvad
 * loeftet paa forsiden daekker.
 */
const FULD = sql`(${listings.totalMonthly} is not null
  and ${listings.totalMonthlyComponents} && array['heat','water','electricity']::text[])`

/**
 * Prisen der filtreres, sorteres og opsummeres på.
 *
 * Den reelle månedlige udgift, når vi kender den — ellers huslejen. Det er
 * det tal, brugeren SER som overskrift på kortet, og dermed det, hun mener,
 * når hun skriver "under 18.000". Filtrerede vi på huslejen alene, ville en
 * bolig til 17.200 i husleje og 18.100 i alt slippe gennem et 18.000-filter
 * og se dyrere ud end bestilt.
 *
 * Boliger uden kendt total falder tilbage på huslejen. De er dermed
 * potentielt dyrere end filteret siger, og skal mærkes som sådan der, hvor
 * de vises — se alarmen.
 */
const PRIS = sql`coalesce(${listings.totalMonthly}, ${listings.rentMonthly})`

/**
 * Filterprædikatet. Eksporteret, fordi alarmen SKAL matche præcis som
 * søgesiden filtrerer. To implementeringer ville betyde, at beskeden
 * rammer noget andet, end brugeren så, da hun oprettede søgningen — og
 * det ville hverken kunne ses eller fejles på.
 */
export function hvor(f: Filtre) {
  const d = [
    eq(listings.status, 'active'),
    // En bolig uden adressematch ved vi ikke hvor ligger. Den vises ikke.
    ne(listings.addressMatchLevel, 'failed'),
  ]
  if (f.by) d.push(ilike(listings.city, `%${f.by}%`))
  if (f.postnr) d.push(eq(listings.postalCode, f.postnr))
  if (f.prisMin != null) d.push(sql`${PRIS} >= ${f.prisMin}`)
  if (f.prisMax != null) d.push(sql`${PRIS} <= ${f.prisMax}`)
  if (f.vaerelserMin != null) d.push(gte(listings.rooms, f.vaerelserMin))
  if (f.arealMin != null) d.push(gte(listings.sizeM2, f.arealMin))
  if (f.kilder?.length) d.push(inArray(sources.slug, f.kilder))
  if (f.fuldOekonomi) d.push(FULD)
  if (f.boligtyper?.length) d.push(inArray(listings.propertyType, f.boligtyper))
  if (f.kaeledyr) d.push(harFacilitet(FACILITET.kaeledyr))
  if (f.elevator) d.push(harFacilitet(FACILITET.elevator))
  if (f.udeplads) d.push(harFacilitet(FACILITET.udeplads))
  return and(...d)
}

const ORDEN = {
  nyeste: desc(listings.firstSeenAt),
  // Sorteres på samme tal som der filtreres på — ellers ville "billigst
  // først" og "under 18.000" pege på to forskellige priser.
  pris_op: sql`${PRIS} asc nulls last`,
  pris_ned: sql`${PRIS} desc nulls last`,
  areal_ned: desc(listings.sizeM2),
  // `nulls last` skal skrives ud ved desc: Postgres sætter ellers null
  // øverst, og en bolig uden oplyst indflytningspris ville stå som den
  // dyreste. Ved asc er det allerede standard, men det står der, så de to
  // linjer kan læses uden at kende reglen.
  indflytning_op: sql`${listings.moveInCost} asc nulls last`,
  indflytning_ned: sql`${listings.moveInCost} desc nulls last`,
}

/** Felterne et boligkort bruger. Delt, saa en gruppes repraesentant hentes
 *  med praecis de samme felter som et enkeltkort. */
const KORTFELTER = {
  id: listings.id,
  adresse: listings.addressRaw,
  vej: listings.street,
  husnr: listings.houseNumber,
  etage: listings.floor,
  doer: listings.door,
  postnr: listings.postalCode,
  by: listings.city,
  type: listings.propertyType,
  areal: listings.sizeM2,
  vaerelser: listings.rooms,
  ledigFra: listings.availableFrom,
  leje: listings.rentMonthly,
  varme: listings.utilitiesHeat,
  vand: listings.utilitiesWater,
  el: listings.utilitiesElectricity,
  elEgenMaaler: listings.electricityOwnMeter,
  oevrig: listings.utilitiesOther,
  total: listings.totalMonthly,
  poster: listings.totalMonthlyComponents,
  indflytning: listings.moveInCost,
  ansoegning: listings.applicationType,
  match: listings.addressMatchLevel,
  foerstSet: listings.firstSeenAt,
  hosKilden: listings.sourceCreatedAt,
  url: listings.sourceUrl,
  kilde: sources.slug,
  kildeNavn: sources.name,
  billeder: sql<number>`(select count(*)::int from listing_images i where i.listing_id = ${listings.id})`,
  // Foerste billede til kortet. Underforespoergsel frem for join, saa
  // en bolig med tyve billeder ikke bliver til tyve raekker.
  forside: sql<string | null>`(
    select i.external_url from listing_images i
    where i.listing_id = ${listings.id} order by i.position limit 1)`,
} as const

// 48 og ikke 200: hvert kort henter et billede gennem proxyen, og to hundrede
// paa én side er baade en langsom side og en unoedig belastning af kilderne.
export async function soeg(f: Filtre, graense = 48) {
  return db
    .select(KORTFELTER)
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvor(f))
    .orderBy(ORDEN[f.sorter ?? 'nyeste'])
    .limit(graense)
}

export type Bolig = Awaited<ReturnType<typeof soeg>>[number]

// ═══════════════════════════════════════════════════════════════
//  Gruppering af ens boliger.
//
//  Femten rækkehuse på samme vej til samme pris er femten kort, der
//  siger det samme. De fylder listen ud, så alt andet ryger under
//  folden, uden at brugeren har lært noget af det femtende.
//
//  Nøglen er: samme kilde, samme postnummer, samme vejnavn, samme antal
//  værelser. Afviger én af delene, er de separate kort.
//
//  Prisen er IKKE i nøglen. Var den det, delte Ammendrup Parks 21
//  rækkehuse sig i ti kort, fordi priserne varierer med et par hundrede
//  kroner. Uden den bliver de to — et med fire værelser, et med tre — og
//  kortets "fra 15.750 kr/md" har et rigtigt spænd bag sig.
//
//  To ting ud over brugerens nøgle:
//
//    · Er en af delene ukendt, grupperes boligen IKKE. To boliger uden
//      kendt værelsestal er ikke kendt ens — de er bare begge ukendte,
//      og ukendt er ikke en værdi at slå sammen på. Prisen tæller med
//      her, selv om den ikke er en nøgledel: kortet siger "fra X kr/md"
//      om hele gruppen, og det må det ikke om en bolig uden kendt pris.
//    · Nøglen bærer OM totalen er kendt. Prisen er coalesce(total,
//      husleje), så en gruppe med begge slags ville skrive "i alt" om
//      boliger, hvor vi kun kender huslejen.
//
//  Grupperingen er KUN en visning. Alarmen matcher på de enkelte
//  boliger gennem hvor(), som ikke ved, at det her findes.
// ═══════════════════════════════════════════════════════════════

export interface Gruppenoegle {
  kilde: string
  postnr: string
  vej: string
  vaerelser: number
  /** Er priserne kendte totaler, eller er det huslejen alene? */
  total: boolean
}

export interface Gruppe {
  noegle: Gruppenoegle
  antal: number
  /** Den nyeste i gruppen. Leverer billede, aconto-tekst og kildemærkat. */
  repraesentant: Bolig
  /** Den laveste i gruppen — det er den, kortet siger "fra". */
  prisMin: number
  prisMax: number
  arealMin: number | null
  arealMax: number | null
  /** Kun sat, når alle i gruppen har samme type. Ellers ved vi det ikke. */
  type: string | null
  ledigMin: Date | null
  ledigMax: Date | null
  ledigUkendte: number
  indflytningMin: number | null
  indflytningMax: number | null
  /** Har alle samme aconto-poster? Ellers står posterne ikke på kortet. */
  ensPoster: boolean
  nyesteMarkedet: Date
}

export type Visning =
  | { slags: 'bolig'; bolig: Bolig }
  | { slags: 'gruppe'; gruppe: Gruppe }

const KAN_GRUPPERES = sql`(
  ${listings.street} is not null and ${listings.postalCode} is not null
  and ${listings.rooms} is not null and ${PRIS} is not null)`

/** Mangler en af delene, får boligen sit id som gruppe og står alene. */
const ALENE = sql<string | null>`case when ${KAN_GRUPPERES} then null else ${listings.id}::text end`

const TOTALKENDT = sql<boolean>`(${listings.totalMonthly} is not null)`

/** Gruppen står i listen dér, hvor dens stærkeste medlem ville have stået. */
const GRUPPEORDEN = {
  nyeste: sql`max(${listings.firstSeenAt}) desc`,
  pris_op: sql`min(${PRIS}) asc nulls last`,
  pris_ned: sql`max(${PRIS}) desc nulls last`,
  areal_ned: sql`max(${listings.sizeM2}) desc nulls last`,
  indflytning_op: sql`min(${listings.moveInCost}) asc nulls last`,
  indflytning_ned: sql`max(${listings.moveInCost}) desc nulls last`,
}

/** Boligkortets felter for en håndfuld id'er, i den rækkefølge de kom. */
async function korteneFor(ider: string[]): Promise<Map<string, Bolig>> {
  if (!ider.length) return new Map()
  const r = await db
    .select(KORTFELTER)
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(inArray(listings.id, ider))
  return new Map(r.map((b) => [b.id, b]))
}

/**
 * Listen, som den vises: enkelte boliger og grupper mellem hinanden.
 *
 * `graense` tæller KORT, ikke boliger. Ellers ville én gruppe på femten
 * spise en tredjedel af siden og efterlade plads til 33 andre.
 */
export async function soegGrupperet(f: Filtre, graense = 48): Promise<Visning[]> {
  const raekker = await db
    .select({
      kilde: sources.slug,
      postnr: listings.postalCode,
      vej: listings.street,
      vaerelser: listings.rooms,
      prisMin: sql<number | null>`min(${PRIS})::int`,
      prisMax: sql<number | null>`max(${PRIS})::int`,
      total: TOTALKENDT,
      antal: sql<number>`count(*)::int`,
      arealMin: sql<number | null>`min(${listings.sizeM2})::int`,
      arealMax: sql<number | null>`max(${listings.sizeM2})::int`,
      typer: sql<number>`count(distinct ${listings.propertyType})::int`,
      type: sql<string | null>`min(${listings.propertyType})`,
      // Datoer ud af en raa aggregatfunktion kommer tilbage som STRENGE —
      // Drizzles kolonnelaeser er ikke med her. De hentes som epoch i
      // millisekunder, saa de rammer praecis samme oejeblik som et
      // enkeltkorts ledigFra, uden at gaa gennem strengfortolkning.
      ledigMinMs: sql<number | null>`(extract(epoch from min(${listings.availableFrom})) * 1000)::float8`,
      ledigMaxMs: sql<number | null>`(extract(epoch from max(${listings.availableFrom})) * 1000)::float8`,
      ledigUkendte: sql<number>`count(*) filter (where ${listings.availableFrom} is null)::int`,
      indflytningMin: sql<number | null>`min(${listings.moveInCost})::int`,
      indflytningMax: sql<number | null>`max(${listings.moveInCost})::int`,
      // coalesce, fordi count(distinct) springer null over: ellers ville
      // "nogle med poster, nogle uden" tælle som ét sæt.
      postsaet: sql<number>`count(distinct coalesce(${listings.totalMonthlyComponents}::text, ''))::int`,
      nyesteMarkedetMs: sql<number>`(extract(epoch from
        max(coalesce(${listings.sourceCreatedAt}, ${listings.firstSeenAt}))) * 1000)::float8`,
      // Den nyeste i gruppen. Dens billede er det, der er hentet sidst.
      repraesentant: sql<string>`(array_agg(${listings.id}::text
        order by coalesce(${listings.sourceCreatedAt}, ${listings.firstSeenAt}) desc))[1]`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvor(f))
    .groupBy(sources.slug, listings.postalCode, listings.street, listings.rooms, TOTALKENDT, ALENE)
    .orderBy(GRUPPEORDEN[f.sorter ?? 'nyeste'])
    .limit(graense)

  const kort = await korteneFor(raekker.map((r) => r.repraesentant))

  const ud: Visning[] = []
  for (const r of raekker) {
    const bolig = kort.get(r.repraesentant)
    if (!bolig) continue
    // En gruppe på én er ikke en gruppe.
    if (r.antal < 2 || r.postnr == null || r.vej == null || r.vaerelser == null
      || r.prisMin == null || r.prisMax == null) {
      ud.push({ slags: 'bolig', bolig })
      continue
    }
    ud.push({
      slags: 'gruppe',
      gruppe: {
        noegle: {
          kilde: r.kilde, postnr: r.postnr, vej: r.vej,
          vaerelser: r.vaerelser, total: r.total,
        },
        antal: r.antal,
        repraesentant: bolig,
        prisMin: r.prisMin, prisMax: r.prisMax,
        arealMin: r.arealMin, arealMax: r.arealMax,
        type: r.typer === 1 ? r.type : null,
        ledigMin: r.ledigMinMs == null ? null : new Date(r.ledigMinMs),
        ledigMax: r.ledigMaxMs == null ? null : new Date(r.ledigMaxMs),
        ledigUkendte: r.ledigUkendte,
        indflytningMin: r.indflytningMin, indflytningMax: r.indflytningMax,
        ensPoster: r.postsaet === 1,
        nyesteMarkedet: new Date(r.nyesteMarkedetMs),
      },
    })
  }
  return ud
}

/** Hvor mange BOLIGER de viste kort dækker. Til linjen over listen. */
export const antalBoliger = (v: Visning[]) =>
  v.reduce((n, x) => n + (x.slags === 'gruppe' ? x.gruppe.antal : 1), 0)

/** Nøglen som URL. Hele nøglen med, så siden kan slå gruppen op igen. */
export function gruppeUrl(n: Gruppenoegle): string {
  const q = new URLSearchParams({
    kilde: n.kilde, postnr: n.postnr, vej: n.vej,
    vaerelser: String(n.vaerelser), total: n.total ? '1' : '0',
  })
  return `/gruppe?${q}`
}

/** Nøgle ud af URL-parametre. Er én del væk eller ugyldig, er der ingen gruppe. */
export function gruppenoegleFra(sp: Soegeparametre): Gruppenoegle | null {
  const t = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim()
  const kilde = t(sp.kilde), postnr = t(sp.postnr), vej = t(sp.vej)
  const vaerelser = Number(t(sp.vaerelser))
  if (!kilde || !postnr || !vej) return null
  if (!Number.isInteger(vaerelser)) return null
  return { kilde, postnr, vej, vaerelser, total: t(sp.total) === '1' }
}

/**
 * De enkelte boliger i én gruppe.
 *
 * Samme grundbetingelser som listen — kun aktive, kun med adressematch.
 * Brugerens øvrige filtre er med vilje IKKE med: gruppen er defineret af
 * nøglen alene, så linket peger på det samme uanset hvem der åbner det.
 */
export async function hentGruppe(n: Gruppenoegle) {
  return db
    .select(KORTFELTER)
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(
      eq(listings.status, 'active'),
      ne(listings.addressMatchLevel, 'failed'),
      eq(sources.slug, n.kilde),
      eq(listings.postalCode, n.postnr),
      eq(listings.street, n.vej),
      eq(listings.rooms, n.vaerelser),
      n.total ? isNotNull(listings.totalMonthly) : isNull(listings.totalMonthly),
      // Prisen er ikke en noegledel, men en bolig uden kendt pris hoerer
      // ikke til i en gruppe, kortet saetter et "fra" paa.
      sql`${PRIS} is not null`,
    ))
    // Husnummer er tekst: "333" og "20" sorteres som ord, hvis vi ikke
    // trækker tallet ud først. Så ville 100 komme før 20.
    .orderBy(
      sql`nullif(regexp_replace(coalesce(${listings.houseNumber}, ''), '\\D', '', 'g'), '')::int nulls last`,
      asc(listings.houseNumber),
      asc(listings.floor),
      asc(listings.door),
    )
}

/** Tal til linjen over listen. Regnes paa samme filtre som listen. */
export async function opsummering(f: Filtre) {
  const [r] = await db
    .select({
      antal: sql<number>`count(*)::int`,
      medTotal: sql<number>`count(${listings.totalMonthly})::int`,
      medIndflytning: sql<number>`count(${listings.moveInCost})::int`,
      fuld: sql<number>`count(*) filter (where ${FULD})::int`,
      billigst: sql<number | null>`min(${PRIS})`,
      dyrest: sql<number | null>`max(${PRIS})`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvor(f))
  return r!
}

/** Byer og kilder til filterfelterne — kun dem der faktisk har boliger. */
export async function facetter() {
  const byer = await db
    .select({ by: listings.city, postnr: listings.postalCode, antal: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed')))
    .groupBy(listings.city, listings.postalCode)
    .orderBy(desc(sql`count(*)`))
  // ÉN forespørgsel til kilder OG faciliteter. Fire adskilte kald gjorde
  // forsiden til ti forespørgsler i træk gennem webappens ene forbindelse
  // (transaction-pooleren, max 1), og så nåede Supabases statement timeout
  // frem før svaret. Aggregaterne koster ingenting oveni gruppperingen.
  const pr = await db
    .select({
      slug: sources.slug,
      navn: sources.name,
      antal: sql<number>`count(*)::int`,
      kaeledyr: sql<number>`count(*) filter (where jsonb_exists(coalesce(${listings.amenities}, '[]'::jsonb), 'kæledyr tilladt'))::int`,
      elevator: sql<number>`count(*) filter (where jsonb_exists(coalesce(${listings.amenities}, '[]'::jsonb), 'elevator'))::int`,
      udeplads: sql<number>`count(*) filter (where jsonb_exists_any(coalesce(${listings.amenities}, '[]'::jsonb), array['altan','terrasse']::text[]))::int`,
      medFaciliteter: sql<number>`count(*) filter (where jsonb_array_length(coalesce(${listings.amenities}, '[]'::jsonb)) > 0)::int`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed')))
    .groupBy(sources.slug, sources.name)
    .orderBy(desc(sql`count(*)`))

  // Kun typer der faktisk findes. Skemaets enum har seks værdier; kilderne
  // leverer tre. Et valg der aldrig giver træf, er værre end intet valg.
  const typer = await db
    .select({ type: listings.propertyType, antal: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(
      eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed'),
      isNotNull(listings.propertyType),
    ))
    .groupBy(listings.propertyType)
    .orderBy(desc(sql`count(*)`))

  const sum = (v: (r: (typeof pr)[number]) => number) => pr.reduce((a, r) => a + v(r), 0)

  return {
    byer,
    kilder: pr.map((k) => ({ slug: k.slug, navn: k.navn, antal: k.antal })),
    typer,
    // Samme regel som for typerne: tælles en facilitet til nul, vises
    // afkrydsningen ikke.
    faciliteter: {
      kaeledyr: sum((r) => r.kaeledyr),
      elevator: sum((r) => r.elevator),
      udeplads: sum((r) => r.udeplads),
    },
    /** Kilder der overhovedet oplyser faciliteter. */
    facilitetskilder: pr.filter((k) => k.medFaciliteter > 0).map((k) => k.navn),
    /** Aktive boliger fra kilder der ALDRIG oplyser faciliteter. Brugeren
     *  skal kunne se, at et facilitetsfilter skjuler dem, fordi kilden tier
     *  — ikke fordi boligen mangler det. */
    udenFacilitetsoplysning: pr.filter((k) => k.medFaciliteter === 0)
      .reduce((a, k) => a + k.antal, 0),
  }
}

// ═══════════════════════════════════════════════════════════════
//  Én bolig.
//
//  Kontaktfelterne staar med vilje IKKE i select-listen. Muren haandhaeves
//  i query'en, ikke i skabelonen: et felt der aldrig forlader databasen,
//  kan ikke laekke ved en uopmaerksom aendring i UI'et senere.
// ═══════════════════════════════════════════════════════════════

export async function hentBolig(id: string) {
  const [b] = await db
    .select({
  id: listings.id,
  adresse: listings.addressRaw,
      vej: listings.street,
      husnr: listings.houseNumber,
      etage: listings.floor,
      doer: listings.door,
      postnr: listings.postalCode,
      by: listings.city,
      match: listings.addressMatchLevel,
      lat: listings.lat,
      lng: listings.lng,
      type: listings.propertyType,
      areal: listings.sizeM2,
      vaerelser: listings.rooms,
      ledigFra: listings.availableFrom,
      leje: listings.rentMonthly,
      varme: listings.utilitiesHeat,
      vand: listings.utilitiesWater,
      el: listings.utilitiesElectricity,
      elEgenMaaler: listings.electricityOwnMeter,
      oevrig: listings.utilitiesOther,
      total: listings.totalMonthly,
      poster: listings.totalMonthlyComponents,
      indflytning: listings.moveInCost,
      ansoegning: listings.applicationType,
      faciliteter: listings.amenities,
      beskrivelse: listings.description,
      aabentHus: listings.openHouseAt,
      status: listings.status,
      foerstSet: listings.firstSeenAt,
      hosKilden: listings.sourceCreatedAt,
      url: listings.sourceUrl,
      kilde: sources.slug,
      kildeNavn: sources.name,
      // contactEmail og contactPhone hentes ALDRIG her. Se noten ovenfor.
      skjult: listings.isBlurred,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(eq(listings.id, id))
    .limit(1)
  if (!b) return null

  const billeder = await db
    .select({ url: listingImages.externalUrl, position: listingImages.position })
    .from(listingImages)
    .where(eq(listingImages.listingId, id))
    .orderBy(asc(listingImages.position))

  return { ...b, billeder }
}

export type BoligDetalje = NonNullable<Awaited<ReturnType<typeof hentBolig>>>

// ═══════════════════════════════════════════════════════════════
//  URL-parametre -> Filtre.
//
//  Ligger her, fordi BÅDE søgesiden og gem-formularen skal bruge den.
//  Læste de to hver sin vej, ville den gemte søgning matche noget andet,
//  end brugeren havde på skærmen, da hun trykkede.
// ═══════════════════════════════════════════════════════════════

export type Soegeparametre = Record<string, string | string[] | undefined>

const en = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v
const heltal = (v: string | undefined) => {
  const n = Number(v)
  return v && Number.isFinite(n) ? Math.trunc(n) : undefined
}
const kroner = (v: string | undefined) => {
  const n = heltal(v)
  return n == null ? undefined : n * 100
}

/**
 * Det store søgefelt tager ét sted — by ELLER postnummer. Fire cifre er
 * et postnummer, alt andet er et bynavn. Brugeren skal ikke vælge felt,
 * før hun ved, hvad hun leder efter.
 */
function stedet(sp: Soegeparametre): { by?: string; postnr?: string } {
  const s = en(sp.sted)?.trim()
  if (s) {
    const tal = s.match(/^(\d{4})/)
    return tal ? { postnr: tal[1] } : { by: s }
  }
  return { by: en(sp.by) || undefined, postnr: en(sp.postnr) || undefined }
}

/** Flere vaerdier af samme parameter — `?type=hus&type=raekkehus`. */
const flere = (v: string | string[] | undefined): string[] | undefined => {
  if (v == null) return undefined
  const a = (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean)
  return a.length ? a : undefined
}

export function filtreFraParametre(sp: Soegeparametre): Filtre {
  const kilder = flere(sp.kilde)
  const sted = stedet(sp)
  // Ukendte vaerdier kasseres. Uden det ville ?sorter=xyz slaa op i ORDEN
  // med undefined og vaelte siden, og ?type=fis naa helt ud i SQL'en.
  const sorter = SORTERINGER.find((x) => x === en(sp.sorter)) ?? 'nyeste'
  const boligtyper = flere(sp.type)
    ?.filter((t): t is Boligtype => (BOLIGTYPER as readonly string[]).includes(t))
  return {
    by: sted.by,
    postnr: sted.postnr,
    prisMin: kroner(en(sp.prisMin)),
    prisMax: kroner(en(sp.prisMax)),
    vaerelserMin: heltal(en(sp.vaerelser)),
    arealMin: heltal(en(sp.areal)),
    kilder,
    fuldOekonomi: en(sp.fuld) === '1',
    boligtyper: boligtyper?.length ? boligtyper : undefined,
    kaeledyr: en(sp.kaeledyr) === '1',
    elevator: en(sp.elevator) === '1',
    udeplads: en(sp.udeplads) === '1',
    sorter,
  }
}

/** Har brugeren overhovedet filtreret? En gemt søgning uden filtre er
 *  "alle boliger i landet" og giver hende hundredvis af mails. */
export function harFiltre(f: Filtre): boolean {
  return Boolean(f.by || f.postnr || f.prisMin != null || f.prisMax != null
    || f.vaerelserMin != null || f.arealMin != null || f.kilder?.length || f.fuldOekonomi
    || f.boligtyper?.length || f.kaeledyr || f.elevator || f.udeplads)
}

// ═══════════════════════════════════════════════════════════════
//  Tallene på forsiden.
//
//  Regnes hver gang. Skrevet ind som tekst ville de være forkerte i
//  morgen — og et tal, brugeren ikke kan stole på, er værre end intet.
// ═══════════════════════════════════════════════════════════════

export async function forsidetal() {
  const [a] = await db
    .select({
      boliger: sql<number>`count(*)::int`,
      // Samme regel som FULD. Se noten der.
      fuldOekonomi: sql<number>`count(*) filter (where
        ${listings.totalMonthly} is not null
        and ${listings.totalMonthlyComponents} && array['heat','water','electricity']::text[])::int`,
      kilder: sql<number>`count(distinct ${listings.sourceId})::int`,
    })
    .from(listings)
    .where(and(eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed')))

  // Hvor hurtigt vi ser en ny bolig. p90 og ikke median: løftet skal holde
  // for de fleste, ikke for halvdelen.
  //
  // Grænsen er PR. KILDE og går et døgn efter kildens første kørsel.
  // Før var den global, og så ødelagde kilde nummer fire målingen: ved
  // første import får hele bagkataloget `first_seen_at = nu`, og
  // LokalBoligs ældste annonce er fra september 2025. p90 sprang til
  // 2.209 timer — sandt om de tal, forkert om det, linjen påstår. Det er
  // samme fælde som alarmens "ny er ikke vi så den nu", og samme svar:
  // en bolig tæller først, når den dukkede op, MENS vi kiggede.
  const [b] = await db
    .select({
      minutterP90: sql<number | null>`
        percentile_cont(0.9) within group (
          order by extract(epoch from (${listings.firstSeenAt} - ${listings.sourceCreatedAt})) / 60)::int`,
    })
    .from(listings)
    .where(and(
      isNotNull(listings.sourceCreatedAt),
      sql`${listings.firstSeenAt} >= (
        select min(r.started_at) + interval '24 hours'
        from crawl_runs r
        where r.source_id = ${listings.sourceId} and r.new_count is not null)`,
    ))

  return { ...a!, minutterP90: b?.minutterP90 ?? null }
}
