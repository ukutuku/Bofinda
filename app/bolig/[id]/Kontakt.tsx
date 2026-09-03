'use client'

import { useState } from 'react'
import { hentKontakt, type Kontakt as Oplysninger } from './kontakthandling'

/**
 * Viser kun det, udlejeren faktisk har oplyst. Har hun kun givet en mail,
 * står der ikke et tomt telefonfelt.
 */
export function Kontakt({ id, harMail, harTelefon }: {
  id: string
  harMail: boolean
  harTelefon: boolean
}) {
  const [vist, setVist] = useState<Oplysninger | null>(null)
  const [henter, setHenter] = useState(false)
  const [fejl, setFejl] = useState<string | null>(null)

  async function vis() {
    setHenter(true); setFejl(null)
    try {
      setVist(await hentKontakt(id))
    } catch {
      setFejl('Kunne ikke hente oplysningerne. Prøv igen.')
    } finally {
      setHenter(false)
    }
  }

  const hvad = [harMail && 'mailadresse', harTelefon && 'telefonnummer']
    .filter(Boolean).join(' og ')

  if (!vist) {
    return (
      <div className="kontaktboks">
        <strong>Kontakt udlejeren</strong>
        <span>{`Udlejeren har oplyst ${hvad}.`}</span>
        {fejl && <span className="kontaktfejl">{fejl}</span>}
        <button type="button" className="knap" onClick={vis} disabled={henter}>
          {henter ? 'Henter …' : 'Vis kontaktoplysninger'}
        </button>
      </div>
    )
  }

  return (
    <div className="kontaktboks">
      <strong>Kontakt udlejeren</strong>
      <dl className="kontaktliste">
        {vist.mail && (
          <div>
            <dt>Mail</dt>
            <dd><a href={`mailto:${vist.mail}`}>{vist.mail}</a></dd>
          </div>
        )}
        {vist.telefon && (
          <div>
            <dt>Telefon</dt>
            <dd><a href={`tel:${vist.telefon.replace(/\s/g, '')}`}>{vist.telefon}</a></dd>
          </div>
        )}
      </dl>
      <span className="kontaktnote">
        Skriv, at du har set boligen på Bofinda. Vi er ikke part i aftalen.
      </span>
    </div>
  )
}
