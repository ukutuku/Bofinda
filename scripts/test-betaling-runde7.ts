// ═══════════════════════════════════════════════════════════════
//  Syvende gennemgangs tre fund, prøvet mod rettelserne.
//
//  Q1 · `afstemSkyldige` kørte køen UDEN beskyttelse pr. række.
//       Fejlede A's Stripe-opslag, og fejlede bogføringen AF den
//       fejl også, kastede `afstemAbonnement` — og løkken stoppede.
//       B og C fik nul forsøg i tre kørsler. Samme fejl som S5 i
//       søsterkøen, rettet ét sted og ikke det andet.
//  Q2 · sikkerhedsstoppet kvitterede UBETINGET, når det ikke selv
//       ejede en generation (`vorGen === null` valgte SQL `true`).
//       Det sker netop, når kunden nåede at gemme sin opsigelse,
//       mens stoppet var i luften — altså præcis når vi IKKE ejer
//       beslutningen. Manglende egen generation blev til ejerskab
//       over andres arbejde.
//  Q3 · fangsten om `noterOpsigelse` svarede altid «ikke gemt».
//       Skrivningen er ét statement, men SVARET kan gå tabt, efter
//       basen har committet. Så stod beslutningen, køen arbejdede
//       videre, tilsynet fuldførte opsigelsen — og kunden havde
//       fået at vide, at der IKKE var sket noget med abonnementet.
//
//  Databasefejlen injiceres gennem repoets EGEN seam, `indsaetBase`.
//  `db` er en Proxy, der altid henter den levende klient, så den kan
//  ikke lappes udefra. Samme kodevej som `testbase.ts` bruger.
//
//  ── HVAD DER ER MÅLT, OG HVAD DER ER MODELLERET ──────────────
//  Q1 og Q2 måles på rigtige tilstandsskift i basen: hvem fik et
//  Stripe-kald, hvad står der i rækken bagefter.
//  Q3's tabte svar er SIMULERET. Vi river ikke en TCP-forbindelse
//  over; vi lader skrivningen lykkes og kaster derefter i klienten.
//  Det modellerer «basen committede, svaret nåede aldrig hjem» og
//  er det, rettelsen handler om — men et rigtigt netværksudfald er
//  ikke målt, og det skal ikke læses som om det var.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, indsaetBase } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { betalingstilsyn, stopForkertFornyelse } from '../lib/webhook'
import { sigOpFor } from '../lib/abonnement'
import { skyldAfstemning } from '../lib/opsigelse'
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

const S = Date.now()
let falsk: Falsk & Record<string, unknown>

