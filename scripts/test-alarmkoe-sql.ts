// ═══════════════════════════════════════════════════════════════
//  PRØVE · scripts/maal-alarmkoe.sql
//
//  Filen er GENERERET af scripts/generer-alarmkoe-sql.ts, og dens
//  `from … where` er appens egen, klippet ud af
//  `ventendeForespoergsel().toSQL()`. Prøven her holder tre ting oppe:
//
//    1 · DRIFT. Det committede er stadig det, generatoren laver.
//        Uden den kunne nogen rette i .sql-filen i hånden, og så var
//        hele pointen — at målingen ikke er en afskrift — væk.
//
//    2 · FILENS UDFØRBARE INDHOLD. De tre select'er i filen er de tre,
//        prøven kører. Drift-prøven alene dækker det ikke: den
//        sammenligner generatorens output med generatorens output, og
//        en fejl i SAMMENSÆTNINGEN (et manglende semikolon, en
//        select, der faldt ud) ville stå grøn i begge ender.
//
//    3 · AT DE SVARER RIGTIGT. Punkt 1 og 2 er tautologier uden den
//        her: en generator, der laver gyldig men forkert SQL, består
//        dem begge. Derfor sås et forlæg, hvor hvert tal er udregnet
//        i hånden FØRST, og de tre select'er køres mod det.
//
//  Og til sidst krydstjekket, som er grunden til at halen genereres:
//  summen af `traef` i spørgsmål 1 SKAL være antallet af rækker,
//  `ventende()` returnerer. To udtryk, ét svar — målt, ikke antaget.
//
//  Grebet med at klippe halen ud af appens egen forespørgsel er
//  Analytics' (d59c613, maalinger/traef-paa-nedtagne.ts), og det
//  samme er formen på forlægget: facit skrevet først.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { ventende } from '../lib/alarm'
import { byg, spoergsmaal, UDFIL } from './generer-alarmkoe-sql'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// PGlite giver { rows }, postgres-js et array. Begge former håndteres,
// så prøven ikke er bundet til driveren.
async function koer(s: string): Promise<Record<string, unknown>[]> {
  const svar = (await db.execute(sql.raw(s))) as unknown
  return (Array.isArray(svar) ? svar : (svar as { rows: unknown[] }).rows) as Record<string, unknown>[]
}
const tal = (v: unknown) => Number(v)

const DELE = spoergsmaal()

console.log('\n══ 1 · det committede er det, generatoren laver ══')
{
  const paaDisken = readFileSync(UDFIL, 'utf8')
  const genereret = byg()
  tjek(`${UDFIL} svarer til generatorens output`, paaDisken === genereret,
    paaDisken === genereret ? `${genereret.length} tegn`
      : 'kør: npm run maal:alarmkoe -- --skriv')
  if (paaDisken !== genereret) {
    // Hvor de skilles. En ren «de er forskellige» ville sende den
    // næste på jagt i 5.500 tegn.
    const a = paaDisken.split('\n'), b = genereret.split('\n')
    const i = a.findIndex((l, n) => l !== b[n])
    console.log(`      første forskel, linje ${i + 1}:\n`
      + `        disken:    ${JSON.stringify(a[i])}\n`
      + `        generator: ${JSON.stringify(b[i])}`)
  }
}

