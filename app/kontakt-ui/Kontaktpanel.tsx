'use client'
// ═══════════════════════════════════════════════════════════════
//  Kontaktpanelet: ÉN primær handling, uanset tilstand.
//
//  ═══ TO VEJE, OG DE MÅ IKKE LIGNE HINANDEN ═══
//
//  · Er boligen oprettet af udlejeren HOS OS, sker kontakten hos os:
//    en samtale på Bofinda, og — hvis hun har oplyst dem —
//    kontaktoplysninger.
//  · Er den hentet fra en kilde, sker kontakten HOS KILDEN. Den eneste
//    handling er vejen derhen, og der er hverken login, betaling eller
//    beskeder involveret. Linket er offentligt, og at lægge en mur
//    foran det ville være at tage penge for noget, vi ikke leverer.
//
//  ═══ PANELET REGNER INGEN ADGANGSREGEL ═══
//
//  Det gengiver ét svar fra adapteren. Der står ikke ét sted her, om
//  kunden har betalt, hvornår en adgang udløber, eller om vi er i
//  gratis eller betalende tilstand. Se kontrakt.ts.
//
//  ═══ EN TEKNISK FEJL FØRER ALDRIG TIL BETALING ═══
//
//  `fejl` har sin egen visning: neutral besked, ét genforsøg, ingen
//  pris og ingen abonnementsknap. Et opslag, der ikke kom igennem,
//  siger intet om, hvorvidt hun har betalt — og at sende hende til
//  kassen, fordi VORES kald fejlede, er at tage penge for vores egen
//  fejl.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react'
import type {
  Annonce, Kontaktoplysninger, Kontaktsvar, Laasegrund, Samtaleadgang,
} from './kontrakt'
import { PRISFORLOEB } from './kontrakt'
import { KALENDERZONE } from '../../lib/dato'

/**
 * «12. oktober 2026».
 *
 * Adapteren sender ISO; dansk skrives HER. Sendte serveren sætningen,
 * ville brugervendt dansk ligge spredt over to lag. Og formatering er
 * ikke en regel: panelet regner ikke på datoen og bruger den ikke til
 * at afgøre noget — adgangen er allerede afgjort af `tilstand`.
 */
const DATO = new Intl.DateTimeFormat('da-DK', {
  timeZone: KALENDERZONE, day: 'numeric', month: 'long', year: 'numeric',
})

/**
 * Teksterne for de låste tilstande bor HER og ikke i serverlaget.
 * Adapteren sender ét ord fra en union; brugerfladen skriver sætningen.
 *
 * ⚠ PRISEN STÅR KUN VED «abonnement-kraevet». Introprisen gælder en ny
 * kunde. Om den også gælder en, der har haft et abonnement før, er en
 * regel, vi IKKE kender — og at love 9 kr. til en, der måske skal betale
 * 349, ville være at opfinde en serverregel. Genaktivering henviser
 * derfor til abonnementssiden, hvor det rigtige tal står.
 */
const LAAST: Record<Laasegrund, {
  overskrift: string; tekst: string; knap: string; visPris: boolean
}> = {
  'login-kraevet': {
    overskrift: 'Log ind for at se kontaktoplysningerne',
    tekst: 'Kontakt og beskeder følger din konto.',
    knap: 'Log ind',
    visPris: false,
  },
  'abonnement-kraevet': {
    overskrift: 'Kontakt kræver abonnement',
    tekst: 'Med abonnement kan du se udlejerens kontaktoplysninger og skrive til hende her på Bofinda.',
    knap: 'Se abonnement',
    visPris: true,
  },
  'abonnement-udloebet': {
    overskrift: 'Dit abonnement er udløbet',
    tekst: 'Genaktivér for at se kontaktoplysninger og læse dine beskeder. Dine samtaler er ikke slettet.',
    knap: 'Genaktivér',
    visPris: false,
  },
}

