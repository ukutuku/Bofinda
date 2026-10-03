// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  Prøver `scripts/maal-billedloft.sql` — den SQL, der skal køres i
//  produktionen for at kende billedbestanden før en hemmelighedsrotation.
//
//  Filen navngiver denne prøve som grundlag for syntaks og typer.
//  Produktionens tal er ikke målt her. Uden den er «syntaks og typer holder» en
//  påstand uden dækning — og `maal-felter.sql` var ét `<> '{}'` fra at
//  svare forkert og TAVST i en produktionskørsel.
//
//  ── FACIT ER SKREVET I HÅNDEN FØRST ──────────────────────────
//  Forlægget er valgt, så de to ændringer fra CLAUDE.md's forespørgsel
//  hver især kan være forkerte og bliver fanget:
//
//    · UDEN `distinct` ville dacas give 4 i stedet for 3
//    · UDEN `status = 'active'` ville findbolig give 2 i stedet for 1
//
//  En prøve, hvor begge fejl gav samme tal, ville bestå med én af dem
//  genindført. Derfor rammer de to forskellige værter og forskellige
//  tal — og begge mutationer prøves nedenfor.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'

const start = performance.now()
let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const FIL = 'scripts/maal-billedloft.sql'
const raa = readFileSync(FIL, 'utf8')
// Kommentarlinjer ud, så sætningerne kan køres hver for sig.
const saetninger = raa
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  .split(';').map((s) => s.trim()).filter(Boolean)

console.log('\n══ 1 · filen er to skrivebeskyttede sætninger ══')
tjek('to sætninger', saetninger.length === 2, `${saetninger.length} fundet`)
tjek('begge er select', saetninger.every((s) => s.toLowerCase().startsWith('select')))
tjek('ingen DDL eller DML',
  !/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(saetninger.join('\n')))

