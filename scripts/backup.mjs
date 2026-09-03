// ═══════════════════════════════════════════════════════════════
//  npm run db:backup — hele databasen ud i én fil
//
//  Free-planen hos Supabase tager ingen backup, og der er kun én base:
//  udvikling og produktion er den samme. Går den tabt, er boligerne,
//  alarmtilmeldingerne og udlejerkontiene væk.
//
//  Der er ingen pg_dump på maskinen (og ingen brew til at hente den), så
//  filen skrives med databasens eget COPY-format gennem postgres.js. Det
//  giver samme data som pg_dump --data-only, men INTET skema:
//
//    med       alle rækker i public, og auth.users (udlejerkontiene)
//    ikke med  tabeldefinitioner — dem laver db/migrations, som ligger i git
//    ikke med  filerne i storage-bucket'en. De ligger kun hos Supabase.
//              Sidefilen -filer.txt viser hvilke der fandtes.
//
//  Filen indeholder INGEN truncate og INGEN delete. Den skal læses ind i en
//  TOM base. Kører man den mod en base med data i, fejler den på en
//  nøglekonflikt — det er med vilje: en backup må aldrig kunne slette.
//
//  Hele dumpet tages i ÉN transaktion (repeatable read). Uden det ville
//  listings blive læst kl. 12.00.01 og listing_images kl. 12.00.31, og et
//  billede oprettet derimellem ville pege på en bolig, filen ikke har —
//  så ville indlæsningen fejle på fremmednøglen. Importen kører hele
//  tiden, så det er ikke en teoretisk risiko.
//
//  Se README for hvordan man læser den tilbage, og npm run db:backup:proev
//  for beviset på at det virker.
//
//  ADVARSEL: auth.users indeholder adgangskode-hashes. backup/ er i
//  .gitignore. Filen må ikke deles eller committes.
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createHash } from 'node:crypto'

const url = process.env.DATABASE_URL_DIRECT
if (!url) {
  console.error('DATABASE_URL_DIRECT mangler. Transaction-pooleren (6543) kan')
  console.error('ikke bruges til dette — det skal være session-pooleren på 5432.')
  process.exit(2)
}
const sql = postgres(url, { max: 1, ssl: 'require', onnotice() {} })

// ── rækkefølge: forældre før børn ────────────────────────────────────
// Vi er ikke superuser, så vi kan ikke slå fremmednøglerne fra under
// indlæsningen (session_replication_role kræver det). Rækkefølgen i filen
// er derfor det eneste, der får indlæsningen til at gå op.
const iPublic = (await sql`
  select table_name t from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'`).map((r) => r.t)

const kanter = await sql`
  select conrelid::regclass::text barn, confrelid::regclass::text foraelder
  from pg_constraint
  where contype = 'f' and connamespace = 'public'::regnamespace
    and conrelid <> confrelid`

