// Måler testdatasættet gennem APPENS egen søgning — ikke gennem et
// sideløbende SQL-udtryk. To udtryk for samme spørgsmål driver fra
// hinanden; her er der kun ét.
//
// PAGINERING PRØVES IKKE HER. Denne fil kører på main, hvor `?side=N`
// endnu ikke findes: `soegGrupperet()` tager tre argumenter og
// returnerer altid det første udsnit. Et fjerde argument ville blive
// tavst ignoreret af tsx, og «side 2» ville måle side 1 igen — en
// kontrol, der ikke kan fejle. Sideantallet nedenfor er derfor et
// udsagn om DATASÆTTETS størrelse, ikke om en pager.
import { soegGrupperet } from '../../lib/soeg'

// Samme stramme mål som resten af miljøet: loopback, port 55432,
// databasen bofinda_test. Værnet står her og ikke kun i maal.sh, så
// en direkte kørsel (`tsx scripts/cloud/tjek.ts`) er dækket lige så
// godt som en gennem wrapperen. Der er ingen standardbase.
const raa = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
if (!raa) {
  console.error('FEJL: ingen DATABASE_URL. Der er ingen standardbase.')
  process.exit(1)
}
const u = new URL(raa)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port !== '55432'
    || u.pathname !== '/bofinda_test') {
  console.error(`FEJL: ${u.hostname}:${u.port}${u.pathname} er ikke den isolerede testbase.`)
  console.error('      Målingen kører kun mod 127.0.0.1:55432/bofinda_test.')
  process.exit(1)
}

// Søgesidens egen sidestørrelse — samme standardværdi som soegGrupperet().
const PR_SIDE = 48

async function vis(navn: string, f: Parameters<typeof soegGrupperet>[0]) {
  const r = await soegGrupperet(f, PR_SIDE, new Date())
  // Hvor mange sider datasættet FYLDER. Sandt uanset om der findes en
  // pager til at nå dem — det er en egenskab ved sættet, ikke ved UI'et.
  const sider = Math.max(1, Math.ceil(r.kortIAlt / PR_SIDE))
  console.log(`  ${navn.padEnd(32)} kort=${String(r.kortIAlt).padStart(4)}  sider=${sider}  `
    + `påSiden=${String(r.visninger.length).padStart(2)}  komplet=${r.komplet}`)
  return { sider, ...r }
}

console.log('\n═══ Testdatasættet, målt gennem soegGrupperet ═══')
const alle = await vis('uden filtre', {})
await vis('postnr 9001', { postnr: '9001' })
await vis('by Attrapby', { by: 'Attrapby' })
await vis('areal >= 100', { arealMin: 100 })
const nul = await vis('NUL-søgning (by=Findesikke)', { by: 'Findesikke' })

const gruppekort = alle.visninger.filter((v: any) => v.gruppe != null).length
console.log(`\n  gruppekort i første udsnit: ${gruppekort} af ${alle.visninger.length}`)

const krav: [string, boolean][] = [
  ['mindst 120 kort', alle.kortIAlt >= 120],
  // Ikke «pageren har 3 sider» — den findes ikke på main. Kun at sættet
  // er stort nok til at fylde dem, så en pager har noget at vise, den
  // dag den lander.
  ['datasættet fylder mindst 3 sider à 48', alle.sider >= 3],
  ['første udsnit er fuldt (48 kort)', alle.visninger.length === PR_SIDE],
  ['mindst ét gruppekort', gruppekort > 0],
  ['nul-søgning giver nul og er komplet', nul.kortIAlt === 0 && nul.komplet],
]
let ok = true
console.log('')
for (const [navn, b] of krav) { console.log(`  ${b ? '✓' : '✗'} ${navn}`); if (!b) ok = false }
console.log('')
process.exit(ok ? 0 : 1)
