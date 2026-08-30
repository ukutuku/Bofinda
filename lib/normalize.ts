// ═══════════════════════════════════════════════════════════════
//  Normalisering: RawListing -> raekke i listings.
//
//  Ligger centralt, ikke i adapteren. En ny kilde skal vaere én fil, der
//  laeser — ikke én der ogsaa fortolker.
//
//  Grundreglen hele vejen igennem: et felt kilden ikke oplyser, bliver
//  null. Ikke nul, ikke et estimat, ikke et eksempelbillede.
// ═══════════════════════════════════════════════════════════════

import type { RawListing } from './adapter'
import { vaskAdresse } from './address'
import { oereTilKroner } from './money'

export type Boligtype =
  | 'lejlighed' | 'hus' | 'raekkehus' | 'vaerelse' | 'studiebolig' | 'andet'

/**
 * Kildens ord -> vores enum. Kan typen ikke afgoeres, returneres null.
 * 'andet' betyder "kendt, og ingen af de andre" — ikke "vi ved det ikke".
 */
export function normaliserBoligtype(raw: string | null | undefined): Boligtype | null {
  if (!raw) return null
  const s = raw.toLowerCase().trim()
  const tabel: [RegExp, Boligtype][] = [
    [/r(æ|ae)kkehus|kaedehus|tv(æ|ae)rhus|townhouse/, 'raekkehus'],
    [/lejlighed|apartment|flat|etagebolig/, 'lejlighed'],
    [/studiebolig|kollegie|ungdomsbolig|student/, 'studiebolig'],
    [/v(æ|ae)relse|room|delebolig|bofaellesskab/, 'vaerelse'],
    [/villa|hus|house|bungalow|landejendom/, 'hus'],
  ]
  for (const [re, type] of tabel) if (re.test(s)) return type
  return null
}

const ACONTO = ['heat', 'water', 'electricity', 'other'] as const

export interface Total {
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
}

/**
 * Summen af husleje og aconto — og listen over hvad der faktisk er talt med.
 *
 * Saettes KUN naar huslejen er kendt OG mindst én aconto-post er kendt.
 * Kender vi kun huslejen, ville en "total" lig huslejen paastaa, at der
 * ikke er andre udgifter. Det ved vi ikke, saa totalen forbliver null.
 *
 * Det er hele forskellen paa vores loefte og konkurrenternes tal.
 */
export function beregnTotal(r: RawListing): Total {
  if (r.rentMonthly == null) return { totalMonthly: null, totalMonthlyComponents: null }

  const med: string[] = ['rent']
  let sum = r.rentMonthly
  const poster = {
    heat: r.utilitiesHeat,
    water: r.utilitiesWater,
    electricity: r.utilitiesElectricity,
    other: r.utilitiesOther,
  }
  for (const n of ACONTO) {
    const v = poster[n]
    if (v != null) { sum += v; med.push(n) }
  }

  if (med.length === 1) return { totalMonthly: null, totalMonthlyComponents: null }
  return { totalMonthly: sum, totalMonthlyComponents: med }
}

/**
 * "Fuld oekonomi" kraever husleje OG alle tre navngivne aconto-poster.
 * 'other' taeller ikke med: uspecificeret aconto kan indeholde hvad som helst,
 * og maa ikke kunne lyve en bolig op i den kategori, loeftet handler om.
 */
export const erFuldOekonomi = (k: string[] | null): boolean =>
  k != null && ['rent', 'heat', 'water', 'electricity'].every((n) => k.includes(n))

const MDR = ['januar','februar','marts','april','maj','juni',
             'juli','august','september','oktober','november','december']

/**
 * Beskrivelsen bygges af vores egne strukturerede felter. Kildens
 * broedtekst kopieres aldrig — fakta er frie, prosa er ikke. Sidegevinsten
 * er ensartet tone paa tvaers af alle kilder.
 *
 * Kun saetninger for felter vi faktisk har. Ingen udfyldning.
 */
