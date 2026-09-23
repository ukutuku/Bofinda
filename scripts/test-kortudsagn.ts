// ═══════════════════════════════════════════════════════════════
//  Boligkortets udsagn: ét klassenavn, én betydning.
//
//  ── HVORFOR FILEN FINDES ──────────────────────────────────────
//  `className="el"` bar TRE ting på gruppekortet: el-forbeholdet,
//  «1 af 10 reserveret» og ansøgningsopdelingen. Fundet i produktionens
//  HTML, hvor det samme kort havde to «el»-divs, der ikke handlede om el.
//
//  Det er ikke en kosmetisk fejl. Et klassenavn er et UDSAGN om hvad et
//  element er: en stiländring for el-forbeholdet ramte reservations-
//  status, og enhver måling på `.el` talte tre ting som én. Det er samme
//  familie som CLAUDE.md's dyreste regel — to udtryk for det samme
//  spørgsmål — bare vendt om: ét udtryk for tre spørgsmål.
//
//  Og «reserveret» stod to steder med to udseender: som ord i metalinjen
//  når det gjaldt alle, som el-stylet div når det gjaldt nogle. Samme
//  faktum, to steder. Nu ét sted på begge korttyper.
//
//  ── PRØVEN MÅLER MARKUP, IKKE HENSIGT ─────────────────────────
//  Kortene gengives med `renderToStaticMarkup`, og der tælles klasser i
//  det, der faktisk kommer ud. En prøve, der kun læste kilden, ville
//  være grøn, hvis nogen flyttede `el` ind i en variabel.
//
//  Kildetjekket er der ALLIGEVEL, som andet lag: det fanger en
//  genforening på et kort, prøvens data ikke rammer.
//
//  Køres gennem scripts/testbase.ts. Alle data er syntetiske.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Gruppekort, Kort } from '../app/Boligkort'
import { paaDansk } from '../lib/liste'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

/** Hvor mange gange bærer markuppen præcis denne klasse? */
const klasser = (markup: string, navn: string) =>
  (markup.match(new RegExp(`class="${navn}"`, 'g')) ?? []).length

/** Teksten inde i hvert element med den klasse. */
const indhold = (markup: string, navn: string) =>
  [...markup.matchAll(new RegExp(`class="${navn}"[^>]*>(.*?)<`, 'g'))].map((m) => m[1] ?? '')

const NU = new Date('2026-09-23T12:00:00Z')

const BOLIG = {
  id: '00000000-0000-4000-8000-0000000000a1',
  adresse: 'Prøvegade 1, 9001 Prøveby', vej: 'Prøvegade', husnr: '1',
  etage: null, doer: null, postnr: '9001', by: 'Prøveby',
  kilde: 'proeve', kildeNavn: 'Prøvekilde', kildetype: 'feed',
  match: 'unit', areal: 70, vaerelser: 3, type: 'lejlighed',
  leje: 900_000, total: 1_050_000, poster: ['rent', 'heating', 'water'],
  egenMaaler: null, billeder: 0, forside: null, billedforbehold: false,
  foerstSet: new Date('2026-09-01T00:00:00Z'), hosKilden: null,
  ledig: null, ogsaaHos: [], availabilityFacts: null,
}

/** Gruppe med: delvis reservation + blandet ansøgning + el-forbehold. */
const GRUPPE = {
  noegle: { kilde: 'proeve', postnr: '9001', vej: 'Prøvegade', vaerelser: 3, total: true, landlordId: null },
  antal: 10,
  repraesentant: BOLIG,
  prisMin: 1_050_000, prisMax: 1_100_000,
  arealMin: 70, arealMax: 75, type: 'lejlighed',
  ledigMin: null, ledigMax: null, ledigUkendte: 0,
  availability: {
    timing: { nu: 10, senere: 0, unknown: 0, conflict: 0 },
    // 1 af 10 reserveret → den delvise linje.
    marked: { paa_markedet: 9, reserveret: 1, udlejet: 0, unknown: 0, conflict: 0 },
    // 3 venteliste / 7 almindelig → den blandede opdeling.
    ansoegning: { normal: 7, venteliste: 3, unknown: 0, conflict: 0 },
    adgang: { bopaelskrav: 0, medlemskrav: 0 },
    tidligstSenere: null, ensDatoer: true,
  },
  indflytningMin: null, indflytningMax: null,
  ensPoster: true,
  // el-forbeholdet: mindst én uden el-beløb, og aconto er én klump.
  nogenUdenEl: true, alleUdenElHarEgenMaaler: false, nogenUkendtDaekning: true,
  matchende: null,
  nyesteMarkedet: new Date('2026-09-01T00:00:00Z'),
}

