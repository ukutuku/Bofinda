// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  LYSBORDETS FORHENTNING — at en forældet kæde stopper.
//
//  app/bolig/[id]/forhentning.ts binder naboernes forhentning til det
//  viste billede. Fejlen, den retter, melder ingenting: en forhentning,
//  der løber videre efter et billedskift, en lukning eller en
//  afmontering, giver ingen fejl og intet forkert billede — kun spildte
//  1600px-hentninger, der deler linjen med det billede, brugeren venter
//  på. Derfor prøves den her, i to lag:
//
//    1 · Kæden alene, med et falsk billede, der aldrig når nettet: hver
//        hentning og hver afbrydelse logges, og et færdig-kald kan
//        komme når som helst — også efter at kæden er forældet.
//    2 · Den RIGTIGE Galleri.tsx, oversat med esbuild og kørt med
//        hook-attrapper, så ledningerne prøves: skift ved miniature,
//        piletast og swipe, lukning med knap og Esc, afmontering og
//        genåbning. Det er IKKE en browser — fokus, rigtige
//        netværkskald og browserens egen afbrydelse er målt med et
//        produktionsbyg (docs/hastighed-2026-10.md).
//
//      koeres uden database
// ═══════════════════════════════════════════════════════════════

import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { lavForhentning, type Forhentningsbillede } from '../app/bolig/[id]/forhentning'

