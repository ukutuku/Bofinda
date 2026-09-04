// ═══════════════════════════════════════════════════════════════
//  Soegningen. Ét sted, saa baade siden og et senere API spoerger ens.
//
//  Kontaktfelter hentes IKKE. Ikke fordi der staar noget i dem paa
//  importerede boliger, men fordi den dag muren kommer, skal den staa i
//  query'en — ikke i skabelonen.
// ═══════════════════════════════════════════════════════════════

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { listingImages, listings, sources } from '../db/schema'
import { FACILITET } from './faciliteter'
import { TILLADTE_VAERTER } from './billede'

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

/**
 * "Kan vi vise det billede?" — det samme spoergsmaal som `vaertTilladt()`
 * i lib/billede.ts, stillet i SQL.
 *
 * Listen skrives IKKE af. Praedikatet bygges af `TILLADTE_VAERTER`, saa de
 * to ikke kan komme fra hinanden: tilfoejer nogen en vaert ét sted, gaelder
 * den begge steder med det samme.
 *
 * Vaerten trækkes ud med samme snit som `new URL(u).host` — alt mellem
 * skemaet og den foerste skraastreg, spoergsmaalstegn eller havelaage.
 * Ikke `like`, fordi `_` er et joker-tegn i LIKE og et lovligt tegn i et
 * vaertsnavn.
 *
 * Hvorfor det skal i SQL og ikke i komponenten: taellingen ER svaret paa
 * "hvor mange billeder har den". Blev den taalt raat og filtreret bagefter,
 * ville tallet og billedet svare paa hver sit — og det er praecis den fejl,
 * der har kostet os fem gennemgange i denne omgang.
 */
export const VISBAR_VAERT = sql`substring(i.external_url from '^https?://([^/?#]+)') = any(array[${
  sql.join([...TILLADTE_VAERTER].map((v) => sql`${v}`), sql`, `)}]::text[])`

/** Boligen oplyser MINDST én facilitet. Tom liste = kilden tier. */
const OPLYST = sql`jsonb_array_length(coalesce(${listings.amenities}, '[]'::jsonb)) > 0`

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

// ═══════════════════════════════════════════════════════════════
//  Dedup mellem kilder — KUN paa enhedsadresse.
//
//  Den samme bolig annonceres hos flere. Vilhelm Ehlerts Alle 15, 3. 3 i
//  Viborg staar hos baade Propstep og LokalBolig med samme areal, samme
//  vaerelsestal, samme husleje, samme total og samme koordinat.
//  Adressevasken giver dem allerede det samme unit-uuid.
//
//  To niveauer:
//
//    unit    Enhedsadressen alene. Samme uuid = samme bolig.
//    access  Opgangen er ikke nok — der kan ligge otte lejligheder — saa
//            noeglen er opgang + areal + vaerelser + husleje, og den
//            KRAEVER et husnummer.
//
//  Husnummerkravet er ikke pynt. Uden husnummer er "opgangen" hele vejen:
//  Nordskovvej i 7184 Vandel er 30 boliger med den samme adressestreng,
//  "Nordskovvej, 7184 Vandel", og kilden siger ikke hvilken bolig der er
//  hvilken. Uden kravet ville access-reglen skjule 26 af dem som dubletter
//  af hinanden. Med kravet skjuler den 2, og begge er den samme bolig
//  annonceret to steder.
//
//  Det her er en VISNING, ikke et filter. `hvor()` er urort, saa alarmen
//  matcher stadig paa de enkelte raekker.
// ═══════════════════════════════════════════════════════════════

/**
 * Rækkerne der ikke blev repræsentant for deres bolig.
 *
 * Rangeringen regnes paa DET FILTREREDE saet, ikke paa hele basen. Ellers
 * ville en soegning paa "kilde: LokalBolig" tabe de boliger, hvor Propstep
 * blev valgt — boligen ville forsvinde helt i stedet for at staa én gang.
 *
 * Den indre `from listings` skygger for den ydre, saa `hvor(f)` binder til
 * den indre tabel. Det er derfor filteret kan genbruges ordret.
 *
 * Repraesentanten er den med flest billeder; er de lige, den med kendt
 * total; er de stadig lige, den aeldste raekke, saa valget er stabilt
 * mellem koersler.
 */
