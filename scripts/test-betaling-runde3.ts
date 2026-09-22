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
  stopForkertFornyelse, type Haendelse } from '../lib/webhook'
import { startKoebFor, lukAlleAabneKoeb, aabneKoeb,
  abonnementForBruger } from '../lib/abonnement'
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
const skyld = (sub: string) => db.select({ s: subscriptions.afstemningSkyldigAt })
  .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
  .then((r) => r[0]?.s)

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

/**
 * Nulstil attrappen OG driftstilstanden.
 *
 * Drift-tilstanden er GLOBAL for hele filen. Et afsnit, der efterlader
 * den paa `gratis` — fordi det fejlede — faar hvert eneste
 * efterfoelgende `startKoebFor` til at svare `gratis_tilstand`, og saa
 * kaster `[0]!.sid` en TypeError, der afbryder HELE prøven. Afsnittene
 * skal kunne fejle hver for sig.
 */
async function nulstil() {
  falsk.nulstil()
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

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
    // Afsnittet stiller sin EGEN række op. Før læste det den, 1b
    // efterlod, og `[0]!.id` er kun en typepåstand: fejlede 1b, kastede
    // linjen en TypeError, der afbrød HELE filen — afsnit 2-7 blev
    // aldrig kørt, og der kom ingen optælling. En prøve, der kan tie om
    // seks afsnit, fordi ét gik galt, måler ikke det, den lover.
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('1c')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    gennemfoerHosStripe(r0!.sid!)
    await startKoebFor(u, '/')          // flytter rækken til gennemfoert
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
    await nulstil()
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

    // Nu svarer Stripe. Skiftet vandt ikke, så reservationen er stadig
    // `aaben`, overtagelsen rammer sin række, og oprydningen køres
    // ALDRIG i dette forløb. Her stod før `fejlPaa.add('…expire')` —
    // et flag, der aldrig fyrede, og en afsnitsoverskrift, der lovede
    // en måling, der ikke fandt sted. Oprydningen har sit eget afsnit
    // nedenfor (2c), hvor den faktisk nås.
    slip()
    const k = await koeb
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig
    tjek('købet lykkes — skiftet vandt jo ikke', k.ok, JSON.stringify(k))
    tjek('  og oprydningen blev IKKE kaldt — der var intet at rydde op',
      falsk.antal('checkout.sessions.expire') === 0,
      `${falsk.antal('checkout.sessions.expire')} expire-kald`)
    const [d2] = await db.select({ t: drift.tilstand }).from(drift)
    const [r2] = await forsoegFor(u)
    // POSITIVT formuleret. «ikke (gratis og betalbar)» er sandt af sig
    // selv, så snart tilstanden ikke er gratis — og det har afsnittet
    // allerede fastslået fire linjer før. En assertion, der ikke kan
    // fejle, måler ingenting.
    tjek('  tilstanden er betaling, og sessionen er kendt og betalbar',
      d2?.t === 'betaling' && r2?.status === 'aaben' && r2.sid !== null
      && falsk.sessioner.get(r2.sid)?.status === 'open',
      `tilstand=${d2?.t} status=${r2?.status} sid=${r2?.sid}`)
  }

  console.log('\n══ 2c · en session, oprydningen ikke kunne lukke, bliver SYNLIG ══')
  {
    // Forløbet, der før gjorde en betalbar session usynlig:
    //  1. reservationen lukkes under kaldet, og kontoen får en NY
    //  2. `opgivSession` kaldes — `expire` fejler
    //  3. fejlgrenen skrev status TILBAGE til `aaben`
    //  4. det delvise indeks afviste det med 23505
    //  5. fejlen slap ud, og den ydre catch lukkede rækken som
    //     `afbrudt` UDEN sessions-id
    //  6. gratis-skiftet meldte «ok», mens sessionen stod betalbar
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('2cadm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('2c')

    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => {
        const sess = await rigtig(p, o)
        // MENS kaldet var i luften: reservationen blev lukket, og
        // kontoen fik en ny uafsluttet række. Nu kan status ikke
        // skrives tilbage til `aaben` uden at ramme indekset.
        await db.update(checkoutForsoeg)
          .set({ status: 'udloebet', lukketAt: new Date() })
          .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
        await db.insert(checkoutForsoeg).values({
          userId: u, prisId: OPS.introPrisId,
          udloeberAt: new Date(Date.now() + 35 * 60_000),
        })
        return sess
      }
    falsk.fejlPaa.add('checkout.sessions.expire')
    const k = await startKoebFor(u, '/')
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig

    tjek('købet afvises, fordi reservationen blev lukket under det',
      !k.ok && k.fejl === 'gratis_tilstand', JSON.stringify(k))
    tjek('  oprydningen BLEV forsøgt — flaget fyrede',
      falsk.antal('checkout.sessions.expire') === 1,
      `${falsk.antal('checkout.sessions.expire')} expire-kald`)
    const raekker3 = await db.select({
      id: checkoutForsoeg.id, status: checkoutForsoeg.status,
      sid: checkoutForsoeg.stripeSessionId, ss: checkoutForsoeg.stripeStatus,
      fejl: checkoutForsoeg.lukkeFejl,
    }).from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    const efterladt = raekker3.find((r) => r.sid !== null)
    tjek('  sessionen står på rækken, selv om lukningen fejlede',
      !!efterladt && efterladt.ss === 'open' && !!efterladt.fejl,
      JSON.stringify(raekker3))
    tjek('  rækken blev IKKE genoplivet til aaben',
      efterladt?.status !== 'aaben', `status=${efterladt?.status}`)
    tjek('  sessionen er stadig betalbar hos Stripe',
      falsk.sessioner.get(efterladt!.sid!)?.status === 'open')
    tjek('  den TÆLLES med på adminsiden', (await aabneKoeb()) === 2,
      `${await aabneKoeb()} talt`)

    // ── DEN AFGØRENDE MÅLING ──────────────────────────────
    // Den ANDEN række fjernes, så den efterladte session er det ENESTE,
    // der kan spærre. Før rettelsen var den usynlig for både
    // `lukAlleAabneKoeb`, `aabneKoeb()` og skiftet — og skiftet meldte
    // «ok», mens sessionen stod betalbar hos Stripe.
    await db.delete(checkoutForsoeg)
      .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
    tjek('  kun den efterladte står tilbage', (await aabneKoeb()) === 1,
      `${await aabneKoeb()} talt`)
    falsk.fejlPaa.add('checkout.sessions.expire')
    const s = await saetTilstand('gratis', admin)
    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    tjek('  gratis-skiftet AFVISES af den ALENE', !s.ok, JSON.stringify(s))
    tjek('  tilstanden er UROERT', d?.t === 'betaling', `tilstand=${d?.t}`)
    tjek('  og sessionen er ikke skjult — den er stadig betalbar',
      falsk.sessioner.get(efterladt!.sid!)?.status === 'open')

    // Og når Stripe svarer igen, lukkes den — uden at nogen status
    // skrives om, og altså uden at ramme indekset.
    const l = await lukAlleAabneKoeb()
    tjek('  næste afstemning lukker sessionen hos Stripe',
      falsk.sessioner.get(efterladt!.sid!)?.status === 'expired', JSON.stringify(l))
    const [e2] = await db.select({ ss: checkoutForsoeg.stripeStatus,
      fejl: checkoutForsoeg.lukkeFejl, status: checkoutForsoeg.status })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.id, efterladt!.id))
    tjek('  rækken bærer nu en BEKRÆFTET lukning',
      e2?.ss === 'expired' && e2.fejl === null, JSON.stringify(e2))
    tjek('  og dens egen status er uændret — vi skrev den aldrig om',
      e2?.status === efterladt?.status, `${efterladt?.status} → ${e2?.status}`)
    const s2 = await saetTilstand('gratis', admin)
    tjek('  og NU kan muren slås fra', s2.ok, JSON.stringify(s2))
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
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
      id: planId, konfigureret: false, status: 'active', subscription: sub,
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
    const planId = `sub_sched_4c_${S}`
    const adgangTil = new Date(Date.now() + 30 * 60_000)   // fornyelse om 30 min
    // Planen STYRER abonnementet, men kun med fase 1: den fornyer til
    // introprisen igen og igen. Bindingen skal være der — en plan, der
    // ikke styrer noget, er der intet at slippe i, og så ville
    // afsnittet ikke måle rækkefølgen, det hedder efter.
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false, schedule: planId })
    falsk.planer.set(planId, {
      id: planId, konfigureret: true, status: 'active', subscription: sub,
      phases: [{ start_date: 1_700_000_000, end_date: 1_700_086_400,
                 items: [{ price: OPS.introPrisId, quantity: 1 }] }],
    })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil, stripeScheduleId: planId,
      planStatus: 'oprettet', planForsoeg: 1, planFejl: 'modelleret 500',
      oprettetAt: new Date(),
    })
    // Planlægningen prøver først at reparere planen — det er dens
    // opgave. Her fejler den, så rækken stadig står ubekræftet, når
    // beskyttelsen kigger.
    falsk.fejlPaa.add('subscriptionSchedules.update')
    const linjer = await betalingstilsyn(OPS)
    tjek('fornyelsen STOPPES, fordi den er nær — ikke fordi forsøgene er brugt',
      linjer.some((l) => l.includes('fornyelsen er STOPPET') && l.includes(sub)),
      JSON.stringify(linjer.filter((l) => l.includes('STOPPET'))))
    // RÆKKEFØLGEN måles, ikke bare at begge skete. Byttede man de to
    // kald om i produktkoden, var en optælling stadig grøn — og
    // rækkefølgen er netop dét, der afgør, om planen kan skrive
    // opsigelsen om ved næste faseskift. Samme form som robusthed §6.
    const iRelease = falsk.kald.findIndex((k) => k.metode === 'subscriptionSchedules.release')
    const iUpdate = falsk.kald.findIndex((k) => k.metode === 'subscriptions.update')
    tjek('  planen blev SLUPPET FØRST (release før update), aldrig cancel',
      iRelease >= 0 && iUpdate >= 0 && iRelease < iUpdate
      && falsk.antal('subscriptions.cancel') === 0,
      `release=${iRelease} update=${iUpdate}`)
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
    await nulstil()
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

  // ═══ MODSTANDSGENNEMGANGENS FUND ═════════════════════════
  //  Fire lasere gik diffen efter, EFTER at de seks fund var rettet.
  //  Det de fandt, er ikke gennemgangens fund — det er fejl, RETTELSERNE
  //  indfoerte, eller som de foerst goer synlige. De hoerer derfor til
  //  her, i samme proeve som det, de retter.

  console.log('\n══ 8 · en BETALT faktura forsvinder aldrig i tavshed ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('8')
    const kunde = `cus_8_${S}`
    const subA = `sub_8A_${S}`
    const subB = `sub_8B_${S}`
    // Kontoen HAR et levende abonnement. Det delvise indeks
    // `sub_en_levende_pr_bruger` tillader kun ét.
    const adgangA = new Date(Date.now() + 86_400_000)
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: subA, stripeCustomerId: kunde,
      status: 'active', adgangTil: adgangA,
    })
    // …og der ankommer en betalt faktura for et ANDET abonnement paa
    // samme Stripe-kunde. Indsaettelsen KAN ikke lykkes.
    const e = faktura(subB, nu() + 86400, OPS.introPrisId, kunde)
    await post(e)

    const [r] = await db.select({
      b: stripeEvents.behandletAt, n: stripeEvents.nyttelast, f: stripeEvents.fejl,
    }).from(stripeEvents).where(eq(stripeEvents.id, e.id))
    tjek('hændelsen er IKKE markeret færdig', r?.b === null, `behandletAt=${r?.b}`)
    tjek('  nyttelasten er bevaret, så den kan køres om', r?.n !== null)
    tjek('  og der står HVORFOR i basen',
      !!r?.f && r.f.includes('dobbelt abonnement'), `fejl=${r?.f}`)
    tjek('  den levende rækkes betalte adgang er URØRT',
      (await abo(subA))?.adgang?.getTime() === adgangA.getTime())
    tjek('  og der blev ikke oprettet en række til',
      (await db.select({ id: subscriptions.id }).from(subscriptions)).length === 1)

    // Og genleveringen fra Stripe kan stadig tages op.
    await post(e)
    const [r2] = await db.select({ b: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, e.id))
    tjek('  en genlevering svarer ikke «gentagelse» og lukker den ikke',
      r2?.b === null, `behandletAt=${r2?.b}`)
  }

  console.log('\n══ 9 · tilsynet ophæver ikke sin egen beskyttelse ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('9')
    const sub = `sub_9_${S}`
    // ── FIKSTURET SKAL VAERE ET, STRIPE KUNNE SVARE PAA ────
    // Her stod en binding til et plan-id, der ikke fandtes hos Stripe,
    // og abonnementet var slet ikke registreret i attrappen. Det virkede
    // kun, fordi `laegPlan` dengang BRUGTE vores egen binding uden at
    // spoerge — planopslaget gav null, og planlaegningen knaekkede.
    //
    // Nu spoerger begge veje kilden foerst (runde 8, T2). Saa er det
    // rigtige fikstur et abonnement, der FINDES, uden plan, hvor
    // oprettelsen fejler: det er netop derfor sikkerhedsstoppet findes.
    // Prøven maaler det samme som foer — at tilsynet ikke ophaever sin
    // egen beskyttelse — men paa et forloeb, Stripe ville kunne have.
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    falsk.fejlPaa.add('subscriptionSchedules.create')
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil: new Date(Date.now() + 30 * 60_000),
      stripeScheduleId: null,
      planStatus: 'mangler', planForsoeg: 1, planFejl: 'modelleret 500',
    })
    await betalingstilsyn(OPS)
    const e1 = await abo(sub)
    tjek('kørsel 1 stopper fornyelsen', !!e1?.stoppet && e1.opsagt === true)
    tjek('  og planen er sluppet', e1?.plan === null, `plan=${e1?.plan}`)

    // NÆSTE TIME. Uden vagten lagde tilsynet en ny plan paa det
    // abonnement, det lige havde sluppet — og markerede den
    // `konfigureret`, mens basen og «Mit abonnement» blev ved med at
    // sige, at der ikke bliver trukket mere.
    //
    // Og Stripe er kommet op igen: oprettelsen ville lykkes nu. Det er
    // dét, der goer assertionen nedenfor til en vagt og ikke en
    // selvfoelgelighed — foer blev den holdt grøn af, at intet kunne
    // oprettes overhovedet.
    falsk.fejlPaa.delete('subscriptionSchedules.create')
    const foer = falsk.antal('subscriptionSchedules.create')
    const linjer = await betalingstilsyn(OPS)
    const e2 = await abo(sub)
    tjek('kørsel 2 lægger INGEN ny plan',
      falsk.antal('subscriptionSchedules.create') === foer,
      `${falsk.antal('subscriptionSchedules.create') - foer} nye`)
    tjek('  abonnementet har stadig ingen plan', e2?.plan === null, `plan=${e2?.plan}`)
    tjek('  og det står stadig som stoppet', !!e2?.stoppet)
    tjek('  advarslen BLIVER stående for et menneske',
      linjer.some((l) => l.includes('har stoppet fornyelse') && l.includes(sub)),
      JSON.stringify(linjer))
  }

  console.log('\n══ 9b · advarslen hviler på ÉT felt, ikke to ══')
  {
    // Blev planen bekraeftet bagefter — af en anden vej end tilsynet —
    // maa advarslen ikke forsvinde: `cancel_at_period_end` staar stadig
    // hos Stripe, og kunden har faaet at vide, at der ikke trækkes mere.
    const u = await bruger('9b')
    const sub = `sub_9b_${S}`
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      cancelAtPeriodEnd: true, fornyelseStoppetAt: new Date(),
      fornyelseStoppetGrund: 'prøvens egen', planStatus: 'konfigureret',
    })
    const linjer = await betalingstilsyn(OPS)
    tjek('en bekræftet plan slukker ikke advarslen om en stoppet fornyelse',
      linjer.some((l) => l.includes('har stoppet fornyelse') && l.includes(sub)),
      JSON.stringify(linjer.filter((l) => l.includes('stoppet fornyelse'))))
    await db.delete(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
  }

  console.log('\n══ 10 · en KORREKT plan slippes aldrig ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('10')
    const sub = `sub_10_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil: new Date(Date.now() + 86_400_000),
      planStatus: 'mangler', planForsoeg: 0,
    })
    // Læg planen rigtigt — gennem den rigtige kodevej.
    await betalingstilsyn(OPS)
    const lagt = await abo(sub)
    tjek('planen er lagt og bekræftet', lagt?.planStatus === 'konfigureret'
      && !!lagt.plan, JSON.stringify(lagt))

    // Nu TABER vi vores egen tilbagelæsning: rækken står «oprettet»,
    // mens planen ligger rigtigt hos Stripe. Og fornyelsen er nær.
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planFejl: 'svaret gik tabt',
             adgangTil: new Date(Date.now() + 30 * 60_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const slip = falsk.antal('subscriptionSchedules.release')
    const r = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')

    tjek('afstemningen svarer «planen er rigtig»', r === 'plan_er_rigtig', `r=${r}`)
    tjek('  planen blev IKKE sluppet',
      falsk.antal('subscriptionSchedules.release') === slip,
      `${falsk.antal('subscriptionSchedules.release') - slip} release`)
    const e = await abo(sub)
    tjek('  abonnementet blev IKKE opsagt', e?.opsagt === false && !e.stoppet,
      JSON.stringify(e))
    tjek('  og planen er nu bekræftet i basen', e?.planStatus === 'konfigureret')
    tjek('  kunden beholder sin overgang til normalprisen',
      falsk.planer.get(e!.plan!)?.status === 'active',
      `status=${falsk.planer.get(e!.plan!)?.status}`)
  }

  console.log('\n══ 10b · en FORKERT plan slippes stadig ══')
  {
    // Modproeven. Ville rettelsen ovenfor have slaaet beskyttelsen fra,
    // ville DEN her blive groen ved at lade vaere med at goere noget.
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('10b')
    const sub = `sub_10b_${S}`
    const planId = `sub_sched_10b_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false, schedule: planId })
    // ÉN fase til introprisen og ingen overgang: praecis den plan, der
    // ville forny til 9 kr. igen og igen. Den STYRER abonnementet —
    // ellers er der intet at slippe, og afsnittet måler ikke det, det
    // hedder.
    falsk.planer.set(planId, {
      id: planId, konfigureret: true, status: 'active', subscription: sub,
      phases: [{ start_date: 1_700_000_000, end_date: 1_700_086_400,
                 items: [{ price: OPS.introPrisId, quantity: 1 }] }],
    })
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil: new Date(Date.now() + 30 * 60_000),
      stripeScheduleId: planId, planStatus: 'oprettet', planForsoeg: 1,
    })
    const r = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    tjek('en plan uden overgang til normalprisen STOPPER fornyelsen',
      r === 'stoppet', `r=${r}`)
    tjek('  planen blev sluppet', falsk.planer.get(planId)?.status === 'released')
    const e = await abo(sub)
    tjek('  og det står i basen med sin grund', !!e?.stoppet && !!e.grund)
  }

  console.log('\n══ 10c · normalprisen røres ALDRIG af beskyttelsen ══')
  {
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('10c')
    const sub = `sub_10c_${S}`
    // En helt almindelig kunde paa 349 kr./28 dage: hun kom aldrig
    // gennem introprisen, saa der er ingen plan og INGEN planStatus.
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      stripePriceId: OPS.normalPrisId,
      adgangTil: new Date(Date.now() + 5 * 60_000),   // fornyelse om fem minutter
    })
    const linjer = await betalingstilsyn(OPS)
    const e = await abo(sub)
    tjek('hun bliver ikke opsagt', e?.opsagt === false, JSON.stringify(e))
    tjek('  fornyelsen er ikke stoppet', !e?.stoppet)
    // Tæl ALT, ikke to navngivne metoder. Hed assertionen «der blev
    // ikke kaldt noget», mens den tælte to ting, ville et tredje kald
    // — fx et opslag af abonnementet — glide igennem usagt.
    tjek('  der blev ikke kaldt noget hos Stripe om hende',
      falsk.kald.filter((k) => k.args[0] === sub).length === 0,
      JSON.stringify(falsk.kald.filter((k) => k.args[0] === sub).map((k) => k.metode)))
    tjek('  og tilsynet nævner hende slet ikke',
      !linjer.some((l) => l.includes(sub)), JSON.stringify(linjer))
  }

  console.log('\n══ 11 · afstemningen stempler ikke fremtiden ══')
  {
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    await db.delete(stripeEvents)
    const u = await bruger('11')
    const kunde = `cus_11_${S}`
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    const sub = gennemfoerHosStripe(r0!.sid!)
    falsk.sessioner.get(r0!.sid!)!.customer = kunde
    falsk.sessioner.get(r0!.sid!)!.client_reference_id = u
    await startKoebFor(u, '/')                  // flytter raekken til gennemfoert
    await db.update(checkoutForsoeg).set({ stripeSubscriptionId: null })
      .where(eq(checkoutForsoeg.id, r0!.id))

    const a = await afstemGennemfoerteKoeb(OPS)
    tjek('afstemningen bogfører abonnementet', a.afstemte === 1, JSON.stringify(a))

    // Webhooken var nede. Nu kommer de ÆGTE hændelser — oprettet FØR
    // afstemningen. De maa ikke afvises som foraeldede.
    const foer = nu() - 3600
    await post(h('checkout.session.completed',
      { id: r0!.sid!, subscription: sub, client_reference_id: u, customer: kunde }, foer))
    await post(faktura(sub, nu() + 86400, OPS.introPrisId, kunde, foer))
    const e = await abo(sub)
    tjek('  status er spejlet, ikke afvist som forældet',
      e?.status === 'active', `status=${e?.status}`)
    const [pris] = await db.select({ p: subscriptions.stripePriceId,
      slut: subscriptions.currentPeriodEnd })
      .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  prisen er spejlet', pris?.p === OPS.introPrisId, `pris=${pris?.p}`)
    tjek('  og perioden er spejlet — «næste betaling» er ikke ukendt',
      pris?.slut !== null)
  }

  console.log('\n══ 12 · uafklarede tæller ikke de gennemførte med ══')
  {
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('12')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    gennemfoerHosStripe(r0!.sid!)
    const l = await lukAlleAabneKoeb()
    tjek('den gennemførte tælles ÉN gang — som gennemført',
      l.gennemfoerte === 1, JSON.stringify(l))
    tjek('  og ikke også som uafklaret', l.uafklarede === 0, JSON.stringify(l))
    tjek('  den tælles heller ikke som lukket', l.lukkede === 0, JSON.stringify(l))
  }

  console.log('\n══ 13 · en introfaktura afsluttes ikke uden Stripe-opsætning ══')
  {
    // Genindført. Afsnittet stod i runde2 og blev slettet, da 3c blev
    // skrevet om — og dermed stod `if (!ops && prisId) return
    // 'afventer'` (lib/webhook.ts) helt uden prøve. Uden den linje
    // markeres hændelsen færdig, nyttelasten kasseres, introflaget
    // tages aldrig, planen bliver aldrig lagt, og abonnementet fornyes
    // til introprisen HVER DAG. Det var anden gennemgangs fund 2.
    falsk.nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    await db.delete(stripeEvents)
    const u = await bruger('13')
    const sub = `sub_13_${S}`
    const kunde = `cus_13_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await post(h('checkout.session.completed',
      { id: `cs_13_${S}`, subscription: sub, client_reference_id: u, customer: kunde }))

    const f = faktura(sub, nu() + 86400, OPS.introPrisId, kunde)
    const udfald = await behandl(f, null)
    tjek('uden opsætning svarer den AFVENTER', udfald === 'afventer', `udfald=${udfald}`)
    tjek('  men adgangen ER skrevet — kunden har betalt',
      !!(await abo(sub))?.adgang)
    const [e] = await db.select({ b: stripeEvents.behandletAt, n: stripeEvents.nyttelast })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  hændelsen er ikke markeret færdig', e?.b === null, `behandletAt=${e?.b}`)
    tjek('  og nyttelasten er bevaret, så tilsynet kan tage den op',
      e?.n !== null)

    // Med opsætningen på plads bliver den færdig, og planen lagt.
    const igen = await behandl(f, OPS)
    const r = await abo(sub)
    tjek('  med opsætning bliver den færdig og planen lagt',
      r?.planStatus === 'konfigureret',
      `udfald=${igen} planStatus=${r?.planStatus}`)
    const [e2] = await db.select({ b: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  og hændelsen er nu færdig', e2?.b !== null)
  }

  console.log('\n══ 14 · et DØDT abonnement lukker forsøget som afbrudt ══')
  {
    // Grenen havde ingen prøve. Den er den ene af tre udgange fra
    // afstemningen, og den, der giver kontoen lov til at købe igen.
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('14')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    const sub = gennemfoerHosStripe(r0!.sid!)
    await startKoebFor(u, '/')          // flytter rækken til gennemfoert
    // Abonnementet er dødt hos os — opsagt, udløbet, hvad som helst.
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'canceled',
    })
    const a = await afstemGennemfoerteKoeb(OPS)
    const [r1] = await forsoegFor(u)
    tjek('forsøget lukkes som AFBRUDT, ikke betalt', r1?.status === 'afbrudt',
      `status=${r1?.status} · ${JSON.stringify(a)}`)
    tjek('  og kontoen må købe igen', (await startKoebFor(u, '/')).ok)
  }

  console.log('\n══ 15 · kan fornyelsen ikke stoppes, SIGER tilsynet det ══')
  {
    // ⚠⚠-linjen havde heller ingen prøve. Den er det eneste, der
    // fortæller et menneske, at beskyttelsen IKKE greb — og at
    // abonnementet derfor fornyes til introprisen, til nogen gør noget.
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('15')
    const sub = `sub_15_${S}`
    const planId = `sub_sched_15_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false, schedule: planId })
    falsk.planer.set(planId, {
      id: planId, konfigureret: true, status: 'active', subscription: sub,
      phases: [{ start_date: 1_700_000_000, end_date: 1_700_086_400,
                 items: [{ price: OPS.introPrisId, quantity: 1 }] }],
    })
    const adgangTil = new Date(Date.now() + 30 * 60_000)
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, status: 'active',
      adgangTil, stripeScheduleId: planId,
      // Forsøgene er brugt op, så `laegManglendePlaner` ikke selv
      // afgør den, før beskyttelsen når at prøve.
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret 500',
    })
    falsk.fejlPaa.add('subscriptionSchedules.release')
    const linjer = await betalingstilsyn(OPS)
    tjek('tilsynet siger med ⚠⚠, at der IKKE blev grebet ind',
      linjer.some((l) => l.includes('⚠⚠') && l.includes(sub)
        && l.includes('IKKE grebet ind')), JSON.stringify(linjer))
    const r = await abo(sub)
    // ── FELTET SKIFTEDE BETYDNING; PÅSTANDEN GJORDE IKKE ──
    // Her stod `!r?.stoppet`: feltet `fornyelse_stoppet_at` skulle
    // være tomt, fordi det BETØD «fornyelsen er stoppet».
    //
    // Det betyder nu «VI har besluttet at stoppe den», og det skrives
    // før de eksterne kald — ellers kan et fejlet indgreb ikke
    // genoptages: afstemningen udleder sin hensigt af netop det felt,
    // og stod det til sidst, var det null præcis på fejlvejen. Så blev
    // skylden ryddet ved næste afstemning uden ét Stripe-kald, med
    // planen stadig aktiv. (Målt; se runde 5.)
    //
    // Prøvens EGEN hensigt er uændret og måles skarpere end før: ingen
    // må PÅSTÅ, at fornyelsen er stoppet. Påstanden bor to steder —
    // driftsrapportens linje og «Mit abonnement» — og begge spørges nu
    // direkte. Oven i kommer den egenskab, fejlen kostede: beslutningen
    // skal være forankret, så arbejdet kan tages op igen.
    tjek('  driftsrapporten PÅSTÅR ikke, at fornyelsen er stoppet',
      !linjer.some((l) => l.includes(sub) && l.includes('fornyes ikke')),
      JSON.stringify(linjer.filter((l) => l.includes(sub))))
    tjek('  men den siger, at den er BESLUTTET og ubekræftet',
      linjer.some((l) => l.includes(sub) && l.includes('BESLUTTET stoppet')),
      JSON.stringify(linjer.filter((l) => l.includes(sub))))
    const side = await abonnementForBruger(u)
    tjek('  «Mit abonnement» siger ikke «fornyelse stoppet»',
      side?.fornyelseStoppet === false && side?.fornyesIkke === false,
      JSON.stringify(side))
    tjek('  beslutningen er FORANKRET, så indgrebet kan genoptages',
      !!r?.stoppet, `stoppet=${r?.stoppet}`)
    tjek('  og der står en skyld, som afstemningen kan tage op',
      !!(await skyld(sub)), 'ingen afstemning_skyldig_at')
    tjek('  abonnementet er ikke opsagt hos Stripe',
      falsk.abonnementer.get(sub)?.cancel_at_period_end !== true)
    tjek('  KUNDENS BETALTE ADGANG ER UROERT',
      r?.adgang?.getTime() === adgangTil.getTime())
  }

  console.log('\n══ 16 · afstemningen bogfører på VORES bruger, ikke Stripes svar ══')
  {
    // `client_reference_id` er noget, vi selv sendte — men den kommer
    // tilbage gennem Stripe. Vandt den over `checkout_forsoeg.user_id`,
    // kunne et svar udefra bestemme, hvilken konto et abonnement
    // bogføres på.
    await nulstil()
    await db.delete(checkoutForsoeg); await db.delete(subscriptions)
    const u = await bruger('16')
    const fremmed = await bruger('16x')
    await startKoebFor(u, '/')
    const [r0] = await forsoegFor(u)
    const sub = gennemfoerHosStripe(r0!.sid!)
    // Stripe svarer med en ANDEN brugers id.
    falsk.sessioner.get(r0!.sid!)!.client_reference_id = fremmed
    await startKoebFor(u, '/')
    await db.update(checkoutForsoeg).set({ stripeSubscriptionId: null })
      .where(eq(checkoutForsoeg.id, r0!.id))

    await afstemGennemfoerteKoeb(OPS)
    const [ejer] = await db.select({ b: subscriptions.userId })
      .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('abonnementet bogføres på RÆKKENS bruger', ejer?.b === u,
      `ejer=${ejer?.b} vores=${u} fremmed=${fremmed}`)
  }
}

try {
  await koer()
} catch (e) {
  // En kastet fejl i ét afsnit maa ikke tie om resten. Optællingen
  // skrives stadig, og det STAAR, at prøven blev afbrudt — i stedet
  // for en rå TypeError og en tavs, uafsluttet liste.
  fejl++
  console.log(`\n  ✗ PRØVEN BLEV AFBRUDT: ${(e as Error).message}`)
  console.log('    De resterende afsnit blev IKKE kørt.')
}
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
