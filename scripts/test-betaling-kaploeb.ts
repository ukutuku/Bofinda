// ═══════════════════════════════════════════════════════════════
//  Kapløbene — på RIGTIG, isoleret PostgreSQL.
//
//  De andre betalingsprøver kører mod PGlite. PGlite er rigtig
//  PostgreSQL, men den er ÉN forbindelse i én proces: to «samtidige»
//  transaktioner serialiseres, før de når hinanden. En prøve for et
//  kapløb kan derfor ikke måle noget dér — den ville være grøn,
//  uanset om vagten fandtes.
//
//  Her er der flere forbindelser mod en server, der selv afgør
//  rækkefølgen. Det er det eneste sted, `for share`/`for update` på
//  drift-rækken og det delvise entydighedsindeks på checkout_forsoeg
//  kan bevises.
//
//  ── ISOLATION ───────────────────────────────────────────────
//  Prøven opretter sin EGEN database i den lokale testklynge, kører
//  de rigtige migrationer i den, og sletter den igen til sidst. Den
//  rører ikke `bofinda_test` og ikke noget andet. Målet efterprøves
//  mod den faktiske forbindelse, før der skrives — værnet nedenfor
//  afviser alt, der ikke er loopback på testporten.
//
//      scripts/cloud/db-op.sh          # rejser klyngen
//      npm run test:kaploeb
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { stubSupabase, koerMigrationer } from './pglite-skema.mjs'

// ── VAERNET · maalet efterproeves paa den FAKTISKE forbindelse ──
const PORT = '55432'
const grundUrl = process.env.BOFINDA_TESTBASE_URL ?? process.env.DATABASE_URL_DIRECT
if (!grundUrl) {
  console.error('FEJL: saet BOFINDA_TESTBASE_URL til den isolerede testbase.')
  console.error('      scripts/cloud/db-op.sh rejser den; miljoe.sh har strengen.')
  process.exit(1)
}
{
  const u = new URL(grundUrl)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port !== PORT) {
    console.error(`FEJL: ${u.hostname}:${u.port} er ikke den isolerede testbase (loopback:${PORT}).`)
    process.exit(1)
  }
}

const NAVN = `bofinda_kaploeb_${process.pid}`
const adm = postgres(grundUrl, { ssl: false, max: 1, onnotice: () => {} })
{
  const svar = await adm`select current_database() as db, current_user as bruger`
  const { db: hvor, bruger } = svar[0] as unknown as { db: string; bruger: string }
  if (!/^bofinda_test$/.test(hvor as string)) {
    console.error(`FEJL: forbundet til «${hvor}» — forventede bofinda_test som udgangspunkt.`)
    process.exit(1)
  }
  console.log(`  udgangspunkt: ${bruger}@${hvor} · opretter ${NAVN}`)
}
await adm.unsafe(`drop database if exists "${NAVN}"`)
await adm.unsafe(`create database "${NAVN}"`)

const url = (() => { const u = new URL(grundUrl); u.pathname = `/${NAVN}`; return u.toString() })()

// db/client.ts laeser miljoeet ved FOERSTE forespoergsel, ikke ved
// import. Den skal saettes, foer noget her roerer basen.
process.env.DATABASE_URL_DIRECT = url
delete process.env.DATABASE_URL
delete process.env.NEXT_RUNTIME
delete process.env.VERCEL

{
  const s = postgres(url, { ssl: false, max: 1, onnotice: () => {} })
  const som = { exec: (t: string) => s.unsafe(t).simple() }
  await stubSupabase(som)
  const n = await koerMigrationer(som)
  console.log(`  ${NAVN}: ${n} migrationer kørt (journalens rækkefølge)`)
  await s.end()
}

const OPS = { hemmelighed: 'sk_test_x', webhookHemmelighed: 'whsec_x',
  introPrisId: 'price_intro', normalPrisId: 'price_normal' }
process.env.STRIPE_SECRET_KEY = OPS.hemmelighed
process.env.STRIPE_WEBHOOK_SECRET = OPS.webhookHemmelighed
process.env.STRIPE_PRIS_INTRO = OPS.introPrisId
process.env.STRIPE_PRIS_NORMAL = OPS.normalPrisId
process.env.NEXT_PUBLIC_BASE_URL = 'https://proeve.invalid'

