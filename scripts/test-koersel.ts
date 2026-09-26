// ═══════════════════════════════════════════════════════════════
//  Koerselsgraenserne — proeves med et kast i hvert trin.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  `ryd()` stod ubeskyttet paa scripts/import.ts:45 og kastede hver time
//  i fem doegn. Fordi der ikke var en graense, faldt dagsaggregatet,
//  alarmmatchningen OG udsendelsen bort med den. Ingen bekraeftet bruger
//  fik varsel om en ny bolig i den periode. Og loggen sagde det ikke:
//  det eneste succes-maerke var `import afsluttet` som SIDSTE saetning i
//  filen, saa en nedbrudt koersels log var et PRAEFIKS af en gennemfoert
//  koersels. Oveni saa `crawl_runs` sund ud, fordi importen naaede at
//  skrive sine raekker foer nedbrudspunktet.
//
//  Det eneste indpakkede trin var analytics-retention — det trin, hvis
//  fejl betyder mindst, fordi `haendelser_daglig` laeses af ingen fil i
//  app/. Graenserne stod altsaa omvendt.
//
//  ── HVAD DER PROEVES ──────────────────────────────────────────
//    A · orkestreringen, uden database
//      1.  graense 2 · kilder: et kast tager ikke de foelgende trin
//      2.  graense 3 · oprydning: ditto — det var DENNE, der kostede
//      3.  graense 5 · match: ditto, og mail koerer alligevel
//      4.  graense 6 · mail: fejlen huskes, koerslen gennemfoeres
//      5.  graense 1 · opstart er UISOLERET med vilje og SKAL standse
//      6.  koerTrin kaster aldrig selv — det er dens kontrakt
//      7.  slutlinjen: afsluttet · afsluttet med fejl · afbrudt
//      8.  exitkoden: 0 kun naar alt lykkedes
//      9.  et kast, der ikke er en Error, faar stadig en laesbar besked
//    B · graense 6's INDRE, mod den rigtige sendAlarmer og en database
//     10.  ét transportkast hos én modtager koster ikke de oevrige
//
//  MODPROEVERNE koerer med: hvert gront flueben har en makker, der
//  koerer samme scenarie UDEN graensen og kraever, at koerslen standser.
//  Et flueben, der ikke kan blive roedt, er ingen proeve. Se noten i
//  scripts/test-maaling.ts om bevidste brud — her er de automatiske.
//
//    npm test
// ═══════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { alertMatches, listings, savedSearches, sources, users } from '../db/schema'
import { _saetSender, sendAlarmer } from '../lib/alarm'
import {
  besked, exitkode, koerTrin, slutlinje, type Trin, type Trinnavn, type Udfald,
} from '../lib/koersel'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// ─── A · Orkestreringen ────────────────────────────────────────
//
//  Hvert trin skriver sit navn, naar det koerer. Et kast i ét trin maa
//  ikke fjerne de foelgende fra sporet.

let spor: string[] = []

const ok = (navn: Trinnavn): Trin => ({
  navn, isoleret: true, koer: async () => { spor.push(navn) },
})

const kaster = (navn: Trinnavn, isoleret = true): Trin => ({
  navn, isoleret,
  koer: async () => { spor.push(`${navn}:forsoegt`); throw new Error(`brud i ${navn}`) },
})

/**
 * Koerslen som den saa ud FOER graenserne: sekventielle await uden try.
 *
 * Bruges KUN af modproeverne. Den findes, saa hver graense har et maalt
 * modstykke — ellers ville de gronne fluebén ikke vise, at graensen er
 * det, der baerer dem.
 */
async function udenGraenser(trin: Trin[]): Promise<void> {
  for (const t of trin) await t.koer()
}

async function modproeve(navn: string, trin: Trin[], maaIkkeNaa: Trinnavn) {
  spor = []
  let kastede = false
  try { await udenGraenser(trin) } catch { kastede = true }
  tjek(`${navn} · UDEN graensen standser koerslen`,
    kastede && !spor.includes(maaIkkeNaa), spor.join(' → ') || '(intet)')
}

console.log('\n── Koerselsgraenserne ────────────────────────────────\n')

// 1 · graense 2 · kilder
{
  spor = []
  const trin = [kaster('kilder'), ok('oprydning'), ok('maaling'), ok('match'), ok('mail')]
  const u = await koerTrin(trin, () => {})
  tjek('1 · graense 2 · et kast i kilder tager ikke de fire foelgende',
    ['oprydning', 'maaling', 'match', 'mail'].every((n) => spor.includes(n)),
    spor.join(' → '))
  tjek('1 · kilder staar som fejlet, og koerslen er ikke afbrudt',
    u.fejlede.includes('kilder') && u.afbrudt === null)
  await modproeve('1 · graense 2', trin, 'mail')
}

