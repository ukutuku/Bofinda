// Koerer importen én gang.
//   npm run import            alle RIGTIGE kilder
//   npm run import -- dummy   én kilde; testkilder kun her
import { KILDER, findKilde, rigtigeKilder, tilladTestkilder } from '../adapters'
import { koerAlle, formatResultat } from '../lib/scheduler'
import { koerKilde, RUNNER } from '../lib/ingest'
import { sql } from '../db/client'

const ud = (s: string) => process.stdout.write(s + '\n')

const slug = process.argv[2]

// Navngives en kilde udtrykkeligt, maa den vaere en testkilde. Ellers ikke.
if (slug) tilladTestkilder()

const valgte = slug
  ? [findKilde(slug)].filter(Boolean) as typeof KILDER
  : rigtigeKilder()

if (slug && !valgte.length) {
  ud(`ukendt kilde: ${slug}. Kendte: ${KILDER.map((k) => k.adapter.id).join(', ')}`)
  process.exit(1)
}

// Foerste linje, foer noget kan naa at gaa galt. Den viser hvad der FAKTISK
// koeres — ikke hvad der staar i registret. Forskellen kostede en fejlmelding.
ud(`import startet · runner=${RUNNER} · node ${process.version} · `
  + `kilder: ${valgte.map((k) => k.adapter.id).join(', ')}`
  + (slug ? '  (udtrykkeligt navngivet)' : ''))

// Resultatet skrives, saa snart hver kilde er faerdig — ikke til sidst.
if (slug) {
  const k = valgte[0]!
  ud(formatResultat(await koerKilde(k.adapter, k.navn, { baseUrl: k.baseUrl })))
} else {
  await koerAlle(valgte, (r) => ud(formatResultat(r)))
}

ud('import afsluttet')
await sql.end()
