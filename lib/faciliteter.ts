// ═══════════════════════════════════════════════════════════════
//  Faciliteter — ordene, filtrene og formularen deles om.
//
//  Ligger i sin EGEN fil uden databaseimport, fordi udlejerformularen er
//  en klientkomponent. Stod listen i lib/udlejer.ts, ville et import af
//  den traekke db/client.ts og dermed `postgres` med ind i browserbundtet
//  — og saa vaelter hele appen paa `Can't resolve 'net'`.
// ═══════════════════════════════════════════════════════════════

/**
 * Soegefiltrene: hvilke ord i `amenities` taeller som hvad.
 *
 * Ordene er kildernes egne. findbolig og Propstep skriver "kæledyr
 * tilladt", "elevator", "altan" og "terrasse", og det er dem, der staar i
 * kolonnen. Vi oversaetter dem ikke — vi filtrerer paa dem.
 */
export const FACILITET = {
  kaeledyr: ['kæledyr tilladt'],
  elevator: ['elevator'],
  // CEJ skelner ikke mellem altan og terrasse — adapterens ord er derfor
  // det samlede. Filteret betyder netop «altan ELLER terrasse», saa ordet
  // hoerer hjemme her; at oversaette det til ét af de to ville vaere et gaet.
  udeplads: ['altan', 'terrasse', 'altan eller terrasse'],
} as const

/** Ethvert ord et filter kan ramme. */
export type Facilitetsord = (typeof FACILITET)[keyof typeof FACILITET][number]

/**
 * De samme ting, som udlejeren spoerges om i formularen.
 *
 * `as const satisfies` og ikke en annotation. Forskellen er hele
 * typevagten nedenfor: en annotation (`readonly { vaerdi: Facilitetsord
 * … }[]`) WIDENER `vaerdi` til hele unionen, saa delingen ikke kan
 * udtrykkes. `satisfies` tjekker det samme og beholder literalerne.
 *
 * Kun de ting, der KAN filtreres paa. At spoerge om mere ville give
 * udlejeren arbejde uden at gavne nogen, der soeger.
 */
export const FACILITETER = [
  { vaerdi: 'elevator', navn: 'Elevator' },
  { vaerdi: 'altan', navn: 'Altan' },
  { vaerdi: 'terrasse', navn: 'Terrasse' },
  { vaerdi: 'kæledyr tilladt', navn: 'Kæledyr er tilladt' },
] as const satisfies readonly { vaerdi: Facilitetsord; navn: string }[]

/**
 * Ord et FILTER kan ramme, men formularen med VILJE ikke spoerger om.
 *
 * Vaerdien er grunden. Den staar her og ikke i en kommentar, fordi
 * udeladelsen skal kunne forsvares af den, der moeder den — og fordi en
 * kommentar kan slettes uden at noget faar nogen til at taenke sig om.
 */
export const UDEN_FOR_FORMULAREN = {
  // CEJ skelner ikke mellem altan og terrasse og skriver det samlede ord.
  // Filteret SKAL ramme det, for ellers forsvinder deres boliger ud af
  // udeplads-soegningen. Men det er en KILDES skrivemaade, ikke et
  // spoergsmaal, man kan stille en udlejer: hun ved, om der er altan, og
  // hun ved, om der er terrasse. Spurgte vi om «altan eller terrasse»,
  // bad vi hende svare paa noget vagere, end hun ved.
  'altan eller terrasse':
    'kildens samlede skrivemaade (CEJ) — udlejeren kender de to hver for sig',
} as const satisfies Partial<Record<Facilitetsord, string>>