/**
 * "l2 er den samme bolig som den ydre række, hos en anden kilde."
 *
 * Skrevet ud i stedet for at genbruge DEDUPNOEGLE, fordi den indre tabel
 * har sit eget alias og udtrykket ville binde til den forkerte. Betingelsen
 * SKAL matche nøglen nedenfor — samme to niveauer, samme husnummerkrav.
 */
const SAMME_BOLIG_ANDEN_KILDE = sql`(
  l2.status = 'active'
  and l2.source_id <> ${listings.sourceId}
  and (
    (${listings.addressMatchLevel} = 'unit' and l2.address_match_level = 'unit'
      and l2.unit_address_uuid = ${listings.unitAddressUuid})
    or
    (${listings.addressMatchLevel} = 'access' and l2.address_match_level = 'access'
      and ${listings.houseNumber} is not null and l2.house_number is not null
      and l2.access_address_uuid = ${listings.accessAddressUuid}
      and l2.size_m2 is not distinct from ${listings.sizeM2}
      and l2.rooms is not distinct from ${listings.rooms}
      and round(l2.rent_monthly / 10000.0)
          is not distinct from round(${listings.rentMonthly} / 10000.0))
  ))`

/**
 * Dedup-nøglen i SQL. SKAL svare til `dedupNoegle` i lib/dedup.ts — to
 * definitioner ville betyde, at det, vi skjuler, og det, vi siger vi
 * skjuler, kunne komme fra hinanden.
 */
const DEDUPNOEGLE = sql`case
  when ${listings.addressMatchLevel} = 'unit' and ${listings.unitAddressUuid} is not null
    then 'unit:' || ${listings.unitAddressUuid}
  when ${listings.addressMatchLevel} = 'access' and ${listings.accessAddressUuid} is not null
       and ${listings.houseNumber} is not null
    then 'access:' || ${listings.accessAddressUuid}
      || ':' || coalesce(${listings.sizeM2}::text, '?')
      || ':' || coalesce(${listings.rooms}::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round(${listings.rentMonthly} / 10000.0)::text, '?')
  else null
end`

export function ikkeRepraesentant(grundlag: SQL | undefined) {
  return sql`${listings.id} in (
    select d.id from (
      select ${listings.id} as id,
        row_number() over (
          partition by ${DEDUPNOEGLE}
          order by
            (select count(*) from listing_images i
              where i.listing_id = ${listings.id} and ${VISBAR_VAERT}) desc,
            (${listings.totalMonthly} is not null) desc,
            ${listings.id}
        ) as rn
      from ${listings}
      inner join ${sources} on ${sources.id} = ${listings.sourceId}
      where ${grundlag ?? sql`true`}
        and ${DEDUPNOEGLE} is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and ${DEDUPNOEGLE} in (
          select ${DEDUPNOEGLE} from ${listings}
          where ${listings.status} = 'active' and ${DEDUPNOEGLE} is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1)`
}

/**
 * Grundlaget PLUS dedup. Alt der viser en liste — eller taeller den —
 * skal gaa gennem den her. Eksporteret, fordi omraadesiderne har deres
 * eget grundpraedikat og skal taelle det samme, som de viser.
 */
export const udenDubletter = (grundlag: SQL | undefined) =>
  and(grundlag, sql`not ${ikkeRepraesentant(grundlag)}`)

/** Den annonce vi viser i stedet for en, der tabte repraesentantvalget. */
export interface Repraesentant {
  id: string
  adresse: string
  postnr: string | null
  by: string | null
  kilde: string
  billeder: number
  harTotal: boolean
}

