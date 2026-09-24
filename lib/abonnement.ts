// ═══════════════════════════════════════════════════════════════
//  Abonnementet: koeb, opsigelse og spejling af Stripes tilstand.
//
//  ── HVEM ER KUNDEN ──────────────────────────────────────────
//  Altid den VERIFICEREDE session. Ingen funktion her tager et
//  bruger-id, et kunde-id, en pris eller en status fra browseren.
//  `hentBrugerId()` laeser Supabase-sessionen paa serveren; kan den
//  ikke svare, er der ingen kunde, og intet sker.
//
//  ── ADGANG FOELGER BETALING, IKKE HENSIGT ───────────────────
//  `adgangTil` skrives ÉT sted: naar en faktura er markeret betalt.
//  Hverken en aabnet betalingsside, en oprettet Checkout Session, et
//  `session_id` i en retur-URL eller et abonnement i status
//  `incomplete` giver adgang. Det er hele forskellen paa «hun har
//  trykket koeb» og «pengene er modtaget».
// ═══════════════════════════════════════════════════════════════

import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { db, raekker } from '../db/client'
import type Stripe from 'stripe'
import { UAFSLUTTET, checkoutForsoeg, subscriptions, users } from '../db/schema'
import { hentBrugerId } from './auth'
import { NORMAL_OERE, fase, opsaetning, stripe, type Stripeopsaetning } from './stripe'
import { TERMINALE, afstemAbonnement, noterOpsigelse } from './opsigelse'
import type { Opsigelsesudfald } from './opsigelse'

/** Statusser, hvor abonnementet stadig lever hos Stripe. */
export const LEVENDE = [
  'trialing', 'active', 'past_due', 'incomplete', 'paused', 'unpaid',
] as const

export type Koebssvar =
  | { ok: true; url: string }
  | { ok: false; fejl: 'gratis_tilstand' | 'ikke_logget_ind' | 'stripe_mangler'
      | 'har_allerede' | 'koeb_i_gang' | 'koeb_gennemfoert' | 'stripe_fejlede' }

/**
 * Starter et koeb og returnerer Stripes betalingsside.
 *
 * Tre spaerringer, i den raekkefoelge:
 *  1. GRATIS tilstand → intet koeb. Der findes ingen vej til kassen,
 *     naar muren er fra — heller ikke ved at kalde handlingen direkte.
 *  2. Ingen session → intet koeb. Vi ved ikke, hvem der skulle betale.
 *  3. Har allerede et levende abonnement → intet nyt. Det er vagten
 *     mod dobbeltklik: to klik giver ikke to abonnementer, fordi det
 *     andet klik moeder en raekke, det foerste lavede.
 */
export async function startKoeb(retur: string): Promise<Koebssvar> {
  const brugerId = await hentBrugerId()
  return brugerId ? startKoebFor(brugerId, retur) : { ok: false, fejl: 'ikke_logget_ind' }
}

/**
 * Samme koeb paa et id, kalderen allerede har. Eksporteret KUN til
 * proeven — samme greb som `sigOpFor` og `abonnementForBruger`, og af
 * samme grund: reglen er det, der skal proeves, ikke Supabases
 * sessionslaesning. `startKoeb()` er den eneste vej ind udefra, og den
 * henter id'et fra den VERIFICEREDE session.
 */
