// ═══════════════════════════════════════════════════════════════
//  Femte gennemgangs fire fund, prøvet mod rettelserne — plus de
//  fire, gennemgangen IKKE fandt, men som rettelserne selv indførte.
//
//  Gennemgangens egen probe kører mod en in-memory SQL-adapter uden
//  transaktionsisolering; den siger det selv. Den her kører mod PGlite
//  med de rigtige migrationer og gennem de FAKTISKE indgange, som
//  opgaven kræver:
//
//    Kunden   `sigOpFor()` · `abonnementForBruger()`
//    Planen   `laegPlan()`
//    Drift    `betalingstilsyn()`
//
//  Kapløbene ligger i scripts/test-betaling-kaploeb.ts mod rigtig,
//  isoleret PostgreSQL. En grøn attrap er ikke en Stripe-verifikation:
//  Stripe-sandkassen er IKKE afprøvet, og intet her måler en betaling.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, laegPlan,
  stopForkertFornyelse } from '../lib/webhook'
import { sigOpFor, abonnementForBruger } from '../lib/abonnement'
import { afstemAbonnement, afstemSkyldige, naesteAfstemning, skyldAfstemning,
  skalFornyelsenStoppes, INGEN_BESLUTNING } from '../lib/opsigelse'
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

let falsk: Falsk & Record<string, unknown>
const S = Date.now()

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r5${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r5${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const laes = (sub: string) => db.select({
  status: subscriptions.status, adgang: subscriptions.adgangTil,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  opsagt: subscriptions.cancelAtPeriodEnd, opsagtAf: subscriptions.opsagtAfKundeAt,
  stoppet: subscriptions.fornyelseStoppetAt,
  skyldig: subscriptions.afstemningSkyldigAt, naeste: subscriptions.afstemningNaesteAt,
  forsoeg: subscriptions.afstemningForsoeg, grund: subscriptions.afstemningFejl,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions)
  await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

/** En konto med abonnement, adgang og en AKTIV plan bundet hos Stripe. */
async function medPlan(navn: string, v: Record<string, unknown> = {}) {
  const u = await bruger(navn)
  const sub = `sub_${navn}_${S}`
  const plan = `sch_${navn}_${S}`
  saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false, schedule: plan })
  falsk.planer.set(plan, { id: plan, status: 'active', subscription: sub, konfigureret: true,
    phases: [{ items: [{ price: OPS.introPrisId }] }, { items: [{ price: OPS.normalPrisId }] }] })
  await db.insert(subscriptions).values({
    userId: u, stripeSubscriptionId: sub, stripeCustomerId: `cus_${navn}`,
    status: 'active', adgangTil: new Date(Date.now() + 30 * 86400_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    stripeScheduleId: plan, planStatus: 'konfigureret',
    cancelAtPeriodEnd: false, ...v,
  } as never)
  return { u, sub, plan }
}

/** Attrappens abonnementskort har ikke `status` i sin type; prøven har brug for den. */
type Sked = { create: (...a: unknown[]) => Promise<unknown>
  release: (id: string) => Promise<unknown> }
type Subs = { retrieve: (id: string) => Promise<unknown> }

const saetAbo = (sub: string, v: Record<string, unknown>) =>
  (falsk.abonnementer as Map<string, unknown>).set(sub, v)

const release = (fra: number) =>
  falsk.kald.slice(fra).filter((k: { metode: string }) =>
    k.metode === 'subscriptionSchedules.release').length

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═════════════════════════════════════════════════════════════
  //  N1 · EN UAFKLARET OPSIGELSE ER IKKE EN GENNEMFØRT OPSIGELSE
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ N1 · anmodning, bekræftet sluttilstand og udestående arbejde ══')
  {
    await nulstil()
    const { u, sub } = await medPlan('N1')
    // Stripe svarer ikke. Hun trykker «Sig op».
    falsk.fejlPaa.add('subscriptionSchedules.retrieve')
    const svar = await sigOpFor(u)

    tjek('kaldet fejlede, så svaret er «afventer» — ikke «ok»',
      svar.ok === false && svar.fejl === 'afventer', JSON.stringify(svar))
    tjek('  …og hun får sin adgangsdato at vide alligevel',
      svar.ok === false && svar.fejl === 'afventer' && svar.adgangTil !== undefined,
      JSON.stringify(svar))

    const r1 = await laes(sub)
    tjek('  ANMODNINGEN er modtaget og gemt', r1?.opsagtAf !== null)
    tjek('  den BEKRÆFTEDE sluttilstand er IKKE påstået', r1?.opsagt === false)
    tjek('  og der står UDESTÅENDE ARBEJDE i basen', r1?.skyldig !== null,
      `skyldig=${r1?.skyldig} grund=${r1?.grund}`)
    tjek('  Stripe har heller ikke fået den',
      falsk.abonnementer.get(sub)?.cancel_at_period_end !== true)

    const ui1 = await abonnementForBruger(u)
    tjek('  «Mit abonnement» siger «opsigelse undervejs»',
      ui1?.naeste.slags === 'opsigelse_undervejs', JSON.stringify(ui1?.naeste))
    tjek('  …ikke «Opsagt», og ikke «fornyes ikke»',
      ui1?.opsagt === false && ui1?.fornyesIkke === false,
      `opsagt=${ui1?.opsagt} fornyesIkke=${ui1?.fornyesIkke}`)
    tjek('  …og undervejs-flaget er sat, så knappen bliver stående',
      ui1?.opsigelseUndervejs === true)
    tjek('  fornyelsesdatoen står stadig — Stripe har den bogført',
      ui1?.fornyesAt !== null)

    // Hun trykker igen. Nu virker Stripe.
    const svar2 = await sigOpFor(u)
    tjek('andet tryk går igennem og BEKRÆFTER',
      svar2.ok === true && svar2.bekraeftet === true, JSON.stringify(svar2))
    const r2 = await laes(sub)
    tjek('  Stripe har bekræftet, og vi har bogført det', r2?.opsagt === true)
    tjek('  planen er sluppet', falsk.planer.get(`sch_N1_${S}`)?.status === 'released')
    tjek('  skylden er indfriet', r2?.skyldig === null)
    const ui2 = await abonnementForBruger(u)
    tjek('  «Mit abonnement» siger nu «Opsagt»',
      ui2?.opsagt === true && ui2?.naeste.slags === 'fornyes_ikke')
    tjek('  …og der er ingen fornyelsesdato', ui2?.fornyesAt === null)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      r2?.adgang?.getTime() === r1?.adgang?.getTime())
  }

  console.log('\n══ N1b · et tabt BOGFØRINGSSKRID er ikke en manglende opsigelse ══')
  {
    // Stripe har bekræftet. Det er VORES skrivning, der gik tabt. Det
    // er en anden fejl end «Stripe svarede ikke», og hun må ikke få at
    // vide, at opsigelsen ikke gik igennem — for det gjorde den.
    await nulstil()
    const { u, sub } = await medPlan('N1b', { stripeScheduleId: null, planStatus: null })
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false })
    const svar = await sigOpFor(u)
    tjek('opsigelsen er bekræftet over for kunden',
      svar.ok === true && svar.bekraeftet === true, JSON.stringify(svar))
    const r = await laes(sub)
    tjek('  pengefaktummet er bogført FØRST', r?.opsagt === true)
    tjek('  og Stripe har den', falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
  }

  // ═════════════════════════════════════════════════════════════
  //  N2 · EN AKTIV PLAN MÅ ALDRIG BLIVE GLEMT
  // ═════════════════════════════════════════════════════════════
  for (const [nr, hvor] of ([['a', 'subscriptionSchedules.release'],
                             ['b', 'subscriptions.update']] as const)) {
    console.log(`\n══ N2${nr} · ${hvor} fejler — planen glemmes ikke ══`)
    await nulstil()
    const { u, sub, plan } = await medPlan(`N2${nr}`)
    const adgangFoer = (await laes(sub))!.adgang!.getTime()
    falsk.fejlPaa.add(hvor)
    const svar = await sigOpFor(u)
    tjek('kunden får «afventer», ikke et løfte',
      svar.ok === false && svar.fejl === 'afventer', JSON.stringify(svar))
    const r1 = await laes(sub)
    tjek('  skylden står', r1?.skyldig !== null)
    tjek('  og den siger HVAD der mangler', (r1?.grund ?? '').length > 0, `${r1?.grund}`)

    // Tilsynet kører. Nu virker Stripe.
    const linjer = await betalingstilsyn(OPS)
    const r2 = await laes(sub)
    tjek('  tilsynet fik planen sluppet',
      falsk.planer.get(plan)?.status === 'released', `${falsk.planer.get(plan)?.status}`)
    tjek('  …og bindingen ryddet FØRST efter bekræftelsen', r2?.plan === null)
    tjek('  fornyelsen er stoppet hos Stripe',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    tjek('  skylden er indfriet', r2?.skyldig === null)
    tjek('  tilsynet siger hvad det gjorde',
      linjer.some((l) => l.includes('afstemning:')), JSON.stringify(linjer.slice(0, 2)))
    tjek('  KUNDENS BETALTE ADGANG ER URØRT', r2?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ N2c · OPRETTELSESVINDUET: en plan lagt i samme øjeblik hun sagde op ══')
  {
    // Det tidligere vindue, gennemgangen bad om at få dækket. `laegPlan`
    // har OPRETTET planen hos Stripe; mens kaldet var i luften, sagde
    // hun op. Før skrev vi `plan: null, planStatus: null` — en påstand
    // Stripe aldrig afgav — og ingen kø kunne se rækken bagefter.
    await nulstil()
    const u = await bruger('N2c')
    const sub = `sub_N2c_${S}`
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, stripeCustomerId: 'cus_N2c',
      status: 'active', adgangTil: new Date(Date.now() + 86400_000),
      currentPeriodEnd: new Date(Date.now() + 86400_000),
      stripePriceId: OPS.introPrisId, planStatus: 'mangler', planForsoeg: 0,
      cancelAtPeriodEnd: false,
    } as never)
    // Hun siger op MENS `create` er i luften.
    const rigtig = (falsk.subscriptionSchedules as Sked).create.bind(falsk.subscriptionSchedules)
    let engang = false
    ;(falsk.subscriptionSchedules as Record<string, unknown>).create = async (...a: unknown[]) => {
      const svar = await (rigtig as (...x: unknown[]) => Promise<unknown>)(...a)
      if (!engang) {
        engang = true
        await db.update(subscriptions).set({ opsagtAfKundeAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, sub))
      }
      return svar
    }
    const r = await laegPlan(sub, OPS)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).create = rigtig
    tjek('`laegPlan` svarer «opsagt»', r === 'opsagt', `r=${r}`)
    const r1 = await laes(sub)
    tjek('  der påstås INTET om planen', r1?.planStatus !== 'konfigureret')
    tjek('  der står i stedet en SKYLD', r1?.skyldig !== null, `${r1?.grund}`)
    const planId = [...falsk.planer.keys()][0] as string
    tjek('  planen er stadig aktiv hos Stripe (intet er påstået væk)',
      falsk.planer.get(planId)?.status === 'active')
    // Køen gør arbejdet færdigt.
    await afstemSkyldige(OPS)
    const r2 = await laes(sub)
    tjek('  afstemningen SLIPPER planen',
      falsk.planer.get(planId)?.status === 'released', `${falsk.planer.get(planId)?.status}`)
    tjek('  …og stopper fornyelsen',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    tjek('  skylden er indfriet', r2?.skyldig === null)
  }

  console.log('\n══ N2d · K1: en skyld sat på et SPEJLET flag må ikke ryddes uden arbejde ══')
  {
    // Sætteren i `laegPlan` spurgte `opsagtAf || cancel_at_period_end`.
    // Betaleren spurgte `opsagtAf || fornyelse_stoppet_at`. Sætterens
    // mængde var en ægte overmængde: en skyld sat alene på det spejlede
    // flag blev ryddet med NUL Stripe-kald, mens planen stod aktiv og
    // bundet. Det er N2's sluttilstand, nået gennem den kø, der skulle
    // fjerne den.
    await nulstil()
    const { sub, plan } = await medPlan('N2d', { cancelAtPeriodEnd: true })
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: true, schedule: plan })
    await skyldAfstemning(sub, 'planen blev lagt, mens kunden sagde op')
    const foer = falsk.kald.length
    await afstemSkyldige(OPS)
    const r = await laes(sub)
    tjek('planen blev faktisk sluppet', release(foer) === 1, `${release(foer)} release`)
    tjek('  …og styrer ikke længere abonnementet',
      falsk.planer.get(plan)?.subscription == null)
    tjek('  skylden er indfriet EFTER arbejdet', r?.skyldig === null)
  }

  console.log('\n══ N2e · K2: vores EGET sikkerhedsstop skal også kunne genoptages ══')
  {
    // `stopForkertFornyelse` skrev `fornyelse_stoppet_at` til SIDST,
    // efter try-blokken. Fejlede kaldene, skrev catch-grenen en skyld,
    // hvis hensigt afstemningen udleder af netop det felt — og feltet
    // var null præcis dér. Skylden blev ryddet uden arbejde.
    await nulstil()
    const { sub, plan } = await medPlan('N2e', {
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret 500',
      adgangTil: new Date(Date.now() + 30 * 60_000),
    })
    falsk.fejlPaa.add('subscriptionSchedules.release')
    const svar = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    tjek('indgrebet fejlede', svar === 'fejlede', `svar=${svar}`)
    const r1 = await laes(sub)
    tjek('  men BESLUTNINGEN er forankret', r1?.stoppet !== null)
    tjek('  og der står en skyld', r1?.skyldig !== null)
    tjek('  intet påstår at fornyelsen ER stoppet', r1?.opsagt === false)
    const foer = falsk.kald.length
    await afstemSkyldige(OPS)
    const r2 = await laes(sub)
    tjek('  afstemningen gør arbejdet færdigt', release(foer) === 1, `${release(foer)} release`)
    tjek('  planen er sluppet', falsk.planer.get(plan)?.status === 'released')
    tjek('  fornyelsen er stoppet', r2?.opsagt === true)
    tjek('  skylden er indfriet', r2?.skyldig === null)
  }

  console.log('\n══ N2f · K2b: et indgreb, der IKKE var nødvendigt, må ikke efterlade en beslutning ══')
  {
    // Beslutningen skrives, hvor den TAGES — ikke øverst i funktionen.
    // Øverst ville `plan_er_rigtig`-grenen, som netop ikke griber ind,
    // efterlade vores beslutning om at stoppe et abonnement, der intet
    // fejlede — med en blivende advarsel i driftsrapporten.
    await nulstil()
    const u = await bruger('N2f')
    const sub = `sub_N2f_${S}`
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, stripeCustomerId: 'cus_N2f',
      status: 'active', adgangTil: new Date(Date.now() + 86400_000),
      currentPeriodEnd: new Date(Date.now() + 86400_000),
      stripePriceId: OPS.introPrisId, planStatus: 'mangler', planForsoeg: 0,
      cancelAtPeriodEnd: false,
    } as never)
    // Læg planen gennem den RIGTIGE kodevej, så den faktisk er rigtig.
    // En håndbygget plan ville kun måle prøvens egen forestilling om,
    // hvad `faserErRigtige` mener.
    await betalingstilsyn(OPS)
    tjek('planen er lagt og bekræftet',
      (await laes(sub))?.planStatus === 'konfigureret',
      `${(await laes(sub))?.planStatus}`)
    // Nu TABER vi vores egen tilbagelæsning, og fornyelsen er nær.
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planFejl: 'svaret gik tabt',
             adgangTil: new Date(Date.now() + 30 * 60_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const svar = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    tjek('svaret er «planen er rigtig»', svar === 'plan_er_rigtig', `svar=${svar}`)
    const r = await laes(sub)
    tjek('  INGEN beslutning er skrevet', r?.stoppet === null, `stoppet=${r?.stoppet}`)
    tjek('  og abonnementet er ikke opsagt', r?.opsagt === false)
  }

  console.log('\n══ N2g · K6: siger Stripe selv, at abonnementet er dødt, stopper vi ══')
  {
    // Dødsvagten læste VORES spejl. Gik `customer.subscription.deleted`
    // tabt — og hele modulet findes, fordi hændelser går tabt — står
    // rækken `active` hos os, mens Stripe har lukket abonnementet.
    // `naesteAfstemning` giver aldrig op, så det blev et evigt timekald.
    await nulstil()
    const { sub } = await medPlan('N2g', { opsagtAfKundeAt: new Date(),
      stripeScheduleId: null, planStatus: null })
    saetAbo(sub, { id: sub, status: 'canceled', cancel_at_period_end: false })
    await skyldAfstemning(sub, 'kunden har sagt op')
    for (let i = 0; i < 3; i++) {
      falsk.fejlPaa.add('subscriptions.update')
      await afstemSkyldige(OPS)
    }
    const r = await laes(sub)
    tjek('skylden er indfriet — et dødt abonnement fornyes ikke', r?.skyldig === null,
      `skyldig=${r?.skyldig} forsoeg=${r?.forsoeg}`)
    tjek('  og vores spejl er rettet efter kilden', r?.status === 'canceled',
      `status=${r?.status}`)
  }

  console.log('\n══ N2h · K7: hendes tryk i vinduet mellem læsning og rydning ══')
  {
    // Rækken læses ÉN gang, øverst i afstemningen. Trykker hun op
    // imellem den læsning og rydningen — og opslaget hos Stripe er
    // netop en netværkstur at gøre det i — ryddede vi en skyld, der
    // aldrig blev indfriet: anmodning modtaget, intet bekræftet, og
    // ingen kø der så rækken.
    await nulstil()
    const { sub } = await medPlan('N2h', { stripeScheduleId: null, planStatus: null })
    await skyldAfstemning(sub, 'en tidligere skyld')
    const rigtig = (falsk.subscriptions as Subs).retrieve.bind(falsk.subscriptions)
    let engang = false
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      if (!engang) {
        engang = true
        await db.update(subscriptions).set({ opsagtAfKundeAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, sub))
      }
      return rigtig(id)
    }
    await afstemSkyldige(OPS)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtig
    const r = await laes(sub)
    tjek('opsigelsen er enten gennemført eller stadig skyldig',
      r?.opsagt === true || r?.skyldig !== null,
      `opsagtAf=${r?.opsagtAf} skyldig=${r?.skyldig} cape=${r?.opsagt}`)
  }

  console.log('\n══ N2i · spejlingen må ikke rydde VORES EGET stop ══')
  {
    // Den tredje skriver af `cancel_at_period_end` er `spejl()`, og
    // den kan skrive FALSE. Vagten dér spurgte kun kundens beslutning
    // (`opsagt_af_kunde_at`) — men vores eget sikkerhedsstop skriver
    // samme kolonne UDEN at sætte det felt. På sådan en række var der
    // altså ingen vagt overhovedet: en forsinket hændelse, dannet før
    // stoppet, ryddede flaget, mens Stripe stadig sagde true. Hverken
    // opsigelseskøen eller fornyelsesvagten tog rækken op.
    //
    // Vagten spørger nu den SENESTE af de to beslutninger. To
    // forløb, to forskellige rigtige svar:
    //   · hændelsen er ÆLDRE end beslutningen → den ved intet om den,
    //     og der skrives ikke.
    //   · hændelsen er NYERE → den er et ægte svar, flaget ryddes —
    //     og så skal der stå en SKYLD, så afstemningen genopretter.
    for (const [nr, navn, forskyd] of ([
      // TIDSPUNKTERNE ER PRÆCISE MED VILJE. Rækken sættes op med
      // `stripe_opdateret_at = nu − 120 s`, og stoppet sker ~nu.
      //   · 'a' skal ligge MELLEM de to: nyere end spejlets stempel,
      //     så den almindelige rækkefølgevagt slipper den igennem —
      //     og ældre end beslutningen, så det er BESLUTNINGSvagten,
      //     der stopper den. Vælger man −600, forkaster den første
      //     vagt hændelsen, beslutningsvagten bliver aldrig spurgt,
      //     og prøven måler noget andet, end den siger. (Målt: med
      //     −600 forblev prøven grøn, da vagten blev rullet tilbage.)
      //   · 'b' skal ligge efter begge.
      ['a', 'ÆLDRE end vores stop — må ikke skrive', -60],
      ['b', 'NYERE end vores stop — skriver, men efterlader en skyld', 600],
    ] as const)) {
      await nulstil()
      const { sub } = await medPlan(`N2i${nr}`, {
        planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
        adgangTil: new Date(Date.now() + 30 * 60_000),
        stripeOpdateretAt: new Date(Date.now() - 120_000),
      })
      const svar = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
      const f1 = await laes(sub)
      tjek(`${nr} · vi stoppede fornyelsen, kunden bad ikke om noget`,
        svar === 'stoppet' && f1?.opsagt === true && f1?.opsagtAf === null,
        `svar=${svar} cape=${f1?.opsagt} opsagtAf=${f1?.opsagtAf}`)

      await behandl({ id: `evt_${randomUUID()}`, type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000) + forskyd,
        data: { object: { id: sub, status: 'active', cancel_at_period_end: false } },
      } as never, OPS)
      const f2 = await laes(sub)
      console.log(`     ${navn}: cape=${f2?.opsagt} skyldig=${f2?.skyldig !== null}`)

      const hosStripe = () => (falsk.abonnementer.get(sub) as
        { cancel_at_period_end?: boolean } | undefined)?.cancel_at_period_end
      // DET ER DÉT, DER SKAL HOLDE: enten er base og Stripe enige, eller
      // også står der en skyld, så nogen retter det. Aldrig tavs uenighed.
      tjek('   base og Stripe er enige, ELLER der står en skyld',
        f2?.opsagt === hosStripe() || f2?.skyldig !== null,
        `base=${f2?.opsagt} stripe=${hosStripe()} skyldig=${f2?.skyldig}`)

      // ── OG MEKANISMEN, IKKE KUN UDFALDET ────────────────
      // Egenskaben ovenfor overlever, hvis vagten fjernes: så skriver
      // spejlingen `false`, den anden vagt sætter en skyld, og
      // afstemningen retter det. Udfaldet er rigtigt — men prøven
      // ville ikke kunne blive rød, og så måler den ingenting.
      // (Målt: jeg rullede vagten tilbage, og prøven blev grøn.)
      //
      // Derfor pinnes selve vagten her. En hændelse, der er ÆLDRE end
      // beslutningen, ved intet om den og skal slet ikke skrive — ikke
      // skrive forkert og blive repareret bagefter. Forskellen er en
      // Stripe-tur og et vindue, hvor basen er forkert.
      if (nr === 'a') {
        tjek('   den ældre hændelse skriver SLET IKKE',
          f2?.opsagt === true && f2?.skyldig === null,
          `cape=${f2?.opsagt} skyldig=${f2?.skyldig}`)
      } else {
        tjek('   den nyere hændelse ER et svar — den skriver, og skylden står',
          f2?.opsagt === false && f2?.skyldig !== null,
          `cape=${f2?.opsagt} skyldig=${f2?.skyldig}`)
      }

      await betalingstilsyn(OPS)
      const f3 = await laes(sub)
      tjek('   og tilsynet bringer dem i overensstemmelse',
        f3?.opsagt === hosStripe(), `base=${f3?.opsagt} stripe=${hosStripe()}`)
      tjek('   KUNDENS BETALTE ADGANG ER URØRT',
        f3?.adgang?.getTime() === f1?.adgang?.getTime())
    }
  }

  // ═════════════════════════════════════════════════════════════
  //  N3 · ET TABT KAPLØB ER IKKE EN FEJL — EN RIGTIG FEJL ER
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ N3 · det tabte release-kapløb, og den fejl der IKKE må sluges ══')
  {
    await nulstil()
    const { u, sub, plan } = await medPlan('N3')
    // En anden slipper planen, netop som vi skal til det. Stripe siger
    // nej til vores `release` — men det, vi bad om, ER sket.
    const rigtig = (falsk.subscriptionSchedules as Sked).release.bind(falsk.subscriptionSchedules)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).release = async (id: string) => {
      await rigtig(id)                       // en anden vandt
      throw new Error('schedule already released')
    }
    const svar = await sigOpFor(u)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).release = rigtig
    tjek('et TABT kapløb er ikke en fejl over for kunden',
      svar.ok === true && svar.bekraeftet === true, JSON.stringify(svar))
    tjek('  planen er sluppet', falsk.planer.get(plan)?.status === 'released')
    tjek('  og fornyelsen er stoppet',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
  }
  {
    // Modstykket: en RIGTIG release-fejl må ikke sluges. Planen gælder
    // stadig efter genlæsningen, så det er ikke et tabt kapløb.
    await nulstil()
    const { u, sub, plan } = await medPlan('N3b')
    falsk.fejlPaa.add('subscriptionSchedules.release')
    const svar = await sigOpFor(u)
    tjek('en RIGTIG release-fejl sluges ikke',
      svar.ok === false && svar.fejl === 'afventer', JSON.stringify(svar))
    const r = await laes(sub)
    tjek('  planen gælder stadig', falsk.planer.get(plan)?.status === 'active')
    tjek('  bindingen er IKKE ryddet', r?.plan === plan)
    tjek('  fornyelsen er ikke påstået stoppet', r?.opsagt === false)
    tjek('  og skylden står', r?.skyldig !== null)
  }

  // ═════════════════════════════════════════════════════════════
  //  N4 · KØEN SKAL HAVE VEDVARENDE OG RETFÆRDIG FREMDRIFT
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ N4 · 25 vedvarende fejl må ikke udsulte nummer 26 ══')
  {
    await nulstil()
    // 25 rækker, der ALTID fejler, og én der kan lade sig gøre.
    const daarlige: string[] = []
    for (let i = 0; i < 25; i++) {
      const { sub } = await medPlan(`N4d${i}`, { opsagtAfKundeAt: new Date() })
      await skyldAfstemning(sub, 'vedvarende fejl')
      daarlige.push(sub)
    }
    // VEDVARENDE, ikke én gang: attrappens `fejlPaa` opbruges ved
    // første kald, og en engangsfejl ville ikke måle udsultning.
    // De 25 fejler hver eneste gang, i alle kørsler.
    const rigtigUpd = (falsk.subscriptions as { update: (...a: unknown[]) => Promise<unknown> })
      .update.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).update =
      async (id: string, ...a: unknown[]) => {
        if (id.includes('N4d')) throw new Error('modelleret vedvarende 500')
        return rigtigUpd(id, ...a)
      }
    const { sub: rask } = await medPlan('N4r', { opsagtAfKundeAt: new Date() })
    await skyldAfstemning(rask, 'kan lade sig gøre')

    const runder: unknown[] = []
    let raskFaerdig = false
    for (let i = 0; i < 3 && !raskFaerdig; i++) {
      const u = await afstemSkyldige(OPS, 25)
      runder.push({ skyldige: u.skyldige, taget: u.taget, afstemte: u.afstemte,
        fejlede: u.fejlede, venter: u.venter })
      raskFaerdig = (await laes(rask))!.skyldig === null
    }
    ;(falsk.subscriptions as Record<string, unknown>).update = rigtigUpd
    console.log(`     runder=${JSON.stringify(runder)}`)
    tjek('den gennemførlige opsigelse blev taget inden for tre kørsler', raskFaerdig)
    tjek('  …og de 25 fejlende står der stadig',
      (await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions)
        .where(and(isNotNull(subscriptions.afstemningSkyldigAt),
          isNotNull(subscriptions.opsagtAfKundeAt))))[0]!.n === 25)
    const en = await laes(daarlige[0]!)
    tjek('  de fejlende er skubbet bagud, ikke opgivet',
      (en?.forsoeg ?? 0) > 0 && en?.skyldig !== null, `forsoeg=${en?.forsoeg}`)
    tjek('  og fejlteksten siger hvad der gik galt',
      (en?.grund ?? '').length > 0, `${en?.grund}`)
  }

  console.log('\n══ N4d · hastværket må ikke vende, når køen har fejlet én gang ══')
  {
    // Rettelsen for N4 — «færrest forsøg først» — kurerer udsultning
    // og INDFØRTE et nyt problem: køen STRAFFEDE den række, den lige
    // havde prioriteret rigtigt. Er fristen anden nøgle, vælges den
    // mest presserende først; fejler kørslen, forlader hun
    // `forsoeg = 0`-laget, og alle uprøvede står foran hende.
    //
    // Målt før rettelsen: hun fik NUL kald i den kørsel, hvor Stripe
    // virkede, og blev nået fire timer senere. Fristen lå 40 min ude.
    await nulstil()
    const lav = async (n: string, minutter: number) => {
      const u = await bruger(n)
      const sub = `sub_${n}_${S}`
      saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false })
      await db.insert(subscriptions).values({
        userId: u, stripeSubscriptionId: sub, stripeCustomerId: `cus_${n}`,
        status: 'active', adgangTil: new Date(Date.now() + minutter * 60_000),
        currentPeriodEnd: new Date(Date.now() + minutter * 60_000),
        opsagtAfKundeAt: new Date(), cancelAtPeriodEnd: false,
      } as never)
      await skyldAfstemning(sub, 'kunden har sagt op')
      return sub
    }
    // ── TALLENE ER VALGT, SÅ PRØVEN KAN BLIVE RØD ───────
    // De UPRØVEDE skal være FLERE end grænsen, ellers slipper hun
    // igennem alligevel: er der plads tilovers efter de uprøvede,
    // sorterer `current_period_end` hende først blandt de prøvede, og
    // så måler prøven ingenting. Med 20 ro-rækker og en grænse på 5
    // er der 16 uprøvede tilbage efter kørsel 1 — mere end nok til at
    // fylde kørsel 2 helt. (Målt: med 40 rækker og grænse 25 forblev
    // prøven grøn, da hasteklassen blev rullet tilbage.)
    const MAKS = 5
    const akut = await lav('N4dAKUT', 40)
    for (let i = 0; i < 20; i++) await lav(`N4dro${i}`, 60 * 24 * 20)

    // Kørsel 1: Stripe er nede, alt fejler — den akutte iblandt.
    const rigtigUpd = (falsk.subscriptions as { update: (...a: unknown[]) => Promise<unknown> })
      .update.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).update =
      async () => { throw new Error('Stripe nede') }
    await afstemSkyldige(OPS, MAKS)
    ;(falsk.subscriptions as Record<string, unknown>).update = rigtigUpd
    const proevet = (await laes(akut))!.forsoeg
    tjek('den akutte blev forsøgt i den kørsel, hvor Stripe var nede',
      (proevet ?? 0) > 0, `forsoeg=${proevet}`)

    // Kørsel 2: Stripe virker igen. Hun SKAL med, selv om 16 uprøvede
    // rækker har færre forsøg end hun har og kan fylde hele kørslen.
    await afstemSkyldige(OPS, MAKS)
    const r = await laes(akut)
    tjek('  …og hun når frem i den kørsel, hvor Stripe virker',
      falsk.abonnementer.get(akut)?.cancel_at_period_end === true,
      `cape=${falsk.abonnementer.get(akut)?.cancel_at_period_end} forsoeg=${r?.forsoeg}`)
    tjek('  skylden er indfriet', r?.skyldig === null)

    // ── OG HASTEKLASSEN MÅ IKKE SELV UDSULTE ────────────
    // En frist, der for længst ER passeret, kan ikke reddes. Lå den i
    // hasteklassen, ville den ligge der for evigt og fortrænge alle
    // andre — samme udsultning, ny indgang. Derfor er klassen smal i
    // BEGGE ender: to timer frem, én time tilbage.
    //
    // Prøven skal have KONKURRENCE for at måle noget: den forældede
    // række alene ville blive taget, uanset hvilken klasse den lå i.
    await nulstil()
    const gammel = await lav('N4dGL', -600)      // frist for 10 timer siden
    await db.update(subscriptions).set({ afstemningForsoeg: 9 })
      .where(eq(subscriptions.stripeSubscriptionId, gammel))
    const friske: string[] = []
    for (let i = 0; i < 3; i++) friske.push(await lav(`N4dfr${i}`, 60 * 24 * 20))

    const foer = falsk.kald.length
    await afstemSkyldige(OPS, 2)
    const kaldPaa = (sub: string) => falsk.kald.slice(foer)
      .filter((k: { args: unknown[] }) => String(k.args[0]) === sub).length
    tjek('  en FOR LÆNGST passeret frist haster ikke — den fortrænger ingen',
      kaldPaa(gammel) === 0, `${kaldPaa(gammel)} kald på den forældede`)
    tjek('  …og pladserne gik til de uprøvede',
      friske.filter((f) => kaldPaa(f) > 0).length === 2,
      `${friske.filter((f) => kaldPaa(f) > 0).length} af 3 friske rørt`)
  }

  console.log('\n══ N4b · tilbagetrækningen giver aldrig op, og den overskrider ikke fristen ══')
  {
    const om = (d: Date) => Math.round((d.getTime() - Date.now()) / 60_000)
    tjek('første to forsøg venter ikke', om(naesteAfstemning(0)) === 0 && om(naesteAfstemning(2)) === 0)
    tjek('  fra tredje forsøg: ti minutter', om(naesteAfstemning(3)) === 10)
    tjek('  loftet er en time, og der ER et loft',
      om(naesteAfstemning(6)) === 60 && om(naesteAfstemning(99)) === 60)
    // Fristen: fornyelsen om 20 minutter. Så må næste forsøg ligge
    // inden for ti minutter, uanset hvor mange gange det har fejlet.
    const frist = new Date(Date.now() + 20 * 60_000)
    tjek('  men aldrig ud over fristen minus ti minutter',
      om(naesteAfstemning(99, frist)) === 10, `${om(naesteAfstemning(99, frist))} min`)
    tjek('  og er fristen allerede nær, prøves der NU',
      om(naesteAfstemning(99, new Date(Date.now() + 60_000))) === 0)
  }

  console.log('\n══ N4c · tællelinjen måles, den udledes ikke af en afkortet liste ══')
  {
    await nulstil()
    for (let i = 0; i < 7; i++) {
      const { sub } = await medPlan(`N4c${i}`, { opsagtAfKundeAt: new Date() })
      await skyldAfstemning(sub, 'vedvarende fejl')
    }
    const rigtigUpd2 = (falsk.subscriptions as { update: (...a: unknown[]) => Promise<unknown> })
      .update.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).update =
      async () => { throw new Error('modelleret vedvarende 500') }
    const u = await afstemSkyldige(OPS, 3)
    ;(falsk.subscriptions as Record<string, unknown>).update = rigtigUpd2
    tjek('«skyldige» er det RIGTIGE total, ikke længden af listen',
      u.skyldige === 7, `skyldige=${u.skyldige}`)
    tjek('  «taget» er grænsen', u.taget === 3, `taget=${u.taget}`)
    tjek('  «fejlede» stemmer med «taget»', u.fejlede === 3 && u.afstemte === 0,
      JSON.stringify(u))
    const venter = (await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions)
      .where(isNotNull(subscriptions.afstemningNaesteAt)))[0]!.n
    tjek('  …og de prøvede har fået en tilbagetrækning', venter === 3, `${venter}`)
  }

  console.log('\n══ D · et DØDT abonnement må ikke love en automatik, der ikke findes ══')
  {
    // Dødsvagten (N2g) rydder skylden, når Stripe selv siger, at
    // abonnementet er lukket. Det er rigtigt for køen — sluttilstanden
    // ER nået. Men `opsigelseUndervejs` havde intet led om, hvorvidt
    // abonnementet stadig lever, så siden blev stående og sagde
    // «Opsigelse undervejs … der kan blive trukket som normalt. Vi
    // prøver automatisk igen», mens køen var tom. Begge sætninger var
    // usande, og knappen stod for evigt.
    //
    // Det er N1's fejl spejlvendt: for LIDT lovet om hendes penge, og
    // en automatik lovet, der ikke fandtes.
    await nulstil()
    const u = await bruger('D')
    const sub = `sub_D_${S}`
    saetAbo(sub, { id: sub, status: 'canceled', cancel_at_period_end: false })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, stripeCustomerId: 'cus_D',
      status: 'active', adgangTil: new Date(Date.now() + 86400_000),
      currentPeriodEnd: new Date(Date.now() + 86400_000),
      opsagtAfKundeAt: new Date(), cancelAtPeriodEnd: false,
    } as never)
    await skyldAfstemning(sub, 'kunden har sagt op')
    await afstemSkyldige(OPS)

    const r = await laes(sub)
    const ui = await abonnementForBruger(u)
    tjek('køen er tom — sluttilstanden ER nået', r?.skyldig === null)
    tjek('  …og så siger siden IKKE «opsigelse undervejs»',
      ui?.opsigelseUndervejs === false, JSON.stringify(ui?.naeste))
    tjek('  den siger, at der ikke kommer flere betalinger',
      ui?.fornyesIkke === true && ui?.naeste.slags === 'fornyes_ikke')
    tjek('  og den viser, at abonnementet ER slut — ikke bare «Opsagt»',
      ui?.afsluttet === true && ui?.status === 'canceled',
      `afsluttet=${ui?.afsluttet} status=${ui?.status}`)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT', ui?.adgangTil !== null)
  }

  // ═════════════════════════════════════════════════════════════
  //  ÉT PRÆDIKAT, TO SPROG — DE OTTE KOMBINATIONER
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ P · JS-prædikatet og SQL-prædikatet er enige om alle otte ══')
  {
    // CLAUDE.md: «Svarer to udtryk på det samme spørgsmål, skal de
    // beregnes ét sted.» De to KAN ikke være ét udtryk — det ene skal
    // køre i basen. Så prøves de mod hinanden, udtømmende. En prøve,
    // der kun tog de tilfælde, koden i dag frembringer, ville gå op
    // per definition.
    await nulstil()
    let uenige = 0
    for (const opsagtAf of [null, new Date()]) {
      for (const stoppet of [null, new Date()]) {
        for (const opsagt of [false, true]) {
          const { sub } = await medPlan(
            `P${opsagtAf ? 1 : 0}${stoppet ? 1 : 0}${opsagt ? 1 : 0}`,
            { opsagtAfKundeAt: opsagtAf, fornyelseStoppetAt: stoppet,
              cancelAtPeriodEnd: opsagt })
          const js = skalFornyelsenStoppes({ opsagtAf, stoppet, opsagt })
          const traf = await db.select({ id: subscriptions.id }).from(subscriptions)
            .where(and(eq(subscriptions.stripeSubscriptionId, sub), ...INGEN_BESLUTNING))
          const sqlSiger = traf.length === 0      // ingen beslutning ⇒ skal IKKE stoppes
          if (js !== sqlSiger) {
            uenige++
            console.log(`     UENIGE opsagtAf=${!!opsagtAf} stoppet=${!!stoppet} `
              + `opsagt=${opsagt}: js=${js} sql=${sqlSiger}`)
          }
        }
      }
    }
    tjek('alle otte kombinationer giver samme svar i JS og i SQL', uenige === 0,
      `${uenige} uenige`)
    tjek('  en manglende kolonne læses som «ingen beslutning», ikke som «stop»',
      skalFornyelsenStoppes({} as never) === false)
  }

  console.log(`\n${fejl === 0 ? '  ALT GROENT' : `  ${fejl} FEJLEDE`}`)
  if (fejl) process.exitCode = 1
}

await koer()
