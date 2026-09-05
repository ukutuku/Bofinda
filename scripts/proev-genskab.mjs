// ═══════════════════════════════════════════════════════════════
//  npm run db:backup:proev — beviset for at backuppen kan læses tilbage
//
//  En backup, man aldrig har genskabt fra, er ikke en backup. Den her
//  bygger en helt ny, tom Postgres i hukommelsen (PGlite — rigtig
//  Postgres oversat til WebAssembly, ingen installation), kører
//  db/migrations på den, læser dumpet ind og tæller rækkerne.
//
//  Den rører ALDRIG produktionsdatabasen. Der er ingen forbindelse ud af
//  maskinen i dette script — det arbejder kun på filen.
//
//  Hvad prøven beviser:
//    · filen er gyldig COPY-syntaks, og hver blok passer til sin tabel
//    · rækkefølgen i filen holder fremmednøglerne — børn efter forældre
//    · hver eneste række kommer med, talt op mod filens eget manifest
//
//  Hvad den ikke beviser: at auth.users kan lægges tilbage i et NYT
//  Supabase-projekt. Det skema ejer Supabase, ikke os — se README.
//
//    npm run db:backup:proev                  nyeste fil i backup/
//    npm run db:backup:proev backup/xxx.sql   en bestemt fil
// ═══════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite'
import { koerMigrationer, stubSupabase } from './pglite-skema.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const valgt = process.argv[2]
const nyeste = () => {
  const f = readdirSync('backup').filter((n) => n.endsWith('.sql')).sort().pop()
  if (!f) { console.error('Ingen dump i backup/. Kør npm run db:backup først.'); process.exit(2) }
  return `backup/${f}`
}
const sti = valgt || nyeste()
const tekst = readFileSync(sti, 'utf8')
console.log(`  fil    ${sti} · ${(Buffer.byteLength(tekst) / 1e6).toFixed(1)} MB`)

// ── halen først ──────────────────────────────────────────────────────
// Et afbrudt dump har intet manifest. Det skal opdages her, ikke den dag
// filen skal bruges.
if (!tekst.trimEnd().endsWith('-- FÆRDIG')) {
  console.error('\n  ✗ Filen mangler sin hale (-- FÆRDIG). Dumpet blev afbrudt.')
  process.exit(1)
}
const lovet = new Map()
for (const l of tekst.split('\n')) {
  const m = l.match(/^--   (\S+)\s+(\d+)\s+([0-9a-f]{64})$/)
  if (m) lovet.set(m[1], { raekker: Number(m[2]), sum: m[3] })
}
if (!lovet.size) {
  console.error('\n  ✗ Filen har intet manifest med kontrolsummer.')
  console.error('    Er den lavet med en ældre backup.mjs? Tag et nyt dump.')
  process.exit(1)
}
console.log(`  lover  ${[...lovet.values()].reduce((a, b) => a + b.raekker, 0)} rækker i ${lovet.size} tabeller`)

// ── del filen op i COPY-blokke ───────────────────────────────────────
const blokke = []
const linjer = tekst.split('\n')
for (let i = 0; i < linjer.length; i++) {
  const m = linjer[i].match(/^copy "([^"]+)"\."([^"]+)" \((.+)\) from stdin;$/)
  if (!m) continue
  const [, skema, tabel, kolonner] = m
  const fra = ++i
  while (i < linjer.length && linjer[i] !== '\\.') i++
  // En tom tabel har ingen datalinjer. Uden det her ville blokken blive
  // til '\n' — én linje, som COPY læser som én række med tomme felter.
  const data = linjer.slice(fra, i)
  blokke.push({ skema, tabel, kolonner, data: data.length ? data.join('\n') + '\n' : '' })
}
console.log(`  finder ${blokke.length} COPY-blokke`)

// Er filen den samme, som den dag den blev skrevet? Det spørgsmål kan
// besvares uden database — og bør besvares, før vi bygger en base op
// omkring den.
let skadet = 0
for (const b of blokke) {
  const navn = `${b.skema}.${b.tabel}`
  const vent = lovet.get(navn)
  if (!vent) { console.log(`  ! ${navn} står ikke i manifestet`); skadet++; continue }
  const sum = createHash('sha256').update(Buffer.from(b.data, 'utf8')).digest('hex')
  if (sum !== vent.sum) {
    console.log(`  ! ${navn}: kontrolsummen passer ikke — filen har taget skade`)
    skadet++
  }
}
if (skadet) {
  console.error(`\n  ✗ ${skadet} blok(ke) er ikke, som de blev skrevet. Brug en anden fil.`)
  process.exit(1)
}
console.log(`  intakt ${blokke.length} kontrolsummer passer\n`)

// ── en helt ny, tom base ─────────────────────────────────────────────
const db = await PGlite.create()

