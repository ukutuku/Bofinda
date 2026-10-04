// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//
//  OVERTAGELSEN SIGES ÉT STED — faktablokken og beskrivelsen må ikke
//  kunne svare forskelligt.
//
//  Fejlen, prøven findes for, er målt på det kørende site 4. oktober
//  2026: 15 af 55 stikprøvede boligsider skrev «Bofinda kan ikke fastslå,
//  hvornår boligen kan overtages» i faktablokken OG «Ledig fra 1. januar
//  2027.» tre afsnit nede i beskrivelsen. 5 af 5 for hver af Propstep,
//  LokalBolig og findbolig.nu.
//
//  Og faktablokken havde ret. For netop de tre kilder er datofeltet
//  efterprøvet og AFVIST som tidsevidens — `brugbarSomTiming: false`.
//  Propsteps ældste værdi er 2002-08-31. Beskrivelsen læste feltet råt og
//  gjorde det afviste til en bekræftet dato. Målt samme dag: 12 «Ledig
//  fra»-datoer i FORTIDEN på 68 hentede boligsider, den ældste 231 dage.
//
//  Prøven kører mod de RIGTIGE kontrakter i lib/kildekontrakt.ts, ikke
//  mod en attrap: det er kontrakternes egne afgørelser, der skal styre
//  teksten, og en attrap ville måle prøvens eget forlæg.
// ═══════════════════════════════════════════════════════════════

import { fortolkAvailability, overtagelsesudsagn } from '../lib/availability'
import { KILDEKONTRAKTER } from '../lib/kildekontrakt'
import { genererBeskrivelse } from '../lib/normalize'
import type { AvailabilityFacts } from '../lib/adapter'
import { isoDato } from '../lib/dato'

/** IsoDate er en maerket type — datoen skal gennem kildens egen vagt. */
const iso = (s: string) => isoDato(s)!

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

const NU = new Date('2026-10-04T08:00:00Z')
const FELTER = {
  propertyType: 'lejlighed' as const, rooms: 3, sizeM2: 84,
  street: 'Prøvevej', houseNumber: '1', postalCode: '2300', city: 'København S',
  rentMonthly: 1_000_000, totalMonthly: null, totalMonthlyComponents: null,
  utilitiesElectricity: null, electricityOwnMeter: null,
}
const udsagn = (kilde: string, fakta: AvailabilityFacts) =>
  overtagelsesudsagn(fortolkAvailability(fakta, KILDEKONTRAKTER[kilde]!, NU).timing)
const tekst = (kilde: string, fakta: AvailabilityFacts) =>
  genererBeskrivelse({ ...FELTER, overtagelse: udsagn(kilde, fakta) })!

console.log('\n══ 1 · UKENDT: et afvist datofelt bliver ikke til en dato ══')
for (const kilde of ['propstep', 'lokalbolig', 'findbolig']) {
  const brugbar = KILDEKONTRAKTER[kilde]!.datofelt?.brugbarSomTiming
  tjek(`${kilde}: datofeltet er afvist i kontrakten`, brugbar === false, `brugbarSomTiming=${brugbar}`)
  const o = udsagn(kilde, { sourceAvailabilityDate: iso('2027-01-01') })
  tjek(`${kilde}: udsagnet er «ukendt»`, o.slags === 'ukendt', o.slags)
  const t = tekst(kilde, { sourceAvailabilityDate: iso('2027-01-01') })
  tjek(`${kilde}: teksten TIER om overtagelsen`,
    !/Ledig fra|overtages/i.test(t), t.slice(-70))
}

console.log('\n══ 2 · den gamle fejl kan ikke genindføres ══')
{
  // Datoen fra kilden er den SAMME i begge prøver ovenfor og nedenfor.
  // Forskellen er kontrakten — altså domænet, ikke feltet.
  const afvist = tekst('propstep', { sourceAvailabilityDate: iso('2027-01-01') })
  const godkendt = tekst('balder', { sourceAvailabilityDate: iso('2027-01-01') })
  tjek('samme dato, to kilder: kun den godkendte giver en dato i teksten',
    !afvist.includes('2027') && godkendt.includes('1. januar 2027'),
    `afvist=«${afvist.slice(-40)}» · godkendt=«${godkendt.slice(-30)}»`)
  // Et datofelt kan ikke længere NÅ generatoren: typen har intet at putte
  // det i. Vagten er oversætteren, ikke en påstand her — men en prøve, der
  // siger det, gør reglen læselig.
  tjek('generatoren har ikke længere et råt datofelt',
    !Object.keys({ ...FELTER }).includes('availableFrom'))
}

console.log('\n══ 3 · KONFLIKT: begge steder siger konflikt ══')
{
  // Kilden siger «ledig nu» OG en dato i fremtiden. To tidssignaler, uenige.
  const fakta: AvailabilityFacts = { rentalAvailableNow: true, sourceAvailabilityDate: iso('2027-01-01') }
  const o = udsagn('home', fakta)
  tjek('udsagnet er «conflict»', o.slags === 'conflict', o.slags)
  const t = tekst('home', fakta)
  tjek('teksten siger modstridende — og nævner INGEN dato',
    t.includes('modstridende') && !t.includes('2027'), t.slice(-80))
}

console.log('\n══ 4 · DOKUMENTERET: samme dato begge steder ══')
{
  const fakta: AvailabilityFacts = { sourceAvailabilityDate: iso('2026-11-01') }
  const o = udsagn('balder', fakta)
  tjek('udsagnet er «senere» med kildens dato', o.slags === 'senere' && o.dato === '2026-11-01',
    JSON.stringify(o))
  tjek('teksten bærer samme dato', tekst('balder', fakta).includes('Ledig fra 1. november 2026.'),
    tekst('balder', fakta).slice(-40))
}

console.log('\n══ 5 · «nu» og kildens eget ord ══')
{
  const nu = udsagn('home', { rentalAvailableNow: true })
  tjek('rentalAvailableNow → «nu»', nu.slags === 'nu', nu.slags)
  tjek('teksten siger «Kan overtages nu.»',
    tekst('home', { rentalAvailableNow: true }).includes('Kan overtages nu.'))
  const snarest = udsagn('dacas', { takeoverText: 'Snarest' })
  tjek('kun takeoverText → «snarest», kildens eget ord', snarest.slags === 'snarest', snarest.slags)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