async function bruger(n: string) {
  const a = randomUUID()
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r7${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r7${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const laes = (s: string) => db.select({
  opsagtAf: subscriptions.opsagtAfKundeAt, opsagt: subscriptions.cancelAtPeriodEnd,
  skyldig: subscriptions.afstemningSkyldigAt, gen: subscriptions.afstemningGen,
  forsoeg: subscriptions.afstemningForsoeg, stoppet: subscriptions.fornyelseStoppetAt,
  adgang: subscriptions.adgangTil,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, s)).then((r) => r[0])

const saetAbo = (sub: string, v: Record<string, unknown>) =>
  (falsk.abonnementer as Map<string, unknown>).set(sub, v)

const hosStripe = (sub: string) =>
  (falsk.abonnementer as Map<string, { cancel_at_period_end?: boolean }>)
    .get(sub)?.cancel_at_period_end === true

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions)
  await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

async function medPlan(n: string, v: Record<string, unknown> = {}) {
  const u = await bruger(n)
  const sub = `sub_${n}_${S}`; const plan = `sch_${n}_${S}`
  saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false, schedule: plan })
  falsk.planer.set(plan, { id: plan, status: 'active', subscription: sub, konfigureret: true,
    phases: [{ items: [{ price: OPS.introPrisId }] }, { items: [{ price: OPS.normalPrisId }] }] })
  await db.insert(subscriptions).values({
    userId: u, stripeSubscriptionId: sub, stripeCustomerId: `cus_${n}`, status: 'active',
    adgangTil: new Date(Date.now() + 30 * 86400_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    stripeScheduleId: plan, planStatus: 'konfigureret', cancelAtPeriodEnd: false, ...v,
  } as never)
  return { u, sub, plan }
}

const METODER = ['select', 'update', 'insert', 'delete', 'execute',
                 'transaction', 'query', 'with', '$with'] as const
function seam(): Record<string, unknown> {
  const aegte: Record<string, unknown> = {}
  for (const m of METODER) {
    const v = (db as unknown as Record<string, unknown>)[m]
    if (v !== undefined) aegte[m] = v
  }
  return aegte
}

/**
 * Bræk basen, og giv den tilbage igen.
 *
 * `update` — matcher `rammer` på de værdier, der skrives.
 *   `efter: false` (standard): skrivningen AFVISES. Det er en
 *     databasefejl: der landede intet.
 *   `efter: true`: skrivningen LYKKES, og derefter kastes der.
 *     Det er det tabte svar — basen har committet, klienten fik det
 *     aldrig at vide. SIMULERET, se filhovedet.
 * `braekLaesning` — forbindelsen dør PÅ skrivningen: `select` kaster
 *   fra det øjeblik, `update` fejlede, og ikke før. Brækkes den fra
 *   start, knækker opslaget FØR opsigelsen, og så måles et helt andet
 *   forløb. (Målt: prøven døde i `sigOpFor`s første select.)
 */
function bryd(rammer: (v: Record<string, unknown>) => boolean,
              { efter = false, braekLaesning = false } = {}): () => void {
  const aegte = seam()
  const rigtigUpdate = aegte.update as (...a: unknown[]) => Record<string, unknown>
  const rigtigSelect = aegte.select as (...a: unknown[]) => unknown
  let doed = false
  const lappet: Record<string, unknown> = { ...aegte,
    select: (...a: unknown[]) => {
      if (doed) throw new Error('INJICERET_LAESEFEJL')
      return rigtigSelect(...a)
    },
    update: (...a: unknown[]) => {
      const b = rigtigUpdate(...a)
      const set = (b.set as (v: unknown) => unknown).bind(b)
      b.set = (v: Record<string, unknown>) => {
        if (!rammer(v)) return set(v)
        const byg = set(v) as { where: (...x: unknown[]) => Promise<unknown> }
        return { where: async (...x: unknown[]) => {
          if (efter) await byg.where(...x)
          if (braekLaesning) doed = true
          throw new Error('INJICERET_DB_FEJL')
        } }
      }
      return b
    },
  }
  indsaetBase(lappet as never, async () => {})
  return () => indsaetBase(aegte as never, async () => {})
}

/**
 * Bræk ÉT navngivet opslag, kendt på sin projektion.
 *
 * Diagnostikken i `afstemSkyldige` henter præcis `{ f, forsoeg }` for
 * at kunne SIGE, hvad der gik galt. Den er det eneste sted i koden med
 * den projektion, så den kan rammes alene — uden at brække resten af
 * køens egne opslag og måle noget andet, end prøven siger.
 */
function brydOpslag(rammer: (felter: Record<string, unknown>) => boolean): () => void {
  const aegte = seam()
  const rigtigSelect = aegte.select as (...a: unknown[]) => unknown
  indsaetBase({ ...aegte,
    select: (...a: unknown[]) => {
      const f = a[0] as Record<string, unknown> | undefined
      if (f && rammer(f)) throw new Error('INJICERET_LAESEFEJL')
      return rigtigSelect(...a)
    },
  } as never, async () => {})
  return () => indsaetBase(aegte as never, async () => {})
}

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═════════════════════════════════════════════════════════════
  //  Q1 · ÉN RÆKKES SKRIVEFEJL MÅ IKKE TØMME KØEN
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ Q1 · afstemningen fortsætter pr. række ══')
  {
    await nulstil()
    const mk = async (n: string, min: number) => {
      const { sub } = await medPlan(n, { opsagtAfKundeAt: new Date(),
        adgangTil: new Date(Date.now() + min * 60_000),
        currentPeriodEnd: new Date(Date.now() + min * 60_000) })
      await skyldAfstemning(sub, 'kunden har sagt op')
      return sub
    }
    // A har nærmest frist og vælges først af køen. Det er dét, der
    // gør den farlig: den dårlige række står forrest.
    const a = await mk('Q1a', 30)
    const b = await mk('Q1b', 6000); const c = await mk('Q1c', 6000)
    const adgangFoer = await Promise.all([a, b, c].map(async (s) => (await laes(s))!.adgang!.getTime()))

    // A's opslag hos Stripe fejler …
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      if (id === a) throw new Error('STRIPE_NEDE_FOR_A')
      return rigtigHent(id)
    }
    // … og bogføringen AF den fejl fejler også, kun for A.
    //
    // Præciseringen er selve modprøven. `RYD_SAET` sætter OGSÅ
    // `afstemningFejl` — til null — så en matcher på feltnavnet alene
    // ville brække B's og C's kvittering med og måle sig selv grøn.
    // (Målt: den gjorde.) Her rammer den kun en skrivning, der sætter
    // en fejlTEKST uden samtidig at skrive beslutningen.
    const genskab = bryd((v) => 'afstemningFejl' in v && v.afstemningFejl !== null
      && !('opsagtAfKundeAt' in v))
    const foer = falsk.kald.length
    const linjer: string[] = []
    for (let i = 0; i < 3; i++) linjer.push(...await betalingstilsyn(OPS))
    genskab()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    const kald = falsk.kald.length - foer
    const rb = await laes(b); const rc = await laes(c); const ra = await laes(a)
    // KERNEN: de øvrige to blev afstemt, ikke bare «ikke glemt».
    tjek('B og C blev afstemt, selv om A knækkede',
      rb?.skyldig === null && rc?.skyldig === null && hosStripe(b) && hosStripe(c),
      `B.skyldig=${rb?.skyldig !== null} C.skyldig=${rc?.skyldig !== null} `
      + `Stripe=[${hosStripe(b)},${hosStripe(c)}] kald=${kald}`)
    tjek('  …og A beholder sin skyld', ra?.skyldig !== null, `skyldig=${ra?.skyldig}`)
    tjek('  fejlen er rapporteret MED abonnementets id',
      linjer.some((l) => l.includes(a)),
      JSON.stringify(linjer.filter((l) => l.includes('afstemning')).slice(0, 2)))
    const adgangEfter = await Promise.all([a, b, c].map(async (s) => (await laes(s))!.adgang!.getTime()))
    tjek('  KUNDERNES BETALTE ADGANG ER URØRT',
      adgangEfter.every((v, i) => v === adgangFoer[i]))
  }

  console.log('\n══ Q1d · også et fejlet DIAGNOSTISK opslag holdes inde ══')
  {
    // Opslaget findes kun for at kunne sige hvad der gik galt. Kaster
    // det, må det koste en fejltekst — ikke resten af køen.
    await nulstil()
    const mk = async (n: string, min: number) => {
      const { sub } = await medPlan(n, { opsagtAfKundeAt: new Date(),
        adgangTil: new Date(Date.now() + min * 60_000),
        currentPeriodEnd: new Date(Date.now() + min * 60_000) })
      await skyldAfstemning(sub, 'kunden har sagt op')
      return sub
    }
    const a = await mk('Q1da', 30)
    const b = await mk('Q1db', 6000); const c = await mk('Q1dc', 6000)

    // Her fejler kun Stripe-opslaget for A — ingen skrivefejl. Så
    // returnerer `afstemAbonnement` pænt «ikke bekræftet», og det
    // ENESTE, der kan vælte køen, er diagnostikken.
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      if (id === a) throw new Error('STRIPE_NEDE_FOR_A')
      return rigtigHent(id)
    }
    const genskab = brydOpslag((f) => 'f' in f && 'forsoeg' in f)
    const linjer = await betalingstilsyn(OPS)
    genskab()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    const rb = await laes(b); const rc = await laes(c)
    tjek('B og C blev afstemt, selv om fejlteksten ikke kunne læses',
      rb?.skyldig === null && rc?.skyldig === null && hosStripe(b) && hosStripe(c),
      `B.skyldig=${rb?.skyldig !== null} C.skyldig=${rc?.skyldig !== null}`)
    tjek('  …og linjen siger BÅDE id og at teksten manglede',
      linjer.some((l) => l.includes(a) && l.includes('fejlteksten kunne ikke læses')),
      JSON.stringify(linjer.filter((l) => l.includes(a))))
  }

  // ═════════════════════════════════════════════════════════════
  //  Q2 · INGEN EGEN GENERATION ER INGEN KVITTERING
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ Q2 · sikkerhedsstoppet kvitterer kun sit eget arbejde ══')
  {
    await nulstil()
    const { u, sub } = await medPlan('Q2', {
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
      adgangTil: new Date(Date.now() + 20 * 60_000),
      currentPeriodEnd: new Date(Date.now() + 20 * 60_000) })
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    // Kunden når det først, MENS stoppet er i luften.
    //
    // Hooken sidder på PLANOPSLAGET, og den skal blive der.
    //
    // Da prøven blev skrevet, var det det ENESTE opslag i forløbet:
    // stoppet brugte sin egen binding og spurgte ikke abonnementet.
    // En hook på `subscriptions.retrieve` målte derfor ingenting.
    // (Målt: den gjorde — scenariet reproducerede ikke.)
    //
    // Siden runde 8 spørger stoppet FØRST abonnementet og derefter
    // planen. Begge ligger stadig før `besluttetAfOs`, så hooken fyrer
    // samme sted i forløbet — men «rammes aldrig» er ikke længere
    // sandt, og det skal stå her, så den næste ikke flytter hooken på
    // et forkert grundlag.
    const rigtigHent = (falsk.subscriptionSchedules as
      { retrieve: (id: string) => Promise<unknown> }).retrieve
      .bind(falsk.subscriptionSchedules)
    let engang = false
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = async (id: string) => {
      const svar = await rigtigHent(id)
      if (!engang) {
        engang = true
        await sigOpFor(u)
        await skyldAfstemning(sub, 'planen blev lagt, mens kunden sagde op')
      }
      return svar
    }
    const r = await stopForkertFornyelse(OPS, sub, 'prøvens grund')
    ;(falsk.subscriptionSchedules as Record<string, unknown>).retrieve = rigtigHent

    const rr = await laes(sub)
    // KERNEN: arbejdet, en anden registrerede, står endnu.
    tjek('det nyere køarbejde overlevede et stop, der ikke ejede det',
      rr?.skyldig !== null, `skyldig=${rr?.skyldig} gen=${rr?.gen}`)
    // … OG skellet holder: den bekræftede Stripe-tilstand er bogført.
    // De to er forskellige spørgsmål, og det var sammenblandingen af
    // dem, der gav den ubetingede kvittering.
    tjek('  …mens den BEKRÆFTEDE Stripe-tilstand er bogført',
      rr?.opsagt === true, `cancel_at_period_end=${rr?.opsagt}`)
    tjek('  stoppet melder stadig «stoppet»', r === 'stoppet', String(r))
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  // ═════════════════════════════════════════════════════════════
  //  Q3 · TRE UDFALD, IKKE ÉT
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ Q3a · et tabt svar er ikke «der er ikke sket noget» ══')
  {
    // SIMULERET: skrivningen lykkes, og derefter kastes der. Se
    // filhovedet — der er ikke revet en forbindelse over.
    await nulstil()
    const { u, sub } = await medPlan('Q3a')
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const genskab = bryd((v) => 'opsagtAfKundeAt' in v, { efter: true })
    const svar = await sigOpFor(u)
    genskab()

    const r = await laes(sub)
    await betalingstilsyn(OPS)
    tjek('svaret påstår ikke «intet er gemt» om noget, der ER gemt',
      !(svar.ok === false && svar.fejl === 'ikke_gemt'), JSON.stringify(svar))
    tjek('  beslutningen står i rækken', r?.opsagtAf !== null)
    tjek('  og opsigelsen blev fuldført hos Stripe', hosStripe(sub))
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ Q3b · en AFVIST skrivning siger stadig «ikke gemt» ══')
  {
    // Modstykket. Rettelsen må ikke gøre `ikke_gemt` uopnåeligt —
    // så var «prøv igen» forsvundet dér, hvor den ER sand.
    await nulstil()
    const { u, sub } = await medPlan('Q3b')
    const genskab = bryd((v) => 'opsagtAfKundeAt' in v)
    const svar = await sigOpFor(u)
    genskab()

    const r = await laes(sub)
    tjek('svaret er «ikke gemt»',
      svar.ok === false && svar.fejl === 'ikke_gemt', JSON.stringify(svar))
    tjek('  …og rækken er faktisk urørt',
      r?.opsagtAf === null && r?.skyldig === null,
      `opsagtAf=${r?.opsagtAf} skyldig=${r?.skyldig}`)
  }

  console.log('\n══ Q3c · kan vi ikke se efter, siger vi «ukendt» ══')
  {
    // Skrivningen fejler, OG rækken kan ikke læses tilbage. Så ved vi
    // det ikke — og hverken «der er ikke sket noget» eller «vi prøver
    // automatisk igen» er dækket.
    await nulstil()
    const { u } = await medPlan('Q3c')
    const genskab = bryd((v) => 'opsagtAfKundeAt' in v, { braekLaesning: true })
    const svar = await sigOpFor(u)
    genskab()

    tjek('svaret er «ukendt», ikke «ikke gemt»',
      svar.ok === false && svar.fejl === 'ukendt', JSON.stringify(svar))
  }

  console.log('\n══ Q3d · et kast i afstemningen giver et SVAR, ikke en fejlside ══')
  {
    // Q3's rettelse lader `sigOpFor` FORTSAETTE til afstemningen, når
    // beslutningen er læst tilbage. Afstemningen kan selv kaste — dens
    // egen fejlbogføring er også en skrivning, jf. Q1 — og så ville
    // kunden møde en ubehandlet fejl i stedet for en besked. Det er
    // præcis det, `sigOpFor`s egen kommentar lover den ikke gør.
    await nulstil()
    const { u, sub } = await medPlan('Q3d')

    // Stripe svarer ikke …
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      if (id === sub) throw new Error('STRIPE_NEDE')
      return rigtigHent(id)
    }
    // … og bogføringen af netop den fejl fejler også. Matcheren er den
    // samme som i Q1 og rammer IKKE `noterOpsigelse`, der skriver
    // beslutningen og fejlteksten i ét.
    const genskab = bryd((v) => 'afstemningFejl' in v && v.afstemningFejl !== null
      && !('opsagtAfKundeAt' in v))
    let kastede: string | null = null
    let svar: Awaited<ReturnType<typeof sigOpFor>> | null = null
    try { svar = await sigOpFor(u) } catch (e) { kastede = (e as Error).message }
    genskab()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    const r = await laes(sub)
    tjek('kunden får et svar, ikke en kastet fejl',
      kastede === null, `kastede: ${kastede}`)
    tjek('  …og svaret er «afventer» — beslutningen ER gemt',
      svar?.ok === false && svar.fejl === 'afventer', JSON.stringify(svar))
    tjek('  rækken står i køen, så tilsynet tager den',
      r?.opsagtAf !== null && r?.skyldig !== null,
      `opsagtAf=${r?.opsagtAf !== null} skyldig=${r?.skyldig !== null}`)
  }

  console.log(`\n${fejl === 0 ? '  ALT GROENT' : `  ${fejl} FEJLEDE`}`)
  if (fejl) process.exitCode = 1
}

await koer()
