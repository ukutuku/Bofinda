// ═══════════════════════════════════════════════════════════════
//  BOLIGTYPENS NAVN — ét sted, og prøven holder det dér.
//
//  `lib/boligtype.ts` blev skrevet for at være den eneste liste. Den
//  var det ikke: der lå FEM private kopier ved siden af, og de var
//  uenige. `app/gruppe/page.tsx` manglede `vaerelse`, `studiebolig` og
//  `andet`, så en gruppe af fem studieboliger stod som «5 boliger» —
//  ikke en grim etiket, men et TAB af en oplysning, vi har.
//
//  ── TO HALVDELE, OG KUN DEN ENE ER EN OVERSÆTTERFEJL ────────
//  `satisfies Record<Boligtype, …>` fanger en sjette enum-værdi uden
//  et navn. Den kan ikke se en NY privat kopi — den er jo typerigtig
//  hver for sig. Derfor scanner prøven kildeteksten.
//
//      koeres uden database, som scripts/test-migrationer.ts
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { propertyTypeEnum } from '../db/schema'
import { BOLIGTYPER, typenavn, typeord } from '../lib/boligtype'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

console.log('\n══ boligtypens navn ══\n')

// ── 1 · HVER ENUM-VÆRDI HAR ET NAVN ──────────────────────────
// `satisfies` siger det allerede ved oversættelse. Her måles det ved
// KØRSELSTID, så prøven også fanger en liste, der er blevet bredere
// end enummet — og så udskriften navngiver den manglende værdi.
const iEnum = [...propertyTypeEnum.enumValues]
const uden = iEnum.filter((t) => !BOLIGTYPER.includes(t))
tjek('hver boligtype i enummet har et navn', uden.length === 0,
  uden.length ? `mangler: ${uden.join(', ')}` : `${iEnum.length} typer`)
const forMeget = BOLIGTYPER.filter((t) => !iEnum.includes(t))
tjek('og listen har ingen værdi, enummet ikke har', forMeget.length === 0,
  forMeget.length ? `findes ikke i enummet: ${forMeget.join(', ')}` : '')

// ── 2 · ENTAL OG FLERTAL FOR HVER ───────────────────────────
for (const t of iEnum) {
  const e = typeord(t), f = typeord(t, true)
  // Kravet er IKKE, at ordet er forskelligt fra slug'en: `lejlighed`,
  // `hus` og `studiebolig` hedder med rette det samme paa dansk. Kravet
  // er, at begge former findes, og at flertal ikke er lig ental —
  // ellers er én af dem ikke udfyldt.
  tjek(`  ${t} har baade ental og flertal`,
    !!e && !!f && e !== f, `${e} / ${f}`)
}

// ── 3 · DEN KONKRETE FEJL, DER VAR I PRODUKTIONEN ───────────
// Gruppesiden manglede netop de tre. Uden dem faldt den til «boliger».
tjek('en gruppe af studieboliger hedder studieboliger, ikke «boliger»',
  typeord('studiebolig', true) === 'studieboliger', String(typeord('studiebolig', true)))
tjek('  og værelser hedder værelser', typeord('vaerelse', true) === 'værelser',
  String(typeord('vaerelse', true)))
tjek('  og andet hedder andre boliger', typeord('andet', true) === 'andre boliger',
  String(typeord('andet', true)))

// `villa` stod i to lister og findes ikke i enummet. En ukendt værdi
// gives videre som kildens eget ord — den bliver IKKE til et navn.
tjek('villa er ikke et navn, vi kender', typeord('villa') === 'villa',
  String(typeord('villa')))

tjek('typenavn giver stort forbogstav', typenavn('andet') === 'Anden bolig',
  typenavn('andet'))

// ── 4 · INGEN PRIVAT KOPI ───────────────────────────────────
// Den halvdel, en oversætter ikke kan se. Et objektliteral med to
// eller flere boligtype-slugs som nøgler ER en kopi, uanset hvad den
// hedder. Kun lib/boligtype.ts må have en.
const filer: string[] = []
const gaa = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') gaa(p) }
    else if (/\.tsx?$/.test(e.name)) filer.push(p)
  }
}
gaa('app'); gaa('lib')

const kopier: string[] = []
for (const f of filer) {
  if (f === join('lib', 'boligtype.ts')) continue
  const tekst = readFileSync(f, 'utf8')
  // Noeglepositionen er efter `{`, efter et komma, eller ved linjestart.
  // Foerste udgave var kun forankret til LINJESTART — og faldt derfor
  // igennem paa en kopi med to noegler paa samme linje, hvilket er
  // praecis den form, de fem fjernede kopier havde. Proeven bestod ved
  // et tilfaelde af formatering; det er samme klasse som det, den maaler.
  const ramt = iEnum.filter((t) =>
    new RegExp(`(^|[{,])\\s*${t}:\\s*['"\`]`, 'm').test(tekst))
  if (ramt.length >= 2) kopier.push(`${f} (${ramt.join(', ')})`)
}
tjek('ingen privat kopi af boligtypens navne', kopier.length === 0,
  kopier.length ? kopier.join(' · ') : `${filer.length} filer scannet`)

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
