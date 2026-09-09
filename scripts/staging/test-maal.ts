// ═══════════════════════════════════════════════════════════════
//  Prøve på målværnet — KUN afvisningsvejene.
//
//  Værnet består af rene funktioner over miljøvariabler. Der er hverken
//  netværk, database eller Supabase indblandet, så prøven kan køre her og
//  nu — i modsætning til selve staging-kørslen, som er blokeret.
//
//  ⚠ HVAD DEN IKKE PRØVER. At værnet SLIPPER det rigtige projekt igennem
//  og ind i en rigtig base, er aldrig blevet kørt: der er ingen adgang til
//  prgmenbwabwkgitjclrj fra dette miljø. «Accept»-tilfældene nedenfor
//  prøver funktionens returværdi, ikke at en forbindelse kommer i stand.
//  Den dag adgangen findes, skal den første kørsel stadig ses efter i
//  hånden.
//
//      npx tsx --tsconfig tsconfig.scripts.json scripts/staging/test-maal.ts
// ═══════════════════════════════════════════════════════════════

import {
  kraevStaging, kraevTom, refFraDatabaseUrl, refFraApiUrl,
  Maalfejl, STAGING_REF, PRODUKTION_REF, type Miljoe,
} from './maal'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

/** Kaster kaldet en Maalfejl, hvis grund nævner `naevner`? */
function afvises(navn: string, env: Miljoe, naevner: RegExp) {
  let besked: string | null = null
  try {
    kraevStaging(env)
  } catch (e) {
    besked = e instanceof Maalfejl ? e.message : `FORKERT FEJLTYPE: ${String(e)}`
  }
  if (besked === null) return tjek(navn, false, 'SLAP IGENNEM')
  tjek(navn, naevner.test(besked), besked.slice(0, 90))
}

const DB_OK = `postgres://postgres.${STAGING_REF}:hemmelig@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
const API_OK = `https://${STAGING_REF}.supabase.co`
const HELE = { STAGING_DATABASE_URL: DB_OK, STAGING_SUPABASE_URL: API_OK, BOFINDA_STAGING_BEKRAEFT: STAGING_REF }

console.log('\n═══ Målværnet for staging ═══')

// ═══ 1 · Intet mål er ikke «standardmålet» ══════════════════════
// Den farligste standardværdi er den, ingen har valgt. Mangler en kanal,
// er svaret et stop — aldrig et gæt på, hvad der nok var ment.
console.log('\n══ 1 · manglende kanaler ══')
afvises('1A · alle tre mangler', {}, /STAGING_DATABASE_URL/)
afvises('1B · database mangler', { ...HELE, STAGING_DATABASE_URL: '' }, /STAGING_DATABASE_URL/)
afvises('1C · API-URL mangler', { ...HELE, STAGING_SUPABASE_URL: '' }, /STAGING_SUPABASE_URL/)
afvises('1D · bekræftelsen mangler', { ...HELE, BOFINDA_STAGING_BEKRAEFT: '' }, /BEKRAEFT/)

// ═══ 2 · Produktionen må ikke optræde nogen steder ══════════════
// Ordret tekstsøgning, ikke kun en parsning: kommer produktionens ref med
// i en fejlkopieret blok, stopper det her — også når feltet ikke er det,
// forbindelsen faktisk bruger.
console.log('\n══ 2 · produktionens ref ══')
afvises('2A · i databasestrengen',
  { ...HELE, STAGING_DATABASE_URL: `postgres://postgres.${PRODUKTION_REF}:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` },
  /PRODUKTION/i)
afvises('2B · i API-URL\'en',
  { ...HELE, STAGING_SUPABASE_URL: `https://${PRODUKTION_REF}.supabase.co` }, /PRODUKTION/i)
afvises('2C · i bekræftelsen',
  { ...HELE, BOFINDA_STAGING_BEKRAEFT: PRODUKTION_REF }, /PRODUKTION/i)
afvises('2D · gemt i en kommentarhale, ikke i værten',
  { ...HELE, STAGING_DATABASE_URL: `${DB_OK}?options=project%3D${PRODUKTION_REF}` }, /PRODUKTION/i)

// ═══ 3 · Vært og databasenavn identificerer ikke et projekt ═════
// Alle projekter i regionen deler poolervært, og de hedder alle sammen
// «postgres». Kan ref'en ikke læses, er strengen ikke et mål.
console.log('\n══ 3 · en streng uden ref er ikke et mål ══')
afvises('3A · pooler uden ref i brugernavnet',
  { ...HELE, STAGING_DATABASE_URL: 'postgres://postgres:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres' },
  /ikke henføres|identificerer ikke/)
afvises('3B · en helt anden vært',
  { ...HELE, STAGING_DATABASE_URL: 'postgres://postgres:x@127.0.0.1:5432/postgres' },
  /ikke henføres|identificerer ikke/)
afvises('3C · slet ikke en URL',
  { ...HELE, STAGING_DATABASE_URL: 'staging' }, /ikke henføres|identificerer ikke/)

