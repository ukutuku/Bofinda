// ═══════════════════════════════════════════════════════════════
//  UDFALDETS REGEL — prøvet mod virkeligheden, ikke mod sig selv.
//
//  Spørgsmålet «er det her udfald færdigt?» stod før tre steder som
//  håndskrevne navnelister: porten i `behandl()`, rutens statuskode og
//  tilsynets optælling. De tre var enige — men ved konstruktion, ikke
//  ved håndhævelse. Nu læser alle tre `UDFALD` i lib/webhook.ts.
//
//  ── HVORFOR PRØVEN IKKE MÅ SAMMENLIGNE DE TRE ───────────────
//  Læser de samme opslag, er de enige PER DEFINITION, og en prøve på
//  det kunne aldrig fejle. Prøven holder derfor tabellens PÅSTAND op
//  mod, hvad der faktisk står i basen og hvad ruten faktisk svarer.
//
//  ── HVORFOR DEN KAN FEJLE PÅ EN SYVENDE VÆRDI ───────────────
//  Den går `Object.keys(UDFALD)` igennem og KRÆVER en sag for hver.
//  Tilføjer nogen en værdi uden at prøve den, fejler prøven med
//  værdiens navn. Det er hullet fra 7327d42: dén commit skrev en prøve
//  for den nye værdi (`u1 === 'afventer'`) og ingen for, om ruten
//  fulgte med. Den her fejler på det omvendte.
//
//  De seks nuværende værdier kan ikke få den til at fejle. Det er
//  meningen: en prøve, der er rød i dag, måler noget andet.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { stripeEvents, subscriptions, users } from '../db/schema'
import { UDFALD, type Haendelse, type Udfald } from '../lib/webhook'
import { indsaetStripe } from '../lib/stripe'
import { lavFalsk } from './stripefalsk/index'
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
indsaetStripe(lavFalsk())

const S = Date.now()
const nu = () => Math.floor(Date.now() / 1000)
const h = (type: string, obj: Record<string, unknown>): Haendelse =>
  ({ id: `evt_${randomUUID()}`, type, created: nu(), data: { object: obj } })

/** Gennem den RIGTIGE rute — statuskoden skal være den, Stripe får. */
const post = (e: Haendelse) => POST(new Request('https://proeve.invalid/api/stripe', {
  method: 'POST',
  headers: { 'stripe-signature': 't=1,v1=attrappen-parser-kun',
             'content-type': 'application/json' },
  body: JSON.stringify(e),
}))

async function bruger(n: string) {
  const a = randomUUID()
  const e = `u${n}${S}${Math.floor(Math.random() * 1e6)}@x.invalid`
  await db.execute(sql`insert into auth.users (id,email) values (${a},${e}) on conflict do nothing`)
  const [u] = await db.insert(users).values({ email: e, authUserId: a })
    .returning({ id: users.id })
  return u!.id
}

/** Et abonnement, hvis spejling er ældre (behandlet) eller nyere (forael). */
async function medAbonnement(navn: string, spejletOm: number) {
  const sub = `sub_${navn}_${S}_${Math.floor(Math.random() * 1e6)}`
  await db.insert(subscriptions).values({
    userId: await bruger(navn), stripeSubscriptionId: sub, status: 'active',
    stripeOpdateretAt: new Date(Date.now() + spejletOm),
  })
  return sub
}

type Maaling = { status: number; udfald: string; id: string }
const kald = async (e: Haendelse): Promise<Maaling> => {
  // En kastet fejl er IKKE en prøvefejl i harnessen — den er et udfald.
  // `behandl()` kaster bl.a., hvis en regel modsiger sig selv, og ruten
  // svarer da 500 uden at kvittere. Det skal måles, ikke vælte prøven.
  try {
    const svar = await post(e)
    const krop = await svar.json() as { udfald?: string }
    return { status: svar.status, udfald: krop.udfald ?? '(intet udfald i svaret)', id: e.id }
  } catch (f) {
    return { status: 500, udfald: `(kastede: ${(f as Error).message})`, id: e.id }
  }
}

// ── ÉN SAG PR. UDFALD ─────────────────────────────────────────
// Nøglerne holdes op mod `UDFALD` nedenfor, i BEGGE retninger.
const SAGER: Record<string, () => Promise<Maaling>> = {
  behandlet: async () =>
    kald(h('customer.subscription.updated',
      { id: await medAbonnement('b', -600_000), status: 'active' })),

  forael: async () =>
    // Rækken bærer en NYERE spejling end hændelsen → `maaSpejle` rammer
    // nul rækker, og udfaldet er «ældre end det, rækken allerede bærer».
    kald(h('customer.subscription.updated',
      { id: await medAbonnement('f', +3_600_000), status: 'active' })),

  ignoreret: () => kald(h('customer.created', { id: `cus_i_${S}` })),

  gentagelse: async () => {
    const e = h('customer.created', { id: `cus_g_${S}` })
    await post(e)                       // første levering gør den færdig
    return kald(e)
  },

  i_gang: async () => {
    const e = h('customer.subscription.updated',
      { id: `sub_i_${randomUUID()}`, status: 'active' })
    // En anden behandler har kravet lige nu — og har IKKE gemt en
    // nyttelast, præcis som en behandler midt i sit arbejde.
    await db.insert(stripeEvents).values({ id: e.id, type: e.type,
      stripeOprettetAt: new Date(e.created * 1000), paabegyndtAt: new Date() })
    return kald(e)
  },

  afventer: () =>
    // En faktura uden sin checkout: forudsætningen er ikke kommet endnu.
    kald(h('invoice.paid', { id: `in_a_${randomUUID()}`,
      subscription: `sub_a_${randomUUID()}`,
      lines: { data: [{ period: { end: nu() + 86_400 } }] } })),
}

