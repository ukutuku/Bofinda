// ═══════════════════════════════════════════════════════════════
//  «ny»-mærkaten: datoen, kalenderen og uret.
//
//  Kører mod PGlite gennem scripts/testbase.ts. Data sås her i filen.
//
//  ── HVAD DEN BEVOGTER ─────────────────────────────────────────
//
//  Mærkaten og sorteringen svarer på det SAMME spørgsmål — «hvornår
//  blev den her bolig ny?». Sorteringen har altid brugt `NYHEDSDATO`
//  (lib/soeg.ts), som giver null for et bagkatalog. Kortet regnede sin
//  egen `hosKilden ?? foerstSet`, og den kan ikke give null. Følgen var
//  en bolig med «ny» på kortet, som listen samtidig lagde sidst.
//
//  Invarianten nedenfor er derfor ikke «mærkaten ser rigtig ud», men:
//  INGEN RÆKKE MÅ HAVE MÆRKAT, HVIS `NYHEDSDATO` ER NULL. Den kan ikke
//  opfyldes ved at kopiere udtrykket — kun ved at bruge det.
//
//  Modprøven nederst genindfører den gamle regel og viser, at prøven
//  bliver rød. Uden den måler prøven kun, at koden er som den er.
// ═══════════════════════════════════════════════════════════════

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { and, eq, isNull, sql as dsql } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, listings, sources } from '../db/schema'
import { Kort, Gruppekort } from '../app/Boligkort'
import { hvor, NYHEDSDATO, soeg, soegGrupperet, udenDubletter } from '../lib/soeg'
import { dageMellem, kalenderdag } from '../lib/dato'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}\n`)
  if (!ok) fejl++
}
const tekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// ── Referencetidspunktet ─────────────────────────────────────────
// 1. oktober kl. 08:00 dansk tid. Klokkeslættet er valgt, fordi det er
// dér, den gamle regel og kalenderen er længst fra hinanden: «for 1 dag
// siden» dækker 23,5–35,5 timer, så alt set efter kl. 08:30 i GÅR hed
// «i dag» hos den gamle.
const NU = new Date('2026-10-01T06:00:00Z')
const timer = (n: number) => new Date(NU.getTime() - n * 3600_000)

process.stdout.write('══ «ny»-mærkaten ══\n')

// Kilden har kørt første gang for 10 døgn siden, så indkøringsvinduet
// (INDKOERING_TIMER = 24) er for længst passeret for nye rækker.
const [kilde] = await db.insert(sources).values({
  slug: `nymaerkat-${Date.now()}`, name: 'Prøvekilde', sourceType: 'feed',
  baseUrl: 'https://proeve.invalid', enabled: false,
}).returning()
await db.insert(crawlRuns).values({
  sourceId: kilde!.id, startedAt: timer(240), finishedAt: timer(239), status: 'ok',
})

let n = 0
const saa = async (navn: string, foerstSet: Date, hosKilden: Date | null) => {
  const [r] = await db.insert(listings).values({
    sourceId: kilde!.id, sourceType: 'feed', externalKey: `ny-${++n}`,
    sourceUrl: `https://proeve.invalid/${n}`,
    addressRaw: `${navn}vej ${n}, 2300 København S`, street: `${navn}vej`,
    houseNumber: String(n), postalCode: '2300', city: 'København S',
    rooms: 2, sizeM2: 60, rentMonthly: 900000 + n, totalMonthly: 1000000 + n,
    totalMonthlyComponents: ['rent', 'heat', 'water'],
    addressMatchLevel: 'unit', unitAddressUuid: `intern:ny:${n}`,
    status: 'active', firstSeenAt: foerstSet, sourceCreatedAt: hosKilden,
  }).returning({ id: listings.id })
  return r!.id
}

