// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  HASTIGHEDSRETTELSERNE — det, der kan gå stille i stykker.
//
//  To ting fra oktober 2026 (docs/hastighed-2026-10.md) kan fejle uden
//  at noget melder fejl:
//
//    1 · Forsidefotoets srcset lover filer i public/hero/. Mangler én,
//        eller har den en anden bredde end deskriptoren siger, får netop
//        de skærme, der vælger den, et brudt eller et udtværet billede —
//        og ingen anden skærm viser noget forkert.
//    2 · Søgeformularen rydder nu selv op før afsendelse, med samme
//        funktion som serverens 307-redirect (lib/soegeadresse.ts).
//        Reglen prøves her mod et facit skrevet i hånden, ad BEGGE veje:
//        som serveren ser parametrene (Next' searchParams-objekt) og som
//        formularen sender dem (i DOM-orden).
//
//      koeres uden database
// ═══════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERO_BREDDER, HERO_SRCSET, heroVariant } from '../lib/hero'
import { renSoegning } from '../lib/soegeadresse'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

/** WebP-filens pixelmål, læst af headeren (VP8, VP8L eller VP8X). */
function webpMaal(buf: Buffer): { b: number; h: number } | null {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') return { b: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const v = buf.readUInt32LE(21)
    return { b: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { b: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
  return null
}

console.log('\n══ forsidefotoets varianter ══\n')

// Originalen er 2048x1365. Varianterne skal have samme forhold.
for (const b of HERO_BREDDER) {
  const fil = join('public', heroVariant(b))
  if (!existsSync(fil)) { tjek(`${fil} findes`, false, 'srcset lover en fil, der ikke er der'); continue }
  const m = webpMaal(readFileSync(fil))
  tjek(`${fil} er ${b} px bred, som deskriptoren siger`, m?.b === b, m ? `${m.b}x${m.h}` : 'ikke en WebP')
  tjek(`${fil} har originalens forhold`, m != null && Math.abs(m.h - Math.round(b * 1365 / 2048)) <= 1,
    m ? `${m.h} px høj` : '')
}
const iMappen = readdirSync('public/hero').filter((f) => f.endsWith('.webp')).sort()
const forventet = HERO_BREDDER.map((b) => heroVariant(b).replace('/hero/', '')).sort()
tjek('ingen forældet variant ligger tilbage i public/hero', JSON.stringify(iMappen) === JSON.stringify(forventet),
  iMappen.join(', '))
tjek('srcset nævner hver variant én gang med sin bredde',
  HERO_BREDDER.every((b) => HERO_SRCSET.split(', ').includes(`${heroVariant(b)} ${b}w`))
    && HERO_SRCSET.split(', ').length === HERO_BREDDER.length, HERO_SRCSET)
tjek('ingen variant er bredere end originalen', HERO_BREDDER.every((b) => b <= 2048))

console.log('\n══ søgeadressen: browserens oprydning = serverens redirect ══\n')

// Som Next bygger `searchParams`: ét navn, flere værdier → et array, og
// navnene i den orden, de FØRST optræder.
function somServeren(q: string): Record<string, string | string[]> {
  const sp: Record<string, string | string[]> = {}
  for (const [k, v] of new URLSearchParams(q)) {
    const f = sp[k]
    sp[k] = f == null ? v : Array.isArray(f) ? [...f, v] : [f, v]
  }
  return sp
}
const serverAdresse = (q: string) => {
  const sp = somServeren(q)
  const { rent, snavs } = renSoegning(Object.entries(sp).flatMap(([k, v]) =>
    (Array.isArray(v) ? v : [v]).map((x) => [k, x] as const)))
  return { q: new URLSearchParams(rent).toString(), snavs }
}
const formAdresse = (q: string) => {
  const { rent, snavs } = renSoegning([...new URLSearchParams(q)])
  return { q: new URLSearchParams(rent).toString(), snavs }
}

const FACIT: [string, string, boolean][] = [
  // [det formularen sender, den rene adresse, blev der fjernet noget]
  ['sted=Aarhus&prisMin=&prisMax=&vaerelser=&areal=&overtagelse=&kilde=&sorter=nyeste', 'sted=Aarhus', true],
  ['sted=2300&type=hus&type=raekkehus&prisMin=', 'sted=2300&type=hus&type=raekkehus', true],
  // Gentagne navne, der ikke står side om side: serveren samler dem.
  ['type=hus&kilde=propstep&type=raekkehus&prisMax=', 'type=hus&type=raekkehus&kilde=propstep', true],
  ['sted=Odense&sorter=pris', 'sted=Odense&sorter=pris', false],
  ['sted=Odense&sorter=nyeste', 'sted=Odense', true],
  ['sted=Odense&elevator=1', 'sted=Odense&elevator=1', false],
  // Alt tomt: rent er tom. Komponenten gør da ingenting og lader
  // serveren sende til `/`, som den altid har gjort.
  ['sted=&prisMin=&sorter=nyeste', '', true],
]
for (const [ind, ud, snavs] of FACIT) {
  const s = serverAdresse(ind), f = formAdresse(ind)
  tjek(`«${ind.slice(0, 48)}${ind.length > 48 ? '…' : ''}»`,
    s.q === ud && f.q === ud && s.snavs === snavs && f.snavs === snavs,
    `server «${s.q}», formular «${f.q}»`)
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
