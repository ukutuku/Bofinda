// ═══════════════════════════════════════════════════════════════
//  Betalingsmuren, driftstilstanden og webhookens vagter.
//
//  Koeres af scripts/testbase.ts mod PGlite — rigtige migrationer,
//  ingen socket, ingen Stripe-forbindelse. Alt Stripe-indhold i filen
//  er SYNTETISKE objekter i Stripes form; intet her har vaeret i
//  kontakt med api.stripe.com, og proeven paastaar ikke andet. Se
//  rapportens afsnit «Manglende verifikation».
//
//  `maaBruge()` laeser sessionen gennem `hentBrugerId()` fra
//  lib/auth.ts, som kraever en Next-request. Den kan ikke koeres her,
//  saa proeven giver bruger-id'et MED — praecis som de rigtige
//  kaldesteder gør, naar de allerede har slaaet det op. Det, der
//  proeves, er reglen; ikke Supabases sessionslaesning.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { drift, listings, sources, subscriptions, users } from '../db/schema'
import { FUNKTION, harBetaltAdgang, hentTilstand, maaBruge } from '../lib/adgang'
import { levendeAbonnementer, saetTilstand } from '../lib/driftskift'
import { behandl, periode, type Haendelse } from '../lib/webhook'
import { faser, INTRO_OERE, NORMAL_OERE, opsaetning } from '../lib/stripe'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const S = Date.now()
const OPS = {
  hemmelighed: 'sk_test_ikke_en_rigtig_noegle',
  webhookHemmelighed: 'whsec_ikke_en_rigtig_noegle',
  introPrisId: 'price_intro_syntetisk',
  normalPrisId: 'price_normal_syntetisk',
}

async function authBruger(navn: string) {
  const id = randomUUID()
  await db.execute(sql`insert into auth.users (id, email)
    values (${id}, ${`bet-${navn}-${S}@proeve.invalid`}) on conflict (id) do nothing`)
  return id
}
async function nyBruger(navn: string, medKonto = true) {
  const [u] = await db.insert(users).values({
    email: `bet-${navn}-${S}@proeve.invalid`,
    ...(medKonto ? { authUserId: await authBruger(navn) } : {}),
  }).returning({ id: users.id })
  return u!.id
}
const saetDrift = (t: 'gratis' | 'betaling') =>
  db.update(drift).set({ tilstand: t }).where(eq(drift.id, true))

/** Et abonnement med BETALT adgang til et givet tidspunkt. */
async function medAdgang(bruger: string, til: Date, ekstra: Record<string, unknown> = {}) {
  const [a] = await db.insert(subscriptions).values({
    userId: bruger, stripeSubscriptionId: `sub_${randomUUID()}`,
    status: 'active', adgangTil: til, currentPeriodEnd: til, ...ekstra,
  }).returning({ id: subscriptions.id })
  return a!.id
}

const iMorgen = () => new Date(Date.now() + 86400000)
const iGaar = () => new Date(Date.now() - 86400000)