// a: set i dag kl. 02 — i dag, uden kildedato
const a = await saa('Idag', timer(4), null)
// b: set i GÅR kl. 23 — ni timer siden, men i går på kalenderen.
//    Det er rækken, den gamle regel kaldte «ny for 9 timer siden».
const b = await saa('Igaar', timer(9), null)
// c: kildedatoen siger for to døgn siden, vi så den i dag
const c = await saa('Todage', timer(2), timer(49))
// d: for fire døgn siden — uden for vinduet
const d = await saa('Gammel', timer(96), null)
// e: BAGKATALOG — og det er den FØRSTE IMPORT, der er tilfældet.
//    En kilde, der kobles på i dag, får hele sin bestand skrevet med
//    `first_seen_at = nu`. Rækkerne er derfor få timer gamle hos OS og
//    årsgamle hos kilden. NYHEDSDATO giver null, fordi kildens første
//    kørsel ligger under 24 timer tilbage — men den gamle regel så kun
//    `?? foerstSet`, altså «for 1 time siden», og mærkede hele
//    bagkataloget «ny» i tre døgn. Det var home.dk: 48 af 48 kort.
const [nyKilde] = await db.insert(sources).values({
  slug: `nymaerkat-bag-${Date.now()}`, name: 'Nytilkoblet kilde', sourceType: 'feed',
  baseUrl: 'https://nykilde.invalid', enabled: false,
}).returning()
await db.insert(crawlRuns).values({
  sourceId: nyKilde!.id, startedAt: timer(2), finishedAt: timer(1), status: 'ok',
})
const [eRaekke] = await db.insert(listings).values({
  sourceId: nyKilde!.id, sourceType: 'feed', externalKey: 'bagkatalog-1',
  sourceUrl: 'https://nykilde.invalid/1',
  addressRaw: 'Bagkatalogvej 1, 2300 København S', street: 'Bagkatalogvej',
  houseNumber: '1', postalCode: '2300', city: 'København S',
  rooms: 2, sizeM2: 60, rentMonthly: 950000, totalMonthly: 1050000,
  totalMonthlyComponents: ['rent', 'heat', 'water'],
  addressMatchLevel: 'unit', unitAddressUuid: 'intern:ny:bag1',
  status: 'active', firstSeenAt: timer(1), sourceCreatedAt: null,
}).returning({ id: listings.id })
const e = eRaekke!.id

const raekker = await soeg({}, 100, NU)
const kortFor = (id: string) => raekker.find((r) => r.id === id)!
const maerkat = (id: string) => {
  const t = tekst(createElement(Kort, { b: kortFor(id), nu: NU }))
  const m = /\b(Ny bolig|Ny) (i dag|i går|· \d+ dage)/.exec(t)
  return m ? m[0] : null
}

tjek('set i dag → «Ny i dag»', maerkat(a) === 'Ny i dag', String(maerkat(a)))
tjek('set i GÅR kl. 23 → «Ny i går», ikke «Ny i dag»',
  maerkat(b) === 'Ny i går', String(maerkat(b)))
tjek('kildedato for to døgn siden → «Ny · 2 dage»',
  maerkat(c) === 'Ny · 2 dage', String(maerkat(c)))
tjek('fire døgn gammel → ingen mærkat', maerkat(d) === null, String(maerkat(d)))
tjek('bagkatalog → ingen mærkat', maerkat(e) === null, String(maerkat(e)))

// ── Invarianten: mærkat ⇒ NYHEDSDATO er ikke null ────────────────
// Spørges basen om hvem der har null, og kortene om hvem der har
// mærkat, må de to mængder ikke overlappe. Det er dén binding, der
// ikke kan opfyldes med en kopi af udtrykket.
const udenNyhedsdato = new Set((await db.select({ id: listings.id }).from(listings)
  .where(and(udenDubletter(hvor({})), dsql`${NYHEDSDATO} is null`))).map((r) => r.id))
const medMaerkat = raekker.filter((r) => maerkat(r.id) !== null).map((r) => r.id)
tjek('ingen række har mærkat, mens NYHEDSDATO er null',
  medMaerkat.every((id) => !udenNyhedsdato.has(id)),
  `${udenNyhedsdato.size} uden nyhedsdato · ${medMaerkat.length} med mærkat`)
tjek('præmis: bagkataloget ER med i sættet (ellers måler invarianten intet)',
  udenNyhedsdato.has(e))

