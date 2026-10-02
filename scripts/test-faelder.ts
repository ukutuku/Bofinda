// ═══════════════════════════════════════════════════════════════
//  Fældetabellen i CLAUDE.md er det, faelder/ siger.
//
//    npx tsx --tsconfig tsconfig.scripts.json scripts/test-faelder.ts
//
//  Tre ting:
//  · hver fil i faelder/ kan læses, og navnene er entydige;
//  · blokken mellem markørerne i CLAUDE.md er byte for byte det, `blok()`
//    skriver i dag — den samme funktion, `npm run faelder` bruger. Prøven
//    bygger ikke sin egen udgave af tabellen;
//  · prosaen omkring blokken henviser kun til rækker, der findes. En række
//    er nu en fil, der kan omdøbes, uden at nogen ser teksten, der nævner
//    den.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { CLAUDE, SLUT, START, blok, laesFaelder, nuvaerendeBlok, type Faelde } from './faelder'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

console.log('\n══ fældetabellen ══\n')

let faelder: Faelde[] = []
try {
  faelder = laesFaelder()
  tjek('hver fil i faelder/ kan læses, og navnene er entydige', true, `${faelder.length} rækker`)
} catch (e) {
  tjek('hver fil i faelder/ kan læses, og navnene er entydige', false, (e as Error).message)
}

const claude = readFileSync(CLAUDE, 'utf8')
const markoerer = claude.split(START).length - 1 === 1 && claude.split(SLUT).length - 1 === 1
tjek('CLAUDE.md har markørerne præcis én gang hver', markoerer)

if (faelder.length && markoerer) {
  const nu = nuvaerendeBlok(claude)
  const skal = blok(faelder)
  let note = `${faelder.length} rækker`
  if (nu !== skal) {
    const a = nu.split('\n')
    const b = skal.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++
    note = `første forskel i blokkens linje ${i + 1}:\n`
      + `      står:      ${JSON.stringify((a[i] ?? '<slut>').slice(0, 100))}\n`
      + `      skal stå:  ${JSON.stringify((b[i] ?? '<slut>').slice(0, 100))}\n`
      + '      Ret filen i faelder/, ikke blokken — og kør npm run faelder'
  }
  tjek('blokken i CLAUDE.md er det, faelder/ genererer', nu === skal, note)

  // Prosaen i afsnittet uden for blokken. Et navn med bindestreg i ** eller
  // ` ` er en henvisning til en række — også med stort forbogstav i
  // starten af en sætning.
  const a = claude.indexOf('## Dækker ét tilfælde mindre')
  const b = claude.indexOf('\n## ', a + 5)
  const sektion = claude.slice(a, b < 0 ? undefined : b)
  const prosa = sektion.slice(0, sektion.indexOf(START)) + sektion.slice(sektion.indexOf(SLUT))
  const navne = new Set(faelder.map((f) => f.navn))
  const henvist = [...new Set([...prosa.matchAll(/(?:\*\*|`)([A-Za-zÆØÅæøå]+(?:-[a-zæøå]+)+)/g)]
    .map((m) => m[1]!.toLowerCase()))]
  const doede = henvist.filter((n) => !navne.has(n))
  tjek('prosaen henviser kun til rækker, der findes', a >= 0 && doede.length === 0,
    a < 0 ? 'fandt ikke afsnittet' : doede.length ? `ukendte: ${doede.join(', ')}` : `${henvist.length} henvisninger`)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
