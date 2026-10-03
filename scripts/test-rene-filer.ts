// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne/0
//  RENE FILER — og alt, hvad de trækker med sig.
//
//  En ren fil har ingen database, ingen next-import og ingen React.
//  Derfor kan en klientkomponent importere den, og `npm test` kan
//  prøve den uden en base. Renheden holdt før kun, fordi nogen huskede
//  at skrive `import type`, og intet i prøvesættet kunne se et brud:
//
//    · db/client.ts opretter forbindelsen DOVENT, ved første brug. En
//      import uden DATABASE_URL lykkes: forklaring.ts med `kr` fra
//      app/Boligkort importeres og kaldes uden fejl. En import-prøve
//      kan altså ikke blive rød.
//    · Prøverne af forklaring() kører under testbasen, hvor basen findes.
//    · Mine annoncer er en serverkomponent, så bygget klager heller ikke.
//
//  Derfor måles GRAFEN, ikke kørslen. esbuild bundter hver ren fil med
//  samme typefjernelse som tsx og Next, og metafilen siger, hvilke
//  filer der kom med. `import type` forsvinder helt. `import { type X }`
//  og et ubrugt `import { kr }` fjernes også, men står stadig i
//  metafilen — og dem afviser prøven med vilje. Se `erSti`.
//
//  ═══ EN ALLOWLIST, IKKE EN DENYLIST ═══
//
//  Spørgsmålet er ikke «trækker den db/client ind?», men «trækker den
//  andet ind end rene filer?». En denylist over db/client, postgres og
//  drizzle ville svigte den dag, basen nås ad en ny vej: en ny klient,
//  next/headers, en tredje pakke. Reglen her er, at en ren fil kun må
//  trække andre filer fra RENE med sig og ingen pakker overhovedet.
//  Får forklaring.ts brug for en ren hjælper, skal hjælperen på listen
//  — og så bliver den selv vogtet. At glemme koster en rød linje, der
//  siger hvilken fil.
//
//      koeres uden database, som scripts/test-boligtype.ts
// ═══════════════════════════════════════════════════════════════

import { build, type Metafile, type Plugin } from 'esbuild'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROD = fileURLToPath(new URL('..', import.meta.url))

/**
 * Filerne, der lover at være rene. Stier relative til roden.
 *
 * De tre, CLAUDE.md og deres egne hoveder binder til det:
 *   · forklaring.ts — teksten på Mine annoncer, prøvet uden database. En
 *     fletteopskrift ville have hentet `kr` fra app/Boligkort ind, og
 *     Boligkort importerer lib/soeg og dermed basen.
 *   · lib/faciliteter.ts — udlejerformularen er en klientkomponent, og et
 *     værdi-import derfra trak engang `postgres` ind i browserbundtet.
 *   · lib/billedloft.ts — samme formular læser loftet.
 *
 * Flere filer lover renhed i deres eget hoved (lib/eloplysning.ts,
 * lib/boligtype.ts, lib/samtykke.ts, lib/maaling.ts, lib/maalingsoeg.ts,
 * lib/filterpanel.ts, app/beskeder/kontrakt.ts, app/kontakt-ui/kontrakt.ts)
 * og var rene, da vagten blev skrevet. De står her ikke endnu: listen
 * strammer reglerne for filer, andre arbejder i, og det er et valg for
 * sig. En ny HJÆLPER til en af de tre skal derimod på listen — ellers er
 * den rød, og det er meningen.
 */
const RENE: readonly string[] = [
  'app/udlejer/boliger/forklaring.ts',
  'lib/faciliteter.ts',
  'lib/billedloft.ts',
]

/** Pakker og indbyggede moduler, en ren fil må trække ind. Tom med vilje. */
const TILLADTE_PAKKER: readonly string[] = []

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

// Alt, der ikke er en relativ sti eller vores eget `@/`-alias, er en
// pakke eller et indbygget modul. Det bundtes ikke — det ses kun, som en
// kant i metafilen. (esbuilds filter er RE2 og kender ikke lookahead,
// derfor afgøres det i funktionen.)
const pakkerSesKun: Plugin = {
  name: 'pakker-ses-kun',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return undefined
      if (a.path.startsWith('.') || a.path.startsWith('/') || a.path.startsWith('@/')) return undefined
      return { path: a.path, external: true }
    })
  },
}

async function graf(fil: string): Promise<Metafile> {
  const r = await build({
    absWorkingDir: ROD,
    entryPoints: [fil],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    tsconfig: join(ROD, 'tsconfig.json'),   // `@/*`-stierne
    jsx: 'automatic',                       // som Next: JSX trækker react/jsx-runtime ind
    logLevel: 'silent',
    plugins: [pakkerSesKun],
  })
  return r.metafile
}

interface Brud {
  filer: string[]                  // ikke-rene filer i grafen
  pakker: string[]                 // pakker og indbyggede moduler
  kunType: [string, string][]      // [fil, sti] — importen fjernes af TypeScript
  graense: [string, string][]      // [ren fil, det første ikke-rene den importerer]
  kaede: (x: string) => string     // korteste importkæde fra roden
}

