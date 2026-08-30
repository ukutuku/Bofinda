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
import postgres from 'postgres'
import * as schema from './schema'

const isServerless = Boolean(process.env.VERCEL)

function connectionString() {
  const url = isServerless
    ? process.env.DATABASE_URL          // Supavisor transaction pooler, :6543
    : process.env.DATABASE_URL_DIRECT   // session pooler eller direct, :5432
  if (!url) {
    throw new Error(
      isServerless
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

export const sql = postgres(connectionString(), {
  // Konservativt med vilje. Se README, "Forbindelsesbudget".
  max: isServerless ? 1 : 10,

  // Transaction mode kan ikke haandtere prepared statements: naeste
  // transaktion lander maaske paa en anden server-forbindelse, og den fejler
  // med "prepared statement does not exist" — typisk foerst under belastning.
  // Session/direct beholder dem, de er hurtigere.
  prepare: !isServerless,

  // Supabase kraever TLS. 'require' verificerer ikke certifikatkaeden, hvilket
  // er det Supabase selv anbefaler til pooleren.
  ssl: 'require',

  idle_timeout: isServerless ? 20 : 300,
  max_lifetime: 60 * 30,
  connect_timeout: 10,

  onnotice: () => {},
})

export const db = drizzle(sql, { schema })
