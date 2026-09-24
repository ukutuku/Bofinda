import type { Metadata } from 'next'
import { renRetur } from '../../lib/retur'
import { betaltPeriode, hentTilstand } from '../../lib/adgang'
import { ADGANG_UKENDT } from '../../lib/adgangsgrunde'
import { hentBrugerId } from '../../lib/auth'
import { gaeldendeTilbud } from '../../lib/abonnement'
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
  const retur = renRetur(sp.retur)
  const tilstand = await hentTilstand()
  const brugerId = await hentBrugerId()
  const tilbud = await gaeldendeTilbud()
  // MURENS opslag, ikke panelets. Siden spoerger udelukkende «har hun
  // adgang» og bruger ingen af kontraktens felter; laeste den
  // `mitAbonnement()`, ville den svare paa en daarligere stikproeve —
  // den raekke, der er NYEST, ikke den, der raekker LAENGST.
  const periode = brugerId ? await betaltPeriode(brugerId) : null

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

  // Kunne vi ikke laese det — hverken tilstanden eller hendes periode —
  // saa siger vi det, med de samme ord som kontaktboksen. At vise
  // koebsboksen her ville sende et menneske til kassen paa grund af
  // VORES fejl.
  if (tilstand === null || periode?.slags === 'fejl') {
    return (
      <main className="side-smal">
        <h1>Abonnement</h1>
        <p>{ADGANG_UKENDT}</p>
        <p><a href={retur}>Tilbage</a></p>
      </main>
    )
  }

  if (periode?.slags === 'loeber') {
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
      <Koebsboks retur={retur} loggetInd={!!brugerId} tilbud={tilbud ?? 'intro'} />
    </main>
  )
}
