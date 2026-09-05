// ═══════════════════════════════════════════════════════════════
//  findbolig.nu
//
//  Soege-API'et bag /da-dk/find. Ét POST-kald giver hele boligobjektet,
//  saa vi henter ALDRIG detaljesiden. Det er ikke en optimering — det er
//  privatlivsgraensen: alt hvad vi ikke henter, kan vi ikke komme til at
//  gemme. Se ALLOWLIST nedenfor.
//
//      POST https://findbolig.nu/api/search
//      { "page": 0, "pageSize": 50,
//        "filters": { "PostalCodeAndPostalCodeName": ["2300 København S"] } }
//
//  Bemaerk: filtrene ligger i BODY'ens `filters`, ikke som query-parametre.
//  Gyldige filterværdier kommer fra GET /api/search/suggestions/{tekst}.
//
//  Svaret blander to slags objekter paa $type:
//    "Property"   en ejendom med mange lejemaal bag en venteliste. Ikke et
//                 lejemaal, har hverken husleje eller adresse paa enheden.
//                 Frafiltreres.
//    "Residence"  det enkelte lejemaal. Det er dem, vi vil have.
//
//  `totalResults` taeller lejemaal paa tvaers af ejendomme og er derfor
//  IKKE laengden af `results`. Pagineringen koeres til `results` er tom.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'

const ORIGIN = 'https://findbolig.nu'
const API = `${ORIGIN}/api/search`
// Kilden har et loft paa hvor mange resultater den overhovedet udleverer.
// Ti sider a 50 gav 141 boliger; én side a 500 gav 147. Stoerre sider naar
// altsaa laengere ned OG koster faerre kald.
const SIDESTOERRELSE = 200

// ═══════════════════════════════════════════════════════════════
//  ALLOWLIST — laes dette foer du roerer noget herunder.
//
//  Vi laeser KUN de felter, der staar navngivet i `laesResidence`. Alt
//  andet i kildens objekt kasseres uden at blive kigget paa.
//
//  Grunden er ikke ryddelighed. Kildens datamodel baerer felter med
//  interne sagsbehandlernoter — navne, telefonnumre og mailadresser paa
//  NUVAERENDE lejere. De personoplysninger har vi hverken ret til eller
//  brug for, og de maa aldrig laeses, skrives eller logges.
//
//  En denylist ("kassér comment") ville daekke i dag og svigte i morgen:
//  tilfoejer kilden et nyt felt med samme slags indhold, ville det flyde
//  lige igennem. En allowlist svigter den anden vej — nye felter bliver
//  ignoreret, indtil nogen bevidst tilfoejer dem her.
//
//  Derfor: udvid ALDRIG denne funktion med spread (`...raw`), med en
//  loekke over Object.keys, eller med et felt du ikke har set indholdet af
//  paa mindst ti rigtige poster.
//
//  Ved skrivende stund findes `comment` ikke i soege-API'ets svar — 72
//  poster gennemgaaet. Allowlisten er der for den dag, det aendrer sig.
// ═══════════════════════════════════════════════════════════════

/** Raa post fra kilden. Vi lover intet om, hvad der ellers er i den. */
type Ukendt = Record<string, unknown>

const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

interface Lejelinje { beskrivelse: string; beloeb: number }

/** rents[] — kun beskrivelse og beloeb. Resten af linjen roeres ikke. */
function laesRents(v: unknown): Lejelinje[] {
  if (!Array.isArray(v)) return []
  const ud: Lejelinje[] = []
  for (const l of v as Ukendt[]) {
    const beskrivelse = tekst(l?.['description'])
    const a = l?.['amount'] as Ukendt | undefined
    const beloeb = tal(a?.['amount'])
    if (beskrivelse && beloeb != null) ud.push({ beskrivelse, beloeb })
  }
  return ud
}

/** openHouses[] — kun startDate. */
function laesAabentHus(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined
  const nu = Date.now()
  const kommende = (v as Ukendt[])
    .map((o) => tekst(o?.['startDate']))
    .filter((s): s is string => !!s)
    .map((s) => new Date(s))
    .filter((d) => !isNaN(+d) && +d >= nu)
    .sort((a, b) => +a - +b)
  return kommende[0]?.toISOString()
}

/** media.images[] — en liste af relative stier. */
function laesBilleder(v: unknown): string[] {
  const m = v as Ukendt | undefined
  const imgs = m?.['images']
  if (!Array.isArray(imgs)) return []
  return (imgs as unknown[])
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => (s.startsWith('http') ? s : ORIGIN + s))
}

