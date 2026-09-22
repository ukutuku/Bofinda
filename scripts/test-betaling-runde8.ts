// ═══════════════════════════════════════════════════════════════
//  Ottende gennemgangs to fund, prøvet mod rettelserne.
//
//  T1 · `afstemSkyldige` kom aldrig ud over sin FØRSTE portion.
//       Catch'en pr. række (runde 7) reddede de øvrige rækker, der
//       allerede var VALGT — den skaffede ikke plads til dem uden
//       for portionen. Fejler bogføringen af et fejlet forsøg,
//       bliver forsøgstallet på 0 og næste forsøg klar, og de samme
//       25 vinder hver eneste udvælgelse. Målt: 26 opsigelser, de
//       25 første med brudt opslag OG brudt fejlbogføring — kunde
//       26 fik NUL kald, indtil nogle af de 25 faldt ud af
//       hasteklassen, fem timekørsler senere og efter hendes frist.
//  T2 · `stopForkertFornyelse` spurgte kun Stripe om abonnementets
//       aktuelle plan, hvis vores EGEN binding var tom. En forældet
//       binding blev altså brugt som autoritet: plan A er frigivet,
//       Stripe styrer med en korrekt plan B — og vi undersøgte A,
//       traf stopbeslutningen og sendte et opsigelseskald på et
//       abonnement, der ikke fejlede noget. `laegPlan` havde samme
//       valgvej.
//
//  ── HVAD DER ER MÅLT, OG HVAD DER ER MODELLERET ──────────────
//  Databasefejlen injiceres gennem repoets EGEN seam, `indsaetBase`.
//  Stripe er `scripts/stripefalsk/` — en attrap. Prøven måler vores
//  kontrolstrøm og vores skrivninger; den siger INTET om, hvad
//  rigtig Stripe ville svare, og den beviser ingen opkrævning.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, indsaetBase } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { behandl, betalingstilsyn, laegPlan } from '../lib/webhook'
import { afstemSkyldige, noterOpsigelse } from '../lib/opsigelse'
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
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r8${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r8${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const laes = (s: string) => db.select({
  skyldig: subscriptions.afstemningSkyldigAt, forsoeg: subscriptions.afstemningForsoeg,
  stoppet: subscriptions.fornyelseStoppetAt, plan: subscriptions.stripeScheduleId,
  planStatus: subscriptions.planStatus, opsagt: subscriptions.cancelAtPeriodEnd,
  adgang: subscriptions.adgangTil,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, s)).then((r) => r[0])

const hosStripe = (s: string) => (falsk.abonnementer as
  Map<string, { cancel_at_period_end?: boolean; schedule?: string }>).get(s)
const planStatus = (id: string) =>
  (falsk.planer.get(id) as { status?: string } | undefined)?.status

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions)
  await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
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
 * Bræk `update` dér hvor `rammer` siger til, og giv basen tilbage igen.
 *
 * Gennem `indsaetBase`, ikke ved at lappe `db`: stedfortræderen i
 * db/client.ts henter den levende klient ved hvert opslag.
 */
function bryd(rammer: (v: Record<string, unknown>) => boolean): () => void {
  // ── ATTRAPPEN SKAL BAERE HELE KAEDEN, OG AFVISE FOERST NAAR
  //    NOGEN VENTER ──────────────────────────────────────────
  // Et `Promise.reject()` returneret fra `.where()` er to fejl i én:
  // kaeden fortsaetter med `.returning()`, som et promise ikke har
  // (en TypeError, der ikke ligner den injicerede fejl), og det
  // afviste promise bliver aldrig ventet paa — altsaa en flydende
  // afvisning, der vaelter processen EFTER proeven er groen. Maalt.
  //
  // Derfor en thenable, der baerer `where`/`returning`/`limit` og
  // foerst laver afvisningen, naar nogen faktisk venter paa den.
  const nej = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {}
    const kaede = () => nej()
    for (const m of ['where', 'returning', 'limit', 'from']) p[m] = kaede
    p.then = (res?: unknown, rej?: unknown) =>
      Promise.reject(new Error('INJICERET_DB_FEJL'))
        .then(res as never, rej as never)
    p.catch = (rej?: unknown) =>
      Promise.reject(new Error('INJICERET_DB_FEJL')).catch(rej as never)
    p.finally = (f?: unknown) =>
      Promise.reject(new Error('INJICERET_DB_FEJL')).finally(f as never)
    return p
  }
  const aegte = seam()
  const rigtig = aegte.update as (...a: unknown[]) => Record<string, unknown>
  indsaetBase({ ...aegte,
    update: (...a: unknown[]) => {
      const b = rigtig(...a)
      const set = (b.set as (v: unknown) => unknown).bind(b)
      b.set = (v: Record<string, unknown>) => rammer(v) ? nej() : set(v)
      return b
    },
  } as never, async () => {})
  return () => indsaetBase(aegte as never, async () => {})
}