console.log('\n══ 2 · filens udførbare indhold ER de tre select\'er ══')
{
  // Kommentarlinjer ud, så semikolon i prosaen ikke tæller med. Hver
  // kommentar i filen er en HEL linje, der begynder med `--`.
  const kode = readFileSync(UDFIL, 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
  const saetninger = kode.split(';').map((s) => s.trim()).filter(Boolean)
  tjek('filen indeholder præcis 3 select\'er', saetninger.length === DELE.length,
    `${saetninger.length} fundet`)
  for (const [i, d] of DELE.entries()) {
    tjek(`  nr. ${i + 1} er ordret den, prøven kører`, saetninger[i] === d.sql.trim())
  }
  tjek('ingen af dem skriver', saetninger.every((s) => s.startsWith('select')))
}

// ─── Forlægget. Facit udregnet i hånden FØR select'erne blev kørt. ───
//
//   SØGNINGER                                  BOLIGER
//   Q1  U1  bekræftet  mail til                L1  active
//   Q2  U2  bekræftet  mail FRA                L2  delisted, ned for 3 t siden
//   Q3  U1  bekræftet  afmeldt                 L3  delisted, ned for 2 t siden
//   Q4  U1  UBEKRÆFTET mail til
//
//   TRÆF                              i kø?  hvorfor
//   M1  Q1+L1  usendt                  ja    aktiv
//   M2  Q1+L2  usendt                  ja    nedtaget, kan mailes
//   M3  Q2+L2  usendt                  ja    nedtaget, mail fra
//   M4  Q3+L3  usendt                  ja    nedtaget, afmeldt
//   M5  Q4+L2  usendt                  NEJ   søgningen er ubekræftet
//   M6  Q1+L3  SENDT for 1 t siden     NEJ   allerede sendt
//
//   → spørgsmål 1, delisted:  traef 3 (M2,M3,M4) · soegninger 3 (Q1,Q2,Q3)
//                             brugere 2 (U1,U2)  · kan_mailes 1 (kun M2)
//   → spørgsmål 1, active:    traef 1 (M1)       · alt andet 1
//   → spørgsmål 2:            1 (M6: L3 gik ned 2 t siden, mailen 1 t siden)
//   → spørgsmål 3:            4 usendte i alt
const FACIT = {
  delisted: { traef: 3, soegninger: 3, brugere: 2, kan_mailes: 1 },
  active: { traef: 1, soegninger: 1, brugere: 1, kan_mailes: 1 },
  sendte_traef_til_nedtagne: 1,
  usendte_i_alt: 4,
}

const S = '11111111-0000-0000-0000-00000000000a'
const U1 = '22222222-0000-0000-0000-000000000001'
const U2 = '22222222-0000-0000-0000-000000000002'
const Q = (n: number) => `33333333-0000-0000-0000-00000000000${n}`
const L = (n: number) => `44444444-0000-0000-0000-00000000000${n}`

async function saa() {
  await db.execute(sql`insert into sources (id, slug, name, source_type) values
    (${S}, 'alarmkoe-proeve', 'Proevekilde', 'spider')`)
  await db.execute(sql`insert into users (id, email) values
    (${U1}, 'en@proeve.invalid'), (${U2}, 'to@proeve.invalid')`)
  await db.execute(sql`insert into saved_searches
    (id, user_id, name, criteria, notify_email, confirmed_at, unsubscribed_at) values
    (${Q(1)}, ${U1}, 'Q1 mail til',   '{}'::jsonb, true,  now(), null),
    (${Q(2)}, ${U2}, 'Q2 mail fra',   '{}'::jsonb, false, now(), null),
    (${Q(3)}, ${U1}, 'Q3 afmeldt',    '{}'::jsonb, true,  now(), now()),
    (${Q(4)}, ${U1}, 'Q4 ubekraeftet','{}'::jsonb, true,  null,  null)`)
  await db.execute(sql`insert into listings
    (id, source_id, source_type, external_key, source_url, address_raw, status, delisted_at) values
    (${L(1)}, ${S}, 'spider', 'l1', 'https://proeve.invalid/1', 'Aktivvej 1, 2300',   'active',   null),
    (${L(2)}, ${S}, 'spider', 'l2', 'https://proeve.invalid/2', 'Nedvej 2, 2300',     'delisted', now() - interval '3 hours'),
    (${L(3)}, ${S}, 'spider', 'l3', 'https://proeve.invalid/3', 'Nedvej 3, 2300',     'delisted', now() - interval '2 hours')`)
  await db.execute(sql`insert into alert_matches
    (saved_search_id, listing_id, matched_at, sent_at) values
    (${Q(1)}, ${L(1)}, now() - interval '10 hours', null),
    (${Q(1)}, ${L(2)}, now() - interval '9 hours',  null),
    (${Q(2)}, ${L(2)}, now() - interval '8 hours',  null),
    (${Q(3)}, ${L(3)}, now() - interval '7 hours',  null),
    (${Q(4)}, ${L(2)}, now() - interval '6 hours',  null),
    (${Q(1)}, ${L(3)}, now() - interval '5 hours',  now() - interval '1 hour')`)
}

console.log('\n══ 3 · select\'erne mod et forlæg med facit skrevet først ══')
{
  // Tom base først. Står der rækker i forvejen, måler facit noget andet
  // end det, kommentaren ovenfor beskriver — og ville være vilkårligt.
  const foer = tal((await koer('select count(*)::int as n from alert_matches'))[0]!.n)
  tjek('basen er tom før forlægget sås', foer === 0, `${foer} træf fundet`)
  await saa()

  const q1 = await koer(DELE[0]!.sql)
  tjek('spørgsmål 1 giver to statusrækker', q1.length === 2,
    q1.map((r) => `${r.status}:${r.traef}`).join(' '))
  for (const [status, f] of Object.entries(FACIT).slice(0, 2) as
    [string, Record<string, number>][]) {
    const r = q1.find((x) => x.status === status)
    if (!r) { tjek(`  status ${status} findes`, false); continue }
    for (const [k, v] of Object.entries(f)) {
      tjek(`  ${status}.${k}`, tal(r[k]) === v, `facit ${v}, målt ${tal(r[k])}`)
    }
  }

  const q2 = await koer(DELE[1]!.sql)
  tjek('spørgsmål 2 · sendte træf til nedtagne',
    tal(q2[0]!.sendte_traef_til_nedtagne) === FACIT.sendte_traef_til_nedtagne,
    `facit ${FACIT.sendte_traef_til_nedtagne}, målt ${tal(q2[0]!.sendte_traef_til_nedtagne)}`)

  const q3 = await koer(DELE[2]!.sql)
  const usendte = q3.reduce((n, r) => n + tal(r.usendte), 0)
  // Summen og ikke rækkeantallet: `date_trunc('day', …)` deler forlægget
  // i to rækker, hvis prøven kører inden for 10 timer efter midnat.
  tjek('spørgsmål 3 · usendte i alt', usendte === FACIT.usendte_i_alt,
    `facit ${FACIT.usendte_i_alt}, målt ${usendte}`)
}

console.log('\n══ 4 · krydstjek: målingen tæller appens egen kø ══')
{
  // Grunden til at halen genereres. Ét svar, to veje derhen: drizzles
  // egen kørsel af `ventende()`, og den rå SQL i filen. Driver de fra
  // hinanden, måler filen noget andet end det, alarmen sender fra.
  const grupper = await ventende()
  const raekker = grupper.flat()
  const q1 = await koer(DELE[0]!.sql)
  const sum = q1.reduce((n, r) => n + tal(r.traef), 0)
  tjek('sum(traef) == antal rækker fra ventende()', sum === raekker.length,
    `SQL ${sum}, ventende() ${raekker.length}`)
  const nedtagne = raekker.filter((r) => r.status !== 'active').length
  const sqlNed = tal(q1.find((r) => r.status === 'delisted')?.traef ?? 0)
  tjek('delisted-spanden == de nedtagne i ventende()', sqlNed === nedtagne,
    `SQL ${sqlNed}, ventende() ${nedtagne}`)
  tjek('forudsætning: der ER nedtagne i køen', nedtagne > 0, `${nedtagne}`)
}

console.log(fejl === 0
  ? '\n  ALT GRØNT — målingen er appens egen forespørgsel, og den svarer rigtigt\n'
  : `\n  ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
