// ═══════════════════════════════════════════════════════════════
//  Balder — https://www.balder.dk/lejeboliger
//
//  Vi henter fra deres SOEGE-API, ikke fra HTML'en. Det er aftalt med
//  Balder selv.
//
//  ── Om noeglen ────────────────────────────────────────────────
//  `BALDER_API_KEY` er den soegenoegle, der ligger i Balders eget
//  offentlige frontend-bundt paa www.balder.dk. **Den bruges dér EFTER
//  BALDERS EGEN ANVISNING** — de har bekraeftet, at det er den, vi skal
//  bruge. Den er ikke gravet ud paa egen haand, og det er derfor, den
//  staar i .env og ikke i denne fil: skifter den, rettes den ét sted.
//  Se docs/kildetilladelser.md for hvem der gav lov og hvornaar.
//
//  ── Om robots.txt ────────────────────────────────────────────
//  `www.balder.dk/robots.txt` har `Disallow: /api/`, og
//  `api.balder.dk/robots.txt` har `Disallow: /` til alle. Vi henter
//  alligevel, fordi rettighedshaveren selv har givet lov: robots.txt er
//  et signal til fremmede, ikke en aftale. Det er en BEVIDST undtagelse
//  fra husreglen, ikke en forglemmelse — se CLAUDE.md.
//
//  ── Om kilden ────────────────────────────────────────────────
//  Indekset `leases` er en Meilisearch med ~4.500 lejemaal, hvoraf de
//  fleste er udlejet. Vi tager kun `status = "Ledig"` — "Reserveret"
//  er ikke ledig, og en bolig man ikke kan faa, hoerer ikke til i en
//  soegning.
//
//  Ét kald giver hele saettet. `discover()` cacher det, og `extract()`
//  laeser fra cachen — samme moenster som findbolig. Det er ikke en
//  optimering: det er grunden til, at vi aldrig roerer detaljesiden.
//
//  ── Hvad kilden IKKE oplyser ─────────────────────────────────
//  Der er ingen el-aconto. Feltlisten har `payment_heating` og
//  `payment_water` og intet tredje, saa Balders boliger faar aldrig
//  "fuld oekonomi" hos os. Det er kildens graense, ikke vores — og vi
//  gaetter ikke et tal, der ville forplante sig til totalen.
//  Der er heller ingen "ledig fra"-dato. Den staar tom.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'

const API = 'https://api.balder.dk/indexes/leases/search'
const SIDE = 'https://www.balder.dk/lejeboliger'

/**
 * Kildens elleve boolean-flag -> vores ordforraad.
 *
 * `elevator`, `altan` og `terrasse` er dem, soegefiltrene rammer — de skal
 * staa ORDRET som i `FACILITET` i lib/faciliteter.ts, ellers matcher de
 * ingenting. To tagformer, `has_roof_terrace` og `has_terrace_garden`,
 * falder begge ned i `terrasse`; det er dét ord, filteret kender.
 *
 * De oevrige otte gemmes ogsaa. Modellen har plads: `amenities` er en
 * jsonb-liste uden fast ordforraad, saa der udelades ingenting. De filtrerer
 * ikke i dag, men de staar paa boligsiden, og de er kildens egne oplysninger
 * — at smide dem vaek ville vaere at vide mindre end vi fik.
 */
const FACILITETER: Record<string, string> = {
  has_elevator: 'elevator',
  has_balcony: 'altan',
  has_terrace_garden: 'terrasse',
  has_roof_terrace: 'terrasse',
  has_dishwasher: 'opvaskemaskine',
  has_washing_machine: 'vaskemaskine',
  has_tumble_dryer: 'tørretumbler',
  has_parking: 'parkering',
  has_charging_station: 'ladestander',
  has_courtyard: 'gårdhave',
  has_playground: 'legeplads',
}

export type Ukendt = Record<string, unknown>
const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
/** Kilden regner i kroner. Vi regner i oere, altid. */
const oere = (v: unknown): number | undefined => {
  const n = tal(v)
  return n == null ? undefined : kronerTilOere(n)
}

