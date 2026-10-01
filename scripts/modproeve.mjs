#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  MODPROEVEKOERER — indfoer fejlen med vilje, og KRAEV at det bliver roedt.
//
//  CLAUDE.md siger princippet: «Kan du ikke faa det roedt ved at indfoere
//  fejlen med vilje, maaler det ikke det, du tror.» Filen her er
//  mekanikken, saa princippet ikke hviler paa, at nogen husker det.
//
//      node scripts/modproeve.mjs <mutation.mjs> -- <proevekommando...>
//
//  Se modproever/LAES-MIG.md for mutationsformen og de fem vagter.
// ═══════════════════════════════════════════════════════════════

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, symlinkSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const PRAEFIKS = 'modproeve-'
const traeerNu = () => readdirSync(tmpdir()).filter((n) => n.startsWith(PRAEFIKS)).sort()

const argv = process.argv.slice(2)
const skil = argv.indexOf('--')
const mutationSti = argv[0]
const kommando = skil >= 0 ? argv.slice(skil + 1) : []
if (!mutationSti || kommando.length === 0) {
  console.error('brug: node scripts/modproeve.mjs <mutation.mjs> -- <proevekommando...>')
  process.exit(2)
}

const rod = git('rev-parse', '--show-toplevel')
const mutationFil = resolve(mutationSti)
if (!existsSync(mutationFil)) {
  console.error(`modproeve: mutationsfilen findes ikke: ${mutationFil}`)
  process.exit(2)
}

// ── VAGT 1 · alt skal vaere i INDEKSET ──────────────────────────
//  Traeet bygges af `git write-tree`, som kun ser det ISCENESATTE. Den
//  naturlige orden — skriv kode, skriv proeve, bevis at den kan blive
//  roed, commit DEREFTER — overlever derfor, saa laenge man har `git
//  add`'et. Men uiscenesat arbejde og nye filer ligger IKKE i traeet, og
//  en modproeve, der tavst maaler uden dem, ser ud som et bevis og er det
//  modsatte. Foerste udgave krAEvede et rent traee og forboed dermed
//  raekkefoelgen i praksis.
const udenfor = git('status', '--porcelain')
  .split('\n').filter(Boolean)
  .filter((l) => l[1] !== ' ')          // andet tegn = aendret i arbejdstraeet
if (udenfor.length) {
  console.error('modproeve: AFVIST — noget ligger uden for indekset.\n')
  console.error('  Traeet bygges af `git write-tree`, som kun ser det iscenesatte.')
  console.error('  Det nedenfor ville IKKE vaere under proeve, og en groen modproeve')
  console.error('  uden det ser ud som et bevis og er det modsatte.\n')
  console.error('  `git add` dem foerst — du behoever ikke committe.\n')
  for (const l of udenfor) console.error(`    ${l}`)
  process.exit(2)
}

// ── Mutationens erklaering laeses FOER noget oprettes ───────────
const mod = await import(pathToFileURL(mutationFil).href)
const f = mod.forventning
if (!f || typeof f !== 'object') {
  console.error('modproeve: AFVIST — mutationen erklaerer ingen `forventning`.')
  console.error('  Se modproever/LAES-MIG.md. En mutation uden erklaering kan ramme')
  console.error('  et andet sted end den paastaar, og vagt 2 ser det ikke: den')
  console.error('  spoerger kun OM noget blev aendret, ikke HVAD.')
  process.exit(2)
}
for (const n of ['fil', 'moenster', 'traeffere']) {
  if (f[n] === undefined) {
    console.error(`modproeve: AFVIST — \`forventning.${n}\` mangler.`)
    process.exit(2)
  }
}

const traeerFoer = traeerNu()
const traee = mkdtempSync(join(tmpdir(), PRAEFIKS))

