'use client'

// ═══════════════════════════════════════════════════════════════
//  Klienttrackeren. Fem events, ingen ramme.
//
//  Den kender HVERKEN anonymous_id ELLER session_id. Cookierne er
//  HttpOnly og følger med af sig selv, fordi /api/maaling er samme
//  oprindelse — så klienten kan ikke forfalske en identitet, og den kan
//  ikke sende et event, serveren ikke ville have accepteret: ruten kører
//  samme allowlist som serversiden.
//
//  KØEN OG NØGLERNE LIGGER PÅ MODULNIVEAU, ikke i state. Det er dét, der
//  overlever React StrictMode's dobbelt-mount i udvikling — og det er
//  hele grunden til, at re-render ikke kan give dubletter.
// ═══════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import type { Eventnavn } from '../lib/maaling'

interface Post {
  navn: Eventnavn
  props: Record<string, unknown>
  listingId?: string
  sourceSlug?: string
  /** Hvor eventet skete. Valideres mod RUTER paa serveren. */
  rute?: string
}

const koe: Post[] = []
const sendte = new Set<string>()
let tilsluttet = false
/** Loebenummer pr. formularindsendelse. Paa modulniveau som `sendte`, saa
 *  dedupnoeglen er unik ogsaa efter en genmontering — en fast noegle ville
 *  lade den ANDEN indsendelse med de samme filtre forsvinde. */
let indsendelser = 0

function laeg(p: Post, noegle: string) {
  if (sendte.has(noegle)) return
  sendte.add(noegle)
  koe.push(p)
  if (koe.length >= 25) tom()
}

