// Måler testdatasættet gennem APPENS egen søgning — ikke gennem et
// sideløbende SQL-udtryk. To udtryk for samme spørgsmål driver fra
// hinanden; her er der kun ét.
import { soegGrupperet } from '../../lib/soeg'

const u = new URL(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? 'x://')
if (u.port !== '55432') { console.error('FEJL: ikke testbasen'); process.exit(1) }

// Søgesidens egen sidestørrelse — samme standardværdi som soegGrupperet().
const PR_SIDE = 48

async function vis(navn: string, f: Parameters<typeof soegGrupperet>[0], side = 1) {
  const r = await soegGrupperet(f, PR_SIDE, new Date(), side)
  const sider = Math.max(1, Math.ceil(r.kortIAlt / PR_SIDE))
  console.log(`  ${navn.padEnd(32)} kort=${String(r.kortIAlt).padStart(4)}  sider=${sider}  `
    + `påSiden=${String(r.visninger.length).padStart(2)}  komplet=${r.komplet}`)
  return { sider, ...r }
}

console.log('\n═══ Testdatasættet, målt gennem soegGrupperet ═══')
const alle = await vis('uden filtre', {})
await vis('side 2', {}, 2)
await vis('sidste side', {}, alle.sider)
await vis('postnr 9001', { postnr: '9001' })
await vis('by Attrapby', { by: 'Attrapby' })
await vis('areal >= 100', { arealMin: 100 })
const nul = await vis('NUL-søgning (by=Findesikke)', { by: 'Findesikke' })

const gruppekort = alle.visninger.filter((v: any) => v.gruppe != null).length
console.log(`\n  gruppekort på side 1: ${gruppekort} af ${alle.visninger.length}`)

const krav: [string, boolean][] = [
  ['mindst 120 kort', alle.kortIAlt >= 120],
  ['mindst 3 sider', alle.sider >= 3],
  ['mindst ét gruppekort', gruppekort > 0],
  ['nul-søgning giver nul og er komplet', nul.kortIAlt === 0 && nul.komplet],
]
let ok = true
console.log('')
for (const [navn, b] of krav) { console.log(`  ${b ? '✓' : '✗'} ${navn}`); if (!b) ok = false }
console.log('')
process.exit(ok ? 0 : 1)
