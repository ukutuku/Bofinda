import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })

const t = await sql`
  select c.relname tabel, c.relrowsecurity rls,
         (select count(*) from information_schema.columns k
           where k.table_schema='public' and k.table_name=c.relname) kol,
         (select count(*) from pg_indexes i
           where i.schemaname='public' and i.tablename=c.relname) idx,
         (select count(*) from pg_policy p where p.polrelid=c.oid) pol
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by c.relname`

console.log(`\n${t.length} tabeller i public — Supabase\n`)
console.log('tabel'.padEnd(18)+'kol'.padStart(5)+'idx'.padStart(5)+'raekker'.padStart(9)+'   RLS'+'  politikker')
console.log('─'.repeat(60))
for (const r of t) {
  const [{n}] = await sql.unsafe(`select count(*)::int n from public."${r.tabel}"`)
  console.log(r.tabel.padEnd(18)+String(r.kol).padStart(5)+String(r.idx).padStart(5)+String(n).padStart(9)
    +(r.rls?'   til ':'   FRA ')+String(r.pol).padStart(8))
}

const m = await sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`
console.log(`\n${m.length} migrationer anvendt`)

const enums = await sql`
  select t.typname, array_agg(e.enumlabel order by e.enumsortorder) vals
  from pg_type t join pg_enum e on e.enumtypid=t.oid
  join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
  group by t.typname order by t.typname`
console.log('\nenums'); console.log('─'.repeat(60))
for (const e of enums) console.log(`${e.typname.padEnd(22)}${e.vals.join(' · ')}`)
await sql.end()
