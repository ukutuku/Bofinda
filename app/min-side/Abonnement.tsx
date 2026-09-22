'use client'

import { useState } from 'react'
import { opsig } from '../abonnement/handlinger'

export interface Abonnementsvisning {
  status: string
  fase: 'intro' | 'normal' | null
  fornyelseStoppet?: boolean
  afsluttet?: boolean
  naeste:
    | { slags: 'beloeb'; oere: number }
    | { slags: 'fornyes_ikke' }
    | { slags: 'opsigelse_undervejs' }
    | { slags: 'ukendt' }
  fornyesAt: string | null
  adgangTil: string | null
  /** BEKRAEFTET opsagt: hun bad om det, OG Stripe har bekraeftet det. */
  opsagt: boolean
  /** Hun bad om det; Stripe har ikke bekraeftet det endnu. */
  opsigelseUndervejs?: boolean
  /** Stripe siger, der ikke kommer en opkraevning — uanset hvem der bad. */
  fornyesIkke?: boolean
}

const kr = (o: number) => (o / 100).toLocaleString('da-DK', { minimumFractionDigits: 2 })

/**
 * Mit abonnement: status, naeste beloeb, fornyelsestidspunkt, adgangens
 * udloeb og opsigelse. Ikke mere — ingen salgstekst, ingen paamindelse.
 */
