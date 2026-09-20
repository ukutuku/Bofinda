// ═══════════════════════════════════════════════════════════════
//  Sammenligner TO databasers skema — kolonner, begrænsninger,
//  indekser, politikker og rettigheder.
//
//  Den findes, fordi en tidligere aflevering påstod, at to baser var
//  «identiske» på grundlag af en md5 over information_schema.columns.
//  Den hash siger noget om KOLONNER. Den siger intet om en manglende
//  unik begrænsning, et manglende indeks, en RLS-politik der ikke blev
//  oprettet, eller en glemt `revoke` — og netop dem er der regler om.
//
//      node scripts/cloud/skemasammenlign.mjs <urlA> <urlB>
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'
import { createHash } from 'node:crypto'

const [a, b] = process.argv.slice(2)
if (!a || !b) { console.error('brug: skemasammenlign.mjs <urlA> <urlB>'); process.exit(2) }
for (const u of [a, b]) {
  const x = new URL(u)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(x.hostname) || x.port !== '55432') {
    console.error(`FEJL: ${x.hostname}:${x.port} er ikke den isolerede testbase.`); process.exit(2)
  }
}

const SNIT = {
  kolonner: `select table_name, column_name, data_type, is_nullable,
      coalesce(column_default,'') as d
    from information_schema.columns where table_schema='public'
    order by 1,2`,
  begraensninger: `select c.relname, con.conname, con.contype::text,
      pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    order by 1,2`,
  indekser: `select tablename, indexname, indexdef from pg_indexes
    where schemaname='public' order by 1,2`,
  politikker: `select tablename, policyname, cmd, coalesce(qual,''),
      coalesce(with_check,'') from pg_policies where schemaname='public' order by 1,2`,
  rls: `select c.relname, c.relrowsecurity::text from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by 1`,
  rettigheder: `select table_name, grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated','service_role')
    order by 1,2,3`,
  funktioner: `select p.proname, pg_get_function_identity_arguments(p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' order by 1,2`,
  enums: `select t.typname, e.enumlabel from pg_type t
    join pg_enum e on e.enumtypid=t.oid
    join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
    order by 1, e.enumsortorder`,
}

const hent = async (url) => {
  const s = postgres(url, { ssl: false, max: 1, onnotice: () => {} })
  const ud = {}
  for (const [navn, q] of Object.entries(SNIT)) {
    ud[navn] = (await s.unsafe(q)).map((r) => Object.values(r).join('\u0001')).sort()
  }
  await s.end()
  return ud
}

const [A, B] = [await hent(a), await hent(b)]
const h = (v) => createHash('sha256').update(v.join('\n')).digest('hex').slice(0, 16)
let forskelle = 0
console.log(`  A = ${new URL(a).pathname.slice(1)}`)
console.log(`  B = ${new URL(b).pathname.slice(1)}`)
console.log()
for (const navn of Object.keys(SNIT)) {
  const ens = h(A[navn]) === h(B[navn])
  console.log(`  ${ens ? '✓' : '✗'} ${navn.padEnd(16)} ${String(A[navn].length).padStart(4)} rækker  `
    + `sha256/16 A=${h(A[navn])} B=${h(B[navn])}`)
  if (!ens) {
    forskelle++
    const kun = (x, y) => x.filter((v) => !y.includes(v))
    for (const v of kun(A[navn], B[navn]).slice(0, 10)) console.log(`      kun i A: ${v.replace(/\u0001/g, ' | ')}`)
    for (const v of kun(B[navn], A[navn]).slice(0, 10)) console.log(`      kun i B: ${v.replace(/\u0001/g, ' | ')}`)
  }
}
console.log()
console.log(forskelle === 0
  ? '  De otte snit er ens. Det er ikke «alt», men det er kolonner, begrænsninger,'
    + '\n  indekser, RLS, politikker, rettigheder, funktioner og enum-værdier.'
  : `  ${forskelle} snit er FORSKELLIGE.`)
process.exit(forskelle === 0 ? 0 : 1)
