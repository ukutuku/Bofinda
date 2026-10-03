// ═══════════════════════════════════════════════════════════════
//  OPDAGEREN — prøvekæden udledt af filerne selv.
//
//      npm test                alle automatiske grupper
//      npm run test:kerne      én gruppe
//      tsx scripts/proever.ts --vis        hvad den ville køre
//      tsx scripts/proever.ts --modproev   beviser afvisningsreglen
//
//  Hver prøvefil siger selv, hvilken gruppe den hører til, i sit eget
//  hoved: `// gruppe: kerne`. Kæden står dermed ikke længere som fire
//  lange linjer i package.json, som enhver ny prøve skal rette — netop
//  den linje har konflikteret i ni PR'er.
//
//  ═══ HVORFOR AFVISNINGSREGLEN IKKE ER VALGFRI ═══
//
//  **En blind afledning er værre end en håndskrevet linje: linjen er
//  synlig i en diff.**
//
//  Det er hele begrundelsen. Påkaldelsesformen udledes herunder af
//  importgrafen — «skal den have testbasen?» er «når den db/client?» —
//  og den afledning er sund for statiske og literal-dynamiske importer.
//  Men den er BLIND for en dynamisk import, hvis specifikator er en
//  variabel. Målt med esbuild 0.19.12:
//
//    import { db } from '../db/client'     kind=import-statement   SES
//    await import('../db/client')          kind=dynamic-import     SES
//    await import(`../db/client`)          kind=dynamic-import     SES
//    require('../db/client')               kind=require-call       SES
//    await import(sti)                     ingen kant              TABES
//    await import(`../${navn}`)            bygget fejler (glob)    5102 fejl
//
//  Den femte er den farlige: grafen bliver 1 fil, og en afledning oven
//  på den ville sige «ingen base nødvendig» om en prøve, der henter
//  databasen. Ingenting ville melde fejl. Derfor AFVISER opdageren den
//  formen — rødt, ikke en advarsel — og navngiver fil og linje.
//
//  Den sjette er ikke tavs, men den er ulæselig: esbuild glob-udvider
//  `../${navn}` og forsøger at bundte hele træet (målt: 756 filer,
//  heriblandt .git/COMMIT_EDITMSG). Opdageren fanger den og siger HVAD
//  den er i stedet for at lade fejlene stå som svaret.
//
//  Scanningen bruger TypeScripts AST, ikke et regex: et regex over
//  `import(` kan ikke skelne kode fra en streng eller en kommentar.
//  Den dækker BÅDE prøvefilen og hver fil i dens graf — er en
//  afhængighed blind, er afledningen for prøven det også.
//
//  ═══ OG GULVET: EN UDLEDT KÆDE KAN SKRUMPE LYDLØST ═══
//
//  En kæde, der er udledt af filerne, måler præcis de filer, der er —
//  og siger intet, når der bliver færre. `GULV` nedenfor er det målte
//  sæt, kæden SKAL finde, så 13 → 12 er rødt og ikke tavst, og så
//  afvisningen NAVNGIVER den, der forsvandt. Et antal, der er faldet,
//  sender den næste på jagt; et navn gør ikke.
// ═══════════════════════════════════════════════════════════════

import { build, type Metafile } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROD = fileURLToPath(new URL('..', import.meta.url))

/**
 * Grupperne. En gruppe, intet nævner, er en fejl; en fil uden gruppe er
 * også en fejl. Begge veje, så en udeladelse er et MÆRKE og aldrig et
 * fravær — allowlistens form, hvor det er gratis at glemme.
 */
export const GRUPPER = {
  kerne:    { noegle: 'test:kerne',    iNpmTest: true },
  adaptere: { noegle: 'test:adaptere', iNpmTest: true },
  oekonomi: { noegle: 'test:oekonomi', iNpmTest: true },
  besked:   { noegle: 'test:besked',   iNpmTest: true },
  konto:    { noegle: 'test:konto',    iNpmTest: true },
  staging:  { noegle: 'staging:proev', iNpmTest: false },
  manuel:   { noegle: '(ingen)',       iNpmTest: false },
} as const
export type Gruppe = keyof typeof GRUPPER

