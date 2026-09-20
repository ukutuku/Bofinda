'use client'
// ═══════════════════════════════════════════════════════════════
//  Beskedmodulet: listen, tråden og de tilstande, de kan stå i.
//
//  ═══ MODULET REGNER INGEN ADGANGSREGLER ═══
//
//  Der står ikke ét sted i denne fil, om nogen har betalt, hvornår et
//  abonnement udløber, eller hvad der er gratis. Porten svarer med en
//  tilstand, og modulet gengiver den. Supply ejer reglen; det her lag
//  ejer ordene og billedet. Se kontrakt.ts.
//
//  ═══ ÉN PORT IND, INGEN FETCH HERINDE ═══
//
//  Ingen `fetch`, ingen server action, ingen adresse. Alt går gennem
//  `port`, og det er dét, der gør modulet afprøvbart med syntetiske
//  samtaler uden et midlertidigt produktions-API — og det, der gør den
//  rigtige serverintegration til ÉN fil senere.
//
//  ═══ TO PANELER PÅ EN SKÆRM, ÉT AD GANGEN PÅ EN TELEFON ═══
//
//  Layoutet ligger i CSS. Den ENESTE grund til, at JavaScript også
//  kender bredden, er tilbageknappen og fokusspringet: på en telefon
//  ERSTATTER tråden listen, og så skal der være en vej tilbage, og
//  fokus skal følge med. Det kan CSS ikke.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import './beskeder.css'
import { Laast } from './Laast'
import { Samtaleliste } from './Samtaleliste'
import { Samtalevisning } from './Samtalevisning'
import type { Beskedport, Indbakke, Laasegrund, Samtaletraad } from './kontrakt'
import { ulaesteIAlt } from './kontrakt'

/** Under denne bredde er der kun plads til ét panel ad gangen. */
const SMAL = '(max-width: 719px)'

type Hentning<T> =
  | { slags: 'henter' }
  | { slags: 'fejl' }
  | { slags: 'klar'; data: T }

function Hentefejl({ hvad, proevIgen }: { hvad: string; proevIgen: () => void }) {
  return (
    <div className="bsk-hentefejl">
      <p>{hvad}</p>
      <button type="button" className="nulstil" onClick={proevIgen}>Prøv igen</button>
    </div>
  )
}

