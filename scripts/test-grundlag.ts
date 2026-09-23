// ═══════════════════════════════════════════════════════════════
//  Grundlagslinjen: fire former, ét svar, præcis én linje.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  Kortet havde en posterlinje og en el-linje, som svarede på det
//  SAMME spørgsmål — «hvad dækker tallet?» — fra hver sin ende, og som
//  stod to steder i rækkefølgen. De er slået sammen til én.
//
//  Målt på 1.864 synlige boliger: ikke-med 857 (46 %), total ukendt
//  504 (27 %), ukendt-daekning 466 (25 %), egen-maaler 20, med 17.
//  De tre store er næsten lige store — der findes altså ingen
//  normaltilstand at afvige fra, og linjen skal bære alle tre lige
//  godt. Derfor prøves hver form for sig.
//
//  ── DEN VIGTIGSTE PRØVE ───────────────────────────────────────
//  At en form A-bolig ALDRIG får egen-måler-formuleringen. «Du betaler
//  selv til elselskabet» er en påstand om kundens forhold, ikke om
//  vores data, og den må kun stå, når kilden selv har sagt det. De 857
//  form A-boliger er netop dem, hvor vi IKKE ved det.
//
//  Køres gennem scripts/testbase.ts. Alle data er syntetiske.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Kort } from '../app/Boligkort'
import { grundlagstekst } from '../lib/grundlag'
import { eltilstand } from '../lib/eloplysning'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const NU = new Date('2026-09-23T12:00:00Z')
const EGENMAALER = /betaler du selv til elselskabet/

const BASIS = {
  id: '00000000-0000-4000-8000-0000000000b1',
  adresse: 'Prøvegade 1, 9001 Prøveby', vej: 'Prøvegade', husnr: '1',
  etage: null, doer: null, postnr: '9001', by: 'Prøveby',
  kilde: 'proeve', kildeNavn: 'Prøvekilde', kildetype: 'feed',
  match: 'unit', areal: 70, vaerelser: 3, type: 'lejlighed',
  // ⚠ FELTET HEDDER `elEgenMaaler`, ikke `egenMaaler`. Foerste udgave
  // af proeven skrev det forkerte navn, og form D' faldt tilbage paa
  // «el kommer oveni» — proeven fangede det, men kun fordi den
  // sammenligner med en VENTET streng. Havde den bare maalt «der staar
  // en linje», var den groen.
  //
  // Grunden til at compileren ikke fangede det: `Kort` kaldes med
  // `as never`, og castet slaar netop den kontrol fra, der ville have
  // set det. Et cast er en paastand om, at man ved bedre end
  // compileren — her vidste jeg ikke bedre.
  leje: 900_000, billeder: 0, forside: null, billedforbehold: false,
  foerstSet: new Date('2026-09-01T00:00:00Z'), hosKilden: null,
  ledig: null, ogsaaHos: [], availabilityFacts: null, indflytning: null,
}

/** De fem tilstande, som de findes i produktionen. */
const FORMER = [
  {
    navn: 'A · el indgår ikke', andel: '857 · 46 %',
    b: { total: 1_050_000, el: null, elEgenMaaler: null, poster: ['rent', 'heat', 'water'] },
    ventet: 'husleje + varme + vand · el kommer oveni',
  },
  {
    navn: 'B · total ukendt', andel: '504 · 27 %',
    b: { total: null, el: null, elEgenMaaler: null, poster: null },
    ventet: 'Spørg udlejeren om varme og vand',
  },
  {
    navn: 'C · ét samlet acontobeløb', andel: '466 · 25 %',
    b: { total: 1_100_000, el: null, elEgenMaaler: null, poster: ['rent', 'other'] },
    ventet: 'husleje + ét samlet acontobeløb · uvist om el er med',
  },
  {
    navn: 'D · el med i tallet', andel: '17 · 0,9 %',
    b: { total: 1_200_000, el: 40_000, elEgenMaaler: null, poster: ['rent', 'heat', 'water', 'electricity'] },
    ventet: 'husleje + varme + vand + el',
  },
  {
    navn: "D' · egen måler", andel: '20 · 1,1 %',
    b: { total: 1_000_000, el: null, elEgenMaaler: true, poster: ['rent', 'heat', 'water'] },
    ventet: 'husleje + varme + vand · el betaler du selv til elselskabet',
  },
] as const

console.log('\n══ 1 · hver form siger sit ══')
for (const f of FORMER) {
  const el = eltilstand(f.b)
  const tekst = grundlagstekst({ totalKendt: f.b.total != null, el, poster: f.b.poster })
  tjek(`${f.navn} (${f.andel})`, tekst === f.ventet, `«${tekst}»`)
}

console.log('\n══ 2 · form A får ALDRIG egen-måler-formuleringen ══')
{
  // Den påstand er stærkere end de andre: den siger noget om KUNDENS
  // forhold. De 857 form A-boliger er netop dem, hvor vi ikke ved det.
  const a = FORMER[0]!
  const tekst = grundlagstekst({ totalKendt: true, el: eltilstand(a.b), poster: a.b.poster })
  tjek('teksten nævner ikke elselskabet', !EGENMAALER.test(tekst), `«${tekst}»`)
  tjek('men den siger, at el kommer oveni', /el kommer oveni/.test(tekst))

  // Og omvendt: kun når kilden HAR sagt det.
  const d = FORMER[4]!
  tjek("D' siger det, fordi kilden har sagt det",
    EGENMAALER.test(grundlagstekst({ totalKendt: true, el: eltilstand(d.b), poster: d.b.poster })))

  // Ingen anden form må bære den.
  const andre = FORMER.filter((f) => f.navn !== d.navn)
  const brud = andre.filter((f) =>
    EGENMAALER.test(grundlagstekst({ totalKendt: f.b.total != null, el: eltilstand(f.b), poster: f.b.poster })))
  tjek('ingen af de øvrige fire bærer den', brud.length === 0,
    brud.map((f) => f.navn).join(', ') || 'ingen')
}

