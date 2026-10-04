// ═══════════════════════════════════════════════════════════════
//  gruppe: oekonomi
//  Beskrivelsen udledes ved visning — og grænsen ved `native` holder.
//
//  Kører mod PGlite gennem scripts/testbase.ts.
//
//  ── HVAD DEN BEVOGTER ─────────────────────────────────────────
//
//  To fejl, én i hver retning, og prøven skal fange BEGGE:
//
//    · Udleder vi for en UDLEJERANNONCE, forsvinder hendes egne ord.
//      De findes intet andet sted. Det er den værste af de to.
//    · Læser vi den GEMTE kolonne for en importeret bolig, er vi tilbage
//      ved to udtryk for ét spørgsmål — og de 22 drevne rækker.
//
//  Derfor er flaget `erUdlejerannonce` bærende, og prøven viser det ved
//  at vende det på den SAMME række og kræve, at svaret skifter. Kunne
//  den ikke det, målte den ikke grænsen, kun at koden er som den er.
// ═══════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import { hentBolig } from '../lib/soeg'
import { beskrivelseFor, genererBeskrivelse } from '../lib/normalize'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}\n`)
  if (!ok) fejl++
}

process.stdout.write('══ Beskrivelsen ved visning ══\n')

// Felterne, begge rækker deles om. Skrevet ud, så den forventede tekst
// kan læses af et menneske.
const FELTER = {
  propertyType: 'lejlighed' as const,
  rooms: 3,
  sizeM2: 84,
  street: 'Nørrebrogade',
  houseNumber: '30',
  postalCode: '2200',
  city: 'København N',
  rentMonthly: 1_250_000,
  totalMonthly: 1_400_000,
  totalMonthlyComponents: ['rent', 'heat', 'water'],
  utilitiesElectricity: null,
  electricityOwnMeter: null,
  overtagelse: { slags: 'ukendt' as const },
}
const UDLEDT = genererBeskrivelse(FELTER)!
process.stdout.write(`\n  udledningen lyder: «${UDLEDT}»\n\n`)

// ── 1 · Importeret bolig: teksten UDLEDES ────────────────────────
const [fremmed] = await db.insert(sources).values({
  slug: 'proeve-visning', name: 'Prøvekilde', sourceType: 'feed',
  baseUrl: 'https://proeve.invalid', enabled: false,
}).returning()
const [imp] = await db.insert(listings).values({
  sourceId: fremmed!.id, sourceType: 'feed', externalKey: 'v-1',
  sourceUrl: 'https://proeve.invalid/1',
  addressRaw: 'Nørrebrogade 30, 2200 København N',
  street: FELTER.street, houseNumber: FELTER.houseNumber,
  postalCode: FELTER.postalCode, city: FELTER.city,
  propertyType: FELTER.propertyType, rooms: FELTER.rooms, sizeM2: FELTER.sizeM2,
  rentMonthly: FELTER.rentMonthly, totalMonthly: FELTER.totalMonthly,
  totalMonthlyComponents: FELTER.totalMonthlyComponents,
  addressMatchLevel: 'unit', unitAddressUuid: 'intern:v:1', status: 'active',
  // Kolonnen er TOM, som den er efter importen nu.
  description: null,
}).returning({ id: listings.id })

const b1 = await hentBolig(imp!.id)
tjek('1 · importeret bolig får sin tekst udledt, selv med tom kolonne',
  b1?.beskrivelse === UDLEDT, String(b1?.beskrivelse))

// ── 2 · Den gemte kolonne er DØD for importerede ─────────────────
// Det er de 22 rækkers klasse, sat på spidsen: står der noget forkert i
// kolonnen, må det ikke kunne nå skærmen.
await db.update(listings).set({ description: 'FORÆLDET TEKST FRA EN ANDEN ADRESSE.' })
  .where(eq(listings.id, imp!.id))
const b2 = await hentBolig(imp!.id)
tjek('2 · en forældet gemt tekst kan ikke naa skaermen',
  b2?.beskrivelse === UDLEDT, String(b2?.beskrivelse))

// ── 3 · genparse-formen: flyt adressen, teksten følger ───────────
// `scripts/genparse-adresser.ts:77-83` skriver praecis disse felter og
// ikke `description`. Det var skrivevejen bag de 22. Nu kan den ikke
// skabe en drift, fordi der ikke er to ting at holde ens.
await db.update(listings)
  .set({ street: 'Jagtvej', houseNumber: '7', postalCode: '2200', city: 'København N' })
  .where(eq(listings.id, imp!.id))
const b3 = await hentBolig(imp!.id)
tjek('3 · adressen flyttet uden at skrive teksten → teksten FØLGER',
  b3!.beskrivelse!.includes('Jagtvej 7') && !b3!.beskrivelse!.includes('Nørrebrogade'),
  String(b3?.beskrivelse))

// ── 4 · Udlejerannonce: hendes EGNE ord ──────────────────────────
const [nativeKilde] = await db.select({ id: sources.id }).from(sources)
  .where(eq(sources.slug, 'native')).limit(1)
tjek('4 · praemis: native-kilden findes (saaet af migration 0013)',
  nativeKilde != null)

const HENDES = 'Lys 3-værelses med morgensol på altanen. Vaskemaskine medfølger. '
  + 'Jeg bor selv i opgangen og svarer hurtigt.'
const [udl] = await db.insert(listings).values({
  sourceId: nativeKilde!.id, sourceType: 'native', externalKey: 'v-native-1',
  // Kolonnen er NOT NULL, og en native bolig har ingen fremmed kilde at
  // pege paa — den peger paa sin egen side, som lib/udlejer.ts:299 goer.
  sourceUrl: 'https://bofinda.dk/bolig/proeve-native-1',
  addressRaw: 'Nørrebrogade 30, 2200 København N',
  street: FELTER.street, houseNumber: FELTER.houseNumber,
  postalCode: FELTER.postalCode, city: FELTER.city,
  propertyType: FELTER.propertyType, rooms: FELTER.rooms, sizeM2: FELTER.sizeM2,
  rentMonthly: FELTER.rentMonthly, totalMonthly: FELTER.totalMonthly,
  totalMonthlyComponents: FELTER.totalMonthlyComponents,
  addressMatchLevel: 'unit', unitAddressUuid: 'intern:v:native1', status: 'active',
  description: HENDES,
}).returning({ id: listings.id })

const b4 = await hentBolig(udl!.id)
tjek('4 · udlejerannoncen viser HENDES ord, ikke udledningen',
  b4?.beskrivelse === HENDES, String(b4?.beskrivelse))

// ── 5 · MODPRØVEN: gør udledningen gældende for native ───────────
// Praemissen foerst: de to tekster SKAL vaere forskellige, ellers maaler
// prøve 4 ingenting — den ville bestaa, uanset hvilken gren der blev
// valgt.
process.stdout.write('\n── modprøve: udledningen gjort gældende for en native-række ──\n')
tjek('5 · praemis: hendes ord og udledningen ER forskellige',
  HENDES !== UDLEDT)

const somOmDenVarFremmed = beskrivelseFor({
  ...FELTER, erUdlejerannonce: false, gemtBeskrivelse: HENDES,
})
tjek('5 · vendes flaget paa SAMME raekke, skifter svaret til udledningen',
  somOmDenVarFremmed === UDLEDT && somOmDenVarFremmed !== HENDES,
  String(somOmDenVarFremmed))
tjek('5 · altsaa: udledes der for native, TABES hendes ord — og proeve 4 bliver roed',
  somOmDenVarFremmed !== HENDES)

// Og den anden vej: laeses kolonnen for en importeret bolig, er den
// foraeldede tekst tilbage paa skaermen, og proeve 2 bliver roed.
const somOmDenVarNative = beskrivelseFor({
  ...FELTER, erUdlejerannonce: true, gemtBeskrivelse: 'FORÆLDET TEKST FRA EN ANDEN ADRESSE.',
})
tjek('5 · og laeses kolonnen for en importeret bolig, er driften tilbage',
  somOmDenVarNative === 'FORÆLDET TEKST FRA EN ANDEN ADRESSE.')

// ── 6 · Tom udlejertekst: kolonnen baerer allerede udledningen ────
// lib/udlejer.ts:263 er `i.beskrivelse.trim() || n.description`, saa et
// tomt felt giver den udledte tekst i kolonnen. Her prøves kun, at
// `null` ikke bliver til en udledning bag hendes ryg.
await db.update(listings).set({ description: null }).where(eq(listings.id, udl!.id))
const b6 = await hentBolig(udl!.id)
tjek('6 · native med tom kolonne giver null — ikke en udledning, hun ikke har skrevet',
  b6?.beskrivelse === null, String(b6?.beskrivelse))

// ── 7 · referenceNow: SAMME raekke, to sider af domaenets datoskifte ──
//
// Teksten siger nu det samme som faktablokken, og faktablokkens svar
// afhaenger af HVORNAAR man spoerger: en dato i fremtiden er «senere»,
// den samme dato i dag er «nu». Proeven viser, at `hentBolig` regner paa
// den referenceNow, den FAAR — ikke paa en klokke inde i sig selv. Var
// det sidste tilfaeldet, kunne siden og teksten staa paa hver sin tid.
//
// Kilden er `balder`, fordi dens datofelt er godkendt som tidsevidens i
// KILDEKONTRAKTER (`brugbarSomTiming: true`). Paa propstep, lokalbolig og
// findbolig er feltet AFVIST, og svaret ville vaere «ukendt» paa begge
// sider af skiftet — det daekkes af scripts/test-overtagelse-i-teksten.ts.
const [balderKilde] = await db.insert(sources).values({
  slug: 'balder', name: 'Balder', sourceType: 'spider',
  baseUrl: 'https://www.balder.dk', enabled: false,
}).returning()
const [dato] = await db.insert(listings).values({
  sourceId: balderKilde!.id, sourceType: 'spider', externalKey: 'v-dato',
  sourceUrl: 'https://www.balder.dk/1',
  addressRaw: 'Else Alfelts Vej 1, 2300 København S',
  street: 'Else Alfelts Vej', houseNumber: '1', postalCode: '2300', city: 'København S',
  propertyType: FELTER.propertyType, rooms: FELTER.rooms, sizeM2: FELTER.sizeM2,
  rentMonthly: FELTER.rentMonthly, totalMonthly: FELTER.totalMonthly,
  totalMonthlyComponents: FELTER.totalMonthlyComponents,
  addressMatchLevel: 'unit', unitAddressUuid: 'intern:v:dato', status: 'active',
  availabilityFacts: { sourceAvailabilityDate: '2026-11-01' },
  description: null,
}).returning({ id: listings.id })

const foer = await hentBolig(dato!.id, new Date('2026-10-31T12:00:00Z'))
tjek('7 · FOER skiftet: teksten baerer kildens dato',
  foer!.beskrivelse!.includes('Ledig fra 1. november 2026.'), String(foer?.beskrivelse).slice(-46))
const efter = await hentBolig(dato!.id, new Date('2026-11-01T12:00:00Z'))
tjek('7 · EFTER skiftet: samme raekke, samme fakta → «Kan overtages nu.»',
  efter!.beskrivelse!.includes('Kan overtages nu.')
  && !efter!.beskrivelse!.includes('Ledig fra'), String(efter?.beskrivelse).slice(-46))
tjek('7 · altsaa regnes teksten paa den referenceNow, der gives med',
  foer!.beskrivelse !== efter!.beskrivelse)

process.stdout.write(fejl ? `\n${fejl} FEJL\n` : '\nAlle prøver bestået.\n')
if (fejl) process.exit(1)
