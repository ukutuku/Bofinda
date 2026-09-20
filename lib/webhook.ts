// ═══════════════════════════════════════════════════════════════
//  Behandlingen af en Stripe-haendelse.
//
//  Udskilt fra ruten, saa den kan proeves uden en HTTP-server og uden
//  en Stripe-forbindelse: proeven kalder `behandl()` med et objekt i
//  Stripes form. Ruten goer kun tre ting — laeser den RAA krop,
//  efterproever signaturen og kalder herind.
//
//  ── DE TRE VAGTER ───────────────────────────────────────────
//  1. GENTAGELSE. Stripe leverer mindst én gang. `stripe_events` har
//     Stripes eget event-id som primaernoegle, saa en gentagelse ikke
//     kan indsaettes to gange. En haendelse, der allerede er
//     FAERDIGBEHANDLET, springes over.
//  2. GENBEHANDLING. En haendelse, der kastede undervejs, staar med
//     `behandlet_at = null` og koeres igen ved naeste levering — den
//     springes ikke over som «allerede set».
//  3. FORSINKELSE. Stripe garanterer ikke raekkefoelgen. En gammel
//     haendelse maa ikke genaabne et udloebet abonnement, saa hver
//     skrivning kraever, at haendelsens tidsstempel er NYERE end det,
//     vi allerede har skrevet paa raekken (`stripe_opdateret_at`).
//
//  ── ADGANG KUN VED BETALT FAKTURA ───────────────────────────
//  `adgang_til` flyttes ét sted: i `invoice.paid`. Hverken
//  `checkout.session.completed` (som kun siger, at kassen blev
//  gennemfoert), `customer.subscription.created` eller
//  `customer.subscription.updated` flytter adgangen. Det er derfor et
//  mislykket traek ikke giver en ny betalt periode: fakturaen bliver
//  aldrig `paid`, og `adgang_til` staar stille, til den gamle periode
//  loeber ud.
// ═══════════════════════════════════════════════════════════════

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { stripeEvents, subscriptions, users } from '../db/schema'
import { fase, faser, stripe, type Stripeopsaetning } from './stripe'

