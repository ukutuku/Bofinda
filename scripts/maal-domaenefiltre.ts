// ═══════════════════════════════════════════════════════════════
//  Domænefiltre efter dedup — hvor mange boliger falder ud, som ikke burde?
//
//  Overtagelse, ansøgningsform og markedsstatus afgøres i JS, på
//  REPRÆSENTANTEN, efter at SQL har valgt den. Passer repræsentanten ikke
//  filteret, men en anden annonce for samme bolig gør, forsvinder boligen
//  fra søgningen — selv om der findes en annonce, der matcher. Der vælges
//  ingen afløser.
//
//  Målingen bruger den kode, der kører — ikke en afskrift:
//    · `DEDUPNOEGLE` og `ikkeRepraesentant(hvor({}))` i lib/soeg.ts afgør,
//      hvilke annoncer der er samme bolig, og hvilken der er repræsentant.
//      Et rent domænefilter ændrer ikke SQL-sættet, så repræsentanten under
//      filteret er den samme som uden.
//    · `availabilityFor` og `matcherDomaene` afgør domænet, med kildens
//      kontrakt og tidspunktet nu.
//
//  For hver filterværdi: boliger med mindst to annoncer, hvor mange af dem
//  der har annoncer på hver sin side af filteret, og hvor mange der TABES:
//  repræsentanten passer ikke, en anden gør.
//
//  Kun SELECT. Kør mod produktionen:
//    npx tsx --tsconfig tsconfig.scripts.json --env-file=.env scripts/maal-domaenefiltre.ts
// ═══════════════════════════════════════════════════════════════

import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { listings, sources } from '../db/schema'
import {
  DEDUPNOEGLE, availabilityFor, hvor, ikkeRepraesentant, matcherDomaene, type Filtre,
} from '../lib/soeg'

export const DOMAENEFILTRE: readonly [string, Filtre][] = [
  ['overtagelse = nu', { overtagelse: 'nu' }],
  ['overtagelse = senere', { overtagelse: 'senere' }],
  ['ansøgningsform = venteliste', { ansoegningsform: 'venteliste' }],
  ['markedsstatus = reserveret', { markedsstatus: 'reserveret' }],
]

export interface Domaenemaaling {
  filter: string
  vist: number             // boliger, filteret viser i dag (repræsentanten passer)
  flereAnnoncer: number    // boliger med mindst to annoncer
  delte: number            // … hvor annoncerne står på hver sin side af filteret
  tabt: { noegle: string; rep: string; passer: string[] }[]
}

export async function maalDomaenefiltre(referenceNow = new Date()) {
  const grundlag = hvor({})
  const raekker = await db
    .select({
      id: listings.id,
      noegle: sql<string | null>`${DEDUPNOEGLE}`,
      rep: sql<boolean>`not ${ikkeRepraesentant(grundlag)}`,
      kilde: sources.slug,
      availabilityFacts: listings.availabilityFacts,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(grundlag))

  // En bolig uden nøgle er sin egen; den kan ikke tabe til en anden annonce.
  const boliger = new Map<string, typeof raekker>()
  for (const r of raekker) {
    const k = r.noegle ?? `alene:${r.id}`
    boliger.set(k, [...(boliger.get(k) ?? []), r])
  }
  const flere = [...boliger.entries()].filter(([, l]) => l.length >= 2)
  const fejlRep = flere.filter(([, l]) => l.filter((r) => r.rep).length !== 1)

  const ud: Domaenemaaling[] = []
  for (const [navn, f] of DOMAENEFILTRE) {
    let vist = 0
    let delte = 0
    const tabt: Domaenemaaling['tabt'] = []
    for (const [noegle, l] of boliger) {
      const passer = l.map((r) => matcherDomaene(f, availabilityFor(r, referenceNow)))
      const rep = l.findIndex((r) => r.rep)
      if (rep >= 0 && passer[rep]) vist++
      if (l.length < 2) continue
      if (passer.some(Boolean) && !passer.every(Boolean)) delte++
      if (rep >= 0 && !passer[rep] && passer.some(Boolean)) {
        tabt.push({ noegle, rep: l[rep]!.kilde, passer: l.filter((_, i) => passer[i]).map((r) => r.kilde) })
      }
    }
    ud.push({ filter: navn, vist, flereAnnoncer: flere.length, delte, tabt })
  }
  return { raekker: raekker.length, boliger: boliger.size, flereAnnoncer: flere.length, fejlRep: fejlRep.length, filtre: ud }
}

if (process.argv[1]?.endsWith('maal-domaenefiltre.ts')) {
  const m = await maalDomaenefiltre()
  console.log(`\nannoncer i hvor({}): ${m.raekker} · boliger: ${m.boliger} · med mindst to annoncer: ${m.flereAnnoncer}`)
  if (m.fejlRep) console.log(`  ⚠ ${m.fejlRep} boliger med flere annoncer har ikke præcis én repræsentant — målingen er ikke til at stole på`)
  for (const f of m.filtre) {
    console.log(`\n══ ${f.filter} ══`)
    console.log(`  vises i dag: ${f.vist} boliger`)
    console.log(`  boliger med annoncer på begge sider af filteret: ${f.delte} af ${f.flereAnnoncer}`)
    console.log(`  TABT — repræsentanten passer ikke, en anden annonce gør: ${f.tabt.length}`)
    const pr = new Map<string, number>()
    for (const t of f.tabt) pr.set(`${t.rep} → ${t.passer.join('+')}`, (pr.get(`${t.rep} → ${t.passer.join('+')}`) ?? 0) + 1)
    for (const [k, n] of [...pr].sort((a, b) => b[1] - a[1])) console.log(`    ${n}× repræsentant ${k}`)
  }
  console.log('')
  process.exit(0)
}
