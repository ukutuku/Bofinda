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

import { and, eq, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, stripeEvents, subscriptions, users } from '../db/schema'
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

export type Udfald =
  | 'behandlet'
  | 'gentagelse'   // set og faerdigbehandlet foer
  | 'i_gang'       // en anden behandler har kravet lige nu
  | 'ignoreret'    // ikke en haendelse, vi lytter paa
  | 'forael'       // aeldre end det, raekken allerede baerer
  /**
   * AFVENTER er det udfald, der manglede. Haendelsen er gyldig, men
   * forudsaetningen er ikke kommet endnu — typisk en `invoice.paid`,
   * der overhaler sin `checkout.session.completed`. Den maa IKKE
   * markeres faerdig: goer man det, giver genleveringen «gentagelse»,
   * og den betalte periode er tabt for altid. Den var reproducerbar
   * paa 832d483.
   */
  | 'afventer'

/** Et krav frigives, hvis behandleren doer. Stripe leverer igen. */
const KRAV_TIMEOUT_MIN = 5

/**
 * Behandler én haendelse. Idempotent: samme haendelse to gange giver
 * «gentagelse» anden gang og aendrer intet.
 */
export async function behandl(h: Haendelse, o: Stripeopsaetning | null): Promise<Udfald> {
  const oprettet = new Date(h.created * 1000)

  // ── Vagt 1-3: ét ATOMISK krav paa haendelsen ────────────────
  // Foer stod her en laesning af `behandlet_at` efterfulgt af en
  // beslutning. To samtidige leveringer laeste begge null og fortsatte
  // begge — primaernoeglen forhindrer to RAEKKER, ikke to BEHANDLERE.
  //
  // Nu tages kravet med ÉN betinget UPDATE. Den rammer enten én raekke
  // (vi har kravet) eller nul (en anden har det, eller den er faerdig).
  // `paabegyndt_at` frigives efter KRAV_TIMEOUT_MIN, saa en doed
  // behandler ikke laaser haendelsen for evigt.
  await db.insert(stripeEvents)
    .values({ id: h.id, type: h.type, stripeOprettetAt: oprettet })
    .onConflictDoNothing()

  const krav = await db.update(stripeEvents)
    .set({ paabegyndtAt: new Date(), forsoeg: sql`${stripeEvents.forsoeg} + 1` })
    .where(and(
      eq(stripeEvents.id, h.id),
      isNull(stripeEvents.behandletAt),
      or(
        isNull(stripeEvents.paabegyndtAt),
        lte(stripeEvents.paabegyndtAt,
          sql`now() - interval '${sql.raw(String(KRAV_TIMEOUT_MIN))} minutes'`),
      ),
    ))
    .returning({ id: stripeEvents.id })

  if (!krav.length) {
    const [kvit] = await db.select({ behandlet: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, h.id)).limit(1)
    return kvit?.behandlet ? 'gentagelse' : 'i_gang'
  }

  if (!(LYTTER as readonly string[]).includes(h.type)) {
    await faerdig(h.id)
    return 'ignoreret'
  }

  const obj = h.data.object
  let udfald: Udfald = 'behandlet'
  try {
    switch (h.type) {
      case 'checkout.session.completed': udfald = await kassen(obj, oprettet, h.id); break
      case 'invoice.paid': udfald = await betalt(obj, oprettet, o); break
      case 'invoice.payment_failed': udfald = await mislykkedes(obj, oprettet); break
      default: udfald = await spejl(obj, oprettet, o); break
    }
  } catch (e) {
    // Fejlen gemmes, og `behandlet_at` bliver staaende null, saa Stripes
    // naeste levering koerer den igen. Vi sluger den IKKE i tavshed.
    // Kravet frigives, saa genleveringen kan tage fat med det samme
    // og ikke skal vente KRAV_TIMEOUT_MIN ud. `behandlet_at` bliver
    // staaende null — vi sluger ikke fejlen.
    await db.update(stripeEvents)
      .set({ fejl: (e as Error).message.slice(0, 500), paabegyndtAt: null })
      .where(eq(stripeEvents.id, h.id))
    throw e
  }
  // AFVENTER markeres IKKE faerdig. Kravet frigives i stedet, saa
  // Stripes naeste levering kan tage det op igen, naar forudsaetningen
  // er kommet. Det er hele rettelsen af fund 1a.
  if (udfald === 'afventer') {
    await db.update(stripeEvents)
      .set({ paabegyndtAt: null, fejl: 'afventer forudsaetning' })
      .where(eq(stripeEvents.id, h.id))
    return udfald
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
async function kassen(o: Ukendt, stempel: Date, eventId: string): Promise<Udfald> {
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
  //
  // KONFLIKTEN MAA IKKE SKJULES. `onConflictDoNothing` stod her alene,
  // og saa forsvandt det tilfaelde, hvor kontoen ALLEREDE har et
  // levende abonnement: det delvist unikke indeks afviste
  // indsaettelsen, vi svarede «behandlet», og Stripe stod med et
  // ANDET, opkraevende abonnement, som Bofinda ikke fulgte. Nu
  // opdages det, og det andet abonnement bogfoeres, saa et menneske
  // kan se det — vi opsiger det ikke selv; det er kundens penge.
  const indsat = await db.insert(subscriptions).values({
    userId: brugerId, stripeSubscriptionId: subId, stripeCustomerId: kunde,
    status: 'incomplete', cancelAtPeriodEnd: false, stripeOpdateretAt: stempel,
  }).onConflictDoNothing().returning({ id: subscriptions.id })

  if (!indsat.length) {
    // Kontoen har allerede et levende abonnement. Raekken kunne ikke
    // skrives, saa det her abonnement staar UDEN for vores bogfoering.
    await db.update(stripeEvents)
      .set({ fejl: `dobbelt abonnement: ${subId} kunne ikke bogfoeres — `
        + `kontoen ${brugerId} har allerede et levende` })
      .where(eq(stripeEvents.id, eventId))
    return 'afventer'
  }
  return 'behandlet'
}

/**
 * BETALT FAKTURA — det eneste sted, adgangen flyttes.
 *
 * ── HVORFOR DEN IKKE BRUGER DET FAELLES TIDSSTEMPELFILTER ──
 * `nyereEnd()` beskytter STATUS-spejlingen mod at blive skrevet
 * baglaens. Men adgang er ikke en spejling; den er en kendsgerning om
 * penge, vi har modtaget. Brugte den samme filter, kunne en
 * `subscription.updated`, der tilfaeldigvis kom foerst, faa en GYLDIG
 * `invoice.paid` afvist som «foraeldet» — og den betalte periode var
 * tabt. Det var reproducerbart paa 832d483 (fund 1b).
 *
 * I stedet er vagten MONOTON: adgangen flyttes kun FREM. En faktura,
 * der ankommer sent, kan ikke forkorte en periode, kunden allerede har
 * betalt for, og en faktura, der ankommer i uorden, kan stadig
 * forlaenge den. Det er den rigtige regel om penge: vi tager aldrig
 * adgang tilbage, og vi giver aldrig mere, end den seneste betalte
 * periode raekker til.
 *
 * ── HVORFOR DEN KAN SVARE «AFVENTER» ──
 * Kommer fakturaen FOER sin checkout-haendelse, findes raekken ikke
 * endnu. Foer returnerede vi 'forael' OG markerede haendelsen faerdig,
 * saa genleveringen gav «gentagelse» og perioden var tabt (fund 1a).
 * Nu forsoeger vi at oprette raekken selv ud fra fakturaens egen
 * kunde — og kan vi ikke finde brugeren, svarer vi 'afventer', som
 * ikke markeres faerdig.
 */
async function betalt(o: Ukendt, stempel: Date, ops: Stripeopsaetning | null): Promise<Udfald> {
  const linjer = (o['lines'] as Ukendt | undefined)?.['data']
  const linje = Array.isArray(linjer) ? linjer[0] as Ukendt | undefined : undefined
  const subId = tekst(o['subscription'])
    ?? tekst(((linje?.['parent'] as Ukendt | undefined)?.['subscription_item_details'] as Ukendt | undefined)?.['subscription'])
  if (!subId) return 'ignoreret'

  const slut = tid((linje?.['period'] as Ukendt | undefined)?.['end'])
  const start = tid((linje?.['period'] as Ukendt | undefined)?.['start'])
  const prisId = tekst(((linje?.['pricing'] as Ukendt | undefined)?.['price_details'] as Ukendt | undefined)?.['price'])
  const kunde = tekst(o['customer'])

  // Findes raekken? Ellers: kan vi lave den ud af fakturaens kunde?
  const [findes] = await db.select({ id: subscriptions.id })
    .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!findes) {
    const bruger = kunde ? await brugerForKunde(kunde) : null
    if (!bruger) {
      // Forudsaetningen mangler stadig. IKKE faerdig — Stripe leverer igen.
      return 'afventer'
    }
    await db.insert(subscriptions).values({
      userId: bruger, stripeSubscriptionId: subId, stripeCustomerId: kunde,
      status: 'active', stripeOpdateretAt: stempel,
    }).onConflictDoNothing()
  }

  // MONOTON vagt: adgangen flyttes kun frem, og kun af en betalt periode.
  const r = await db.update(subscriptions)
    .set({
      status: 'active',
      ...(slut ? { adgangTil: slut, currentPeriodEnd: slut } : {}),
      ...(start ? { currentPeriodStart: start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      ...(kunde ? { stripeCustomerId: kunde } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(subscriptions.stripeSubscriptionId, subId),
      slut
        ? or(isNull(subscriptions.adgangTil), lt(subscriptions.adgangTil, slut))
        : sql`true`,
    ))
    .returning({ bruger: subscriptions.userId, plan: subscriptions.stripeScheduleId })

  if (!r.length) {
    // Adgangen var allerede lige saa lang eller laengere. Det er ikke en
    // fejl — det er en gentagelse eller en overhalet faktura.
    return 'forael'
  }

  // Introduktionen er brugt, naar den er BETALT — ikke naar siden blev
  // aabnet. Saettes kun, hvis den ikke stod i forvejen.
  if (ops && prisId && fase(prisId, ops) === 'intro') {
    await db.update(users)
      .set({ introBrugtAt: new Date() })
      .where(and(eq(users.id, r[0]!.bruger), isNull(users.introBrugtAt)))

    // Planlaegningen markeres som SKYLDIG her og udfoeres nedenfor.
    // Bliver kaldet til Stripe afbrudt, staar skylden i basen, og
    // `laegManglendePlaner()` tager den op igen.
    await db.update(subscriptions)
      .set({ planStatus: 'mangler' })
      .where(and(
        eq(subscriptions.stripeSubscriptionId, subId),
        isNull(subscriptions.planStatus),
      ))
    await laegPlan(subId, ops)
  }
  // Lukker koebsforsoeget, saa kontoen kan koebe igen en anden dag.
  if (kunde) await lukForsoegForKunde(kunde)
  return 'behandlet'
}

/** Vores bruger bag en Stripe-kunde. Null, hvis vi ikke kender kunden. */
async function brugerForKunde(kunde: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id })
    .from(users).where(eq(users.stripeCustomerId, kunde)).limit(1)
  if (u) return u.id
  const [a] = await db.select({ id: subscriptions.userId })
    .from(subscriptions).where(eq(subscriptions.stripeCustomerId, kunde)).limit(1)
  return a?.id ?? null
}

/** Et betalt forloeb er ikke laengere aabent. */
async function lukForsoegForKunde(kunde: string): Promise<void> {
  await db.update(checkoutForsoeg)
    .set({ status: 'betalt', lukketAt: new Date() })
    .where(and(
      eq(checkoutForsoeg.stripeCustomerId, kunde),
      eq(checkoutForsoeg.status, 'aaben'),
    ))
}

// ═══════════════════════════════════════════════════════════════
//  PLANLAEGNINGEN — særskilt, vedvarende og genkoerbar.
//
//  Foer var det en sideeffekt i `betalt()` med en tavs try/catch:
//  fejlede den, blev haendelsen alligevel markeret faerdig, og
//  genleveringen gav «gentagelse». Abonnementet kunne derfor blive ved
//  med at koere til 9 kr./DAG — `interval: 'day'` betyder hver dag, ikke
//  én gang. Reproduceret paa 832d483 (fund 2 og 2b).
//
//  Nu er den en TILSTAND paa abonnementet:
//    mangler      · skylden er bogfoert, planen er ikke lagt
//    oprettet     · schedule findes, men faserne er ikke bekraeftet
//    konfigureret · faserne er skrevet OG laest tilbage
//    fejlet       · gav op efter PLAN_MAX_FORSOEG; kraever et menneske
//
//  Kundens betalte adgang roeres aldrig af en planlaegningsfejl. Hun
//  har betalt, og adgangen er hendes. Det, der mangler, er VORES
//  opgave — og den staar nu i basen, hvor den kan ses og koeres om.
// ═══════════════════════════════════════════════════════════════

export const PLAN_MAX_FORSOEG = 5

/**
 * Lægger eller REPARERER den tofasede plan. Idempotent.
 *
 * Tre indgange, alle sikre at gentage:
 *  · intet schedule → opret, konfigurér, bekraeft
 *  · schedule uden bekraeftede faser → konfigurér, bekraeft
 *  · allerede konfigureret → goer ingenting
 *
 * KASTER IKKE. Fejlen skrives paa raekken, og `plan_forsoeg` taelles op.
 */
export async function laegPlan(subId: string, ops: Stripeopsaetning): Promise<
  'konfigureret' | 'oprettet' | 'fejlet' | 'sprunget_over'
> {
  const [a] = await db.select({
    plan: subscriptions.stripeScheduleId,
    status: subscriptions.planStatus,
    forsoeg: subscriptions.planForsoeg,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!a) return 'sprunget_over'
  if (a.status === 'konfigureret') return 'konfigureret'
  if (a.forsoeg >= PLAN_MAX_FORSOEG && a.status === 'fejlet') return 'fejlet'

  const s = stripe(ops)
  let planId = a.plan
  try {
    if (!planId) {
      // `from_subscription` kan ikke kombineres med `phases` — SDK'ens
      // egen note, SubscriptionSchedules.d.ts:653-656. Derfor to kald.
      const plan = await s.subscriptionSchedules.create(
        { from_subscription: subId },
        { idempotencyKey: `plan:${subId}` },
      )
      planId = plan.id
      // Skrives STRAKS, foer konfigurationen. Afbrydes vi nu, ved
      // genkoerslen at planen findes og skal konfigureres — den
      // opretter ikke en til.
      await db.update(subscriptions)
        .set({ stripeScheduleId: planId, planStatus: 'oprettet', planForsoegtAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId))
    }

    const nu = await s.subscriptionSchedules.retrieve(planId)
    const nuvaerende = (nu as unknown as { phases?: { start_date?: number; end_date?: number }[] })
      .phases?.[0]
    if (!nuvaerende) throw new Error('planen har ingen fase at bygge videre paa')

    // Fase 1 gengives med Stripes EGNE tidspunkter. Vi regner dem ikke
    // ud: perioden begyndte, da betalingen gik igennem.
    const oenskede = [
      {
        items: [{ price: ops.introPrisId, quantity: 1 }],
        start_date: nuvaerende.start_date,
        end_date: nuvaerende.end_date,
      },
      faser(ops)[1]!,
    ]
    await s.subscriptionSchedules.update(planId, { phases: oenskede as never })

    // LAES TILBAGE. Et schedule-id beviser ikke, at faserne er rigtige.
    // Uden det her ville «oprettet men forkert konfigureret» se faerdig ud.
    const efter = await s.subscriptionSchedules.retrieve(planId)
    if (!faserErRigtige(efter, ops)) {
      throw new Error('faserne stemmer ikke efter opdatering')
    }

    await db.update(subscriptions)
      .set({ planStatus: 'konfigureret', planFejl: null, planForsoegtAt: new Date() })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
    return 'konfigureret'
  } catch (e) {
    const forsoeg = a.forsoeg + 1
    await db.update(subscriptions)
      .set({
        planStatus: forsoeg >= PLAN_MAX_FORSOEG ? 'fejlet' : (planId ? 'oprettet' : 'mangler'),
        planFejl: (e as Error).message.slice(0, 500),
        planForsoeg: forsoeg,
        planForsoegtAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
    return forsoeg >= PLAN_MAX_FORSOEG ? 'fejlet' : 'oprettet'
  }
}

/**
 * Er de to faser dem, vi bad om?
 *
 * Maaler PRISERNE og at der er praecis to faser. Det er det, der
 * afgoer, hvad kunden traekkes: fase 1 introprisen, fase 2
 * normalprisen. Stemmer det ikke, er planen ikke konfigureret —
 * uanset at den findes.
 */
export function faserErRigtige(plan: unknown, ops: Stripeopsaetning): boolean {
  const p = (plan as { phases?: { items?: { price?: unknown }[] }[] } | null)?.phases
  if (!Array.isArray(p) || p.length !== 2) return false
  const pris = (f: { items?: { price?: unknown }[] } | undefined) => {
    const v = f?.items?.[0]?.price
    return typeof v === 'string' ? v : (v as { id?: string } | undefined)?.id
  }
  return pris(p[0]) === ops.introPrisId && pris(p[1]) === ops.normalPrisId
}

/**
 * Driftstilsynets indgang: tag alle skyldige planer op igen.
 *
 * Kaldes af importkoerslen. Uden den ville en plan, der fejlede fem
 * gange i traek paa en time med nedetid hos Stripe, staa for evigt —
 * og kunden betale 9 kr. om dagen imens.
 */
export async function laegManglendePlaner(ops: Stripeopsaetning, maks = 25): Promise<{
  forsoegt: number; konfigureret: number; fejlet: number
}> {
  const skyldige = await db.select({ sub: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(
      isNotNull(subscriptions.planStatus),
      ne(subscriptions.planStatus, 'konfigureret'),
      lt(subscriptions.planForsoeg, PLAN_MAX_FORSOEG),
    ))
    .limit(maks)
  let konfigureret = 0, fejlet = 0
  for (const s of skyldige) {
    const r = await laegPlan(s.sub, ops)
    if (r === 'konfigureret') konfigureret++
    else if (r === 'fejlet') fejlet++
  }
  return { forsoegt: skyldige.length, konfigureret, fejlet }
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
