import type { Metadata } from 'next'
import { renRetur } from '../../../lib/retur'
import { mitAbonnement } from '../../../lib/abonnement'
import { hentBrugerId } from '../../../lib/auth'

// ═══════════════════════════════════════════════════════════════
//  Tilbagevenden fra Stripe.
//
//  Siden LAESER vores egen base. Den tror ikke paa noget i URL'en:
//  hverken `session_id`, `success=true` eller en `retur`-sti giver
//  adgang. Adgangen staar i `subscriptions.adgang_til`, og den kolonne
//  skrives kun af webhooken, naar en faktura er BETALT.
//
//  Derfor kan siden ogsaa vise «vi venter stadig»: Stripes webhook
//  kommer typisk inden for sekunder, men kunden er tilbage med det
//  samme. At sige «du har adgang» foer vi har set pengene ville vaere
//  den samme loegn som et gaettet aconto-beloeb.
// ═══════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Kvittering · Bofinda', robots: { index: false } }

export default async function Side({ searchParams }: {
  searchParams: Promise<{ retur?: string }>
}) {
  const sp = await searchParams
  const retur = renRetur(sp.retur)
  const brugerId = await hentBrugerId()
  const abo = brugerId ? await mitAbonnement() : null
  const harAdgang = !!abo?.adgangTil && abo.adgangTil > new Date()

  return (
    <main className="side-smal">
      <h1>{harAdgang ? 'Tak — du har adgang' : 'Vi venter på betalingen'}</h1>
      {harAdgang ? (
        <>
          <p>
            Adgangen gælder til{' '}
            <strong>{abo!.adgangTil!.toLocaleString('da-DK')}</strong>, og
            abonnementet fornyes automatisk, indtil du siger op.
          </p>
          <p><a className="knap" href={retur}>Tilbage til boligen</a></p>
        </>
      ) : (
        <>
          <p>
            Vi har ikke fået bekræftet betalingen endnu. Det tager som regel
            få sekunder. Opdatér siden om lidt — der er ikke trukket noget
            ekstra, og du skal ikke betale igen.
          </p>
          {/* Returvejen skal MED. Uden den landede kunden paa forsiden
              efter at have opdateret én gang — og boligen, hun havde
              betalt for at kunne kontakte, var vaek. */}
          <p>
            <a href={`/abonnement/kvittering?retur=${encodeURIComponent(retur)}`}>Opdatér</a>
            {' · '}<a href={retur}>Tilbage</a>
          </p>
        </>
      )}
      <p><a href="/min-side#abonnement">Mit abonnement</a></p>
    </main>
  )
}
