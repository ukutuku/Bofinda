// ═══════════════════════════════════════════════════════════════
//  ADAPTERKONTRAKTEN — prøvet af OVERSÆTTEREN, ikke af en kørsel.
//
//  `detaljeBudgetPrKoersel` er TAVST VIRKNINGSLØST uden `listeGrundlag`.
//  Loftet i `lib/ingest.ts` er `opslag ? (budget ?? Infinity) : Infinity`,
//  og trimningen er gated på `opslag`. Sætter man kun budgettet, læses det
//  af ingenting: kilden henter videre uden loft, mens den, der satte det,
//  tror der er et. Samme slags fejl som `sources.enabled` — en knap, der
//  ikke virker, er værre end ingen knap, for den bruges i en nødsituation.
//
//  Parret stod som en KOMMENTAR på budgettet («Kun læst, når listeGrundlag
//  findes») og var ikke håndhævet af noget. Alle tre adaptere med et
//  budget havde også grundlaget — men det var held, ikke en regel.
//
//  Nu er `SourceAdapter` en union, så kombinationen ikke kan skrives. Og
//  DENNE fil er grunden til, at man kan stole på det: den fremkalder
//  fejlen og kræver, at oversætteren afviser den.
//
//  ── Hvorfor to arme ──────────────────────────────────────────
//  En prøve, der kun kræver «tsc fejler på den dårlige», er grøn, hvis
//  tsc fejler på ALT — en syntaksfejl i forlægget, en manglende import,
//  en brækket tsconfig. Den ville måle, at oversætteren er utilfreds,
//  ikke at den er utilfreds med det rigtige. Derfor kræver prøven også,
//  at den GODE kombination går rent igennem, og at afvisningen navngiver
//  `listeGrundlag`.
//
//  ── Hvorfor den ikke ligger i sin egen npm-kommando ───────────
//  `test:kerne` er én lang `&&`-kæde, og to åbne PR'er ændrer præcis den
//  linje. En tredje samtidig ændring dér er en konflikt, ingen kan flette
//  automatisk. Filen er derfor sin egen, men kaldes fra kæden, og
//  opløsningen ved en konflikt er en union af de tre kommandoer.
// ═══════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const start = performance.now()
let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

const rod = process.cwd()

/** Fælles hoved. Uden `listeGrundlag`/budget er dette en gyldig adapter. */
const HOVED = (sti: string) => `
import type { SourceAdapter, RawListing } from '${sti}'
const grundlag = {} as RawListing
const hoved = {
  id: 'kontraktproeve', sourceType: 'spider' as const, host: 'example.invalid',
  async discover() { return [] },
  async extract() { return grundlag },
}
`

/**
 * De tre LOVLIGE former i ÉT forlæg, så prøven koster to oversættelser og
 * ikke fire. `npm test` betaler for hver tsc-start, og fire kostede 38 s.
 * Samlet er de to arme stadig uafhængige: den ene SKAL fejle, den anden
 * SKAL gå rent igennem, og fejler den gode, siger noten hvilken af de tre
 * former der brækkede.
 */
const LOVLIGE = `
export const medBegge: SourceAdapter = { ...hoved,
  listeGrundlag() { return { grundlag, detaljesignatur: 's' } },
  detaljeBudgetPrKoersel: 3,
}
export const udenNogen: SourceAdapter = { ...hoved }
export const kunGrundlag: SourceAdapter = { ...hoved,
  listeGrundlag() { return { grundlag, detaljesignatur: 's' } },
}
`
const ULOVLIG = `
export const kunBudget: SourceAdapter = { ...hoved, detaljeBudgetPrKoersel: 3 }
`

/** Oversæt ét forlæg. Returnerer tsc's output og exitkoden. */
function oversaet(krop: string): { ok: boolean; ud: string } {
  const mappe = mkdtempSync(join(tmpdir(), 'adapterkontrakt-'))
  try {
    const filsti = join(mappe, 'forlaeg.ts')
    const importsti = relative(mappe, join(rod, 'lib/adapter')).replaceAll('\\', '/')
    writeFileSync(filsti, HOVED(importsti) + krop)
    const konfig = join(mappe, 'tsconfig.json')
    writeFileSync(konfig, JSON.stringify({
      extends: join(rod, 'tsconfig.json'),
      compilerOptions: { noEmit: true, types: [] },
      files: [filsti],
    }))
    try {
      // `${PIPESTATUS[0]}`-fælden i JS-form: execFileSync kaster ved exit≠0,
      // saa udfaldet laeses af undtagelsen og ikke af et returneret tal.
      const ud = execFileSync('npx', ['tsc', '-p', konfig], { encoding: 'utf8', cwd: rod })
      return { ok: true, ud }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      return { ok: false, ud: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  } finally {
    rmSync(mappe, { recursive: true, force: true })
  }
}

console.log('\n══ Adapterkontrakten: budget KRÆVER listeGrundlag ══\n')

const uden = oversaet(ULOVLIG)
const lovlige = oversaet(LOVLIGE)

// Den egentlige påstand.
tjek('budget UDEN listeGrundlag AFVISES af oversætteren', !uden.ok,
  uden.ok ? 'tsc ACCEPTEREDE den — loftet er tavst virkningsløst igen' : 'tsc fejler')
tjek('og afvisningen NAVNGIVER listeGrundlag',
  !uden.ok && uden.ud.includes('listeGrundlag'),
  uden.ud.split('\n').find((l) => l.includes('error'))?.replace(/^.*forlaeg\.ts/, 'forlaeg.ts')
    .slice(0, 100) ?? '(ingen fejllinje)')

// Modvægten. Uden den var prøven grøn, hvis tsc fejlede på ALT — en
// syntaksfejl i forlægget, en brækket tsconfig, en flyttet import.
tjek('og de tre LOVLIGE former går alle rent igennem', lovlige.ok,
  lovlige.ok ? 'begge + ingen af dem + kun grundlag' : lovlige.ud.slice(0, 180))

console.log(`\n  (${Math.round(performance.now() - start)} ms)`)
console.log(fejl === 0 ? '  ALT GRØNT\n' : `  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