/** Verificerede propertyType-GUID'er. Ukendte giver null — vi gaetter ikke. */
const BOLIGTYPER: Record<string, string> = {
  '0b119adc-83b4-4d51-981c-4b3c26d58d50': 'Lejlighed',
}
const ukendteTyper = new Set<string>()

/** Aconto-linjer -> vores tre navngivne poster. Ukendte linjer ignoreres her
 *  og fanges bagefter som uspecificeret rest. */
function acontoFraLinjer(linjer: Lejelinje[]) {
  let varme: number | undefined, vand: number | undefined, el: number | undefined
  for (const l of linjer) {
    const d = l.beskrivelse.toLowerCase().replace(/[^a-zæøå]/g, '')
    if (!/^(a?c?o?n?t?o?|ac|a)/.test(d) && !/varme|vand|el(ektricitet)?$/.test(d)) continue
    if (/varme/.test(d)) varme = (varme ?? 0) + l.beloeb
    else if (/vand/.test(d)) vand = (vand ?? 0) + l.beloeb
    else if (/^(aconto|ac|aconto)?el$|elektricitet|acontoel/.test(d)) el = (el ?? 0) + l.beloeb
  }
  return { varme, vand, el }
}

/**
 * ALLOWLISTEN. Kun felterne herunder laeses ud af kildens objekt.
 * Tilfoejer kilden nye felter, bliver de ignoreret — med vilje.
 */
