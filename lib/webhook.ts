// ═══════════════════════════════════════════════════════════════
//  Behandlingen af en Stripe-haendelse.
//
//  Udskilt fra ruten, saa den kan proeves uden en HTTP-server og uden
//  en Stripe-forbindelse: proeven kalder `behandl()` med et objekt i
//  Stripes form. Ruten goer kun tre ting — laeser den RAA krop,
//  efterproever signaturen og kalder herind.
//
//  ── DE TRE VAGTER ───────────────────────────────────────────
//  1. GENTAGELSE. Stripe leverer mindst én gang. `stripe_events` har
//     Stripes eget event-id som primaernoegle, saa en gentagelse ikke
//     kan indsaettes to gange. En haendelse, der allerede er
//     FAERDIGBEHANDLET, springes over.
//  2. GENBEHANDLING. En haendelse, der kastede undervejs, staar med
//     `behandlet_at = null` og koeres igen ved naeste levering — den
//     springes ikke over som «allerede set».
//  3. FORSINKELSE. Stripe garanterer ikke raekkefoelgen. En gammel
//     haendelse maa ikke genaabne et udloebet abonnement, saa hver
//     skrivning kraever, at haendelsens tidsstempel er NYERE end det,
//     vi allerede har skrevet paa raekken (`stripe_opdateret_at`).
//
//  ── ADGANG KUN VED BETALT FAKTURA ───────────────────────────
//  `adgang_til` flyttes ét sted: i `invoice.paid`. Hverken
//  `checkout.session.completed` (som kun siger, at kassen blev
//  gennemfoert), `customer.subscription.created` eller
//  `customer.subscription.updated` flytter adgangen. Det er derfor et
//  mislykket traek ikke giver en ny betalt periode: fakturaen bliver
//  aldrig `paid`, og `adgang_til` staar stille, til den gamle periode
//  loeber ud.
// ═══════════════════════════════════════════════════════════════

import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { TERMINALE, UAFSLUTTET, checkoutForsoeg, erTerminal, erTerminalTekst,
  stripeEvents, subscriptions, users } from '../db/schema'
import { INTRO_TIMER, fase, faser, stripe, type Stripeopsaetning } from './stripe'
import { INGEN_BESLUTNING, RYD_SAET, afstemSkyldige, bindingUroert,
  planDerStyrer, planGaelder, skalFornyelsenStoppes, skyldAfstemning } from './opsigelse'

