// ═══════════════════════════════════════════════════════════════
//  Abonnementet: koeb, opsigelse og spejling af Stripes tilstand.
//
//  ── HVEM ER KUNDEN ──────────────────────────────────────────
//  Altid den VERIFICEREDE session. Ingen funktion her tager et
//  bruger-id, et kunde-id, en pris eller en status fra browseren.
//  `hentBrugerId()` laeser Supabase-sessionen paa serveren; kan den
//  ikke svare, er der ingen kunde, og intet sker.
//
//  ── ADGANG FOELGER BETALING, IKKE HENSIGT ───────────────────
//  `adgangTil` skrives ÉT sted: naar en faktura er markeret betalt.
//  Hverken en aabnet betalingsside, en oprettet Checkout Session, et
//  `session_id` i en retur-URL eller et abonnement i status
//  `incomplete` giver adgang. Det er hele forskellen paa «hun har
//  trykket koeb» og «pengene er modtaget».
// ═══════════════════════════════════════════════════════════════

import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '../db/client'
import type Stripe from 'stripe'
import { checkoutForsoeg, subscriptions, users } from '../db/schema'
import { hentBrugerId } from './auth'
import { NORMAL_OERE, fase, opsaetning, stripe, type Stripeopsaetning } from './stripe'
import { hentTilstand } from './adgang'

/** Statusser, hvor abonnementet stadig lever hos Stripe. */
export const LEVENDE = [
  'trialing', 'active', 'past_due', 'incomplete', 'paused', 'unpaid',
] as const

export type Koebssvar =
  | { ok: true; url: string }
  | { ok: false; fejl: 'gratis_tilstand' | 'ikke_logget_ind' | 'stripe_mangler'
      | 'har_allerede' | 'stripe_fejlede' }

/**
 * Starter et koeb og returnerer Stripes betalingsside.
 *
 * Tre spaerringer, i den raekkefoelge:
 *  1. GRATIS tilstand → intet koeb. Der findes ingen vej til kassen,
 *     naar muren er fra — heller ikke ved at kalde handlingen direkte.
 *  2. Ingen session → intet koeb. Vi ved ikke, hvem der skulle betale.
 *  3. Har allerede et levende abonnement → intet nyt. Det er vagten
 *     mod dobbeltklik: to klik giver ikke to abonnementer, fordi det
 *     andet klik moeder en raekke, det foerste lavede.
 */
