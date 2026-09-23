// ═══════════════════════════════════════════════════════════════
//  Brugerrejsen fra boligannonce til kontakt og beskeder —
//  datakontrakten.
//
//  ═══ FILEN ER REN ═══
//
//  Ingen database, ingen next/headers, ingen React. Samme regel som
//  app/beskeder/kontrakt.ts og lib/gemoenske.ts: modulet importeres af
//  KLIENTkomponenter, og et værdi-import fra et modul, der trækker
//  `postgres` med ind, væltede engang hele appen på `Can't resolve
//  'net'`. Serverlaget må importere herfra; herfra importeres intet
//  ud over beskedmodulets egen kontrakt.
//
//  ═══ FRONTEND AFGØR INGENTING ═══
//
//  Der står ikke ét sted i `app/kontakt-ui/`, om kunden har betalt,
//  hvornår en adgang udløber, eller om vi er i gratis eller betalende
//  tilstand. Adapteren svarer med ÉN tilstand pr. funktion, og
//  brugerfladen adlyder den. Supply ejer reglen.
//
//  Det er derfor `Kontaktsvar` er en diskrimineret union og ikke et
//  objekt med et `laast`-flag ved siden af oplysningerne: i de låste
//  varianter FINDES hverken kontaktoplysninger eller samtale. En
//  komponent kan ikke gengive noget, den ikke har fået.
//
//  ⚠ ═══ TYPERNE ER UDVIKLERHJÆLP, IKKE SIKKERHED ═══
//
//  Nøjagtig samme forbehold som i app/beskeder/kontrakt.ts, og det
//  gælder ordret her: typer findes ikke ved kørselstid, der er ingen
//  kode der fjerner felter på vej ud, og intet her er et bevis for, at
//  private data ikke forlader en server. Serverlaget skal selv
//  kontrollere adgang OG ejerskab i hver forespørgsel og EKSPLICIT
//  bygge et svar uden private felter, når adgangen afvises.
//  Se SERVERINTEGRATION.md.
// ═══════════════════════════════════════════════════════════════

import type { Laasegrund } from '../beskeder/kontrakt'

export type { Laasegrund }

// ── Annoncen: hvad den ER ───────────────────────────────────────
//
// Slagsen er en egenskab ved BOLIGEN, ikke ved kundens adgang. En
// scrapet bolig har en kilde at henvise til, og der linker vi — det er
// projektets regel, ikke en adgangsregel, og derfor spørger rejsen slet
// ikke adapteren om adgang for en ekstern annonce. Der er ingenting at
// låse op: linket til kildens egen annonce er offentligt.

interface Fael {
  id: string
  /** Uden postnummer og by — som boligkortene gør det. */
  adresse: string
  /** «2300 København S». Null hvis kilden ikke oplyser det. */
  sted: string | null
  /** «Lejlighed · 3 vær. · 72 m²». Bygges af strukturerede felter. */
  overskrift: string
  /** ISO 8601. Brugerfladen formaterer med `siden()` i lib/dato.ts. */
  setAfOs: string
}

export type Annonce =
  /** Udlejeren har oprettet den selv. Kontakt og samtale sker HOS OS. */
  | (Fael & { slags: 'native' })
  /**
   * Hentet fra en kilde. Kontakten sker HOS KILDEN, og den eneste
   * handling er vejen derhen. `videreHref` er vores egen `/go/<id>` —
   * aldrig kildens URL direkte, for ruten må ikke kunne bruges som et
   * åbent redirect.
   */
  | (Fael & {
    slags: 'ekstern'
    /** Kildens visningsnavn: «home.dk», «CEJ», «Propstep». */
    kilde: string
    videreHref: string
    /** Hvornår kilden selv annoncerede den. Null hvis ukendt. */
    annonceret: string | null
  })

// ── Adgangen: hvad kunden må, funktion for funktion ─────────────

/**
 * Hvad udlejeren HAR oplyst — ikke hvad hun har oplyst.
 *
 * ═══ ADRESSEN MÅ IKKE LIGGE I SVARET ═══
 *
 * CLAUDE.md: *«Mailadresser står aldrig som rå tekst på en offentlig
 * side. Adressehøstere læser markup på minutter. Værdien hentes med en
 * server action, når nogen trykker, så den ikke er i svaret.»*
 *
 * Derfor to booleans her og en selvstændig `hentKontakt()` på porten.
 * Det er præcis det mønster, produktet allerede bruger på boligsiden
 * (`harKontaktMail` / `harKontaktTlf` + `hentKontakt` i
 * app/bolig/[id]/kontakthandling.ts), og det er værd at gentage: et
 * felt, der aldrig forlader serveren, kan ikke lække ved en
 * uopmærksom UI-ændring.
 */
export interface Kontaktoplyst {
  harMail: boolean
  harTelefon: boolean
}

/** Selve værdierne. Hentes FØRST når et menneske trykker. */
export interface Kontaktoplysninger {
  mail: string | null
  telefon: string | null
}

/**
 * Må der startes eller åbnes en samtale?
 *
 * Den står FOR SIG, og ikke som en afledning af `tilstand`. I gratis
 * tilstand kan kontaktoplysningerne godt være åbne, mens en samtale
 * kræver en konto — og så skal login stå dér, hvor funktionen kræver
 * det, og ingen andre steder. Det er Supplys beslutning, ikke vores, og
 * derfor er den et selvstændigt felt.
 */
