#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Isolationsvagten: de tre signaler, og at alle kaldere går gennem den.
//
//  Kører under almindelig `node` og rører ingen database. De tre krav i
//  scripts/cloud/isoleret.mjs er RENE funktioner netop derfor — de tager
//  tal og svar, kalderen har hentet.
//
//  ── DEN STRUKTURELLE DEL ──────────────────────────────────────
//
//  Den vigtigste prøve her er ikke, at vagten virker, men at der ikke
//  kommer en kopi mere. Vagten fandtes i ni kopier i fire stavemåder, og
//  seks forbindelser havde ingen — det var MÆNGDEN, der skabte hullerne.
//
//  `TILLADT_EGEN_FORBINDELSE` er en allowlist, der skal SKRINKE. Den
//  rummer de ni, der endnu har deres egen kopi. Prøven fejler også, hvis
//  en fil på listen IKKE længere har sin egen forbindelse — så listen kan
//  ikke blive stående som et fossil, når flytningen er gjort.
//
//  Scanneren læser hele filen og er IKKE linjeforankret. CLAUDE.md's
//  `linjeankeret` er netop den fælde: et `^` gør en scanner til en
//  linjescanner, og modprøven bestod, fordi kopien havde to nøgler på
//  samme linje.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  Isolationsfejl, LOFT, TESTBASE,
  kraevIsoleretUrl, kraevLilleBase, kraevSammeBase,
} from './cloud/isoleret.mjs'

let fejl = 0
const tjek = (navn, ok, note = '') => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}\n`)
  if (!ok) fejl++
}
/** Kastede den en Isolationsfejl? Returnerer beskeden, ellers null. */
const kaster = (f) => {
  try { f(); return null } catch (e) {
    return e instanceof Isolationsfejl ? e.message : `FORKERT FEJLTYPE: ${e.name}`
  }
}

const TEST_URL = `postgres://bofinda_test:x@127.0.0.1:${TESTBASE.port}/${TESTBASE.database}?sslmode=disable`

process.stdout.write('══ Isolationsvagten ══\n\n── signal 1 · formen ──\n')

tjek('testbasens egen URL slipper igennem', kaster(() => kraevIsoleretUrl(TEST_URL)) === null,
  String(kaster(() => kraevIsoleretUrl(TEST_URL))))
for (const [navn, u] of [
  ['transaction-pooleren (6543)', 'postgresql://postgres.abcdefghijklmnopqrst:k@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'],
  ['session-pooleren (5432)', 'postgresql://postgres.abcdefghijklmnopqrst:k@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'],
  ['direct (db.<ref>.supabase.co)', 'postgresql://postgres:k@db.abcdefghijklmnopqrst.supabase.co:5432/postgres'],
]) tjek(`produktionens ${navn} afvises`, kaster(() => kraevIsoleretUrl(u)) !== null)

tjek('ingen URL afvises — der er ingen standardbase',
  (kaster(() => kraevIsoleretUrl('')) ?? '').includes('ingen DATABASE_URL'))
tjek('en streng, der ikke er en URL, afvises', kaster(() => kraevIsoleretUrl('ikke en url')) !== null)

// Suffiksmatchet var fejlen i to kopier: `pathname.endsWith('bofinda_test')`.
tjek('/prod_bofinda_test afvises — suffiksmatchet var fejlen',
  kaster(() => kraevIsoleretUrl(`postgres://u:p@127.0.0.1:${TESTBASE.port}/prod_bofinda_test`)) !== null)
// Og den omvendte: en fremmed vaert paa den rigtige port med det rigtige
// navn. Det var hullet i den kopi, der ikke tjekkede vaert overhovedet.
tjek('en fremmed vært på 55432/bofinda_test afvises — værten manglede i én kopi',
  kaster(() => kraevIsoleretUrl(`postgres://u:p@10.0.0.7:${TESTBASE.port}/${TESTBASE.database}`)) !== null)
