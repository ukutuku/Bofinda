// ═══════════════════════════════════════════════════════════════
//  Fældetabellen i CLAUDE.md — genereret af én fil pr. række i faelder/.
//
//    npm run faelder        skriver blokken i CLAUDE.md
//
//  Hvorfor: fem sessioner skrev rækker til den samme tabel, og hver ny
//  række kolliderede med de andres. Fletningen krævede en vurdering af
//  tekst, mennesker havde skrevet. Nu er en ny række en ny FIL, og det
//  eneste, der kan kollidere, er den genererede blok i CLAUDE.md — som
//  ingen håndredigerer. Opløsningen er at køre scriptet igen. Samme form
//  som scripts/maalinger/maalinger-til-supabase.sql.
//
//  scripts/test-faelder.ts (npm test) er rød, hvis blokken ikke er det,
//  scriptet skriver i dag, eller hvis en fil ikke kan læses.
//
//  ═══ FILFORMATET ═══
//
//    ---
//    navn: gitignore-skråstregen
//    form: 1
//    faelde: `node_modules/` i `.gitignore`
//    kort: (valgfri) én sætning i formlisten over tabellen
//    kostet: (valgfri) «nej — <hvorfor>», hvis fælden blev fundet, før
//            den kostede en omgang. Udeladt betyder, at den har.
//    ---
//    Teksten i kolonnen «Hvad den IKKE dækker». Linjeskift bliver til
//    mellemrum; en lodret streg skrives \| som i tabellen.
//
//  Filnavnet er slug(navn) — samme regel som områdesiderne, så æøå bliver
//  ae/oe/aa. Navnet med æøå er identifikatoren, filnavnet er ASCII:
//  macOS normaliserer æøå i filnavne anderledes end Linux.
//
//  Rækkefølgen i tabellen er form, derefter navn i dansk orden. Der er
//  ingen numre — navnet er identifikatoren (se CLAUDE.md).
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { slug } from '../lib/slug'

export const MAPPE = 'faelder'
export const CLAUDE = 'CLAUDE.md'
export const START = '<!-- faelder:start · genereret af scripts/faelder.ts fra faelder/*.md — ret filerne, ikke blokken, og kør npm run faelder -->'
export const SLUT = '<!-- faelder:slut -->'

/** Formerne, i den rækkefølge de står. En ny form er en bevidst ændring her. */
export const FORMER = [
  {
    id: '1', titel: 'Form 1 · et værn, der læses som udtømmende, og ikke er det.',
    tekst: 'De fanger noget — og netop derfor ser de ud, som om de fanger resten.',
  },
  {
    id: '2', titel: 'Form 2 · et værn, der måler sig selv i stedet for koden.',
    tekst: 'Værre end form 1: de måler noget rigtigt, blot mindre; disse måler ikke det, de handler om.',
  },
  {
    id: '3', titel: 'Form 3 · et svar om værktøjet er ikke et svar om arbejdet.',
    tekst: 'Ikke et værn, der dækker for lidt, men et svar, der er SANDT om noget andet, end man læser det som. Se afsnittet efter tabellen.',
  },
  {
    id: '4', titel: 'Form 4 · et tal, der ikke kan sige, at det ikke blev målt.',
    tekst: 'Den handler ikke om et værktøj eller et værn, men om DATA: et nul fra en tæller er «ingenting skete» og «vi holdt op med at måle» i samme tegn.',
  },
  {
    id: 'ikke-vaern', titel: 'Og de, der ikke er værn.',
    tekst: 'De handler ikke om, hvor meget et værn dækker.',
  },
] as const
export type Formid = (typeof FORMER)[number]['id']

export interface Faelde {
  fil: string
  navn: string
  form: Formid
  faelde: string | null
  kort: string | null
  kostet: string | null
  tekst: string
}

const DANSK = new Intl.Collator('da')

