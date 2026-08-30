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

for (const r of await koerAlle(valgte)) console.log(formatResultat(r))
await sql.end()