// Supabase-delene, som vores migrationer regner med, men som Supabase selv
// ejer. Her står de kun som stubbe: nok til at migrationerne kan køre og
// dataene kan lande, ikke en efterligning af Supabases eget skema.
const auth = blokke.find((b) => b.skema === 'auth' && b.tabel === 'users')
if (!auth) { console.error('Dumpet har ingen auth.users. Er det den rigtige fil?'); process.exit(1) }
const authKolonner = auth.kolonner.split(', ').map((k) => k.replace(/"/g, ''))
await stubSupabase(db, authKolonner)

// ── vores eget skema, fra migrationerne ──────────────────────────────
// Samme rækkefølge som drizzle bruger: journalen, ikke filnavnene på disk.
// (Det er netop forskellen, npm run db:status findes for.)
let antalMigrationer
try {
  antalMigrationer = await koerMigrationer(db)
} catch (e) {
  console.error(`  ✗ ${e.message}`)
  console.error('    Så kan basen heller ikke genskabes. Ret migrationen.')
  process.exit(1)
}
await db.exec(readFileSync('db/toem-public.sql', 'utf8'))
console.log(`  skema  ${antalMigrationer} migrationer kørt, public tømt`)

// ── læs dataene ind ──────────────────────────────────────────────────
for (const b of blokke) {
  const navn = `"${b.skema}"."${b.tabel}"`
  try {
    await db.query(`copy ${navn} (${b.kolonner}) from '/dev/blob'`, [], {
      blob: new Blob([b.data]),
    })
  } catch (e) {
    console.error(`\n  ✗ ${b.skema}.${b.tabel} kunne ikke læses ind: ${e.message}`)
    if (/foreign key|violates/i.test(e.message))
      console.error('    Rækkefølgen i dumpet holder ikke. Se sorteringen i backup.mjs.')
    process.exit(1)
  }
}

// ── tæl op ───────────────────────────────────────────────────────────
let fejl = 0
console.log('')
for (const [navn, { raekker: forventet }] of lovet) {
  const [skema, tabel] = navn.split('.')
  const { rows } = await db.query(`select count(*)::int n from "${skema}"."${tabel}"`)
  const fik = rows[0].n
  const enig = fik === forventet
  if (!enig) fejl++
  console.log(`  ${enig ? '✓' : '✗'} ${navn.padEnd(24)} ${String(fik).padStart(6)} / ${forventet}`)
}
// ── og er det de samme data? ─────────────────────────────────────────
// Rækketal fanger ikke en værdi, der blev forvansket undervejs. Vi skriver
// hver tabel ud igen med de samme kolonner og sammenligner linjerne med
// filens egen blok. Er de ens, er intet tabt: ingen afkortet tekst, ingen
// tabt tidszone, ingen jsonb der skiftede form.
//
// Linjerne sammenlignes sorteret, ikke i rækkefølge: COPY uden order by
// lover ingen bestemt rækkefølge, og det er værdierne, vi vil efterprøve.
// Tidszonen sættes til UTC, fordi dumpet blev skrevet af en server i UTC —
// ellers ville hvert tidsstempel se forskelligt ud uden at være forkert.
await db.exec("set time zone 'UTC'")
let afvig = 0
for (const b of blokke) {
  const { blob } = await db.query(
    `copy (select ${b.kolonner} from "${b.skema}"."${b.tabel}") to '/dev/blob'`)
  // En tom tabel giver slet ingen blob tilbage, ikke en tom en.
  const sorter = (t) => t.split('\n').filter(Boolean).sort()
  const foer = sorter(b.data)
  const efter = sorter(blob ? await blob.text() : '')
  const ens = foer.length === efter.length && foer.every((l, i) => l === efter[i])
  if (!ens) {
    afvig++
    const anderledes = efter.filter((l, i) => l !== foer[i]).length
    console.log(`  ! ${b.skema}.${b.tabel}: ${anderledes} linje(r) kom anderledes tilbage`)
    const i = foer.findIndex((l, j) => l !== efter[j])
    if (i >= 0) {
      console.log(`      i filen:  ${String(foer[i]).slice(0, 120)}`)
      console.log(`      tilbage:  ${String(efter[i]).slice(0, 120)}`)
    }
  }
}
await db.close()

if (fejl) {
  console.error(`\n  ✗ ${fejl} tabel(ler) stemmer ikke. Backuppen kan ikke bruges som den er.`)
  process.exit(1)
}
if (afvig) {
  console.error(`\n  ✗ ${afvig} tabel(ler) kom anderledes tilbage, end de gik ind.`)
  process.exit(1)
}
console.log(`\n  ✓ Genskabt i en ny, tom base.`)
console.log(`    Alle ${lovet.size} tabeller: rækketal stemmer, og hver linje kom`)
console.log('    uændret tilbage. Produktionsdatabasen blev ikke rørt.')
