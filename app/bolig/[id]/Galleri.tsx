'use client'

// ═══════════════════════════════════════════════════════════════
//  Billedgalleri med fuldskaerms-lysbord.
//
//  Betjening: piletaster, swipe, klik paa siderne, miniaturer, Esc.
//  Store billeder hentes foerst, naar lysbordet aabnes — 1600px-varianter
//  til nitten billeder ville ellers koste flere megabyte paa en side, hvor
//  de fleste aldrig aabner galleriet.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'

export interface GalleriBillede {
  lille: string
  stor: string
}

export function Galleri({ billeder }: { billeder: GalleriBillede[] }) {
  const [aaben, setAaben] = useState<number | null>(null)
  const roer = useRef<number | null>(null)

  const luk = useCallback(() => setAaben(null), [])
  const gaa = useCallback((retning: number) => {
    setAaben((n) => (n == null ? null : (n + retning + billeder.length) % billeder.length))
  }, [billeder.length])

  // Tastatur. Bindes kun mens lysbordet er aabent, saa piletaster ellers
  // stadig ruller siden.
  useEffect(() => {
    if (aaben == null) return
    const paaTast = (e: KeyboardEvent) => {
      if (e.key === 'Escape') luk()
      else if (e.key === 'ArrowRight') gaa(1)
      else if (e.key === 'ArrowLeft') gaa(-1)
    }
    window.addEventListener('keydown', paaTast)
    // Baggrunden maa ikke rulle bag overlayet.
    const gemt = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', paaTast)
      document.body.style.overflow = gemt
    }
  }, [aaben, luk, gaa])

  // Hent naboerne paa forhaand, saa bladring ikke blinker.
  useEffect(() => {
    if (aaben == null) return
    for (const n of [aaben + 1, aaben - 1]) {
      const b = billeder[(n + billeder.length) % billeder.length]
      if (b) { const i = new Image(); i.src = b.stor }
    }
  }, [aaben, billeder])

  const start = (x: number) => { roer.current = x }
  const slut = (x: number) => {
    if (roer.current == null) return
    const flyt = x - roer.current
    roer.current = null
    if (Math.abs(flyt) > 45) gaa(flyt < 0 ? 1 : -1)
  }

  // Tre ved siden af hinanden, ikke fem i et mosaikmoenster. Resten
  // ligger i lysbordet, og taelleren siger hvor mange der er.
  const vist = billeder.slice(0, 3)
  const rest = billeder.length - vist.length

  return (
    <>
      <div className={`galleri g${Math.min(vist.length, 3)}`}>
        {vist.map((b, i) => (
          <button key={i} type="button" onClick={() => setAaben(i)} aria-label={`Åbn billede ${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.lille} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
          </button>
        ))}
        {billeder.length > 1 && (
          <button type="button" className="flere" onClick={() => setAaben(vist.length)}>
            {rest > 0 ? `+${rest} billeder` : `${billeder.length} billeder`}
          </button>
        )}
      </div>

      {aaben != null && (
        <div
          className="lysbord"
          role="dialog"
          aria-modal="true"
          aria-label={`Billede ${aaben + 1} af ${billeder.length}`}
          onClick={(e) => { if (e.target === e.currentTarget) luk() }}
          onTouchStart={(e) => start(e.touches[0]!.clientX)}
          onTouchEnd={(e) => slut(e.changedTouches[0]!.clientX)}
        >
          <div className="lys-top">
            <span className="taeller">{aaben + 1} / {billeder.length}</span>
            <button type="button" className="luk" onClick={luk} aria-label="Luk (Esc)">✕</button>
          </div>

          <button type="button" className="pil venstre" onClick={() => gaa(-1)} aria-label="Forrige">‹</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lys-billede" src={billeder[aaben]!.stor} alt="" />
          <button type="button" className="pil hoejre" onClick={() => gaa(1)} aria-label="Næste">›</button>

          <div className="minier" onClick={(e) => e.stopPropagation()}>
            {billeder.map((b, i) => (
              <button
                key={i}
                type="button"
                className={i === aaben ? 'valgt' : ''}
                onClick={() => setAaben(i)}
                aria-label={`Billede ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.lille} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
