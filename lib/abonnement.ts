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

import { and, count, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { db, raekker } from '../db/client'
import type Stripe from 'stripe'
import { checkoutForsoeg, subscriptions, users } from '../db/schema'
import { hentBrugerId } from './auth'
import { NORMAL_OERE, fase, opsaetning, stripe, type Stripeopsaetning } from './stripe'

/** Statusser, hvor abonnementet stadig lever hos Stripe. */
export const LEVENDE = [
  'trialing', 'active', 'past_due', 'incomplete', 'paused', 'unpaid',
] as const

export type Koebssvar =
  | { ok: true; url: string }
  | { ok: false; fejl: 'gratis_tilstand' | 'ikke_logget_ind' | 'stripe_mangler'
      | 'har_allerede' | 'koeb_i_gang' | 'stripe_fejlede' }

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

      // Udloebne reservationer lukkes, saa et nyt forsoeg kan laves.
      await tx.update(checkoutForsoeg)
        .set({ status: 'udloebet', lukketAt: new Date() })
        .where(and(
          eq(checkoutForsoeg.userId, brugerId),
          eq(checkoutForsoeg.status, 'aaben'),
          lt(checkoutForsoeg.udloeberAt, new Date()),
        ))

      const [aaben] = await tx.select({
        id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
      }).from(checkoutForsoeg)
        .where(and(eq(checkoutForsoeg.userId, brugerId), eq(checkoutForsoeg.status, 'aaben')))
        .limit(1)
      if (aaben) throw new Koebsfejl('aaben_findes', aaben.id, aaben.sid)

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
        if (svar.slags === 'lukket' && foersteForsoeg) {
          return startKoebFor(brugerId, retur, false)
        }
        // · vi kunne ikke faa svar fra Stripe → raekken staar aaben, og
        //   vi paastaar ingenting om den.
        return { ok: false, fejl: 'koeb_i_gang' }
      }
      return { ok: false, fejl: e.slags }
    }
    // Det delvise indeks `checkout_en_aaben_pr_bruger` afviste
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
type Koebsfejlslags = 'gratis_tilstand' | 'har_allerede' | 'ikke_logget_ind' | 'aaben_findes'
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
  /** Sessionen er ubetalbar, og raekken er lukket. Der kan begyndes forfra. */
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
    const sess = await stripe(o).checkout.sessions.retrieve(sessionId) as
      { status?: string; url?: string } | null
    if (sess?.status === 'open' && sess.url) {
      await db.update(checkoutForsoeg).set({ stripeStatus: 'open' })
        .where(eq(checkoutForsoeg.id, forsoegId))
      return { slags: 'url', url: sess.url }
    }
    if (sess?.status && sess.status !== 'open') {
      await db.update(checkoutForsoeg)
        .set({ status: sess.status === 'complete' ? 'betalt' : 'udloebet',
               stripeStatus: sess.status, lukketAt: new Date() })
        .where(eq(checkoutForsoeg.id, forsoegId))
      return { slags: 'lukket' }
    }
    return { slags: 'uafklaret' }
  } catch {
    // Ukendt. Forsoeget bliver staaende AABENT.
    return { slags: 'uafklaret' }
  }
}

/**
 * Sessionen blev oprettet, men reservationen naaede at blive lukket
 * under os. Den skal udloebes hos Stripe — ellers kan den betales.
 *
 * LYKKES lukningen ikke, saettes raekken TILBAGE til `aaben` med
 * sessionsnummeret paa. Det ser bagvendt ud, og det er med vilje:
 * bogfoerer vi den som lukket, forsvinder den betalbare session ud af
 * hver eneste opgoerelse, og gratis-skiftet ville melde alt klar. En
 * aaben raekke er den eneste maade, naeste afstemning kan se den paa.
 */
async function opgivSession(o: Stripeopsaetning, forsoegId: string, sessionId: string) {
  try {
    await stripe(o).checkout.sessions.expire(sessionId)
    await db.update(checkoutForsoeg)
      .set({ stripeSessionId: sessionId, stripeStatus: 'expired',
             status: 'afbrudt', lukketAt: new Date() })
      .where(eq(checkoutForsoeg.id, forsoegId))
  } catch (e) {
    await db.update(checkoutForsoeg)
      .set({ stripeSessionId: sessionId, stripeStatus: 'open',
             status: 'aaben', lukketAt: null,
             lukkeFejl: (e as Error).message.slice(0, 300),
             lukkeForsoeg: sql`${checkoutForsoeg.lukkeForsoeg} + 1` })
      .where(eq(checkoutForsoeg.id, forsoegId))
  }
}

