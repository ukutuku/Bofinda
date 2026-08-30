import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })
const kr = (o) => o == null ? '—' : (o/100).toLocaleString('da-DK')
const r = await sql`
  select l.address_raw, l.street, l.house_number, l.floor, l.door, l.postal_code, l.city,
         l.address_match_level lvl, l.unit_address_uuid u, l.access_address_uuid a,
         l.property_type, l.size_m2, l.rooms, l.rent_monthly,
         l.utilities_heat h, l.utilities_water v, l.utilities_electricity e, l.utilities_other o,
         l.total_monthly tm, l.total_monthly_components tk, l.move_in_cost mic,
         l.application_type app, l.rent_model rm, l.lat, l.lng,
         l.source_created_at sc, l.first_seen_at fs, l.source_url,
         (select count(*) from listing_images i where i.listing_id=l.id) bill,
         l.description
  from listings l join sources s on s.id=l.source_id
  where s.slug='findbolig' order by l.rent_monthly desc limit 10`
for (const b of r) {
  console.log('━'.repeat(78))
  console.log(`${b.address_raw}`)
  console.log(`  parset     ${b.street} ${b.house_number ?? ''} | et.${b.floor ?? '—'} ${b.door ?? '—'} | ${b.postal_code} ${b.city}`)
  console.log(`  match      ${b.lvl}   ${b.u ?? b.a}`)
  console.log(`  bolig      ${b.property_type ?? 'NULL'} · ${b.size_m2 ?? 'NULL'} m² · ${b.rooms ?? 'NULL'} vær · ${b.bill} billeder · ${b.lat},${b.lng}`)
  console.log(`  husleje    ${kr(b.rent_monthly)}   varme ${kr(b.h)}  vand ${kr(b.v)}  el ${kr(b.e)}  øvrig ${kr(b.o)}`)
  console.log(`  TOTAL      ${kr(b.tm)}   talt med: ${b.tk ? b.tk.join('+') : 'NULL'}`)
  console.log(`  indflytn.  ${kr(b.mic)}   ansøgning: ${b.app ?? 'NULL'} (${b.rm ?? '—'})`)
  console.log(`  hos kilden ${b.sc ? b.sc.toISOString().slice(0,16) : '—'}   set af os ${b.fs.toISOString().slice(0,16)}`)
  console.log(`  ${b.source_url}`)
  console.log(`  » ${b.description}`)
}
const s = await sql`select application_type a, address_match_level l, count(*)::int n,
  count(total_monthly)::int m from listings l2 join sources so on so.id=l2.source_id
  where so.slug='findbolig' group by 1,2`
console.log('━'.repeat(78))
console.log('opsummering:', s.map(x=>`${x.a}/${x.l}: ${x.n} boliger, ${x.m} med total`).join('   '))
await sql.end()
