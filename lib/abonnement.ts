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

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { subscriptions, users } from '../db/schema'
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

  const [bruger] = await db.select({
    mail: users.email, kunde: users.stripeCustomerId, intro: users.introBrugtAt,
  }).from(users).where(eq(users.id, brugerId)).limit(1)
  if (!bruger) return { ok: false, fejl: 'ikke_logget_ind' }

  const s = stripe(o)
  try {
    // Kunden genbruges. En ny Stripe-kunde pr. koeb ville splitte
    // betalingshistorikken op paa et menneske, der kun har én konto.
    let kunde = bruger.kunde
    if (!kunde) {
      const ny = await s.customers.create(
        { email: bruger.mail, metadata: { bofinda_bruger: brugerId } },
        // Samme bruger, samme noegle: to samtidige klik giver ÉN kunde.
        { idempotencyKey: `kunde:${brugerId}` },
      )
      kunde = ny.id
      await db.update(users).set({ stripeCustomerId: kunde }).where(eq(users.id, brugerId))
    }

    // Introduktionsprisen KUN foerste gang. `intro_brugt_at` saettes,
    // naar introbetalingen gennemfoeres — ikke her. Aabner hun siden
    // uden at betale, er tilbuddet altsaa ikke brugt op.
    const foersteGang = bruger.intro === null
    const pris = foersteGang ? o.introPrisId : o.normalPrisId

    const sess = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: kunde,
      line_items: [{ price: pris, quantity: 1 }],
      // Returvejen. `retur` er valideret af kaldet ovenfor til at vaere
      // en intern sti — aldrig en fremmed URL.
      success_url: `${grundadresse()}/abonnement/kvittering?retur=${encodeURIComponent(retur)}`,
      cancel_url: `${grundadresse()}${retur}`,
      // Vores egen noegle paa abonnementet, saa webhooken kan finde
      // brugeren uden at stole paa noget fra browseren.
      subscription_data: {
        metadata: { bofinda_bruger: brugerId, bofinda_intro: String(foersteGang) },
      },
      client_reference_id: brugerId,
      locale: 'da',
    }, {
      // Dobbeltklik inden for samme minut giver SAMME session, ikke to.
      idempotencyKey: `koeb:${brugerId}:${foersteGang ? 'intro' : 'normal'}:${minut()}`,
    })
    return sess.url ? { ok: true, url: sess.url } : { ok: false, fejl: 'stripe_fejlede' }
  } catch {
    // Stripes fejltekster kan baere kunde- og beloebsdetaljer. De
    // logges ikke videre herfra; kaldet faar en klasse, ikke en besked.
    return { ok: false, fejl: 'stripe_fejlede' }
  }
}

const grundadresse = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bofinda.dk'
/** Minut-praecis noegle: samme klik-burst deler noegle, i morgen ikke. */
const minut = () => Math.floor(Date.now() / 60000)

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
  if (!brugerId) return { ok: false, fejl: 'ikke_logget_ind' }

  const [a] = await db.select({
    stripeId: subscriptions.stripeSubscriptionId, adgang: subscriptions.adgangTil,
  }).from(subscriptions)
    .where(and(eq(subscriptions.userId, brugerId), inArray(subscriptions.status, [...LEVENDE])))
    .limit(1)
  if (!a) return { ok: false, fejl: 'intet_abonnement' }

  const o = opsaetning()
  if (!o) return { ok: false, fejl: 'stripe_mangler' }

  try {
    await stripe(o).subscriptions.update(a.stripeId, { cancel_at_period_end: true })
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
  naesteBeloebOere: number | null
  fornyesAt: Date | null
  adgangTil: Date | null
  opsagt: boolean
}

/** Til «Mit abonnement». Kun den verificerede brugers egen raekke. */
export async function mitAbonnement(): Promise<Abonnementsbillede | null> {
  const brugerId = await hentBrugerId()
  if (!brugerId) return null
  const [a] = await db.select({
    status: subscriptions.status, pris: subscriptions.stripePriceId,
    slut: subscriptions.currentPeriodEnd, adgang: subscriptions.adgangTil,
    opsagt: subscriptions.cancelAtPeriodEnd, plan: subscriptions.stripeScheduleId,
  }).from(subscriptions)
    .where(and(eq(subscriptions.userId, brugerId), isNotNull(subscriptions.stripeSubscriptionId)))
    .orderBy(subscriptions.oprettetAt)
    .limit(1)
  if (!a) return null
  const o = opsaetning()
  const f = o ? fase(a.pris, o) : null
  return {
    status: a.status,
    fase: f,
    // NAESTE BELOEB — kun naar vi kan indestaa for det.
    //
    // I introfasen er naeste traek 349 kr. udelukkende, FORDI den
    // tofasede plan er lagt. Er `stripe_schedule_id` null, er planen
    // ikke kommet paa (se `laegPlan` i lib/webhook.ts), og saa ville
    // Stripe traekke introprisen igen. At skrive 349 kr. der ville
    // vaere en paastand om kundens egne penge, vi ikke har daekning
    // for — samme fejl som et gaettet aconto-beloeb. Vi skriver
    // hellere ingenting og lader «Mit abonnement» sige det.
    naesteBeloebOere:
      a.opsagt ? null
      : f === 'normal' ? NORMAL_OERE
      : f === 'intro' && a.plan ? NORMAL_OERE
      : null,
    fornyesAt: a.opsagt ? null : a.slut,
    adgangTil: a.adgang,
    opsagt: a.opsagt,
  }
}

export type { Stripeopsaetning }
