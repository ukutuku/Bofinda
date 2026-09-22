// ═══════════════════════════════════════════════════════════════
//  Fjerde gennemgangs fire fund, prøvet mod rettelserne.
//
//  Gennemgangens egen probe kører med en in-memory SQL-adapter uden
//  transaktionsisolering. Den beviser KODEFORLØB — den siger det selv.
//  Denne prøve kører de samme forløb mod PGlite (rigtige migrationer,
//  rigtige indekser, rigtige enums) og gennem de FAKTISKE indgange:
//
//    HTTP    `POST` fra app/api/stripe/route.ts
//    Kunden  `sigOpFor()` fra lib/abonnement.ts
//    Drift   `betalingstilsyn()`
//
//  Kapløbene ligger i scripts/test-betaling-kaploeb.ts, som kører mod
//  rigtig, isoleret PostgreSQL.
//
//  Stripe er scripts/stripefalsk. Attrappen håndhæver nu Stripes egen
//  regel om, at `release` kun virker på `not_started`/`active`, og at
//  en frigivet plan slipper sit abonnement — uden den var prøverne
//  grønne om et forløb, Stripe ville have afvist. En grøn attrap er
//  stadig ikke en Stripe-verifikation.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, laegPlan, stopForkertFornyelse,
  type Haendelse } from '../lib/webhook'
import { sigOpFor, startKoebFor, abonnementForBruger } from '../lib/abonnement'
import { planGaelder, afstemSkyldige } from '../lib/opsigelse'
import { indsaetStripe } from '../lib/stripe'
import { lavFalsk, type Falsk } from './stripefalsk/index'
import { POST } from '../app/api/stripe/route'

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

