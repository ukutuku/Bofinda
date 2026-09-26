// ═══════════════════════════════════════════════════════════════
//  Koerselsgraenserne — proeves paa de FAKTISKE flag.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  `ryd()` stod ubeskyttet paa scripts/import.ts og kastede hver time i
//  fem doegn. Alt efter linjen faldt bort: dagsaggregatet,
//  alarmmatchningen OG udsendelsen. Ingen bekraeftet bruger fik varsel.
//  Loggen sagde det ikke: det eneste succes-maerke var `import afsluttet`
//  som SIDSTE saetning, saa en nedbrudt koersels log var et PRAEFIKS af en
//  gennemfoert koersels. `crawl_runs` saa oveni koebet sund ud.
//
//  ── HVORFOR DEN LAESER lib/koersel.ts' TABELLER ───────────────
//  Foerste udgave af denne fil byggede sine egne trin med sine egne flag.
//  Den var groen — OGSAA da hvert eneste flag i scripts/import.ts blev
//  vendt om, altsaa da femdoegns-fejlen blev genindfoert og forvaerret.
//  Proeven kunne ikke se forskel paa rettelsen og fejlen, fordi de to
//  laeste hver sit sted. Flagene bor nu i `GRAENSER` og `AFHAENGIGHEDER` i
//  lib/koersel.ts, og afsnit A proever DEM.
//
//  ── HVAD DER PROEVES ──────────────────────────────────────────
//    A · tabellerne selv — de faktiske flag, ikke prøvens egne
//    B · at koerTrin respekterer en tabel, og modsat uden den
//    C · slutlinje, exitkode og besked
//    D · graense 6's indre, mod den rigtige sendAlarmer og en database
//
//  MODPROEVERNE koerer mod den RIGTIGE `koerTrin` med en aendret tabel, saa
//  de maaler produktionskode og ikke sig selv. Hvor en kontrol IKKE kan
//  blive roed, staar det ved den. En kontrol, der ikke diskriminerer, maa
//  ikke taelle som bevis.
//
//    npm test
// ═══════════════════════════════════════════════════════════════

import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { alertMatches, listings, savedSearches, sources, users } from '../db/schema'
import { _saetSender, sendAlarmer } from '../lib/alarm'
import {
  AFHAENGIGHEDER, GRAENSER, besked, enLinje, exitkode, koerTrin, slutlinje,
  type Trin, type Trinnavn, type Udfald,
} from '../lib/koersel'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

let spor: string[] = []
const ok = (navn: Trinnavn): Trin => ({ navn, koer: async () => { spor.push(navn) } })
const kaster = (navn: Trinnavn): Trin => ({
  navn, koer: async () => { spor.push(`${navn}:forsoegt`); throw new Error(`brud i ${navn}`) },
})
const ALLE: Trinnavn[] = ['opstart', 'kilder', 'oprydning', 'maaling', 'match', 'mail']
const kaede = (kastende: Trinnavn) => ALLE.map((n) => (n === kastende ? kaster(n) : ok(n)))

// ─── A · Tabellerne selv ───────────────────────────────────────
//
//  Det er DE HER kontroller, der fanger en vendt graense. Vendes et flag i
//  lib/koersel.ts, bliver netop den roed.

console.log('\n── A · De faktiske graenser ──────────────────────────\n')

tjek('A1 · opstart er UISOLERET — en koersel uden grundlag skal ses paa',
  GRAENSER.opstart === false)
tjek('A2 · oprydning er UISOLERET — 24-maaneders-loeftet har intet andet vaern',
  GRAENSER.oprydning === false)
tjek('A3 · kilder, maaling, match og mail er ISOLEREDE',
  GRAENSER.kilder && GRAENSER.maaling && GRAENSER.match && GRAENSER.mail)
tjek('A4 · hvert trin har et flag — ingen falder tilbage paa undefined',
  ALLE.every((n) => typeof GRAENSER[n] === 'boolean'),
  Object.entries(GRAENSER).map(([k, v]) => `${k}=${v}`).join(' '))
tjek('A5 · mail kraever match — en halv koe maa ikke sendes som en hel',
  AFHAENGIGHEDER.mail === 'match')
tjek('A6 · intet andet trin har en afhaengighed, vi ikke har begrundet',
  Object.keys(AFHAENGIGHEDER).length === 1)

