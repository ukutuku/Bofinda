import { bekraeft, beskrivFiltre, findPaaBekraeftToken } from '../../../lib/alarm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Bekræft besked — Bofinda', robots: { index: false } }

// ═══════════════════════════════════════════════════════════════
//  Bekræftelse af tilmelding.
//
//  Linket BEKRÆFTER IKKE ved at blive åbnet. Mailscannere og
//  forhåndsvisninger henter hvert link i en mail — og et GET, der
//  aktiverer, ville betyde, at modtagerens egen mailserver bekræftede
//  for hende. Så var den dobbelte tilmelding ingenting værd.
//
//  GET viser en knap. POST aktiverer. Samme princip som afmeldingen,
//  af samme grund.
// ═══════════════════════════════════════════════════════════════

async function bekraeftHandling(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  if (token) await bekraeft(token)
}

export default async function Side(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const s = await findPaaBekraeftToken(token)

  return (
    <div className="afmeld">
      {!s ? (
        <>
          <h1>Linket virker ikke</h1>
          <p>Søgningen findes ikke længere, eller linket er ufuldstændigt.</p>
        </>
      ) : s.bekraeftet ? (
        <>
          <h1>Du får besked</h1>
          <p>
            <strong>{s.navn ?? 'Din søgning'}</strong> er aktiv. Vi sender, så snart
            der kommer en ny bolig, der matcher — højst én mail i timen.
          </p>
          <p className="note">Hver besked har et afmeldingslink, der virker uden login.</p>
        </>
      ) : (
        <>
          <h1>Bekræft din boligbesked</h1>
          <p>
            Du er ved at slå besked til for <strong>{s.navn ?? 'din søgning'}</strong>.
          </p>
          <p className="kriterier">{beskrivFiltre(s.kriterier)}</p>
          <form action={bekraeftHandling}>
            <input type="hidden" name="token" value={token} />
            <button type="submit">Ja, send mig besked</button>
          </form>
          <p className="note">
            Var det ikke dig, der bad om det, skal du bare lukke siden. Uden dit
            tryk sender vi intet.
          </p>
        </>
      )}
      <p className="note"><a href="/">← Til boligsøgningen</a></p>
    </div>
  )
}