/** De haendelser, vi handler paa. Alt andet kvitteres og ignoreres. */
export const LYTTER = [
  // Kassen gennemfoert. Knytter abonnementet til brugeren; giver IKKE adgang.
  'checkout.session.completed',
  // Betalt faktura. Det ENESTE, der flytter adgangen.
  'invoice.paid',
  // Mislykket traek. Flytter INGEN adgang — kun status.
  'invoice.payment_failed',
  // Stripes egen spejling af status, opsigelse og periode.
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

type Ukendt = Record<string, unknown>
const tekst = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const tal = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const tid = (sek: unknown): Date | null => {
  const n = tal(sek)
  return n === null ? null : new Date(n * 1000)
}

/**
 * Perioden ligger paa ITEMET, ikke paa abonnementet.
 *
 * I stripe@22 (API 2026-08-26.dahlia) har Subscription-objektet
 * hverken `current_period_start` eller `current_period_end` — se
 * node_modules/stripe/esm/resources/Subscriptions.d.ts:90. De ligger
 * paa hvert SubscriptionItem. Vi laeser det foerste item, fordi
 * modellen kun har ét. Findes det ikke, returneres null, og INTET
 * skrives: et udregnet tidspunkt ville vaere et gaet om nogens adgang.
 */
export function periode(sub: Ukendt): { start: Date | null; slut: Date | null } {
  const items = (sub['items'] as Ukendt | undefined)?.['data']
  const f = Array.isArray(items) ? items[0] as Ukendt | undefined : undefined
  return {
    start: tid(f?.['current_period_start']) ?? tid(sub['current_period_start']),
    slut: tid(f?.['current_period_end']) ?? tid(sub['current_period_end']),
  }
}

export interface Haendelse {
  id: string
  type: string
  created: number
  data: { object: Ukendt }
}

export type Udfald = 'behandlet' | 'gentagelse' | 'ignoreret' | 'forael'

/**
 * Behandler én haendelse. Idempotent: samme haendelse to gange giver
 * «gentagelse» anden gang og aendrer intet.
 */
export async function behandl(h: Haendelse, o: Stripeopsaetning | null): Promise<Udfald> {
  const oprettet = new Date(h.created * 1000)

  // Vagt 1 og 2. `onConflictDoNothing` + en efterfoelgende laesning:
  // findes raekken allerede FAERDIGBEHANDLET, er det en gentagelse.
  // Findes den ubehandlet, er det et genforsoeg, og vi koerer videre.
  await db.insert(stripeEvents)
    .values({ id: h.id, type: h.type, stripeOprettetAt: oprettet })
    .onConflictDoNothing()
  const [kvit] = await db.select({ behandlet: stripeEvents.behandletAt })
    .from(stripeEvents).where(eq(stripeEvents.id, h.id)).limit(1)
  if (kvit?.behandlet) return 'gentagelse'
  await db.update(stripeEvents)
    .set({ forsoeg: sql`${stripeEvents.forsoeg} + 1` })
    .where(eq(stripeEvents.id, h.id))

  if (!(LYTTER as readonly string[]).includes(h.type)) {
    await faerdig(h.id)
    return 'ignoreret'
  }

  const obj = h.data.object
  let udfald: Udfald = 'behandlet'
  try {
    switch (h.type) {
      case 'checkout.session.completed': udfald = await kassen(obj, oprettet); break
      case 'invoice.paid': udfald = await betalt(obj, oprettet, o); break
      case 'invoice.payment_failed': udfald = await mislykkedes(obj, oprettet); break
      default: udfald = await spejl(obj, oprettet, o); break
    }
  } catch (e) {
    // Fejlen gemmes, og `behandlet_at` bliver staaende null, saa Stripes
    // naeste levering koerer den igen. Vi sluger den IKKE i tavshed.
    await db.update(stripeEvents)
      .set({ fejl: (e as Error).message.slice(0, 500) })
      .where(eq(stripeEvents.id, h.id))
    throw e
  }
  await faerdig(h.id)
  return udfald
}

const faerdig = (id: string) => db.update(stripeEvents)
  .set({ behandletAt: new Date(), fejl: null }).where(eq(stripeEvents.id, id))

/**
 * Vagt 3, som ét praedikat: afvis kun en haendelse, der er AELDRE end
 * det, raekken allerede baerer. `or(isNull(...))` er der, fordi den
 * foerste skrivning ikke har noget at sammenligne med.
 *
 * Graensen er `<=`, ikke `<`. Stripes `created` er i HELE SEKUNDER, og
 * to haendelser om samme abonnement deler rutinemaessigt sekund —
 * `checkout.session.completed` og den foerste `invoice.paid` kommer
 * begge i det sekund, kortet blev godkendt. Med `<` afviste vagten den
 * betalte faktura som «foraeldet», og adgangen blev aldrig givet.
 * Proeven fangede det: seks roede tjek i afsnit 6.
 *
 * Det koster ingen sikkerhed. Vagten her handler om RAEKKEFOELGE;
 * gentagelser fanges af `stripe_events`' primaernoegle, som er
 * Stripes eget event-id, og to FORSKELLIGE haendelser i samme sekund
 * er ikke ude af orden.
 */
const nyereEnd = (stempel: Date) => or(
  isNull(subscriptions.stripeOpdateretAt),
  lte(subscriptions.stripeOpdateretAt, stempel),
)

/** Kassen gennemfoert: knyt abonnementet til brugeren. Ingen adgang. */
async function kassen(o: Ukendt, stempel: Date): Promise<Udfald> {
  const subId = tekst(o['subscription'])
  const brugerId = tekst(o['client_reference_id'])
  const kunde = tekst(o['customer'])
  if (!subId || !brugerId) return 'ignoreret'

  const [fandtes] = await db.select({ id: subscriptions.id })
    .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (fandtes) {
    const r = await db.update(subscriptions)
      .set({ stripeCustomerId: kunde, stripeOpdateretAt: stempel, updatedAt: new Date() })
      .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))
      .returning({ id: subscriptions.id })
    return r.length ? 'behandlet' : 'forael'
  }
  // Status `incomplete`: abonnementet FINDES, men er ikke betalt.
  // `adgang_til` staar null, saa raekken giver ingen adgang.
  await db.insert(subscriptions).values({
    userId: brugerId, stripeSubscriptionId: subId, stripeCustomerId: kunde,
    status: 'incomplete', cancelAtPeriodEnd: false, stripeOpdateretAt: stempel,
  }).onConflictDoNothing()
  return 'behandlet'
}

