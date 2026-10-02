// ═══════════════════════════════════════════════════════════════
//  KILDETJEK — hvilke slags traeffere taeller med, naar en proeve
//  soeger i kildeteksten.
//
//  Proeverne her soeger i kildefiler, fordi nogle regler ikke kan
//  gengives: at `ne(listings.sourceType, 'native')` staar i SQL'en og
//  ikke i en gren, at en komponent ikke importerer databasen, at en
//  ordbog ikke er skrevet af et andet sted. Et regex mod filen er den
//  eneste maade at stille det spoergsmaal paa.
//
//  ═══ HVORFOR FILEN FINDES ═══
//
//  Spoergsmaalet «taeller denne traeffer med» blev besvaret NI steder,
//  og de fire forskellige svar er maalt, ikke formodet:
//
//      main           test-genskriv.ts, test-kontaktmur.ts,
//                     test-beskrivelse.ts
//                     → /\/\*[\s\S]*?\*\//g + /^\s*\/\/.*$/gm
//      betalingsgren  test-favoritforloeb.ts  (samme, men erstatter
//                     med ' ' i stedet for '')
//                     test-gendannelse.ts ×4  (`udenKommentarer` to
//                     gange, `renKode`, `ren`) → /\/\/.*$/gm, og to af
//                     dem ogsaa /\{\/\*[\s\S]*?\*\/\}/g
//
//  Ingen af dem kender strenge. Det er ikke en skoenhedsfejl:
//
//    · `/^\s*\/\/.*$/gm` fjerner KUN kommentarer, der staar alene paa
//      linjen. En efterhaengt `// ...` bliver staaende, saa en proeve,
//      der leder efter et ord, kan blive groen af nogens note.
//      Det er sket: `/tilbud === null/` ramte kommentaren OM vagten.
//    · `/\/\/.*$/gm` fanger den efterhaengte — og aeder samtidig
//      resten af enhver linje med `https://`. En proeve, der leder
//      efter en URL, kan derfor aldrig blive roed.
//
//  To udtryk for ét spoergsmaal, hvor begge ser rigtige ud hver for
//  sig. Se CLAUDE.md om netop den fejlform.
//
//  ═══ DEN AFGOERENDE EGENSKAB: MASKEN BEVARER POSITIONER ═══
//
//  `kildelag()` SLETTER ikke; den blaender ud med mellemrum og
//  beholder hvert `\n`. Laengden og hver linjes nummer er derfor
//  uaendret, og et `match.index` i masken peger paa samme tegn i den
//  rigtige fil.
//
//  Det er ikke pynt. Modproevekoereren (scripts/modproeve.mjs) regner
//  linjenummer som `indhold.slice(0, i).split('\n').length` og
//  anvender mutationen paa `indhold.slice(0, index)` — begge dele
//  braekker, hvis masken flytter noget. En stripper, der sletter, kan
//  taelle traeffere, men kan ikke pege paa dem.
//
//  ═══ 'KODE' BETYDER «IKKE KOMMENTAR». STRENGE ER KODE ═══
//
//  ⚠ LAES DETTE AFSNIT, FOER DU «RETTER» DET TILBAGE.
//
//  Strengene SKAL blive i kodelaget. Det lyder forkert — en streng er
//  tekstdata, ikke logik — og det er praecis derfor, nogen vil lave
//  det om. Her er hvorfor det ikke maa:
//
//  Den oprindelige graenseflade sagde «udelader kommentarer og
//  strenge». Formuleringen var FORESLAAET af den ene side og
//  GODKENDT af den anden; diskussionen gik paa feltets navn, ikke paa
//  dens betydning. To mennesker laeste den og saa intet galt.
//
//  Den blev bygget saadan, og saa blev den koert mod de fem rigtige
//  kildetjek, der fandtes i forvejen. FIRE AF DEM GIK ROEDE:
//
//      POSTNAVN hentes fra lib/grundlag          from './grundlag'
//      el-tilstanden hentes fra lib/eloplysning  from './eloplysning'
//      opremsningen hentes fra lib/liste         from './liste'
//      ne(listings.sourceType, 'native')         'native'
//
//  Gennemlaesningen fangede det ikke. Maalingen gjorde. Det er den
//  eneste grund til, at filen her ikke er forkert i dag — og derfor
//  staar tallet skrevet: fjerner du strengene fra kodelaget, bliver
//  de fire roede igen, og de er den eneste advarsel du faar.
//
//  Grunden er den samme hver gang: ET KILDETJEK LEDER NAESTEN ALTID
//  EFTER EN STRENG-LITERAL. En importsti, et SQL-praedikat, et
//  feltnavn — de staar i anfoerselstegn, fordi det er saadan koden
//  skriver dem. Blaender man strengenes indhold ud, kan praecis de
//  spoergsmaal ikke stilles laengere.
//
//  Det, der har bidt i dette repo, er heller ikke strenge. Det er
//  PROSA: `/tilbud === null/` ramte kommentaren OM vagten,
//  `beslutning.ts`' fremtidige import stod som eksempel i filhovedet,
//  og `lib/soeg` stod i en kommentar i Hastighed.tsx. Tre gange, tre
//  kommentarer.
//
//  Saa 'kode' er alt, der ikke er kommentar, og de tre vaerdier er en
//  aegte PARTITION: `kode + kommentar === alt`, tegn for tegn.
//  `scripts/test-kildetjek.ts` maaler de tre uafhaengigt og kraever
//  det — en proeve, der udledte den ene som resten, ville gaa op per
//  definition og aldrig kunne fejle.
//
//  Skanneren kender stadig strenge indvendigt, og det er ikke pynt:
//  uden at vide hvad der er en streng, kan man ikke se, at `//` i
//  `'https://…'` ikke aabner en kommentar. Der er ingen 'streng'
//  blandt vaerdierne, fordi ingen af de fem kaldsteder har brug for
//  den — maalt, ikke formodet. Faar et kaldested det, er det en
//  udvidelse med sin egen proeve.
// ═══════════════════════════════════════════════════════════════

