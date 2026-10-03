// ═══════════════════════════════════════════════════════════════
//  Boligtypens navn — ÉT sted.
//
//  Der var to lister. `TYPEORD` i app/Boligkort.tsx gav ental og
//  flertal til kortet; `TYPENAVN` i app/page.tsx gav et stort forbogstav
//  til filtrene. De var uenige, og uenigheden var synlig: `andet` hed
//  «Anden bolig» i filteret og «andet» på kortet, og `villa` og
//  `studiebolig` fandtes kun i den ene hver.
//
//  Det er samme form som el-linjen og faciliteterne: to udtryk, der
//  svarer på det samme spørgsmål, hver for sig korrekte, og som driver
//  fra hinanden. Svaret er ét sted og alt andet afledt derfra.
//
//  Ren tekst: ingen database, ingen next-import. Filen kan derfor
//  importeres af både en serverkomponent, en klientkomponent og en
//  prøve. Importen nedenfor er `import type` og forsvinder i
//  oversættelsen — der er stadig ingen runtime-afhængighed af basen.
//
//  ── DET VAR IKKE ÉT STED ─────────────────────────────────────
//  Filen blev skrevet for at være den eneste, og den var det ikke.
//  Der lå FEM private kopier ved siden af den, og de var uenige om
//  mere end dækning:
//
//    `andet`   «anden bolig» her · «Bolig» på boligsiden og i
//              gem-boksen · «boliger» på områdesiderne
//    `gruppe`  manglede `vaerelse`, `studiebolig` OG `andet`, så en
//              gruppe af fem studieboliger stod som «5 boliger» —
//              et tab af en oplysning, vi HAR
//    `villa`   fandtes to steder og findes ikke i enummet
//
//  `satisfies Record<Boligtype, …>` binder listen til enummet, så en
//  sjette boligtype uden et navn er en oversætterfejl, og `villa` ikke
//  kan stå her. Prøven i scripts/test-boligtype.ts fanger den anden
//  halvdel, som en oversætter ikke kan se: en NY privat kopi.
// ═══════════════════════════════════════════════════════════════

// Kun typen. Den forsvinder i oversættelsen, så løftet ovenfor holder.
import type { propertyTypeEnum } from '../db/schema'

export type Boligtype = (typeof propertyTypeEnum.enumValues)[number]

/** Ental og flertal, i den form de STÅR i en sætning — altså med småt. */
const NAVNE = {
  lejlighed: ['lejlighed', 'lejligheder'],
  raekkehus: ['rækkehus', 'rækkehuse'],
  hus: ['hus', 'huse'],
  vaerelse: ['værelse', 'værelser'],
  studiebolig: ['studiebolig', 'studieboliger'],
  andet: ['anden bolig', 'andre boliger'],
} as const satisfies Record<Boligtype, readonly [string, string]>

/** Alle typer, i enummets rækkefølge. Prøven opregner dem herfra. */
export const BOLIGTYPER = Object.keys(NAVNE) as readonly Boligtype[]

// Opslag paa en vilkaarlig streng UDEN en cast. `typeord` tager med
// vilje `string`: en vaerdi, en kilde har fundet paa, gives videre som
// kildens eget ord, og det er ikke en maengde, vi kan udtoemme.
const NAVNESAET: ReadonlyMap<string, readonly [string, string]> =
  new Map(Object.entries(NAVNE))

/** Første bogstav stort. Til en overskrift, aldrig midt i en sætning. */
export const stort = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Typens ord, med småt.
 *
 * Kender vi ikke typen — eller er den blandet i en gruppe — siger vi
 * «bolig», ikke noget vi ikke ved. En ukendt værdi fra en kilde gives
 * videre, som den står: den er kildens ord, ikke vores gæt.
 */
export function typeord(t: string | null, flertal = false): string | null {
  if (!t) return flertal ? 'boliger' : null
  const par = NAVNESAET.get(t)
  return par ? par[flertal ? 1 : 0] : t
}

/** Typens navn med stort forbogstav — til filtrenes etiketter. */
export function typenavn(t: string): string {
  return stort(typeord(t) ?? t)
}