console.log('\n══ 3 · præcis ÉN grundlagslinje, uanset form ══')
for (const f of FORMER) {
  const markup = renderToStaticMarkup(createElement(Kort as never, {
    b: { ...BASIS, ...f.b }, nu: NU,
  }))
  const antal = (markup.match(/class="kort-grundlag"/g) ?? []).length
  tjek(`${f.navn}: én linje`, antal === 1, `${antal}`)
}

console.log('\n══ 4 · el-oplysningen kan ikke stå to steder ══')
{
  // Den gamle dobbelthed: posterlinjen sagde hvad der VAR med, el-linjen
  // hvad der IKKE var. Vender den tilbage, står svaret to steder igen.
  const a = FORMER[0]!
  const markup = renderToStaticMarkup(createElement(Kort as never, {
    b: { ...BASIS, ...a.b }, nu: NU,
  }))
  tjek('ingen .el i markuppen', !/class="el"/.test(markup))
  tjek('ingen .poster i markuppen', !/class="poster"/.test(markup))
  tjek('ingen gul .ukendt-boks', !/class="ukendt"/.test(markup))

  // Hele el-udsagnet skal stå INDE i grundlagslinjen — ikke ved siden af.
  const linjer = [...markup.matchAll(/class="kort-grundlag"[^>]*>(.*?)</g)].map((m) => m[1] ?? '')
  const iLinjen = linjer.some((l) => /el kommer oveni/.test(l))
  const udenfor = markup.replace(/class="kort-grundlag"[^>]*>.*?</g, '')
  tjek('el-udsagnet står i grundlagslinjen', iLinjen)
  tjek('og INTET andet sted i kortet', !/el kommer oveni/.test(udenfor))

  // ═══ OG FOR HVER FORM, MED ALLE TRE ORDLYDE ═══
  //
  // Ovenstående prøver form A med form A's egen ordlyd. En modprøve
  // viste, at det ikke rækker: en genindført el-note med en ANDEN
  // tilstands ordlyd — eller på en anden form — glider igennem.
  // Udsagnene udledes af `grundlagstekst` selv, så de følger ordlyden.
  const ELUDSAGN = (['ikke-med', 'egen-maaler', 'ukendt-daekning'] as const)
    .map((el) => grundlagstekst({ totalKendt: true, el, poster: ['rent'] }).split(' · ')[1] ?? '')
  tjek('alle tre el-udsagn kunne udledes', ELUDSAGN.every((u) => u.length > 0),
    ELUDSAGN.join(' / '))
  for (const f of FORMER) {
    const m = renderToStaticMarkup(createElement(Kort as never, {
      b: { ...BASIS, ...f.b }, nu: NU,
    }))
    const ude = m.replace(/class="kort-grundlag"[^>]*>.*?</g, '')
    const dubletter = ELUDSAGN.filter((u) => ude.includes(u))
    tjek(`${f.navn}: intet el-udsagn uden for grundlagslinjen`,
      dubletter.length === 0, dubletter.join(', ') || 'ingen')
  }
}

console.log('\n══ 4b · en ukendt post kan ikke slippe ud som dansk tekst ══')
{
  // Fallbacket var `POSTNAVN[p] ?? p`, og så stod kildens engelske
  // nøgle midt i sætningen. En prøvebolig med `'heating'` (ordet hedder
  // `heat`) gengav «husleje + heating + vand» på kortet, og ingen
  // prøve så det — fixturet går gennem `as never`.
  const t = grundlagstekst({ totalKendt: true, el: 'ikke-med', poster: ['rent', 'heating', 'water'] })
  tjek('den ukendte nøgle skrives ikke ud', !/heating/.test(t), `«${t}»`)

  // Og den må ikke bare springes over: «husleje + vand» ville påstå,
  // at acontoen kun dækker vand, om et beløb der også dækker varme.
  // Kan ét led ikke oversættes, kan listen ikke opregnes.
  tjek('og listen opregnes slet ikke', /^husleje \+ aconto/.test(t), `«${t}»`)
  tjek('el-forbeholdet står der stadig', /el kommer oveni/.test(t), `«${t}»`)

  // Kendte nøgler opregnes uaendret.
  const k = grundlagstekst({ totalKendt: true, el: 'ikke-med', poster: ['rent', 'heat', 'water'] })
  tjek('kendte nøgler opregnes som før', k.startsWith('husleje + varme + vand'), `«${k}»`)
}

console.log('\n══ 5 · kildetjek: ingen genindført el-linje ══')
{
  const kilde = readFileSync('app/Boligkort.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  tjek('der findes ingen Ellinje-komponent mere',
    !/function Ellinje/.test(kilde))
  tjek('og ingen className="el"', !/className="el"/.test(kilde))
  const gemt = readFileSync('app/min-side/Gemtkort.tsx', 'utf8')
  tjek('Gemtkort bruger SAMME komponent, ikke en kopi',
    /import \{[^}]*\bGrundlag\b[^}]*\} from '\.\.\/Boligkort'/.test(gemt))
  const grundlag = readFileSync('lib/grundlag.ts', 'utf8')
  tjek('teksten regnes i lib/grundlag.ts, ikke i en komponent',
    /export function grundlagstekst/.test(grundlag))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl ? 1 : 0)
