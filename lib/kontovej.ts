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
export const INTERNE_MAAL = [
  '/min-side', '/udlejer', '/udlejer/boliger', '/glemt', '/nulstil',
] as const
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
  /**
   * Når et gendannelseslink ER vekslet til en session.
   *
   * Samme side for begge kontekster: «Vælg ny adgangskode» spørger om
   * én ting og kender hverken annoncer eller gemte boliger. Konteksten
   * følger med i adressen, så hun bagefter sendes hen, hvor HUN kom fra.
   */
  efterGendannelse: InterntMaal
  /**
   * Når gendannelseslinket ikke kunne veksles.
   *
   * IKKE `vedLinkfejl`: dér står «log ind, eller opret kontoen igen», og
   * det er forkerte råd til en, der har glemt sin adgangskode. Hun skal
   * kunne bede om et nyt link — altså tilbage til formularen, hun kom
   * fra.
   */
  vedGendannelsesfejl: InterntMaal
}

export const KONTOVEJ: Record<Kontekst, Vej> = {
  bolig: {
    efterLogin: '/min-side',
    efterLogud: '/min-side',
    efterBekraeftelse: '/min-side',
    vedLinkfejl: '/min-side',
    efterGendannelse: '/nulstil',
    vedGendannelsesfejl: '/glemt',
  },
  udlejer: {
    efterLogin: '/udlejer/boliger',
    efterLogud: '/udlejer',
    efterBekraeftelse: '/udlejer/boliger',
    // Ikke /udlejer/boliger: den omdirigerer til /udlejer, når man ikke er
    // logget ind, og en fejlbesked, der forsvinder i et hop, er ingen
    // besked. Fejlen skal stå dér, hvor formularen er.
    vedLinkfejl: '/udlejer',
    efterGendannelse: '/nulstil',
    vedGendannelsesfejl: '/glemt',
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

/**
 * HVILKET forløb et link hører til.
 *
 * ═══ HVORFOR DER SKAL SKELNES ═══
 *
 * Både bekræftelsesmailen og gendannelsesmailen lander på den SAMME
 * rute med den samme `?code=`. Vekslingen er ens; det, der sker
 * bagefter, er det ikke. En bekræftet konto skal ind på Min side. En,
 * der har glemt sin adgangskode, skal videre til «Vælg ny adgangskode»
 * — ellers er hun logget ind uden nogensinde at have sat en kode, og
 * forløbet er uafsluttet på præcis den måde, callback-ruten blev
 * skrevet for at fjerne.
 *
 * ═══ OG HVORFOR DET ER UFARLIGT ═══
 *
 * Ordet vælger en DESTINATION, ikke en rettighed — nøjagtig som `k`.
 * Et ord, bordet ikke kender, bliver til standarden. At sætte
 * `f=gendan` selv giver intet: `/nulstil` kræver en session, som kun
 * Auth-serveren kan udstede, og den kigger aldrig på parameteren.
 * Adgangen ligger i sessionen; parameteren peger kun på en side.
 */
export const FORLOEB = ['bekraeft', 'gendan'] as const
export type Forloeb = (typeof FORLOEB)[number]

/**
 * Standarden er bekræftelsen.
 *
 * Den findes i forvejen og er i drift. Falder parameteren bort — en
 * mailklient, der klipper i adressen, et gammelt link sendt før denne
 * ændring — skal forløbet opføre sig præcis som før.
 */
export const STANDARDFORLOEB: Forloeb = 'bekraeft'

export function forloebFra(v: unknown): Forloeb {
  return typeof v === 'string' && (FORLOEB as readonly string[]).includes(v)
    ? (v as Forloeb)
    : STANDARDFORLOEB
}

/** Parameternavnet, forløbet bæres i. Ét sted, som K_PARAM. */
export const F_PARAM = 'f'

/**
 * Kvitteringen efter en gennemført gendannelse.
 *
 * ═══ HVORFOR DEN IKKE ER EN URL-PARAMETER ═══
 *
 * Den var det før, og det var forkert: enhver kunne skrive
 * `?nulstillet=1` i adresselinjen og få siden til at påstå, at en
 * adgangskode LIGE var skiftet. En kvittering er en oplysning om, hvad
 * serveren gjorde — så må den også komme fra serveren.
 *
 * Cookien sættes af `gemNyKode` umiddelbart før omdirigeringen, er
 * HttpOnly og lever to minutter. Den bærer intet om HVEM, kun HVAD der
 * skete, og den er derfor hverken en session eller et bevis på adgang.
 */
export const KVITTERINGSCOOKIE = 'bofinda_kvittering'

/**
 * Hvad der faktisk skete. To udfald, fordi de kræver hver sin besked:
 *
 *   · `skiftet`            koden er skiftet, og udlogningen blev afsluttet
 *   · `skiftet-uden-logud` koden ER skiftet, men udlogningen fejlede
 *
 * Det andet udfald findes, fordi hun ikke må tro, hun skal skifte koden
 * igen — den ER skiftet — og heller ikke må få at vide, at udlogningen
 * lykkedes, når den ikke gjorde.
 */
export const KVITTERINGER = ['skiftet', 'skiftet-uden-logud'] as const
export type Kvittering = (typeof KVITTERINGER)[number]

/** Kender vi ikke værdien, er der ingen kvittering — aldrig et gæt. */
export function kvitteringFra(v: unknown): Kvittering | null {
  return typeof v === 'string' && (KVITTERINGER as readonly string[]).includes(v)
    ? (v as Kvittering)
    : null
}

/** Bekræftelseslinkets landingsadresse, som den skal stå i emailRedirectTo. */
export function callbackUrl(base: string, k: Kontekst): string {
  const u = new URL('/auth/callback', base)
  u.searchParams.set(K_PARAM, k)
  return u.toString()
}

/**
 * Gendannelseslinkets landingsadresse, som den skal stå i redirectTo.
 *
 * Bygget af callbackUrl, ikke ved siden af den: ruten og konteksten er
 * det samme spørgsmål for begge forløb, og to steder ville drive.
 */
export function gendanUrl(base: string, k: Kontekst): string {
  const u = new URL(callbackUrl(base, k))
  u.searchParams.set(F_PARAM, 'gendan')
  return u.toString()
}
