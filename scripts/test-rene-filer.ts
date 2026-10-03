// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne/0
//  LØFTER OM IMPORT — og alt, hvad filerne trækker med sig.
//
//  Tyve filer har et løfte om, at de ikke rører databasen — nitten i
//  deres eget hoved, én i hovedet på det program, der måler den. Nogle
//  lover mere: ingen React, ingen next-import, ingen next/headers, eller
//  slet ingen import. Løfterne holdt før kun, fordi nogen huskede
//  at skrive `import type`, og intet i prøvesættet kunne se et brud:
//
//    · db/client.ts opretter forbindelsen DOVENT, ved første brug. En
//      import uden DATABASE_URL lykkes: forklaring.ts med `kr` fra
//      app/Boligkort importeres og kaldes uden fejl. En import-prøve
//      kan altså ikke blive rød.
//    · Prøverne af forklaring() kører under testbasen, hvor basen findes.
//    · Mine annoncer er en serverkomponent, så bygget klager heller ikke.
//
//  Derfor måles GRAFEN, ikke kørslen. esbuild bundter hver fil, og
//  metafilen siger, hvad der kom med. Bundtet bygges med TypeScripts
//  `verbatimModuleSyntax`: kun `import type` forsvinder. `import { type X }`
//  og et ubrugt `import { kr }` bliver stående som rigtige kanter — et løfte
//  må ikke hvile på, at et navn tilfældigvis ikke bruges.
//
//  ═══ VAGTEN PRØVER LØFTET — IKKE EN HUSREGEL ═══
//
//  Kravet til hver fil udledes af løftet, ordret som det står i hovedet.
//  «Ingen database, ingen React» forbyder database og React og intet
//  andet; «Den rører hverken database, cookies eller `headers()`» forbyder
//  database og next/headers, så komponenten må gerne være React. En vagt,
//  der prøvede mere end løftet, ville lave falske røde; en, der prøvede
//  mindre, falske grønne. Løftet citeres i hver linje, rød som grøn, og
//  vagten fejler, hvis citatet ikke længere står i hovedet — så kan
//  løftet og vagten ikke glide fra hinanden.
//
//  ═══ TO ALLOWLISTER, IKKE EN DENYLIST ═══
//
//  · Hver PAKKE i grafen skal være klassificeret i `PAKKER`. En ukendt
//    pakke er rød, også under et løfte, der kun nævner databasen: en ny
//    vej til basen — en ny driver, en ny klient — skal tages stilling til,
//    før den kan slippe forbi. Det er allowlisten.
//  · Hvert HOVED, der matcher `SPOR`, skal stå i `LOEFTER` eller i
//    `IKKE_LOEFTER` med en grund. Skriver nogen «ingen database» i en ny
//    fil, er vagten rød, til nogen har valgt. Det koster ingenting at
//    glemme at tilføje filen — vagten husker det.
//
//  Scanneren ser kun HOVEDET (kommentarerne før første kodelinje) i de
//  filer, `git ls-files` lister med endelserne i `ENDELSER`, og kun de
//  formuleringer, `SPOR` kender. Et løfte, der står andre steder eller med
//  andre ord, ser den ikke — og det siger den i sin linje.
//
//      koeres uden database, som scripts/test-boligtype.ts
// ═══════════════════════════════════════════════════════════════

import { build, type Metafile, type Plugin } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROD = fileURLToPath(new URL('..', import.meta.url))

type Kategori = 'database' | 'skema' | 'next' | 'next/headers' | 'react' | 'node' | 'vaerktoej'

interface Loefte {
  fil: string        // filen, hvis graf prøves
  loefte: string     // ordret fra hovedet — mellemrum og kommentartegn tæller ikke
  kilde?: string     // hvis hoved løftet står i, når det ikke er filens eget
}

/**
 * Løfterne, ordret. Udledt af filernes egne hoveder — ikke opfundet.
 *
 * Tre af løfterne står ikke i filens eget hoved, men i hovedet på det
 * program, der måler siden (`kilde`). De handler om prøvevisningerne og
 * prøves derfor dér, hvor siden bor.
 */
