// ═══════════════════════════════════════════════════════════════
//  En kontrolleret Stripe-ERSTATNING. Intet netvaerk.
//
//  Den efterligner kun det, vores kode faktisk kalder, og den
//  REGISTRERER hvert kald med sine argumenter, saa proeven kan maale
//  HVAD der blev sendt — ikke bare at en funktion blev ramt.
//
//  Den er ikke Stripe. Den kan ikke bevise, at Stripe accepterer vores
//  argumenter; det kraever sandbox. Den beviser, at VORES kode kalder
//  det, vi siger den kalder, i den raekkefoelge vi siger — og at den
//  opfoerer sig rigtigt, naar kaldet fejler.
//
//  ── TO STEDER HAANDHAEVER DEN STRIPES EGEN DOKUMENTEREDE ADFAERD ──
//
//  1 · IDEMPOTENSNOEGLER. Stripe gemmer resultatet af et kald med en
//      `Idempotency-Key` i mindst 24 timer.
//        · samme noegle + SAMME parametre → det FOERSTE svar afspilles;
//          handlingen udfoeres ikke igen
//        · samme noegle + ANDRE parametre → fejl, ikke et nyt svar
//        · og RESULTATET KAN VAERE EN FEJL. Stripe gemmer ogsaa et
//          HTTP 500-svar, naar udfoerelsen er paabegyndt. En
//          valideringsfejl FOER udfoerelse er en anden situation og
//          gemmes ikke. Attrappen skelner de to med `fejlPaa`
//          (foer udfoerelse) og `gemtFejlPaa` (ukendt udfald).
//      Netop den anden regel var det, der vaeltede genstarten af et
//      koeb, da noeglen var `koeb:<bruger>:<pristype>`: en ny session
//      efter en udloebet havde et nyt `expires_at`, altsaa andre
//      parametre, og Stripe ville have afvist den. Uden at erstatningen
//      haandhaever reglen, kan proeven ikke se forskel paa en noegle,
//      der virker, og en der ikke goer.
//
//  2 · FASERNES TIDSPUNKTER. Stripe UDREGNER `start_date`/`end_date`
//      paa de faser, man sender med en `duration`, og en fase begynder,
//      hvor den foregaaende slipper. Sendte erstatningen bare
//      parametrene retur, ville `planfejl()` maale sine egne
//      indputfelter i stedet for det, Stripe ville have svaret — og
//      kontrollen af tidsgraenserne ville ikke bevise noget.
// ═══════════════════════════════════════════════════════════════

export interface Kald {
  metode: string
  args: unknown[]
  /** Kaldet blev IKKE udfoert: svaret kom fra idempotensnoeglen. */
  afspillet?: boolean
}

interface Vare { price?: unknown; quantity?: unknown }
interface Fase {
  items?: Vare[]
  start_date?: number
  end_date?: number
  duration?: { interval?: string; interval_count?: number }
  trial?: boolean
  trial_end?: number
}
export interface Plan {
  id: string; phases: Fase[]; konfigureret: boolean; status: string
  /**
   * Abonnementet, planen styrer. Stripe FJERNER feltet ved `release`
   * og flytter id'et til `released_subscription`
   * (SubscriptionSchedules.d.ts:39, :104-116). Uden det i attrappen
   * kunne en proeve ikke skelne en gaeldende plan fra en sluppet — og
   * det var netop den skelnen, der manglede i koden.
   */
  subscription?: string | null
  released_subscription?: string | null
}
export interface Session {
  id: string; url: string; status: string; expires_at?: number
  /** Saettes naar kassen gennemfoeres. Stripes to akser, ikke én. */
  subscription?: string
  payment_status?: string
  /**
   * De to, vi selv sendte med ved oprettelsen. Stripe giver dem tilbage
   * paa en `retrieve`, og `afstemGennemfoerteKoeb` laeser dem netop
   * dér, naar webhooken aldrig kom. Uden dem i attrappen ville den
   * kodevej aldrig blive prøvet.
   */
  client_reference_id?: string
  customer?: string
}