/** De haendelser, vi handler paa. Alt andet kvitteres og ignoreres. */
export const LYTTER = [
  // Kassen gennemfoert. Knytter abonnementet til brugeren; giver IKKE adgang.
  'checkout.session.completed',
  // Betalt faktura. Det ENESTE, der flytter adgangen.
  'invoice.paid',
  // Mislykket traek. Flytter INGEN adgang — kun status.
  'invoice.payment_failed',
  // Stripes egen spejling af status, opsigelse og periode.
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

type Ukendt = Record<string, unknown>
const tekst = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const tal = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const tid = (sek: unknown): Date | null => {
  const n = tal(sek)
  return n === null ? null : new Date(n * 1000)
}

/**
 * Perioden ligger paa ITEMET, ikke paa abonnementet.
 *
 * I stripe@22 (API 2026-08-26.dahlia) har Subscription-objektet
 * hverken `current_period_start` eller `current_period_end` — se
 * node_modules/stripe/esm/resources/Subscriptions.d.ts:90. De ligger
 * paa hvert SubscriptionItem. Vi laeser det foerste item, fordi
 * modellen kun har ét. Findes det ikke, returneres null, og INTET
 * skrives: et udregnet tidspunkt ville vaere et gaet om nogens adgang.
 */
export function periode(sub: Ukendt): { start: Date | null; slut: Date | null } {
  const items = (sub['items'] as Ukendt | undefined)?.['data']
  const f = Array.isArray(items) ? items[0] as Ukendt | undefined : undefined
  return {
    start: tid(f?.['current_period_start']) ?? tid(sub['current_period_start']),
    slut: tid(f?.['current_period_end']) ?? tid(sub['current_period_end']),
  }
}

export interface Haendelse {
  id: string
  type: string
  created: number
  data: { object: Ukendt }
}

/**
 * Hvad PORTEN i `behandl()` skal goere ved et udfald.
 *
 * En boolean var ikke nok, og det er ikke en smagssag: «ikke faerdig»
 * daekker TO tilstande, og den forkerte efterbehandling er dyr begge
 * veje.
 *
 *   · Er kravet en ANDENS, maa vi ikke frigive det. Gjorde vi det,
 *     kunne to behandlere arbejde paa samme haendelse samtidig — og
 *     det atomiske krav er netop det, der forhindrer det.
 *   · Er kravet VORES, skal ALLE TRE skrivninger med. De kan ikke
 *     udledes af et flag, og en noegle, der ser fuldstaendig ud, er
 *     praecis det, der faar dem oversprunget:
 *       `paabegyndt_at = null`  ellers svarer de naeste
 *                               KRAV_TIMEOUT_MIN = 5 minutter 'i_gang'
 *       `fejl` som COALESCE     den praecise grund vinder over den
 *                               generelle, se porten
 *       `naeste_forsoeg_at`     uden den staar raekken permanent som
 *                               «klar», ligger forrest i
 *                               `orderBy(stripe_oprettet_at)` og
 *                               optager én af tilsynets 50 pladser i
 *                               hver eneste time. Det er fund 6 igen,
 *                               men nu sulter den ANDRES haendelser.
 *
 * Derfor en diskrimineret union og ikke et flag: en syvende vaerdi kan
 * ikke noejes med `{ faerdig: false }` — det er en oversaetterfejl.
 * Forfatteren SKAL svare paa, hvis krav det er, og er det vores, hvad
 * der skal staa, naar behandleren ikke selv har skrevet en grund.
 *
 * Det fjerner ikke muligheden for at gaette `faerdig` forkert. Det
 * goer, at et forkert gaet er forkert ÉT sted — og at raekken,
 * statuskoden og tilsynets optaelling ikke kan sige tre forskellige
 * ting.
 */
type Udfaldsregel =
  | { faerdig: true }
  | { faerdig: false; kravet: 'andens' }
  | { faerdig: false; kravet: 'vores'; grund: string }

/**
 * DE SEKS UDFALD OG DERES REGEL — beregnet ét sted, laest tre.
 *
 * Spoergsmaalet «er det her udfald faerdigt?» stod foer tre steder som
 * haandskrevne navnelister: porten paa :189, rutens statuskode
 * (app/api/stripe/route.ts) og tilsynets optaelling i
 * `behandlUbehandlede`. De tre var enige — men ved KONSTRUKTION, ikke
 * ved haandhaevelse: alt der ikke er 'afventer' falder gennem porten
 * til `faerdig()`, saa listerne gengav resultatet i stedet for at
 * bestemme det.
 *
 * Det er sket foer. `3640549` havde fire udfald, alle faerdige, og
 * ruten svarede `status: 200` ubetinget — korrekt. `7327d42` tilfoejede
 * 'i_gang' OG 'afventer', begge IKKE faerdige, og roerte ikke ruten.
 * Begge nye vaerdier blev tavst kvitteret med «proev ikke igen».
 * `234f5f6` rettede det ved at NAVNGIVE de to — altsaa samme form én
 * vaerdi laengere fremme.
 *
 * Typen afledes af tabellen, saa en vaerdi uden regel ikke kan skrives,
 * og `Object.keys(UDFALD)` er den opregning, `scripts/test-udfald.ts`
 * kraever en sag for.
 */
export const UDFALD = {
  /** Anvendt. */
  behandlet: { faerdig: true },
  /** Set og faerdigbehandlet foer — af en anden levering, ikke af os. */
  gentagelse: { faerdig: true },
  /**
   * Ikke en haendelse, vi lytter paa.
   *
   * NOTERET, IKKE LOEST: vaerdien baerer allerede TO domme. Porten
   * ovenfor svarer 'ignoreret' om en TYPE uden for `LYTTER` — dér er
   * «faerdig» rigtigt, der var intet at goere. Men behandlerne svarer
   * SAMME vaerdi om en type, vi DA lytter paa, naar et paakraevet id
   * manglede (`kassen`, `betalt`, `mislykkedes`, `spejl`). Den bliver
   * ogsaa markeret faerdig og faar sin nyttelast ryddet, og kan derfor
   * aldrig koeres om.
   *
   * I dag er det formentlig rigtigt — en engangsfaktura har ingen
   * `subscription` — men sikkerheden hviler paa Stripes objektform, og
   * den har allerede flyttet sig én gang (`current_period_*` rykkede
   * fra Subscription til SubscriptionItem i stripe@22). Det er samme
   * slags sammenfald som det, opslaget her findes for: en gren, der
   * ikke venter paa en ny vaerdi, men allerede har slaaet to
   * eksisterende sammen. Ikke efterproevet, ikke aendret.
   */
  ignoreret: { faerdig: true },
  /** Aeldre end det, raekken allerede baerer. */
  forael: { faerdig: true },
  /**
   * En anden behandler har kravet lige nu. Vi maa IKKE frigive det:
   * det er hele meningen med det atomiske krav. Behandleren kan doe
   * midt i, og saa frigiver KRAV_TIMEOUT_MIN kravet af sig selv.
   */
  i_gang: { faerdig: false, kravet: 'andens' },
  /**
   * AFVENTER er det udfald, der manglede. Haendelsen er gyldig, men
   * forudsaetningen er ikke kommet endnu — typisk en `invoice.paid`,
   * der overhaler sin `checkout.session.completed`. Den maa IKKE
   * markeres faerdig: goer man det, giver genleveringen «gentagelse»,
   * og den betalte periode er tabt for altid. Den var reproducerbar
   * paa 832d483.
   */
  afventer: { faerdig: false, kravet: 'vores', grund: 'afventer forudsaetning' },
} as const satisfies Record<string, Udfaldsregel>

export type Udfald = keyof typeof UDFALD

/** Et krav frigives, hvis behandleren doer. Stripe leverer igen. */
const KRAV_TIMEOUT_MIN = 5

/**
 * Behandler én haendelse. Idempotent: samme haendelse to gange giver
 * «gentagelse» anden gang og aendrer intet.
 */
export async function behandl(h: Haendelse, o: Stripeopsaetning | null): Promise<Udfald> {
  const oprettet = new Date(h.created * 1000)

  // ── Vagt 1-3: ét ATOMISK krav paa haendelsen ────────────────
  // Foer stod her en laesning af `behandlet_at` efterfulgt af en
  // beslutning. To samtidige leveringer laeste begge null og fortsatte
  // begge — primaernoeglen forhindrer to RAEKKER, ikke to BEHANDLERE.
  //
  // Nu tages kravet med ÉN betinget UPDATE. Den rammer enten én raekke
  // (vi har kravet) eller nul (en anden har det, eller den er faerdig).
  // `paabegyndt_at` frigives efter KRAV_TIMEOUT_MIN, saa en doed
  // behandler ikke laaser haendelsen for evigt.
  // NYTTELASTEN GEMMES. Uden den kan en haendelse, vi ikke naaede at
  // faerdiggoere, kun tages op igen, hvis STRIPE leverer den igen — og
  // Stripe holder op efter sit genforsoegsvindue. Med den kan vores
  // eget tilsyn koere den om naar som helst, ogsaa bagefter. Det er
  // den «fungerende genbehandlingsvej», fund 1 beder om.
  await db.insert(stripeEvents)
    .values({
      id: h.id, type: h.type, stripeOprettetAt: oprettet,
      nyttelast: kunDetViLaeser(h),
    })
    .onConflictDoNothing()

  const krav = await db.update(stripeEvents)
    // `fejl` ryddes, naar kravet tages. Ellers ville en fejltekst fra
    // et TIDLIGERE forsoeg overleve ind i det naeste og se ud, som om
    // den hoerte til dét — og vagten nedenfor, der bevarer en
    // behandlers egen, praecise grund, ville bevare en forældet.
    .set({ paabegyndtAt: new Date(), fejl: null,
           forsoeg: sql`${stripeEvents.forsoeg} + 1` })
    .where(and(
      eq(stripeEvents.id, h.id),
      isNull(stripeEvents.behandletAt),
      or(
        isNull(stripeEvents.paabegyndtAt),
        lte(stripeEvents.paabegyndtAt,
          sql`now() - interval '${sql.raw(String(KRAV_TIMEOUT_MIN))} minutes'`),
      ),
    ))
    .returning({ id: stripeEvents.id })

  if (!krav.length) {
    const [kvit] = await db.select({ behandlet: stripeEvents.behandletAt })
      .from(stripeEvents).where(eq(stripeEvents.id, h.id)).limit(1)
    return kvit?.behandlet ? 'gentagelse' : 'i_gang'
  }

  if (!(LYTTER as readonly string[]).includes(h.type)) {
    await faerdig(h.id)
    return 'ignoreret'
  }

  const obj = h.data.object
  let udfald: Udfald = 'behandlet'
  try {
    switch (h.type) {
      case 'checkout.session.completed': udfald = await kassen(obj, oprettet, h.id); break
      case 'invoice.paid': udfald = await betalt(obj, oprettet, o, h.id); break
      case 'invoice.payment_failed': udfald = await mislykkedes(obj, oprettet); break
      default: udfald = await spejl(obj, oprettet, o); break
    }
  } catch (e) {
    // Fejlen gemmes, og `behandlet_at` bliver staaende null, saa Stripes
    // naeste levering koerer den igen. Vi sluger den IKKE i tavshed.
    // Kravet frigives, saa genleveringen kan tage fat med det samme
    // og ikke skal vente KRAV_TIMEOUT_MIN ud. `behandlet_at` bliver
    // staaende null — vi sluger ikke fejlen.
    await db.update(stripeEvents)
      .set({
        fejl: (e as Error).message.slice(0, 500), paabegyndtAt: null,
        naesteForsoegAt: naesteForsoeg(await forsoegstal(h.id)),
      })
      .where(eq(stripeEvents.id, h.id))
    throw e
  }
  // ── PORTEN ────────────────────────────────────────────────
  // Her afgoeres det ene spoergsmaal: er haendelsen faerdig? Svaret
  // OPSLAAS i `UDFALD` — det er ikke en liste, porten selv foerer.
  // Ruten (app/api/stripe/route.ts) og tilsynets optaelling laeser
  // samme opslag, saa de tre ikke kan drive fra hinanden.
  //
  // Foer stod her `if (udfald === 'afventer')`: én af seks vaerdier
  // navngivet, alt andet gennem til `faerdig()`. Den var rigtig — men
  // ved konstruktion, ikke ved haandhaevelse, og en syvende vaerdi
  // ville derfor falde i den gren, der er uoprettelig: `faerdig()`
  // rydder nyttelasten, og tilsynets koe kraever den.
  const regel: Udfaldsregel = UDFALD[udfald]
  if (!regel.faerdig) {
    // ── 'andens' KAN IKKE VAERE SANDT HER ─────────────────────
    // Naar vi er naaet til porten, ER kravet vores: vi tog det med den
    // betingede UPDATE ovenfor, og 'i_gang' vender tilbage foer porten,
    // netop fordi den IKKE fik kravet. Et udfald fra switchen med
    // `kravet: 'andens'` er derfor en selvmodsigelse — og den maa ikke
    // kunne bruges som en genvej uden om de tre skrivninger nedenfor.
    //
    // Vi kvitterer ikke, og vi tier ikke. Kravet frigives, grunden
    // skrives, tilbagetraekningen saettes — og saa kastes der: ruten
    // svarer 500, Stripe leverer igen, nyttelasten er i behold, og
    // tilsynet taeller den som `fejlet` i driftlinjen hver time.
    // En larmende, genoprettelig fejl er det modsatte af det tavse
    // 200, hele det her opslag findes for at forhindre.
    if (regel.kravet === 'andens') {
      const besked = `udfaldet '${udfald}' naaede porten med kravet: 'andens'`
        + ' — her er kravet altid vores. Ret reglen i UDFALD.'
      await db.update(stripeEvents)
        .set({ fejl: besked.slice(0, 500), paabegyndtAt: null,
               naesteForsoegAt: naesteForsoeg(await forsoegstal(h.id)) })
        .where(eq(stripeEvents.id, h.id))
      throw new Error(besked)
    }

    // Kravet er VORES, og vi blev ikke faerdige. Kravet frigives, saa
    // Stripes naeste levering kan tage det op igen, naar
    // forudsaetningen er kommet. Det er hele rettelsen af fund 1a.
    await db.update(stripeEvents)
      .set({
        paabegyndtAt: null,
        // ── DEN PRAECISE GRUND VINDER OVER DEN GENERELLE ──────
        // Her stod `fejl: 'afventer forudsaetning'` ubetinget, og den
        // overskrev det, behandleren lige havde skrevet. En raekke, der
        // afventer, fordi «kontoen har allerede et levende abonnement»,
        // saa derefter ud som enhver anden ventende — og netop DEN skal
        // et menneske se, for den loeser sig ikke selv.
        //
        // Samme spoergsmaal, to svar: nu er det generelle et
        // FALDBACK, ikke en overskrivning. `fejl` er ryddet, da kravet
        // blev taget, saa det, der staar, er fra dette forsoeg.
        // Faldbacken staar i `UDFALD`, saa en ny ikke-faerdig vaerdi
        // ikke kan arve 'afventer forudsaetning' ved et uheld.
        fejl: sql`coalesce(${stripeEvents.fejl}, ${regel.grund})`,
        // Tilbagetraekning, saa den ikke fortraenger de andre i koeen.
        // Uden den staar raekken permanent som «klar» og optager én af
        // de 50 pladser i hver koersel — og sulter ANDRES haendelser.
        naesteForsoegAt: naesteForsoeg(await forsoegstal(h.id)),
      })
      .where(eq(stripeEvents.id, h.id))
    return udfald
  }
  await faerdig(h.id)
  return udfald
}

/**
 * Faerdig — OG nyttelasten kasseres.
 *
 * Den gemmes udelukkende for at kunne koere en uafsluttet haendelse om.
 * Er den afsluttet, er der intet at koere om, og saa er der heller ingen
 * grund til at beholde et Stripe-objekt med kundeoplysninger i vores
 * base. Det er den samme regel som alt andet her: vi opbevarer ikke det,
 * vi ikke bruger.
 */
const faerdig = (id: string) => db.update(stripeEvents)
  .set({ behandletAt: new Date(), fejl: null, nyttelast: null, naesteForsoegAt: null })
  .where(eq(stripeEvents.id, id))

/** Hvor mange gange er haendelsen forsoegt? */
async function forsoegstal(id: string): Promise<number> {
  const [r] = await db.select({ n: stripeEvents.forsoeg })
    .from(stripeEvents).where(eq(stripeEvents.id, id)).limit(1)
  return r?.n ?? 1
}

/**
 * Tilbagetraekning for en haendelse, der ikke kunne goeres faerdig.
 *
 * Uden den tog tilsynet altid de 50 AELDSTE ubehandlede, og
 * femoghalvtreds haendelser, hvis forudsaetning aldrig kommer, spaerrede
 * den 51., som var klar — for evigt. Dens forsoegstaeller stod paa 1,
 * mens de foerstes stod paa 4. Det var fund 6.
 *
 * Trinene er de samme som `naesteForsoeg()` i lib/ingest.ts, og af
 * samme grund: en noegle, der bliver ved at fejle, skal koste mindre og
 * mindre. Forskellen er, at en betalingshaendelse ALDRIG opgives — der
 * er ingen «giv op efter fem» her. Den proeves bare sjaeldnere, og den
 * bliver staaende i basen med sin fejl.
 */
export function naesteForsoeg(forsoeg: number): Date {
  const nu = Date.now()
  if (forsoeg >= 10) return new Date(nu + 6 * 3600_000)   // seks timer
  if (forsoeg >= 6) return new Date(nu + 3600_000)        // en time
  if (forsoeg >= 3) return new Date(nu + 10 * 60_000)     // ti minutter
  // DE FOERSTE TO FORSOEG VENTER IKKE.
  //
  // Det er ikke en udeladelse. Forudsaetningen for en `afventer` er
  // som oftest kommet inden for sekunder — en `checkout.session.completed`,
  // der var et oejeblik bagefter sin faktura — og tilsynet skal kunne
  // goere den faerdig i den SAMME koersel. En minutlang foerste
  // tilbagetraekning ville ikke loese noget: tilsynet koerer hver time,
  // saa alt under en time er usynligt i drift.
  //
  // Udsultningen loeses af de SENERE trin. Haendelser, der bliver ved
  // at afvente, glider ud i ti minutter, en time, seks timer — og en
  // ny haendelse med forsoeg 1 er altid klar foer dem.
  return new Date(nu)
}

// ═══════════════════════════════════════════════════════════════
//  NYTTELASTEN GEMMES SOM EN ALLOWLIST, ALDRIG SOM HELE OBJEKTET.
//
//  Det ville vaere lettere at skrive `h` direkte i kolonnen, og det var
//  ogsaa det, foerste udgave gjorde. Men et Stripe-haendelsesobjekt
//  baerer kundens navn, mailadresse, faktureringsadresse, kortets
//  sidste fire cifre og udstederland — oplysninger vi hverken laeser
//  eller har brug for. At gemme dem, fordi de tilfaeldigvis fulgte med
//  i en HTTP-krop, er den samme fejl som `...raw` i en adapter, og
//  CLAUDE.md siger hvorfor: en denylist daekker i dag og svigter i
//  morgen, naar Stripe tilfoejer et felt.
//
//  Listen nedenfor er PRAECIS de stier, behandlerne herover laeser.
//  Tilfoejes en ny laesning, skal den med her — ellers ser en
//  genbehandling ikke feltet. Det er den rigtige vej at svigte: et
//  manglende felt opdages, et gemt felt opdages ikke.
// ═══════════════════════════════════════════════════════════════

/** Ét felt, hvis det er der. Tomme objekter opstaar ikke. */
function tag(kilde: Ukendt, felter: string[]): Ukendt | undefined {
  const ud: Ukendt = {}
  for (const f of felter) if (kilde[f] !== undefined) ud[f] = kilde[f]
  return Object.keys(ud).length ? ud : undefined
}

function fakturalinje(l: Ukendt): Ukendt {
  const ud: Ukendt = {}
  const periode = tag((l['period'] ?? {}) as Ukendt, ['start', 'end'])
  if (periode) ud['period'] = periode
  const pd = ((l['pricing'] as Ukendt | undefined)?.['price_details'] ?? {}) as Ukendt
  const pris = tag(pd, ['price'])
  if (pris) ud['pricing'] = { price_details: pris }
  const sid = ((l['parent'] as Ukendt | undefined)?.['subscription_item_details'] ?? {}) as Ukendt
  const forael = tag(sid, ['subscription'])
  if (forael) ud['parent'] = { subscription_item_details: forael }
  return ud
}

function abonnementsvare(v: Ukendt): Ukendt {
  const ud = tag(v, ['current_period_start', 'current_period_end']) ?? {}
  const pris = tag((v['price'] ?? {}) as Ukendt, ['id'])
  if (pris) ud['price'] = pris
  return ud
}

export function kunDetViLaeser(h: Haendelse): Record<string, unknown> {
  const o = (h.data?.object ?? {}) as Ukendt
  const obj: Ukendt = tag(o, [
    // kassen()
    'subscription', 'client_reference_id', 'customer',
    // spejl()
    'id', 'status', 'cancel_at_period_end', 'schedule',
    'current_period_start', 'current_period_end',
  ]) ?? {}

  // Fakturaens binding til koebsforsoeget. KUN den ene noegle laeses —
  // `subscription_details.metadata` kan baere hvad som helst, kunden
  // eller en integration har sat, og vi gemmer ikke resten.
  const forsoeg = forsoegAf(o)
  if (forsoeg) {
    obj['parent'] = {
      subscription_details: { metadata: { bofinda_forsoeg: forsoeg } },
    }
  }

  const linjer = (o['lines'] as Ukendt | undefined)?.['data']
  if (Array.isArray(linjer)) {
    // Kun FOERSTE linje laeses af `betalt()`. Resten gemmes ikke.
    const f = linjer[0] as Ukendt | undefined
    if (f) obj['lines'] = { data: [fakturalinje(f)] }
  }
  const varer = (o['items'] as Ukendt | undefined)?.['data']
  if (Array.isArray(varer)) {
    const f = varer[0] as Ukendt | undefined
    if (f) obj['items'] = { data: [abonnementsvare(f)] }
  }

  return { id: h.id, type: h.type, created: h.created, data: { object: obj } }
}

/**
 * ── TO VAGTER, IKKE ÉN ──────────────────────────────────────
 *
 * Stripes `created` er i HELE SEKUNDER, og Stripe garanterer ikke
 * leveringsraekkefoelgen. Det giver to krav, der trak hver sin vej:
 *
 *  · To haendelser i samme sekund skal stadig kunne goere FREMSKRIDT.
 *    `checkout.session.completed` og den foerste `invoice.paid` kommer
 *    begge i det sekund, kortet blev godkendt. Med `<` afviste vagten
 *    den betalte faktura som «foraeldet», og spejlingen blev aldrig
 *    skrevet. Det var runde 1's fund 6 — seks roede tjek.
 *
 *  · Men en TERMINAL status maa ikke genoplives. Behandles
 *    `customer.subscription.deleted` foerst, og kommer en forsinket
 *    `invoice.paid` med samme sekund bagefter, tillod `<=` den sidste
 *    skrivning: status gik fra `canceled` tilbage til `active`. Det
 *    var tredje runde's fund 5.
 *
 * Kommentaren her paastod engang, at «to forskellige haendelser i samme
 * sekund ikke er ude af orden». Det er forkert, og gennemgangen havde
 * ret i at paatale det.
 *
 * Rettelsen er ikke at skifte `<=` ud med `<` — det ville bare bytte
 * den ene fejl for den anden. De to krav handler om forskellige ting:
 * det ene om TID, det andet om hvilke statusser der overhovedet kan
 * forlades. Derfor to vagter.
 */

/** Tidsvagten. Uaendret: `<=`, saa samme sekund stadig kan goere fremskridt. */
const nyereEnd = (stempel: Date) => or(
  isNull(subscriptions.stripeOpdateretAt),
  lte(subscriptions.stripeOpdateretAt, stempel),
)

/**
 * Statusser, et abonnement ikke kommer tilbage fra.
 *
 * Hos Stripe er `canceled` endelig — «After it's canceled, the
 * subscription is largely immutable» (Subscriptions.d.ts:21). Det
 * samme gaelder `incomplete_expired`. `expired` er vores egen
 * tilsvarende. Koeber kunden igen, faar hun et NYT abonnements-id og
 * dermed en ny raekke; en terminal raekke skal derfor aldrig
 * genoplives, uanset hvad et tidsstempel siger.
 */
// TERMINALE bor i `lib/opsigelse.ts` og importeres oeverst i filen.
// Den stod her som sin EGEN identiske liste; to udtryk for samme
// spoergsmaal i hver sin fil. Ingen uden for webhooken importerede den
// herfra, saa der er intet at genudstille.

/**
 * Terminalvagten. En raekke i en terminal status forlades kun af en
 * haendelse, der selv er terminal.
 *
 * Bemaerk at den er uafhaengig af tid OG af adgangens monotoni. En
 * gammel faktura maa stadig registrere betalt adgang — `adgang_til`
 * har sin egen, monotone vagt og roeres ikke her.
 */
const ikkeTerminal = () => or(
  isNull(subscriptions.status),
  notInArray(subscriptions.status, [...TERMINALE]),
)

/**
 * Begge vagter, for en skrivning der saetter en IKKE-terminal status.
 * Saetter haendelsen selv en terminal status, bruges kun tidsvagten:
 * `deleted` skal kunne skrive `canceled` hen over `active`.
 */
const maaSpejle = (stempel: Date, nyStatus: string) =>
  // `nyStatus` er BLANDET: to kaldere sender en literal, den tredje
  // sender Stripes egen streng videre. Derfor `erTerminalTekst`, som
  // tager `string` — her ER en ukendt vaerdi en virkelig mulighed.
  erTerminalTekst(nyStatus)
    ? nyereEnd(stempel)
    : and(nyereEnd(stempel), ikkeTerminal())

/** Kassen gennemfoert: knyt abonnementet til brugeren. Ingen adgang. */
async function kassen(o: Ukendt, stempel: Date, eventId: string): Promise<Udfald> {
  const subId = tekst(o['subscription'])
  const brugerId = tekst(o['client_reference_id'])
  const kunde = tekst(o['customer'])
  const sessionId = tekst(o['id'])
  if (!subId || !brugerId) return 'ignoreret'

  const udfald = await bogfoerAbonnement(subId, brugerId, kunde, stempel, eventId)

  // ── FORSOEGET LUKKES PAA SESSIONS-ID ──────────────────────
  // Det er den ENESTE entydige binding, vi har paa det her tidspunkt,
  // og vi har den gratis: haendelsens `id` ER sessionens id, og det
  // felt staar allerede i allowlisten.
  //
  // Foer blev forsoeget lukket af `betalt()` paa KUNDE-id alene, og en
  // kunde kan have et doedt abonnement og et levende koeb samtidig.
  // Det var fund 3.
  if (sessionId) {
    await db.update(checkoutForsoeg)
      .set({ status: 'betalt', stripeSubscriptionId: subId,
             stripeStatus: 'complete', afstemtAt: new Date(), lukketAt: new Date() })
      .where(and(
        eq(checkoutForsoeg.stripeSessionId, sessionId),
        inArray(checkoutForsoeg.status, [...UAFSLUTTET]),
      ))
  }
  return udfald
}

/**
 * Abonnementsraekken, oprettet eller opdateret. ÉN implementering.
 *
 * Baade webhooken og tilsynets afstemning har brug for den, og to
 * implementeringer af «opret abonnementsraekken» ville vaere praecis
 * den drift, CLAUDE.md advarer imod.
 */
export async function bogfoerAbonnement(
  subId: string, brugerId: string, kunde: string | null,
  stempel: Date | null, eventId: string | null,
): Promise<Udfald> {
  const [fandtes] = await db.select({ id: subscriptions.id })
    .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (fandtes) {
    if (!stempel) {
      // Uden stempel er der ingen haendelse at spejle — kun kunde-id'et
      // at skrive. Saa er der heller ikke noget at sammenligne med, og
      // tidsvagten ville sammenligne med ingenting.
      await db.update(subscriptions)
        .set({ stripeCustomerId: kunde, updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId))
      return 'behandlet'
    }
    const r = await db.update(subscriptions)
      .set({ stripeCustomerId: kunde, stripeOpdateretAt: stempel, updatedAt: new Date() })
      .where(and(eq(subscriptions.stripeSubscriptionId, subId), nyereEnd(stempel)))
      .returning({ id: subscriptions.id })
    // Her skrives ingen STATUS, kun kunde og tidsstempel, saa
    // terminalvagten er ikke noedvendig: en terminal raekke kan ikke
    // genoplives af en kunde-id-opdatering.
    return r.length ? 'behandlet' : 'forael'
  }
  // Status `incomplete`: abonnementet FINDES, men er ikke betalt.
  // `adgang_til` staar null, saa raekken giver ingen adgang.
  //
  // KONFLIKTEN MAA IKKE SKJULES. `onConflictDoNothing` stod her alene,
  // og saa forsvandt det tilfaelde, hvor kontoen ALLEREDE har et
  // levende abonnement: det delvist unikke indeks afviste
  // indsaettelsen, vi svarede «behandlet», og Stripe stod med et
  // ANDET, opkraevende abonnement, som Bofinda ikke fulgte. Nu
  // opdages det, og det andet abonnement bogfoeres, saa et menneske
  // kan se det — vi opsiger det ikke selv; det er kundens penge.
  const indsat = await db.insert(subscriptions).values({
    userId: brugerId, stripeSubscriptionId: subId, stripeCustomerId: kunde,
    status: 'incomplete', cancelAtPeriodEnd: false, stripeOpdateretAt: stempel,
  }).onConflictDoNothing().returning({ id: subscriptions.id })

  if (!indsat.length) {
    // Kontoen har allerede et levende abonnement. Raekken kunne ikke
    // skrives, saa det her abonnement staar UDEN for vores bogfoering.
    if (eventId) {
      await db.update(stripeEvents)
        .set({ fejl: `dobbelt abonnement: ${subId} kunne ikke bogfoeres — `
          + `kontoen ${brugerId} har allerede et levende` })
        .where(eq(stripeEvents.id, eventId))
    }
    return 'afventer'
  }
  return 'behandlet'
}

/**
 * BETALT FAKTURA — det eneste sted, adgangen flyttes.
 *
 * ── HVORFOR DEN IKKE BRUGER DET FAELLES TIDSSTEMPELFILTER ──
 * `nyereEnd()` beskytter STATUS-spejlingen mod at blive skrevet
 * baglaens. Men adgang er ikke en spejling; den er en kendsgerning om
 * penge, vi har modtaget. Brugte den samme filter, kunne en
 * `subscription.updated`, der tilfaeldigvis kom foerst, faa en GYLDIG
 * `invoice.paid` afvist som «foraeldet» — og den betalte periode var
 * tabt. Det var reproducerbart paa 832d483 (fund 1b).
 *
 * I stedet er vagten MONOTON: adgangen flyttes kun FREM. En faktura,
 * der ankommer sent, kan ikke forkorte en periode, kunden allerede har
 * betalt for, og en faktura, der ankommer i uorden, kan stadig
 * forlaenge den. Det er den rigtige regel om penge: vi tager aldrig
 * adgang tilbage, og vi giver aldrig mere, end den seneste betalte
 * periode raekker til.
 *
 * ── HVORFOR DEN KAN SVARE «AFVENTER» ──
 * Kommer fakturaen FOER sin checkout-haendelse, findes raekken ikke
 * endnu. Foer returnerede vi 'forael' OG markerede haendelsen faerdig,
 * saa genleveringen gav «gentagelse» og perioden var tabt (fund 1a).
 * Nu forsoeger vi at oprette raekken selv ud fra fakturaens egen
 * kunde — og kan vi ikke finde brugeren, svarer vi 'afventer', som
 * ikke markeres faerdig.
 */
async function betalt(
  o: Ukendt, stempel: Date, ops: Stripeopsaetning | null, eventId: string | null = null,
): Promise<Udfald> {
  const linjer = (o['lines'] as Ukendt | undefined)?.['data']
  const linje = Array.isArray(linjer) ? linjer[0] as Ukendt | undefined : undefined
  const subId = tekst(o['subscription'])
    ?? tekst(((linje?.['parent'] as Ukendt | undefined)?.['subscription_item_details'] as Ukendt | undefined)?.['subscription'])
  if (!subId) return 'ignoreret'

  const slut = tid((linje?.['period'] as Ukendt | undefined)?.['end'])
  const start = tid((linje?.['period'] as Ukendt | undefined)?.['start'])
  const prisId = tekst(((linje?.['pricing'] as Ukendt | undefined)?.['price_details'] as Ukendt | undefined)?.['price'])
  const kunde = tekst(o['customer'])

  // Findes raekken? Ellers: kan vi lave den ud af fakturaens kunde?
  const [findes] = await db.select({ id: subscriptions.id })
    .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!findes) {
    const bruger = kunde ? await brugerForKunde(kunde) : null
    if (!bruger) {
      // Forudsaetningen mangler stadig. IKKE faerdig — hverken Stripes
      // genlevering eller vores eget tilsyn er afskaaret fra at tage
      // den op igen.
      return 'afventer'
    }
    // ── RAEKKEN SKRIVES GENNEM DEN FAELLES IMPLEMENTERING ──────
    // Her stod en ANDEN indsaettelse af den samme raekke, med
    // `onConflictDoNothing()` og uden at laese resultatet. Det er
    // praecis den drift, kommentaren over `bogfoerAbonnement` advarer
    // imod — og den kostede penge:
    //
    // Har kontoen i forvejen et levende abonnement, afviser det
    // delvist unikke indeks `sub_en_levende_pr_bruger` indsaettelsen.
    // Konflikten blev slugt, de tre skrivninger nedenfor ramte nul
    // raekker, `adgang_til` blev aldrig skrevet — og haendelsen blev
    // alligevel markeret faerdig og nyttelasten slettet. En BETALT
    // faktura forsvandt i tavshed, og Stripes genlevering svarede
    // «gentagelse». Den samme forudsaetning haandterede
    // `bogfoerAbonnement` korrekt hele tiden.
    //
    // Svaret 'afventer' markerer IKKE haendelsen faerdig: nyttelasten
    // beholdes, fejlteksten staar paa `stripe_events`, og baade
    // Stripes genlevering og vores eget tilsyn kan tage den op igen,
    // naar et menneske har afgjort, hvad der skal ske med det andet
    // abonnement.
    const u = await bogfoerAbonnement(subId, bruger, kunde, stempel, eventId)
    if (u === 'afventer') return 'afventer'
  }

  // ── SKRIVNING 1 · ADGANGEN, MONOTON OG UDEN TIDSFILTER ─────
  // Adgang er ikke en spejling; den er en kendsgerning om penge, vi har
  // modtaget. Vagten er derfor monoton — kun FREM — og ikke
  // `nyereEnd()`: en `invoice.paid`, der overhales af en
  // `subscription.updated`, skal stadig kunne forlaenge perioden.
  const adgang = slut
    ? await db.update(subscriptions)
        .set({ adgangTil: slut, updatedAt: new Date() })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          or(isNull(subscriptions.adgangTil), lt(subscriptions.adgangTil, slut)),
        ))
        .returning({ id: subscriptions.id })
    : []

  // ── SKRIVNING 2 · SPEJLINGEN, MED TIDSFILTER ───────────────
  // Status, pris og periode er Stripes tilstand, ikke vores
  // kendsgerning. En AELDRE faktura maa registrere betalt adgang
  // ovenfor — men den maa ikke skrive `active` hen over en NYERE
  // `customer.subscription.deleted`. Foer var de to skrivninger én, og
  // status fulgte med adgangen uden at blive sammenlignet med noget.
  await db.update(subscriptions)
    .set({
      status: 'active',
      ...(slut ? { currentPeriodEnd: slut } : {}),
      ...(start ? { currentPeriodStart: start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      ...(kunde ? { stripeCustomerId: kunde } : {}),
      stripeOpdateretAt: stempel, updatedAt: new Date(),
    })
    // `maaSpejle` og ikke `nyereEnd`: fakturaen saetter `active`, som
    // er IKKE-terminal, og maa derfor ikke skrive hen over en raekke,
    // der allerede er `canceled`. Adgangen ovenfor er uroert af det —
    // den har sin egen monotone vagt, og en gammel faktura skal stadig
    // kunne registrere en betalt periode.
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), maaSpejle(stempel, 'active')))

  // ── SKRIVNING 3 · INTRO OG PLAN, UAFHAENGIGT AF DE TO ─────
  // HER laa fund 2. Skrivningen ovenfor havde en tidlig `return
  // 'forael'`, naar adgangen ikke flyttede sig — og en genlevering,
  // der skulle reparere en HALVT gennemfoert behandling, ramte netop
  // den gren: `adgang_til` var skrevet i foerste forsoeg, saa anden
  // omgang gav «foraeldet» og sprang baade introregistreringen og
  // planskylden over. Kunden stod med adgang, intro-flaget utaget og
  // ingen plan — altsaa 9 kr. om DAGEN.
  //
  // De tre skrivninger er nu uafhaengige og hver for sig betingede paa
  // deres EGET felt. En genlevering kan derfor faerdiggoere praecis
  // det, der mangler, uanset hvad der lykkedes foerste gang.
  //
  // UDEN `ops` kan vi ikke afgoere, OM det er introprisen — og en
  // haendelse, der maaske skyldte en plan, maa ikke markeres faerdig
  // paa et spoergsmaal, vi ikke kunne stille. Den svarer 'afventer' og
  // tages op igen, naar Stripe er konfigureret. Adgangen er skrevet
  // ovenfor uanset: kunden har betalt.
  if (!ops && prisId) return 'afventer'
  if (ops && prisId && fase(prisId, ops) === 'intro') {
    const [r] = await db.select({ bruger: subscriptions.userId })
      .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
    if (r) {
      // Introduktionen er brugt, naar den er BETALT — ikke naar siden
      // blev aabnet. Saettes kun, hvis den ikke stod i forvejen.
      await db.update(users)
        .set({ introBrugtAt: new Date() })
        .where(and(eq(users.id, r.bruger), isNull(users.introBrugtAt)))

      // Planlaegningen markeres som SKYLDIG her og udfoeres nedenfor.
      // Bliver kaldet til Stripe afbrudt, staar skylden i basen, og
      // `laegManglendePlaner()` tager den op igen.
      await db.update(subscriptions)
        .set({ planStatus: 'mangler' })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          isNull(subscriptions.planStatus),
        ))
      await laegPlan(subId, ops)
    }
  }

  // Lukker koebsforsoeget — sit EGET, bundet af metadataen Stripe
  // fastfryser i fakturaen. Kan bindingen ikke afgoeres, lukkes intet.
  await lukForsoegForFaktura(subId, forsoegAf(o))

  // Udfaldet er informativt: 'forael' betyder, at adgangen ikke flyttede
  // sig — ikke at der blev sprunget arbejde over.
  return slut && !adgang.length ? 'forael' : 'behandlet'
}

