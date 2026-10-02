// ═══════════════════════════════════════════════════════════════
//  PRØVE · scripts/maal-felter.sql
//
//  Filen køres i produktionen af et menneske. Den kan derfor ikke prøves
//  mod de tal, den skal måle — men den kan prøves mod SKEMAET, og det er
//  dér, de fejl sidder, der vælter en produktionskørsel.
//
//  Første udkast brugte `unnest(l.amenities)` og `l.amenities <> '{}'`.
//  `amenities` er JSONB. Den første fejler med en typefejl; den anden
//  **tier** og giver et forkert tal, fordi `'{}'` er et tomt OBJEKT i
//  jsonb og aldrig lig en tom liste. Den stille af de to er grunden til,
//  at prøven her findes: en SELECT, der kører og svarer forkert, er
//  værre end en, der fejler.
//
//  To ting prøves:
//    1 · hver sætning PARSER og KØRER mod de rigtige migrationer, og
//        regner rigtigt på et forlæg med facit skrevet i hånden først.
//    2 · de fem filtrerbare ord i filen er PRÆCIS `Facilitetsord`.
//        Listen i spørgsmål 3 er skrevet af fra lib/faciliteter.ts og er
//        dermed det andet udtryk for samme spørgsmål — CLAUDE.mds
//        «svarer to udtryk på det samme spørgsmål, skal de beregnes ét
//        sted». Her KAN de ikke beregnes ét sted, for SQL'en skal kunne
//        pastes uden en checkout. Så tælles der efter i stedet.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { FACILITET } from '../lib/faciliteter'

const FIL = 'scripts/maal-felter.sql'
let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

async function koer(s: string): Promise<Record<string, unknown>[]> {
  const svar = (await db.execute(sql.raw(s))) as unknown
  return (Array.isArray(svar) ? svar : (svar as { rows: unknown[] }).rows) as Record<string, unknown>[]
}

const raa = readFileSync(FIL, 'utf8')
// Kommentarlinjer ud, så semikolon i prosaen ikke tæller som et skel.
const saetninger = raa
  .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  .split(';').map((s) => s.trim()).filter(Boolean)

console.log('\n══ 1 · filen er tre skrivebeskyttede sætninger ══')
tjek('tre sætninger', saetninger.length === 3, `${saetninger.length} fundet`)
tjek('alle er select', saetninger.every((s) => s.toLowerCase().startsWith('select')))
tjek('ingen DDL eller DML',
  !/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i.test(saetninger.join('\n')))

// ─── Forlægget. Facit udregnet i hånden FØR sætningerne blev kørt. ───
//
//   To kilder, fire aktive boliger, én afmeldt (skal IKKE tælles).
//   K1 «Alfa»:  B1 alle syv felter sat, amenities ['altan','elevator']
//               B2 ingen af de syv, amenities []
//   K2 «Beta»:  B3 kun deposit, amenities ['altan','ukendt ord']
//               B4 kun floor+door, amenities ['elevator']
//               B5 DELISTED, alt sat — uden for målingen
//
//   → 1: Alfa 2 aktive · pct_amenities 50,0 · pct_floor 50,0 · pct_deposit 50,0
//        Beta 2 aktive · pct_amenities 100,0 · pct_floor 50,0 · pct_deposit 50,0
//   → 2: altan 2 (2 kilder) · elevator 2 (2 kilder) · «ukendt ord» 1 (1 kilde)
//   → 3: distinkte 3, heraf ufiltrerbare 1 («ukendt ord»)
const S1 = '11111111-0000-0000-0000-00000000000a'
const S2 = '11111111-0000-0000-0000-00000000000b'

async function saa() {
  await db.execute(sql`insert into sources (id, slug, name, source_type) values
    (${S1}, 'maalfelt-alfa', 'Alfa', 'spider'),
    (${S2}, 'maalfelt-beta', 'Beta', 'spider')`)
  const b = (n: number, kilde: string, status: string) => sql`
    (${`44444444-0000-0000-0000-00000000000${n}`}, ${kilde}, 'spider',
     ${`k${n}`}, ${`https://proeve.invalid/${n}`}, ${`Vej ${n}, 2300`}, ${status})`
  await db.execute(sql`insert into listings
    (id, source_id, source_type, external_key, source_url, address_raw, status) values
    ${b(1, S1, 'active')}, ${b(2, S1, 'active')}, ${b(3, S2, 'active')},
    ${b(4, S2, 'active')}, ${b(5, S2, 'delisted')}`)
  const sæt = (n: number, felter: string) => db.execute(sql.raw(
    `update listings set ${felter} where external_key = 'k${n}'`))
  await sæt(1, `floor = '2', door = 'th', deposit = 3000000, prepaid_rent = 1000000,
               move_in_cost = 4000000, open_house_at = now(),
               amenities = '["altan","elevator"]'::jsonb`)
  await sæt(2, `amenities = '[]'::jsonb`)
  await sæt(3, `deposit = 2000000, amenities = '["altan","ukendt ord"]'::jsonb`)
  await sæt(4, `floor = '1', door = 'tv', amenities = '["elevator"]'::jsonb`)
  await sæt(5, `floor = '9', door = 'mf', deposit = 9000000, prepaid_rent = 9000000,
                move_in_cost = 9000000, open_house_at = now(),
                amenities = '["altan","elevator","ukendt ord"]'::jsonb`)
}