const rent = (s) => s.replace(/^public\./, '').replace(/"/g, '')
const venter = new Map(iPublic.map((t) => [t, new Set()]))
for (const k of kanter) {
  const [b, f] = [rent(k.barn), rent(k.foraelder)]
  if (venter.has(b) && venter.has(f)) venter.get(b).add(f)
}
const orden = []
while (venter.size) {
  const klar = [...venter].filter(([, p]) => !p.size).map(([t]) => t).sort()
  if (!klar.length) {
    // Kredsløb i fremmednøglerne. Vi har ingen i dag, men sker det, ville
    // filen ikke kunne læses tilbage i nogen rækkefølge — sig det hellere
    // nu end når basen er væk.
    console.error(`Fremmednøglerne går i ring: ${[...venter.keys()].join(', ')}`)
    process.exit(2)
  }
  for (const t of klar) { orden.push(t); venter.delete(t) }
  for (const [, p] of venter) klar.forEach((t) => p.delete(t))
}

// auth.users først: public.users.auth_user_id peger på den.
const tabeller = [['auth', 'users'], ...orden.map((t) => ['public', t])]

// Kolonnerne skrives udtrykkeligt i filen, så den også kan læses tilbage,
// hvis en kolonne senere skifter plads i tabellen. Genererede kolonner og
// "generated always as identity" kan ikke skrives tilbage og springes over.
const kolonnerFor = async (skema, tabel) => (await sql`
  select column_name k from information_schema.columns
  where table_schema = ${skema} and table_name = ${tabel}
    and is_generated = 'NEVER'
    and (is_identity = 'NO' or identity_generation is distinct from 'ALWAYS')
  order by ordinal_position`).map((r) => `"${r.k}"`)

const plan = []
for (const [skema, tabel] of tabeller) {
  const kolonner = await kolonnerFor(skema, tabel)
  if (kolonner.length) plan.push({ skema, tabel, kolonner })
  else console.log(`  ${skema}.${tabel} — sprunget over, ingen skrivbare kolonner`)
}

// ── hent alt under ét snapshot ────────────────────────────────────────
// Dumpet samles i hukommelsen og skrives først, når hver tabel er hentet.
// To grunde: en afbrudt forbindelse må ikke efterlade en halv fil, og et
// forsøg mere skal kunne starte forfra uden at rydde op. Basen er få MB;
// vokser den til hundreder, skal det laves om til at streame til en
// midlertidig fil i stedet.
const hentAlt = async () => {
  await sql.unsafe('begin isolation level repeatable read read only')
  try {
    const dele = []
    const tal = []
    for (const { skema, tabel, kolonner } of plan) {
      const navn = `"${skema}"."${tabel}"`
      const liste = kolonner.join(', ')
      const bidder = []
      let raekker = 0

      // COPY-tekstformat er én linje pr. række — nylinjer inde i en værdi
      // står som \n. Linjerne ER altså rækketallet, og vi undgår et
      // count(*), der ville se en anden tilstand end kopien.
      const strøm = await sql`copy ${sql.unsafe(navn)} (${sql.unsafe(liste)}) to stdout`.readable()
      for await (const del of strøm) {
        for (let i = 0; i < del.length; i++) if (del[i] === 10) raekker++
        bidder.push(del)
      }

      const data = Buffer.concat(bidder)
      dele.push(`-- ${skema}.${tabel}\ncopy ${navn} (${liste}) from stdin;\n`)
      dele.push(data)
      dele.push('\\.\n\n')
      // Kontrolsummen gør filen selvkontrollerende: en fil, der har taget
      // skade på disken eller under en kopiering, kan afsløres uden at
      // spørge databasen — den er alligevel en anden i morgen.
      tal.push([`${skema}.${tabel}`, raekker, createHash('sha256').update(data).digest('hex')])
      console.log(`  ${`${skema}.${tabel}`.padEnd(24)} ${String(raekker).padStart(6)} rækker`)
    }
    return { dele, tal }
  } finally {
    await sql.unsafe('commit').catch(() => {})
  }
}

// Supavisor lukkede forbindelsen midt i en 31 sekunders COPY under
// afprøvningen. Et enkelt netværkshul må ikke koste dagens backup.
let hentet
for (let forsoeg = 1; ; forsoeg++) {
  try { hentet = await hentAlt(); break } catch (e) {
    if (forsoeg === 3) throw e
    console.log(`  forbindelsen knækkede (${e.code || e.message}) — forsøg ${forsoeg + 1} af 3`)
  }
}
const { dele, tal } = hentet

// ── filen ────────────────────────────────────────────────────────────
const [{ version }] = await sql`select version()`
const stempel = new Date().toISOString().replace(/:/g, '-').slice(0, 19)
await mkdir('backup', { recursive: true })
const sti = `backup/bofinda-${stempel}.sql`
const ud = createWriteStream(sti)
const skriv = async (s) => { if (!ud.write(s)) await once(ud, 'drain') }

await skriv(`-- Bofinda · data-backup ${new Date().toISOString()}
-- ${version.split(' on ')[0]}
--
-- Kun data, intet skema. Lav tabellerne med db/migrations først.
-- Skal læses ind i en TOM base — filen sletter ikke noget selv.
-- Indeholder adgangskode-hashes fra auth.users. Del den ikke.
--
--   psql "$URL" -v ON_ERROR_STOP=1 -f denne-fil.sql

begin;

`)
for (const del of dele) await skriv(del)

// Manifestet står til sidst med vilje: er halen der, nåede dumpet at blive
// færdigt. Et afbrudt dump har ingen hale og kan kendes fra et helt.
// db:backup:proev læser tallene herfra og sammenligner efter indlæsning.
await skriv('\ncommit;\n\n-- ═══ manifest ═══\n')
for (const [n, r, sum] of tal) await skriv(`--   ${n.padEnd(24)} ${String(r).padStart(6)}  ${sum}\n`)
const ialt = tal.reduce((s, [, r]) => s + r, 0)
await skriv(`-- I ALT ${ialt} rækker i ${tal.length} tabeller\n-- FÆRDIG\n`)
await new Promise((ok) => ud.end(ok))

// ── sidefil: hvilke filer lå i bucket'en ─────────────────────────────
// Et SQL-dump kan ikke tage filerne med — de ligger hos Supabase, ikke i
// basen. Listen her er ikke en backup af dem, men den siger præcis hvad
// der manglede, hvis uheldet sker.
const filer = await sql`
  select o.name, o.created_at, (o.metadata->>'size')::bigint stoerrelse, b.name bucket
  from storage.objects o join storage.buckets b on b.id = o.bucket_id
  order by b.name, o.name`
const filsti = `backup/bofinda-${stempel}-filer.txt`
await writeFile(filsti, [
  `# Filer i Supabase Storage ${new Date().toISOString()}`,
  '# Kun en liste. Selve filerne er IKKE med i backuppen — se README.',
  '',
  ...filer.map((f) => `${f.bucket}/${f.name}\t${f.stoerrelse ?? '?'}\t${f.created_at.toISOString()}`),
  '',
  `# ${filer.length} filer, ${(filer.reduce((s, f) => s + Number(f.stoerrelse ?? 0), 0) / 1e6).toFixed(1)} MB i alt`,
].join('\n'))

await sql.end()
const { size } = await stat(sti)
console.log(`\n  ${sti}`)
console.log(`  ${(size / 1e6).toFixed(1)} MB · ${ialt} rækker i ${tal.length} tabeller`)
console.log(`  ${filsti} · ${filer.length} filer i storage (ikke sikret — se README)`)
console.log('\n  Filen indeholder adgangskode-hashes. Læg den et sikkert sted.')
