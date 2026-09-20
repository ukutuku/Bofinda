// ═══════════════════════════════════════════════════════════════
//  Tredje gennemgangs seks fund, prøvet mod rettelserne.
//
//  Gennemgangens egen probe kører med en in-memory SQL-adapter uden
//  transaktionsisolering. Den er god til kontrolflow og dårlig til alt
//  andet, og den siger det selv. Denne prøve kører de SAMME forløb mod
//  PGlite — rigtige migrationer, rigtige indekser, rigtige enums — og
//  gennem de FAKTISKE indgange:
//
//    HTTP    `POST` fra app/api/stripe/route.ts
//    Køb     `startKoebFor()` fra lib/abonnement.ts
//    Drift   `betalingstilsyn()` og `saetTilstand()`
//
//  Kapløbene ligger i scripts/test-betaling-kaploeb.ts, som kører mod
//  rigtig, isoleret PostgreSQL — PGlite er én forbindelse og kan ikke
//  måle dem.
//
//  Stripe er scripts/stripefalsk. Den skelner nu to slags fejl:
//  afvist FØR udførelse (intet gemt) og 500 med UKENDT udfald (gemt
//  under nøglen). En grøn attrap er stadig ikke en Stripe-verifikation.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, afstemGennemfoerteKoeb, naesteForsoeg,
  type Haendelse } from '../lib/webhook'