// En RELATIV sti, der står som ekstern i metafilen, er ikke en pakke:
// plugin'et gør kun pakker eksterne. Det er en import, esbuild fjernede
// efter TypeScripts regel, fordi den kun bruges som type eller slet
// ikke — `import { type X }` eller et ubrugt `import { kr }`. Den
// trækker intet ind i dag (heller ikke i Next), men én brug af navnet
// gør den til et rigtigt import. Målt ens i esbuild 0.19.12 og 0.28.2.
const erSti = (p: string) => p.startsWith('.') || p.startsWith('/') || p.startsWith('@/')

function brud(m: Metafile, fra: string, rene: ReadonlySet<string>): Brud {
  const forrige = new Map<string, string | null>([[fra, null]])
  const pakkeFra = new Map<string, string>()
  const kunType: [string, string][] = []
  const koe = [fra]
  while (koe.length) {
    const f = koe.shift()!
    for (const i of m.inputs[f]?.imports ?? []) {
      if (i.external && erSti(i.path)) { if (rene.has(f)) kunType.push([f, i.path]); continue }
      if (i.external) { if (!pakkeFra.has(i.path)) pakkeFra.set(i.path, f); continue }
      if (!forrige.has(i.path)) { forrige.set(i.path, f); koe.push(i.path) }
    }
  }
  const kaede = (x: string): string => {
    const led: string[] = []
    let f: string | null | undefined = pakkeFra.has(x) ? pakkeFra.get(x) : forrige.get(x)
    led.push(x)
    while (f) { led.push(f); f = forrige.get(f) }
    return led.join(' ← ')
  }
  const filer = [...forrige.keys()].filter((f) => !rene.has(f))
  const pakker = [...pakkeFra.keys()].filter((p) => !TILLADTE_PAKKER.includes(p))
  const graense: [string, string][] = []
  for (const f of forrige.keys()) {
    if (!rene.has(f)) continue
    for (const i of m.inputs[f]?.imports ?? []) {
      if (i.external && erSti(i.path)) continue
      const ud = i.external ? !TILLADTE_PAKKER.includes(i.path) : !rene.has(i.path)
      if (ud && !graense.some(([a, b]) => a === f && b === i.path)) graense.push([f, i.path])
    }
  }
  return { filer, pakker, kunType, graense, kaede }
}

const start = performance.now()
console.log('\n══ rene filer: ingen database, ingen pakker ══\n')

// ── 0 · MODPRØVE PÅ DEN RIGTIGE MEKANIK ──────────────────────
// Samme `graf` og `brud` på en fil, der IKKE er ren. Ser mekanikken
// ikke db/client og postgres her, er hvert grønt flueben nedenfor
// grønt af den forkerte grund — fx hvis nogen «løser» en byggefejl ved
// at gøre alting eksternt.
{
  const b = brud(await graf('lib/soeg.ts'), 'lib/soeg.ts', new Set(RENE))
  tjek('modprøve: lib/soeg.ts er ikke ren, og mekanikken ser hvorfor',
    b.filer.includes('db/client.ts') && b.pakker.includes('postgres'),
    `${b.filer.length} filer, pakker: ${b.pakker.join(', ') || 'ingen'}`)
}

// ── 1 · HVER REN FIL TRÆKKER KUN RENE FILER MED SIG ──────────
const rene = new Set(RENE)
for (const fil of RENE) {
  if (!existsSync(join(ROD, fil))) { tjek(`${fil} findes`, false, 'flyttet? ret RENE'); continue }
  let m: Metafile
  try { m = await graf(fil) } catch (e) {
    tjek(fil, false, `kunne ikke bundtes: ${(e as Error).message.split('\n')[0]}`); continue
  }
  const b = brud(m, fil, rene)
  const ok = b.filer.length === 0 && b.pakker.length === 0 && b.kunType.length === 0
  const med = Object.keys(m.inputs).length
  tjek(fil, ok, ok
    ? (med === 1 ? 'intet andet' : `${med - 1} andre rene: ${Object.keys(m.inputs).filter((f) => f !== fil).join(', ')}`)
    : `${b.filer.length} ikke-rene filer, ${b.pakker.length} pakker, ${b.kunType.length} skjulte imports`)
  if (ok) continue
  // Streng med vilje: en ren fil skriver `import type`, så renheden
  // står i kildeteksten og ikke hviler på, at et navn ikke bruges.
  for (const [f, p] of b.kunType) {
    console.log(`      kun type  ${f} importerer ${p} uden at bruge en værdi — skriv \`import type\` eller fjern den`)
  }
  for (const [f, til] of b.graense) console.log(`      grænsen brydes: ${f} → ${til}`)
  for (const p of b.pakker) console.log(`      pakke  ${b.kaede(p)}`)
  for (const f of b.filer.filter((x) => x.startsWith('db/'))) console.log(`      base   ${b.kaede(f)}`)
  const resten = b.filer.filter((x) => !x.startsWith('db/'))
  if (resten.length) console.log(`      og     ${resten.join(', ')}`)
}

console.log(`\n  (${Math.round(performance.now() - start)} ms)`)
console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
