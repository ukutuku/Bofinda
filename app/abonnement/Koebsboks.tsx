'use client'

import { useState } from 'react'
import { koeb } from './handlinger'

/**
 * Begge priser, fornyelsen og perioden staar SAMLET, foer der trykkes.
 * Ikke spredt over flere skaerme: det, kunden skal tage stilling til,
 * skal staa ét sted, mens hun stadig kan naa at lade vaere.
 */
export function Koebsboks({ retur, loggetInd, tilbud }: {
  retur: string
  loggetInd: boolean
  /**
   * Det tilbud, DEN HER konto faktisk faar. Boksen viste foer
   * introprisen til alle, mens `startKoeb()` valgte normalprisen for
   * en konto, der allerede havde brugt tilbuddet — altsaa et forkert
   * tal om kundens penge paa selve koebsskaermen.
   */
  tilbud: 'intro' | 'normal'
}) {
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
      koeb_i_gang: 'Du har allerede et køb i gang i et andet vindue. '
        + 'Gør det færdigt dér — eller vent et øjeblik og prøv igen.',
      // Hun HAR betalt. Det værste, vi kunne gøre her, var at åbne en
      // ny betalingsside — og det var præcis det, koden gjorde, fordi
      // en gennemført session blev læst som en død side.
      koeb_gennemfoert: 'Din betaling er gennemført. Vi venter på '
        + 'bekræftelsen fra Stripe — den plejer at tage få sekunder. '
        + 'Opdatér om et øjeblik. Du skal ikke betale igen.',
      stripe_fejlede: 'Betalingen kunne ikke startes. Prøv igen — der er ikke trukket noget.',
    }[svar.fejl])
  }

  return (
    <div className="koebsboks">
      {tilbud === 'intro' ? (
        <ul className="betalingsvilkaar">
          <li><b>9 kr.</b> for de første 24 timer</li>
          <li><b>349 kr.</b> når de 24 timer er gået</li>
          <li>derefter <b>349 kr.</b> hver 28. dag</li>
        </ul>
      ) : (
        <ul className="betalingsvilkaar">
          <li><b>349 kr.</b> for de første 28 dage</li>
          <li>derefter <b>349 kr.</b> hver 28. dag</li>
        </ul>
      )}
      <p className="koebsnote">
        Abonnementet fornyes automatisk, indtil du siger op. Siger du op,
        løber adgangen perioden ud. Alle priser er inkl. moms.
        {tilbud === 'intro'
          ? ' Tilbuddet på 9 kr. gælder én gang pr. konto.'
          : ' Introduktionstilbuddet på 9 kr. er brugt på denne konto.'}
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
        <>
          {/* /min-side laeser INGEN returparameter — leverancens egen
              kommentar sagde det, og det er stadig sandt. Saa lover vi
              det ikke: hun faar at vide, at hun skal trykke igen, i
              stedet for at lande et tilfaeldigt sted bagefter. Vejen
              tilbage baeres i stedet af den her sides egen `retur`,
              som hun kommer tilbage til. */}
          <a className="knap" href="/min-side">Log ind for at fortsætte</a>
          <p className="koebsnote">
            Efter login åbner du boligen igen og trykker «Vis
            kontaktoplysninger» — så er du tilbage her.
          </p>
        </>
      )}
      <p><a href={retur}>Tilbage</a></p>
    </div>
  )
}