function Laastkontakt({ grund, loginHref, abonnementHref }: {
  grund: Laasegrund; loginHref: string; abonnementHref: string
}) {
  const t = LAAST[grund]
  return (
    // `role="status"` og ikke `alert`: det er en tilstand, siden står i,
    // ikke noget der lige er gaaet galt.
    <div className="kui-panel kui-laast" role="status">
      <h3 className="kui-titel">{t.overskrift}</h3>
      <p className="kui-tekst">{t.tekst}</p>
      {/* Hele forløbet i ÉN sætning. Se noten ved PRISFORLOEB. */}
      {t.visPris && <p className="kui-pris">{PRISFORLOEB}</p>}
      <a
        className="knap kui-handling"
        href={grund === 'login-kraevet' ? loginHref : abonnementHref}
      >
        {t.knap}
      </a>
    </div>
  )
}

function Hentefejl({ proevIgen, venter }: { proevIgen: () => void; venter: boolean }) {
  return (
    <div className="kui-panel kui-fejl">
      <h3 className="kui-titel">Vi kunne ikke hente det lige nu</h3>
      {/* Sætning to er ikke høflighed. Uden den gætter hun selv, og det
          nærmeste gæt er «jeg skal vist betale». */}
      <p className="kui-tekst">
        Det er en fejl hos os — ikke noget med din adgang.
      </p>
      <button
        type="button" className="nulstil kui-handling"
        onClick={proevIgen} aria-busy={venter || undefined}
      >
        Prøv igen
      </button>
    </div>
  )
}

function Skelet() {
  return (
    <div className="kui-panel kui-skelet" aria-hidden="true">
      <span className="kui-skeletlinje bred" />
      <span className="kui-skeletlinje mellem" />
      <span className="kui-skeletlinje knap" />
    </div>
  )
}

/** Hvad har udlejeren oplyst? Bygget af det, der FAKTISK er der. */
const oplystTekst = (harMail: boolean, harTelefon: boolean): string | null => {
  const hvad = [harMail && 'mailadresse', harTelefon && 'telefonnummer']
    .filter(Boolean).join(' og ')
  return hvad ? `Udlejeren har oplyst ${hvad}.` : null
}

function Oplysninger({ vist }: { vist: Kontaktoplysninger }) {
  return (
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
  )
}

/** Samtaleknappen. Hvilken den er, afgør ADAPTEREN — ikke vi. */
function Samtaleknap({ samtale, loginHref, start, starter, paaAaben }: {
  samtale: Samtaleadgang
  loginHref: string
  start: () => void
  starter: boolean
  paaAaben: () => void
}) {
  if (samtale.slags === 'kraever-login') {
    // Gratis tilstand: kontaktoplysningerne er aabne, men en samtale
    // kraever en konto. Login staar dér, hvor funktionen kraever det —
    // og INTET andet sted. Ingen pris, ingen abonnementsknap.
    return <a className="knap kui-handling" href={loginHref}>Log ind for at skrive</a>
  }
  // «Åbn beskeder» og ikke «Åbn samtalen»: modulet aabner INDBAKKEN,
  // ikke den enkelte traad — se noten ved `samtaleId` i kontrakt.ts.
  // En knap skal love dét, den goer.
  if (samtale.slags === 'i-gang') {
    return (
      <button type="button" className="kui-handling" onClick={paaAaben}>
        Åbn beskeder
      </button>
    )
  }
  return (
    <button
      type="button" className="kui-handling"
      onClick={start} aria-busy={starter || undefined}
    >
      Skriv til udlejeren
    </button>
  )
}