// 2 · graense 3 · oprydning — den fejl, der faktisk indtraf
{
  spor = []
  const trin = [ok('kilder'), kaster('oprydning'), ok('maaling'), ok('match'), ok('mail')]
  const u = await koerTrin(trin, () => {})
  tjek('2 · graense 3 · et kast i ryd() tager ikke maaling, match og mail',
    ['maaling', 'match', 'mail'].every((n) => spor.includes(n)), spor.join(' → '))
  tjek('2 · det var netop disse tre, der faldt bort i fem doegn',
    u.fejlede.length === 1 && u.fejlede[0] === 'oprydning')
  await modproeve('2 · graense 3', trin, 'mail')
}

// 3 · graense 5 · match
{
  spor = []
  const trin = [ok('oprydning'), kaster('match'), ok('mail')]
  const u = await koerTrin(trin, () => {})
  tjek('3 · graense 5 · et kast i match standser ikke udsendelsen',
    spor.includes('mail'), spor.join(' → '))
  tjek('3 · koeen kan holde raekker fra tidligere koersler — derfor er den isoleret',
    u.afbrudt === null)
  await modproeve('3 · graense 5', trin, 'mail')
}

// 4 · graense 6 · mail (den ydre; den indre proeves i afsnit B)
{
  spor = []
  const linjer: string[] = []
  const u = await koerTrin([ok('match'), kaster('mail')], (s) => linjer.push(s))
  tjek('4 · graense 6 · koerslen gennemfoeres, selv om mail fejler',
    u.afbrudt === null && u.fejlede.includes('mail'))
  tjek('4 · fejlen NAVNGIVES i loggen — tavshed var hele problemet',
    linjer.some((l) => l.startsWith('[mail] FEJLEDE:')), linjer.join(' | '))
}

// 5 · graense 1 · opstart er uisoleret MED VILJE
{
  spor = []
  const u = await koerTrin([kaster('opstart', false), ok('kilder'), ok('mail')], () => {})
  tjek('5 · graense 1 · opstart standser koerslen',
    u.afbrudt?.trin === 'opstart' && !spor.includes('kilder'), spor.join(' → '))
  tjek('5 · men den standser HOERBART: trinet er navngivet',
    slutlinje(u) === 'import afbrudt: opstart — brud i opstart', slutlinje(u))
}

// 6 · koerTrin kaster aldrig selv
{
  let kastede = false
  try {
    await koerTrin([kaster('kilder'), kaster('oprydning'), kaster('mail')], () => {})
  } catch { kastede = true }
  tjek('6 · koerTrin kaster aldrig selv — det er dens kontrakt', !kastede)
}

// 7 · slutlinjen: altid én af to former
{
  const ren: Udfald = { fejlede: [], afbrudt: null }
  const medFejl: Udfald = { fejlede: ['oprydning', 'mail'], afbrudt: null }
  const brudt: Udfald = { fejlede: [], afbrudt: { trin: 'opstart', fejl: 'ingen kilder' } }
  tjek('7 · ren koersel', slutlinje(ren) === 'import afsluttet', slutlinje(ren))
  tjek('7 · isolerede fejl staar PAA slutlinjen, ikke kun i en logline',
    slutlinje(medFejl) === 'import afsluttet · fejl i: oprydning, mail', slutlinje(medFejl))
  tjek('7 · afbrudt navngiver trin og fejl',
    slutlinje(brudt) === 'import afbrudt: opstart — ingen kilder', slutlinje(brudt))
  tjek('7 · alle tre former begynder med «import » — loggen ender altid genkendeligt',
    [ren, medFejl, brudt].every((u) => slutlinje(u).startsWith('import ')))
}

// 8 · exitkoden
{
  tjek('8 · 0 kun naar alt lykkedes',
    exitkode({ fejlede: [], afbrudt: null }) === 0)
  tjek('8 · et isoleret trins fejl giver ogsaa ≠ 0 — koerslen gjorde ikke sit arbejde',
    exitkode({ fejlede: ['mail'], afbrudt: null }) === 1)
  tjek('8 · afbrudt giver ≠ 0',
    exitkode({ fejlede: [], afbrudt: { trin: 'opstart', fejl: 'x' } }) === 1)
}

