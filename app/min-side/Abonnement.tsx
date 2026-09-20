'use client'

import { useState } from 'react'
import { opsig } from '../abonnement/handlinger'

export interface Abonnementsvisning {
  status: string
  fase: 'intro' | 'normal' | null
  fornyelseStoppet?: boolean
  naeste:
    | { slags: 'beloeb'; oere: number }
    | { slags: 'fornyes_ikke' }
    | { slags: 'ukendt' }
  fornyesAt: string | null
  adgangTil: string | null
  opsagt: boolean
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
      setA((x) => (x ? { ...x, opsagt: true, naeste: { slags: 'fornyes_ikke' }, fornyesAt: null } : x))
      setMelding('Abonnementet er sagt op. Adgangen løber perioden ud.')
      return
    }
    setMelding({
      ikke_logget_ind: 'Log ind igen, og prøv så.',
      intet_abonnement: 'Der er ikke noget løbende abonnement at sige op.',
      stripe_mangler: 'Betaling er ikke slået til. Skriv til info@bofinda.dk.',
      stripe_fejlede: 'Opsigelsen gik ikke igennem. Prøv igen — der er ikke ændret noget.',
    }[svar.fejl])
  }

  return (
    <section id="abonnement">
      <h2>Mit abonnement</h2>
      <dl className="abonnementsliste">
        <div><dt>Status</dt><dd>{a.opsagt ? 'Opsagt' : statusTekst(a.status)}</dd></div>
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
              : 'Kan ikke bekræftes lige nu'}
          </dd>
        </div>
        {a.naeste.slags === 'ukendt' && !a.opsagt && (
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
      {!a.opsagt && (
        <button type="button" className="knap" onClick={sigOpNu} disabled={arbejder}>
          {arbejder ? 'Siger op …' : 'Sig abonnementet op'}
        </button>
      )}
      {a.opsagt && a.adgangTil && (
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
