// Koerer importen én gang.
//   npm run import            alle kilder
//   npm run import -- dummy   én kilde
import { KILDER, findKilde } from '../adapters'
import { koerAlle } from '../lib/scheduler'
import { formatResultat } from '../lib/scheduler'
import { sql } from '../db/client'

const slug = process.argv[2]
const valgte = slug ? [findKilde(slug)].filter(Boolean) as typeof KILDER : KILDER
if (slug && !valgte.length) {
  console.error(`ukendt kilde: ${slug}. Kendte: ${KILDER.map((k) => k.adapter.id).join(', ')}`)
  process.exit(1)
}

// Navngives en kilde udtrykkeligt, koeres den — ogsaa en testkilde.
// Uden argument koeres kun de rigtige.
const resultater = slug
  ? [await (await import('../lib/ingest')).koerKilde(valgte[0]!.adapter, valgte[0]!.navn, { baseUrl: valgte[0]!.baseUrl })]
  : await koerAlle(valgte)
for (const r of resultater) console.log(formatResultat(r))
await sql.end()
