#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  OMVENDT MODPRØVE — en udvidelse skal gå GRØN af sig selv.
//
//  De tre facilitetsfiltre var opregnet 14+ steder i hånden. Hvert sted
//  var korrekt; tilsammen var de en tidsindstillet fejl, for en
//  udvidelse skulle huskes i alle. Og CLAUDE.md kræver, at et
//  facilitetsfilter navngiver de kilder, der tier, og tæller de tre
//  grupper — den regel må ikke «komme bagefter» en udvidelse.
//
//  ── HVORFOR DEN IKKE KAN KØRE PÅ scripts/modproeve.mjs ──────
//  Kørerens vagt 3 KRÆVER, at mutationen bliver rød. Her er påstanden
//  den modsatte: tilføjer man et begreb til FACILITET, skal filteret,
//  aggregatet, afkrydsningen, grundlagslinjen og `tavseKilder` tage det
//  med UDEN at nogen rører dem. Går de ikke med af sig selv, er
//  udledningen ikke færdig.
//
//  Derfor dens eget script — med den samme disciplin: mutationen
//  erklæres, den skal ramme PRÆCIS ét sted pr. mønster, og filen
//  gendannes i `finally`.
//
//      node scripts/proev-facilitetsudvidelse.mjs
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const FIL = 'lib/faciliteter.ts'
const NY = 'vask'
const ORD = 'vaskemaskine'

// Erklæringen. Alle tre står i SAMME fil — det er en del af pointen:
// et nyt begreb kræver et ord, en formularplacering og et navn, og
// typevagten håndhæver netop de tre. Alt ANDET skal følge af sig selv.
const MUTATIONER = [
  { naer: 'export const FACILITET = {',
    moenster: "  elevator: ['elevator'],",
    erstat: `  elevator: ['elevator'],\n  ${NY}: ['${ORD}'],` },
  { naer: 'export const FACILITETER = [',
    moenster: "  { vaerdi: 'elevator', navn: 'Elevator' },",
    erstat: `  { vaerdi: 'elevator', navn: 'Elevator' },\n  { vaerdi: '${ORD}', navn: 'Vaskemaskine' },` },
  { naer: 'export const FACILITETSNAVN = {',
    moenster: "  elevator: 'elevator',\n  udeplads:",
    erstat: `  elevator: 'elevator',\n  ${NY}: '${ORD}',\n  udeplads:` },
]

const foer = readFileSync(FIL, 'utf8')
let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

try {
  let s = foer
  for (const m of MUTATIONER) {
    const n = s.split(m.moenster).length - 1
    if (n !== 1) {
      console.error(`AFVIST — «${m.moenster.slice(0, 40)}» rammer ${n} gange, ikke 1`)
      process.exit(2)
    }
    if (!s.includes(m.naer)) {
      console.error(`AFVIST — holdepunktet «${m.naer}» findes ikke`)
      process.exit(2)
    }
    s = s.replace(m.moenster, m.erstat)
  }
  if (s === foer) { console.error('AFVIST — intet blev ændret'); process.exit(2) }
  writeFileSync(FIL, s)
  console.log(`\n  mutation: ${NY} → ['${ORD}'] tilføjet til FACILITET,`)
  console.log('            med formularplacering og navn. Intet andet rørt.\n')

  // Påstanden: alt det afledte tager det nye begreb med AF SIG SELV.
  const ud = execFileSync('npx', [
    'tsx', '--tsconfig', 'tsconfig.scripts.json',
    'scripts/testbase.ts', 'scripts/_udvidelsespaastand.ts',
  ], { encoding: 'utf8', env: { ...process.env,
    BILLED_HEMMELIGHED: 'proeve-hemmelighed-kun-til-proever',
    NYT_BEGREB: NY, NYT_ORD: ORD } })
  process.stdout.write(ud)
  const roede = (ud.match(/^\s*✗/gm) ?? []).length
  tjek('udvidelsen gik GRØN uden at nogen rørte de afledte steder', roede === 0,
    `${roede} ✗`)
} catch (e) {
  process.stdout.write(`${e.stdout ?? ''}${e.stderr ?? ''}`)
  // En TYPEFEJL her er ikke en fejl i udledningen, den er dens modsatte
  // bevis: `FILTERORD` i lib/alarm.ts er bundet med `satisfies`, så et
  // nyt begreb UDEN mailens egen kortere ordlyd ER en oversætterfejl.
  // Det er den ene ting, en udvidelse SKAL tvinge et menneske til.
  tjek('kørslen lykkedes', false, String(e.message).split('\n')[0])
} finally {
  writeFileSync(FIL, foer)
  console.log(`\n  ${FIL} gendannet`)
}
process.exit(fejl === 0 ? 0 : 1)
