import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })
const kr = (o) => o == null ? '—' : (o/100).toLocaleString('da-DK')

console.log('\n── pr. kilde ──')
for (const r of await sql`
  select s.slug, count(*)::int n, count(l.total_monthly)::int total,
         count(l.move_in_cost)::int mic, count(l.lat)::int geo,
         sum(case when l.address_match_level='unit' then 1 else 0 end)::int unit,
         sum(case when l.address_match_level='access' then 1 else 0 end)::int acc,
         sum(case when l.address_match_level='failed' then 1 else 0 end)::int fail
  from listings l join sources s on s.id=l.source_id group by s.slug order by s.slug`)
  console.log(`  ${r.slug.padEnd(11)} ${String(r.n).padStart(3)} boliger · ${r.total} med total · ${r.mic} med indflytningspris · ${r.geo} med koordinater · unit ${r.unit} / access ${r.acc} / failed ${r.fail}`)

console.log('\n── fem fra Propstep ──')
for (const b of await sql`
  select l.address_raw, l.property_type, l.size_m2, l.rooms, l.rent_monthly r,
    l.utilities_heat h, l.utilities_water v, l.utilities_electricity e, l.utilities_other o,
    l.total_monthly tm, l.total_monthly_components tk, l.move_in_cost mic, l.application_type app,
    l.address_match_level lvl, l.unit_address_uuid u, l.amenities,
    (select count(*) from listing_images i where i.listing_id=l.id) bill, l.description
  from listings l join sources s on s.id=l.source_id
  where s.slug='propstep' order by l.rent_monthly desc limit 5`) {
  console.log(`\n  ${b.address_raw}`)
  console.log(`    ${b.property_type ?? 'NULL'} · ${b.size_m2 ?? '—'} m² · ${b.rooms ?? '—'} vær · ${b.bill} billeder · ${b.lvl}`)
  console.log(`    husleje ${kr(b.r)}  varme ${kr(b.h)}  vand ${kr(b.v)}  el ${kr(b.e)}  øvrig ${kr(b.o)}`)
  console.log(`    TOTAL ${kr(b.tm)} (${b.tk ? b.tk.join('+') : 'NULL'})   indflytning ${kr(b.mic)}   ${b.app}`)
  console.log(`    ${b.u ?? '—'}`)
  console.log(`    faciliteter: ${(b.amenities||[]).join(', ') || '—'}`)
}

console.log('\n── dedup på tværs af kilder (samme unit-nøgle, flere kilder) ──')
const d = await sql`
  select l.unit_address_uuid k, count(*)::int n, array_agg(distinct s.slug) kilder,
         array_agg(l.rent_monthly) lejer, array_agg(l.address_raw) adresser
  from listings l join sources s on s.id=l.source_id
  where l.unit_address_uuid is not null
  group by l.unit_address_uuid having count(distinct s.slug) > 1`
if (!d.length) console.log('  ingen bolig optræder hos mere end én kilde')
for (const x of d) {
  console.log(`  ${x.kilder.join(' + ')}  ${x.k}`)
  x.adresser.forEach((a,i)=>console.log(`     ${a}  ${kr(x.lejer[i])}`))
}
console.log('\n── dubletter inden for samme kilde ──')
const s2 = await sql`
  select s.slug, l.unit_address_uuid k, count(*)::int n from listings l
  join sources s on s.id=l.source_id where l.unit_address_uuid is not null
  group by s.slug, l.unit_address_uuid having count(*)>1`
console.log(s2.length ? s2.map(x=>`  ${x.slug}: ${x.n}x ${x.k}`).join('\n') : '  ingen')
await sql.end()