// ─── B · koerTrin respekterer tabellen ─────────────────────────

console.log('\n── B · Mekanikken ───────────────────────────────────\n')

// B1 · et isoleret trins fejl tager ikke de foelgende
for (const n of ['kilder', 'maaling'] as Trinnavn[]) {
  spor = []
  const u = await koerTrin(kaede(n), () => {})
  const efter = ALLE.slice(ALLE.indexOf(n) + 1)
  tjek(`B1 · ${n} fejler → ${efter.join(', ')} koerer alligevel`,
    efter.every((x) => spor.includes(x)) && u.afbrudt === null && u.fejlede.includes(n),
    spor.join(' → '))
}

// B2 · MODPROEVE mod den rigtige koerTrin: vendes flaget, standser den
for (const n of ['kilder', 'maaling', 'match'] as Trinnavn[]) {
  spor = []
  const u = await koerTrin(kaede(n), () => {}, { ...GRAENSER, [n]: false })
  tjek(`B2 · MODPROEVE · ${n} som uisoleret standser koerslen`,
    u.afbrudt?.trin === n && !spor.includes('mail'), spor.join(' → '))
}

// B3 · de uisolerede standser, som tabellen siger
for (const n of ['opstart', 'oprydning'] as Trinnavn[]) {
  spor = []
  const u = await koerTrin(kaede(n), () => {})
  const efter = ALLE.slice(ALLE.indexOf(n) + 1)
  tjek(`B3 · ${n} fejler → ${efter.join(', ')} koerer IKKE`,
    u.afbrudt?.trin === n && !efter.some((x) => spor.includes(x)), spor.join(' → '))
}

// B4 · MODPROEVE: som isoleret ville de netop ikke standse
for (const n of ['opstart', 'oprydning'] as Trinnavn[]) {
  spor = []
  const u = await koerTrin(kaede(n), () => {}, { ...GRAENSER, [n]: true })
  tjek(`B4 · MODPROEVE · ${n} som isoleret lader resten koere`,
    u.afbrudt === null && spor.includes('maaling'), spor.join(' → '))
}

// B5 · afhaengigheden: mail springes over, naar match fejlede
{
  spor = []
  const linjer: string[] = []
  const u = await koerTrin(kaede('match'), (s) => linjer.push(s))
  tjek('B5 · match fejler → mail SPRINGES OVER, ikke sendes halvt',
    u.sprunget.includes('mail') && !spor.includes('mail'), spor.join(' → '))
  tjek('B5 · og det staar i loggen',
    linjer.some((l) => l === '[mail] SPRUNGET OVER: match fejlede'), linjer.join(' | '))
  // MODPROEVE: uden afhaengigheden ville mail koere paa en halv koe
  spor = []
  const u2 = await koerTrin(kaede('match'), () => {}, GRAENSER, {})
  tjek('B5 · MODPROEVE · uden afhaengigheden koerer mail alligevel',
    spor.includes('mail') && u2.sprunget.length === 0, spor.join(' → '))
}

// B6 · koerTrin kaster aldrig selv — heller ikke naar loggen kaster
{
  let kastede = false
  try {
    await koerTrin(kaede('kilder'), () => { throw new Error('loggen er i stykker') })
  } catch { kastede = true }
  tjek('B6 · en logfunktion, der kaster, vaelter ikke koerslen', !kastede)
}

// ─── C · Slutlinje, exitkode, besked ───────────────────────────

console.log('\n── C · Slutlinjen ───────────────────────────────────\n')