/**
 * Hvem vises i stedet for de her boliger?
 *
 * Dedup er en visning, ikke et filter — men for den udlejer, der tabte
 * valget, er forskellen ikke til at se: annoncen staar som udgivet og kan
 * aabnes paa sit eget link, mens den ikke findes i soegningen. Det er den
 * samme uaerlighed som en total, der lader som om aconto er kendt.
 *
 * Funktionen bygger ikke sin egen rangering. Den spoerger `ikkeRepraesentant`
 * hvem der tabte, og `udenDubletter` hvem der vandt — praecis de to
 * praedikater soegesiden selv bruger. To definitioner ville betyde, at det
 * vi skjuler, og det vi siger vi skjuler, kunne komme fra hinanden.
 *
 * Grundlaget er den UFILTREREDE soegning: spoergsmaalet er, om boligen
 * overhovedet kan findes, ikke om den slipper gennem et bestemt filter.
 */
export async function repraesentantFor(ids: string[]): Promise<Map<string, Repraesentant>> {
  const svar = new Map<string, Repraesentant>()
  if (!ids.length) return svar

  const grundlag = hvor({})
  const noegle = sql<string>`${DEDUPNOEGLE}`

  // 1. Hvilke af dem tabte? En bolig, der slet ikke er med i grundlaget,
  //    er skjult af noget andet og hoerer ikke til her.
  const tabere = await db
    .select({ id: listings.id, noegle })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(inArray(listings.id, ids), grundlag, ikkeRepraesentant(grundlag)))
  if (!tabere.length) return svar

  // 2. Hvem vandt paa de noegler?
  const noegler = [...new Set(tabere.map((t) => t.noegle))]
  const vindere = await db
    .select({
      id: listings.id,
      adresse: listings.addressRaw,
      postnr: listings.postalCode,
      by: listings.city,
      kilde: sources.name,
      billeder: sql<number>`(select count(*)::int from ${listingImages} i
        where i.listing_id = ${listings.id} and ${VISBAR_VAERT})`,
      harTotal: sql<boolean>`(${listings.totalMonthly} is not null)`,
      noegle,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(udenDubletter(grundlag), inArray(noegle, noegler)))

  const efterNoegle = new Map(vindere.map((v) => [v.noegle, v]))
  for (const t of tabere) {
    const v = efterNoegle.get(t.noegle)
    if (v) svar.set(t.id, {
      id: v.id, adresse: v.adresse, postnr: v.postnr, by: v.by,
      kilde: v.kilde, billeder: v.billeder, harTotal: v.harTotal,
    })
  }
  return svar
}

const hvorVist = (f: Filtre) => udenDubletter(hvor(f))

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
  // Kildens egne koordinater. Vi opfinder dem aldrig — Dacas oplyser dem
  // ikke, og de nitten boliger derfra har null. De skal stadig kunne vises.
  lat: listings.lat,
  lng: listings.lng,
  foerstSet: listings.firstSeenAt,
  hosKilden: listings.sourceCreatedAt,
  url: listings.sourceUrl,
  kilde: sources.slug,
  kildeNavn: sources.name,
  // Kun billeder vi FAKTISK kan vise. Se VISBAR_VAERT.
  billeder: sql<number>`(select count(*)::int from listing_images i
    where i.listing_id = ${listings.id} and ${VISBAR_VAERT})`,
  // Foerste billede til kortet. Underforespoergsel frem for join, saa
  // en bolig med tyve billeder ikke bliver til tyve raekker.
  forside: sql<string | null>`(
    select i.external_url from listing_images i
    where i.listing_id = ${listings.id} and ${VISBAR_VAERT}
    order by i.position limit 1)`,
  // De ANDRE kilder der har den samme bolig. Boligen vises én gang, men
  // kortet skal ikke lade som om, den kun findes ét sted.
  ogsaaHos: sql<string[]>`(
    select coalesce(array_agg(distinct s2.name order by s2.name), '{}'::text[])
    from listings l2 join sources s2 on s2.id = l2.source_id
    where ${SAMME_BOLIG_ANDEN_KILDE})`,
} as const

