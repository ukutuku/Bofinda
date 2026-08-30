// ═══════════════════════════════════════════════════════════════
//  Beloeb. Alt gemmes i oere. Aldrig float.
// ═══════════════════════════════════════════════════════════════

export const kronerTilOere = (kr: number): number => Math.round(kr * 100)
export const oereTilKroner = (oere: number): number => oere / 100

/**
 * Laeser et dansk beloeb fra en kildes tekst. "12.500 kr.", "kr. 4.250,50",
 * "3450" -> oere.
 *
 * Returnerer null hvis strengen ikke utvetydigt er ét beloeb. Et gaet her
 * ender i total_monthly og dermed i det loefte, der baerer produktet.
 */
export function parseDanskBeloebTilOere(input: string | null | undefined): number | null {
  if (!input) return null
  const s = input.replace(/ /g, ' ').trim()

  // Intervaller ("8.000 - 12.000 kr.") er ikke ét beloeb. Afvis.
  if (/\d\s*[-–]\s*\d/.test(s)) return null

  const m = s.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?/)
  if (!m) return null

  const hel = Number(m[1]!.replace(/[.\s]/g, ''))
  if (!Number.isFinite(hel)) return null
  const decimaler = m[2] ? Number(m[2].padEnd(2, '0')) : 0
  return hel * 100 + decimaler
}
