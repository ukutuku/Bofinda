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
// ═══════════════════════════════════════════════════════════════

export interface Kald { metode: string; args: unknown[] }

export interface Falsk {
  kald: Kald[]
  /** Naeste kald til `metode` kaster. Sat af proeven. */
  fejlPaa: Set<string>
  planer: Map<string, { id: string; phases: unknown[]; konfigureret: boolean }>
  sessioner: Map<string, { id: string; url: string; status: string }>
  abonnementer: Map<string, { id: string; cancel_at_period_end?: boolean; schedule?: string }>
  nulstil: () => void
  sidste: (metode: string) => Kald | undefined
  antal: (metode: string) => number
}

export function lavFalsk(): Falsk & Record<string, unknown> {
  const kald: Kald[] = []
  const fejlPaa = new Set<string>()
  const planer = new Map<string, { id: string; phases: unknown[]; konfigureret: boolean }>()
  const sessioner = new Map<string, { id: string; url: string; status: string }>()
  const abonnementer = new Map<string, { id: string; cancel_at_period_end?: boolean; schedule?: string }>()
  let n = 0

  const log = (metode: string, ...args: unknown[]) => {
    kald.push({ metode, args })
    if (fejlPaa.has(metode)) {
      fejlPaa.delete(metode)
      throw new Error(`falsk stripe: ${metode} fejlede med vilje`)
    }
  }

  const f = {
    kald, fejlPaa, planer, sessioner, abonnementer,
    nulstil: () => { kald.length = 0; fejlPaa.clear() },
    sidste: (m: string) => [...kald].reverse().find((k) => k.metode === m),
    antal: (m: string) => kald.filter((k) => k.metode === m).length,

    customers: {
      create: async (p: unknown, o?: unknown) => {
        log('customers.create', p, o)
        return { id: `cus_falsk_${++n}` }
      },
    },
    checkout: {
      sessions: {
        create: async (p: unknown, o?: unknown) => {
          log('checkout.sessions.create', p, o)
          const id = `cs_falsk_${++n}`
          const s = { id, url: `https://falsk.invalid/${id}`, status: 'open' }
          sessioner.set(id, s)
          return s
        },
        retrieve: async (id: string) => {
          log('checkout.sessions.retrieve', id)
          return sessioner.get(id) ?? null
        },
        expire: async (id: string) => {
          log('checkout.sessions.expire', id)
          const s = sessioner.get(id)
          if (s) s.status = 'expired'
          return s
        },
      },
    },
    subscriptions: {
      update: async (id: string, p: unknown) => {
        log('subscriptions.update', id, p)
        const a = abonnementer.get(id) ?? { id }
        Object.assign(a, p)
        abonnementer.set(id, a)
        return a
      },
      cancel: async (id: string) => { log('subscriptions.cancel', id); return { id, status: 'canceled' } },
      retrieve: async (id: string) => { log('subscriptions.retrieve', id); return abonnementer.get(id) ?? { id } },
    },
    subscriptionSchedules: {
      create: async (p: unknown, o?: unknown) => {
        log('subscriptionSchedules.create', p, o)
        const id = `sub_sched_falsk_${++n}`
        // Som Stripe: en plan lavet `from_subscription` har ÉN fase,
        // der spejler abonnementet — med start og slut allerede sat.
        const plan = {
          id, konfigureret: false,
          phases: [{ start_date: 1_700_000_000, end_date: 1_700_086_400, items: [{ price: 'intro' }] }],
        }
        planer.set(id, plan)
        return plan
      },
      update: async (id: string, p: { phases?: unknown[] }) => {
        log('subscriptionSchedules.update', id, p)
        const plan = planer.get(id)
        if (plan && p.phases) { plan.phases = p.phases; plan.konfigureret = true }
        return plan
      },
      retrieve: async (id: string) => { log('subscriptionSchedules.retrieve', id); return planer.get(id) ?? null },
      release: async (id: string) => { log('subscriptionSchedules.release', id); return planer.get(id) ?? null },
    },
    webhooks: {
      constructEvent: (raa: string) => { log('webhooks.constructEvent'); return JSON.parse(raa) },
    },
  }
  return f as unknown as Falsk & Record<string, unknown>
}