export interface Falsk {
  kald: Kald[]
  /**
   * Naeste kald til `metode` afvises FOER udfoerelse. Intet gemmes
   * under noeglen, og et genforsoeg med samme noegle udfoerer paa ny.
   */
  fejlPaa: Set<string>
  /**
   * Naeste kald til `metode` giver 500 med UKENDT udfald. Svaret
   * GEMMES under noeglen; hver senere afspilning kaster det samme
   * uden at udfoere noget.
   */
  gemtFejlPaa: Set<string>
  planer: Map<string, Plan>
  sessioner: Map<string, Session>
  abonnementer: Map<string, { id: string; cancel_at_period_end?: boolean; schedule?: string }>
  /**
   * Noeglerne, Stripe ville have gemt. Proeven kan laese og toemme dem.
   * En post baerer ENTEN et svar ELLER en fejl — Stripe gemmer begge
   * dele, naar udfoerelsen er paabegyndt.
   */
  noegler: Map<string, { fingeraftryk: string; svar?: unknown; fejl?: Error }>
  nulstil: () => void
  sidste: (metode: string) => Kald | undefined
  antal: (metode: string) => number
  /** Kald, der faktisk blev UDFOERT — ikke afspillet fra en noegle. */
  udfoerte: (metode: string) => number
}

/** Stripes egen fejl, naar en noegle genbruges med andre parametre. */
export class Idempotensfejl extends Error {
  readonly type = 'idempotency_error'
  readonly statusCode = 400
  constructor(noegle: string) {
    super(
      'Keys for idempotent requests can only be used with the same parameters '
      + `they were first used with. Key: ${noegle}`,
    )
  }
}

/**
 * En fejl, Stripe afviste FOER udfoerelsen — en valideringsfejl.
 *
 * Intet skete. Svaret gemmes IKKE under idempotensnoeglen, og et
 * genforsoeg med samme noegle udfoerer paa ny.
 * SDK'ens modstykke: `StripeInvalidRequestError`, `type:
 * 'invalid_request_error'` (Error.d.ts:104).
 */
export class FoerUdfoerelseFejl extends Error {
  readonly type = 'invalid_request_error'
  readonly statusCode = 400
  constructor(metode: string) {
    super(`falsk stripe: ${metode} afvist foer udfoerelse (validering)`)
  }
}

/**
 * En fejl med UKENDT udfald — udfoerelsen kan vaere paabegyndt.
 *
 * Her stod attrappen tidligere og paastod i sin egen kommentar, at
 * «et kald, der fejlede, gemmes IKKE paa noeglen — Stripe gemmer kun
 * et svar, der blev til noget». Det holder ikke: Stripe gemmer ogsaa
 * et HTTP 500-svar, naar udfoerelsen er startet, og hver senere
 * afspilning af noeglen giver den samme fejl uden at udfoere noget.
 * En kalder, der bare proever igen med samme noegle, kommer derfor
 * aldrig videre — og en kalder, der BLINDT skifter noegle, kan oprette
 * det samme to gange.
 *
 * SDK'ens modstykke: `StripeAPIError`, `type: 'api_error'`
 * (Error.d.ts:113).
 */
export class UkendtUdfaldFejl extends Error {
  readonly type = 'api_error'
  readonly statusCode = 500
  constructor(metode: string) {
    super(`falsk stripe: ${metode} gav 500 — udfoerelsen kan vaere paabegyndt`)
  }
}

/** Sekunder i en `duration`. Kun de intervaller, modellen bruger. */
function varighed(d: Fase['duration']): number | null {
  if (!d || typeof d.interval !== 'string') return null
  const n = typeof d.interval_count === 'number' ? d.interval_count : 1
  const sek: Record<string, number> = {
    day: 86400, week: 604800, month: 2592000, year: 31536000,
  }
  const e = sek[d.interval]
  return e === undefined ? null : e * n
}

