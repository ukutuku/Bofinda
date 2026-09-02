// ═══════════════════════════════════════════════════════════════
//  Databaseklient — Supabase Postgres.
//
//  To kaldere, to profiler:
//
//    Frontend  Vercel, serverless. Mange kortlivede processer, hver med
//              sin egen pool. Gaar gennem Supavisor i TRANSACTION mode
//              (port 6543). Pool paa 1, prepared statements slaaet fra.
//    Worker    Railway, én lang proces. Gaar paa session/direct (port
//              5432). Pool paa 10, prepared statements slaaet til.
//
//  Applikationslags-pooling loeser ikke serverless: hver lambda har sin
//  egen pool. Poolen skal ligge uden for processerne — det er derfor
//  frontenden skal gennem Supavisor og ikke paa direct.
// ═══════════════════════════════════════════════════════════════

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

/**
 * Webappen skal ALTID gennem transaction-pooleren, ogsaa lokalt.
 *
 * Foer valgte den paa `VERCEL`, som ikke er sat lokalt — saa tog `next dev`
 * worker-profilen med ti forbindelser paa SESSION-pooleren, samtidig med at
 * workeren tog ti. Supabases session-pool er 15, og siden faldt med
 * MAX_CLIENTS_REACHED. `NEXT_RUNTIME` saettes af Next selv i alle
 * servermiljoeer, saa den skelner rigtigt baade lokalt og paa Vercel.
 */
const iWebappen = Boolean(process.env.NEXT_RUNTIME || process.env.VERCEL)

function forbindelse() {
  const url = iWebappen
    ? process.env.DATABASE_URL          // Supavisor transaction pooler, :6543
    : process.env.DATABASE_URL_DIRECT   // session pooler eller direct, :5432
  if (!url) {
    throw new Error(
      iWebappen
        ? 'DATABASE_URL mangler (Supabase transaction pooler, port 6543)'
        : 'DATABASE_URL_DIRECT mangler (Supabase session/direct, port 5432)',
    )
  }
  // ?pgbouncer=true er Prismas flag for at slaa prepared statements fra.
  // postgres.js kender det ikke og ville sende det videre som en
  // startup-parameter til serveren. Hos os er mekanismen prepare: false
  // nedenfor, saa parameteren fjernes her.
  const parsed = new URL(url)
  parsed.searchParams.delete('pgbouncer')
  return parsed.toString()
}

/**
 * Klienten oprettes ved FOERSTE BRUG, ikke ved modulindlaesning.
 *
 * Next importerer hver sides modul under `next build` for at samle
 * konfiguration. Blev klienten oprettet paa modulniveau, kraevede et
 * sidebyg en gyldig forbindelsesstreng — og Railway-bygget faldt med
 * "DATABASE_URL mangler", selv om servicen kun koerer importoeren og
 * aldrig rammer webappen. Et byg skal kunne lykkes uden en database.
 */
let _sql: Sql | null = null
function klient(): Sql {
  if (_sql) return _sql
  _sql = postgres(forbindelse(), {
    // Workeren: konservativt. Den gaar paa SESSION-pooleren, som kun har
    // 15 pladser i alt og deles med migrationer og ad hoc-forespoergsler.
    // Se README, "Forbindelsesbudget".
    //
    // Webappen: fem. Den gaar gennem Supavisor i TRANSACTION mode, hvor
    // klientforbindelser multiplexes ned paa faerre serverforbindelser —
    // det er ikke session-poolerens 15 pladser, den bruger.
    //
    // Den stod paa 1, og det var for lidt. Med én forbindelse serialiseres
    // ALT i en lambda-instans: sidens egne forespoergsler, og de samtidige
    // requests instansen betjener. Lokalt hang hver listeside i minutter,
    // og i produktionen gav det 504 FUNCTION_INVOCATION_TIMEOUT.
    max: 5,

    // Transaction mode kan ikke haandtere prepared statements: naeste
    // transaktion lander maaske paa en anden server-forbindelse, og den
    // fejler med "prepared statement does not exist" — typisk foerst under
    // belastning. Session/direct beholder dem, de er hurtigere.
    prepare: !iWebappen,

    // Supabase kraever TLS. 'require' verificerer ikke certifikatkaeden,
    // hvilket er det Supabase selv anbefaler til pooleren.
    ssl: 'require',

    idle_timeout: iWebappen ? 20 : 120,
    max_lifetime: 60 * 30,
    connect_timeout: 10,

    onnotice: () => {},
  })
  return _sql
}

let _db: DrizzleDb | null = null
function drizzleKlient(): DrizzleDb {
  if (!_db) _db = drizzle(klient(), { schema })
  return _db
}

/** Metoder skal bindes til den rigtige instans, ikke til stedfortraederen. */
function stedfortraeder<T extends object>(hent: () => T, maal: object): T {
  return new Proxy(maal as T, {
    apply: (_m, _this, args) => (hent() as unknown as (...a: unknown[]) => unknown)(...args),
    get: (_m, n) => {
      const i = hent()
      const v = (i as Record<string | symbol, unknown>)[n]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(i) : v
    },
  })
}

// `sql` bruges baade som skabelontag og som objekt (sql.end, sql.unsafe),
// saa stedfortraederens maal skal vaere en funktion.
export const sql: Sql = stedfortraeder(klient, function () {})
export const db: DrizzleDb = stedfortraeder(drizzleKlient, {})