// 48 og ikke 200: hvert kort henter et billede gennem proxyen, og to hundrede
// paa én side er baade en langsom side og en unoedig belastning af kilderne.
export async function soeg(f: Filtre, graense = 48) {
  return db
    .select(KORTFELTER)
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    // hvorVist og ikke hvor: alt der viser en LISTE, skal vise boligen én
    // gang. `hvor()` alene hoerer til alarmen, som matcher paa raekkerne.
    .where(hvorVist(f))
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
  /**
   * Udlejerens konto — kun sat paa native annoncer.
   *
   * `sources.slug` er 'native' for ALLE udlejerannoncer, saa uden den her
   * ville to forskellige udlejere med hver sin lejlighed paa samme vej med
   * samme vaerelsestal blive ét kort, der paastod, at det var samme udbud.
   *
   * Kolonnen er NULL paa hver eneste scrapede bolig, og `group by` samler
   * NULL i én gruppe — de eksisterende grupper er derfor uroerte. For dem
   * er sammenlaegningen ogsaa rigtig: samme kilde, samme vej, samme
   * vaerelsestal er som regel den samme ejendom.
   */
  ejer: string | null
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
  /** Mangler MINDST én i gruppen et el-beløb? Så skal kortet sige det. */
  nogenUdenEl: boolean
  /** Siger kilden om hver enkelt af dem, at lejeren har egen elmåler? */
  alleUdenElHarEgenMaaler: boolean
  /** Har MINDST én af dem en aconto, vi ikke kender indholdet af? */
  nogenUkendtDaekning: boolean
  /** Har ALLE i gruppen den samme bolig hos en anden kilde? */
  alleOgsaaAndetsteds: boolean
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
      ejer: listings.landlordId,
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
      // El i gruppen. Ét kort taler for flere boliger, saa spoergsmaalet er
      // ikke "har repraesentanten el?" men "er der NOGEN i gruppen, der
      // mangler den?". Fravaer af oplysning er ikke et nej: mangler blot én,
      // kan kortets total ikke staa som hele udgiften for dem alle.
      nogenUdenEl: sql<boolean>`bool_or(${listings.utilitiesElectricity} is null)`,
      // Og siger kilden selv om ALLE de manglende, at lejeren har egen
      // maaler? Kun saa maa den staerkere formulering bruges.
      alleUdenElHarEgenMaaler: sql<boolean>`bool_and(${listings.utilitiesElectricity} is not null
        or ${listings.electricityOwnMeter} is true)`,
      // Er der NOGEN i gruppen, hvis aconto er ét samlet beloeb uden
      // specifikation? Saa kan kortet ikke sige "el indgaar ikke" om dem
      // alle — for den ene ved vi det ikke. Samme regel som `samletKlump`
      // i lib/eloplysning.ts, stillet i SQL.
      nogenUkendtDaekning: sql<boolean>`bool_or(
        ${listings.totalMonthly} is not null
        and ${listings.totalMonthlyComponents} @> array['other']::text[]
        and not (${listings.totalMonthlyComponents} && array['heat','water','electricity']::text[])
        and ${listings.electricityOwnMeter} is not true)`,
      // Gaelder det ALLE i gruppen, at en anden kilde ogsaa har boligen?
      // Repraesentantens egen `ogsaaHos` maa ikke tale for de andre —
      // kortet ville paastaa to kilder for femten boliger, hvor det
      // maaske kun gaelder den ene, vi tilfaeldigvis valgte.
      alleOgsaaAndetsteds: sql<boolean>`bool_and(exists (
        select 1 from listings l2 where ${SAMME_BOLIG_ANDEN_KILDE}))`,
      nyesteMarkedetMs: sql<number>`(extract(epoch from
        max(coalesce(${listings.sourceCreatedAt}, ${listings.firstSeenAt}))) * 1000)::float8`,
      // Den nyeste i gruppen. Dens billede er det, der er hentet sidst.
      repraesentant: sql<string>`(array_agg(${listings.id}::text
        order by coalesce(${listings.sourceCreatedAt}, ${listings.firstSeenAt}) desc))[1]`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(hvorVist(f))
    .groupBy(sources.slug, listings.postalCode, listings.street, listings.rooms,
      listings.landlordId, TOTALKENDT, ALENE)
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
          vaerelser: r.vaerelser, total: r.total, ejer: r.ejer,
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
        nogenUdenEl: r.nogenUdenEl ?? false,
        alleUdenElHarEgenMaaler: r.alleUdenElHarEgenMaaler ?? false,
        nogenUkendtDaekning: r.nogenUkendtDaekning ?? false,
        alleOgsaaAndetsteds: r.alleOgsaaAndetsteds ?? false,
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
/**
 * Linket til gruppens egen side.
 *
 * Adressen baerer ÉN ting: repraesentantens bolig-id. Siden slaar den op og
 * udleder noeglen derfra.
 *
 * Foer stod hele noeglen i adressen. Da ejeren kom med i noeglen, ville det
 * have lagt en udlejers KONTO-id i en delbar URL. Bolig-id'et er derimod
 * allerede offentligt — det staar i /bolig/{id} paa hvert eneste kort.
 */
export const gruppeUrl = (repraesentantId: string): string =>
  `/gruppe?b=${encodeURIComponent(repraesentantId)}`

/**
 * Nøgle ud af de GAMLE URL-parametre. Er én del væk eller ugyldig, er der
 * ingen gruppe.
 *
 * Formatet er afloest af `?b=<bolig-id>`, men links delt foer skiftet ligger
 * stadig i folks browserhistorik og noter. De virker uaendret: `ejer` saettes
 * til null, hvilket er praecis rigtigt, for kun scrapede boliger kunne
 * danne grupper dengang, og deres `landlord_id` ER null.
 */
export function gruppenoegleFra(sp: Soegeparametre): Gruppenoegle | null {
  const t = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim()
  const kilde = t(sp.kilde), postnr = t(sp.postnr), vej = t(sp.vej)
  const vaerelser = Number(t(sp.vaerelser))
  if (!kilde || !postnr || !vej) return null
  if (!Number.isInteger(vaerelser)) return null
  return { kilde, postnr, vej, vaerelser, total: t(sp.total) === '1', ejer: null }
}

/**
 * Noeglen udledt af én bolig — den vej `/gruppe?b=<id>` gaar.
 *
 * Boligen skal selv kunne grupperes; mangler den vej, postnummer,
 * vaerelsestal eller pris, staar den alene i listen, og saa er der ingen
 * gruppe at vise.
 */
export async function gruppenoegleFraBolig(id: string): Promise<Gruppenoegle | null> {
  const [r] = await db
    .select({
      kilde: sources.slug, postnr: listings.postalCode, vej: listings.street,
      vaerelser: listings.rooms, ejer: listings.landlordId,
      total: sql<boolean>`(${listings.totalMonthly} is not null)`,
      kanGrupperes: sql<boolean>`${KAN_GRUPPERES}`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(
      eq(listings.id, id),
      eq(listings.status, 'active'),
      ne(listings.addressMatchLevel, 'failed'),
    ))
    .limit(1)
  if (!r || !r.kanGrupperes || !r.postnr || !r.vej || r.vaerelser == null) return null
  return {
    kilde: r.kilde, postnr: r.postnr, vej: r.vej,
    vaerelser: r.vaerelser, total: r.total, ejer: r.ejer,
  }
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
      // Ejeren er NULL paa alle scrapede — `is null` rammer dem alle.
      n.ejer == null ? isNull(listings.landlordId) : eq(listings.landlordId, n.ejer),
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
      // Grundlaget under facilitetsfiltrene. Aggregaterne koster ingenting
      // oveni den scanning, der alligevel sker — samme argument som for
      // facetternes fire tal i én forespørgsel.
      oplyser: sql<number>`count(*) filter (where ${OPLYST})::int`,
      tier: sql<number>`count(*) filter (where not ${OPLYST})::int`,
      // De samme prædikater som filtrene selv bruger. To definitioner ville
      // betyde, at tallet og filteret kunne sige hver sit.
      kaeledyr: sql<number>`count(*) filter (where ${harFacilitet(FACILITET.kaeledyr)})::int`,
      elevator: sql<number>`count(*) filter (where ${harFacilitet(FACILITET.elevator)})::int`,
      udeplads: sql<number>`count(*) filter (where ${harFacilitet(FACILITET.udeplads)})::int`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    // Samme saet som listen. Ellers ville "Viser de 62 nyeste af 1.137"
    // taelle dubletter, listen ikke viser.
    .where(hvorVist(f))
  return r!
}

/**
 * Grundlaget under hver afkrydsning: hvor mange oplyser en facilitet, og
 * hvor mange tier og forsvinder derfor, hvis man saetter kryds.
 *
 * Filteret bliver ved at udelukke de ukendte — det er det eneste aerlige,
 * for vi ved ikke, om de har elevator. Men saa skal brugeren kunne se, hvad
 * hun ikke faar. Samme princip som prissammenligningen, der altid skriver,
 * hvor mange boliger medianen er regnet af.
 *
 * "Oplyser" maales paa BOLIGEN, ikke paa kilden. En findbolig-annonce med en
 * tom facilitetsliste ved vi lige saa lidt om som en fra LokalBolig, der
 * aldrig sender nogen.
 *
 * Det er `opsummering` paa den samme soegning UDEN de tre facilitetsfiltre —
 * ikke en ny forespoergsel med sin egen definition. Med filtrene paa ville
 * tallene beskrive et saet, der allerede var renset, og "0 tier" ville staa
 * under et filter, der lige havde skjult 435 boliger.
 *
 * Er ingen af de tre sat, er `where` ORDRET den samme som `opsummering`s, og
 * saa skal kalderen genbruge det svar i stedet for at spoerge igen. Se
 * app/page.tsx. Forsiden koerer to forespoergsler pr. visning, og det tal
 * har vaeret dyrt at faa ned.
 */
export const facilitetsgrundlag = (f: Filtre) =>
  opsummering({ ...f, kaeledyr: false, elevator: false, udeplads: false })

export type Facilitetsgrundlag = Awaited<ReturnType<typeof opsummering>>

/**
 * Grundlaget under "Fuld økonomi kendt".
 *
 * Samme princip som `facilitetsgrundlag`: soegningen UDEN det filter, linjen
 * beskriver. Med filteret paa ville tallene beskrive et saet, der allerede
 * var renset, og "0 uden total" ville staa under et filter, der lige havde
 * skjult 316 boliger.
 *
 * Tre grupper, og de skal daekke alle boliger:
 *   fuld              husleje + mindst én NAVNGIVEN aconto-post
 *   kun samlet aconto totalen er kendt, men ikke hvad den bestaar af
 *   ingen total       vi kender kun huslejen
 *
 * Alle tre tal er allerede i `opsummering` — `antal`, `medTotal`, `fuld` —
 * saa der er ingen ekstra forespoergsel, naar filteret ikke er sat.
 */
export const oekonomigrundlag = (f: Filtre) =>
  opsummering({ ...f, fuldOekonomi: false })

/** Kilder der aldrig oplyser faciliteter, og hvor mange boliger de har. */
export interface Tavsekilder {
  navne: string[]
  antal: number
}

/**
 * Hvilke kilder tier HELT om faciliteter i den aktuelle soegning?
 *
 * Frafaldet i et facilitetsfilter er ikke jaevnt fordelt. Tre kilder —
 * LokalBolig, findbolig.nu og Dacas — oplyser aldrig faciliteter, saa et
 * kryds i "Elevator" fjerner dem fuldstaendigt. Filtret bliver dermed ogsaa
 * et KILDEfilter, og det skal brugeren kunne se: hun har ikke fravalgt en
 * egenskab, hun har fravalgt tre kilder.
 *
 * Navnene beregnes, ikke skrives ind. Skifter en kilde praksis, eller
 * kommer der en ny tavs kilde, retter linjen sig selv.
 *
 * Grundlaget er soegningen UDEN de tre facilitetsfiltre — med dem er de
 * tavse kilder allerede vaek, og saa ville svaret altid vaere tomt.
 * Koeres kun naar et facilitetsfilter er sat, hvilket er den eneste gang
 * linjen vises.
 */
export async function tavseKilder(f: Filtre): Promise<Tavsekilder> {
  const r = await db
    .select({
      navn: sources.name,
      antal: sql<number>`count(*)::int`,
      oplyser: sql<number>`count(*) filter (where ${OPLYST})::int`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(
      hvorVist({ ...f, kaeledyr: false, elevator: false, udeplads: false }),
      // Vores EGEN kilde hoerer ikke til her. Saetningen paastaar, at en
      // kilde aldrig oplyser faciliteter — og det er faktuelt forkert om
      // udlejerannoncer: formularen SPOERGER om dem. At én annonce ikke
      // har krydset noget af, er ikke en datapraksis hos en tredjepart.
      // De taelles stadig med i "oplyser ingen" paa grundlagslinjen.
      ne(listings.sourceType, 'native'),
    ))
    .groupBy(sources.name)
  const tavse = r.filter((x) => x.oplyser === 0)
  return {
    navne: tavse.map((x) => x.navn).sort(),
    antal: tavse.reduce((a, x) => a + x.antal, 0),
  }
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
      // Kontaktfelterne kommer KUN ud for native boliger, og betingelsen
      // staar i SQL'en — ikke i skabelonen. En scrapet bolig kan derfor
      // ikke faa dem ud, uanset hvad en senere UI-aendring beder om.
      //
      // Muren er aaben for native indtil videre: der er ingen kilde at
      // henvise til, og en annonce ingen kan svare paa er ingen annonce.
      // Se noten i CLAUDE.md om hvad der skal ske, naar betalingsmodellen
      // kommer.
      skjult: listings.isBlurred,
      // Til visningen: en native bolig har ingen ekstern kilde at sende
      // laeseren hen til. Kontaktfelterne hentes stadig ALDRIG her — muren
      // staar i query'en, ikke i skabelonen.
      egenAnnonce: sql<boolean>`(${listings.sourceType} = 'native')`,
      // OM der er oplyst noget — ikke HVAD. Vaerdien hentes foerst, naar
      // et menneske trykker, saa den ikke ligger i sidens markup, hvor en
      // adresse-hoester kan laese den.
      harKontaktMail: sql<boolean>`(${listings.sourceType} = 'native'
        and ${listings.contactEmail} is not null)`,
      harKontaktTlf: sql<boolean>`(${listings.sourceType} = 'native'
        and ${listings.contactPhone} is not null)`,
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
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    // Dedupet: "1.137 ledige boliger" maa ikke taelle den samme bolig,
    // fordi to kilder annoncerer den.
    .where(hvorVist({}))

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

// ═══════════════════════════════════════════════════════════════
//  Prissammenligning: kr/m² mod medianen i samme postnummer.
//
//  Kun boliger med KENDT total tæller med. En bolig hvor vi kun kender
//  huslejen, ville trække medianen ned og sammenligne to forskellige
//  ting — og både boligen selv og grundlaget skal være samme slags tal.
//
//  Grundlaget er dedupet: den samme bolig hos to kilder er én bolig, ikke
//  to, og må ikke tælle dobbelt i en median.
//
//  MINDST er ikke til pynt. En median af to boliger er ikke en
//  markedspris, og et tal, brugeren ikke kan stole på, er værre end
//  ingenting. Under grænsen returneres null, og siden viser intet.
// ═══════════════════════════════════════════════════════════════

/** Færre end det, og medianen siger mere om tilfældet end om markedet. */
export const MINDST_TIL_SAMMENLIGNING = 5

export interface Kvadratmeterpris {
  /** Median kr/m² pr. måned, i øre. */
  median: number
  /** Hvor mange boliger medianen er regnet af. Skal ALTID vises. */
  antal: number
}

export async function kvadratmeterpris(postnr: string): Promise<Kvadratmeterpris | null> {
  const [r] = await db
    .select({
      median: sql<number | null>`percentile_cont(0.5) within group (
        order by ${listings.totalMonthly}::numeric / ${listings.sizeM2})::int`,
      antal: sql<number>`count(*)::int`,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(udenDubletter(and(
      eq(listings.status, 'active'),
      ne(listings.addressMatchLevel, 'failed'),
      eq(listings.postalCode, postnr),
      isNotNull(listings.totalMonthly),
      sql`${listings.sizeM2} > 0`,
    )))
  if (!r || r.median == null || r.antal < MINDST_TIL_SAMMENLIGNING) return null
  return { median: r.median, antal: r.antal }
}
