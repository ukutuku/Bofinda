// ═══════════════════════════════════════════════════════════════
//  Depositum og forudbetalt leje som SELVSTAENDIGE felter.
//
//  ── HVORFOR DEN HER FIL FINDES ────────────────────────────────
//  Begge adaptere LAESTE allerede beloebene og brugte dem — men kun til
//  at regne `moveInCost` ud. Delene naaede aldrig `RawListing`, saa
//  kolonnerne `deposit` og `prepaidRent` stod tomme paa hver eneste
//  Propstep- og LokalBolig-bolig, selv om kilden havde oplyst dem.
//
//  Summen kraever ALLE tre beloeb (leje + depositum + forudbetalt). Var
//  felterne blevet haengt op paa den, ville en bolig, hvor kun
//  depositummet er oplyst, stadig staa tom. Derfor proever filen her
//  hvert felt for sig, og udtrykkeligt ogsaa det tilfaelde, hvor
//  `moveInCost` IKKE kan beregnes.
//
//  ── ENHEDERNE ER FORSKELLIGE, OG DET ER POINTEN ───────────────
//  Propstep regner i mindste enhed og siger det selv
//  (`transactionDetails.unit === 'cents'`); beloebene foeres videre
//  uaendret. LokalBolig regner i KRONER og skal konverteres ÉN gang.
//  En prøve, der kun maalte «feltet er sat», ville bestaa med en faktor
//  100 i forskel — derfor maaler hver prøve det praecise oerebeloeb.
//
//  ── ALLE PROEVEDATA HER ER SYNTETISKE ─────────────────────────
//  Der findes INGEN gemte kildeproever for de to parsere i repoet, og
//  der er ikke hentet nye: opgaven var udtrykkeligt uden kilde-
//  undersoegelse. Payloadene nedenfor er skrevet i haanden i kildernes
//  egen form, med tydeligt opdigtede vaerdier («Attrapvej», «Proeveby»,
//  sags-id'er med `proeve`). De dokumenterer ikke kilden — de proever
//  VORES parsning af den form, adapteren allerede laeser.
//
//  Koeres gennem scripts/testbase.ts: PGlite i processen, intet
//  netvaerk, ingen produktion.
// ═══════════════════════════════════════════════════════════════

import { laesBolig as propstepLaes, type GitterRaekke } from '../adapters/propstep'
import { laesBolig as lokalboligLaes } from '../adapters/lokalbolig'
import { normaliser } from '../lib/normalize'
import type { VasketAdresse } from '../lib/address'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// ─── Propstep ──────────────────────────────────────────────────
// SYNTETISK payload i Propsteps egen form. Beloeb i oere, fordi
// `unit: 'cents'` — det er kildens egen erklaering, og adapteren laeser
// intet oekonomifelt uden den.
const GITTER: GitterRaekke = {
  id: 'proeve-ps-1', propertySlug: 'attrapvej-1',
  postalcode: '2300', city: 'Prøveby',
  availabilityStatus: 'Available',
  url: 'https://propstep.invalid/da-DK/bolig/proeve-ps-1-attrapvej-1',
}

/** Bygger en Propstep-`property` med netop de oekonomifelter, prøven vil sætte. */
const psBolig = (td: Record<string, unknown>) => ({
  id: 'proeve-ps-1',
  location: {
    addressAPostalCodeACity: 'Attrapvej 1, 2300 Prøveby',
    postalcode: '2300',
    point: { x: 12.5, y: 55.6 },
  },
  propertyDetails: { type: 1, size: 70, rooms: 3 },
  transactionDetails: { unit: 'cents', price: 1200000, ...td },
})

console.log('\n══ Propstep: depositum og forudbetalt leje (syntetisk) ══')

// 1 · Begge beloeb oplyst.
const psBegge = propstepLaes(psBolig({
  calculatedDeposit: 3600000, calculatedPrepaidRent: 1200000,
}), GITTER)
tjek('begge beløb oplyst: depositum er 36.000 kr. i øre',
  psBegge?.deposit === 3600000, String(psBegge?.deposit))
tjek('begge beløb oplyst: forudbetalt er 12.000 kr. i øre',
  psBegge?.prepaidRent === 1200000, String(psBegge?.prepaidRent))
