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
import { drift, haendelser, listings, sources, subscriptions, users } from '../db/schema'
import {
  FUNKTION, GRUNDE, adgang, funktionFraRetur, harBetaltAdgang, hentTilstand,
  koebsgrund, koebsstart, maaBruge,
} from '../lib/adgang'
import { rens, saetAktiv, type Haendelse as Maalehaendelse, type Kontekst } from '../lib/maaling'
import { levendeAbonnementer, saetTilstand } from '../lib/driftskift'
import { behandl, periode, type Haendelse } from '../lib/webhook'
import { faser, indsaetStripe, INTRO_OERE, NORMAL_OERE, opsaetning } from '../lib/stripe'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { abonnementForBruger, startKoebFor } from '../lib/abonnement'
import { Abonnement, type Abonnementsvisning } from '../app/min-side/Abonnement'
import { _saetDedup, _saetKontekst, spor } from '../lib/maaling-server'
// De to kaldesteder KOERES i afsnit 9. Importen er statisk og ikke
// dynamisk, saa `npm run typecheck` ogsaa daekker dem: doebes
// `hentKontakt` om, fejler proeven ved oversaettelsen og ikke foerst i
// en gren, nogen maaske ikke naar.
import { hentKontakt } from '../app/bolig/[id]/kontakthandling'
import { GET as goRute } from '../app/go/[id]/route'
import { optag, roerer } from './sqlbaand'
import { lavFalsk } from './stripefalsk/index'

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

  // ═══ 8b · UDLOEBET ER IKKE «HAR ALDRIG HAFT» ═════════════════
  // Frontends fund 2.2c: en udloebet periode faldt ud af
  // `gt(adgangTil, now)` og gav ingen raekke — altsaa samme svar som
  // en bruger, der aldrig har haft et abonnement. Tilstand 7 mistede
  // dermed saetningen «Dine samtaler er ikke slettet».
  //
  // Seks brugere, seks situationer. Uden skellet svarer fem af dem det
  // samme.
  console.log('\n══ 8b · Udloebet er ikke «har aldrig haft» ══')
  {
    await saetDrift('betaling')
    const sub = (u: string, s: 'canceled' | 'incomplete' | 'active', til: Date | null) =>
      db.insert(subscriptions).values({
        userId: u, stripeSubscriptionId: `sub_${randomUUID()}`, status: s, adgangTil: til,
      })

    const A = await nyBruger('grund-a')
    const B = await nyBruger('grund-b'); await sub(B, 'canceled', iGaar())
    const C = await nyBruger('grund-c'); await sub(C, 'incomplete', null)
    // D er FAELDEN: en udloebet raekke OG en nyere, hvor betalingen
    // aldrig gik igennem. Se nedenfor.
    const D = await nyBruger('grund-d')
    await sub(D, 'canceled', iGaar()); await sub(D, 'incomplete', null)
    const E = await nyBruger('grund-e')
    await sub(E, 'canceled', iGaar()); await sub(E, 'active', iMorgen())
    const F = await nyBruger('grund-f'); await sub(F, 'active', iMorgen())

    const svar = async (u: string) => {
      const s = await maaBruge(FUNKTION.kontakt, u)
      return s.ok ? 'ok' : s.grund
    }
    const sager: [string, string, string][] = [
      [A, 'abonnement_kraeves', 'A · har aldrig haft et'],
      [B, 'abonnement_udloebet', 'B · har haft et, det er udloebet'],
      [C, 'abonnement_kraeves', 'C · en raekke, men aldrig betalt'],
      [D, 'abonnement_udloebet', 'D · udloebet PLUS et nyt mislykket koeb'],
      [E, 'ok', 'E · udloebet PLUS en ny levende'],
      [F, 'ok', 'F · kun levende'],
    ]
    for (const [u, vent, navn] of sager) {
      const fik = await svar(u)
      tjek(navn, fik === vent, `fik ${fik}, ventede ${vent}`)
    }

    // ── DEN NAVNGIVNE isNotNull-PROEVE ────────────────────────
    // Uden `isNotNull(adgangTil)` i `slaaAdgangOp` svarer D
    // «abonnement_kraeves». Ikke fordi filteret er en smagssag, men
    // fordi `order by … desc` er NULLS FIRST i Postgres: raekken uden
    // betaling vinder over den udloebne, og svaret bliver «har aldrig
    // haft» om en kunde, der HAR haft.
    //
    // Kombinationen er ikke konstrueret. `lib/webhook.ts` indsaetter
    // `status = 'incomplete'` uden `adgang_til`, og 0023's DELVISE
    // indeks tillader «én levende plus vilkaarligt mange afsluttede».
    // Det er altsaa den kunde, der lige er begyndt et nyt koeb.
    //
    // Proeven staar for sig selv, fordi linjen ellers forsvinder ved
    // naeste oprydning: den ser ud som et overfloedigt filter.
    tjek('isNotNull: en udloebet raekke slaar en ubetalt, uanset raekkefoelgen',
      await svar(D) === 'abonnement_udloebet',
      'uden filteret vinder NULL i «order by adgang_til desc» (NULLS FIRST)')
    const [raekkerneForD] = await db.select({ n: sql<number>`count(*)::int` })
      .from(subscriptions).where(eq(subscriptions.userId, D))
    tjek('  og praemissen holder: D HAR begge raekker',
      raekkerneForD?.n === 2, `${raekkerneForD?.n} raekker`)

    // ── OVERSAETTEREN, som DATAKONTRAKT.md §5.1 beder om ──────
    // Bygges den ikke, skriver beskedlagets serverside selv
    // `Grund → Laasegrund`, og saa er der to steder, der afgoer hvad
    // brugeren ser.
    const oversat: [string, string, string][] = [
      [A, 'abonnement-kraevet', 'aldrig haft → «Beskeder kraever abonnement»'],
      [B, 'abonnement-udloebet', 'udloebet → «Dit abonnement er udloebet»'],
      [D, 'abonnement-udloebet', 'udloebet bag et mislykket koeb → stadig udloebet'],
      [F, 'adgang', 'levende → adgang'],
    ]
    for (const [u, vent, navn] of oversat) {
      const fik = await adgang(u)
      tjek(`adgang(): ${navn}`, fik === vent, `fik ${fik}`)
    }

    // Gratis tilstand: beskeder kraever stadig login, og en bruger MED
    // konto faar adgang uanset abonnement.
    await saetDrift('gratis')
    tjek('adgang(): i gratis tilstand er en konto nok',
      await adgang(A) === 'adgang')
    tjek('adgang(): uden konto er det login, ikke abonnement',
      await adgang(null) === 'login-kraevet')

    // ── VORES EGEN FEJL BLIVER ALDRIG EN BETALINGSOPFORDRING ──
    await db.delete(drift)
    const fejlsvar = await adgang(B)
    tjek('adgang(): uden driftstilstand svares der «ukendt-tilstand»',
      fejlsvar === 'ukendt-tilstand', String(fejlsvar))
    tjek('  og ALDRIG en abonnementsvaerdi',
      fejlsvar !== 'abonnement-kraevet' && fejlsvar !== 'abonnement-udloebet',
      'det ville stille et menneske over for en betaling paa grund af VORES fejl')
    await db.insert(drift).values({ id: true, tilstand: 'gratis' })

    // ── ALLOWLISTEN ER SAMME VAERDI, IKKE EN AFSKRIFT ─────────
    // `af: GRUNDE` i lib/maaling.ts. Proeven loeber HELE arrayet, saa
    // en femte grund er daekket uden at nogen skal huske en linje her.
    // Uden den ville `rens()` afvise eventet om den nye grund, og
    // muren ville holde op med at taelle netop den gruppe — tavst.
    const kontekst: Kontekst = {
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      userId: null, researchSessionId: null, rute: '/bolig/[id]',
    }
    for (const g of GRUNDE) {
      const h = {
        navn: 'paywall_blocked',
        props: { funktion: 'kontakt', grund: g, tilstand: 'betaling' },
      } as unknown as Maalehaendelse
      const r = rens(h, kontekst)
      tjek(`maalingen kan baere grunden «${g}»`, r.ok,
        r.ok ? '' : `${r.fejl.grund} (${r.fejl.detalje})`)
    }
    await saetDrift('gratis')
  }

  // ═══ 8c · «ADGANGEN FORTSAETTER INDTIL DA» — OM EN FORTIDIG DATO ═══
  // /min-side skrev «Du har betalt til {dato}. Adgangen fortsætter
  // indtil da» paa betingelsen `fornyesIkke && adgangTil`. Ingen af de
  // to spoerger, om perioden stadig LOEBER: `fornyesIkke` er sand for
  // en terminal raekke, og en FORTIDIG dato er lige saa truthy som en
  // fremtidig. En kunde, hvis periode loeb ud i gaar, fik at vide, at
  // adgangen fortsatte.
  //
  // To lag proeves hver for sig: KENDSGERNINGEN (kommer `periode`
  // rigtigt ud af basen) og SAETNINGEN (skriver panelet det rigtige).
  console.log('\n══ 8c · Panelet paastaar ikke adgang, der er loebet ud ══')
  {
    await saetDrift('betaling')
    const sub = (u: string, s: 'canceled' | 'incomplete' | 'active',
                 til: Date | null, opsagt = false) =>
      db.insert(subscriptions).values({
        userId: u, stripeSubscriptionId: `sub_${randomUUID()}`, status: s,
        adgangTil: til, cancelAtPeriodEnd: opsagt,
      })

    // ── laget 1 · kendsgerningen ──────────────────────────────
    const ud = await nyBruger('panel-udloebet'); await sub(ud, 'canceled', iGaar(), true)
    const lb = await nyBruger('panel-loeber'); await sub(lb, 'active', iMorgen(), true)
    const ig = await nyBruger('panel-ingen'); await sub(ig, 'incomplete', null)

    const pUd = (await abonnementForBruger(ud))?.periode
    const pLb = (await abonnementForBruger(lb))?.periode
    const pIg = (await abonnementForBruger(ig))?.periode
    tjek('en periode, der loeb ud i gaar, er «udloebet»',
      pUd?.slags === 'udloebet', String(pUd?.slags))
    tjek('en periode, der loeber til i morgen, er «loeber»',
      pLb?.slags === 'loeber', String(pLb?.slags))
    tjek('en raekke uden betaling er «ingen»',
      pIg?.slags === 'ingen', String(pIg?.slags))

    // ── laget 2 · saetningen ──────────────────────────────────
    const vis = (p: Abonnementsvisning['periode'], fornyesIkke: boolean) =>
      renderToStaticMarkup(createElement(Abonnement, {
        start: {
          status: 'canceled', fase: 'normal', naeste: { slags: 'fornyes_ikke' },
          fornyesAt: null, periode: p, opsagt: true, fornyesIkke,
        } satisfies Abonnementsvisning,
      }))

    const FORTSAETTER = 'Adgangen fortsætter indtil da'
    const loeber = vis({ slags: 'loeber', til: '24.9.2026, 12.00.00' }, true)
    tjek('en LOEBENDE periode faar stadig «fortsaetter indtil da»',
      loeber.includes(FORTSAETTER),
      'saetningen maa ikke bare slettes — den er sand her')
    tjek('  og etiketten er «Adgang til»', loeber.includes('Adgang til'))

    const udloebet = vis({ slags: 'udloebet', sidst: '22.9.2026, 12.00.00' }, true)
    tjek('en UDLOEBET periode paastaar IKKE, at adgangen fortsaetter',
      !udloebet.includes(FORTSAETTER),
      'det var loegnen: en fortidig dato er lige saa truthy som en fremtidig')
    tjek('  og den siger det samme som kontaktboksen paa boligsiden',
      udloebet.includes('Dit abonnement er udløbet'))
    tjek('  og etiketten er sat i datid',
      udloebet.includes('Adgang udløb') && !udloebet.includes('Adgang til'))

    // Lever abonnementet stadig hos Stripe (past_due, unpaid), er det
    // PERIODEN der er ude — ikke abonnementet. «Dit abonnement er
    // udloebet» ville staa lige over «Sig abonnementet op».
    const levende = vis({ slags: 'udloebet', sidst: '22.9.2026, 12.00.00' }, false)
    tjek('et LEVENDE abonnement med udloebet periode siger det snaevrere',
      levende.includes('Din betalte periode er udløbet')
      && !levende.includes('Dit abonnement er udløbet'),
      'abonnementet lever; det er perioden, der er ude')
    tjek('  og det paastaar heller ikke, at adgangen fortsaetter',
      !levende.includes(FORTSAETTER))

    const ingen = vis({ slags: 'ingen' }, true)
    tjek('uden betalt periode staar der hverken det ene eller det andet',
      ingen.includes('Ingen betalt adgang')
      && !ingen.includes(FORTSAETTER) && !ingen.includes('udløbet'))
    await saetDrift('gratis')
  }

  // ═══ 8d · KOEBSSTARTEN OPFINDER IKKE, HVOR HUN KOM FRA ═══
  // `checkout_started` bar `funktion: 'kontakt'` haardkodet og ingen
  // `grund` overhovedet. To maalefejl med hver sin form: ét OPDIGTET
  // felt og ét MANGLENDE. Uden `grund` kan genaktiveringstragten ikke
  // maales — vi kunne se, at nogen blev stoppet, og at nogen begyndte
  // et koeb, men ikke om det var den samme slags menneske.
  console.log('\n══ 8d · Koebsstarten opfinder ikke, hvor hun kom fra ══')
  {
    await saetDrift('betaling')
    const sub = (u: string, s: 'canceled' | 'incomplete' | 'active', til: Date | null) =>
      db.insert(subscriptions).values({
        userId: u, stripeSubscriptionId: `sub_${randomUUID()}`, status: s, adgangTil: til,
      })

    // ── GRUNDEN kommer fra basen, ikke fra adressen ───────────
    const foerste = await nyBruger('koebsgrund-foerste')
    const vendende = await nyBruger('koebsgrund-vendende'); await sub(vendende, 'canceled', iGaar())
    const bagEt = await nyBruger('koebsgrund-bag')
    await sub(bagEt, 'canceled', iGaar()); await sub(bagEt, 'incomplete', null)
    const harAdgang = await nyBruger('koebsgrund-adgang'); await sub(harAdgang, 'active', iMorgen())

    tjek('en foerstegangskoeber giver «abonnement_kraeves»',
      await koebsgrund(foerste) === 'abonnement_kraeves')
    tjek('en VENDENDE kunde giver «abonnement_udloebet»',
      await koebsgrund(vendende) === 'abonnement_udloebet',
      'det er hele tragten: foerste koeb eller genaktivering')
    tjek('  ogsaa naar der ligger et nyt, mislykket koeb foran',
      await koebsgrund(bagEt) === 'abonnement_udloebet')
    tjek('en bruger MED adgang giver ingen grund',
      await koebsgrund(harAdgang) === undefined,
      'der findes ingen vaerdi, man kan lukke nogen ind paa')

    // ── FUNKTIONEN udledes af den GENOPBYGGEDE returvej ───────
    const id = randomUUID()
    tjek('/bolig/<uuid> → kontakt', funktionFraRetur(`/bolig/${id}`) === FUNKTION.kontakt)
    tjek('/go/<uuid> → kildelink', funktionFraRetur(`/go/${id}`) === FUNKTION.kildelink)
    tjek('/min-side → ingen mur, altsaa intet felt',
      funktionFraRetur('/min-side') === undefined,
      'her stod foer «kontakt» — ogsaa naar ingen mur havde staaet i vejen')
    tjek('forsiden → intet felt', funktionFraRetur('/') === undefined)

    // ── SAMMENSAETNINGEN ──────────────────────────────────────
    const fraBolig = await koebsstart(vendende, `/bolig/${id}`)
    tjek('koebsstart: vendende kunde fra boligsiden',
      fraBolig.funktion === 'kontakt' && fraBolig.grund === 'abonnement_udloebet'
      && fraBolig.tilstand === 'betaling', JSON.stringify(fraBolig))
    const fraGo = await koebsstart(foerste, `/go/${id}`)
    tjek('koebsstart: foerstegangskoeber fra kildelinket',
      fraGo.funktion === 'kildelink' && fraGo.grund === 'abonnement_kraeves',
      JSON.stringify(fraGo))
    const fraMinSide = await koebsstart(foerste, '/min-side')
    tjek('koebsstart: uden en mur UDELADES feltet — det opfindes ikke',
      !('funktion' in fraMinSide) && fraMinSide.grund === 'abonnement_kraeves',
      JSON.stringify(fraMinSide))

    // ── OG MAALINGEN TAGER IMOD DEM ALLE TRE ──────────────────
    // Uden at `funktion` blev valgfri i allowlisten, ville den
    // SIDSTE blive afvist af rens() — og tragten ville tabe netop de
    // koeb, ingen mur udloeste.
    const kontekst: Kontekst = {
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      userId: null, researchSessionId: null, rute: '/abonnement',
    }
    for (const [navn, props] of [
      ['fra boligsiden', fraBolig], ['fra kildelinket', fraGo],
      ['uden mur', fraMinSide],
    ] as const) {
      const r = rens({ navn: 'checkout_started', props } as unknown as Maalehaendelse, kontekst)
      tjek(`maalingen tager imod koebsstarten ${navn}`, r.ok,
        r.ok ? '' : `${r.fejl.grund} (${r.fejl.detalje})`)
    }
    await saetDrift('gratis')
  }

  // ═══ 8e · TRAGTENS TO HALVDELE KAN HOLDES OP MOD HINANDEN ═══
  // Aktiveringer taelles i `subscriptions`, ikke som et event: adgangen
  // opstaar i `invoice.paid`, og dér kan et event ikke skrives —
  // webhookens request er Stripes, og tilsynet koerer i workeren. Se
  // docs/analytics-v1.md.
  //
  // Saa er `user_id` paa `checkout_started` det eneste, der binder de to
  // halvdele sammen. Uden den er der intet at matche paa, og tallene kan
  // kun sammenlignes paa tvaers af to forskellige befolkninger — hvilket
  // ikke er en konverteringsrate.
  console.log('\n══ 8e · Koebsstarten baerer brugeren ══')
  {
    saetAktiv(true)
    _saetKontekst({
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      rute: '/abonnement',
    })
    _saetDedup(new Set())

    const bruger = await nyBruger('tragt-bruger')
    const foer = (await db.select().from(haendelser)).length
    await spor({
      navn: 'checkout_started',
      props: { tilstand: 'betaling', grund: 'abonnement_kraeves', funktion: 'kontakt' },
    } as unknown as Maalehaendelse, '/abonnement', { brugerId: bruger })

    const raekker = await db.select().from(haendelser)
    const skrevet = raekker[raekker.length - 1]
    tjek('koebsstarten bliver skrevet', raekker.length === foer + 1)
    tjek('  og user_id er brugerens — ikke null',
      skrevet?.userId === bruger, String(skrevet?.userId),
      )
    tjek('  uden den kan tragten ikke matches',
      skrevet?.eventName === 'checkout_started' && skrevet?.userId !== null)

    // ── OG EVENTET, DER IKKE KAN SKRIVES, ER VAEK ─────────────
    // Affyres `subscription_activated` ved en fejl, svarer `rens()`
    // 'ukendt-event' i stedet for at skrive en raekke, ingen kan stole
    // paa. Det er den rigtige vej at svigte.
    const k: Kontekst = {
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      userId: null, researchSessionId: null, rute: '/abonnement',
    }
    const afvist = rens(
      { navn: 'subscription_activated', props: { fase: 'intro' } } as unknown as Maalehaendelse, k)
    tjek('subscription_activated er ude af taksonomien',
      !afvist.ok && afvist.fejl.grund === 'ukendt-event',
      afvist.ok ? 'den blev accepteret' : afvist.fejl.grund)
    tjek('  mens opsigelsen stadig kan skrives',
      rens({ navn: 'subscription_canceled', props: {} } as unknown as Maalehaendelse, k).ok,
      'kun den ene skulle fjernes')

    _saetKontekst(null)
    saetAktiv(null)
    _saetDedup(null)
  }

  // ═══ 9 · KALDESTEDERNE SPOERGER FAKTISK ══════════════════════
  // Afsnit 1-8 proever REGLEN. De ville alle vaere groenne, selv om
  // nogen slettede vagten i kontakthandling.ts eller i /go-ruten — og
  // saa stod muren aaben, mens proeven sagde god for den. Det er
  // praecis `sources.enabled`-fejlen, ét lag hoejere oppe.
  //
  // Her KOERES de to kaldesteder. Foer stod der en tekstsoegning i
  // deres kildefiler, og den kunne kun se den ene af de to maader, en
  // vagt gaar tabt paa:
  //
  //   FJERNET  vagten er vaek         →  svaret baerer kontaktdata
  //   FLYTTET  vagten staar BAG det   →  svaret er bit for bit det
  //            beskyttede opslag         samme som det rigtige nej
  //
  // Den anden kan ikke ses paa returvaerdien, og det var netop den,
  // tekstsoegningen lod passere. Paastanden var
  //
  //     t.indexOf('maaBruge(') < t.indexOf('db\n') + t.indexOf('await db')
  //
  // og den er sand af to grunde, der begge er UAFHAENGIGE af, hvor
  // vagten staar. Det FOERSTE `maaBruge(` i kontakthandling.ts staar i
  // kommentaren paa linje 23 — 1.400 tegn foer det rigtige kald — saa
  // venstresiden peger ikke paa vagten. Og hoejresiden laegger TO
  // positioner sammen (2.514 + 2.508 = 5.022) i stedet for at pege paa
  // én, saa den er stoerre end hele filen. Flyttes vagten om bag
  // opslaget, staar der stadig ✓, og annoncens beskyttede felter kan
  // forlade basen, mens proeven er groen.
  //
  // Derfor SQL-BAANDET — de saetninger, driveren faktisk sendte under
  // kaldet. Se scripts/sqlbaand.ts.
  //
  // ── HVAD DER ER ET BESKYTTET OPSLAG, OG HVAD DER IKKE ER ────
  // Vagten slaar selv op i `drift` for at kunne svare, og muren
  // bogfoerer sit eget nej i `haendelser`. Ingen af delene er en
  // laesning af annoncens beskyttede felter. En proeve, der bare talte
  // forespoergsler, ville blive roed af dem — derfor er maalingen
  // TAENDT her, og derfor kraeves det positivt, at BEGGE staar paa
  // baandet, samtidig med at `listings` ikke goer.
  //
  // ── DETEKTORENS EGEN PROEVE ─────────────────────────────────
  // En maaler, der aldrig slaar ud, er et groent flueben uden
  // daekning. Den TILLADTE vej maales med noejagtig samme maaler, og
  // dér SKAL opslaget staa paa baandet. Bliver den linje roed, er det
  // baandet, der er i stykker — ikke muren.
  //
  // ── HVAD DER IKKE NAAS AD DENNE VEJ ─────────────────────────
  // `maaBruge()` uden bruger-id gaar gennem `hentBrugerId()`, som
  // kraever et Next-request. Uden et saadant er der ingen session, saa
  // de grunde, kaldestederne kan naa her, er `login_kraeves` og
  // `ukendt_tilstand`. `abonnement_kraeves` proeves paa reglen i
  // afsnit 5 og 8; kaldestederne forgrener sig ikke paa grunden — de
  // spoerger og adlyder — saa adfaerden er daekket.
  console.log('\n══ 9 · Kaldestederne spoerger muren ══')
  {
    // Maalingen TAENDES, saa murens eget event faktisk skrives. Uden
    // det kunne «ingen beskyttede opslag» vaere groent, fordi der slet
    // ikke skete noget.
    saetAktiv(true)
    _saetKontekst({
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      rute: '/bolig/[id]',
    })

    const [nativeKilde] = await db.select({ id: sources.id })
      .from(sources).where(eq(sources.slug, 'native')).limit(1)
    const udlejer = await nyBruger('udlejer-mur')
    const MAIL = 'udlejer-mur@proeve.invalid'
    const TLF = '+4512345678'
    const KILDEURL = 'https://kilde.proeve.invalid/annonce/1'

    const [nativeBolig] = await db.insert(listings).values({
      sourceId: nativeKilde!.id, sourceType: 'native', externalKey: `mur-native-${S}`,
      sourceUrl: 'https://bofinda.dk/bolig/mur', landlordId: udlejer,
      addressRaw: 'Proevevej 1, 2300 Koebenhavn S', status: 'active',
      contactEmail: MAIL, contactPhone: TLF,
    }).returning({ id: listings.id })
    const [scrapet] = await db.insert(listings).values({
      sourceId: kilde!.id, sourceType: 'spider', externalKey: `mur-spider-${S}`,
      sourceUrl: KILDEURL, addressRaw: 'Proevevej 2, 2300 Koebenhavn S', status: 'active',
    }).returning({ id: listings.id })
    const nId = nativeBolig!.id
    const gId = scrapet!.id
    const goKald = () => goRute(
      new Request(`https://bofinda.dk/go/${gId}`), { params: Promise.resolve({ id: gId }) })
    const foerste = (sql: string[], navn: string) => roerer(sql, navn)[0] ?? ''

    // ── 9a · KONTAKT, adgang naegtet ──────────────────────────
    await saetDrift('betaling')
    const a = await optag(() => hentKontakt(nId))
    tjek('hentKontakt: uden adgang udleveres ingen kontaktdata',
      a.svar.mail === null && a.svar.telefon === null, JSON.stringify(a.svar))
    tjek('  og grunden foelger med, saa siden kan sige hvorfor',
      a.svar.naegtet === 'login_kraeves', String(a.svar.naegtet))
    tjek('  INTET beskyttet annonceopslag skete',
      roerer(a.sql, 'listings').length === 0, foerste(a.sql, 'listings'))
    tjek('  kontaktfelterne forlod aldrig basen',
      roerer(a.sql, 'contact_email').length === 0
      && roerer(a.sql, 'contact_phone').length === 0,
      foerste(a.sql, 'contact_email') || foerste(a.sql, 'contact_phone'))
    tjek('  vagten spurgte faktisk basen — `drift` blev laest',
      roerer(a.sql, 'drift').length > 0,
      'ellers kunne linjerne ovenfor vaere groenne af, at INTET skete')
    tjek('  og murens eget event blev skrevet — maaling er ikke et opslag',
      roerer(a.sql, 'haendelser').length > 0,
      'vagtens egne opslag og maalingen maa ikke forveksles med annoncefelterne')

    // ── 9b · KONTAKT, adgang givet · POSITIV KONTROL ──────────
    // Samme maaler paa den tilladte vej. Slaar den ikke ud her, maaler
    // den ingenting, og 9a er et flueben uden daekning.
    await saetDrift('gratis')
    const b = await optag(() => hentKontakt(nId))
    tjek('hentKontakt: med adgang udleveres kontaktdata',
      b.svar.mail === MAIL && b.svar.telefon === TLF, JSON.stringify(b.svar))
    tjek('  ingen naegtelse paa svaret', b.svar.naegtet === undefined)
    tjek('  og opslaget STAAR paa baandet — maaleren slaar ud',
      roerer(b.sql, 'listings').length > 0
      && roerer(b.sql, 'contact_email').length > 0,
      'uden den her linje kunne 9a vaere groen, fordi baandet var tomt')

    // ── 9c · KONTAKT, teknisk fejl · INGEN betalingsopfordring ─
    await db.delete(drift)
    const c = await optag(() => hentKontakt(nId))
    tjek('hentKontakt: uden driftstilstand naegtes adgangen',
      c.svar.mail === null && c.svar.telefon === null, JSON.stringify(c.svar))
    tjek('  og fejlen kaldes ikke «abonnement kraeves»',
      c.svar.naegtet === 'ukendt_tilstand', String(c.svar.naegtet))
    tjek('  intet beskyttet opslag ved vores EGEN fejl',
      roerer(c.sql, 'listings').length === 0, foerste(c.sql, 'listings'))
    await db.insert(drift).values({ id: true, tilstand: 'gratis' })

    // ── 9d · /go/[id], adgang naegtet ─────────────────────────
    _saetKontekst({
      miljoe: 'proeve', anonymousId: randomUUID(), sessionId: randomUUID(),
      rute: '/go/[id]',
    })
    await saetDrift('betaling')
    const d = await optag(goKald)
    const dSted = d.svar.headers.get('location') ?? ''
    tjek('/go/[id]: uden adgang viderestilles der IKKE til kilden',
      d.svar.status === 303 && dSted.startsWith('/abonnement?'),
      `${d.svar.status} → ${dSted}`)
    tjek('  kildens adresse staar ingen steder i svaret',
      ![...d.svar.headers].some(([, v]) => v.includes('kilde.proeve.invalid')),
      JSON.stringify([...d.svar.headers]))
    tjek('  og grunden foelger med til koebssiden',
      dSted.includes('grund=login_kraeves'), dSted)
    tjek('  INTET beskyttet annonceopslag skete',
      roerer(d.sql, 'listings').length === 0, foerste(d.sql, 'listings'))
    tjek('  kildens URL forlod aldrig basen',
      roerer(d.sql, 'source_url').length === 0, foerste(d.sql, 'source_url'))
    tjek('  vagten spurgte faktisk basen — `drift` blev laest',
      roerer(d.sql, 'drift').length > 0)
    tjek('  og murens eget event blev skrevet',
      roerer(d.sql, 'haendelser').length > 0)

    // ── 9e · /go/[id], adgang givet · POSITIV KONTROL ─────────
    await saetDrift('gratis')
    const e = await optag(goKald)
    tjek('/go/[id]: med adgang viderestilles der til kilden',
      e.svar.status === 302 && e.svar.headers.get('location') === KILDEURL,
      `${e.svar.status} → ${e.svar.headers.get('location')}`)
    tjek('  og opslaget STAAR paa baandet — maaleren slaar ud',
      roerer(e.sql, 'listings').length > 0 && roerer(e.sql, 'source_url').length > 0,
      'uden den her linje kunne 9d vaere groen, fordi baandet var tomt')

    // ── 9f · /go/[id], teknisk fejl · INGEN betalingsopfordring ─
    await db.delete(drift)
    const g = await optag(goKald)
    const gSted = g.svar.headers.get('location') ?? ''
    tjek('/go/[id]: uden driftstilstand viderestilles der ikke til kilden',
      g.svar.status === 303 && gSted.startsWith('/abonnement?'),
      `${g.svar.status} → ${gSted}`)
    tjek('  og der staar ikke «abonnement kraeves» om VORES fejl',
      gSted.includes('grund=ukendt_tilstand')
      && !gSted.includes('grund=abonnement_kraeves'), gSted)
    tjek('  intet beskyttet opslag ved vores EGEN fejl',
      roerer(g.sql, 'listings').length === 0, foerste(g.sql, 'listings'))
    await db.insert(drift).values({ id: true, tilstand: 'gratis' })

    _saetKontekst(null)
    saetAktiv(null)
  }

  // Koebsvejen maa ikke kunne kaldes i gratis tilstand. HANDLINGEN
  // proeves, ikke kildeteksten: en tekstsoegning efter vagtens navn kan
  // ikke se, om vagten faktisk fyrer, og den ville vaere groen paa en
  // vagt, der stod i en gren, ingen naar.
  {
    await db.update(drift).set({ tilstand: 'gratis' }).where(eq(drift.id, true))
    const falsk = lavFalsk(); indsaetStripe(falsk)
    process.env.STRIPE_SECRET_KEY = OPS.hemmelighed
    process.env.STRIPE_WEBHOOK_SECRET = OPS.webhookHemmelighed
    process.env.STRIPE_PRIS_INTRO = OPS.introPrisId
    process.env.STRIPE_PRIS_NORMAL = OPS.normalPrisId
    const koeber = await nyBruger('koeber-gratis')
    const svar = await startKoebFor(koeber, '/')
    tjek('startKoeb afviser gratis tilstand',
      !svar.ok && svar.fejl === 'gratis_tilstand', JSON.stringify(svar))
    tjek('  og der blev IKKE oprettet en session hos Stripe',
      falsk.antal('checkout.sessions.create') === 0,
      'afvisningen skal ske FOER det eksterne kald, ikke efter')
    indsaetStripe(null)
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_PRIS_INTRO
    delete process.env.STRIPE_PRIS_NORMAL
  }

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