const LOEFTER: readonly Loefte[] = [
  { fil: 'docs/designforslag/gengivelse/proev-billedkontrol.mjs', loefte: 'Billedkontrollen i npm test — uden browser, app eller database.' },
  { fil: 'lib/koersel.ts', loefte: 'Ren logik: ingen database, ingen next-import.' },
  { fil: 'app/udlejer/boliger/forklaring.ts', loefte: 'Ren fil — ingen database, ingen React' },
  { fil: 'lib/faciliteter.ts', loefte: 'Ligger i sin EGEN fil uden databaseimport' },
  { fil: 'lib/billedloft.ts', loefte: 'Filen maa IKKE importere databasen' },
  { fil: 'lib/eloplysning.ts', loefte: 'Ligger i sin EGEN fil uden databaseimport' },
  { fil: 'lib/boligtype.ts', loefte: 'Ren tekst: ingen database, ingen next-import.' },
  { fil: 'lib/samtykke.ts', loefte: 'Filen er REN: den importerer hverken next/headers, databasen eller noget andet.' },
  { fil: 'lib/maaling.ts', loefte: 'DENNE FIL MÅ ALDRIG IMPORTERE DATABASEN.' },
  { fil: 'lib/maalingsoeg.ts', loefte: 'Ren logik: ingen database, ingen next-import.' },
  { fil: 'lib/filterpanel.ts', loefte: 'Ren logik: ingen database, ingen next-import.' },
  { fil: 'app/beskeder/kontrakt.ts', loefte: 'Ingen database, ingen next/headers, ingen React.' },
  { fil: 'app/kontakt-ui/kontrakt.ts', loefte: 'Ingen database, ingen next/headers, ingen React.' },
  { fil: 'app/Hastighed.tsx', loefte: 'Den rører hverken database, cookies eller `headers()`.' },
  { fil: 'app/beskeder/proeve/attrapport.ts', loefte: 'Ingen database, ingen konto, ingen mail, intet netværk.' },
  { fil: 'app/beskeder/proeve/page.tsx', loefte: 'Der er ingen database, ingen konto, ingen adgangskontrol og intet netværk bag' },
  { fil: 'app/beskeder/proeve/page.tsx', kilde: 'scripts/cloud/beskedkontrol.mjs',
    loefte: 'Der er ingen database, ingen konto, ingen adgangskontrol og ingen beskedlevering bag' },
  { fil: 'app/beskeder/proeve/page.tsx', kilde: 'scripts/cloud/strictmodekontrol.mjs',
    loefte: 'Der er ingen database, ingen konto, ingen adgangskontrol og ingen beskedlevering bag.' },
  { fil: 'app/beskeder/proeve/Proeve.tsx', loefte: 'uden en database, uden en konto og uden at sende noget.' },
  { fil: 'app/kontakt-ui/proeve/attrap.ts', loefte: 'Ingen database, ingen konto, ingen betaling, ingen afsendelse, intet netværk.' },
  { fil: 'app/kontakt-ui/proeve/page.tsx', kilde: 'scripts/cloud/kontaktkontrol.mjs',
    loefte: 'Der er ingen database, ingen konto, ingen betaling, ingen adgangskontrol og ingen kontakt bag' },
  { fil: 'scripts/staging/test-maal.ts', loefte: 'Der er hverken netværk, database eller Supabase indblandet' },
  { fil: 'scripts/test-boligtype.ts', loefte: 'koeres uden database' },
  { fil: 'scripts/test-rene-filer.ts', loefte: 'koeres uden database, som scripts/test-boligtype.ts' },
  { fil: 'scripts/maalinger/gengiv.ts', loefte: 'Gengiv en drizzle-forespørgsel som ren SQL-tekst — uden en database.' },
]

