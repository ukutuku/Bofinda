// Ét-klik-afmelding fra mailklienten (RFC 8058).
//
// KUN POST. Et GET her ville blive ramt af enhver mailscanner, der
// forhaandshenter links, og afmelde folk der aldrig roerte noget.
import { afmeld } from '../../../lib/alarm'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('t')
    ?? (await req.formData().catch(() => null))?.get('token')?.toString()
  if (!token) return new Response('mangler token', { status: 400 })
  const r = await afmeld(token)
  return new Response(r ? 'afmeldt' : 'ukendt token', { status: r ? 200 : 404 })
}
