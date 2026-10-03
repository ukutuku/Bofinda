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

import { existsSync, readFileSync } from 'node:fs'
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
    //
    // ── CITATET SKAL OPLØSES, IKKE BLOT HAVE DEN RIGTIGE FORM ───
    //  Første udgave prøvede kun, at hovedet indeholdt NOGET med formen
    //  `scripts/test-<noget>.ts`. Den efterprøvede ikke, at filen
    //  findes. Målt: et hoved, der citerede `scripts/test-findes-ikke.ts`,
    //  stod GRØNT. Kravet gemte altså et citat, og intet opløste det.
    //
    //  Det er ANDEN INSTANS af samme form inden for ét døgn. Den første
    //  var `imagesMayDiffer`, som gemte `true` uden det tekstspænd, det
    //  kom fra; rettelsen dér var at gemme spændet OG lade `belaegHolder`
    //  efterprøve, at spændet indeholder faktummet. Her er attesten et
    //  filnavn, og `existsSync` er dens `belaegHolder`.
    //
    //  **Den første blev fundet af en anden læser, ikke af den, der
    //  skrev den.** Begge gange skrev jeg vagten og så ikke, at den
    //  manglede sin anden halvdel.
    //
    //  ── DEN TREDJE FINDES, OG DEN ER STØRRE END DE TO ───────────
    //  `docs/kildetilladelser.md` gemmer kildenavne, værter og endpoints,
    //  og **intet følger dem til adapterne**. Git & Releases skranke —
    //  «hver kørende kilde skal kunne placeres i tabellen, og placeringen
    //  skal følge af registret» — er ikke bygget. Samme form som de to
    //  her, bare større: en henvisning gemt i dokumentation, aldrig slået
    //  op i koden. Den har en ejer, så «led efter den tredje» er ikke en
    //  opfordring uden adresse.
    //
    //  Og formen er bredere end stier. Et filter, der leder efter
    //  litterale filstier uden et `existsSync` i nærheden, svarer om
    //  STIER — ikke om formen. «Gem en henvisning, følg den aldrig»
    //  dækker også nøgler, id'er, værtsnavne og kolonnenavne. Et
    //  «ingenting» fra et sti-filter er derfor ikke et nej.
    //
    //  ── ET FJERDE LED, OG DET HAR SIT EGET MODTRÆK ──────────────
    //  «Hent genstanden frem for at citere fra hukommelsen» er det tredje
    //  led, og det er rigtigt. Det er ikke nok.
    //
    //  Målt på mig selv: jeg skulle citere en doc-kommentar ordret og
    //  hentede filen frem for at huske den — men hentede en ref, der var
    //  overhalet 23 timer før. Citatet var ordret korrekt om en version,
    //  der ikke fandtes længere.
    //
    //  De to led har FORSKELLIGE modtræk, og det er hele værdien af at
    //  holde dem adskilt:
    //
    //      hukommelse → genstand      «hent den»
    //      genstand   → NUVAERENDE    «tjek tidsstemplet»
    //
    //  «Hent den» ville ikke have hjulpet her, for det gjorde jeg. Samlet
    //  under «vær omhyggelig» forsvinder forskellen, og så fanger man den
    //  ene fejl med modtrækket mod den anden.
    if (seteTal) {
      const citat = hoved.match(/scripts\/test-[\w-]+\.ts/)?.[0]
      tjek(`  ${f} navngiver prøven, der kørte sætningerne`, citat != null)
      tjek(`  ${f}: og den citerede prøve FINDES`,
        citat != null && existsSync(citat), citat ?? 'intet citat')
    }
    // ── HVORFOR `test-`-BINDINGEN BLIVER STAAENDE INDTIL VIDERE ──
    //  Regexet hårdkoder `test-`, og det er en sløjfe: skulle en måle-SQL
    //  citere `scripts/maalinger/proev-maal-sql.ts` — repoets ANDEN
    //  navnekonvention for prøvefiler — ville tjekket AFVISE den. Målt:
    //  rødt på et citat til en fil, der findes. Konventionen kan altså
    //  ikke citere den fil, hvis brudthed udløste konventionen.
    //
    //  Den rettes IKKE her. Repoet har to navnekonventioner for
    //  prøvefiler — **målt over HELE repoet på b39329a**, ikke i
    //  `scripts/`:
    //
    //      test-*.ts     13
    //      test-*.mjs     0
    //      proev-*        3    scripts/proev-genskab.mjs
    //                          scripts/maalinger/proev-maal-sql.ts
    //                          docs/designforslag/maalinger/proev-maal.mjs
    //
    //  Omfanget står ved tallet, fordi det er forskellen: søger man kun i
    //  `scripts/`, får man 2 og misser den i `docs/`. Det tal blev engang
    //  rapporteret som en kendsgerning om repoet, og det var et svar om én
    //  mappe. `ordet-maalt` (a) — et tal uden sit omfang er ikke en måling.
    //
    //  ── DERFOR «13 + 0» OG IKKE «13» ───────────────────────────
    //  `test-*.mjs: 0` ser ud som en tom række. Den er formatets halve del.
    //  #49's opdager globber nu BÅDE `.ts` og `.mjs`, så i dag falder
    //  filnavnstællingen og kædens tal sammen — 13 = 13. Det er et
    //  SAMMENFALD, ikke en identitet: `test-isolation.mjs` ligger på #52,
    //  og lander den, finder kæden 14, mens en optælling af `.ts` stadig
    //  siger 13.
    //
    //  Altså et tal, der holder op med at være sandt, fordi EN ANDEN PR
    //  lander — uden at nogen rører det. «13 test-*.ts + 0 test-*.mjs på
    //  b39329a» er ikke blot mere præcist; det er det eneste format, der
    //  stadig er sandt efter #52. Samme fejl som ovenfor, med ENDELSEN som
    //  omfanget i stedet for mappen.
    //
    //  #49's kæde globber `test-*.ts` og `test-*.mjs`; #54's CI kører
    //  npm-nøglerne. `proev-genskab.mjs` er nået gennem `db:backup:proev`,
    //  så «har et mærke» og «står i en nøgle» er TO spørgsmål og ikke ét —
    //  og `scripts/proev-facilitetsudvidelse.mjs` (#60) er beviset: en
    //  omvendt modprøve, der SKAL være nøgle-kun.
    //
    //  Når #49 er landet og Analytics har valgt mellem de to, skærpes
    //  kravet her til **«har et mærke eller står i en nøgle»** frem for
    //  et navnemønster — samtidig med deres valg, af præcis den grund
    //  jeg selv gav om mit eget glob: to udtryk for ét spørgsmål skal
    //  ikke drive fra hinanden fra dag ét.
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
