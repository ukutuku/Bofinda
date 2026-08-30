// ═══════════════════════════════════════════════════════════════
//  Dedup i to niveauer.
//
//  To kilder maa gerne have den samme bolig — dedup afviser ikke den
//  anden kilde, den grupperer dem, saa brugeren ser boligen én gang.
//
//    unit    Enhedsadressen er noeglen alene. Samme UUID = samme bolig.
//    access  Opgangen alene er ikke nok; der kan ligge otte lejligheder.
//            Noeglen er opgang + areal + vaerelser + husleje.
//    failed  Dedupes ikke og vises ikke. Vi ved ikke hvor boligen ligger.
// ═══════════════════════════════════════════════════════════════

export interface DedupInput {
  addressMatchLevel: 'unit' | 'access' | 'failed'
  unitAddressUuid: string | null
  accessAddressUuid: string | null
  sizeM2: number | null
  rooms: number | null
  rentMonthly: number | null
}

/**
 * Gruppenoeglen for en bolig, eller null naar den ikke kan dedupes.
 * Null betyder "staar alene" — ikke "samme som de andre null'er".
 */
export function dedupNoegle(b: DedupInput): string | null {
  if (b.addressMatchLevel === 'unit' && b.unitAddressUuid) {
    return `unit:${b.unitAddressUuid}`
  }
  if (b.addressMatchLevel === 'access' && b.accessAddressUuid) {
    // Husleje rundes til naermeste 100 kr, saa et gebyr til forskel mellem to
    // kilder ikke deler boligen i to.
    const leje = b.rentMonthly == null ? '?' : String(Math.round(b.rentMonthly / 10000))
    return `access:${b.accessAddressUuid}:${b.sizeM2 ?? '?'}:${b.rooms ?? '?'}:${leje}`
  }
  return null
}