// Kilden er allerede i mindste enhed. Ganges der med 100 her, bliver
// 36.000 kr. til 3,6 mio. — derfor maales det praecise tal, ikke bare
// at feltet er sat.
tjek('… og der er IKKE ganget med 100 undervejs',
  psBegge?.deposit === 3600000 && psBegge?.prepaidRent === 1200000)
tjek('begge beløb oplyst: indflytningsprisen kan beregnes',
  psBegge?.moveInCost === 6000000, String(psBegge?.moveInCost))

// 2 · Kun ét beloeb oplyst. Det afgoerende: feltet skal komme med,
//     SELV OM `moveInCost` ikke kan beregnes uden det andet.
const psKunDep = propstepLaes(psBolig({ calculatedDeposit: 3600000 }), GITTER)
tjek('kun depositum oplyst: feltet kommer med',
  psKunDep?.deposit === 3600000, String(psKunDep?.deposit))
tjek('kun depositum oplyst: forudbetalt forbliver UKENDT',
  psKunDep?.prepaidRent === undefined, String(psKunDep?.prepaidRent))
tjek('kun depositum oplyst: indflytningsprisen kan IKKE beregnes — og det spærrer ikke feltet',
  psKunDep?.moveInCost === undefined && psKunDep?.deposit === 3600000)

const psKunForud = propstepLaes(psBolig({ calculatedPrepaidRent: 1200000 }), GITTER)
tjek('kun forudbetalt oplyst: feltet kommer med',
  psKunForud?.prepaidRent === 1200000, String(psKunForud?.prepaidRent))
tjek('kun forudbetalt oplyst: depositum forbliver UKENDT',
  psKunForud?.deposit === undefined, String(psKunForud?.deposit))

// 3 · Oplyst NUL. «Udlejer opkraever intet» og «udlejer oplyser intet»
//     er to forskellige udsagn, og 0 maa ikke smelte sammen med fravaer.
const psNul = propstepLaes(psBolig({
  calculatedDeposit: 0, calculatedPrepaidRent: 0,
}), GITTER)
tjek('oplyst nul bevares som 0 — ikke som ukendt',
  psNul?.deposit === 0 && psNul?.prepaidRent === 0,
  `${psNul?.deposit} / ${psNul?.prepaidRent}`)
tjek('… og et nul spærrer ikke indflytningsprisen',
  psNul?.moveInCost === 1200000, String(psNul?.moveInCost))

// 4 · Manglende beloeb. Ingen nuller opfindes.
const psTom = propstepLaes(psBolig({}), GITTER)
tjek('manglende beløb forbliver UKENDTE — ingen nuller opfindes',
  psTom?.deposit === undefined && psTom?.prepaidRent === undefined,
  `${psTom?.deposit} / ${psTom?.prepaidRent}`)
tjek('… men huslejen er urørt', psTom?.rentMonthly === 1200000, String(psTom?.rentMonthly))

// 5 · Enheden er kildens egen erklaering. Er `unit` noget andet end
//     'cents', forstaar vi ikke tallene — og saa oplyses INGEN oekonomi.
//     Det gjaldt allerede leje og aconto; det skal ogsaa gaelde delene.
const psAndenEnhed = propstepLaes({
  ...psBolig({ calculatedDeposit: 3600000, calculatedPrepaidRent: 1200000 }),
  transactionDetails: {
    unit: 'kroner', price: 12000,
    calculatedDeposit: 36000, calculatedPrepaidRent: 12000,
  },
}, GITTER)
tjek('ukendt enhed: hverken depositum eller forudbetalt oplyses',
  psAndenEnhed?.deposit === undefined && psAndenEnhed?.prepaidRent === undefined,
  `${psAndenEnhed?.deposit} / ${psAndenEnhed?.prepaidRent}`)
tjek('… og huslejen oplyses heller ikke, som før',
  psAndenEnhed?.rentMonthly === undefined, String(psAndenEnhed?.rentMonthly))

// 6 · `calculatedDeposit` vinder over `deposit`, men et beregnet NUL er
//     stadig et tal: `??` maa ikke falde videre til raa-feltet.
const psNulVinder = propstepLaes(psBolig({
  calculatedDeposit: 0, deposit: 3600000,
}), GITTER)
tjek('et beregnet nul vinder over rå-feltet — ?? falder ikke igennem',
  psNulVinder?.deposit === 0, String(psNulVinder?.deposit))

