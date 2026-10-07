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
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

type Kortbillede = { src: string; srcSet: string | null }

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
  const liste = useRef<Promise<Kortbillede[]> | null>(null)
  const forhentet = useRef(new Set<string>())
  const beroering = useRef<{ x: number; y: number } | null>(null)
  const slugKlik = useRef(false)
  const [indeks, setIndeks] = useState(0)
  const [i_alt, setIAlt] = useState(antal)
  const [besked, setBesked] = useState('')

  const billede = () => ramme.current?.querySelector<HTMLImageElement>('.kort-billede img') ?? null

  // Listen hentes én gang pr. kort og kun ved hensigt.
  const hent = useCallback(() => {
    if (!liste.current) {
      liste.current = fetch(`/api/kortbilleder/${id}`)
        .then((r) => (r.ok ? r.json() : { billeder: [] }))
        .then((d: { billeder: Kortbillede[] }) => {
          if (d.billeder.length) setIAlt(d.billeder.length)
          return d.billeder
        })
        .catch(() => [])
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
    if (antal < 2) return
    // Den første nabo forhentes ved hensigt, så det første klik er
    // øjeblikkeligt. Forsidebilledet er allerede hentet.
    void hent().then((l) => forhent(l[1]))
  }, [antal, hent, forhent])

  const gaa = useCallback(async (retning: 1 | -1) => {
    const l = await hent()
    if (l.length < 2) return
    const naeste = (indeks + retning + l.length) % l.length
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
    setIndeks(naeste)
    setBesked(`Billede ${naeste + 1} af ${l.length}`)
    forhent(l[(naeste + retning + l.length) % l.length])
  }, [hent, forhent, indeks])

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
      void gaa(dx < 0 ? 1 : -1)
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
    void gaa(retning)
  }

  return (
    // Musens hensigt, ikke en finger, der ruller forbi: på touch er det
    // kun en berøring af selve billedet, der tæller (se `start` ovenfor).
    <div className="kortramme" ref={ramme}
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') hensigt() }}>
      {children}
      {antal > 1 && (
        <div className="kb-lag">
          <span className="kb-taeller" aria-hidden="true">
            <span className="kb-ikon" />{indeks + 1} / {i_alt}
          </span>
          <button type="button" className="kb-pil kb-forrige" aria-label="Forrige billede"
            onClick={pil(-1)} onFocus={hensigt}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className="kb-pil kb-naeste" aria-label="Næste billede"
            onClick={pil(1)} onFocus={hensigt}>
            <span aria-hidden="true">›</span>
          </button>
          <span className="sr-only" aria-live="polite">{besked}</span>
        </div>
      )}
    </div>
  )
}
