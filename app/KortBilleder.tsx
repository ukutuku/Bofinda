'use client'

// ═══════════════════════════════════════════════════════════════
//  Bladring i et boligkorts billeder — direkte på kortet.
//
//  PILENE STÅR UDEN FOR KORTLINKET. Kortet er ét <a>, og en knap inde i
//  et link er to interaktive elementer i ét: skærmlæsere læser dem
//  sammen, og et klik på pilen ville også være et klik på linket. Her er
//  rammen en <div> med linket og pilene som SØSKENDE; pilene ligger
//  visuelt oven på billedet, men et klik på dem rammer aldrig linket.
//
//  INTET HENTES VED SIDEVISNING. Kortet har forsidebilledet (lazy, eller
//  eager på det øverste kort — se `Billedprioritet` i Boligkort.tsx) og
//  antallet. Billedlisten hentes FØRST, når nogen viser hensigt: musen
//  kommer ind over kortet, en pil får fokus, eller en finger rører
//  billedet. Derefter forhentes kun NABOEN i den retning, der bladres —
//  ét billede ad gangen, aldrig hele listen.
//
//  SWIPE på billedet. `touch-action: pan-y` på billedfeltet (globals.css)
//  lader browseren rulle lodret og overlader det vandrette til os, så et
//  swipe hverken ruller siden sidelæns eller går tilbage i historikken.
//  Et swipe efterfølges af et klik fra browseren; det sluges, så swipet
//  ikke også åbner annoncen.
//
//  ── ET TRYK, MENS LISTEN HENTES, TABES IKKE (K13) ──────────────
//
//  Det viste billedes plads står i en REF (`nu`), ikke kun i React-
//  tilstanden. Før regnede `gaa()` det næste billede EFTER `await hent()`
//  — men ud fra den `indeks`, renderen havde lukket over. To tryk, før
//  listen kom, regnede derfor begge fra billede 1: næste+næste gav 2/5,
//  næste+forrige gav 5/5.
//
//  Nu lægges hvert accepteret tryk i `vent` (et skridt, +1 eller −1) i
//  det øjeblik, det sker, og det første svar efter listen udfører ALLE
//  ventende skridt på én gang mod `nu`. At bladre er addition modulo N,
//  så summen er præcis det samme som at udføre trykkene i rækkefølge —
//  og kun det billede, de ender på, hentes. Pile, tastatur (Enter på en
//  pil er et klik) og swipe går alle gennem `gaa()`.
//
//  ── EN FEJL ER IKKE EN TOM LISTE (K14) ─────────────────────────
//
//  Før blev et HTTP-fejlsvar og et afvist `fetch` til `[]`, og det tomme
//  løfte lå i `liste` for altid: pilene stod, men intet tryk forsøgte
//  igen, og intet blev sagt. Nu er svaret en af to ting:
//
//    · `{ ok: true, billeder }` — gyldigt, også tomt. Gemmes. Har det
//      færre end to billeder, er der intet at blade i, og pilene og
//      tælleren forsvinder (ingen døde pile).
//    · `{ ok: false }` — HTTP-fejl, netværksfejl eller et svar, vi ikke
//      kan læse. Gemmes IKKE: `liste` ryddes, forsidebilledet bliver
//      stående, og har en person trykket, står der en besked — synligt og
//      i aria-live. En fejl, der KUN kom af en hensigt, er tavs: ingen bad
//      om et billede endnu. Fejler et genforsøg igen, siges det igen.
//
//  Kun en NY, eksplicit navigation (pil, Enter, swipe) forsøger igen —
//  aldrig en timer, og ikke en hensigt (mus ind, fokus): efter en fejl
//  ville hver musebevægelse over kortet ellers blive et nyt kald. Der er
//  højst ét igangværende listekald pr. kort; tryk under et kald venter
//  på DET kald. Fejler kaldet, er trykkene, der ventede på det, tabt —
//  de genspilles ikke, for det ville være et forsøg, ingen bad om.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

type Kortbillede = { src: string; srcSet: string | null }

/** Svaret fra billedlisten. Fejlen er sin egen gren — ikke en tom liste. */
type Liste = { ok: true; billeder: Kortbillede[] } | { ok: false }
const FEJL: Liste = { ok: false }

/** Et svar, vi kan stole på. Alt andet er en fejl, ikke «ingen billeder». */
const gyldig = (d: unknown): d is { billeder: Kortbillede[] } => {
  const b = (d as { billeder?: unknown } | null)?.billeder
  return Array.isArray(b) && b.every((x: unknown) => {
    const k = x as Partial<Kortbillede> | null
    return typeof k?.src === 'string' && (k.srcSet === null || typeof k.srcSet === 'string')
  })
}

