// ═══════════════════════════════════════════════════════════════
//  Sjette gennemgangs to fund, prøvet mod rettelserne.
//
//  M1 · `noterOpsigelse` lavede TO selvstændige skrivninger —
//       beslutningen og køarbejdet. Fejlede den anden, stod
//       beslutningen uden en vej til udførelse: tre tilsynskørsler
//       gjorde intet, mens siden lovede automatisk genforsøg.
//  M2 · slutgrenen i `afstemAbonnement` kvitterede UBETINGET. Kom der
//       nyt, korrekt registreret arbejde, mens det afsluttende
//       Stripe-svar var i luften, slettede den gamle kvittering det.
//
//  Databasefejlen injiceres gennem repoets EGEN seam, `indsaetBase` —
//  `db` er en Proxy, der altid henter den levende klient, så den kan
//  ikke lappes udefra. Det er den samme kodevej, `testbase.ts` bruger.
//
//  Kapløbet i M2 måles her som en RÆKKEFØLGE (barriere på det
//  afsluttende opslag). Den samtidige udgave mod rigtig PostgreSQL
//  ligger i scripts/test-betaling-kaploeb.ts §E4.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, indsaetBase } from '../db/client'
import { checkoutForsoeg, drift, stripeEvents, subscriptions, users } from '../db/schema'
import { betalingstilsyn, stopForkertFornyelse } from '../lib/webhook'
import { sigOpFor, abonnementForBruger } from '../lib/abonnement'
import { afstemSkyldige, noterOpsigelse, skyldAfstemning } from '../lib/opsigelse'
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
  await db.execute(sql`insert into auth.users (id,email) values (${a},${`r6${n}${S}@x.invalid`}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: `r6${n}${S}@x.invalid`, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

const laes = (sub: string) => db.select({
  opsagtAf: subscriptions.opsagtAfKundeAt, opsagt: subscriptions.cancelAtPeriodEnd,
  skyldig: subscriptions.afstemningSkyldigAt, gen: subscriptions.afstemningGen,
  plan: subscriptions.stripeScheduleId, planStatus: subscriptions.planStatus,
  adgang: subscriptions.adgangTil, fejl: subscriptions.afstemningFejl,
  stoppet: subscriptions.fornyelseStoppetAt,
}).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub)).then((r) => r[0])

const saetAbo = (sub: string, v: Record<string, unknown>) =>
  (falsk.abonnementer as Map<string, unknown>).set(sub, v)

async function nulstil() {
  falsk.nulstil()
  await db.delete(checkoutForsoeg); await db.delete(subscriptions)
  await db.delete(stripeEvents)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))
}

async function medPlan(navn: string, v: Record<string, unknown> = {}) {
  const u = await bruger(navn)
  const sub = `sub_${navn}_${S}`
  const plan = `sch_${navn}_${S}`
  saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false, schedule: plan })
  falsk.planer.set(plan, { id: plan, status: 'active', subscription: sub, konfigureret: true,
    phases: [{ items: [{ price: OPS.introPrisId }] }, { items: [{ price: OPS.normalPrisId }] }] })
  await db.insert(subscriptions).values({
    userId: u, stripeSubscriptionId: sub, stripeCustomerId: `cus_${navn}`,
    status: 'active', adgangTil: new Date(Date.now() + 30 * 86400_000),
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    stripeScheduleId: plan, planStatus: 'konfigureret', cancelAtPeriodEnd: false, ...v,
  } as never)
  return { u, sub, plan }
}

/**
 * Bryd databasen for ALLE `update`-kald, og giv den tilbage igen.
 *
 * Gennem `indsaetBase`, ikke ved at lappe `db`: stedfortræderen i
 * db/client.ts henter den levende klient ved hvert opslag, så en
 * tilsnigelse udefra rammer den aldrig. Det er med vilje.
 */
function bryd(rammer: (v: Record<string, unknown>) => boolean = () => true): () => void {
  const METODER = ['select', 'update', 'insert', 'delete', 'execute',
                   'transaction', 'query', 'with', '$with'] as const
  const aegte: Record<string, unknown> = {}
  for (const m of METODER) {
    const v = (db as unknown as Record<string, unknown>)[m]
    if (v !== undefined) aegte[m] = v
  }
  const rigtigUpdate = aegte.update as (...a: unknown[]) => Record<string, unknown>
  indsaetBase({ ...aegte,
    update: (...a: unknown[]) => {
      const b = rigtigUpdate(...a)
      const set = (b.set as (v: unknown) => unknown).bind(b)
      b.set = (v: Record<string, unknown>) =>
        rammer(v)
          ? { where: () => Promise.reject(new Error('INJICERET_DB_FEJL')) }
          : set(v)
      return b
    },
  } as never, async () => {})
  return () => indsaetBase(aegte as never, async () => {})
}

/**
 * Den skrivning, der FANDTES, da fejlen fandtes: skylden ALENE.
 *
 * Praeciseringen er selve modproeven. Braekker man hver eneste
 * `update`, fejler ogsaa den FOERSTE skrivning i den gamle
 * to-saetnings-udgave — og saa staar der ingenting, hverken foer eller
 * efter rettelsen. Proeven ville vaere groen begge veje og maale
 * ingenting. (Maalt: den var det.)
 *
 * Nu rammer fejlen kun en skrivning, der saetter skylden UDEN
 * beslutningen. Efter rettelsen findes den skrivning ikke i
 * `noterOpsigelse` — de to er ét statement — saa intet gaar tabt. Foer
 * rettelsen er det praecis den anden af de to.
 */
const kunSkyldenAlene = (v: Record<string, unknown>) =>
  'afstemningSkyldigAt' in v && !('opsagtAfKundeAt' in v)

async function koer() {
  falsk = lavFalsk(); indsaetStripe(falsk)
  await db.update(drift).set({ tilstand: 'betaling' }).where(eq(drift.id, true))

  // ═════════════════════════════════════════════════════════════
  //  M1 · BESLUTNING OG KØARBEJDE KAN IKKE SKILLES AD
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ M1 · en gemt beslutning har altid en vej til udførelse ══')
  {
    // Fejlen ramte PRÆCIS den anden af to skrivninger. Den prøves
    // derfor på `noterOpsigelse` alene — ikke gennem hele `sigOpFor`,
    // hvor afstemningen laver sine EGNE skyld-skrivninger, som den
    // samme injektion også ville ramme. Så målte prøven noget andet,
    // end den siger. (Målt: den gjorde.)
    await nulstil()
    const { sub } = await medPlan('M1')
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const genskab = bryd(kunSkyldenAlene)
    let afvist: string | null = null
    try { await noterOpsigelse(sub) } catch (e) { afvist = (e as Error).message }
    genskab()

    const r = await laes(sub)
    // KERNEN: de to felter må aldrig kunne stå hver for sig.
    tjek('beslutning og køarbejde følges ad — begge eller ingen',
      (r?.opsagtAf !== null) === (r?.skyldig !== null),
      `opsagtAf=${r?.opsagtAf !== null} skyldig=${r?.skyldig !== null} (kastede: ${afvist})`)
    tjek('  …og her landede BEGGE, fordi det er ét statement',
      r?.opsagtAf !== null && r?.skyldig !== null)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT', r?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ M1c · en fejlet skrivning giver et SVAR, ikke en kastet fejl ══')
  {
    // `sigOpFor` kastede sit promise videre, så kunden mødte en
    // ubehandlet fejl. Her brækkes ALT — vi kommer ikke til at gemme
    // noget, og det er netop pointen: så skal svaret sige, at vi ikke
    // ved, om noget blev gemt.
    await nulstil()
    const { u, sub } = await medPlan('M1c')
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    const genskab = bryd()
    let svar: unknown = null; let afvist: string | null = null
    try { svar = await sigOpFor(u) } catch (e) { afvist = (e as Error).message }
    genskab()

    const r = await laes(sub)
    const ui = await abonnementForBruger(u)
    tjek('kaldet afviser ikke sit promise — kunden får en besked',
      afvist === null, `afvist=${afvist}`)
    // ── «IKKE GEMT» ER IKKE «AFVENTER» ──────────────────
    // Skrivningen er ét statement: fejler den, står HVERKEN
    // beslutningen eller skylden. Så er «vi prøver automatisk igen»
    // et løfte om en automatik, der ikke findes — N1's fejl i en ny
    // forklædning. De to udfald skal holdes adskilt.
    tjek('  svaret er «ikke_gemt» — ikke «afventer»',
      (svar as { fejl?: string } | null)?.fejl === 'ikke_gemt', JSON.stringify(svar))
    tjek('  …og der står da heller ingenting i basen',
      r?.opsagtAf === null && r?.skyldig === null,
      `opsagtAf=${r?.opsagtAf} skyldig=${r?.skyldig}`)
    tjek('  siden lover ikke genforsøg om en tom kø',
      !(ui?.opsigelseUndervejs === true && r?.skyldig === null),
      `undervejs=${ui?.opsigelseUndervejs} skyldig=${r?.skyldig !== null}`)
    tjek('  KUNDENS BETALTE ADGANG ER URØRT', r?.adgang?.getTime() === adgangFoer)

    // Og når basen virker igen: opsigelsen går igennem.
    const svar2 = await sigOpFor(u)
    const r2 = await laes(sub)
    tjek('  andet tryk går igennem', (svar2 as { ok?: boolean }).ok === true,
      JSON.stringify(svar2))
    tjek('  …og Stripe har opsigelsen',
      falsk.abonnementer.get(sub)?.cancel_at_period_end === true)
    tjek('  skylden er indfriet', r2?.skyldig === null)
  }

  console.log('\n══ M1b · ét tryk = én skrivning, og gentagne tryk bevarer tidspunktet ══')
  {
    await nulstil()
    const { sub } = await medPlan('M1b')
    await noterOpsigelse(sub)
    const a = await laes(sub)
    tjek('beslutning OG skyld er sat af det samme kald',
      a?.opsagtAf !== null && a?.skyldig !== null,
      `opsagtAf=${a?.opsagtAf} skyldig=${a?.skyldig}`)
    tjek('  generationen er hævet', (a?.gen ?? 0) === 1, `gen=${a?.gen}`)

    await new Promise((r) => setTimeout(r, 5))
    await noterOpsigelse(sub)
    const b = await laes(sub)
    // Det FØRSTE tidspunkt er det rigtige: det er dér, kunden traf
    // valget, og det er dét, spejlingen sammenligner en forsinket
    // hændelse med. Det var `isNull`-vagtens opgave; nu er det
    // `coalesce`, og egenskaben skal være den samme.
    tjek('  gentaget tryk bevarer det FØRSTE beslutningstidspunkt',
      b?.opsagtAf?.getTime() === a?.opsagtAf?.getTime(),
      `${a?.opsagtAf?.toISOString()} → ${b?.opsagtAf?.toISOString()}`)
    tjek('  …og det første SKYLD-tidspunkt', b?.skyldig?.getTime() === a?.skyldig?.getTime())
    tjek('  men generationen stiger — det er en ny registrering',
      (b?.gen ?? 0) === 2, `gen=${b?.gen}`)
  }

  // ═════════════════════════════════════════════════════════════
  //  M2 · EN KVITTERING DÆKKER KUN DET, DEN HAR SET
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ M2 · nyt køarbejde overlever en ældre kvittering ══')
  {
    await nulstil()
    const { u, sub, plan } = await medPlan('M2')
    const adgangFoer = (await laes(sub))!.adgang!.getTime()

    // MENS det afsluttende Stripe-svar er i luften, registrerer en
    // anden aktør nyt arbejde — præcis som `laegPlan` gør, når dens
    // forsinkede `create` vender tilbage på et opsagt abonnement.
    const rigtig = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    let engang = false
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      const svar = await rigtig(id)
      if (!engang) {
        engang = true
        await skyldAfstemning(sub, 'planen blev lagt, mens kunden sagde op')
        falsk.planer.set(`${plan}_ny`, { id: `${plan}_ny`, status: 'active',
          subscription: sub, konfigureret: true,
          phases: [{ items: [{ price: OPS.introPrisId }] }] })
      }
      return svar
    }
    const svar = await sigOpFor(u)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtig

    const r = await laes(sub)
    tjek('kunden får sit ja — VORES arbejde blev gjort',
      (svar as { ok?: boolean }).ok === true, JSON.stringify(svar))
    tjek('  men det NYERE køarbejde står stadig', r?.skyldig !== null,
      `skyldig=${r?.skyldig} gen=${r?.gen}`)

    const foer = falsk.kald.length
    console.log(`     DBG raekke=${JSON.stringify(await laes(sub))}`)
    for (let i = 0; i < 3; i++) await betalingstilsyn(OPS)
    const nye = falsk.kald.length - foer
    const r2 = await laes(sub)
    tjek('  tilsynet tager den op og rører Stripe', nye > 0, `${nye} kald`)
    tjek('  skylden er indfriet til sidst — af en kørsel, der HAR set den',
      r2?.skyldig === null, `skyldig=${r2?.skyldig}`)
    // Bemærk, hvad der IKKE måles her. Om den nye plan ender sluppet,
    // afhænger af, hvad Stripe gør ved `subscription.schedule`, når en
    // ANDEN plan frigives — og attrappen rydder feltet ubetinget, så
    // opstillingen kan ikke udtrykke «gammel sluppet, ny bundet».
    // Det er ikke målt, og det påstås ikke. Fundet er, at køarbejdet
    // blev slettet, og dét er målt ovenfor.
    //
    // Er den nye plan FAKTISK bundet hos Stripe, fanger den
    // autoritative tilbagelæsning det allerede: den kaster «en plan
    // styrer stadig abonnementet», og så kvitteres der slet ikke.
    // Runde 5's N2 dækker den vej.
    tjek('  KUNDENS BETALTE ADGANG ER URØRT', r2?.adgang?.getTime() === adgangFoer)
  }

  console.log('\n══ M2b · planbindingen ryddes kun, hvis den peger på DEN plan ══')
  {
    // Den anden halvdel af M2: ikke bare skylden, men bindingen. Bandt
    // en anden aktør en NY plan, mens vi var i luften, må vores
    // oprydning ikke slette den — så stod planen aktiv hos Stripe uden
    // at være bundet hos os, og ingen kø ville se den.
    await nulstil()
    const { u, sub, plan } = await medPlan('M2b')
    const rigtig = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    let engang = false
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      const svar = await rigtig(id)
      if (!engang) {
        engang = true
        await db.update(subscriptions)
          .set({ stripeScheduleId: `${plan}_ny`, planStatus: 'oprettet' })
          .where(eq(subscriptions.stripeSubscriptionId, sub))
      }
      return svar
    }
    await sigOpFor(u)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtig
    const r = await laes(sub)
    tjek('den NYE binding står endnu — vi slap den aldrig',
      r?.plan === `${plan}_ny`, `plan=${r?.plan}`)
  }

  console.log('\n══ M2c · generationen, ikke tidsstemplet ══')
  {
    // Gennemgangens egen pointe, målt: `coalesce(skyldig_at, now())`
    // BEVARER med vilje det gamle tidspunkt, så to generationer af
    // arbejde får præcis samme værdi. Tidsstemplet kan derfor ikke
    // bruges til at se, om der er kommet noget nyt.
    await nulstil()
    const { sub } = await medPlan('M2c')
    await skyldAfstemning(sub, 'første')
    const a = await laes(sub)
    await skyldAfstemning(sub, 'anden')
    const b = await laes(sub)
    tjek('to registreringer får SAMME tidsstempel',
      a?.skyldig?.getTime() === b?.skyldig?.getTime(),
      `${a?.skyldig?.toISOString()} = ${b?.skyldig?.toISOString()}`)
    tjek('  …men FORSKELLIG generation — det er dét, der kan skelnes',
      (b?.gen ?? 0) > (a?.gen ?? 0), `${a?.gen} → ${b?.gen}`)
  }

  console.log('\n══ M2d · en kvittering på en forældet generation rydder intet ══')
  {
    await nulstil()
    const { sub } = await medPlan('M2d', { opsagtAfKundeAt: new Date() })
    await skyldAfstemning(sub, 'arbejde A')
    // Afstemningen læser generationen … og imens kommer der mere.
    const foer = (await laes(sub))!.gen
    await skyldAfstemning(sub, 'arbejde B')
    // Kvitteringen for A må ikke rydde B.
    await afstemSkyldige(OPS)
    const r = await laes(sub)
    tjek('generationen steg, mens arbejdet stod på',
      (r?.gen ?? 0) > (foer ?? 0), `${foer} → ${r?.gen}`)
    tjek('  og rækken er enten afklaret eller stadig skyldig — aldrig tavs',
      r?.opsagt === true || r?.skyldig !== null,
      `cape=${r?.opsagt} skyldig=${r?.skyldig}`)
  }

  // ═════════════════════════════════════════════════════════════
  //  DE TRE FUND I RETTELSERNE SELV
  // ═════════════════════════════════════════════════════════════
  console.log('\n══ S1 · et MISS er et udfald, ikke en tavshed ══')
  {
    // `ryd()` returnerede `void`, så en forbigået kvittering var
    // usynlig: udfaldet blev «afstemt», og tilsynet skrev
    // «1 skyldige · 1 taget · 1 afstemt · 0 kunne ikke endnu» om en
    // række, der STADIG var skyldig. Det er CLAUDE.md's egen regel —
    // en manglende oplysning skal være synlig — vendt indad.
    await nulstil()
    const { sub } = await medPlan('S1', { opsagtAfKundeAt: new Date(),
      stripeScheduleId: null, planStatus: null })
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false })
    await skyldAfstemning(sub, 'arbejde A')
    const rigtig = (falsk.subscriptions as { retrieve: (id: string) => Promise<unknown> })
      .retrieve.bind(falsk.subscriptions)
    let engang = false
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = async (id: string) => {
      const svar = await rigtig(id)
      if (!engang) { engang = true; await skyldAfstemning(sub, 'arbejde B') }
      return svar
    }
    const u = await afstemSkyldige(OPS)
    ;(falsk.subscriptions as Record<string, unknown>).retrieve = rigtig
    const r = await laes(sub)
    tjek('rapporten melder ikke «afstemt» om en række, der stadig er skyldig',
      !(u.afstemte > 0 && r?.skyldig !== null),
      `afstemte=${u.afstemte} skyldig=${r?.skyldig !== null}`)
    tjek('  …den tæller det som NYT ARBEJDE, så det kan ses',
      u.nytArbejde === 1, `nytArbejde=${u.nytArbejde}`)
    tjek('  og skylden står, så næste kørsel tager den',
      r?.skyldig !== null)
  }

  console.log('\n══ S2 · binding og skyld kan ikke komme i utakt ══')
  {
    // To vagter, to skrivninger: med en FORÆLDET lokal binding missede
    // bindingsvagten, mens generationsvagten ramte. Skylden blev
    // ryddet, bindingen stod — og rækken påstod «plan konfigureret»
    // uden køarbejde. Nu er de ét statement under samme vagt.
    await nulstil()
    const { sub } = await medPlan('S2', { opsagtAfKundeAt: new Date(),
      stripeScheduleId: `sch_gammel_lokal_${S}`, planStatus: 'konfigureret' })
    const hos = `sch_hos_stripe_${S}`
    saetAbo(sub, { id: sub, status: 'active', cancel_at_period_end: false, schedule: hos })
    falsk.planer.set(hos, { id: hos, status: 'active', subscription: sub,
      konfigureret: true, phases: [{ items: [{ price: OPS.introPrisId }] }] })
    await skyldAfstemning(sub, 'kunden har sagt op')
    await afstemSkyldige(OPS)
    const r = await laes(sub)
    tjek('binding og skyld følges ad — ingen halv oprydning',
      !(r?.plan !== null && r?.skyldig === null),
      `plan=${r?.plan} skyldig=${r?.skyldig}`)
  }

  console.log('\n══ S3 · vores EGET stop har også altid en vej til udførelse ══')
  {
    // Samme fejl som M1, med os som forfatter: `besluttetAfOs` skrev
    // beslutningen alene, og skylden blev sat i en catch langt nede.
    // Fejlede DEN skrivning, stod `fornyelse_stoppet_at` uden
    // køarbejde, og tre tilsynskørsler gjorde intet. Målt.
    await nulstil()
    const { sub } = await medPlan('S3', {
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
      adgangTil: new Date(Date.now() + 30 * 60_000),
      currentPeriodEnd: new Date(Date.now() + 30 * 60_000),
    })
    falsk.fejlPaa.add('subscriptionSchedules.release')
    const genskab = bryd((v) => 'afstemningSkyldigAt' in v && !('fornyelseStoppetAt' in v))
    let afvist: string | null = null
    try { await stopForkertFornyelse(OPS, sub, 'prøvens grund') }
    catch (e) { afvist = (e as Error).message }
    genskab()
    const r = await laes(sub)
    tjek('beslutning og køarbejde følges ad — begge eller ingen',
      (r?.stoppet !== null) === (r?.skyldig !== null),
      `stoppet=${r?.stoppet !== null} skyldig=${r?.skyldig !== null} (kastede: ${afvist})`)
    const foer = falsk.kald.length
    for (let i = 0; i < 3; i++) await betalingstilsyn(OPS)
    tjek('  …og tilsynet kommer videre med den',
      falsk.kald.length > foer, `${falsk.kald.length - foer} kald`)
  }

  console.log('\n══ S4 · et LYKKEDES stop efterlader ikke evigt arbejde ══')
  {
    // Modstykket: kvitteringen for vores eget stop skal også ske — men
    // betinget, så den ikke rydder arbejde, en anden har registreret.
    await nulstil()
    const { sub } = await medPlan('S4', {
      planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
      adgangTil: new Date(Date.now() + 30 * 60_000),
      currentPeriodEnd: new Date(Date.now() + 30 * 60_000),
    })
    const svar = await stopForkertFornyelse(OPS, sub, 'prøvens grund')
    const r = await laes(sub)
    tjek('indgrebet lykkedes', svar === 'stoppet', `svar=${svar}`)
    tjek('  …og skylden er kvitteret med det samme', r?.skyldig === null,
      `skyldig=${r?.skyldig}`)
    const foer = falsk.kald.length
    await betalingstilsyn(OPS)
    tjek('  næste kørsel rører den ikke igen',
      falsk.kald.length === foer, `${falsk.kald.length - foer} kald`)
  }

  console.log('\n══ S5 · én dårlig række må ikke tage de øvrige med sig ══')
  {
    // `iFareForForkertFornyelse` er den SIDSTE sikring før en forkert
    // fornyelse. Løkken over den lå i ét stort try, og
    // `stopForkertFornyelse` kunne kaste — dens docstring lovede
    // ellers det modsatte. Målt: kastede den første, fik de øvrige
    // INTET forsøg, og loggen sagde kun «fornyelsesbeskyttelsen
    // fejlede». Nul af to.
    //
    // ── TO RETTELSER, OG DE ER REDUNDANTE MED VILJE ─────
    // `stopForkertFornyelse` holder nu sit «KASTER IKKE»-løfte, OG
    // løkken bærer fejlen pr. række. Hver for sig er nok, så en
    // modprøve, der kun ruller den ene tilbage, bliver GRØN — målt.
    // Det er godt nyt om koden og dårligt nyt om den modprøve:
    // modprøven ruller derfor BEGGE tilbage, og så bliver den her rød
    // med 0 af 2. Redundansen er ikke tilfældig: den ene beskytter
    // mod en fejl vi kender, den anden mod dem vi ikke har set endnu.
    await nulstil()
    const lav = async (n: string) => {
      const { sub } = await medPlan(n, {
        planStatus: 'fejlet', planForsoeg: 5, planFejl: 'modelleret',
        adgangTil: new Date(Date.now() + 20 * 60_000),
        currentPeriodEnd: new Date(Date.now() + 20 * 60_000),
      })
      falsk.planer.set(`sch_${n}_${S}`, { id: `sch_${n}_${S}`, status: 'active',
        subscription: sub, konfigureret: false,
        phases: [{ items: [{ price: OPS.introPrisId }] }] })
      return sub
    }
    const a = await lav('S5a'); const b = await lav('S5b'); const c = await lav('S5c')
    falsk.fejlPaa.add('subscriptionSchedules.release')
    // Kun den FØRSTE rækkes skyld-skrivning brækkes.
    let brugt = false
    const genskab = bryd((v) => {
      if (brugt) return false
      if ('afstemningSkyldigAt' in v && !('fornyelseStoppetAt' in v)) {
        brugt = true; return true
      }
      return false
    })
    const linjer = await betalingstilsyn(OPS)
    genskab()

    const roert = (await Promise.all([b, c].map(laes)))
      .filter((r) => r?.stoppet !== null).length
    tjek('de øvrige rækker fik også et forsøg', roert === 2, `${roert} af 2`)
    tjek('  …og den dårlige række har sin EGEN linje',
      linjer.some((l) => l.includes(a) && l.includes('⚠⚠')),
      JSON.stringify(linjer.filter((l) => l.includes(a))))
    tjek('  loggen siger ikke bare «fornyelsesbeskyttelsen fejlede»',
      !linjer.some((l) => l.includes('fornyelsesbeskyttelsen fejlede')),
      JSON.stringify(linjer.filter((l) => l.includes('fejlede'))))
  }

  console.log(`\n${fejl === 0 ? '  ALT GROENT' : `  ${fejl} FEJLEDE`}`)
  if (fejl) process.exitCode = 1
}

await koer()
