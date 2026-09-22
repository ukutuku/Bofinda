// ═══════════════════════════════════════════════════════════════
//  OPSIGELSEN — genoptagelig, og planafstemningen autoritativ.
//
//  ── HVORFOR FILEN FINDES ────────────────────────────────────
//  Tre steder svarer paa det samme spoergsmaal: «styrer den her plan
//  stadig abonnementet, og maa vi slippe den?» Kundens egen opsigelse
//  (`sigOpFor` i lib/abonnement.ts), tilsynets sikkerhedsstop
//  (`stopForkertFornyelse` i lib/webhook.ts) og genoptagelsen af en
//  halvt gennemfoert opsigelse. De to foerste svarede hver for sig, og
//  begge svarede forkert paa hver sin maade.
//
//  Filen ligger for sig, fordi baade `lib/abonnement.ts` og
//  `lib/webhook.ts` skal bruge den. Den maa derfor ikke importere
//  nogen af dem — og den maa ikke traekke `./auth` med, som haenger
//  `next/headers` paa workeren.
//
//  ── HVAD STRIPE FAKTISK SIGER ───────────────────────────────
//  Alt herunder staar i den installerede SDK's egne typer, ikke i en
//  formodning:
//
//   · `release` virker KUN paa en plan i `not_started` eller `active`
//     (SubscriptionSchedules.d.ts:39). Et genforsoeg paa en allerede
//     frigivet plan fejler — og det var netop dét, der laaste
//     opsigelsen fast: hvert genforsoeg doede paa `release`, FOER det
//     naaede `subscriptions.update`.
//   · En frigivet plan faar sin `subscription` FJERNET; id'et flyttes
//     til `released_subscription` (samme linje, og :104-116). En plan
//     med de rigtige faser er derfor ikke bevis for, at den stadig
//     styrer noget.
//   · `status` er `active | canceled | completed | not_started |
//     released` (:267).
// ═══════════════════════════════════════════════════════════════

import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm'
import { db } from '../db/client'
import { subscriptions } from '../db/schema'
import { stripe, type Stripeopsaetning } from './stripe'

/** Statusser, hvor en plan stadig kan styre et abonnement. */
export const PLAN_LEVENDE = ['active', 'not_started'] as const

/** Id'et, uanset om Stripe gav en streng eller et objekt. */
const idAf = (v: unknown): string | null =>
  typeof v === 'string' ? v
  : typeof (v as { id?: unknown } | null)?.id === 'string' ? (v as { id: string }).id
  : null

/**
 * GAELDER planen stadig for DET HER abonnement?
 *
 * To led, og begge er noedvendige:
 *  · status er `active` eller `not_started` — alt andet kan ikke
 *    slippes og styrer ingenting
 *  · `subscription` peger paa netop det abonnement, vi spoerger om
 *
 * Det andet led er det, en faseligning ikke kan svare paa. En frigivet
 * plan beholder sine faser; den styrer bare ikke laengere noget. Uden
 * leddet svarede sikkerhedskontrollen «planen er rigtig» om en plan,
 * Stripe havde sluppet — og skrev `konfigureret` paa den.
 */
export function planGaelder(plan: unknown, subId: string): boolean {
  const p = plan as { status?: unknown; subscription?: unknown } | null
  if (!p) return false
  const status = typeof p.status === 'string' ? p.status : ''
  if (!(PLAN_LEVENDE as readonly string[]).includes(status)) return false
  return idAf(p.subscription) === subId
}

export type Opsigelsesudfald =
  /** Bekraeftet hos Stripe OG bogfoert hjemme. */
  | 'opsagt'
  /**
   * Stripe har opsigelsen; vores egen raekke naaede ikke at blive
   * skrevet. Kundens penge er i sikkerhed — det er dét, der taeller —
   * og tilsynet skriver raekken hjem i naeste koersel. «Mit
   * abonnement» siger allerede det rigtige, fordi beslutningen blev
   * noteret FOER kaldene.
   */
  | 'bogfoering_fejlede'
  /** Vi kunne ikke faa svar; beslutningen staar, tilsynet proever igen. */
  | 'stripe_fejlede'

/**
 * FULDFOER en besluttet opsigelse. Genoptagelig, og altid i samme
 * raekkefoelge.
 *
 * Den maa kaldes igen og igen paa den samme raekke. Det er hele
 * pointen: `opsagt_af_kunde_at` er skrevet FOER det her, saa
 * beslutningen overlever, uanset hvor kaldet knaekker.
 *
 * ── RAEKKEFOELGEN, OG HVORFOR ───────────────────────────────
 * 1. AFSTEM planen hos Stripe. Vores `stripe_schedule_id` er en
 *    bogfoering, ikke en kendsgerning; et gammelt id er ikke bevis for
 *    en aktiv plan.
 * 2. SLIP den kun, hvis den faktisk gaelder. Er den allerede frigivet,
 *    er der intet at slippe — og et `release` paa den ville kaste og
 *    dermed spaerre resten af opsigelsen. Det var fejlen.
 * 3. Ryd bindingen lokalt — MEN uden at lade en fejl her stoppe
 *    opsigelsen. En tabt databaseskrivning er vores problem, ikke
 *    kundens; hun har bedt om at blive fri.
 * 4. `cancel_at_period_end` hos Stripe. Det er dét, kunden bad om, og
 *    det er dét, der faktisk stopper opkraevningen.
 * 5. Skriv flaget hjemme, saa siden ikke siger «fornyes» bagefter.
 */
