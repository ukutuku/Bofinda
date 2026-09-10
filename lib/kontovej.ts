// ═══════════════════════════════════════════════════════════════
//  Hvor et kontoforløb ender.
//
//  ═══ HVORFOR FILEN FINDES ═══
//
//  Den samme kontoformular står to steder — på /udlejer og på /min-side.
//  `login()` sendte alle til `/udlejer/boliger`, og `tilmeld()` satte
//  bekræftelseslinket til `/udlejer`, begge hårdkodet. En boligsøgende,
//  der loggede ind fra Min side, blev derfor kastet over på udlejersiden,
//  og bekræftelsesmailen sendte hende samme forkerte sted hen.
//
//  Rettelsen er ikke to formularer. Det er ÉT bord, som både server
//  actions, callback-ruten og formularen læser destinationen af — samme
//  regel som `filtreFraParametre()` for søgningen: svarer to steder på
//  det samme spørgsmål, skal svaret beregnes ét sted.
//
//  ═══ ET NØGLEORD, ALDRIG EN URL ═══
//
//  Klienten sender `k=bolig` eller `k=udlejer` — et kort ord, som
//  serveren slår op i bordet nedenfor. Den sender ALDRIG en adresse.
//  Derfor findes der ikke et åbent redirect at lukke: en værdi, bordet
//  ikke kender, bliver til standardkonteksten, og hvert eneste mål
//  herunder er en litteral i denne fil.
//
//  ═══ HVAD ET FELT FRA KLIENTEN KAN OG IKKE KAN ═══
//
//  Konteksten vælger en DESTINATION. Den giver ingen adgang.
//
//  Målet afgør transitivt, hvilken `role` der skrives ved FØRSTE binding
//  — /udlejer/boliger kalder `hentUdlejer()` (landlord), /min-side kalder
//  `hentBrugerStatus()` (tenant). Det er en beskrivelse, ikke en
//  rettighed: `users.role` læses ikke ét eneste sted i koden, og
//  /udlejer/boliger viser `mineBoliger(u)` — hendes egne rækker, slået op
//  på hendes egen bruger. En, der selv sætter `k=udlejer`, får altså en
//  tom annonceliste og et forkert ord i sin egen række. Hun får ikke
//  andres data, og hun får ikke lov til noget, hun ikke måtte i forvejen.
//
//  Filen er REN: ingen database, ingen next/headers, ingen React. Den
//  skal kunne læses fra middleware (edge), fra en rutehandler, fra en
//  klientkomponent og fra en prøve.
// ═══════════════════════════════════════════════════════════════

/** De eneste adresser, et kontoforløb kan ende på. Alle er interne. */
export const INTERNE_MAAL = ['/min-side', '/udlejer', '/udlejer/boliger'] as const
export type InterntMaal = (typeof INTERNE_MAAL)[number]

export const KONTEKSTER = ['bolig', 'udlejer'] as const
export type Kontekst = (typeof KONTEKSTER)[number]

/**
 * Standarden er den boligsøgende.
 *
 * Ikke et tilfældigt valg: /min-side er det mindst privilegerede mål og
 * virker for enhver konto, mens /udlejer/boliger ville sætte `landlord`
 * på en, der aldrig bad om det. Falder konteksten bort — en gammel
 * bogmærket URL, en mailklient der klipper i parametre — er det bedre at
 * lande et sted, der giver mening for alle.
 */
export const STANDARDKONTEKST: Kontekst = 'bolig'

export interface Vej {
  /** Efter login med adgangskode. */
  efterLogin: InterntMaal
  /** Efter logud. Begge viser kontoformularen igen. */
  efterLogud: InterntMaal
  /** Når bekræftelseslinket er vekslet til en session. */
  efterBekraeftelse: InterntMaal
  /** Når callbacken IKKE kunne veksle koden. Skal vise en vej videre. */
  vedLinkfejl: InterntMaal
}

export const KONTOVEJ: Record<Kontekst, Vej> = {
  bolig: {
    efterLogin: '/min-side',
    efterLogud: '/min-side',
    efterBekraeftelse: '/min-side',
    vedLinkfejl: '/min-side',
  },
  udlejer: {
    efterLogin: '/udlejer/boliger',
    efterLogud: '/udlejer',
    efterBekraeftelse: '/udlejer/boliger',
    // Ikke /udlejer/boliger: den omdirigerer til /udlejer, når man ikke er
    // logget ind, og en fejlbesked, der forsvinder i et hop, er ingen
    // besked. Fejlen skal stå dér, hvor formularen er.
    vedLinkfejl: '/udlejer',
  },
}

/**
 * Konteksten fra en klientværdi. Kender bordet den ikke, er svaret
 * standarden — aldrig værdien selv, og aldrig et kast.
 */
export function kontekstFra(v: unknown): Kontekst {
  return typeof v === 'string' && (KONTEKSTER as readonly string[]).includes(v)
    ? (v as Kontekst)
    : STANDARDKONTEKST
}

export const vejFor = (k: Kontekst): Vej => KONTOVEJ[k]

/** Parameternavnet, konteksten bæres i. Ét sted, så de tre kaldere ikke driver. */
export const K_PARAM = 'k'

/**
 * Fejlmærkatet på landingssiden. Ét fast ord, ikke en fejltekst.
 *
 * Der er med vilje kun ÉN tilstand. At skelne «udløbet» fra «allerede
 * brugt» ville kræve, at vi læste Auth-serverens engelske fejltekst og
 * gættede på dens ordlyd — og teksten må under ingen omstændigheder
 * videre ud i en URL. Beskeden dækker derfor ærligt begge tilfælde.
 */
export const LINKFEJL = 'linkfejl'

/** Bekræftelseslinkets landingsadresse, som den skal stå i emailRedirectTo. */
export function callbackUrl(base: string, k: Kontekst): string {
  const u = new URL('/auth/callback', base)
  u.searchParams.set(K_PARAM, k)
  return u.toString()
}
