// ═══════════════════════════════════════════════════════════════
//  Adresse.
//
//  To adskilte ting, som ikke maa blandes sammen:
//
//    1. PARSNING  — at dele kildens streng op i vej, husnr, postnr, by.
//       Det er laesning af data, vi allerede har. Sker her.
//
//    2. VASK      — at slaa adressen op i det officielle register og faa
//       et UUID tilbage. Det er data, vi IKKE har. Kraever Datafordeleren
//       (DAR); DAWA lukker. Tjenesten er ikke valgt endnu, saa vaskeren
//       nedenfor svarer aerligt 'failed' paa alt.
//
//  Konsekvensen er med vilje synlig: uden vask faar ingen bolig et
//  matchniveau, og en bolig uden match vises ikke. Bedre end at lade som
//  om vi ved, hvor boligen ligger.
// ═══════════════════════════════════════════════════════════════

export interface ParsetAdresse {
  street: string | null
  houseNumber: string | null
  floor: string | null
  door: string | null
  postalCode: string | null
  city: string | null
}

export interface VasketAdresse extends ParsetAdresse {
  unitAddressUuid: string | null
  accessAddressUuid: string | null
  addressMatchLevel: 'unit' | 'access' | 'failed'
  lat: string | null
  lng: string | null
}

const TOM: ParsetAdresse = {
  street: null, houseNumber: null, floor: null,
  door: null, postalCode: null, city: null,
}

/**
 * "Noerrebrogade 56 B, 3. tv, 2200 Koebenhavn N" ->
 *   { street: 'Noerrebrogade', houseNumber: '56B', floor: '3', door: 'tv',
 *     postalCode: '2200', city: 'Koebenhavn N' }
 *
 * Felter der ikke kan laeses, bliver null. Der gaettes ikke.
 */
export function parsAdresse(raw: string): ParsetAdresse {
  if (!raw?.trim()) return { ...TOM }

  // Postnummer og by tages bagfra — de er de mest genkendelige.
  const post = raw.match(/\b(\d{4})\s+([A-Za-zÆØÅæøå][^,]*?)\s*(?:,\s*Danmark)?\s*$/)
  const postalCode = post?.[1] ?? null
  const city = post?.[2]?.trim() ?? null

  const foran = (post ? raw.slice(0, post.index) : raw).replace(/,\s*$/, '').trim()
  const dele = foran.split(',').map((d) => d.trim()).filter(Boolean)

  const vejDel = dele[0] ?? ''
  const vej = vejDel.match(/^(.*?)\s+(\d+\s*[A-Za-z]?)$/)
  const street = vej ? vej[1]!.trim() : (vejDel || null)
  const houseNumber = vej ? vej[2]!.replace(/\s+/g, '').toUpperCase() : null

  // "3. tv", "st. th", "4 th"
  let floor: string | null = null
  let door: string | null = null
  for (const d of dele.slice(1)) {
    const m = d.match(/^(st|kl|\d{1,2})\.?\s*(tv|th|mf|[a-z0-9-]{1,4})?\.?$/i)
    if (m) {
      floor = m[1]!.toLowerCase()
      door = m[2]?.toLowerCase() ?? null
      break
    }
  }

  return { street, houseNumber, floor, door, postalCode, city }
}

/**
 * Sommen til adressevask. Naar DAR-tabellen er bygget, udskiftes kun
 * kroppen her — kaldere roeres ikke.
 */
export async function vaskAdresse(raw: string): Promise<VasketAdresse> {
  const parset = parsAdresse(raw)
  return {
    ...parset,
    // Kraever opslag i DAR. Findes ikke endnu — derfor null og 'failed'.
    unitAddressUuid: null,
    accessAddressUuid: null,
    addressMatchLevel: 'failed',
    lat: null,
    lng: null,
  }
}

/** Sandt naar vaskeren er en rigtig tjeneste og ikke sommen ovenfor. */
export const adressevaskErKonfigureret = false
