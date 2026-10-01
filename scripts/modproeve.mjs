#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  MODPROEVEKOERER — indfoer fejlen med vilje, og KRAEV at det bliver roedt.
//
//  CLAUDE.md siger princippet: «Kan du ikke faa det roedt ved at indfoere
//  fejlen med vilje, maaler det ikke det, du tror.» Filen her er
//  mekanikken, saa princippet ikke hviler paa, at nogen husker det.
//
//  ═══ HVORFOR DEN LAVER SIT EGET ARBEJDSTRAEE ═══
//
//  Foerste udgave muterede dét traee, den blev kaldt fra. Det gik galt paa
//  praecis den maade, man ikke ser: en `git add -A` i en anden kommando
//  ramte, mens mutationen var aktiv, og indekset fangede den MUTEREDE fil.
//  Havde den commit gaaet igennem, var fejlen landet sammen med den
//  modproeve, der lige havde bevist den.
//
//  Derfor muteres der aldrig i kalderens traee. `git worktree add` giver et
//  eget traee, mutationen sker dér, og det fjernes igen. Kalderens
//  arbejdskopi og indeks roeres ikke, uanset hvad mutationen goer.
//
//  ═══ TRE VAGTER, OG HVORFOR HVER AF DEM FINDES ═══
//
//  1 · BESKIDT TRAEE AFVISES. Et arbejdstraee skabes fra et COMMIT. Er der
//      uforpligtede aendringer, ligger de ikke i traeet — saa maaler
//      modproeven en kode, der ikke er den, du er ved at aflevere. Det er
//      ikke en formalitet: en groen modproeve mod det forkerte traee ser
//      ud som et bevis og er det modsatte.
//
//  2 · EN MUTATION, DER IKKE AENDRER NOGET, AFVISES. Ramte moenstret ikke,
//      koerer proeven mod uaendret kode og bliver groen. Uden vagten ville
//      det laese som «vagten virker ikke» — den praecist omvendte
//      konklusion af virkeligheden.
//
//  3 · EN MUTATION, DER IKKE BLIVER ROED, ER ET FUND. Det er hele
//      formaalet, og derfor er det kaldets exitkode: 0 betyder «mutationen
//      BLEV fanget», ikke «kommandoen koerte».
//
//  ═══ BRUG ═══
//
//      node scripts/modproeve.mjs <mutation.mjs> -- <proevekommando...>
//
//  Mutationsfilen faar arbejdstraeets rod som sit foerste argument og skal
//  aendre mindst én fil dér. Eksempel:
//
//      node scripts/modproeve.mjs modproever/fjern-ellinje.mjs -- \
//        npm run test:kerne
// ═══════════════════════════════════════════════════════════════

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const argv = process.argv.slice(2)
const skil = argv.indexOf('--')
const mutationSti = argv[0]
const kommando = skil >= 0 ? argv.slice(skil + 1) : []
if (!mutationSti || kommando.length === 0) {
  console.error('brug: node scripts/modproeve.mjs <mutation.mjs> -- <proevekommando...>')
  process.exit(2)
}

const rod = git('rev-parse', '--show-toplevel')
const mutation = resolve(mutationSti)
if (!existsSync(mutation)) {
  console.error(`modproeve: mutationsfilen findes ikke: ${mutation}`)
  process.exit(2)
}

// ── Vagt 1 · beskidt traee ──────────────────────────────────────
const urent = git('status', '--porcelain')
if (urent) {
  console.error('modproeve: AFVIST — traeet er ikke rent.\n')
  console.error('  Et arbejdstraee skabes fra et commit, saa dine uforpligtede')
  console.error('  aendringer ville IKKE vaere under proeve. En modproeve mod det')
  console.error('  forkerte traee ser ud som et bevis og er det modsatte.\n')
  console.error('  Commit eller stash foerst. Uforpligtet:\n')
  console.error(urent.split('\n').map((l) => `    ${l}`).join('\n'))
  process.exit(2)
}

const head = git('rev-parse', 'HEAD')
const traee = mkdtempSync(join(tmpdir(), 'modproeve-'))

// ⚠ Kroppen RETURNERER sin exitkode frem for at kalde process.exit().
// Foerste udgave kaldte process.exit() inde i try'en paa afvisningsvejene,
// og `finally` springes over ved process.exit() — saa hver afvisning
// efterlod sit arbejdstraee i /tmp og en post i `git worktree list`.
// Opdaget ved at LAESE `git worktree list` efter en afvist koersel; intet
// i outputtet antydede det.
function koer() {
  git('worktree', 'add', '--detach', '--quiet', traee, head)
  // tsx og react ligger i kalderens node_modules; et nyt traee har ingen.
  // Et symlink er nok og koster ingen kopiering.
  const nm = join(rod, 'node_modules')
  if (existsSync(nm)) symlinkSync(nm, join(traee, 'node_modules'), 'dir')

  console.log(`modproeve: arbejdstraee ${traee}`)
  console.log(`modproeve: fra ${head.slice(0, 8)} — kalderens traee roeres ikke\n`)

  // ── Mutationen ────────────────────────────────────────────────
  const m = spawnSync(process.execPath, [mutation, traee], { stdio: 'inherit' })
  if (m.status !== 0) {
    console.error('\nmodproeve: AFVIST — mutationen fejlede selv.')
    return 2
  }

  // ── Vagt 2 · aendrede mutationen overhovedet noget? ───────────
  const aendret = execFileSync('git', ['-C', traee, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (!aendret) {
    console.error('\nmodproeve: AFVIST — mutationen aendrede ingen filer.')
    console.error('  Moenstret ramte ikke. Proeven ville koere mod UAENDRET kode og')
    console.error('  blive groen, hvilket ville laese som «vagten virker ikke».')
    return 2
  }
  console.log('\nmodproeve: mutationen rammer')
  console.log(aendret.split('\n').map((l) => `    ${l}`).join('\n'))

  // ── Proeven ───────────────────────────────────────────────────
  console.log(`\nmodproeve: koerer ${kommando.join(' ')}\n`)
  const p = spawnSync(kommando[0], kommando.slice(1), {
    cwd: traee, encoding: 'utf8', shell: false,
    env: { ...process.env, BILLED_HEMMELIGHED: process.env.BILLED_HEMMELIGHED ?? 'proeve-hemmelighed-kun-til-proever' },
  })
  const ud = `${p.stdout ?? ''}${p.stderr ?? ''}`
  const roede = ud.split('\n').filter((l) => /^\s*✗/.test(l))

  // ── Vagt 3 · blev den roed? ───────────────────────────────────
  if (p.status === 0 && roede.length === 0) {
    console.error('modproeve: FUND — mutationen blev IKKE fanget.')
    console.error('  Proeven er groen, selv om fejlen er indfoert med vilje. Saa')
    console.error('  maaler den ikke det, den ser ud til at maale.')
    return 1
  } else {
    console.log(`modproeve: FANGET — proeven blev roed (exit ${p.status}).`)
    for (const l of roede.slice(0, 20)) console.log(`    ${l.trim()}`)
    if (roede.length > 20) console.log(`    … og ${roede.length - 20} flere`)
    console.log(`\n  roede tjek: ${roede.length}`)
    return 0
  }
}

let kode = 2
try {
  kode = koer()
} finally {
  // Kalderens traee skal vaere urOErt, ogsaa hvis noget gik i stykker.
  try { git('worktree', 'remove', '--force', traee) } catch { /* bedste forsoeg */ }
  rmSync(traee, { recursive: true, force: true })
}
process.exit(kode)
