// ═══════════════════════════════════════════════════════════════
//  Gennemgangens otte fund, prøvet mod rettelserne.
//
//  Alt Stripe-indhold er en KONTROLLERET ERSTATNING uden netværk
//  (scripts/stripefalsk). Den registrerer hvert kald med sine
//  argumenter, så prøven kan måle HVAD der blev sendt — ikke bare at
//  en funktion blev ramt. Den kan ikke bevise, at Stripe ACCEPTERER
//  argumenterne; det kræver sandbox. Se rapportens «Manglende
//  verifikation».
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, faserErRigtige, laegManglendePlaner, laegPlan, type Haendelse } from '../lib/webhook'
import { abonnementForBruger, sigOpFor } from '../lib/abonnement'
import { indsaetStripe } from '../lib/stripe'
import { betalingsRetur } from '../lib/retur'
import { lavFalsk, type Falsk } from './stripefalsk/index'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}
const OPS = { hemmelighed: 'sk_test_x', webhookHemmelighed: 'whsec_x',
  introPrisId: 'price_intro', normalPrisId: 'price_normal' }

// Opsaetningen i miljoeet — de samme FALSKE vaerdier. `opsaetning()`
// laeser dem, og uden dem falder de konfigurerede kodeveje tilbage til
// «stripe_mangler», saa proeven ville maale den forkerte gren.
// Ingen af dem er en rigtig noegle, og der er ingen forbindelse ud af
// processen: `indsaetStripe(falsk)` staar mellem koden og netvaerket.
process.env.STRIPE_SECRET_KEY = OPS.hemmelighed
process.env.STRIPE_WEBHOOK_SECRET = OPS.webhookHemmelighed
process.env.STRIPE_PRIS_INTRO = OPS.introPrisId
process.env.STRIPE_PRIS_NORMAL = OPS.normalPrisId
let falsk: Falsk & Record<string, unknown>
const S = Date.now()
const nu = () => Math.floor(Date.now() / 1000)
const h = (type: string, obj: Record<string, unknown>, created?: number): Haendelse =>
  ({ id: `evt_${randomUUID()}`, type, created: created ?? nu(), data: { object: obj } })

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`rb${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `rb${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}
const faktura = (sub: string, slut: number, pris = OPS.introPrisId, kunde?: string) =>
  h('invoice.paid', {
    subscription: sub, ...(kunde ? { customer: kunde } : {}),
    lines: { data: [{ period: { start: nu(), end: slut }, pricing: { price_details: { price: pris } } }] },
  })
