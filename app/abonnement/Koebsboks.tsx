'use client'

import { useState } from 'react'
import { koeb } from './handlinger'

/**
 * Begge priser, fornyelsen og perioden staar SAMLET, foer der trykkes.
 * Ikke spredt over flere skaerme: det, kunden skal tage stilling til,
 * skal staa ét sted, mens hun stadig kan naa at lade vaere.
 */
export function Koebsboks({ retur, loggetInd }: { retur: string; loggetInd: boolean }) {
  const [henter, setHenter] = useState(false)
  const [fejl, setFejl] = useState<string | null>(null)

  async function start() {
    setHenter(true); setFejl(null)
    const svar = await koeb(retur)
    if (svar.ok) { window.location.href = svar.url; return }
    setHenter(false)
    setFejl({
      gratis_tilstand: 'Bofinda er gratis lige nu — der er ikke noget at købe.',
      ikke_logget_ind: 'Log ind først, så ved vi, hvem abonnementet hører til.',
      stripe_mangler: 'Betaling er ikke slået til endnu. Prøv igen senere.',
      har_allerede: 'Du har allerede et abonnement. Se Mit abonnement.',
      stripe_fejlede: 'Betalingen kunne ikke startes. Prøv igen — der er ikke trukket noget.',
    }[svar.fejl])
  }

  return (
    <div className="koebsboks">
      <ul className="betalingsvilkaar">
        <li><b>9 kr.</b> for de første 24 timer</li>
        <li><b>349 kr.</b> når de 24 timer er gået</li>
        <li>derefter <b>349 kr.</b> hver 28. dag</li>
      </ul>
      <p className="koebsnote">
        Abonnementet fornyes automatisk, indtil du siger op. Siger du op,
        løber adgangen perioden ud. Alle priser er inkl. moms. Tilbuddet
        på 9 kr. gælder én gang pr. konto.
      </p>
      <p className="koebsnote">
        Abonnementet giver adgang til udlejerens kontaktoplysninger og til
        annoncen hos kilden. Vi er ikke part i aftalen, og vi kan ikke
        love, at en udlejer svarer. Kildens egen tjeneste er ikke en del
        af abonnementet.
      </p>
      {fejl && <p className="koebsfejl" role="alert">{fejl}</p>}
      {loggetInd ? (
        <button type="button" className="knap" onClick={start} disabled={henter}>
          {henter ? 'Åbner betaling …' : 'Fortsæt til betaling'}
        </button>
      ) : (
        <a className="knap" href={`/min-side?retur=${encodeURIComponent(retur)}`}>
          Log ind for at fortsætte
        </a>
      )}
      <p><a href={retur}>Tilbage</a></p>
    </div>
  )
}
