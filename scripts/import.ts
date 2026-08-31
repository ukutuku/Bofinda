// Koerer importen én gang.
//   npm run import            alle rigtige kilder
//   npm run import -- dummy   én kilde, ogsaa en testkilde
import { KILDER, findKilde } from '../adapters'
import { koerAlle, formatResultat } from '../lib/scheduler'
import { koerKilde, RUNNER } from '../lib/ingest'
import { sql } from '../db/client'

const ud = (s: string) => process.stdout.write(s + '\n')

const slug = process.argv[2]
const valgte = slug ? [findKilde(slug)].filter(Boolean) as typeof KILDER : KILDER
if (slug && !valgte.length) {
  ud(`ukendt kilde: ${slug}. Kendte: ${KILDER.map((k) => k.adapter.id).join(', ')}`)
  process.exit(1)
}

// Foerste linje, foer noget kan naa at gaa galt. Er den her ikke i loggen,
// naaede processen aldrig at starte.
ud(`import startet · runner=${RUNNER} · node ${process.version} · `
  + `kilder: ${valgte.map((k) => k.adapter.id).join(', ')}`)

// Resultatet skrives, saa snart hver kilde er faerdig — ikke til sidst.
// Doer processen midt i kilde nr. to, staar kilde nr. ét stadig i loggen.
if (slug) {
  const k = valgte[0]!
  ud(formatResultat(await koerKilde(k.adapter, k.navn, { baseUrl: k.baseUrl })))
} else {
  await koerAlle(valgte, (r) => ud(formatResultat(r)))
}

ud('import afsluttet')
await sql.end()
