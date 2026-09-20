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

import { and, count, eq, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, stripeEvents, subscriptions, users } from '../db/schema'
import { INTRO_TIMER, fase, faser, stripe, type Stripeopsaetning } from './stripe'

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
  // NYTTELASTEN GEMMES. Uden den kan en haendelse, vi ikke naaede at
  // faerdiggoere, kun tages op igen, hvis STRIPE leverer den igen — og
  // Stripe holder op efter sit genforsoegsvindue. Med den kan vores
  // eget tilsyn koere den om naar som helst, ogsaa bagefter. Det er
  // den «fungerende genbehandlingsvej», fund 1 beder om.
  await db.insert(stripeEvents)
    .values({
      id: h.id, type: h.type, stripeOprettetAt: oprettet,
      nyttelast: kunDetViLaeser(h),
    })
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

/**
 * Faerdig — OG nyttelasten kasseres.
 *
 * Den gemmes udelukkende for at kunne koere en uafsluttet haendelse om.
 * Er den afsluttet, er der intet at koere om, og saa er der heller ingen
 * grund til at beholde et Stripe-objekt med kundeoplysninger i vores
 * base. Det er den samme regel som alt andet her: vi opbevarer ikke det,
 * vi ikke bruger.
 */
const faerdig = (id: string) => db.update(stripeEvents)
  .set({ behandletAt: new Date(), fejl: null, nyttelast: null })
  .where(eq(stripeEvents.id, id))

// ═══════════════════════════════════════════════════════════════
//  NYTTELASTEN GEMMES SOM EN ALLOWLIST, ALDRIG SOM HELE OBJEKTET.
//
//  Det ville vaere lettere at skrive `h` direkte i kolonnen, og det var
//  ogsaa det, foerste udgave gjorde. Men et Stripe-haendelsesobjekt
//  baerer kundens navn, mailadresse, faktureringsadresse, kortets
//  sidste fire cifre og udstederland — oplysninger vi hverken laeser
//  eller har brug for. At gemme dem, fordi de tilfaeldigvis fulgte med
//  i en HTTP-krop, er den samme fejl som `...raw` i en adapter, og
//  CLAUDE.md siger hvorfor: en denylist daekker i dag og svigter i
//  morgen, naar Stripe tilfoejer et felt.
//
//  Listen nedenfor er PRAECIS de stier, behandlerne herover laeser.
//  Tilfoejes en ny laesning, skal den med her — ellers ser en
//  genbehandling ikke feltet. Det er den rigtige vej at svigte: et
//  manglende felt opdages, et gemt felt opdages ikke.
// ═══════════════════════════════════════════════════════════════

/** Ét felt, hvis det er der. Tomme objekter opstaar ikke. */
function tag(kilde: Ukendt, felter: string[]): Ukendt | undefined {
  const ud: Ukendt = {}
  for (const f of felter) if (kilde[f] !== undefined) ud[f] = kilde[f]
  return Object.keys(ud).length ? ud : undefined
}

function fakturalinje(l: Ukendt): Ukendt {
  const ud: Ukendt = {}
  const periode = tag((l['period'] ?? {}) as Ukendt, ['start', 'end'])
  if (periode) ud['period'] = periode
  const pd = ((l['pricing'] as Ukendt | undefined)?.['price_details'] ?? {}) as Ukendt
  const pris = tag(pd, ['price'])
  if (pris) ud['pricing'] = { price_details: pris }
  const sid = ((l['parent'] as Ukendt | undefined)?.['subscription_item_details'] ?? {}) as Ukendt
  const forael = tag(sid, ['subscription'])
  if (forael) ud['parent'] = { subscription_item_details: forael }
  return ud
}

function abonnementsvare(v: Ukendt): Ukendt {
  const ud = tag(v, ['current_period_start', 'current_period_end']) ?? {}
  const pris = tag((v['price'] ?? {}) as Ukendt, ['id'])
  if (pris) ud['price'] = pris
  return ud
}

