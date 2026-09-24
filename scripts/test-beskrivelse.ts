// ═══════════════════════════════════════════════════════════════
//  listings.description: samme tal, samme svar som kortet
//
//  Beskrivelsen skrev «Med varme og vand er den samlede månedlige
//  udgift 10.500 kr.» — en påstand om fuldstændighed om NØJAGTIG det
//  tal, kortet tager forbehold for. Målt 24. september 2026:
//
//      ikke-med          1.367  ·  1.367 med påstanden  ·  100 %
//      ukendt-daekning     669  ·    669                ·  100 %
//      egen-maaler          28  ·     28                ·  100 %
//      med                  27  ·     26                ·   96 %
//
//  2.090 rækker bar sætningen. Kun de 26, hvor el er en navngiven
//  post, kunne bære den. De 28 egen-måler-boliger er de værste:
//  detaljesiden skriver ordret «Det indgår ikke i beløbet», og
//  beskrivelsen kaldte samme tal samlet — modsatte påstande på samme
//  skærm.
//
//  Prøven her måler ikke ordlyden for ordlydens skyld. Den måler, at
//  el-SPØRGSMÅLET besvares ét sted: `elUdsagn` i lib/grundlag.ts.
//  Derfor sammenlignes beskrivelsen med den funktions svar og ikke med
//  en streng, der er skrevet af her — en prøve, der gentog ordlyden,
//  ville blive grøn, den dag de to drev fra hinanden.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { genererBeskrivelse } from '../lib/normalize'
import { elUdsagn } from '../lib/grundlag'
import { eltilstand, type Eltilstand } from '../lib/eloplysning'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const BASIS = {
  propertyType: 'lejlighed' as const, rooms: 2, sizeM2: 64,
  street: 'Prøvegade', houseNumber: '1', postalCode: '5000', city: 'Odense C',
  availableFrom: null, rentMonthly: 900_000, totalMonthly: 1_050_000,
}

const lav = (poster: string[] | null, el: number | null, egen: boolean | null) =>
  genererBeskrivelse({
    ...BASIS, totalMonthlyComponents: poster,
    utilitiesElectricity: el, electricityOwnMeter: egen,
  }) ?? ''

interface Form {
  navn: string; poster: string[]; el: number | null; egen: boolean | null
  tilstand: Eltilstand; ventet: string
}

const FORMER: Form[] = [
  { navn: 'A · el kommer oveni', poster: ['rent', 'heat', 'water'], el: null, egen: null,
    tilstand: 'ikke-med',
    ventet: 'Med varme og vand betales 10.500 kr. om måneden til udlejeren — el kommer oveni.' },
  { navn: 'C · ét samlet acontobeløb', poster: ['rent', 'other'], el: null, egen: null,
    tilstand: 'ukendt-daekning',
    ventet: 'Med ét samlet acontobeløb betales 10.500 kr. om måneden til udlejeren — uvist om el er med.' },
  { navn: 'D · el er en navngiven post', poster: ['rent', 'heat', 'electricity'], el: 40_000, egen: null,
    tilstand: 'med',
    ventet: 'Med varme og el betales 10.500 kr. om måneden til udlejeren.' },
  { navn: "D' · egen måler", poster: ['rent', 'heat'], el: null, egen: true,
    tilstand: 'egen-maaler',
    ventet: 'Med varme betales 10.500 kr. om måneden til udlejeren — el betaler du selv til elselskabet.' },
]

console.log('\n══ 1 · hver el-tilstand for sig ══')
for (const f of FORMER) {
  const t = lav(f.poster, f.el, f.egen)
  const st = eltilstand({ total: BASIS.totalMonthly, el: f.el, elEgenMaaler: f.egen, poster: f.poster })
  tjek(`${f.navn}: tilstanden er ${f.tilstand}`, st === f.tilstand, String(st))
  tjek(`${f.navn}: ordlyden`, t.includes(f.ventet), `«${t}»`)
}

console.log('\n══ 2 · ingen fuldstændighedspåstand nogen steder ══')
{
  // «i alt» og «den samlede … udgift» lover, at tallet er hele
  // udgiften. Det er det ikke: el står uden for beløbet hos næsten
  // alle kilder. Prisetiketten blev døbt om af præcis den grund.
  for (const f of FORMER) {
    const t = lav(f.poster, f.el, f.egen)
    tjek(`${f.navn}: siger ikke «samlede … udgift»`,
      !/samlede\s+\S*\s*udgift/.test(t), `«${t}»`)
    tjek(`${f.navn}: siger ikke «i alt»`, !/\bi alt\b/.test(t))
    tjek(`${f.navn}: siger «til udlejeren»`, /til udlejeren/.test(t))
  }
}

