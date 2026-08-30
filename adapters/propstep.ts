// ═══════════════════════════════════════════════════════════════
//  Propstep (white-label af Rotation CRM)
//
//  To led, med vilje:
//
//    discover()  /da-DK/lejebolig?page=N — soegegitteret i __NEXT_DATA__.
//                29 sider a 24. Gitterobjektet har 19 felter, alle
//                harmloese, og baerer postnummeret — saa filtreringen sker
//                HER, foer nogen detaljeside overhovedet hentes.
//    extract()   /da-DK/bolig/{id}-{slug} — oekonomi og boligdetaljer.
//
//  __NEXT_DATA__ laeses ud af HTML'en. Der findes ogsaa et rent
//  JSON-endpoint paa /_next/data/{buildId}/…, men buildId skifter ved hver
//  deploy, og en adapter der skal gaette deres deploy-id knaekker stille.
//  HTML'en koster ~100 kB ekstra og har ingen bevaegelige dele.
//
//  Beloeb er allerede i mindste enhed — transactionDetails.unit = 'cents'.
//  Ingen omregning.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { politeFetch } from '../lib/fetch'

const ORIGIN = 'https://propstep.com'
const BILLED_BASE = 'https://app.propstep.com/api/image/find-public'
const GITTER = `${ORIGIN}/da-DK/lejebolig`

// ═══════════════════════════════════════════════════════════════
//  ALLOWLIST — laes dette foer du roerer noget herunder.
//
//  Vi laeser KUN felterne navngivet i `laesGitterRaekke` og `laesBolig`.
//  Alt andet i kildens objekt kasseres ulaest.
//
//  Propsteps __NEXT_DATA__ paa en offentlig boligside baerer ogsaa
//  `property.note` (fri intern tekst), `owner`, `propertyGroup`
//  (herunder betalings- og kontooplysninger), `application` og
//  `statusHistory[].authorId`. Paa den post, der er efterset, var de tomme
//  DTO-felter — men de KAN blive udfyldt, og vi har hverken ret til eller
//  brug for indholdet.
//
//  Derfor roerer vi aldrig:
//      note · owner · propertyGroup · application
//      statusHistory · transactionStatusHistory
//      accountId · companyId · ownerId · transactionId · settings
//
//  Udvid ALDRIG med spread (`...raw`) eller en loekke over Object.keys.
//  Et nyt felt skal tilfoejes bevidst, af en der har set hvad der staar i det.
// ═══════════════════════════════════════════════════════════════

type Ukendt = Record<string, unknown>

const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : undefined

/** Verificerede propertyDetails.type. Ukendte giver null — vi gaetter ikke.
 *  Begge er eftersete mod den rendrede side: 1 = "Lejlighed", 2 = "Raekkehus"
 *  (bekraeftet paa fire uafhaengige boliger). i18n har ogsaa TypeHouse, men
 *  hvilket tal den har, er ikke set endnu. */
const BOLIGTYPER: Record<number, string> = { 1: 'Lejlighed', 2: 'Raekkehus' }
const ukendteTyper = new Set<number>()

/** utilitiesNew -> vores poster. Alt der ikke er varme/vand/el laegges
 *  sammen som uspecificeret rest, saa totalen svarer til det, der opkraeves. */
const VARME = 'HEATING', VAND = 'WATER', EL = 'ELECTRICITY'
const OEVRIGE = new Set([
  'COOLING', 'TV_ANTENNA', 'INTERNET', 'WASTEWATER',
  'RESIDENCE_REPRESENTATION', 'UTILITIES',
])

function laesForbrug(v: unknown) {
  let varme: number | undefined, vand: number | undefined, el: number | undefined
  let rest: number | undefined
  if (!Array.isArray(v)) return { varme, vand, el, rest }
  for (const p of v as Ukendt[]) {
    const navn = tekst(p?.['name'])
    const beloeb = tal(p?.['amount'])
    if (!navn || beloeb == null) continue
    if (navn === VARME) varme = (varme ?? 0) + beloeb
    else if (navn === VAND) vand = (vand ?? 0) + beloeb
    else if (navn === EL) el = (el ?? 0) + beloeb
    else if (OEVRIGE.has(navn)) rest = (rest ?? 0) + beloeb
  }
  return { varme, vand, el, rest }
}