export function kunDetViLaeser(h: Haendelse): Record<string, unknown> {
  const o = (h.data?.object ?? {}) as Ukendt
  const obj: Ukendt = tag(o, [
    // kassen()
    'subscription', 'client_reference_id', 'customer',
    // spejl()
    'id', 'status', 'cancel_at_period_end', 'schedule',
    'current_period_start', 'current_period_end',
  ]) ?? {}

  const linjer = (o['lines'] as Ukendt | undefined)?.['data']
  if (Array.isArray(linjer)) {
    // Kun FOERSTE linje laeses af `betalt()`. Resten gemmes ikke.
    const f = linjer[0] as Ukendt | undefined
    if (f) obj['lines'] = { data: [fakturalinje(f)] }
  }
  const varer = (o['items'] as Ukendt | undefined)?.['data']
  if (Array.isArray(varer)) {
    const f = varer[0] as Ukendt | undefined
    if (f) obj['items'] = { data: [abonnementsvare(f)] }
  }

  return { id: h.id, type: h.type, created: h.created, data: { object: obj } }
}

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
      // Forudsaetningen mangler stadig. IKKE faerdig — hverken Stripes
      // genlevering eller vores eget tilsyn er afskaaret fra at tage
      // den op igen.
      return 'afventer'
    }
    await db.insert(subscriptions).values({
      userId: bruger, stripeSubscriptionId: subId, stripeCustomerId: kunde,
      status: 'active', stripeOpdateretAt: stempel,
    }).onConflictDoNothing()
  }

  // ── SKRIVNING 1 · ADGANGEN, MONOTON OG UDEN TIDSFILTER ─────
  // Adgang er ikke en spejling; den er en kendsgerning om penge, vi har
  // modtaget. Vagten er derfor monoton — kun FREM — og ikke
  // `nyereEnd()`: en `invoice.paid`, der overhales af en
  // `subscription.updated`, skal stadig kunne forlaenge perioden.
  const adgang = slut
    ? await db.update(subscriptions)
        .set({ adgangTil: slut, updatedAt: new Date() })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          or(isNull(subscriptions.adgangTil), lt(subscriptions.adgangTil, slut)),
        ))
        .returning({ id: subscriptions.id })
    : []

  // ── SKRIVNING 2 · SPEJLINGEN, MED TIDSFILTER ───────────────
  // Status, pris og periode er Stripes tilstand, ikke vores
  // kendsgerning. En AELDRE faktura maa registrere betalt adgang
  // ovenfor — men den maa ikke skrive `active` hen over en NYERE
  // `customer.subscription.deleted`. Foer var de to skrivninger én, og
  // status fulgte med adgangen uden at blive sammenlignet med noget.
  await db.update(subscriptions)
    .set({
      status: 'active',
      ...(slut ? { currentPeriodEnd: slut } : {}),
      ...(start ? { currentPeriodStart: start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      ...(kunde ? { stripeCustomerId: kunde } : {}),
      stripeOpdateretAt: stempel, updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))

  // ── SKRIVNING 3 · INTRO OG PLAN, UAFHAENGIGT AF DE TO ─────
  // HER laa fund 2. Skrivningen ovenfor havde en tidlig `return
  // 'forael'`, naar adgangen ikke flyttede sig — og en genlevering,
  // der skulle reparere en HALVT gennemfoert behandling, ramte netop
  // den gren: `adgang_til` var skrevet i foerste forsoeg, saa anden
  // omgang gav «foraeldet» og sprang baade introregistreringen og
  // planskylden over. Kunden stod med adgang, intro-flaget utaget og
  // ingen plan — altsaa 9 kr. om DAGEN.
  //
  // De tre skrivninger er nu uafhaengige og hver for sig betingede paa
  // deres EGET felt. En genlevering kan derfor faerdiggoere praecis
  // det, der mangler, uanset hvad der lykkedes foerste gang.
  //
  // UDEN `ops` kan vi ikke afgoere, OM det er introprisen — og en
  // haendelse, der maaske skyldte en plan, maa ikke markeres faerdig
  // paa et spoergsmaal, vi ikke kunne stille. Den svarer 'afventer' og
  // tages op igen, naar Stripe er konfigureret. Adgangen er skrevet
  // ovenfor uanset: kunden har betalt.
  if (!ops && prisId) return 'afventer'
  if (ops && prisId && fase(prisId, ops) === 'intro') {
    const [r] = await db.select({ bruger: subscriptions.userId })
      .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
    if (r) {
      // Introduktionen er brugt, naar den er BETALT — ikke naar siden
      // blev aabnet. Saettes kun, hvis den ikke stod i forvejen.
      await db.update(users)
        .set({ introBrugtAt: new Date() })
        .where(and(eq(users.id, r.bruger), isNull(users.introBrugtAt)))

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
  }

  // Lukker koebsforsoeget, saa kontoen kan koebe igen en anden dag.
  if (kunde) await lukForsoegForKunde(kunde)

  // Udfaldet er informativt: 'forael' betyder, at adgangen ikke flyttede
  // sig — ikke at der blev sprunget arbejde over.
  return slut && !adgang.length ? 'forael' : 'behandlet'
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
    const fejl = planfejl(efter, ops)
    if (fejl.length) {
      throw new Error(`faserne stemmer ikke efter opdatering: ${fejl.join('; ')}`)
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
 * Foer maalte den kun pris-id'erne og at der var to faser. Det er ikke
 * nok til at baere prismodellen: en plan med de rigtige priser og
 * `quantity: 5` traekker 45 kr. og 1.745 kr., og en fase 1, der varer
 * to doegn i stedet for ét, er en anden model end den, der er lovet.
 * Derfor maales nu ogsaa MAENGDER og TIDSGRAENSER.
 *
 * Kontrollen, punkt for punkt:
 *  · praecis to faser
 *  · én vare pr. fase — en ekstra vare er en ekstra opkraevning
 *  · fase 1: introprisen, maengde 1
 *  · fase 2: normalprisen, maengde 1
 *  · fase 1 varer PRAECIS `INTRO_TIMER` timer, maalt paa Stripes egne
 *    `start_date`/`end_date`. Vi sender dem selv, saa tilbagelaesningen
 *    skal give det samme; goer den ikke det, har vi ikke forstaaet,
 *    hvad Stripe gjorde, og planen er ikke bekraeftet.
 *  · fase 2 begynder PRAECIS hvor fase 1 slipper. Et hul ville vaere
 *    tid uden abonnement; et overlap ville vaere to samtidige.
 *  · fase 1 er ikke en proeveperiode. En `trial` er GRATIS hos Stripe,
 *    og saa er de 9 kr. der ikke.
 *
 * Fase 2's `end_date` maales IKKE. Den er aaben i vores model, og
 * hvad Stripe skriver i feltet for en aaben sidste fase er ikke noget,
 * vi har kunnet efterproeve — en kontrol paa et gaet ville afvise
 * rigtige planer.
 *
 * `quantity` er valgfri i Stripes type. Mangler den, laeses den som 1:
 * det er Stripes egen standard, og en manglende vaerdi er ikke bevis
 * for en forkert. Risikoen, kontrollen findes for — en maengde paa 2
 * eller 5 — fanges uaendret.
 */
export function faserErRigtige(plan: unknown, ops: Stripeopsaetning): boolean {
  return planfejl(plan, ops).length === 0
}

/**
 * Samme kontrol, men den SIGER hvad der er galt. `laegPlan` skriver
 * listen paa raekken, saa en plan, der ikke kan bekraeftes, kan
 * efterses af et menneske uden at nogen skal gaette.
 */
export function planfejl(plan: unknown, ops: Stripeopsaetning): string[] {
  type Vare = { price?: unknown; quantity?: unknown }
  type Fase = {
    items?: Vare[]; start_date?: unknown; end_date?: unknown
    trial?: unknown; trial_end?: unknown
  }
  const p = (plan as { phases?: Fase[] } | null)?.phases
  if (!Array.isArray(p)) return ['planen har ingen faser']
  if (p.length !== 2) return [`planen har ${p.length} faser, ikke 2`]

  const fejl: string[] = []
  const prisId = (v: Vare | undefined) => {
    const x = v?.price
    return typeof x === 'string' ? x : (x as { id?: string } | undefined)?.id
  }
  const forventet = [ops.introPrisId, ops.normalPrisId]
  p.forEach((f, n) => {
    const varer = Array.isArray(f?.items) ? f.items : []
    if (varer.length !== 1) {
      fejl.push(`fase ${n + 1} har ${varer.length} varer, ikke 1`)
      return
    }
    if (prisId(varer[0]) !== forventet[n]) {
      fejl.push(`fase ${n + 1} har prisen ${String(prisId(varer[0]))}, ikke ${forventet[n]}`)
    }
    // Mangler `quantity`, er Stripes standard 1.
    const m = varer[0]!.quantity
    const maengde = m === undefined || m === null ? 1 : m
    if (maengde !== 1) fejl.push(`fase ${n + 1} har mængde ${String(maengde)}, ikke 1`)
  })

  const t = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const s0 = t(p[0]?.start_date), e0 = t(p[0]?.end_date), s1 = t(p[1]?.start_date)
  if (s0 === null || e0 === null) {
    fejl.push('fase 1 mangler start_date eller end_date')
  } else if (e0 - s0 !== INTRO_TIMER * 3600) {
    fejl.push(`fase 1 varer ${e0 - s0} sekunder, ikke ${INTRO_TIMER * 3600}`)
  }
  if (s1 === null) fejl.push('fase 2 mangler start_date')
  else if (e0 !== null && s1 !== e0) {
    fejl.push(`fase 2 begynder ${s1}, mens fase 1 slutter ${e0}`)
  }
  if (p[0]?.trial === true) fejl.push('fase 1 er markeret som prøveperiode — den ville være gratis')
  const pt = t(p[0]?.trial_end)
  if (pt !== null && e0 !== null && pt >= e0) {
    fejl.push('fase 1 har trial_end ved eller efter fasens slutning — hele fasen ville være gratis')
  }
  return fejl
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

// ═══════════════════════════════════════════════════════════════
//  GENBEHANDLING — den vej, HTTP-kvitteringen ikke kan vaere.
//
//  Ruten svarer nu 409 paa 'afventer', saa Stripe leverer igen. Men
//  Stripes genforsoeg holder op efter sit vindue, og en haendelse, hvis
//  forudsaetning kommer for sent, ville dermed vaere tabt. Derfor to
//  ting, ikke én:
//
//    · nyttelasten GEMMES paa raekken, naar haendelsen foerste gang ses
//    · `behandlUbehandlede()` koerer dem om fra basen, uden Stripe
//
//  Ingen ubehandlet haendelse kasseres nogensinde af sig selv. Staar
//  den stadig, staar den i `stripe_events` med sin fejl og sit
//  forsoegstal, hvor et menneske kan se den. En betaling, vi ikke har
//  faaet bogfoert, maa ikke kunne forsvinde i tavshed.
// ═══════════════════════════════════════════════════════════════

/**
 * Tager gemte, ubehandlede haendelser op igen. Kaldes af importkoerslen.
 *
 * Kun raekker med en gemt nyttelast kan koeres om — en raekke fra foer
 * kolonnen fandtes har ingen krop at behandle, og vi opfinder ikke en.
 */
export async function behandlUbehandlede(
  o: Stripeopsaetning | null, maks = 50,
): Promise<{ taget: number; behandlet: number; afventer: number; fejlet: number; tilbage: number }> {
  const ubehandlede = await db.select({
    id: stripeEvents.id, last: stripeEvents.nyttelast,
  }).from(stripeEvents)
    .where(and(isNull(stripeEvents.behandletAt), isNotNull(stripeEvents.nyttelast)))
    .orderBy(stripeEvents.stripeOprettetAt)
    .limit(maks)

  let behandlet = 0, afventer = 0, fejlet = 0
  for (const r of ubehandlede) {
    const h = r.last as unknown as Haendelse | null
    if (!h || typeof h.id !== 'string' || !h.data) { fejlet++; continue }
    try {
      const u = await behandl(h, o)
      if (u === 'afventer' || u === 'i_gang') afventer++
      else behandlet++
    } catch {
      // `behandl()` har allerede skrevet fejlen paa raekken og frigivet
      // kravet. Tilsynet maa ikke vaelte af én daarlig haendelse.
      fejlet++
    }
  }

  const [t] = await db.select({ n: count() }).from(stripeEvents)
    .where(isNull(stripeEvents.behandletAt))
  return { taget: ubehandlede.length, behandlet, afventer, fejlet, tilbage: t?.n ?? 0 }
}

/**
 * Driftsindgangen. Ét kald, importkoerslen laver hver time:
 *  1. koer ubehandlede haendelser om
 *  2. tag skyldige betalingsplaner op igen
 *
 * Raekkefoelgen er ikke ligegyldig. En haendelse, der bliver faerdig i
 * skridt 1, bogfoerer sin planskyld — og skridt 2 tager den med i den
 * SAMME koersel i stedet for at vente en time.
 *
 * KASTER IKKE. Tilsynet maa ikke kunne vaelte importen.
 */
export async function betalingstilsyn(o: Stripeopsaetning | null): Promise<string[]> {
  const linjer: string[] = []

  if (!o) {
    // ── UDEN STRIPE GOER TILSYNET INGENTING — OG SIGER DET ──
    // Det er fristende at koere genbehandlingen alligevel: den er
    // «bare» database. Men `betalt()` kan ikke afgoere, om en faktura
    // er introprisen, naar den ikke kender priserne — og en haendelse,
    // der blev markeret faerdig paa det grundlag, ville tage sin
    // planskyld med sig. Tavshed her ville desuden se ud praecis som
    // «der var ikke noget at goere».
    const [u] = await db.select({ n: count() }).from(stripeEvents)
      .where(isNull(stripeEvents.behandletAt))
    const [p] = await db.select({ n: count() }).from(subscriptions)
      .where(and(
        isNotNull(subscriptions.planStatus),
        ne(subscriptions.planStatus, 'konfigureret'),
      ))
    if (u?.n) {
      linjer.push(`[betaling] ${u.n} ubehandlede hændelser blev IKKE taget op: `
        + 'Stripe er ikke konfigureret i denne kørsel.')
    }
    if (p?.n) {
      linjer.push(`[betaling] ${p.n} skyldige betalingsplaner kunne IKKE lægges: `
        + 'Stripe er ikke konfigureret i denne kørsel.')
    }
    return linjer
  }

  try {
    const g = await behandlUbehandlede(o)
    if (g.taget || g.tilbage) {
      linjer.push(
        `[betaling] genbehandling: ${g.taget} taget · ${g.behandlet} færdige `
        + `· ${g.afventer} afventer · ${g.fejlet} fejlede · ${g.tilbage} ubehandlede tilbage`,
      )
    }
  } catch (e) {
    linjer.push(`[betaling] genbehandling fejlede: ${(e as Error).message}`)
  }
  try {
    const p = await laegManglendePlaner(o)
    if (p.forsoegt) {
      linjer.push(`[betaling] planer: ${p.forsoegt} forsøgt · ${p.konfigureret} konfigureret `
        + `· ${p.fejlet} opgivet efter ${PLAN_MAX_FORSOEG} forsøg`)
    }
  } catch (e) {
    linjer.push(`[betaling] planlægning fejlede: ${(e as Error).message}`)
  }

  // ── DE OPGIVNE SKAL BLIVE VED AT STAA DER ─────────────────
  // `laegManglendePlaner` springer dem over: de har brugt deres fem
  // forsoeg. Men «opgivet» er ikke «loest». Uden plan fornyes
  // abonnementet til 9 kr. HVER DAG hos Stripe, og en tavs raekke i
  // basen stopper ingenting. Linjen staar derfor i HVER kørsel, til
  // et menneske har gjort noget ved den — se
  // docs/betaling/betjening.md.
  try {
    const opgivne = await db.select({ sub: subscriptions.stripeSubscriptionId })
      .from(subscriptions).where(eq(subscriptions.planStatus, 'fejlet')).limit(20)
    if (opgivne.length) {
      linjer.push(
        `[betaling] ⚠ ${opgivne.length} abonnement(er) har INGEN bekræftet plan efter `
        + `${PLAN_MAX_FORSOEG} forsøg og fornyes til 9 kr./DAG hos Stripe, til nogen griber ind: `
        + opgivne.map((x) => x.sub).join(', '),
      )
    }
  } catch (e) {
    linjer.push(`[betaling] opgørelsen af opgivne planer fejlede: ${(e as Error).message}`)
  }
  return linjer
}