let fejl = 0
const tjek = (n: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${n}${note ? `  — ${note}` : ''}`); if (!ok) fejl++
}

/** Et billede, der aldrig når nettet. Hver hentning og afbrydelse logges. */
class Falsk implements Forhentningsbillede {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  complete = false
  url = ''
  constructor(private log: string[], private alle: Falsk[]) { alle.push(this) }
  get src() { return this.url }
  set src(u: string) {
    if (u) { this.url = u; this.log.push(`hent ${u}`) } else this.log.push(`afbryd ${this.url}`)
  }
  faerdig(ok = true) { this.complete = true; (ok ? this.onload : this.onerror)?.() }
}

const STORE = Array.from({ length: 6 }, (_, i) => `stor-${i}`)

function opstil(store: readonly string[] = STORE) {
  const log: string[] = [], alle: Falsk[] = []
  const f = lavForhentning(() => new Falsk(log, alle))
  const hentning = (url: string) => alle.find((b) => b.url === url)!
  const hentet = () => log.filter((l) => l.startsWith('hent ')).map((l) => l.slice(5))
  return { f, log, alle, hentning, hentet, store }
}

console.log('\n══ 1 · kæden alene ══\n')

{
  const { f, hentet, hentning, store } = opstil()
  f.skift(0, store)
  tjek('intet hentes, før hovedbilledet er hentet', hentet().length === 0)
  f.start(0, store)
  tjek('hovedbilledet hentet → den NÆSTE først, og kun den', JSON.stringify(hentet()) === '["stor-1"]', hentet().join(', '))
  hentning('stor-1').faerdig()
  tjek('den næste færdig → så den forrige', JSON.stringify(hentet()) === '["stor-1","stor-5"]', hentet().join(', '))
}

{
  const { f, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store); hentning('stor-1').faerdig(false)
  tjek('en nabo, der fejler, stopper ikke kæden', hentet().includes('stor-5'), hentet().join(', '))
}

{
  const { f, log, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(3, store)
  tjek('spring til et andet billede → naboen afbrydes VED SKIFTET, ikke ved næste load',
    log.includes('afbryd stor-1'), log.join(' · '))
  const foer = hentet().length
  hentning('stor-1').faerdig()
  tjek('…og et sent færdig-kald fra den gamle kæde starter intet', hentet().length === foer, hentet().join(', '))
  f.start(3, store)
  tjek('det nye billedes kæde starter ved dets eget load', hentet().at(-1) === 'stor-4', hentet().join(', '))
}

{
  const { f, log, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(1, store) // næste, mens netop stor-1 forhentes
  tjek('skift til det billede, der forhentes → det afbrydes IKKE', !log.includes('afbryd stor-1'), log.join(' · '))
  const foer = hentet().length
  hentning('stor-1').faerdig()
  tjek('…men dets færdig-kald fortsætter ikke den gamle kæde (ingen stor-5)', hentet().length === foer, hentet().join(', '))
  f.start(1, store)
  tjek('det nye billedes kæde: stor-2 og derefter stor-0', hentet().slice(foer).join(',') === 'stor-2', hentet().join(', '))
  hentning('stor-2').faerdig()
  tjek('…og stor-0 bagefter', hentet().at(-1) === 'stor-0', hentet().join(', '))
}

{
  const { f, log, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(1, store)          // stor-1 vises og beholdes …
  f.skift(4, store)          // … brugeren forlader det, før det er hentet …
  tjek('det forladte billede hentes færdigt ét skridt endnu', !log.includes('afbryd stor-1'), log.join(' · '))
  f.skift(2, store)          // … og går videre igen
  tjek('…men afbrydes ved det næste skift', log.includes('afbryd stor-1'), log.join(' · '))
}

{
  const { f, log, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store)
  // Næste, næste, forrige — før stor-1 er hentet. Brugeren ender på det
  // billede, der lige blev forladt: afbrudt skulle det hentes forfra.
  f.skift(1, store); f.skift(2, store); f.skift(1, store)
  tjek('næste-næste-forrige: billedet, brugeren vender tilbage til, afbrydes aldrig',
    !log.includes('afbryd stor-1'), log.join(' · '))
  const foer = hentet().length
  hentning('stor-1').faerdig()
  tjek('…og dets færdig-kald starter intet', hentet().length === foer, hentet().join(', '))
}

{
  const { f, log, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(1, store)          // stor-1 beholdes som vist
  f.skift(null, store)       // lukning: det forladte beholdes IKKE
  tjek('lukning afbryder også det billede, der lige blev forladt', log.includes('afbryd stor-1'), log.join(' · '))
}

{
  const { f, log, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(null, store)
  tjek('lukning afbryder det, der hentes', log.includes('afbryd stor-1'), log.join(' · '))
  const foer = hentet().length
  hentning('stor-1').faerdig()
  tjek('…og et færdig-kald efter lukningen starter intet', hentet().length === foer, hentet().join(', '))
  f.skift(2, store); f.start(2, store)
  tjek('genåbning starter en ny kæde for det nye billede', hentet().at(-1) === 'stor-3', hentet().join(', '))
}

{
  const { f, log, hentet, hentning, store } = opstil()
  f.skift(0, store); f.start(0, store)
  f.skift(1, store)
  f.stop()
  tjek('afmontering afbryder alt — også det beholdte billede', log.includes('afbryd stor-1'), log.join(' · '))
  const foer = hentet().length
  hentning('stor-1').faerdig()
  tjek('…og intet starter bagefter', hentet().length === foer, hentet().join(', '))
}

{
  const { f, log, hentet, store } = opstil()
  f.skift(0, store)
  // Hovedbilledet lå i cachen: dets load kom FØR effekten, der melder skiftet.
  f.start(3, store)
  f.skift(3, store)
  tjek('load før skift-effekten → skiftet til samme billede stopper ikke kæden',
    !log.some((l) => l.startsWith('afbryd')) && hentet().join(',') === 'stor-4', log.join(' · '))
}

{
  const { f, hentet, store } = opstil()
  f.skift(0, store)
  f.skift(1, store); f.skift(2, store); f.skift(3, store)
  tjek('hurtige skift før noget er hentet → ingen hentninger', hentet().length === 0, hentet().join(', '))
  f.start(3, store)
  tjek('…og kun det sidste billedes nabo, når det er hentet', hentet().join(',') === 'stor-4', hentet().join(', '))
}

{
  const { f, hentet, hentning } = opstil()
  const to = ['stor-0', 'stor-1']
  f.skift(0, to); f.start(0, to); hentning('stor-1').faerdig()
  tjek('to billeder: naboen hentes én gang, ikke som både næste og forrige', hentet().join(',') === 'stor-1', hentet().join(', '))
  const { f: g, hentet: h2 } = opstil()
  g.skift(0, ['stor-0']); g.start(0, ['stor-0'])
  tjek('ét billede: ingen forhentning af billedet selv', h2().length === 0, h2().join(', '))
  const { f: t, hentet: h3 } = opstil()
  t.start(0, [])
  tjek('ingen billeder: ingenting', h3().length === 0)
}

console.log('\n══ 2 · den rigtige Galleri.tsx med hook-attrapper ══\n')

function oversaet(fil: string): string {
  return transformSync(readFileSync(fil, 'utf8'), {
    loader: fil.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs',
    jsx: 'transform', jsxFactory: 'h', jsxFragment: 'Fragment', target: 'es2022',
  }).code
}
const GALLERI = oversaet('app/bolig/[id]/Galleri.tsx')
const FORHENTNING = oversaet('app/bolig/[id]/forhentning.ts')

interface Knude { tag: unknown; props: Record<string, any>; children: Knude[] }

function galleri(antal = 6) {
  let markoer = 0, kroge: any[] = [], effekter: (() => void)[] = [], trae: Knude | null = null
  const log: string[] = [], alle: Falsk[] = []
  const lige = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    useState(v: unknown) {
      const i = markoer++; if (!(i in kroge)) kroge[i] = { v }
      return [kroge[i].v, (x: any) => { kroge[i].v = typeof x === 'function' ? x(kroge[i].v) : x }]
    },
    useRef(v: unknown) { const i = markoer++; if (!(i in kroge)) kroge[i] = { current: v }; return kroge[i] },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = markoer++; if (!kroge[i] || !lige(kroge[i].deps, deps)) kroge[i] = { fn, deps }; return kroge[i].fn
    },
    useEffect(fn: () => (() => void) | void, deps: unknown[]) {
      const i = markoer++; const gl = kroge[i]
      if (!gl || !lige(gl.deps, deps)) {
        const plads = kroge[i] = { deps, oprydning: gl?.oprydning, effekt: true }
        effekter.push(() => { plads.oprydning?.(); plads.oprydning = fn() })
      }
    },
  }
  const lyttere = new Map<string, (e: unknown) => void>()
  const dialog = { open: false, showModal() { this.open = true }, close() { this.open = false } }
  const kontekst: Record<string, unknown> = {
    h: (tag: unknown, props: Record<string, unknown> | null, ...b: unknown[]) =>
      ({ tag, props: props ?? {}, children: b.flat(Infinity).filter((x) => x != null && x !== false) }),
    Fragment: 'fragment',
    Image: class extends Falsk { constructor() { super(log, alle) } },
    window: { addEventListener: (t: string, f: any) => lyttere.set(t, f), removeEventListener: (t: string) => lyttere.delete(t) },
    document: { body: { style: { overflow: '' } } },
    console,
  }
  const modul = (kode: string, kraev: (n: string) => unknown) => {
    const m = { exports: {} as Record<string, any> }
    runInNewContext(kode, { ...kontekst, module: m, exports: m.exports, require: kraev })
    return m.exports
  }
  const forhentning = modul(FORHENTNING, (n) => { throw new Error(n) })
  const { Galleri } = modul(GALLERI, (n) => {
    if (n === 'react') return react
    if (n === './forhentning') return forhentning
    throw new Error(`uventet import: ${n}`)
  })
  const billeder = Array.from({ length: antal }, (_, i) => ({ lille: `lille-${i}`, stor: `stor-${i}`, mini: `mini-${i}` }))
  const knuder = (k: Knude | null = trae): Knude[] => (k && typeof k === 'object' ? [k, ...k.children.flatMap((c) => knuder(c))] : [])
  const find = (p: (k: Knude) => boolean) => { const k = knuder().find(p); if (!k) throw new Error('knuden findes ikke'); return k }
  const tegn = () => {
    markoer = 0; effekter = []
    trae = Galleri({ billeder }) as Knude
    for (const k of knuder()) if (k.props.ref) k.props.ref.current = dialog
    effekter.forEach((e) => e())
  }
  const hentet = () => log.filter((l) => l.startsWith('hent ')).map((l) => l.slice(5))
  const hovedbillede = () => find((k) => k.props.className === 'lys-billede')
  return {
    log, hentet, dialog,
    hentning: (url: string) => alle.find((b) => b.url === url)!,
    tegn,
    aabn() { tegn(); find((k) => k.props['aria-label'] === 'Åbn billede 1').props.onClick(); tegn() },
    hovedHentet() { hovedbillede().props.onLoad() },
    hovedFejlede() { hovedbillede().props.onError() },
    vist: () => hovedbillede().props.src as string,
    miniature(i: number) { find((k) => k.props['aria-label'] === `Billede ${i + 1}`).props.onClick(); tegn() },
    tast(key: string) { lyttere.get('keydown')?.({ key }); tegn() },
    swipe(fra: number, til: number) {
      const d = find((k) => k.props.className === 'lysbord')
      d.props.onTouchStart({ touches: [{ clientX: fra }] }); d.props.onTouchEnd({ changedTouches: [{ clientX: til }] }); tegn()
    },
    luk() { find((k) => k.props.className === 'luk').props.onClick(); tegn() },
    esc() { find((k) => k.props.className === 'lysbord').props.onCancel({ preventDefault() {} }); tegn() },
    afmonter() { for (const k of kroge) if (k?.effekt) k.oprydning?.(); trae = null },
  }
}

{
  const g = galleri()
  g.aabn()
  tjek('åbning: hovedbilledet først — ingen nabo, før det er hentet', g.hentet().length === 0 && g.vist() === 'stor-0')
  g.hovedHentet()
  tjek('hovedbilledet hentet → stor-1', g.hentet().join(',') === 'stor-1', g.hentet().join(', '))
  g.miniature(3)
  tjek('miniature før naboen er hentet → stor-1 afbrudt VED KLIKKET', g.log.includes('afbryd stor-1'), g.log.join(' · '))
  const foer = g.hentet().length
  g.hentning('stor-1').faerdig()
  tjek('…og dens sene færdig-kald starter intet', g.hentet().length === foer, g.hentet().join(', '))
  g.hovedHentet()
  tjek('billede 4 hentet → dets nabo stor-4', g.hentet().at(-1) === 'stor-4' && g.vist() === 'stor-3', g.hentet().join(', '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.tast('ArrowRight')
  tjek('piletast til det billede, der forhentes → ikke afbrudt, og vises', !g.log.includes('afbryd stor-1') && g.vist() === 'stor-1',
    g.log.join(' · '))
  const foer = g.hentet().length
  g.hentning('stor-1').faerdig()
  tjek('…den gamle kæde fortsætter ikke til stor-5', g.hentet().length === foer, g.hentet().join(', '))
  g.hovedHentet()
  tjek('…den nye kæde starter ved hovedbilledets load: stor-2', g.hentet().at(-1) === 'stor-2', g.hentet().join(', '))
  g.tast('ArrowLeft')
  tjek('piletast tilbage → stor-2 afbrudt', g.log.includes('afbryd stor-2') && g.vist() === 'stor-0', g.log.join(' · '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.tast('ArrowRight'); g.tast('ArrowRight'); g.tast('ArrowLeft')
  tjek('piletaster næste-næste-forrige → stor-1 afbrydes aldrig, og det vises',
    !g.log.includes('afbryd stor-1') && g.vist() === 'stor-1', g.log.join(' · '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.swipe(300, 100)
  tjek('swipe mod venstre → næste billede', g.vist() === 'stor-1')
  g.hovedFejlede()
  tjek('hovedbilledet fejler → naboerne hentes alligevel', g.hentet().at(-1) === 'stor-2', g.hentet().join(', '))
  g.swipe(100, 300)
  tjek('swipe mod højre → forrige, og stor-2 afbrydes', g.vist() === 'stor-0' && g.log.includes('afbryd stor-2'), g.log.join(' · '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.luk()
  tjek('luk-knappen → dialogen lukket og stor-1 afbrudt', !g.dialog.open && g.log.includes('afbryd stor-1'), g.log.join(' · '))
  const foer = g.hentet().length
  g.hentning('stor-1').faerdig()
  tjek('…og et færdig-kald efter lukningen starter intet', g.hentet().length === foer, g.hentet().join(', '))
  g.aabn()
  tjek('genåbning: intet hentet før hovedbilledet', g.hentet().length === foer && g.dialog.open)
  g.hovedHentet()
  tjek('…og så stor-1 igen, i en ny kæde', g.hentet().at(-1) === 'stor-1' && g.hentet().length === foer + 1, g.hentet().join(', '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.esc()
  tjek('Esc → lukket og stor-1 afbrudt', !g.dialog.open && g.log.includes('afbryd stor-1'), g.log.join(' · '))
}

{
  const g = galleri()
  g.aabn(); g.hovedHentet()
  g.afmonter()
  tjek('afmontering → stor-1 afbrudt', g.log.includes('afbryd stor-1'), g.log.join(' · '))
  const foer = g.hentet().length
  g.hentning('stor-1').faerdig()
  tjek('…og intet starter bagefter', g.hentet().length === foer, g.hentet().join(', '))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
