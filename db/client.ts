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

/**
 * 'require' verificerer ikke certifikatkaeden — det er det, Supabase selv
 * anbefaler til pooleren. Vi slaar den kun fra, hvor den ikke giver mening.
 */
export function tlsFor(url: string): 'require' | false {
  const u = new URL(url)
  // postgres' egen konvention. Skrevet i strengen er det et valg, ikke et uheld.
  if (u.searchParams.get('sslmode') === 'disable') return false
  // Loopback gaar ikke over nettet. En lokal base har sjaeldent TLS, og
  // 'require' ville afvise den — det var praecis det, der spaerrede for at
  // koere proever et andet sted end i produktionen.
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) return false
  // Alt andet gaar over nettet. Der er en fjern base uden TLS en fejl,
  // ikke en konfiguration.
  return 'require'
}

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
  // Hoejlydt, ikke stille. Naar en testbase er indsat, er en forbindelse til
  // produktionen aldrig det, kalderen mente — og en stille forbindelse
  // hertil ville vaere netop den fejl, testbasen findes for at fjerne.
  if (_indsat) {
    throw new Error(
      'Rå postgres.js-forbindelse blev bedt om, mens testbasen er indsat. '
      + 'PGlite har ingen socket. Brug `db` (drizzle) eller `luk()`.',
    )
  }
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

    // TLS udledes af selve forbindelsen. Foer stod her 'require' fast, og
    // saa kunne ingen anden base end Supabase bruges — heller ikke en lokal
    // til proever. Reglen er streng i den rigtige retning: TLS fravaelges
    // KUN, naar strengen udtrykkeligt siger det, eller naar basen er
    // loopback og altsaa ikke gaar over nettet. Produktionens to URL'er er
    // hverken loopback eller `sslmode=disable`, saa de faar 'require' som
    // foer.
    ssl: tlsFor(forbindelse()),

    idle_timeout: iWebappen ? 20 : 120,
    max_lifetime: 60 * 30,
    connect_timeout: 10,

    onnotice: () => {},
  })
  return _sql
}

/**
 * En base UDEFRA — i praksis PGlite, rigtig Postgres i WASM, som proeverne
 * rejser i hukommelsen.
 *
 * Den indsaettes, den bygges ikke her. db/client.ts maa ikke importere
 * PGlite: modulet indlaeses af hver eneste side, og en WASM-motor i
 * klientbundtet er baade tung og meningsloes. Indsprojtningen holder
 * afhaengigheden hos den, der har brug for den — scripts/testbase.ts.
 *
 * Kun den kodevej, der udtrykkeligt kalder `indsaetBase`, kan taende den.
 * Samme greb som `tilladTestkilder` i adapters/index.ts, og af samme grund:
 * en spaerring, der hviler paa en miljoevariabel, nogen skal huske at
 * saette, er ingen spaerring.
 */
let _indsat: DrizzleDb | null = null
let _lukIndsat: (() => Promise<void>) | null = null
export function indsaetBase(d: DrizzleDb, lukning: () => Promise<void>) {
  _indsat = d
  _lukIndsat = lukning
}

let _db: DrizzleDb | null = null
function drizzleKlient(): DrizzleDb {
  if (_indsat) return _indsat
  if (!_db) _db = drizzle(klient(), { schema })
  return _db
}

/** Lukker det, der er aktivt — produktionens pool eller den indsatte base. */
export async function luk() {
  if (_lukIndsat) { await _lukIndsat(); return }
  if (_sql) await _sql.end()
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