const SPRING_OVER = new Set(['node_modules', '.git', '.next', 'backup', 'dist'])

/**
 * GULVET — de prøvefiler, kæden SKAL finde.
 *
 * **Hvorfor den findes:** `filer.length === 0` fanger, at opdageren ikke
 * måler NOGET, og gruppeløkken i `laegPlan` fanger en navngiven gruppe,
 * der løber tom. Ingen af dem fanger 13 → 12. Det er
 * `nullet-der-betyder-to-ting` i kædens egen form — et tal, der ikke kan
 * sige, at det holdt op med at måle. En prøve, der omdøbes, flyttes uden
 * for roden eller mister sin endelse, forsvinder lydløst, og opdageren
 * ville være grøn hele vejen.
 *
 * **Formen er en LISTE og ikke et tal**, af to grunde:
 *
 * · Den kan navngive HVILKE filer der er væk. Et tal, der er faldet,
 *   sender den næste på jagt.
 * · Den er additivt gratis. En ny prøve øger det målte antal over gulvet
 *   og kræver INGEN redigering her — ellers var gulvet blevet den delte
 *   linje, som denne PR fjerner. Kun en FJERNELSE eller en OMDØBNING
 *   koster en bevidst rettelse, og det er præcis den handling, der SKAL
 *   koste noget.
 *
 * Gruppen står med, fordi den vogter en ting mere: en fil, der beholder
 * sit navn, men flytter sit mærke til en gruppe uden for `npm test`,
 * falder også ud af kæden — og tælles stadig i totalen. Gruppen her er
 * den, filen blev MÅLT i, ikke en påstand om, hvor den står i dag: et
 * skifte mellem to grupper, der begge er i `npm test`, er i orden.
 *
 * **Målt 2. oktober 2026 på `277f01d`: 13 filer.** Listen er ikke
 * skrevet af i hånden — den er genereret af `findProever()` og
 * `laesMaerke()` på den commit. Hæves gulvet, skal tallet, datoen og
 * commit'en følge med, så det kan læses som en måling og ikke et gæt.
 */
export const GULV = {
  maalt: '2. oktober 2026',
  commit: '277f01d',
  pr: {
    kerne: [
      'scripts/test-boligtype.ts',
      'scripts/test-indflytning.ts',
      'scripts/test-kildetjek.ts',
      'scripts/test-maaling.ts',
      'scripts/test-redigering.ts',
      'scripts/test-rene-filer.ts',
      'scripts/test-soegning.ts',
    ],
    adaptere: [
      'scripts/test-depositum.ts',
    ],
    oekonomi: [
      'scripts/test-beskrivelse-ved-visning.ts',
      'scripts/test-beskrivelse.ts',
      'scripts/test-genskriv.ts',
    ],
    besked: [
      'scripts/test-kontaktmur.ts',
    ],
    staging: [
      'scripts/staging/test-maal.ts',
    ],
  },
} as const satisfies { maalt: string; commit: string; pr: Partial<Record<Gruppe, readonly string[]>> }

/** Gulvets poster, flade: `{ fil, gruppe }`. Gruppen er den MÅLTE. */
export const gulvposter = (): { fil: string; gruppe: Gruppe }[] =>
  Object.entries(GULV.pr).flatMap(([g, l]) => l.map((fil) => ({ fil, gruppe: g as Gruppe })))


