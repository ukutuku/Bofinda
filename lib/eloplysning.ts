// ═══════════════════════════════════════════════════════════════
//  Hvad kan vi sige om el?
//
//  Ligger i sin EGEN fil uden databaseimport, saa baade kortene,
//  boligsiden og alarmmailen kan spoerge det samme sted. Teksterne er
//  forskellige de tre steder — et kort har ikke plads til en saetning —
//  men SPOERGSMAALET maa kun besvares ét sted. Det er reglen i CLAUDE.md
//  om to udtryk, der svarer paa det samme.
// ═══════════════════════════════════════════════════════════════

/**
 * De fire tilstande. Tre af dem handler om, hvorvidt el er MED i tallet.
 * Den fjerde handler om noget andet: om vi overhovedet ved, hvad tallet
 * daekker.
 *
 *   med             el er en navngiven post i totalen. Ingen linje noedvendig.
 *   egen-maaler     kilden siger selv, at lejeren afregner el direkte.
 *   ikke-med        posterne er udspecificerede, og el er ikke blandt dem.
 *                   Vi kan AFLAESE at el ikke er i tallet.
 *   ukendt-daekning acontoen er ét samlet beloeb uden specifikation. El
 *                   KAN ligge i klumpen. Vi ved det ikke.
 *
 * Forskellen paa de to sidste er hele pointen. "El er ikke med i tallet"
 * og "vi ved ikke hvad der er i tallet" er to forskellige udsagn, og kun
 * det foerste kan aflaeses af udspecificerede poster. Sagde vi "el indgaar
 * ikke" om en klump, ville vi paastaa noget, vi ikke har faaet at vide.
 */
export type Eltilstand = 'med' | 'egen-maaler' | 'ikke-med' | 'ukendt-daekning'

/** Posterne, en kilde kan NAVNGIVE. Samme tre som `FULD` i lib/soeg.ts. */
const NAVNGIVNE = ['heat', 'water', 'electricity']

/**
 * Tilstanden for ÉN bolig. `null` = der skal ingen linje staa.
 *
 * Uden en total er der ikke noget tal at tage forbehold for — der staar
 * "Udlejer oplyser ikke aconto" i stedet, og to forbehold oven i hinanden
 * hjaelper ingen.
 */
export function eltilstand(b: {
  total: number | null
  el: number | null
  elEgenMaaler: boolean | null
  poster: string[] | null
}): Eltilstand | null {
  if (b.total == null) return null
  if (b.el != null) return 'med'
  if (b.elEgenMaaler) return 'egen-maaler'
  return samletKlump(b.poster) ? 'ukendt-daekning' : 'ikke-med'
}

/**
 * Er acontoen ét samlet beloeb uden specifikation?
 *
 * `other` uden en eneste navngiven post. Det er de 254 boliger fra
 * LokalBolig, Propstep og Dacas, hvor kilden skriver "Aconto pr. md.:
 * 1.783 kr." og intet andet — hverken overskrift, note eller
 * specifikation siger, hvad beloebet daekker.
 */
export const samletKlump = (poster: string[] | null): boolean =>
  poster != null && poster.includes('other') && !poster.some((p) => NAVNGIVNE.includes(p))
