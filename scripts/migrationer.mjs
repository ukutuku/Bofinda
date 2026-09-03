// ═══════════════════════════════════════════════════════════════
//  Er databasen på højde med koden?
//
//  Migrationer køres IKKE af Vercel-bygget: et byg skal kunne lykkes uden
//  en database (se noten i db/client.ts). Det betyder også, at ingen ting
//  opdager en migration, der aldrig blev kørt — 0014 lå usynligt uden for
//  produktionen, indtil en upload fejlede.
//
//    npm run db:status    siger hvad der mangler, og fejler hvis noget gør
//    npm run db:migrate   kører det
//
//  Kør db:status efter hver deploy. Den fejler med exit 1, så den kan
//  bruges i en pipeline.
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'
import { readFileSync, readdirSync } from 'node:fs'

const url = process.env.DATABASE_URL_DIRECT
if (!url) { console.error('DATABASE_URL_DIRECT mangler'); process.exit(2) }
const sql = postgres(url, { max: 1, ssl: 'require', onnotice() {} })

const journal = JSON.parse(
  readFileSync('db/migrations/meta/_journal.json', 'utf8')).entries
const filer = readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()

let koert = []
try {
  koert = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
} catch {
  console.log('  drizzle.__drizzle_migrations findes ikke — ingen migration er kørt.')
}

const udenPost = filer.filter((f) => !journal.some((e) => f.startsWith(e.tag)))
const mangler = journal.slice(koert.length)

console.log(`  filer ${filer.length} · journalposter ${journal.length} · kørt ${koert.length}`)
if (udenPost.length) {
  console.log(`\n  ⚠ ${udenPost.length} fil(er) uden journalpost — de bliver ALDRIG kørt:`)
  udenPost.forEach((f) => console.log(`      ${f}`))
  console.log('    En håndskrevet migration skal tilføjes i meta/_journal.json.')
}
if (mangler.length) {
  console.log(`\n  ⚠ ${mangler.length} migration(er) mangler i databasen:`)
  mangler.forEach((e) => console.log(`      ${e.tag}`))
  console.log('\n    Kør: npm run db:migrate')
}
await sql.end()
if (udenPost.length || mangler.length) process.exit(1)
console.log('  ✓ databasen er på højde med koden.')
