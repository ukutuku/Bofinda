// ═══════════════════════════════════════════════════════════════
//  Landingssiden for et gendannelseslink.
//
//  ═══ HVAD DER AUTORISERER ÆNDRINGEN ═══
//
//  Sessionen. Ikke adressen. Callbacken har vekslet koden fra mailen
//  til en rigtig session, og `harAuthSession()` spørger Auth-serveren,
//  om den findes. Uden den vises en forklaring og en vej videre —
//  aldrig formularen.
//
//  At skrive /nulstil i adresselinjen giver derfor ingenting, og `?k=`
//  vælger kun, hvor hun sendes hen bagefter.
//
//  ═══ OG HVAD DER IKKE SKER HER ═══
//
//  Ingenting ændres af at ÅBNE siden. Adgangskoden skiftes først af
//  server action'en bag formularen, altså på et POST. En mailscanner
//  eller en forhåndsvisning, der henter adressen, kan ikke sætte en ny
//  kode — samme regel som afmeldings- og bekræftelseslinkene i
//  CLAUDE.md.
// ═══════════════════════════════════════════════════════════════

import type { Metadata } from 'next'
import Link from 'next/link'
import { harAuthSession, konfigureret } from '../../lib/auth'
import { K_PARAM, kontekstFra, vejFor } from '../../lib/kontovej'
import { NyKode } from './NyKode'

/** Sessionen afgør, hvad siden viser. Der er intet at gengive på forhånd. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Vælg ny adgangskode — Bofinda',
  description: 'Vælg en ny adgangskode til din konto.',
  robots: { index: false, follow: false },
}

export default async function Side(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const sp = await searchParams
  const kontekst = kontekstFra(sp[K_PARAM])

  if (!konfigureret()) {
    return (
      <div className="minside">
        <h1>Vælg ny adgangskode</h1>
        <div className="blok"><p>Kontooprettelse er ikke sat op på dette miljø endnu.</p></div>
      </div>
    )
  }

  // Ét spørgsmål til Auth-serveren afgør hele siden.
  if (!(await harAuthSession())) {
    return (
      <div className="minside">
        <h1>Vælg ny adgangskode</h1>
        <div className="blok kontofejl" role="status">
          <p><strong>Linket er ikke længere gyldigt.</strong></p>
          <p>
            Gendannelseslinks kan kun bruges én gang, og de udløber efter kort tid.
            Åbnede du mailen i en anden browser end den, du bad om linket fra, virker
            det heller ikke — linket hører til den browser, der spurgte.
          </p>
          <p>
            <Link href={`/glemt?${K_PARAM}=${kontekst}`}>Bed om et nyt link</Link>
            {' · '}
            <Link href={vejFor(kontekst).efterLogud}>Log ind</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="minside">
      <h1>Vælg ny adgangskode</h1>
      <p className="manchet">
        Vælg en ny adgangskode til din konto. Den gamle holder op med at virke med
        det samme.
      </p>
      <NyKode kontekst={kontekst} />
    </div>
  )
}
