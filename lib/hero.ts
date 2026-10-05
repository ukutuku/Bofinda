// ═══════════════════════════════════════════════════════════════
//  Forsidefotoets varianter — ét sted.
//
//  Bredderne her er BÅDE dem, `scripts/hero-varianter.ts` skriver til
//  public/hero/, og dem, srcset'en på forsiden tilbyder. Står de to
//  steder, kan srcset'en love en fil, der ikke findes, og så får netop
//  de skærme, der vælger den, et brudt billede. `npm test` holder
//  filerne op mod listen (scripts/test-hastighed.ts).
//
//  Ren fil: ingen database, ingen next-import. Den importeres af siden,
//  af scriptet og af prøven.
// ═══════════════════════════════════════════════════════════════

/** Bredder i px. 2048 er originalens egen bredde og loftet. */
export const HERO_BREDDER = [640, 960, 1280, 1600, 1920, 2048] as const
export type HeroBredde = (typeof HERO_BREDDER)[number]

export const heroVariant = (b: HeroBredde): string => `/hero/hero-stue-${b}.webp`

export const HERO_SRCSET = HERO_BREDDER.map((b) => `${heroVariant(b)} ${b}w`).join(', ')

/**
 * Hvor bredt billedet TEGNES, ikke hvor bred rammen er.
 *
 * `.hero-billede img` har `object-fit: cover`. På en smal skærm er rammen
 * højere end billedets forhold, så billedet skaleres til rammens HØJDE og
 * beskæres i siderne. Målt i Chromium på main 31b5680: rammen er ~400 css-px
 * høj op til ~600 px's bredde, og billedet tegnes derfor ~600 css-px bredt
 * (360, 390 og 414 px gav 600, 600 og 564). Over 600 px er det bredden, der
 * afgør, og så er det 100vw (`.fuldbredde` når skærmkanten).
 *
 * Skrev vi `100vw` hele vejen, valgte en telefon på 390 px med DPR 3 en
 * variant på 1280 og tegnede den 600 css-px bred — 2,1 px pr. css-px mod
 * originalens 3,4. Det ville være et synligt tab, ikke en optimering.
 * Ændres hero'ens højde, skal tallet her måles igen.
 */
export const HERO_SIZES = '(max-width: 600px) 600px, 100vw'