/**
 * Hver `test-*.ts` og `test-*.mjs` under roden. Fra ROTEN, så ingen mappe
 * kan skjule en.
 *
 * **Endelsen dækker `.mjs`, og det er et valg med en begrundelse.**
 * `scripts/test-isolation.mjs` (#52) har det rigtige præfiks og en anden
 * endelse — og den står i `test:kerne` i dag. Så en `.ts`-only opdager
 * ville FJERNE en vagt, der gater lige nu, i samme øjeblik denne PR
 * landede. Det er netop den lydløse afgang, opdageren findes for.
 *
 * Alternativet var at kræve en omdøbning. Målt, før valget blev truffet:
 * tre `test-*.mjs` findes på otte grene — `test-isolation.mjs` (187
 * linjer, kører under almindelig `node`, rører ingen base) og to
 * browserdrevne på 711 og 664 linjer, `test-favoritforloeb-e2e.mjs` og
 * `test-gendannelse-actions.mjs`, som ikke står i nogen npm-nøgle i dag.
 * En omdøbning er billig for den første og dyr for de to andre, som så
 * skulle gennem `tsconfig.scripts.json` og tsx uden at nogen havde bedt
 * om det. Og en fil bør ikke omdøbes, fordi en kæde ikke kan se den.
 *
 * De to e2e-filer er ALLEREDE tavse. Med `.mjs` dækket bliver tavsheden
 * en rød linje, der siger «sæt et mærke» — afvisningsreglen, der virker.
 * Målt på denne gren koster udvidelsen 0 filer: der er ingen
 * `test-*.mjs` her endnu.
 *
 * **`proev-*` dækkes IKKE**, og det er også målt: `scripts/` på main har
 * 13 `test-*` mod 2 `proev-*`, og ingen af de to er prøvekædefiler.
 * `scripts/maalinger/proev-maal-sql.ts` er død — absolut sti til en anden
 * sessions scratchpad, i ingen npm-nøgle — og `scripts/proev-genskab.mjs`
 * er genskabelsesprøven for `db:backup`. En udvidelse til `proev-*` ville
 * trække den døde fil ind i `npm test` og fejle på en sti, der ikke
 * findes. `test-*` ER konventionen, 13 mod 2.
 */
export function findProever(rod = ROD): string[] {
  const ud: string[] = []
  const gaa = (m: string) => {
    for (const n of readdirSync(m)) {
      if (SPRING_OVER.has(n)) continue
      const p = join(m, n)
      if (statSync(p).isDirectory()) gaa(p)
      else if (/^test-.*\.(ts|mjs)$/.test(n)) ud.push(relative(rod, p))
    }
  }
  gaa(rod)
  return ud.sort()
}

export interface Maerke { gruppe: Gruppe; orden: number }

/** `// gruppe: kerne` eller `// gruppe: kerne/0`. Kun i de første 60 linjer. */
export function laesMaerke(kilde: string): { ok: true; m: Maerke } | { ok: false; grund: string } {
  const hoved = kilde.split('\n').slice(0, 60)
  const traef = hoved
    .map((l) => /^\s*\/\/\s*gruppe:\s*([a-z]+)(?:\/(\d+))?\s*$/.exec(l))
    .filter((x): x is RegExpExecArray => x !== null)
  if (traef.length === 0) return { ok: false, grund: 'intet `// gruppe:`-maerke i de foerste 60 linjer' }
  if (traef.length > 1) return { ok: false, grund: `${traef.length} gruppemaerker — der maa vaere ét` }
  const navn = traef[0]![1]!
  if (!(navn in GRUPPER)) {
    return { ok: false, grund: `ukendt gruppe «${navn}» — kendte: ${Object.keys(GRUPPER).join(', ')}` }
  }
  return { ok: true, m: { gruppe: navn as Gruppe, orden: traef[0]![2] ? Number(traef[0]![2]) : 50 } }
}

export interface BlindImport { fil: string; linje: number; form: string; tekst: string }

/**
 * Dynamiske importer og `require`, hvis specifikator IKKE er en literal.
 *
 * En `StringLiteral` og en skabelon UDEN substitution er begge målt som
 * fulgt af esbuild og er derfor i orden. Alt andet afvises:
 * en skabelon MED substitution glob-udvider, og enhver anden form
 * (variabel, sammensætning, kald) tabes tavst.
 */