/**
 * Hvilket lag af kildeteksten et moenster maa ramme.
 *
 * - `'kode'` — alt der ikke er kommentar. Streng- og skabelontekst
 *   taeller MED: et kildetjek leder naesten altid efter en
 *   streng-literal (en importsti, et SQL-praedikat). Se filhovedet.
 * - `'kommentar'` — kun kommentarerne, inkl. JSX-formen `{/* … *\/}`.
 * - `'alt'`  — filen ordret, og tegn for tegn det samme som
 *   `kode + kommentar`.
 */
export type Kun = 'kode' | 'alt' | 'kommentar'

/** Standarden. Et kildetjek spoerger naesten altid om koden. */
export const STANDARD: Kun = 'kode'

type Lag = 'kode' | 'kommentar' | 'streng'

/**
 * Deler kildeteksten op tegn for tegn i kode, kommentar og streng.
 *
 * Returnerer et array med ét `Lag` pr. tegn i `tekst`. Linjeskift
 * henregnes altid til `'kode'`, saa en maske aldrig kan fjerne dem.
 *
 * Skanneren er ét gennemloeb og ikke en kaede af `.replace()`, fordi
 * lagene er indlejrede: en `//` inde i en streng er ikke en kommentar,
 * et `/*` inde i et regex er ikke en kommentar, og en `'` inde i en
 * kommentar aabner ingen streng. Et regex kan ikke se den forskel.
 */