// ── Gruppekortet svarer det samme ────────────────────────────────
// Samme funktion, og derfor samme svar. Gruppen her består KUN af
// bagkatalogrækker, så dens nyhedsdato er null.
const [kilde2] = await db.insert(sources).values({
  slug: `nymaerkat-g-${Date.now()}`, name: 'Prøvekilde 2', sourceType: 'feed',
  baseUrl: 'https://proeve2.invalid', enabled: false,
}).returning()
await db.insert(crawlRuns).values({
  sourceId: kilde2!.id, startedAt: timer(2), finishedAt: timer(1), status: 'ok',
})
for (let i = 0; i < 3; i++) {
  await db.insert(listings).values({
    sourceId: kilde2!.id, sourceType: 'feed', externalKey: `g-${i}`,
    sourceUrl: `https://proeve2.invalid/${i}`,
    addressRaw: `Gruppevej ${i}, 9999 Prøveby`, street: 'Gruppevej',
    houseNumber: String(i), postalCode: '9999', city: 'Prøveby',
    rooms: 3, sizeM2: 70 + i, rentMonthly: 800000, totalMonthly: 900000,
    totalMonthlyComponents: ['rent', 'heat', 'water'],
    // Kun ÉN af de tre oplyser en indflytningspris.
    moveInCost: i === 0 ? 2500000 : null,
    addressMatchLevel: 'unit', unitAddressUuid: `intern:g:${i}`,
    status: 'active', firstSeenAt: timer(1), sourceCreatedAt: null,
  })
}
const { visninger } = await soegGrupperet({ postnr: '9999' }, 48, NU, 1)
const gruppe = visninger.find((v) => v.slags === 'gruppe')
tjek('præmis: de tre blev ét gruppekort', gruppe != null,
  `${visninger.length} visning(er)`)
if (gruppe?.slags === 'gruppe') {
  const t = tekst(createElement(Gruppekort, { g: gruppe.gruppe, nu: NU }))
  tjek('gruppe af lutter bagkatalog → ingen mærkat', !/\bNy bolig\b/.test(t))
  tjek('gruppens nyhedsdato er null, ikke en dato', gruppe.gruppe.nyhed === null,
    String(gruppe.gruppe.nyhed))
  // ── Indflytningsprisen taler kun for dem, der har den ──────────
  tjek('indflytningspris oplyst for 1 af 3 → dækningen står på kortet',
    t.includes('oplyst for 1 af 3'), t.slice(0, 160))
  tjek('… og beløbet står som «fra», ikke som gruppens pris',
    /indflytning fra 25\.000 kr\./.test(t), t.slice(0, 160))
}

// ── MODPRØVE: den gamle regel skal gøre prøven rød ───────────────
// Genindfører `hosKilden ?? foerstSet` + det rullende 72-timers vindue,
// og viser, at BEGGE de to fejl den havde, fanges her.
process.stdout.write('\n── modprøve: den gamle regel ──\n')
const gammelRegel = (r: { hosKilden: Date | null; foerstSet: Date }) => {
  const paaMarkedet = r.hosKilden ?? r.foerstSet
  return NU.getTime() - paaMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3
}
tjek('den gamle regel ville give bagkataloget mærkat (fejlen var ægte)',
  gammelRegel(kortFor(e)), 'det er dén, invarianten nu forbyder')
// `siden()` runder: ni timer bliver til «for 9 timer siden», som
// designlagets omdøbning læste som «i dag».
const bDage = dageMellem(kalenderdag(kortFor(b).foerstSet), kalenderdag(NU))
tjek('den gamle regel ville kalde gårsdagens bolig «i dag»',
  NU.getTime() - kortFor(b).foerstSet.getTime() < 23.5 * 3600_000 && bDage === 1,
  `${((NU.getTime() - kortFor(b).foerstSet.getTime()) / 3600_000).toFixed(0)} t, men ${bDage} kalenderdøgn`)

process.stdout.write(fejl ? `\n${fejl} FEJL\n` : '\nAlle prøver bestået.\n')
if (fejl) process.exit(1)
