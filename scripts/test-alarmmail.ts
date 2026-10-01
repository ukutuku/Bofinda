// ═══════════════════════════════════════════════════════════════
//  ALARMMAILENS TEKST — tre usande udsagn, der landede uopfordret.
//
//  Mailen var den ENESTE brugervendte flade uden en prøve. `npm test`
//  kalder ikke `sendAlarmer`, og den returnerer kun `{ sendt, grund }`
//  — så ingen kunne læse, hvad der faktisk stod i en alarmmail. Alle
//  tre fund nedenfor var derfor usynlige for sættet.
//
//  Prøven gengiver BEGGE udgaver, ren tekst og HTML, af den samme
//  funktion afsendelsen bruger. Forlægget er fri fantasi; der røres
//  ingen database og intet netværk.
//
//  ── HVORFOR HVER PÅSTAND HAR EN MODPRØVE ────────────────────
//  Hver af de tre rettelser kan ophæves med én linje, og `modproever/`
//  har en fil pr. rettelse. Består prøven stadig, måler den ikke det,
//  den siger. Se modproever/LAES-MIG.md i #37.
// ═══════════════════════════════════════════════════════════════

import { renderToStaticMarkup } from 'react-dom/server'
import { byggAlarmmail, beskrivFiltre, kunAktive, sendAlarmer } from '../lib/alarm'
import { eltilstand, type Eltilstand } from '../lib/eloplysning'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}
void renderToStaticMarkup // JSX-runtime holdes i live for tsconfig.scripts

// ─── Forlægget ─────────────────────────────────────────────────
// Felterne er dem, `ventende()` selekterer. Typen udledes af samme
// select, så en manglende kolonne er en oversætterfejl her.
type Raekke = Parameters<typeof byggAlarmmail>[1]

const BOLIG = {
  soegningId: 's1', soegning: 'min søgning', kriterier: {} as Record<string, unknown>,
  modtager: 'nogen@proeve.invalid', paaMail: true, afmeldt: null,
  token: 'tok', sidstSendt: null, matchId: 'm1', matchetKl: new Date('2026-09-01'),
  adresse: 'Prøvegade 1, 2300 København S', postnr: '2300', by: 'København S',
  areal: 64, vaerelser: 3, leje: 900_000, total: 1_050_000, indflytning: null,
  el: null, elEgenMaaler: null, poster: ['rent', 'heat', 'water'] as unknown,
  boligId: 'b1', kilde: 'Prøvekilde', foerstSet: new Date('2026-09-01'),
  hosKilden: null, status: 'active' as string,
} as unknown as Raekke

const med = (x: Partial<Record<string, unknown>>) =>
  ({ ...(BOLIG as unknown as Record<string, unknown>), ...x }) as unknown as Raekke

console.log('\n══ 1 · boliger, der er taget ned, kommer ikke med ══')
{
  // Forudsætningen først: en aktiv bolig ER med. Uden den kunne resten
  // bestå, fordi mailen var tom af en anden grund.
  const kunAktiv = byggAlarmmail([BOLIG], BOLIG, 'min søgning')
  tjek('forudsætning: en aktiv bolig står i mailen',
    kunAktiv.tekst.includes('Prøvegade 1'))
  tjek('… og emnet tæller den', kunAktiv.emne.startsWith('1 ny bolig'), kunAktiv.emne)

  // `byggAlarmmail` får de FILTREREDE rækker — filtreringen sker i
  // sendAlarmer. Prøven her måler, at emnet og overskriften følger den
  // liste, de faktisk fik: det var dét, der ville være gået galt, hvis
  // filtreringen var sket inde i `linjer` i stedet for før `emne`.
  const nedtaget = med({ boligId: 'b2', adresse: 'Nedtagetvej 2, 2300 København S', status: 'delisted' })
  const begge = byggAlarmmail([BOLIG, nedtaget], BOLIG, 'min søgning')
  tjek('forudsætning: gives BEGGE rækker, nævner mailen begge',
    begge.emne.startsWith('2 nye boliger') && begge.tekst.includes('Nedtagetvej 2'))

  // KODENS eget filter, ikke prøvens. Første udgave skrev
  // `.filter(b => b.status === 'active')` her — og så målte prøven sit
  // eget forlæg: modprøven, der fjerner filteret i `sendAlarmer`, blev
  // kun rød på kildetjekket, ikke på en påstand om teksten.
  const filtreret = kunAktive([BOLIG, nedtaget])
  const m = byggAlarmmail(filtreret, BOLIG, 'min søgning')
  tjek('den nedtagne bolig står IKKE i teksten', !m.tekst.includes('Nedtagetvej 2'))
  tjek('… og ikke i HTML-en', !m.html.includes('Nedtagetvej 2'))
  // Fælden: emnet blev regnet af hele gruppen, FØR linjerne blev bygget.
  tjek('emnet tæller 1, ikke 2 — tallet følger listen',
    m.emne.startsWith('1 ny bolig') && !m.emne.startsWith('2'), m.emne)
  tjek('og overskriften i HTML-en gør det samme',
    m.html.includes('<strong>1 ny bolig</strong>') && !m.html.includes('2 nye boliger'))
  tjek('den rene tekst siger «1 ny bolig matcher»',
    m.tekst.startsWith('1 ny bolig matcher'))
}

