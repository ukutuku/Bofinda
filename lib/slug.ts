// ═══════════════════════════════════════════════════════════════
//  Slug-reglen.
//
//  ÆNDR DEN ALDRIG. Hver slug er en URL, Google har indekseret. Aendrer
//  reglen sig, brækker alle indekserede adresser paa én gang, og den
//  optjente placering starter forfra.
//
//    æ Æ  ->  ae        mellemrum  ->  bindestreg
//    ø Ø  ->  oe        alt andet end a-z0-9  ->  bindestreg
//    å Å  ->  aa        gentagne bindestreger  ->  én
//
//  Skal formen laves om, skal det ske som en NY rute med 301 fra den
//  gamle — ikke ved at rette her.
// ═══════════════════════════════════════════════════════════════

export function slug(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    // Oevrige diakritiske tegn (é, ü) foldes til grundbogstavet. Danske
    // bogstaver er allerede haandteret ovenfor, saa de rammes ikke her.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Postnumre staar alene i stien — uden bynavn. */
export const erPostnummer = (s: string): boolean => /^[1-9][0-9]{3}$/.test(s)

/**
 * Under denne graense genereres siden ikke. En side med to boliger er
 * tynd og bliver ikke placeret; den traekker snarere resten ned.
 */
export const MINDST_BOLIGER = 3
