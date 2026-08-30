// Viser hvad der faktisk staar i databasen. Ikke hvad skemaet paastaar.
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false })

const tables = await sql`
  select t.table_name,
         (select count(*) from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = t.table_name) as cols,
         (select count(*) from pg_indexes i
           where i.schemaname = 'public' and i.tablename = t.table_name) as idx
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by t.table_name`

console.log(`\n${tables.length} tabeller i public\n`)
console.log('tabel'.padEnd(20) + 'kolonner'.padStart(9) + 'indeks'.padStart(8) + 'raekker'.padStart(9))
console.log('─'.repeat(46))
for (const t of tables) {
  const [{ n }] = await sql.unsafe(`select count(*)::int as n from public."${t.table_name}"`)
  console.log(t.table_name.padEnd(20) + String(t.cols).padStart(9) + String(t.idx).padStart(8) + String(n).padStart(9))
}

const enums = await sql`
  select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as vals
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`
console.log('\nenums')
console.log('─'.repeat(46))
for (const e of enums) console.log(`${e.typname.padEnd(20)} ${e.vals.join(' · ')}`)

const uniq = await sql`
  select indexname, tablename, indexdef from pg_indexes
  where schemaname = 'public' and indexdef ilike '%unique%' order by tablename`
console.log('\nunikke indeks (det er dem, der forhindrer dubletter)')
console.log('─'.repeat(46))
for (const u of uniq) {
  const cols = u.indexdef.match(/\(([^)]+)\)$/)?.[1] ?? ''
  console.log(`${u.tablename.padEnd(18)} ${u.indexname.padEnd(26)} (${cols})`)
}

await sql.end()
