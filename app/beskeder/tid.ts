// ═══════════════════════════════════════════════════════════════
//  Tidspunkter i beskedmodulet.
//
//  Den RELATIVE formulering — «for 3 timer siden» — hentes fra
//  lib/dato.ts og skrives ikke om her. Den fandtes engang to steder og
//  drev fra hinanden, så boligsiden skrev «oprettet … 6 dage siden» uden
//  «for». Se noten i lib/dato.ts; reglen er CLAUDE.md's:
//  *«Svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted.»*
//
//  Det ENESTE, der er nyt her, er den nøjagtige tid til `title` og
//  `<time>`: «20. sep. 2026 kl. 14.32». Relativ tid er let at overskue,
//  men den kan ikke bruges til at svare på «hvornår skrev hun præcis?»,
//  og i en samtale er det tit netop dét, man leder efter.
// ═══════════════════════════════════════════════════════════════

import { KALENDERZONE, siden } from '../../lib/dato'

export { siden }

const NOEJAGTIG = new Intl.DateTimeFormat('da-DK', {
  timeZone: KALENDERZONE,
  day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})

/** «20. sep. 2026, 14.32» — til `title` og til skærmlæsere. */
export const noejagtig = (iso: string): string => NOEJAGTIG.format(new Date(iso))

/**
 * Klokkeslættet alene: «14.32».
 *
 * Bruges i tråden, hvor dagen står som sin egen skillelinje. At gentage
 * datoen på hver eneste boble ville være støj i præcis det, man læser
 * hurtigst.
 */
const KLOKKEN = new Intl.DateTimeFormat('da-DK', {
  timeZone: KALENDERZONE, hour: '2-digit', minute: '2-digit',
})
export const klokken = (iso: string): string => KLOKKEN.format(new Date(iso))

/**
 * Dagens overskrift i tråden: «I dag», «I går» eller «20. september».
 *
 * Sammenligningen sker på KALENDERDAGEN i Bofindas zone, ikke på antal
 * timer. To beskeder med fire timers mellemrum kan ligge på hver sin
 * dag, og en tidsforskel ville kalde dem den samme.
 */
const DAG = new Intl.DateTimeFormat('da-DK', {
  timeZone: KALENDERZONE, day: 'numeric', month: 'long',
})
const DAGSNOEGLE = new Intl.DateTimeFormat('en-CA', {
  timeZone: KALENDERZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

export function dagsskel(iso: string, nu: Date = new Date()): string {
  const d = DAGSNOEGLE.format(new Date(iso))
  if (d === DAGSNOEGLE.format(nu)) return 'I dag'
  const igaar = new Date(nu.getTime() - 86_400_000)
  if (d === DAGSNOEGLE.format(igaar)) return 'I går'
  return DAG.format(new Date(iso))
}

/** Er de to tidspunkter på samme kalenderdag i Bofindas zone? */
export const sammeDag = (a: string, b: string): boolean =>
  DAGSNOEGLE.format(new Date(a)) === DAGSNOEGLE.format(new Date(b))