console.log('\n══ 1 · ét klassenavn, én betydning ══')
const gm = renderToStaticMarkup(createElement(Gruppekort as never, { g: GRUPPE, nu: NU }))
{
  const antalEl = klasser(gm, 'el')
  tjek('gruppekortet har PRÆCIS ÉN .el', antalEl === 1, `${antalEl}`)
  const tekst = indhold(gm, 'el').join(' | ')
  tjek('og den handler om EL', /el /i.test(tekst) || /Aconto er ét samlet beløb/.test(tekst),
    `«${tekst}»`)
  tjek('.el bærer ikke reservationsstatus', !/reserveret/i.test(tekst), `«${tekst}»`)
  tjek('.el bærer ikke ansøgningsform', !/venteliste|almindelig/i.test(tekst), `«${tekst}»`)

  tjek('ansøgningsopdelingen har sin EGEN klasse',
    klasser(gm, 'gruppe-fordeling') === 1, `${klasser(gm, 'gruppe-fordeling')}`)
  tjek('og den indeholder opdelingen',
    /venteliste/.test(indhold(gm, 'gruppe-fordeling').join('')),
    `«${indhold(gm, 'gruppe-fordeling').join('')}»`)
}

console.log('\n══ 2 · reserveret: ét sted, ét udseende ══')
{
  const meta = indhold(gm, 'kort-meta').join(' ')
  tjek('gruppekortet: «1 af 10 reserveret» står i kort-meta',
    /1 af 10 reserveret/.test(meta), `«${meta}»`)

  // Ingen anden klasse må bære den.
  const udenMeta = gm.replace(/class="kort-meta"[^>]*>.*?<\/p>/g, '')
  tjek('og INGEN anden klasse bærer reservationsstatus',
    !/reserveret/i.test(udenMeta),
    /reserveret/i.test(udenMeta) ? 'staar ogsaa et andet sted' : 'kun ét sted')

  // ═══ ENKELTKORTET SKAL FAKTISK VÆRE RESERVERET ═══
  //
  // Første udgave satte `{ rawMarketStatus: 'reserveret' }` — en nøgle,
  // domænet ikke kender. Den blev ignoreret (med en advarsel i loggen),
  // kortet var aldrig reserveret, og BEGGE påstande herunder var
  // tomme: kortet har altid en kort-meta, og det havde ingen .el med
  // «reserveret», fordi det ikke havde reservationsstatus overhovedet.
  //
  // Nøglen er `rawStatus`, og den slås op i kildens KONTRAKT. Derfor
  // en rigtig kilde: propstep.statusser['Reserved'] → marked:
  // ['reserveret'] (lib/kildekontrakt.ts). Med en opdigtet kilde-slug
  // kan prøven ikke nå reservationsstatus ad nogen vej.
  const reserveretBolig = {
    ...BOLIG,
    kilde: 'propstep', kildeNavn: 'Propstep',
    availabilityFacts: { rawStatus: 'Reserved' },
  }
  const em = renderToStaticMarkup(createElement(Kort as never, { b: reserveretBolig, nu: NU }))
  const emMeta = indhold(em, 'kort-meta').join(' ')
  tjek('enkeltkortet ER reserveret (ellers måler resten ingenting)',
    /reserveret/i.test(em), 'ingen reservationsstatus i markuppen')
  tjek('enkeltkortet bruger OGSÅ kort-meta til markedsstatus',
    /reserveret/i.test(emMeta), `«${emMeta}»`)
  tjek('enkeltkortet har ingen .el med reservationsstatus',
    !/reserveret/i.test(indhold(em, 'el').join(' ')))
  const emUdenMeta = em.replace(/class="kort-meta"[^>]*>.*?<\/p>/g, '')
  tjek('og ingen anden klasse bærer den heller',
    !/reserveret/i.test(emUdenMeta))
}

console.log('\n══ 1b · kildetjek: ingen genforening ══')
{
  const kilde = readFileSync('app/Boligkort.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const antal = (kilde.match(/className="el"/g) ?? []).length
  tjek('className="el" står PRÆCIS ét sted i kilden', antal === 1,
    antal === 1 ? 'kun Ellinje' : `${antal} steder — er de tre betydninger genforenet?`)
  tjek('gruppe-fordeling findes som egen klasse',
    kilde.includes('className="gruppe-fordeling"'))
}

console.log('\n══ 7 · opremsning på dansk ══')
{
  tjek('ét led', paaDansk(['A']) === 'A', `«${paaDansk(['A'])}»`)
  tjek('to led', paaDansk(['A', 'B']) === 'A og B', `«${paaDansk(['A', 'B'])}»`)
  tjek('tre led', paaDansk(['A', 'B', 'C']) === 'A, B og C', `«${paaDansk(['A', 'B', 'C'])}»`)
  const elleve = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']
  const ud = paaDansk(elleve)
  const ogAntal = (ud.match(/ og /g) ?? []).length
  tjek('elleve led giver PRÆCIS ét «og»', ogAntal === 1, `${ogAntal} — «${ud}»`)
  tjek('og ni kommaer', (ud.match(/,/g) ?? []).length === 9,
    `${(ud.match(/,/g) ?? []).length}`)
  tjek('tomme led kasseres uden hængende komma',
    paaDansk(['A', '', null, 'B']) === 'A og B', `«${paaDansk(['A', '', null, 'B'])}»`)
  tjek('ingen led giver tom streng', paaDansk([]) === '')
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl ? 1 : 0)