for (const v of TESTBASE.vaerter) {
  tjek(`${v} tælles som loopback`,
    kaster(() => kraevIsoleretUrl(`postgres://u:p@${v}:${TESTBASE.port}/${TESTBASE.database}`)) === null)
}
tjek('beskeden navngiver hvad den SÅ — ikke bare at det var forkert',
  (kaster(() => kraevIsoleretUrl('postgres://u:p@example.invalid:5432/prod')) ?? '').includes('example.invalid:5432/prod'))

process.stdout.write('\n── signal 2 · serverens eget svar ──\n')
tjek('serveren bekræfter navn og port', kaster(() =>
  kraevSammeBase({ database: TESTBASE.database, port: Number(TESTBASE.port) })) === null)
tjek('serveren siger et andet basenavn → afvist', kaster(() =>
  kraevSammeBase({ database: 'postgres', port: Number(TESTBASE.port) })) !== null)
tjek('serveren siger en anden port → afvist', kaster(() =>
  kraevSammeBase({ database: TESTBASE.database, port: 5432 })) !== null)
tjek('intet svar → afvist, ikke accepteret', kaster(() => kraevSammeBase(null)) !== null)
// DET er hele pointen med signal 2: URL'en kan passere og alligevel lyve.
tjek('URL\'en kan passere signal 1 og stadig fanges af signal 2',
  kaster(() => kraevIsoleretUrl(TEST_URL)) === null
  && kaster(() => kraevSammeBase({ database: 'postgres', port: 6543 })) !== null)

process.stdout.write('\n── signal 3 · indholdet ──\n')
tjek('et lille sæt slipper igennem', kaster(() => kraevLilleBase({ listings: 280 })) === null)
tjek(`over loftet (${LOFT}) afvises`, kaster(() => kraevLilleBase({ listings: LOFT + 1 })) !== null)
tjek('loftet nævner tabellen og tallet',
  (kaster(() => kraevLilleBase({ listings: 10000 })) ?? '').includes('10000 listings'))
tjek('ét felt over loftet er nok, selv om de andre er små',
  kaster(() => kraevLilleBase({ listings: 10, users: LOFT + 1 })) !== null)
tjek('og de tre signaler er UAFHÆNGIGE: alle tre kan passere hver for sig og sagen stadig være gal',
  kaster(() => kraevIsoleretUrl(TEST_URL)) === null
  && kaster(() => kraevSammeBase({ database: TESTBASE.database, port: 55432 })) === null
  && kaster(() => kraevLilleBase({ listings: 10000 })) !== null)

// ═══ Den strukturelle del ═══
process.stdout.write('\n── alle kaldere går gennem vagten ──\n')

/**
 * De ni, der endnu har deres EGEN kopi af vagten — med et PRÆCIST ANTAL.
 *
 * Listen skal SKRINKE. Prøven fejler også, hvis en post har et andet
 * antal end erklæret, så den ikke kan blive et fossil.
 *
 * ── HVORFOR ET ANTAL OG IKKE ET JA/NEJ ────────────────────────
 *
 * Her stod et `Set`, altså «har filen en egen forbindelse?». Modprøven
 * `isolationsvagt-kortkontrol.mjs` SLAP IGENNEM: filen har to blokke, og
 * den stod på listen for den FØRSTE bloks skyld. En ny forbindelse i den
 * anden ændrede ikke svaret på et ja/nej-spørgsmål, så prøven blev grøn
 * om den fejl, hastesagen netop rettede.
 *
 * Det er CLAUDE.md's `de-tilfældigt-ens`: prøven og facit var enige af
 * en anden grund end den, der blev målt. Et antal kan ikke være enigt
 * ved et tilfælde.
 */
const TILLADT_EGEN_FORBINDELSE = new Map([
  ['browserkontrol.mjs', 1], ['browserkontrol-pagination.mjs', 1],
  ['filterkontrol.mjs', 1], ['fotokontrol.mjs', 1], ['klargoer.mjs', 1],
  ['kortkontrol.mjs', 1], ['lancering.mjs', 1], ['saa.mjs', 1],
  ['skaerm.mjs', 1],
])
/** De seks, hastesagen flyttede. De må IKKE have en egen forbindelse. */
const SKAL_GENNEM_MODULET = [
  'beliggenhedkontrol.mjs', 'indflytningkontrol.mjs', 'kortsynk.mjs',
  'lysbordkontrol.mjs', 'mobilforenkling.mjs',
]