export async function startKoeb(retur: string): Promise<Koebssvar> {
  if (await hentTilstand() !== 'betaling') return { ok: false, fejl: 'gratis_tilstand' }

  const brugerId = await hentBrugerId()
  if (!brugerId) return { ok: false, fejl: 'ikke_logget_ind' }

  const o = opsaetning()
  if (!o) return { ok: false, fejl: 'stripe_mangler' }

  const [levende] = await db.select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, brugerId), inArray(subscriptions.status, [...LEVENDE])))
    .limit(1)
  if (levende) return { ok: false, fejl: 'har_allerede' }

  const s = stripe(o)

  // ── ÉN AABEN RESERVATION PR. KONTO ─────────────────────────
  // Foer skrev funktionen ingenting, og idempotensnoeglen skiftede med
  // MINUTTET. To faner — eller ét minut senere — gav to BETALBARE
  // Checkout-forloeb, og det unikke abonnementsindeks greb foerst ind,
  // naar Stripe allerede havde oprettet abonnement nummer to. Saa stod
  // kunden med et opkraevende abonnement, vi ikke fulgte.
  //
  // Nu er reservationen en raekke, og det delvist unikke indeks
  // `checkout_en_aaben_pr_bruger` er vagten. Er der en aaben, der
  // stadig kan betales, faar hun SAMME session igen — ikke en ny.
  const aaben = await ryddUdloebne(brugerId)
  if (aaben) {
    const sess = await hentSession(s, aaben.stripeSessionId)
    if (sess?.status === 'open' && sess.url) return { ok: true, url: sess.url }
    // Ikke betalbar laengere — luk reservationen og lav en ny.
    await lukForsoeg(aaben.id, 'udloebet')
  }

  const [bruger] = await db.select({
    mail: users.email, kunde: users.stripeCustomerId, intro: users.introBrugtAt,
  }).from(users).where(eq(users.id, brugerId)).limit(1)
  if (!bruger) return { ok: false, fejl: 'ikke_logget_ind' }

  try {
    let kunde = bruger.kunde
    if (!kunde) {
      const ny = await s.customers.create(
        { email: bruger.mail, metadata: { bofinda_bruger: brugerId } },
        { idempotencyKey: `kunde:${brugerId}` },
      )
      kunde = ny.id
      await db.update(users).set({ stripeCustomerId: kunde }).where(eq(users.id, brugerId))
    }

    const foersteGang = bruger.intro === null
    const pris = foersteGang ? o.introPrisId : o.normalPrisId
    const udloeber = new Date(Date.now() + CHECKOUT_LEVETID_MIN * 60000)

    const sess = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: kunde,
      line_items: [{ price: pris, quantity: 1 }],
      success_url: `${grundadresse()}/abonnement/kvittering?retur=${encodeURIComponent(retur)}`,
      cancel_url: `${grundadresse()}${retur}`,
      subscription_data: {
        metadata: { bofinda_bruger: brugerId, bofinda_intro: String(foersteGang) },
      },
      client_reference_id: brugerId,
      locale: 'da',
      expires_at: Math.floor(udloeber.getTime() / 1000),
    }, {
      // Noeglen er nu bundet til RESERVATIONEN, ikke til minuttet: to
      // klik i samme forloeb deler noegle, uanset hvor laenge der gaar.
      idempotencyKey: `koeb:${brugerId}:${foersteGang ? 'intro' : 'normal'}`,
    })
    if (!sess.url) return { ok: false, fejl: 'stripe_fejlede' }

    // Reservationen skrives EFTER sessionen, saa vi aldrig har en
    // reservation uden en session. Vinder en anden fane kapløbet om
    // indekset, lukker vi VORES session igen — ellers stod der to
    // betalbare forloeb, og det var hele fejlen.
    try {
      await db.insert(checkoutForsoeg).values({
        userId: brugerId, stripeSessionId: sess.id, stripeCustomerId: kunde,
        prisId: pris, udloeberAt: udloeber,
      })
    } catch {
      await lukSessionHosStripe(s, sess.id)
      const [vinder] = await db.select({ s: checkoutForsoeg.stripeSessionId })
        .from(checkoutForsoeg)
        .where(and(eq(checkoutForsoeg.userId, brugerId), eq(checkoutForsoeg.status, 'aaben')))
        .limit(1)
      if (vinder) {
        const v = await hentSession(s, vinder.s)
        if (v?.status === 'open' && v.url) return { ok: true, url: v.url }
      }
      return { ok: false, fejl: 'har_allerede' }
    }
    return { ok: true, url: sess.url }
  } catch {
    return { ok: false, fejl: 'stripe_fejlede' }
  }
}

/** Hvor laenge en paabegyndt betaling kan staa aaben. */
export const CHECKOUT_LEVETID_MIN = 30

type Forsoeg = { id: string; stripeSessionId: string }

/** Lukker udloebne reservationer og giver den, der stadig er aaben. */
async function ryddUdloebne(brugerId: string): Promise<Forsoeg | null> {
  await db.update(checkoutForsoeg)
    .set({ status: 'udloebet', lukketAt: new Date() })
    .where(and(
      eq(checkoutForsoeg.userId, brugerId),
      eq(checkoutForsoeg.status, 'aaben'),
      lt(checkoutForsoeg.udloeberAt, new Date()),
    ))
  const [a] = await db.select({
    id: checkoutForsoeg.id, stripeSessionId: checkoutForsoeg.stripeSessionId,
  }).from(checkoutForsoeg)
    .where(and(eq(checkoutForsoeg.userId, brugerId), eq(checkoutForsoeg.status, 'aaben')))
    .limit(1)
  return a ?? null
}

const lukForsoeg = (id: string, status: 'udloebet' | 'afbrudt') =>
  db.update(checkoutForsoeg).set({ status, lukketAt: new Date() })
    .where(eq(checkoutForsoeg.id, id))

async function hentSession(s: Stripe, id: string) {
  try {
    return await s.checkout.sessions.retrieve(id) as { status?: string; url?: string } | null
  } catch { return null }
}

async function lukSessionHosStripe(s: Stripe, id: string) {
  try { await s.checkout.sessions.expire(id) } catch { /* bedste forsoeg */ }
}

