import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  BASISCOOKIE, C_FORSOEG, C_SAMTYKKE, FORSOEG_SEK, SAMTYKKE_SEK, VALGCOOKIE,
} from '../../../lib/samtykke'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Brugertest — Bofinda', robots: { index: false } }

// ═══════════════════════════════════════════════════════════════
//  Start af en modereret brugertest.
//
//  Siden BEKRÆFTER IKKE ved at blive åbnet. Deltageren skal selv trykke,
//  efter at have læst hvad der optages — samme princip som bekræftelses-
//  og afmeldingslinket, og af samme grund: et samtykke, moderator sætter
//  på deltagerens vegne, er ikke et samtykke.
//
//  Holdnummeret er et løbenummer. Aldrig navn, initialer eller mail.
//  Taggen giver INGEN produktrettigheder — den læses kun, når et event
//  skrives, og deltageren ser nøjagtig samme Bofinda som alle andre.
// ═══════════════════════════════════════════════════════════════

const KODE = /^[a-z0-9][a-z0-9_-]{0,39}$/i

export default async function Side({ params }: { params: Promise<{ kode: string }> }) {
  const { kode } = await params
  const gyldig = KODE.test(kode)

  async function start() {
    'use server'
    if (!gyldig) return
    const jar = await cookies()
    jar.set(C_SAMTYKKE, 'ja', { ...VALGCOOKIE, maxAge: SAMTYKKE_SEK })
    jar.set(C_FORSOEG, kode, { ...BASISCOOKIE, maxAge: FORSOEG_SEK })
    redirect('/')
  }

  if (!gyldig) {
    return (
      <div className="afmeld">
        <h1>Linket virker ikke</h1>
        <p>Holdnummeret er ikke gyldigt.</p>
        <p className="note"><a href="/">← Til boligsøgningen</a></p>
      </div>
    )
  }

  return (
    <div className="afmeld">
      <h1>Brugertest</h1>
      <p>
        Du er ved at starte en session, hvor vi registrerer, hvad du klikker på
        undervejs — hvilke søgninger du laver, hvilke boliger du åbner, og om du
        går videre til en udlejer. Det er nøjagtig det samme, vi måler for alle
        andre, plus et <strong>holdnummer</strong> ({kode}), så vi kan finde lige
        præcis denne session igen bagefter.
      </p>
      <p>
        Vi gemmer <strong>ikke</strong> dit navn, din mailadresse, dit
        telefonnummer eller det, du skriver i søgefeltet. Holdnummeret er et
        løbenummer og siger intet om, hvem du er.
      </p>
      <p>Optagelsen stopper efter fire timer, og tallene slettes efter 90 dage.</p>
      <form action={start}>
        <button type="submit">Ja, start sessionen</button>
      </form>
      <p className="note">
        Vil du ikke være med, skal du bare lukke siden. Uden dit tryk registrerer
        vi ingenting. <a href="/privatliv">Sådan behandler vi dine oplysninger</a>.
      </p>
    </div>
  )
}
