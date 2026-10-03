// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne/1
//  Prøver `scripts/kildetjek.ts` — laget, der afgør hvilke slags
//  træffere et kildetjek må tælle med.
//
//  Prøven er bygget om tre ting, og de er de tre, der faktisk gik
//  galt i repoet før filen fandtes:
//
//    1. En træffer i en KOMMENTAR må ikke tælle som kode. Det er
//       `/tilbud === null/`-fejlen: regexet ramte kommentaren OM
//       vagten, og modprøven blev grøn.
//    2. En træffer i en STRENG SKAL tælle som kode. Det er ikke en
//       eftergivelse: fire af de fem rigtige kildetjek på main leder
//       efter en importsti eller et SQL-prædikat, og de står i
//       anførselstegn. En første udgave, der også blændede strengene
//       ud, gjorde dem alle fire røde. Se scripts/kildetjek.ts.
//    3. `https://` i en streng må ikke æde resten af linjen. Det gør
//       `/\/\/.*$/gm`, som fire af de ni strippere brugte — og det er
//       dét, skanneren skal kende strenge for at undgå.
//
//  Og den vigtigste egenskab af alle: masken SLETTER ikke. Prøven
//  kræver, at længde og linjenumre er uændrede, for ellers kan
//  modprøvekøreren ikke pege på den træffer, den har talt.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { antal, findes, kildelag, lagvis, traeffere, type Kun } from './kildetjek'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// ─── Forlægget ─────────────────────────────────────────────────
//  ORDET står præcis seks gange, én gang i hvert lag der findes:
//  kode, linjekommentar, blokkommentar, streng, skabelontekst og
//  regex-literal. Tallene nedenfor er talt i hånden af denne tekst,
//  ikke udledt af funktionen — en prøve, der spurgte funktionen om
//  facit, ville gå op per definition.
const ORD = 'MAALORD'
const FORLAEG = [
  `const a = ${ORD}`,                        // 1 · kode
  `const b = 1 // ${ORD} i en linjekommentar`, // 2 · linjekommentar
  `/* ${ORD} i en blokkommentar */`,          // 3 · blokkommentar
  `const c = '${ORD} i en streng'`,           // 4 · streng
  'const d = `tekst ' + ORD + ' i en skabelon`', // 5 · skabelontekst
  `const e = /${ORD}/g`,                      // 6 · regex-literal
].join('\n')

console.log('\n══ 1 · de tre lag tælles hver for sig ══')
{
  // Kode = alt der ikke er kommentar: udtrykket, strengen,
  // skabelonteksten og regex-literalen. Fire.
  tjek('kode: 4 (udtryk, streng, skabelon, regex)',
    antal(FORLAEG, ORD, 'kode') === 4, `${antal(FORLAEG, ORD, 'kode')}`)
  tjek('kommentar: 2 (linje- og blokkommentaren)',
    antal(FORLAEG, ORD, 'kommentar') === 2, `${antal(FORLAEG, ORD, 'kommentar')}`)
  tjek('alt: 6', antal(FORLAEG, ORD, 'alt') === 6, `${antal(FORLAEG, ORD, 'alt')}`)

  // ── DE TRE ER EN PARTITION, og prøven skal måle det ──
  //  Tallene tælles UAFHÆNGIGT og sammenlignes bagefter. En prøve,
  //  der udledte 'kode' som «alt minus kommentar», ville gå op per
  //  definition og aldrig kunne fejle — samme disciplin som
  //  facilitetsgrundlagets tre grupper.
  const k = antal(FORLAEG, ORD, 'kode')
  const m = antal(FORLAEG, ORD, 'kommentar')
  const a = antal(FORLAEG, ORD, 'alt')
  tjek('kode + kommentar går op med alt', k + m === a, `${k} + ${m} = ${a}`)
  // … og tegn for tegn, ikke kun i antal træffere: hvert eneste tegn
  // skal stå i præcis ét af de to lag.
  const km = kildelag(FORLAEG, 'kode')
  const km2 = kildelag(FORLAEG, 'kommentar')
  const flettet = [...FORLAEG].map((c, i) =>
    c === '\n' ? c : (km[i] !== ' ' ? km[i] : km2[i])).join('')
  const dobbelt = [...FORLAEG].filter((c, i) =>
    c !== '\n' && c !== ' ' && km[i] !== ' ' && km2[i] !== ' ').length
  tjek('… og tegn for tegn: de to lag flettet GIVER filen',
    flettet === FORLAEG, flettet === FORLAEG ? '' : 'der mangler tegn')
  tjek('… og intet tegn står i begge', dobbelt === 0, `${dobbelt} i begge`)
}

