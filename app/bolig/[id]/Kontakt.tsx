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
 * serveren har naegtet adgangen, og en betalingsgrund kan kun komme i
 * BETALING-tilstand.
 *
 * ═══ EN TABEL, IKKE EN KAEDE MED EN CATCH-ALL ═══
 *
 * Her stod foer to `if` og et sidste `return`. Det sidste return var en
 * TAVS fælde: en ny grund faldt igennem til teksten «Fra 9 kr.», og
 * oversaetteren sagde ingenting. Netop `abonnement_udloebet` er den
 * grund, hvor tallet er FORKERT — `users.intro_brugt_at` er sat paa en
 * vendende kunde, saa `gaeldendeTilbud()` giver 'normal', og hun skal
 * betale 349. Et forkert tal om kundens penge er vaerre end intet tal,
 * og den fejl er rettet i den her fil én gang foer.
 *
 * `Record<Grund, …>` lukker vejen: en femte grund kan ikke tilfoejes
 * uden en tekst, for saa oversaetter filen ikke.
 */
interface Murtekst {
  tekst: string
  /** Den lille note under teksten. Udelades, naar vi intet kan love. */
  note?: string
  knap?: string
  /** Giver den groenne betalingsramme. Kun naar det ER et koeb. */
  betaling?: true
}

const MURTEKST: Record<NonNullable<Oplysninger['naegtet']>, Murtekst> = {
  // VORES fejl. Send hende ikke til kassen for noget, vi selv har
  // braekket — og lov ikke, at det virker om et oejeblik.
  ukendt_tilstand: {
    tekst: 'Vi kan ikke bekræfte din adgang lige nu. Prøv igen om lidt — '
      + 'det er en fejl hos os, ikke hos dig.',
  },
  login_kraeves: {
    tekst: 'Log ind for at se kontaktoplysningerne.',
    knap: 'Log ind',
  },
  // Selve priserne staar paa /abonnement, hvor kontoens EGET tilbud er
  // slaaet op. Boksen viste foer introprisen til alle — ogsaa til konti,
  // der havde brugt den.
  abonnement_kraeves: {
    tekst: 'Kontaktoplysningerne er en del af abonnementet.',
    note: 'Fra 9 kr. Abonnementet fornyes automatisk, indtil du siger op; '
      + 'adgangen løber perioden ud. Priserne står samlet på næste side, '
      + 'før du betaler.',
    knap: 'Se abonnementet',
    betaling: true,
  },
  // INGEN «fra 9 kr.» her. Introtilbuddet er brugt, og hendes pris er
  // normalprisen. Vi siger hvad hun skal gøre, og lader tallet staa dér,
  // hvor hendes eget tilbud er slaaet op.
  abonnement_udloebet: {
    tekst: 'Dit abonnement er udløbet. Genaktivér for at se '
      + 'kontaktoplysningerne igen.',
    note: 'Prisen står på næste side, før du betaler.',
    knap: 'Genaktivér',
    betaling: true,
  },
}

function Betalingsboks({ grund, id }: {
  grund: NonNullable<Oplysninger['naegtet']>
  id: string
}) {
  const t = MURTEKST[grund]
  // Gennem /abonnement, ikke /min-side. Min side laeser ingen
  // `retur`-parameter, saa vejen tilbage til boligen ville gaa tabt i
  // loginnet — og kunden lande et andet sted end det, hun kom fra.
  // /abonnement baerer den hele vejen og skelner selv.
  const maal = `/abonnement?retur=${encodeURIComponent(`/bolig/${id}`)}`

  return (
    <div className={`kontaktboks${t.betaling ? ' kontaktboks-betaling' : ''}`}>
      <strong>Kontakt udlejeren</strong>
      <span>{t.tekst}</span>
      {t.note && <span className="kontaktnote">{t.note}</span>}
      {t.knap && <a className="knap" href={maal}>{t.knap}</a>}
    </div>
  )
}
