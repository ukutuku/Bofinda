'use client'

import { useState } from 'react'
import { meld } from '../../Maaling'
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

  // ── MUREN SVAREDE NEJ ───────────────────────────────────────
  // Handlingen returnerer `naegtet` i stedet for tomme felter, saa
  // boksen kan sige hvad der skal til. Beslutningen er truffet paa
  // serveren; her vaelges kun en tekst.
  if (vist?.naegtet) {
    return <Betalingsboks grund={vist.naegtet} id={id} />
  }

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
            {/* Kun AT der blev trykket. Aldrig adressen. */}
            <dd>
              <a
                href={`mailto:${vist.mail}`}
                onClick={() => meld('contact_click', { maal: 'mail' }, { listingId: id })}
              >{vist.mail}</a>
            </dd>
          </div>
        )}
        {vist.telefon && (
          <div>
            <dt>Telefon</dt>
            <dd>
              <a
                href={`tel:${vist.telefon.replace(/\s/g, '')}`}
                onClick={() => meld('contact_click', { maal: 'telefon' }, { listingId: id })}
              >{vist.telefon}</a>
            </dd>
          </div>
        )}
      </dl>
      <span className="kontaktnote">
        Skriv, at du har set boligen på Bofinda. Vi er ikke part i aftalen.
      </span>
    </div>
  )
}

/**
 * ÉN kort boks ved kontaktforsoeget. Begge priser, fornyelsen og
 * perioden staar samlet — ikke spredt over et koebsforloeb, hvor man
 * kan naa at trykke, foer man har set det hele.
 *
 * Boksen viser ALDRIG en koebsknap af sig selv: den vises kun, naar
 * serveren har svaret `abonnement_kraeves`, og det svar kan kun komme
 * i BETALING-tilstand.
 */
function Betalingsboks({ grund, id }: {
  grund: NonNullable<Oplysninger['naegtet']>
  id: string
}) {
  const retur = `/bolig/${id}`

  if (grund === 'ukendt_tilstand') {
    // VORES fejl. Send hende ikke til kassen for noget, vi selv har
    // brækket — og lov ikke, at det virker om et oejeblik.
    return (
      <div className="kontaktboks">
        <strong>Kontakt udlejeren</strong>
        <span>
          Vi kan ikke bekræfte din adgang lige nu. Prøv igen om lidt —
          det er en fejl hos os, ikke hos dig.
        </span>
      </div>
    )
  }

  if (grund === 'login_kraeves') {
    return (
      <div className="kontaktboks">
        <strong>Kontakt udlejeren</strong>
        <span>Log ind for at se kontaktoplysningerne.</span>
        <a className="knap" href={`/min-side?retur=${encodeURIComponent(retur)}`}>
          Log ind
        </a>
      </div>
    )
  }

  return (
    <div className="kontaktboks kontaktboks-betaling">
      <strong>Kontakt udlejeren</strong>
      <span>
        Kontaktoplysningerne er en del af abonnementet.
      </span>
      <ul className="betalingsvilkaar">
        <li><b>9 kr.</b> for de første 24 timer</li>
        <li><b>349 kr.</b> når de 24 timer er gået</li>
        <li>derefter <b>349 kr.</b> hver 28. dag</li>
      </ul>
      <span className="kontaktnote">
        Abonnementet fornyes automatisk, indtil du siger op. Du kan sige
        op når som helst — adgangen løber perioden ud. Priserne er inkl.
        moms.
      </span>
      <a className="knap" href={`/abonnement?retur=${encodeURIComponent(retur)}`}>
        Se abonnementet
      </a>
    </div>
  )
}