export function Beskedmodul({ port, loginHref = '/min-side', abonnementHref }: {
  port: Beskedport
  /** Findes i produktet i dag. Derfor en standardværdi — og kun her. */
  loginHref?: string
  /**
   * Adressen til abonnement/genaktivering. INGEN standardværdi med vilje:
   * ruten ejes af Supply og findes ikke endnu. En knap, der peger på en
   * rute, der ikke findes, er værre end ingen knap.
   */
  abonnementHref: string
}) {
  const [indbakke, setIndbakke] = useState<Hentning<Indbakke>>({ slags: 'henter' })
  const [valgt, setValgt] = useState<string | null>(null)
  const [traad, setTraad] = useState<Hentning<Samtaletraad> | null>(null)
  const [smal, setSmal] = useState(false)
  const [melding, setMelding] = useState('')
  const listetitel = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const m = window.matchMedia(SMAL)
    const opdater = () => setSmal(m.matches)
    opdater()
    m.addEventListener('change', opdater)
    return () => m.removeEventListener('change', opdater)
  }, [])

  const hentIndbakke = useCallback(() => {
    setIndbakke({ slags: 'henter' })
    setMelding('Henter dine samtaler…')
    port.hentIndbakke()
      .then((d) => {
        setIndbakke({ slags: 'klar', data: d })
        setMelding(d.tilstand === 'adgang'
          ? `${d.samtaler.length} ${d.samtaler.length === 1 ? 'samtale' : 'samtaler'}.`
          : '')
      })
      .catch(() => {
        setIndbakke({ slags: 'fejl' })
        setMelding('Samtalerne kunne ikke hentes.')
      })
  }, [port])

  useEffect(() => { hentIndbakke() }, [hentIndbakke])

  const aabn = useCallback((id: string) => {
    setValgt(id)
    setTraad({ slags: 'henter' })
    port.hentTraad(id)
      .then((d) => {
        setTraad({ slags: 'klar', data: d })
        if (d.tilstand !== 'adgang') return
        // Ulæst-markeringen fjernes lokalt med det samme. Kvitteringen til
        // serveren må gerne fejle i stilhed — en markering, der bliver
        // stående et øjeblik for længe, er ikke værd at afbryde nogen for.
        setIndbakke((i) => (i.slags === 'klar' && i.data.tilstand === 'adgang'
          ? {
            slags: 'klar',
            data: {
              tilstand: 'adgang',
              samtaler: i.data.samtaler.map((s) => (s.id === id ? { ...s, ulaeste: 0 } : s)),
            },
          }
          : i))
        void port.markerLaest(id).catch(() => {})
      })
      .catch(() => setTraad({ slags: 'fejl' }))
  }, [port])

  const tilbage = useCallback(() => {
    setValgt(null)
    setTraad(null)
    // Fokus tilbage i listen — ellers står den, der bruger tastatur,
    // i toppen af et dokument, hun ikke selv navigerede til.
    window.requestAnimationFrame(() => listetitel.current?.focus())
  }, [])

  // ── Hele modulet låst ───────────────────────────────────────
  if (indbakke.slags === 'klar' && indbakke.data.tilstand !== 'adgang') {
    return (
      <Laast
        grund={indbakke.data.tilstand}
        loginHref={loginHref}
        abonnementHref={abonnementHref}
      />
    )
  }

  const samtaler = indbakke.slags === 'klar' && indbakke.data.tilstand === 'adgang'
    ? indbakke.data.samtaler : []
  const ulaeste = ulaesteIAlt(samtaler)
  // På en telefon er der kun plads til ét panel. Er en samtale valgt,
  // ER det panelet — listen er der ikke, og derfor er tilbageknappen ikke
  // pynt, men den eneste vej.
  const visListe = !smal || valgt === null
  const visTraad = !smal || valgt !== null

  // Narrowingen sker FØR JSX'en. `traad` er en tilstandsvariabel, og
  // lukningerne nedenfor ville ellers hver for sig se den brede union
  // igen. Den låste variant har ingen `hoved` — og det er netop dét,
  // typen skal kunne håndhæve.
  const aaben = traad?.slags === 'klar' && traad.data.tilstand === 'adgang'
    ? traad.data : null

  return (
    <div className={`bsk-modul${valgt ? ' har-valgt' : ''}`}>
      <span className="skjult-for-oejet" role="status">{melding}</span>

      {visListe && (
        <section className="bsk-panel bsk-listepanel" aria-label="Samtaler">
          <div className="bsk-panelhoved">
            <h2 className="bsk-paneltitel" ref={listetitel} tabIndex={-1}>Samtaler</h2>
            {ulaeste > 0 && (
              <p className="bsk-ulaest-i-alt">{ulaeste} ulæst{ulaeste === 1 ? '' : 'e'}</p>
            )}
          </div>
          {indbakke.slags === 'fejl' ? (
            <Hentefejl hvad="Samtalerne kunne ikke hentes." proevIgen={hentIndbakke} />
          ) : (
            <Samtaleliste
              tilstand={indbakke.slags === 'henter' ? 'henter' : 'klar'}
              samtaler={samtaler}
              valgt={valgt}
              vaelg={aabn}
            />
          )}
        </section>
      )}

      {visTraad && (
        <div className="bsk-panel bsk-traadpanel">
          {traad === null ? (
            <p className="bsk-intet-valgt">Vælg en samtale i listen.</p>
          ) : traad.slags === 'henter' ? (
            <p className="bsk-intet-valgt" role="status">Henter samtalen…</p>
          ) : traad.slags === 'fejl' ? (
            <Hentefejl
              hvad="Samtalen kunne ikke hentes."
              proevIgen={() => { if (valgt) aabn(valgt) }}
            />
          ) : traad.data.tilstand === 'findes-ikke' ? (
            <p className="bsk-intet-valgt">Samtalen findes ikke længere.</p>
          ) : aaben === null ? (
            <Laast
              grund={traad.data.tilstand as Laasegrund}
              loginHref={loginHref}
              abonnementHref={abonnementHref}
            />
          ) : (
            <Samtalevisning
              hoved={aaben.hoved}
              beskeder={aaben.beskeder}
              skriv={aaben.skriv}
              abonnementHref={abonnementHref}
              visTilbage={smal}
              paaTilbage={tilbage}
              send={async (tekst) => {
                const svar = await port.send(aaben.hoved.id, tekst)
                if (!svar.ok) return svar
                // Serverens besked vinder — også tidspunktet. Et klokkeslæt,
                // klienten satte, ville kunne stå anderledes end modpartens
                // kopi af den samme besked.
                setTraad((t) => (t?.slags === 'klar' && t.data.tilstand === 'adgang'
                  ? {
                    slags: 'klar',
                    data: { ...t.data, beskeder: [...t.data.beskeder, svar.besked] },
                  }
                  : t))
                setIndbakke((i) => (i.slags === 'klar' && i.data.tilstand === 'adgang'
                  ? {
                    slags: 'klar',
                    data: {
                      tilstand: 'adgang',
                      samtaler: i.data.samtaler.map((s) => (s.id === aaben.hoved.id
                        ? { ...s, sidsteAktivitet: svar.besked.tidspunkt, uddrag: null }
                        : s)),
                    },
                  }
                  : i))
                return { ok: true as const }
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
