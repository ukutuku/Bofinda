import { afmeld, findPaaToken } from '../../../lib/alarm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Afmeld besked — Bofinda', robots: { index: false } }

// ═══════════════════════════════════════════════════════════════
//  Afmelding uden login.
//
//  Linket AFMELDER IKKE ved at blive åbnet. Mailscannere og
//  forhåndsvisninger henter hvert link i en mail, og et GET, der ændrer
//  noget, ville afmelde folk, der aldrig rørte det.
//
//  Derfor: GET viser en knap, POST afmelder. Mailklienternes
//  ét-klik-afmelding (List-Unsubscribe-Post) rammer samme POST og virker
//  derfor uden at åbne siden.
// ═══════════════════════════════════════════════════════════════

async function afmeldHandling(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  if (token) await afmeld(token)
}

export default async function Side(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const s = await findPaaToken(token)

  return (
    <div className="afmeld">
      {!s ? (
        <>
          <h1>Linket virker ikke</h1>
          <p>Søgningen findes ikke længere, eller linket er ufuldstændigt.</p>
        </>
      ) : s.afmeldt ? (
        <>
          <h1>Du er afmeldt</h1>
          <p>
            Du får ikke flere beskeder om <strong>{s.navn ?? 'din søgning'}</strong>.
            Søgningen er gemt, hvis du senere vil have den igen.
          </p>
        </>
      ) : (
        <>
          <h1>Afmeld besked</h1>
          <p>
            Du er ved at afmelde beskeder om <strong>{s.navn ?? 'din søgning'}</strong>.
            Vi sender ikke mere om den søgning.
          </p>
          <form action={afmeldHandling}>
            <input type="hidden" name="token" value={token} />
            <button type="submit">Ja, afmeld mig</button>
          </form>
          <p className="note">
            Du behøver ikke logge ind. Vi beholder søgningen, så den kan slås
            til igen, men sender ikke mere før du beder om det.
          </p>
        </>
      )}
      <p className="note"><a href="/">← Til boligsøgningen</a></p>
    </div>
  )
}