export async function startKoebFor(
  brugerId: string, retur: string, foersteForsoeg = true,
): Promise<Koebssvar> {
  const o = opsaetning()
  if (!o) return { ok: false, fejl: 'stripe_mangler' }

  // ── 1 · RESERVÉR FOER ENHVER EKSTERN SIDEEFFEKT ────────────
  // Foer blev Stripe-sessionen oprettet FOERST og reservationen
  // skrevet bagefter. To ting gik galt af det:
  //  · Idempotensnoeglen kunne ikke bindes til forsoeget, fordi
  //    forsoeget ikke fandtes endnu. Den var `koeb:<bruger>:<pristype>`
  //    og blev genbrugt paa tvaers af forsoeg. Stripe gemmer en noegle
  //    i mindst 24 timer og AFVISER den med aendrede parametre — saa
  //    et nyt koeb efter en udloebet session gav `stripe_fejlede`.
  //  · Taberen af et kaploeb havde allerede oprettet en session hos
  //    Stripe, og fejlgrenen lukkede den — men vinderen delte den,
  //    fordi noeglen var den samme. Resultatet var én «gyldig» URL
  //    til en session, vi lige havde udloebet.
  //
  // Nu er raekkens eget id noeglen, og parametrene ligger fast pr.
  // forsoeg. Taberen naar aldrig at kalde Stripe.
  //
  // ── 2 · SAMME TRANSAKTION SOM DRIFTSTILSTANDEN ────────────
  // `select ... for share` paa drift-raekken serialiserer koebet mod
  // `saetTilstand()`, som tager `for update` paa den samme raekke.
  // Uden det kunne et koeb, der var i gang, naa forbi et skift til
  // GRATIS — kunden endte med en aaben betalingsside i gratis
  // tilstand. Det delvise indeks loeser ikke DEN koordinering; det
  // afgoer kun, hvor mange reservationer der maa vaere.
  let forsoeg: Reservation
  try {
    forsoeg = await db.transaction(async (tx): Promise<Reservation> => {
      const [d] = raekker<{ tilstand: string }>(await tx.execute(
        sql`select tilstand from drift where id = true for share`,
      ))
      if (d?.tilstand !== 'betaling') throw new Koebsfejl('gratis_tilstand')

      const [levende] = await tx.select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, brugerId), inArray(subscriptions.status, [...LEVENDE])))
        .limit(1)
      if (levende) throw new Koebsfejl('har_allerede')

      // ── SWEEPET LUKKER KUN DET, STRIPE ALDRIG FIK AT VIDE ──
      // Foer lukkede det enhver udloebet reservation paa det LOKALE ur.
      // Det kunne skjule et koeb, der blev GENNEMFOERT foer
      // udloebstidspunktet: sessionen var `complete` hos Stripe, mens
      // vi skrev `udloebet` uden at spoerge.
      //
      // En raekke MED et sessions-id afgoeres derfor udelukkende af
      // Stripes svar — den vej ligger to linjer laengere nede, hvor
      // `aaben_findes` sender den gennem `urlForForsoeg`. Det lokale ur
      // bruges kun til det, Stripe aldrig blev fortalt.
      //
      // For en SESSIONSLOES raekke er uret nok, og det er ikke et
      // skoen: sessionens `expires_at` ER reservationens `udloeber_at`
      // (samme tal, med vilje). Er tidspunktet passeret, kan en session,
      // der maatte vaere oprettet, heller ikke betales laengere.
      await tx.update(checkoutForsoeg)
        .set({ status: 'udloebet', lukketAt: new Date() })
        .where(and(
          eq(checkoutForsoeg.userId, brugerId),
          eq(checkoutForsoeg.status, 'aaben'),
          isNull(checkoutForsoeg.stripeSessionId),
          lt(checkoutForsoeg.udloeberAt, new Date()),
        ))

      // BEGGE ikke-afgjorte tilstande spaerrer. Et `gennemfoert`
      // forsoeg er den vigtigste af de to: der er maaske betalt, og et
      // nyt koeb ville give kunden to abonnementer.
      //
      // Bemaerk at spaerringen IKKE hviler paa `subscriptions`-raekken.
      // Den skabes kun af webhooken, og Stripe garanterer hverken
      // raekkefoelge eller hastighed — en beskyttelse, der venter paa en
      // fremmed levering, er ingen beskyttelse. Sessionens egen
      // `complete` er det tidligste bevis, VI selv kan hente.
      const [uafsluttet] = await tx.select({
        id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
        status: checkoutForsoeg.status,
      }).from(checkoutForsoeg)
        .where(and(
          eq(checkoutForsoeg.userId, brugerId),
          inArray(checkoutForsoeg.status, [...UAFSLUTTET]),
        ))
        .limit(1)
      if (uafsluttet?.status === 'gennemfoert') throw new Koebsfejl('gennemfoert_findes')
      if (uafsluttet) throw new Koebsfejl('aaben_findes', uafsluttet.id, uafsluttet.sid)

      const [u] = await tx.select({
        mail: users.email, kunde: users.stripeCustomerId, intro: users.introBrugtAt,
      }).from(users).where(eq(users.id, brugerId)).limit(1)
      if (!u) throw new Koebsfejl('ikke_logget_ind')

      const pris = u.intro === null ? o.introPrisId : o.normalPrisId
      // Udloebstidspunktet beregnes ÉN gang og GEMMES. Foer blev det
      // beregnet paa ny ved hvert kald, saa den samme idempotensnoegle
      // fik forskellige parametre — netop det, Stripe afviser.
      const udloeber = new Date(Date.now() + CHECKOUT_LEVETID_MIN * 60000)
      const [r] = await tx.insert(checkoutForsoeg).values({
        userId: brugerId, prisId: pris, udloeberAt: udloeber,
        stripeCustomerId: u.kunde,
      }).returning({ id: checkoutForsoeg.id })
      return { id: r!.id, pris, udloeber, kunde: u.kunde ?? null, mail: u.mail }
    })
  } catch (e) {
    if (e instanceof Koebsfejl) {
      // Sessionen er gennemfoert. Der er intet nyt koeb at starte, og
      // det ville vaere det vaerst taenkelige svar paa en betaling.
      if (e.slags === 'gennemfoert_findes') return { ok: false, fejl: 'koeb_gennemfoert' }
      if (e.slags === 'aaben_findes') {
        // Der ligger allerede et aabent forsoeg. Tre udfald, og de er
        // tre FORSKELLIGE beskeder til hende:
        const svar = await urlForForsoeg(o, e.forsoegId!, e.sessionId ?? null)
        // · sessionen kan stadig betales → giv den SAMME igen
        if (svar.slags === 'url') return { ok: true, url: svar.url }
        // · sessionen er doed, og raekken er nu lukket → begynd forfra.
        //   Foer svarede vi «har_allerede», hvis tekst er «Du har
        //   allerede et abonnement» — og det havde hun ikke. Hun havde
        //   en udloebet betalingsside, og det rigtige svar paa den er en
        //   ny. Ét genforsoeg, saa en uventet tilstand ikke kan loekke.
        // · sessionen er GENNEMFOERT → ikke et nyt koeb. Her laa
        //   fund 1: `complete` blev laest som «doed side», raekken sat
        //   til `betalt`, og genstarten oprettede session nummer to
        //   oven i en betaling, der lige var gaaet igennem.
        if (svar.slags === 'gennemfoert') return { ok: false, fejl: 'koeb_gennemfoert' }
        if (svar.slags === 'lukket' && foersteForsoeg) {
          return startKoebFor(brugerId, retur, false)
        }
        // · vi kunne ikke faa svar fra Stripe → raekken staar aaben, og
        //   vi paastaar ingenting om den.
        return { ok: false, fejl: 'koeb_i_gang' }
      }
      return { ok: false, fejl: e.slags }
    }
    // Det delvise indeks `checkout_uafsluttet_pr_bruger` afviste
    // indsaettelsen: en ANDEN samtidig forespoergsel naaede at
    // reservere foerst. Det er ikke en Stripe-fejl, og teksten
    // «prøv igen — der er ikke trukket noget» ville vaere forkert:
    // der ER et koeb i gang, og det er hendes eget.
    //
    // Vagten ligger i BASEN og ikke i koden. To forespoergsler laeser
    // begge «ingen aaben reservation» i samme sekund, hver i sin
    // transaktion — ingen af dem kan se den anden, foer den er
    // committet. Kun et unikt indeks kan afgoere det.
    if (erDublet(e)) return { ok: false, fejl: 'koeb_i_gang' }
    return { ok: false, fejl: 'stripe_fejlede' }
  }

  // ── 3 · EKSTERNE KALD, EFTER reservationen ────────────────
  const s = stripe(o)
  try {
    let kunde = forsoeg.kunde
    if (!kunde) {
      const ny = await s.customers.create(
        { email: forsoeg.mail, metadata: { bofinda_bruger: brugerId } },
        // Noeglen er FORSOEGETS, ikke brugerens. En noegle paa
        // `kunde:<bruger>` ville have LAASTE parametre for evigt: den
        // dag hun skifter mailadresse, ville Stripe afvise noeglen med
        // «andre parametre», og koebet ville vaere spaerret helt. Med
        // forsoegets id er det vaerste, der kan ske, en dublet
        // kunderaekke hos Stripe, hvis vores egen skrivning nedenfor
        // gik galt — ingen opkraevning, og ingen spaerret kunde.
        { idempotencyKey: `kunde:${forsoeg.id}` },
      )
      kunde = ny.id
      await db.update(users).set({ stripeCustomerId: kunde }).where(eq(users.id, brugerId))
      await db.update(checkoutForsoeg).set({ stripeCustomerId: kunde })
        .where(eq(checkoutForsoeg.id, forsoeg.id))
    }

    const sess = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: kunde,
      line_items: [{ price: forsoeg.pris, quantity: 1 }],
      success_url: `${grundadresse()}/abonnement/kvittering?retur=${encodeURIComponent(retur)}`,
      cancel_url: `${grundadresse()}${retur}`,
      subscription_data: {
        metadata: {
          bofinda_bruger: brugerId, bofinda_forsoeg: forsoeg.id,
          bofinda_intro: String(forsoeg.pris === o.introPrisId),
        },
      },
      client_reference_id: brugerId,
      locale: 'da',
      expires_at: Math.floor(forsoeg.udloeber.getTime() / 1000),
    }, {
      // Noeglen er FORSOEGET. Et nyt forsoeg faar en ny noegle, saa
      // Stripes 24-timers opbevaring ikke kan spaerre en genstart.
      idempotencyKey: `koeb:${forsoeg.id}`,
    })
    if (!sess.url) {
      await lukForsoeg(forsoeg.id, 'afbrudt')
      return { ok: false, fejl: 'stripe_fejlede' }
    }

    // ── RESERVATIONEN SKAL STADIG VAERE VORES ────────────────
    // Transaktionen ovenfor er committet, og laasen paa drift-raekken
    // er sluppet, mens Stripe svarede. Et skift til GRATIS kan altsaa
    // have lukket reservationen i mellemtiden. Betingelsen `status =
    // 'aaben'` er det, der opdager det: rammer opdateringen nul
    // raekker, har skiftet vundet, og sessionen maa ikke blive
    // staaende betalbar.
    const beholdt = await db.update(checkoutForsoeg)
      .set({ stripeSessionId: sess.id, stripeStatus: 'open' })
      .where(and(eq(checkoutForsoeg.id, forsoeg.id), eq(checkoutForsoeg.status, 'aaben')))
      .returning({ id: checkoutForsoeg.id })
    if (!beholdt.length) {
      await opgivSession(o, forsoeg.id, sess.id)
      return { ok: false, fejl: 'gratis_tilstand' }
    }
    return { ok: true, url: sess.url }
  } catch {
    // Reservationen lukkes, saa kontoen ikke staar laast ude af et
    // forsoeg, der aldrig blev til en session.
    //
    // Det aabner ét hul, og det er lukket et andet sted: gik kaldet
    // igennem hos Stripe, men svaret gik tabt paa vej hjem, staar der
    // en session, vi ikke kender. Den bliver aldrig betalt — URL'en er
    // aldrig naaet til nogen — og den doer af sig selv paa `expires_at`,
    // som er PRAECIS reservationens egen `udloeber_at`. De to
    // tidspunkter er det samme tal, og det er grunden til, at de skal
    // blive ved med at vaere det.
    await lukForsoeg(forsoeg.id, 'afbrudt')
    return { ok: false, fejl: 'stripe_fejlede' }
  }
}

