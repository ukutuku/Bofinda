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
  /**
   * Den fede indledning. Betinget, som rangeringen er: den regnes paa det
   * FILTREREDE saet, saa i en soegning, den anden annonce ikke passer til,
   * vises hendes. Her stod «Vises ikke i søgningen.» — ubetinget, lige over
   * en forklaring, der sagde det modsatte.
   */
  overskrift: string
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
 *   · «i hver søgning, den passer til» — rangeringen regnes paa det
 *     filtrerede saet. Passer kildens annonce ikke et filter, er den ikke
 *     med, og saa kan hendes blive vist. Uden betingelsen ville hun kunne
 *     finde sin annonce i en soegning lige efter at have laest, at den
 *     ikke vises.
 *   · «tager vi deres annonce ud af søgningen, når vi opdager det» —
 *     `koerKilde` afmelder en raekke, kilden ikke laengere viser, men kun
 *     naar koerslen gaar gennem sikringen; ellers ved en senere koersel.
 *     Derfor ikke «ved næste hentning».
 *   · «kan din blive vist» og «kan din vises i stedet» — ikke «bliver»: en
 *     anden udlejerannonce paa samme bolig kan stadig vinde paa billeder.
 *
 * ═══ HVAD EN REN FIL IKKE KAN PROEVE ═══
 *
 * Filen goer TEKSTEN proevbar. Men to udsagn her er loefter om andre
 * moduler: «kan stadig åbnes på sit eget link» handler om `hentBolig` og
 * detaljeruten, og «tager vi deres annonce ud af søgningen» om `koerKilde`.
 * Dem kan en proeve af den her fil ikke se — den ville bestaa, ogsaa hvis
 * linket gav 404. De proeves derfor dér, hvor modulerne bor, i
 * scripts/test-redigering.ts. Se CLAUDE.md, «Dækker ét tilfælde mindre».
 */
export function forklaring(
  min: { billeder: number; total: number | null }, af: Repraesentant,
): Forklaring {
  const overskrift = 'Vises ikke i søgninger, hvor en anden annonce for samme bolig også passer.'
  if (!af.udlejerannonce) {
    return {
      overskrift,
      grund: `den kommer fra ${af.kilde}`,
      slutning: 'Vi viser hver bolig én gang. Står den også hos en af de sider, '
        + 'vi henter boliger fra, viser vi den annonce frem for udlejerens egen i '
        + 'hver søgning, den passer til — i en søgning, den ikke passer til, kan '
        + 'din blive vist. Det gælder alle udlejere og er ikke en vurdering af din '
        + 'annonce, så flere billeder ændrer ikke valget. Er det ikke den samme '
        + 'bolig, så tjek, at adressen er rigtig — også etage og dør. Din annonce '
        + 'er ikke fjernet: den kan stadig åbnes på sit eget link. Tages boligen '
        + 'ned de steder, vi henter den fra, tager vi deres annonce ud af '
        + 'søgningen, når vi opdager det — og så kan din vises i stedet.',
    }
  }
  const slutning = 'Din annonce er ikke fjernet: den kan stadig åbnes på sit eget '
    + 'link, og du kan rette den.'
  if (af.billeder > min.billeder) {
    return { overskrift, grund: `den viser flere billeder — ${af.billeder} mod dine ${min.billeder}`, slutning }
  }
  if (af.harTotal && min.total == null) {
    return { overskrift, grund: 'den oplyser en samlet månedlig udgift, og det gør din ikke', slutning }
  }
  return { overskrift, grund: 'de to står lige på billeder og oplysninger, og valget faldt på den anden', slutning }
}