export function blindeImporter(fil: string, kilde: string): BlindImport[] {
  const sf = ts.createSourceFile(fil, kilde, ts.ScriptTarget.ESNext, true)
  const ud: BlindImport[] = []
  const linje = (p: number) => sf.getLineAndCharacterOfPosition(p).line + 1
  const gaa = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const erImport = n.expression.kind === ts.SyntaxKind.ImportKeyword
      const erRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require'
      if ((erImport || erRequire) && n.arguments.length > 0) {
        const a = n.arguments[0]!
        const literal = ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)
        if (!literal) {
          ud.push({
            fil, linje: linje(a.getStart(sf)),
            form: ts.isTemplateExpression(a)
              ? 'skabelon med substitution — esbuild glob-udvider den'
              : 'ikke en literal — kanten findes ikke i grafen',
            tekst: a.getText(sf).replace(/\s+/g, ' ').slice(0, 60),
          })
        }
      }
    }
    ts.forEachChild(n, gaa)
  }
  gaa(sf)
  return ud
}

export interface Form { testbase: boolean; billedhemmelighed: boolean }

/** Grafen for én fil. Kaster med en LÆSELIG besked ved glob-eksplosion. */
export async function graf(fil: string): Promise<Metafile> {
  try {
    const r = await build({
      absWorkingDir: ROD, entryPoints: [fil],
      bundle: true, write: false, metafile: true,
      platform: 'node', format: 'esm',
      tsconfig: join(ROD, 'tsconfig.json'), jsx: 'automatic',
      logLevel: 'silent',
      // Next er runtime-rammen, ikke projektets importgraf. Dets valgfrie
      // tracing-peer findes ikke i alle npm ci-installationer. Repoets egne
      // imports foelges stadig, herunder server actions og db/client.
      external: ['pg-native', 'esbuild', 'typescript', 'next', 'next/*'],
    })
    return r.metafile
  } catch (e) {
    const fejl = (e as { errors?: { location?: { file?: string } }[] }).errors ?? []
    const filer = new Set(fejl.map((x) => x.location?.file).filter(Boolean))
    if (fejl.length > 50) {
      throw new Error(
        `${fil}: grafen kunne ikke regnes — ${fejl.length} fejl over ${filer.size} filer.\n`
        + '      Det er glob-eksplosionen: en fil i grafen har en dynamisk import med en\n'
        + '      skabelon-specifikator (`import(`../${x}`)`), og esbuild forsoeger at bundte\n'
        + '      hele traeet. Find den med scanningen ovenfor — den er ikke en syntaksfejl.')
    }
    throw new Error(`${fil}: grafen kunne ikke regnes — ${fejl.length} fejl`)
  }
}

/** Påkaldelsesformen, UDLEDT. Ikke erklæret — grafen er grunden selv. */
export function formFraGraf(m: Metafile): Form {
  const stier = Object.keys(m.inputs)
  return {
    testbase: stier.some((s) => /(^|\/)db\/client\.ts$/.test(s)),
    billedhemmelighed: stier.some((s) => /(^|\/)lib\/billede\.ts$/.test(s)),
  }
}

export function kommando(fil: string, f: Form): { kmd: string[]; miljoe: Record<string, string> } {
  const kmd = ['tsx', '--tsconfig', 'tsconfig.scripts.json']
  if (f.testbase) kmd.push('scripts/testbase.ts')
  kmd.push(fil)
  return { kmd, miljoe: f.billedhemmelighed ? { BILLED_HEMMELIGHED: 'proeve-hemmelighed-kun-til-proever' } : {} }
}

export interface Post { fil: string; maerke: Maerke; form: Form }
export interface Plan { poster: Post[]; afvist: string[] }