/**
 * Forsoegets id, som vi selv satte i `subscription_data.metadata`, da
 * sessionen blev oprettet, og som Stripe fastfryser i fakturaen.
 *
 * Stien er FAKTURAENS `parent.subscription_details.metadata` — ikke
 * linjens. Linjens `parent.subscription_item_details` baerer
 * `subscription` og `subscription_item`, men INGEN metadata
 * (InvoiceLineItems.d.ts:191-212); metadataen ligger paa fakturaen
 * (Invoices.d.ts:847-856), hvor Stripe beskriver den som «an immutable
 * snapshot of the subscription metadata at the time of invoice
 * finalization». Foerste udgave af den her funktion laeste linjen og
 * ville derfor aldrig have fundet noget.
 */
function forsoegAf(o: Ukendt): string | null {
  const sd = (o['parent'] as Ukendt | undefined)?.['subscription_details']
  const m = (sd as Ukendt | undefined)?.['metadata']
  return tekst((m as Ukendt | undefined)?.['bofinda_forsoeg'])
}

/** Vores bruger bag en Stripe-kunde. Null, hvis vi ikke kender kunden. */
async function brugerForKunde(kunde: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id })
    .from(users).where(eq(users.stripeCustomerId, kunde)).limit(1)
  if (u) return u.id
  const [a] = await db.select({ id: subscriptions.userId })
    .from(subscriptions).where(eq(subscriptions.stripeCustomerId, kunde)).limit(1)
  return a?.id ?? null
}

/**
 * Fakturaen lukker sit EGET koebsforsoeg — og kun det.
 *
 * Her stod `lukForsoegForKunde(kunde)`, som matchede paa Stripe-kundens
 * id alene. En forsinket faktura fra et gammelt, opsagt abonnement
 * lukkede derfor kundens NYE reservation, hvis betalingsside stadig var
 * aaben hos Stripe — og naeste koeb oprettede endnu en. To betalbare
 * sider, begge udleveret af produktkoden. Det var fund 3.
 *
 * Kunde-id er ikke en binding: én kunde kan have et doedt abonnement og
 * et levende koeb samtidig. To bindinger er derimod entydige, og vi har
 * dem begge:
 *
 *  1. `subscriptions.stripe_subscription_id` → `checkout_forsoeg`
 *     gennem den `stripe_subscription_id`, `kassen()` eller
 *     afstemningen skrev.
 *  2. fakturaens egen `parent.subscription_details.metadata`, som
 *     Stripe fastfryser ved faktureringen. Vi saetter allerede
 *     `bofinda_forsoeg` i `subscription_data.metadata`, naar sessionen
 *     oprettes (lib/abonnement.ts), saa forsoegets id staar i hver
 *     faktura, abonnementet giver.
 *
 * KAN BINDINGEN IKKE AFGOERES, LUKKES INTET. En faktura, vi ikke kan
 * knytte til et forsoeg, er ikke bevis for, at noget forsoeg er forbi.
 * Forsoeget lukkes saa af sin egen afstemning eller af sin udloebstid.
 */
async function lukForsoegForFaktura(
  subId: string, forsoegId: string | null,
): Promise<'paa_forsoeg' | 'paa_abonnement' | 'ingen_binding'> {
  if (forsoegId) {
    const r = await db.update(checkoutForsoeg)
      .set({ status: 'betalt', stripeSubscriptionId: subId,
             afstemtAt: new Date(), lukketAt: new Date() })
      .where(and(
        eq(checkoutForsoeg.id, forsoegId),
        inArray(checkoutForsoeg.status, [...UAFSLUTTET]),
      ))
      .returning({ id: checkoutForsoeg.id })
    if (r.length) return 'paa_forsoeg'
  }
  const r2 = await db.update(checkoutForsoeg)
    .set({ status: 'betalt', afstemtAt: new Date(), lukketAt: new Date() })
    .where(and(
      eq(checkoutForsoeg.stripeSubscriptionId, subId),
      inArray(checkoutForsoeg.status, [...UAFSLUTTET]),
    ))
    .returning({ id: checkoutForsoeg.id })
  return r2.length ? 'paa_abonnement' : 'ingen_binding'
}

// ═══════════════════════════════════════════════════════════════
//  PLANLAEGNINGEN — særskilt, vedvarende og genkoerbar.
//
//  Foer var det en sideeffekt i `betalt()` med en tavs try/catch:
//  fejlede den, blev haendelsen alligevel markeret faerdig, og
//  genleveringen gav «gentagelse». Abonnementet kunne derfor blive ved
//  med at koere til 9 kr./DAG — `interval: 'day'` betyder hver dag, ikke
//  én gang. Reproduceret paa 832d483 (fund 2 og 2b).
//
//  Nu er den en TILSTAND paa abonnementet:
//    mangler      · skylden er bogfoert, planen er ikke lagt
//    oprettet     · schedule findes, men faserne er ikke bekraeftet
//    konfigureret · faserne er skrevet OG laest tilbage
//    fejlet       · gav op efter PLAN_MAX_FORSOEG; kraever et menneske
//
//  Kundens betalte adgang roeres aldrig af en planlaegningsfejl. Hun
//  har betalt, og adgangen er hendes. Det, der mangler, er VORES
//  opgave — og den staar nu i basen, hvor den kan ses og koeres om.
// ═══════════════════════════════════════════════════════════════