function koer() {
  const tree = git('write-tree')
  // Et haengende commit: `git worktree add` kraever en commit-ish, og
  // INGEN ref peger paa den. Den samles op af gc i sin tid.
  const commit = git('commit-tree', tree, '-p', git('rev-parse', 'HEAD'),
    '-m', 'modproeve: det iscenesatte')
  git('worktree', 'add', '--detach', '--quiet', traee, commit)
  const nm = join(rod, 'node_modules')
  if (existsSync(nm)) symlinkSync(nm, join(traee, 'node_modules'), 'dir')

  const iscenesat = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
  console.log(`modproeve: arbejdstraee ${traee}`)
  console.log(`modproeve: bygget af INDEKSET (${iscenesat.length} iscenesat${iscenesat.length === 1 ? ' fil' : 'te filer'})`)
  console.log('modproeve: kalderens arbejdskopi og indeks roeres ikke\n')

  // ── VAGT 4 · rammer mutationen DÉR, hvor den siger? ──────────
  const maal = join(traee, f.fil)
  if (!existsSync(maal)) {
    console.error(`modproeve: AFVIST — \`forventning.fil\` findes ikke i traeet: ${f.fil}`)
    return 2
  }
  const indhold = readFileSync(maal, 'utf8')
  const re = f.moenster instanceof RegExp
    ? new RegExp(f.moenster.source, f.moenster.flags.includes('g') ? f.moenster.flags : `${f.moenster.flags}g`)
    : new RegExp(f.moenster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const fund = [...indhold.matchAll(re)]
  const linje = (i) => indhold.slice(0, i).split('\n').length

  if (fund.length !== f.traeffere) {
    console.error(`modproeve: AFVIST — moenstret rammer ${fund.length} gang(e), erklaeret ${f.traeffere}.\n`)
    console.error(`  Et regex, der rammer et andet antal end forventet, rammer et`)
    console.error(`  ANDET STED. Det er sket tre gange i dette repo, og vagt 2 ser`)
    console.error(`  det ikke: den spoerger OM noget blev aendret, ikke HVAD.\n`)
    if (fund.length) {
      console.error(`  Fundet i ${f.fil} paa linje:`)
      for (const m of fund) console.error(`    ${linje(m.index)}: ${m[0].split('\n')[0].trim().slice(0, 70)}`)
    } else {
      console.error(`  Moenstret ramte INTET i ${f.fil}.`)
    }
    return 2
  }

  const vaelg = f.vaelg ?? 0
  const valgt = fund[vaelg]
  if (!valgt) {
    console.error(`modproeve: AFVIST — \`forventning.vaelg\` = ${vaelg}, men der er ${fund.length} traeffere.`)
    return 2
  }

  // Holdepunktet pinner HVILKEN traeffer, naar der er flere ens.
  if (f.naer !== undefined) {
    const vindue = f.naerVindue ?? 15
    const l = linje(valgt.index)
    const linjer = indhold.split('\n')
    const fra = Math.max(0, l - 1 - vindue), til = Math.min(linjer.length, l - 1 + vindue)
    if (!linjer.slice(fra, til).join('\n').includes(f.naer)) {
      console.error(`modproeve: AFVIST — holdepunktet \`${f.naer}\` staar ikke inden for`)
      console.error(`  ${vindue} linjer af traeffer ${vaelg} (linje ${l}) i ${f.fil}.`)
      console.error(`  Mutationen rammer altsaa et andet sted end den paastaar.`)
      const hvor = linjer.findIndex((x) => x.includes(f.naer))
      if (hvor >= 0) console.error(`  Holdepunktet staar paa linje ${hvor + 1}.`)
      return 2
    }
    console.log(`modproeve: holdepunkt \`${f.naer}\` bekraeftet naer linje ${linje(valgt.index)}`)
  }
  console.log(`modproeve: ${fund.length} traeffer(e) som erklaeret · muterer nr. ${vaelg} paa linje ${linje(valgt.index)}`)

  // ── Mutationen anvendes ──────────────────────────────────────
  const nyt = typeof mod.default === 'function'
    ? mod.default(indhold, fund, vaelg)
    : indhold.slice(0, valgt.index) + (f.erstat ?? '') + indhold.slice(valgt.index + valgt[0].length)
  writeFileSync(maal, nyt)

  // ── VAGT 2 · aendrede den overhovedet noget? ──────────────────
  const aendret = execFileSync('git', ['-C', traee, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (!aendret) {
    console.error('\nmodproeve: AFVIST — mutationen aendrede ingen filer.')
    console.error('  Proeven ville koere mod UAENDRET kode og blive groen, hvilket')
    console.error('  ville laese som «vagten virker ikke».')
    return 2
  }
  console.log(`modproeve: mutationen rammer\n${aendret.split('\n').map((l) => `    ${l}`).join('\n')}`)

  // ── Proeven ───────────────────────────────────────────────────
  console.log(`\nmodproeve: koerer ${kommando.join(' ')}\n`)
  const p = spawnSync(kommando[0], kommando.slice(1), {
    cwd: traee, encoding: 'utf8', shell: false,
    env: { ...process.env, BILLED_HEMMELIGHED: process.env.BILLED_HEMMELIGHED ?? 'proeve-hemmelighed-kun-til-proever' },
  })
  const ud = `${p.stdout ?? ''}${p.stderr ?? ''}`
  const roede = ud.split('\n').filter((l) => /^\s*✗/.test(l))

  // ── VAGT 3 · blev den roed? ───────────────────────────────────
  if (p.status === 0 && roede.length === 0) {
    console.log('')
    console.log('  ══════════════════════════════════════════════════')
    console.log('   MUTATIONEN SLAP IGENNEM — proeven blev groen')
    console.log('  ══════════════════════════════════════════════════')
    console.log('')
    console.log(`  Fejlen er indfoert med vilje i ${f.fil}, og intet blev roedt.`)
    console.log('  Proeven maaler altsaa ikke det, den ser ud til at maale.')
    return 1
  }
  for (const l of roede.slice(0, 20)) console.log(`    ${l.trim()}`)
  if (roede.length > 20) console.log(`    … og ${roede.length - 20} flere`)
  console.log('')
  console.log('  ══════════════════════════════════════════════════')
  console.log(`   MUTATIONEN BLEV FANGET — ${roede.length} roede (proeven gav exit ${p.status})`)
  console.log('  ══════════════════════════════════════════════════')
  return 0
}

let kode = 2
try {
  // ⚠ Kroppen RETURNERER sin kode frem for at kalde process.exit().
  // process.exit() springer `finally` over, og foerste udgave efterlod
  // derfor sit arbejdstraee ved hver afvisning. Opdaget ved at LAESE
  // `git worktree list` — intet i outputtet antydede det. Det er vagt 5's
  // grund til at findes.
  kode = await koer()
} finally {
  try { git('worktree', 'remove', '--force', traee) } catch { /* bedste forsoeg */ }
  rmSync(traee, { recursive: true, force: true })

  // ── VAGT 5 · efterlod vi noget? ──────────────────────────────
  const traeerEfter = traeerNu()
  const efterladt = traeerEfter.filter((n) => !traeerFoer.includes(n))
  if (efterladt.length) {
    console.error(`\nmodproeve: FEJL I KOEREREN — ${efterladt.length} arbejdstraee(r) blev efterladt:`)
    for (const n of efterladt) console.error(`    ${join(tmpdir(), n)}`)
    console.error('  Oprydningen virker ikke. Et vaerktoejs tavshed er ikke et bevis,')
    console.error('  saa den her vagt taeller frem for at stole paa `finally`.')
    kode = 2
  }
}
process.exit(kode)
