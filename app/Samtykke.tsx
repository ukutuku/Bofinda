'use client'

// ═══════════════════════════════════════════════════════════════
//  Samtykkebanneret.
//
//  To knapper, samme størrelse, samme vægt, samme kontrast. Ingen
//  forudkrydsning, ingen cookie-mur, ingen «for at give dig den bedste
//  oplevelse». Banneret kan lukkes uden at vælge — det er IKKE samtykke,
//  der sættes ingen identifikator, og boksen kommer igen næste besøg.
//
//  Kategorier: nødvendige (auth, sikkerhed, teknisk funktion) og
//  statistik. Der er ingen marketingkategori, fordi der ikke er nogen
//  marketing at samtykke til.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useTransition } from 'react'
import { C_SAMTYKKE } from '../lib/samtykke'
import { saetSamtykke } from './samtykkehandling'

export function Samtykke() {
  // Valget laeses i browseren, ikke paa serveren: en cookielaesning i
  // layoutet ville goere hver eneste omraadeside dynamisk og tage dem ud
  // af den statiske gengivelse, SEO-ruterne lever af.
  const [aaben, setAaben] = useState(false)
  const [venter, start] = useTransition()

  useEffect(() => {
    const valgt = document.cookie.split('; ').some((c) => c.startsWith(`${C_SAMTYKKE}=`))
    if (!valgt) setAaben(true)
  }, [])

  if (!aaben) return null

  const svar = (v: 'ja' | 'nej') => start(async () => {
    await saetSamtykke(v)
    setAaben(false)
  })

  return (
    <div className="samtykke" role="dialog" aria-label="Statistik">
      <div className="samtykke-tekst">
        <strong>Må vi måle, hvordan siden bruges?</strong>
        <span>
          Vi tæller søgninger og klik for at gøre boligsøgningen bedre. Målingen
          er vores egen — ingen tredjepart, ingen markedsføring, og vi gemmer
          hverken din mailadresse, din adresse eller det, du skriver i
          søgefeltet. <a href="/privatliv">Sådan behandler vi dine oplysninger</a>.
        </span>
      </div>
      <div className="samtykke-knapper">
        {/* Rækkefølgen er bevidst: afvis står først og er ikke svagere. */}
        <button type="button" onClick={() => svar('nej')} disabled={venter}>
          Kun det nødvendige
        </button>
        <button type="button" onClick={() => svar('ja')} disabled={venter}>
          Tillad statistik
        </button>
      </div>
      <button
        type="button" className="samtykke-luk" aria-label="Luk uden at vælge"
        onClick={() => setAaben(false)} disabled={venter}
      >
        ×
      </button>
    </div>
  )
}