function tom() {
  if (!koe.length) return
  const krop = JSON.stringify({ events: koe.splice(0, koe.length) })
  try {
    // sendBeacon overlever, at siden lukkes. keepalive er reserven.
    if (!navigator.sendBeacon?.('/api/maaling', new Blob([krop], { type: 'application/json' }))) {
      void fetch('/api/maaling', {
        method: 'POST', body: krop, keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {})
    }
  } catch { /* maaling maa aldrig kaste ind i siden */ }
}

/** Andre klientkomponenter melder ind her i stedet for at kende køen. */
export function meld(navn: Eventnavn, props: Record<string, unknown> = {}, ekstra: Partial<Post> = {}) {
  try {
    window.dispatchEvent(new CustomEvent('bofinda:maaling', {
      detail: { navn, props, ...ekstra },
    }))
  } catch { /* ingen */ }
}

export function Maaling({ aktiv, impressions, visning, rute }: {
  aktiv: boolean
  impressions: boolean
  visning: string | null
  /** Rutemoenstret, ikke adressen. Serveren kender det; browseren ikke. */
  rute: string
}) {
  useEffect(() => {
    if (!aktiv || tilsluttet) return
    tilsluttet = true

    const send = () => tom()
    const paaSkjult = () => { if (document.visibilityState === 'hidden') tom() }
    document.addEventListener('visibilitychange', paaSkjult)
    window.addEventListener('pagehide', send)

    // ── filter_opened ──────────────────────────────────────────
    // `toggle` bobler ikke; derfor capture.
    const paaToggle = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'DETAILS' && t.classList.contains('flere')
        && (t as HTMLDetailsElement).open) {
        laeg({ navn: 'filter_opened', props: {}, rute }, 'filter_opened')
      }
    }
    document.addEventListener('toggle', paaToggle, true)

    // ── search_submitted ───────────────────────────────────────
    // En OBSERVERET indsendelse af soegeformularen. Serveren kan ikke se
    // forskel paa en indsendelse og et klik paa et pagineringslink:
    // begge er en GET-navigation med de samme headere. Derfor her.
    //
    // Syv krav fra docs/analytics-v1.md §7b, og hvordan de er mødt:
    //  1 · `submit`, ikke knappens `click` — saa baade «Søg», «Find bolig»
    //      og Enter i et tekstfelt daekkes af ÉN lytter, der fyrer én gang.
    //  2 · Noeglen er unik pr. indsendelse. `laeg()` dedupliker paa et
    //      modulglobalt Set, saa en fast noegle ville lade den ANDEN
    //      indsendelse med de samme filtre forsvinde. Taelleren ligger paa
    //      modulniveau ved siden af `sendte`, saa den overlever
    //      StrictModes dobbelt-mount — samme grund som koeen selv.
    //  3 · En afvist eller annulleret indsendelse taeller ikke. `submit`
    //      fyrer slet ikke, naar HTML-validering fejler. Kalder en anden
    //      handler `preventDefault()`, skal vi respektere det — derfor
    //      lyttes UDEN capture, saa vi koerer sidst, og
    //      `e.defaultPrevented` laeses.
    //  4 · Paginering, reload og tilbage/frem roerer den ikke: «Naeste» og
    //      «Forrige» er almindelige <a>, og de udloeser ingen `submit`.
    //  5 · Maalingen maa ikke forsinke soegningen. `laeg()` lægger i koeen
    //      og returnerer; intet `await`, intet `preventDefault`.
    //  6 · Uden samtykke sker der intet: effekten her koerer kun naar
    //      `aktiv` er sand.
    //  7 · Ingen properties. Filterkonteksten staar paa det `search`, der
    //      foelger i samme session.
    const paaSubmit = (e: Event) => {
      if (e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.matches?.('form.filtre')) {
        laeg({ navn: 'search_submitted', props: {}, rute }, `sub:${++indsendelser}`)
      }
    }
    document.addEventListener('submit', paaSubmit)

    // ── alert_started ──────────────────────────────────────────
    // Første tastetryk i gem-formularen. ALDRIG feltets indhold.
    const paaInput = (e: Event) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('form.gem')) laeg({ navn: 'alert_started', props: {}, rute }, 'alert_started')
    }
    document.addEventListener('input', paaInput, true)

    // ── Indmeldinger fra andre komponenter ─────────────────────
    const paaMeld = (e: Event) => {
      const d = (e as CustomEvent).detail as Post & { noegle?: string }
      if (!d?.navn) return
      laeg(
        { navn: d.navn, props: d.props ?? {}, listingId: d.listingId, sourceSlug: d.sourceSlug, rute },
        d.noegle ?? `${d.navn}:${JSON.stringify(d.props ?? {})}:${d.listingId ?? ''}`,
      )
    }
    window.addEventListener('bofinda:maaling', paaMeld)

    // ── listing_impression ─────────────────────────────────────
    // ≥50 % synlig i ≥1000 ms. Ikke ved render, og ikke ved et enkelt
    // frames gennemsving under en hurtig scroll.
    let io: IntersectionObserver | null = null
    const ure = new Map<Element, ReturnType<typeof setTimeout>>()
    if (impressions && visning && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((poster) => {
        for (const p of poster) {
          const el = p.target as HTMLElement
          if (p.isIntersecting && p.intersectionRatio >= 0.5) {
            if (ure.has(el)) continue
            ure.set(el, setTimeout(() => {
              ure.delete(el)
              const id = el.dataset.bolig
              if (!id) return
              laeg({
                navn: 'listing_impression',
                listingId: id,
                sourceSlug: el.dataset.kilde,
                rute,
                props: {
                  result_view_id: visning,
                  position: Number(el.dataset.position ?? 0),
                  er_gruppe: el.dataset.gruppe === '1',
                  ...(el.dataset.gruppeAntal ? { gruppe_antal: Number(el.dataset.gruppeAntal) } : {}),
                },
              }, `imp:${visning}:${id}`)
              io?.unobserve(el)
            }, 1000))
          } else {
            const u = ure.get(el)
            if (u) { clearTimeout(u); ure.delete(el) }
          }
        }
      }, { threshold: [0, 0.5, 1] })
      for (const el of document.querySelectorAll('a.kort[data-bolig]')) io.observe(el)
    }

    return () => {
      document.removeEventListener('visibilitychange', paaSkjult)
      window.removeEventListener('pagehide', send)
      document.removeEventListener('toggle', paaToggle, true)
      document.removeEventListener('submit', paaSubmit)
      document.removeEventListener('input', paaInput, true)
      window.removeEventListener('bofinda:maaling', paaMeld)
      for (const u of ure.values()) clearTimeout(u)
      io?.disconnect()
      tilsluttet = false
      tom()
    }
  }, [aktiv, impressions, visning, rute])

  return null
}