/** Teksten, når listen ikke kunne hentes. Står både synligt og i aria-live.
 *  «De øvrige»: forsidebilledet ER hentet — det er listen over resten, der
 *  mangler. «med pilene»: beskeden tager ikke imod klik (et klik på den
 *  åbner annoncen), så den peger på det, der faktisk forsøger igen. */
const FEJLTEKST = 'De øvrige billeder kunne ikke hentes. Prøv igen med pilene.'
/** Et gyldigt svar med under to billeder: pilene forsvinder. */
const INGEN_FLERE = 'Der er ikke flere billeder af denne bolig.'

/** Vandret bevægelse i px, før en berøring er et swipe og ikke et tryk. */
const SWIPE = 40

export function KortRamme({ id, antal, children }: {
  /** Boligens id — repræsentantens på et gruppekort. */
  id: string
  /** Antal VISBARE billeder, som søgningen talte dem (`billeder`). */
  antal: number
  children: React.ReactNode
}) {
  const ramme = useRef<HTMLDivElement>(null)
  /** Det igangværende ELLER det vellykkede listekald. Aldrig et fejlet. */
  const liste = useRef<Promise<Liste> | null>(null)
  /** Fejlede det seneste kald? Så forsøger kun en eksplicit navigation igen. */
  const fejlet = useRef(false)
  /** Det viste billedes plads. Sandheden — `indeks` er dens afspejling. */
  const nu = useRef(0)
  /** Accepterede tryk, der endnu ikke er udført: antal og samlet skridt. */
  const vent = useRef({ tryk: 0, skridt: 0 })
  const forhentet = useRef(new Set<string>())
  const beroering = useRef<{ x: number; y: number } | null>(null)
  const slugKlik = useRef(false)
  const [indeks, setIndeks] = useState(0)
  const [i_alt, setIAlt] = useState(antal)
  const [besked, setBesked] = useState('')
  const [fejl, setFejl] = useState(false)
  /** Falsk, når et GYLDIGT svar har færre end to billeder. */
  const [bladring, setBladring] = useState(true)

  const billede = () => ramme.current?.querySelector<HTMLImageElement>('.kort-billede img') ?? null

  // Ét kald ad gangen pr. kort. Et vellykket svar gemmes; et fejlet
  // ryddes, så det næste eksplicitte forsøg henter igen.
  const hent = useCallback((): Promise<Liste> => {
    if (!liste.current) {
      fejlet.current = false
      const kald: Promise<Liste> = fetch(`/api/kortbilleder/${id}`)
        .then(async (r): Promise<Liste> => {
          if (!r.ok) return FEJL
          const d: unknown = await r.json()
          return gyldig(d) ? { ok: true, billeder: d.billeder } : FEJL
        })
        .catch((): Liste => FEJL)
        .then((svar) => {
          if (!svar.ok) {
            if (liste.current === kald) liste.current = null
            fejlet.current = true
            return svar
          }
          if (svar.billeder.length >= 2) {
            setIAlt(svar.billeder.length)
          } else {
            // Intet at blade i. Står fokus på en pil, flyttes det til
            // kortet, før pilene forsvinder — ellers lander det på <body>.
            // Og der siges hvorfor, så springet ikke er uforklaret.
            const r = ramme.current
            const aktiv = r?.ownerDocument?.activeElement
            if (r && aktiv && r.querySelector('.kb-lag')?.contains(aktiv)) {
              r.querySelector<HTMLElement>('a.kort')?.focus()
              setBesked(INGEN_FLERE)
            }
            setBladring(false)
          }
          return svar
        })
      liste.current = kald
    }
    return liste.current
  }, [id])

  // Ét billede forhentes med SAMME srcset og sizes som kortets <img>, så
  // browseren vælger den samme bredde, og forhentningen ikke er spildt.
  const forhent = useCallback((b: Kortbillede | undefined) => {
    const img = billede()
    if (!b || !img || forhentet.current.has(b.src)) return
    forhentet.current.add(b.src)
    const f = new Image()
    if (img.sizes) f.sizes = img.sizes
    if (b.srcSet) f.srcset = b.srcSet
    f.src = b.src
  }, [])

  const hensigt = useCallback(() => {
    // Efter en fejl forsøger kun en eksplicit navigation igen — en
    // musebevægelse over kortet må ikke blive et nyt kald.
    if (antal < 2 || fejlet.current) return
    void hent().then((svar) => {
      if (!svar.ok || svar.billeder.length < 2) return
      const l = svar.billeder
      forhent(l[(nu.current + 1) % l.length])
    })
  }, [antal, hent, forhent])

  // Det fælles forløb for pile, tastatur og swipe.
  const gaa = useCallback((retning: 1 | -1) => {
    vent.current.tryk++
    vent.current.skridt += retning
    // En ny eksplicit navigation: en tidligere fejlbesked gælder ikke
    // længere — enten forsøges der igen, eller listen er allerede her.
    // Er det et genforsøg, ryddes også aria-live-teksten: fejler det igen,
    // er beskeden ellers den SAMME tekst, React rører ikke DOM'en, og
    // skærmlæseren hører intet om, at forsøget blev gjort og fejlede.
    if (fejlet.current) setBesked('')
    setFejl(false)
    void hent().then((svar) => {
      // Det første svar efter listen udfører ALLE ventende tryk; de
      // øvrige finder køen tom.
      const { tryk, skridt } = vent.current
      if (tryk === 0) return
      vent.current = { tryk: 0, skridt: 0 }
      if (!svar.ok) {
        setFejl(true)
        setBesked(FEJLTEKST)
        return
      }
      const l = svar.billeder
      if (l.length < 2) {
        setBesked(INGEN_FLERE)
        return
      }
      const naeste = (((nu.current + skridt) % l.length) + l.length) % l.length
      if (naeste !== nu.current) {
        const img = billede()
        const b = l[naeste]!
        if (img) {
          // Billedet er synligt nu; et nyt `src` på et lazy billede, der er
          // i visningen, hentes straks.
          if (b.srcSet) img.srcset = b.srcSet
          else img.removeAttribute('srcset')
          img.src = b.src
          img.dataset.indeks = String(naeste)
        }
        nu.current = naeste
        setIndeks(naeste)
      }
      setBesked(`Billede ${naeste + 1} af ${l.length}`)
      // Naboen i den retning, trykkene gik. Gik de i nul, ingen.
      if (skridt !== 0) forhent(l[(naeste + Math.sign(skridt) + l.length) % l.length])
    })
  }, [hent, forhent])

  // Swipe og det klik, browseren sender bagefter.
  useEffect(() => {
    const r = ramme.current
    if (!r || antal < 2) return
    const feltet = (e: Event) => (e.target as Element | null)?.closest('.kort-billede')
    const start = (e: TouchEvent) => {
      if (!feltet(e) || e.touches.length !== 1) return
      beroering.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
      hensigt()
    }
    const slut = (e: TouchEvent) => {
      const s = beroering.current
      beroering.current = null
      if (!s) return
      const t = e.changedTouches[0]!
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return
      slugKlik.current = true
      window.setTimeout(() => { slugKlik.current = false }, 500)
      gaa(dx < 0 ? 1 : -1)
    }
    const klik = (e: MouseEvent) => {
      if (!slugKlik.current) return
      slugKlik.current = false
      e.preventDefault()
      e.stopPropagation()
    }
    r.addEventListener('touchstart', start, { passive: true })
    r.addEventListener('touchend', slut, { passive: true })
    r.addEventListener('click', klik, true)
    return () => {
      r.removeEventListener('touchstart', start)
      r.removeEventListener('touchend', slut)
      r.removeEventListener('click', klik, true)
    }
  }, [antal, gaa, hensigt])

  const pil = (retning: 1 | -1) => (e: React.MouseEvent<HTMLButtonElement>) => {
    // Knappen står uden for linket, men stoppes alligevel: intet over
    // os må tolke klikket som et klik på kortet.
    e.preventDefault()
    e.stopPropagation()
    gaa(retning)
  }

  return (
    // Musens hensigt, ikke en finger, der ruller forbi: på touch er det
    // kun en berøring af selve billedet, der tæller (se `start` ovenfor).
    <div className="kortramme" ref={ramme}
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') hensigt() }}>
      {children}
      {antal > 1 && bladring && (
        <div className="kb-lag">
          <span className="kb-taeller" aria-hidden="true">
            <span className="kb-ikon" />{indeks + 1} / {i_alt}
          </span>
          {/* Synlig udgave af beskeden. Skærmlæseren får den fra
              aria-live nedenfor, så den læses ikke to gange. */}
          {fejl && <span className="kb-fejl" aria-hidden="true">{FEJLTEKST}</span>}
          <button type="button" className="kb-pil kb-forrige" aria-label="Forrige billede"
            onClick={pil(-1)} onFocus={hensigt}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="kb-pil kb-naeste" aria-label="Næste billede"
            onClick={pil(1)} onFocus={hensigt}>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      {/* Uden for laget: beskeden skal kunne læses, også når laget er
          væk, fordi listen viste sig at have under to billeder. */}
      {antal > 1 && <span className="sr-only" aria-live="polite">{besked}</span>}
    </div>
  )
}