/** Læser og prøver hver fil. Kaster med ALLE problemer, ikke det første. */
export function laesFaelder(mappe = MAPPE): Faelde[] {
  const problemer: string[] = []
  const ud: Faelde[] = []
  const filer = readdirSync(mappe).filter((f) => f.endsWith('.md') && f !== 'LAES-MIG.md').sort()
  for (const fil of filer) {
    const raa = readFileSync(`${mappe}/${fil}`, 'utf8').replace(/\r\n/g, '\n')
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raa)
    if (!m) { problemer.push(`${fil}: mangler hovedet mellem to linjer med ---`); continue }
    const felter = new Map<string, string>()
    for (const linje of m[1]!.split('\n')) {
      const i = linje.indexOf(':')
      if (i < 1) { problemer.push(`${fil}: linjen «${linje}» er ikke «nøgle: værdi»`); continue }
      const k = linje.slice(0, i).trim()
      if (!['navn', 'form', 'faelde', 'kort', 'kostet'].includes(k)) problemer.push(`${fil}: ukendt felt «${k}»`)
      if (felter.has(k)) problemer.push(`${fil}: feltet «${k}» står to gange`)
      felter.set(k, linje.slice(i + 1).trim())
    }
    const navn = felter.get('navn') ?? ''
    const form = felter.get('form') ?? ''
    const tekst = m[2]!.trim().split(/\s*\n\s*/).join(' ')
    if (!navn) problemer.push(`${fil}: mangler navn`)
    else if (`${slug(navn)}.md` !== fil) problemer.push(`${fil}: filnavnet skal være ${slug(navn)}.md (slug af navnet)`)
    if (!FORMER.some((f) => f.id === form)) problemer.push(`${fil}: form «${form}» findes ikke — en af ${FORMER.map((f) => f.id).join(', ')}`)
    if (!tekst) problemer.push(`${fil}: teksten er tom`)
    for (const [hvad, v] of [['teksten', tekst], ['faelde', felter.get('faelde') ?? '']] as const) {
      if (/(^|[^\\])\|/.test(v)) problemer.push(`${fil}: ${hvad} har en lodret streg uden \\ — den ville splitte tabellen`)
    }
    const kostet = felter.get('kostet') ?? null
    if (kostet != null && !/^nej — \S/.test(kostet)) problemer.push(`${fil}: kostet skal være «nej — <hvorfor>» eller udeladt`)
    ud.push({
      fil, navn, form: form as Formid, tekst, kostet,
      faelde: felter.get('faelde') || null, kort: felter.get('kort') || null,
    })
  }
  const set = new Set<string>()
  for (const f of ud) {
    if (set.has(f.navn)) problemer.push(`navnet «${f.navn}» står i to filer`)
    set.add(f.navn)
  }
  if (ud.length === 0) problemer.push(`ingen rækker i ${mappe}/ — tabellen ville være tom`)
  if (problemer.length) throw new Error(`faelder/ kan ikke læses:\n  ${problemer.join('\n  ')}`)
  return ud
}

const kode = (navn: string) => `\`${navn}\``
function opremsning(navne: string[]): string {
  return navne.length === 1 ? navne[0]! : `${navne.slice(0, -1).join(', ')} og ${navne.at(-1)}`
}

/** Blokken, markørerne med. */
export function blok(faelder: readonly Faelde[]): string {
  const sorteret = [...faelder].sort((a, b) =>
    FORMER.findIndex((f) => f.id === a.form) - FORMER.findIndex((f) => f.id === b.form)
    || DANSK.compare(a.navn, b.navn))
  const dele: string[] = [START, '']
  for (const form of FORMER) {
    const her = sorteret.filter((f) => f.form === form.id)
    if (her.length === 0) continue
    const korte = her.filter((f) => f.kort).map((f) => `${kode(f.navn)}: ${f.kort}`)
    dele.push([`**${form.titel}**`, form.tekst, `Her ligger ${opremsning(her.map((f) => kode(f.navn)))}.`, ...korte].join(' '), '')
  }
  const undtagne = sorteret.filter((f) => f.kostet)
  dele.push(undtagne.length === 0
    ? 'Hver af dem har kostet mindst én omgang i dette repo.'
    : `Hver af dem har kostet mindst én omgang i dette repo — undtagen ${undtagne.map((f) => `${kode(f.navn)}, ${f.kostet!.replace(/^nej — /, '')}`).join('; ')}.`, '')
  dele.push('| Fælden | Hvad den IKKE dækker |', '|---|---|')
  for (const f of sorteret) {
    dele.push(`| **${f.navn}**${f.faelde ? ` · ${f.faelde}` : ''} | ${f.tekst} |`)
  }
  dele.push('', SLUT)
  return dele.join('\n')
}

/** CLAUDE.md med blokken skiftet ud. Kaster, hvis markørerne ikke står præcis én gang. */
export function medBlok(claude: string, ny: string): string {
  const a = claude.split(START).length - 1
  const b = claude.split(SLUT).length - 1
  if (a !== 1 || b !== 1) throw new Error(`${CLAUDE} skal have markørerne præcis én gang hver (start ${a}, slut ${b})`)
  const i = claude.indexOf(START)
  const j = claude.indexOf(SLUT) + SLUT.length
  if (j < i) throw new Error(`${CLAUDE}: slutmarkøren står før startmarkøren`)
  return claude.slice(0, i) + ny + claude.slice(j)
}

/** Blokken, som den står i CLAUDE.md i dag. */
export function nuvaerendeBlok(claude: string): string {
  const i = claude.indexOf(START)
  const j = claude.indexOf(SLUT)
  if (i < 0 || j < 0) throw new Error(`${CLAUDE} mangler markørerne`)
  return claude.slice(i, j + SLUT.length)
}

// Filnavnet præcist: `endsWith('faelder.ts')` ramte også test-faelder.ts,
// så prøven kørte scriptet ved import.
if (/(^|[\\/])faelder\.ts$/.test(process.argv[1] ?? '')) {
  const ny = blok(laesFaelder())
  const claude = readFileSync(CLAUDE, 'utf8')
  const efter = medBlok(claude, ny)
  if (process.argv.includes('--skriv')) {
    writeFileSync(CLAUDE, efter)
    process.stdout.write(efter === claude ? 'uændret\n' : `skrevet: ${CLAUDE}\n`)
  } else {
    process.stdout.write(ny + '\n')
  }
}
