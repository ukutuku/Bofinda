import 'dotenv/config'
import type { Config } from 'drizzle-kit'

// Migrationer skal ALDRIG gaa gennem PgBouncer i transaction mode.
// DDL og advisory locks kraever en session, og transaction pooling giver
// dig en tilfaeldig server-forbindelse pr. transaktion. Koer altid mod
// Railway-Postgres direkte.
export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT! },
} satisfies Config