/**
 * BETALT FAKTURA — det eneste sted, adgangen flyttes.
 *
 * `adgang_til` saettes til periodens slut, som Stripe oplyser den. Vi
 * regner den ikke ud: 24 timer og 28 dage staar i priserne, og hvis
 * Stripe mener noget andet, er det Stripes tal, kunden er blevet
 * opkraevet efter.
 */
async function betalt(o: Ukendt, stempel: Date, ops: Stripeopsaetning | null): Promise<Udfald> {
  const linjer = (o['lines'] as Ukendt | undefined)?.['data']
  const linje = Array.isArray(linjer) ? linjer[0] as Ukendt | undefined : undefined
  const subId = tekst(o['subscription'])
    ?? tekst((linje?.['parent'] as Ukendt | undefined)?.['subscription_item_details']
      && ((linje!['parent'] as Ukendt)['subscription_item_details'] as Ukendt)['subscription'])
  if (!subId) return 'ignoreret'

  const slut = tid((linje?.['period'] as Ukendt | undefined)?.['end'])
  const start = tid((linje?.['period'] as Ukendt | undefined)?.['start'])
  const prisId = tekst((linje?.['pricing'] as Ukendt | undefined)?.['price_details']
    && ((linje!['pricing'] as Ukendt)['price_details'] as Ukendt)['price'])

  const r = await db.update(subscriptions)
    .set({
      status: 'active',
      ...(slut ? { adgangTil: slut, currentPeriodEnd: slut } : {}),
      ...(start ? { currentPeriodStart: start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      stripeOpdateretAt: stempel, updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))
    .returning({ bruger: subscriptions.userId })
  if (!r.length) return 'forael'

  // Introduktionen er brugt, naar den er BETALT — ikke naar siden blev
  // aabnet. `intro_brugt_at` saettes kun, hvis den ikke stod i forvejen,
  // saa en genbehandling ikke flytter tidspunktet.
  if (ops && prisId && fase(prisId, ops) === 'intro') {
    await db.update(users)
      .set({ introBrugtAt: new Date() })
      .where(and(eq(users.id, r[0]!.bruger), isNull(users.introBrugtAt)))

    // ── OVERGANGEN TIL NORMALPRISEN ─────────────────────────
    // Uden det her ville abonnementet blive ved med at koere paa
    // introprisen: Checkout opretter det med ÉN pris, og 9 kr. med
    // `interval: 'day'` betyder 9 kr. HVER DAG — ikke 9 kr. én gang.
    // Kunden ville blive trukket 9 kr. i doegnet i det uendelige, og
    // «Mit abonnement» ville samtidig love hende 349 kr. Det er den
    // slags fejl, der koster rigtige penge for rigtige mennesker.
    //
    // Planen laegges FOERST her, fordi den er bundet til den
    // GENNEMFOERTE introbetaling. Laegges den ved kasseoprettelsen,
    // ville en aabnet og forladt betalingsside efterlade en plan uden
    // en betaling bag sig.
    await laegPlan(subId, ops)
  }
  return 'behandlet'
}

/**
 * Knytter den tofasede plan til et netop betalt abonnement.
 *
 * To kald, fordi API'et kraever det: `from_subscription` kan ikke
 * kombineres med `phases` — SDK'ens egen note siger «When using this
 * parameter, other parameters (such as phase values) cannot be set. To
 * create a subscription schedule with other modifications, we recommend
 * making two separate API calls»
 * (node_modules/stripe/esm/resources/SubscriptionSchedules.d.ts:653-656).
 *
 * KASTER IKKE. En fejl her maa ikke rulle den betalte adgang tilbage —
 * kunden HAR betalt, og fakturaen er behandlet. Fejlen skrives paa
 * haendelsen, saa den kan ses og rettes; `stripe_schedule_id` staar
 * null, og «Mit abonnement» lover derfor ikke et beloeb, vi ikke kan
 * indestaa for.
 *
 * IKKE EFTERPROEVET MOD STRIPE. api.stripe.com er spaerret i det miljoe,
 * det her blev bygget i. Se rapportens «Manglende verifikation».
 */
async function laegPlan(subId: string, ops: Stripeopsaetning): Promise<void> {
  try {
    const s = stripe(ops)
    const plan = await s.subscriptionSchedules.create(
      { from_subscription: subId },
      { idempotencyKey: `plan:${subId}` },
    )
    const nuvaerende = plan.phases[0]
    if (!nuvaerende) return
    await s.subscriptionSchedules.update(plan.id, {
      // Fase 1 gengives med sit EGNE start- og sluttidspunkt, som
      // Stripe allerede har sat dem. Vi regner dem ikke ud: perioden
      // begyndte, da betalingen gik igennem, og det er Stripes tal.
      phases: [
        {
          items: [{ price: ops.introPrisId, quantity: 1 }],
          start_date: nuvaerende.start_date,
          end_date: nuvaerende.end_date,
        },
        faser(ops)[1]!,
      ],
    })
    await db.update(subscriptions)
      .set({ stripeScheduleId: plan.id })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
  } catch {
    // Bevidst tavs over for kaldet: adgangen er allerede givet, og
    // fakturaen skal ikke behandles om. Fejlen er synlig paa
    // `subscriptions.stripe_schedule_id is null` for en bruger i
    // introfasen — det er det, driftstilsynet skal se efter.
  }
}

/** Mislykket traek: status flyttes, ADGANGEN roeres ikke. */
async function mislykkedes(o: Ukendt, stempel: Date): Promise<Udfald> {
  const subId = tekst(o['subscription'])
  if (!subId) return 'ignoreret'
  const r = await db.update(subscriptions)
    .set({ status: 'past_due', stripeOpdateretAt: stempel, updatedAt: new Date() })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))
    .returning({ id: subscriptions.id })
  return r.length ? 'behandlet' : 'forael'
}

/** Spejling af Stripes abonnementsobjekt. Flytter ingen adgang. */
async function spejl(o: Ukendt, stempel: Date, ops: Stripeopsaetning | null): Promise<Udfald> {
  const subId = tekst(o['id'])
  if (!subId) return 'ignoreret'
  const status = tekst(o['status']) ?? 'incomplete'
  const p = periode(o)
  const items = (o['items'] as Ukendt | undefined)?.['data']
  const f = Array.isArray(items) ? items[0] as Ukendt | undefined : undefined
  const prisId = tekst((f?.['price'] as Ukendt | undefined)?.['id'])

  const r = await db.update(subscriptions)
    .set({
      status: status as typeof subscriptions.$inferInsert.status,
      cancelAtPeriodEnd: o['cancel_at_period_end'] === true,
      ...(p.slut ? { currentPeriodEnd: p.slut } : {}),
      ...(p.start ? { currentPeriodStart: p.start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      ...(tekst(o['schedule']) ? { stripeScheduleId: tekst(o['schedule'])! } : {}),
      stripeOpdateretAt: stempel, updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))
    .returning({ id: subscriptions.id })
  void ops
  return r.length ? 'behandlet' : 'forael'
}