/** Hele planen — eller afvisningerne. Afviser den, køres INTET. */
export async function laegPlan(rod = ROD): Promise<Plan> {
  const filer = findProever(rod)
  const afvist: string[] = []
  const poster: Post[] = []
  if (filer.length === 0) afvist.push('fandt NUL test-*.ts/.mjs — opdageren maaler ikke noget')

  // GULVET. Et antal, der er FALDET, kan ikke sige det selv — se GULV.
  // Der er bevidst ikke et separat «antal under gulvet»-tjek: falder
  // antallet under gulvets, mangler mindst én af gulvets filer, saa
  // navnetjekket er strengere og kan ogsaa fange en OMDOEBNING, hvor
  // antallet staar stille. Et flueben, der ikke kan blive roedt alene,
  // er ingen proeve.
  const fundet = new Set(filer)
  const forsvundet = gulvposter().filter((x) => !fundet.has(x.fil))
  if (forsvundet.length) {
    afvist.push(
      `gulvet: ${filer.length} proevefiler fundet, ${gulvposter().length} maalt ${GULV.maalt} (${GULV.commit}) — `
      + `${forsvundet.length} er VAEK: ${forsvundet.map((x) => `${x.fil} (maalt i ${x.gruppe})`).join(', ')}.\n`
      + '      Er fjernelsen med vilje, skal GULV i scripts/proever.ts rettes i SAMME aendring.')
  }

  for (const fil of filer) {
    const kilde = readFileSync(join(rod, fil), 'utf8')
    const m = laesMaerke(kilde)
    if (!m.ok) { afvist.push(`${fil}: ${m.grund}`); continue }

    // Manuel betyder ingen automatisk paakaldelse eller udledt importgraf.
    // Gulvet ovenfor forhindrer stadig, at en kraevet proeve flyttes hertil.
    if (m.m.gruppe === 'manuel') { poster.push({ fil, maerke: m.m, form: { testbase: false, billedhemmelighed: false } }); continue }

    // Scanningen FOER grafen: den er praecis, og den goer glob-eksplosionen
    // uopnaaelig for den fil, vi selv har i haanden.
    const blind = blindeImporter(fil, kilde)
    if (blind.length) {
      for (const b of blind) afvist.push(`${fil}:${b.linje}: \`${b.tekst}\` — ${b.form}`)
      continue
    }

    let g: Metafile
    try { g = await graf(fil) } catch (e) { afvist.push(String((e as Error).message)); continue }

    // Og hver fil i grafen: er en afhaengighed blind, er afledningen
    // for prøven det ogsaa.
    for (const dep of Object.keys(g.inputs)) {
      if (dep === fil || dep.includes('node_modules')) continue
      let k: string
      try { k = readFileSync(join(rod, dep), 'utf8') } catch { continue }
      for (const b of blindeImporter(dep, k)) {
        afvist.push(`${fil} → ${dep}:${b.linje}: \`${b.tekst}\` — ${b.form}`)
      }
    }
    poster.push({ fil, maerke: m.m, form: formFraGraf(g) })
  }

  // Og den anden vej ud af kaeden: samme filnavn, nyt maerke. Den
  // taelles stadig i totalen, saa gulvets antal ser uaendret ud.
  for (const x of gulvposter()) {
    const p = poster.find((q) => q.fil === x.fil)
    if (!p || p.maerke.gruppe === x.gruppe) continue
    if (GRUPPER[x.gruppe].iNpmTest && !GRUPPER[p.maerke.gruppe].iNpmTest) {
      afvist.push(
        `gulvet: ${x.fil} er flyttet fra «${x.gruppe}» til «${p.maerke.gruppe}», som IKKE er i npm test — `
        + 'daekning, der forlader kaeden uden at antallet falder. Er det med vilje, retter du GULV i samme aendring.')
    }
  }

  for (const [navn, g] of Object.entries(GRUPPER)) {
    if (!g.iNpmTest) continue
    if (!poster.some((p) => p.maerke.gruppe === navn)) {
      afvist.push(`gruppen «${navn}» har nul filer — en navngivet gruppe uden proever er en fejl`)
    }
  }
  return { poster, afvist }
}

export const iOrden = (p: Post[], gruppe: Gruppe): Post[] =>
  p.filter((x) => x.maerke.gruppe === gruppe)
    .sort((a, b) => a.maerke.orden - b.maerke.orden || a.fil.localeCompare(b.fil))

// ═══════════════════════════════════════════════════════════════
//  Kørsel
// ═══════════════════════════════════════════════════════════════

const ud = (s = '') => process.stdout.write(`${s}\n`)
const fejlUd = (s: string) => process.stderr.write(`${s}\n`)