console.log('\n══ 2 · masken bevarer position, længde og linjer ══')
for (const kun of ['kode', 'kommentar'] as const) {
  const maske = kildelag(FORLAEG, kun)
  tjek(`${kun}: samme længde`, maske.length === FORLAEG.length,
    `${maske.length} mod ${FORLAEG.length}`)
  tjek(`${kun}: samme antal linjer`,
    maske.split('\n').length === FORLAEG.split('\n').length)
  tjek(`${kun}: hvert linjeskift står samme sted`,
    [...FORLAEG].every((c, i) => c !== '\n' || maske[i] === '\n'))
}
tjek('alt: masken ER teksten', kildelag(FORLAEG, 'alt') === FORLAEG)
{
  // Positionen skal pege i den RIGTIGE fil, ikke i masken.
  const t = traeffere(FORLAEG, ORD, 'kommentar')
  tjek('en kommentartræffers linje passer med forlægget',
    t.length === 2 && t[0]!.linje === 2 && t[1]!.linje === 3,
    t.map((x) => x.linje).join(', '))
  tjek('og teksten på positionen er ordet selv',
    t.every((x) => FORLAEG.slice(x.index, x.index + ORD.length) === ORD))
}

console.log('\n══ 3 · de tre fejl, de håndskrevne strippere lavede ══')
{
  // 1 · efterhængt kommentar. `/^\s*\/\/.*$/gm` (main ×3) ser den ikke.
  const efterhaengt = 'const x = 1 // VAGTEN er beskrevet her\n'
  tjek('efterhængt // tæller ikke som kode',
    !findes(efterhaengt, 'VAGTEN', 'kode'))
  tjek('… men den FINDES som kommentar', findes(efterhaengt, 'VAGTEN', 'kommentar'))

  // 2 · URL i en streng. `/\/\/.*$/gm` (grenen ×4) æder resten af linjen.
  const url = "const u = 'https://proeve.invalid/MAAL'\nconst v = SENERE\n"
  tjek('en URL i en streng æder ikke resten af linjen',
    findes(url, 'SENERE', 'kode'))
  tjek('… og URL-en er stadig SYNLIG som kode — den er en værdi, ikke prosa',
    findes(url, 'proeve.invalid', 'kode'))
  tjek('… og den er ikke kommentar', !findes(url, 'proeve.invalid', 'kommentar'))

  // 3 · `//` inde i en streng åbner ingen kommentar.
  const iStreng = "const s = 'ikke // en kommentar'\nconst t = EFTER\n"
  tjek('// inde i en streng åbner ingen kommentar', findes(iStreng, 'EFTER', 'kode'))
  tjek('… og indholdet er ikke kommentar',
    !findes(iStreng, 'en kommentar', 'kommentar'))

  // 3b · DET, DE FEM RIGTIGE KILDETJEK SPØRGER OM: en importsti og et
  //  SQL-prædikat står i anførselstegn og SKAL kunne findes.
  const imp = "import { POSTNAVN } from './grundlag'\n// … from './attrap'\n"
  tjek("importstien findes som kode", findes(imp, /from '\.\/grundlag'/, 'kode'))
  tjek('… men kommentarens attrap-sti gør ikke',
    !findes(imp, /from '\.\/attrap'/, 'kode')
    && findes(imp, /from '\.\/attrap'/, 'kommentar'))

  // 4 · `/*` inde i en streng lukker ikke resten af filen ude.
  const blokIStreng = "const s = '/* ikke en blok'\nconst t = EFTER2\n"
  tjek('/* inde i en streng åbner ingen blokkommentar',
    findes(blokIStreng, 'EFTER2', 'kode'))

  // 5 · en apostrof i en kommentar åbner ingen streng.
  const apostrof = "// det's en note\nconst t = EFTER3\n"
  tjek("apostrof i en kommentar åbner ingen streng", findes(apostrof, 'EFTER3', 'kode'))

  // 6 · JSX-kommentar.
  const jsx = '<div>{/* SKJULT */}</div>\nconst t = SYNLIG\n'
  tjek('JSX-kommentar er kommentar', findes(jsx, 'SKJULT', 'kommentar'))
  tjek('… og ikke kode', !findes(jsx, 'SKJULT', 'kode'))
  tjek('… og den lukker igen', findes(jsx, 'SYNLIG', 'kode'))

  // 7 · skabelon med ${ { } } — den matchende krølle, ikke den første.
  const skab = 'const s = `a ${ {b: 1}.b } c`\nconst t = EFTER4\n'
  tjek('${ {…} } slutter ved den MATCHENDE krølle', findes(skab, 'EFTER4', 'kode'))
  tjek('… og udtrykket indeni er kode', findes(skab, '.b', 'kode'))
  tjek('… og skabelonteksten er det også', findes(skab, 'a $', 'kode'))
}