{
  const u = (o: Partial<Udfald>): Udfald => ({ fejlede: [], sprunget: [], afbrudt: null, ...o })
  tjek('C1 · ren koersel', slutlinje(u({})) === 'import afsluttet')
  tjek('C2 · isolerede fejl staar paa linjen',
    slutlinje(u({ fejlede: ['kilder', 'mail'] })) === 'import afsluttet · fejl i: kilder, mail')
  tjek('C3 · sprungne trin staar ogsaa',
    slutlinje(u({ fejlede: ['match'], sprunget: ['mail'] }))
      === 'import afsluttet · fejl i: match · sprunget: mail')
  // Foerste udgave returnerede paa afbrudt-grenen og tabte `fejlede`.
  tjek('C4 · afbrudt TABER IKKE de trin, der fejlede foer',
    slutlinje(u({ fejlede: ['kilder'], afbrudt: { trin: 'oprydning', fejl: 'x' } }))
      === 'import afbrudt: oprydning — x · fejl i: kilder',
    slutlinje(u({ fejlede: ['kilder'], afbrudt: { trin: 'oprydning', fejl: 'x' } })))
  // Postgres-fejl er flerlinjede. En slutlinje paa to linjer er ingen slutlinje.
  const flerlinjet = slutlinje(u({ afbrudt: { trin: 'oprydning', fejl: 'fejl\nDETAIL: mere\nHINT: endnu mere' } }))
  tjek('C5 · en flerlinjet fejl presses til ÉN linje', !flerlinjet.includes('\n'), flerlinjet)
  tjek('C6 · alle former begynder med «import »',
    [u({}), u({ fejlede: ['mail'] }), u({ afbrudt: { trin: 'opstart', fejl: 'x' } })]
      .every((x) => slutlinje(x).startsWith('import ')))

  tjek('C7 · exitkode 0 kun naar alt lykkedes', exitkode(u({})) === 0)
  tjek('C8 · et isoleret trins fejl giver ogsaa ≠ 0', exitkode(u({ fejlede: ['mail'] })) === 1)
  tjek('C9 · et sprunget trin giver ≠ 0', exitkode(u({ sprunget: ['mail'] })) === 1)
  tjek('C10 · afbrudt giver ≠ 0', exitkode(u({ afbrudt: { trin: 'opstart', fejl: 'x' } })) === 1)
}

{
  // `besked` skal ikke kunne kaste — ellers bryder koerTrin sin kontrakt.
  const slem = Object.create(null) as unknown        // ingen toString
  const ondsindet = { toString() { throw new Error('nej') } } as unknown
  tjek('C11 · en Error uden message falder tilbage paa sit navn',
    besked(new Error('')) === 'Error', besked(new Error('')))
  tjek('C12 · en kastet streng gengives', besked('bare en streng') === 'bare en streng')
  tjek('C13 · et objekt uden toString kaster ikke', besked(slem).length > 0, besked(slem))
  tjek('C14 · et objekt hvis toString kaster, kaster ikke ud',
    besked(ondsindet) === 'ukendt fejl (kunne ikke laeses)', besked(ondsindet))
  tjek('C15 · besked presser selv til én linje', !besked(new Error('a\nb')).includes('\n'))
  tjek('C16 · enLinje samler mellemrum', enLinje('  a \n\n b  ') === 'a b')
}

// C17 · beskeden naar FAKTISK loggen — foerste udgave sendte den til () => {}
{
  const linjer: string[] = []
  await koerTrin([{ navn: 'kilder', koer: async () => { throw 'en streng, ikke en Error' } }],
    (s) => linjer.push(s))
  tjek('C17 · en kastet streng staar laesbart i loggen',
    linjer.some((l) => l === '[kilder] FEJLEDE: en streng, ikke en Error'), linjer.join(' | '))
}

// ─── D · Graense 6's indre: pr. modtager ───────────────────────
//
//  `sendMail` haandterer selv en spaerring og et 4xx/5xx-svar. Men et kast
//  — timeout paa 20 s, reset, DNS, TLS — gik foer hele vejen ud gennem
//  loekken i sendAlarmer og ud af scripts/import.ts. Ét glip hos én
//  modtager kostede resten af koeen.
//
//  MODPROEVEN er indbygget: fjernes try/catch'et i lib/alarm.ts, AFVISER
//  `sendAlarmer()` i stedet for at returnere, og D1 bliver roed.

console.log('\n── D · Én modtagers fejl ────────────────────────────\n')