function visAfvisning(a: string[]): void {
  fejlUd('')
  fejlUd('  ══════════════════════════════════════════════════════════')
  fejlUd(`   AFVIST — ${a.length} ${a.length === 1 ? 'grund' : 'grunde'}. INTET er koert.`)
  fejlUd('  ══════════════════════════════════════════════════════════')
  for (const x of a) fejlUd(`    · ${x}`)
  fejlUd('')
  fejlUd('  En prøvefil uden gruppemaerke er daekning, der lydloest ikke')
  fejlUd('  findes. En blind import gør afledningen af paakaldelsesformen')
  fejlUd('  usand. Og en kaede, der er udledt af filerne, skrumper lydloest:')
  fejlUd('  derfor gulvet. Alle tre er roede med vilje — se hovedet i')
  fejlUd('  scripts/proever.ts.')
  fejlUd('')
}

async function koerGruppe(g: Gruppe, poster: Post[]): Promise<number> {
  const liste = iOrden(poster, g)
  ud(`\n══ ${g} · ${liste.length} ${liste.length === 1 ? 'prøve' : 'prøver'} ══`)
  for (const p of liste) {
    const { kmd, miljoe } = kommando(p.fil, p.form)
    const r = spawnSync('npx', kmd, {
      cwd: ROD, stdio: 'inherit',
      env: { ...process.env, ...miljoe },
    })
    if (r.status !== 0) {
      fejlUd(`\n  ✗ ${p.fil} — exit ${r.status}. Kæden stopper her, som \`&&\` gjorde.`)
      return r.status ?? 1
    }
  }
  return 0
}

if (process.argv[1]?.endsWith('proever.ts')) {
  const flag = process.argv[2]

  if (flag === '--modproev') {
    // Spawnes som et barn og importeres IKKE: en cirkulaer dynamisk
    // import herfra laaser, fordi denne blok selv er et top-level
    // await. Maalt: «unsettled top-level await», exit 13.
    const r = spawnSync('npx', ['tsx', '--tsconfig', 'tsconfig.scripts.json',
      'scripts/proever-modproev.ts'], { cwd: ROD, stdio: 'inherit' })
    process.exitCode = r.status ?? 1
  } else {
    const plan = await laegPlan()
    if (plan.afvist.length) {
      visAfvisning(plan.afvist)
      process.exitCode = 1
    } else if (flag === '--vis') {
      ud(`  ${plan.poster.length} prøvefiler, alle med maerke\n`)
      for (const [navn, g] of Object.entries(GRUPPER)) {
        const l = iOrden(plan.poster, navn as Gruppe)
        if (!l.length) { ud(`  ${navn.padEnd(9)} (ingen)`); continue }
        ud(`  ${navn.padEnd(9)} ${g.iNpmTest ? 'i npm test' : `kun ${g.noegle}`}`)
        for (const p of l) {
          const { kmd, miljoe } = kommando(p.fil, p.form)
          const m = Object.keys(miljoe).length ? 'BILLED_HEMMELIGHED=… ' : ''
          ud(`    ${String(p.maerke.orden).padStart(3)}  ${m}npx ${kmd.join(' ')}`)
        }
      }
    } else {
      const kun = flag && flag in GRUPPER ? [flag as Gruppe] : null
      const grupper = kun ?? (Object.entries(GRUPPER)
        .filter(([, g]) => g.iNpmTest).map(([n]) => n) as Gruppe[])
      let kode = 0
      let koert = 0
      for (const g of grupper) {
        koert += iOrden(plan.poster, g).length
        kode = await koerGruppe(g, plan.poster)
        if (kode !== 0) break
      }
      // Linjen navngiver sig selv. Stod der bare «ALT GRØNT», var den
      // ikke til at skelne fra den sidste prøves egen slutlinje — og en
      // logline, der ikke svarer til hvem der siger den, er værre end
      // ingen. Tallene siger desuden HVAD der blev dækket: en kæde, der
      // stille kørte færre prøver, ville ellers se grøn ud.
      ud(kode === 0
        ? `\n  opdageren: ALT GRØNT — ${grupper.length} ${grupper.length === 1 ? 'gruppe' : 'grupper'}, ${koert} ${koert === 1 ? 'prøve' : 'prøver'}\n`
        : '')
      process.exitCode = kode
    }
  }
}