/** Hoveder, der nævner databasen uden at love noget om filens import. */
const IKKE_LOEFTER: Readonly<Record<string, string>> = {
  'scripts/cloud/isoleret.mjs': 'løftet handler om de tre rene vagter; aabnIsoleret i samme modul åbner udtrykkeligt en forbindelse',
  'scripts/proever.ts': 'beskriver en forkert afledning om en ANDEN prøves databasebehov, ikke sit eget importløfte',
  'scripts/test-alarmmail.ts': 'kun afsnit 1–3 er uden base; afsnit 1b kører udtrykkeligt den rigtige afsendelse under testbasen',
  'scripts/test-isolation.ts': 'afprøver vagterne uden at åbne en forbindelse; hovedet angiver udtrykkeligt postgres i importgrafen',
  'adapters/cej.ts': 'handler om, at persondata ikke når basen — ikke om filens import',
  'lib/kontaktmur.ts': 'handler om, at et nej ikke koster en forespørgsel — filen bruger basen',
  'scripts/backup.mjs': 'beskriver dumpets format',
  'scripts/home-felter.ts': 'handler om, at scriptet intet SKRIVER — ikke om hvad det importerer',
  'scripts/migrationer.mjs': 'handler om, at Vercel-bygget kan lykkes uden en base',
  'scripts/proev-genskab.mjs': 'handler om produktionsbasen — prøven bruger selv en base',
  'scripts/cloud/beskedkontrol.mjs': 'løftet handler om /beskeder/proeve og prøves dér (se LOEFTER)',
  'scripts/cloud/strictmodekontrol.mjs': 'løftet handler om /beskeder/proeve og prøves dér (se LOEFTER)',
  'scripts/cloud/kontaktkontrol.mjs': 'løftet handler om /kontakt-ui/proeve og prøves dér (se LOEFTER)',
  'modproever/hastighed-dynamisk-import.mjs': 'en mutation: beskriver det løfte, den bryder i app/Hastighed.tsx, som prøves i LOEFTER',
  'scripts/cloud/rooms-repraesentant.ts': 'filen bruger basen og skriver; den nævner DATABASE_URL om sin spærring',
  'scripts/kildetjek.ts': 'beskriver, hvad prøverne søger efter i ANDRE filer — ikke filens egen import',
}

/**
 * Hoveder, der LOVER ingen database, og hvis graf alligevel når den.
 *
 * Ikke det samme som IKKE_LOEFTER. Dér står hoveder, der ikke lover noget
 * om importen; her står løfter, der ikke holder. Løftet gælder kørslen —
 * ingen forbindelse åbnes, for db/client forbinder først ved første
 * forespørgsel — men grafen når db/client og postgres. Det er fælden
 * `import-prøven` i CLAUDE.md. Lagt i LOEFTER bliver de røde med stien
 * skrevet ud.
 *
 * Hver post har en FRIST, og typen kræver den. En undtagelse uden dato
 * bliver et arkiv: den står der stadig om et år, og ingen husker hvorfor.
 * Efter fristen er listen rød, til nogen har rettet hovedet, så det
 * siger det, der holder, eller flyttet importen, så løftet holder. Så
 * fjernes posten. Forny ikke fristen uden en ny grund.
 */
const BRUDTE_LOEFTER: Readonly<Record<string, { grund: string; frist: string }>> = {
  'scripts/cloud/rooms-adressevagt.ts': {
    grund: '«Ingen database, ingen socket» gælder kørslen; grafen når db/client gennem rooms-repraesentant.ts',
    frist: '2026-12-31',
  },
  'scripts/maalinger/skriv-maal-sql.ts': {
    grund: '«rører ingen database» gælder kørslen; grafen når db/client gennem lib/omraade og lib/soeg',
    frist: '2026-12-31',
  },
}

/** Ordene i et løfte, vagten kan prøve, og hvad de forbyder. */
const LOEFTEORD: readonly [RegExp, Kategori | 'alt'][] = [
  [/databas/i, 'database'],
  [/supabase/i, 'database'],
  [/next\/headers|`headers\(\)`|\bcookies\b/i, 'next/headers'],
  [/next-import/i, 'next'],
  [/\breact\b/i, 'react'],
  [/noget andet/i, 'alt'],
]

