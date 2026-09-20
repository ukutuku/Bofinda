// ═══════════════════════════════════════════════════════════════
//  Migrationerne, kørt som drizzle-kit faktisk kører dem.
//
//  `drizzle-kit migrate` lægger ALLE ventende migrationer i ÉN
//  transaktion (drizzle-orm/pg-core/dialect: `session.transaction(...)`
//  om hele listen). Vores egne hjælpere gør det modsatte: både
//  `koerMigrationer()` i scripts/pglite-skema.mjs og cloud-klargøringen
//  kører filerne hver for sig.
//
//  Forskellen er ikke teoretisk. `alter type ... add value` er TILLADT
//  i en transaktion, men den nye værdi må ikke BRUGES i samme
//  transaktion — «unsafe use of new value». Kører man filerne enkeltvis,
//  committer hver fil for sig, og fælden bider aldrig. 0021 måtte omgå
//  den, og 0026 måtte omgå den igen; begge gange blev det opdaget ved
//  håndkraft, fordi ingen prøve dækkede det.
//
//  Den her prøve dækker det. Den rejser en tom base, kører journalens
//  migrationer i ÉN transaktion og fejler, hvis det ikke kan lade sig
//  gøre — altså præcis dét, en deploy mod en frisk base ville gøre.
//
//      tsx scripts/test-migrationer.ts
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { stubSupabase } from './pglite-skema.mjs'
import { UAFSLUTTET, koebStatusEnum } from '../db/schema'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

const MAPPE = 'db/migrations'
function migrationer(): { tag: string; sql: string }[] {
  const journal = JSON.parse(readFileSync(`${MAPPE}/meta/_journal.json`, 'utf8')).entries as
    { tag: string }[]
  const filer = readdirSync(MAPPE).filter((f) => f.endsWith('.sql'))
  return journal.map((p) => {
    const fil = filer.find((f) => f.startsWith(p.tag))
    if (!fil) throw new Error(`journalen nævner ${p.tag}, men filen mangler`)
    return { tag: p.tag, sql: readFileSync(`${MAPPE}/${fil}`, 'utf8') }
  })
}

console.log('\n══ migrationerne i ÉN transaktion ══')
{
  const pg = await PGlite.create()
  await stubSupabase(pg)
  const alle = migrationer()
  let faldt: string | null = null
  try {
    await pg.exec('begin')
    for (const m of alle) {
      try {
        await pg.exec(m.sql)
      } catch (e) {
        faldt = `${m.tag}: ${(e as Error).message}`
        break
      }
    }
    if (!faldt) await pg.exec('commit')
    else await pg.exec('rollback')
  } catch (e) {
    faldt = faldt ?? (e as Error).message
  }
  tjek(`alle ${alle.length} migrationer kører i én transaktion`, faldt === null,
    faldt ?? '')

  if (!faldt) {
    // ── OG BASEN ER DEN SAMME ────────────────────────────────
    // En transaktion, der går igennem, er ikke nok: den skal give det
    // samme skema som fil-for-fil-vejen, ellers måler `npm test` noget
    // andet end en deploy bygger.
    const enFor = await pg.query<{ n: string }>(
      "select enumlabel as n from pg_enum e join pg_type t on t.oid = e.enumtypid "
      + "where t.typname = 'koeb_status' order by e.enumsortorder")
    tjek('  og koeb_status har sine fem værdier i rækkefølge',
      enFor.rows.map((r) => r.n).join(',') === koebStatusEnum.enumValues.join(','),
      enFor.rows.map((r) => r.n).join(','))

    // ── ÉN KILDE TIL «UAFSLUTTET» ────────────────────────────
    // Listen i db/schema.ts og indekspraedikatet i basen svarer på det
    // SAMME spørgsmål. De kan ikke udledes af hinanden — det ene er
    // TypeScript, det andet er SQL — så prøven binder dem sammen.
    const idx = await pg.query<{ d: string }>(
      "select indexdef as d from pg_indexes where indexname = 'checkout_uafsluttet_pr_bruger'")
    const def = idx.rows[0]?.d ?? ''
    tjek('  det delvise indeks findes', !!def, def)
    const iPraedikatet = [...koebStatusEnum.enumValues]
      .filter((v) => new RegExp(`'${v}'`).test(def.slice(def.indexOf('WHERE'))))
    tjek('  og dets praedikat er PRÆCIS UAFSLUTTET',
      iPraedikatet.join(',') === [...UAFSLUTTET].join(','),
      `base=[${iPraedikatet}] kode=[${[...UAFSLUTTET]}]`)
  }
  if (!faldt) {
    // ── INDEKSETS NYE HALVDEL HAANDHAEVER FAKTISK ────────────
    // 0026 udvidede `checkout_uafsluttet_pr_bruger` fra kun `aaben`
    // til BEGGE uafsluttede tilstande. Den nye halvdel var ikke prøvet
    // noget sted: kodevagten `gennemfoert_findes` kaster FØR
    // indsættelsen, og kapløbsprøven kapløber kun på `aaben`. Et
    // praedikat, ingen har målt, kan være forkert uden at noget siger
    // fra — så her går vi uden om koden og skriver direkte i basen.
    await pg.exec(`insert into auth.users (id, email)
      values ('11111111-1111-1111-1111-111111111111', 'idx@proeve.invalid')`)
    const u = await pg.query<{ id: string }>(
      `insert into users (email, auth_user_id)
       values ('idx@proeve.invalid', '11111111-1111-1111-1111-111111111111')
       returning id`)
    const bruger = u.rows[0]!.id
    const laeg = (status: string) => pg.exec(
      `insert into checkout_forsoeg (user_id, pris_id, status, udloeber_at)
       values ('${bruger}', 'price_x', '${status}', now() + interval '1 hour')`)

    await laeg('gennemfoert')
    let afvist = false
    try { await laeg('aaben') } catch { afvist = true }
    tjek('  et AABENT køb afvises, mens et GENNEMFOERT står', afvist)
    afvist = false
    try { await laeg('gennemfoert') } catch { afvist = true }
    tjek('  og et gennemført nummer to afvises også', afvist)
    // De terminale er ikke omfattet — kontoen skal kunne købe igen.
    let gik = true
    try { await laeg('afbrudt'); await laeg('udloebet'); await laeg('betalt') }
    catch { gik = false }
    tjek('  men de TERMINALE spærrer ikke — kontoen må købe igen', gik)
  }

  await pg.close()
}

console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
