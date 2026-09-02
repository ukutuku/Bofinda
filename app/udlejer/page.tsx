import { redirect } from 'next/navigation'
import { hentUdlejer, konfigureret } from '../../lib/auth'
import { Konto } from './Konto'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Udlej din bolig — Bofinda' }

export default async function Side() {
  if (konfigureret() && await hentUdlejer()) redirect('/udlejer/boliger')

  return (
    <div className="udlejer">
      <h1>Udlej din bolig</h1>
      <p className="manchet">
        Opret din bolig på Bofinda. Det er gratis indtil videre. Din annonce står
        sammen med de {' '}boliger, vi henter fra andre portaler — med den samme
        ærlige økonomi: husleje, aconto og hvad der skal betales ved indflytning.
      </p>

      {konfigureret() ? <Konto /> : (
        <div className="blok">
          <p>Kontooprettelse er ikke sat op på dette miljø endnu.</p>
        </div>
      )}
    </div>
  )
}