export function lavFalsk(): Falsk & Record<string, unknown> {
  const kald: Kald[] = []
  const fejlPaa = new Set<string>()
  const gemtFejlPaa = new Set<string>()
  const planer = new Map<string, Plan>()
  const sessioner = new Map<string, Session>()
  const abonnementer = new Map<string, { id: string; cancel_at_period_end?: boolean; schedule?: string }>()
  const noegler = new Map<string, { fingeraftryk: string; svar?: unknown; fejl?: Error }>()
  let n = 0

  const noegleAf = (o: unknown): string | null => {
    const k = (o as { idempotencyKey?: unknown } | undefined)?.idempotencyKey
    return typeof k === 'string' && k ? k : null
  }

  /**
   * Ét kald gennem baade logbogen, den villede fejl og
   * idempotensnoeglen. Rækkefølgen er Stripes: noeglen slaas op FOER
   * handlingen, saa en afspilning ikke laver noget nyt.
   */
  async function gennem<T>(
    metode: string, params: unknown[], opts: unknown, udfoer: () => T,
  ): Promise<T> {
    // Logbogen baerer BAADE parametre og indstillinger, saa proeven kan
    // laese idempotensnoeglen af kaldet. Fingeraftrykket regnes derimod
    // KUN paa parametrene: noeglen er ikke en parameter, den er
    // opslaget.
    const args = [...params, opts]
    const noegle = noegleAf(opts)
    if (noegle) {
      const kendt = noegler.get(noegle)
      const aftryk = JSON.stringify(params)
      if (kendt) {
        kald.push({ metode, args, afspillet: true })
        if (kendt.fingeraftryk !== aftryk) throw new Idempotensfejl(noegle)
        // Gemt FEJL afspilles som fejl. Det er hele pointen: noeglen er
        // braendt, og et genforsoeg paa den kommer aldrig videre.
        if (kendt.fejl) throw kendt.fejl
        // Stripe afspiller et GEMT snapshot. Det er ikke en levende
        // reference til noget, der kan naa at aendre sig.
        return oejebliksbillede(kendt.svar) as T
      }
      kald.push({ metode, args })
      if (fejlPaa.has(metode)) {
        fejlPaa.delete(metode)
        // FOER UDFOERELSE. Intet skete, og intet gemmes paa noeglen.
        // Et genforsoeg med samme noegle udfoerer paa ny.
        throw new FoerUdfoerelseFejl(metode)
      }
      if (gemtFejlPaa.has(metode)) {
        gemtFejlPaa.delete(metode)
        // UDFOERELSEN BLEV PAABEGYNDT, og Stripe gemte sin 500 under
        // noeglen. Den bliver liggende: hver senere afspilning giver
        // den samme fejl UDEN at udfoere noget.
        const f = new UkendtUdfaldFejl(metode)
        noegler.set(noegle, { fingeraftryk: aftryk, fejl: f })
        throw f
      }
      const svar = udfoer()
      noegler.set(noegle, { fingeraftryk: aftryk, svar })
      return oejebliksbillede(svar)
    }
    kald.push({ metode, args })
    if (fejlPaa.has(metode)) {
      fejlPaa.delete(metode)
      throw new FoerUdfoerelseFejl(metode)
    }
    if (gemtFejlPaa.has(metode)) {
      gemtFejlPaa.delete(metode)
      throw new UkendtUdfaldFejl(metode)
    }
    return oejebliksbillede(udfoer())
  }

  const f: Falsk & Record<string, unknown> = {
    kald, fejlPaa, gemtFejlPaa, planer, sessioner, abonnementer, noegler,
    // ── NULSTIL BETYDER NULSTIL ──────────────────────────────
    // Foer ryddede den kun `kald`, `fejlPaa`, `gemtFejlPaa` og
    // `noegler` — men ikke sessionerne, planerne og abonnementerne.
    // Et afsnit, der taeller «hvor mange sessioner er aabne hos
    // Stripe», maalte derfor ogsaa de foregaaende afsnits, og ét
    // afsnit kompenserede ad hoc med et eksplicit
    // `falsk.sessioner.clear()`. En attrap, hvis `nulstil` ikke
    // nulstiller, er en faelde, der venter paa naeste proeve.
    nulstil: () => {
      kald.length = 0; fejlPaa.clear(); gemtFejlPaa.clear(); noegler.clear()
      sessioner.clear(); planer.clear(); abonnementer.clear()
    },
    sidste: (m: string) => [...kald].reverse().find((k) => k.metode === m),
    antal: (m: string) => kald.filter((k) => k.metode === m).length,
    udfoerte: (m: string) => kald.filter((k) => k.metode === m && !k.afspillet).length,

    customers: {
      create: (p: unknown, o?: unknown) =>
        gennem('customers.create', [p], o, () => ({ id: `cus_falsk_${++n}` })),
    },
    checkout: {
      sessions: {
        create: (p: unknown, o?: unknown) =>
          gennem('checkout.sessions.create', [p], o, () => {
            const id = `cs_falsk_${++n}`
            const par = p as {
              expires_at?: number; client_reference_id?: string; customer?: string
            } | undefined
            const s: Session = {
              id, url: `https://falsk.invalid/${id}`, status: 'open',
              expires_at: par?.expires_at,
              client_reference_id: par?.client_reference_id,
              customer: par?.customer,
            }
            sessioner.set(id, s)
            return s
          }),
        retrieve: (id: string) =>
          gennem('checkout.sessions.retrieve', [id], undefined, () => {
            const s = sessioner.get(id)
            if (!s) return null
            // Stripe udloeber selv en session paa dens `expires_at`.
            // Uden det her ville attrappen svare `open` for evigt, og
            // en proeve, der flytter uret frem, ville maale noget,
            // Stripe aldrig ville have svaret.
            if (s.status === 'open' && s.expires_at !== undefined
                && s.expires_at * 1000 <= Date.now()) {
              s.status = 'expired'
            }
            return s
          }),
        expire: (id: string) =>
          gennem('checkout.sessions.expire', [id], undefined, () => {
            const s = sessioner.get(id)
            if (s) s.status = 'expired'
            return s ?? null
          }),
      },
    },
    subscriptions: {
      update: (id: string, p: unknown) =>
        gennem('subscriptions.update', [id, p], undefined, () => {
          const a = abonnementer.get(id) ?? { id }
          Object.assign(a, p)
          abonnementer.set(id, a)
          return a
        }),
      cancel: (id: string) =>
        gennem('subscriptions.cancel', [id], undefined, () => ({ id, status: 'canceled' })),
      retrieve: (id: string) =>
        gennem('subscriptions.retrieve', [id], undefined, () => abonnementer.get(id) ?? { id }),
    },
    subscriptionSchedules: {
      create: (p: unknown, o?: unknown) =>
        gennem('subscriptionSchedules.create', [p], o, () => {
          // ── STRIPES EGEN REGEL: ÉN PLAN PR. ABONNEMENT ──────
          // `from_subscription` paa et abonnement, der allerede har et
          // schedule, afvises af Stripe. Attrappen tog FOER imod og
          // overskrev bare `a.schedule` — og saa kunne en proeve vaere
          // groen om et forloeb, Stripe ville have sagt nej til.
          //
          // Det blev vigtigt i runde 8: `laegPlan` opretter nu, naar
          // KILDEN siger, at ingen plan styrer abonnementet. Svarer
          // kilden forkert ét oejeblik, er det her nej den sidste
          // spaerring mod plan nummer to — og saa skal attrappen have
          // den, ellers maaler proeverne en anden verden.
          const paa = (p as { from_subscription?: unknown } | undefined)?.from_subscription
          if (typeof paa === 'string' && abonnementer.get(paa)?.schedule) {
            throw new FoerUdfoerelseFejl(
              `falsk stripe: abonnementet ${paa} har allerede en plan`)
          }
          const id = `sub_sched_falsk_${++n}`
          // Som Stripe: en plan lavet `from_subscription` har ÉN fase,
          // der spejler abonnementet — med start og slut allerede sat.
          // De 86.400 sekunder er introprisens eget doegn.
          const sub = (p as { from_subscription?: unknown } | undefined)?.from_subscription
          const plan: Plan = {
            id, konfigureret: false, status: 'active',
            subscription: typeof sub === 'string' ? sub : null,
            released_subscription: null,
            phases: [{
              start_date: PLANSTART, end_date: PLANSTART + 86400,
              items: [{ price: 'intro', quantity: 1 }],
            }],
          }
          planer.set(id, plan)
          // Abonnementet kender sin egen plan hos Stripe. `laegPlan`
          // og opsigelsen afstemmer netop paa det felt.
          if (typeof sub === 'string') {
            const a = abonnementer.get(sub) ?? { id: sub }
            a.schedule = id
            abonnementer.set(sub, a)
          }
          return plan
        }),
      update: (id: string, p: { phases?: Fase[] }) =>
        gennem('subscriptionSchedules.update', [id, p], undefined, () => {
          const plan = planer.get(id)
          // En frigivet plan kan ikke aendres. Samme grund som ved
          // release: en attrap, der tager imod, maaler en anden verden.
          if (plan && plan.status !== 'active' && plan.status !== 'not_started') {
            throw new FoerUdfoerelseFejl(
              `falsk stripe: kan ikke aendre en plan i status ${plan.status}`)
          }
          if (plan && Array.isArray(p.phases)) {
            plan.phases = udregnFaser(p.phases, plan.phases[0]?.start_date ?? PLANSTART)
            plan.konfigureret = true
          }
          return plan ?? null
        }),
      retrieve: (id: string) =>
        gennem('subscriptionSchedules.retrieve', [id], undefined, () => planer.get(id) ?? null),
      release: (id: string) =>
        gennem('subscriptionSchedules.release', [id], undefined, () => {
          const plan = planer.get(id)
          if (!plan) return null
          // ── STRIPES EGEN REGEL, HAANDHAEVET ─────────────────
          // «A schedule can only be released if its status is
          // not_started or active» (SubscriptionSchedules.d.ts:39).
          // Attrappen tog FOER imod et release paa hvad som helst, og
          // saa kunne en proeve vaere groen om et forloeb, Stripe ville
          // have afvist. Det var praecis den forskel, der skjulte, at
          // opsigelsen sad fast paa sit eget genforsoeg.
          if (plan.status !== 'active' && plan.status !== 'not_started') {
            throw new FoerUdfoerelseFejl(
              `falsk stripe: kan ikke release en plan i status ${plan.status}`)
          }
          plan.status = 'released'
          // Og planen slipper abonnementet — som hos Stripe.
          if (plan.subscription) {
            const a = abonnementer.get(plan.subscription)
            if (a) a.schedule = undefined
            plan.released_subscription = plan.subscription
            plan.subscription = null
          }
          return plan
        }),
    },
    webhooks: {
      constructEvent: (raa: string) => {
        kald.push({ metode: 'webhooks.constructEvent', args: [] })
        if (fejlPaa.has('webhooks.constructEvent')) {
          fejlPaa.delete('webhooks.constructEvent')
          throw new Error('falsk stripe: ugyldig signatur')
        }
        return JSON.parse(raa)
      },
    },
  }
  return f
}