/** Bræk `select` fra og med det N'te kald. Til den ekstra portion. */
function brydOpslagFra(n: number): () => void {
  const aegte = seam()
  const rigtig = aegte.select as (...a: unknown[]) => unknown
  let set = 0
  indsaetBase({ ...aegte,
    select: (...a: unknown[]) => {
      if (++set >= n) throw new Error('INJICERET_LAESEFEJL')
      return rigtig(...a)
    },
  } as never, async () => {})
  return () => indsaetBase(aegte as never, async () => {})
}

/** 26 opsigelser i kø: de 25 første med tidligst frist, nr. 26 sidst. */
async function seksogtyve(mrk: string, antal = 26) {
  const subs: string[] = []
  for (let i = 1; i <= antal; i++) {
    const u = await bruger(`${mrk}_${i}`)
    const sub = `sub_${mrk}_${String(i).padStart(2, '0')}_${S}`
    const plan = `sch_${mrk}_${i}_${S}`
    falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false, schedule: plan })
    falsk.planer.set(plan, { id: plan, status: 'active', subscription: sub, konfigureret: true,
      phases: [{ items: [{ price: OPS.introPrisId }] }, { items: [{ price: OPS.normalPrisId }] }] })
    // Alle ligger UDEN FOR hasteklassen (mere end to timer ude), så
    // rækkefølgen alene afgøres af forsøgstal og dernæst frist. De 25
    // første har tidligere frist og sorterer derfor først.
    const frist = new Date(Date.now() + 10 * 3600_000 + i * 60_000)
    await db.insert(subscriptions).values({
      userId: u, stripeSubscriptionId: sub, stripeCustomerId: `cus_${mrk}_${i}`,
      status: 'active', adgangTil: frist, currentPeriodEnd: frist,
      stripeScheduleId: plan, planStatus: 'konfigureret', cancelAtPeriodEnd: false,
    } as never)
    await noterOpsigelse(sub)
    subs.push(sub)
  }
  return subs
}

/** Et abonnement med en RIGTIG, konfigureret plan, lagt ad den faktiske vej. */
async function medRigtigPlan(mrk: string) {
  const u = await bruger(mrk)
  const sub = `sub_${mrk}_${S}`
  falsk.abonnementer.set(sub, { id: sub, cancel_at_period_end: false })
  const t = Math.floor(Date.now() / 1000)
  await behandl({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed',
    created: t, data: { object: { subscription: sub, client_reference_id: u,
      customer: `cus_${mrk}` } } } as never, OPS)
  await behandl({ id: `evt_${randomUUID()}`, type: 'invoice.paid',
    created: t, data: { object: { subscription: sub, customer: `cus_${mrk}`,
      lines: { data: [{ period: { start: t, end: t + 86400 },
        pricing: { price_details: { price: OPS.introPrisId } } }] } } } } as never, OPS)
  const r = await laes(sub)
  return { u, sub, b: r!.plan!, planStatusEfter: r?.planStatus }
}