console.log('\n══ 4 · standarden er «kode» ══')
{
  tjek('antal() uden argument er «kode»', antal(FORLAEG, ORD) === antal(FORLAEG, ORD, 'kode'))
  tjek('findes() uden argument er «kode»',
    findes(FORLAEG, ORD) === findes(FORLAEG, ORD, 'kode'))
  tjek('kildelag() uden argument er «kode»',
    kildelag(FORLAEG) === kildelag(FORLAEG, 'kode'))
  // En fjerde værdi må ikke kunne tastes. `satisfies` fanger en
  // tastefejl i en EKSISTERENDE værdi; den fanger ikke en manglende.
  // Derfor tælles medlemmerne her, så en udvidelse uden en prøve
  // bliver rød.
  const ALLE = ['kode', 'alt', 'kommentar'] as const satisfies readonly Kun[]
  tjek('Kun har præcis tre værdier, og alle tre er prøvet ovenfor',
    ALLE.length === 3 && new Set(ALLE).size === 3)
}

console.log('\n══ 5 · den kører på rigtige filer uden at gå i stå ══')
{
  // Skanneren er ét gennemløb over hvert tegn. En uafsluttet streng,
  // et regex den læser forkert eller en skabelon uden ende må ikke
  // kunne sende den i en løkke — og den skal give samme længde på
  // HVER fil i repoet, ikke kun på forlægget.
  const filer: string[] = []
  const gaa = (m: string) => {
    for (const n of readdirSync(m, { withFileTypes: true })) {
      if (n.name === 'node_modules' || n.name.startsWith('.')) continue
      const p = join(m, n.name)
      if (n.isDirectory()) gaa(p)
      else if (/\.tsx?$/.test(n.name)) filer.push(p)
    }
  }
  for (const m of ['app', 'lib', 'adapters', 'scripts']) gaa(m)
  let skaev = 0
  let ulige: string | null = null
  for (const f of filer) {
    const t = readFileSync(f, 'utf8')
    const l = lagvis(t)
    if (l.length !== t.length || kildelag(t, 'kode').length !== t.length) {
      skaev++; ulige ??= f
    }
  }
  tjek(`alle ${filer.length} TS-filer i repoet beholder deres længde`,
    filer.length > 100 && skaev === 0, ulige ?? `${skaev} skæve`)

  // Og det mest konkrete: INGEN fil må have et `import … from '…'`,
  // der forsvinder ud af kodelaget. Det er den slags, test-soegning
  // leder efter.
  let tabt = 0
  for (const f of filer) {
    const t = readFileSync(f, 'utf8')
    const ialt = (t.match(/^import .*from '/gm) ?? []).length
    const iKode = (kildelag(t, 'kode').match(/^import .*from '/gm) ?? []).length
    if (ialt !== iKode) tabt++
  }
  tjek('ingen import-linje falder ud af kodelaget', tabt === 0, `${tabt} filer`)
}

console.log(fejl ? `\n  ${fejl} FEJLEDE\n` : '\n  ALT GRØNT\n')
process.exit(fejl ? 1 : 0)
