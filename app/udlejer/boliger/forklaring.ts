// ═══════════════════════════════════════════════════════════════
//  Hvorfor vises en anden annonce i stedet for hendes?
//
//  Ren fil — ingen database, ingen React — saa forklaringen kan proeves
//  i `npm test`. Den stod foer inde i siden og kunne ikke naas af nogen
//  proeve: «dine N» var 0 i maaneder, og en forkert gren her ville ingen
//  have set.
//
//  Raekkefoelgen SKAL svare til `ikkeRepraesentant` i lib/soeg.ts:
//  kildens annonce foer udlejerens, saa unikke billeder, saa om totalen
//  er kendt, saa id'et. Vi siger kun den grund, der faktisk afgjorde
//  det — "flere billeder" om to annoncer med lige mange ville vaere en
//  paastand, vi ikke kan staa inde for.
// ═══════════════════════════════════════════════════════════════

import type { Repraesentant } from '../../../lib/soeg'

export interface Forklaring {
  /** Leddet efter «Den blev valgt, fordi …». */
  grund: string
  /** Hvad det betyder for hende, og hvad hun kan goere. */
  slutning: string
}

/**
 * Foerste gren er reglen i `UDLEJERANNONCE`: er vinderen en annonce fra en
 * af kilderne, var billeder og total IKKE grunden — heller ikke naar
 * tallene tilfaeldigvis peger samme vej — og saa maa teksten ikke sige det.
 * `af.udlejerannonce` er beregnet af samme SQL-udtryk som rangeringen.
 *
 * Hvert udsagn i regelteksten er efterproevet mod koden:
 *   · «den kommer fra X» — vinderen i den gren er altid en ikke-native kilde.
 *   · Ikke «altid» og ikke «uanset pris»: rangeringen regnes paa det
 *     filtrerede saet, og pris er ikke et trin.
 *   · «flere billeder ændrer ikke valget» — sandt. «En rettelse ændrer
 *     ikke valget» ville vaere FALSK: retter hun adresse, areal, vaerelser
 *     eller husleje, kan dedup-noeglen skifte, og paa access-niveau er
 *     «samme bolig» kun et gaet (samme opgang, areal, vaerelser og leje).
 *     Er det to forskellige lejligheder, er etage og doer vejen ud.
 *   · «kan blive vist igen» — ikke «bliver»: en anden udlejerannonce paa
 *     samme bolig kan stadig vinde paa billeder.
 */
export function forklaring(
  min: { billeder: number; total: number | null }, af: Repraesentant,
): Forklaring {
  if (!af.udlejerannonce) {
    return {
      grund: `den kommer fra ${af.kilde}`,
      slutning: 'Vi viser hver bolig én gang, og står den også hos en af de sider, '
        + 'vi henter boliger fra, viser vi den annonce frem for udlejerens egen. '
        + 'Det gælder alle udlejere og er ikke en vurdering af din annonce, så '
        + 'flere billeder ændrer ikke valget. Er det ikke den samme bolig, så tjek, '
        + 'at adressen er rigtig — også etage og dør. Din annonce er ikke fjernet: '
        + 'den kan stadig åbnes på sit eget link, og forsvinder boligen fra de '
        + 'sider, vi henter fra, kan den blive vist igen.',
    }
  }
  const slutning = 'Din annonce er ikke fjernet: den kan stadig åbnes på sit eget '
    + 'link, og du kan rette den.'
  if (af.billeder > min.billeder) {
    return { grund: `den viser flere billeder — ${af.billeder} mod dine ${min.billeder}`, slutning }
  }
  if (af.harTotal && min.total == null) {
    return { grund: 'den oplyser en samlet månedlig udgift, og det gør din ikke', slutning }
  }
  return { grund: 'de to står lige på billeder og oplysninger, og valget faldt på den anden', slutning }
}
