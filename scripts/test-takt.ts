// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  TAKTTABELLEN MÅ IKKE HAVE EN STANDARD.
//
//  Hver vært, en registreret kilde henter fra, skal stå i `VAERTSTAKT` —
//  også de værter, der kører på standardtakten. En vært uden en linje er
//  ikke en standard; det er en manglende beslutning, der ser ud som en.
//
//  ── Hvorfor det er værd at håndhæve ──────────────────────────
//  Tabellen havde to poster, og begge var reaktioner: Heimstaden 5000
//  efter deres 503, Laros 20000 fra deres robots.txt. Alt andet faldt til
//  `RATE_MS` = ét kald i sekundet — og ét kald i sekundet er PRÆCIS den
//  takt, der fik os spærret hos Heimstaden efter ~17 minutter.
//
//  Standardtakten er altså ikke en sikker værdi at falde tilbage på. Den
//  er den værdi, vi har et målt modeksempel på.
//
//  ── Hvad tjekket måler, og hvad det IKKE måler ───────────────
//  Det måler, at der er TAGET STILLING — ikke at taksten er klog. En
//  `IKKE_BESLUTTET`-markør tæller som en linje og lader tjekket passere,
//  men den siger højt, at ingen har besluttet, og den tælles i rapporten.
//  Det er med vilje: at skrue otte kilder ned på én gang er en
//  driftsændring, ingen har besluttet, og tjekket her handler om, at
//  beslutningen skal være SKREVET.
//
//  ── Grænsen: adapterens `host` er ikke nødvendigvis URL'ens ──
//  `politeFetch` slår takten op på `new URL(url).host` (lib/fetch.ts:82),
//  ikke på adapterens `host`-felt. De to er to udtryk for det samme
//  spørgsmål, og de kan drive fra hinanden: henter en adapter en dag fra
//  et søskende-domæne (`api.foo.dk` ved siden af `www.foo.dk`), får den
//  vært sin EGEN takt-spand på standarden, uden en linje nogen steder.
//  Tjekket kan ikke se det — det kender kun de erklærede værter. Derfor
//  prøves den grænse udtrykkeligt nedenfor, så den er dokumenteret og ikke
//  en overraskelse.
// ═══════════════════════════════════════════════════════════════

import { rigtigeKilder } from '../adapters/index'
import { taktBesluttet, taktStaarITabellen, taktTabellensVaerter, taktFor } from '../lib/fetch'

const start = performance.now()
let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

console.log('\n══ Takttabellen: ingen vært uden en linje ══\n')

const kilder = rigtigeKilder()
const manglende = kilder.filter((k) => !taktStaarITabellen(k.adapter.host))
tjek(`alle ${kilder.length} kørende kilders værter står i tabellen`,
  manglende.length === 0,
  manglende.length ? manglende.map((k) => `${k.navn} → ${k.adapter.host}`).join(' · ') : 'ingen huller')

// Den anden vej: en linje for en vært, ingen henter fra, er ikke en fejl
// (en kilde kan være taget ud), men den skal kunne ses.
const erklaerede = new Set(kilder.map((k) => k.adapter.host))
const forladte = taktTabellensVaerter().filter((v) => !erklaerede.has(v) && !v.includes('invalid'))
console.log(`    (${forladte.length} linjer uden en kørende kilde${forladte.length ? ': ' + forladte.join(', ') : ''})`)

// Optællingen. Den skal falde over tid, og den står her, så den kan ses falde.
const besluttet = kilder.filter((k) => taktBesluttet(k.adapter.host))
const ikke = kilder.filter((k) => !taktBesluttet(k.adapter.host))
console.log(`\n  besluttet: ${besluttet.length} af ${kilder.length}`)
for (const k of besluttet) console.log(`      ${k.navn.padEnd(18)} ${k.adapter.host.padEnd(24)} ${taktFor(k.adapter.host)} ms`)
console.log(`  IKKE besluttet: ${ikke.length} — kører på standardtakten, uden at nogen har taget stilling`)
for (const k of ikke) console.log(`      ${k.navn.padEnd(18)} ${k.adapter.host.padEnd(24)} ${taktFor(k.adapter.host)} ms`)

// Grænsen, dokumenteret: en vært der IKKE er erklæret af nogen adapter
// findes ikke for tjekket, og får standardtakten uden en linje.
console.log('')
tjek('GRÆNSE: en uerklæret vært står ikke i tabellen og får standardtakten',
  !taktStaarITabellen('soeskende-domaene.invalid') && taktFor('soeskende-domaene.invalid') === 1000,
  'tjekket kender kun de erklærede værter — se hovedet')

console.log(`\n  (${Math.round(performance.now() - start)} ms)`)
console.log(fejl === 0 ? '  ALT GRØNT\n' : `  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
