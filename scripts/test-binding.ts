// ═══════════════════════════════════════════════════════════════
//  Lister, unioner udledes af — og delingen, der tvinger et valg
//
//  To konstanter navngiver medlemmerne af en union. Begge stod før med
//  en annotation, der UDVIDER: `readonly X[]`. Den fanger en forkert
//  værdi og ikke en manglende, og det er den manglende, der gør skade:
//
//    LAASEGRUNDE   en låsegrund, listen ikke har -> prøvevisningen og
//                  attrapporten ser den ikke. `ukendt-tilstand` er
//                  allerede besluttet som en fjerde.
//    FACILITETER   et filterord, formularen ikke spørger om -> ingen
//                  udlejer kan krydse det af, mens filteret skjuler
//                  hver annonce uden det.
//
//  ═══ HVORFOR DENNE PRØVE OVERHOVEDET FINDES ═══
//
//  Selve bindingen er en TYPE-vagt: den fejler i `tsc`. Men `npm test`
//  kører gennem `tsx`, som transpilerer UDEN at typetjekke — så en
//  slettet vagt ville ikke blive rød her. Prøven måler derfor, at
//  vagterne STÅR der, og at delingen holder ved kørsel.
//
//  Modprøver, kørt i et separat arbejdstræ:
//    unionen udvidet uden listen      -> rød (vagten + to Record-læsere)
//    femte filterord uden placering   -> rød
//    samme ord lagt i IKKE_I_FORMULAREN -> grøn (valget er taget)
//    tastefejl i FACILITETER          -> rød
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { LAASEGRUNDE } from '../app/beskeder/kontrakt'
import { FACILITET, FACILITETER, IKKE_I_FORMULAREN } from '../lib/faciliteter'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const uden = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('\n══ 1 · unionen udledes af listen, ikke omvendt ══')
{
  const k = uden(readFileSync('app/beskeder/kontrakt.ts', 'utf8'))
  tjek('Laasegrund udledes af LAASEGRUNDE',
    /export type Laasegrund = \(typeof LAASEGRUNDE\)\[number\]\s*$/m.test(k))
  tjek('LAASEGRUNDE bærer ingen udvidende annotation',
    !/export const LAASEGRUNDE\s*:/.test(k))
  tjek('og listen er «as const»', /\] as const/.test(k))
  tjek('vagten mod en bredere union står der',
    /_Overskydende = Exclude<Laasegrund/.test(k) && /\[_Overskydende\] extends \[never\]/.test(k))
}

console.log('\n══ 2 · faciliteterne er DELT, ikke fuldstændige ══')
{
  const f = uden(readFileSync('lib/faciliteter.ts', 'utf8'))
  tjek('FACILITETER bruger «satisfies», ikke en udvidende annotation',
    /\] as const satisfies readonly \{ vaerdi: Facilitetsord/.test(f)
    && !/export const FACILITETER\s*:/.test(f))
  tjek('de bevidst udeladte har deres egen liste',
    /export const IKKE_I_FORMULAREN/.test(f))
  tjek('og delingen håndhæves ved oversættelsen',
    /_Uplaceret = Exclude<\s*Facilitetsord/.test(f) && /\[_Uplaceret\] extends \[never\]/.test(f))
}

console.log('\n══ 3 · delingen holder ved kørsel, ikke kun i typerne ══')
{
  // Typevagten kan slettes; denne kan ikke uden at blive rød. De to
  // måler det samme fra hver sin side — og det er med vilje: den ene
  // fejler ved oversættelse, den anden ved kørsel.
  const alle = new Set<string>(Object.values(FACILITET).flat())
  const spurgt = new Set<string>(FACILITETER.map((x) => x.vaerdi))
  const udeladt = new Set<string>(IKKE_I_FORMULAREN)

  const uplaceret = [...alle].filter((o) => !spurgt.has(o) && !udeladt.has(o))
  tjek('hvert filterord er enten spurgt om eller bevidst udeladt',
    uplaceret.length === 0, uplaceret.join(', ') || 'ingen')

  const begge = [...spurgt].filter((o) => udeladt.has(o))
  tjek('og intet ord står begge steder', begge.length === 0, begge.join(', ') || 'ingen')

  const fremmede = [...spurgt, ...udeladt].filter((o) => !alle.has(o))
  tjek('ingen af dem er et ord, filtrene ikke kender',
    fremmede.length === 0, fremmede.join(', ') || 'ingen')

  tjek('delingen er udtømmende', spurgt.size + udeladt.size === alle.size,
    `${spurgt.size} + ${udeladt.size} = ${alle.size}`)
}

console.log('\n══ 4 · låsegrundene er dem, brugerfladen kender ══')
{
  // Laast.tsx og Kontaktpanel.tsx bruger `Record<Laasegrund, …>` og er
  // dermed udtømmende af sig selv. Her måles kun, at listen ikke er
  // tom og ikke har dubletter — en tom liste ville gøre unionen til
  // `never` og hver Record triviel.
  tjek('listen er ikke tom', LAASEGRUNDE.length > 0, `${LAASEGRUNDE.length}`)
  tjek('og har ingen dubletter',
    new Set<string>(LAASEGRUNDE).size === LAASEGRUNDE.length)
}

console.log(fejl ? `\n  ${fejl} FEJLEDE\n` : '\n  ALT GRØNT\n')
process.exit(fejl ? 1 : 0)
