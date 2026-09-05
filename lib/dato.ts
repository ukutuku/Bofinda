// ═══════════════════════════════════════════════════════════════
//  Kalenderdatoer.
//
//  En kilde, der skriver «2026-09-05», har sagt en DAG — ikke et
//  oejeblik. Gemmes den som midnat UTC, har vi opfundet et klokkeslaet,
//  kilden aldrig har oplyst, og sammenligninger begynder at afhaenge af,
//  hvilken tidszone serveren tilfaeldigvis staar i. Derfor er typen en
//  valideret streng, ikke en Date.
//
//  Bofindas kalenderzone er Europe/Copenhagen: boligerne er danske, og
//  «kan overtages i dag» betyder i dag i Danmark — ogsaa naar serveren
//  staar i en anden zone. Zonen er EKSPLICIT overalt; intet kald bruger
//  serverens lokale zone implicit.
// ═══════════════════════════════════════════════════════════════

/** En valideret kalenderdato, YYYY-MM-DD. Branded: en tilfaeldig streng
 *  kan ikke blive en IsoDate uden at gaa gennem `isoDato()`. */
export type IsoDate = string & { readonly __isoDate: unique symbol }

export const KALENDERZONE = 'Europe/Copenhagen'

/**
 * Validerer baade FORM og VIRKELIGHED. «2026-02-31» har formen, men er
 * ikke en dag i nogen kalender — round-trip gennem Date.UTC afsloerer
 * den, fordi JS ruller den over i marts.
 */
export function isoDato(v: unknown): IsoDate | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  const [aar, md, dag] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(aar, md - 1, dag))
  if (d.getUTCFullYear() !== aar || d.getUTCMonth() !== md - 1 || d.getUTCDate() !== dag) {
    return null
  }
  return v as IsoDate
}

// en-CA formaterer som YYYY-MM-DD. Intl haandterer sommer-/vintertid.
const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: KALENDERZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Hvilken kalenderdag er dette oejeblik i Bofindas zone? */
export function kalenderdag(t: Date): IsoDate {
  return FORMAT.format(t) as IsoDate
}