export function lagvis(tekst: string): Lag[] {
  const ud: Lag[] = new Array(tekst.length)
  // Skabelon-literaler kan indeholde `${ ... }` med kode, der selv kan
  // indeholde en skabelon. Derfor en stak og ikke et flag.
  //   -1  = vi staar i skabelonens TEKST
  //   n>=0 = vi staar inde i et `${ … }` paa kroellet dybde n
  // Dybden taelles, fordi `${ {a: 1}.a }` ellers ville slutte udtrykket
  // ved den FOERSTE `}` og laese resten af koden som skabelontekst.
  const skabelon: number[] = []
  let i = 0

  // Til at afgoere om `/` aabner et regex eller er division: det sidste
  // betydende tegn i KODE. Efter en vaerdi (`)`, `]`, navn, tal) er `/`
  // division; ellers er det et regex.
  let sidsteKode = ''
  const sidsteOrd = () => {
    let j = i - 1
    let slut = -1
    while (j >= 0) {
      const c = tekst[j]!
      if (/\s/.test(c)) { if (slut >= 0) break; j--; continue }
      if (!/[A-Za-z_$]/.test(c)) break
      if (slut < 0) slut = j
      j--
    }
    return slut >= 0 ? tekst.slice(j + 1, slut + 1) : ''
  }
  const EFTER_DISSE_ER_REGEX = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await',
  ])

  const saet = (fra: number, til: number, lag: Lag) => {
    for (let k = fra; k < til; k++) ud[k] = tekst[k] === '\n' ? 'kode' : lag
  }

  while (i < tekst.length) {
    const c = tekst[i]!
    const n = tekst[i + 1]

    // ── Kommentarer ────────────────────────────────────────────
    if (c === '/' && n === '/') {
      let j = i
      while (j < tekst.length && tekst[j] !== '\n') j++
      saet(i, j, 'kommentar'); i = j; continue
    }
    if (c === '/' && n === '*') {
      let j = i + 2
      while (j < tekst.length && !(tekst[j] === '*' && tekst[j + 1] === '/')) j++
      j = Math.min(j + 2, tekst.length)
      saet(i, j, 'kommentar'); i = j; continue
    }

    // ── Strenge ────────────────────────────────────────────────
    if (c === '"' || c === "'") {
      let j = i + 1
      let lukket = false
      while (j < tekst.length) {
        if (tekst[j] === '\\') { j += 2; continue }
        if (tekst[j] === c) { j++; lukket = true; break }
        // En uafsluttet streng maa ikke sluge resten af filen.
        if (tekst[j] === '\n') break
        j++
      }
      ud[i] = 'kode'                       // selve anfoerselstegnet er kode
      saet(i + 1, lukket ? j - 1 : j, 'streng')
      if (lukket) ud[j - 1] = 'kode'       // … og det lukkende ogsaa
      i = j; sidsteKode = c; continue
    }
    if (c === '`') {
      ud[i] = 'kode'; i++
      skabelon.push(-1)
      // Skabelonens tekst laeses nedenfor, naar stakken er aktiv.
      continue
    }
    if (skabelon.length > 0 && skabelon[skabelon.length - 1] === -1) {
      // Vi staar i skabelonens TEKST.
      let j = i
      while (j < tekst.length) {
        if (tekst[j] === '\\') { saet(j, j + 2, 'streng'); j += 2; continue }
        if (tekst[j] === '`') break
        if (tekst[j] === '$' && tekst[j + 1] === '{') break
        ud[j] = tekst[j] === '\n' ? 'kode' : 'streng'
        j++
      }
      if (j >= tekst.length) { i = j; continue }
      if (tekst[j] === '`') { ud[j] = 'kode'; skabelon.pop(); i = j + 1; continue }
      // `${` — tilbage i kode, indtil den MATCHENDE `}`
      ud[j] = 'kode'; ud[j + 1] = 'kode'
      skabelon[skabelon.length - 1] = 0
      i = j + 2; sidsteKode = '{'; continue
    }

    // ── Regex-literal vs. division ─────────────────────────────
    if (c === '/') {
      const ord = sidsteOrd()
      const erRegex = sidsteKode === '' || EFTER_DISSE_ER_REGEX.has(ord)
        || /[(,=:[!&|?{};+\-*%~^<>]/.test(sidsteKode)
      if (erRegex) {
        let j = i + 1
        let iKlasse = false
        while (j < tekst.length) {
          const d = tekst[j]!
          if (d === '\\') { j += 2; continue }
          if (d === '\n') break               // ufuldstaendigt — giv op
          if (d === '[') iKlasse = true
          else if (d === ']') iKlasse = false
          else if (d === '/' && !iKlasse) { j++; break }
          j++
        }
        while (j < tekst.length && /[a-z]/.test(tekst[j]!)) j++   // flag
        saet(i, j, 'kode'); i = j; sidsteKode = '/'; continue
      }
    }

    ud[i] = 'kode'
    if (!/\s/.test(c)) sidsteKode = c
    // Inde i et `${ … }` foerer den MATCHENDE `}` tilbage i skabelonteksten.
    const top = skabelon.length - 1
    if (top >= 0 && skabelon[top]! >= 0) {
      if (c === '{') skabelon[top]!++
      else if (c === '}') {
        if (skabelon[top] === 0) skabelon[top] = -1   // udtrykket slut
        else skabelon[top]!--
      }
    }
    i++
  }
  for (let k = 0; k < ud.length; k++) if (ud[k] === undefined) ud[k] = 'kode'
  return ud
}

/**
 * Kildeteksten, hvor alt uden for det valgte lag er blaendet ud med
 * mellemrum. Laengde og linjenumre er uaendrede — se filhovedet.
 *
 * `'alt'` returnerer teksten ordret, saa `kildelag(t, 'alt') === t`.
 */
export function kildelag(tekst: string, kun: Kun = STANDARD): string {
  if (kun === 'alt') return tekst
  const lag = lagvis(tekst)
  // 'kode' er komplementet til 'kommentar' — strenge hoerer til koden.
  const beholdes = kun === 'kommentar'
    ? (l: Lag) => l === 'kommentar'
    : (l: Lag) => l !== 'kommentar'
  const ud = new Array<string>(tekst.length)
  for (let k = 0; k < tekst.length; k++) {
    const c = tekst[k]!
    if (c === '\n') { ud[k] = c; continue }
    ud[k] = beholdes(lag[k]!) ? c : ' '
  }
  return ud.join('')
}

/** Mønstret som et globalt RegExp — en streng tages ORDRET, ikke som regex. */
function somRegex(moenster: string | RegExp): RegExp {
  if (moenster instanceof RegExp) {
    return new RegExp(moenster.source,
      moenster.flags.includes('g') ? moenster.flags : `${moenster.flags}g`)
  }
  return new RegExp(moenster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
}

/**
 * Traefferne i det valgte lag, med position i den RIGTIGE fil.
 *
 * `index` og `linje` peger i `tekst`, ikke i masken — se filhovedet om
 * hvorfor det er masken, der skal bevare positionerne.
 */
export function traeffere(
  tekst: string, moenster: string | RegExp, kun: Kun = STANDARD,
): { index: number, linje: number, tekst: string }[] {
  const maske = kildelag(tekst, kun)
  return [...maske.matchAll(somRegex(moenster))].map((m) => ({
    index: m.index,
    linje: tekst.slice(0, m.index).split('\n').length,
    tekst: tekst.slice(m.index, m.index + m[0].length),
  }))
}

/** Findes moenstret i det valgte lag? Det almindelige kildetjek. */
export function findes(
  tekst: string, moenster: string | RegExp, kun: Kun = STANDARD,
): boolean {
  return somRegex(moenster).test(kildelag(tekst, kun))
}

/** Antal traeffere — bekvemmelighed, naar kun tallet skal bruges. */
export function antal(
  tekst: string, moenster: string | RegExp, kun: Kun = STANDARD,
): number {
  return traeffere(tekst, moenster, kun).length
}