export function Abonnement({ start }: { start: Abonnementsvisning | null }) {
  const [a, setA] = useState(start)
  const [arbejder, setArbejder] = useState(false)
  const [melding, setMelding] = useState<string | null>(null)

  if (!a) {
    return (
      <section id="abonnement">
        <h2>Mit abonnement</h2>
        <p>Du har ikke noget abonnement.</p>
      </section>
    )
  }

  async function sigOpNu() {
    setArbejder(true); setMelding(null)
    const svar = await opsig()
    setArbejder(false)
    if (svar.ok) {
      setA((x) => (x ? { ...x, opsagt: true, opsigelseUndervejs: false,
        fornyesIkke: true, naeste: { slags: 'fornyes_ikke' }, fornyesAt: null } : x))
      setMelding('Abonnementet er sagt op. Adgangen løber perioden ud.')
      return
    }
    if (svar.fejl === 'afventer') {
      // ── ANMODNINGEN ER GEMT, OG DET SKAL HUN VIDE ────────
      // Her stod «Prøv igen — der er ikke ændret noget». Det var
      // forkert: beslutningen ER skrevet, før vi ringede til
      // betalingsudbyderen, og tilsynet arbejder videre på den. At
      // sige «der er ikke ændret noget» fik hende til at tro, at hun
      // stod samme sted som før — og hun gør ikke.
      //
      // Men det modsatte er lige så forkert: vi må ikke love, at der
      // ikke kommer en betaling. Det ved vi først, når Stripe har
      // svaret. Derfor: modtaget, undervejs, og knappen bliver.
      setA((x) => (x ? { ...x, opsigelseUndervejs: true,
        naeste: { slags: 'opsigelse_undervejs' } } : x))
      setMelding('Vi har modtaget din opsigelse, men kunne ikke bekræfte den '
        + 'hos betalingsudbyderen lige nu. Vi prøver automatisk igen. Du må '
        + 'gerne trykke igen — det gør ingen skade.')
      return
    }
    setMelding({
      ikke_logget_ind: 'Log ind igen, og prøv så.',
      intet_abonnement: 'Der er ikke noget løbende abonnement at sige op.',
      stripe_mangler: 'Betaling er ikke slået til. Skriv til info@bofinda.dk.',
    }[svar.fejl])
  }

  return (
    <section id="abonnement">
      <h2>Mit abonnement</h2>
      <dl className="abonnementsliste">
        <div>
          <dt>Status</dt>
          <dd>
            {/* «Opsagt» er HENDES opsigelse, bekraeftet. Har VI stoppet
                fornyelsen — eller staar flaget uden at nogen af os bad
                om det — er det ikke hendes, og saa maa det ikke hedde
                det. Det ville tillaegge hende en handling, hun ikke har
                foretaget, og blokere hende fra at gaa videre. */}
            {/* At abonnementet ER slut, står FØRST. «Opsagt» ville
                skjule det — og for et lukket abonnement er det den
                vigtigste kendsgerning på siden. */}
            {a.afsluttet ? statusTekst(a.status)
              : a.opsagt ? 'Opsagt'
              : a.fornyelseStoppet ? 'Fornyelse stoppet'
              : a.fornyesIkke ? 'Fornyes ikke'
              : a.opsigelseUndervejs ? 'Opsigelse undervejs'
              : statusTekst(a.status)}
          </dd>
        </div>
        {a.fase && (
          <div>
            <dt>Periode</dt>
            <dd>{a.fase === 'intro' ? 'Første 24 timer' : '28 dage'}</dd>
          </div>
        )}
        <div>
          <dt>Næste beløb</dt>
          {/* Tre udfald, ikke to. «Fornyes ikke» er et LØFTE om, at der
              ikke kommer en betaling; «kan ikke bekræftes» siger, at vi
              ikke ved det. Før var begge `null`, og en kunde, hvis plan
              ikke var bekræftet, fik løftet — som vi ikke kunne holde. */}
          <dd>
            {a.naeste.slags === 'beloeb' ? `${kr(a.naeste.oere)} kr.`
              : a.naeste.slags === 'fornyes_ikke' ? 'Intet — fornyes ikke'
              : a.naeste.slags === 'opsigelse_undervejs' ? 'Afventer bekræftelse'
              : 'Kan ikke bekræftes lige nu'}
          </dd>
        </div>
        {/* Opsigelsen er modtaget, men ikke bekræftet. Hun skal se
            begge dele: at vi HAR den, og at der stadig kan blive
            trukket, indtil betalingsudbyderen har bekræftet det. Et
            «fornyes ikke» her ville være et løfte om hendes penge, vi
            ikke kan holde. */}
        {a.opsigelseUndervejs && (
          <div>
            <dt>Opsigelse</dt>
            <dd>
              Vi har modtaget din opsigelse og er ved at gennemføre den
              hos vores betalingsudbyder. <strong>Den er ikke bekræftet
              endnu</strong>, så bliver den ikke gennemført inden næste
              fornyelse, kan der blive trukket som normalt. Vi prøver
              automatisk igen. Skriv til info@bofinda.dk, hvis det her
              bliver stående.
            </dd>
          </div>
        )}
        {a.naeste.slags === 'ukendt' && !a.fornyesIkke && (
          <div>
            <dt>Bemærk</dt>
            <dd>
              Vi kan ikke bekræfte næste betaling lige nu. Det er en fejl
              hos os — skriv til info@bofinda.dk, hvis den bliver stående.
            </dd>
          </div>
        )}
        {/* Fornyelsen er stoppet AF OS, fordi vi ikke kunne bekræfte
            overgangen til 349 kr. Hun skal vide det, og hun skal vide,
            at hun beholder det, hun har betalt for. At tie om det ville
            være samme fejl som at love «fornyes ikke» til en, hvis plan
            bare ikke var bekræftet. */}
        {a.fornyelseStoppet && (
          <div>
            <dt>Fornyelse stoppet</dt>
            <dd>
              Vi kunne ikke bekræfte overgangen til den normale pris, og
              vi har derfor stoppet fornyelsen. <strong>Du beholder den
              periode, du har betalt for</strong>, og der bliver ikke
              trukket mere. Skriv til info@bofinda.dk, hvis du vil
              fortsætte — så sætter vi det i gang igen.
            </dd>
          </div>
        )}
        <div>
          <dt>Fornyes</dt>
          <dd>{a.fornyesAt ?? 'Fornyes ikke'}</dd>
        </div>
        <div>
          <dt>Adgang til</dt>
          <dd>{a.adgangTil ?? 'Ingen betalt adgang'}</dd>
        </div>
      </dl>
      {melding && <p role="status">{melding}</p>}
      {/* Knappen forsvinder FOERST, naar opsigelsen er bekraeftet.
          Skjultes den paa anmodningen alene, ville en kunde, hvis kald
          fejlede hos Stripe, staa uden nogen vej videre — og tro, at
          hun var faerdig. Kaldet er idempotent, saa et ekstra tryk
          koster ingenting. */}
      {!a.fornyesIkke && (
        <button type="button" className="knap" onClick={sigOpNu} disabled={arbejder}>
          {arbejder ? 'Siger op …'
            : a.opsigelseUndervejs ? 'Prøv opsigelsen igen'
            : 'Sig abonnementet op'}
        </button>
      )}
      {a.fornyesIkke && a.adgangTil && (
        <p className="koebsnote">
          Du har betalt til {a.adgangTil}. Adgangen fortsætter indtil da.
        </p>
      )}
    </section>
  )
}

function statusTekst(s: string): string {
  return {
    active: 'Aktivt', trialing: 'Aktivt', past_due: 'Betaling mislykkedes',
    unpaid: 'Ubetalt', paused: 'Sat på pause', canceled: 'Afsluttet',
    incomplete: 'Betaling ikke gennemført', incomplete_expired: 'Betaling udløb',
    expired: 'Udløbet',
  }[s] ?? s
}
