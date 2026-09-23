// ═══════════════════════════════════════════════════════════════
//  Niende gennemgangs fund, prøvet mod rettelsen.
//
//  U1 · Et svar om ÉN plan kunne bogføres som en godkendelse af en
//       ANDEN. Begge indgange havde hullet:
//       · `stopForkertFornyelse` beskyttede rettelsen af bindingen
//         med en compare-and-set, men læste ikke dens resultat — og
//         skrev derefter `planStatus: 'konfigureret'` afgrænset på
//         abonnements-id alene.
//       · `laegPlan` beskyttede sin afsluttende godkendelse mod en
//         opsigelse, men ikke mod at rækken nu peger på en anden plan
//         end den, funktionen konfigurerede og læste tilbage.
//
//       Følgen er værre end den forkerte status: `laegPlan`,
//       `stopForkertFornyelse` og `iFareForForkertFornyelse` springer
//       alle `konfigureret` over. Rækken bliver usynlig, og den plan,
//       der FAKTISK styrer abonnementet, bliver aldrig konfigureret.
//
//  ── HVAD DER ER MÅLT, OG HVAD DER ER MODELLERET ──────────────
//  Overlappet er STYRET med en hook: den anden aktørs planskift
//  lægges ind i vinduet mellem opslaget og skrivningen. Det er ikke
//  et målt netværksforløb, og det er ikke to samtidige forbindelser.
//  Den samtidige udgave — rigtige, uafhængige forbindelser mod
//  isoleret PostgreSQL — ligger i test-betaling-kaploeb.ts §E7.
//
//  Stripe er `scripts/stripefalsk/`. Intet her siger noget om, hvad
//  rigtig Stripe ville svare, og intet beviser en opkrævning.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, laegPlan, stopForkertFornyelse } from '../lib/webhook'
import { indsaetStripe } from '../lib/stripe'
import { lavFalsk, type Falsk } from './stripefalsk/index'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

const OPS = { hemmelighed: 'sk_test_x', webhookHemmelighed: 'whsec_x',
  introPrisId: 'price_intro', normalPrisId: 'price_normal' }
process.env.STRIPE_SECRET_KEY = OPS.hemmelighed
process.env.STRIPE_WEBHOOK_SECRET = OPS.webhookHemmelighed
process.env.STRIPE_PRIS_INTRO = OPS.introPrisId
process.env.STRIPE_PRIS_NORMAL = OPS.normalPrisId
process.env.NEXT_PUBLIC_BASE_URL = 'https://proeve.invalid'