console.log('\n══ 3 · el besvares ÉT sted — beskrivelsen henter svaret ══')
{
  // Kernen. Ordlyden sammenlignes ikke med en afskrift, men med det,
  // `elUdsagn` faktisk svarer. Skifter formuleringen ét sted, følger
  // prøven med; driver de to fra hinanden, bliver den rød.
  for (const f of FORMER) {
    const t = lav(f.poster, f.el, f.egen)
    const u = elUdsagn(f.tilstand)
    if (u == null) {
      tjek(`${f.navn}: intet forbehold, og intet står der`,
        !/ — /.test(t.split('. ').slice(1).join('. ')), `«${t}»`)
    } else {
      tjek(`${f.navn}: bærer NETOP elUdsagn'ets ord`, t.includes(u), `«${u}»`)
    }
    // Og ingen ANDEN tilstands ord må stå der.
    const fremmede = (['ikke-med', 'egen-maaler', 'ukendt-daekning'] as const)
      .filter((e) => e !== f.tilstand)
      .map((e) => elUdsagn(e)!)
      .filter((o) => t.includes(o))
    tjek(`${f.navn}: og ingen anden tilstands ord`, fremmede.length === 0,
      fremmede.join(', ') || 'ingen')
  }
}

console.log('\n══ 4 · ordet «undefined» kan ikke slippe ud ══')
{
  // Grenen fandtes: var komponentlisten ['rent'] alene, blev listen tom
  // og `aconto[0]` undefined — «Med undefined er den samlede månedlige
  // udgift 10.500 kr.» Den var ikke nåbar gennem beregnTotal, som giver
  // totalMonthly = null i det tilfælde, og check-constraint'en afviser
  // en tom liste. Men grenen lå der, og en skrivesti uden om
  // beregnTotal ville have ramt den.
  for (const [navn, poster] of [
    ['kun rent', ['rent']],
    ['tom liste', []],
    ['ukendt nøgle', ['rent', 'heating']],
  ] as [string, string[]][]) {
    const t = lav(poster, null, null)
    tjek(`${navn}: intet «undefined»`, !/undefined/.test(t), `«${t}»`)
    tjek(`${navn}: den uopregnede form`, /Med aconto betales/.test(t), `«${t}»`)
  }
  // Og den ukendte nøgle skrives ikke ud råt — det gamle «?? k».
  tjek('den ukendte nøgle skrives ikke ud', !/heating/.test(lav(['rent', 'heating'], null, null)))
}

console.log('\n══ 5 · ukendt total: den ærlige gren står urørt ══')
{
  const t = genererBeskrivelse({
    ...BASIS, totalMonthly: null, totalMonthlyComponents: null,
    utilitiesElectricity: null, electricityOwnMeter: null,
  }) ?? ''
  tjek('siger at totalen ikke kendes', /kendes ikke/.test(t), `«${t}»`)
  tjek('og påstår ingen total', !/betales .* til udlejeren/.test(t))
}

console.log('\n══ 6 · kildetjek: ingen anden ordbog, intet «?? k» ══')
{
  const kilde = readFileSync('lib/normalize.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  tjek('normalize har ingen egen POSTNAVN-ordbog',
    !/heat:\s*'varme'/.test(kilde))
  tjek('og intet «?? k»-fallback', !/\?\?\s*k\b/.test(kilde))
  tjek('POSTNAVN hentes fra lib/grundlag', /import \{[^}]*POSTNAVN[^}]*\} from '\.\/grundlag'/.test(kilde))
  tjek('el-tilstanden hentes fra lib/eloplysning',
    /import \{[^}]*eltilstand[^}]*\} from '\.\/eloplysning'/.test(kilde))
  tjek('opremsningen hentes fra lib/liste',
    /import \{[^}]*paaDansk[^}]*\} from '\.\/liste'/.test(kilde))
  const grundlag = readFileSync('lib/grundlag.ts', 'utf8')
  tjek('elUdsagn er eksporteret', /export function elUdsagn/.test(grundlag))
  tjek('og grundlagstekst bruger den selv', /elUdsagn\(s\.el\)/.test(grundlag))
}

console.log(fejl ? `\n  ${fejl} FEJLEDE\n` : '\n  ALT GRØNT\n')
process.exit(fejl ? 1 : 0)
