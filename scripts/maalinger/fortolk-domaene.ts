// ═══════════════════════════════════════════════════════════════
//  Fortolker cellen «til_fortolkning» fra blok D2 med appens EGEN kode.
//
//    npx tsx --tsconfig tsconfig.scripts.json scripts/maalinger/fortolk-domaene.ts d2.json [--tidspunkt=ISO]
//
//  D2 kan kun give rå fakta: domænet kræver kildekontrakten og tidspunktet
//  nu (`availabilityFor` og `matcherDomaene` i lib/soeg.ts), og en kopi i
//  SQL ville være et andet udtryk for det samme. Her køres de rigtige
//  funktioner på hver annonce, og for hver filterværdi tælles:
//    · delte: boliger, hvor annoncerne står på hver sin side af filteret
//    · tabte: repræsentanten passer ikke, en anden annonce gør — boligen
//      forsvinder fra en søgning, den hører til i
//  Kalder ingen forespørgsel — kun appens rene funktioner. (De bor i
//  lib/soeg, som importerer db/client; forbindelsen oprettes først ved
//  første forespørgsel, og her kommer der ingen.)
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { availabilityFor, matcherDomaene, type Filtre } from '../../lib/soeg'

export const DOMAENEFILTRE: readonly [string, Filtre][] = [
  ['overtagelse = nu', { overtagelse: 'nu' }],
  ['overtagelse = senere', { overtagelse: 'senere' }],
  ['ansøgningsform = venteliste', { ansoegningsform: 'venteliste' }],
  ['markedsstatus = reserveret', { markedsstatus: 'reserveret' }],
]

export interface Annonce { bolig: string; repraesentant: boolean; kilde: string; fakta: unknown }
export interface Fortolkning { filter: string; delte: number; tabte: { bolig: string; rep: string; passer: string[] }[] }

export function fortolk(annoncer: readonly Annonce[], tidspunkt: Date): Fortolkning[] {
  const boliger = new Map<string, Annonce[]>()
  for (const a of annoncer) boliger.set(a.bolig, [...(boliger.get(a.bolig) ?? []), a])
  for (const [b, l] of boliger) {
    if (l.filter((a) => a.repraesentant).length !== 1) {
      throw new Error(`bolig ${b} har ikke præcis én repræsentant — D2 er ikke til at stole på`)
    }
  }
  return DOMAENEFILTRE.map(([navn, f]) => {
    let delte = 0
    const tabte: Fortolkning['tabte'] = []
    for (const [bolig, l] of boliger) {
      const passer = l.map((a) => matcherDomaene(f, availabilityFor({ availabilityFacts: a.fakta, kilde: a.kilde }, tidspunkt)))
      if (passer.some(Boolean) && !passer.every(Boolean)) delte++
      const rep = l.findIndex((a) => a.repraesentant)
      if (!passer[rep] && passer.some(Boolean)) {
        tabte.push({ bolig, rep: l[rep]!.kilde, passer: l.filter((_, i) => passer[i]).map((a) => a.kilde) })
      }
    }
    return { filter: navn, delte, tabte }
  })
}

if (process.argv[1]?.endsWith('fortolk-domaene.ts')) {
  const fil = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const t = process.argv.find((a) => a.startsWith('--tidspunkt='))?.slice('--tidspunkt='.length)
  if (!fil) { console.error('brug: fortolk-domaene.ts <fil med cellen fra D2> [--tidspunkt=ISO]'); process.exit(2) }
  const tidspunkt = t ? new Date(t) : new Date()
  const annoncer = JSON.parse(readFileSync(fil, 'utf8')) as Annonce[]
  const boliger = new Set(annoncer.map((a) => a.bolig)).size
  console.log(`\n${boliger} boliger, ${annoncer.length} annoncer, fortolket pr. ${tidspunkt.toISOString()}`)
  for (const r of fortolk(annoncer, tidspunkt)) {
    console.log(`\n══ ${r.filter} ══\n  på begge sider af filteret: ${r.delte}\n  TABT: ${r.tabte.length}`)
    const pr = new Map<string, number>()
    for (const x of r.tabte) pr.set(`${x.rep} → ${x.passer.join('+')}`, (pr.get(`${x.rep} → ${x.passer.join('+')}`) ?? 0) + 1)
    for (const [k, n] of [...pr].sort((a, b) => b[1] - a[1])) console.log(`    ${n}× repræsentant ${k}`)
  }
  console.log('')
}
