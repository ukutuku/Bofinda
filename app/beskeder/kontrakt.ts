// ═══════════════════════════════════════════════════════════════
//  Beskedmodulets datakontrakt.
//
//  ═══ FILEN ER REN ═══
//
//  Ingen database, ingen next/headers, ingen React. Samme regel som
//  lib/gemoenske.ts og lib/faciliteter.ts: modulet importeres af
//  KLIENTkomponenter, og et værdi-import fra et modul, der trækker
//  `postgres` med ind, væltede engang hele appen på `Can't resolve
//  'net'`. Serverlaget må importere herfra; herfra importeres intet.
//
//  ═══ ADGANGSREGLERNE EJES AF SUPPLY, IKKE AF KOMPONENTERNE ═══
//
//  Ingen komponent regner ud, om nogen har betalt, om et abonnement er
//  udløbet, eller om en samtale er gratis. Serverlaget sender ÉN
//  eksplicit visningstilladelse, og brugerfladen adlyder den.
//
//  Det er derfor `Indbakke` og `Samtaletraad` er diskriminerede unioner
//  og ikke objekter med et `laast`-flag ved siden af indholdet: i de
//  låste varianter FINDES beskedfelterne ikke. En komponent kan ikke
//  komme til at gengive indhold, den ikke har fået, og en «skjul det
//  med CSS»-fejl kan ikke skrives ned. Opgavens krav — *«beskedindhold
//  må ikke blot skjules med CSS; den endelige serverintegration skal
//  undlade at udlevere indholdet»* — står altså i typen og ikke i en
//  aftale, nogen skal huske.
//
//  Serverlaget skal derfor returnere `{ tilstand: 'login-kraevet' }`
//  UDEN `samtaler`, ikke `{ tilstand: 'login-kraevet', samtaler: [...] }`
//  med et tomt flag. Kompilatoren håndhæver det.
// ═══════════════════════════════════════════════════════════════

/**
 * Hvorfor indholdet er lukket.
 *
 * `abonnement-kraevet` er «har aldrig haft et», `abonnement-udloebet` er
 * «har haft et». De to får forskellig tekst og forskelligt knapnavn —
 * «Se abonnement» mod «Genaktivér» — fordi det er to forskellige
 * situationer for den, der står i dem.
 */
export type Laasegrund = 'login-kraevet' | 'abonnement-kraevet' | 'abonnement-udloebet'

/** Alle tilstande, brugerfladen kan stå i. Bruges af prøvevisningen. */
export const LAASEGRUNDE: readonly Laasegrund[] =
  ['login-kraevet', 'abonnement-kraevet', 'abonnement-udloebet'] as const

export interface Modpart {
  /** Udlejerens eller den boligsøgendes navn. Null → brugerfladen skriver rollen. */
  navn: string | null
  rolle: 'udlejer' | 'boligsoegende'
}

export interface Boligreference {
  id: string
  /** Uden postnummer og by — som boligkortene gør det. */
  adresse: string
  /** «2300 København S». Null hvis kilden ikke oplyser det. */
  sted: string | null
}

/**
 * Det, oversigten viser om én samtale.
 *
 * `uddrag` forkortes af SERVEREN, ikke af brugerfladen. Sendte vi hele
 * beskeden og klippede med CSS, ville hele teksten stå i markuppen — og
 * det er samme fejl som at skjule et låst indhold med `display: none`.
 */
export interface Samtalehoved {
  id: string
  bolig: Boligreference
  modpart: Modpart
  /** ISO 8601. Brugerfladen formaterer med `siden()` i lib/dato.ts. */
  sidsteAktivitet: string
  uddrag: string | null
  /** Antal ulæste. 0 = ingen markering. */
  ulaeste: number
}

export interface Besked {
  id: string
  /** Afgjort af serveren ud fra den indloggede bruger — aldrig af klienten. */
  fra: 'mig' | 'modpart'
  tekst: string
  /** ISO 8601. */
  tidspunkt: string
}

/**
 * Må der skrives i tråden?
 *
 * Skemaets egen note siger det: *«Spær ved AFSENDELSE, server-side.
 * Udløbet abonnement betyder skrivebeskyttet historik — slet aldrig
 * beskeder.»* Derfor er skrivning en SELVSTÆNDIG tilladelse og ikke en
 * afledning af adgangen: Supply kan give læseadgang til historikken
 * uden at give skriveadgang, og brugerfladen skal kunne vise begge dele
 * uden at gætte, hvilken regel der gjaldt.
 */
export type Skrivetilstand = 'kan-skrive' | 'skrivebeskyttet'

export type Indbakke =
  | { tilstand: 'adgang'; samtaler: Samtalehoved[] }
  | { tilstand: Laasegrund }

export type Samtaletraad =
  | {
    tilstand: 'adgang'
    hoved: Samtalehoved
    beskeder: Besked[]
    skriv: Skrivetilstand
  }
  | { tilstand: Laasegrund }
  /** Samtalen findes ikke, eller den er ikke denne brugers. Samme svar med vilje. */
  | { tilstand: 'findes-ikke' }

export type Sendefejl =
  /** Kaldet nåede ikke frem, eller serveren svarede ikke. Kan prøves igen. */
  | 'netvaerk'
  /** Over `MAKS_TEGN`. Kan ikke prøves igen uden at rette teksten. */
  | 'for-lang'
  /** Adgangen er ændret, siden tråden blev hentet. Genindlæs. */
  | 'laast'
  | 'ukendt'

export type Sendesvar =
  | { ok: true; besked: Besked }
  | { ok: false; fejl: Sendefejl }

/**
 * Længdegrænsen står ÉT sted og afledes begge steder fra.
 *
 * Tælleren i skrivefeltet og serverens afvisning svarer på det samme
 * spørgsmål. To tal ville drive fra hinanden, og brugeren ville se et
 * felt, der sagde god for en tekst, serveren kastede væk. Se CLAUDE.md:
 * *«Svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted.»*
 */
export const MAKS_TEGN = 2000

/** Tælleren vises først, når der er under så mange tegn tilbage. */
export const TAELLER_FRA = 200

/**
 * Brugerfladens eneste vej til data.
 *
 * Komponenterne kalder ALDRIG `fetch` eller en server action direkte.
 * De får en port ind, og den kan være tre ting: serverlagets rigtige
 * implementering (kommer efter Supplys levering), prøvevisningens
 * syntetiske, eller en, en prøve bygger. Det er dét, der gør modulet
 * afprøvbart uden et midlertidigt produktions-API.
 */
export interface Beskedport {
  hentIndbakke(signal?: AbortSignal): Promise<Indbakke>
  hentTraad(samtaleId: string, signal?: AbortSignal): Promise<Samtaletraad>
  send(samtaleId: string, tekst: string): Promise<Sendesvar>
  /**
   * Kvitter for, at tråden er set. Må fejle i stilhed — en ulæst-markering,
   * der bliver stående et øjeblik for længe, er ikke værd at afbryde nogen for.
   */
  markerLaest(samtaleId: string): Promise<void>
}

/** Summen af ulæste på tværs af samtaler. Regnes ét sted, vises flere. */
export const ulaesteIAlt = (s: Samtalehoved[]): number =>
  s.reduce((n, x) => n + x.ulaeste, 0)

/** Modpartens navn, eller rollen hvis det ikke er oplyst. Aldrig en pladsholder. */
export const modpartsnavn = (m: Modpart): string =>
  m.navn ?? (m.rolle === 'udlejer' ? 'Udlejeren' : 'Den boligsøgende')
