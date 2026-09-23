// ═══════════════════════════════════════════════════════════════
//  Grundlagslinjen: hvad dækker tallet, og hvad kommer oveni?
//
//  ═══ HVORFOR DEN AFLØSER TO LINJER ═══
//
//  Kortet havde en posterlinje og en el-linje:
//
//      husleje + varme + vand                        ← hvad ER med
//      El indgår ikke — udlejer oplyser ikke hvordan ← hvad er IKKE med
//
//  To linjer, to pladser i rækkefølgen, som skal læses sammen for at
//  give ét svar på ét spørgsmål. Det er CLAUDE.md's dyreste mønster —
//  to udtryk for det samme — og det stod på 71 % af kortene.
//
//  Her er de ét udtryk. Oplysningen er den samme; niveauet er væk.
//
//  ═══ FIRE FORMER, FORDI DER ER FIRE GRUPPER ═══
//
//  Målt på 1.864 synlige boliger, 23. september 2026:
//
//      ikke-med          857   46,0 %
//      total ukendt      504   27,0 %
//      ukendt-daekning   466   25,0 %
//      egen-maaler        20    1,1 %
//      med                17    0,9 %
//
//  De tre store er næsten lige store. Der findes altså INGEN
//  normaltilstand at afvige fra, og derfor er «højst ét forbehold» det
//  forkerte greb: et forbehold forudsætter en hovedregel. Linjen skal
//  bære alle tre lige godt.
//
//  ═══ `egen-maaler` ER EN STÆRKERE PÅSTAND END DE ANDRE ═══
//
//  «Du betaler selv til elselskabet» siger noget om KUNDENS forhold,
//  ikke om vores data. Den må kun stå, når kilden selv har sagt det —
//  `electricity_own_meter` sættes aldrig af os. Den må ALDRIG blive
//  standardteksten for de 857, hvor vi netop ikke ved det; dér siger vi
//  «el kommer oveni», som er, hvad vi har dækning for.
// ═══════════════════════════════════════════════════════════════

import type { Eltilstand } from './eloplysning'

/** Kildernes ordforråd for aconto-poster. Se lib/normalize.ts. */
const POSTNAVN: Record<string, string> = {
  rent: 'husleje', heat: 'varme', water: 'vand',
  electricity: 'el', other: 'øvrig aconto',
}

export interface Grundlagsspoergsmaal {
  /**
   * Er totalen kendt?
   *
   * ⚠ GIVES EKSPLICIT, og udledes ikke af `el`. Enkeltkortets `b.total`
   * er et BELØB, der kan være null; gruppekortets `n.total` er en
   * BOOLEAN, der aldrig er det. Samme ord, to typer — det kostede 47
   * gruppekort sidst, hvor `n.total == null` aldrig var sand og vagten
   * derfor aldrig fyrede. Her er der ingen at tage fejl af.
   */
  totalKendt: boolean
  /** `null` når totalen er ukendt — så er der ikke noget tal at tage forbehold for. */
  el: Eltilstand | null
  /**
   * Aconto-posterne. `null` betyder «kan ikke opregnes»: enten ukendte,
   * eller — på et gruppekort — ikke ens for alle medlemmer. Så siger
   * linjen «husleje + aconto», som er sandt for hele gruppen.
   * Repræsentanten må ikke tale for de andre.
   */
  poster: readonly string[] | null
}

/**
 * «husleje + varme + vand», eller «husleje + aconto» når de ikke kan opregnes.
 *
 * ⚠ EN UKENDT NØGLE GIVER DEN UOPREGNEDE FORM — den skrives ikke ud.
 * Fallbacket var før `POSTNAVN[p] ?? p`, og så stod kildens engelske
 * nøgle midt i en dansk sætning: en prøvebolig med `'heating'` (ordet
 * hedder `heat`) gengav «husleje + heating + vand» på kortet, og ingen
 * prøve så det. De to andre udveje er begge løgne: at printe nøglen
 * siger ingenting, og at springe den over siger «acontoen dækker kun
 * vand» om et beløb, der også dækker varme. Kan ét led ikke oversættes,
 * kan listen ikke opregnes — og «husleje + aconto» er sandt uanset hvad
 * det ukendte led er.
 */
function posterTekst(poster: readonly string[] | null): string {
  if (poster == null || poster.length === 0) return 'husleje + aconto'
  const navne = poster.map((p) => POSTNAVN[p])
  if (navne.some((n) => n == null)) return 'husleje + aconto'
  return navne.join(' + ')
}

/**
 * ÉN linje, altid. Kaldes af begge søgekorttyper og af Min sides
 * gemte-kort — spørgsmålet besvares ét sted og bruges derfra.
 */
export function grundlagstekst(s: Grundlagsspoergsmaal): string {
  // Ingen total: der er ikke noget tal at gøre rede for. Vi kan ikke
  // skelne «udlejer opkræver intet» fra «udlejer oplyser intet», så vi
  // påstår ingen af delene — vi siger, hvad hun skal spørge om.
  if (!s.totalKendt) return 'Spørg udlejeren om varme og vand'

  // Ét samlet beløb uden specifikation. At opregne «husleje + øvrig
  // aconto» ville være en opremsning, der intet tilføjer; det, hun
  // mangler, er at vide, at el KAN ligge i klumpen.
  if (s.el === 'ukendt-daekning') {
    return 'husleje + ét samlet acontobeløb · uvist om el er med'
  }

  const poster = posterTekst(s.poster)
  if (s.el === 'egen-maaler') return `${poster} · el betaler du selv til elselskabet`
  if (s.el === 'ikke-med') return `${poster} · el kommer oveni`
  // 'med' — el er en navngiven post og står allerede i opregningen.
  // Og `null` med kendt total: kilden har gjort rede for det hele.
  return poster
}