/** Hvor mange paabegyndte betalinger staar stadig aabne? */
export async function aabneKoeb(): Promise<number> {
  const [r] = await db.select({ n: count() })
    .from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben'))
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
  lukkede: number; uafklarede: number; detaljer: string[]
}> {
  const o = opsaetning()
  const aabne = await udf.select({
    id: checkoutForsoeg.id, sid: checkoutForsoeg.stripeSessionId,
  }).from(checkoutForsoeg).where(eq(checkoutForsoeg.status, 'aaben'))
  if (!aabne.length) return { lukkede: 0, uafklarede: 0, detaljer: [] }

  if (!o) {
    // INGEN opsaetning = intet kald = ingen bekraeftet lukning.
    // Foer talte de som lukkede uden at Stripe var spurgt.
    return {
      lukkede: 0, uafklarede: aabne.length,
      detaljer: ['Stripe er ikke konfigureret, så sessionerne kan ikke lukkes.'],
    }
  }
  const s = stripe(o)
  let lukkede = 0
  const detaljer: string[] = []
  for (const a of aabne) {
    if (!a.sid) {
      // Reserveret, men ingen session naaede at blive oprettet.
      await udf.update(checkoutForsoeg)
        .set({ status: 'afbrudt', lukketAt: new Date() })
        .where(eq(checkoutForsoeg.id, a.id))
      lukkede++; continue
    }
    try {
      const sess = await s.checkout.sessions.retrieve(a.sid) as { status?: string } | null
      if (sess?.status && sess.status !== 'open') {
        // Allerede ubetalbar — ikke en fejl.
        await udf.update(checkoutForsoeg)
          .set({ status: sess.status === 'complete' ? 'betalt' : 'udloebet',
                 stripeStatus: sess.status, lukketAt: new Date() })
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
  return { lukkede, uafklarede: aabne.length - lukkede, detaljer }
}

export type Opsigelsessvar =
  | { ok: true; adgangTil: Date | null }
  | { ok: false; fejl: 'ikke_logget_ind' | 'intet_abonnement' | 'stripe_mangler' | 'stripe_fejlede' }

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

  try {
    const s = stripe(o)
    if (a.plan) {
      // ── OPSIGELSE MED EN AKTIV PLAN ────────────────────────
      // Styres abonnementet af en SubscriptionSchedule, er det planen,
      // der bestemmer faserne. Sætter man `cancel_at_period_end` direkte
      // paa abonnementet, kan planen skrive det om ved naeste faseskift
      // — og kunden blive traekt igen, efter hun sagde op. Derfor
      // slippes planen FOERST; derefter er abonnementet sit eget, og
      // opsigelsen bider.
      //
      // `release` afslutter planen UDEN at opsige abonnementet — det er
      // netop pointen: den allerede betalte periode skal loebe ud.
      // IKKE `cancel`, som ville afslutte abonnementet med det samme og
      // tage en periode, kunden har betalt for.
      await s.subscriptionSchedules.release(a.plan)
      await db.update(subscriptions)
        .set({ stripeScheduleId: null, planStatus: null })
        .where(eq(subscriptions.stripeSubscriptionId, a.stripeId))
    }
    await s.subscriptions.update(a.stripeId, { cancel_at_period_end: true })
  } catch {
    return { ok: false, fejl: 'stripe_fejlede' }
  }
  // Vi skriver flaget her OG spejler det igen fra webhooken. Uden det
  // foerste ville siden vise «fornyes» lige efter, hun sagde op.
  await db.update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, a.stripeId))
  return { ok: true, adgangTil: a.adgang }
}

export interface Abonnementsbillede {
  status: string
  fase: 'intro' | 'normal' | null
  /**
   * `{ slags: 'beloeb' }` · vi ved hvad der traekkes
   * `{ slags: 'fornyes_ikke' }` · opsagt — der kommer ingen betaling
   * `{ slags: 'ukendt' }` · vi kan IKKE bekraefte naeste betaling
   *
   * De to sidste maa aldrig smelte sammen. `null` betoed foer begge
   * dele, og «fornyes ikke» blev vist til en kunde, hvis plan bare ikke
   * var bekraeftet — altsaa et loefte om ingen betaling, vi ikke kunne
   * holde.
   */
  naeste: { slags: 'beloeb'; oere: number } | { slags: 'fornyes_ikke' } | { slags: 'ukendt' }
  fornyesAt: Date | null
  adgangTil: Date | null
  opsagt: boolean
}

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

  const o = opsaetning()
  const f = o ? fase(a.pris, o) : null

  // NAESTE BETALING — tre udfald, ikke to.
  const naeste: Abonnementsbillede['naeste'] =
    a.opsagt ? { slags: 'fornyes_ikke' }
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
    naeste,
    fornyesAt: a.opsagt ? null : a.slut,
    adgangTil: a.adgang,
    opsagt: a.opsagt,
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