async function koer() {
  const [kilde] = await db.insert(sources).values({
    slug: `test-betaling-${S}`, name: 'Prøvekilde betaling', sourceType: 'spider',
  }).returning({ id: sources.id })

  // ═══ 1 · PRISMODELLEN ════════════════════════════════════════
  console.log('\n══ 1 · Prismodellen ══')
  tjek('intro er 9,00 kr.', INTRO_OERE === 900, `${INTRO_OERE} øre`)
  tjek('normal er 349,00 kr.', NORMAL_OERE === 34900, `${NORMAL_OERE} øre`)
  const f = faser(OPS)
  const f0 = f[0] as { items: { price: string }[]; duration?: { interval: string; interval_count?: number } }
  const f1 = f[1] as { items: { price: string }[]; duration?: unknown; proration_behavior?: string }
  tjek('fase 1 er introprisen i PRAECIS ét doegn',
    f0.items[0]!.price === OPS.introPrisId
    && f0.duration?.interval === 'day' && f0.duration?.interval_count === 1)
  tjek('fase 1 bruger duration, ikke det FJERNEDE iterations',
    !('iterations' in f[0]!),
    'iterations findes kun i SDK-CHANGELOG, ikke i nogen type')
  tjek('fase 2 er normalprisen og loeber videre',
    f1.items[0]!.price === OPS.normalPrisId && f1.duration === undefined)
  tjek('faseskiftet efterregulerer ikke', f1.proration_behavior === 'none')

  // ═══ 2 · GRATIS TILSTAND ═════════════════════════════════════
  console.log('\n══ 2 · GRATIS — uden Stripe og uden abonnement ══')
  await saetDrift('gratis')
  const uden = await nyBruger('gratis-uden-abo')
  tjek('tilstanden laeses som gratis', await hentTilstand() === 'gratis')
  tjek('Stripe er IKKE konfigureret i denne koersel', opsaetning() === null)

  const k1 = await maaBruge(FUNKTION.kontakt, uden)
  tjek('kontakt: adgang uden abonnement', k1.ok && k1.tilstand === 'gratis')
  const g1 = await maaBruge(FUNKTION.kildelink, uden)
  tjek('kildelink: adgang uden abonnement', g1.ok)
  const anonym = await maaBruge(FUNKTION.kontakt, null)
  tjek('kontakt: adgang UDEN login overhovedet', anonym.ok)

  // Beskeder kraever stadig login — gratis aendrer ikke kontoejerskab.
  const b1 = await maaBruge(FUNKTION.beskeder, uden)
  tjek('beskeder: login er nok i gratis', b1.ok)
  const b2 = await maaBruge(FUNKTION.beskeder, null)
  tjek('beskeder: UDEN login naegtes stadig',
    !b2.ok && b2.ok === false && b2.grund === 'login_kraeves')

  // ═══ 3 · BETALING ════════════════════════════════════════════
  console.log('\n══ 3 · BETALING — muren staar ══')
  await saetDrift('betaling')
  tjek('tilstanden laeses som betaling', await hentTilstand() === 'betaling')

  const k2 = await maaBruge(FUNKTION.kontakt, uden)
  tjek('kontakt uden abonnement naegtes',
    !k2.ok && k2.ok === false && k2.grund === 'abonnement_kraeves')
  const g2 = await maaBruge(FUNKTION.kildelink, uden)
  tjek('kildelink uden abonnement naegtes', !g2.ok)
  const a1 = await maaBruge(FUNKTION.kontakt, null)
  tjek('uden login naegtes med login_kraeves',
    !a1.ok && a1.ok === false && a1.grund === 'login_kraeves')

  const betalende = await nyBruger('betalende')
  await medAdgang(betalende, iMorgen())
  const k3 = await maaBruge(FUNKTION.kontakt, betalende)
  tjek('med betalt adgang: kontakt gives', k3.ok)
  const b3 = await maaBruge(FUNKTION.beskeder, betalende)
  tjek('med betalt adgang: beskeder gives', b3.ok)

  // ═══ 4 · UDLOEB OG OPSIGELSE ═════════════════════════════════
  console.log('\n══ 4 · Udloeb, opsigelse, mislykket fornyelse ══')
  const udloebet = await nyBruger('udloebet')
  await medAdgang(udloebet, iGaar(), { status: 'canceled' })
  tjek('udloebet adgang giver intet', !(await maaBruge(FUNKTION.kontakt, udloebet)).ok)
  tjek('harBetaltAdgang er null ved udloeb', await harBetaltAdgang(udloebet) === null)

  const opsagt = await nyBruger('opsagt')
  await medAdgang(opsagt, iMorgen(), { cancelAtPeriodEnd: true })
  tjek('OPSAGT men ikke udloebet: adgang bevares',
    (await maaBruge(FUNKTION.kontakt, opsagt)).ok,
    'opsigelse maa ikke laase en allerede betalt periode')

  // Mislykket fornyelse: status flyttes, adgangen staar stille.
  const fejlet = await nyBruger('fejlet-fornyelse')
  const fId = `sub_${randomUUID()}`
  await db.insert(subscriptions).values({
    userId: fejlet, stripeSubscriptionId: fId, status: 'active',
    adgangTil: iMorgen(), currentPeriodEnd: iMorgen(),
  })
  await behandl(haendelse('invoice.payment_failed', { subscription: fId }), OPS)
  const [efterFejl] = await db.select({
    status: subscriptions.status, adgang: subscriptions.adgangTil,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, fId))
  tjek('mislykket fornyelse: status bliver past_due', efterFejl?.status === 'past_due')
  tjek('mislykket fornyelse giver INGEN ny adgangsperiode',
    !!efterFejl?.adgang && efterFejl.adgang.getTime() < Date.now() + 86400000 + 5000,
    'adgangTil blev ikke flyttet frem')
  tjek('men den allerede betalte periode loeber ud',
    (await maaBruge(FUNKTION.kontakt, fejlet)).ok)

  // ═══ 5 · TILSTANDSSKIFT ══════════════════════════════════════
  console.log('\n══ 5 · Skift mellem tilstandene ══')
  const admin = await nyBruger('admin')
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin))
  const almindelig = await nyBruger('ikke-admin')

  const nej = await saetTilstand('gratis', almindelig)
  tjek('ikke-admin kan ikke skifte tilstand',
    !nej.ok && nej.fejl === 'ikke_admin')
  const nejAnonym = await saetTilstand('gratis', null)
  tjek('uden login kan ingen skifte tilstand',
    !nejAnonym.ok && nejAnonym.fejl === 'ikke_admin')

  const n = await levendeAbonnementer()
  const afvist = await saetTilstand('gratis', admin)
  tjek('skift til GRATIS afvises, naar der er levende abonnementer',
    !afvist.ok && afvist.fejl === 'levende_abonnementer', `${n} levende`)
  if (!afvist.ok && afvist.fejl === 'levende_abonnementer') {
    tjek('  og afvisningen siger hvor mange og hvorfor',
      afvist.antal === n && afvist.forklaring.includes('349')
      && afvist.forklaring.includes('opsig') === false
        ? afvist.forklaring.length > 80 : afvist.forklaring.length > 80)
  }
  tjek('tilstanden staar uroert efter afvisningen', await hentTilstand() === 'betaling')

  // Uden levende abonnementer gaar skiftet igennem.
  await db.update(subscriptions).set({ status: 'canceled' })
  const ja = await saetTilstand('gratis', admin, 'prøve')
  tjek('uden levende abonnementer gaar skiftet igennem', ja.ok)
  tjek('og tilstanden er nu gratis', await hentTilstand() === 'gratis')

  // Skift TIL betaling opretter ingenting.
  const foer = (await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions))[0]!.n
  await saetTilstand('betaling', admin)
  const efter = (await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions))[0]!.n
  tjek('skift til BETALING opretter ingen abonnementer', foer === efter, `${foer} → ${efter}`)
  tjek('gratis bruger er stadig uden adgang og uden raekke',
    await harBetaltAdgang(uden) === null)

  // ═══ 6 · WEBHOOKENS VAGTER ═══════════════════════════════════
  console.log('\n══ 6 · Webhooken: gentagelse, forsinkelse, adgang ══')
  const koeber = await nyBruger('koeber')
  const subId = `sub_${randomUUID()}`

  const kasse = haendelse('checkout.session.completed', {
    subscription: subId, client_reference_id: koeber, customer: `cus_${S}`,
  })
  tjek('kassen gennemfoert → raekke oprettet', await behandl(kasse, OPS) === 'behandlet')
  const [efterKasse] = await db.select({
    status: subscriptions.status, adgang: subscriptions.adgangTil,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId))
  tjek('  status er incomplete', efterKasse?.status === 'incomplete')
  tjek('  og den giver INGEN adgang', efterKasse?.adgang === null,
    'et gennemfoert kasseforloeb er ikke en betaling')
  tjek('  brugeren har stadig ingen adgang', await harBetaltAdgang(koeber) === null)

  tjek('samme haendelse igen er en gentagelse',
    await behandl(kasse, OPS) === 'gentagelse')

  // Betalt faktura → adgang.
  const slut = new Date(Date.now() + 24 * 3600 * 1000)
  const faktura = haendelse('invoice.paid', {
    subscription: subId,
    lines: { data: [{
      period: { start: Math.floor(Date.now() / 1000), end: Math.floor(slut.getTime() / 1000) },
      pricing: { price_details: { price: OPS.introPrisId } },
    }] },
  })
  tjek('betalt faktura behandles', await behandl(faktura, OPS) === 'behandlet')
  const [efterBetaling] = await db.select({
    status: subscriptions.status, adgang: subscriptions.adgangTil,
    pris: subscriptions.stripePriceId,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId))
  tjek('  adgangen sat til Stripes periodeslut',
    !!efterBetaling?.adgang
    && Math.abs(efterBetaling.adgang.getTime() - slut.getTime()) < 2000)
  tjek('  status er active', efterBetaling?.status === 'active')
  tjek('  prisen er introprisen', efterBetaling?.pris === OPS.introPrisId)
  const [brugerEfter] = await db.select({ intro: users.introBrugtAt })
    .from(users).where(eq(users.id, koeber))
  tjek('  introtilbuddet er brugt — af BETALINGEN, ikke af sidebesoeget',
    brugerEfter?.intro !== null)
  tjek('  og brugeren har nu adgang', (await maaBruge(FUNKTION.kontakt, koeber)).ok)

  // FORSINKET haendelse: aeldre stempel maa ikke genaabne noget.
  const udloebetSub = `sub_${randomUUID()}`
  const gammelBruger = await nyBruger('forsinket')
  await db.insert(subscriptions).values({
    userId: gammelBruger, stripeSubscriptionId: udloebetSub, status: 'canceled',
    adgangTil: iGaar(), stripeOpdateretAt: new Date(),
  })
  const gammel = haendelse('customer.subscription.updated', {
    id: udloebetSub, status: 'active',
    items: { data: [{ current_period_end: Math.floor(iMorgen().getTime() / 1000) }] },
  }, Math.floor(iGaar().getTime() / 1000))
  tjek('en FORSINKET haendelse afvises som foraeldet',
    await behandl(gammel, OPS) === 'forael')
  const [uaendret] = await db.select({ status: subscriptions.status, adgang: subscriptions.adgangTil })
    .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, udloebetSub))
  tjek('  det udloebne abonnement blev IKKE genaabnet',
    uaendret?.status === 'canceled' && !!uaendret.adgang && uaendret.adgang < new Date())

  // Perioden laeses fra ITEMET, ikke fra abonnementet.
  const p = periode({ items: { data: [{ current_period_end: 1800000000, current_period_start: 1700000000 }] } })
  tjek('perioden laeses fra items[0] (stripe@22 har den ikke paa Subscription)',
    p.slut?.getTime() === 1800000000000 && p.start?.getTime() === 1700000000000)

  // ═══ 7 · ÉN BRUGER, ÉT ABONNEMENT ════════════════════════════
  console.log('\n══ 7 · Ingen kan administrere en andens abonnement ══')
  const aBruger = await nyBruger('ejer-a')
  const bBruger = await nyBruger('ejer-b')
  await medAdgang(aBruger, iMorgen())
  tjek('B har ingen adgang af at A har betalt', await harBetaltAdgang(bBruger) === null)
  tjek('A har adgang', await harBetaltAdgang(aBruger) !== null)

  // Dobbeltklik: to LEVENDE raekker paa samme bruger er umuligt i basen.
  let toLevende = false
  try {
    await db.insert(subscriptions).values({
      userId: aBruger, stripeSubscriptionId: `sub_${randomUUID()}`,
      status: 'active', adgangTil: iMorgen(),
    })
    toLevende = true
  } catch { /* ventet: delvist unikt indeks */ }
  tjek('to LEVENDE abonnementer paa samme bruger afvises af basen', !toLevende,
    'vagten mod dobbeltklik ligger i skemaet, ikke kun i koden')

  // ═══ 8 · FEJL LUKKER, DEN AABNER IKKE ════════════════════════
  console.log('\n══ 8 · Kan tilstanden ikke laeses, naegtes adgangen ══')
  await db.delete(drift)
  tjek('uden en drift-raekke er tilstanden ukendt', await hentTilstand() === null)
  const ukendt = await maaBruge(FUNKTION.kontakt, betalende)
  tjek('og adgangen NAEGTES — ogsaa for en betalende bruger',
    !ukendt.ok && ukendt.ok === false && ukendt.grund === 'ukendt_tilstand')
  tjek('  fejlen kaldes ikke «abonnement kraeves»',
    !ukendt.ok && ukendt.grund !== 'abonnement_kraeves',
    'det ville sende et menneske til kassen paa grund af vores fejl')
  await db.insert(drift).values({ id: true, tilstand: 'gratis' })

  // ═══ 9 · KALDESTEDERNE SPOERGER FAKTISK ══════════════════════
  // Afsnit 1-8 proever REGLEN. De ville alle vaere groenne, selv om
  // nogen slettede vagten i kontakthandling.ts eller i /go-ruten —
  // og saa stod muren aaben, mens proeven sagde god for den. Det er
  // praecis `sources.enabled`-fejlen, ét lag hoejere oppe.
  //
  // Her laeses KILDEN til de to kaldesteder. Det er en svagere
  // proeve end en koersel, og det siges der: ruterne kan ikke kaldes
  // uden en Next-request. Men den fejler, hvis vagten forsvinder.
  console.log('\n══ 9 · Kaldestederne spoerger muren ══')
  const { readFileSync } = await import('node:fs')
  const kilder: [string, string][] = [
    ['app/bolig/[id]/kontakthandling.ts', 'FUNKTION.kontakt'],
    ['app/go/[id]/route.ts', 'FUNKTION.kildelink'],
  ]
  for (const [fil, funk] of kilder) {
    const t = readFileSync(fil, 'utf8')
    tjek(`${fil} kalder maaBruge(${funk})`,
      t.includes('maaBruge(') && t.includes(funk))
    tjek(`  og naegter FOER databasen roeres`,
      t.indexOf('maaBruge(') < t.indexOf('db\n') + t.indexOf('await db'),
      'opslaget maa ikke koere, naar adgangen er naegtet')
  }
  // Koebsvejen maa ikke kunne kaldes i gratis tilstand.
  const abo = readFileSync('lib/abonnement.ts', 'utf8')
  tjek('startKoeb afviser gratis tilstand',
    abo.includes("hentTilstand() !== 'betaling'") && abo.includes('gratis_tilstand'))

  void listings; void kilde
}

/** Et Stripe-haendelsesobjekt i rigtig form. Syntetisk indhold. */
function haendelse(type: string, obj: Record<string, unknown>, created?: number): Haendelse {
  return {
    id: `evt_${randomUUID()}`, type,
    created: created ?? Math.floor(Date.now() / 1000),
    data: { object: obj },
  }
}

await koer()
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