/**
 * Enten `db` eller en aaben transaktion. `lukAlleAabneKoeb` skal kunne
 * koere INDE i gratis-skiftets transaktion, saa laasen paa drift-raekken
 * daekker baade lukningen og skrivningen af tilstanden.
 */
export type Udfoerer = Pick<typeof db, 'select' | 'update'>

/** Det, reservationen giver videre til de eksterne kald. */
interface Reservation {
  id: string
  pris: string
  udloeber: Date
  kunde: string | null
  mail: string
}

const grundadresse = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bofinda.dk'

/** PostgreSQL's kode for en kraenket entydighed. */
const erDublet = (e: unknown) =>
  (e as { code?: string } | null)?.code === '23505'
  // Teksten er reserveetappen: postgres.js saetter `code`, men en anden
  // driver eller en attrap goer det maaske ikke.
  || /duplicate key|unique[ _]constraint/i.test(String((e as Error)?.message ?? ''))

/**
 * Intern signalfejl fra transaktionen. Baerer ingen Stripe-detaljer.
 *
 * Felterne er skrevet ud, ikke som parameteregenskaber
 * (`constructor(readonly x)`). Den korte form er TypeScript-syntaks,
 * der SKABER kode, og derfor den ene ting, Nodes egen typestripning
 * ikke kan klare: et vaerktoej, der bare fjerner typer, vil kaste
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` paa filen. Det ramte
 * gennemgangens egen probe. Fire linjer mere er en lav pris for at
 * filen kan laeses af den slags vaerktoej.
 */
type Koebsfejlslags = 'gratis_tilstand' | 'har_allerede' | 'ikke_logget_ind'
  | 'aaben_findes' | 'gennemfoert_findes'
class Koebsfejl extends Error {
  slags: Koebsfejlslags
  forsoegId?: string
  sessionId?: string | null
  constructor(slags: Koebsfejlslags, forsoegId?: string, sessionId?: string | null) {
    super(slags)
    this.slags = slags
    this.forsoegId = forsoegId
    this.sessionId = sessionId
  }
}

/**
 * URL'en for et aabent forsoeg — hvis sessionen stadig kan betales.
 *
 * Kan status IKKE slaas op, lades forsoeget staa som AABENT. Et
 * mislykket opslag er ikke bevis for, at en session er ubetalbar;
 * foer markerede vi den udloebet, og saa kunne kontoen begynde et nyt
 * koeb, mens det gamle stadig kunne betales.
 */
type Forsoegssvar =
  /** Sessionen kan betales. */
  | { slags: 'url'; url: string }
  /**
   * Sessionen er GENNEMFOERT. Der er maaske betalt, og der er maaske
   * opstaaet et abonnement — vi har bare ikke bogfoert det endnu.
   * Raekken staar `gennemfoert` og spaerrer, til afstemningen er lavet.
   */
  | { slags: 'gennemfoert' }
  /** Sessionen er UDLOEBET. Raekken er lukket. Der kan begyndes forfra. */
  | { slags: 'lukket' }
  /** Vi fik ikke svar. Raekken staar aaben, og vi paastaar ingenting. */
  | { slags: 'uafklaret' }

async function urlForForsoeg(
  o: Stripeopsaetning, forsoegId: string, sessionId: string | null,
): Promise<Forsoegssvar> {
  if (!sessionId) {
    // Reserveret, men sessionen er ikke skrevet paa endnu. Det betyder
    // som oftest, at et ANDET kald staar inde i Stripe-kaldet lige nu.
    //
    // Her stod et oejeblik «luk raekken og begynd forfra». Det var
    // praecis den fejl, gennemgangen skrev om: taberen af et kaploeb
    // ryddede op efter VINDEREN. Raekken blev lukket under den, dens
    // betingede overtagelse slog fejl, og den udloeb sin egen, gyldige
    // session. Min egen proeve fangede det.
    //
    // En reservation, ingen nogensinde faerdiggoer, ryddes af TIDEN —
    // `udloeberAt` og sweep'et oeverst i transaktionen — ikke af en,
    // der tilfaeldigvis kiggede.
    return { slags: 'uafklaret' }
  }
  try {
    // Vi betaler allerede for det her opslag. Foer blev svaret castet
    // til `{ status, url }`, og BAADE `subscription` og
    // `payment_status` blev smidt vaek — netop de to felter, der siger
    // om kassen blev til noget. Nu laeses de.
    const sess = await stripe(o).checkout.sessions.retrieve(sessionId) as
      { status?: string; url?: string; subscription?: unknown
        payment_status?: string } | null
    if (sess?.status === 'open' && sess.url) {
      await db.update(checkoutForsoeg).set({ stripeStatus: 'open' })
        .where(eq(checkoutForsoeg.id, forsoegId))
      return { slags: 'url', url: sess.url }
    }
    if (sess?.status === 'complete') {
      // GENNEMFOERT. Raekken lukkes IKKE — den spaerrer, til
      // abonnementet er bogfoert. Uanset `payment_status`: `unpaid`
      // betyder «betalingen behandles endnu», ikke «der kom intet».
      await db.update(checkoutForsoeg)
        .set({
          status: 'gennemfoert', stripeStatus: 'complete',
          stripePaymentStatus: sess.payment_status ?? null,
          stripeSubscriptionId: subId(sess.subscription),
        })
        .where(eq(checkoutForsoeg.id, forsoegId))
      return { slags: 'gennemfoert' }
    }
    if (sess?.status && sess.status !== 'open') {
      await db.update(checkoutForsoeg)
        .set({ status: 'udloebet', stripeStatus: sess.status, lukketAt: new Date() })
        .where(eq(checkoutForsoeg.id, forsoegId))
      return { slags: 'lukket' }
    }
    return { slags: 'uafklaret' }
  } catch {
    // Ukendt. Forsoeget bliver staaende AABENT.
    return { slags: 'uafklaret' }
  }
}

/** Abonnements-id'et, uanset om Stripe gav en streng eller et objekt. */
const subId = (v: unknown): string | null =>
  typeof v === 'string' ? v
  : typeof (v as { id?: unknown } | null)?.id === 'string' ? (v as { id: string }).id
  : null