const { and, eq, sql } = await import('drizzle-orm')
const { db, luk, raekker } = await import('../db/client')
const { checkoutForsoeg, drift, stripeEvents, subscriptions, users } =
  await import('../db/schema')
const { startKoebFor, sigOpFor } = await import('../lib/abonnement')
const { saetTilstand } = await import('../lib/driftskift')
const { behandl, laegPlan, betalingstilsyn, stopForkertFornyelse } = await import('../lib/webhook')
type Haendelse = Parameters<typeof behandl>[0]
const { indsaetStripe } = await import('../lib/stripe')
const { lavFalsk } = await import('./stripefalsk/index')

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

const falsk = lavFalsk()
indsaetStripe(falsk)

const nu = () => Math.floor(Date.now() / 1000)
const h = (type: string, obj: Record<string, unknown>, created?: number): Haendelse =>
  ({ id: `evt_${randomUUID()}`, type, created: created ?? nu(), data: { object: obj } })

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`kp${n}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `kp${n}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

try {
  const [her] = raekker<{ hvor: string }>(await db.execute(sql`select current_database() as hvor`))
  const hvor = her?.hvor
  tjek(`prøven skriver i ${NAVN}`, hvor === NAVN, `current_database()=${hvor}`)

  /** En lille aftale mellem to tråde: A venter, til B siger til. */
  function aftale() {
    let slip: () => void = () => {}
    const naaet = new Promise<void>((r) => { slip = r })
    return { naaet, slip }
  }

  // ═══ A · TO SAMTIDIGE KOEB PAA SAMME KONTO ═══════════════
  console.log('\n══ A · to samtidige køb — kun én reservation ══')
  {
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const u = await bruger('a')
    const svar = await Promise.all([startKoebFor(u, '/'), startKoebFor(u, '/')])
    const ok = svar.filter((x) => x.ok)

    // Bemaerk hvad der IKKE staar her: «præcis ét kald lykkes». To
    // samtidige klik maa gerne begge faa en url — hvis det er den
    // SAMME. Det er jo det samme koeb, aabnet i to vinduer, og et
    // pænere svar end en fejl. Foerste udgave af proeven kraevede ét
    // svar og var derfor roed paa en fuldstaendig rigtig opfoersel.
    tjek('mindst ét kald får en betalingsside', ok.length >= 1, JSON.stringify(svar))
    tjek('  og fik BEGGE en, er det den samme session',
      ok.length < 2 || (ok[0]!.ok && ok[1]!.ok && ok[0]!.url === ok[1]!.url),
      JSON.stringify(ok))
    tjek('  en afvisning er «køb i gang», ikke «Stripe fejlede»',
      svar.every((x) => x.ok || x.fejl === 'koeb_i_gang' || x.fejl === 'har_allerede'),
      JSON.stringify(svar.filter((x) => !x.ok)))
    const aabne = await db.select({ id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg)
      .where(and(eq(checkoutForsoeg.userId, u), eq(checkoutForsoeg.status, 'aaben')))
    tjek('  der står præcis én åben reservation', aabne.length === 1, `${aabne.length} åbne`)
    tjek('  og der blev oprettet HØJST én session hos Stripe',
      falsk.udfoerte('checkout.sessions.create') <= 1,
      `${falsk.udfoerte('checkout.sessions.create')} oprettelser`)
    const levende = [...falsk.sessioner.values()].filter((x) => x.status === 'open')
    tjek('  vinderens session er stadig betalbar',
      ok.every((x) => x.ok && levende.some((l) => l.url === x.url)))
    tjek('  og taberen lukkede ikke vinderens session',
      falsk.antal('checkout.sessions.expire') === 0,
      `${falsk.antal('checkout.sessions.expire')} expire-kald`)
  }

  // ═══ B · KOEB MOD GRATIS-SKIFT ═══════════════════════════
  //
  // Det farlige udfald er ÉT: gratis tilstand OG en betalbar session.
  // De to afsnit nedenfor stiller kapløbet op i begge rækkefølger med
  // SIGNALER i stedet for ventetider: en `sleep` ville måle en
  // rækkefølge, vi håber på, og være grøn den dag maskinen er hurtig.

  console.log('\n══ B1 · reservationen er skrevet, mens skiftet kommer ══')
  {
    falsk.nulstil(); falsk.sessioner.clear()
    await db.delete(checkoutForsoeg)
    await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('b1adm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('b1')

    // Den farligste rækkefølge, præcist stillet op:
    //  1 · købet committer sin reservation — og slipper dermed låsen
    //  2 · købet kalder Stripe, og HOLDER dér
    //  3 · skiftet tager låsen og ser en reservation UDEN sessions-id
    //  4 · Stripe svarer, og der står en session, ingen forventede
    //
    // Prøven målte før, at skiftet gik IGENNEM, og at købet derefter
    // udløb sin egen session. Det var for optimistisk: den gren
    // hviler på, at `expire` LYKKES, og gør den ikke det, står man med
    // gratis tilstand og en betalbar side. Det var gennemgangens
    // scenarie C. Nu AFVISES skiftet i stedet, og det er den rigtige
    // rækkefølge: først finde ud af, hvad der sker, så skrive.
    const iStripe = aftale()
    const maaFortsaette = aftale()
    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => {
        iStripe.slip(); await maaFortsaette.naaet; return rigtig(p, o)
      }

    const koeb = startKoebFor(u, '/')
    await iStripe.naaet
    const laaste = await db.select({ id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben'))
    tjek('reservationen er committet, FØR Stripe blev kaldt',
      laaste.length === 1 && laaste[0]!.sid === null,
      `${laaste.length} åbne, session=${laaste[0]?.sid}`)

    const s = await saetTilstand('gratis', admin, 'kapløb B1')
    maaFortsaette.slip()
    const k = await koeb
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig

    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    const betalbare = [...falsk.sessioner.values()].filter((x) => x.status === 'open')
    console.log(`     køb=${JSON.stringify(k)} · skift=${JSON.stringify(s)}`)
    console.log(`     tilstand=${d?.t} · betalbare sessioner=${betalbare.length}`)

    tjek('skiftet AFVISES — et tomt sessions-id er ikke bevis for, at intet kører',
      !s.ok && s.fejl === 'aabne_koeb', JSON.stringify(s))
    tjek('  købet lykkes, for skiftet vandt ikke', k.ok, JSON.stringify(k))
    tjek('  ALDRIG gratis tilstand OG en betalbar session',
      !(d?.t === 'gratis' && betalbare.length > 0),
      'det var hele grunden til vagten')
    tjek('  tilstanden er UROERT', d?.t === 'betaling', `tilstand=${d?.t}`)

    // Og skiftet er ikke spærret for evigt: nu HAR rækken et
    // sessions-id, og næste forsøg kan lukke den hos Stripe.
    const s2 = await saetTilstand('gratis', admin, 'andet forsøg')
    const [d2] = await db.select({ t: drift.tilstand }).from(drift)
    const betalbare2 = [...falsk.sessioner.values()].filter((x) => x.status === 'open')
    tjek('næste forsøg går igennem, når sessionen er kendt', s2.ok, JSON.stringify(s2))
    tjek('  sessionen blev udløbet hos Stripe',
      falsk.antal('checkout.sessions.expire') === 1,
      `${falsk.antal('checkout.sessions.expire')} expire-kald`)
    tjek('  og der er ingen betalbar session tilbage', betalbare2.length === 0)
    tjek('  tilstanden er nu gratis', d2?.t === 'gratis')
  }

  console.log('\n══ B2 · skiftet holder låsen, mens købet forsøger ══')
  {
    falsk.nulstil(); falsk.sessioner.clear()
    await db.delete(checkoutForsoeg)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const u = await bruger('b2')

    // Skiftet efterlignes af en RÅ transaktion, der holder præcis den
    // lås, `saetTilstand()` tager. Det er den eneste måde at holde
    // låsen fast, mens noget andet prøver — og det er dét, `for share`
    // i `startKoebFor()` skal støde på.
    const raa = postgres(url, { ssl: false, max: 1, onnotice: () => {} })
    let koeb: ReturnType<typeof startKoebFor> | null = null
    await raa.begin(async (tx) => {
      await tx`select tilstand from drift where id = true for update`
      koeb = startKoebFor(u, '/')
      // Giv købet tid til at nå frem til låsen og blokere på den.
      await new Promise((r) => setTimeout(r, 150))
      const undervejs = await db.select({ id: checkoutForsoeg.id }).from(checkoutForsoeg)
        .where(eq(checkoutForsoeg.userId, u))
      tjek('købet kan IKKE reservere, mens låsen holdes', undervejs.length === 0,
        `${undervejs.length} rækker skrevet under låsen`)
      await tx`update drift set tilstand = 'gratis' where id = true`
    })
    const k = await koeb!
    await raa.end()

    tjek('købet ser den NYE tilstand, når låsen slippes',
      !k.ok && k.fejl === 'gratis_tilstand', JSON.stringify(k))
    tjek('  og Stripe blev slet ikke kaldt',
      falsk.antal('checkout.sessions.create') === 0,
      JSON.stringify(falsk.kald.map((x) => x.metode)))
    const aabne = await db.select({ id: checkoutForsoeg.id }).from(checkoutForsoeg)
      .where(eq(checkoutForsoeg.status, 'aaben'))
    tjek('  ingen reservation blev efterladt', aabne.length === 0)
  }

  // ═══ B3 · SKIFTET MOEDER ET GENNEMFOERT KOEB ═════════════
  console.log('\n══ B3 · gratis-skift mod et GENNEMFØRT køb ══')
  {
    falsk.nulstil(); falsk.sessioner.clear()
    await db.delete(checkoutForsoeg)
    await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('b3adm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('b3')
    const k = await startKoebFor(u, '/')
    tjek('købet lykkes', k.ok, JSON.stringify(k))

    // Kassen gennemføres hos Stripe. Webhooken er IKKE ankommet.
    const [r0] = await db.select({ sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.userId, u))
    const sess = falsk.sessioner.get(r0!.sid!)!
    sess.status = 'complete'
    sess.subscription = 'sub_b3'
    sess.payment_status = 'paid'

    const s = await saetTilstand('gratis', admin)
    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    console.log(`     skift=${JSON.stringify(s)}`)
    tjek('skiftet AFVISES — der er sandsynligvis betalt',
      !s.ok && s.fejl === 'gennemfoerte_koeb', JSON.stringify(s))
    tjek('  tilstanden er UROERT', d?.t === 'betaling', `tilstand=${d?.t}`)
    tjek('  og vi opsagde hende ikke selv',
      falsk.antal('subscriptions.cancel') === 0)
  }

  // ═══ B4 · SKIFT MOD ET KALD I LUFTEN, HVOR EXPIRE FEJLER ═
  // Gennemgangens scenarie C, men paa RIGTIG Postgres og med den
  // fejlende oprydning, deres probe efterlyste.
  console.log('\n══ B4 · skift mod et kald i luften — og expire fejler ══')
  {
    falsk.nulstil(); falsk.sessioner.clear()
    await db.delete(checkoutForsoeg)
    await db.delete(subscriptions)
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const admin = await bruger('b4adm')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
    const u = await bruger('b4')

    const iStripe = aftale()        // købet er nået ind i Stripe-kaldet
    const maaFortsaette = aftale()  // skiftet er færdigt
    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => {
        iStripe.slip(); await maaFortsaette.naaet; return rigtig(p, o)
      }

    const koeb = startKoebFor(u, '/')
    await iStripe.naaet
    const laaste = await db.select({ id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId })
      .from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben'))
    tjek('reservationen er committet UDEN sessions-id',
      laaste.length === 1 && laaste[0]!.sid === null,
      `${laaste.length} åbne, session=${laaste[0]?.sid}`)

    const s = await saetTilstand('gratis', admin, 'kapløb B4')
    // Oprydningen fejler, NÅR kaldet lander.
    falsk.fejlPaa.add('checkout.sessions.expire')
    maaFortsaette.slip()
    const k = await koeb
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create = rigtig

    const [d] = await db.select({ t: drift.tilstand }).from(drift)
    const betalbare = [...falsk.sessioner.values()].filter((x) => x.status === 'open')
    const aabne = await db.select({ id: checkoutForsoeg.id }).from(checkoutForsoeg)
      .where(eq(checkoutForsoeg.status, 'aaben'))
    console.log(`     skift=${JSON.stringify(s)}`)
    console.log(`     køb=${JSON.stringify(k)}`)
    console.log(`     tilstand=${d?.t} · betalbare=${betalbare.length} · åbne=${aabne.length}`)

    tjek('skiftet blev AFVIST, ikke meldt færdigt',
      !s.ok && s.fejl === 'aabne_koeb', JSON.stringify(s))
    tjek('  ALDRIG gratis tilstand OG en betalbar session',
      !(d?.t === 'gratis' && betalbare.length > 0),
      'det var hele grunden til vagten')
    tjek('  tilstanden er betaling', d?.t === 'betaling', `tilstand=${d?.t}`)
    tjek('  og reservationen står åben, så næste forsøg ser den',
      aabne.length === 1, `${aabne.length} åbne`)
  }

  // ═══ C · SAMME HAENDELSE, TO SAMTIDIGE BEHANDLERE ════════
  console.log('\n══ C · samme webhook-hændelse, to samtidige behandlere ══')
  {
    await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
    const u = await bruger('c')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_c`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }), OPS)
    const slut = nu() + 86400
    const f = h('invoice.paid', {
      subscription: sub, customer: kunde,
      lines: { data: [{ period: { start: nu(), end: slut },
        pricing: { price_details: { price: OPS.introPrisId } } }] },
    })
    const r = await Promise.allSettled([behandl(f, OPS), behandl(f, OPS), behandl(f, OPS)])
    const udfald = r.map((x) => x.status === 'fulfilled' ? x.value : 'kastede')
    tjek('kun ÉN behandler får kravet',
      udfald.filter((x) => x === 'behandlet').length === 1, JSON.stringify(udfald))
    const [e] = await db.select({ n: stripeEvents.forsoeg, b: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, f.id))
    tjek('  forsøgstælleren står på 1', e?.n === 1, `forsoeg=${e?.n}`)
    tjek('  og hændelsen er færdig', e?.b !== null)
    const [a] = await db.select({ til: subscriptions.adgangTil }).from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  adgangen er sat én gang, til fakturaens periodeslut',
      a?.til?.getTime() === slut * 1000)
  }

  // ═══ D · TO FAKTURAER SAMTIDIG — MONOTONIEN HOLDER ═══════
  console.log('\n══ D · to samtidige fakturaer — adgangen går kun frem ══')
  {
    const u = await bruger('d')
    const sub = `sub_${randomUUID()}`
    const kunde = `cus_d`
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }), OPS)
    const kort = nu() + 3600, lang = nu() + 28 * 86400
    const f = (slut: number) => h('invoice.paid', {
      subscription: sub, customer: kunde,
      lines: { data: [{ period: { start: nu(), end: slut },
        pricing: { price_details: { price: OPS.normalPrisId } } }] },
    })
    await Promise.allSettled([behandl(f(lang), OPS), behandl(f(kort), OPS)])
    const [a] = await db.select({ til: subscriptions.adgangTil }).from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('adgangen står på den LÆNGSTE af de to perioder',
      a?.til?.getTime() === lang * 1000,
      `adgang=${a?.til?.toISOString()} lang=${new Date(lang * 1000).toISOString()}`)
  }
  // ═══ E · TO SAMTIDIGE OPSIGELSER ════════════════════════
  console.log('\n══ E · to samtidige opsigelser — ét release, ét ja ══')
  {
    const u = await bruger('e')
    const sub = `sub_${randomUUID()}`
    const kunde = 'cus_e'
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }), OPS)
    await behandl(h('invoice.paid', {
      subscription: sub, customer: kunde,
      lines: { data: [{ period: { start: nu(), end: nu() + 86400 },
        pricing: { price_details: { price: OPS.introPrisId } } }] },
    }), OPS)
    const [foer] = await db.select({ plan: subscriptions.stripeScheduleId,
      planStatus: subscriptions.planStatus }).from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('planen er lagt og bekræftet',
      foer?.planStatus === 'konfigureret' && !!foer.plan, JSON.stringify(foer))

    // ── DOBBELTKLIK, MED VINDUET TVUNGET ÅBENT ────────────
    // Her stod `Promise.all([sigOpFor(u), sigOpFor(u)])` alene, og
    // assertionen tællede KALD: «der blev sluppet ÉN gang».
    //
    // Den prøve kunne ikke blive rød. `Promise.all` giver ingen
    // interleaving af sig selv: den første opsigelse når HELE vejen
    // gennem `retrieve → planGaelder → release`, før den anden
    // overhovedet når sit `planGaelder`. Målt både på PGlite og på
    // rigtig, isoleret PostgreSQL — med og uden rettelsen: «1 release,
    // begge ok». Prøven målte én bestemt planlægning, ikke egenskaben.
    // Det er den samme fælde, prøven selv advarer imod i B1/B2:
    // «SIGNALER i stedet for ventetider». §E brugte hverken det ene
    // eller det andet — den brugte håb.
    //
    // PORTEN åbner vinduet: begge kaldere får deres `retrieve`-svar,
    // og først når BEGGE har det, får nogen af dem lov at gå videre.
    // Så har de begge et `active`-øjebliksbillede i hånden, og de
    // kalder begge `release`. Det er ikke til at undgå uden
    // distribueret låsning, og det SKAL det heller ikke være.
    //
    // Derfor måler assertionen nu VIRKNING, ikke kaldtal: præcis ét
    // release tager effekt, ingen af de to melder fejl til kunden, og
    // forsøgstallet bevises at have været over ét — ellers åbnede
    // vinduet ikke, og prøven ville igen kun måle en planlægning.
    const port = (n: number) => {
      let kom = 0
      let slip: () => void = () => {}
      const alle = new Promise<void>((r) => { slip = r })
      return async () => {
        if (++kom >= n) slip()
        // Nødudgang efter et sekund: når planlægningen aldrig n
        // kaldere, skal prøven fejle på sin assertion — ikke hænge.
        await Promise.race([alle, new Promise((r) => setTimeout(r, 1000))])
      }
    }
    const hold = port(2)
    const rigtigHent = (falsk.subscriptionSchedules as
      { retrieve: (id: string) => Promise<unknown> }).retrieve
      .bind(falsk.subscriptionSchedules)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve =
      async (id: string) => {
        const svar = await rigtigHent(id)   // hent FØRST — snapshottet er taget
        await hold()                        // og hold, til den anden også har sit
        return svar
      }
    const slip0 = falsk.antal('subscriptionSchedules.release')
    const svar = await Promise.all([sigOpFor(u), sigOpFor(u)])
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = rigtigHent
    const forsoeg = falsk.antal('subscriptionSchedules.release') - slip0

    tjek('BEGGE svarer ok — ingen af dem ser en fejl',
      svar.every((x) => x.ok), JSON.stringify(svar))
    tjek('  vinduet var FAKTISK åbent — begge nåede at forsøge et release',
      forsoeg >= 2, `${forsoeg} release-forsøg`)
    const plan = falsk.planer.get(foer!.plan!)
    tjek('  men præcis ét TOG EFFEKT — planen er sluppet én gang',
      plan?.status === 'released' && plan?.released_subscription === sub
        && plan?.subscription == null,
      JSON.stringify({ status: plan?.status, released: plan?.released_subscription,
        subscription: plan?.subscription }))
    tjek('  planen er sluppet hos Stripe',
      falsk.planer.get(foer!.plan!)?.status === 'released')
    tjek('  og cancel_at_period_end er sat',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    const [e] = await db.select({
      opsagt: subscriptions.cancelAtPeriodEnd, opsagtAf: subscriptions.opsagtAfKundeAt,
      plan: subscriptions.stripeScheduleId, adgang: subscriptions.adgangTil,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  rækken står opsagt, uden binding',
      e?.opsagt === true && !!e.opsagtAf && e.plan === null, JSON.stringify(e))
    tjek('  og adgangen er URØRT', !!e?.adgang)
  }

  // ═══ E2 · TILSYNET TABER RELEASE-KAPLOEBET MOD KUNDEN ═══
  console.log('\n══ E2 · vores eget stop taber kapløbet mod hendes opsigelse ══')
  {
    // `stopForkertFornyelse` har sit EGET `retrieve → planGaelder →
    // release`. Det er det andet udtryk for samme spørgsmål — «må vi
    // slippe den her plan?» — og CLAUDE.md's egen regel siger, at to
    // sådanne driver fra hinanden. Rettelsen i runde 5 landede begge
    // steder; den her prøve er det, der holder dem sammen.
    //
    // Taber tilsynet, må det ikke svare «fejlede» og lade
    // `cancel_at_period_end` stå usat: det, det bad om, ER sket.
    const u = await bruger('e2')
    const sub = `sub_${randomUUID()}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: 'cus_e2' }), OPS)
    await behandl(h('invoice.paid', {
      subscription: sub, customer: 'cus_e2',
      lines: { data: [{ period: { start: nu(), end: nu() + 86400 },
        pricing: { price_details: { price: OPS.introPrisId } } }] },
    }), OPS)
    const [foer] = await db.select({ plan: subscriptions.stripeScheduleId })
      .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    // Fornyelsen er nær, og vores tilbagelæsning er tabt.
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planFejl: 'svaret gik tabt', planForsoeg: 5,
             adgangTil: new Date(Date.now() + 30 * 60_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    // HUN slipper planen, mens tilsynet holder sit snapshot.
    const rigtigHent = (falsk.subscriptionSchedules as
      { retrieve: (id: string) => Promise<unknown> }).retrieve
      .bind(falsk.subscriptionSchedules)
    let engang = false
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve =
      async (id: string) => {
        const svar = await rigtigHent(id)
        if (!engang) { engang = true; await sigOpFor(u) }
        return svar
      }
    const r = await stopForkertFornyelse(OPS, sub, 'prøvens egen grund')
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = rigtigHent

    tjek('tilsynet melder ikke fejl på et kapløb, det tabte',
      r !== 'fejlede', `r=${r}`)
    const plan = falsk.planer.get(foer!.plan!)
    tjek('  planen er sluppet præcis én gang',
      plan?.status === 'released' && plan?.subscription == null,
      JSON.stringify({ status: plan?.status, subscription: plan?.subscription }))
    tjek('  og fornyelsen ER stoppet hos Stripe',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    const [e2] = await db.select({
      opsagt: subscriptions.cancelAtPeriodEnd, opsagtAf: subscriptions.opsagtAfKundeAt,
      skyldig: subscriptions.afstemningSkyldigAt, adgang: subscriptions.adgangTil,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  rækken er enten afklaret eller stadig skyldig — aldrig tavs',
      e2?.opsagt === true || e2?.skyldig !== null, JSON.stringify(e2))
    tjek('  HENDES forfatterskab står', !!e2?.opsagtAf)
    tjek('  og adgangen er URØRT', !!e2?.adgang)
  }

  // ═══ E3 · «PLANEN ER BEKRAEFTET» OM EN PLAN, DER IKKE FINDES ═══
  console.log('\n══ E3 · planStatus «konfigureret» må aldrig stå uden en plan ══')
  {
    // Den inkonsistens, der blev målt på rigtig PostgreSQL:
    //   {opsagt: true, plan: null, planStatus: 'konfigureret'}
    // «Planen er bekræftet» om en plan, der ikke findes, på et
    // abonnement kunden har sagt op. Skrivningen i `laegPlan` er nu
    // betinget af, at ingen har besluttet noget — læsning og skrivning
    // er ÉT skridt i basen.
    const u = await bruger('e3')
    const sub = `sub_${randomUUID()}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: 'cus_e3' }), OPS)
    await db.update(subscriptions)
      .set({ planStatus: 'mangler', planForsoeg: 0, stripePriceId: OPS.introPrisId,
             adgangTil: new Date(Date.now() + 86_400_000),
             currentPeriodEnd: new Date(Date.now() + 86_400_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    // Hun siger op, mens `create` er i luften — det tætteste vindue.
    const rigtigOpret = (falsk.subscriptionSchedules as
      { create: (...a: unknown[]) => Promise<unknown> }).create
      .bind(falsk.subscriptionSchedules)
    let engang = false
    ;(falsk.subscriptionSchedules as Record<string, unknown>).create =
      async (...a: unknown[]) => {
        const svar = await rigtigOpret(...a)
        if (!engang) { engang = true; await sigOpFor(u) }
        return svar
      }
    await laegPlan(sub, OPS)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).create = rigtigOpret

    const [e3] = await db.select({
      plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
      opsagt: subscriptions.cancelAtPeriodEnd, skyldig: subscriptions.afstemningSkyldigAt,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('«konfigureret» står aldrig uden en plan',
      !(e3?.planStatus === 'konfigureret' && e3?.plan === null), JSON.stringify(e3))
    tjek('  og en uafklaret plan er ikke glemt — enten afklaret eller skyldig',
      e3?.skyldig !== null || (e3?.opsagt === true && e3?.plan === null),
      JSON.stringify(e3))
  }

  // ═══ F · OPSIGELSE MOD ET IGANGVAERENDE PLANKALD ═════════
  console.log('\n══ F · opsigelse mod et planlægningskald i luften ══')
  {
    const u = await bruger('f')
    const sub = `sub_${randomUUID()}`
    const kunde = 'cus_f'
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
    await behandl(h('checkout.session.completed',
      { subscription: sub, client_reference_id: u, customer: kunde }), OPS)
    // Planen skyldes, men er ikke lagt.
    await db.update(subscriptions)
      .set({ planStatus: 'mangler', planForsoeg: 0, stripePriceId: OPS.introPrisId,
             adgangTil: new Date(Date.now() + 86_400_000) })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    // Planlaegningen holdes inde i Stripe-kaldet, mens kunden siger op
    // paa en ANDEN forbindelse. Vagten oeverst i `laegPlan` har
    // allerede laest raekken; kun gentjekket bagefter kan fange det.
    const iStripe = aftale(); const erNaaet = aftale()
    const rigtig = (falsk.subscriptionSchedules as
      { update: (...a: unknown[]) => Promise<unknown> }).update
    ;(falsk.subscriptionSchedules as { update: unknown }).update =
      async (...a: unknown[]) => {
        erNaaet.slip(); await iStripe.naaet; return rigtig(...a)
      }
    const plan = laegPlan(sub, OPS)
    await erNaaet.naaet
    const opsagt = await sigOpFor(u)
    iStripe.slip()
    const planSvar = await plan
    ;(falsk.subscriptionSchedules as { update: unknown }).update = rigtig

    tjek('opsigelsen lykkes', opsagt.ok, JSON.stringify(opsagt))
    tjek('  og planlægningen svarer «opsagt», ikke «konfigureret»',
      planSvar === 'opsagt', `svar=${planSvar}`)
    const [f] = await db.select({
      plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
      opsagt: subscriptions.cancelAtPeriodEnd, adgang: subscriptions.adgangTil,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub))
    tjek('  ingen plan bliver stående på et opsagt abonnement',
      f?.plan === null && f.planStatus !== 'konfigureret', JSON.stringify(f))
    tjek('  ALLE planer på abonnementet er sluppet hos Stripe',
      [...falsk.planer.values()].filter((x) => x.subscription === sub).length === 0,
      JSON.stringify([...falsk.planer.values()].map((x) => [x.id, x.status, x.subscription])))
    tjek('  opsigelsen står', f?.opsagt === true)
    tjek('  og adgangen er urørt', !!f?.adgang)

    // Og tilsynet lægger den ikke tilbage bagefter.
    const create0 = falsk.antal('subscriptionSchedules.create')
    await betalingstilsyn(OPS)
    tjek('  tilsynet lægger ingen ny plan bagefter',
      falsk.antal('subscriptionSchedules.create') === create0,
      `${falsk.antal('subscriptionSchedules.create') - create0} nye`)
  }
} finally {
  await luk()
  await adm.unsafe(`drop database if exists "${NAVN}" with (force)`)
  console.log(`\n  ${NAVN} slettet igen`)
  await adm.end()
}

console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