// ═══ 4 · Ankrede værtsnavne ═════════════════════════════════════
// «Starter med vores ref» er ikke «er vores projekt». En fremmed vært kan
// bære navnet som præfiks eller suffiks.
console.log('\n══ 4 · vært der kun LIGNER vores ══')
tjek('4A · <ref>.supabase.co.example.invalid læses ikke som ref',
  refFraApiUrl(`https://${STAGING_REF}.supabase.co.example.invalid`) === null)
tjek('4B · db.<ref>.supabase.co.example.invalid heller ikke',
  refFraDatabaseUrl(`postgres://postgres:x@db.${STAGING_REF}.supabase.co.example.invalid:5432/postgres`) === null)
tjek('4C · ondsindet-<ref>.supabase.co heller ikke',
  refFraApiUrl(`https://ondsindet-${STAGING_REF}.supabase.co`) === null)
afvises('4D · og kraevStaging afviser den', { ...HELE, STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co.example.invalid` },
  /ikke på formen/)

// ═══ 5 · http er ikke https ═════════════════════════════════════
// En nedgradering ville sende Auth-tokens ukrypteret.
console.log('\n══ 5 · protokollen ══')
tjek('5A · http afvises af parseren', refFraApiUrl(`http://${STAGING_REF}.supabase.co`) === null)
afvises('5B · og af værnet', { ...HELE, STAGING_SUPABASE_URL: `http://${STAGING_REF}.supabase.co` }, /ikke på formen/)

// ═══ 6 · Tre kanaler skal sige DET SAMME ════════════════════════
// Hver kanal alene kan være rigtig, mens målet er forkert. Uenighed er
// nok til et stop — vi gætter ikke på, hvilken af dem der talte sandt.
console.log('\n══ 6 · uenige kanaler ══')
const TREDJE = 'abcdefghijklmnopqrst'   // et gyldigt-formet, men fremmed projekt
afvises('6A · databasen peger et tredje sted',
  { ...HELE, STAGING_DATABASE_URL: `postgres://postgres.${TREDJE}:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` },
  new RegExp(TREDJE))
afvises('6B · API-URL\'en peger et tredje sted',
  { ...HELE, STAGING_SUPABASE_URL: `https://${TREDJE}.supabase.co` }, new RegExp(TREDJE))
afvises('6C · bekræftelsen er skrevet forkert af',
  { ...HELE, BOFINDA_STAGING_BEKRAEFT: STAGING_REF.slice(0, -1) + 'x' }, /BEKRAEFT|stemmer ikke/)
afvises('6D · bekræftelsen er et ord, ikke en ref',
  { ...HELE, BOFINDA_STAGING_BEKRAEFT: 'ja' }, /BEKRAEFT|stemmer ikke/)

// ═══ 7 · Begge gyldige databaseformer accepteres ════════════════
console.log('\n══ 7 · de former, der ER staging ══')
tjek('7A · pooler-formen læses', refFraDatabaseUrl(DB_OK) === STAGING_REF)
tjek('7B · direct-formen læses',
  refFraDatabaseUrl(`postgres://postgres:x@db.${STAGING_REF}.supabase.co:5432/postgres`) === STAGING_REF)
tjek('7C · API-formen læses', refFraApiUrl(API_OK) === STAGING_REF)
{
  let m: { ref: string } | null = null
  try { m = kraevStaging(HELE) } catch (e) { console.log(`     ${String(e)}`) }
  tjek('7D · tre enige kanaler giver staging som mål', m?.ref === STAGING_REF)
}
{
  let m: { ref: string } | null = null
  const direct = { ...HELE, STAGING_DATABASE_URL: `postgres://postgres:x@db.${STAGING_REF}.supabase.co:5432/postgres` }
  try { m = kraevStaging(direct) } catch { /* fanget af tjekket */ }
  tjek('7E · også med direct-forbindelsen', m?.ref === STAGING_REF)
}

// ═══ 8 · Indholdsprøven ═════════════════════════════════════════
// Det eneste værn, der ser på basen selv. De andre kan narres af en
// forkert kopieret streng; det her kan kun narres af en staging-base,
// nogen har fyldt med produktionsdata — og så er den ikke staging.
console.log('\n══ 8 · ligner basen produktionen? ══')
{
  const kaster = (t: { boliger: number; brugere: number }) => {
    try { kraevTom(t); return false } catch (e) { return e instanceof Maalfejl }
  }
  tjek('8A · en tom base slipper igennem', !kaster({ boliger: 0, brugere: 0 }))
  tjek('8B · en lille base slipper igennem', !kaster({ boliger: 12, brugere: 3 }))
  tjek('8C · 1.226 boliger stopper det', kaster({ boliger: 1226, brugere: 3 }))
  tjek('8D · også når det kun er brugerne', kaster({ boliger: 0, brugere: 900 }))
}

console.log(fejl === 0 ? '\n✓ ALT GRØNT — men kun afvisningsvejene. Se hovedet.\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