export function genererBeskrivelse(f: {
  propertyType: Boligtype | null
  rooms: number | null
  sizeM2: number | null
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  rentMonthly: number | null
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
  availableFrom: Date | null
}): string | null {
  const kr = (o: number) => oereTilKroner(o).toLocaleString('da-DK')
  const s: string[] = []

  const type = f.propertyType ? { lejlighed:'Lejlighed', hus:'Hus', raekkehus:'Rækkehus',
    vaerelse:'Værelse', studiebolig:'Studiebolig', andet:'Bolig' }[f.propertyType] : 'Bolig'
  const dele = [
    f.rooms != null ? `${f.rooms} ${f.rooms === 1 ? 'værelse' : 'værelser'}` : null,
    f.sizeM2 != null ? `${f.sizeM2} m²` : null,
  ].filter(Boolean)
  const sted = [f.street, f.houseNumber].filter(Boolean).join(' ')
  const bydel = [f.postalCode, f.city].filter(Boolean).join(' ')

  let f1 = type
  if (dele.length) f1 += ` på ${dele.join(' og ')}`
  if (sted) f1 += ` på ${sted}`
  if (bydel) f1 += sted ? ` i ${bydel}` : ` i ${bydel}`
  s.push(f1 + '.')

  if (f.rentMonthly != null) {
    if (f.totalMonthly != null && f.totalMonthlyComponents) {
      const navne: Record<string, string> = {
        heat: 'varme', water: 'vand', electricity: 'el', other: 'øvrig aconto',
      }
      const aconto = f.totalMonthlyComponents.filter((k) => k !== 'rent').map((k) => navne[k] ?? k)
      // Dansk opremsning: "varme, vand og el" — ikke "varme og vand og el".
      const liste = aconto.length > 1
        ? `${aconto.slice(0, -1).join(', ')} og ${aconto.at(-1)}`
        : aconto[0]
      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Med ${liste} er den samlede månedlige udgift `
        + `${kr(f.totalMonthly)} kr.`)
    } else {
      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Kilden oplyser ikke aconto, så den samlede udgift kendes ikke.`)
    }
  }

  if (f.availableFrom) {
    const d = f.availableFrom
    s.push(`Ledig fra ${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}.`)
  }

  return s.length ? s.join(' ') : null
}

export interface NormaliseretBolig {
  externalKey: string
  sourceUrl: string
  addressRaw: string
  street: string | null
  houseNumber: string | null
  floor: string | null
  door: string | null
  postalCode: string | null
  city: string | null
  unitAddressUuid: string | null
  accessAddressUuid: string | null
  addressMatchLevel: 'unit' | 'access' | 'failed'
  lat: string | null
  lng: string | null
  propertyType: Boligtype | null
  sizeM2: number | null
  rooms: number | null
  availableFrom: Date | null
  rentMonthly: number | null
  utilitiesHeat: number | null
  utilitiesWater: number | null
  utilitiesElectricity: number | null
  utilitiesOther: number | null
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
  moveInCost: number | null
  applicationType: 'regular' | 'waiting_list' | null
  rentModel: string | null
  openHouseAt: Date | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  amenities: string[]
  description: string | null
  imageUrls: string[]
}

const dato = (s: string | undefined | null): Date | null => {
  if (!s) return null
  const d = new Date(s)
  return isNaN(+d) ? null : d
}

export async function normaliser(r: RawListing): Promise<NormaliseretBolig> {
  // Kildens eget postnummer bruges som fallback, hvis strengen ikke bar det.
  const adr = await vaskAdresse(r.address, { postalCode: r.postalCode })
  const postalCode = adr.postalCode ?? r.postalCode ?? null

  const propertyType = normaliserBoligtype(r.propertyType)
  const { totalMonthly, totalMonthlyComponents } = beregnTotal(r)
  const availableFrom = r.availableFrom ? new Date(r.availableFrom) : null

  return {
    externalKey: r.externalKey,
    sourceUrl: r.sourceUrl,
    addressRaw: r.address,
    street: adr.street,
    houseNumber: adr.houseNumber,
    floor: adr.floor,
    door: adr.door,
    postalCode,
    city: adr.city,
    unitAddressUuid: adr.unitAddressUuid,
    accessAddressUuid: adr.accessAddressUuid,
    addressMatchLevel: adr.addressMatchLevel,
    // Kildens egne koordinater vinder. Vaskeren har dem ikke endnu.
    lat: r.lat != null ? String(r.lat) : adr.lat,
    lng: r.lng != null ? String(r.lng) : adr.lng,
    propertyType,
    sizeM2: r.sizeM2 ?? null,
    rooms: r.rooms ?? null,
    availableFrom: availableFrom && !isNaN(+availableFrom) ? availableFrom : null,
    rentMonthly: r.rentMonthly ?? null,
    utilitiesHeat: r.utilitiesHeat ?? null,
    utilitiesWater: r.utilitiesWater ?? null,
    utilitiesElectricity: r.utilitiesElectricity ?? null,
    utilitiesOther: r.utilitiesOther ?? null,
    totalMonthly,
    totalMonthlyComponents,
    moveInCost: r.moveInCost ?? null,
    applicationType: r.applicationType ?? null,
    rentModel: r.rentModel ?? null,
    openHouseAt: dato(r.openHouseAt),
    sourceCreatedAt: dato(r.sourceCreatedAt),
    sourceUpdatedAt: dato(r.sourceUpdatedAt),
    // Ingen pladsholder. Fandt adapteren ingen billeder, er listen tom.
    imageUrls: r.imageUrls ?? [],
    amenities: r.amenities ?? [],
    description: genererBeskrivelse({
      propertyType, rooms: r.rooms ?? null, sizeM2: r.sizeM2 ?? null,
      street: adr.street, houseNumber: adr.houseNumber, postalCode, city: adr.city,
      rentMonthly: r.rentMonthly ?? null, totalMonthly, totalMonthlyComponents,
      availableFrom,
    }),
  }
}
