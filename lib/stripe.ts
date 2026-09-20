// ═══════════════════════════════════════════════════════════════
//  Stripe-klienten og prismodellen.
//
//  ── PRISMODELLEN, ORDRET ─────────────────────────────────────
//     9 kr.   for de foerste 24 timer
//   349 kr.   ved udloebet af de 24 timer
//   349 kr.   derefter hver 28. dag
//  Alle beloeb er kundens SAMLEDE pris inkl. moms, i DKK.
//
//  ── HVORDAN DEN UDTRYKKES I STRIPE ───────────────────────────
//  IKKE som en prøveperiode. En `trial` er GRATIS hos Stripe — der er
//  ingen mekanisme til at tage 9 kr. for en prøveperiode. Havde vi
//  brugt `trial_period_days: 1`, ville de foerste 24 timer have kostet
//  0 kr., og modellen var en anden end den, der blev bestilt.
//
//  I stedet TO priser paa samme produkt, begge med `interval: 'day'`:
//
//      intro:  unit_amount 900,    recurring { interval: 'day', interval_count: 1 }
//      normal: unit_amount 34900,  recurring { interval: 'day', interval_count: 28 }
//
//  `'day'` er en dokumenteret intervalvaerdi — se
//  node_modules/stripe/esm/resources/Prices.d.ts:271:
//      type Interval = 'day' | 'month' | 'week' | 'year' | OtherString
//  saa baade «24 timer» og «28 dage» kan udtrykkes praecist. 28 dage er
//  IKKE en maaned: en maaned ville give 12 traek om aaret paa skiftende
//  datoer, 28 dage giver 13 paa faste intervaller.
//
//  Overgangen styres af en `SubscriptionSchedule` med to faser:
//    fase 1 · intro-prisen, `iterations: 1`  → én 24-timers periode
//    fase 2 · normalprisen, ingen iterations → loeber videre
//  Stripe skifter fase paa det praecise faseskel, saa fornyelsen faar
//  ét entydigt tidspunkt 24 timer efter starten — og starten er, naar
//  introbetalingen GENNEMFOERES, ikke naar betalingssiden blev aabnet.
//
//  ── HVAD DER IKKE ER EFTERPROEVET ────────────────────────────
//  `api.stripe.com` er spaerret i det miljoe, det her blev bygget i
//  (CONNECT svarer 000). Kaldene nedenfor er skrevet mod SDK'ens
//  typer, som er den dokumenterede overflade, men de er ALDRIG koert
//  mod Stripe — heller ikke i sandbox. Se rapportens afsnit
//  «Manglende verifikation» for den praecise liste, der skal koeres i
//  testtilstand, FOER muren slaas til.
// ═══════════════════════════════════════════════════════════════

import Stripe from 'stripe'

/** Beloeb i oere, som alt andet i projektet. Aldrig float. */
export const INTRO_OERE = 900
export const NORMAL_OERE = 34900
export const INTRO_TIMER = 24
export const NORMAL_DAGE = 28
export const VALUTA = 'dkk'

/**
 * Konfigurationen. Alt kommer fra miljøet — ingen noegle i koden, og
 * ingen pris hardkodet i et Stripe-kald: priserne oprettes én gang i
 * Stripes dashboard, og deres id'er saettes her.
 */
export interface Stripeopsaetning {
  hemmelighed: string
  webhookHemmelighed: string
  introPrisId: string
  normalPrisId: string
}

/**
 * Er Stripe overhovedet sat op?
 *
 * GRATIS tilstand skal virke UDEN Stripe-noegler. Derfor er den her
 * funktion den eneste vej ind: mangler noget, faar man null, og
 * kaldet ovenfor siger pænt fra i stedet for at kaste en
 * konfigurationsfejl i ansigtet paa en bruger, der bare ville se en
 * bolig.
 */
export function opsaetning(): Stripeopsaetning | null {
  const hemmelighed = process.env.STRIPE_SECRET_KEY
  const webhookHemmelighed = process.env.STRIPE_WEBHOOK_SECRET
  const introPrisId = process.env.STRIPE_PRIS_INTRO
  const normalPrisId = process.env.STRIPE_PRIS_NORMAL
  if (!hemmelighed || !webhookHemmelighed || !introPrisId || !normalPrisId) return null
  return { hemmelighed, webhookHemmelighed, introPrisId, normalPrisId }
}

/** Klienten. Kastes kun, hvis nogen kalder den uden opsaetning. */
export function stripe(o: Stripeopsaetning): Stripe {
  return new Stripe(o.hemmelighed, {
    // Laast til den version, SDK'ets typer er bygget mod. Uden den
    // foelger vi Stripes nyeste automatisk, og et felt kan skifte
    // betydning under os uden en commit.
    apiVersion: '2026-08-26.dahlia',
    appInfo: { name: 'Bofinda', url: 'https://bofinda.dk' },
  })
}

/**
 * Fasens navn ud fra pris-id'et. Bruges til visningen og til
 * maalingen — aldrig til at afgoere adgang.
 */
export function fase(prisId: string | null, o: Stripeopsaetning): 'intro' | 'normal' | null {
  if (prisId === o.introPrisId) return 'intro'
  if (prisId === o.normalPrisId) return 'normal'
  return null
}

/**
 * De to faser, som `SubscriptionSchedule` skal have.
 *
 * Udskilt fra kaldet, saa formen kan proeves uden en Stripe-forbindelse
 * — og saa der er ÉT sted, der siger hvad modellen er.
 */
export function faser(o: Stripeopsaetning) {
  return [
    // Fase 1: PRAECIS ét doegn til introprisen.
    //
    // `duration`, ikke `iterations`. Feltet `iterations` er FJERNET fra
    // Stripes API: det findes ikke i én eneste typedefinition i den
    // installerede SDK — kun i node_modules/stripe/CHANGELOG.md, hvor
    // fjernelsen er noteret. Et kald med `iterations` ville blive afvist.
    // Erstatningen staar i Phase-typen: `duration?: Phase.Duration`, hvor
    // Duration er `{ interval: 'day'|'week'|'month'|'year', interval_count? }`.
    {
      items: [{ price: o.introPrisId, quantity: 1 }],
      duration: { interval: 'day' as const, interval_count: 1 },
    },
    // Fase 2: normalprisen, ingen duration → loeber indtil opsigelse.
    // `proration_behavior: 'none'`: faseskiftet maa ikke udloese en
    // forholdsmaessig efterregulering. Kunden betaler 349 kr., ikke
    // 349 kr. plus et broekdelsbeloeb, ingen har lovet hende.
    { items: [{ price: o.normalPrisId, quantity: 1 }], proration_behavior: 'none' as const },
  ]
}