/**
 * Hvad hver pakke ER. Allowlisten: en pakke, der ikke står her, er rød.
 * En pakke kan høre til flere kategorier — next/headers er også next.
 */
const PAKKER: readonly [RegExp, readonly Kategori[]][] = [
  [/^(postgres|pg|@electric-sql\/pglite|@supabase\/.+)$/, ['database']],
  [/^drizzle-orm\/(postgres-js|pglite|node-postgres)$/, ['database']],
  [/^drizzle-orm(\/pg-core)?$/, ['skema']],
  [/^next\/headers$/, ['next/headers', 'next']],
  [/^next(\/.+)?$/, ['next']],
  [/^react(-dom)?(\/.+)?$/, ['react']],
  [/^node:.+$/, ['node']],
  [/^esbuild$/, ['vaerktoej']],
]

/** Filer i grafen, der selv ER en kategori. Andre filer følges blot. */
const FILER: Readonly<Record<string, readonly Kategori[]>> = {
  'db/client.ts': ['database'],
  'db/schema.ts': ['skema'],
}

/** Formuleringer, der sporer et løfte om ingen database i et hoved. */
const SPOR = /(ingen|uden|hverken|ikke|aldrig)\b[^.]{0,60}?databas|databas\w*import|\bren (fil|logik|tekst)\b|filen er ren/i
const ENDELSER = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

/** Hovedet: kommentarerne før første kodelinje, uden kommentartegn. */
export function hoved(tekst: string): string {
  const ud: string[] = []
  let blok = false
  for (const linje of tekst.split('\n')) {
    const s = linje.trim()
    if (blok) { ud.push(s); if (s.includes('*/')) blok = false; continue }
    if (s === '' || /^['"]use (client|server)['"];?$/.test(s) || s.startsWith('#!')) continue
    if (s.startsWith('//')) { ud.push(s); continue }
    if (s.startsWith('/*')) { ud.push(s); blok = !s.slice(2).includes('*/'); continue }
    break
  }
  return ud.map((x) => x.replace(/^(\/\/+|\/\*+|\*+\/?)\s?/, '').trim()).join(' ').replace(/\s+/g, ' ')
}

export function forbudte(loefte: string): Set<Kategori | 'alt'> {
  return new Set(LOEFTEORD.filter(([r]) => r.test(loefte)).map(([, k]) => k))
}

export function kategorierFor(pakke: string): readonly Kategori[] | null {
  return PAKKER.find(([r]) => r.test(pakke))?.[1] ?? null
}

// Alt, der ikke er en relativ sti eller vores eget `@/`-alias, er en
// pakke eller et indbygget modul. Det bundtes ikke — det ses kun, som en
// kant i metafilen. (esbuilds filter er RE2 og kender ikke lookahead,
// derfor afgøres det i funktionen.)
const pakkerSesKun: Plugin = {
  name: 'pakker-ses-kun',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === 'entry-point') return undefined
      if (a.path.startsWith('.') || a.path.startsWith('/') || a.path.startsWith('@/')) return undefined
      return { path: a.path, external: true }
    })
  },
}

// tsconfig.json's egne indstillinger (`@/*`-stierne), plus
// verbatimModuleSyntax. Læst fra filen, så stierne ikke står to steder.
const TSCONFIG = JSON.parse(readFileSync(join(ROD, 'tsconfig.json'), 'utf8')) as { compilerOptions: object }

export async function graf(fil: string): Promise<Metafile> {
  const r = await build({
    absWorkingDir: ROD,
    entryPoints: [fil],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    tsconfigRaw: { compilerOptions: { baseUrl: '.', ...TSCONFIG.compilerOptions, verbatimModuleSyntax: true } } as never,
    jsx: 'automatic',                       // som Next: JSX trækker react/jsx-runtime ind
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [pakkerSesKun],
  })
  return r.metafile
}

interface Fund {
  hvad: string                       // pakken eller filen
  kategorier: readonly Kategori[] | null   // null: ukendt pakke
  kaede: string                      // korteste importkæde fra roden
}