{
  const [kilde] = await db.insert(sources).values({
    slug: 'proevekilde-koersel', name: 'Prøvekilde kørselsgrænser',
    sourceType: 'feed', baseUrl: 'https://proeve.invalid',
  }).returning({ id: sources.id })

  const [bolig] = await db.insert(listings).values({
    sourceId: kilde!.id, sourceType: 'feed',
    externalKey: 'koersel-1', sourceUrl: 'https://proeve.invalid/1',
    addressRaw: 'Graensevej 1, 9001 Prøveby',
    street: 'Graensevej', houseNumber: '1', postalCode: '9001', city: 'Prøveby',
    rooms: 3, sizeM2: 70, rentMonthly: 1_000_000,
  }).returning({ id: listings.id })

  // To soegninger, to modtagere. `ventende()` ordner paa soegningens navn,
  // saa «A» rammes foerst — den, vi lader kaste.
  const brugere: string[] = []
  const soegninger: string[] = []
  for (const b of ['A', 'B']) {
    const [u] = await db.insert(users)
      .values({ email: `${b.toLowerCase()}@eksempel.invalid` }).returning({ id: users.id })
    const [s] = await db.insert(savedSearches).values({
      userId: u!.id, name: `${b}-soegning`, criteria: { postnr: '9001' },
      unsubscribeToken: `afmeld-${b}`, confirmToken: `bekraeft-${b}`,
      confirmedAt: new Date(), notifyEmail: true,
    }).returning({ id: savedSearches.id })
    await db.insert(alertMatches).values({ savedSearchId: s!.id, listingId: bolig!.id })
    brugere.push(u!.id); soegninger.push(s!.id)
  }
  const [aId, bId] = soegninger

  const forsoegte: string[] = []
  let afviste = false
  let res: Awaited<ReturnType<typeof sendAlarmer>> = []
  try {
    _saetSender(async (o) => {
      forsoegte.push(o.til)
      if (o.til.startsWith('a@')) throw new Error('fetch failed: timeout efter 20000 ms')
      return { sendt: true, id: 'proeve' }
    })
    try { res = await sendAlarmer() } catch { afviste = true }
  } finally {
    // I en `finally`, saa saedet ikke laekker, hvis en kontrol ovenfor kaster.
    _saetSender(null)
  }

  tjek('D1 · ét kast forplanter sig IKKE ud af sendAlarmer', !afviste)
  tjek('D2 · den anden modtager blev alligevel forsoegt',
    forsoegte.length === 2, forsoegte.join(', '))

  const a = res.find((r) => r.modtager.startsWith('a@'))
  const b = res.find((r) => r.modtager.startsWith('b@'))
  tjek('D3 · den fejlede rapporteres som fejl, ikke som sendt',
    a?.sendt === false && a?.fejl === true, a?.grund ?? '(ingen)')
  tjek('D4 · og `fejl` er sat, saa import.ts kan lade trinet fejle hoerbart',
    a?.fejl === true)
  tjek('D5 · den anden staar som sendt UDEN fejlflag',
    b?.sendt === true && b?.fejl === undefined)

  const [aM] = await db.select({ sentAt: alertMatches.sentAt })
    .from(alertMatches).where(eq(alertMatches.savedSearchId, aId!))
  const [bM] = await db.select({ sentAt: alertMatches.sentAt })
    .from(alertMatches).where(eq(alertMatches.savedSearchId, bId!))
  // D6 og D7 er BOGHOLDERI, ikke bevis: `sent_at` og `last_notified_at` er
  // nullable uden default, saa de er sande ogsaa uden graensen. De staar,
  // fordi de beskriver den rigtige tilstand — men de diskriminerer ikke,
  // og de maa ikke laeses som daekning. D1-D5 er det diskriminerende saet.
  tjek('D6 · den fejlede beholder sent_at = null (bogholderi, ikke bevis)',
    aM?.sentAt === null)
  tjek('D7 · den sendte har sent_at sat — mailen FOER maerket',
    bM?.sentAt !== null)

  // Afgraenset oprydning. Filen roerer KUN sine egne raekker: en uafgraenset
  // `db.delete(users)` her ville toemme brugertabellen, og spaerringen mod
  // produktionen ville alene vaere, at package.json kalder filen gennem
  // scripts/testbase.ts. `tsx --env-file=.env scripts/test-koersel.ts` er en
  // naerliggende ting at goere under fejlsoegning. CLAUDE.md kraever backup
  // foer enhver `delete`, og `npm test` har FOER skrevet i produktionen.
  await db.delete(alertMatches).where(inArray(alertMatches.savedSearchId, soegninger))
  await db.delete(savedSearches).where(inArray(savedSearches.id, soegninger))
  await db.delete(users).where(inArray(users.id, brugere))
  await db.delete(listings).where(eq(listings.id, bolig!.id))
  await db.delete(sources).where(eq(sources.id, kilde!.id))
}

console.log(`\n${fejl === 0 ? '  ALT GRØNT' : `  ${fejl} FEJL`}\n`)
if (fejl) process.exit(1)
