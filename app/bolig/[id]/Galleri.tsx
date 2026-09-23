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
  const dialog = useRef<HTMLDialogElement>(null)

  const luk = useCallback(() => setAaben(null), [])
  const gaa = useCallback((retning: number) => {
    setAaben((n) => (n == null ? null : (n + retning + billeder.length) % billeder.length))
  }, [billeder.length])

  // ── Lysbordet er en RIGTIG modal dialog ───────────────────────
  //
  //  Det var et `<div role="dialog" aria-modal="true">`. Attributten
  //  lover tre ting, som et div ikke kan holde: at fokus flytter ind,
  //  at Tab bliver inde, og at fokus vender tilbage. Ingen af dem
  //  skete. Maalt paa en bolig med fem billeder, begge bredder:
  //  fokus blev staaende paa aabningsknappen, 21 af 30 tab-tryk landede
  //  paa siden BAG lysbordet — «Boligen», «Faciliteter», «Pris pr. m²» —
  //  og ved lukning faldt fokus til <body>.
  //
  //  `showModal()` giver alle tre af browseren. Det er den samme
  //  loesning som filtervinduet i app/Filterdialog.tsx, og det er
  //  pointen: der skal vaere ÉT svar paa «hvordan laver vi en modal»,
  //  ikke to. En haandskrevet fokusfaelde ville vaere det andet udtryk
  //  for det samme spoergsmaal.
  //
  //  Dialogen bliver MONTERET hele tiden og aabnes og lukkes med
  //  metoderne. Lod vi React afmontere den, ville browseren aldrig se
  //  `close()` — og saa er der ingen til at give fokus tilbage.
  //  Indholdet renderes stadig kun naar den er aaben, saa 1600px-
  //  varianterne foerst hentes ved aabning, som foer.
  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (aaben != null && !d.open) d.showModal()
    else if (aaben == null && d.open) d.close()
  }, [aaben])

  // Piletaster. Bindes kun mens lysbordet er aabent, saa de ellers
  // stadig ruller siden. Escape staar IKKE her mere: en modal dialog
  // haandterer den selv og sender `cancel`, som `onCancel` tager. To
  // veje ud ville vaere to steder at rette.
  useEffect(() => {
    if (aaben == null) return
    const paaTast = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') gaa(1)
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
  }, [aaben, gaa])

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
  // ligger i lysbordet.
  //
  // `vist` er hvad KOMPONENTEN lægger i gitteret. Hvor mange af dem der
  // faktisk kan ses, afgøres af CSS'en og ikke her: under 720 px skjuler
  // `.galleri > button:not(:first-child):not(.flere)` alle på nær den
  // første. Derfor må knappens tekst ikke regnes af `vist.length`.
  const vist = billeder.slice(0, 3)

  return (
    <>
      <div className={`galleri g${Math.min(vist.length, 3)}`}>
        {vist.map((b, i) => (
          <button key={i} type="button" onClick={() => setAaben(i)} aria-label={`Åbn billede ${i + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.lille} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
          </button>
        ))}
        {/* ── Knappen siger det SAMLEDE antal ────────────────────
            Der stod «+{billeder.length - 3} billeder» — altså hvor mange
            der lå ud over de tre, komponenten lægger i gitteret. Det var
            to udtryk for det samme spørgsmål: JS'en regnede med tre
            synlige ruder, mens CSS'en under 720 px kun viser ÉN. Med
            fire billeder så en telefonbruger derfor ét foto og fik at
            vide, at der var «+1 billeder» — altså to i alt, ikke fire.
            Begge udtryk var rigtige hver for sig; de svarede bare på
            hver sit spørgsmål.

            Det samlede antal er sandt ved enhver bredde, uanset hvor
            mange ruder CSS'en viser, og det er ét tal fra én kilde.
            `billeder` er allerede filtreret gennem `billedUrl()` i
            page.tsx, så tallet er dem, der faktisk kan vises — ikke
            rækkerne i `listing_images`.

            Ét billede får ingen knap: «Se alle 1 billeder» er hverken
            dansk eller en handling, og det ene foto åbner selv lysbordet
            ved klik. Kontrollen i fotokontrol.mjs prøver netop det.

            Lysbordet åbner på det FØRSTE billede og ikke på nr. 4.
            `setAaben(vist.length)` hvilede på den samme antagelse om tre
            synlige ruder: på en telefon sprang den de to over, brugeren
            aldrig havde set. «Se alle» begynder forfra. */}
        {billeder.length > 1 && (
          <button type="button" className="flere" onClick={() => setAaben(0)}>
            Se alle {billeder.length} billeder
          </button>
        )}
      </div>

      <dialog
        ref={dialog}
        className="lysbord"
        aria-label={aaben == null ? 'Billeder' : `Billede ${aaben + 1} af ${billeder.length}`}
        // Escape lukker en modal dialog af sig selv. `preventDefault` stopper
        // browserens egen lukning, saa tilstanden i React og dialogens
        // `open` ikke kan komme fra hinanden: ÉN vej ud, gennem `luk`.
        onCancel={(e) => { e.preventDefault(); luk() }}
        onClick={(e) => { if (e.target === e.currentTarget) luk() }}
        onTouchStart={(e) => { if (e.touches[0]) start(e.touches[0].clientX) }}
        onTouchEnd={(e) => { if (e.changedTouches[0]) slut(e.changedTouches[0].clientX) }}
      >
        {aaben != null && (
        <>
          <div className="lys-top">
            <span className="taeller">{aaben + 1} / {billeder.length}</span>
            {/* Foerste fokuserbare i traeet, og udtrykkeligt markeret:
                `showModal()` leder foerst efter [autofocus]. Saa er det
                ikke DOM-raekkefoelgen, der afgoer, hvor fokus lander. */}
            <button type="button" className="luk" onClick={luk} aria-label="Luk (Esc)" autoFocus>✕</button>
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
        </>
        )}
      </dialog>
    </>
  )
}
