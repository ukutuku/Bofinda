// ═══════════════════════════════════════════════════════════════
//  BILLEDFORBEHOLDET BÆRER SIT SPÆND.
//
//  Fejlen, reglen findes for: vi gemte `true` og intet andet.
//  Omformulerer kilden sin sætning, bliver feltet `false` UDEN SPOR, og
//  en bolig begynder at vise billeder, kilden tager forbehold for. Der
//  var intet at holde det op imod, så ingen prøve kunne se det.
//
//  Prøven her måler fire ting, og den fjerde er den strukturelle:
//    1 · spændet findes, hører til sin regel og er et UDSNIT
//    2 · efterprøvningen kan blive rød — forvansket og for langt spænd
//    3 · hydratoren fejler LUKKET på alt, der ikke er et gyldigt belæg
//    4 · ingen adapter kan sætte booleanen selv. Den UDLEDES, så de to
//        ikke kan drive fra hinanden.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import {
  FORBEHOLDSREGLER, MAKS_UDDRAG, belaegHolder, belaegTilKolonne,
  findForbehold, laesForbeholdsbelaeg, visForbehold,
} from '../lib/billedforbehold'
import { kildelag } from './kildetjek'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// Kildernes egne, målte formuleringer. CEJ's tre er dem, der står i
// test-redigering.ts; LokalBoligs er den, CLAUDE.md citerer.
const CEJ = 'OBS: Billederne i denne annonce er ikke nødvendigvis fra den pågældende bolig, men skal give et indtryk af stilen.'
const LB = 'Bemærk venligst, at billederne kan være fra en anden bolig.'

console.log('\n══ 1 · spændet findes, hører til sin regel, og er et udsnit ══')
{
  const c = findForbehold(CEJ, 'cej')
  const l = findForbehold(LB, 'lokalbolig')
  tjek('cej: belæg fundet', c != null)
  tjek('cej: regel navngivet', c?.regel === 'cej', c?.regel)
  tjek('cej: spændet er KORTERE end beskrivelsen',
    (c?.uddrag.length ?? 0) < CEJ.length, `${c?.uddrag.length} < ${CEJ.length}`)
  tjek('cej: spændet står ORDRET i beskrivelsen',
    c != null && CEJ.replace(/\s+/g, ' ').includes(c.uddrag), c?.uddrag)
  tjek('lokalbolig: belæg fundet med sin egen regel',
    l != null && l.regel === 'lokalbolig')
  tjek('en tekst UDEN forbeholdet giver null',
    findForbehold('Billederne i annoncen er AI-redigerede.', 'cej') === null)
  tjek('tom og manglende tekst giver null',
    findForbehold('', 'cej') === null && findForbehold(null, 'cej') === null
    && findForbehold(undefined, 'cej') === null)
  // Reglerne må ikke ramme hinandens kilder — ellers ville `regel` være
  // en etiket uden indhold.
  tjek('cej-reglen rammer IKKE LokalBoligs sætning',
    findForbehold(LB, 'cej') === null)
  tjek('begge regler er med i opslaget',
    Object.keys(FORBEHOLDSREGLER).sort().join(',') === 'cej,lokalbolig')
}

console.log('\n══ 2 · efterprøvningen kan blive rød ══')
{
  const c = findForbehold(CEJ, 'cej')!
  tjek('forudsætning: et ægte belæg HOLDER', belaegHolder(c))
  // Forvansket spænd: faktummet er væk, etiketten står.
  tjek('et forvansket spænd holder IKKE',
    !belaegHolder({ uddrag: 'Billederne er dejlige', regel: 'cej' }))
  // Tom streng — den stilleste af dem.
  tjek('et tomt spænd holder IKKE', !belaegHolder({ uddrag: '', regel: 'cej' }))
  // For langt: attesten er blevet en kopi af brødteksten.
  tjek('et spænd over MAKS_UDDRAG holder IKKE',
    !belaegHolder({ uddrag: CEJ.repeat(9).slice(0, MAKS_UDDRAG + 1), regel: 'cej' }),
    `maks ${MAKS_UDDRAG}`)
  // Rigtigt spænd, FORKERT regel — etiketten skal bære vægt.
  tjek('rigtigt spænd under den forkerte regel holder IKKE',
    !belaegHolder({ uddrag: c.uddrag, regel: 'lokalbolig' }))
  // Og findForbehold kan ikke selv lave et spænd, der ikke holder.
  tjek('findForbehold kan ikke producere et spænd, der ikke holder',
    [CEJ, LB].every((t) => {
      const b = findForbehold(t, t === LB ? 'lokalbolig' : 'cej')
      return b == null || belaegHolder(b)
    }))
}

