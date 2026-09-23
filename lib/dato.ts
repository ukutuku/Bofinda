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

/**
 * Et tidspunkt, skrevet som et menneske i Danmark laeser det.
 *
 * Zonen er EKSPLICIT — se filens hoved. `toLocaleString('da-DK')` uden
 * zone bruger SERVERENS, og Vercel koerer UTC: en periode, der udloeber
 * kl. 00.30 dansk tid, ville blive skrevet med dagen foer. Det er en
 * forkert DATO om nogens penge, produceret af en manglende indstilling.
 */
export const dansk = (t: Date): string =>
  t.toLocaleString('da-DK', { timeZone: KALENDERZONE })

/** Hvilken kalenderdag er dette oejeblik i Bofindas zone? */
export function kalenderdag(t: Date): IsoDate {
  return FORMAT.format(t) as IsoDate
}

// ═══════════════════════════════════════════════════════════════
//  «for 3 timer siden» — ÉT sted.
//
//  Funktionen fandtes to gange, ordret ens paa naer to ting: kortets
//  udgave skrev «for … siden» og havde et «lige nu», mens boligsidens
//  skrev «3 timer siden» uden «for». Paa boligsiden blev det til
//  «oprettet … 6 dage siden», som mangler et ord for at vaere dansk.
//
//  «lige nu» daekker de foerste ~30 sekunder, ikke det foerste minut:
//  `min` er allerede afrundet, saa 29 sek. giver «lige nu» og 30 sek.
//  giver «for 1 min. siden». Maalt, ikke laest.
//
//  Det er moenstret fra CLAUDE.md: to udtryk for ét spoergsmaal, begge
//  naesten rigtige, drevet fra hinanden. Svaret regnes nu ét sted, og
//  begge sider afleder det derfra.
//
//  Den ligger HER og ikke i en komponent, fordi filen er ren — ingen
//  database, ingen React, ingen next/headers — og derfor kan deles af
//  baade kortet og boligsiden uden at traekke noget med sig.
//
//  `Date.now()` staar inde i funktionen, som den gjorde begge steder
//  foer. Availability-laget faar sit `referenceNow` udefra; det her er
//  en visningsstreng ved siden af, og den maa ikke skifte betydning,
//  fordi den flyttede fil.
// ═══════════════════════════════════════════════════════════════

/**
 * Hvor laenge siden var det? Som en dansk saetning, der kan staa efter
 * et udsagnsord: «annonceret for 3 timer siden», «set af os lige nu».
 */
export function siden(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'lige nu'
  if (min < 60) return `for ${min} min. siden`
  const t = Math.round(min / 60)
  if (t < 24) return `for ${t} ${t === 1 ? 'time' : 'timer'} siden`
  const dg = Math.round(t / 24)
  if (dg < 31) return `for ${dg} ${dg === 1 ? 'dag' : 'dage'} siden`
  const m = Math.round(dg / 30)
  return `for ${m} ${m === 1 ? 'måned' : 'måneder'} siden`
}