/** Hver pakke og hver kategoriseret fil i grafen, med sin kæde. */
export function fund(m: Metafile, fra: string): { fund: Fund[]; filer: string[] } {
  const forrige = new Map<string, string | null>([[fra, null]])
  const pakkeFra = new Map<string, string>()
  const koe = [fra]
  while (koe.length) {
    const f = koe.shift()!
    for (const i of m.inputs[f]?.imports ?? []) {
      if (i.external) { if (!pakkeFra.has(i.path)) pakkeFra.set(i.path, f); continue }
      if (!forrige.has(i.path)) { forrige.set(i.path, f); koe.push(i.path) }
    }
  }
  const kaede = (x: string): string => {
    const led = [x]
    let f: string | null | undefined = pakkeFra.has(x) ? pakkeFra.get(x) : forrige.get(x)
    while (f) { led.push(f); f = forrige.get(f) }
    return led.join(' ← ')
  }
  const ud: Fund[] = []
  for (const p of pakkeFra.keys()) ud.push({ hvad: p, kategorier: kategorierFor(p), kaede: kaede(p) })
  for (const f of forrige.keys()) if (FILER[f]) ud.push({ hvad: f, kategorier: FILER[f]!, kaede: kaede(f) })
  return { fund: ud, filer: [...forrige.keys()].filter((f) => f !== fra) }
}

function filerIRepoet(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROD, encoding: 'utf8' })
    .split('\n').filter((f) => ENDELSER.test(f))
}

const start = performance.now()
console.log('\n══ løfter om import: hver fil prøves på sit eget løfte ══\n')

// ── 0 · MODPRØVER PÅ DEN RIGTIGE MEKANIK ─────────────────────
// Samme `graf`, `fund`, `forbudte` og `hoved` som nedenfor. Ser de ikke
// det, de skal, er hvert grønt flueben grønt af den forkerte grund.
{
  const soeg = fund(await graf('lib/soeg.ts'), 'lib/soeg.ts')
  tjek('modprøve: lib/soeg.ts når basen, og mekanikken ser det',
    soeg.fund.some((x) => x.hvad === 'db/client.ts') && soeg.fund.some((x) => x.hvad === 'postgres'),
    `${soeg.filer.length} filer, pakker: ${soeg.fund.filter((x) => !FILER[x.hvad]).map((x) => x.hvad).join(', ')}`)
  const f = forbudte('Ingen database, ingen next/headers, ingen React.')
  tjek('modprøve: løftet udleder sine egne forbud og ikke flere',
    f.size === 3 && f.has('database') && f.has('next/headers') && f.has('react'), [...f].join(', '))
  tjek('modprøve: et citat, der ikke står i hovedet, findes ikke',
    !hoved(readFileSync(join(ROD, 'lib/maaling.ts'), 'utf8')).includes('Denne fil må gerne importere databasen.'))
  tjek('modprøve: en ukendt pakke er ikke klassificeret', kategorierFor('et-nyt-drev') === null)
}

