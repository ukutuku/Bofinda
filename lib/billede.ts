// ═══════════════════════════════════════════════════════════════
//  Billed-proxy: signering og URL-bygning.
//
//  Billeder hotlinkes, kopieres aldrig. Vi gemmer kildens egen URL i
//  listing_images og henter den gennem vores egen rute, som skalerer og
//  konverterer til WebP undervejs. Nul lagerplads, aldrig foraeldede
//  billeder — og kilden faar ikke vores brugeres IP-adresser.
//
//  Signaturen er der, saa fremmede ikke kan bruge proxyen som gratis
//  billedtjeneste for vilkaarlige URL'er. Vaertslisten er andet lag:
//  slipper hemmeligheden ud, kan den stadig kun pege paa de to vaerter,
//  vi allerede hotlinker fra.
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Vaerter vi henter billeder fra. Skal foelge kilderne i adapters/. */
export const TILLADTE_VAERTER = new Set([
  'app.propstep.com',
  'findbolig.nu',
])

/** Bredder vi overhovedet udleverer. Frit valg ville lade en fremmed
 *  bede om tusind varianter og fylde cachen. */
export const BREDDER = [400, 800, 1600] as const
export type Bredde = (typeof BREDDER)[number]

function hemmelighed(): string {
  const s = process.env.BILLED_HEMMELIGHED
  if (!s || s.length < 16) {
    throw new Error('BILLED_HEMMELIGHED mangler eller er for kort (mindst 16 tegn)')
  }
  return s
}

const signer = (url: string, bredde: number): string =>
  createHmac('sha256', hemmelighed()).update(`${url}|${bredde}`).digest('base64url').slice(0, 24)

/** Sammenlign i konstant tid — ellers kan signaturen gaettes tegn for tegn. */
export function signaturOk(url: string, bredde: number, givet: string): boolean {
  const vores = Buffer.from(signer(url, bredde))
  const deres = Buffer.from(givet)
  if (vores.length !== deres.length) return false
  return timingSafeEqual(vores, deres)
}

export function vaertTilladt(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && TILLADTE_VAERTER.has(u.host)
  } catch {
    return false
  }
}

/** Kildens billed-URL -> vores signerede rute. */
export function billedUrl(eksternUrl: string, bredde: Bredde = 800): string | null {
  if (!vaertTilladt(eksternUrl)) return null
  const p = new URLSearchParams({
    u: eksternUrl,
    b: String(bredde),
    s: signer(eksternUrl, bredde),
  })
  return `/api/billede?${p}`
}