/**
 * Lukker alle aabne betalingsforloeb. Kaldes FOER et skift til GRATIS
 * accepteres.
 *
 * Uden den kunne en kunde, der havde betalingssiden aaben i det sekund
 * muren blev slaaet fra, betale bagefter — og staa med et loebende
 * abonnement i gratis tilstand. `expire` hos Stripe er det, der
 * faktisk goer sessionen ubetalbar; raekken herhjemme er kun vores
 * bogfoering af det.
 */
export async function lukAlleAabneKoeb(): Promise<{ lukkede: number; fejlede: number }> {
  const o = opsaetning()
  const aabne = await db.select({
    id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
  }).from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben'))
  let fejlede = 0
  for (const a of aabne) {
    if (o) {
      try { await stripe(o).checkout.sessions.expire(a.sid) } catch { fejlede++ }
    }
    await lukForsoeg(a.id, 'afbrudt')
  }
  return { lukkede: aabne.length - fejlede, fejlede }
}

const grundadresse = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bofinda.dk'

export type Opsigelsessvar =
  | { ok: true; adgangTil: Date | null }
  | { ok: false; fejl: 'ikke_logget_ind' | 'intet_abonnement' | 'stripe_mangler' | 'stripe_fejlede' }

/**
 * Opsigelse. Stopper NAESTE fornyelse; den betalte periode loeber ud.
 *
 * Abonnementet slaas op paa den VERIFICEREDE brugers id — aldrig paa
 * et abonnements-id fra browseren. Det er hele vaernet mod, at én
 * bruger administrerer en andens abonnement: der er ikke noget felt at
 * manipulere, fordi handlingen ikke tager et.
 */
export async function sigOp(): Promise<Opsigelsessvar> {
  const brugerId = await hentBrugerId()
  return brugerId ? sigOpFor(brugerId) : { ok: false, fejl: 'ikke_logget_ind' }
}

/** Samme opsigelse paa et kendt id. Eksporteret KUN til proeven. */
export async function sigOpFor(brugerId: string): Promise<Opsigelsessvar> {

  const [a] = await db.select({
    stripeId: subscriptions.stripeSubscriptionId, adgang: subscriptions.adgangTil,
    plan: subscriptions.stripeScheduleId,
  }).from(subscriptions)
    .where(and(eq(subscriptions.userId, brugerId), inArray(subscriptions.status, [...LEVENDE])))
    .limit(1)
  if (!a) return { ok: false, fejl: 'intet_abonnement' }

  const o = opsaetning()
  if (!o) return { ok: false, fejl: 'stripe_mangler' }

  try {
    const s = stripe(o)
    if (a.plan) {
      // ── OPSIGELSE MED EN AKTIV PLAN ────────────────────────
      // Styres abonnementet af en SubscriptionSchedule, er det planen,
      // der bestemmer faserne. Sætter man `cancel_at_period_end` direkte
      // paa abonnementet, kan planen skrive det om ved naeste faseskift
      // — og kunden blive traekt igen, efter hun sagde op. Derfor
      // slippes planen FOERST; derefter er abonnementet sit eget, og
      // opsigelsen bider.
      //
      // `release` afslutter planen UDEN at opsige abonnementet — det er
      // netop pointen: den allerede betalte periode skal loebe ud.
      // IKKE `cancel`, som ville afslutte abonnementet med det samme og
      // tage en periode, kunden har betalt for.
      await s.subscriptionSchedules.release(a.plan)
      await db.update(subscriptions)
        .set({ stripeScheduleId: null, planStatus: null })
        .where(eq(subscriptions.stripeSubscriptionId, a.stripeId))
    }
    await s.subscriptions.update(a.stripeId, { cancel_at_period_end: true })
  } catch {
    return { ok: false, fejl: 'stripe_fejlede' }
  }
  // Vi skriver flaget her OG spejler det igen fra webhooken. Uden det
  // foerste ville siden vise «fornyes» lige efter, hun sagde op.
  await db.update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, a.stripeId))
  return { ok: true, adgangTil: a.adgang }
}