/** propertyDetails-flag -> faciliteter. Kun dem der er udtrykkeligt true. */
const FACILITETER: [string, string][] = [
  ['elevator', 'elevator'], ['petsAllowed', 'kæledyr tilladt'],
  ['washingMachine', 'vaskemaskine'], ['dryer', 'tørretumbler'],
  ['dishwasher', 'opvaskemaskine'], ['refrigerator', 'køleskab'],
  ['freezer', 'fryser'], ['cooker', 'komfur'], ['shareable', 'delevenlig'],
  ['furnished', 'møbleret'], ['parking', 'parkering'],
]

// ─── Gitteret ──────────────────────────────────────────────────

export interface GitterRaekke {
  id: string
  propertySlug: string
  postalcode: string | undefined
  city: string | undefined
  availabilityStatus: string | undefined
  url: string
}

/** ALLOWLIST, led 1. Nitten felter i gitteret; vi bruger fem. */
function laesGitterRaekke(raw: Ukendt): GitterRaekke | null {
  const id = tekst(raw['id'])
  const propertySlug = tekst(raw['propertySlug'])
  if (!id || !propertySlug) return null
  return {
    id,
    propertySlug,
    postalcode: tekst(raw['postalcode']),
    city: tekst(raw['city']),
    availabilityStatus: tekst(raw['availabilityStatus']),
    url: `${ORIGIN}/da-DK/bolig/${id}-${propertySlug}`,
  }
}

// ─── Detaljesiden ──────────────────────────────────────────────

/** ALLOWLIST, led 2. Kun `property`, og kun felterne herunder. */
function laesBolig(property: Ukendt, gitter: GitterRaekke): RawListing | null {
  const id = tekst(property['id'])
  if (!id) return null
  // Laeste felter paa property: id, slug, name, location, transactionDetails,
  // propertyDetails, images, onMarketSince, addedOn, updatedOn,
  // onWaitingListSince. Intet andet.

  const loc = (property['location'] ?? {}) as Ukendt
  const punkt = (loc['point'] ?? {}) as Ukendt
  const td = (property['transactionDetails'] ?? {}) as Ukendt
  const pd = (property['propertyDetails'] ?? {}) as Ukendt

  const address = tekst(loc['addressAPostalCodeACity'])
    ?? [tekst(loc['address']), tekst(loc['postalCodeAndCity'])].filter(Boolean).join(', ')
  const postalCode = tekst(loc['postalcode']) ?? gitter.postalcode
  if (!address || !postalCode) return null

  // Beloeb er allerede i mindste enhed. Er unit noget andet end 'cents',
  // forstaar vi ikke tallene, og saa oplyser vi ingen oekonomi.
  const enhed = tekst(td['unit'])
  const iOere = enhed === 'cents'

  const price = iOere ? tal(td['price']) : undefined
  const depositum = iOere ? (tal(td['calculatedDeposit']) ?? tal(td['deposit'])) : undefined
  const forudbetalt = iOere ? (tal(td['calculatedPrepaidRent']) ?? tal(td['prepaidRent'])) : undefined
  const { varme, vand, el, rest } = iOere
    ? laesForbrug(td['utilitiesNew'])
    : { varme: undefined, vand: undefined, el: undefined, rest: undefined }

  const acontoIalt = [varme, vand, el, rest].reduce<number | undefined>(
    (a, v) => (v == null ? a : (a ?? 0) + v), undefined)

  // Indflytningspris: foerste maaneds leje + depositum + forudbetalt + aconto.
  // Kun naar alle tre beloeb kendes — der regnes ikke paa halve oplysninger.
  const moveInCost =
    price != null && depositum != null && forudbetalt != null
      ? price + depositum + forudbetalt + (acontoIalt ?? 0)
      : undefined

  const typeNr = tal(pd['type'])
  const boligtype = typeNr != null ? BOLIGTYPER[typeNr] : undefined
  if (typeNr != null && !boligtype && !ukendteTyper.has(typeNr)) {
    ukendteTyper.add(typeNr)
    // Logges her, ikke i discover(): saettet fyldes foerst under extract.
    console.warn(`  propstep: ukendt propertyDetails.type = ${typeNr} `
      + `(boligtype sat til null). Efterse den rendrede side og udvid BOLIGTYPER.`)
  }

  const amenities: string[] = []
  for (const [felt, navn] of FACILITETER) if (bool(pd[felt]) === true) amenities.push(navn)
  if (tal(pd['balconies'])) amenities.push('altan')
  if (tal(pd['terraces'])) amenities.push('terrasse')

  const billeder = Array.isArray(property['images'])
    ? (property['images'] as Ukendt[])
        .map((b) => tekst(b?.['name']))
        .filter((n): n is string => !!n)
        .map((n) => `${BILLED_BASE}/${n}?resize=true&scaleFactor=1&width=1200`)
    : []

  return {
    externalKey: id,
    sourceUrl: gitter.url,
    address,
    postalCode,
    sizeM2: tal(pd['size']),
    rooms: tal(pd['rooms']),
    propertyType: boligtype,
    availableFrom: tekst(td['availableFrom']),
    rentMonthly: price,
    utilitiesHeat: varme,
    utilitiesWater: vand,
    utilitiesElectricity: el,
    utilitiesOther: rest,
    moveInCost,
    lat: tal(punkt['y']),
    lng: tal(punkt['x']),
    // Laeses af kilden, gaettes ikke: onWaitingListSince er sat, naar
    // lejemaalet gaar efter anciennitet i stedet for foerst til moelle.
    applicationType: tekst(property['onWaitingListSince']) ? 'waiting_list' : 'regular',
    // Propstep har intet felt der svarer til findboligs rentModel. Feltet
    // forbliver tomt frem for at faa en opfundet vaerdi.
    sourceCreatedAt: tekst(property['onMarketSince']) ?? tekst(property['addedOn']),
    sourceUpdatedAt: tekst(property['updatedOn']),
    amenities,
    imageUrls: billeder,
  }
}