console.log('\n══ 2 · «din grænse» kun når søgningen HAR en ══')
{
  const GRAENSE = 'din grænse'
  const uTotal = { total: null, leje: 900_000 }

  // Uden prisfilter: sætningen må ikke stå.
  const uden = med({ ...uTotal, kriterier: { postnr: '2300', vaerelserMin: 3 } })
  const a = byggAlarmmail([uden], uden, 'uden grænse')
  tjek('forudsætning: boligen ER i mailen', a.tekst.includes('Prøvegade 1'))
  tjek('forudsætning: totalen er ukendt, så prisen siger det',
    a.tekst.includes('total ukendt'))
  tjek('uden prisfilter står «din grænse» IKKE i teksten', !a.tekst.includes(GRAENSE))
  tjek('… og ikke i HTML-en', !a.html.includes(GRAENSE))
  // Og mailen må ikke modsige sig selv: filterlinjen nævner ingen grænse.
  tjek('… hvilket passer med filterlinjen, der heller ikke nævner en',
    !beskrivFiltre({ postnr: '2300', vaerelserMin: 3 }).includes('kr.'))

  // Med prisfilter: sætningen SKAL stå — ellers måler vagten ingenting.
  for (const [navn, k] of [
    ['prisMax', { postnr: '2300', prisMax: 1_200_000 }],
    ['prisMin', { postnr: '2300', prisMin: 500_000 }],
  ] as const) {
    const m = med({ ...uTotal, kriterier: k })
    const r = byggAlarmmail([m], m, 'med grænse')
    tjek(`med ${navn} står forbeholdet i teksten`, r.tekst.includes(GRAENSE))
    tjek(`med ${navn} står det også i HTML-en`, r.html.includes(GRAENSE))
  }

  // ── DEN NAIVE RETTELSE, DER VILLE HAVE BRUDT FARVEN ──────────
  // `uvis` var ÉT felt og besvarede to spørgsmål: skal prisblokken
  // være grøn, og skal forbeholdet stå. Gjorde man bare `uvis` falsk
  // uden en grænse, blev en bolig UDEN kendt total GRØN — og en grøn
  // total betyder «vi kender hele beløbet til udlejeren».
  tjek('uden grænse er prisen stadig IKKE grøn', a.html.includes('#14161a'))
  tjek('… og den grønne står der ikke', !a.html.includes('#14624f'))
  const kendt = byggAlarmmail([BOLIG], BOLIG, 'kendt total')
  tjek('en KENDT total er grøn', kendt.html.includes('#14624f'))
}

console.log('\n══ 3 · el-teksten er udtømmende over Eltilstand ══')
{
  // Alle fire tilstande fremkaldes gennem den RIGTIGE udledning —
  // ikke ved at skrive tilstanden ind. Ellers målte prøven sit eget
  // forlæg i stedet for `eltilstand`.
  const FORLAEG: Record<Eltilstand, Record<string, unknown>> = {
    med: { el: 15_000, poster: ['rent', 'heat', 'electricity'] },
    'egen-maaler': { el: null, elEgenMaaler: true, poster: ['rent', 'heat'] },
    'ikke-med': { el: null, poster: ['rent', 'heat', 'water'] },
    'ukendt-daekning': { el: null, poster: ['other'] },
  }
  const sete = new Set<string>()
  for (const [forventet, felter] of Object.entries(FORLAEG) as [Eltilstand, Record<string, unknown>][]) {
    const b = med({ ...felter, total: 1_050_000 })
    tjek(`${forventet}: udledningen giver tilstanden`, eltilstand(b as never) === forventet)
    const r = byggAlarmmail([b], b, 'el')
    const linje = r.tekst.split('\n').find((l) => /^ {2}(el|aconto)/i.test(l.trim()) === false
      && /el |aconto er/.test(l)) ?? ''
    if (forventet === 'med') {
      tjek('med: der står ingen el-linje',
        !r.tekst.includes('el indgår ikke') && !r.tekst.includes('el afregnes')
        && !r.tekst.includes('aconto er ét samlet'))
    } else {
      tjek(`${forventet}: der står en el-linje`, linje.trim().length > 0, linje.trim())
      sete.add(linje.trim())
    }
  }
  tjek('de tre tekster er FORSKELLIGE — ingen falder igennem til den samme',
    sete.size === 3, `${sete.size} forskellige`)
  // Den påstand, den fjerde tilstand blev indført for at undgå, må
  // kun stå om «ikke-med».
  const klump = med({ el: null, poster: ['other'], total: 1_050_000 })
  tjek('«ukendt-dækning» siger IKKE «el indgår ikke»',
    !byggAlarmmail([klump], klump, 'el').tekst.includes('el indgår ikke'))
}