import { startKoebFor, lukAlleAabneKoeb } from '../lib/abonnement'
import { saetTilstand } from '../lib/driftskift'
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
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r3${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r3${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}
const faktura = (sub: string, slut: number, pris = OPS.introPrisId,
                 kunde?: string, created?: number, forsoegId?: string) =>
  h('invoice.paid', {
    subscription: sub, ...(kunde ? { customer: kunde } : {}),
    ...(forsoegId
      ? { parent: { subscription_details: { metadata: { bofinda_forsoeg: forsoegId } } } }
      : {}),
    lines: { data: [{ period: { start: nu(), end: slut }, pricing: { price_details: { price: pris } } }] },
  }, created)
const forsoegFor = (u: string) => db.select({
  id: checkoutForsoeg.id, status: checkoutForsoeg.status,
  sid: checkoutForsoeg.stripeSessionId, sub: checkoutForsoeg.stripeSubscriptionId,
  betaling: checkoutForsoeg.stripePaymentStatus, afstemt: checkoutForsoeg.afstemtAt,
}).from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
const abo = (sub: string) => db.select({
  status: subscriptions.status, adgang: subscriptions.adgangTil,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  opsagt: subscriptions.cancelAtPeriodEnd,
  stoppet: subscriptions.fornyelseStoppetAt, grund: subscriptions.fornyelseStoppetGrund,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

const post = (haendelse: Haendelse) => POST(new Request('https://proeve.invalid/api/stripe', {
  method: 'POST',
  headers: { 'stripe-signature': 't=1,v1=ligegyldig-attrappen-parser-kun',
             'content-type': 'application/json' },
  body: JSON.stringify(haendelse),
}))

/** Sessionen gennemføres hos Stripe, uden at webhooken er ankommet. */
function gennemfoerHosStripe(sid: string, sub = `sub_gf_${randomUUID()}`) {
  const s = falsk.sessioner.get(sid)!
  s.status = 'complete'
  s.subscription = sub
  s.payment_status = 'paid'
  falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
  return sub
}

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═══ FUND 1 · GENNEMFØRT CHECKOUT ════════════════════════
  console.log('\n══ 1 · en gennemført session åbner ikke for et nyt køb ══')
  {
    falsk.nulstil()
    const u = await bruger('1')
    const a = await startKoebFor(u, '/')
    tjek('første køb lykkes', a.ok, JSON.stringify(a))
    const sid = (await forsoegFor(u))[0]!.sid!
    const sub = gennemfoerHosStripe(sid)

    const b = await startKoebFor(u, '/')
    tjek('andet køb AFVISES', !b.ok && b.fejl === 'koeb_gennemfoert', JSON.stringify(b))
    tjek('  og der blev IKKE oprettet en session til',
      falsk.udfoerte('checkout.sessions.create') === 1,
      `${falsk.udfoerte('checkout.sessions.create')} oprettelser`)
    const [r] = await forsoegFor(u)
    tjek('  forsøget står som GENNEMFOERT, ikke betalt eller udløbet',
      r?.status === 'gennemfoert', `status=${r?.status}`)
    tjek('  og det er bundet til abonnementet, sessionen oplyste',
      r?.sub === sub, `sub=${r?.sub}`)
    tjek('  sessionens ANDEN akse er gemt', r?.betaling === 'paid',
      `payment_status=${r?.betaling}`)
    tjek('  men INGEN adgang er givet — det kræver en betalt faktura',
      (await abo(sub)) === undefined)
  }

  console.log('\n══ 1b · og den spærrer gratis-skiftet ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('1badm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('1b')
    await startKoebFor(u, '/')
    const sid = (await forsoegFor(u))[0]!.sid!
    gennemfoerHosStripe(sid)

    const s = await saetTilstand('gratis', admin)
    tjek('skiftet AFVISES med sin egen grund',
      !s.ok && s.fejl === 'gennemfoerte_koeb', JSON.stringify(s))
    tjek('  og teksten siger, at der SANDSYNLIGVIS er betalt',
      !s.ok && s.fejl === 'gennemfoerte_koeb' && s.forklaring.includes('GENNEMFØRT'))
    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  tilstanden er UROERT', d?.t === 'betaling', `tilstand=${d?.t}`)
    tjek('  og vi opsagde hende IKKE selv',
      falsk.antal('subscriptions.cancel') === 0)
    tjek('  sessionen blev heller ikke udløbet',
      falsk.antal('checkout.sessions.expire') === 0)
  }

  console.log('\n══ 1c · afstemningen opløser den — og kun den ══')
  {
    const u = (await db.select({ id: checkoutForsoeg.userId }).from(checkoutForsoeg)
      .where(eq(checkoutForsoeg.status, 'gennemfoert')).limit(1))[0]!.id
    const linjer = await betalingstilsyn(OPS)
    const [r] = await forsoegFor(u)
    tjek('tilsynet afstemmer det gennemførte køb', r?.status === 'betalt',
      `status=${r?.status} · ${linjer.join(' | ')}`)
    tjek('  og afstemningstidspunktet står på rækken', !!r?.afstemt)
    tjek('  abonnementet er bogført gennem samme vej som webhooken',
      !!(await abo(r!.sub!)), `sub=${r?.sub}`)
    tjek('  men stadig UDEN adgang — ingen faktura er set',
      (await abo(r!.sub!))?.adgang === null)
  }

  console.log('\n══ 1d · sweepet lukker ikke en række, Stripe kender ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg)
    const u = await bruger('1d')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    // Reservationen "udløber" lokalt, men sessionen er GENNEMFOERT.
    gennemfoerHosStripe(r0!.sid!)
    await db.update(checkoutForsoeg).set({ udloeberAt: new Date(Date.now() - 60000) })
      .where(eq(checkoutForsoeg.id, r0!.id))
    const b = await startKoebFor(u, '/')
    const [r1] = await forsoegFor(u)
    tjek('et lokalt udløb skjuler ikke et gennemført køb',
      !b.ok && b.fejl === 'koeb_gennemfoert', JSON.stringify(b))
    tjek('  rækken er gennemfoert, ikke udloebet', r1?.status === 'gennemfoert',
      `status=${r1?.status}`)
  }

  // ═══ FUND 2 · SKIFT UNDER IGANGVÆRENDE OPRETTELSE ════════
  console.log('\n══ 2 · et tomt sessions-id er ikke bevis for, at intet kører ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('2adm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('2')

    // Købet holdes inde i Stripe-kaldet. Reservationen er committet,
    // sessions-id'et er endnu ikke skrevet.
    let slip: () => void = () => {}
    const iStripe = new Promise<void>((r) => { slip = r })
    let naaet: () => void = () => {}
    const erNaaet = new Promise<void>((r) => { naaet = r })
    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => { naaet(); await iStripe; return rigtig(p, o) }

    const koeb = startKoebFor(u, '/')
    await erNaaet
    const [r0] = await forsoegFor(u)
    tjek('reservationen er committet UDEN sessions-id',
      r0?.status === 'aaben' && r0.sid === null, JSON.stringify(r0))

    const s = await saetTilstand('gratis', admin)
    tjek('skiftet AFVISES — ikke meldt færdigt',
      !s.ok && s.fejl === 'aabne_koeb', JSON.stringify(s))
    tjek('  og forklaringen siger, at en side er ved at blive oprettet',
      !s.ok && s.fejl === 'aabne_koeb' && s.forklaring.includes('ved at blive oprettet'))
    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  tilstanden er UROERT', d?.t === 'betaling', `tilstand=${d?.t}`)
    const [r1] = await forsoegFor(u)
    tjek('  reservationen blev IKKE markeret afbrudt', r1?.status === 'aaben',
      `status=${r1?.status}`)

    // Nu svarer Stripe, og oprydningen fejler.
    falsk.fejlPaa.add('checkout.sessions.expire')
    slip()
    const k = await koeb
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig
    tjek('købet lykkes — skiftet vandt jo ikke', k.ok, JSON.stringify(k))
    const [d2] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  ALDRIG gratis tilstand OG en betalbar session',
      !(d2?.t === 'gratis'
        && [...falsk.sessioner.values()].some((x) => x.status === 'open')),
      `tilstand=${d2?.t}`)
  }

  console.log('\n══ 2b · en sessionsløs reservation efter udløb er harmløs ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg)
    const admin = (await db.select({ id: users.id }).from(users)
      .where(eq(users.role, 'admin')).limit(1))[0]!.id
    const u = await bruger('2b')
    await db.insert(checkoutForsoeg).values({
      userId: u, prisId: OPS.introPrisId,
      // Sessionens `expires_at` ER dette tal. Er det passeret, kan en
      // session, der måtte findes, heller ikke betales.
      udloeberAt: new Date(Date.now() - 60000),
    })
    const r = await lukAlleAabneKoeb()
    tjek('den tælles som LUKKET, ikke uafklaret',
      r.lukkede === 1 && r.uafklarede === 0, JSON.stringify(r))
    const s = await saetTilstand('gratis', admin, 'efter udløb')
    tjek('  og gratis-skiftet går igennem', s.ok, JSON.stringify(s))
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
  }

  // ═══ FUND 3 · FAKTURAENS BINDING ═════════════════════════
  console.log('\n══ 3 · en gammel faktura lukker ikke en fremmed reservation ══')
  {
    // Sessionerne fra de tidligere afsnit skal vaek: de ville taelle
    // med i «hvor mange betalbare sider findes der» og goere maalingen
    // til noget andet end det, afsnittet handler om.
    falsk.nulstil(); falsk.sessioner.clear()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('3')
    const kunde = `cus_3_${S}`
    await db.update(users).set({ stripeCustomerId: kunde, introBrugtAt: new Date() })
      .where(eq(users.id, u))
    // Et gammelt, opsagt abonnement på SAMME kunde.
    const gammel = `sub_gammel_${randomUUID()}`
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: gammel, stripeCustomerId: kunde,
      status: 'canceled', stripeOpdateretAt: new Date(Date.now() - 86400000),
      oprettetAt: new Date(Date.now() - 172800000),
    })

    const a = await startKoebFor(u, '/')
    tjek('et nyt køb lykkes', a.ok, JSON.stringify(a))
    const [r0] = await forsoegFor(u)

    // Den forsinkede faktura fra det GAMLE abonnement.
    await post(faktura(gammel, nu() + 28 * 86400, OPS.normalPrisId, kunde))
    const [r1] = await forsoegFor(u)
    tjek('den NYE reservation er urørt', r1?.status === 'aaben', `status=${r1?.status}`)
    tjek('  og den gamle status er stadig canceled',
      (await abo(gammel))?.status === 'canceled')

    const b = await startKoebFor(u, '/')
    tjek('næste køb giver SAMME betalingsside', b.ok && a.ok && b.url === a.url,
      JSON.stringify(b))
    tjek('  så der er kun ÉN betalbar side',
      [...falsk.sessioner.values()].filter((x) => x.status === 'open').length === 1)

    // Og fakturaen for HENDES eget køb lukker det rigtige forsøg.
    const nyt = `sub_nyt_${randomUUID()}`
    await post(faktura(nyt, nu() + 86400, OPS.introPrisId, kunde, undefined, r0!.id))
    const [r2] = await forsoegFor(u)
    tjek('hendes EGEN faktura lukker forsøget — bundet på metadataen',
      r2?.status === 'betalt', `status=${r2?.status}`)
  }

  console.log('\n══ 3b · kan bindingen ikke afgøres, lukkes INTET ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('3b')
    const kunde = `cus_3b_${S}`
    await db.update(users).set({ stripeCustomerId: kunde, introBrugtAt: new Date() })
      .where(eq(users.id, u))
    await startKoebFor(u, '/')
    // En faktura uden metadata og uden kendt abonnement.
    await post(faktura(`sub_fremmed_${randomUUID()}`, nu() + 86400,
      OPS.normalPrisId, kunde))
    const [r] = await forsoegFor(u)
    tjek('reservationen er urørt', r?.status === 'aaben', `status=${r?.status}`)
  }

  // ═══ FUND 4 · GEMT 500 OG FORNYELSESBESKYTTELSEN ═════════
  console.log('\n══ 4 · et gemt 500 må ikke udtømme forsøgene ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('4')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_4_${S}`
    await post(h('checkout.session.completed',
      { id: `cs_4_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))
    // Stripe gemmer sin 500 under nøglen: hver afspilning kaster den samme.
    falsk.gemtFejlPaa.add('subscriptionSchedules.create')
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
    const r1 = await abo(sub)
    tjek('adgangen er givet trods planfejl', !!r1?.adgang)
    tjek('  planen skyldes', r1?.planStatus !== 'konfigureret', `plan=${r1?.planStatus}`)

    // Næste forsøg AFSTEMMER først: findes planen hos Stripe?
    const foer = falsk.antal('subscriptions.retrieve')
    await betalingstilsyn(OPS)
    tjek('tilsynet afstemmer abonnementet før det opretter igen',
      falsk.antal('subscriptions.retrieve') > foer,
      `${falsk.antal('subscriptions.retrieve') - foer} opslag`)
    const r2 = await abo(sub)
    tjek('  og planen bliver lagt, fordi nøglen ikke er den samme brændte',
      r2?.planStatus === 'konfigureret', `plan=${r2?.planStatus}`)
  }

  console.log('\n══ 4b · ADOPTÉR en plan, det gemte 500 skjulte ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('4b')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_4b_${S}`
    await post(h('checkout.session.completed',
      { id: `cs_4b_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))

    // Oprettelsen LYKKEDES hos Stripe, men svaret gik tabt: planen
    // findes, abonnementet peger på den, og vores base ved det ikke.
    const planId = `sub_sched_skjult_${S}`
    falsk.planer.set(planId, {
      id: planId, konfigureret: false, status: 'active',
      phases: [{ start_date: 1_700_000_000, end_date: 1_700_086_400,
                 items: [{ price: 'intro', quantity: 1 }] }],
    })
    falsk.abonnementer.set(sub, { id: sub, schedule: planId } as never)
    falsk.gemtFejlPaa.add('subscriptionSchedules.create')
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
    await betalingstilsyn(OPS)

    const r = await abo(sub)
    tjek('den SKJULTE plan blev adopteret, ikke duplikeret',
      r?.plan === planId, `plan=${r?.plan}`)
    tjek('  og der blev IKKE oprettet en plan nummer to',
      falsk.udfoerte('subscriptionSchedules.create') === 0,
      `${falsk.udfoerte('subscriptionSchedules.create')} oprettelser`)
    tjek('  planen er konfigureret', r?.planStatus === 'konfigureret')
  }

  console.log('\n══ 4c · en plan, der ikke kan bekræftes, STOPPER fornyelsen ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('4c')
    const sub = `sub_${randomUUID()}`
    const adgangTil = new Date(Date.now() + 30 * 60_000)   // fornyelse om 30 min
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil, stripeScheduleId: `sub_sched_4c_${S}`,
      planStatus: 'oprettet', planForsoeg: 1, planFejl: 'modelleret 500',
      oprettetAt: new Date(),
    })
    const linjer = await betalingstilsyn(OPS)
    tjek('fornyelsen STOPPES, fordi den er nær — ikke fordi forsøgene er brugt',
      linjer.some((l) => l.includes('fornyelsen er STOPPET') && l.includes(sub)),
      JSON.stringify(linjer.filter((l) => l.includes('STOPPET'))))
    tjek('  planen blev SLUPPET først (release), aldrig cancel',
      falsk.antal('subscriptionSchedules.release') >= 1
      && falsk.antal('subscriptions.cancel') === 0)
    const k = falsk.sidste('subscriptions.update')
    tjek('  og cancel_at_period_end blev sat hos Stripe',
      (k?.args[1] as { cancel_at_period_end?: boolean })?.cancel_at_period_end === true)
    const r = await abo(sub)
    tjek('  KUNDENS BETALTE ADGANG ER UROERT',
      r?.adgang?.getTime() === adgangTil.getTime())
    tjek('  og det står i basen med sin grund', !!r?.stoppet && !!r.grund)
  }

  // ═══ FUND 5 · SAMME SEKUND ═══════════════════════════════
  console.log('\n══ 5 · samme sekund genopliver ikke en terminal status ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('5')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_5_${S}`
    const t0 = nu()
    await post(h('checkout.session.completed',
      { id: `cs_5_${S}`, subscription: sub, client_reference_id: u, customer: kunde }, t0))
    await post(h('customer.subscription.deleted',
      { id: sub, status: 'canceled', cancel_at_period_end: false }, t0))
    tjek('status er canceled', (await abo(sub))?.status === 'canceled')
    await post(faktura(sub, t0 + 86400, OPS.introPrisId, kunde, t0))
    const r = await abo(sub)
    tjek('en faktura med SAMME sekund skriver ikke active tilbage',
      r?.status === 'canceled', `status=${r?.status}`)
    tjek('  men den betalte adgang ER registreret', !!r?.adgang,
      `adgang=${r?.adgang?.toISOString()}`)
  }

  console.log('\n══ 5b · og samme-sekund-fremskridt virker stadig ══')
  {
    await db.delete(subscriptions)
    const u = await bruger('5b')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_5b_${S}`
    const t0 = nu()
    await post(h('checkout.session.completed',
      { id: `cs_5b_${S}`, subscription: sub, client_reference_id: u, customer: kunde }, t0))
    await post(faktura(sub, t0 + 86400, OPS.introPrisId, kunde, t0))
    const r = await abo(sub)
    tjek('checkout og faktura i SAMME sekund spejler stadig',
      r?.status === 'active', `status=${r?.status}`)
    tjek('  og adgangen er sat', !!r?.adgang)
  }

  console.log('\n══ 5c · en NYERE opsigelse skriver stadig canceled ══')
  {
    await db.delete(subscriptions)
    const u = await bruger('5c')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_5c_${S}`
    const t0 = nu()
    await post(h('checkout.session.completed',
      { id: `cs_5c_${S}`, subscription: sub, client_reference_id: u, customer: kunde }, t0))
    await post(faktura(sub, t0 + 86400, OPS.introPrisId, kunde, t0))
    await post(h('customer.subscription.deleted',
      { id: sub, status: 'canceled', cancel_at_period_end: false }, t0 + 60))
    const r = await abo(sub)
    tjek('terminalvagten spærrer ikke for at BLIVE terminal',
      r?.status === 'canceled', `status=${r?.status}`)
    tjek('  og adgangen er urørt af opsigelsen', !!r?.adgang)
  }

  // ═══ FUND 6 · KØEN ═══════════════════════════════════════
  console.log('\n══ 6 · de ældste udsulter ikke en senere klar hændelse ══')
  {
    falsk.nulstil()
    await db.delete(stripeEvents); await db.delete(subscriptions)
    const u = await bruger('6')
    // 51 hændelser, hvis forudsætning aldrig kommer. Id'erne gemmes —
    // en opslagsnøgle, der ikke rammer, ville give `undefined`, og
    // `undefined !== null` er en prøve, der består uden at måle noget.
    const idKoe: string[] = []
    for (let n = 0; n < 51; n++) {
      const e = faktura(`sub_koe_${n}`, nu() + 86400, OPS.introPrisId,
        `cus_mangler_${n}_${S}`, nu() + n)
      idKoe.push(e.id)
      await post(e)
    }
    tjek('51 hændelser ligger ubehandlede i køen',
      (await db.select({ id: stripeEvents.id }).from(stripeEvents)).length === 51)
    // Kun den SIDSTE bliver behandlingsklar.
    await db.update(users).set({ stripeCustomerId: `cus_mangler_50_${S}` })
      .where(eq(users.id, u))
    for (let n = 0; n < 3; n++) await betalingstilsyn(OPS)

    const [sen] = await db.select({
      b: stripeEvents.behandletAt, f: stripeEvents.forsoeg,
    }).from(stripeEvents).where(eq(stripeEvents.id, idKoe[50]!))
    tjek('den 51. ER taget op og gjort færdig',
      sen !== undefined && sen.b !== null,
      `fundet=${sen !== undefined} behandlet=${sen?.b?.toISOString()} forsoeg=${sen?.f}`)
    const [foerste] = await db.select({ f: stripeEvents.forsoeg })
      .from(stripeEvents).where(eq(stripeEvents.id, idKoe[0]!))
    tjek('  og de første er IKKE blevet ved med at blive valgt',
      (foerste?.f ?? 0) <= 3, `første forsøg=${foerste?.f}`)
    tjek('  og dens abonnement er bogført',
      (await db.select({ id: subscriptions.id }).from(subscriptions)).length === 1)
    const [v] = await db.select({ n: sql<number>`count(*)::int` }).from(stripeEvents)
      .where(and(sql`${stripeEvents.behandletAt} is null`,
        sql`${stripeEvents.naesteForsoegAt} is not null`))
    tjek('  og de fastlåste ligger i tilbagetrækning', (v?.n ?? 0) >= 50, `${v?.n} venter`)
  }

  console.log('\n══ 6b · tilbagetrækningen opgiver aldrig en betaling ══')
  {
    tjek('forsøg 1-2 venter ikke', naesteForsoeg(1).getTime() <= Date.now() + 1000)
    tjek('forsøg 3 venter ti minutter',
      Math.abs(naesteForsoeg(3).getTime() - (Date.now() + 600_000)) < 2000)
    tjek('forsøg 6 venter en time',
      Math.abs(naesteForsoeg(6).getTime() - (Date.now() + 3_600_000)) < 2000)
    tjek('forsøg 100 venter seks timer — ikke «opgivet»',
      Math.abs(naesteForsoeg(100).getTime() - (Date.now() + 6 * 3_600_000)) < 2000,
      'en betalingshændelse opgives aldrig; den prøves bare sjældnere')
  }

  // ═══ AFSTEMNINGEN SOM SELVSTÆNDIG INDGANG ════════════════
  console.log('\n══ 7 · afstemningen er sikker, når Stripe ikke svarer ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('7')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    gennemfoerHosStripe(r0!.sid!)
    await startKoebFor(u, '/')          // flytter raekken til gennemfoert
    await db.update(checkoutForsoeg).set({ stripeSubscriptionId: null })
      .where(eq(checkoutForsoeg.id, r0!.id))
    falsk.fejlPaa.add('checkout.sessions.retrieve')
    const a = await afstemGennemfoerteKoeb(OPS)
    const [r1] = await forsoegFor(u)
    tjek('en fejlet afstemning lader forsøget stå GENNEMFOERT',
      r1?.status === 'gennemfoert', `status=${r1?.status}`)
    tjek('  og den siger hvorfor', a.uafklarede === 1 && a.detaljer.length > 0,
      JSON.stringify(a))
  }
}

await koer()
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
