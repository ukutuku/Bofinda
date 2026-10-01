// ═══════════════════════════════════════════════════════════════
//  Prøven af reglen «kommandoen navngiver sit mål og afviser som
//  standard» — kørt mod de RIGTIGE kommandoer (laast-base.mjs › kraevMaal,
//  de tre målescripts, importer-testbase.sh og app-skud.mjs), hver i sin
//  egen proces. Ikke mod en kopi af vagten.
//
//      node docs/designforslag/maalinger/proev-maal.mjs
//
//  Ingen forbindelse åbnes, og intet importeres: de afviste tilfælde
//  stopper i vagten, de godkendte kraevMaal-tilfælde stopper, før en
//  forbindelse ville blive åbnet, og importen kører mod en attrap af
//  `npx` forrest i PATH, som kun skriver sit miljø ud. Derfor er også en
//  modprøve med en svækket importvagt ufarlig, når netværket er åbent.
//  Et afvist kald må ikke have skrevet noget: app-skud.mjs' udmappe skal
//  ikke findes bagefter. Exit 1 ved afvigelse.
// ═══════════════════════════════════════════════════════════════
import { spawnSync, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
const HER = new URL('.', import.meta.url).pathname
const ROD = join(HER, '../../..')
const LB = join(HER, 'laast-base.mjs')
const TEST = 'postgres://x:y@127.0.0.1:55432/bofinda_test?sslmode=disable'
const POOLER = 'postgres://postgres.abcdefghijklmnopqrst:y@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
const DIREKTE = 'postgres://postgres:y@db.abcdefghijklmnopqrst.supabase.co:5432/postgres'
const STAGING = 'postgres://postgres.prgmenbwabwkgitjclrj:y@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
const RENT = { PATH: process.env.PATH, HOME: process.env.HOME }

const vagt = (args, url, ekstra = {}) => spawnSync(process.execPath, ['-e',
  `import(${JSON.stringify(LB)}).then((m) => { const r = m.kraevMaal(${JSON.stringify(args)}); console.log(r.maal) })`],
  { env: { ...RENT, ...(url ? { DATABASE_URL_DIRECT: url } : {}), ...ekstra }, encoding: 'utf8' })
// De rigtige kommandolinjer — plain node: vagten står før enhver .ts-import.
const cli = (script, args, url) => spawnSync(process.execPath, [join(HER, script), ...args],
  { env: { ...RENT, ROD, ...(url ? { DATABASE_URL_DIRECT: url } : {}) }, encoding: 'utf8' })
const imp = (env) => spawnSync('bash', [join(HER, '../gengivelse/importer-testbase.sh'), 'propstep'], { env: { ...RENT, ...env }, encoding: 'utf8' })
const appskud = (url) => {
  const ud = join(tmpdir(), `proev-maal-${process.pid}-${Math.round(performance.now())}`)
  const r = spawnSync(process.execPath, [join(HER, '../gengivelse/app-skud.mjs'), ud, 'efter'], { env: { ...RENT, DATABASE_URL_DIRECT: url }, encoding: 'utf8' })
  r.skrev = existsSync(ud)
  if (r.skrev) rmSync(ud, { recursive: true, force: true })
  return r
}

// Attrappen: en `npx`, der skriver det miljø, importen ville have kørt med.
const attrapMappe = mkdtempSync(join(tmpdir(), 'npx-attrap-'))
writeFileSync(join(attrapMappe, 'npx'), '#!/bin/sh\necho "MAAL=$DATABASE_URL_DIRECT"\necho "RESEND=${RESEND_API_KEY:-fravaerende}"\necho "ARGS=$*"\n')
chmodSync(join(attrapMappe, 'npx'), 0o755)
const testUrl = execFileSync('bash', ['-c', `source "${ROD}/scripts/cloud/miljoe.sh" && test_url`]).toString().trim()
const medAttrap = { PATH: `${attrapMappe}:${process.env.PATH}` }

const T = [
  // ── kraevMaal: navnet ───────────────────────────────────────────
  ['intet --maal', vagt([], TEST), 3],
  ['--base alene (den gamle form)', vagt(['--base'], TEST), 3],
  ['--maal test uden DATABASE_URL_DIRECT', vagt(['--maal', 'test'], null), 3],
  ['ugyldig URL', vagt(['--maal', 'test'], 'postgres://[ugyldig'), 3],
  // ── test: positivt, læst af miljoe.sh ───────────────────────────
  ['--maal test mod testbasen', vagt(['--maal', 'test'], TEST), 0],
  ['--maal test mod en fjern base', vagt(['--maal', 'test'], POOLER), 3],
  ['--maal test mod forkert lokal port', vagt(['--maal', 'test'], TEST.replace('55432', '5432')), 3],
  ['--maal test med ?dbname= (psql ville følge den)', vagt(['--maal', 'test'], TEST + '&dbname=postgres'), 3],
  ['--maal test med ?host=', vagt(['--maal', 'test'], TEST + '&host=10.0.0.1'), 3],
  ['--maal test, BOFINDA_PGPORT/-DB i miljøet udvider ikke', vagt(['--maal', 'test'], 'postgres://x:y@127.0.0.1:5432/postgres', { BOFINDA_PGPORT: '5432', BOFINDA_PGDB: 'postgres' }), 3],
  // ── prod: positivt — kun Supabase, /postgres, ikke staging ──────
  ['--maal prod mod session-pooleren', vagt(['--maal', 'prod'], POOLER), 0],
  ['--maal prod mod direkte vært', vagt(['--maal', 'prod'], DIREKTE), 0],
  ['--maal prod mod testbasen', vagt(['--maal', 'prod'], TEST), 3],
  ...['LOCALHOST', 'localhost.', '127.1', '127.0.0.2', '0.0.0.0', '[::ffff:127.0.0.1]', 'host.docker.internal', 'db.invalid,127.0.0.1'].map((v) =>
    // Stien er /postgres, som Supabase's: så er værtskravet den ENESTE
    // barriere, og tilfældet prøver netop det (modprøven fandt, at stien
    // /bofinda_test ellers afviste dem i forvejen).
    [`--maal prod mod ${v} (sti /postgres)`, vagt(['--maal', 'prod'], `postgres://x:y@${v}:5432/postgres`), 3]),
  ['--maal prod mod staging', vagt(['--maal', 'prod'], STAGING), 3],
  ['--maal prod mod staging med versaler', vagt(['--maal', 'prod'], 'postgres://postgres:y@db.PRGMENBWABWKGITJCLRJ.supabase.co:5432/postgres'), 3],
  ['--maal prod mod en Supabase-vært med /bofinda_test', vagt(['--maal', 'prod'], POOLER.replace(/\/postgres$/, '/bofinda_test')), 3],
  ['--maal prod mod :6543', vagt(['--maal', 'prod'], POOLER.replace(':5432', ':6543')), 3],
  // ── de rigtige kommandolinjer ───────────────────────────────────
  ['maal-prisspaend.mjs uden flag', cli('maal-prisspaend.mjs', [], TEST), 3],
  ['maal-ny.mjs uden flag', cli('maal-ny.mjs', [], TEST), 3],
  ['maal-chips.mjs uden flag', cli('maal-chips.mjs', [], TEST), 3],
  ['maal-chips.mjs --prod (den gamle form)', cli('maal-chips.mjs', ['--prod'], TEST), 3],
  ['maal-forsidetal.mjs uden flag', cli('maal-forsidetal.mjs', [], TEST), 3],
  ['maal-prisspaend.mjs --maal test mod en fjern base', cli('maal-prisspaend.mjs', ['--maal', 'test'], POOLER), 3],
  ['maal-ny.mjs --maal prod mod testbasen', cli('maal-ny.mjs', ['--maal', 'prod'], TEST), 3],
  // ── importen ────────────────────────────────────────────────────
  ['importer-testbase.sh med DATABASE_URL i skallen', imp({ ...medAttrap, DATABASE_URL: POOLER }), 3],
  ['importer-testbase.sh med DATABASE_URL_DIRECT i skallen', imp({ ...medAttrap, DATABASE_URL_DIRECT: POOLER }), 3],
  ['importer-testbase.sh med RESEND_API_KEY i skallen', imp({ ...medAttrap, RESEND_API_KEY: 're_x' }), 3],
  ['importer-testbase.sh i en ren skal: målet er testbasen, ingen mailnøgle', (() => {
    const r = imp(medAttrap)
    const ok = r.status === 0 && r.stdout.includes(`MAAL=${testUrl}`) && r.stdout.includes('RESEND=fravaerende') && r.stdout.includes('ARGS=tsx scripts/import.ts propstep')
    return { status: ok ? 0 : 99, stdout: r.stdout, stderr: r.stderr }
  })(), 0],
  // ── app-skud: altid testbasen, og intet skrevet ved afvisning ──
  ...[['en fjern base', POOLER], ['testbasen med ?dbname=postgres', TEST + '&dbname=postgres']].map(([n, u]) => {
    const r = appskud(u)
    return [`app-skud.mjs mod ${n}: exit 3 og intet skrevet`, { status: r.status === 3 && !r.skrev ? 3 : (r.skrev ? 98 : r.status), stdout: r.stdout, stderr: r.stderr + (r.skrev ? '\n(udmappen blev oprettet)' : '') }, 3]
  }),
]
rmSync(attrapMappe, { recursive: true, force: true })
let fejl = 0
for (const [navn, r, forventet] of T) {
  const ok = r.status === forventet
  if (!ok) fejl++
  console.log(`${ok ? '✓' : '✗'} ${navn}: exit ${r.status} (forventet ${forventet})${ok ? '' : '\n    ' + ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(0, 6).join('\n    ')}`)
}
console.log(fejl ? `\n${fejl} AFVIGELSE(R)` : `\nAlle ${T.length} tilfælde gav den forventede exit-kode.`)
process.exit(fejl ? 1 : 0)
