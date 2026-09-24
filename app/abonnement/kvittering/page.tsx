import type { Metadata } from 'next'
import { renRetur } from '../../../lib/retur'
import { dansk } from '../../../lib/dato'
import { hentBrugerId } from '../../../lib/auth'
import { betaltPeriode, hentTilstand } from '../../../lib/adgang'
import { ADGANG_UKENDT } from '../../../lib/adgangsgrunde'

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
  // MURENS opslag. Efter hinanden, ikke i Promise.all — se noten i
  // app/page.tsx om pipelinede saetninger gennem transaction-pooleren.
  const tilstand = await hentTilstand()
  const periode = brugerId ? await betaltPeriode(brugerId) : null
  const harAdgang = periode?.slags === 'loeber'

  // ── VI MAA IKKE SIGE «DU HAR ADGANG», NAAR VI IKKE VED DET ──
  // Siden laeste foer hverken `drift` eller et fejludfald. Kunne
  // tilstanden ikke laeses, sagde hver boligside «det er en fejl hos
  // os» — mens kvitteringen i samme sekund sagde «Tak — du har
  // adgang». To skaerme, samme sekund, modsat svar om de samme penge.
  if (tilstand === null || periode?.slags === 'fejl') {
    return (
      <main className="side-smal">
        <h1>Vi kan ikke bekræfte din adgang</h1>
        <p>{ADGANG_UKENDT}</p>
        <p>
          <strong>Der er ikke trukket noget ekstra</strong>, og du skal
          ikke betale igen.
        </p>
        <p>
          <a href={`/abonnement/kvittering?retur=${encodeURIComponent(retur)}`}>Opdatér</a>
          {' · '}
          <a href={retur}>Tilbage</a>
        </p>
      </main>
    )
  }

  return (
    <main className="side-smal">
      <h1>{harAdgang ? 'Tak — du har adgang' : 'Vi venter på betalingen'}</h1>
      {harAdgang ? (
        <>
          <p>
            Adgangen gælder til{' '}
            <strong>{dansk((periode as { til: Date }).til)}</strong>, og
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
