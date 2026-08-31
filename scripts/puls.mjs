// Hvordan gaar det med den loebende import? Svarer paa de tre spoergsmaal:
// hvor mange nye pr. doegn, hvor hurtigt ser vi dem, virker afmeldningen.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })
const timer = (ms) => ms / 3600000
const varighed = (t) => {
  if (t == null) return '—'
  if (t < 1) return `${Math.round(t * 60)} min`
  if (t < 48) return `${t.toFixed(1)} t`
  return `${(t / 24).toFixed(1)} dg`
}

console.log('\n═══ KØRSLER ═══')
const runs = await sql`
  select s.slug, cr.started_at, cr.finished_at, cr.status,
         cr.discovered_count d, cr.new_count n, cr.updated_count u,
         cr.touched_count t, cr.delisted_count dl, cr.error_count e, cr.notes
  from crawl_runs cr join sources s on s.id = cr.source_id
  where cr.new_count is not null
  order by cr.started_at desc limit 30`
if (!runs.length) console.log('  ingen kørsler med de nye tællere endnu')
console.log('  tidspunkt         kilde       fundet  nye  hentet  bekræft  afmeldt  fejl')
console.log('  ' + '─'.repeat(76))
for (const r of runs) {
  const min = r.finished_at ? Math.round((r.finished_at - r.started_at) / 60000) : null
  console.log(`  ${r.started_at.toISOString().slice(0,16).replace('T',' ')}  ${r.slug.padEnd(10)}`
    + `${String(r.d).padStart(6)}${String(r.n).padStart(5)}${String(r.u).padStart(8)}`
    + `${String(r.t).padStart(9)}${String(r.dl).padStart(9)}${String(r.e).padStart(6)}`
    + `${r.status === 'ok' ? '' : '  ✗'}${min != null ? `   ${min} min` : ''}`)
  if (r.notes && r.status !== 'ok') for (const l of r.notes.split('\n').slice(0,1)) console.log(`      ${l}`)
}

console.log('\n═══ NYE BOLIGER PR. DØGN ═══')
for (const r of await sql`
  select date_trunc('day', first_seen_at) dag, s.slug, count(*)::int n
  from listings l join sources s on s.id = l.source_id
  group by 1,2 order by 1 desc, 2 limit 20`)
  console.log(`  ${r.dag.toISOString().slice(0,10)}  ${r.slug.padEnd(11)}${String(r.n).padStart(5)}`)

console.log('\n═══ FORSINKELSE: fra kilden oprettede den, til vi så den ═══')
const lag = await sql`
  select s.slug,
    count(*)::int n,
    percentile_cont(0.5) within group (order by extract(epoch from (l.first_seen_at - l.source_created_at))*1000) median,
    percentile_cont(0.9) within group (order by extract(epoch from (l.first_seen_at - l.source_created_at))*1000) p90,
    min(extract(epoch from (l.first_seen_at - l.source_created_at))*1000) hurtigst,
    max(extract(epoch from (l.first_seen_at - l.source_created_at))*1000) langsomst
  from listings l join sources s on s.id = l.source_id
  where l.source_created_at is not null group by 1 order by 1`
console.log('  kilde        antal    median      p90   hurtigst  langsomst')
for (const r of lag)
  console.log(`  ${r.slug.padEnd(11)}${String(r.n).padStart(6)}  ${varighed(timer(r.median)).padStart(8)}`
    + `${varighed(timer(r.p90)).padStart(9)}${varighed(timer(r.hurtigst)).padStart(11)}${varighed(timer(r.langsomst)).padStart(11)}`)
console.log('\n  NB: boliger fra første import har en forsinkelse, der kun siger noget om,')
console.log('      hvor gamle annoncerne var, da vi startede. Tallet bliver først')
console.log('      meningsfuldt for boliger set EFTER den løbende import gik i gang.')

const [start] = await sql`select min(started_at) t from crawl_runs where new_count is not null`
if (start?.t) {
  console.log(`\n  Kun boliger set efter ${start.t.toISOString().slice(0,16).replace('T',' ')}:`)
  const efter = await sql`
    select s.slug, count(*)::int n,
      percentile_cont(0.5) within group (order by extract(epoch from (l.first_seen_at - l.source_created_at))*1000) median
    from listings l join sources s on s.id = l.source_id
    where l.source_created_at is not null and l.first_seen_at >= ${start.t}
    group by 1 order by 1`
  if (!efter.length) console.log('    ingen nye boliger endnu')
  for (const r of efter) console.log(`    ${r.slug.padEnd(11)}${String(r.n).padStart(4)} boliger, median ${varighed(timer(r.median))}`)
}

console.log('\n═══ AFMELDNING ═══')
const [a] = await sql`
  select count(*) filter (where status='delisted')::int afmeldte,
         count(*) filter (where status='active')::int aktive,
    percentile_cont(0.5) within group (order by extract(epoch from (delisted_at - first_seen_at))*1000)
      filter (where status='delisted') levetid
  from listings`
console.log(`  ${a.aktive} aktive, ${a.afmeldte} afmeldt`)
if (a.afmeldte) console.log(`  median levetid fra vi så den til den forsvandt: ${varighed(timer(a.levetid))}`)
for (const r of await sql`
  select l.address_raw, s.slug, l.first_seen_at f, l.delisted_at d
  from listings l join sources s on s.id=l.source_id
  where l.status='delisted' order by l.delisted_at desc limit 5`)
  console.log(`    ${r.d.toISOString().slice(0,16).replace('T',' ')}  ${r.slug.padEnd(10)} ${r.address_raw}`)
await sql.end()