export async function fuldfoerOpsigelse(
  ops: Stripeopsaetning, subId: string,
): Promise<Opsigelsesudfald> {
  const [a] = await db.select({
    plan: subscriptions.stripeScheduleId,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)

  try {
    const s = stripe(ops)

    // ── 1-2 · AFSTEM, SLIP KUN DET DER GAELDER ──────────────
    // Ogsaa naar vi ikke har et id: abonnementet kender selv sin plan
    // (`subscription.schedule`), og en plan, VI har glemt, kan stadig
    // skrive opsigelsen om ved naeste faseskift.
    let planId = a?.plan ?? null
    if (!planId) {
      const abo = await s.subscriptions.retrieve(subId) as { schedule?: unknown } | null
      planId = idAf(abo?.schedule)
    }
    if (planId) {
      const plan = await s.subscriptionSchedules.retrieve(planId)
      if (planGaelder(plan, subId)) {
        // Planen skal slippes FOER opsigelsen. Gjorde vi det omvendt,
        // kunne planen skrive `cancel_at_period_end` om ved naeste
        // faseskift — og kunden blive traekt, efter hun sagde op.
        await s.subscriptionSchedules.release(planId)
      }
    }

    // ── 3 · DET, KUNDEN BAD OM ──────────────────────────────
    await s.subscriptions.update(subId, { cancel_at_period_end: true })
  } catch {
    return 'stripe_fejlede'
  }

  // ── 4 · BOGFOERINGEN, ÉN SKRIVNING, TIL SIDST ────────────
  // Alt hvad vi skriver hjemme, staar her: bindingen ryddes, og flaget
  // saettes. Det er med vilje ÉN skrivning EFTER de eksterne kald.
  //
  // Foer laa rydningen mellem `release` og `update`, og en enkelt
  // fejlet skrivning kastede derfor MIDT i opsigelsen: planen var
  // sluppet hos Stripe, men `cancel_at_period_end` blev aldrig sat, og
  // hvert genforsoeg doede paa et `release` af en plan, Stripe
  // allerede havde sluppet. Kunden sad fast paa et abonnement, hun
  // havde sagt op.
  //
  // Nu er raekkefoelgen: Stripe foerst, bogfoering bagefter. Fejler
  // bogfoeringen, er opsigelsen stadig i kraft DÉR HVOR PENGENE ER, og
  // `fuldfoerSkyldigeOpsigelser` skriver den hjem i naeste kørsel —
  // begge Stripe-kald er idempotente, og `release` springes over, naar
  // planen ikke laengere gaelder.
  try {
    await db.update(subscriptions)
      .set({ stripeScheduleId: null, planStatus: null,
             cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
  } catch {
    return 'bogfoering_fejlede'
  }
  return 'opsagt'
}

/**
 * Noter beslutningen. Skrives FOER de eksterne kald.
 *
 * Idempotent: staar tidspunktet i forvejen, bliver det staaende. Det
 * foerste tidspunkt er det rigtige — det er dér, kunden traf valget,
 * og det er dét, spejlingen sammenligner en forsinket haendelse med.
 */
export async function noterOpsigelse(subId: string): Promise<void> {
  await db.update(subscriptions)
    .set({ opsagtAfKundeAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(subscriptions.stripeSubscriptionId, subId),
      isNull(subscriptions.opsagtAfKundeAt),
    ))
}

/** Statusser, et abonnement ikke kommer tilbage fra. Delt med webhooken. */
const DOEDE = ['canceled', 'incomplete_expired', 'expired'] as const

/**
 * De opsigelser, kunden har besluttet, og som Stripe endnu ikke har
 * bekraeftet.
 *
 * Det er hele genoptagelsen: knaekkede opsigelsen midt i — release
 * lykkedes, den lokale skrivning fejlede — staar raekken her, og
 * tilsynet tager den op igen. Et doedt abonnement fornyes ikke og er
 * ikke skyldigt.
 */
export async function fuldfoerSkyldigeOpsigelser(
  ops: Stripeopsaetning, maks = 25,
): Promise<{ skyldige: number; opsagte: number; fejlede: number; detaljer: string[] }> {
  const raekker = await db.select({ sub: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(
      isNotNull(subscriptions.opsagtAfKundeAt),
      eq(subscriptions.cancelAtPeriodEnd, false),
      notInArray(subscriptions.status, [...DOEDE]),
    ))
    .limit(maks)

  let opsagte = 0, fejlede = 0
  const detaljer: string[] = []
  for (const r of raekker) {
    const u = await fuldfoerOpsigelse(ops, r.sub)
    if (u !== 'opsagt') {
      fejlede++
      detaljer.push(`${r.sub}: opsigelsen kunne ikke fuldføres hos Stripe endnu`)
    } else {
      opsagte++
    }
  }
  return { skyldige: raekker.length, opsagte, fejlede, detaljer }
}
