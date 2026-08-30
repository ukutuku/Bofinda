import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false })
const t = process.argv[2] ?? 'listings'
const cols = await sql`
  select ordinal_position p, column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public' and table_name=${t} order by ordinal_position`
console.log(`\npublic.${t} — ${cols.length} kolonner\n`)
console.log('  #  kolonne'.padEnd(34) + 'type'.padEnd(26) + 'null  default')
console.log('─'.repeat(84))
for (const c of cols) {
  const d = (c.column_default ?? '').replace(/::[a-z_ ]+/g,'').slice(0,20)
  console.log(String(c.p).padStart(3) + '  ' + c.column_name.padEnd(29) + c.data_type.padEnd(26) + (c.is_nullable==='YES'?'ja  ':'nej ') + '  ' + d)
}
await sql.end()