export const PLAN_MAX_FORSOEG = 5

/**
 * Lægger eller REPARERER den tofasede plan. Idempotent.
 *
 * Tre indgange, alle sikre at gentage:
 *  · intet schedule → opret, konfigurér, bekraeft
 *  · schedule uden bekraeftede faser → konfigurér, bekraeft
 *  · allerede konfigureret → goer ingenting
 *
 * KASTER IKKE. Fejlen skrives paa raekken, og `plan_forsoeg` taelles op.
 */
export async function laegPlan(subId: string, ops: Stripeopsaetning): Promise<
  'konfigureret' | 'oprettet' | 'fejlet' | 'sprunget_over' | 'stoppet' | 'opsagt'
> {
  const [a] = await db.select({
    plan: subscriptions.stripeScheduleId,
    status: subscriptions.planStatus,
    forsoeg: subscriptions.planForsoeg,
    stoppet: subscriptions.fornyelseStoppetAt,
    opsagtAf: subscriptions.opsagtAfKundeAt,
    opsagt: subscriptions.cancelAtPeriodEnd,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!a) return 'sprunget_over'
  if (a.status === 'konfigureret') return 'konfigureret'

  // ── ER FORNYELSEN STOPPET, LAEGGER VI IKKE PLAN IGEN ──────
  // Uden den her vagt ophaevede tilsynet sin egen beskyttelse: foerste
  // koersel slap planen og satte `cancel_at_period_end`, og NAESTE
  // koersel lagde en ny plan paa det samme abonnement og markerede den
  // 'konfigureret' — mens vores base og «Mit abonnement» blev ved med
  // at sige «der bliver ikke trukket mere». To kilder, der modsiger
  // hinanden om kundens penge, og kunden ville blive traekt.
  //
  // At stoppe en fornyelse er en beslutning. At ophaeve den er ogsaa
  // en beslutning, og den skal et menneske tage — se
  // docs/betaling/betjening.md for hvordan.
  if (a.stoppet) return 'stoppet'

  // ── HAR KUNDEN SAGT OP, LAEGGER VI INGEN PLAN ─────────────
  // Beskyttelsen fandtes kun mod systemets EGET sikkerhedsstop
  // (`fornyelse_stoppet_at`). Kundens almindelige opsigelse havde
  // ingen: en forsinket introfaktura eller bare naeste tilsynskoersel
  // sendte et nyt `subscriptionSchedules.create` og et `update` ind i
  // den betalingsplan, hun lige havde afmeldt — og skrev
  // `konfigureret` paa det.
  //
  // Begge felter taeller. `opsagt_af_kunde_at` er HENDES beslutning og
  // kan ikke spejles vaek; `cancel_at_period_end` faanger ogsaa den
  // opsigelse, der kom fra Stripes side — fx en, vi selv satte i
  // dashboardet.
  if (a.opsagtAf || a.opsagt) return 'opsagt'

  if (a.forsoeg >= PLAN_MAX_FORSOEG && a.status === 'fejlet') return 'fejlet'

  const s = stripe(ops)
  let planId = a.plan
  try {
    // ── AFSTEM FOER DU OPRETTER — OG FOER DU BRUGER DEN, DU HAR ──
    // Et tidligere forsoeg kan have oprettet planen, uden at vi fik
    // svaret: en 500 fra Stripe betyder «udfoerelsen kan vaere
    // paabegyndt», ikke «intet skete». Stripe gemmer den 500 under
    // idempotensnoeglen, saa et genforsoeg paa SAMME noegle kaster
    // den samme fejl igen — fem gange, og saa staar planen `fejlet`,
    // mens den maaske findes. Og et BLINDT noegleskift ville oprette
    // nummer to.
    //
    // Abonnementet ved det selv: `subscription.schedule`
    // (Subscriptions.d.ts:245). Ét opslag afgoer det.
    //
    // ── OG SPOERGSMAALET STILLES ALTID ──────────────────
    // Her stod `if (!planId)` omkring hele afstemningen: vi spurgte
    // KUN, naar vi intet vidste. En ikke-tom binding blev altsaa brugt
    // som autoritet — ogsaa naar den var foraeldet. Saa konfigurerede
    // vi en frigivet plan (og fejlede), mens abonnementet i
    // virkeligheden stod med en anden, gyldig plan. Det er den samme
    // valgvej som i `stopForkertFornyelse`, og den er rettet samme
    // sted: kilden svarer, vi retter os efter svaret.
    // Reglen er ÉT sted — `planDerStyrer` — og deles med
    // `afstemAbonnement` og `stopForkertFornyelse`. Den svarer kun med
    // en plan, der FAKTISK styrer abonnementet: en frigivet plan
    // beholder sine faser, men styrer ingenting, og et `update` paa
    // den ville blive afvist af Stripe.
    const styrer = await planDerStyrer(s, subId, planId)
    const aktuel = styrer?.id ?? null
    if (aktuel !== planId) {
      // Betinget paa den vaerdi, VI laeste. Gik der en anden
      // planlaegning i gang imellem opslaget og den her skrivning, er
      // dens binding nyere end vores svar, og den skal ikke tabes.
      //
      // `eq(kolonne, null)` er aldrig sandt i SQL, saa den tomme
      // binding skal proeves med `isNull`.
      const hvor = and(
        eq(subscriptions.stripeSubscriptionId, subId),
        a.plan === null
          ? isNull(subscriptions.stripeScheduleId)
          : eq(subscriptions.stripeScheduleId, a.plan),
      )
      if (aktuel) {
        await db.update(subscriptions)
          .set({ stripeScheduleId: aktuel, planStatus: 'oprettet', planForsoegtAt: new Date() })
          .where(hvor)
      }
      // ── OG DEN FORAELDEDE BINDING RYDDES IKKE HER ───────
      // Det proevede jeg. Rydningen ville ligge FOER `create`, saa en
      // fejlet oprettelse efterlod raekken uden nogen pegepind — og en
      // pegepind, der ikke gaelder, er harmloes: `planDerStyrer`
      // kasserer den ved hvert opslag. Lykkes oprettelsen, skriver den
      // selv den nye binding et par linjer nede.
      planId = aktuel
    }
    if (!planId) {
      // `from_subscription` kan ikke kombineres med `phases` — SDK'ens
      // egen note, SubscriptionSchedules.d.ts:653-656. Derfor to kald.
      //
      // Noeglen baerer forsoegstallet, og den ROTERER ved hvert
      // forsoeg — ogsaa efter en ren valideringsfejl, hvor intet blev
      // udfoert. Det er med vilje, men det er IKKE det, der goer det
      // sikkert.
      //
      // Sikkerheden ligger i afstemningen ovenfor: vi naar kun hertil,
      // naar `subscription.schedule` har sagt, at der INGEN plan er.
      // Et blindt noegleskift ville kunne oprette nummer to; et skift
      // paa et afstemt grundlag kan ikke. Stod der i stedet «noeglen
      // genbruges», ville kommentaren beskrive en vagt, koden ikke
      // har — og saa ville nogen en dag fjerne den, der findes.
      const plan = await s.subscriptionSchedules.create(
        { from_subscription: subId },
        { idempotencyKey: `plan:${subId}:${a.forsoeg}` },
      )
      planId = plan.id
      // Skrives STRAKS, foer konfigurationen. Afbrydes vi nu, ved
      // genkoerslen at planen findes og skal konfigureres — den
      // opretter ikke en til.
      await db.update(subscriptions)
        .set({ stripeScheduleId: planId, planStatus: 'oprettet', planForsoegtAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subId))
    }

    // `planDerStyrer` har allerede hentet planen, naar den svarede med
    // én. Den genbruges — to opslag af samme id i traek er ét for
    // meget, og det ene af dem ville vaere aeldre end det andet.
    const nu = styrer && styrer.id === planId
      ? styrer.plan
      : await s.subscriptionSchedules.retrieve(planId)
    const nuvaerende = (nu as unknown as { phases?: { start_date?: number; end_date?: number }[] })
      .phases?.[0]
    if (!nuvaerende) throw new Error('planen har ingen fase at bygge videre paa')

    // Fase 1 gengives med Stripes EGNE tidspunkter. Vi regner dem ikke
    // ud: perioden begyndte, da betalingen gik igennem.
    const oenskede = [
      {
        items: [{ price: ops.introPrisId, quantity: 1 }],
        start_date: nuvaerende.start_date,
        end_date: nuvaerende.end_date,
      },
      faser(ops)[1]!,
    ]
    await s.subscriptionSchedules.update(planId, { phases: oenskede as never })

    // LAES TILBAGE. Et schedule-id beviser ikke, at faserne er rigtige.
    // Uden det her ville «oprettet men forkert konfigureret» se faerdig ud.
    const efter = await s.subscriptionSchedules.retrieve(planId)
    const fejl = planfejl(efter, ops)
    if (fejl.length) {
      throw new Error(`faserne stemmer ikke efter opdatering: ${fejl.join('; ')}`)
    }

    // ── SAGDE HUN OP, MENS VI VAR I LUFTEN? ───────────────
    // Vagten oeverst laeser raekken ÉN gang, og imellem den og det her
    // ligger tre eksterne kald. En opsigelse i det vindue ville ellers
    // faa den plan, vi netop har lagt, til at staa `konfigureret` paa
    // et abonnement, kunden har afmeldt — og en plan kan skrive
    // `cancel_at_period_end` om ved naeste faseskift.
    //
    // Vi slipper den derfor igen. Hendes beslutning vandt, ogsaa selv
    // om den kom et sekund efter vores kald.
    const [efterKaldet] = await db.select({
      opsagtAf: subscriptions.opsagtAfKundeAt,
      stoppet: subscriptions.fornyelseStoppetAt,
      opsagt: subscriptions.cancelAtPeriodEnd,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
    // SAMME SPOERGSMAAL SOM AFSTEMNINGEN STILLER. Vagten spurgte foer
    // `opsagtAf || opsagt`, mens afstemningen — den, der skal goere
    // arbejdet — spurgte `opsagtAf || stoppet`. To rigtige udtryk,
    // forskellige maengder: en skyld sat her paa `opsagt` alene blev
    // ryddet dér uden ét Stripe-kald. Se `skalFornyelsenStoppes`.
    if (efterKaldet && skalFornyelsenStoppes(efterKaldet)) {
      // ── SKYLDEN, IKKE EN PAASTAND ───────────────────────
      // Her stod et `release` i sin egen try/catch — fejlen blev
      // slugt — og derefter `stripeScheduleId: null, planStatus:
      // null`, som om den var sluppet. Den paastand var ikke
      // afgivet af Stripe, og ingen koe kunne se raekken bagefter:
      // opsigelseskoeen kraevede `cancel_at_period_end = false`, og
      // opsigelsen havde netop skrevet `true`. Planen stod aktiv hos
      // Stripe, usynlig for hele modulet.
      //
      // Nu skrives der ikke noget om planen. Der skrives, at der er
      // ARBEJDE tilbage, og `afstemAbonnement` goer det: den laeser
      // Stripes egen tilstand, slipper planen, og rydder foerst
      // bindingen, naar sluttilstanden er laest tilbage.
      await skyldAfstemning(subId,
        `planen blev lagt, mens kunden sagde op — afventer frigivelse (${planId})`)
      return 'opsagt'
    }

    // ── BETINGET, SAA KAPLOEBET IKKE KAN TABES I VINDUET ──
    // Gentjekket ovenfor laeser raekken; mellem den laesning og den her
    // skrivning kan en opsigelse naa hele vejen igennem. Uden
    // betingelsen endte raekken som `{opsagt: true, plan: null,
    // planStatus: 'konfigureret'}` — «planen er bekraeftet» om en plan,
    // der ikke findes, paa et abonnement, kunden har sagt op.
    //
    // Betingelsen goer laesningen og skrivningen til ÉT skridt i
    // basen. Rammer den nul raekker, vandt opsigelsen, og saa er
    // svaret det samme som ovenfor.
    //
    // ── OG TIL DEN PLAN, VI FAKTISK KONTROLLEREDE ───────
    // Betingelsen daekkede kun «har kunden besluttet noget imens».
    // Den daekkede ikke «peger raekken stadig paa den plan, jeg lige
    // har konfigureret og laest tilbage». Skifter bindingen i vinduet
    // — en anden aktoer slipper B og opretter C, og C bogfoeres
    // straks, praecis som den her funktion selv goer efter et
    // `create` — saa blev et svar om B skrevet som en godkendelse af
    // C. Og C er ikke konfigureret: dens faser er kun den indledende.
    //
    // Derefter er raekken usynlig. `laegPlan` og
    // `stopForkertFornyelse` springer `konfigureret` over, og
    // `iFareForForkertFornyelse` udelukker den. Maalt: tre
    // tilsynskoersler med NUL kald om C.
    //
    // Et kontrolresultat maa kun bogfoeres paa det grundlag, det
    // blev taget paa. Derfor plan-id'et i betingelsen.
    const skrevet = await db.update(subscriptions)
      .set({ planStatus: 'konfigureret', planFejl: null, planForsoegtAt: new Date() })
      .where(and(
        eq(subscriptions.stripeSubscriptionId, subId),
        eq(subscriptions.stripeScheduleId, planId),
        ...INGEN_BESLUTNING,
      ))
      .returning({ id: subscriptions.id })
    if (!skrevet.length) {
      // ── TO AARSAGER, TO SVAR ──────────────────────────
      // Betingelsen har nu to led, og de betyder ikke det samme. Den
      // gamle kode svarede `opsagt` paa ethvert miss — og et rent
      // planskift er ikke en opsigelse. At sige det ville vaere en
      // opdigtet kundebeslutning, og `skyldAfstemning` ville oven i
      // koebet registrere afstemningsarbejde paa den paastand.
      //
      // Spoergsmaalet «staar der en beslutning?» stilles med SAMME
      // praedikat som ovenfor, ikke med en JS-kopi af det. To udgaver
      // ville drive fra hinanden, og det er den fejlform, hele runde 5
      // handlede om.
      const [uroert] = await db.select({ n: count() }).from(subscriptions)
        .where(and(eq(subscriptions.stripeSubscriptionId, subId), ...INGEN_BESLUTNING))
      if (!uroert || uroert.n === 0) {
        await skyldAfstemning(subId,
          `planen blev lagt, mens kunden sagde op — afventer frigivelse (${planId})`)
        return 'opsagt'
      }
      // Ingen beslutning. Saa var det bindingen: raekken peger paa en
      // anden plan end den, vi kontrollerede.
      //
      // Der skrives INTET om status. Raekken staar dermed stadig som
      // ikke-konfigureret, og `laegManglendePlaner` tager den igen —
      // nu med den nye binding som grundlag. Forsoegstallet roeres
      // heller ikke: der er ikke fejlet noget hos Stripe, og et
      // opbrugt budget ville spaerre for den plan, der FAKTISK skal
      // konfigureres.
      const [naa] = await db.select({ plan: subscriptions.stripeScheduleId })
        .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
      await db.update(subscriptions)
        .set({ planFejl: `bekræftelsen gjaldt ${planId}; rækken peger nu på `
          + `${naa?.plan ?? 'ingen plan'} — den konfigureres i næste kørsel` })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          ne(subscriptions.planStatus, 'konfigureret'),
        ))
      return 'oprettet'
    }
    return 'konfigureret'
  } catch (e) {
    // ── VAR DET EN OPSIGELSE, DER SLOG KALDET IHJEL? ──────
    // Sagde kunden op, mens vi var i luften, slipper HENDES kodevej
    // planen — og Stripe afviser saa vores `update` paa en frigivet
    // plan. Det er ikke en planfejl, og det skal ikke taelles som et
    // forsoeg eller staa som `plan_fejl` paa hendes raekke. Det er
    // bare et kald, der kom for sent.
    const [efterFejlen] = await db.select({
      opsagtAf: subscriptions.opsagtAfKundeAt,
      opsagt: subscriptions.cancelAtPeriodEnd,
    }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
    if (efterFejlen?.opsagtAf || efterFejlen?.opsagt) {
      // Samme grund som ovenfor — og her var paastanden endnu
      // svagere: grenen ANTOG, at kundens kodevej havde sluppet
      // planen, og ryddede bindingen uden overhovedet at spoerge.
      // Fejlede konfigurationen, mens den nyoprettede plan var
      // aktiv, stod den aktiv tilbage. Skylden staar nu i stedet.
      await skyldAfstemning(subId,
        `planlægningen blev afbrudt af en opsigelse — afventer afstemning`
        + (planId ? ` (${planId})` : ''))
      return 'opsagt'
    }

    const forsoeg = a.forsoeg + 1
    await db.update(subscriptions)
      .set({
        planStatus: forsoeg >= PLAN_MAX_FORSOEG ? 'fejlet' : (planId ? 'oprettet' : 'mangler'),
        planFejl: (e as Error).message.slice(0, 500),
        planForsoeg: forsoeg,
        planForsoegtAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subId))
    return forsoeg >= PLAN_MAX_FORSOEG ? 'fejlet' : 'oprettet'
  }
}

// `skemaId` stod her og var en ordret kopi af `idAf` i
// lib/opsigelse.ts — to udtryk for ét spoergsmaal, som CLAUDE.md
// advarer imod. Den havde to kaldere, og begge er nu gaaet over til
// `planDerStyrer`, der laeser feltet ét sted. Derfor er den fjernet
// frem for at staa tilbage som en kopi, nogen kunne komme til at
// bruge igen.

/**
 * Er de to faser dem, vi bad om?
 *
 * Foer maalte den kun pris-id'erne og at der var to faser. Det er ikke
 * nok til at baere prismodellen: en plan med de rigtige priser og
 * `quantity: 5` traekker 45 kr. og 1.745 kr., og en fase 1, der varer
 * to doegn i stedet for ét, er en anden model end den, der er lovet.
 * Derfor maales nu ogsaa MAENGDER og TIDSGRAENSER.
 *
 * Kontrollen, punkt for punkt:
 *  · praecis to faser
 *  · én vare pr. fase — en ekstra vare er en ekstra opkraevning
 *  · fase 1: introprisen, maengde 1
 *  · fase 2: normalprisen, maengde 1
 *  · fase 1 varer PRAECIS `INTRO_TIMER` timer, maalt paa Stripes egne
 *    `start_date`/`end_date`. Vi sender dem selv, saa tilbagelaesningen
 *    skal give det samme; goer den ikke det, har vi ikke forstaaet,
 *    hvad Stripe gjorde, og planen er ikke bekraeftet.
 *  · fase 2 begynder PRAECIS hvor fase 1 slipper. Et hul ville vaere
 *    tid uden abonnement; et overlap ville vaere to samtidige.
 *  · fase 1 er ikke en proeveperiode. En `trial` er GRATIS hos Stripe,
 *    og saa er de 9 kr. der ikke.
 *
 * Fase 2's `end_date` maales IKKE. Den er aaben i vores model, og
 * hvad Stripe skriver i feltet for en aaben sidste fase er ikke noget,
 * vi har kunnet efterproeve — en kontrol paa et gaet ville afvise
 * rigtige planer.
 *
 * `quantity` er valgfri i Stripes type. Mangler den, laeses den som 1:
 * det er Stripes egen standard, og en manglende vaerdi er ikke bevis
 * for en forkert. Risikoen, kontrollen findes for — en maengde paa 2
 * eller 5 — fanges uaendret.
 */
export function faserErRigtige(plan: unknown, ops: Stripeopsaetning): boolean {
  return planfejl(plan, ops).length === 0
}

/**
 * Samme kontrol, men den SIGER hvad der er galt. `laegPlan` skriver
 * listen paa raekken, saa en plan, der ikke kan bekraeftes, kan
 * efterses af et menneske uden at nogen skal gaette.
 */
export function planfejl(plan: unknown, ops: Stripeopsaetning): string[] {
  type Vare = { price?: unknown; quantity?: unknown }
  type Fase = {
    items?: Vare[]; start_date?: unknown; end_date?: unknown
    trial?: unknown; trial_end?: unknown
  }
  const p = (plan as { phases?: Fase[] } | null)?.phases
  if (!Array.isArray(p)) return ['planen har ingen faser']
  if (p.length !== 2) return [`planen har ${p.length} faser, ikke 2`]

  const fejl: string[] = []
  const prisId = (v: Vare | undefined) => {
    const x = v?.price
    return typeof x === 'string' ? x : (x as { id?: string } | undefined)?.id
  }
  const forventet = [ops.introPrisId, ops.normalPrisId]
  p.forEach((f, n) => {
    const varer = Array.isArray(f?.items) ? f.items : []
    if (varer.length !== 1) {
      fejl.push(`fase ${n + 1} har ${varer.length} varer, ikke 1`)
      return
    }
    if (prisId(varer[0]) !== forventet[n]) {
      fejl.push(`fase ${n + 1} har prisen ${String(prisId(varer[0]))}, ikke ${forventet[n]}`)
    }
    // Mangler `quantity`, er Stripes standard 1.
    const m = varer[0]!.quantity
    const maengde = m === undefined || m === null ? 1 : m
    if (maengde !== 1) fejl.push(`fase ${n + 1} har mængde ${String(maengde)}, ikke 1`)
  })

  const t = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const s0 = t(p[0]?.start_date), e0 = t(p[0]?.end_date), s1 = t(p[1]?.start_date)
  if (s0 === null || e0 === null) {
    fejl.push('fase 1 mangler start_date eller end_date')
  } else if (e0 - s0 !== INTRO_TIMER * 3600) {
    fejl.push(`fase 1 varer ${e0 - s0} sekunder, ikke ${INTRO_TIMER * 3600}`)
  }
  if (s1 === null) fejl.push('fase 2 mangler start_date')
  else if (e0 !== null && s1 !== e0) {
    fejl.push(`fase 2 begynder ${s1}, mens fase 1 slutter ${e0}`)
  }
  if (p[0]?.trial === true) fejl.push('fase 1 er markeret som prøveperiode — den ville være gratis')
  const pt = t(p[0]?.trial_end)
  if (pt !== null && e0 !== null && pt >= e0) {
    fejl.push('fase 1 har trial_end ved eller efter fasens slutning — hele fasen ville være gratis')
  }
  return fejl
}

/**
 * Driftstilsynets indgang: tag alle skyldige planer op igen.
 *
 * Kaldes af importkoerslen. Uden den ville en plan, der fejlede fem
 * gange i traek paa en time med nedetid hos Stripe, staa for evigt —
 * og kunden betale 9 kr. om dagen imens.
 */
export async function laegManglendePlaner(ops: Stripeopsaetning, maks = 25): Promise<{
  forsoegt: number; konfigureret: number; fejlet: number
}> {
  const skyldige = await db.select({ sub: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(
      isNotNull(subscriptions.planStatus),
      ne(subscriptions.planStatus, 'konfigureret'),
      lt(subscriptions.planForsoeg, PLAN_MAX_FORSOEG),
      // Er fornyelsen stoppet, er planen ikke laengere en skyld, vi maa
      // indfri af os selv. Vagten staar OGSAA i `laegPlan` — det her er
      // udvaelgelsen, der sparer opslaget.
      isNull(subscriptions.fornyelseStoppetAt),
      // Og det samme for kundens egen opsigelse. Begge felter, af
      // samme grund som i `laegPlan`.
      isNull(subscriptions.opsagtAfKundeAt),
      eq(subscriptions.cancelAtPeriodEnd, false),
    ))
    .limit(maks)
  let konfigureret = 0, fejlet = 0
  for (const s of skyldige) {
    const r = await laegPlan(s.sub, ops)
    if (r === 'konfigureret') konfigureret++
    else if (r === 'fejlet') fejlet++
  }
  return { forsoegt: skyldige.length, konfigureret, fejlet }
}

// ═══════════════════════════════════════════════════════════════
//  BESKYTTELSEN MOD AT FORNY PAA VILKAAR, VI IKKE KAN LEVERE
//
//  Prismodellen er 9 kr. for de foerste 24 timer, derefter 349 kr. hver
//  28. dag. Overgangen findes KUN i den tofasede plan. Kan planen ikke
//  bekraeftes, fornyes abonnementet hos Stripe til introprisen — hver
//  DAG. `plan_status = 'fejlet'` stopper ingenting: det er en
//  markering i VORES base, og en loglinje er ikke en beskyttelse.
//  Gennemgangen havde ret i, at «dokumenteret» ikke er det samme som
//  «foreneligt med prismodellen».
//
//  ── HVAD VI GOER, OG HVORFOR NETOP DET ────────────────────
//  Planen SLIPPES (release), og `cancel_at_period_end` saettes. Saa:
//   · kunden beholder de 24 timer, hun betalte 9 kr. for. Adgangen
//     roeres ikke — `adgang_til` er uaendret, og monotonien staar.
//   · der kommer ingen opkraevning paa vilkaar, vi ikke kan levere.
//   · et menneske kan sætte det tilbage, naar planen er lagt.
//
//  Det er IKKE en aendring af prismodellen. Det er en afvisning af at
//  forny paa en anden model end den aftalte. Alternativet — at lade
//  den loebe til 9 kr. om dagen — ville VAERE en anden model, og den
//  har ingen bedt om.
//
//  Rækkefoelgen er den samme som i `sigOpFor`: planen skal slippes
//  FOERST, ellers kan den skrive `cancel_at_period_end` om ved naeste
//  faseskift, og kunden bliver traekt alligevel.
//
//  ── HVORNAAR ──────────────────────────────────────────────
//  Ikke af forsoegstaelleren alene. Faren er knyttet til FORNYELSEN,
//  ikke til hvor mange gange vi har proevet: en plan, der fejler fem
//  gange paa fem minutter, har stadig 23 timer tilbage, mens en, der
//  fejler to gange lige foer fornyelsen, ikke har. Derfor udloeser
//  naerheden til `adgang_til`.
// ═══════════════════════════════════════════════════════════════

/**
 * Afstemmer de GENNEMFOERTE koeb med deres abonnement.
 *
 * Et forsoeg i `gennemfoert` betyder: Stripe siger, at kassen blev
 * gennemfoert, og vi har ikke bogfoert abonnementet. Det spaerrer
 * baade nye koeb og gratis-skiftet — og med rette. Men det maa ikke
 * kunne staa der for evigt, saa det opløses her.
 *
 * Tre udfald, og det sidste er det vigtigste:
 *  · abonnementet er kendt (eller kan bogfoeres) → forsoeget `betalt`
 *  · abonnementet er doedt → forsoeget `afbrudt`; kontoen maa koebe igen
 *  · Stripe svarer ikke → forsoeget BLIVER `gennemfoert`
 *
 * Det sidste er det sikre udfald, fordi omkostningerne er
 * asymmetriske: at spaerre et nyt koeb koster hende et genforsoeg, at
 * tillade det koster hende to abonnementer.
 *
 * `adgang_til` roeres ALDRIG her. Adgangen foelger den betalte
 * faktura og intet andet.
 */
export async function afstemGennemfoerteKoeb(ops: Stripeopsaetning): Promise<{
  afstemte: number; uafklarede: number; detaljer: string[]
}> {
  const raekker = await db.select({
    id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
    sub: checkoutForsoeg.stripeSubscriptionId, bruger: checkoutForsoeg.userId,
    kunde: checkoutForsoeg.stripeCustomerId,
    forsoeg: checkoutForsoeg.lukkeForsoeg,
  }).from(checkoutForsoeg)
    .where(eq(checkoutForsoeg.status, 'gennemfoert'))
    // ── DE MINDST PROEVEDE FOERST ──────────────────────────
    // Uden raekkefoelge tog den de samme 50 hver gang, og et forsoeg
    // fejlede uden at skrive paa raekken. Funktionen har sine EGNE
    // dokumenterede, permanente beboere — «kontoen har allerede et
    // levende abonnement … den loeser sig ikke af sig selv» — saa
    // halvtreds af dem spaerrede den 51., der kunne afstemmes. Maalt
    // over tre koersler.
    //
    // Hver fejl taeller nu paa raekken, og de mindst proevede vaelges
    // foerst. Samme svar som koeerne ovenfor; her er taelleren bare
    // den, der allerede fandtes.
    .orderBy(asc(checkoutForsoeg.lukkeForsoeg), asc(checkoutForsoeg.oprettetAt))
    .limit(50)
  if (!raekker.length) return { afstemte: 0, uafklarede: 0, detaljer: [] }

  const s = stripe(ops)
  let afstemte = 0
  const detaljer: string[] = []
  for (const r of raekker) {
    try {
      let subId = r.sub
      let bruger = r.bruger
      let kunde = r.kunde
      if (!subId && r.sid) {
        const sess = await s.checkout.sessions.retrieve(r.sid) as
          { subscription?: unknown; client_reference_id?: string
            customer?: unknown; payment_status?: string } | null
        subId = subId2(sess?.subscription)
        // ── VORES EGEN RAEKKE AFGOER, HVEM KOEBET TILHOERER ──
        // `client_reference_id` er noget, VI sendte — men den kommer
        // tilbage gennem Stripe, og `checkout_forsoeg.user_id` er
        // NOT NULL. Lod vi den fjerne vaerdi vinde, ville et svar
        // udefra kunne bestemme, hvilken konto et abonnement bogfoeres
        // paa. Den bruges derfor kun, hvis vi selv intet har.
        bruger = bruger
          || (typeof sess?.client_reference_id === 'string' ? sess.client_reference_id : '')
        kunde = kunde ?? subId2(sess?.customer)
        if (subId) {
          await db.update(checkoutForsoeg)
            .set({ stripeSubscriptionId: subId,
                   stripePaymentStatus: sess?.payment_status ?? null })
            .where(eq(checkoutForsoeg.id, r.id))
        }
      }
      if (!subId) {
        await taelForsoeg(r.id)
        detaljer.push(`${r.id}: sessionen oplyser intet abonnement endnu`)
        continue
      }

      const [kendt] = await db.select({ status: subscriptions.status })
        .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
      if (!kendt) {
        // Bogfoer det gennem SAMME kodevej som webhooken. To
        // implementeringer af «opret abonnementsraekken» ville vaere
        // netop den drift, CLAUDE.md advarer imod.
        //
        // ── UDEN STEMPEL, OG DET ER POINTEN ──────────────────
        // Her stod `new Date()`. `stripe_opdateret_at` betyder «det
        // nyeste Stripe-tidspunkt, vi har SPEJLET» — og afstemningen
        // har ikke spejlet nogen haendelse; den har opdaget en
        // tilstand. Stemplede vi den med NU, ville de aegte
        // haendelser fra selve koebet, som er oprettet FOER
        // afstemningen, blive afvist af `nyereEnd` som foraeldede:
        // raekken blev staaende `incomplete` uden pris og uden
        // periode, og «Mit abonnement» sagde «næste betaling: ukendt»,
        // indtil en senere haendelse tilfaeldigvis reddede den.
        //
        // Null er det aerlige svar, og `nyereEnd`'s egen isNull-gren
        // lader den foerste aegte haendelse spejle frit.
        const u = await bogfoerAbonnement(subId, bruger, kunde, null, null)
        if (u === 'afventer') {
          // ── DEN HER LOESER SIG IKKE SELV ──────────────────────
          // Kontoen har to abonnementer hos Stripe og maa kun have ét
          // hos os. Det aendrer sig ikke af at vente: naeste time
          // rammer den samme vagt, og forsoeget bliver ved med at
          // staa `gennemfoert` — altsaa spaerret for baade nye koeb og
          // gratis-skiftet.
          //
          // Derfor SKAL linjen sige det. Staar der kun «kunne ikke
          // bogføres», laeser den, der kigger paa driftssiden, den som
          // endnu et forbigaaende nej — og «tilsynet ordner det inden
          // for en time» er et loefte, der ikke holder her.
          await taelForsoeg(r.id)
          detaljer.push(`${r.id}: ${subId} kan IKKE afstemmes automatisk — `
            + `kontoen ${bruger} har allerede et levende abonnement. `
            + `Den loeser sig ikke af sig selv; et menneske skal afgoere, `
            + `hvilket abonnement der gaelder. Se docs/betaling/betjening.md.`)
          continue
        }
      }
      const [nu2] = await db.select({ status: subscriptions.status })
        .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
      const doedt = nu2 !== undefined && erTerminal(nu2.status)
      await db.update(checkoutForsoeg)
        .set({ status: doedt ? 'afbrudt' : 'betalt',
               afstemtAt: new Date(), lukketAt: new Date() })
        .where(eq(checkoutForsoeg.id, r.id))
      afstemte++
    } catch (e) {
      await taelForsoeg(r.id)
      detaljer.push(`${r.id}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  return { afstemte, uafklarede: raekker.length - afstemte, detaljer }
}

/**
 * Ét forsoeg mere paa et koebsforsoeg, der ikke kunne afstemmes.
 *
 * Taelleren er `lukke_forsoeg`, som allerede fandtes. Den er det, der
 * giver koeen fremdrift: en raekke, der bliver ved at fejle, glider
 * bagest, og den naeste kommer til.
 */
const taelForsoeg = (id: string) => db.update(checkoutForsoeg)
  .set({ lukkeForsoeg: sql`${checkoutForsoeg.lukkeForsoeg} + 1` })
  .where(eq(checkoutForsoeg.id, id))

/** Id'et, uanset om Stripe gav en streng eller et objekt. */
const subId2 = (v: unknown): string | null =>
  typeof v === 'string' ? v
  : typeof (v as { id?: unknown } | null)?.id === 'string' ? (v as { id: string }).id
  : null

/** Saa taet paa fornyelsen griber vi ind, uanset forsoegstal. */
export const STOP_FOER_FORNYELSE_MIN = 120

/**
 * Stopper fornyelsen for et abonnement, hvis plan ikke kan bekraeftes.
 *
 * KASTER IKKE. Lykkes det ikke, staar skylden stadig i basen, og
 * tilsynet proever igen i naeste koersel.
 */
/**
 * Skriv VORES beslutning om at stoppe en fornyelse.
 *
 * Betinget paa, at ingen har besluttet noget: rammer den nul raekker,
 * er kunden eller en tidligere koersel kommet foerst, og saa er det
 * ikke vores indgreb. Derfor er den ogsaa IDEMPOTENT — den kan kaldes
 * fra begge de veje, der foerer til et indgreb, uden at den anden
 * skriver hen over den foerste.
 */
async function besluttetAfOs(subId: string, grund: string): Promise<number | null> {
  // ── SAMME REGEL SOM `noterOpsigelse` ──────────────────────
  // Beslutningen og vejen til at udfoere den skrives i ÉT statement.
  // Foer stod beslutningen alene, og skylden blev sat i catch-grenen
  // langt nede — fejlede DEN skrivning, stod `fornyelse_stoppet_at`
  // tilbage uden koearbejde, og tre tilsynskoersler gjorde intet.
  // Maalt; det er noejagtig M1 med os som forfatter i stedet for
  // kunden.
  //
  // Lykkes indgrebet, bliver skylden staaende til naeste afstemning,
  // som laeser Stripes sluttilstand, ser at alt er gjort, og rydder
  // den ÉT sted. Det koster én afstemning og er den samme vej hjem
  // som alle andre.
  const r = await db.update(subscriptions)
    .set({
      fornyelseStoppetAt: new Date(),
      fornyelseStoppetGrund: grund.slice(0, 300),
      afstemningSkyldigAt: sql`coalesce(${subscriptions.afstemningSkyldigAt}, now())`,
      afstemningNaesteAt: null,
      afstemningFejl: `fornyelsen stoppes: ${grund}`.slice(0, 300),
      afstemningGen: sql`${subscriptions.afstemningGen} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), ...INGEN_BESLUTNING))
    .returning({ gen: subscriptions.afstemningGen })
  return r[0]?.gen ?? null
}

export async function stopForkertFornyelse(
  ops: Stripeopsaetning, subId: string, grund: string,
): Promise<'stoppet' | 'allerede' | 'fejlede' | 'ikke_noedvendig'
  | 'plan_er_rigtig' | 'grundlaget_skiftede'> {
  const [a] = await db.select({
    plan: subscriptions.stripeScheduleId,
    planStatus: subscriptions.planStatus,
    stoppet: subscriptions.fornyelseStoppetAt,
    opsagt: subscriptions.cancelAtPeriodEnd,
    opsagtAf: subscriptions.opsagtAfKundeAt,
    status: subscriptions.status,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!a) return 'ikke_noedvendig'
  if (a.planStatus === 'konfigureret') return 'ikke_noedvendig'
  // Et doedt abonnement fornyes ikke, og en allerede opsagt heller ikke.
  if (erTerminal(a.status)) return 'ikke_noedvendig'
  // Kundens EGEN opsigelse er ogsaa «allerede». Uden `opsagtAf` kunne
  // tilsynet vinde kaploebet mod hende og skrive
  // `fornyelse_stoppet_at` — og saa stod der «VI har stoppet
  // fornyelsen» om noget, hun selv havde bedt om, med en blivende
  // advarsel i driftsrapporten, indtil et menneske ryddede den.
  if (a.stoppet || a.opsagt || a.opsagtAf) return 'allerede'

  // Generationen, VORES beslutning skrev. Kvitteringen nedenfor
  // maaler mod den, saa arbejde registreret af en anden, mens vi var
  // i luften, ikke bliver kvitteret af os.
  let vorGen: number | null = null

  try {
    const s = stripe(ops)

    // ── AFSTEM FOER DU SLIPPER ──────────────────────────────
    // Den modsatte halvdel af «AFSTEM FOER DU OPRETTER» i `laegPlan`,
    // og den er vigtigere: dér koster en manglende afstemning en plan
    // for meget, her koster den kundens overgang til normalprisen OG
    // en opsigelse, hun ikke har bedt om.
    //
    // `plan_status` er VORES tilbagelaesning, ikke Stripes tilstand.
    // Et tabt svar er nok til at lade den staa 'oprettet', selv om
    // planen ligger rigtigt hos Stripe — og saa var ét mislykket
    // opslag i de sidste 120 minutter foer fornyelsen nok til, at vi
    // slap en KORREKT plan og satte `cancel_at_period_end` paa et
    // abonnement, der ikke fejlede noget.
    //
    // Vi spoerger derfor kilden, praecis som `laegPlan` goer:
    // abonnementet kender selv sit schedule (`subscription.schedule`,
    // Subscriptions.d.ts:245), og `faserErRigtige` afgoer resten.
    //
    // Kan vi IKKE faa svar, griber vi ikke ind. Saa staar skylden i
    // basen, tilsynet skriver ⚠⚠-linjen, og et menneske ser den. At
    // opsige et fremmed menneskes abonnement paa et grundlag, vi ikke
    // kunne bekraefte, er ikke den sikre side af valget.
    // ── OG SPOERGSMAALET STILLES ALTID, IKKE KUN NAAR VI INTET VED ──
    // Her stod `let planId = a.plan; if (!planId) { spoerg kilden }`.
    // Altsaa: vi spurgte KUN, naar vi ikke havde en binding i forvejen
    // — praecis det tilfaelde, hvor der ikke var noget at afstemme.
    // Kommentaren ovenfor sagde «vi spoerger derfor kilden»; koden
    // gjorde det kun i det ene tilfaelde. Det er samme form som
    // catch-kommentaren laengere nede engang havde: en vagt beskrevet,
    // men ikke bygget.
    //
    // En ikke-tom binding er netop den farlige. Den kan vaere
    // foraeldet: plan A er frigivet, Stripe styrer abonnementet med en
    // korrekt plan B — og saa undersoegte vi A, fandt en plan der ikke
    // styrer noget, og traf vores stopbeslutning paa den. Maalt gennem
    // `betalingstilsyn`: B blev aldrig hentet, `fornyelse_stoppet_at`
    // blev skrevet, og der gik et `cancel_at_period_end` ud paa et
    // abonnement, der ikke fejlede noget. Afvistes det foerste kald,
    // frigav naeste afstemning B paa den samme gemte beslutning.
    //
    // Reglen er ÉT sted — `planDerStyrer` i lib/opsigelse.ts — og
    // deles med `afstemAbonnement` og `laegPlan`. Tre udgaver af
    // «hvilken plan styrer abonnementet» var praecis det, fejlen kom
    // af.
    //
    // Kan vi ikke faa svar, kaster kaldet, og catch'en nedenfor
    // bevarer usikkerheden: skylden staar, og tilsynet skriver
    // ⚠⚠-linjen. Vi griber ikke ind paa et grundlag, vi ikke har.
    const styrer = await planDerStyrer(s, subId, a.plan)
    const planId = styrer?.id ?? null
    if (planId !== a.plan) {
      // ── RET BINDINGEN, MEN KUN HVIS DEN STADIG ER DEN, VI LAESTE ──
      // `laegPlan` skriver bindingen STRAKS efter sit `create`. Havde
      // vi skrevet ubetinget, kunne vi slette en nyere binding til en
      // plan, der lige er oprettet — med det svar, vi laeste FOER den
      // blev til. Rammer betingelsen nul raekker, har nogen skrevet
      // imens, og deres vaerdi er nyere end vores.
      //
      // `eq(kolonne, null)` er aldrig sandt i SQL, saa den tomme
      // binding skal proeves med `isNull`. Samme faelde som
      // `bindingUroert` selv er skrevet for at undgaa.
      await db.update(subscriptions)
        .set({ stripeScheduleId: planId })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          a.plan === null
            ? isNull(subscriptions.stripeScheduleId)
            : eq(subscriptions.stripeScheduleId, a.plan),
        ))
    }
    if (styrer) {
      // ── TO SPOERGSMAAL, IKKE ÉT ─────────────────────────
      // «Er faserne rigtige?» og «styrer planen stadig det her
      // abonnement?» er ikke det samme. En FRIGIVET plan beholder sine
      // faser — Stripe fjerner kun dens `subscription` — saa en
      // kontrol paa faser alene svarede «planen er rigtig» om en plan,
      // der ikke styrede noget, og skrev `konfigureret` paa den.
      //
      // Det andet spoergsmaal er nu besvaret FOER vi kommer hertil:
      // `planDerStyrer` giver kun en plan tilbage, naar den gaelder.
      // Tilbage staar faserne.
      if (faserErRigtige(styrer.plan, ops)) {
        // Planen var der hele tiden, og den er rigtig. Saa er det
        // vores egen bogfoering, der var bagud — ikke kundens
        // abonnement, der var i fare. Skriv det, og lad hende vaere.
        //
        // ── MEN KUN OM DEN PLAN, VI FAKTISK KONTROLLEREDE ──
        // Korrektionen ovenfor er betinget, og dens resultat blev ikke
        // laest. Ramte den nul raekker, peger raekken paa en anden plan
        // end den, vi lige har godkendt — og saa skrev den her
        // ubetingede linje vores svar om B som en godkendelse af C.
        // C er ikke konfigureret, og bagefter er raekken usynlig for
        // baade `laegPlan`, `stopForkertFornyelse` og
        // `iFareForForkertFornyelse`. Maalt: tre tilsynskoersler med
        // NUL kald om C.
        //
        // Samme regel som i `laegPlan`: et kontrolresultat bogfoeres
        // kun paa det grundlag, det blev taget paa.
        const bekraeftet = await db.update(subscriptions)
          .set({ planStatus: 'konfigureret', planFejl: null, updatedAt: new Date() })
          .where(and(
            eq(subscriptions.stripeSubscriptionId, subId),
            eq(subscriptions.stripeScheduleId, styrer.id),
          ))
          .returning({ id: subscriptions.id })
        if (!bekraeftet.length) {
          // Grundlaget skiftede under os. Der skrives INTET om status:
          // raekken staar stadig som ikke-konfigureret og bliver taget
          // op igen — nu med den nye binding. Og der gribes ikke ind:
          // vi har ikke set noget, der siger, at den nye plan er
          // forkert. Svaret er derfor hverken «rigtig» eller «fejlede».
          const [naa] = await db.select({ plan: subscriptions.stripeScheduleId })
            .from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
          await db.update(subscriptions)
            .set({ planFejl: `kontrollen gjaldt ${styrer.id}; rækken peger nu på `
              + `${naa?.plan ?? 'ingen plan'} — den tages op igen` })
            .where(and(
              eq(subscriptions.stripeSubscriptionId, subId),
              ne(subscriptions.planStatus, 'konfigureret'),
            ))
          return 'grundlaget_skiftede'
        }
        return 'plan_er_rigtig'
      }
      // ── HER ER BESLUTNINGEN TAGET, OG FOERST HER ────────
      // Foerst paa dette punkt VED vi, at der skal gribes ind: enten
      // gaelder planen og er forkert, eller ogsaa er der ingen plan.
      // Beslutningen skrives derfor her — foer de eksterne kald, som
      // `noterOpsigelse` goer med kundens.
      //
      // Den skal ikke skrives oeverst i funktionen. Det proevede jeg,
      // og det er strengt vaerre end fejlen: `plan_er_rigtig`-grenen
      // griber netop IKKE ind, og saa baerer et abonnement, der intet
      // fejlede, vores beslutning om at stoppe det — med en blivende
      // advarsel i driftsrapporten. Prøve 10 i runde 3 maaler det.
      //
      // Hvorfor foer kaldene og ikke efter: fejler de, skriver
      // catch-grenen en SKYLD, og afstemningen udleder sin hensigt af
      // netop det her felt. Stod det til sidst — som det gjorde — var
      // feltet null praecis dér, og skylden blev ryddet ved naeste
      // afstemning med nul `release`, nul `update` og planen stadig
      // aktiv. Kommentaren ved catch'en beskrev en vagt, koden ikke
      // havde.
      //
      // Betinget, saa et samtidigt tryk fra hende vinder: rammer den
      // nul raekker, har nogen besluttet noget imens.
      vorGen = await besluttetAfOs(subId, grund) ?? vorGen

      // SLIP planen foerst — ellers skriver den opsigelsen om ved
      // naeste faseskift. Samme grund som i `sigOpFor`.
      try {
        await s.subscriptionSchedules.release(styrer.id)
      } catch (e) {
        // Samme vagt som i `afstemAbonnement`: taber vi kaploebet
        // mod kundens egen opsigelse, er det, vi bad om, sket.
        // Uden genlaesningen svarede tilsynet «fejlede» og satte
        // aldrig `cancel_at_period_end`.
        const igen = await s.subscriptionSchedules.retrieve(styrer.id)
        if (planGaelder(igen, subId)) throw e
      }
      // ── OG RYDNINGEN ER OGSAA BETINGET ──────────────────
      // Her stod `.where(eq(subId))` og intet andet. Det var til at
      // leve med, saa laenge `planId` ALTID var raekkens eget id: saa
      // ryddede vi det, vi selv havde laest. Nu kommer `planId` fra
      // kilden og kan vaere et andet — og saa ville en ubetinget
      // rydning kunne slette en binding, en anden lige har skrevet.
      // Vagten er `bindingUroert`, den samme som `afstemAbonnement`
      // bruger, af samme grund og med begge observerede id'er.
      await db.update(subscriptions)
        .set({ stripeScheduleId: null })
        .where(and(
          eq(subscriptions.stripeSubscriptionId, subId),
          bindingUroert(a.plan, styrer.id),
        ))
    }
    // Og den anden vej ind: der var slet ingen plan at undersoege.
    // Kaldet ovenfor har saa ikke fundet sted, og beslutningen skal
    // stadig staa, foer vi roerer Stripe. `besluttetAfOs` er betinget
    // og skriver ikke hen over sig selv.
    vorGen = await besluttetAfOs(subId, grund) ?? vorGen
    await s.subscriptions.update(subId, { cancel_at_period_end: true })
  } catch {
    // Vi naaede ikke i maal. Skylden staar, saa `afstemAbonnement`
    // tager raekken op igen — den udleder sin hensigt af
    // `fornyelse_stoppet_at`, som vi selv har sat, og af kundens
    // beslutning. Foer var en saadan raekke foraeldreloes: ingen koe
    // valgte den, og base og Stripe blev staaende uenige.
    // ── «KASTER IKKE» SKAL VAERE SANDT ──────────────────
    // Docstringen lovede det; koden holdt det ikke. Fejlede DEN her
    // skrivning ogsaa, kastede funktionen — og tilsynets loekke over
    // fare-listen blev afbrudt, saa resten af de truede abonnementer
    // fik INTET forsoeg i den koersel. Maalt: nul af to. Det er den
    // sidste sikring foer en forkert fornyelse, og én daarlig raekke
    // slog den fra for alle andre.
    try {
      await skyldAfstemning(subId, `fornyelsen kunne ikke stoppes: ${grund}`)
    } catch {
      // Kan vi ikke engang notere skylden, er der intet mere at goere
      // her. Svaret er stadig «fejlede», og tilsynet skriver ⚠⚠-linjen.
    }
    return 'fejlede'
  }
  // Beslutningen staar allerede. Her skrives kun den BEKRAEFTEDE
  // kendsgerning: Stripe har svaret paa `cancel_at_period_end`.
  //
  // Naaede hun at sige op, mens vi var i luften, staar HENDES
  // tidsstempel ogsaa — og «Opsagt» vinder paa skaermen, fordi hendes
  // forfatterskab er det oeverste led i kaskaden. `cancel_at_period_end`
  // er sat enten vej.
  // ── TO KENDSGERNINGER, TO SKRIVNINGER ───────────────────
  // De laa i ÉN, og vagten var
  // `vorGen !== null ? eq(gen, vorGen) : sql\`true\``. Den `true` er
  // fejlen: `besluttetAfOs` returnerer null, naar KUNDEN naaede at
  // gemme sin opsigelse, mens vi var i luften — altsaa netop naar vi
  // IKKE ejer beslutningen. Og saa valgte afslutningen en ubetinget
  // kvittering og kunne slette koearbejde, en anden havde registreret.
  // Maalt: den nye skyld forsvandt, planen stod `active` hos Stripe,
  // og tre tilsynskoersler gjorde nul kald.
  //
  // MANGLENDE EGEN GENERATION ER IKKE EJERSKAB OVER ANDRES ARBEJDE.
  // Det er det modsatte: ejer vi ingen generation, har vi intet at
  // kvittere.

  // 1 · Kendsgerningen. Stripe HAR svaret, og det er vores at bogfoere,
  //     uanset hvem der ellers har skrevet paa raekken.
  await db.update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, subId))

  // 2 · Kvitteringen. KUN den generation, vi selv skrev. Ejer vi ingen,
  //     kvitterer vi ingenting, og skylden staar — den er en andens,
  //     og afstemningen tager den.
  if (vorGen !== null) {
    await db.update(subscriptions)
      .set({ ...RYD_SAET, updatedAt: new Date() })
      .where(and(
        eq(subscriptions.stripeSubscriptionId, subId),
        eq(subscriptions.afstemningGen, vorGen),
      ))
    // Nul raekker er ikke et bevis for, at alt er afstemt — det
    // betyder, at nogen har registreret arbejde, vi ikke har udfoert.
    // Skylden staar, og det er det rigtige.
  }
  return 'stoppet'
}