function laesResidence(raw: Ukendt): RawListing | null {
  const id = tekst(raw['id'])
  const uri = tekst(raw['uri'])
  if (!id || !uri) return null

  const street = tekst(raw['street'])
  const number = tal(raw['number'])
  const letter = tekst(raw['letter'])
  const floor = raw['floor']
  const door = tekst(raw['door'])
  const postalCode = tal(raw['postalCode'])
  const city = tekst(raw['city'])

  const area = tal(raw['area'])
  const rooms = tal(raw['rooms'])
  const rent = tal(raw['rent'])
  const aconto = tal(raw['aconto'])
  const rents = laesRents(raw['rents'])
  const monthsOfDeposit = tal(raw['monthsOfDeposit'])
  const monthsOfPrepaid = tal(raw['monthsOfPrepaid'])
  const availableFrom = tekst(raw['availableFrom'])
  const propertyTypeGuid = tekst(raw['propertyType'])
  const applicationTypeRaw = tekst(raw['applicationType'])
  const rentModel = tekst(raw['rentModel'])
  const latitude = tal(raw['latitude'])
  const longitude = tal(raw['longitude'])
  const imageUrls = laesBilleder(raw['media'])
  const openHouseAt = laesAabentHus(raw['openHouses'])
  const created = tekst(raw['created'])
  const updated = tekst(raw['updated'])
  // ── slut paa allowlisten ──

  if (!street || postalCode == null) return null

  // Adressen samles til den kanoniske form, vores parser laeser.
  const husnr = number != null ? `${number}${letter ?? ''}` : ''
  const etageDoer = [
    floor != null && floor !== '' ? `${floor}.` : null,
    door ?? null,
  ].filter(Boolean).join(' ')
  const address = [
    [street, husnr].filter(Boolean).join(' '),
    etageDoer || null,
    [postalCode, city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')

  // ── Oekonomi. Alt til oere. ──
  const rentOere = rent != null ? kronerTilOere(rent) : undefined
  const acontoOere = aconto != null ? kronerTilOere(aconto) : undefined
  const { varme, vand, el } = acontoFraLinjer(rents)
  const varmeO = varme != null ? kronerTilOere(varme) : undefined
  const vandO = vand != null ? kronerTilOere(vand) : undefined
  const elO = el != null ? kronerTilOere(el) : undefined

  // Kilden oplyser én samlet aconto OG en delvis opdeling. Resten er reel
  // udgift, som bare ikke er specificeret — den skal med i totalen, ellers
  // undervurderer vi det, lejeren betaler.
  let varmeUd = varmeO, vandUd = vandO, elUd = elO
  let restO: number | undefined
  if (acontoOere != null) {
    const specificeret = (varmeO ?? 0) + (vandO ?? 0) + (elO ?? 0)
    const rest = acontoOere - specificeret
    if (rest > 0) {
      restO = rest
    } else if (rest < 0) {
      // Opdelingen overstiger kildens egen aconto-total. Saa forstaar vi ikke
      // tallene, og saa oplyser vi ingen oekonomi ud over huslejen — boligen
      // beholdes, men uden en total vi ikke kan staa inde for.
      varmeUd = vandUd = elUd = undefined
      restO = undefined
    }
  }

  // Indflytningspris = leje x (depositum + forudbetalt + foerste maaned)
  //                    + aconto. Kun naar alle led kendes.
  const moveInCost =
    rentOere != null && monthsOfDeposit != null && monthsOfPrepaid != null && acontoOere != null
      ? rentOere * (monthsOfDeposit + monthsOfPrepaid + 1) + acontoOere
      : undefined

  const boligtype = propertyTypeGuid ? BOLIGTYPER[propertyTypeGuid] : undefined
  if (propertyTypeGuid && !boligtype) ukendteTyper.add(propertyTypeGuid)

  const applicationType =
    applicationTypeRaw === 'Regular' ? 'regular' as const
    : applicationTypeRaw === 'WaitingList' ? 'waiting_list' as const
    : undefined

  return {
    externalKey: id,
    sourceUrl: ORIGIN + uri,
    address,
    postalCode: String(postalCode),
    sizeM2: area,
    rooms,
    propertyType: boligtype,
    availableFrom,
    rentMonthly: rentOere,
    utilitiesHeat: varmeUd,
    utilitiesWater: vandUd,
    utilitiesElectricity: elUd,
    utilitiesOther: restO,
    moveInCost,
    lat: latitude,
    lng: longitude,
    applicationType,
    rentModel,
    openHouseAt,
    sourceCreatedAt: created,
    sourceUpdatedAt: updated,
    // Kildens RAA ord. `applicationType` normaliseres ovenfor til legacy-
    // kolonnen; her gemmes ordet selv, saa kontrakten kan slaa det op.
    // Datoen gemmes ogsaa raat — kontrakten siger selv, at dens betydning
    // er uafklaret, og saa giver den ingen tidsevidens. Lossless foerst.
    availability: {
      ...(applicationTypeRaw ? { rawApplicationType: applicationTypeRaw } : {}),
      ...(() => {
        const d = isoDato(availableFrom ? availableFrom.slice(0, 10) : null)
        return d ? { sourceAvailabilityDate: d } : {}
      })(),
    },
    amenities: [],
    imageUrls,
  }
}

// ═══════════════════════════════════════════════════════════════

async function hentSide(page: number, filters: Record<string, string[]>): Promise<Ukendt[]> {
  const res = await politeFetch(API, 3, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, pageSize: SIDESTOERRELSE, filters }),
  })
  if (!res.ok) throw new Error(`findbolig /api/search gav ${res.status}`)
  const j = await res.json() as { results?: unknown }
  return Array.isArray(j.results) ? j.results as Ukendt[] : []
}

export function findboligAdapter(filters: Record<string, string[]> = {}): SourceAdapter {
  // discover() henter hele objektet, saa extract() ikke behoever et kald til.
  // Cachen er derfor ogsaa grunden til, at detaljesiden aldrig roeres.
  const cache = new Map<string, RawListing>()

  const hentAlt = async (): Promise<RawListing[]> => {
    cache.clear()
    const ud: RawListing[] = []
    for (let page = 0; page < 200; page++) {
      const raekker = await hentSide(page, filters)
      if (!raekker.length) break
      for (const r of raekker) {
        // "Property" er en ejendom, ikke et lejemaal.
        if (r['$type'] !== 'Residence') continue
        const b = laesResidence(r)
        if (!b) continue
        cache.set(b.sourceUrl, b)
        ud.push(b)
      }
    }
    if (ukendteTyper.size) {
      console.warn(`  findbolig: ukendte propertyType-GUID'er (boligtype sat til null): `
        + [...ukendteTyper].join(', '))
    }
    return ud
  }

  return {
    id: 'findbolig',
    sourceType: 'feed',
    host: 'findbolig.nu',

    async discover(): Promise<DiscoveredListing[]> {
      const alle = await hentAlt()
      return alle.map((b) => ({ externalKey: b.externalKey, url: b.sourceUrl }))
    },

    async extract(url: string): Promise<RawListing> {
      const b = cache.get(url)
      if (!b) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)
      return b
    },
  }
}