console.log('\n══ 4 · elUdsagn er udtømmende — og CLAUDE.md\'s tal er TALT ══')
{
  const { elUdsagn } = await import('../lib/grundlag')
  // `elUdsagn` er den FJERDE oversættelse af `Eltilstand`, og den
  // værste at falde igennem i: den svarer `null`, og det bliver en tom
  // streng i den genererede beskrivelse — et forbehold, der forsvinder
  // uden spor, i en tekst der står i `listings.description`.
  const svar = new Map<Eltilstand, string | null>()
  for (const t of ['med', 'egen-maaler', 'ikke-med', 'ukendt-daekning'] as const) {
    svar.set(t, elUdsagn(t))
  }
  tjek('«med» giver intet forbehold — el står i opregningen', svar.get('med') === null)
  const tre = [...svar.entries()].filter(([t]) => t !== 'med')
  tjek('de tre øvrige har hver sit udsagn',
    tre.every(([, v]) => typeof v === 'string' && v.length > 0))
  tjek('… og de er FORSKELLIGE — ingen falder igennem til den samme',
    new Set(tre.map(([, v]) => v)).size === 3, tre.map(([, v]) => v).join(' · '))
  tjek('null ind (ingen total) giver intet forbehold', elUdsagn(null) === null)

  // Og den TALTE optælling, bundet til koden. CLAUDE.md sagde «de fire
  // steder» og opregnede tre flader forkert; nu står tabellen der, og
  // denne linje holder den fast. Kilderne tælles, ikke læses.
  const { readFileSync } = await import('node:fs')
  const steder = [
    ['app/Boligkort.tsx', /tilstand === 'egen-maaler'/],
    ['app/bolig/[id]/page.tsx', /t === 'egen-maaler'/],
    ['lib/alarm.ts', /satisfies Record<Eltilstand, string \| null>/],
    ['lib/grundlag.ts', /satisfies Record<Eltilstand, string \| null>/],
  ] as const
  const fundne = steder.filter(([f, re]) => re.test(readFileSync(f, 'utf8')))
  tjek('FIRE steder oversætter en Eltilstand til el-forbeholdet',
    fundne.length === 4, `${fundne.length}: ${fundne.map(([f]) => f).join(', ')}`)
  const bundne = steder.filter(([f]) => /alarm|grundlag/.test(f))
    .filter(([f, re]) => re.test(readFileSync(f, 'utf8')))
  tjek('… og to af dem er bundet med satisfies i dag', bundne.length === 2)
  tjek('CLAUDE.md bærer den målte tabel, ikke en opregning',
    /Fire steder oversætter en `Eltilstand` til el-forbeholdet/
      .test(readFileSync('CLAUDE.md', 'utf8')))
}

console.log('\n══ 5 · kildetjek: vagterne står i koden, ikke i en kommentar ══')
{
  const { readFileSync } = await import('node:fs')
  // KODELAGET, ikke den rå fil. Hele hovedet over hver vagt beskriver
  // fejlen med de samme ord, så en søgning i den rå fil ville ramme
  // prosaen i stedet for koden — præcis `/tilbud === null/`-fejlen.
  //
  // Strimlingen står her som to `.replace()`, fordi `scripts/kildetjek.ts`
  // ligger i en anden åben PR (#41) og endnu ikke er på main. Når den
  // lander, skal denne linje blive `kildelag(readFileSync(...))`: den
  // nuværende form ser kun kommentarer, der står ALENE på linjen, og
  // den kender ikke strenge.
  const kode = readFileSync('lib/alarm.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  tjek('status-filteret står i afsendelsesvejen',
    /const g = kunAktive\(alle\)/.test(kode)
    && /g\.filter\(\(b\) => b\.status === 'active'\)/.test(kode))
  tjek('el-teksten er bundet med satisfies Record<Eltilstand',
    /satisfies Record<Eltilstand, string \| null>/.test(kode))
  tjek('grænsen udledes af søgningens egne kriterier',
    /harGraense = kriterier\.prisMin != null \|\| kriterier\.prisMax != null/.test(kode))
  tjek('farven læser ukendtTotal, forbeholdet læser overGraense',
    /l\.ukendtTotal \? '#14161a'/.test(kode) && /l\.overGraense \?/.test(kode))
  tjek('og `uvis` findes ikke længere som ét felt for to spørgsmål',
    !/\buvis\b/.test(kode))
  tjek('sendAlarmer er stadig eksporteret', typeof sendAlarmer === 'function')
}

console.log(fejl ? `\n  ${fejl} FEJLEDE\n` : '\n  ALT GRØNT\n')
process.exit(fejl ? 1 : 0)