const S = Date.now()
let falsk: Falsk & Record<string, unknown>

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r9${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r9${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const laes = (s: string) => db.select({
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  planForsoeg: subscriptions.planForsoeg, planFejl: subscriptions.planFejl,
  stoppet: subscriptions.fornyelseStoppetAt, opsagtAf: subscriptions.opsagtAfKundeAt,
  opsagt: subscriptions.cancelAtPeriodEnd, skyldig: subscriptions.afstemningSkyldigAt,
  gen: subscriptions.afstemningGen, adgang: subscriptions.adgangTil,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, s)).then((r) => r[0])

const planStatus = (id: string) =>
  (falsk.planer.get(id) as { status?: string } | undefined)?.status

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions); await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

/** Et abonnement med en RIGTIG, konfigureret plan B, lagt ad den faktiske vej. */
async function medRigtigPlan(mrk: string) {
  const u = await bruger(mrk)
  const sub = `sub_${mrk}_${S}`
  falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
  const t = Math.floor(Date.now() / 1000)
  await behandl({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed',
    created: t, data: { object: { subscription: sub, client_reference_id: u,
      customer: `cus_${mrk}` } } } as never, OPS)
  await behandl({ id: `evt_${randomUUID()}`, type: 'invoice.paid',
    created: t, data: { object: { subscription: sub, customer: `cus_${mrk}`,
      lines: { data: [{ period: { start: t, end: t + 86400 },
        pricing: { price_details: { price: OPS.introPrisId } } }] } } } } as never, OPS)
  const r = await laes(sub)
  return { u, sub, b: r!.plan! }
}

/** En gammel, frigivet plan A, som rækkens binding peger på. */
async function medGammelBinding(sub: string, b: string, mrk: string,
                                v: Record<string, unknown>) {
  const a = `sch_${mrk}_A_${S}`
  falsk.planer.set(a, { ...structuredClone(falsk.planer.get(b) as object), id: a,
    status: 'released', subscription: null, released_subscription: sub } as never)
  await db.update(subscriptions).set({ stripeScheduleId: a, ...v } as never)
    .where(eq(subscriptions.stripeSubscriptionId, sub))
  return a
}

/**
 * En ANDEN aktør skifter planen midt i vinduet.
 *
 * B slippes, C oprettes på samme abonnement, og C bogføres straks —
 * nøjagtig som `laegPlan` selv gør efter sit `create`. Der er på intet
 * tidspunkt to aktive planer.
 */
async function skiftPlan(sub: string, b: string) {
  await (falsk.subscriptionSchedules as { release: (id: string) => Promise<unknown> }).release(b)
  const c = await (falsk.subscriptionSchedules as
    { create: (p: unknown) => Promise<{ id: string }> }).create({ from_subscription: sub })
  await db.update(subscriptions)
    .set({ stripeScheduleId: c.id, planStatus: 'oprettet', planForsoegtAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, sub))
  return c.id
}

/** Hook på planopslaget. `naar` vælger hvilket opslag der udløser skiftet. */
function vedOpslag(b: string, naar: (n: number) => boolean, gør: () => Promise<string>) {
  let n = 0
  let resultat: string | null = null
  const rigtig = (falsk.subscriptionSchedules as
    { retrieve: (id: string) => Promise<unknown> }).retrieve.bind(falsk.subscriptionSchedules)
  ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = async (id: string) => {
    const svar = await rigtig(id)
    if (id === b && naar(++n) && resultat === null) resultat = await gør()
    return svar
  }
  return {
    slut: () => {
      ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = rigtig
      return resultat
    },
  }
}

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═════════════════════════════════════════════════════════════
  //  U1a · SIKKERHEDSSTOPPET
  // ═════════════════════════════════════════════════════════════
  for (const skift of [false, true]) {
    const mrk = skift ? 'med planskift' : 'uden planskift'
    console.log(`\n══ U1a (${mrk}) · stopForkertFornyelse bogfører kun det, den kontrollerede ══`)
    await nulstil()
    const { sub, b } = await medRigtigPlan(`U1a${skift ? 'S' : 'U'}`)
    await medGammelBinding(sub, b, `U1a${skift ? 'S' : 'U'}`,
      { planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret' })
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const hook = skift
      ? vedOpslag(b, (n) => n === 1, () => skiftPlan(sub, b))
      : { slut: () => null }
    const r = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    const c = hook.slut()

    const e = await laes(sub)
    if (skift) {
      // ── VAGTEN OM PRØVEN SELV ─────────────────────────
      // Uden den kunne alt nedenfor være grønt, fordi overlappet
      // aldrig fandt sted.
      tjek('overlappet fandt faktisk sted — rækken peger på C',
        c !== null && e?.plan === c, `C=${c} binding=${e?.plan}`)
      tjek('  BINDING: C står endnu', e?.plan === c, `${e?.plan}`)
      tjek('  STATUS: C er IKKE godkendt', e?.planStatus !== 'konfigureret',
        `${e?.planStatus}`)
      tjek('  SVAR: hverken «rigtig» eller «fejlede»',
        r === 'grundlaget_skiftede', `${r}`)
      tjek('  der er ikke opfundet en kundeopsigelse',
        e?.opsagtAf === null && e?.opsagt === false && e?.stoppet === null,
        `opsagtAf=${e?.opsagtAf} opsagt=${e?.opsagt} stoppet=${e?.stoppet}`)
      tjek('  og der står HVORFOR på rækken',
        (e?.planFejl ?? '').includes('rækken peger nu på'), `${e?.planFejl}`)
    } else {
      tjek('B bliver godkendt, når intet skiftede', e?.planStatus === 'konfigureret'
        && r === 'plan_er_rigtig' && e?.plan === b,
        `status=${e?.planStatus} svar=${r} binding=${e?.plan}`)
      tjek('  og fornyelsen er ikke stoppet', e?.stoppet === null)
    }

    // TILSYN BAGEFTER: den ubekræftede erstatningsplan skal stadig
    // kunne blive behandlet.
    const foer = falsk.kald.length
    for (let i = 0; i < 3; i++) await betalingstilsyn(OPS)
    const kaldOmC = c === null ? 0 : falsk.kald.slice(foer).filter((k) => k.args[0] === c).length
    const til_sidst = await laes(sub)
    if (skift) {
      tjek('  TILSYN: C bliver taget op bagefter', kaldOmC > 0, `kald om C=${kaldOmC}`)
      // C har kun sin indledende fase og kan ikke konfigureres; budgettet
      // er brugt. Så er det RIGTIGE udfald, at fornyelsen stoppes.
      tjek('  …og ender i en afklaret tilstand, ikke i tavshed',
        til_sidst?.stoppet !== null || til_sidst?.planStatus === 'konfigureret',
        `status=${til_sidst?.planStatus} stoppet=${til_sidst?.stoppet !== null}`)
    }
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      til_sidst?.adgang?.getTime() === adgangFoer)
  }

  // ═════════════════════════════════════════════════════════════
  //  U1b · PLANLÆGNINGEN
  // ═════════════════════════════════════════════════════════════
  for (const skift of [false, true]) {
    const mrk = skift ? 'med planskift' : 'uden planskift'
    console.log(`\n══ U1b (${mrk}) · laegPlan bogfører kun det, den læste tilbage ══`)
    await nulstil()
    const { sub, b } = await medRigtigPlan(`U1b${skift ? 'S' : 'U'}`)
    await medGammelBinding(sub, b, `U1b${skift ? 'S' : 'U'}`,
      { planStatus: 'oprettet', planForsoeg: 1, planFejl: 'modelleret' })
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    // Skiftet sker under TILBAGELÆSNINGEN — altså ved andet opslag af B.
    const hook = skift
      ? vedOpslag(b, (n) => n === 2, () => skiftPlan(sub, b))
      : { slut: () => null }
    const r = await laegPlan(sub, OPS)
    const c = hook.slut()

    const e = await laes(sub)
    if (skift) {
      tjek('overlappet fandt faktisk sted — rækken peger på C',
        c !== null && e?.plan === c, `C=${c} binding=${e?.plan}`)
      tjek('  BINDING: C står endnu', e?.plan === c, `${e?.plan}`)
      tjek('  STATUS: C er IKKE godkendt', e?.planStatus !== 'konfigureret',
        `${e?.planStatus}`)
      tjek('  SVAR: ikke «konfigureret»', r !== 'konfigureret', `${r}`)
      tjek('  …og ikke «opsagt» — et planskift er ikke en kundebeslutning',
        r !== 'opsagt' && e?.opsagtAf === null && e?.opsagt === false,
        `svar=${r} opsagtAf=${e?.opsagtAf}`)
      tjek('  der er ikke registreret afstemningsarbejde på en falsk grund',
        e?.skyldig === null && e?.gen === 0, `skyldig=${e?.skyldig} gen=${e?.gen}`)
      tjek('  forsøgstallet er urørt — der fejlede intet hos Stripe',
        e?.planForsoeg === 1, `${e?.planForsoeg}`)
    } else {
      tjek('B bliver godkendt, når intet skiftede',
        r === 'konfigureret' && e?.planStatus === 'konfigureret' && e?.plan === b,
        `svar=${r} status=${e?.planStatus} binding=${e?.plan}`)
    }

    const foer = falsk.kald.length
    for (let i = 0; i < 3; i++) await betalingstilsyn(OPS)
    const kaldOmC = c === null ? 0 : falsk.kald.slice(foer).filter((k) => k.args[0] === c).length
    const til_sidst = await laes(sub)
    if (skift) {
      tjek('  TILSYN: C bliver taget op bagefter', kaldOmC > 0, `kald om C=${kaldOmC}`)
      tjek('  …og C bliver konfigureret, nu hvor den ER grundlaget',
        til_sidst?.planStatus === 'konfigureret' && til_sidst?.plan === c,
        `status=${til_sidst?.planStatus} binding=${til_sidst?.plan}`)
      tjek('  og planen er aktiv hos Stripe', planStatus(c!) === 'active', `${planStatus(c!)}`)
    }
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      til_sidst?.adgang?.getTime() === adgangFoer)
  }

  // ═════════════════════════════════════════════════════════════
  //  U1c · EN RIGTIG OPSIGELSE SKAL STADIG HEDDE «OPSAGT»
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ U1c · en opsigelse i vinduet svarer stadig «opsagt» ══')
  {
    // Rettelsen deler ét miss op i to årsager. Den må ikke koste det
    // svar, der var rigtigt i forvejen: siger kunden op, mens planen
    // lægges, er svaret «opsagt», og skylden skal registreres.
    await nulstil()
    const { sub, b } = await medRigtigPlan('U1c')
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planForsoeg: 1, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const hook = vedOpslag(b, (n) => n === 1, async () => {
      await db.update(subscriptions).set({ opsagtAfKundeAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, sub))
      return 'opsigelse'
    })
    const r = await laegPlan(sub, OPS)
    hook.slut()

    const e = await laes(sub)
    tjek('svaret er «opsagt»', r === 'opsagt', `${r}`)
    tjek('  planen er IKKE godkendt', e?.planStatus !== 'konfigureret', `${e?.planStatus}`)
    tjek('  og skylden er registreret, så afstemningen slipper planen',
      e?.skyldig !== null, `${e?.skyldig}`)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  console.log(`\n${fejl === 0 ? '  ALT GROENT' : `  ${fejl} FEJLEDE`}`)
  if (fejl) process.exitCode = 1
}

await koer()