/**
 * ET SVAR ER ET OEJEBLIKSBILLEDE, IKKE EN LEVENDE REFERENCE.
 *
 * Bruges paa ALLE tre veje ud af `gennem()` — afspilning fra en
 * idempotensnoegle, udfoerelse med noegle og udfoerelse uden. Stripe
 * giver aldrig en levende reference tilbage, heller ikke naar den
 * afspiller et gemt svar.
 *
 * Attrappen gav foer den SAMME muterbare genstand tilbage, som et
 * senere `release` bagefter aendrede. Et rigtigt HTTP-svar aendrer sig
 * ikke, fordi en anden HTTP-anmodning bliver behandlet — og forskellen
 * er ikke akademisk: den skjulte, at to samtidige opsigelser begge kan
 * have laest `status: active`, foer den foerste slap planen. Den anden
 * faar saa et nej fra Stripe, som ikke er en fejl, men et tabt kaploeb.
 *
 * En attrap, der er mildere end virkeligheden, goer proever groenne om
 * forloeb, der ville fejle. Den her er strengere, og det er meningen.
 */
const oejebliksbillede = <T>(v: T): T =>
  v === null || typeof v !== 'object' ? v : structuredClone(v)

/** Fast starttidspunkt, saa proeverne er deterministiske. */
export const PLANSTART = 1_700_000_000

