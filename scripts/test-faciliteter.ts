// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  FACILITETSORDENE — delingen, og driften mellem kilderne.
//
//  ── HVORFOR EN KØRENDE PRØVE, NÅR DER ER EN TYPEVAGT ────────
//  Typevagten i lib/faciliteter.ts er den rigtige mekanisme, og den er
//  efterprøvet i tre retninger (ord uden hjem · ord i begge lister ·
//  et sjette ord i FACILITET) — alle tre giver TS2344 med det hjemløse
//  ord i fejlteksten.
//
//  Men `npm test` kører INGEN typekontrol. `test-rene-filer.ts` bruger
//  esbuild, som fjerner typer uden at tjekke dem, og resten kører
//  gennem tsx, der gør det samme. Typevagten fyrer altså kun under
//  `npm run typecheck`. En vagt, prøvesættet ikke udøver, er en vagt,
//  der kan være brudt i en PR, hvor nogen kørte `npm test` og intet
//  andet.
//
//  Derfor kører afsnit 1 den samme deling på VÆRDIERNE. Det er ikke to
//  udtryk for ét spørgsmål i CLAUDE.mds forstand: typevagten prøver
//  typerne ved oversættelse, denne prøver listerne ved kørsel, og de
//  kan ikke begge være grønne med et hjemløst ord. Den rigtige
//  rettelse er at lægge `tsc --noEmit` ind i `npm test` — det er en
//  beslutning for hele repoet og ikke noget, denne skive tager.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { FACILITET, FACILITETER, UDEN_FOR_FORMULAREN } from '../lib/faciliteter'
import { kildelag } from './kildetjek'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

console.log('\n══ 1 · delingen: hvert ord ét sted, og kun ét ══')
{
  const alle = Object.values(FACILITET).flat() as readonly string[]
  const iFormularen = new Set<string>(FACILITETER.map((f) => f.vaerdi))
  const udeladte = new Set<string>(Object.keys(UDEN_FOR_FORMULAREN))

  tjek('forudsætning: der ER ord at dele', alle.length > 0, `${alle.length} ord`)
  const udenHjem = alle.filter((o) => !iFormularen.has(o) && !udeladte.has(o))
  tjek('intet ord står uden hjem', udenHjem.length === 0, udenHjem.join(', '))
  const begge = alle.filter((o) => iFormularen.has(o) && udeladte.has(o))
  tjek('intet ord står i begge lister', begge.length === 0, begge.join(', '))
  // Den anden vej: en udeladelse skal pege på et ord, der FINDES.
  const spøgelser = [...udeladte].filter((o) => !alle.includes(o))
  tjek('ingen udeladelse peger på et ord uden for FACILITET',
    spøgelser.length === 0, spøgelser.join(', '))
  tjek(`delingen dækker alle ${alle.length}: ${iFormularen.size} i formularen, ${udeladte.size} udeladt`,
    iFormularen.size + udeladte.size === alle.length)
  // Hver udeladelse bærer sin GRUND. En tom streng ville være en
  // udeladelse uden forsvar, og det er præcis dét, listen findes imod.
  tjek('hver udeladelse har en grund',
    Object.values(UDEN_FOR_FORMULAREN).every((g) => typeof g === 'string' && g.length > 10))
}

console.log('\n══ 2 · typevagten STÅR i filen ══')
{
  const kode = kildelag(readFileSync('lib/faciliteter.ts', 'utf8'))
  tjek('KunNever er erklæret', /type KunNever<T extends never> = T/.test(kode))
  tjek('… og bruges på det udækkede',
    /KunNever<Exclude<Facilitetsord, IFormularen \| Udeladt>>/.test(kode))
  tjek('… og på overlappet', /KunNever<Extract<IFormularen, Udeladt>>/.test(kode))
  // `as const satisfies` og ikke en annotation: med en annotation
  // widener `vaerdi` til hele unionen, og delingen kan ikke udtrykkes.
  tjek('FACILITETER er bundet med `as const satisfies`',
    /\] as const satisfies readonly \{ vaerdi: Facilitetsord/.test(kode))
  tjek('UDEN_FOR_FORMULAREN er nøglebundet til Facilitetsord',
    /as const satisfies Partial<Record<Facilitetsord, string>>/.test(kode))
}

// ─── Kildernes udgangsordforråd, trukket ud af adapterne ───────
//
// Hver adapter oversætter kildens ord til VORES. Antallet er erklæret,
// så en udtrækning, der stille finder nul, ikke kan stå grøn — samme
// grund som modprøvekørerens vagt 4.
const FORVENTET: Record<string, number> = {
  propstep: 13, dacas: 18, cej: 22, balder: 10,
}

