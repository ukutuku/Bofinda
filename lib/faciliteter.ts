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
 * ═══ BINDINGEN DAEKKER ÉN HALVDEL ═══
 *
 * Bindingen til `Facilitetsord` fanger en TASTEFEJL: skriver nogen
 * "kæledyr tilladte" her, fejler oversaettelsen. Det var altid sandt og
 * er stadig sandt.
 *
 * Men den fangede ikke en UDELADELSE. Annotationen stod foer som
 * `readonly { vaerdi: Facilitetsord; navn: string }[]`, og et array af
 * den type maa have enhver laengde — ogsaa nul. Et nyt filterord kunne
 * altsaa komme til i `FACILITET` uden at naa formularen, og saa ville
 * ingen udlejer kunne krydse det af, mens filteret skjulte hver eneste
 * annonce, der manglede det.
 *
 * ═══ OG HER ER UDELADELSEN MED VILJE ═══
 *
 * Derfor er listen IKKE bundet til at vaere hele unionen. Ordet
 * `altan eller terrasse` er CEJ's samlede ord — en KILDES skrivemaade,
 * ikke et spoergsmaal, man kan stille en udlejer. At tvinge det ind i
 * formularen ville vaere at rette en fejl, der ikke var der.
 *
 * Svaret er en DELING i stedet for en fuldstaendighed: hvert ord i
 * `FACILITET` skal enten staa her eller i `IKKE_I_FORMULAREN` nedenfor.
 * Et nyt ord tvinger dermed et VALG, ikke en tilfoejelse — og et glemt
 * ord bliver roedt ved oversaettelsen.
 */
export const FACILITETER = [
  { vaerdi: 'elevator', navn: 'Elevator' },
  { vaerdi: 'altan', navn: 'Altan' },
  { vaerdi: 'terrasse', navn: 'Terrasse' },
  { vaerdi: 'kæledyr tilladt', navn: 'Kæledyr er tilladt' },
] as const satisfies readonly { vaerdi: Facilitetsord; navn: string }[]

/**
 * Filterord, udlejeren BEVIDST ikke spoerges om.
 *
 * `altan eller terrasse` er CEJ's egen samlede formulering. Filteret
 * `udeplads` rammer den, men en udlejer skal krydse «Altan» eller
 * «Terrasse» af — ikke et ord, der betyder «én af de to».
 *
 * Listen er ikke en undtagelsesliste, man kan fylde for at slippe for
 * at tage stilling: staar et ord her, er paastanden, at ingen udlejer
 * skal spoerges om det. Den paastand skal kunne forsvares.
 */
export const IKKE_I_FORMULAREN = [
  'altan eller terrasse',
] as const satisfies readonly Facilitetsord[]

/**
 * Delingen haandhaeves ved oversaettelsen, ikke ved gennemlaesning.
 *
 * Kommer der et femte ord i `FACILITET`, og placeres det hverken i
 * `FACILITETER` eller i `IKKE_I_FORMULAREN`, er `_Uplaceret` ikke
 * laengere `never`, typen herunder bliver `false`, og tildelingen af
 * `true` fejler i `tsc`.
 */
type _Uplaceret = Exclude<
  Facilitetsord,
  (typeof FACILITETER)[number]['vaerdi'] | (typeof IKKE_I_FORMULAREN)[number]
>
const _alleOrdPlaceret: [_Uplaceret] extends [never] ? true : false = true
void _alleOrdPlaceret