/**
 * Det Stripe goer ved `phases`, og som en ren ekko-attrap ikke goer:
 * hver fase faar konkrete tidspunkter. Fase 1 beholder sine egne, hvis
 * de er sendt med; ellers begynder den, hvor planen begyndte. De
 * oevrige begynder, hvor den foregaaende slipper, og slutter efter
 * deres `duration` — har de ingen, er de AABNE og faar ingen `end_date`.
 */
function udregnFaser(sendte: Fase[], planstart: number): Fase[] {
  const ud: Fase[] = []
  let markoer = planstart
  for (const f of sendte) {
    const start = typeof f.start_date === 'number' ? f.start_date : markoer
    const v = varighed(f.duration)
    const slut = typeof f.end_date === 'number' ? f.end_date
      : v === null ? undefined : start + v
    const fase: Fase = {
      ...f,
      items: (f.items ?? []).map((v2) => ({
        price: v2.price,
        // Stripes standard, naar `quantity` udelades paa en licenspris.
        quantity: v2.quantity === undefined ? 1 : v2.quantity,
      })),
      start_date: start,
    }
    delete fase.duration
    if (slut === undefined) delete fase.end_date
    else fase.end_date = slut
    ud.push(fase)
    markoer = slut ?? start
  }
  return ud
}