console.log('\n══ 3 · hydratoren fejler LUKKET ══')
{
  const c = findForbehold(CEJ, 'cej')!
  tjek('null og undefined giver null',
    laesForbeholdsbelaeg(null) === null && laesForbeholdsbelaeg(undefined) === null)
  for (const [navn, v] of [
    ['en streng', 'noget'], ['et tal', 7], ['en liste', [c]],
    ['uden uddrag', { regel: 'cej' }], ['tomt uddrag', { uddrag: '', regel: 'cej' }],
    ['uddrag som tal', { uddrag: 7, regel: 'cej' }],
    ['ukendt regel', { uddrag: c.uddrag, regel: 'findbolig' }],
    ['regel som tal', { uddrag: c.uddrag, regel: 3 }],
  ] as [string, unknown][]) {
    tjek(`  ${navn} → null`, laesForbeholdsbelaeg(v) === null)
  }
  const rundt = laesForbeholdsbelaeg(belaegTilKolonne(c))
  tjek('et gyldigt belæg overlever rundturen gennem kolonnen',
    rundt != null && rundt.uddrag === c.uddrag && rundt.regel === c.regel)
  tjek('belaegTilKolonne(null) er null', belaegTilKolonne(null) === null)
  // Ukendte felter må ikke smugles med gennem skrivesiden.
  tjek('kolonneværdien har PRÆCIS to felter',
    Object.keys(belaegTilKolonne(c)!).sort().join(',') === 'regel,uddrag')
}

console.log('\n══ 4 · booleanen UDLEDES — ingen adapter sætter den ══')
{
  // Det strukturelle. Sattes de hver for sig, var de to udtryk for ét
  // spørgsmål, og CLAUDE.md har en tabel over netop den fejlform.
  for (const a of ['cej', 'lokalbolig']) {
    const kode = kildelag(readFileSync(`adapters/${a}.ts`, 'utf8'))
    tjek(`${a}: sætter IKKE imagesMayDiffer selv`,
      !/imagesMayDiffer\s*:/.test(kode))
    tjek(`${a}: leverer belægget`, /imagesMayDifferEvidence\s*:/.test(kode))
    tjek(`${a}: har ikke sit eget FORBEHOLD-regex længere`,
      !/const FORBEHOLD\s*=/.test(kode))
  }
  const norm = kildelag(readFileSync('lib/normalize.ts', 'utf8'))
  tjek('normalize UDLEDER booleanen af belægget',
    /imagesMayDiffer: r\.imagesMayDifferEvidence != null/.test(norm))
  const ing = kildelag(readFileSync('lib/ingest.ts', 'utf8'))
  tjek('ingest skriver belægget på BEGGE skrivesteder',
    (ing.match(/imagesMayDifferEvidence: belaegTilKolonne/g) ?? []).length === 2)

  // Visningen er med VILJE ikke betinget af, at belægget holder: et
  // forbehold, vi ikke viser, er en påstand om, at billedet er af
  // boligen. Gjorde vi visningen betinget, ville en ændret regel SLETTE
  // forbeholdet fra skærmen — fejlen, spændet blev indført for at fange.
  tjek('visForbehold viser forbeholdet, også når belægget ikke holder',
    visForbehold(true) === true
    && !belaegHolder({ uddrag: 'forvansket', regel: 'cej' }))
  tjek('… og viser det ikke, når kilden intet har taget', visForbehold(false) === false)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