let falsk: Falsk & Record<string, unknown>
const S = Date.now()
const nu = () => Math.floor(Date.now() / 1000)
const h = (type: string, obj: Record<string, unknown>, created?: number): Haendelse =>
  ({ id: `evt_${randomUUID()}`, type, created: created ?? nu(), data: { object: obj } })

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r4${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r4${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const faktura = (sub: string, slut: number, pris = OPS.introPrisId,
                 kunde?: string, created?: number) =>
  h('invoice.paid', {
    subscription: sub, ...(kunde ? { customer: kunde } : {}),
    lines: { data: [{ period: { start: nu(), end: slut },
                      pricing: { price_details: { price: pris } } }] },
  }, created)

const post = (haendelse: Haendelse) => POST(new Request('https://proeve.invalid/api/stripe', {
  method: 'POST',
  headers: { 'stripe-signature': 't=1,v1=ligegyldig-attrappen-parser-kun',
             'content-type': 'application/json' },
  body: JSON.stringify(haendelse),
}))

const abo = (sub: string) => db.select({
  status: subscriptions.status, adgang: subscriptions.adgangTil,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  opsagt: subscriptions.cancelAtPeriodEnd, opsagtAf: subscriptions.opsagtAfKundeAt,
  stoppet: subscriptions.fornyelseStoppetAt,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

const haendelse = (id: string) => db.select({
  b: stripeEvents.behandletAt, n: stripeEvents.nyttelast, f: stripeEvents.fejl,
}).from(stripeEvents).where(eq(stripeEvents.id, id)).then((r) => r[0])

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions)
  await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

/** En konto med et abonnement og en BEKRÆFTET, gældende plan. */
async function medBekraeftetPlan(navn: string) {
  const u = await bruger(navn)
  const sub = `sub_${navn}_${S}`
  const kunde = `cus_${navn}_${S}`
  falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
  await post(h('checkout.session.completed',
    { id: `cs_${navn}_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))
  await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
  return { u, sub, kunde }
}

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═══ R1 · EN TERMINAL HÆNDELSE FØR RÆKKEN FINDES ═════════
  console.log('\n══ R1 · en opsigelse, der ankommer først, går ikke tabt ══')
  {
    await nulstil()
    const u = await bruger('R1')
    const sub = `sub_R1_${S}`
    const kunde = `cus_R1_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })

    // Stripe garanterer ingen rækkefølge. Opsigelsen kommer FØRST.
    const slet = h('customer.subscription.deleted',
      { id: sub, status: 'canceled', customer: kunde, cancel_at_period_end: false },
      nu() + 200)
    const svar = await post(slet)
    tjek('ruten svarer 409, ikke 200 — forudsætningen mangler',
      svar.status === 409, `status=${svar.status}`)
    const e1 = await haendelse(slet.id)
    tjek('  hændelsen er IKKE markeret færdig', e1?.b === null, `behandletAt=${e1?.b}`)
    tjek('  og nyttelasten er bevaret, så den kan køres om', e1?.n !== null)

    // Nu kommer de ÆLDRE hændelser: rækken oprettes, og der betales.
    await post(h('checkout.session.completed',
      { id: `cs_R1_${S}`, subscription: sub, client_reference_id: u, customer: kunde },
      nu() + 100))
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde, nu() + 100))
    const efterBetaling = await abo(sub)
    tjek('  den betalte periode er bogført', !!efterBetaling?.adgang)

    // Tilsynet tager den bevarede hændelse op igen.
    await betalingstilsyn(OPS)
    const r = await abo(sub)
    tjek('tilsynet reparerer tilstanden: canceled, ikke active',
      r?.status === 'canceled', `status=${r?.status}`)
    tjek('  og KUNDENS BETALTE ADGANG ER URØRT',
      r?.adgang?.getTime() === efterBetaling?.adgang?.getTime(),
      `${efterBetaling?.adgang?.toISOString()} → ${r?.adgang?.toISOString()}`)
    const e2 = await haendelse(slet.id)
    tjek('  hændelsen er nu færdig', e2?.b !== null)
    const k = await startKoebFor(u, '/')
    tjek('  og kontoen er ikke låst ude af et abonnement, Stripe har slettet',
      k.ok, JSON.stringify(k))
  }

  console.log('\n══ R1b · og en ALMINDELIG hændelse før rækken går heller ikke tabt ══')
  {
    await nulstil()
    const u = await bruger('R1b')
    const sub = `sub_R1b_${S}`
    const kunde = `cus_R1b_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    const opd = h('customer.subscription.updated',
      { id: sub, status: 'past_due', customer: kunde, cancel_at_period_end: false })
    const svar = await post(opd)
    tjek('en updated før rækken svarer også 409', svar.status === 409,
      `status=${svar.status}`)
    await post(h('checkout.session.completed',
      { id: `cs_R1b_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))
    await betalingstilsyn(OPS)
    tjek('  og spejles, når rækken findes', (await abo(sub))?.status === 'past_due',
      `status=${(await abo(sub))?.status}`)
  }

  // ═══ R2 · EN GENOPTAGELIG OPSIGELSE ══════════════════════
  console.log('\n══ R2 · fejl EFTER release, FØR subscriptions.update ══')
  {
    await nulstil()
    const { u, sub } = await medBekraeftetPlan('R2')
    const foer = await abo(sub)
    tjek('planen er lagt og bekræftet', foer?.planStatus === 'konfigureret' && !!foer.plan,
      JSON.stringify(foer))

    // Præcis det hul, gennemgangen målte: `release` lykkes hos Stripe,
    // og så knækker det inden `cancel_at_period_end`.
    falsk.fejlPaa.add('subscriptions.update')
    const svar = await sigOpFor(u)
    tjek('kunden får et ærligt svar: anmodningen afventer',
      !svar.ok && svar.fejl === 'afventer', JSON.stringify(svar))
    tjek('  planen ER sluppet hos Stripe',
      falsk.planer.get(foer!.plan!)?.status === 'released')
    tjek('  men opsigelsen nåede IKKE frem',
      falsk.abonnementer.get(sub)?.cancel_at_period_end !== true)

    const r = await abo(sub)
    tjek('  BESLUTNINGEN står dog i basen — det er ankeret', !!r?.opsagtAf)
    const vis = await abonnementForBruger(u)
    // ── DEN HER ASSERTION VAR FORKERT ────────────────────
    // Den krævede «fornyes ikke» og `opsagt: true` på en række, hvor
    // Stripe intet havde fået. Prøven fastholdt altså selve det falske
    // løfte, gennemgangen kalder N1: et fejlet kald vist som en
    // gennemført opsigelse. Nu kræver den det modsatte.
    tjek('  og «Mit abonnement» siger IKKE «fornyes ikke»',
      vis?.naeste.slags === 'opsigelse_undervejs'
      && vis.opsagt === false && vis.opsigelseUndervejs === true
      && vis.fornyesIkke === false,
      JSON.stringify({ naeste: vis?.naeste, opsagt: vis?.opsagt,
        undervejs: vis?.opsigelseUndervejs }))
    tjek('  og knappen bliver stående, så hun kan prøve igen',
      vis?.fornyesIkke === false)

    // GENOPTAGELSEN. Før døde hvert genforsøg på et `release` af den
    // plan, Stripe allerede havde sluppet — længe før det nåede
    // `cancel_at_period_end`. Kunden sad fast.
    const slip = falsk.antal('subscriptionSchedules.release')
    const linjer = await betalingstilsyn(OPS)
    tjek('tilsynet fuldfører opsigelsen', 
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    tjek('  UDEN at forsøge release igen',
      falsk.antal('subscriptionSchedules.release') === slip,
      `${falsk.antal('subscriptionSchedules.release') - slip} ekstra`)
    const r2 = await abo(sub)
    tjek('  og skriver rækken hjem',
      r2?.opsagt === true && r2.plan === null && r2.planStatus === null,
      JSON.stringify(r2))
    tjek('  det står i rapporten',
      linjer.some((l) => l.includes('afstemning:') && l.includes('1 afstemt')),
      JSON.stringify(linjer))
    tjek('  og adgangen er URØRT', r2?.adgang?.getTime() === foer?.adgang?.getTime())
  }

  console.log('\n══ R2a · og fejl EFTER subscriptions.update ══')
  {
    // Stripe har opsigelsen; vores egen bogføring nåede ikke igennem.
    // Det er den tredje fejlplacering, og den ser sådan ud i basen.
    await nulstil()
    const { u, sub } = await medBekraeftetPlan('R2a')
    const planId = (await abo(sub))!.plan!
    tjek('opsigelsen lykkes hos Stripe', (await sigOpFor(u)).ok)
    // Rul bogføringen tilbage — præcis det, en tabt skrivning giver.
    // Skylden bliver stående: den ryddes først EFTER bogføringen, så
    // en skrivning, der aldrig landede, efterlader netop denne række.
    await db.update(subscriptions)
      .set({ cancelAtPeriodEnd: false, stripeScheduleId: planId,
             planStatus: 'konfigureret',
             afstemningSkyldigAt: new Date(), afstemningNaesteAt: null })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const vis = await abonnementForBruger(u)
    // Stripe HAR opsigelsen; vores egen række nåede ikke at få den.
    // Siden må derfor ikke sige «fornyes ikke» — vi kan ikke se det —
    // men den skal vise, at anmodningen er modtaget og undervejs.
    tjek('  siden siger «opsigelse undervejs», ikke «fornyes ikke»',
      vis?.naeste.slags === 'opsigelse_undervejs' && vis.opsigelseUndervejs === true,
      JSON.stringify(vis?.naeste))

    const slip = falsk.antal('subscriptionSchedules.release')
    await betalingstilsyn(OPS)
    const r = await abo(sub)
    tjek('tilsynet skriver rækken hjem',
      r?.opsagt === true && r.plan === null && r.planStatus === null, JSON.stringify(r))
    tjek('  og prøver ikke at slippe den slupne plan igen',
      falsk.antal('subscriptionSchedules.release') === slip,
      `${falsk.antal('subscriptionSchedules.release') - slip} ekstra`)
  }

  console.log('\n══ R2b · et genforsøg dør ikke på en allerede sluppet plan ══')
  {
    await nulstil()
    const { u, sub } = await medBekraeftetPlan('R2b')
    const planId = (await abo(sub))!.plan!
    tjek('første opsigelse lykkes', (await sigOpFor(u)).ok)
    tjek('  planen er sluppet hos Stripe',
      falsk.planer.get(planId)?.status === 'released')
    const slip = falsk.antal('subscriptionSchedules.release')
    // Stripe AFVISER et release af en sluppet plan. Gjorde vi det
    // alligevel, kastede kaldet — og opsigelsen kom aldrig videre.
    const igen = await sigOpFor(u)
    tjek('anden opsigelse lykkes også', igen.ok, JSON.stringify(igen))
    tjek('  og der blev IKKE forsøgt et release nummer to',
      falsk.antal('subscriptionSchedules.release') === slip,
      `${falsk.antal('subscriptionSchedules.release') - slip} ekstra`)
  }

  console.log('\n══ R2c · svarer Stripe slet ikke, står beslutningen og tages op igen ══')
  {
    await nulstil()
    const { u, sub } = await medBekraeftetPlan('R2c')
    falsk.fejlPaa.add('subscriptionSchedules.release')
    const svar = await sigOpFor(u)
    tjek('kunden får et ærligt svar: anmodningen afventer',
      !svar.ok && svar.fejl === 'afventer', JSON.stringify(svar))
    const r = await abo(sub)
    tjek('  men beslutningen er noteret', !!r?.opsagtAf)
    tjek('  og Stripe har IKKE opsigelsen endnu',
      falsk.abonnementer.get(sub)?.cancel_at_period_end !== true)
    await betalingstilsyn(OPS)
    const r2 = await abo(sub)
    tjek('tilsynet fuldfører den', r2?.opsagt === true, JSON.stringify(r2))
    tjek('  og Stripe har den nu',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
  }

  // ═══ R3 · KUNDENS OPSIGELSE SPÆRRER PLANLÆGNINGEN ════════
  console.log('\n══ R3 · efter en opsigelse lægges der ingen ny plan ══')
  {
    await nulstil()
    const u = await bruger('R3')
    const sub = `sub_R3_${S}`
    const kunde = `cus_R3_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await post(h('checkout.session.completed',
      { id: `cs_R3_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))
    // Planlægningen fejler før udførelse: skylden står som «mangler».
    falsk.fejlPaa.add('subscriptionSchedules.create')
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
    tjek('planen står som skyldig', (await abo(sub))?.planStatus === 'mangler',
      `planStatus=${(await abo(sub))?.planStatus}`)

    tjek('kunden siger op', (await sigOpFor(u)).ok)
    const create0 = falsk.antal('subscriptionSchedules.create')
    await betalingstilsyn(OPS)
    tjek('tilsynet lægger INGEN ny plan',
      falsk.antal('subscriptionSchedules.create') === create0,
      `${falsk.antal('subscriptionSchedules.create') - create0} nye`)

    // En FORSINKET introfaktura må heller ikke starte den igen.
    await post(faktura(sub, nu() + 172800, OPS.introPrisId, kunde))
    await betalingstilsyn(OPS)
    tjek('  og en forsinket introfaktura starter den heller ikke',
      falsk.antal('subscriptionSchedules.create') === create0,
      `${falsk.antal('subscriptionSchedules.create') - create0} nye`)
    const r = await abo(sub)
    tjek('  opsigelsen står stadig', r?.opsagt === true && !!r.opsagtAf)
    tjek('  og adgangen er URØRT — hun har betalt for perioden', !!r?.adgang)
    tjek('  laegPlan svarer «opsagt», hvis nogen kalder den direkte',
      (await laegPlan(sub, OPS)) === 'opsagt')
  }

  console.log('\n══ R3b · en opsigelse MIDT i et planlægningskald vinder ══')
  {
    await nulstil()
    const u = await bruger('R3b')
    const sub = `sub_R3b_${S}`
    const kunde = `cus_R3b_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await post(h('checkout.session.completed',
      { id: `cs_R3b_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))

    // Kunden siger op, MENS planen konfigureres. Vagten øverst i
    // `laegPlan` har allerede læst rækken; kun gentjekket bagefter
    // kan fange det.
    const rigtig = (falsk.subscriptionSchedules as { update: (...a: unknown[]) => Promise<unknown> }).update
    ;(falsk.subscriptionSchedules as { update: unknown }).update =
      async (...a: unknown[]) => {
        const svar = await rigtig(...a)
        await sigOpFor(u)
        return svar
      }
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
    ;(falsk.subscriptionSchedules as { update: unknown }).update = rigtig

    const r = await abo(sub)
    tjek('planen blev IKKE markeret konfigureret',
      r?.planStatus !== 'konfigureret', `planStatus=${r?.planStatus}`)
    tjek('  bindingen er ryddet', r?.plan === null, `plan=${r?.plan}`)
    tjek('  og planen er sluppet hos Stripe',
      [...falsk.planer.values()].every((p) => p.status === 'released'),
      JSON.stringify([...falsk.planer.values()].map((p) => p.status)))
    tjek('  opsigelsen står', r?.opsagt === true && !!r.opsagtAf)
    tjek('  og adgangen er urørt', !!r?.adgang)
  }

  // ═══ R4 · BINDINGEN OG BEKRÆFTELSEN ══════════════════════
  console.log('\n══ R4 · en forsinket hændelse ophæver ikke opsigelsen ══')
  {
    await nulstil()
    const { u, sub, kunde } = await medBekraeftetPlan('R4')
    const planId = (await abo(sub))!.plan!
    tjek('opsigelsen lykkes', (await sigOpFor(u)).ok)
    const beslutning = (await abo(sub))!.opsagtAf!

    // ── STIL RÆKKEN, SÅ HÆNDELSEN FAKTISK NÅR FREM ────────
    // Uden det her ville `nyereEnd` afvise den forsinkede hændelse af
    // en HELT anden grund — den er ældre end sidste spejling — og
    // afsnittet ville være grønt, uden at vagten nogensinde blev prøvet.
    // Den sidst spejlede hændelse sættes derfor ældre end beslutningen.
    await db.update(subscriptions)
      .set({ stripeOpdateretAt: new Date(beslutning.getTime() - 7_200_000),
             stripeScheduleId: planId })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    // Oprettet FØR beslutningen, men nyere end sidste spejling.
    const forsinket = Math.floor((beslutning.getTime() - 3_600_000) / 1000)
    await post(h('customer.subscription.updated',
      { id: sub, status: 'past_due', customer: kunde,
        cancel_at_period_end: false, schedule: planId },
      forsinket))
    const r = await abo(sub)
    tjek('hændelsen NÅEDE frem — status er spejlet', r?.status === 'past_due',
      `status=${r?.status}`)
    tjek('  men den rydder IKKE opsigelsesflaget', r?.opsagt === true,
      JSON.stringify(r))
    const vis = await abonnementForBruger(u)
    tjek('  og siden siger stadig «fornyes ikke»',
      vis?.naeste.slags === 'fornyes_ikke', JSON.stringify(vis?.naeste))
    tjek('  bindingen står stadig — den ryddes af en autoritativ null, ikke her',
      r?.plan === planId, `plan=${r?.plan}`)

    // ── `schedule: null` ER ET SVAR ───────────────────────
    // Nyere end beslutningen, og med `schedule` sat til null.
    await post(h('customer.subscription.updated',
      { id: sub, status: 'active', customer: kunde,
        cancel_at_period_end: true, schedule: null },
      Math.floor(beslutning.getTime() / 1000) + 3600))
    const r2 = await abo(sub)
    tjek('en autoritativ `schedule: null` RYDDER bindingen', r2?.plan === null,
      `plan=${r2?.plan}`)

    // Og en NYERE hændelse må gerne rydde flaget — det er ikke en lås,
    // det er en rækkefølge.
    await post(h('customer.subscription.updated',
      { id: sub, status: 'active', customer: kunde,
        cancel_at_period_end: false, schedule: null },
      Math.floor(beslutning.getTime() / 1000) + 7200))
    tjek('  en NYERE hændelse må gerne rydde flaget',
      (await abo(sub))?.opsagt === false)
  }

  console.log('\n══ R4a · attrappen håndhæver Stripes egen regel ══')
  {
    // Prøverne ovenfor hviler på, at attrappen afviser det, Stripe
    // afviser. Gør den ikke det, er de grønne om et forløb, der ville
    // fejle — og så måler de ikke det, de hedder. Derfor prøves
    // attrappen selv.
    await nulstil()
    const { sub } = await medBekraeftetPlan('R4a')
    const planId = (await abo(sub))!.plan!
    const s = falsk.subscriptionSchedules as {
      release: (id: string) => Promise<unknown>
      update: (id: string, p: unknown) => Promise<unknown>
    }
    await s.release(planId)
    tjek('planen er sluppet', falsk.planer.get(planId)?.status === 'released')
    tjek('  og den har sluppet sit abonnement',
      falsk.planer.get(planId)?.subscription === null
      && falsk.planer.get(planId)?.released_subscription === sub,
      JSON.stringify(falsk.planer.get(planId)))
    tjek('  abonnementet peger ikke længere på den',
      falsk.abonnementer.get(sub)?.schedule === undefined)
    let nej = false
    try { await s.release(planId) } catch { nej = true }
    tjek('  et release NUMMER TO afvises — som hos Stripe', nej)
    nej = false
    try { await s.update(planId, { phases: [] }) } catch { nej = true }
    tjek('  og en sluppet plan kan ikke ændres', nej)
  }

  console.log('\n══ R4b · en sluppet plan bekræftes aldrig som gyldig ══')
  {
    await nulstil()
    const { sub } = await medBekraeftetPlan('R4b')
    const planId = (await abo(sub))!.plan!
    // Planen slippes hos Stripe, uden at vi når at bogføre det — og
    // vores egen række står stadig med id'et.
    await (falsk.subscriptionSchedules as
      { release: (id: string) => Promise<unknown> }).release(planId)
    await db.update(subscriptions)
      .set({ stripeScheduleId: planId, planStatus: 'oprettet', planForsoeg: 1,
             adgangTil: new Date(Date.now() + 30 * 60_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    const r = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    tjek('sikkerheden svarer IKKE «planen er rigtig»', r !== 'plan_er_rigtig', `r=${r}`)
    const e = await abo(sub)
    tjek('  og skriver ikke «konfigureret» på den',
      e?.planStatus !== 'konfigureret', `planStatus=${e?.planStatus}`)
    tjek('  fornyelsen blev stoppet i stedet', r === 'stoppet' && !!e?.stoppet, `r=${r}`)
  }

  console.log('\n══ R4c · planGaelder måler BEGGE led ══')
  {
    const p = (o: Record<string, unknown>) => ({ id: 'sub_sched_x', phases: [], ...o })
    tjek('active + rigtigt abonnement gælder',
      planGaelder(p({ status: 'active', subscription: 'sub_A' }), 'sub_A'))
    tjek('  not_started gælder også',
      planGaelder(p({ status: 'not_started', subscription: 'sub_A' }), 'sub_A'))
    tjek('  released gælder IKKE — uanset faser',
      !planGaelder(p({ status: 'released', subscription: 'sub_A' }), 'sub_A'))
    tjek('  canceled og completed gælder ikke',
      !planGaelder(p({ status: 'canceled', subscription: 'sub_A' }), 'sub_A')
      && !planGaelder(p({ status: 'completed', subscription: 'sub_A' }), 'sub_A'))
    tjek('  en plan på et ANDET abonnement gælder ikke',
      !planGaelder(p({ status: 'active', subscription: 'sub_B' }), 'sub_A'))
    tjek('  og en plan uden abonnement gælder ikke',
      !planGaelder(p({ status: 'active', subscription: null }), 'sub_A')
      && !planGaelder(p({ status: 'active' }), 'sub_A'))
    tjek('  objektform læses som id', planGaelder(
      p({ status: 'active', subscription: { id: 'sub_A' } }), 'sub_A'))
    tjek('  ingen plan gælder ikke', !planGaelder(null, 'sub_A'))
  }

  // ═══ PRISMODELLEN ER URØRT ═══════════════════════════════
  console.log('\n══ P · den almindelige vej er uændret ══')
  {
    await nulstil()
    const { sub } = await medBekraeftetPlan('P')
    const r = await abo(sub)
    tjek('et almindeligt introkøb får sin bekræftede plan',
      r?.planStatus === 'konfigureret' && !!r.plan, JSON.stringify(r))
    const plan = falsk.planer.get(r!.plan!)
    tjek('  med PRÆCIS to faser', plan?.phases.length === 2,
      `${plan?.phases.length} faser`)
    tjek('  9 kr. først, derefter 349 kr.',
      plan?.phases[0]?.items?.[0]?.price === OPS.introPrisId
      && plan.phases[1]?.items?.[0]?.price === OPS.normalPrisId,
      JSON.stringify(plan?.phases.map((f) => f.items?.[0]?.price)))
    tjek('  planen GÆLDER for abonnementet', planGaelder(plan, sub))
    tjek('  og den er ikke opsagt', r?.opsagt === false && r.opsagtAf === null)
    const tomt = await afstemSkyldige(OPS)
    tjek('  tilsynet har ingen skyldige opsigelser at fuldføre',
      tomt.skyldige === 0, JSON.stringify(tomt))
  }
}

try {
  await koer()
} catch (e) {
  fejl++
  console.log(`\n  ✗ PRØVEN BLEV AFBRUDT: ${(e as Error).message}`)
  console.log('    De resterende afsnit blev IKKE kørt.')
}
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
