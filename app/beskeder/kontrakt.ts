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
//  ⚠ ═══ TYPERNE ER UDVIKLERHJÆLP, IKKE SIKKERHED ═══
//
//  Unionerne herunder gør det svært at komme til at gengive indhold i en
//  låst tilstand, og de gør det tydeligt, hvad serveren skal sende. Det
//  er alt, de gør. De er:
//
//    · IKKE autorisation. Typer findes ikke ved kørselstid. Enhver kan
//      kalde en server action eller en rute direkte, uden vores klient.
//    · IKKE en filtrering af svar. Der er ingen kode, der fjerner felter
//      på vej ud; et serverlag, der lægger `samtaler` ved siden af en
//      låst tilstand, sender dem — typen er væk, når JSON'en pakkes.
//    · IKKE et bevis for, at private data ikke forlader serveren.
//
//  **Serverlaget skal derfor selv kontrollere adgang OG ejerskab i hver
//  eneste forespørgsel og EKSPLICIT bygge et svar uden private felter,
//  når adgangen afvises.** Ikke returnere det fulde objekt og lade
//  typen «skjule» noget. Se DATAKONTRAKT.md afsnit 6.
//
//  Det, typen giver, er at `{ tilstand: 'login-kraevet' }` ikke HAR et
//  `samtaler`-felt, så den vej ind er lukket ved et uheld. Den vej ind
//  ved en fejl i serverlaget er ikke lukket af noget her.
// ═══════════════════════════════════════════════════════════════

/**
 * Hvorfor indholdet er lukket.
 *
 * `abonnement-kraevet` er «har aldrig haft et», `abonnement-udloebet` er
 * «har haft et». De to får forskellig tekst og forskelligt knapnavn —
 * «Se abonnement» mod «Genaktivér» — fordi det er to forskellige
 * situationer for den, der står i dem.
 *
 * ═══ ET UDLØBET ABONNEMENT LÅSER BEGGE VEJE ═══
 *
 * Besluttet. I betalingstilstand låser `abonnement-udloebet` BÅDE
 * læsning og skrivning: beskederne vises ikke, og der kan ikke skrives.
 * De bevares i basen og bliver tilgængelige igen ved genaktivering —
 * der slettes ingenting.
 *
 * En opsigelse med resterende betalt adgang låser IKKE. Adgangen løber
 * til periodens udløb, og først derefter er tilstanden
 * `abonnement-udloebet`. Regnestykket — `cancelAtPeriodEnd` sammen med
 * `currentPeriodEnd` — hører til hos Supply og ikke her.
 *
 * I gratis tilstand er det Supplys centrale adgangsbeslutning, der
 * afgør tilstanden. Brugerfladen kender ikke forskel på de to
 * tilstande; den får ét ord og viser det.
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

export type Indbakke =
  | { tilstand: 'adgang'; samtaler: Samtalehoved[] }
  | { tilstand: Laasegrund }

export type Samtaletraad =
  | { tilstand: 'adgang'; hoved: Samtalehoved; beskeder: Besked[] }
  | { tilstand: Laasegrund }
  /** Samtalen findes ikke, eller den er ikke denne brugers. Samme svar med vilje. */
  | { tilstand: 'findes-ikke' }

export type Sendefejl =
  /** Kaldet nåede ikke frem, eller serveren svarede ikke. Kan prøves igen. */
  | 'netvaerk'
  /** Over `MAKS_TEGN`. Kan ikke prøves igen uden at rette teksten. */
  | 'for-lang'
  /** Adgangen er ændret, siden tråden blev hentet. */
  | 'laast'
  | 'ukendt'

/**
 * Svaret på en afsendelse.
 *
 * `laast` bærer sin GRUND. Uden den ville brugerfladen vide, at adgangen
 * var lukket, men ikke kunne sige hvorfor — og så ville den eneste
 * ærlige besked være «genindlæs», hvilket er at bede brugeren om at
 * gøre vores arbejde. Med grunden kan modulet gå direkte i den rigtige
 * låste visning med den rigtige knap.
 */
export type Sendesvar =
  | { ok: true; besked: Besked }
  | { ok: false; fejl: Exclude<Sendefejl, 'laast'> }
  | { ok: false; fejl: 'laast'; grund: Laasegrund }

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
 *
 * Alle fire må afvise deres løfte. Modulet håndterer det — en afvist
 * Promise er ikke det samme som et svar, der siger nej, og begge dele
 * sker i virkeligheden.
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

/** Er tilstanden en låsning? Ét udtryk, brugt af både modulet og porten. */
export const erLaast = (t: Indbakke['tilstand'] | Samtaletraad['tilstand']): t is Laasegrund =>
  t === 'login-kraevet' || t === 'abonnement-kraevet' || t === 'abonnement-udloebet'