export function Kontaktpanel({
  annonce, svar, loginHref, abonnementHref,
  proevIgen, venter, hentKontakt, start, starter, startfejl, paaAaben,
}: {
  annonce: Annonce
  /** Null mens der hentes. */
  svar: Kontaktsvar | null
  loginHref: string
  abonnementHref: string
  proevIgen: () => void
  venter: boolean
  hentKontakt: () => Promise<Kontaktoplysninger>
  start: () => void
  starter: boolean
  startfejl: boolean
  paaAaben: () => void
}) {
  const [vist, setVist] = useState<Kontaktoplysninger | null>(null)
  const [henter, setHenter] = useState(false)
  const [visfejl, setVisfejl] = useState(false)

  // ── Ekstern annonce: der er ingen adgang at spoerge om ──────
  if (annonce.slags === 'ekstern') {
    return (
      <div className="kui-panel">
        <h3 className="kui-titel">Annoncen ligger hos {annonce.kilde}</h3>
        <p className="kui-tekst">
          Kontaktoplysningerne står i udlejerens egen annonce. Vi er ikke part i aftalen.
        </p>
        {/* Vores egen /go/<id>, aldrig kildens URL direkte — ruten maa
            ikke kunne bruges som et aabent redirect. */}
        <a
          className="knap kui-handling" href={annonce.videreHref}
          target="_blank" rel="noopener noreferrer"
        >
          Se annoncen hos {annonce.kilde}
        </a>
      </div>
    )
  }

  if (svar === null) return <Skelet />
  if (svar.tilstand === 'fejl') return <Hentefejl proevIgen={proevIgen} venter={venter} />
  if (svar.tilstand !== 'adgang') {
    return (
      <Laastkontakt grund={svar.tilstand} loginHref={loginHref} abonnementHref={abonnementHref} />
    )
  }

  const oplyst = oplystTekst(svar.kontakt.harMail, svar.kontakt.harTelefon)

  async function vis() {
    setHenter(true); setVisfejl(false)
    try { setVist(await hentKontakt()) } catch { setVisfejl(true) } finally { setHenter(false) }
  }

  return (
    <div className="kui-panel">
      {/* IKKE «Skriv til udlejeren». Det er knappens ord, og en
          skærmlæser ville sige det to gange lige efter hinanden.
          «Kontakt udlejeren» er desuden ordlyden i den eksisterende
          app/bolig/[id]/Kontakt.tsx, så de to kontaktflader taler
          samme sprog. */}
      <h3 className="kui-titel">Kontakt udlejeren</h3>
      <p className="kui-tekst">
        Boligen er oprettet af udlejeren selv på Bofinda. Samtalen ligger her på siden.
      </p>

      {/* PRIMÆR handling. Den staar foerst og er den eneste fyldte knap. */}
      <Samtaleknap
        samtale={svar.samtale} loginHref={loginHref}
        start={start} starter={starter} paaAaben={paaAaben}
      />
      {startfejl && (
        <p className="kui-linjefejl" role="status">
          Samtalen kunne ikke startes. Det er en fejl hos os — prøv igen.
        </p>
      )}

      {/* Kontaktoplysningerne er SEKUNDÆRE. Adressen hentes foerst ved et
          tryk, saa den ikke staar i markuppen for en adressehoester. */}
      {oplyst ? (
        <div className="kui-kontakt">
          <p className="kui-tekst">{oplyst}</p>
          {vist ? <Oplysninger vist={vist} /> : (
            <button
              type="button" className="nulstil kui-sekundaer"
              onClick={() => void vis()} aria-busy={henter || undefined}
            >
              Vis kontaktoplysninger
            </button>
          )}
          {visfejl && (
            <p className="kui-linjefejl" role="status">
              Oplysningerne kunne ikke hentes. Prøv igen.
            </p>
          )}
        </div>
      ) : (
        <p className="kui-note">Udlejeren har ikke oplyst mail eller telefon.</p>
      )}

      {/* Opsagt, men stadig betalt. En oplysning — ikke et salg. */}
      {svar.ophoerer && (
        <p className="kui-note" role="status">
          Dit abonnement er opsagt. Du har adgang til {DATO.format(new Date(svar.ophoerer))}.
        </p>
      )}

      <p className="kui-note">Vi er ikke part i aftalen.</p>
    </div>
  )
}