// 9 · en kastet vaerdi behoever ikke vaere en Error
{
  const u = await koerTrin([{
    navn: 'oprydning', isoleret: true,
    koer: async () => { throw 'en streng, ikke en Error' },
  }], () => {})
  tjek('9 · en kastet streng bliver en laesbar besked',
    u.fejlede.includes('oprydning'))
  const tom = new Error('')
  tjek('9 · en Error uden message falder tilbage paa sit navn',
    besked(tom) === 'Error', besked(tom))
}

// ─── B · Graense 6's indre: pr. modtager ───────────────────────
//
//  `sendMail` haandterer selv en spaerring og et 4xx/5xx-svar ved at
//  returnere `{ sendt: false }`. Men en TRANSPORTfejl — timeout paa 20 s,
//  reset, DNS, TLS — kaster, og kastet gik foer hele vejen ud gennem
//  loekken i sendAlarmer og ud af scripts/import.ts. Ét netvaerksglip hos
//  én modtager kostede resten af koeen.
//
//  MODPROEVEN er indbygget: fjernes try/catch'et i lib/alarm.ts, AFVISER
//  `sendAlarmer()` i stedet for at returnere, og proeve 10a bliver roed.

console.log('\n── Graense 6: én modtagers netvaerksfejl ─────────────\n')

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
  const opret = async (bogstav: string) => {
    const [u] = await db.insert(users)
      .values({ email: `${bogstav.toLowerCase()}@eksempel.invalid` })
      .returning({ id: users.id })
    const [s] = await db.insert(savedSearches).values({
      userId: u!.id, name: `${bogstav}-soegning`, criteria: { postnr: '9001' },
      unsubscribeToken: `afmeld-${bogstav}`, confirmToken: `bekraeft-${bogstav}`,
      confirmedAt: new Date(), notifyEmail: true,
    }).returning({ id: savedSearches.id })
    await db.insert(alertMatches)
      .values({ savedSearchId: s!.id, listingId: bolig!.id })
    return s!.id
  }
  const aId = await opret('A')
  const bId = await opret('B')

  const forsoegte: string[] = []
  _saetSender(async (o) => {
    forsoegte.push(o.til)
    if (o.til.startsWith('a@')) throw new Error('fetch failed: timeout efter 20000 ms')
    return { sendt: true, id: 'proeve' }
  })

  let afviste = false
  let res: Awaited<ReturnType<typeof sendAlarmer>> = []
  try { res = await sendAlarmer() } catch { afviste = true }
  _saetSender(null)

  tjek('10a · ét transportkast forplanter sig IKKE ud af sendAlarmer', !afviste)
  tjek('10b · den anden modtager blev alligevel forsoegt',
    forsoegte.length === 2, forsoegte.join(', '))

  const a = res.find((r) => r.modtager.startsWith('a@'))
  const b = res.find((r) => r.modtager.startsWith('b@'))
  tjek('10c · den fejlede rapporteres som transportfejl, ikke som sendt',
    a?.sendt === false && (a?.grund ?? '').startsWith('transportfejl:'), a?.grund ?? '(ingen)')
  tjek('10d · den anden staar som sendt', b?.sendt === true)

  const [aM] = await db.select({ sentAt: alertMatches.sentAt })
    .from(alertMatches).where(eq(alertMatches.savedSearchId, aId))
  const [bM] = await db.select({ sentAt: alertMatches.sentAt })
    .from(alertMatches).where(eq(alertMatches.savedSearchId, bId))
  tjek('10e · den fejlede beholder sent_at = null og proeves igen',
    aM?.sentAt === null)
  tjek('10f · den sendte har sent_at sat — mailen FOER maerket, som docstringen kraever',
    bM?.sentAt !== null)

  const [aS] = await db.select({ sidst: savedSearches.lastNotifiedAt })
    .from(savedSearches).where(eq(savedSearches.id, aId))
  tjek('10g · den fejlede soegning faar IKKE last_notified_at — 60-minutters-uret staar stille',
    aS?.sidst === null)

  // Oprydning: filen efterlader ikke raekker til de naeste proever.
  await db.delete(alertMatches)
  await db.delete(savedSearches)
  await db.delete(users)
  await db.delete(listings)
  await db.delete(sources).where(eq(sources.id, kilde!.id))
}

console.log(`\n${fejl === 0 ? '  ALT GRØNT' : `  ${fejl} FEJL`}\n`)
if (fejl) process.exit(1)
