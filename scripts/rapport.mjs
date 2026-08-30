// Kvalitetsrapport pr. kilde. Kun aggregat og stikproever — ingen dump.
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL_DIRECT, { max: 1, prepare: false, ssl: 'require' })
const kilde = process.argv[2]
const hvor = kilde ? sql`where s.slug = ${kilde}` : sql``
const kr = (o) => o == null ? '—' : Math.round(o/100).toLocaleString('da-DK')

const [t] = await sql`
  select count(*)::int n,
    count(*) filter (where l.status='active')::int aktive,
    count(*) filter (where l.address_match_level='unit')::int unit,
    count(*) filter (where l.address_match_level='access')::int access,
    count(*) filter (where l.address_match_level='failed')::int failed,
    count(l.total_monthly)::int total,
    count(l.move_in_cost)::int mic,
    count(l.property_type)::int type,
    count(l.lat)::int geo,
    count(l.size_m2)::int areal,
    count(l.rooms)::int vaer,
    count(l.available_from)::int ledig,
    count(l.source_created_at)::int oprettet,
    min(l.rent_monthly) minleje, max(l.rent_monthly) maxleje
  from listings l join sources s on s.id=l.source_id ${hvor}`

const [b] = await sql`
  select count(*) filter (where i.n > 0)::int med, count(*) filter (where i.n = 0)::int uden,
         coalesce(round(avg(i.n))::int,0) snit, max(i.n)::int flest
  from (select l.id, (select count(*)::int from listing_images x where x.listing_id=l.id) n
        from listings l join sources s on s.id=l.source_id ${hvor}) i`

const p = (x) => `${x} (${t.n ? Math.round(x*100/t.n) : 0} %)`
console.log(`\n══ ${kilde ?? 'alle kilder'} — ${t.n} boliger, ${t.aktive} aktive ══\n`)
console.log(`  match_level     unit ${p(t.unit)}   access ${p(t.access)}   failed ${p(t.failed)}`)
console.log(`  med total       ${p(t.total)}`)
console.log(`  indflytningspris ${p(t.mic)}`)
console.log(`  boligtype sat   ${p(t.type)}`)
console.log(`  koordinater     ${p(t.geo)}`)
console.log(`  areal / vær.    ${p(t.areal)} / ${p(t.vaer)}`)
console.log(`  ledig fra       ${p(t.ledig)}`)
console.log(`  kildens dato    ${p(t.oprettet)}`)
console.log(`  billeder        ${p(b.med)} med, ${b.uden} uden, snit ${b.snit}, flest ${b.flest}`)
console.log(`  husleje         ${kr(t.minleje)} – ${kr(t.maxleje)} kr/md`)

console.log('\n  boligtyper:')
for (const r of await sql`select coalesce(l.property_type::text,'(ingen)') t, count(*)::int n
  from listings l join sources s on s.id=l.source_id ${hvor} group by 1 order by 2 desc`)
  console.log(`    ${r.t.padEnd(14)} ${r.n}`)

console.log('\n  aconto-poster i totalen:')
for (const r of await sql`select coalesce(array_to_string(l.total_monthly_components,'+'),'(ingen total)') k,
  count(*)::int n from listings l join sources s on s.id=l.source_id ${hvor} group by 1 order by 2 desc limit 8`)
  console.log(`    ${r.k.padEnd(34)} ${r.n}`)

console.log('\n  mistænkelige adresser:')
const rows = await sql`
  select l.street, l.house_number, l.floor, l.door, l.postal_code, l.city,
         l.size_m2, l.rooms, l.rent_monthly, l.address_raw, l.address_match_level lvl
  from listings l join sources s on s.id=l.source_id ${hvor}`
const tjek = [
  ['vejnavn mangler',              (x) => !x.street],
  ['husnummer mangler',            (x) => !x.house_number],
  ['etage+dør mangler (= access)', (x) => x.lvl === 'access'],
  ['postnr uden for 1000-9999',    (x) => !/^[1-9][0-9]{3}$/.test(x.postal_code ?? '')],
  ['by mangler',                   (x) => !x.city],
  ['vejnavn under 3 tegn',         (x) => (x.street ?? '').length < 3],
  ['vejnavn med ciffer',           (x) => /[0-9]/.test(x.street ?? '')],
  ['dør over 6 tegn',              (x) => (x.door ?? '').length > 6],
  ['areal under 10 / over 400',    (x) => x.size_m2 != null && (x.size_m2 < 10 || x.size_m2 > 400)],
  ['husleje under 2.000 kr',       (x) => x.rent_monthly != null && x.rent_monthly < 200000],
  ['husleje over 60.000 kr',       (x) => x.rent_monthly != null && x.rent_monthly > 6000000],
]
const ramt = new Map()
for (const [navn, f] of tjek) {
  const r = rows.filter(f)
  ramt.set(navn, r)
  console.log(`    ${navn.padEnd(32)} ${r.length === 0 ? '—' : r.length}`)
}
for (const [navn, r] of ramt) {
  if (!r.length || navn.includes('access')) continue
  console.log(`\n  eksempler — ${navn}:`)
  for (const x of r.slice(0, 4))
    console.log(`    ${JSON.stringify(x.address_raw)}\n      -> ${x.street} | ${x.house_number} | ${x.floor} | ${x.door} | ${x.postal_code} | ${x.city}`)
}

console.log('\n  adresser uden etage/dør — stikprøve:')
for (const x of rows.filter((r) => r.lvl === 'access').slice(0, 5))
  console.log(`    ${JSON.stringify(x.address_raw)}`)

await sql.end()
