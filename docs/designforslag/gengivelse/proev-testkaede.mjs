#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Kan en fletning fjerne billedkontrollen fra npm test uden at noget
//  bliver rødt? Denne prøve siger nej.
//
//      node docs/designforslag/gengivelse/proev-testkaede.mjs              package.json
//      node docs/designforslag/gengivelse/proev-testkaede.mjs --selvproeve beviset
//
//  Designgrenen og main har hver sin "test"-linje, og de konflikterer.
//  Begge oplagte løsninger er grønne og forkerte:
//    tag main's   → billedkontrollen forsvinder af kæden;
//    tag grenens  → test:kerne, test:adaptere, test:oekonomi og test:besked
//                   forsvinder, og deres prøvefiler køres ikke.
//  Den rigtige løsning står ordret i docs/designforslag/FLETNING.md — for
//  begge udgaver af main, før og efter #49.
//
//  HÅNDSKREVET KÆDE (i dag): to krav, fulgt gennem hvert «npm run X» fra
//  "test":
//    1. proev:billedkontrol nås.
//    2. hver scripts/test-*.ts, der ligger på disken, nævnes. Det er det,
//       der fanger «tag grenens»: filerne kommer med fra main, men intet
//       kører dem.
//
//  AFLEDT KÆDE (scripts/proever.ts, #49): "test" kører opdageren, som
//  finder hver test-*.ts i repoet og kører den i den gruppe, filens
//  `// gruppe:`-mærke siger. Krav 2 er da opdagerens eget, og krav 1 bliver:
//  test-billedkontrol.ts findes og er mærket med en gruppe, der er i npm
//  test. En fil uden mærke er rød hos opdageren; en fil mærket «manuel»
//  eller «staging» kører ikke i npm test — den fanges her.
//
//  PRØVEN KØRES FRA scripts/test-redigering.ts, ikke kun fra kæden selv.
//  En prøve, der står i den linje, fletningen erstatter, forsvinder med
//  den. test-redigering.ts køres af BEGGE siders kæde, så prøven overlever
//  hvilken som helst af de to løsninger — og gør dem begge røde.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROD = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Alle scripts, "test" når gennem «npm run X» / «npm test», og deres samlede tekst. */
export function testkaeden(scripts) {
  const naaet = new Set(), tekst = []
  const foelg = (navn) => {
    if (naaet.has(navn) || scripts[navn] == null) return
    naaet.add(navn); tekst.push(scripts[navn])
    for (const m of scripts[navn].matchAll(/npm (?:run(?:-script)?|test)\b\s*([\w:.-]*)/g)) foelg(m[0].startsWith('npm test') ? 'test' : m[1])
  }
  foelg('test')
  return { naaet, tekst: tekst.join('\n') }
}

export const KONTROLFIL = 'docs/designforslag/gengivelse/test-billedkontrol.ts'
const OPDAGER = 'scripts/proever.ts'

/** De grupper, opdageren kører i npm test — læst af dens egen GRUPPER. */
export const npmTestGrupper = (proeverTs) =>
  new Set([...proeverTs.matchAll(/^\s*(\w+):\s*\{[^}]*iNpmTest:\s*true/gm)].map((m) => m[1]))

/**
 * → fejl (tom = kæden er hel). `laes(sti)` giver en fils indhold eller null;
 * den bruges kun, når kæden er afledt.
 */
export function tjekTestkaede(scripts, testfiler, laes = () => null) {
  const { naaet, tekst } = testkaeden(scripts)
  const fejl = []
  if (tekst.includes(OPDAGER)) {
    const opdager = laes(OPDAGER), fil = laes(KONTROLFIL)
    if (opdager == null) return [`"test" kører ${OPDAGER}, men filen findes ikke`]
    if (fil == null) return [`${KONTROLFIL} findes ikke — den afledte kæde har ingen billedkontrol`]
    const m = [...fil.split('\n').slice(0, 60).join('\n').matchAll(/^\s*\/\/\s*gruppe:\s*([a-z]+)(?:\/\d+)?\s*$/gm)]
    const grupper = npmTestGrupper(opdager)
    if (m.length !== 1) fejl.push(`${KONTROLFIL} har ${m.length} gruppemærker — der skal være ét`)
    else if (!grupper.has(m[0][1])) fejl.push(`${KONTROLFIL} er mærket «${m[0][1]}», som ikke kører i npm test (${[...grupper].join(', ')}) — billedkontrollen er ude af kæden`)
    return fejl
  }
  if (!naaet.has('proev:billedkontrol')) fejl.push('proev:billedkontrol står ikke i test-kæden — billedkontrollen er flettet ud')
  for (const f of testfiler) if (!tekst.includes(f)) fejl.push(`${f} køres ikke af npm test — prøvenøglen, der kørte den, er flettet ud`)
  return fejl
}

const testfilerPaaDisken = () => readdirSync(join(ROD, 'scripts')).filter((n) => /^test-.*\.ts$/.test(n)).map((n) => `scripts/${n}`).sort()

