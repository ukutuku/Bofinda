// ═══════════════════════════════════════════════════════════════
//  Anden dummy-kilde. TESTDATA.
//
//  Findes for at bevise dedup PAA TVAERS af kilder: den foerste bolig er
//  den samme som dummy/a1, men skrevet som en anden kilde ville skrive
//  den — "Noerrebrogade" i stedet for "Nørrebrogade", "56B" uden
//  mellemrum, "3 tv" uden punktum, "Kbh N" i stedet for "København N".
//  Adressenoeglen skal blive den samme.
// ═══════════════════════════════════════════════════════════════

import { maaTestkilderKoere } from './index'
import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { keyFromUrl } from '../lib/adapter'
import { kronerTilOere as kr } from '../lib/money'

const BASE = 'https://dummy2.invalid/listing'

type Post = Omit<RawListing, 'externalKey' | 'sourceUrl'> & { id: string }

const POSTER: Post[] = [
  {
    id: 'b1',
    // Samme bolig som dummy/a1, anderledes skrevet.
    address: 'Noerrebrogade 56B, 3 tv, 2200 Kbh N',
    propertyType: 'apartment', sizeM2: 86, rooms: 3,
    rentMonthly: kr(12500), utilitiesHeat: kr(650),
    utilitiesWater: kr(200), utilitiesElectricity: kr(400),
    amenities: ['altan'],
    imageUrls: [`${BASE}/b1/1.jpg`],
  },
  {
    id: 'b2',
    // Villa: ingen etage og doer. Bliver 'access', ikke 'unit'.
    address: 'Birkevej 4, 2830 Virum',
    propertyType: 'Villa', sizeM2: 165, rooms: 5,
    rentMonthly: kr(24000), utilitiesHeat: kr(1200),
    amenities: ['have', 'carport'],
    imageUrls: [`${BASE}/b2/1.jpg`],
  },
  {
    id: 'b3',
    // Uden postnummer: kan ikke stedfaestes. Skal blive 'failed'.
    address: 'Et sted i midtbyen',
    propertyType: 'Lejlighed', rooms: 2,
    rentMonthly: kr(7500),
    amenities: [],
    imageUrls: [],
  },
]

export const dummy2Adapter: SourceAdapter = {
  id: 'dummy2',
  sourceType: 'spider',
  host: 'dummy2.invalid',

  async discover(): Promise<DiscoveredListing[]> {
    // Ikke NODE_ENV: kun den kodevej, der navngiver kilden udtrykkeligt,
    // taender flaget. Se adapters/index.ts.
    if (!maaTestkilderKoere()) {
      throw new Error(
        'dummy2 er en testkilde og maa kun køres, når den navngives: '
        + 'npm run import -- dummy2',
      )
    }
    return Promise.all(POSTER.map(async (p) => {
      const url = `${BASE}/${p.id}`
      return { externalKey: await keyFromUrl(url), url }
    }))
  },

  async extract(url: string): Promise<RawListing> {
    const id = url.split('/').pop()
    const p = POSTER.find((x) => x.id === id)
    if (!p) throw new Error(`ukendt dummy2-bolig: ${url}`)
    const { id: _, ...rest } = p
    return { ...rest, externalKey: await keyFromUrl(url), sourceUrl: url }
  },
}
