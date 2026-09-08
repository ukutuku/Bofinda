// ═══════════════════════════════════════════════════════════════
//  Skemaet på testbasen.
//
//  GENBRUGER scripts/pglite-skema.mjs — de samme Supabase-stubbe og de
//  samme migrationer i journalens rækkefølge, som `npm test` bruger.
//  Skrev den sin egen udgave, ville testmiljøet være noget andet end
//  produktionen, og så prøver det noget andet end produktionen.
//
//  Idempotent: er skemaet der, gør scriptet ingenting.
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'
import { stubSupabase, koerMigrationer } from '../pglite-skema.mjs'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
if (!url) { console.error('FEJL: ingen DATABASE_URL. Kør gennem scripts/cloud/.'); process.exit(1) }
const u = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port !== '55432') {
  console.error(`FEJL: ${u.hostname}:${u.port} er ikke den isolerede testbase.`); process.exit(1)
}

const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })

// PGlite's exec() kører flere sætninger i ét kald. postgres.js gør det
// samme gennem simple query-protokollen — så koerMigrationer() kan
// bruges uændret mod en rigtig server.
const som = { exec: (s) => sql.unsafe(s).simple() }

const [{ findes }] = await sql`
  select count(*)::int > 0 as findes from information_schema.tables
  where table_schema='public' and table_name='listings'`

if (findes) {
  console.log('· skemaet findes allerede — intet at gøre')
} else {
  await som.exec('create schema if not exists public')
  await stubSupabase(som)
  const n = await koerMigrationer(som)
  console.log(`✓ ${n} migrationer kørt (journalens rækkefølge, samme som npm test)`)
}

const [{ tabeller }] = await sql`
  select count(*)::int as tabeller from information_schema.tables where table_schema='public'`
console.log(`  public: ${tabeller} tabeller`)
await sql.end()
