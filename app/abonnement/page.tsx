import type { Metadata } from 'next'
import { hentTilstand } from '../../lib/adgang'
import { hentBrugerId } from '../../lib/auth'
import { mitAbonnement } from '../../lib/abonnement'
import { Koebsboks } from './Koebsboks'

// Siden afhaenger af tilstanden og af HVEM der spoerger. Den maa aldrig
// prerendres eller caches: et cachet svar ville baere ét menneskes
// adgang videre til det naeste.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Abonnement · Bofinda', robots: { index: false } }

export default async function Side({ searchParams }: {
  searchParams: Promise<{ retur?: string; grund?: string }>
}) {
  const sp = await searchParams
  const retur = sp.retur && sp.retur.startsWith('/') && !sp.retur.startsWith('//') ? sp.retur : '/'
  const tilstand = await hentTilstand()
  const brugerId = await hentBrugerId()
  const abo = brugerId ? await mitAbonnement() : null

  // GRATIS: der er intet at koebe, og der vises ingen koebsknap. En
  // direkte kalder af `koeb()` faar ogsaa nej — se lib/abonnement.ts.
  if (tilstand === 'gratis') {
    return (
      <main className="side-smal">
        <h1>Abonnement</h1>
        <p>
          Bofinda er gratis lige nu. Du kan se kontaktoplysninger og åbne
          annoncer hos kilderne uden at betale.
        </p>
        <p><a href={retur}>Tilbage</a></p>
      </main>
    )
  }

  if (tilstand === null) {
    return (
      <main className="side-smal">
        <h1>Abonnement</h1>
        <p>Vi kan ikke bekræfte din adgang lige nu. Det er en fejl hos os. Prøv igen om lidt.</p>
        <p><a href={retur}>Tilbage</a></p>
      </main>
    )
  }

  if (abo?.adgangTil && abo.adgangTil > new Date()) {
    return (
      <main className="side-smal">
        <h1>Abonnement</h1>
        <p>Du har allerede adgang. Se <a href="/min-side#abonnement">Mit abonnement</a>.</p>
        <p><a href={retur}>Tilbage til boligen</a></p>
      </main>
    )
  }

  return (
    <main className="side-smal">
      <h1>Abonnement</h1>
      <Koebsboks retur={retur} loggetInd={!!brugerId} />
    </main>
  )
}