const raekken = (id: string) => db.select({
  behandlet: stripeEvents.behandletAt, nyttelast: stripeEvents.nyttelast,
  paabegyndt: stripeEvents.paabegyndtAt, naeste: stripeEvents.naesteForsoegAt,
  fejl: stripeEvents.fejl,
}).from(stripeEvents).where(eq(stripeEvents.id, id)).then((r) => r[0])

console.log('\nUDFALD — tabellens påstand mod basen og ruten\n')

// ── 1 · OPREGNINGEN ER UDTØMMENDE, BEGGE VEJE ─────────────────
// Den ene retning er hele pointen: en syvende værdi uden sag fejler
// HER, med sit navn. Den anden fanger en sag, der prøver noget, der
// ikke findes mere.
const noegler = Object.keys(UDFALD)
const udenSag = noegler.filter((u) => !(u in SAGER))
tjek('hvert udfald i UDFALD har en sag', udenSag.length === 0,
  udenSag.length ? `INGEN PRØVE FOR: ${udenSag.join(', ')}` : `${noegler.length} udfald`)
const udenUdfald = Object.keys(SAGER).filter((u) => !(u in UDFALD))
tjek('hver sag svarer til et udfald i UDFALD', udenUdfald.length === 0,
  udenUdfald.length ? `sag uden udfald: ${udenUdfald.join(', ')}` : '')

// ── 2 · TABELLENS PÅSTAND MOD VIRKELIGHEDEN ───────────────────
for (const navn of noegler) {
  const sag = SAGER[navn]
  if (!sag) continue                    // allerede talt som fejl ovenfor
  const regel = UDFALD[navn as Udfald]
  console.log(`\n  ${navn}  (tabellen siger: ${regel.faerdig ? 'færdig'
    : `IKKE færdig, kravet er ${regel.kravet}`})`)

  const m = await sag()
  tjek('  sagen giver det udfald, den er filed under', m.udfald === navn,
    `fik ${m.udfald}`)
  const r = await raekken(m.id)

  // Påstanden mod BASEN. `behandlet_at` er referatet af portens
  // beslutning — siger tabellen noget andet, er en af dem forkert.
  tjek('  behandlet_at stemmer med tabellen',
    regel.faerdig === (r?.behandlet != null),
    `tabellen=${regel.faerdig} · behandlet_at=${r?.behandlet ? 'sat' : 'null'}`)

  // Påstanden mod STRIPE. 200 = «prøv ikke igen».
  tjek('  rutens statuskode stemmer med tabellen',
    regel.faerdig === (m.status === 200),
    `tabellen=${regel.faerdig} · http=${m.status}`)

  if (regel.faerdig) continue

  if (regel.kravet === 'andens') {
    // Vi må ikke rydde op efter en behandler, der stadig arbejder.
    tjek('  en andens krav står urørt', r?.paabegyndt != null,
      `paabegyndt_at=${r?.paabegyndt ? 'sat' : 'null'}`)
    continue
  }

  // Kravet er VORES, og vi blev ikke færdige. Alle tre skrivninger
  // skal være der. Ingen af dem kan udledes af et flag, og springes
  // de over, er rækken enten låst i fem minutter, uden grund til et
  // menneske, eller permanent «klar» og sulter andres hændelser.
  tjek('  vores krav er frigivet (paabegyndt_at)', r?.paabegyndt == null,
    `paabegyndt_at=${r?.paabegyndt ? 'sat' : 'null'}`)
  tjek('  tilbagetrækningen er sat (naeste_forsoeg_at)', r?.naeste != null,
    `naeste_forsoeg_at=${r?.naeste ? 'sat' : 'NULL — rækken står permanent klar'}`)
  tjek('  der står en grund et menneske kan læse', (r?.fejl ?? '').length > 0,
    `fejl=${r?.fejl ?? 'null'}`)
  // Uden nyttelast kan tilsynet ikke køre den om: køen kræver den.
  tjek('  nyttelasten er i behold', r?.nyttelast != null,
    `nyttelast=${r?.nyttelast ? 'gemt' : 'RYDDET — kan aldrig køres om'}`)
}

console.log(fejl === 0 ? '\nALLE PRØVER BESTÅET\n' : `\n${fejl} FEJL\n`)
process.exit(fejl === 0 ? 0 : 1)