/**
 * Filens KODE, uden kommentarer.
 *
 * Den her funktion kom af, at prøven fejlede på sin egen rettelse: den
 * forbudte form `set move_in_cost = null` står CITERET i en kommentar i
 * kortkontrol.mjs, hvor den forklarer, hvad der blev rettet. En scanner,
 * der ikke skelner kode fra kommentar, læser forklaringen som fejlen —
 * og så kan man ikke dokumentere en rettelse uden at bryde prøven.
 *
 * Det er `linjeankeret`s nabo i CLAUDE.md: scanneren så på det rigtige
 * sted og læste det forkerte dér.
 */
const kode = (sti) => readFileSync(sti, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blokkommentarer
  .replace(/(^|[^:])\/\/.*$/gm, '$1')   // linjekommentarer, men ikke «://»

const ROD = 'scripts/cloud'
const filer = readdirSync(ROD).filter((n) => n.endsWith('.mjs') && n !== 'isoleret.mjs')
// Hele filens indhold, ikke linje for linje. Se noten om `linjeankeret`.
/** ANTAL egne forbindelser, ikke om der er nogen. Se noten ved listen. */
const antalForbindelser = (n) => (kode(join(ROD, n)).match(/\bpostgres\s*\(/g) ?? []).length
const egenForbindelse = (n) => antalForbindelser(n) > 0
const gaarGennemModulet = (n) => /from '\.\/isoleret\.mjs'/.test(kode(join(ROD, n)))

const uventede = filer.filter((n) => egenForbindelse(n) && !TILLADT_EGEN_FORBINDELSE.has(n))
tjek('ingen NY fil åbner sin egen forbindelse', uventede.length === 0, uventede.join(' ') || 'ingen')

// Antallet skal stemme PRÆCIST — både ned (en post er flyttet, listen er
// et fossil) og OP (en kopi mere er sneget sig ind i en fil, der allerede
// havde én). Det sidste er det, modprøven afslørede at et Set ikke kunne.
const afvigende = [...TILLADT_EGEN_FORBINDELSE].filter(([n, ventet]) =>
  !filer.includes(n) || antalForbindelser(n) !== ventet)
tjek('hver post på allowlisten har PRÆCIST det erklærede antal',
  afvigende.length === 0,
  afvigende.map(([n, v]) => `${n}: ventet ${v}, fandt ${filer.includes(n) ? antalForbindelser(n) : '(fil væk)'}`).join(' · ') || 'ingen')

for (const n of SKAL_GENNEM_MODULET) {
  tjek(`${n} går gennem modulet og har ingen egen forbindelse`,
    gaarGennemModulet(n) && !egenForbindelse(n),
    `modul=${gaarGennemModulet(n)} egen=${egenForbindelse(n)}`)
}
// kortkontrol har TO blokke: den første beholder sin kopi til oprydningen,
// den anden er flyttet. Derfor begge udsagn om netop den fil.
tjek('kortkontrol.mjs går gennem modulet OG har PRÆCIST sin ene gamle kopi',
  gaarGennemModulet('kortkontrol.mjs') && antalForbindelser('kortkontrol.mjs') === 1,
  `${antalForbindelser('kortkontrol.mjs')} forbindelse(r)`)

// Gendannelsen: den tabsgivende form må ikke komme tilbage.
const kk = kode(join(ROD, 'kortkontrol.mjs'))
tjek('gendannelsen skriver ikke hardkodet null/false tilbage',
  !/set move_in_cost = null/.test(kk) && !/set images_may_differ = false/.test(kk))
tjek('… men gendanner til det fangede', /set move_in_cost = \$\{f\.move_in_cost\}/.test(kk))

process.stdout.write(fejl ? `\n${fejl} FEJL\n` : '\nAlle prøver bestået.\n')
process.exit(fejl ? 1 : 0)
