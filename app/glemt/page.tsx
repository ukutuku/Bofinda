// ═══════════════════════════════════════════════════════════════
//  Siden, «Glemt adgangskode?» fører hen til.
//
//  Den er kontekstbaaren, ikke kontekstdelt: der er ÉN formular, og
//  `?k=` afgoer kun, hvor gendannelsesmailen sender hende hen bagefter
//  — Min side eller udlejersiden. Se lib/kontovej.ts.
// ═══════════════════════════════════════════════════════════════

import Link from 'next/link'
import { konfigureret } from '../../lib/auth'
import { K_PARAM, LINKFEJL, kontekstFra, vejFor } from '../../lib/kontovej'
import { Glemt } from './Glemt'

/** Formular og cookies pr. besoeg: intet at gengive paa forhaand. */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Glemt adgangskode — Bofinda',
  description: 'Bed om et link til at vælge en ny adgangskode.',
  robots: { index: false, follow: false },
}

export default async function Side(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const sp = await searchParams
  const kontekst = kontekstFra(sp[K_PARAM])
  const linkfejl = Boolean(sp[LINKFEJL])

  return (
    <div className="minside">
      <h1>Glemt adgangskode</h1>

      {konfigureret() ? (
        <>
          <Glemt kontekst={kontekst} linkfejl={linkfejl} />
          <p className="note">
            Kom du til at trykke forkert?{' '}
            <Link href={vejFor(kontekst).efterLogud}>Tilbage til log ind</Link>
          </p>
        </>
      ) : (
        <div className="blok">
          <p>Kontooprettelse er ikke sat op på dette miljø endnu.</p>
        </div>
      )}
    </div>
  )
}
