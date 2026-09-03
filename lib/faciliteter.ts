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
  udeplads: ['altan', 'terrasse'],
} as const

/** Ethvert ord et filter kan ramme. */
export type Facilitetsord = (typeof FACILITET)[keyof typeof FACILITET][number]

/**
 * De samme ting, som udlejeren spoerges om i formularen.
 *
 * Typen er bundet til `FACILITET` ovenfor: skriver nogen "kæledyr
 * tilladte" her, fejler oversaettelsen. Foer stod ordene to steder uden
 * baand imellem, og en tastefejl ville have gjort afkrydsningen virkningsloes
 * uden at nogen kunne se det.
 *
 * Kun de tre ting, der KAN filtreres paa. At spoerge om mere ville give
 * udlejeren arbejde uden at gavne nogen, der soeger.
 */
export const FACILITETER: readonly { vaerdi: Facilitetsord; navn: string }[] = [
  { vaerdi: 'elevator', navn: 'Elevator' },
  { vaerdi: 'altan', navn: 'Altan' },
  { vaerdi: 'terrasse', navn: 'Terrasse' },
  { vaerdi: 'kæledyr tilladt', navn: 'Kæledyr er tilladt' },
]