// ─── LokalBolig ────────────────────────────────────────────────
// SYNTETISK payload i LokalBoligs egen form: RSC-brudstykker i
// `self.__next_f`. Kilden regner i KRONER — derfor skal hvert beloeb
// konverteres ÉN gang, og prøven maaler oerebeloebet.
console.log('\n══ LokalBolig: depositum og forudbetalt leje (syntetisk) ══')

/** Pakker en JSON-streng som det RSC-brudstykke, `flight()` samler op. */
const lbSide = (felter: string) =>
  `<html><body><script>self.__next_f.push([1,${JSON.stringify(
    `{"caseNumber":"49-proeve01","caseType":"CaseRented",`
    + `"address":{"streetName":"Attrapvej","streetNumber":"1",`
    + `"zip":2300,"city":"Prøveby"},`
    + `"floorArea":70,"roomCount":3,"monthlyRent":10000,${felter}`
    + `"acquisitionDate":"2026-11-01T00:00:00","createdDate":"2026-09-01T00:00:00",`
    + `"lastUpdated":"2026-09-01T00:00:00","coordinates":{"latitude":55.6,"longitude":12.5},`
    + `"pictures":[],"caseDataFinancial":{"Aconto pr. md.":"900 kr."},`
    + `"caseDataGeneral":{"Boligtype":"Lejlighed"},`
    // GRAENSEN. Alt efter den hoerer til «lignende boliger» og maa aldrig
    // laeses som boligens egne tal — naboen har med vilje andre beloeb.
    + `"relatedCases":[{"deposit":99999,"prepaidRent":88888,"roomCount":9}]}`,
  )}])</script></body></html>`

const LB_URL = 'https://www.lokalbolig.dk/bolig/49-proeve01'

// 1 · Begge beloeb oplyst — i kroner hos kilden.
const lbBegge = lokalboligLaes(lbSide('"deposit":30000,"prepaidRent":10000,'), LB_URL)
tjek('begge beløb oplyst: depositum 30.000 kr. → 3.000.000 øre',
  lbBegge?.deposit === 3000000, String(lbBegge?.deposit))
tjek('begge beløb oplyst: forudbetalt 10.000 kr. → 1.000.000 øre',
  lbBegge?.prepaidRent === 1000000, String(lbBegge?.prepaidRent))
// Konverteringen skal ske ÉN gang. Sker den to gange, bliver 30.000 kr.
// til 300 mio. øre; sker den slet ikke, staar der 30.000 øre = 300 kr.
tjek('… konverteret præcis én gang — hverken 30.000 eller 300.000.000',
  lbBegge?.deposit !== 30000 && lbBegge?.deposit !== 300000000)
tjek('begge beløb oplyst: indflytningsprisen kan beregnes',
  lbBegge?.moveInCost === 5090000, String(lbBegge?.moveInCost))
// Naboen i `relatedCases` har 99999/88888. Rammer parsingen dem, er
// graensen brudt — og tallet ville se lige saa rigtigt ud som et rigtigt.
tjek('naboens beløb i relatedCases læses IKKE som boligens',
  lbBegge?.deposit !== 9999900 && lbBegge?.prepaidRent !== 8888800)

// 2 · Kun ét beloeb oplyst — feltet skal med, selv om summen falder bort.
const lbKunDep = lokalboligLaes(lbSide('"deposit":30000,'), LB_URL)
tjek('kun depositum oplyst: feltet kommer med',
  lbKunDep?.deposit === 3000000, String(lbKunDep?.deposit))
tjek('kun depositum oplyst: forudbetalt forbliver UKENDT',
  lbKunDep?.prepaidRent === undefined, String(lbKunDep?.prepaidRent))
tjek('kun depositum oplyst: indflytningsprisen kan IKKE beregnes — og det spærrer ikke feltet',
  lbKunDep?.moveInCost === undefined && lbKunDep?.deposit === 3000000)

const lbKunForud = lokalboligLaes(lbSide('"prepaidRent":10000,'), LB_URL)
tjek('kun forudbetalt oplyst: feltet kommer med',
  lbKunForud?.prepaidRent === 1000000, String(lbKunForud?.prepaidRent))
tjek('kun forudbetalt oplyst: depositum forbliver UKENDT',
  lbKunForud?.deposit === undefined, String(lbKunForud?.deposit))

// 3 · Oplyst NUL — og 0 kr. er stadig 0 øre efter konverteringen.
const lbNul = lokalboligLaes(lbSide('"deposit":0,"prepaidRent":0,'), LB_URL)
tjek('oplyst nul bevares som 0 — ikke som ukendt',
  lbNul?.deposit === 0 && lbNul?.prepaidRent === 0,
  `${lbNul?.deposit} / ${lbNul?.prepaidRent}`)
