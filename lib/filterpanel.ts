// ═══════════════════════════════════════════════════════════════
//  Filterpanelets sammenfatning.
//
//  Panelet er lukket som udgangspunkt, og så er `<summary>` det ENESTE,
//  der er synligt af det. Derfor skal linjen kunne bære alt, panelet
//  skjuler — ellers er et aktivt filter usynligt, og det er samme fejl
//  som en total, der lader som om aconto er kendt.
//
//  Ren logik: ingen database, ingen next-import. Kun `import type` fra
//  lib/soeg og `antalFiltre` fra lib/maalingsoeg, så tallet på skærmen
//  ALDRIG kan drive fra `antal_filtre` i analytics.
// ═══════════════════════════════════════════════════════════════

import type { Filtre } from './soeg'
import { antalFiltre } from './maalingsoeg'

/**
 * Hvor mange AVANCEREDE filtre er sat?
 *
 * Udledt af `antalFiltre` ved subtraktion, ikke skrevet af. Tilføjer nogen
 * et felt til `harFiltre`/`antalFiltre`, tæller det med her af sig selv.
 * To lister ville før eller siden svare forskelligt på det samme spørgsmål.
 *
 * Stedet trækkes fra. Det er sidens primære søgning og hører til i det
 * store felt over panelet, ikke blandt de avancerede valg — talte det med,
 * ville enhver almindelig bysøgning stå som «1 aktivt filter», og tallet
 * ville holde op med at betyde «noget er skjult i panelet».
 *
 * Kan ikke blive negativt: `antalFiltre` tæller `by` og `postnr` med
 * nøjagtig det samme prædikat, `Boolean(...)`, som fratrækket bruger.
 */
export function antalAvancerede(f: Filtre): number {
  return antalFiltre(f) - (f.by ? 1 : 0) - (f.postnr ? 1 : 0)
}

/** Er der sorteret på andet end standarden? */
export function erSorteret(f: Filtre): boolean {
  return (f.sorter ?? 'nyeste') !== 'nyeste'
}

/**
 * Sammenfatningens dele. Første led er altid navnet; resten er det, der
 * ellers ville være skjult.
 *
 * DELE, ikke én streng: teksten skal kunne sættes op med det aktive tal
 * fremhævet, og en streng ville tvinge markuppen til at bygge sin egen
 * udgave af den samme sætning. Så var der to udtryk for samme spørgsmål
 * igen — ét i prøven og ét på skærmen.
 *
 * Sorteringen står for sig og tælles ALDRIG med i tallet. `filterDiff` og
 * `antalFiltre` er begge enige om, at en sortering ikke er et filter, og
 * et tal her, der sagde noget andet, ville modsige analytics. Men
 * kontrollen bor inde i panelet, så en søgning sorteret efter pris ville
 * ellers være usynlig, når panelet er lukket.
 */
export function sammenfatFlere(f: Filtre): string[] {
  const n = antalAvancerede(f)
  const dele = ['Flere filtre']
  if (n > 0) dele.push(n === 1 ? '1 aktivt' : `${n} aktive`)
  if (erSorteret(f)) dele.push('sorteret')
  return dele
}
