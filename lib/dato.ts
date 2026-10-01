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

/**
 * Hele kalenderdoegn mellem to dage i Bofindas zone.
 *
 * Begge argumenter er allerede resolvet til en DAG, saa differencen
 * regnes paa kalenderen og ikke paa et tidsrum. Det er forskellen paa
 * «i gaar» og «for 23,5 timer siden»: en bolig set kl. 23 i gaar er i
 * gaar kl. 08 i dag, ogsaa selv om der kun er gaaet ni timer.
 *
 * `Date.UTC` paa to YYYY-MM-DD: begge bliver midnat UTC, saa
 * differencen er et helt multiplum af et doegn uanset sommertid.
 */
export function dageMellem(fra: IsoDate, til: IsoDate): number {
  const ms = (d: IsoDate) =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((ms(til) - ms(fra)) / 86_400_000)
}

/**
 * Hvor laenge siden var det? Som en dansk saetning, der kan staa efter
 * et udsagnsord: «annonceret for 3 timer siden», «set af os lige nu».
 *
 * `Date.now()` staar inde i funktionen. Availability-laget faar sit
 * `referenceNow` udefra; det her er en visningsstreng ved siden af, og
 * den maa ikke skifte betydning, fordi den flyttede fil.
 *
 * ── HVORFOR DEN LIGGER HER OG IKKE I EN SENERE SKIVE ─────────
 *
 * Funktionen hoerer oprindeligt til 25ded34, som er en del af
 * kortudsagns-skiven (S6). app/beskeder/tid.ts og
 * app/kontakt-ui/Annoncekort.tsx importerer den, og de er DENNE skive.
 * Uden de elleve linjer her kan skiven ikke oversaettes, og saa var den
 * ikke laengere fri — den ville skulle merges EFTER S6.
 *
 * Elleve linjer duplikeret er billigere end en raekkefoelgebinding
 * mellem to skiver, der ellers ikke deler noget. Naar S6 lander,
 * konflikter den her — og oploesningen er at beholde ÉN af dem,
 * ikke at have to.
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