export type Samtaleadgang =
  | { slags: 'kan-starte' }
  /**
   * Der er allerede en samtale.
   *
   * ⚠ `samtaleId` BRUGES IKKE TIL AT FORVÆLGE DEN ENDNU. `Beskedmodul`
   * tager `{ port, loginHref, abonnementHref }` og har ingen prop til
   * en forvalgt samtale, så «Åbn beskeder» åbner indbakken — ikke
   * tråden. Id'et står her, fordi serveren HAR det, og fordi
   * forvalget er ét felt væk den dag beskedmodulet får proppen. At
   * ændre modulet hører til modulets egen opgave, ikke denne.
   * Handlingen hedder derfor «Åbn beskeder» og ikke «Åbn samtalen»:
   * knappen skal love dét, den gør. Se SERVERINTEGRATION.md.
   */
  | { slags: 'i-gang'; samtaleId: string }
  | { slags: 'kraever-login' }

/**
 * Adapterens svar om ÉN native annonce.
 *
 * ═══ «FEJL» ER IKKE «INGEN ADGANG» ═══
 *
 * `fejl` er en egen tilstand og må aldrig falde sammen med de to
 * abonnementstilstande. Et kald, der ikke kom igennem, siger INTET om,
 * hvorvidt kunden har betalt — og at sende hende til betaling, fordi
 * vores eget opslag fejlede, er at tage penge for en fejl, vi selv har
 * lavet. Derfor:
 *
 *   · `fejl` giver en neutral besked og et genforsøg. Ingen pris,
 *     ingen abonnementsknap, ingen login-opfordring.
 *   · En AFVIST Promise fra porten ender samme sted. De to er ikke det
 *     samme — et svar er ikke et udfald — men brugeren skal se det
 *     samme, og hun skal kunne prøve igen.
 */
export type Kontaktsvar =
  | {
    tilstand: 'adgang'
    /** KUN om der er noget. Værdierne hentes med `hentKontakt()`. */
    kontakt: Kontaktoplyst
    samtale: Samtaleadgang
    /**
     * Er adgangen opsagt, men løber videre til en dato? ISO 8601.
     *
     * ⚠ BRUGERFLADEN REGNER IKKE PÅ DEN. Den viser den. Adgangen er
     * allerede afgjort af `tilstand`, og datoen er en oplysning ved
     * siden af — aldrig et led i en beslutning. Null når der ikke er
     * noget at sige.
     */
    ophoerer: string | null
  }
  | { tilstand: Laasegrund }
  | { tilstand: 'fejl' }

export type Startsvar =
  | { ok: true; samtaleId: string }
  /** Adgangen er ændret, siden svaret blev hentet. Hele panelet låses. */
  | { ok: false; grund: Laasegrund }
  /** Teknisk. Neutral besked og genforsøg — ALDRIG en vej til betaling. */
  | { ok: false; grund: 'fejl' }

/**
 * Brugerfladens eneste vej til data om adgang.
 *
 * Komponenterne kalder aldrig `fetch` eller en server action direkte.
 * De får en port ind — præcis som beskedmodulet — og det er dét, der
 * gør rejsen afprøvbar med syntetiske oplysninger uden et midlertidigt
 * produktions-API.
 *
 * Begge må afvise deres løfte. En afvist Promise er ikke det samme som
 * et svar, der siger nej, og begge dele sker i virkeligheden.
 */
export interface Kontaktport {
  hentAdgang(boligId: string): Promise<Kontaktsvar>
  /**
   * Selve kontaktoplysningerne. Kaldes FØRST når et menneske trykker,
   * så adressen ikke står i det første svars markup.
   *
   * Serverlaget skal kontrollere adgangen HER IGEN — `hentAdgang` gav en
   * visningstilladelse, ikke en adgangskontrol, og adgangen kan være
   * ændret siden. Se SERVERINTEGRATION.md.
   */
  hentKontakt(boligId: string): Promise<Kontaktoplysninger>
  /** I prøvevisningen er den SIMULERET. Der oprettes ingenting. */
  startSamtale(boligId: string): Promise<Startsvar>
}

/**
 * Prisforløbet står som ÉN sætning, ét sted.
 *
 * ═══ HVORFOR DEN IKKE ER DELT I TO ═══
 *
 * «9 kr.» alene er sandt i 24 timer og vildledende bagefter. Delte vi
 * strengen — introprisen ét sted, den løbende et andet — ville de to
 * kunne komme fra hinanden i et layout, og så står der en pris uden sit
 * forløb. Som én konstant kan det ikke lade sig gøre: viser man prisen,
 * viser man hele forløbet.
 *
 * ⚠ TALLENE EJES AF SUPPLY. De står her, fordi brugerfladen skal kunne
 * vise dem i dag, og fordi opgaven har givet ordlyden ordret. Den rigtige
 * plads er hos Supply, sammen med det, Stripe fakturerer — ellers kan
 * sætningen og regningen komme fra hinanden. Det står på listen i
 * SERVERINTEGRATION.md.
 *
 * Beskedmodulet har med vilje INGEN pris; se app/beskeder/DATAKONTRAKT.md.
 * Den hører til dér, hvor der spørges om penge, og kun dér.
 */
export const PRISFORLOEB = '9 kr. de første 24 timer. Derefter 349 kr. hver 28. dag.'

// Der er med vilje INGEN `erLaast()` her. Den fandtes et øjeblik og
// skrev de tre grunde af en gang til — to udtryk for ét spørgsmål, og
// det ene ville stille returnere `false` den dag en fjerde grund kom
// til. `Kontaktpanel` klarer sig med compilerens egen indsnævring:
// tager man `'fejl'` fra først, ER resten `Laasegrund`, og bytter nogen
// om på de to linjer, fejler bygget.
