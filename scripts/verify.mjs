import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })
const kr = (o) => o == null ? '—' : (o/100).toLocaleString('da-DK')

const r = await sql`
  select l.external_key, l.address_raw, l.street, l.house_number, l.floor, l.door,
         l.postal_code, l.city, l.property_type, l.size_m2, l.rooms,
         l.rent_monthly, l.total_monthly, l.total_monthly_components,
         l.address_match_level, l.status, l.first_seen_at, l.last_seen_at, l.delisted_at,
         l.description, l.is_blurred, l.contact_email,
         (select count(*) from listing_images i where i.listing_id=l.id) bill
  from listings l join sources s on s.id=l.source_id
  where s.slug='dummy' order by l.first_seen_at, l.address_raw`

console.log(`\n${r.length} boliger fra dummy\n`)
for (const b of r) {
  const t = b.total_monthly_components
  console.log(`${b.status==='active'?'●':'○'} ${b.address_raw}`)
  console.log(`   parset      vej=${b.street ?? '—'} nr=${b.house_number ?? '—'} et=${b.floor ?? '—'} dr=${b.door ?? '—'} ${b.postal_code ?? '—'} ${b.city ?? '—'}`)
  console.log(`   type=${b.property_type ?? 'NULL'}  ${b.size_m2 ?? 'NULL'} m²  ${b.rooms ?? 'NULL'} vær.  billeder=${b.bill}`)
  console.log(`   husleje ${kr(b.rent_monthly)}  total ${kr(b.total_monthly)}  talt med: ${t ? t.join('+') : 'NULL'}`)
  console.log(`   match=${b.address_match_level}  blurred=${b.is_blurred}  kontakt=${b.contact_email ?? 'NULL'}`)
  console.log(`   først set ${b.first_seen_at.toISOString().slice(0,19)}  sidst ${b.last_seen_at.toISOString().slice(0,19)}${b.delisted_at?`  AFMELDT ${b.delisted_at.toISOString().slice(0,19)}`:''}`)
  console.log(`   » ${b.description ?? 'NULL'}`)
  console.log()
}

const runs = await sql`
  select c.started_at, c.status, c.discovered_count d, c.extracted_count e, c.error_count f, c.notes
  from crawl_runs c join sources s on s.id=c.source_id where s.slug='dummy'
  order by c.started_at`
console.log('crawl_runs')
console.log('─'.repeat(72))
for (const x of runs) {
  console.log(`${x.started_at.toISOString().slice(0,19)}  ${x.status.padEnd(7)} fundet=${x.d} skrevet=${x.e} fejl=${x.f}`)
  if (x.notes) for (const n of x.notes.split('\n')) console.log(`    ${n}`)
}
await sql.end()