tjek('… og et nul spærrer ikke indflytningsprisen',
  lbNul?.moveInCost === 1090000, String(lbNul?.moveInCost))

// 4 · Manglende beloeb.
const lbTom = lokalboligLaes(lbSide(''), LB_URL)
tjek('manglende beløb forbliver UKENDTE — ingen nuller opfindes',
  lbTom?.deposit === undefined && lbTom?.prepaidRent === undefined,
  `${lbTom?.deposit} / ${lbTom?.prepaidRent}`)
tjek('… men huslejen er urørt', lbTom?.rentMonthly === 1000000, String(lbTom?.rentMonthly))

// ─── Gennemloeb gennem normaliseringen ─────────────────────────
// Proeverne ovenfor stopper ved adapterens RawListing. `normaliser` er
// det lag, der oversaetter til raekken, og det er dér `?? null` kunne
// komme til at sluge et oplyst nul.
console.log('\n══ Gennemløb gennem normaliser ══')

const VASK: VasketAdresse = {
  street: 'Attrapvej', houseNumber: '1', floor: null, door: null,
  postalCode: '2300', city: 'Prøveby',
  unitAddressUuid: crypto.randomUUID(), accessAddressUuid: null,
  addressMatchLevel: 'unit', lat: null, lng: null,
}

tjek('præmis: begge parsere gav en bolig (ellers måler resten intet)',
  psBegge != null && lbBegge != null && psNul != null && lbNul != null
  && psTom != null && lbTom != null && lbKunDep != null,
  `propstep ${psBegge != null} · lokalbolig ${lbBegge != null}`)
if (psBegge == null || lbBegge == null || psNul == null || lbNul == null
  || psTom == null || lbTom == null || lbKunDep == null) {
  console.log('\n  parseren gav null — resten af prøven kan ikke måle noget\n')
  process.exit(1)
}

const psNorm = await normaliser(psBegge!, VASK)
tjek('propstep: begge beløb når frem i øre',
  psNorm.deposit === 3600000 && psNorm.prepaidRent === 1200000,
  `${psNorm.deposit} / ${psNorm.prepaidRent}`)

const lbNorm = await normaliser(lbBegge!, VASK)
tjek('lokalbolig: begge beløb når frem i øre',
  lbNorm.deposit === 3000000 && lbNorm.prepaidRent === 1000000,
  `${lbNorm.deposit} / ${lbNorm.prepaidRent}`)

const psNulNorm = await normaliser(psNul!, VASK)
const lbNulNorm = await normaliser(lbNul!, VASK)
tjek('et oplyst nul er stadig 0 efter normaliseringen — ikke null',
  psNulNorm.deposit === 0 && psNulNorm.prepaidRent === 0
  && lbNulNorm.deposit === 0 && lbNulNorm.prepaidRent === 0,
  `propstep ${psNulNorm.deposit}/${psNulNorm.prepaidRent} · `
  + `lokalbolig ${lbNulNorm.deposit}/${lbNulNorm.prepaidRent}`)

const psTomNorm = await normaliser(psTom!, VASK)
const lbTomNorm = await normaliser(lbTom!, VASK)
tjek('manglende beløb er null efter normaliseringen — ikke 0',
  psTomNorm.deposit === null && psTomNorm.prepaidRent === null
  && lbTomNorm.deposit === null && lbTomNorm.prepaidRent === null,
  `propstep ${psTomNorm.deposit}/${psTomNorm.prepaidRent} · `
  + `lokalbolig ${lbTomNorm.deposit}/${lbTomNorm.prepaidRent}`)

// Huslejen, acontoen og indflytningsprisen skal vaere UROERTE af den her
// aendring — delene kom til ved siden af, de erstattede ingenting.
const lbKunDepNorm = await normaliser(lbKunDep!, VASK)
tjek('husleje, aconto og moveInCost er urørte af ændringen',
  lbNorm.rentMonthly === 1000000 && lbNorm.utilitiesOther === 90000
  && lbNorm.moveInCost === 5090000 && lbKunDepNorm.moveInCost === null,
  `${lbNorm.rentMonthly} / ${lbNorm.utilitiesOther} / ${lbNorm.moveInCost}`)

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