const raekke = (sub: string) => db.select({
  adgang: subscriptions.adgangTil, status: subscriptions.status,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  planForsoeg: subscriptions.planForsoeg,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═══ FUND 1a · OMVENDT RAEKKEFOELGE ═══════════════════════
  console.log('\n══ 1a · invoice.paid FOER checkout.session.completed ══')
  {
    const u = await bruger('1a'); const sub = `sub_${randomUUID()}`
    const kunde = `cus_1a_${S}`
    await db.update(users).set({ stripeCustomerId: kunde }).where(eq(users.id, u))
    const slut = nu() + 86400
    const f = faktura(sub, slut, OPS.introPrisId, kunde)
    const u1 = await behandl(f, OPS)
    const r1 = await raekke(sub)
    tjek('fakturaen opretter selv raekken ud fra kunden', u1 === 'behandlet', `udfald=${u1}`)
    tjek('  og adgangen er givet', !!r1?.adgang)
    const u2 = await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }), OPS)
    tjek('  den sene checkout-haendelse taber ikke adgangen',
      (await raekke(sub))?.adgang?.getTime() === r1?.adgang?.getTime(), `udfald=${u2}`)
  }

  // Ukendt kunde → AFVENTER, ikke faerdigbehandlet
  console.log('\n══ 1a2 · ukendt kunde: haendelsen maa ikke markeres faerdig ══')
  {
    const sub = `sub_${randomUUID()}`
    const f = faktura(sub, nu() + 86400, OPS.introPrisId, `cus_ukendt_${S}`)
    const u1 = await behandl(f, OPS)
    tjek('svarer AFVENTER', u1 === 'afventer', `udfald=${u1}`)
    const [e] = await db.select({ b: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  og er IKKE markeret faerdig', e?.b === null)
    // Nu kommer forudsaetningen, og genleveringen virker.
    const u = await bruger('1a2')
    await db.update(users).set({ stripeCustomerId: `cus_ukendt_${S}` }).where(eq(users.id, u))
    const u2 = await behandl(f, OPS)
    tjek('  genlevering efter forudsaetningen giver adgang', u2 === 'behandlet', `udfald=${u2}`)
    tjek('  adgangen er sat', !!(await raekke(sub))?.adgang)
  }

  // ═══ FUND 1b · NYERE UPDATED BLOKERER GYLDIG BETALING ═════
  console.log('\n══ 1b · nyere subscription.updated foerst ══')
  {
    const u = await bruger('1b'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_1b_${S}` }), OPS)
    await behandl(h('customer.subscription.updated', { id: sub, status: 'active' }, nu() + 10), OPS)
    const slut = nu() + 86400
    const u2 = await behandl(faktura(sub, slut), OPS)
    const r = await raekke(sub)
    tjek('den aeldre, gyldige betaling gaar igennem', u2 === 'behandlet', `udfald=${u2}`)
    tjek('  adgangen er sat til fakturaens periodeslut',
      !!r?.adgang && Math.abs(r.adgang.getTime() - slut * 1000) < 2000)
  }

  // ═══ MONOTONI ════════════════════════════════════════════
  console.log('\n══ 1c · adgangen flyttes kun FREM ══')
  {
    const u = await bruger('1c'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_1c_${S}` }), OPS)
    const langt = nu() + 28 * 86400
    await behandl(faktura(sub, langt, OPS.normalPrisId), OPS)
    const foer = (await raekke(sub))!.adgang!
    const u2 = await behandl(faktura(sub, nu() + 3600), OPS)
    const efter = (await raekke(sub))!.adgang!
    tjek('en kortere, sent ankommen periode forkorter ikke adgangen',
      efter.getTime() === foer.getTime() && u2 === 'forael', `udfald=${u2}`)
  }

  // ═══ SAMTIDIGHED ═════════════════════════════════════════
  console.log('\n══ 1d · to samtidige behandlere af samme haendelse ══')
  {
    const u = await bruger('1d'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_1d_${S}` }), OPS)
    const f = faktura(sub, nu() + 86400)
    const [a, b] = await Promise.all([behandl(f, OPS), behandl(f, OPS)])
    const udfald = [a, b].sort().join('+')
    tjek('kun ÉN behandler faar kravet',
      [a, b].filter((x) => x === 'behandlet').length === 1
      && [a, b].some((x) => x === 'i_gang' || x === 'gentagelse'), udfald)
    const [e] = await db.select({ n: stripeEvents.forsoeg })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  og forsoegstaelleren staar paa 1', e?.n === 1, `forsoeg=${e?.n}`)
  }

  // ═══ FEJL EFTER DELVIS BEHANDLING ════════════════════════
  console.log('\n══ 1e · fejl midt i behandlingen frigiver kravet ══')
  {
    const u = await bruger('1e'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_1e_${S}` }), OPS)
    const f = faktura(sub, nu() + 86400)
    // Faa `betalt()` til at kaste: fjern tabellen et oejeblik er for
    // grimt; i stedet gives en haendelse, hvis behandler kaster.
    const daarlig = h('customer.subscription.updated', { id: sub, status: 'ugyldig_status' })
    let kastede = false
    try { await behandl(daarlig, OPS) } catch { kastede = true }
    tjek('en kastende behandler boblede op', kastede)
    const [e] = await db.select({ b: stripeEvents.behandletAt, p: stripeEvents.paabegyndtAt })
      .from(stripeEvents).where(eq(stripeEvents.id, daarlig.id))
    tjek('  haendelsen er hverken faerdig eller laast', e?.b === null && e?.p === null)
    void f
  }

  // ═══ FUND 2 · PLANLAEGNINGEN ═════════════════════════════
  console.log('\n══ 2 · planlaegningen er vedvarende og genkoerbar ══')
  {
    falsk.nulstil()
    const u = await bruger('2'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_2_${S}` }), OPS)
    falsk.fejlPaa.add('subscriptionSchedules.create')
    await behandl(faktura(sub, nu() + 86400), OPS)
    const r1 = await raekke(sub)
    tjek('adgangen er givet trods planfejl', !!r1?.adgang)
    tjek('  skylden er bogfoert som «mangler»', r1?.planStatus === 'mangler',
      `planStatus=${r1?.planStatus} forsoeg=${r1?.planForsoeg}`)
    // Genkoerslen retter det.
    const r = await laegPlan(sub, OPS)
    const r2 = await raekke(sub)
    tjek('genkoerslen lægger planen', r === 'konfigureret', `svar=${r}`)
    tjek('  og den er bekraeftet konfigureret', r2?.planStatus === 'konfigureret')
    // DE FAKTISKE ARGUMENTER til update.
    const kald = falsk.sidste('subscriptionSchedules.update')
    const faser = (kald?.args[1] as { phases?: { items?: { price?: string }[] }[] })?.phases
    tjek('  fase 1 sendes med INTROprisen', faser?.[0]?.items?.[0]?.price === OPS.introPrisId)
    tjek('  fase 2 sendes med NORMALprisen', faser?.[1]?.items?.[0]?.price === OPS.normalPrisId)
    tjek('  fase 1 baerer Stripes EGNE tidspunkter',
      (faser?.[0] as unknown as { start_date?: number })?.start_date === 1_700_000_000)
    tjek('  fase 2 har INGEN duration (loeber videre)',
      (faser?.[1] as unknown as { duration?: unknown })?.duration === undefined)
    tjek('  fase 1 har duration ét doegn — ikke det fjernede iterations',
      JSON.stringify(faser?.[0]).includes('"end_date"') && !JSON.stringify(faser).includes('iterations'))
  }

  console.log('\n══ 2b · fejl EFTER create, FOER konfiguration ══')
  {
    falsk.nulstil()
    const u = await bruger('2b'); const sub = `sub_${randomUUID()}`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: `cus_2b_${S}` }), OPS)
    falsk.fejlPaa.add('subscriptionSchedules.update')
    await behandl(faktura(sub, nu() + 86400), OPS)
    const r1 = await raekke(sub)
    tjek('planen er bogfoert som OPRETTET, ikke konfigureret',
      r1?.planStatus === 'oprettet' && !!r1.plan, `status=${r1?.planStatus} plan=${r1?.plan}`)
    const r = await laegPlan(sub, OPS)
    tjek('genkoerslen opretter IKKE en plan til',
      falsk.antal('subscriptionSchedules.create') === 1,
      `create kaldt ${falsk.antal('subscriptionSchedules.create')} gang(e)`)
    tjek('  og konfigurerer den eksisterende', r === 'konfigureret')
  }

  console.log('\n══ 2c · et schedule-id alene beviser ikke rigtige faser ══')
  {
    tjek('to faser med rigtige priser godkendes',
      faserErRigtige({ phases: [{ items: [{ price: OPS.introPrisId }] },
        { items: [{ price: OPS.normalPrisId }] }] }, OPS))
    tjek('kun én fase afvises',
      !faserErRigtige({ phases: [{ items: [{ price: OPS.introPrisId }] }] }, OPS))
    tjek('forkert pris i fase 2 afvises',
      !faserErRigtige({ phases: [{ items: [{ price: OPS.introPrisId }] },
        { items: [{ price: OPS.introPrisId }] }] }, OPS))
    tjek('ingen plan afvises', !faserErRigtige(null, OPS))
  }

  console.log('\n══ 2d · driftstilsynet tager skyldige planer op ══')
  {
    falsk.nulstil()
    const r = await laegManglendePlaner(OPS)
    tjek('manglende planer forsoeges igen', r.forsoegt >= 0,
      `forsoegt=${r.forsoegt} konfigureret=${r.konfigureret} fejlet=${r.fejlet}`)
    const [rest] = await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions)
      .where(and(sql`${subscriptions.planStatus} is not null`,
        sql`${subscriptions.planStatus} <> 'konfigureret'`))
    tjek('  ingen skyldige planer tilbage', rest!.n === 0, `${rest!.n} tilbage`)
  }

  // ═══ FUND 3 · ÉT KOEBSFORLOEB ════════════════════════════
  console.log('\n══ 3 · én aaben checkout pr. konto ══')
  {
    const u = await bruger('3')
    await db.insert(checkoutForsoeg).values({
      userId: u, stripeSessionId: `cs_a_${S}`, prisId: OPS.introPrisId,
      udloeberAt: new Date(Date.now() + 1800000),
    })
    let to = false
    try {
      await db.insert(checkoutForsoeg).values({
        userId: u, stripeSessionId: `cs_b_${S}`, prisId: OPS.introPrisId,
        udloeberAt: new Date(Date.now() + 1800000),
      })
      to = true
    } catch { /* ventet */ }
    tjek('to AABNE forloeb paa samme konto afvises af basen', !to,
      'vagten ligger i skemaet, ikke kun i koden')
    await db.update(checkoutForsoeg).set({ status: 'udloebet' })
      .where(eq(checkoutForsoeg.userId, u))
    let efter = false
    try {
      await db.insert(checkoutForsoeg).values({
        userId: u, stripeSessionId: `cs_c_${S}`, prisId: OPS.introPrisId,
        udloeberAt: new Date(Date.now() + 1800000),
      })
      efter = true
    } catch { /* ikke ventet */ }
    tjek('  men et NYT forloeb kan laves, naar det gamle er lukket', efter)
  }

  // ═══ FUND 4 · DET AKTUELLE ABONNEMENT ════════════════════
  console.log('\n══ 4 · opsigelse → udloeb → nyt koeb ══')
  {
    const u = await bruger('4')
    // Historikken: opsagt og udloebet for en uge siden.
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: `sub_gl_${randomUUID()}`, status: 'canceled',
      adgangTil: new Date(Date.now() - 7 * 86400000), stripePriceId: OPS.introPrisId,
      cancelAtPeriodEnd: true, oprettetAt: new Date(Date.now() - 30 * 86400000),
    })
    const foerNyt = await abonnementForBruger(u)
    tjek('uden et levende vises det NYESTE (her historikken)',
      foerNyt?.status === 'canceled')
    // Det nye koeb.
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: `sub_ny_${randomUUID()}`, status: 'active',
      adgangTil: new Date(Date.now() + 28 * 86400000), stripePriceId: OPS.normalPrisId,
      planStatus: 'konfigureret', oprettetAt: new Date(),
    })
    const a = await abonnementForBruger(u)
    tjek('det LEVENDE abonnement vises — ikke historikken',
      a?.status === 'active', `status=${a?.status}`)
    tjek('  naeste beloeb er normalprisen',
      a?.naeste.slags === 'beloeb' && a.naeste.oere === 34900,
      JSON.stringify(a?.naeste))
  }

  console.log('\n══ 4b · «fornyes ikke» og «kan ikke bekraeftes» er to ting ══')
  {
    const u = await bruger('4b')
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: `sub_${randomUUID()}`, status: 'active',
      adgangTil: new Date(Date.now() + 86400000), stripePriceId: OPS.introPrisId,
      planStatus: 'mangler', oprettetAt: new Date(),
    })
    const a = await abonnementForBruger(u)
    tjek('introfase UDEN bekraeftet plan: naeste betaling er UKENDT',
      a?.naeste.slags === 'ukendt', JSON.stringify(a?.naeste))
    tjek('  og det er IKKE et loefte om ingen betaling',
      a?.naeste.slags !== 'fornyes_ikke')

    const u2 = await bruger('4b2')
    await db.insert(subscriptions).values({
      userId: u2, stripeSubscriptionId: `sub_${randomUUID()}`, status: 'active',
      adgangTil: new Date(Date.now() + 86400000), stripePriceId: OPS.introPrisId,
      planStatus: 'konfigureret', oprettetAt: new Date(),
    })
    const b = await abonnementForBruger(u2)
    tjek('introfase MED bekraeftet plan: naeste er 349 kr.',
      b?.naeste.slags === 'beloeb' && b.naeste.oere === 34900, JSON.stringify(b?.naeste))

    const u3 = await bruger('4b3')
    await db.insert(subscriptions).values({
      userId: u3, stripeSubscriptionId: `sub_${randomUUID()}`, status: 'active',
      adgangTil: new Date(Date.now() + 86400000), stripePriceId: OPS.normalPrisId,
      cancelAtPeriodEnd: true, planStatus: 'konfigureret', oprettetAt: new Date(),
    })
    const c = await abonnementForBruger(u3)
    tjek('opsagt: «fornyes ikke»', c?.naeste.slags === 'fornyes_ikke')
  }

  // ═══ FUND 6 · OPSIGELSE MED AKTIV PLAN ═══════════════════
  console.log('\n══ 6 · opsigelse naar en plan styrer abonnementet ══')
  {
    falsk.nulstil()
    const u = await bruger('6'); const sub = `sub_${randomUUID()}`
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil: new Date(Date.now() + 86400000), stripeScheduleId: `sub_sched_${S}`,
      planStatus: 'konfigureret', stripePriceId: OPS.introPrisId, oprettetAt: new Date(),
    })
    const svar = await sigOpFor(u)
    tjek('opsigelsen gaar igennem', svar.ok, JSON.stringify(svar))
    tjek('  planen SLIPPES foerst (release, ikke cancel)',
      falsk.antal('subscriptionSchedules.release') === 1
      && falsk.antal('subscriptionSchedules.cancel') === 0,
      'cancel ville tage en periode, kunden har betalt for')
    const k = falsk.sidste('subscriptions.update')
    tjek('  og derefter saettes cancel_at_period_end paa abonnementet',
      (k?.args[1] as { cancel_at_period_end?: boolean })?.cancel_at_period_end === true)
    tjek('  raekkefoelgen er release FOER update',
      falsk.kald.findIndex((x) => x.metode === 'subscriptionSchedules.release')
      < falsk.kald.findIndex((x) => x.metode === 'subscriptions.update'))
    const r = await raekke(sub)
    tjek('  adgangen er UROERT — den betalte periode loeber ud', !!r?.adgang)
    tjek('  og planen er ryddet af raekken', !r?.plan)
  }

  console.log('\n══ 6b · opsigelse UDEN plan roerer ingen plan ══')
  {
    falsk.nulstil()
    const u = await bruger('6b'); const sub = `sub_${randomUUID()}`
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil: new Date(Date.now() + 86400000), oprettetAt: new Date(),
    })
    const svar = await sigOpFor(u)
    tjek('opsigelsen gaar igennem', svar.ok)
    tjek('  ingen plan slippes', falsk.antal('subscriptionSchedules.release') === 0)
  }

  // ═══ FUND 5 · RETURVEJEN ═════════════════════════════════
  console.log('\n══ 5 · returvejen valideres ét sted ══')
  {
    const id = '11111111-2222-4333-8444-555555555555'
    const gode: [string, string][] = [
      [`/bolig/${id}`, 'bolig'], [`/go/${id}`, 'kildelink'],
      ['/', 'forsiden'], ['/lejeboliger/koebenhavn-s', 'omraadeside'],
      ['/min-side', 'min side'],
    ]
    for (const [v, navn] of gode) tjek(`  ${navn} accepteres`, betalingsRetur(v) === v)
    const onde: [string, string][] = [
      ['/\\fremmed.invalid/phishing', 'skraastreg + backslash — FUND 5'],
      ['//fremmed.invalid', 'protokolrelativ'],
      ['https://fremmed.invalid', 'absolut URL'],
      ['/%2F%2Ffremmed.invalid', 'kodet dobbeltskraastreg'],
      ['/%5Cfremmed.invalid', 'kodet backslash'],
      ['/bolig/../../etc', 'sti-traversering'],
      ['/udlejer/boliger', 'ikke paa listen'],
      ['/bolig/ikke-et-uuid', 'ugyldigt id'],
      ['', 'tom'],
    ]
    for (const [v, navn] of onde) tjek(`  afvises: ${navn}`, betalingsRetur(v) === null, JSON.stringify(v))
  }
}

await koer()
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
