import { redirect } from 'next/navigation'
import { hentUdlejer, konfigureret } from '../../lib/auth'
import { cookies } from 'next/headers'
import { KVITTERINGSCOOKIE, LINKFEJL, kvitteringFra } from '../../lib/kontovej'
import { Konto } from './Konto'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Udlej din bolig — Bofinda' }

export default async function Side(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  // Er hun logget ind, hoerer hun til paa Mine annoncer, og hun sendes
  // derhen FOER kvitteringen nedenfor laeses. Det er med vilje — adgangen
  // maa ikke afhaenge af en cookie, der kun baerer en besked. Blokken
  // gengives derfor OGSAA paa /udlejer/boliger, for fejler udlogningen i
  // `gemNyKode`, er det den side, hun faktisk lander paa.
  if (konfigureret() && await hentUdlejer()) redirect('/udlejer/boliger')
  // Callbacken sender hertil, naar bekraeftelseslinket ikke kunne veksles.
  // Ét fast ord i URL'en — aldrig en kode og aldrig Auth-serverens tekst.
  const sp = await searchParams
  const linkfejl = Boolean(sp[LINKFEJL])
  // Kvitteringen efter en gennemfoert gendannelse. Den kommer fra en
  // cookie, SERVEREN satte i gemNyKode() — ikke fra adressen. Et
  // haandskrevet «?nulstillet=1» skal ikke kunne faa siden til at
  // paastaa, at en adgangskode lige er skiftet.
  const kvittering = kvitteringFra((await cookies()).get(KVITTERINGSCOOKIE)?.value)

  return (
    <div className="udlejer">
      <h1>Udlej din bolig</h1>
      <p className="manchet">
        Opret din bolig på Bofinda. Det er gratis indtil videre. Din annonce står
        sammen med de {' '}boliger, vi henter fra andre portaler — med den samme
        ærlige økonomi: husleje, aconto og hvad der skal betales ved indflytning.
      </p>

      {konfigureret() ? <Konto kontekst="udlejer" linkfejl={linkfejl} kvittering={kvittering} /> : (
        <div className="blok">
          <p>Kontooprettelse er ikke sat op på dette miljø endnu.</p>
        </div>
      )}
    </div>
  )
}