/**
 * Hvilke abonnementer er i fare for en forkert fornyelse NU?
 *
 * Planen er ikke bekraeftet, fornyelsen er ikke allerede stoppet, og
 * enten er forsoegene brugt op, eller ogsaa er fornyelsen naer.
 */
async function iFareForForkertFornyelse(): Promise<
  { sub: string; grund: string }[]
> {
  const graense = new Date(Date.now() + STOP_FOER_FORNYELSE_MIN * 60_000)
  const raekker = await db.select({
    sub: subscriptions.stripeSubscriptionId,
    status: subscriptions.planStatus,
    forsoeg: subscriptions.planForsoeg,
    adgang: subscriptions.adgangTil,
    fejl: subscriptions.planFejl,
  }).from(subscriptions)
    .where(and(
      isNotNull(subscriptions.planStatus),
      ne(subscriptions.planStatus, 'konfigureret'),
      isNull(subscriptions.fornyelseStoppetAt),
      eq(subscriptions.cancelAtPeriodEnd, false),
      notInArray(subscriptions.status, [...TERMINALE]),
    ))
    // Fristen er hele funktionens formaal. Uden raekkefoelge kunne den
    // fornyelse, der ligger naermest, falde uden for de hundrede.
    .orderBy(asc(subscriptions.adgangTil))
    .limit(100)

  return raekker.flatMap((r) => {
    const naer = r.adgang !== null && r.adgang <= graense
    const opbrugt = r.forsoeg >= PLAN_MAX_FORSOEG
    if (!naer && !opbrugt) return []
    const hvorfor = naer
      ? `fornyelsen er mindre end ${STOP_FOER_FORNYELSE_MIN} minutter væk`
      : `${r.forsoeg} forsøg på at lægge planen mislykkedes`
    return [{
      sub: r.sub,
      grund: `Planen kunne ikke bekræftes: ${hvorfor}. `
        + `Sidste fejl: ${r.fejl?.slice(0, 150) ?? 'ukendt'}`,
    }]
  })
}