console.log('\n══ 2 · sætningerne mod et forlæg med facit skrevet først ══')
{
  await saa()
  const q1 = await koer(saetninger[0]!)
  tjek('1 · to kilderækker', q1.length === 2, q1.map((r) => `${r.kilde}:${r.aktive}`).join(' '))
  const alfa = q1.find((r) => r.kilde === 'Alfa')
  const beta = q1.find((r) => r.kilde === 'Beta')
  const n = (v: unknown) => Number(v)
  tjek('1 · Alfa: 2 aktive, 50 % amenities, 50 % deposit',
    n(alfa?.aktive) === 2 && n(alfa?.pct_amenities) === 50 && n(alfa?.pct_deposit) === 50,
    JSON.stringify(alfa))
  // Beta beviser, at den afmeldte er UDE: med B5 ville aktive vaere 3.
  tjek('1 · Beta: 2 aktive (den afmeldte er ude), 100 % amenities',
    n(beta?.aktive) === 2 && n(beta?.pct_amenities) === 100, JSON.stringify(beta))
  tjek('1 · Beta: 50 % floor, 0 % openhouse',
    n(beta?.pct_floor) === 50 && n(beta?.pct_openhouse) === 0, JSON.stringify(beta))

  const q2 = await koer(saetninger[1]!)
  const ord = new Map(q2.map((r) => [String(r.ord), Number(r.forekomster)]))
  tjek('2 · tre ord, og den afmeldtes ord tælles ikke',
    q2.length === 3, [...ord].map(([o, f]) => `${o}:${f}`).join(' '))
  tjek('2 · altan 2 · elevator 2 · «ukendt ord» 1',
    ord.get('altan') === 2 && ord.get('elevator') === 2 && ord.get('ukendt ord') === 1)
  tjek('2 · altan står hos BEGGE kilder',
    Number(q2.find((r) => r.ord === 'altan')?.kilder) === 2)

  const q3 = await koer(saetninger[2]!)
  tjek('3 · 3 distinkte ord, 1 ufiltrerbart',
    Number(q3[0]?.distinkte_ord) === 3 && Number(q3[0]?.ufiltrerbare) === 1,
    JSON.stringify(q3[0]))
}

console.log('\n══ 3 · konventionen gælder HVER måle-SQL ══')
{
  // CLAUDE.md: «uprøvet» er ikke én tilstand. En fil, der skal køres i
  // produktionen, skal sige HVILKEN af de to den er — ellers skal
  // læseren gætte, om tallene bare er usete, eller om sætningerne
  // aldrig har mødt en parser.
  //
  // Tjekket står her og ikke som en vane, fordi netop denne fil var ét
  // `<> '{}'` fra at svare forkert og tavst i en produktionskørsel.
  const { readdirSync } = await import('node:fs')
  const filer = readdirSync('scripts')
    .filter((f) => f.startsWith('maal-') && f.endsWith('.sql'))
  tjek('der ER måle-SQL\'er at holde op mod konventionen', filer.length > 0,
    filer.join(', '))
  for (const f of filer) {
    const hoved = readFileSync(`scripts/${f}`, 'utf8').split('\n').slice(0, 40).join('\n')
    const seteTal = /TALLENE ER ALDRIG SET/i.test(hoved)
    const koertMod = /koert mod produktionen|kørt mod produktionen/i.test(hoved)
    tjek(`  ${f} erklærer sin tilstand`, seteTal || koertMod,
      seteTal || koertMod ? (seteTal ? 'tallene er aldrig set' : 'kørt mod produktionen')
        : 'mangler «TALLENE ER ALDRIG SET» eller en erklæring om en kørsel')
    // Den første slags skal navngive den prøve, der kørte sætningerne.
    // Uden den er «syntaks og typer holder» en påstand uden dækning.
    if (seteTal) {
      tjek(`  ${f} navngiver prøven, der kørte sætningerne`,
        /scripts\/test-[\w-]+\.ts/.test(hoved))
    }
    tjek(`  ${f} siger at den er skrivebeskyttet`, /SKRIVEBESKYTTET/.test(hoved))
  }
}

console.log('\n══ 4 · ordlisten i filen ER Facilitetsord ══')
{
  // Spørgsmål 3's `not in (…)` er en AFSKRIFT af lib/faciliteter.ts.
  // Den kan ikke beregnes ét sted — SQL'en skal kunne pastes uden en
  // checkout — så her tælles der efter i stedet.
  const iKoden = new Set<string>(Object.values(FACILITET).flat())
  const blok = saetninger[2]!.match(/not in \(([\s\S]*?)\)/)
  tjek('listen findes i spørgsmål 3', blok != null)
  const iFilen = new Set((blok?.[1] ?? '').match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [])
  const mangler = [...iKoden].filter((o) => !iFilen.has(o))
  const ekstra = [...iFilen].filter((o) => !iKoden.has(o))
  tjek(`samme antal (${iKoden.size})`, iFilen.size === iKoden.size, `filen har ${iFilen.size}`)
  tjek('intet ord mangler i filen', mangler.length === 0, mangler.join(', '))
  tjek('filen har ingen ord, koden ikke kender', ekstra.length === 0, ekstra.join(', '))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
