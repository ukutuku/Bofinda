// ═══════════════════════════════════════════════════════════════
//  Databaseklient.
//
//  To vidt forskellige kaldere, to vidt forskellige indstillinger:
//
//    Frontend  Vercel, serverless. Mange kortlivede processer, hver med
//              sin egen pool. Gaar gennem PgBouncer. Pool paa 1.
//    Worker    Railway, én lang proces. Gaar direkte paa Postgres over
//              Railways private net. Pool paa 10.
//
//  Applikationslags-pooling loeser IKKE serverless-problemet: hver
//  lambda har sin egen pool, saa "max: 10" i tyve samtidige lambdaer er
//  200 forbindelser mod en database der taaler 100. Poolen skal ligge
//  UDEN for processerne. Derfor PgBouncer.
// ═══════════════════════════════════════════════════════════════

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const isServerless = Boolean(process.env.VERCEL)

function connectionString() {
  const url = isServerless
    ? process.env.DATABASE_URL          // PgBouncer, offentlig TCP-proxy
    : process.env.DATABASE_URL_DIRECT   // Postgres direkte, privat net
  if (!url) {
    throw new Error(
      isServerless
        ? 'DATABASE_URL mangler (skal pege paa PgBouncer)'
        : 'DATABASE_URL_DIRECT mangler (skal pege paa Postgres direkte)',
    )
  }
  return url
}

export const sql = postgres(connectionString(), {
  // Konservativt med vilje. Se README, afsnittet "Forbindelsesbudget".
  max: isServerless ? 1 : 10,

  // PgBouncer i transaction mode kan ikke haandtere prepared statements:
  // naeste transaktion lander maaske paa en anden server-forbindelse, og
  // du faar "prepared statement does not exist". Skal vaere false her.
  // Workeren koerer direkte og beholder dem — de er hurtigere.
  prepare: !isServerless,

  // Slip forbindelsen hurtigt i serverless, saa PgBouncer kan genbruge
  // den. Workeren maa gerne holde paa sine.
  idle_timeout: isServerless ? 20 : 300,
  max_lifetime: 60 * 30,
  connect_timeout: 10,

  onnotice: () => {},
})

export const db = drizzle(sql, { schema })