/** Mislykket traek: status flyttes, ADGANGEN roeres ikke. */
async function mislykkedes(o: Ukendt, stempel: Date): Promise<Udfald> {
  const subId = tekst(o['subscription'])
  if (!subId) return 'ignoreret'
  const r = await db.update(subscriptions)
    .set({ status: 'past_due', stripeOpdateretAt: stempel, updatedAt: new Date() })
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), maaSpejle(stempel, 'past_due')))
    .returning({ id: subscriptions.id })
  return r.length ? 'behandlet' : 'forael'
}

/** Spejling af Stripes abonnementsobjekt. Flytter ingen adgang. */
async function spejl(o: Ukendt, stempel: Date, ops: Stripeopsaetning | null): Promise<Udfald> {
  const subId = tekst(o['id'])
  if (!subId) return 'ignoreret'
  const status = tekst(o['status']) ?? 'incomplete'
  const p = periode(o)
  const items = (o['items'] as Ukendt | undefined)?.['data']
  const f = Array.isArray(items) ? items[0] as Ukendt | undefined : undefined
  const prisId = tekst((f?.['price'] as Ukendt | undefined)?.['id'])

  // ── FINDES RAEKKEN OVERHOVEDET? ───────────────────────────
  // «Nul raekker opdateret» betoed FOER to vidt forskellige ting:
  // «din spejling er foraeldet» og «der er ingen raekke at spejle i».
  // Begge svarede 'forael', og 'forael' markeres faerdig.
  //
  // Det kostede en `customer.subscription.deleted`, der ankom FOER sin
  // checkout: den blev kvitteret 200, nyttelasten slettet — og da den
  // aeldre checkout og faktura saa ankom, blev raekken oprettet og stod
  // `active`, mens Stripe sagde `canceled`. Genleveringen svarede
  // «gentagelse», og kontoen kunne ikke koebe igen: `har_allerede`.
  // Stripe garanterer ingen raekkefoelge — se docs/webhooks#event-ordering.
  //
  // Terminalvagten kunne ikke fange det: den beskytter en EKSISTERENDE
  // terminal raekke. Den kan ikke beskytte mod en terminal haendelse,
  // der blev kasseret, foer raekken fandtes.
  //
  // 'afventer' markerer IKKE faerdig: nyttelasten beholdes, ruten
  // svarer 409, og baade Stripes genlevering og vores eget tilsyn kan
  // tage den op igen, naar `kassen()` har skrevet raekken.
  const [raekke] = await db.select({
    id: subscriptions.id, opsagtAf: subscriptions.opsagtAfKundeAt,
    stoppet: subscriptions.fornyelseStoppetAt,
    opsagt: subscriptions.cancelAtPeriodEnd,
    planRoert: subscriptions.planForsoegtAt,
  }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1)
  if (!raekke) return 'afventer'

  // ── EN BESLUTNING SPEJLES IKKE VAEK ───────────────────────
  // En forsinket `updated`, oprettet FOER beslutningen, baerer
  // `cancel_at_period_end: false` — og skrev det hen over den, saa
  // «Mit abonnement» sagde «fornyes» kort efter, kunden sagde op.
  // Flaget er et spejl; beslutningen er ikke. Kun en haendelse, der er
  // NYERE end beslutningen, maa rydde flaget.
  //
  // BEGGE beslutninger taeller. Kundens opsigelse er den ene; vores
  // eget sikkerhedsstop (`fornyelse_stoppet_at`) er den anden, og det
  // skriver det SAMME felt. Uden den anden kunne en haendelse, dannet
  // foer stoppet, rydde flaget paa en raekke, hvor VI havde stoppet
  // fornyelsen — og raekken var derefter foraeldreloes.
  //
  // At saette flaget til true er altid i orden: dér er spejl og
  // beslutning enige.
  //
  // ── OG EN MANGLENDE NOEGLE ER IKKE ET «NEJ» ───────────────
  // `o['cancel_at_period_end'] === true` gjorde en FRAVAERENDE noegle
  // til false og ryddede flaget. Tre linjer nede staar `harSkema` med
  // `hasOwnProperty` og kommentaren om, at det er noeglens
  // TILSTEDEVAERELSE, der afgoer — samme saetning, to regler. Maalt:
  // en `customer.subscription.updated` uden noeglen slog flaget fra.
  const harFlag = Object.prototype.hasOwnProperty.call(o, 'cancel_at_period_end')
  const rydder = o['cancel_at_period_end'] !== true
  const beslutning = [raekke.opsagtAf, raekke.stoppet]
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((m, d) => (m === null || d > m ? d : m), null)
  const aeldreEndBeslutningen = beslutning !== null && beslutning > stempel
  const maaSkriveOpsigelsesflag = harFlag && !(rydder && aeldreEndBeslutningen)

  // ── `schedule: null` ER ET SVAR ───────────────────────────
  // Feltet blev foer kun skrevet, naar det havde en VAERDI. En
  // autoritativ `schedule: null` — Stripes egen maade at sige «det
  // her abonnement styres ikke laengere af en plan» — kunne derfor
  // ikke rydde bindingen, og et gammelt plan-id blev staaende som
  // bevis for en plan, der var sluppet. Nu afgoer det, om NOEGLEN er
  // der, ikke om vaerdien er sand.
  //
  // MEN et svar fra FOER planen fandtes er ikke et svar om planen.
  // `laegPlan` skriver `plan_forsoegt_at`, hver gang den roerer en
  // plan, og en haendelse, der er aeldre end det, ved intet om den.
  // Uden vagten kunne en forsinket `updated` rydde bindingen paa en
  // aktiv, korrekt plan — og saa var planen usynlig for os igen.
  const harSkema = Object.prototype.hasOwnProperty.call(o, 'schedule')
    && !(tekst(o['schedule']) === null
         && raekke.planRoert !== null && raekke.planRoert > stempel)

  const r = await db.update(subscriptions)
    .set({
      status: status as typeof subscriptions.$inferInsert.status,
      ...(maaSkriveOpsigelsesflag
        ? { cancelAtPeriodEnd: o['cancel_at_period_end'] === true } : {}),
      ...(p.slut ? { currentPeriodEnd: p.slut } : {}),
      ...(p.start ? { currentPeriodStart: p.start } : {}),
      ...(prisId ? { stripePriceId: prisId } : {}),
      ...(harSkema ? { stripeScheduleId: tekst(o['schedule']) } : {}),
      stripeOpdateretAt: stempel, updatedAt: new Date(),
    })
    // En `subscription.deleted` saetter `canceled` og skal kunne skrive
    // hen over `active`. En `updated` med `active` maa derimod ikke
    // skrive hen over en allerede opsagt raekke, uanset sekundet.
    .where(and(eq(subscriptions.stripeSubscriptionId, subId), maaSpejle(stempel, status)))
    .returning({ id: subscriptions.id })

  // ── ET SPEJL, DER MODSIGER EN BESLUTNING, ER ARBEJDE ──────
  // Ryddede haendelsen flaget, mens en beslutning stadig staar — fordi
  // den var NYERE end beslutningen, og altsaa Stripes egen sandhed —
  // saa er Stripe og vores beslutning uenige. Det er ikke noget at
  // spaerre for; det er noget at afstemme. Uden det her ville raekken
  // blive staaende med en beslutning, ingen koe tog op.
  if (r.length && maaSkriveOpsigelsesflag && rydder
      && (raekke.opsagtAf !== null || raekke.stoppet !== null)) {
    await skyldAfstemning(subId,
      'Stripe melder fornyelse, men opsigelsen står stadig — afstemmes')
  }
  void ops
  return r.length ? 'behandlet' : 'forael'
}

