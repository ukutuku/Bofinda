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
//  prøve.
// ═══════════════════════════════════════════════════════════════

/** Ental og flertal, i den form de STÅR i en sætning — altså med småt. */
const NAVNE: Record<string, [string, string]> = {
  lejlighed: ['lejlighed', 'lejligheder'],
  raekkehus: ['rækkehus', 'rækkehuse'],
  hus: ['hus', 'huse'],
  villa: ['villa', 'villaer'],
  vaerelse: ['værelse', 'værelser'],
  studiebolig: ['studiebolig', 'studieboliger'],
  andet: ['anden bolig', 'andre boliger'],
}

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
  const par = NAVNE[t]
  return par ? par[flertal ? 1 : 0] : t
}

/** Typens navn med stort forbogstav — til filtrenes etiketter. */
export function typenavn(t: string): string {
  return stort(typeord(t) ?? t)
}
