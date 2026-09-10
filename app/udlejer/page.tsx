import { redirect } from 'next/navigation'
import { hentUdlejer, konfigureret } from '../../lib/auth'
import { LINKFEJL } from '../../lib/kontovej'
import { Konto } from './Konto'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Udlej din bolig — Bofinda' }

export default async function Side(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  if (konfigureret() && await hentUdlejer()) redirect('/udlejer/boliger')
  // Callbacken sender hertil, naar bekraeftelseslinket ikke kunne veksles.
  // Ét fast ord i URL'en — aldrig en kode og aldrig Auth-serverens tekst.
  const linkfejl = Boolean((await searchParams)[LINKFEJL])

  return (
    <div className="udlejer">
      <h1>Udlej din bolig</h1>
      <p className="manchet">
        Opret din bolig på Bofinda. Det er gratis indtil videre. Din annonce står
        sammen med de {' '}boliger, vi henter fra andre portaler — med den samme
        ærlige økonomi: husleje, aconto og hvad der skal betales ved indflytning.
      </p>

      {konfigureret() ? <Konto kontekst="udlejer" linkfejl={linkfejl} /> : (
        <div className="blok">
          <p>Kontooprettelse er ikke sat op på dette miljø endnu.</p>
        </div>
      )}
    </div>
  )
}