// ── 1 · HVER FIL HOLDER SIT LØFTE ────────────────────────────
console.log('')
for (const l of LOEFTER) {
  const kilde = l.kilde ?? l.fil
  const navn = l.kilde ? `${l.fil} (lovet i ${l.kilde})` : l.fil
  if (!existsSync(join(ROD, l.fil)) || !existsSync(join(ROD, kilde))) {
    tjek(navn, false, 'filen findes ikke — flyttet? ret LOEFTER'); continue
  }
  const citat = l.loefte.replace(/\s+/g, ' ')
  if (!hoved(readFileSync(join(ROD, kilde), 'utf8')).includes(citat)) {
    tjek(navn, false, `løftet står ikke længere i hovedet af ${kilde}: «${citat}» — ret LOEFTER, eller vagten prøver et løfte, ingen giver`)
    continue
  }
  const forbud = forbudte(citat)
  if (forbud.size === 0) { tjek(navn, false, `løftet nævner intet, vagten kan prøve: «${citat}»`); continue }

  let m: Metafile
  try { m = await graf(l.fil) } catch (e) {
    tjek(navn, false, `kunne ikke bundtes: ${(e as Error).message.split('\n')[0]}`); continue
  }
  const g = fund(m, l.fil)
  const ukendte = g.fund.filter((x) => x.kategorier === null)
  const brud = g.fund.filter((x) => x.kategorier?.some((k) => forbud.has(k)))
  const alt = forbud.has('alt') ? [...g.filer, ...g.fund.filter((x) => !FILER[x.hvad]).map((x) => x.hvad)] : []
  const ok = ukendte.length === 0 && brud.length === 0 && alt.length === 0
  const proevet = [...forbud].map((k) => (k === 'alt' ? 'al import' : k)).join(', ')
  tjek(navn, ok, `prøvet: ${proevet} · «${citat}»`)
  if (ok) continue
  for (const x of brud) console.log(`      brudt   ${x.hvad} er ${x.kategorier!.join('/')}: ${x.kaede}`)
  for (const x of ukendte) console.log(`      ukendt  pakken ${x.hvad} er ikke klassificeret i PAKKER: ${x.kaede}`)
  if (alt.length) console.log(`      import  løftet siger «noget andet», og filen importerer: ${alt.join(', ')}`)
  console.log('      (står importen kun for typer, så skriv `import type` — den forsvinder helt)')
}

// ── 2 · HVERT LØFTE I ET HOVED ER TAGET STILLING TIL ─────────
console.log('')
{
  const kendte = new Set([
    ...LOEFTER.map((l) => l.kilde ?? l.fil), ...Object.keys(IKKE_LOEFTER), ...Object.keys(BRUDTE_LOEFTER),
  ])
  const filer = filerIRepoet()
  const spor = filer.filter((f) => SPOR.test(hoved(readFileSync(join(ROD, f), 'utf8'))))
  const nye = spor.filter((f) => !kendte.has(f))
  tjek(`hvert hoved, der lover ingen database, står i LOEFTER, IKKE_LOEFTER eller BRUDTE_LOEFTER`, nye.length === 0,
    `${spor.length} af ${filer.length} hoveder sporet (git ls-files, ${ENDELSER.source})`)
  for (const f of nye) {
    const h = hoved(readFileSync(join(ROD, f), 'utf8'))
    const i = h.search(SPOR)
    console.log(`      nyt     ${f}: «…${h.slice(Math.max(0, i - 30), i + 70)}…» — før den i LOEFTER med citatet, eller i IKKE_LOEFTER med en grund`)
  }
  const undtagelser = [...Object.keys(IKKE_LOEFTER), ...Object.keys(BRUDTE_LOEFTER)]
  const forsvundne = undtagelser.filter((f) => !spor.includes(f))
  tjek('hver undtagelse står stadig i et sporet hoved', forsvundne.length === 0,
    forsvundne.length ? `fjern: ${forsvundne.join(', ')}` : `${undtagelser.length} undtagelser`)

  // ── Fristerne. En dato, der ikke er en dato, må ikke tavst aldrig udløbe:
  // «2026-13-45» sammenlignet som tekst ville stå «i fremtiden» for altid.
  const iDag = new Date().toISOString().slice(0, 10)
  for (const [f, { frist }] of Object.entries(BRUDTE_LOEFTER)) {
    const d = new Date(`${frist}T00:00:00Z`)
    const gyldig = /^\d{4}-\d{2}-\d{2}$/.test(frist) && !Number.isNaN(d.getTime())
      && d.toISOString().slice(0, 10) === frist
    const dage = gyldig ? Math.round((d.getTime() - Date.parse(`${iDag}T00:00:00Z`)) / 86400000) : NaN
    tjek(`${f}: brudt løfte, efterset inden ${frist}`, gyldig && iDag <= frist,
      !gyldig ? `«${frist}» er ikke en dato`
        : iDag > frist ? `fristen udløb for ${-dage} dage siden — ret hovedet eller importen, og fjern posten`
          : `${dage} dage tilbage`)
  }
}

console.log(`\n  (${Math.round(performance.now() - start)} ms)`)
console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
