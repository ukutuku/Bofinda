// ═══════════════════════════════════════════════════════════════
//  Anden gennemgangs fund, prøvet mod rettelserne.
//
//  Forskellen på denne og test-betaling-robusthed.ts er, HVOR den
//  kalder ind. Første runde prøvede `behandl()`, `laegPlan()` og
//  `sigOpFor()` — altså laget under indgangene. Gennemgangen bad
//  udtrykkeligt om «de faktiske HTTP-, købs- og driftsindgange», og
//  det er dem, der kaldes her:
//
//    HTTP    `POST` fra app/api/stripe/route.ts, med en rigtig
//            Request og en rå krop. Statuskoden ER fundet: 200
//            betyder «prøv ikke igen» over for Stripe.
//    Køb     `startKoebFor()` fra lib/abonnement.ts — hele vejen,
//            inklusive reservationen og idempotensnøglen.
//    Drift   `betalingstilsyn()` fra lib/webhook.ts, som
//            scripts/import.ts kalder hver time, og `saetTilstand()`
//            fra lib/driftskift.ts.
//
//  Stripe er scripts/stripefalsk — ingen netværk. Den HÅNDHÆVER nu
//  Stripes dokumenterede idempotensadfærd: samme nøgle med samme
//  parametre afspiller det første svar, samme nøgle med ANDRE
//  parametre er en fejl. Uden den regel kunne prøven ikke se forskel
//  på en nøgle, der virker, og en der ikke gør.
//
//  Den kan stadig ikke bevise, at Stripe ACCEPTERER vores argumenter.
//  Det kræver sandbox, og adgangen mangler. Se rapporten.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, type Haendelse } from '../lib/webhook'
import { startKoebFor, lukAlleAabneKoeb } from '../lib/abonnement'
import { saetTilstand } from '../lib/driftskift'
import { indsaetStripe } from '../lib/stripe'
import { lavFalsk, Idempotensfejl, type Falsk } from './stripefalsk/index'
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
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r2${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r2${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}
const faktura = (sub: string, slut: number, pris = OPS.introPrisId, kunde?: string, created?: number) =>
  h('invoice.paid', {
    subscription: sub, ...(kunde ? { customer: kunde } : {}),
    lines: { data: [{ period: { start: nu(), end: slut }, pricing: { price_details: { price: pris } } }] },
  }, created)
const raekke = (sub: string) => db.select({
  adgang: subscriptions.adgangTil, status: subscriptions.status,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  pris: subscriptions.stripePriceId, slut: subscriptions.currentPeriodEnd,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

/** Et rigtigt kald paa ruten. Kroppen er RAA, som Stripe sender den. */
const post = (haendelse: Haendelse) => POST(new Request('https://proeve.invalid/api/stripe', {
  method: 'POST',
  headers: { 'stripe-signature': 't=1,v1=ligegyldig-attrappen-parser-kun', 'content-type': 'application/json' },
  body: JSON.stringify(haendelse),
}))

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═══ FUND 1 · HTTP-KVITTERINGEN ══════════════════════════
  console.log('\n══ 1 · ruten maa ikke kvittere for noget, den ikke fik gjort ══')
  {
    const sub = `sub_${randomUUID()}`
    const f = faktura(sub, nu() + 86400, OPS.introPrisId, `cus_ukendt_${S}`)
    // Stripe sender KUNDEOPLYSNINGER med i sine haendelser. De skal ikke
    // i vores base, bare fordi de fulgte med i en HTTP-krop.
    const o = f.data.object as Record<string, unknown>
    o['customer_details'] = { name: 'kundens.navn', email: 'kunde@x.invalid',
      address: { line1: 'Vestergade 1', postal_code: '8000' } }
    o['billing_details'] = { name: 'kundens.navn' }
    const svar = await post(f)
    tjek('en AFVENTENDE haendelse faar 409, ikke 200', svar.status === 409,
      `status=${svar.status} · 200 betyder «prøv ikke igen» hos Stripe`)
    tjek('  kroppen siger hvad udfaldet var',
      (await svar.clone().json() as { udfald?: string }).udfald === 'afventer')
    const [e] = await db.select({ b: stripeEvents.behandletAt, last: stripeEvents.nyttelast })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  haendelsen er IKKE markeret faerdig', e?.b === null)
    tjek('  og NYTTELASTEN er gemt', !!e?.last && (e.last as { id?: string }).id === f.id,
      'uden den kan den kun tages op, hvis Stripe leverer igen')
    // …men KUN det, behandlerne laeser. Et Stripe-objekt baerer kundens
    // navn, mail, faktureringsadresse og kortets sidste fire cifre.
    const gemt = JSON.stringify(e?.last)
    tjek('  og den er en ALLOWLIST, ikke hele objektet',
      !gemt.includes('kundens.navn') && !gemt.includes('Vestergade')
      && !gemt.includes('billing_details') && !gemt.includes('customer_details'),
      gemt.slice(0, 160))

    // Forudsaetningen kommer — gennem ruten, som i virkeligheden.
    const u = await bruger('1')
    await db.update(users).set({ stripeCustomerId: `cus_ukendt_${S}` }).where(eq(users.id, u))

    // DRIFTSINDGANGEN, ikke en genlevering fra Stripe. Det er hele
    // pointen: ruten alene kan ikke garantere, at haendelsen bliver
    // faerdig, for Stripes genforsoeg holder op.
    const linjer = await betalingstilsyn(OPS)
    tjek('driftstilsynet tager den op og goer den faerdig',
      !!(await raekke(sub))?.adgang, linjer.join(' | '))
    const [e2] = await db.select({ b: stripeEvents.behandletAt, last: stripeEvents.nyttelast })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  og nu ER den markeret faerdig', e2?.b !== null)
    tjek('  nyttelasten er kasseret, da der ikke laengere er noget at koere om',
      e2?.last === null, JSON.stringify(e2?.last)?.slice(0, 80))

    const igen = await post(f)
    tjek('en gentagelse faar 200', igen.status === 200,
      `status=${igen.status}`)
  }

  console.log('\n══ 1b · ugyldig signatur og manglende signatur ══')
  {
    falsk.fejlPaa.add('webhooks.constructEvent')
    const s1 = await post(h('invoice.paid', {}))
    tjek('ugyldig signatur giver 400', s1.status === 400, `status=${s1.status}`)
    const s2 = await POST(new Request('https://proeve.invalid/api/stripe', { method: 'POST', body: '{}' }))
    tjek('manglende signatur giver 400', s2.status === 400, `status=${s2.status}`)
  }

  // ═══ FUND 2 · DELVISE SKRIVNINGER ════════════════════════
  console.log('\n══ 2 · genlevering faerdiggoer det halve arbejde ══')
  {
    falsk.nulstil()
    const u = await bruger('2'); const sub = `sub_${randomUUID()}`
    const kunde = `cus_2_${S}`
    await post(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }))

    // Et RIGTIGT nedbrud paa praecis den soem, fundet handler om:
    // adgangen er skrevet, og processen doer, foer introduktionen og
    // planskylden naar at blive det. Triggeren er PostgreSQL's egen —
    // ingen attrap, ingen omskrevet kode.
    await db.execute(sql`
      create or replace function proeve_braek() returns trigger language plpgsql as $$
      begin raise exception 'nedbrud midt i behandlingen'; end $$`)
    await db.execute(sql`
      create trigger proeve_braek_tg before update of intro_brugt_at on users
      for each row when (new.intro_brugt_at is not null) execute function proeve_braek()`)

    const f = faktura(sub, nu() + 86400, OPS.introPrisId, kunde)
    const svar = await post(f).catch(() => null)
    await db.execute(sql`drop trigger proeve_braek_tg on users`)

    const r1 = await raekke(sub)
    tjek('nedbruddet naaede ikke at forhindre adgangen', !!r1?.adgang,
      'kunden har betalt — pengene er modtaget, uanset hvad der saa gik galt')
    const [u1] = await db.select({ i: users.introBrugtAt }).from(users).where(eq(users.id, u))
    tjek('  men introduktionen er IKKE registreret', u1?.i === null)
    tjek('  og planskylden er IKKE bogfoert', r1?.planStatus === null,
      `planStatus=${r1?.planStatus}`)
    const [e] = await db.select({ b: stripeEvents.behandletAt, f: stripeEvents.fejl })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  haendelsen staar ubehandlet med sin fejl', e?.b === null && !!e?.f,
      `fejl=${e?.f?.slice(0, 40)}`)
    tjek('  ruten svarede 500 eller kastede', svar === null || svar.status === 500,
      svar ? `status=${svar.status}` : 'kastede')

    // GENLEVERINGEN. Adgangen staar allerede paa fakturaens
    // periodeslut, saa den monotone vagt flytter INTET — og det var
    // netop dér, den gamle kode svarede «foraeldet» og sprang resten
    // over. Nu skal introduktionen og planen blive faerdige.
    const adgangFoer = r1!.adgang!.getTime()
    const udfald = await behandl(f, OPS)
    const r2 = await raekke(sub)
    const [u2] = await db.select({ i: users.introBrugtAt }).from(users).where(eq(users.id, u))
    tjek('genleveringen registrerer introduktionen', u2?.i !== null, `udfald=${udfald}`)
    tjek('  og planen er lagt og bekraeftet', r2?.planStatus === 'konfigureret',
      `planStatus=${r2?.planStatus} plan=${r2?.plan}`)
    tjek('  adgangen er UROERT — den var allerede rigtig',
      r2?.adgang?.getTime() === adgangFoer)
    tjek('  og haendelsen er nu faerdig',
      (await db.select({ b: stripeEvents.behandletAt }).from(stripeEvents)
        .where(eq(stripeEvents.id, f.id)))[0]?.b !== null)
  }

  // ═══ FUND 3 · PLANERNES GENFORSOEG, FRA DRIFTSINDGANGEN ══
  console.log('\n══ 3 · driftsindgangen tager en FAKTISK skyldig plan op ══')
  {
    falsk.nulstil()
    const u = await bruger('3'); const sub = `sub_${randomUUID()}`
    const kunde = `cus_3_${S}`
    await post(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }))
    falsk.fejlPaa.add('subscriptionSchedules.create')
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde))
    const r1 = await raekke(sub)
    tjek('planen skyldes efter en fejl hos Stripe', r1?.planStatus === 'mangler',
      `planStatus=${r1?.planStatus}`)
    tjek('  men adgangen er givet', !!r1?.adgang)

    // scripts/import.ts kalder praecis den her funktion, hver time.
    const linjer = await betalingstilsyn(OPS)
    const r2 = await raekke(sub)
    tjek('driftsindgangen lægger den skyldige plan', r2?.planStatus === 'konfigureret',
      linjer.join(' | '))
    tjek('  og den siger det i kørselsrapporten',
      linjer.some((l) => l.includes('[betaling] planer:')), JSON.stringify(linjer))
  }

  console.log('\n══ 3b · uden Stripe-opsaetning TIER tilsynet ikke ══')
  {
    const u = await bruger('3b'); const sub = `sub_${randomUUID()}`
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      planStatus: 'mangler', oprettetAt: new Date(),
    })
    const linjer = await betalingstilsyn(null)
    tjek('den siger at planerne IKKE kunne lægges',
      linjer.some((l) => l.includes('skyldige betalingsplaner kunne IKKE lægges')),
      JSON.stringify(linjer))
    tjek('  og planen staar stadig som skyldig',
      (await raekke(sub))?.planStatus === 'mangler')
    // Genbehandlingen koeres HELLER IKKE uden opsaetning: `betalt()`
    // kan ikke afgoere, om en faktura er introprisen, og en haendelse
    // markeret faerdig paa det grundlag ville tage sin planskyld med.
    tjek('  og genbehandlingen koeres ikke — men tier heller ikke om det',
      linjer.some((l) => l.includes('ubehandlede hændelser blev IKKE taget op'))
      || !linjer.some((l) => l.includes('genbehandling:')),
      JSON.stringify(linjer))
    await db.delete(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
  }

  console.log('\n══ 3c · en plan, der ikke kan bekraeftes, STOPPER fornyelsen ══')
  {
    // Her stod foer: «tilsynet advarer om abonnementet uden bekraeftet
    // plan». Advarslen er ikke nok — det var tredje gennemgangs fund 4.
    // En markering i VORES base stopper ingen opkraevning hos Stripe.
    falsk.nulstil()
    const u = await bruger('3c'); const sub = `sub_${randomUUID()}`
    const adgangTil = new Date(Date.now() + 86400000)
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil, stripeScheduleId: `sub_sched_3c_${S}`,
      // Forsoegene er brugt op — det er DEN udloeser, afsnittet
      // proever. (Den naere fornyelse er den anden, og den har runde3
      // §4c.)
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret 500',
      oprettetAt: new Date(),
    })
    const linjer = await betalingstilsyn(OPS)
    tjek('fornyelsen bliver STOPPET, ikke bare logget',
      linjer.some((l) => l.includes('fornyelsen er STOPPET') && l.includes(sub)),
      JSON.stringify(linjer))
    const iRelease = falsk.kald.findIndex((k) => k.metode === 'subscriptionSchedules.release')
    const iUpdate = falsk.kald.findIndex((k) => k.metode === 'subscriptions.update')
    tjek('  planen blev SLUPPET FOERST (release FOER update), ikke cancel',
      iRelease >= 0 && iUpdate >= 0 && iRelease < iUpdate
      && falsk.antal('subscriptions.cancel') === 0,
      `release=${iRelease} update=${iUpdate} — en plan kan skrive opsigelsen `
      + 'om ved naeste faseskift, saa det er RAEKKEFOELGEN der er vagten')
    const k = falsk.sidste('subscriptions.update')
    tjek('  og cancel_at_period_end blev sat hos Stripe',
      (k?.args[1] as { cancel_at_period_end?: boolean })?.cancel_at_period_end === true,
      JSON.stringify(k?.args))
    const r = await raekke(sub)
    tjek('  KUNDENS BETALTE ADGANG ER UROERT',
      r?.adgang?.getTime() === adgangTil.getTime(),
      `adgang=${r?.adgang?.toISOString()}`)
    const [sr] = await db.select({
      stoppet: subscriptions.fornyelseStoppetAt,
      grund: subscriptions.fornyelseStoppetGrund,
      opsagt: subscriptions.cancelAtPeriodEnd,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  og det STAAR i basen med sin grund',
      !!sr?.stoppet && !!sr.grund && sr.opsagt === true,
      JSON.stringify(sr))

    // Anden koersel: den stopper ikke igen, laegger ingen ny plan, og
    // tier heller ikke.
    //
    // FORSOEGSTALLET SAETTES NED FOERST, og det er hele pointen. Med 5
    // filtrerede `lt(planForsoeg, PLAN_MAX_FORSOEG)` raekken fra, og den
    // sidste assertion bestod af den grund — ikke fordi beskyttelsen
    // holdt. Med 1 er raekken en rigtig kandidat til
    // `laegManglendePlaner`, og kun `isNull(fornyelse_stoppet_at)`
    // holder den ude. Uden vagten ville tilsynet her laegge en NY plan
    // paa det abonnement, det lige har sluppet.
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planForsoeg: 1 })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    falsk.nulstil()
    const igen = await betalingstilsyn(OPS)
    tjek('naeste koersel stopper den ikke igen',
      falsk.antal('subscriptions.update') === 0,
      `${falsk.antal('subscriptions.update')} kald`)
    tjek('  og den laegger INGEN ny plan paa det slupne abonnement',
      falsk.antal('subscriptionSchedules.create') === 0,
      `${falsk.antal('subscriptionSchedules.create')} oprettelser`)
    const r2 = await raekke(sub)
    tjek('  abonnementet har stadig ingen plan', r2?.plan === null,
      `plan=${r2?.plan}`)
    tjek('  men den bliver ved at staa i rapporten',
      igen.some((l) => l.includes('har stoppet fornyelse')),
      JSON.stringify(igen))
    await db.delete(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
  }

  // ═══ FUND 4 · KOEBET ═════════════════════════════════════
  console.log('\n══ 4 · reservationen ligger FOER det eksterne kald ══')
  {
    falsk.nulstil()
    const u = await bruger('4')
    // Maaler ordenen direkte: naar Stripe kaldes, SKAL raekken vaere der.
    let saaReservation: number | null = null
    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => {
        const r = await db.select({ id: checkoutForsoeg.id }).from(checkoutForsoeg)
          .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
        saaReservation = r.length
        return rigtig(p, o)
      }
    const svar = await startKoebFor(u, '/')
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig

    tjek('koebet lykkes', svar.ok, JSON.stringify(svar))
    tjek('  reservationen fandtes ALLEREDE, da Stripe blev kaldt', saaReservation === 1,
      `fandt ${saaReservation} aabne raekker paa kaldstidspunktet`)
    const k = falsk.sidste('checkout.sessions.create')
    const [res] = await db.select({ id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
      udl: checkoutForsoeg.udloeberAt })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    tjek('  idempotensnoeglen er FORSOEGETS id',
      (k?.args[1] as { idempotencyKey?: string })?.idempotencyKey === `koeb:${res!.id}`,
      String((k?.args[1] as { idempotencyKey?: string })?.idempotencyKey))
    tjek('  expires_at kommer fra den GEMTE udloebstid, ikke en ny udregning',
      (k?.args[0] as { expires_at?: number })?.expires_at
        === Math.floor(res!.udl.getTime() / 1000))
    tjek('  og sessionen er skrevet paa raekken', res?.sid === (falsk.sessioner.keys().next().value))
  }

  console.log('\n══ 4b · samme forsoeg igen giver SAMME session, ikke en ny ══')
  {
    const u = (await db.select({ id: checkoutForsoeg.userId }).from(checkoutForsoeg)
      .where(eq(checkoutForsoeg.status, 'aaben')).limit(1))[0]!.id
    const foer = falsk.antal('checkout.sessions.create')
    const svar = await startKoebFor(u, '/')
    tjek('andet klik giver en url', svar.ok, JSON.stringify(svar))
    tjek('  og der blev IKKE oprettet en session til',
      falsk.antal('checkout.sessions.create') === foer,
      `${falsk.antal('checkout.sessions.create') - foer} nye`)
  }

  console.log('\n══ 4b2 · et MISLYKKET opslag er ikke bevis for, at sessionen er doed ══')
  {
    // Supplerende kodefund til fund 5: `hentSession` slugte fejlen som
    // null, og koebet markerede saa reservationen udloebet. Et opslag,
    // der ikke kunne laves, siger ingenting om, hvorvidt sessionen kan
    // betales — og tog man den for et nej, kunne kontoen begynde et nyt
    // koeb, mens det gamle stadig var betalbart.
    const [foer] = await db.select({ id: checkoutForsoeg.id, uid: checkoutForsoeg.userId })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben')).limit(1)
    const antalFoer = falsk.antal('checkout.sessions.create')
    falsk.fejlPaa.add('checkout.sessions.retrieve')
    const svar = await startKoebFor(foer!.uid, '/')
    tjek('koebet giver ikke en ny betalingsside', !svar.ok, JSON.stringify(svar))
    tjek('  og der blev IKKE oprettet en session til',
      falsk.antal('checkout.sessions.create') === antalFoer)
    const [efter] = await db.select({ s: checkoutForsoeg.status })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.id, foer!.id))
    tjek('  reservationen staar STADIG aaben efter det mislykkede opslag',
      efter?.s === 'aaben', `status=${efter?.s}`)
  }

  console.log('\n══ 4b3 · er sessionen DOED, begyndes der forfra ══')
  {
    // Ikke det samme som 4b2. Dér kunne vi ikke FAA svar, og saa staar
    // raekken aaben. Her svarer Stripe klart: sessionen er udloebet.
    // Saa er «Du har allerede et abonnement» et forkert svar — hun har
    // ingen, hun har en doed betalingsside, og svaret paa den er en ny.
    falsk.nulstil()
    const u = await bruger('4b3')
    const a = await startKoebFor(u, '/')
    tjek('foerste koeb lykkes', a.ok, JSON.stringify(a))
    const sid = (await db.select({ sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(and(eq(checkoutForsoeg.userId, u),
        eq(checkoutForsoeg.status, 'aaben'))))[0]!.sid!
    falsk.sessioner.get(sid)!.status = 'expired'
    const b = await startKoebFor(u, '/')
    tjek('andet koeb giver en NY betalingsside', b.ok, JSON.stringify(b))
    tjek('  og det er ikke den doede session igen', a.ok && b.ok && a.url !== b.url)
    const raekker2 = await db.select({ s: checkoutForsoeg.status, sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    tjek('  den gamle raekke er lukket som udloebet',
      raekker2.some((r) => r.sid === sid && r.s === 'udloebet'),
      JSON.stringify(raekker2))
    tjek('  og der er praecis én aaben tilbage',
      raekker2.filter((r) => r.s === 'aaben').length === 1)
  }

  console.log('\n══ 4c · genstart efter udloeb — noeglen maa ikke spaerre ══')
  {
    falsk.nulstil()
    const u = await bruger('4c')
    const a = await startKoebFor(u, '/')
    tjek('foerste koeb lykkes', a.ok)
    // Reservationen udloeber. Stripe HUSKER stadig noeglen i 24 timer.
    //
    // BEGGE ure flyttes, og det er ikke pedanteri: sessionens
    // `expires_at` ER reservationens `udloeber_at` — samme tal, sat i
    // samme kald. Flyttede proeven kun vores eget, ville den maale en
    // verden, der ikke kan opstaa: vores raekke udloebet, mens Stripes
    // session stadig kan betales. Og netop dét er grunden til, at
    // sweepet ikke laengere maa lukke en raekke, Stripe kender.
    const sid4c = (await db.select({ sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(and(eq(checkoutForsoeg.userId, u),
        eq(checkoutForsoeg.status, 'aaben'))))[0]!.sid!
    await db.update(checkoutForsoeg)
      .set({ udloeberAt: new Date(Date.now() - 60000) })
      .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
    falsk.sessioner.get(sid4c)!.expires_at = Math.floor((Date.now() - 60000) / 1000)
    const b = await startKoebFor(u, '/')
    tjek('et NYT koeb efter udloeb lykkes', b.ok, JSON.stringify(b))
    tjek('  og det fik sin EGEN session', a.ok && b.ok && a.url !== b.url)
    const noegler = falsk.kald.filter((x) => x.metode === 'checkout.sessions.create')
      .map((x) => (x.args[1] as { idempotencyKey?: string })?.idempotencyKey)
    tjek('  med to FORSKELLIGE idempotensnoegler', new Set(noegler).size === 2,
      JSON.stringify(noegler))
    tjek('  og ingen af kaldene blev afspillet fra en gammel noegle',
      falsk.udfoerte('checkout.sessions.create') === 2)
  }

  console.log('\n══ 4c2 · erstatningen HAANDHAEVER Stripes noegleregel ══')
  {
    // Bevis for, at 4c maaler noget. Den GAMLE noegleform var
    // `koeb:<bruger>:<pristype>` — konstant pr. konto — mens
    // `expires_at` blev regnet ud paa ny ved hvert kald. Stripe
    // afviser netop den kombination.
    const s = falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } }
    const noegle = { idempotencyKey: `koeb:samme:intro` }
    const et = await s.sessions.create({ expires_at: 1000 }, noegle)
    const to = await s.sessions.create({ expires_at: 1000 }, noegle)
    tjek('samme noegle + samme parametre afspiller det foerste svar',
      (et as { id: string }).id === (to as { id: string }).id)
    let afvist: unknown = null
    try { await s.sessions.create({ expires_at: 2000 }, noegle) } catch (e) { afvist = e }
    tjek('  samme noegle + ANDRE parametre afvises',
      afvist instanceof Idempotensfejl,
      afvist ? (afvist as Error).message.slice(0, 60) : 'ingen fejl')
  }

  console.log('\n══ 4d · to samtidige koeb — taberen maa ikke lukke vinderens ══')
  {
    falsk.nulstil()
    const u = await bruger('4d')
    const [a, b] = await Promise.allSettled([startKoebFor(u, '/'), startKoebFor(u, '/')])
    const svar = [a, b].map((x) => x.status === 'fulfilled' ? x.value : { ok: false as const, fejl: 'kastede' })
    const ok = svar.filter((x) => x.ok)
    tjek('mindst ét af de to kald giver en betalingsside', ok.length >= 1,
      JSON.stringify(svar))
    const aabne = await db.select({ id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg)
      .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
    tjek('  der staar PRAECIS én aaben reservation', aabne.length === 1,
      `${aabne.length} aabne`)
    const levende = [...falsk.sessioner.values()].filter((x) => x.status === 'open')
    tjek('  og den session, brugeren fik, er stadig betalbar',
      ok.every((x) => x.ok && levende.some((l) => l.url === x.url)),
      `aabne sessioner: ${levende.length}`)
    tjek('  ingen session blev udloebet under kaploebet',
      falsk.antal('checkout.sessions.expire') === 0)
  }

  // ═══ FUND 5 · GRATIS-SKIFTET ═════════════════════════════
  console.log('\n══ 5 · en mislykket lukning bogfoeres ikke som afsluttet ══')
  {
    falsk.nulstil()
    await db.delete(subscriptions)
    // Afsnit 4 efterlod aabne reservationer paa andre konti. De ville
    // blande sig i maalingen her: den villede fejl ville ramme en
    // fremmed raekke, og tallene ville ikke sige noget om den, proeven
    // handler om.
    await db.delete(checkoutForsoeg)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('5adm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('5')
    const koeb = await startKoebFor(u, '/')
    tjek('der ligger et paabegyndt koeb', koeb.ok)

    falsk.fejlPaa.add('checkout.sessions.retrieve')
    const afvist = await saetTilstand('gratis', admin)
    tjek('skiftet AFVISES, naar Stripe ikke svarer',
      !afvist.ok && afvist.fejl === 'aabne_koeb', JSON.stringify(afvist))
    const [d1] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  og tilstanden er UROERT', d1?.t === 'betaling', `tilstand=${d1?.t}`)
    const [r1] = await db.select({ s: checkoutForsoeg.status, f: checkoutForsoeg.lukkeFejl,
      n: checkoutForsoeg.lukkeForsoeg })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    tjek('  reservationen staar stadig AABEN', r1?.s === 'aaben', `status=${r1?.s}`)
    tjek('  med Stripes fejl og et forsoegstal', !!r1?.f && r1.n === 1,
      `forsoeg=${r1?.n} fejl=${r1?.f?.slice(0, 40)}`)
    tjek('  og afvisningen siger hvorfor',
      !afvist.ok && afvist.fejl === 'aabne_koeb' && afvist.forklaring.includes('IKKE skiftet'))

    // Andet forsoeg: Stripe svarer, sessionen udloebes, skiftet gaar igennem.
    const ja = await saetTilstand('gratis', admin, 'anden gang')
    tjek('naeste forsoeg gaar igennem', ja.ok, JSON.stringify(ja))
    tjek('  sessionen blev udloebet hos Stripe',
      falsk.antal('checkout.sessions.expire') === 1)
    const [r2] = await db.select({ s: checkoutForsoeg.status, st: checkoutForsoeg.stripeStatus })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    tjek('  og raekken er lukket', r2?.s === 'afbrudt' && r2.st === 'expired',
      `status=${r2?.s}/${r2?.st}`)
    const [d2] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  tilstanden er nu gratis', d2?.t === 'gratis')
  }

  console.log('\n══ 5b · uden Stripe-opsaetning taelles intet som lukket ══')
  {
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const u = (await db.select({ id: users.id }).from(users).limit(1))[0]!.id
    await db.insert(checkoutForsoeg).values({
      userId: u, prisId: OPS.introPrisId, stripeSessionId: `cs_uden_${S}`,
      udloeberAt: new Date(Date.now() + 1800000),
    })
    const gem = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    const r = await lukAlleAabneKoeb()
    process.env.STRIPE_SECRET_KEY = gem
    tjek('ingen lukninger bogfoeres uden en Stripe-forbindelse',
      r.lukkede === 0 && r.uafklarede === 1, JSON.stringify(r))
    tjek('  og det SIGES hvorfor', r.detaljer.join(' ').includes('ikke konfigureret'))
    await db.delete(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
  }

  console.log('\n══ 5c · koeb i GRATIS tilstand afvises, ogsaa direkte ══')
  {
    await db.update(drift).set({ tilstand: 'gratis' }).where(eq(drift.id, true))
    falsk.nulstil()
    const u = await bruger('5c')
    const svar = await startKoebFor(u, '/')
    tjek('koebet afvises', !svar.ok && svar.fejl === 'gratis_tilstand', JSON.stringify(svar))
    tjek('  og Stripe blev slet ikke kaldt', falsk.kald.length === 0,
      JSON.stringify(falsk.kald.map((x) => x.metode)))
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
  }

  // ═══ FUND 6 · AELDRE FAKTURA, NYERE STATUS ═══════════════
  console.log('\n══ 6 · en aeldre faktura maa ikke skrive status baglaens ══')
  {
    falsk.nulstil()
    const u = await bruger('6'); const sub = `sub_${randomUUID()}`
    const kunde = `cus_6_${S}`
    const t0 = nu()
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }, t0), OPS)
    await behandl(faktura(sub, t0 + 86400, OPS.introPrisId, kunde, t0 + 1), OPS)

    // Abonnementet opsiges og slettes hos Stripe — NYERE end alt andet.
    await behandl(h('customer.subscription.deleted',
      { id: sub, status: 'canceled', cancel_at_period_end: true }, t0 + 100), OPS)
    const r1 = await raekke(sub)
    tjek('status er canceled', r1?.status === 'canceled', `status=${r1?.status}`)

    // Og SAA kommer en gammel, forsinket faktura for en LAENGERE periode.
    const sent = faktura(sub, t0 + 28 * 86400, OPS.normalPrisId, kunde, t0 + 2)
    const udfald = await behandl(sent, OPS)
    const r2 = await raekke(sub)
    tjek('den betalte adgang bliver registreret',
      r2!.adgang!.getTime() === (t0 + 28 * 86400) * 1000,
      `udfald=${udfald} adgang=${r2?.adgang?.toISOString()}`)
    tjek('  men status er IKKE skrevet tilbage til active',
      r2?.status === 'canceled', `status=${r2?.status}`)
    tjek('  og periodefeltet er heller ikke rykket',
      r2?.slut === null || r2!.slut!.getTime() <= (t0 + 86400) * 1000,
      `slut=${r2?.slut?.toISOString()}`)
    tjek('  prisen er stadig den, den nyere haendelse satte',
      r2?.pris !== OPS.normalPrisId, `pris=${r2?.pris}`)
  }

  console.log('\n══ 6b · en NYERE faktura spejler som foer ══')
  {
    const u = await bruger('6b'); const sub = `sub_${randomUUID()}`
    const kunde = `cus_6b_${S}`
    const t0 = nu()
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }, t0), OPS)
    await behandl(faktura(sub, t0 + 86400, OPS.introPrisId, kunde, t0 + 5), OPS)
    const r = await raekke(sub)
    tjek('status, pris og periode er spejlet',
      r?.status === 'active' && r.pris === OPS.introPrisId
      && r.slut?.getTime() === (t0 + 86400) * 1000,
      `status=${r?.status} pris=${r?.pris} slut=${r?.slut?.toISOString()}`)
    tjek('  og adgangen er sat', r!.adgang!.getTime() === (t0 + 86400) * 1000)
  }
}

await koer()
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