// ═══════════════════════════════════════════════════════════════
//  TYPEVAGTEN · delingen er udtoemmende OG disjunkt
//
//  Bindingen mellem `FACILITETER` og `FACILITET` daekkede kun den ene
//  halvdel. Den fangede en forkert vaerdi — «kæledyr tilladte» fejler —
//  men IKKE en manglende, for en annotation tillader enhver laengde,
//  ogsaa en kortere end unionen. Maalt dengang: `Facilitetsord` havde
//  fem medlemmer, `FACILITETER` fire.
//
//  Fuldstaendighed ville have vaeret den forkerte rettelse: det femte
//  ord mangler MED VILJE. Derfor en DELING. Hvert ord skal staa ét af to
//  steder, og et sjette ord tvinger dermed et VALG frem for en
//  tilfoejelse — nogen skal skrive, om udlejeren kan spoerges om det.
//
//  `KunNever` fejler med TS2344, naar dens argument ikke er `never`, og
//  fejlteksten navngiver det hjemloese ord.
// ═══════════════════════════════════════════════════════════════

type IFormularen = (typeof FACILITETER)[number]['vaerdi']
type Udeladt = keyof typeof UDEN_FOR_FORMULAREN

/** Fejler ved oversaettelse, hvis `T` ikke er `never`. */
type KunNever<T extends never> = T

/** Et ord, der hverken staar i formularen eller blandt de udeladte. */
type _udenHjem = KunNever<Exclude<Facilitetsord, IFormularen | Udeladt>>

/** Et ord, der staar BEGGE steder. Delingen skal ogsaa vaere disjunkt:
 *  et ord, formularen spoerger om, er ikke bevidst udeladt. */
type _begge = KunNever<Extract<IFormularen, Udeladt>>

// ═══════════════════════════════════════════════════════════════
//  NØGLERNE — så opregningen aldrig skrives i hånden igen.
//
//  De tre filtre var opregnet 14+ steder: `Filtre`, `hvor()`,
//  `facetter()`, `opsummering()`, `facilitetsgrundlag`, `tavseKilder`,
//  `filtreFraParametre`, `tilParametre`, `harFiltre`, `filterpanel`,
//  `alarm`, `maaling`, `maalingsoeg` ×3 og `app/page.tsx` ×5. Hvert
//  sted var korrekt; tilsammen var de en tidsindstillet fejl, for en
//  udvidelse skulle huskes i alle.
//
//  CLAUDE.md kræver, at et facilitetsfilter navngiver de kilder, der
//  tier, og tæller de tre grupper. Den regel kan ikke «komme bagefter»
//  en udvidelse, hvis opregningen er UDLEDT: et nyt begreb i FACILITET
//  bliver et felt, et filter, et aggregat, en afkrydsning og en
//  grundlagslinje af sig selv.
//
//  Nøglerne er stadig NAVNE og ikke numre, og feltnavnene på `Filtre`
//  er uændrede — `saved_searches.criteria` er en serialiseret `Filtre`,
//  så en omdøbning ville kræve en datamigrering af gemte søgninger.
// ═══════════════════════════════════════════════════════════════

/** Begreberne, ikke ordene. `kaeledyr` | `elevator` | `udeplads` i dag. */
export type Facilitetsnoegle = keyof typeof FACILITET

/**
 * Nøglerne som en liste, til hver opregning.
 *
 * `Object.keys` og ikke en skrevet liste: en skrevet liste ville være
 * det andet udtryk for `FACILITET`, og de to kunne drive fra hinanden —
 * præcis den fejlform, hele denne fil handler om.
 */
export const FACILITETSNOEGLER = Object.keys(FACILITET) as Facilitetsnoegle[]

/**
 * Det, brugeren ser. Små bogstaver, fordi det er formen i filterchips
 * og i alarmmailens filterlinje; afkrydsningen og grundlagslinjen
 * bruger `stortForbogstav`, så der kun er ÉN streng pr. begreb.
 *
 * `satisfies Record<Facilitetsnoegle, string>` og ikke `Partial`: et nyt
 * begreb UDEN et navn er TS2741. Uden den binding ville et nyt filter
 * kunne nå skærmen med sin nøgle som etiket.
 */
export const FACILITETSNAVN = {
  kaeledyr: 'kæledyr tilladt',
  elevator: 'elevator',
  udeplads: 'altan eller terrasse',
} as const satisfies Record<Facilitetsnoegle, string>

export const stortForbogstav = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
