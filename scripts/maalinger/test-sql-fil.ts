// ═══════════════════════════════════════════════════════════════
//  Den committede SQL-fil er det, generatoren skriver i dag.
//
//    npx tsx --tsconfig tsconfig.scripts.json scripts/maalinger/test-sql-fil.ts
//
//  maalinger-til-supabase.sql ligger i repoet, så den, der skal køre
//  målingerne i Supabases SQL-editor, kan hente den uden at klone og
//  køre generatoren. Men en committet kopi af et genereret output er to
//  udtryk for det samme: ændres et af appens prædikater, skriver
//  generatoren noget andet, og filen står og svarer på det gamle
//  spørgsmål. Prøven her gør den forskel rød.
//
//  Teksten sammenlignes byte for byte med `tekst()` — den samme
//  funktion, `npm run maaling:sql` skriver filen med. Prøven bygger ikke
//  sin egen udgave af outputtet.
// ═══════════════════════════════════════════════════════════════

import { existsSync, readFileSync } from 'node:fs'
import { SQL_FIL, tekst } from './skriv-bynavne-domaene-sql'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

console.log('\n══ den committede SQL-fil ══\n')

const findes = existsSync(SQL_FIL)
tjek(`${SQL_FIL} findes`, findes, findes ? '' : 'skriv den med: npm run maaling:sql')

if (findes) {
  const committet = readFileSync(SQL_FIL, 'utf8')
  const genereret = tekst()
  const ens = committet === genereret
  let note = `${Buffer.byteLength(genereret)} bytes`
  if (!ens) {
    const a = committet.split('\n')
    const b = genereret.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++
    note = `første forskel på linje ${i + 1}:\n`
      + `      committet:  ${JSON.stringify((a[i] ?? '<slut>').slice(0, 110))}\n`
      + `      genereret:  ${JSON.stringify((b[i] ?? '<slut>').slice(0, 110))}\n`
      + '      Er ændringen i appen rigtig, så skriv filen igen: npm run maaling:sql'
  }
  tjek('filen er byte for byte det, generatoren skriver i dag', ens, note)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
