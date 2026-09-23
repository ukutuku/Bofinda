// ═══════════════════════════════════════════════════════════════
//  Grundene til et nej. ÉN liste, to læsere.
//
//  ═══ DENNE FIL MÅ ALDRIG IMPORTERE DATABASEN ═══
//
//  `lib/maaling.ts` læser herfra, og den importeres af
//  klienttrackeren. Et værdi-import fra et modul, der trækker
//  `postgres` med ind, væltede engang hele appen på
//  `Can't resolve 'net'` — samme regel som `lib/faciliteter.ts`.
//  Derfor ligger listen her og ikke i `lib/adgang.ts`, som læser
//  `drift` og `subscriptions`.
//
//  ═══ TYPEN ER AFLEDT AF ARRAYET ═══
//
//  Ikke skrevet ved siden af det. Allowlisten i `lib/maaling.ts`
//  skriver `af: GRUNDE` — altså den SAMME værdi, ikke en afskrift af
//  den. En femte grund kan derfor ikke tilføjes ét sted og glemmes
//  det andet, og `rens()` kan ikke komme til at afvise et event om en
//  grund, muren faktisk bruger. Samme greb som `FACILITETER`, der er
//  typebundet til `FACILITET`.
//
//  ═══ HVORFOR «UDLØBET» ER SIN EGEN GRUND ═══
//
//  «Du har aldrig haft et abonnement» og «dit er løbet ud» er to
//  forskellige situationer for den, der står i dem. Den ene skal se
//  et tilbud, den anden skal se «Genaktivér» og have at vide, at
//  hendes samtaler ikke er slettet. Uden ordet kan visningen ikke
//  skelne dem, og så får den vendende kunde førstegangsteksten.
//
//  Skellet MÅLES på `subscriptions.adgang_til`, ikke på om der findes
//  en række: en række i `incomplete`, hvor betalingen aldrig gik
//  igennem, har `adgang_til = null` og er altså «har aldrig haft».
//  Se `slaaAdgangOp` i lib/adgang.ts.
// ═══════════════════════════════════════════════════════════════

export const GRUNDE = [
  /** BETALING, og hun har ALDRIG haft en betalt periode → vis tilbuddet. */
  'abonnement_kraeves',
  /** BETALING, og hun HAR haft en, der er løbet ud → vis «Genaktivér». */
  'abonnement_udloebet',
  /** Funktionen kræver en konto. */
  'login_kraeves',
  /** Vi kunne ikke læse tilstanden → VORES fejl, ikke en manglende betaling. */
  'ukendt_tilstand',
] as const

/** Hvorfor adgangen blev nægtet. Visningen vælger tekst ud fra den. */
export type Grund = typeof GRUNDE[number]
