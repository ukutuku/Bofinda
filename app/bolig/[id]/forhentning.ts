// ═══════════════════════════════════════════════════════════════
//  Lysbordets forhentning af naboerne — bundet til det VISTE billede.
//
//  Ren logik: ingen database, ingen React.
//
//  Galleri.tsx henter naboerne til det viste billede, når det selv er
//  hentet: den næste først, den forrige bagefter, én ad gangen. Kæden
//  hører til ÉN åbning og ÉT billede. Skifter brugeren billede, lukker
//  lysbordet eller forlader siden, er kæden forældet, og så skal den
//  stoppe MED DET SAMME — ikke først, når det næste hovedbillede er
//  hentet. Før gjorde den netop det: annulleringen lå i starten af den
//  næste kæde, så en forældet forhentning delte linjen med det billede,
//  brugeren ventede på, og dens færdig-kald startede den næste nabo til
//  et billede, ingen så længere — også efter lukning og afmontering.
//
//  Tre regler, og hver har en prøve i scripts/test-galleri-forhentning.ts:
//
//    1 · `skift` og `stop` fjerner kaldene fra ALT, der stadig hentes.
//        Et færdig-kald fra en kæde, der ikke længere er den aktuelle,
//        findes derfor ikke og kan ikke starte den næste nabo. Det er den
//        eneste mekanisme — et kædenummer oven i ville aldrig kunne blive
//        rødt (prøvet: modproever/forhentning-kald-bliver.mjs).
//    2 · `skift` og `stop` afbryder det, der stadig hentes — undtagen
//        det billede, der NU vises. Det henter browserens <img> også, og
//        en afbrydelse dér ville gøre det nye hovedbillede langsommere
//        eller hente det forfra. Det får sine kald fjernet og løber færdigt.
//    3 · Er hovedbilledet allerede i cachen, kan dets load komme FØR
//        effekten, der melder skiftet. Derfor sætter `start` selv det
//        viste billede, og `skift` til det samme billede gør ingenting —
//        ellers stoppede skiftet den kæde, load lige havde startet.
// ═══════════════════════════════════════════════════════════════

/** Det, kæden bruger af et `HTMLImageElement`. */
export interface Forhentningsbillede {
  onload: ((ev: Event) => unknown) | null
  onerror: ((ev: Event | string) => unknown) | null
  src: string
  readonly complete: boolean
}

export interface Forhentning {
  /** Billedet `vist` er hentet (eller fejlede): hent naboerne, én ad gangen. */
  start(vist: number, stor: readonly string[]): void
  /** Lysbordet viser nu `til` — `null` er lukket. Stopper den forældede kæde. */
  skift(til: number | null, stor: readonly string[]): void
  /** Afmontering: alt stopper, også det billede, der vistes. */
  stop(): void
}

interface Hentning { billede: Forhentningsbillede; url: string }

export function lavForhentning(lav: () => Forhentningsbillede = () => new Image()): Forhentning {
  let vist: number | null = null
  let aktive: Hentning[] = []

  /** Afbryd det, der hentes. `behold` er det viste billedes URL. */
  const afbryd = (behold?: string) => {
    const tilbage: Hentning[] = []
    for (const h of aktive) {
      h.billede.onload = null
      h.billede.onerror = null
      if (h.url === behold) { tilbage.push(h); continue }
      if (!h.billede.complete) h.billede.src = ''
    }
    // Det beholdte billede bliver på listen uden kald, så et senere
    // skift til et ANDET billede stadig kan afbryde det.
    aktive = tilbage
  }

  return {
    start(n, stor) {
      if (stor.length === 0) return
      vist = n
      const visesNu = stor[n]
      afbryd(visesNu)
      const hentet = new Set<string>(visesNu ? [visesNu] : [])
      const hent = (i: number, videre?: () => void) => {
        const url = stor[(i + stor.length) % stor.length]
        // To billeder: den næste og den forrige er den samme. Ét billede:
        // naboen er billedet selv. Ingen af dem hentes to gange.
        if (!url || hentet.has(url)) { videre?.(); return }
        hentet.add(url)
        const billede = lav()
        const h: Hentning = { billede, url }
        // Fejler en nabo, fortsættes der alligevel. Når kaldet kommer,
        // er kæden stadig den aktuelle — ellers havde `afbryd` fjernet det.
        const faerdig = () => {
          aktive = aktive.filter((a) => a !== h)
          videre?.()
        }
        billede.onload = faerdig
        billede.onerror = faerdig
        aktive.push(h)
        billede.src = url
      }
      hent(n + 1, () => hent(n - 1))
    },

    skift(til, stor) {
      if (til === vist) return
      vist = til
      afbryd(til == null ? undefined : stor[til])
    },

    stop() {
      vist = null
      afbryd()
    },
  }
}
