'use client'

import { useState } from 'react'
import { skiftTilstand } from '../../abonnement/handlinger'

export function Skifter({ tilstand, levende, aendretAt, note }: {
  tilstand: 'gratis' | 'betaling'
  levende: number
  aendretAt: string | null
  note: string | null
}) {
  const [nu, setNu] = useState(tilstand)
  const [melding, setMelding] = useState<string | null>(null)
  const [arbejder, setArbejder] = useState(false)

  async function skift(til: 'gratis' | 'betaling') {
    setArbejder(true); setMelding(null)
    const svar = await skiftTilstand(til)
    setArbejder(false)
    if (svar.ok) { setNu(til); setMelding(`Tilstanden er nu ${til.toUpperCase()}.`); return }
    setMelding(
      svar.fejl === 'levende_abonnementer' ? svar.forklaring
      : svar.fejl === 'ikke_admin' ? 'Du har ikke adgang til at skifte tilstand.'
      : 'Der er ingen driftsrække i basen. Kør migrationerne.',
    )
  }

  return (
    <>
      <p>
        Nuværende tilstand: <strong>{nu.toUpperCase()}</strong>
        {aendretAt && <> · ændret {aendretAt}</>}
        {note && <> · «{note}»</>}
      </p>
      <p>
        <strong>GRATIS</strong> — kontaktoplysninger og kildelinks er åbne
        for alle. Ingen betalingsbokse, ingen køb.<br />
        <strong>BETALING</strong> — de samme funktioner kræver et gyldigt
        abonnement. Søgeresultater, beskrivelser og billeder er stadig
        offentlige.
      </p>
      <p>Løbende abonnementer lige nu: <strong>{levende}</strong></p>
      {melding && <p className="koebsfejl" role="alert">{melding}</p>}
      <p>
        <button type="button" className="knap" disabled={arbejder || nu === 'betaling'}
          onClick={() => skift('betaling')}>Slå muren TIL</button>
        {' '}
        <button type="button" className="knap" disabled={arbejder || nu === 'gratis'}
          onClick={() => skift('gratis')}>Slå muren FRA</button>
      </p>
      <p className="koebsnote">
        Et skift til GRATIS afvises, så længe nogen har et løbende
        abonnement: Stripe ville blive ved med at trække, og en automatisk
        opsigelse ville være en beslutning om deres penge, ingen har bedt
        om. Tag stilling til hver enkelt i Stripe først.
      </p>
    </>
  )
}