/**
 * Sessionen blev oprettet, men reservationen naaede at blive lukket
 * under os. Den skal udloebes hos Stripe — ellers kan den betales.
 *
 * ── SESSIONSNUMMERET SKRIVES FOERST, ALTID ──────────────────
 * Foer kaldet, ikke efter. Den raekkefoelge er hele vagten: fra det
 * oejeblik Stripe har givet os et sessions-id, findes der noget
 * betalbart, og saa maa der aldrig vaere et vindue, hvor vores base
 * ikke kender det. Alt hvad der kommer bagefter — kaldet, svaret,
 * skrivningen — kan mislykkes.
 *
 * ── OG RAEKKEN GENOPLIVES ALDRIG ────────────────────────────
 * Her stod foer `status: 'aaben'` i fejlgrenen, saa naeste afstemning
 * kunne se raekken. Det virkede kun, saa laenge kontoen ikke havde en
 * anden uafsluttet raekke — og den HAR den netop her: vi er i den her
 * gren, fordi reservationen blev lukket under os, og kunden typisk har
 * trykket igen. Det delvise indeks `checkout_uafsluttet_pr_bruger`
 * afviste saa skrivningen med 23505, fejlen slap ud af funktionen, og
 * `startKoebFor`s ydre catch lukkede raekken som `afbrudt` UDEN
 * sessions-id. Sessionen var dermed usynlig for baade
 * `lukAlleAabneKoeb`, `aabneKoeb()` og gratis-skiftet — som derefter
 * meldte «ok», mens der stod en betalbar session hos Stripe. Det er
 * praecis det udfald, hele vagten findes for at forhindre.
 *
 * Nu roerer fejlgrenen ikke `status`. Den skriver kun, hvad vi ved:
 * sessionen findes, den stod `open`, og lukningen mislykkedes. Det
 * praedikat, `UDEN_BEKRAEFTET_LUKNING` beskriver, finder den derefter
 * uanset hvilken status raekken staar i.
 */
async function opgivSession(o: Stripeopsaetning, forsoegId: string, sessionId: string) {
  await db.update(checkoutForsoeg)
    .set({ stripeSessionId: sessionId, stripeStatus: 'open' })
    .where(eq(checkoutForsoeg.id, forsoegId))
  try {
    await stripe(o).checkout.sessions.expire(sessionId)
    await db.update(checkoutForsoeg)
      .set({ stripeStatus: 'expired', lukkeFejl: null })
      .where(eq(checkoutForsoeg.id, forsoegId))
  } catch (e) {
    await db.update(checkoutForsoeg)
      .set({ lukkeFejl: (e as Error).message.slice(0, 300),
             lukkeForsoeg: sql`${checkoutForsoeg.lukkeForsoeg} + 1` })
      .where(eq(checkoutForsoeg.id, forsoegId))
  }
}

/**
 * En session, VI ikke har faaet bekraeftet lukket — uanset hvilken
 * status raekken selv staar i.
 *
 * Raekkens `status` svarer paa «maa kontoen starte noget nyt?».
 * Sessionen hos Stripe svarer paa «kan der stadig komme penge?». Det
 * er to forskellige spoergsmaal, og de kan staa forskelligt: en raekke,
 * der blev lukket under et kald i luften, er afgjort HOS OS, mens
 * sessionen stadig er betalbar HOS STRIPE.
 *
 * Tre led, og alle tre er noedvendige: der ER en session, vi HAR
 * forsoegt at lukke den (ellers er den bare ny), og det sidste, Stripe
 * sagde om den, var `open`.
 */
const UDEN_BEKRAEFTET_LUKNING = () => and(
  isNotNull(checkoutForsoeg.stripeSessionId),
  isNotNull(checkoutForsoeg.lukkeFejl),
  eq(checkoutForsoeg.stripeStatus, 'open'),
)

/**
 * Alt, der kan spaerre et gratis-skift: et uafsluttet forsoeg ELLER en
 * session, vi ikke har faaet bekraeftet lukket.
 *
 * ÉT sted, fordi `lukAlleAabneKoeb` og `aabneKoeb()` ellers ville
 * svare forskelligt paa det samme spoergsmaal — og et tal paa
 * adminsiden, der modsiger afvisningen ved siden af, er selve den
 * fejltype, hele det her modul handler om.
 */
export const SPAERRER_SKIFTET = () => or(
  inArray(checkoutForsoeg.status, [...UAFSLUTTET]),
  UDEN_BEKRAEFTET_LUKNING(),
)

/**
 * Hvor mange paabegyndte betalinger er endnu ikke afgjort?
 *
 * BEGGE ikke-terminale tilstande taeller. Talte den kun `aaben`, ville
 * adminsiden vise 0, mens skiftet blev afvist — og et tal, der
 * modsiger afvisningen ved siden af, er praecis den fejltype, hele
 * rettelsen handler om.
 */
export async function aabneKoeb(): Promise<number> {
  const [r] = await db.select({ n: count() })
    .from(checkoutForsoeg).where(SPAERRER_SKIFTET())
  return r?.n ?? 0
}

/**
 * Hvor laenge en paabegyndt betaling kan staa aaben.
 *
 * 35, ikke 30, og forskellen er ikke kosmetisk. Stripe kraever, at
 * `expires_at` ligger **mindst 30 minutter** ude i fremtiden. Tiden
 * beregnes nu ÉN gang og gemmes paa raekken — det er hele pointen med
 * en stabil idempotensnoegle — og mellem den beregning og Stripes
 * modtagelse af kaldet gaar der en transaktion, et kundeopslag og en
 * netvaerksrejse. Stod der 30, ville den gemte tid vaere faldet UNDER
 * graensen, naar den naaede frem, og Stripe ville afvise sessionen.
 * De fem minutter er luften mellem vores ur og deres krav.
 */
export const CHECKOUT_LEVETID_MIN = 35

const lukForsoeg = (id: string, status: 'udloebet' | 'afbrudt') =>
  db.update(checkoutForsoeg).set({ status, lukketAt: new Date() })
    .where(eq(checkoutForsoeg.id, id))

/**
 * Lukker alle aabne betalingsforloeb. Kaldes af `saetTilstand()` INDE i
 * dens transaktion — ellers kunne et koeb slippe imellem.
 *
 * Bogfoerer KUN en lukning, Stripe har bekraeftet. Foer blev raekken
 * sat til `afbrudt`, ogsaa naar `expire` kastede — og naeste forsoeg
 * paa gratis-skiftet fandt saa ingen aabne og gik igennem, mens
 * sessionen stadig var `open` hos Stripe.
 */