export interface Abonnementsbillede {
  status: string
  fase: 'intro' | 'normal' | null
  /**
   * `{ slags: 'beloeb' }` · vi ved hvad der traekkes
   * `{ slags: 'fornyes_ikke' }` · opsagt — der kommer ingen betaling
   * `{ slags: 'ukendt' }` · vi kan IKKE bekraefte naeste betaling
   *
   * De to sidste maa aldrig smelte sammen. `null` betoed foer begge
   * dele, og «fornyes ikke» blev vist til en kunde, hvis plan bare ikke
   * var bekraeftet — altsaa et loefte om ingen betaling, vi ikke kunne
   * holde.
   */
  naeste: { slags: 'beloeb'; oere: number } | { slags: 'fornyes_ikke' } | { slags: 'ukendt' }
  fornyesAt: Date | null
  adgangTil: Date | null
  opsagt: boolean
}

/**
 * Til «Mit abonnement». Kun den verificerede brugers EGEN, AKTUELLE
 * raekke.
 *
 * Sorteringen var `asc(oprettetAt)` og valgte dermed den AELDSTE —
 * altsaa historikken. Efter opsigelse → udloeb → nyt koeb viste siden
 * det gamle, afsluttede abonnement. Reproduceret paa 832d483 (fund 4a).
 * Nu: et levende foerst, ellers det nyeste.
 */
export async function mitAbonnement(): Promise<Abonnementsbillede | null> {
  const brugerId = await hentBrugerId()
  return brugerId ? abonnementForBruger(brugerId) : null
}

/**
 * Samme opslag, men paa et id, kaldet allerede har. Eksporteret saa
 * proeven kan maale UDVAELGELSEN uden en Next-session — reglen er det,
 * der skal proeves, ikke Supabases sessionslaesning.
 */
export async function abonnementForBruger(brugerId: string): Promise<Abonnementsbillede | null> {
  const felter = {
    status: subscriptions.status, pris: subscriptions.stripePriceId,
    slut: subscriptions.currentPeriodEnd, adgang: subscriptions.adgangTil,
    opsagt: subscriptions.cancelAtPeriodEnd, plan: subscriptions.stripeScheduleId,
    planStatus: subscriptions.planStatus,
  }
  const [levende] = await db.select(felter).from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      isNotNull(subscriptions.stripeSubscriptionId),
      inArray(subscriptions.status, [...LEVENDE]),
    ))
    .orderBy(desc(subscriptions.oprettetAt)).limit(1)
  const [nyeste] = levende ? [levende] : await db.select(felter).from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      isNotNull(subscriptions.stripeSubscriptionId),
    ))
    .orderBy(desc(subscriptions.oprettetAt)).limit(1)
  const a = nyeste
  if (!a) return null

  const o = opsaetning()
  const f = o ? fase(a.pris, o) : null

  // NAESTE BETALING — tre udfald, ikke to.
  const naeste: Abonnementsbillede['naeste'] =
    a.opsagt ? { slags: 'fornyes_ikke' }
    : f === 'normal' ? { slags: 'beloeb', oere: NORMAL_OERE }
    // I introfasen er naeste traek 349 kr. UDELUKKENDE, fordi planen er
    // bekraeftet konfigureret. Er den det ikke, ved vi det ikke — og
    // saa siger vi det, i stedet for at gaette paa kundens penge.
    : f === 'intro' && a.planStatus === 'konfigureret'
      ? { slags: 'beloeb', oere: NORMAL_OERE }
    : { slags: 'ukendt' }

  return {
    status: a.status,
    fase: f,
    naeste,
    fornyesAt: a.opsagt ? null : a.slut,
    adgangTil: a.adgang,
    opsagt: a.opsagt,
  }
}

/**
 * Hvilket tilbud gaelder for DEN HER konto?
 *
 * Boksene viste introprisen til alle, mens `startKoeb()` valgte
 * normalprisen for en konto, der allerede havde brugt tilbuddet. Det
 * er et forkert tal om kundens penge paa selve koebsskaermen.
 */
export async function gaeldendeTilbud(): Promise<'intro' | 'normal' | null> {
  const brugerId = await hentBrugerId()
  if (!brugerId) return 'intro'   // ikke logget ind: tilbuddet gaelder endnu
  const [u] = await db.select({ intro: users.introBrugtAt })
    .from(users).where(eq(users.id, brugerId)).limit(1)
  if (!u) return null
  return u.intro === null ? 'intro' : 'normal'
}

export type { Stripeopsaetning }