function selvproeve() {
  // Fiksturer med de to siders form, forkortet til det, prøven læser.
  const MAIN_FILER = ['scripts/test-redigering.ts', 'scripts/test-rene-filer.ts', 'scripts/test-depositum.ts', 'scripts/test-beskrivelse.ts', 'scripts/test-kontaktmur.ts']
  const mainsNoegler = {
    'test:kerne': 'tsx scripts/test-rene-filer.ts && tsx scripts/testbase.ts scripts/test-redigering.ts',
    'test:adaptere': 'tsx scripts/testbase.ts scripts/test-depositum.ts',
    'test:oekonomi': 'tsx scripts/test-beskrivelse.ts',
    'test:besked': 'tsx scripts/testbase.ts scripts/test-kontaktmur.ts',
  }
  const proev = { 'proev:billedkontrol': 'node docs/designforslag/gengivelse/proev-billedkontrol.mjs' }
  const RIGTIG = 'npm run proev:billedkontrol && npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked'
  const TILFAELDE = [
    ['den rigtige løsning', { test: RIGTIG, ...mainsNoegler, ...proev }, MAIN_FILER, null],
    ['tag main\'s linje', { test: 'npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked', ...mainsNoegler, ...proev }, MAIN_FILER, /proev:billedkontrol står ikke/],
    ['tag grenens linje', { test: 'npm run proev:billedkontrol && tsx scripts/testbase.ts scripts/test-redigering.ts && tsx scripts/test-beskrivelse.ts', ...proev }, MAIN_FILER, /test-rene-filer\.ts køres ikke/],
    ['tag grenens linje, men behold main\'s nøgler', { test: 'npm run proev:billedkontrol && tsx scripts/testbase.ts scripts/test-redigering.ts', ...mainsNoegler, ...proev }, MAIN_FILER, /test-depositum\.ts køres ikke/],
    ['billedkontrollen kaldt direkte, ikke ved navn', { test: 'node docs/designforslag/gengivelse/proev-billedkontrol.mjs && npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked', ...mainsNoegler }, MAIN_FILER, /proev:billedkontrol står ikke/],
    ['nøglen findes, men intet kalder den', { test: 'npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked', ...mainsNoegler, ...proev }, MAIN_FILER, /proev:billedkontrol står ikke/],
    ['kæden gennem et mellemliggende script', { test: 'npm run alt', alt: RIGTIG, ...mainsNoegler, ...proev }, MAIN_FILER, null],
  ]
  // Den afledte kæde (#49): "test" kører opdageren; billedkontrollen kommer
  // med gennem den mærkede fil.
  const AFLEDT = { test: 'tsx --tsconfig tsconfig.scripts.json scripts/proever.ts', ...proev }
  const OPDAGEREN = "export const GRUPPER = {\n  kerne:    { noegle: 'test:kerne',    iNpmTest: true },\n  besked:   { noegle: 'test:besked',   iNpmTest: true },\n  staging:  { noegle: 'staging:proev', iNpmTest: false },\n  manuel:   { noegle: '(ingen)',       iNpmTest: false },\n}\n"
  const filer = (maerke) => (sti) => sti === OPDAGER ? OPDAGEREN : sti === KONTROLFIL ? (maerke == null ? null : `// ═══\n${maerke}\n// tekst\n`) : null
  TILFAELDE.push(
    ['afledt kæde, kontrolfilen mærket kerne', AFLEDT, MAIN_FILER, null, filer('//  gruppe: kerne/2')],
    ['afledt kæde, kontrolfilen mangler', AFLEDT, MAIN_FILER, /findes ikke/, filer(null)],
    ['afledt kæde, kontrolfilen uden mærke', AFLEDT, MAIN_FILER, /0 gruppemærker/, filer('// intet mærke')],
    ['afledt kæde, kontrolfilen mærket manuel', AFLEDT, MAIN_FILER, /mærket «manuel», som ikke kører i npm test/, filer('//  gruppe: manuel')],
  )
  let afvig = 0
  for (const [navn, scripts, filer, forventet, laes] of TILFAELDE) {
    const f = tjekTestkaede(scripts, filer, laes)
    const ok = forventet ? f.some((x) => forventet.test(x)) : f.length === 0
    if (!ok) afvig++
    console.log(`${ok ? '✓' : '✗'} test-kæden: ${navn}: ${f.length ? 'rød' : 'grøn'} (forventet ${forventet ? 'rød' : 'grøn'})${!ok && f.length ? ' · ' + f[0] : ''}`)
  }
  return afvig
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selvproeve')) {
    const a = selvproeve()
    console.log(a ? `${a} AFVIGELSE(R)` : 'Test-kæden: alle tilfælde gav det forventede.')
    process.exit(a ? 1 : 0)
  }
  const { scripts } = JSON.parse(readFileSync(join(ROD, 'package.json'), 'utf8'))
  const laes = (sti) => { try { return readFileSync(join(ROD, sti), 'utf8') } catch { return null } }
  const fejl = tjekTestkaede(scripts, testfilerPaaDisken(), laes)
  for (const f of fejl) console.log(`RØD  ${f}`)
  if (fejl.length) { console.log('Den rigtige "test"-linje står ordret i docs/designforslag/FLETNING.md.'); process.exit(1) }
}
