// ═══════════════════════════════════════════════════════════════
//  Dummy-kilde. TESTDATA — ikke rigtige boliger.
//
//  Findes udelukkende for at koere importlaget fra ende til anden, foer
//  der er skrevet en rigtig adapter. Den naegter at koere i produktion.
//
//  Datasaettet er valgt til at ramme reglerne, ikke til at se paent ud:
//    1  fuld oekonomi (husleje + varme + vand + el)  -> total, fuld
//    2  husleje + varme                              -> total, ikke fuld
//    3  kun husleje                                  -> total er NULL
//    4  ingen billeder, ukendt boligtype             -> tom liste, null
//    5  ukendt areal og vaerelser                    -> null, ingen gaet
//
//  DUMMY_SET=2 giver et andet saet, hvor bolig 3 er forsvundet og en ny
//  er kommet til. Det er saadan afmeldning og first_seen_at afproeves.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { keyFromUrl } from '../lib/adapter'
import { kronerTilOere as kr } from '../lib/money'

const BASE = 'https://dummy.invalid/bolig'

type Post = Omit<RawListing, 'externalKey' | 'sourceUrl'> & { id: string }

const SAET_1: Post[] = [
  {
    id: 'a1',
    address: 'Nørrebrogade 56 B, 3. tv, 2200 København N',
    propertyType: 'Lejlighed', sizeM2: 86, rooms: 3,
    availableFrom: '2026-10-01',
    rentMonthly: kr(12500), utilitiesHeat: kr(650),
    utilitiesWater: kr(200), utilitiesElectricity: kr(400),
    moveInCost: kr(37500),
    amenities: ['altan', 'opvaskemaskine'],
    imageUrls: [`${BASE}/a1/1.jpg`, `${BASE}/a1/2.jpg`],
  },
  {
    id: 'a2',
    address: 'Skovvejen 12, 8000 Aarhus C',
    propertyType: 'lejlighed', sizeM2: 75, rooms: 2,
    availableFrom: '2026-09-15',
    rentMonthly: kr(9800), utilitiesHeat: kr(500),
    moveInCost: kr(29400),
    amenities: ['vaskemaskine'],
    imageUrls: [`${BASE}/a2/1.jpg`],
  },
  {
    id: 'a3',
    address: 'Vestergade 45, 5000 Odense C',
    propertyType: 'Rækkehus', sizeM2: 134, rooms: 4,
    rentMonthly: kr(13193),
    amenities: [],
    imageUrls: [`${BASE}/a3/1.jpg`],
  },
  {
    id: 'a4',
    address: 'Havnegade 3, 1058 København K',
    propertyType: 'noget kilden kalder noget andet', sizeM2: 40, rooms: 1,
    rentMonthly: kr(8400), utilitiesHeat: kr(300), utilitiesWater: kr(150),
    amenities: [],
    imageUrls: [],   // Ingen billeder. Der indsaettes ikke en pladsholder.
  },
  {
    id: 'a5',
    address: 'Ny Munkegade 7, 2. th, 8000 Aarhus C',
    propertyType: 'Værelse',
    rentMonthly: kr(4200),
    amenities: ['delekoekken'],
    imageUrls: [`${BASE}/a5/1.jpg`],
  },
]

// Saet 2: a3 er væk (skal afmeldes), a6 er ny, a1 har faaet ny husleje.
const SAET_2: Post[] = [
  { ...SAET_1[0]!, rentMonthly: kr(12900) },
  SAET_1[1]!,
  SAET_1[3]!,
  SAET_1[4]!,
  {
    id: 'a6',
    address: 'Godthåbsvej 21, 2000 Frederiksberg',
    propertyType: 'Lejlighed', sizeM2: 62, rooms: 2,
    availableFrom: '2026-11-01',
    rentMonthly: kr(11200), utilitiesHeat: kr(450),
    utilitiesWater: kr(180), utilitiesElectricity: kr(350),
    moveInCost: kr(33600),
    amenities: ['altan'],
    imageUrls: [`${BASE}/a6/1.jpg`],
  },
]

// Saet 3: kun én bolig. Efterligner en knaekket parser, saa sikringen mod
// afmeldning kan afproeves — den skal NAEGTE at afmelde de fire andre.
const SAET_3: Post[] = [SAET_1[0]!]

const saet = () =>
  process.env.DUMMY_SET === '3' ? SAET_3
  : process.env.DUMMY_SET === '2' ? SAET_2
  : SAET_1

export const dummyAdapter: SourceAdapter = {
  id: 'dummy',
  sourceType: 'feed',
  host: 'dummy.invalid',

  async discover(): Promise<DiscoveredListing[]> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('dummy-kilden maa ikke koere i produktion')
    }
    return Promise.all(saet().map(async (p) => {
      const url = `${BASE}/${p.id}`
      return { externalKey: await keyFromUrl(url), url }
    }))
  },

  async extract(url: string): Promise<RawListing> {
    const id = url.split('/').pop()
    const p = saet().find((x) => x.id === id)
    if (!p) throw new Error(`ukendt dummy-bolig: ${url}`)
    const { id: _, ...rest } = p
    return { ...rest, externalKey: await keyFromUrl(url), sourceUrl: url }
  },
}
