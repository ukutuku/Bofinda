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
const { startKoebFor } = await import('../lib/abonnement')
const { saetTilstand } = await import('../lib/driftskift')
const { behandl } = await import('../lib/webhook')
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

  /** En lille aftale mellem to tråde: A venter, til B siger til. */
  function aftale() {
    let slip: () => void = () => {}
    const naaet = new Promise<void>((r) => { slip = r })
    return { naaet, slip }
  }

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
    //  3 · skiftet tager låsen, lukker reservationen, skriver GRATIS
    //  4 · Stripe svarer, og købet står med en session i gratis tilstand
    // Punkt 4 er hele prøven: sessionen må ikke blive betalbar.
    const iStripe = aftale()      // købet er nået til Stripe
    const maaFortsaette = aftale() // skiftet er færdigt
    const rigtig = (falsk.checkout as { sessions: { create: (p: unknown, o?: unknown) => Promise<unknown> } })
      .sessions.create
    ;(falsk.checkout as { sessions: { create: unknown } }).sessions.create =
      async (p: unknown, o?: unknown) => {
        iStripe.slip()
        await maaFortsaette.naaet
        return rigtig(p, o)
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
    const aabne = await db.select({ id: checkoutForsoeg.id }).from(checkoutForsoeg)
      .where(eq(checkoutForsoeg.status, 'aaben'))
    console.log(`     køb=${JSON.stringify(k)} · skift=${JSON.stringify(s)}`)
    console.log(`     tilstand=${d?.t} · betalbare sessioner=${betalbare.length} · åbne rækker=${aabne.length}`)

    tjek('skiftet gik igennem', s.ok, JSON.stringify(s))
    tjek('  købet ender som gratis_tilstand, ikke som en gyldig url',
      !k.ok && k.fejl === 'gratis_tilstand', JSON.stringify(k))
    tjek('  ALDRIG gratis tilstand OG en betalbar session', betalbare.length === 0,
      'det var hele grunden til vagten')
    tjek('  købet udløb selv sin egen session hos Stripe',
      falsk.antal('checkout.sessions.expire') === 1,
      `${falsk.antal('checkout.sessions.expire')} expire-kald`)
    tjek('  og der er ingen åben reservation tilbage', aabne.length === 0)
    tjek('  tilstanden er gratis', d?.t === 'gratis')
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
} finally {
  await luk()
  await adm.unsafe(`drop database if exists "${NAVN}" with (force)`)
  console.log(`\n  ${NAVN} slettet igen`)
  await adm.end()
}

console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
