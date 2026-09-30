// ═══════════════════════════════════════════════════════════════
//  Kravet til en adgangskode. ÉT sted.
//
//  ═══ HVORFOR FILEN FINDES ═══
//
//  `tilmeld()` skrev `kode.length < 10` og sin egen besked, og
//  formularen skrev hjælpeteksten en tredje gang. Da gendannelsen kom
//  til, skulle den stille NØJAGTIG det samme krav — og så var vi tre
//  steder med ét spørgsmål.
//
//  Det er mønstret fra CLAUDE.md: to udtryk, begge korrekte hver for
//  sig, der driver fra hinanden. Hæves kravet ét sted, kan en bruger
//  vælge en kode ved gendannelse, som hun ikke kunne have valgt ved
//  oprettelsen — og ingen prøve ville fange det, for begge steder ville
//  se rigtige ud.
//
//  Filen er REN: ingen database, ingen next/headers, ingen React. Den
//  læses af to server actions, af formularerne og af prøven.
// ═══════════════════════════════════════════════════════════════

/**
 * Længden er hele kravet.
 *
 * Ikke tegnklasser: et krav om store bogstaver og tegn giver «Sommer1!»
 * — kort, gættelig og svær at huske. Længden er det, der faktisk koster
 * en angriber noget, og teksten siger det, så valget ikke ligner en
 * forglemmelse.
 */
export const MINDST_TEGN = 10

/** Hjælpeteksten UNDER feltet. Står, før nogen har gjort noget forkert. */
export const KODEKRAV = `Mindst ${MINDST_TEGN} tegn. Længde slår krøllede tegn.`

/** Fejlen, når den er for kort. Ordlyden er den, `tilmeld()` altid har brugt. */
export const FOR_KORT = `Adgangskoden skal være mindst ${MINDST_TEGN} tegn. Længde slår krøllede tegn.`

/** Fejlen, når gentagelsen ikke passer. Kun relevant, hvor der ER to felter. */
export const IKKE_ENS = 'De to adgangskoder er ikke ens. Skriv den samme begge steder.'

/**
 * Er koden god nok? Returnerer fejlteksten, eller null når alt er i orden.
 *
 * `gentagelse` er valgfri, fordi oprettelsesformularen kun har ét felt,
 * mens «Vælg ny adgangskode» har to. Kravet til selve koden er det
 * samme begge steder — det er dét, der er pointen med filen.
 *
 * Rækkefølgen er med vilje: for kort siges FØR uens. Er begge felter
 * tomme, er «mindst 10 tegn» det svar, der fortæller hende, hvad hun
 * skal gøre; «de er ikke ens» ville være sandt og ubrugeligt.
 */
export function tjekAdgangskode(kode: string, gentagelse?: string): string | null {
  if (kode.length < MINDST_TEGN) return FOR_KORT
  if (gentagelse !== undefined && kode !== gentagelse) return IKKE_ENS
  return null
}
