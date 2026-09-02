// ═══════════════════════════════════════════════════════════════
//  Soegningen. Ét sted, saa baade siden og et senere API spoerger ens.
//
//  Kontaktfelter hentes IKKE. Ikke fordi der staar noget i dem paa
//  importerede boliger, men fordi den dag muren kommer, skal den staa i
//  query'en — ikke i skabelonen.
// ═══════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm'
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
  sorter?: 'nyeste' | 'pris_op' | 'pris_ned' | 'areal_ned'
}

/**
 * Fuld oekonomi: huslejen og alle aconto-poster udlejeren opkraever.
 * total_monthly saettes praecis naar det er tilfaeldet — se beregnTotal og
 * erFuldOekonomi i normalize.ts. El indgaar ikke i kravet.
 */
const FULD = isNotNull(listings.totalMonthly)

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
  return and(...d)
}

const ORDEN = {
  nyeste: desc(listings.firstSeenAt),
  // Sorteres på samme tal som der filtreres på — ellers ville "billigst
  // først" og "under 18.000" pege på to forskellige priser.
  pris_op: sql`${PRIS} asc nulls last`,
  pris_ned: sql`${PRIS} desc nulls last`,
  areal_ned: desc(listings.sizeM2),
}

// 48 og ikke 200: hvert kort henter et billede gennem proxyen, og to hundrede
// paa én side er baade en langsom side og en unoedig belastning af kilderne.
export async function soeg(f: Filtre, graense = 48) {
  return db
    .select({
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
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvor(f))
    .orderBy(ORDEN[f.sorter ?? 'nyeste'])
    .limit(graense)
}

export type Bolig = Awaited<ReturnType<typeof soeg>>[number]

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
  const kilder = await db
    .select({ slug: sources.slug, navn: sources.name, antal: sql<number>`count(*)::int` })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(eq(listings.status, 'active'), ne(listings.addressMatchLevel, 'failed')))
    .groupBy(sources.slug, sources.name)
    .orderBy(desc(sql`count(*)`))
  return { byer, kilder }
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

export function filtreFraParametre(sp: Soegeparametre): Filtre {
  const kilder = sp.kilde ? (Array.isArray(sp.kilde) ? sp.kilde : [sp.kilde]) : undefined
  return {
    by: en(sp.by) || undefined,
    postnr: en(sp.postnr) || undefined,
    prisMin: kroner(en(sp.prisMin)),
    prisMax: kroner(en(sp.prisMax)),
    vaerelserMin: heltal(en(sp.vaerelser)),
    arealMin: heltal(en(sp.areal)),
    kilder,
    fuldOekonomi: en(sp.fuld) === '1',
    sorter: (en(sp.sorter) as Filtre['sorter']) || 'nyeste',
  }
}

/** Har brugeren overhovedet filtreret? En gemt søgning uden filtre er
 *  "alle boliger i landet" og giver hende hundredvis af mails. */
export function harFiltre(f: Filtre): boolean {
  return Boolean(f.by || f.postnr || f.prisMin != null || f.prisMax != null
    || f.vaerelserMin != null || f.arealMin != null || f.kilder?.length || f.fuldOekonomi)
}