// ═══════════════════════════════════════════════════════════════
//  GENBEHANDLING — den vej, HTTP-kvitteringen ikke kan vaere.
//
//  Ruten svarer nu 409 paa 'afventer', saa Stripe leverer igen. Men
//  Stripes genforsoeg holder op efter sit vindue, og en haendelse, hvis
//  forudsaetning kommer for sent, ville dermed vaere tabt. Derfor to
//  ting, ikke én:
//
//    · nyttelasten GEMMES paa raekken, naar haendelsen foerste gang ses
//    · `behandlUbehandlede()` koerer dem om fra basen, uden Stripe
//
//  Ingen ubehandlet haendelse kasseres nogensinde af sig selv. Staar
//  den stadig, staar den i `stripe_events` med sin fejl og sit
//  forsoegstal, hvor et menneske kan se den. En betaling, vi ikke har
//  faaet bogfoert, maa ikke kunne forsvinde i tavshed.
// ═══════════════════════════════════════════════════════════════

/**
 * Tager gemte, ubehandlede haendelser op igen. Kaldes af importkoerslen.
 *
 * Kun raekker med en gemt nyttelast kan koeres om — en raekke fra foer
 * kolonnen fandtes har ingen krop at behandle, og vi opfinder ikke en.
 */
export async function behandlUbehandlede(
  o: Stripeopsaetning | null, maks = 50,
): Promise<{
  taget: number; behandlet: number; afventer: number; fejlet: number
  tilbage: number; venter: number
}> {
  // ── KUN DE, DER ER KLAR NU ────────────────────────────────
  // Foer stod her «de 50 aeldste ubehandlede», og det var nok til at
  // spaerre koeen for altid: femoghalvtreds haendelser, hvis
  // forudsaetning aldrig kommer, blev valgt hver gang, og den 51. —
  // som var klar — blev aldrig taget op.
  //
  // Nu springes en haendelse over, indtil dens `naeste_forsoeg_at` er
  // passeret. Raekkefoelgen er stadig aeldste foerst BLANDT DE KLARE,
  // saa en gammel haendelse ikke omvendt bliver fortraengt af nye.
  const nu = new Date()
  const ubehandlede = await db.select({
    id: stripeEvents.id, last: stripeEvents.nyttelast,
  }).from(stripeEvents)
    .where(and(
      isNull(stripeEvents.behandletAt),
      isNotNull(stripeEvents.nyttelast),
      or(isNull(stripeEvents.naesteForsoegAt), lte(stripeEvents.naesteForsoegAt, nu)),
    ))
    .orderBy(stripeEvents.stripeOprettetAt)
    .limit(maks)

  let behandlet = 0, afventer = 0, fejlet = 0
  for (const r of ubehandlede) {
    const h = r.last as unknown as Haendelse | null
    if (!h || typeof h.id !== 'string' || !h.data) { fejlet++; continue }
    try {
      const u = await behandl(h, o)
      // Samme opslag som porten og ruten. Stod foer som en ordret
      // kopi af rutens to navne — og en ukendt vaerdi ville derfor
      // staa som «faerdig» i driftlinjen, samtidig med at `tilbage`
      // paa samme linje taeller den som ubehandlet.
      if (UDFALD[u].faerdig) behandlet++
      else afventer++
    } catch {
      // `behandl()` har allerede skrevet fejlen paa raekken og frigivet
      // kravet. Tilsynet maa ikke vaelte af én daarlig haendelse.
      fejlet++
    }
  }

  const [t] = await db.select({ n: count() }).from(stripeEvents)
    .where(isNull(stripeEvents.behandletAt))
  // Hvor mange venter paa deres tid? Tallet skal STAA der: uden det
  // ville «0 taget» se ud som «ingenting at lave», ogsaa naar der er
  // hundrede haendelser i tilbagetraekning.
  const [v] = await db.select({ n: count() }).from(stripeEvents)
    .where(and(
      isNull(stripeEvents.behandletAt),
      isNotNull(stripeEvents.naesteForsoegAt),
      gt(stripeEvents.naesteForsoegAt, nu),
    ))
  return {
    taget: ubehandlede.length, behandlet, afventer, fejlet,
    tilbage: t?.n ?? 0, venter: v?.n ?? 0,
  }
}

