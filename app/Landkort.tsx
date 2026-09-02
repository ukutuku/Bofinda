'use client'

// ═══════════════════════════════════════════════════════════════
//  Kortet ved siden af listen.
//
//  Fliserne kommer fra OpenStreetMaps egen tjeneste. Den er
//  donationsdrevet, og deres Tile Usage Policy stiller krav, som er
//  bygget ind her:
//
//    · Præcis URL'en https://tile.openstreetmap.org/{z}/{x}/{y}.png
//    · Synlig kreditering, aldrig skjult bag en knap
//    · Kun fliserne til det, brugeren ser nu — ingen forhentning,
//      ingen offline, ingen scanning af områder
//    · Ingen restriktiv Referrer-Policy (vi sætter ingen)
//    · "Report a map issue"-link, som de anbefaler
//
//  URL'en er IKKE hardkodet. Politikkens afsnit 7 siger, at adgang kan
//  trækkes uden varsel, og at kommercielle tjenester særligt skal regne
//  med det. Bofinda er en kommerciel tjeneste. Derfor kan flisekilden
//  skiftes med en miljøvariabel i stedet for en kodeændring.
//
//  Kortet indlæses først, når det er synligt: Leaflet hentes i en
//  dynamisk import fra en IntersectionObserver. Rammer man aldrig
//  kortet, betaler man ikke for det.
// ═══════════════════════════════════════════════════════════════

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'

export interface Maerke {
  id: string
  lat: number
  lng: number
  /** Antal boliger bag mærket. 1 for et enkeltkort. */
  antal: number
  etiket: string
}

const FLISER = process.env.NEXT_PUBLIC_FLISE_URL
  ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const KREDIT = process.env.NEXT_PUBLIC_FLISE_KREDIT
  ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragydere'
  + ' &middot; <a href="https://www.openstreetmap.org/fixthemap">Meld en fejl i kortet</a>'

export function Landkort({ maerker }: { maerker: Maerke[] }) {
  const boks = useRef<HTMLDivElement>(null)
  const kort = useRef<LeafletMap | null>(null)
  const lag = useRef<LayerGroup | null>(null)
  const [synlig, setSynlig] = useState(false)
  const [valgt, setValgt] = useState<string | null>(null)

  // ── Indlæs først når kortet er i syne ────────────────────────
  //
  // To målinger, ikke én. IntersectionObserver er den rigtige og fanger
  // ogsaa de tilfaelde, hvor kortet bliver synligt UDEN at nogen ruller —
  // en blok ovenfor der klapper sammen, en resize, en indlejret visning.
  // Men en indlaesning, der stille lader vaere med at ske, er den vaerste
  // slags fejl, saa maalingen paa afstand ligger ved siden af som net.
  useEffect(() => {
    if (synlig) return
    const naer = () => {
      const el = boks.current
      if (!el) return false
      const r = el.getBoundingClientRect()
      // 200 px foer kanten, saa kortet naar at staa klar.
      return r.top < window.innerHeight + 200 && r.bottom > -200
    }
    if (naer()) { setSynlig(true); return }

    const se = () => { if (naer()) setSynlig(true) }
    window.addEventListener('scroll', se, { passive: true })
    window.addEventListener('resize', se, { passive: true })

    let obs: IntersectionObserver | undefined
    if (typeof IntersectionObserver === 'function' && boks.current) {
      obs = new IntersectionObserver((e) => {
        if (e.some((x) => x.isIntersecting)) setSynlig(true)
      }, { rootMargin: '200px' })
      obs.observe(boks.current)
    }
    return () => {
      window.removeEventListener('scroll', se)
      window.removeEventListener('resize', se)
      obs?.disconnect()
    }
  }, [synlig])

  // ── Byg kortet ───────────────────────────────────────────────
  useEffect(() => {
    if (!synlig || !boks.current || kort.current) return
    let doed = false
    ;(async () => {
      const L = (await import('leaflet')).default
      if (doed || !boks.current) return
      const m = L.map(boks.current, { scrollWheelZoom: false, attributionControl: true })
      L.tileLayer(FLISER, { attribution: KREDIT, maxZoom: 18 }).addTo(m)
      kort.current = m
      lag.current = L.layerGroup().addTo(m)
      tegn(L, m, lag.current)
    })()
    return () => { doed = true }
  }, [synlig])

  // ── Tegn mærkerne, og igen når listen skifter ────────────────
  useEffect(() => {
    if (!kort.current || !lag.current) return
    ;(async () => {
      const L = (await import('leaflet')).default
      tegn(L, kort.current!, lag.current!)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maerker, valgt])

  function tegn(
    L: typeof import('leaflet'),
    m: LeafletMap,
    g: LayerGroup,
  ) {
    g.clearLayers()
    if (!maerker.length) { m.setView([56.0, 10.5], 6); return }
    for (const mk of maerker) {
      const eralgt = valgt === mk.id
      const ikon = L.divIcon({
        className: 'maerke-ikon',
        html: `<span class="maerke-boble${eralgt ? ' valgt' : ''}">${mk.antal > 1 ? mk.antal : ''}</span>`,
        iconSize: [mk.antal > 1 ? 30 : 18, mk.antal > 1 ? 30 : 18],
      })
      L.marker([mk.lat, mk.lng], { icon: ikon, title: mk.etiket })
        .on('click', () => vaelg(mk.id))
        .addTo(g)
    }
    const b = L.latLngBounds(maerker.map((x) => [x.lat, x.lng] as [number, number]))
    m.fitBounds(b, { padding: [28, 28], maxZoom: 15 })
  }

  /** Klik paa et maerke fremhaever kortet i listen og ruller det frem. */
  function vaelg(id: string) {
    setValgt(id)
    const el = document.getElementById(`kort-${id}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('fremhaevet')
    window.setTimeout(() => el.classList.remove('fremhaevet'), 2200)
  }

  // ── Den anden vej: listen fremhaever maerket ─────────────────
  useEffect(() => {
    const paa = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-bolig]')
      if (el) setValgt(el.getAttribute('data-bolig'))
    }
    const liste = document.querySelector('.liste')
    liste?.addEventListener('mouseover', paa)
    liste?.addEventListener('focusin', paa)
    return () => {
      liste?.removeEventListener('mouseover', paa)
      liste?.removeEventListener('focusin', paa)
    }
  }, [])

  return <div ref={boks} className="landkort-flade" aria-label="Kort over boligerne" />
}