export async function lukAlleAabneKoeb(udf: Udfoerer = db): Promise<{
  lukkede: number; uafklarede: number; gennemfoerte: number; detaljer: string[]
}> {
  const o = opsaetning()
  const tom = { lukkede: 0, uafklarede: 0, gennemfoerte: 0, detaljer: [] }
  const uafsluttede = await udf.select({
    id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
    status: checkoutForsoeg.status, udloeber: checkoutForsoeg.udloeberAt,
  }).from(checkoutForsoeg).where(SPAERRER_SKIFTET())
  if (!uafsluttede.length) return tom

  // Et GENNEMFOERT forsoeg kan ikke lukkes her. Der er maaske betalt, og
  // det er ikke en oprydningsopgave — det er en beslutning om et
  // abonnement, som et menneske skal tage. Det taelles for sig.
  const gennemfoerte = uafsluttede.filter((x) => x.status === 'gennemfoert')
  const aabne = uafsluttede.filter((x) => x.status === 'aaben')
  // ── DE EFTERLADTE ────────────────────────────────────────
  // Lukket hos OS, ubekraeftet hos STRIPE. De maa ikke behandles som
  // `aabne`: deres `status` er allerede afgjort, og at skrive den om
  // ville ramme `checkout_uafsluttet_pr_bruger`, naar kontoen i
  // mellemtiden har faaet en ny reservation — hvilket er netop den
  // situation, de opstaar i. Sessionen lukkes; raekkens status roeres
  // ikke.
  const efterladte = uafsluttede.filter(
    (x) => x.status !== 'aaben' && x.status !== 'gennemfoert')

  if (!o) {
    // INGEN opsaetning = intet kald = ingen bekraeftet lukning.
    // Foer talte de som lukkede uden at Stripe var spurgt.
    return {
      lukkede: 0, uafklarede: aabne.length + efterladte.length,
      gennemfoerte: gennemfoerte.length,
      detaljer: ['Stripe er ikke konfigureret, så sessionerne kan ikke lukkes.'],
    }
  }
  const s = stripe(o)
  let lukkede = 0
  const detaljer: string[] = []
  const nu = Date.now()
  for (const a of aabne) {
    if (!a.sid) {
      // ── SESSIONSLOES: TO HELT FORSKELLIGE TILFAELDE ────────
      // Her stod «reserveret, men ingen session naaede at blive
      // oprettet» — og raekken blev talt som LUKKET. Det var fund 2.
      // Et tomt sessions-id siger kun, at VI ikke har faaet et id at
      // vide; et `checkout.sessions.create` kan koere lige nu.
      //
      // Skellet er tiden, og det er ikke et skoen: sessionens
      // `expires_at` ER reservationens `udloeber_at`. Er den passeret,
      // kan en session, der maatte findes, ikke betales.
      if (a.udloeber.getTime() <= nu) {
        await udf.update(checkoutForsoeg)
          .set({ status: 'udloebet', lukketAt: new Date() })
          .where(eq(checkoutForsoeg.id, a.id))
        lukkede++
      } else {
        detaljer.push(
          `reservation ${a.id}: en betalingsside er ved at blive oprettet. `
          + `Afventer til ${a.udloeber.toLocaleString('da-DK')}.`,
        )
      }
      continue
    }
    try {
      const sess = await s.checkout.sessions.retrieve(a.sid) as
        { status?: string; payment_status?: string; subscription?: unknown } | null
      if (sess?.status === 'complete') {
        // GENNEMFOERT. Ikke en lukning — en afstemning, der mangler.
        await udf.update(checkoutForsoeg)
          .set({ status: 'gennemfoert', stripeStatus: 'complete',
                 stripePaymentStatus: sess.payment_status ?? null,
                 stripeSubscriptionId: subId(sess.subscription) })
          .where(eq(checkoutForsoeg.id, a.id))
        detaljer.push(`session ${a.sid}: gennemført — afventer afstemning med abonnementet.`)
        continue
      }
      if (sess?.status && sess.status !== 'open') {
        // Allerede ubetalbar — ikke en fejl.
        await udf.update(checkoutForsoeg)
          .set({ status: 'udloebet', stripeStatus: sess.status, lukketAt: new Date() })
          .where(eq(checkoutForsoeg.id, a.id))
        lukkede++; continue
      }
      await s.checkout.sessions.expire(a.sid)
      await udf.update(checkoutForsoeg)
        .set({ status: 'afbrudt', stripeStatus: 'expired', lukketAt: new Date() })
        .where(eq(checkoutForsoeg.id, a.id))
      lukkede++
    } catch (e) {
      // UAFKLARET. Raekken bliver staaende aaben, saa naeste forsoeg
      // ser den igen.
      await udf.update(checkoutForsoeg)
        .set({ lukkeFejl: (e as Error).message.slice(0, 300),
               lukkeForsoeg: sql`${checkoutForsoeg.lukkeForsoeg} + 1` })
        .where(eq(checkoutForsoeg.id, a.id))
      detaljer.push(`session ${a.sid}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  // ── ANDET GENNEMLOEB · DE EFTERLADTE SESSIONER ───────────
  // Kun sessionen lukkes. `status` roeres ALDRIG her — se kommentaren
  // over `efterladte`.
  for (const a of efterladte) {
    if (!a.sid) continue
    try {
      const sess = await s.checkout.sessions.retrieve(a.sid) as
        { status?: string } | null
      if (sess?.status === 'complete') {
        // Der er sandsynligvis betalt paa en session, vores raekke har
        // lukket. Vi skriver INTET om den — hverken status eller
        // «lukket». `lukke_fejl` bliver staaende, saa den bliver ved
        // at spaerre skiftet, til et menneske har set paa den.
        detaljer.push(
          `session ${a.sid}: GENNEMFØRT hos Stripe, men rækken her står `
          + `«${a.status}». Der er sandsynligvis betalt — slå abonnementet `
          + 'op i Stripe og tag stilling, før muren slås fra.',
        )
        continue
      }
      if (sess?.status && sess.status !== 'open') {
        await udf.update(checkoutForsoeg)
          .set({ stripeStatus: sess.status, lukkeFejl: null })
          .where(eq(checkoutForsoeg.id, a.id))
        continue
      }
      await s.checkout.sessions.expire(a.sid)
      await udf.update(checkoutForsoeg)
        .set({ stripeStatus: 'expired', lukkeFejl: null })
        .where(eq(checkoutForsoeg.id, a.id))
    } catch (e) {
      await udf.update(checkoutForsoeg)
        .set({ lukkeFejl: (e as Error).message.slice(0, 300),
               lukkeForsoeg: sql`${checkoutForsoeg.lukkeForsoeg} + 1` })
        .where(eq(checkoutForsoeg.id, a.id))
      detaljer.push(`efterladt session ${a.sid}: ${(e as Error).message.slice(0, 120)}`)
    }
  }

  // ── BEGGE TAL MAALES, INGEN AF DEM UDLEDES ────────────────
  // `uafklarede` var `aabne.length - lukkede`. Det ser rigtigt ud og er
  // det ikke: en raekke, der netop blev `gennemfoert` her i loekken,
  // taeller i `aabne.length`, men ikke i `lukkede` — saa den stod BAADE
  // som uafklaret og som gennemfoert. Det er CLAUDE.md's regel om to
  // udtryk for det samme spoergsmaal: «hvor mange staar der endnu?»
  // maales, den udledes ikke af et startantal minus en taeller.
  //
  // Maalingen er samtidig den rigtige: den ser paa basen EFTER loekken,
  // saa en raekke, en samtidig kaerre har skrevet, ogsaa taeller med.
  // Den skal taelle med — den spaerrer skiftet lige saa meget.
  const staaende = await udf.select({ status: checkoutForsoeg.status })
    .from(checkoutForsoeg).where(SPAERRER_SKIFTET())
  return {
    lukkede,
    // Alt der STADIG spaerrer og ikke er `gennemfoert`, er uafklaret —
    // baade en aaben reservation og en efterladt session.
    uafklarede: staaende.filter((x) => x.status !== 'gennemfoert').length,
    gennemfoerte: staaende.filter((x) => x.status === 'gennemfoert').length,
    detaljer,
  }
}

/**
 * ── TRE UDFALD, IKKE TO ─────────────────────────────────────
 * `ok` betoed foer to ting paa én gang: «vi har gemt din beslutning»
 * og «der kommer ingen opkraevning». De to er ikke det samme, og det
 * var netop dét, der gjorde et fejlet Stripe-kald til «Opsagt · Intet
 * — fornyes ikke» paa skaermen.
 *
 * `bekraeftet` siger, om STRIPE har den. `ok: true, bekraeftet: false`
 * findes ikke — er den ikke bekraeftet, er svaret `afventer`, saa
 * ingen kalder kan komme til at laese `ok` som et loefte.
 *
 * `afventer` er ikke en fejl, kunden har gjort noget forkert ved. Hendes
 * anmodning ER gemt, tilsynet arbejder videre, og hun maa gerne trykke
 * igen — kaldet er idempotent.
 */
export type Opsigelsessvar =
  | { ok: true; bekraeftet: true; adgangTil: Date | null }
  | { ok: false; fejl: 'afventer'; adgangTil: Date | null }
  /**
   * Der blev IKKE gemt noget. Beslutningen er ikke noteret, og der er
   * ingen koe, der arbejder videre.
   *
   * Den maa ikke slaas sammen med `afventer`. «Vi proever automatisk
   * igen» er sandt for `afventer` — beslutningen staar, og skylden
   * staar — og USANDT her: der er ikke noget at proeve igen paa. Det
   * er N1's fejl i en ny forklaedning, og den skal holdes adskilt.
   */
  | { ok: false; fejl: 'ikke_gemt' }
  /**
   * Vi VED det ikke. Skrivningen fejlede, og raekken kunne ikke laeses
   * tilbage bagefter — saa vi kan hverken sige, at noget staar, eller
   * at intet goer.
   *
   * Den maa hverken slaas sammen med `ikke_gemt` eller med `afventer`.
   * `ikke_gemt` paastaar, at intet skete; `afventer` lover en
   * automatik. Her er begge dele ubekraeftede, og et gaet er et udsagn
   * om hendes penge.
   */
  | { ok: false; fejl: 'ukendt'; adgangTil: Date | null }
  | { ok: false; fejl: 'ikke_logget_ind' | 'intet_abonnement' | 'stripe_mangler' }

/**
 * Opsigelse. Stopper NAESTE fornyelse; den betalte periode loeber ud.
 *
 * Abonnementet slaas op paa den VERIFICEREDE brugers id — aldrig paa
 * et abonnements-id fra browseren. Det er hele vaernet mod, at én
 * bruger administrerer en andens abonnement: der er ikke noget felt at
 * manipulere, fordi handlingen ikke tager et.
 */
export async function sigOp(): Promise<Opsigelsessvar> {
  const brugerId = await hentBrugerId()
  return brugerId ? sigOpFor(brugerId) : { ok: false, fejl: 'ikke_logget_ind' }
}

/** Samme opsigelse paa et kendt id. Eksporteret KUN til proeven. */
export async function sigOpFor(brugerId: string): Promise<Opsigelsessvar> {

  const [a] = await db.select({
    stripeId: subscriptions.stripeSubscriptionId, adgang: subscriptions.adgangTil,
    plan: subscriptions.stripeScheduleId,
  }).from(subscriptions)
    .where(and(eq(subscriptions.userId, brugerId), inArray(subscriptions.status, [...LEVENDE])))
    .limit(1)
  if (!a) return { ok: false, fejl: 'intet_abonnement' }

  const o = opsaetning()
  if (!o) return { ok: false, fejl: 'stripe_mangler' }

  // ── BESLUTNINGEN SKRIVES FOERST ──────────────────────────
  // Foer et eneste eksternt kald. Det er ankeret, der goer resten
  // genoptagelig: knaekker opsigelsen midtvejs — `release` lykkedes,
  // den lokale skrivning fejlede — staar beslutningen stadig, og
  // `fuldfoerSkyldigeOpsigelser` tager den op igen i naeste
  // tilsynskoersel. Foer stod der intet at genoptage FRA, og kunden
  // sad fast: hvert genforsoeg doede paa et `release` af en plan,
  // Stripe allerede havde sluppet, laenge foer det naaede
  // `cancel_at_period_end`.
  //
  // Beslutningen spaerrer samtidig automatisk planlaegning og kan ikke
  // ryddes af en forsinket spejling. Se `opsagtAfKundeAt` i skemaet.
  // ── OG ET AFVIST KALD ER OGSAA ET SVAR ────────────────
  // Fejler skrivningen — en databasefejl er nok — kastede `sigOpFor`
  // sit promise videre, og kunden mødte en ubehandlet fejl i stedet
  // for en besked. Vi ved i det tilfælde ikke, om beslutningen nåede
  // at blive gemt, så vi siger præcis dét: vi kunne ikke bekræfte
  // noget. Knappen bliver stående, og hun kan trykke igen.
  //
  // Det er samme regel som N1, anvendt ét skridt tidligere: et kald,
  // der ikke lykkedes, må ikke vises som noget andet end det.
  try {
    await noterOpsigelse(a.stripeId)
  } catch {
    // ── ET KAST ER IKKE ET BEVIS FOR, AT INTET SKETE ────────
    // Her stod `ikke_gemt` ubetinget, og det var for staerkt et
    // udsagn. Skrivningen er ÉT statement: den lander helt eller slet
    // ikke. Men et tabt svar — forbindelsen falder, EFTER basen har
    // committet — kaster PRAECIS som en afvist skrivning. Beslutningen
    // og skylden staar da i raekken, tilsynet fuldfoerer opsigelsen, og
    // «der er IKKE sket noget med dit abonnement» er saa usandt.
    //
    // Det er atomiciteten, der goer raekken til et gyldigt svar: der
    // findes ingen halv tilstand at fejllaese. Derfor laeses den
    // tilbage, og derfor skal skrivningen BLIVE ét statement.
    let staar: { opsagt: Date | null; skyldig: Date | null } | undefined
    try {
      ;[staar] = await db.select({
        opsagt: subscriptions.opsagtAfKundeAt,
        skyldig: subscriptions.afstemningSkyldigAt,
      }).from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, a.stripeId)).limit(1)
    } catch {
      // Vi kunne ikke engang se efter. Saa siger vi det.
      return { ok: false, fejl: 'ukendt', adgangTil: a.adgang }
    }
    if (!staar) return { ok: false, fejl: 'ukendt', adgangTil: a.adgang }

    // Hverken beslutning eller skyld: skrivningen landede ikke. Det er
    // det eneste tilfaelde, hvor «der er ikke sket noget» er maalt.
    // Der er heller ingen koe at haenge et loefte om automatik paa.
    if (!staar.opsagt && !staar.skyldig) return { ok: false, fejl: 'ikke_gemt' }

    // Den ene uden den anden. Det kan ikke komme af DENNE skrivning —
    // den saetter begge i samme statement — saa vi ved ikke, hvad vi
    // ser, og om tilsynet tager den. Vi lover ingen af delene.
    if (!staar.opsagt || !staar.skyldig) {
      return { ok: false, fejl: 'ukendt', adgangTil: a.adgang }
    }

    // Begge staar: skrivningen ER landet, og det var svaret, der gik
    // tabt. Tilstanden er den samme som efter et kald, der lykkedes,
    // saa vi fortsaetter som efter et kald, der lykkedes.
  }

  // Afstemningen henter sin hensigt fra raekken, og beslutningen er
  // netop skrevet. Den er ÉN implementering, delt med tilsynet: to
  // udgaver af «slip planen og saet cancel_at_period_end» ville vaere
  // praecis den drift, CLAUDE.md advarer imod.
  // `false`: hendes eget tryk er ikke et koeforsoeg. Taltes det med,
  // ville tre mislykkede tryk skubbe hendes egen opsigelse bagud i
  // koeen — hun ville blive straffet for at proeve.
  // ── OGSAA AFSTEMNINGEN KAN KASTE ────────────────────────
  // Den bogfoerer selv en Stripe-fejl, og fejler DEN skrivning ogsaa,
  // kaster den — samme form som Q1 i koeen. Uden vagten her moedte
  // kunden en ubehandlet fejl i stedet for en besked, og det er
  // noejagtig det, kommentaren ovenfor lover at den ikke goer.
  //
  // Svaret er `afventer`, og det er MAALT, ikke gaettet: enten
  // lykkedes `noterOpsigelse`, eller ogsaa har vi lige laest
  // beslutningen OG skylden tilbage. Raekken staar i koeen, og
  // tilsynet tager den.
  let u: Opsigelsesudfald
  try {
    u = await afstemAbonnement(o, a.stripeId, false)
  } catch {
    return { ok: false, fejl: 'afventer', adgangTil: a.adgang }
  }

  // ── TO SLAGS «IKKE FAERDIG», OG KUN DEN ENE ER EN FEJL ──
  // `bekraeftet_ikke_bogfoert` betyder, at STRIPE har opsigelsen — der
  // kommer ingen opkraevning — og at det kun er vores egen oprydning,
  // der mangler. Det er ikke noget, hun skal goere om, og det er ikke
  // et ubekraeftet loefte: det er laest tilbage fra kilden.
  //
  // `ikke_bekraeftet` er derimod netop det, N1 handler om: vi VED det
  // ikke. Saa siger vi det.
  if (u === 'ikke_bekraeftet') return { ok: false, fejl: 'afventer', adgangTil: a.adgang }
  return { ok: true, bekraeftet: true, adgangTil: a.adgang }
}

export interface Abonnementsbillede {
  status: string
  fase: 'intro' | 'normal' | null
  /**
   * `{ slags: 'beloeb' }` · vi ved hvad der traekkes
   * `{ slags: 'fornyes_ikke' }` · BEKRAEFTET stoppet — ingen betaling
   * `{ slags: 'opsigelse_undervejs' }` · hun har sagt op, Stripe har
   *    ikke bekraeftet det endnu
   * `{ slags: 'ukendt' }` · vi kan IKKE bekraefte naeste betaling
   *
   * Ingen af dem maa smelte sammen. `null` betoed engang baade
   * «fornyes ikke» og «ved ikke», og «fornyes ikke» blev vist til en
   * kunde, hvis plan bare ikke var bekraeftet.
   *
   * `opsigelse_undervejs` kom til af samme grund én runde senere:
   * `fornyes_ikke` blev udtalt alene paa kundens BESLUTNING, saa et
   * fejlet Stripe-kald saa ud som en gennemfoert opsigelse. Et loefte
   * om ingen betaling maa kun hvile paa Stripes eget svar.
   */
  naeste: { slags: 'beloeb'; oere: number } | { slags: 'fornyes_ikke' }
    | { slags: 'opsigelse_undervejs' } | { slags: 'ukendt' }
  /**
   * Fornyelsen er stoppet AF OS, fordi planen ikke kunne bekraeftes.
   * Hun skal vide det — og at hun beholder det, hun har betalt for.
   */
  fornyelseStoppet: boolean
  /**
   * Abonnementet er lukket hos Stripe og kommer ikke tilbage.
   *
   * Staar foerst i statuskaskaden: at abonnementet ER slut, er den
   * vigtigste kendsgerning paa siden, og «Opsagt» ville skjule den.
   * Beregnes paa serveren af `TERMINALE`, saa klientkomponenten ikke
   * skal importere en vaerdi fra `lib/` — et vaerdi-import derfra
   * traekker `postgres` med ind i browserbundtet.
   */
  afsluttet: boolean
  fornyesAt: Date | null
  /**
   * Hun har sagt op, og Stripe har ikke bekraeftet det endnu.
   *
   * Skal vises som en ROLIG status — «vi har din opsigelse og er ved
   * at gennemfoere den» — og knappen skal blive staaende, saa hun kan
   * proeve igen. Aldrig som «Opsagt»: der er ikke kommet et nej fra
   * betalingsudbyderen endnu, og indtil det goer, kan der blive
   * traekt som normalt.
   */
  opsigelseUndervejs: boolean
  /**
   * Stripe siger, at der ikke kommer en opkraevning — uanset HVEM der
   * bad om det. Kunden, os (`fornyelse_stoppet_at`) eller en haand i
   * Stripes eget dashboard.
   *
   * Det er udsagnet om pengene, og det er dét, der skjuler
   * opsigelsesknappen: er der ingen fornyelse, er der intet at sige op.
   * Ordet «Opsagt» hoerer derimod kun til HENDES opsigelse — at
   * tillaegge hende vores egen handling er en anden slags usandhed.
   */
  fornyesIkke: boolean
  opsagt: boolean
}

// `periode` stod her og er FLYTTET til `betaltPeriode` i lib/adgang.ts.
//
// Den var det eneste af elleve felter, der ikke var en egenskab ved
// raekken: de ti oevrige — status, fase, naeste, fornyesAt, opsagt,
// opsigelseUndervejs, fornyesIkke, afsluttet, fornyelseStoppet — er
// KONTRAKTEN hos Stripe, og de kan ikke udledes af MAX(adgang_til).
// `periode` spurgte derimod ordret murens spoergsmaal — «er den betalte
// periode loebet ud» — men paa en daarligere stikproeve: raekkevalget
// her ser aldrig paa `adgang_til`.
//
// Proeven paa, at det var ÉT spoergsmaal og ikke to: svarene kunne
// ORDNES. Panelet sagde aldrig mere adgang end muren gav, og nogle
// gange mindre. Se afsnit 8f i scripts/test-betaling.ts for de to
// maalte uenigheder.

/**
 * Til «Mit abonnement». Kun den verificerede brugers EGEN, AKTUELLE
 * raekke.
 *
 * Sorteringen var `asc(oprettetAt)` og valgte dermed den AELDSTE —
 * altsaa historikken. Efter opsigelse → udloeb → nyt koeb viste siden
 * det gamle, afsluttede abonnement. Reproduceret paa 832d483 (fund 4a).
 * Nu: et levende foerst, ellers det nyeste.
 */
export async function mitAbonnement(): Promise<Abonnementsbillede | null> {
  const brugerId = await hentBrugerId()
  return brugerId ? abonnementForBruger(brugerId) : null
}

/**
 * Samme opslag, men paa et id, kaldet allerede har. Eksporteret saa
 * proeven kan maale UDVAELGELSEN uden en Next-session — reglen er det,
 * der skal proeves, ikke Supabases sessionslaesning.
 */
export async function abonnementForBruger(brugerId: string): Promise<Abonnementsbillede | null> {
  const felter = {
    status: subscriptions.status, pris: subscriptions.stripePriceId,
    slut: subscriptions.currentPeriodEnd, adgang: subscriptions.adgangTil,
    opsagt: subscriptions.cancelAtPeriodEnd, plan: subscriptions.stripeScheduleId,
    planStatus: subscriptions.planStatus,
    stoppet: subscriptions.fornyelseStoppetAt,
    opsagtAf: subscriptions.opsagtAfKundeAt,
  }
  const [levende] = await db.select(felter).from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      isNotNull(subscriptions.stripeSubscriptionId),
      inArray(subscriptions.status, [...LEVENDE]),
    ))
    .orderBy(desc(subscriptions.oprettetAt)).limit(1)
  const [nyeste] = levende ? [levende] : await db.select(felter).from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      isNotNull(subscriptions.stripeSubscriptionId),
    ))
    .orderBy(desc(subscriptions.oprettetAt)).limit(1)
  const a = nyeste
  if (!a) return null

  // ── TO FELTER, OG BEGGE SKAL VAERE SANDE ────────────────
  // Her stod `a.opsagt || a.opsagtAf !== null`. Et OR kan kun goere et
  // udsagn STAERKERE — saa den svageste oplysning, at hun har trykket
  // paa en knap, kom ud som det staerkeste loefte, vi kan give om
  // hendes penge: «Intet — fornyes ikke». Et fejlet Stripe-kald saa
  // dermed ud som en gennemfoert opsigelse, og knappen forsvandt, saa
  // hun ikke engang kunne proeve igen.
  //
  // De to felter svarer paa hver sit spoergsmaal:
  //  · `opsagtAf`  — HAR HUN BEDT OM DET? En beslutning, vores egen.
  //  · `opsagt`    — SIGER STRIPE, at der ikke kommer en opkraevning?
  //
  // «Opsagt» kraever begge. Kun kunden → opsigelsen er undervejs. Kun
  // Stripe-flaget → det er ikke hendes opsigelse; det er VORES
  // sikkerhedsstop (`stopForkertFornyelse` skriver det samme felt), og
  // det har sin egen blok og sin egen vej videre. Maalt: uden kravet om
  // `opsagtAf` stod der «Opsagt» og knappen var skjult for en kunde,
  // der aldrig havde sagt op.
  const anmodet = a.opsagtAf !== null
  // TRE booleans, ét spoergsmaal hver:
  //  · `fornyesIkke`          — siger STRIPE, at der ikke kommer en
  //                             opkraevning? Det er et udsagn om penge,
  //                             og det er sandt, uanset hvem der bad om
  //                             det. Det er dét, der skjuler knappen:
  //                             der er ikke noget at sige op.
  //  · `opsagt`               — er det HENDES opsigelse, og er den
  //                             bekraeftet? Kun den maa hedde «Opsagt».
  //  · `opsigelseUndervejs`   — hun har bedt om det, Stripe har ikke
  //                             bekraeftet det. Knappen bliver.
  // ── ET DOEDT ABONNEMENT FORNYES HELLER IKKE ─────────────
  // Afstemningens doedsvagt rydder skylden, naar Stripe selv siger,
  // at abonnementet er lukket — og det er rigtigt: sluttilstanden ER
  // naaet. Men `opsigelseUndervejs` havde intet led om, hvorvidt
  // abonnementet stadig lever, saa siden blev staaende og sagde
  // «Opsigelse undervejs … der kan blive trukket som normalt. Vi
  // proever automatisk igen», mens koeen var tom. Begge saetninger
  // var usande, og knappen stod for evigt.
  //
  // Det er N1's fejl spejlvendt: N1 lovede for MEGET om hendes penge
  // ud fra en beslutning alene; det her lovede for LIDT — og lovede
  // en automatik, der ikke fandtes. Samme svar som N1: udsagnet skal
  // hvile paa den bekraeftede sluttilstand, og et doedt abonnement
  // ER en bekraeftet sluttilstand.
  const afsluttet = (TERMINALE as readonly string[]).includes(a.status)
  const fornyesIkke = a.opsagt || afsluttet
  const opsagt = anmodet && fornyesIkke
  const opsigelseUndervejs = anmodet && !fornyesIkke

  const o = opsaetning()
  const f = o ? fase(a.pris, o) : null

  // NAESTE BETALING — fire udfald, ikke to.
  const naeste: Abonnementsbillede['naeste'] =
    fornyesIkke ? { slags: 'fornyes_ikke' }
    : opsigelseUndervejs ? { slags: 'opsigelse_undervejs' }
    : f === 'normal' ? { slags: 'beloeb', oere: NORMAL_OERE }
    // I introfasen er naeste traek 349 kr. UDELUKKENDE, fordi planen er
    // bekraeftet konfigureret. Er den det ikke, ved vi det ikke — og
    // saa siger vi det, i stedet for at gaette paa kundens penge.
    : f === 'intro' && a.planStatus === 'konfigureret'
      ? { slags: 'beloeb', oere: NORMAL_OERE }
    : { slags: 'ukendt' }

  return {
    status: a.status,
    fase: f,
    // ── OGSAA VORES EGET STOP SKAL VAERE BEKRAEFTET ──────
    // `fornyelse_stoppet_at` er nu VORES BESLUTNING, skrevet foer de
    // eksterne kald — samme regel som hendes opsigelse, og af samme
    // grund: uden et anker kunne en fejlet kaldsraekke ikke genoptages.
    // Men saa er feltet ikke laengere et bevis for, at fornyelsen ER
    // stoppet, og «Fornyelse stoppet» paa skaermen ville vaere N1's
    // fejl om igen — bare med os som forfatter i stedet for hende.
    //
    // Er stoppet besluttet og ikke bekraeftet, staar der ingenting
    // saerligt: abonnementet ER aktivt og fornyes, indtil vi naar
    // igennem. Det er en driftssag, ikke en besked til hende — hun
    // har ikke bedt om noget. Skylden staar i basen, og afstemningen
    // tager den.
    fornyelseStoppet: a.stoppet !== null && fornyesIkke,
    afsluttet,
    naeste,
    // Er opsigelsen kun ANMODET, staar fornyelsesdatoen stadig. Det er
    // sandt: Stripe har den bogfoert, indtil opsigelsen er bekraeftet,
    // og at skjule den ville vaere det samme loefte forfra.
    fornyesAt: fornyesIkke ? null : a.slut,
    opsagt,
    opsigelseUndervejs,
    fornyesIkke,
  }
}

/**
 * Hvilket tilbud gaelder for DEN HER konto?
 *
 * Boksene viste introprisen til alle, mens `startKoeb()` valgte
 * normalprisen for en konto, der allerede havde brugt tilbuddet. Det
 * er et forkert tal om kundens penge paa selve koebsskaermen.
 */
export async function gaeldendeTilbud(): Promise<'intro' | 'normal' | null> {
  const brugerId = await hentBrugerId()
  if (!brugerId) return 'intro'   // ikke logget ind: tilbuddet gaelder endnu
  const [u] = await db.select({ intro: users.introBrugtAt })
    .from(users).where(eq(users.id, brugerId)).limit(1)
  if (!u) return null
  return u.intro === null ? 'intro' : 'normal'
}

export type { Stripeopsaetning }