/**
 * Driftsindgangen. Ét kald, importkoerslen laver hver time:
 *  1. koer ubehandlede haendelser om
 *  2. tag skyldige betalingsplaner op igen
 *
 * Raekkefoelgen er ikke ligegyldig. En haendelse, der bliver faerdig i
 * skridt 1, bogfoerer sin planskyld — og skridt 2 tager den med i den
 * SAMME koersel i stedet for at vente en time.
 *
 * KASTER IKKE. Tilsynet maa ikke kunne vaelte importen.
 */
export async function betalingstilsyn(o: Stripeopsaetning | null): Promise<string[]> {
  const linjer: string[] = []

  if (!o) {
    // ── UDEN STRIPE GOER TILSYNET INGENTING — OG SIGER DET ──
    // Det er fristende at koere genbehandlingen alligevel: den er
    // «bare» database. Men `betalt()` kan ikke afgoere, om en faktura
    // er introprisen, naar den ikke kender priserne — og en haendelse,
    // der blev markeret faerdig paa det grundlag, ville tage sin
    // planskyld med sig. Tavshed her ville desuden se ud praecis som
    // «der var ikke noget at goere».
    const [u] = await db.select({ n: count() }).from(stripeEvents)
      .where(isNull(stripeEvents.behandletAt))
    const [p] = await db.select({ n: count() }).from(subscriptions)
      .where(and(
        isNotNull(subscriptions.planStatus),
        ne(subscriptions.planStatus, 'konfigureret'),
      ))
    if (u?.n) {
      linjer.push(`[betaling] ${u.n} ubehandlede hændelser blev IKKE taget op: `
        + 'Stripe er ikke konfigureret i denne kørsel.')
    }
    if (p?.n) {
      linjer.push(`[betaling] ${p.n} skyldige betalingsplaner kunne IKKE lægges: `
        + 'Stripe er ikke konfigureret i denne kørsel.')
    }
    return linjer
  }

  try {
    const g = await behandlUbehandlede(o)
    if (g.taget || g.tilbage) {
      linjer.push(
        `[betaling] genbehandling: ${g.taget} taget · ${g.behandlet} færdige `
        + `· ${g.afventer} afventer · ${g.fejlet} fejlede · ${g.tilbage} ubehandlede tilbage `
        + `(${g.venter} venter på tilbagetrækning)`,
      )
    }
  } catch (e) {
    linjer.push(`[betaling] genbehandling fejlede: ${(e as Error).message}`)
  }
  // ── FULDFOER DE SKYLDIGE OPSIGELSER ───────────────────────
  // FOER planlaegningen, og det er ikke tilfaeldigt: en opsigelse, der
  // staar halvt gennemfoert, skal ryddes af vejen, inden vi
  // overvejer at laegge planer. Ellers ville tilsynet i vaerste fald
  // lægge en plan paa et abonnement, det et oejeblik senere selv
  // opsiger.
  //
  // Genoptagelsen findes, fordi opsigelsen kan knaekke midtvejs:
  // `release` lykkes hos Stripe, den lokale skrivning fejler, og
  // funktionen svarer `stripe_fejlede`. Foer sad kunden saa fast —
  // hvert genforsoeg doede paa et `release` af en plan, Stripe
  // allerede havde sluppet, laenge foer det naaede
  // `cancel_at_period_end`. Nu staar beslutningen i basen, og den her
  // tager den op igen.
  try {
    const op = await afstemSkyldige(o)
    if (op.skyldige) {
      linjer.push(
        `[betaling] afstemning: ${op.skyldige} skyldige · ${op.taget} taget `
        + `· ${op.afstemte} afstemt · ${op.fejlede} kunne ikke endnu `
        + (op.nytArbejde ? `· ${op.nytArbejde} fik nyt arbejde undervejs ` : '')
        // «ved kørslens start» er ikke en omsvøb. `venter` måles FØR
        // runden, så de rækker, runden selv skubber bagud, ikke er med.
        // Uden ordene ville en operatør læse «0 venter» som «ingen er i
        // tilbagetrækning nu» — og runden har lige sat femogtyve i den.
        + `(${op.venter} var i tilbagetrækning ved kørslens start)`
        + (op.detaljer.length ? ` — ${op.detaljer.join(' · ')}` : ''),
      )
    }
  } catch (e) {
    linjer.push(`[betaling] afstemningen fejlede: ${(e as Error).message}`)
  }

  try {
    const p = await laegManglendePlaner(o)
    if (p.forsoegt) {
      linjer.push(`[betaling] planer: ${p.forsoegt} forsøgt · ${p.konfigureret} konfigureret `
        + `· ${p.fejlet} opgivet efter ${PLAN_MAX_FORSOEG} forsøg`)
    }
  } catch (e) {
    linjer.push(`[betaling] planlægning fejlede: ${(e as Error).message}`)
  }

  // ── AFSTEM DE GENNEMFOERTE KOEB ───────────────────────────
  // Et forsoeg i `gennemfoert` spaerrer baade nye koeb og
  // gratis-skiftet. Det maa derfor ikke kun kunne opløses af, at
  // kunden klikker igen — en kunde, der aldrig kommer tilbage, ville
  // staa der for evigt.
  try {
    const a = await afstemGennemfoerteKoeb(o)
    if (a.afstemte || a.uafklarede) {
      linjer.push(
        `[betaling] gennemførte køb: ${a.afstemte} afstemt · ${a.uafklarede} uafklaret`
        + (a.detaljer.length ? ` — ${a.detaljer.join(' · ')}` : ''),
      )
    }
  } catch (e) {
    linjer.push(`[betaling] afstemningen af gennemførte køb fejlede: ${(e as Error).message}`)
  }

  // ── STOP EN FORNYELSE, VI IKKE KAN LEVERE ─────────────────
  // Her stod foer KUN en loglinje om, at abonnementet «fornyes til
  // 9 kr./DAG, til nogen griber ind». Det var sandt og utilstraekkeligt:
  // en advarsel er ikke en beskyttelse. Nu gribes der ind.
  try {
    const fare = await iFareForForkertFornyelse()
    for (const f of fare) {
      // ── ÉN RAEKKE MAA IKKE TAGE DE OEVRIGE MED SIG ────
      // Loekken laa i ét stort try: kastede det foerste kald, fik
      // resten af listen intet forsoeg, og loggen sagde kun
      // «fornyelsesbeskyttelsen fejlede». Maalt: nul af to oevrige
      // blev roert. Nu baerer hver raekke sin egen fejl, og de andre
      // bliver forsoegt.
      let r: Awaited<ReturnType<typeof stopForkertFornyelse>> | null = null
      try {
        r = await stopForkertFornyelse(o, f.sub, f.grund)
      } catch (e) {
        linjer.push(
          `[betaling] ⚠⚠ fornyelsen for ${f.sub} kunne IKKE stoppes, og `
          + 'forsøget kastede: ' + (e as Error).message.slice(0, 200)
          + '. Der er IKKE grebet ind for netop den; de øvrige er forsøgt.',
        )
        continue
      }
      if (r === 'stoppet') {
        linjer.push(
          `[betaling] ⚠ fornyelsen er STOPPET for ${f.sub}: ${f.grund} `
          + 'Kunden beholder den betalte periode; der kommer ingen ny opkrævning. '
          + 'Sæt cancel_at_period_end tilbage, når planen er lagt.',
        )
      } else if (r === 'plan_er_rigtig') {
        // Ikke en indgriben — en afstemning. Den staar i loggen, fordi
        // den er SVARET paa den fare, linjen ellers ville melde: der
        // var ingen.
        linjer.push(
          `[betaling] ${f.sub}: planen ligger rigtigt hos Stripe — `
          + 'det var vores egen tilbagelæsning, der manglede. '
          + 'Fornyelsen er IKKE stoppet, og planen er nu bekræftet.',
        )
      } else if (r === 'grundlaget_skiftede') {
        // Ikke en fejl og ikke en bekraeftelse. Planen skiftede,
        // mens vi kontrollerede den gamle, saa vores svar gjaldt et
        // grundlag, der ikke er raekkens laengere. Raekken staar
        // stadig som ikke-konfigureret og bliver taget op igen.
        linjer.push(
          `[betaling] ${f.sub}: planen skiftede, mens den blev kontrolleret — `
          + 'vores svar gjaldt den forrige plan og er IKKE bogført. '
          + 'Fornyelsen er hverken stoppet eller bekræftet; '
          + 'rækken tages op igen i næste kørsel.',
        )
      } else if (r === 'fejlede') {
        linjer.push(
          `[betaling] ⚠⚠ fornyelsen for ${f.sub} kunne IKKE stoppes hos Stripe — `
          + 'enten svarede Stripe ikke, eller også kunne planen ikke afstemmes. '
          + 'Der er IKKE grebet ind: abonnementet fornyes til introprisen, '
          + 'indtil nogen ser efter i Stripe. '
          + `Grund: ${f.grund}`,
        )
      }
    }
  } catch (e) {
    linjer.push(`[betaling] fornyelsesbeskyttelsen fejlede: ${(e as Error).message}`)
  }

  // De stoppede skal BLIVE ved at staa der, til et menneske har set dem.
  try {
    const stoppede = await db.select({ sub: subscriptions.stripeSubscriptionId,
      bekraeftet: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions)
      // ── ÉT FELT AFGOER DET, IKKE TO ───────────────────────
      // Her stod ogsaa `planStatus <> 'konfigureret'`. Det er et ANDET
      // spoergsmaal end «er fornyelsen stoppet?», og det kunne slukke
      // advarslen: blev planen bekraeftet bagefter, forsvandt linjen,
      // mens `cancel_at_period_end` stadig stod hos Stripe og kunden
      // stadig fik at vide, at der ikke bliver trukket mere.
      //
      // At stoppe en fornyelse er en beslutning. Den staar, til et
      // menneske har taget den om — og saa er det `fornyelse_stoppet_at`,
      // der ryddes, ikke en anden kolonne, der tilfaeldigvis skifter.
      .where(isNotNull(subscriptions.fornyelseStoppetAt))
      .limit(20)
    // ── BESLUTNINGEN OG KENDSGERNINGEN ER TO LINJER ───────
    // `fornyelse_stoppet_at` er VORES BESLUTNING, skrevet foer de
    // eksterne kald, saa et fejlet indgreb kan genoptages. Den er
    // derfor ikke laengere et bevis for, at fornyelsen ER stoppet.
    //
    // Linjen «fornyes ikke, før nogen har taget stilling» er en
    // paastand om kundens penge. Den maa kun staa om de raekker,
    // Stripe har bekraeftet. For de oevrige er sandheden den modsatte
    // — abonnementet fornyes — og det er den, en operatoer skal se.
    const bekraeftede = stoppede.filter((x) => x.bekraeftet)
    const uafklarede = stoppede.filter((x) => !x.bekraeftet)
    if (bekraeftede.length) {
      linjer.push(
        `[betaling] ${bekraeftede.length} abonnement(er) har stoppet fornyelse. `
        + 'Kunden har sin betalte periode, men fornyes ikke, før nogen har taget '
        + 'stilling og ryddet fornyelse_stoppet_at: '
        + bekraeftede.map((x) => x.sub).join(', '),
      )
    }
    if (uafklarede.length) {
      linjer.push(
        `[betaling] ⚠ ${uafklarede.length} abonnement(er) er BESLUTTET stoppet, men `
        + 'Stripe har ikke bekræftet det. De fornyes stadig. Afstemningen prøver '
        + 'igen hver kørsel; bliver de stående, skal nogen se efter i Stripe: '
        + uafklarede.map((x) => x.sub).join(', '),
      )
    }
  } catch (e) {
    linjer.push(`[betaling] opgørelsen af stoppede fornyelser fejlede: ${(e as Error).message}`)
  }
  return linjer
}