/** Eksporteret KUN til proeven: et frossent hit gennem parsningen. */
export function laes(h: Ukendt): RawListing | null {
  const slug = tekst(h['slug'])
  const id = tekst(h['id']) ?? tekst(h['salesforce_id'])
  const vej = tekst(h['street'])
  if (!slug || !id || !vej) return null

  const postnr = tekst(h['postal_code'])
  const by = tekst(h['city'])
  const geo = h['_geo'] as { lat?: number; lng?: number } | undefined

  const faciliteter = [...new Set(
    Object.entries(FACILITETER).filter(([k]) => h[k] === true).map(([, v]) => v),
  )]

  return {
    // Salesforce-id'et, ikke slug'en: adressen kan rettes, id'et staar fast.
    externalKey: id,
    sourceUrl: `${SIDE}/${slug}`,
    // "Strandlodsvej 63 H, 4. mf., 2300 Koebenhavn S" — den form
    // adressevasken laeser. Vi samler den ikke af loesdele bagefter.
    address: [vej, [postnr, by].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    postalCode: postnr,
    sizeM2: tal(h['gross_area']),
    rooms: tal(h['number_of_rooms']),
    propertyType: 'lejlighed',
    rentMonthly: oere(h['rent']),
    utilitiesHeat: oere(h['payment_heating']),
    utilitiesWater: oere(h['payment_water']),
    // Kilden oplyser indflytningsprisen selv (`combined_upfront_payment`).
    // Vi regner den ikke ud af depositum- og forudbetalingsmaanederne:
    // et tal vi selv har lagt sammen, ville se lige saa sikkert ud som
    // kildens eget, og det er det ikke.
    moveInCost: oere(h['combined_upfront_payment']),
    lat: geo?.lat,
    lng: geo?.lng,
    amenities: faciliteter,
    imageUrls: Array.isArray(h['images'])
      ? (h['images'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    // Hvad kilden SAGDE — fortolkningen bor i lib/kildekontrakt.ts.
    // `status` er kildens eget ord ("Ledig" er det eneste, filteret slipper
    // igennem, men det skrives ikke af: skulle filteret aendres, skal
    // faktaet stadig vaere kildens). `acquisition_date` er date-only;
    // eksplicit null bevares som null, en misdannet vaerdi udelades —
    // den kan ikke repraesenteres som kalenderdag.
    availability: {
      rawStatus: tekst(h['status']) ?? null,
      ...(h['acquisition_date'] === null
        ? { sourceAvailabilityDate: null }
        : (() => {
            const d = isoDato(h['acquisition_date'])
            return d ? { sourceAvailabilityDate: d } : {}
          })()),
    },
  }
}

export function balderAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  return {
    id: 'balder',
    sourceType: 'feed',
    // Rate-limiten hoerer til der, hvor vi faktisk henter.
    host: 'api.balder.dk',

    async discover(): Promise<DiscoveredListing[]> {
      const noegle = process.env.BALDER_API_KEY
      if (!noegle) {
        throw new Error(
          'BALDER_API_KEY mangler. Noeglen ligger i Balders eget frontend-bundt '
          + 'paa www.balder.dk efter deres anvisning — se docs/kildetilladelser.md.',
        )
      }
      cache.clear()

      const ud: DiscoveredListing[] = []
      // Meilisearch lofter selv `limit`; vi bladrer, saa et hoejere loft
      // hos dem ikke stille afkorter vores saet.
      for (let offset = 0; offset < 5000; offset += 200) {
        const res = await politeFetch(API, 3, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${noegle}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            q: '',
            limit: 200,
            offset,
            // "Reserveret" er ikke ledig.
            filter: 'status = "Ledig"',
          }),
        })
        if (!res.ok) throw new Error(`balder ${API} gav ${res.status}`)
        const svar = await res.json() as { hits?: Ukendt[] }
        const hits = svar.hits ?? []
        if (!hits.length) break

        for (const h of hits) {
          const b = laes(h)
          if (!b) continue
          cache.set(b.sourceUrl, b)
          ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
        }
        if (hits.length < 200) break
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const b = cache.get(url)
      if (!b) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)
      return b
    },
  }
}
