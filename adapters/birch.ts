// ═══════════════════════════════════════════════════════════════
//  Birch Ejendomme — https://birchejendomme.dk/find-bolig
//
//  INGEN aftale endnu — robots.txt tillader alt (tom Disallow, maalt
//  2026-09-06), og feedet er sidens eget datagrundlag (bundet i
//  find-bolig-sidens data-feed-url).
//
//  ── Om kilden ────────────────────────────────────────────────
//  Umbraco-site med eget JSON-feed: `/bolig-feed?onlyvacant=1` giver
//  KUN ledige enheder (alle med kildens egne markeringer Status
//  "Ledig", Vacancy "vacant", IsVacant true) med leje, m2, vaerelser,
//  boligtype, ledig-fra-dato og billedgalleri. Pagineres med
//  `&pagenumber=`; feedet oplyser selv NoOfPages, og vi foelger det.
//  Detaljesiden laegger depositum-BELOEBET til (kildens eget tal i
//  faktatabellen) — derfor spider, ikke feed.
//
//  ── Hvad kilden IKKE oplyser ─────────────────────────────────
//  Ingen aconto: faktatabellen siger ordret «A/C vand & varme:
//  Afregnes med forsyningsselskab» — lejeren afregner selv, og der
//  findes intet beloeb at hoeste. totalMonthly forbliver derfor null
//  (vi kender ikke forsyningsudgiften), og det er kildens graense,
//  ikke vores. Ingen forudbetalt leje naevnt. Aabent hus-felterne
//  (EventText/ShowEvent) hoestes ikke endnu.
//
//  Bemaerk: kilden angiver selv postnummer 8000 for Engsoe-kvarteret
//  i Risskov (reelt 8240). Vi viderebringer kildens egne tal;
//  adressevasken mod DAWA afgoer den slags centralt.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { parseDanskBeloebTilOere } from '../lib/money'

const BASE = 'https://birchejendomme.dk'
const FEED = `${BASE}/bolig-feed?onlyvacant=1`

/** Feedets galleri-URL'er er absolutte paa kildens eget domaene —
 *  1.412 af 1.412 maalt 2026-09-06. Skal staa i TILLADTE_VAERTER. */
const BILLEDVAERT = 'birchejendomme.dk'

/** Loft mod en defekt NoOfPages. 59 enheder = 5 sider. */
const MAKS_SIDER = 20

export type Ukendt = Record<string, unknown>
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
/** Feedet skriver tal som strenge ("6800", "47"). */
const talStreng = (v: unknown): number | undefined => {
  const s = tekst(v)
  if (!s || !/^\d+([.,]\d+)?$/.test(s)) return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Kildens visningsdato «01.02.2027» → kalenderdag. */
const dagFraDDMMYYYY = (s: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  return m ? isoDato(`${m[3]}-${m[2]}-${m[1]}`) : null
}

/**
 * Ét element fra feedet → grundlaget for en RawListing. Depositum
 * kommer fra detaljesiden. Eksporteret KUN til proeven.
 */
export function laesFeed(r: Ukendt): RawListing | null {
  const noegle = tekst(r['ContentId'])
  const sti = tekst(r['Link'])
  const navn = tekst(r['Name'])
  if (!noegle || !sti || !navn) return null

  const postnr = tekst(r['Zipcode'])
  const leje = talStreng(r['Rent'])
  const dato = tekst(r['StatusDateLabel'])
    ? dagFraDDMMYYYY(tekst(r['StatusDateLabel'])!)
    : null

  const faciliteter: string[] = []
  if (r['DomesticAnimalsAllowed'] === true) faciliteter.push('kæledyr tilladt')
  // Feltet hedder BalconyTerrace og skelner ikke — ordet goer det
  // heller ikke, samme valg som hos CEJ.
  if (r['BalconyTerrace'] === true) faciliteter.push('altan eller terrasse')
  if (r['PrivateParking'] === true || r['SharedParking'] === true) {
    faciliteter.push('parkering')
  }

  const billeder = (Array.isArray(r['ResidenceImages']) ? r['ResidenceImages'] : [])
    .map((b) => tekst((b as Ukendt)?.['jpegCropLarge']) ?? tekst((b as Ukendt)?.['jpegCrop']))
    .filter((u): u is string => {
      if (!u) return false
      try { return new URL(u).host === BILLEDVAERT } catch { return false }
    })

  return {
    // Umbraco-ContentId: stabilt; Link-stien kan aendres med adressen.
    externalKey: noegle,
    sourceUrl: `${BASE}${sti}`,
    // "Arresøvej 5, st. 1" + postnr og by — den form adressevasken laeser.
    address: [navn, [postnr, tekst(r['City'])].filter(Boolean).join(' ')]
      .filter(Boolean).join(', '),
    postalCode: postnr,
    sizeM2: talStreng(r['AreaSize']),
    rooms: talStreng(r['NoOfRooms']),
    propertyType: tekst(r['Type']),
    rentMonthly: leje != null ? leje * 100 : undefined,
    availableFrom: dato ?? undefined,
    amenities: faciliteter,
    imageUrls: billeder,
    availability: {
      rawStatus: tekst(r['Status']) ?? null,
      ...(dato ? { sourceAvailabilityDate: dato } : {}),
    },
  }
}

/**
 * Detaljesidens faktatabel: th/td-par. Kun depositum-BELOEBET hoestes —
 * lejen kommer fra feedet, og A/C-raekken baerer tekst, ikke tal.
 * Eksporteret KUN til proeven.
 */
export function laesDetalje(html: string): { deposit?: number } {
  const m = /<th[^>]*>\s*Depositum\s*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i.exec(html)
  const beloeb = m ? parseDanskBeloebTilOere(m[1]) : null
  return beloeb != null ? { deposit: beloeb } : {}
}

export function birchAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  const hentSide = async (nr: number): Promise<Ukendt> => {
    const url = nr === 1 ? FEED : `${FEED}&pagenumber=${nr}`
    const res = await politeFetch(url)
    if (!res.ok) throw new Error(`birch ${url} gav ${res.status}`)
    return await res.json() as Ukendt
  }

  return {
    id: 'birch',
    sourceType: 'spider',
    host: 'birchejendomme.dk',

    async discover(): Promise<DiscoveredListing[]> {
      cache.clear()
      const foerste = await hentSide(1)
      const antalSider = typeof foerste['NoOfPages'] === 'number' ? foerste['NoOfPages'] : 1
      if (antalSider > MAKS_SIDER) {
        throw new Error(`birch: ${antalSider} sider — over loftet paa ${MAKS_SIDER}, noget er galt`)
      }

      const ud: DiscoveredListing[] = []
      const set = new Set<string>()
      for (let nr = 1; nr <= antalSider; nr++) {
        const svar = nr === 1 ? foerste : await hentSide(nr)
        const raekker = Array.isArray(svar['residencesData']) ? svar['residencesData'] : []
        for (const raa of raekker) {
          const b = laesFeed((raa ?? {}) as Ukendt)
          if (!b || set.has(b.externalKey)) continue
          set.add(b.externalKey)
          cache.set(b.sourceUrl, b)
          ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
        }
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const grund = cache.get(url)
      if (!grund) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)

      const res = await politeFetch(url)
      if (!res.ok) throw new Error(`birch ${url} gav ${res.status}`)
      const d = laesDetalje(await res.text())

      return { ...grund, ...(d.deposit != null ? { deposit: d.deposit } : {}) }
    },
  }
}