// ─── Hjaelpere ─────────────────────────────────────────────────

async function hentNextData(url: string): Promise<Ukendt> {
  const res = await politeFetch(url, 3, { headers: { Accept: 'text/html' } })
  if (!res.ok) throw new Error(`propstep ${url} gav ${res.status}`)
  const html = await res.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)
  if (!m) throw new Error(`intet __NEXT_DATA__ paa ${url}`)
  return JSON.parse(m[1]!) as Ukendt
}

const pageProps = (d: Ukendt): Ukendt =>
  ((d['props'] as Ukendt | undefined)?.['pageProps'] ?? {}) as Ukendt

// ─── Adapteren ─────────────────────────────────────────────────

export function propstepAdapter(opts: { postalCodes?: string[] } = {}): SourceAdapter {
  const filter = opts.postalCodes?.length ? new Set(opts.postalCodes) : null
  const gitter = new Map<string, GitterRaekke>()

  return {
    id: 'propstep',
    sourceType: 'feed',
    host: 'propstep.com',

    async discover(): Promise<DiscoveredListing[]> {
      gitter.clear()
      const ud: DiscoveredListing[] = []
      let side = 1, sider = 1

      do {
        const pp = pageProps(await hentNextData(side === 1 ? GITTER : `${GITTER}?page=${side}`))
        const g = (pp['propertiesGridProps'] ?? {}) as Ukendt
        const p = (g['pagination'] ?? {}) as Ukendt
        sider = tal(p['pageCount']) ?? 1
        for (const raa of (Array.isArray(g['data']) ? g['data'] as Ukendt[] : [])) {
          const r = laesGitterRaekke(raa)
          if (!r) continue
          // Filtrer HER. En bolig uden for filteret hentes aldrig.
          if (filter && (!r.postalcode || !filter.has(r.postalcode))) continue
          gitter.set(r.url, r)
          ud.push({ externalKey: r.id, url: r.url })
        }
        side++
      } while (side <= sider)

      if (ukendteTyper.size) {
        console.warn(`  propstep: ukendte propertyDetails.type (boligtype sat til null): `
          + [...ukendteTyper].join(', '))
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const g = gitter.get(url)
      if (!g) throw new Error(`ikke i gitteret: ${url} (koer discover foerst)`)
      const pp = pageProps(await hentNextData(url))
      const po = (pp['propertyOverview'] ?? {}) as Ukendt
      // Kun `property`. propertyOverview.owner, .propertyGroup og
      // .application roeres ikke — se allowlisten oeverst.
      const property = po['property'] as Ukendt | undefined
      if (!property) throw new Error(`ingen property i __NEXT_DATA__: ${url}`)
      const b = laesBolig(property, g)
      if (!b) throw new Error(`kunne ikke laese bolig: ${url}`)
      return b
    },
  }
}
