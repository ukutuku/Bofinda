import type { Metadata } from 'next'
import { hentBrugerId } from '../../../lib/auth'
import { driftsbillede } from '../../../lib/driftskift'
import { Skifter } from './Skifter'

// ═══════════════════════════════════════════════════════════════
//  Ejerens knap. Skifter driftstilstand UDEN ny deployment.
//
//  Rollen laeses i basen af `driftsbillede()` — ikke fra en cookie, en
//  header eller en query-parameter. Er man ikke admin, ser man ikke
//  engang den nuvaerende tilstand.
// ═══════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Drift · Bofinda', robots: { index: false, follow: false } }

export default async function Side() {
  const b = await driftsbillede(await hentBrugerId())
  if (!b.admin) {
    // Samme svar for «ikke logget ind» og «logget ind uden adgang»:
    // siden roeber ikke, at der findes et adminomraade.
    return <main className="side-smal"><h1>Ikke fundet</h1></main>
  }
  return (
    <main className="side-smal">
      <h1>Driftstilstand</h1>
      <Skifter
        tilstand={b.tilstand!}
        levende={b.levende}
        aendretAt={b.aendretAt ? b.aendretAt.toLocaleString('da-DK') : null}
        note={b.note}
      />
    </main>
  )
}