function ordforraad(navn: string): string[] {
  const kode = kildelag(readFileSync(`adapters/${navn}.ts`, 'utf8'))
  const ud: string[] = []
  if (navn === 'propstep') {
    const b = kode.slice(kode.indexOf('const FACILITETER: [string, string][] = ['))
    ud.push(...[...b.slice(0, b.indexOf('\n]')).matchAll(/,\s*'([^']+)'\]/g)].map((m) => m[1]!))
    ud.push('altan', 'terrasse')   // de to literaler uden for tabellen
  } else {
    for (const m of kode.matchAll(/(FACILITETSORD|FACILITETER)\s*:?[^=]*=\s*\{([\s\S]*?)\n\}/g)) {
      ud.push(...[...m[2]!.matchAll(/:\s*'([^']+)'/g)].map((x) => x[1]!))
    }
  }
  return [...new Set(ud)]
}

console.log('\n══ 3 · drift: samme begreb, to stavemåder ══')
{
  const alle = new Map<string, string[]>()   // ord -> kilder
  for (const [navn, antal] of Object.entries(FORVENTET)) {
    const ord = ordforraad(navn)
    tjek(`udtrækningen fandt ${antal} ord hos ${navn}`, ord.length === antal,
      `fandt ${ord.length}`)
    for (const o of ord) alle.set(o, [...(alle.get(o) ?? []), navn])
  }

  // Normaliseringen er SNÆVER med vilje: tegnsætning, mellemrum og
  // bindeordet «og». Den rammer «fælles vaskeri»/«fællesvaskeri» og
  // «køle- og fryseskab»/«køle-/fryseskab» — og den rammer IKKE
  // «delebolig»/«delevenlig», hvilket er rigtigt: CEJ's `sharing`
  // står i gruppe med `senior`/`student`/`youth`, altså en
  // boligKATEGORI, mens Propsteps `shareable` er en egenskab ved
  // lejemålet. At slå dem sammen ville være et gæt om CEJ's semantik.
  const normal = (o: string) => o.toLowerCase()
    .replace(/\bog\b/g, '').replace(/[^\p{L}]/gu, '')
  const efterNormal = new Map<string, string[]>()
  for (const o of alle.keys()) {
    const n = normal(o)
    efterNormal.set(n, [...(efterNormal.get(n) ?? []), o])
  }
  const kollisioner = [...efterNormal.values()].filter((v) => v.length > 1)
  tjek('ingen to ord falder sammen under normaliseringen',
    kollisioner.length === 0,
    kollisioner.map((v) => v.join(' / ')).join('  ·  '))

  // Forudsætningen: normaliseringen VIRKER. Uden den ville afsnittet
  // være grønt, fordi den ikke rammer noget som helst.
  tjek('forudsætning: normaliseringen ville FANGE de to gamle par',
    normal('fælles vaskeri') === normal('fællesvaskeri')
    && normal('køle- og fryseskab') === normal('køle-/fryseskab'))
  tjek('… og den slår IKKE delebolig og delevenlig sammen',
    normal('delebolig') !== normal('delevenlig'))

  for (const [ord, kilder] of [...alle].sort()) {
    if (kilder.length > 1) console.log(`      ${ord.padEnd(22)} ${kilder.join(', ')}`)
  }
}

console.log('\n══ 4 · Dacas oversætter nu i stedet for at gennemsende ══')
{
  const kode = kildelag(readFileSync('adapters/dacas.ts', 'utf8'))
  tjek('Set\'et er væk — det var et INPUT-filter', !/new Set\(\[\s*'delevenlig'/.test(kode))
  tjek('der oversættes gennem en tabel', /const FACILITETSORD: Record<string, string>/.test(kode))
  tjek('kildens ord slås OP, og VORES skrives',
    /const vores = FACILITETSORD\[f\]/.test(kode) && /if \(vores\) faciliteter\.push\(vores\)/.test(kode))
  tjek('«fælles vaskeri» → «fællesvaskeri»', /'fælles vaskeri': 'fællesvaskeri'/.test(kode))
  tjek('«køle- og fryseskab» → «køle-/fryseskab»',
    /'køle- og fryseskab': 'køle-\/fryseskab'/.test(kode))
  // Ukendte ord skal STADIG opdages. Oversættelsen må ikke have gjort
  // tabellen til et tavst filter.
  tjek('ukendte ord registreres fortsat', /ukendteFaciliteter\.add\(f\)/.test(kode))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