// ─── Forlægget. Facit UDREGNET I HÅNDEN før sætningerne blev kørt. ───
//
//   S1 = dacas.dk · S2 = findbolig.nu
//
//   L1 active  (S1)  dacas.dk/1.jpg · dacas.dk/2.jpg
//   L2 active  (S1)  dacas.dk/2.jpg ← SAMME som L1 · dacas.dk/3.jpg
//   L3 active  (S2)  findbolig.nu/a.jpg
//   L4 delisted(S2)  findbolig.nu/b.jpg · findbolig.nu/a.jpg
//
//   dacas.dk      rækker 4 · distinkte 3 (1,2,3) · boliger 2
//   findbolig.nu  rækker 1 · distinkte 1 (a)     · boliger 1
//                 b.jpg hører til den AFMELDTE og må ikke med
//   i alt         distinkte 4 · boliger med billeder 3
const FACIT = {
  dacas: { distinkte: 3, raekker: 4, boliger: 2 },
  findbolig: { distinkte: 1, raekker: 1, boliger: 1 },
  ialt: { distinkte: 4, boliger: 3 },
}

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const L = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`

await db.execute(sql`insert into sources (id, slug, name, source_type) values
  (${S1}::uuid, 'proev-dacas', 'Prøve-Dacas', 'spider'),
  (${S2}::uuid, 'proev-findbolig', 'Prøve-findbolig', 'feed')`)
const b = (n: number, s: string, status: string) => sql`(${L(n)}::uuid, ${s}::uuid,
  ${n <= 2 ? 'spider' : 'feed'}, ${`k${n}`}, ${`https://proeve.invalid/${n}`},
  ${`Vej ${n}, 2300`}, ${status})`
await db.execute(sql`insert into listings
  (id, source_id, source_type, external_key, source_url, address_raw, status) values
  ${b(1, S1, 'active')}, ${b(2, S1, 'active')}, ${b(3, S2, 'active')},
  ${b(4, S2, 'delisted')}`)
const img = (l: number, u: string, p: number) => sql`(${L(l)}::uuid, ${u}, ${p})`
await db.execute(sql`insert into listing_images (listing_id, external_url, position) values
  ${img(1, 'https://dacas.dk/1.jpg', 0)}, ${img(1, 'https://dacas.dk/2.jpg', 1)},
  ${img(2, 'https://dacas.dk/2.jpg', 0)}, ${img(2, 'https://dacas.dk/3.jpg', 1)},
  ${img(3, 'https://findbolig.nu/a.jpg', 0)},
  ${img(4, 'https://findbolig.nu/b.jpg', 0)}, ${img(4, 'https://findbolig.nu/a.jpg', 1)}`)

type Raekke = Record<string, unknown>
// Svaret har to former: postgres-js giver en array-lignende RowList, PGlite
// giver `{ rows }`. Typen er postgres-js', saa `.rows` oversaetter ikke — og
// det fangede `npm test` IKKE, fordi hverken tsx eller esbuild typetjekker.
// Den samme form som i scripts/test-maal-felter.ts, af samme grund.
async function koer(s: string): Promise<Raekke[]> {
  const svar = (await db.execute(sql.raw(s))) as unknown
  return (Array.isArray(svar) ? svar : (svar as { rows: unknown[] }).rows) as Raekke[]
}

console.log('\n══ 2 · sætning 1: bestanden pr. vært ══')
const pr = await koer(saetninger[0]!)
const find = (v: string) => pr.find((r) => r['vaert'] === v)
const d = find('dacas.dk'), f = find('findbolig.nu')
tjek('kun de to værter med aktive boliger', pr.length === 2,
  pr.map((r) => r['vaert']).join(', '))
tjek(`dacas.dk: ${FACIT.dacas.distinkte} distinkte af ${FACIT.dacas.raekker} rækker`,
  Number(d?.['distinkte_billeder']) === FACIT.dacas.distinkte
  && Number(d?.['billedraekker']) === FACIT.dacas.raekker,
  `${d?.['distinkte_billeder']} af ${d?.['billedraekker']}`)
tjek('… og 2 boliger deler det ene billede',
  Number(d?.['aktive_boliger']) === FACIT.dacas.boliger, String(d?.['aktive_boliger']))
tjek(`findbolig.nu: ${FACIT.findbolig.distinkte} distinkt — den AFMELDTES billede er ude`,
  Number(f?.['distinkte_billeder']) === FACIT.findbolig.distinkte,
  `${f?.['distinkte_billeder']} (2 ville betyde at den afmeldte tælles med)`)

console.log('\n══ 3 · sætning 2: bestanden i alt ══')
const ialt = (await koer(saetninger[1]!))[0]!
tjek(`${FACIT.ialt.distinkte} distinkte billeder i alt`,
  Number(ialt['distinkte_billeder_i_alt']) === FACIT.ialt.distinkte,
  String(ialt['distinkte_billeder_i_alt']))
tjek(`${FACIT.ialt.boliger} aktive boliger med billeder`,
  Number(ialt['aktive_boliger_med_billeder']) === FACIT.ialt.boliger,
  String(ialt['aktive_boliger_med_billeder']))

// ─── Modprøven: begge ændringer kan fjernes, og begge skal mærkes ───
console.log('\n══ 4 · modprøve: hver ændring for sig ══')
const udenDistinct = saetninger[0]!.replace('count(distinct i.external_url)', 'count(i.external_url)')
const udenAktiv = saetninger[0]!.replace("where l.status = 'active'", 'where true')
const d2 = (await koer(udenDistinct)).find((r) => r['vaert'] === 'dacas.dk')
const f2 = (await koer(udenAktiv)).find((r) => r['vaert'] === 'findbolig.nu')
tjek('UDEN distinct giver dacas 4 i stedet for 3 — altså måler distinct noget',
  Number(d2?.['distinkte_billeder']) === 4, String(d2?.['distinkte_billeder']))
tjek('UDEN status-filteret giver findbolig 2 i stedet for 1 — altså måler det noget',
  Number(f2?.['distinkte_billeder']) === 2, String(f2?.['distinkte_billeder']))

console.log(`\n  (${Math.round(performance.now() - start)} ms)`)
console.log(fejl === 0 ? '  ALT GRØNT\n' : `  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
