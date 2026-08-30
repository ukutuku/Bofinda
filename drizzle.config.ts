import 'dotenv/config'
import type { Config } from 'drizzle-kit'

// Migrationer skal ALDRIG gaa gennem transaction pooleren (:6543).
// DDL og advisory locks kraever en session; transaction mode giver en
// tilfaeldig server-forbindelse pr. transaktion. Koer altid mod Supabases
// session pooler eller direct connection (:5432).
export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT!,
    ssl: 'require',
  },
} satisfies Config