/** Et forsinket snapshot, der stadig nævner den gamle plan. */
const spejlGammelBinding = (sub: string, gammel: string) =>
  behandl({ id: `evt_${randomUUID()}`, type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: sub, status: 'active', cancel_at_period_end: false,
      schedule: gammel } } } as never, OPS)

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═════════════════════════════════════════════════════════════
  //  T1 · KØEN SKAL UD OVER SIN FØRSTE PORTION
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ T1 · en ubogført række bruger ikke kørslens kapacitet ══')
  {
    await nulstil()
    const subs = await seksogtyve('T1')
    const rask = subs[25]!
    const adgangFoer = (await laes(rask))!.adgang!.getTime()

    // De 25 førstes Stripe-opslag fejler …
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      if (id !== rask) throw new Error('OPSLAG_NEDE')
      return rigtigHent(id)
    }
    // … og bogføringen AF den fejl fejler også. Kun den: matcheren
    // rammer en fejlTEKST med netop den besked, og kun de 25 kan
    // producere den, fordi nr. 26's opslag virker.
    const genskab = bryd((v) => typeof v.afstemningFejl === 'string'
      && (v.afstemningFejl as string).includes('OPSLAG_NEDE'))

    const foer = falsk.kald.length
    const linjer = await betalingstilsyn(OPS)
    genskab()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    const kald = falsk.kald.slice(foer).filter((k) => k.args[0] === rask).length
    const r = await laes(rask)
    const forsoeg = [...new Set(await Promise.all(
      subs.slice(0, 25).map(async (s) => (await laes(s))!.forsoeg)))]
    // KERNEN: hun nås i FØRSTE kørsel, altså ti timer før sin frist.
    tjek('kunde 26 fik sit forsøg i FØRSTE kørsel',
      kald > 0, `kald=${kald}`)
    tjek('  …og opsigelsen blev gennemført',
      hosStripe(rask)?.cancel_at_period_end === true && r?.skyldig === null,
      `stripe=${hosStripe(rask)?.cancel_at_period_end} skyldig=${r?.skyldig !== null}`)
    tjek('  de 25 beholder deres skyld',
      (await Promise.all(subs.slice(0, 25).map(async (s) => (await laes(s))!.skyldig)))
        .every((x) => x !== null))
    tjek('  …og deres forsøgstal står stadig på 0 — de blev ikke bogført',
      forsoeg.length === 1 && forsoeg[0] === 0, JSON.stringify(forsoeg))
    tjek('  kørslen SIGER, at den tog mere end én portion',
      linjer.some((l) => l.includes('26 taget')),
      JSON.stringify(linjer.filter((l) => l.includes('afstemning:')).map((l) => l.split(' — ')[0])))
    tjek('  hver af de 25 er navngivet i rapporten',
      subs.slice(0, 25).every((s) => linjer.some((l) => l.includes(s))))
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(rask))?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ T1b · «bekræftet, ikke bogført» spærrer på samme måde ══')
  {
    // Den gren KASTER ikke. Den skriver skylden og fejlteksten, men
    // hverken forsøgstal eller tilbagetrækning — se oprydningsfangsten
    // i `afstemAbonnement`. Rækken beholder altså sine sorteringsnøgler
    // og vinder udvælgelsen igen. Uden at tælle den med de ubevægede
    // ville T1's rettelse kun dække den ene af de to veje.
    await nulstil()
    const subs = await seksogtyve('T1b')
    const rask = subs[25]!

    // Oprydningen efter en LYKKET opsigelse fejler for de 25 første.
    // Matcheren kan ikke se abonnementets id, så den tæller: de 25
    // første oprydninger tilhører de 25 rækker, der sorterer først.
    // Assertionen nedenfor efterprøver netop dét.
    let n = 0
    const genskab = bryd((v) => v.stripeScheduleId === null
      && 'afstemningForsoeg' in v && ++n <= 25)

    const foer = falsk.kald.length
    await betalingstilsyn(OPS)
    genskab()

    const kald = falsk.kald.slice(foer).filter((k) => k.args[0] === rask).length
    const r = await laes(rask)
    const blokerede = await Promise.all(subs.slice(0, 25).map(async (s) => (await laes(s))!.skyldig))
    tjek('kunde 26 fik sit forsøg i FØRSTE kørsel', kald > 0, `kald=${kald}`)
    tjek('  …og hendes opsigelse er gennemført og ryddet',
      hosStripe(rask)?.cancel_at_period_end === true && r?.skyldig === null)
    tjek('  det var de 25 FØRSTE, der ikke blev bogført',
      blokerede.every((x) => x !== null),
      `${blokerede.filter((x) => x === null).length} af 25 var ryddet`)
  }

  console.log('\n══ T1c · loftet stopper kørslen, og det kan SES ══')
  {
    // Køens egen indgang med en lille grænse, så loftet nås billigt.
    // `maks = 2` giver et loft på otte forsøgte rækker.
    await nulstil()
    const subs = await seksogtyve('T1c', 12)
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async () => {
      throw new Error('OPSLAG_NEDE')
    }
    const genskab = bryd((v) => typeof v.afstemningFejl === 'string'
      && (v.afstemningFejl as string).includes('OPSLAG_NEDE'))
    const svar = await afstemSkyldige(OPS, 2)
    genskab()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    tjek('kørslen stopper på loftet, ikke på den første portion',
      svar.taget === 8, `taget=${svar.taget}`)
    tjek('  …og loftet står i rapporten med et tal',
      svar.detaljer.some((d) => d.includes('loftet på 8') && d.includes('4 klare rækker')),
      JSON.stringify(svar.detaljer.filter((d) => d.includes('loftet'))))
    tjek('  alle tolv beholder deres skyld',
      (await Promise.all(subs.map(async (s) => (await laes(s))!.skyldig)))
        .every((x) => x !== null))
  }

  console.log('\n══ T1d · en fejlet EKSTRA udvælgelse koster ikke rundens regnskab ══')
  {
    // Den første udvælgelse ligger før alt arbejde; kaster den, er der
    // intet at miste. De efterfølgende ligger MIDT i runden, og et kast
    // dér ville kaste hele rapporten for de rækker, der ER afstemt.
    await nulstil()
    await seksogtyve('T1d', 6)
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async () => {
      throw new Error('OPSLAG_NEDE')
    }
    const genskabSkriv = bryd((v) => typeof v.afstemningFejl === 'string'
      && (v.afstemningFejl as string).includes('OPSLAG_NEDE'))
    // Selects i `afstemSkyldige`: 1 = i alt, 2 = klar nu, 3 = portion 1,
    // 4 = portion 2. Vi brækker fra det fjerde.
    const genskabLaes = brydOpslagFra(4)
    let kastede: string | null = null
    let svar: Awaited<ReturnType<typeof afstemSkyldige>> | null = null
    try { svar = await afstemSkyldige(OPS, 2) } catch (e) { kastede = (e as Error).message }
    genskabLaes(); genskabSkriv()
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    tjek('kørslen kaster ikke — den rapporterer det, den nåede',
      kastede === null, `kastede: ${kastede}`)
    tjek('  …og de to rækker, den nåede, står i rapporten',
      (svar?.taget ?? 0) === 2 && (svar?.fejlede ?? 0) === 2,
      `taget=${svar?.taget} fejlede=${svar?.fejlede}`)
    tjek('  og der står HVORFOR der ikke kom flere',
      (svar?.detaljer ?? []).some((d) => d.includes('kunne ikke hente flere rækker')),
      JSON.stringify(svar?.detaljer.slice(-1)))
  }

  // ═════════════════════════════════════════════════════════════
  //  T2 · KILDEN AFGØR, HVILKEN PLAN DER STYRER
  // ═════════════════════════════════════════════════════════════
  for (const afvisFoersteKald of [false, true]) {
    const mrk = afvisFoersteKald ? 'afvist' : 'accepteret'
    console.log(`\n══ T2 (${mrk}) · en forældet binding må ikke opsige en korrekt plan ══`)
    await nulstil()
    const { sub, b, planStatusEfter } = await medRigtigPlan(`T2${mrk}`)
    tjek('opsætningen gav en KONFIGURERET plan B',
      planStatusEfter === 'konfigureret' && !!b, `status=${planStatusEfter} plan=${b}`)

    // En gammel, frigivet plan A — den slags Stripe selv siger, man
    // skal kassere id'et på.
    const a = `sch_T2_A_${mrk}_${S}`
    falsk.planer.set(a, { ...structuredClone(falsk.planer.get(b) as object), id: a,
      status: 'released', subscription: null, released_subscription: sub } as never)
    // Vores egen bogføring er bagud, og fem planforsøg er brugt: det
    // er indgangen til sikkerhedsstoppet.
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const spejlet = await spejlGammelBinding(sub, a)
    const efter = await laes(sub)
    tjek('  spejlingen satte den gamle binding gennem den faktiske indgang',
      spejlet === 'behandlet' && efter?.plan === a, `svar=${spejlet} binding=${efter?.plan}`)
    const adgangFoer = efter!.adgang!.getTime()

    if (afvisFoersteKald) (falsk.fejlPaa as Set<string>).add('subscriptions.update')
    const foer = falsk.kald.length
    await betalingstilsyn(OPS)
    const kald = falsk.kald.slice(foer)
    const r = await laes(sub)
    const opsigelser = kald.filter((k) => k.metode === 'subscriptions.update'
      && (k.args[1] as { cancel_at_period_end?: boolean } | undefined)?.cancel_at_period_end === true)
    tjek('  den AKTUELLE plan blev undersøgt før beslutningen',
      kald.some((k) => k.metode === 'subscriptions.retrieve')
      && kald.some((k) => k.metode === 'subscriptionSchedules.retrieve' && k.args[0] === b),
      JSON.stringify(kald.map((k) => k.metode)))
    tjek('  der blev IKKE sendt et opsigelseskald', opsigelser.length === 0)
    tjek('  der blev IKKE gemt en stopbeslutning', r?.stoppet === null, `${r?.stoppet}`)
    tjek('  den lokale binding er rettet til B', r?.plan === b, `${r?.plan}`)

    // … og de efterfølgende kørsler må heller ikke fuldføre en
    // beslutning, der aldrig burde være taget.
    if (afvisFoersteKald) (falsk.fejlPaa as Set<string>).delete('subscriptions.update')
    for (let i = 0; i < 3; i++) await betalingstilsyn(OPS)
    const til_sidst = await laes(sub)
    tjek('  plan B står stadig aktiv efter tre kørsler mere',
      planStatus(b) === 'active', `${planStatus(b)}`)
    tjek('  abonnementet er ikke opsagt hos Stripe',
      hosStripe(sub)?.cancel_at_period_end !== true)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      til_sidst?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ T2g · at STÅ NED kræver ikke et svar fra kilden ══')
  {
    // Mit første forsøg på T2 spurgte abonnementet UBETINGET og som
    // det første kald. Det gjorde kildens svar nødvendigt for at stå
    // ned — ikke kun for at gribe ind. Er netop det kald nede, mens
    // planerne svarer fint, faldt hele sikkerhedsstoppet i sin catch
    // og skrev ⚠⚠ «der er IKKE grebet ind» hver time om et abonnement,
    // hvis plan var helt korrekt.
    //
    // Reglen er derfor: vores binding prøves først, og den tæller, når
    // planen SELV siger, at den styrer abonnementet. Kilden er nødvendig
    // for at gribe ind, og kun dér.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2g')
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    // Kun opslaget af ABONNEMENTET er nede. Planerne svarer fint.
    const rigtigHent = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async () => {
      throw new Error('DELVIS_NEDETID')
    }
    const linjer = await betalingstilsyn(OPS)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtigHent

    const r = await laes(sub)
    tjek('planen blev bekræftet uden at spørge abonnementet',
      r?.planStatus === 'konfigureret', `status=${r?.planStatus}`)
    tjek('  der kom INGEN ⚠⚠-alarm',
      !linjer.some((l) => l.includes('⚠⚠')),
      JSON.stringify(linjer.filter((l) => l.includes('⚠'))))
    tjek('  der blev ikke gemt en stopbeslutning', r?.stoppet === null)
    tjek('  og ingen skyld i afstemningskøen', r?.skyldig === null, `${r?.skyldig}`)
    tjek('  planen står stadig aktiv hos Stripe', planStatus(b) === 'active')
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ T2b · en FAKTISK forkert plan bliver stadig stoppet ══')
  {
    // Rettelsen må ikke afvæbne sikkerhedsstoppet. Her ER den aktuelle
    // plan forkert — og så skal den slippes og fornyelsen stoppes.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2b')
    ;(falsk.planer.get(b) as { phases: unknown[] }).phases = []
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const foer = falsk.kald.length
    await betalingstilsyn(OPS)
    const kald = falsk.kald.slice(foer)
    const r = await laes(sub)
    tjek('fornyelsen ER stoppet', r?.stoppet !== null && r?.opsagt === true,
      `stoppet=${r?.stoppet !== null} opsagt=${r?.opsagt}`)
    tjek('  den forkerte plan er sluppet hos Stripe', planStatus(b) === 'released',
      `${planStatus(b)}`)
    tjek('  og opsigelseskaldet blev sendt',
      kald.some((k) => k.metode === 'subscriptions.update'
        && (k.args[1] as { cancel_at_period_end?: boolean } | undefined)?.cancel_at_period_end === true))
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ T2c · INGEN plan hos Stripe bliver stadig stoppet ══')
  {
    // Den anden halvdel af «bevar korrekt indgreb»: siger kilden, at
    // ingen plan styrer abonnementet, ER der ingen plan — også når
    // vores binding påstår noget andet.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2c')
    // Planen slippes hos Stripe. Abonnementets `schedule` ryddes med,
    // præcis som hos Stripe — og vores binding bliver stående.
    await (falsk.subscriptionSchedules as { release: (id: string) => Promise<unknown> })
      .release(b)
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
             stripeScheduleId: b })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    await betalingstilsyn(OPS)
    const r = await laes(sub)
    tjek('fornyelsen ER stoppet', r?.stoppet !== null && r?.opsagt === true,
      `stoppet=${r?.stoppet !== null} opsagt=${r?.opsagt}`)
    tjek('  den forældede binding står ikke tilbage', r?.plan === null, `${r?.plan}`)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT',
      (await laes(sub))?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ T2e · rydningen efter indgrebet sletter ikke en nyere binding ══')
  {
    // Før kom `planId` altid fra rækken selv, så en ubetinget rydning
    // ryddede det, vi selv havde læst. Nu kommer det fra kilden og kan
    // være et andet — og så kunne rydningen slette en binding, en
    // anden lige har skrevet.
    //
    // Rækkefølgen er sat med en hook, ikke med to forbindelser:
    // PGlite er én forbindelse, så et rigtigt kapløb kan ikke måles
    // her. Den samtidige udgave af den ANDEN skrivning (korrektionen)
    // ligger i test-betaling-kaploeb.ts §E6.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2e')
    ;(falsk.planer.get(b) as { phases: unknown[] }).phases = []   // planen ER forkert
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))

    // Mens vi slipper den forkerte plan, binder en anden en ny.
    const c = `sch_T2e_C_${S}`
    const rigtigSlip = (falsk.subscriptionSchedules as
      { release: (id: string) => Promise<unknown> }).release.bind(falsk.subscriptionSchedules)
    let engang = false
    ;(falsk.subscriptionSchedules as Record<string, unknown>).release = async (id: string) => {
      const svar = await rigtigSlip(id)
      if (!engang) {
        engang = true
        await db.update(subscriptions).set({ stripeScheduleId: c })
          .where(eq(subscriptions.stripeSubscriptionId, sub))
      }
      return svar
    }
    await betalingstilsyn(OPS)
    ;(falsk.subscriptionSchedules as Record<string, unknown>).release = rigtigSlip

    const r = await laes(sub)
    tjek('indgrebet skete — den forkerte plan er sluppet',
      planStatus(b) === 'released' && r?.stoppet !== null,
      `plan=${planStatus(b)} stoppet=${r?.stoppet !== null}`)
    tjek('  …men den NYERE binding står endnu', r?.plan === c, `${r?.plan}`)
  }

  console.log('\n══ T2f · en TOM binding må stadig kunne fyldes ud ══')
  {
    // Den anden halvdel af compare-and-set'en. `eq(kolonne, null)` er
    // aldrig sandt i SQL, så den tomme binding skal prøves med
    // `isNull` — ellers rammer korrektionen nul rækker, i tavshed.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2f')
    await db.update(subscriptions)
      .set({ planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
             stripeScheduleId: null })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    await betalingstilsyn(OPS)
    const r = await laes(sub)
    tjek('bindingen blev fyldt ud fra kilden', r?.plan === b, `${r?.plan}`)
    tjek('  og planen blev bekræftet, ikke stoppet',
      r?.planStatus === 'konfigureret' && r?.stoppet === null,
      `status=${r?.planStatus} stoppet=${r?.stoppet}`)
  }

  console.log('\n══ T2d · laegPlan konfigurerer ikke en frigivet plan ══')
  {
    // Samme valgvej, samme rettelse. Bindingen peger på A, Stripe
    // styrer med B — og `laegPlan` skal tage B, ikke A.
    await nulstil()
    const { sub, b } = await medRigtigPlan('T2d')
    const a = `sch_T2d_A_${S}`
    falsk.planer.set(a, { ...structuredClone(falsk.planer.get(b) as object), id: a,
      status: 'released', subscription: null, released_subscription: sub } as never)
    await db.update(subscriptions)
      .set({ planStatus: 'oprettet', planForsoeg: 1, planFejl: 'modelleret' })
      .where(eq(subscriptions.stripeSubscriptionId, sub))
    await spejlGammelBinding(sub, a)
    tjek('bindingen peger på den gamle plan', (await laes(sub))?.plan === a)

    const foer = falsk.kald.length
    const svar = await laegPlan(sub, OPS)
    const kald = falsk.kald.slice(foer)
    const r = await laes(sub)
    tjek('laegPlan bekræfter den AKTUELLE plan', svar === 'konfigureret', `${svar}`)
    // A BLIVER slået op — det er sådan vi opdager, at den er forældet;
    // bindingen prøves først, fordi den er billig, og `planGaelder`
    // dømmer den. Det, der ikke må ske, er at vi KONFIGURERER den.
    tjek('  …og skrev ikke i den frigivne plan A',
      !kald.some((k) => k.args[0] === a && k.metode !== 'subscriptionSchedules.retrieve'),
      JSON.stringify(kald.map((k) => [k.metode, k.args[0]])))
    tjek('  …men den blev slået op, og det er dét, der afslører den',
      kald.some((k) => k.metode === 'subscriptionSchedules.retrieve' && k.args[0] === a))
    tjek('  bindingen er rettet til B', r?.plan === b, `${r?.plan}`)
    tjek('  der blev ikke oprettet en plan nummer to',
      !kald.some((k) => k.metode === 'subscriptionSchedules.create'))
  }

  console.log(`\n${fejl === 0 ? '  ALT GROENT' : `  ${fejl} FEJLEDE`}`)
  if (fejl) process.exitCode = 1
}

await koer()
