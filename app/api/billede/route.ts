// ═══════════════════════════════════════════════════════════════
//  Billed-proxyen.
//
//  Henter kildens billede, skalerer og konverterer til WebP, og sender
//  det videre. Kildens URL naar aldrig browseren, og browseren naar
//  aldrig kilden.
// ═══════════════════════════════════════════════════════════════

import { BREDDER, signaturOk, vaertTilladt, type Bredde } from '../../../lib/billede'

export const runtime = 'nodejs'

const UA = process.env.CRAWLER_USER_AGENT
  ?? 'BofindaBot/1.0 (+https://bofinda.dk/bot; kontakt@bofinda.dk)'

const afvis = (grund: string, kode = 400) =>
  new Response(grund, { status: kode, headers: { 'cache-control': 'no-store' } })

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const url = q.get('u')
  const bredde = Number(q.get('b'))
  const sig = q.get('s')

  if (!url || !sig || !BREDDER.includes(bredde as Bredde)) return afvis('ugyldige parametre')
  // Vaertslisten tjekkes FOER signaturen: slipper hemmeligheden ud, skal
  // proxyen stadig ikke kunne pege paa vilkaarlige adresser.
  if (!vaertTilladt(url)) return afvis('vært ikke tilladt', 403)
  if (!signaturOk(url, bredde, sig)) return afvis('ugyldig signatur', 403)

  let raa: ArrayBuffer
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'image/*' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return afvis(`kilden svarede ${r.status}`, 502)
    const type = r.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return afvis('kilden svarede ikke med et billede', 502)
    raa = await r.arrayBuffer()
  } catch (e) {
    return afvis(`kunne ikke hente billedet: ${(e as Error).message}`, 502)
  }

  try {
    const sharp = (await import('sharp')).default
    const ud = await sharp(Buffer.from(raa))
      .rotate()                                   // respektér EXIF
      .resize({ width: bredde, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    return new Response(new Uint8Array(ud), {
      headers: {
        'content-type': 'image/webp',
        // Signaturen binder (url, bredde), saa svaret aendrer sig aldrig.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    // Kan billedet ikke laeses, sendes originalen videre frem for ingenting.
    return new Response(raa, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' },
    })
  }
}
