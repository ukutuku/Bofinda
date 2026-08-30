// ═══════════════════════════════════════════════════════════════
//  Adresse.
//
//  To ting, som ikke maa blandes sammen:
//
//    PARSNING  at dele kildens streng op i vej, husnr, etage, doer,
//              postnr og by. Laesning af data vi allerede har.
//    VASK      at binde adressen til en noegle, saa to kilder der skriver
//              den samme bolig forskelligt, bliver til én bolig.
//
//  Vasken har to implementeringer bag samme kontrakt:
//
//    SimpelAdressevask   Deterministisk noegle af postnr + vej + husnr
//                        (+ etage + doer). INTERN — ikke et DAR-UUID.
//                        Godt nok til dedup mellem kilder, og virker nu.
//    DarAdressevask      Officielt opslag i Datafordeleren. Ikke bygget.
//
//  Skiftet mellem dem er ét miljoevariabel. Ingen kaldere aendres.
// ═══════════════════════════════════════════════════════════════

/** Praefiks paa alle internt genererede noegler.
 *  Ligger i unit_address_uuid / access_address_uuid, fordi skemaets
 *  check-constraint kraever et UUID-felt udfyldt paa 'unit' og 'access'.
 *  Praefikset er den eneste maade at kende dem fra rigtige DAR-UUID'er,
 *  naar de en dag ligger side om side i samme kolonne:
 *      update listings set ... where unit_address_uuid like 'intern:v1:%'
 *  Versionsnummeret skal haeves, hvis normaliseringen aendres — ellers
 *  aendrer gamle raekker gruppe uden at blive skrevet om. */
export const INTERN_PRAEFIKS = 'intern:v1:'

export const erInternNoegle = (n: string | null): boolean =>
  n != null && n.startsWith(INTERN_PRAEFIKS)

export type MatchNiveau = 'unit' | 'access' | 'failed'

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
  addressMatchLevel: MatchNiveau
  lat: string | null
  lng: string | null
}

export interface Adressevask {
  readonly id: string
  /** Sandt kun for en rigtig myndighedskilde. Styrer om vi tør love praecision. */
  readonly officiel: boolean
  vask(raw: string, hint?: { postalCode?: string | null }): Promise<VasketAdresse>
}

const TOM: ParsetAdresse = {
  street: null, houseNumber: null, floor: null,
  door: null, postalCode: null, city: null,
}

// ─── Parsning ──────────────────────────────────────────────────

/**
 * "Noerrebrogade 56 B, 3. tv, 2200 Koebenhavn N" ->
 *   vej=Noerrebrogade nr=56B etage=3 doer=tv postnr=2200 by=Koebenhavn N
 * Felter der ikke kan laeses, bliver null. Der gaettes ikke.
 */
export function parsAdresse(raw: string): ParsetAdresse {
  if (!raw?.trim()) return { ...TOM }

  const post = raw.match(/\b(\d{4})\s+([A-Za-zÆØÅæøå][^,]*?)\s*(?:,\s*Danmark)?\s*$/)
  const postalCode = post?.[1] ?? null
  const city = post?.[2]?.trim() ?? null

  const foran = (post ? raw.slice(0, post.index) : raw).replace(/,\s*$/, '').trim()
  const dele = foran.split(',').map((d) => d.trim()).filter(Boolean)

  const vejDel = dele[0] ?? ''
  const vej = vejDel.match(/^(.*?)\s+(\d+\s*[A-Za-z]?)$/)
  const street = vej ? vej[1]!.trim() : (vejDel || null)
  const houseNumber = vej ? vej[2]!.replace(/\s+/g, '').toUpperCase() : null

  let floor: string | null = null
  let door: string | null = null
  for (const d of dele.slice(1)) {
    const m = d.match(/^(st|stuen|kl|k(æ|ae)lder|\d{1,2})\.?\s*(?:sal)?\.?\s*([a-zæøå0-9.-]{1,6})?\.?$/i)
    if (m) {
      floor = normaliserEtage(m[1]!)
      door = m[3] ? normaliserDoer(m[3]) : null
      break
    }
  }
  return { street, houseNumber, floor, door, postalCode, city }
}

// ─── Normalisering til noegle ──────────────────────────────────
// Kilder skriver den samme adresse paa mange maader. Noeglen skal vaere
// den samme for dem alle, ellers dedup'er den ingenting.

/** æ->ae, ø->oe, å->aa, alt smaat, kun bogstaver og tal. */
function kanonisk(s: string): string {
  return s.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** "stuen", "st.", "0" -> "st". "kælder", "kl" -> "kl". "3." -> "3". */
export function normaliserEtage(s: string): string {
  const k = kanonisk(s)
  if (k === 'st' || k === 'stuen' || k === '0') return 'st'
  if (k === 'kl' || k === 'kaelder' || k === 'kaeld') return 'kl'
  return k.replace(/^0+/, '') || k
}

/** "t.v.", "TV", "venstre" -> "tv". Numre og bogstaver beholdes som de er. */
export function normaliserDoer(s: string): string {
  const k = kanonisk(s)
  if (k === 'tv' || k === 'venstre') return 'tv'
  if (k === 'th' || k === 'hoejre') return 'th'
  if (k === 'mf' || k === 'mit' || k === 'midt' || k === 'midtfor') return 'mf'
  return k
}

/** "56 B", "56b" -> "56b". */
const normaliserHusnr = (s: string): string => kanonisk(s)

// ─── 1. Simpel vask — virker nu ────────────────────────────────

export class SimpelAdressevask implements Adressevask {
  readonly id = 'simpel'
  /** Ikke officiel. Noeglen er vores egen, ikke myndighedens. */
  readonly officiel = false

  async vask(raw: string, hint?: { postalCode?: string | null }): Promise<VasketAdresse> {
    const p = parsAdresse(raw)
    const postalCode = p.postalCode ?? hint?.postalCode ?? null

    // Uden vejnavn eller postnummer ved vi ikke hvor boligen ligger.
    // Saa er den ikke matchet, og saa vises den ikke.
    if (!p.street || !postalCode) {
      return {
        ...p, postalCode,
        unitAddressUuid: null, accessAddressUuid: null,
        addressMatchLevel: 'failed', lat: null, lng: null,
      }
    }

    // Opgangen. Husnummer maa gerne mangle — saa er noeglen grovere, men
    // stadig deterministisk.
    const adgang = INTERN_PRAEFIKS + [
      postalCode,
      kanonisk(p.street),
      p.houseNumber ? normaliserHusnr(p.houseNumber) : '-',
    ].join(':')

    // Enheden kraever BEGGE dele. Etage uden doer peger paa flere boliger.
    const harEnhed = p.floor != null && p.door != null
    const enhed = harEnhed
      ? `${adgang}:${normaliserEtage(p.floor!)}:${normaliserDoer(p.door!)}`
      : null

    return {
      ...p,
      postalCode,
      unitAddressUuid: enhed,
      // Saettes ogsaa naar enheden er fundet — skemaet forventer begge.
      accessAddressUuid: adgang,
      addressMatchLevel: harEnhed ? 'unit' : 'access',
      // Koordinater kraever et rigtigt register. Vi opfinder dem ikke.
      lat: null, lng: null,
    }
  }
}

// ─── 2. Officiel vask — senere ─────────────────────────────────

/**
 * DAR gennem Datafordeleren.
 *
 * Naar den bygges: hent DAR som fildownload til en lokal tabel og slaa op
 * lokalt. Ét kald per adresse mod en ekstern tjeneste ville goere importen
 * langsom og goere hastighedsloeftet afhaengigt af en andens oppetid.
 *
 * Skiftet hertil kraever ogsaa en engangsopdatering af eksisterende raekker,
 * som kan findes praecist paa INTERN_PRAEFIKS.
 */
export class DarAdressevask implements Adressevask {
  readonly id = 'dar'
  readonly officiel = true

  async vask(_raw: string): Promise<VasketAdresse> {
    throw new Error(
      'DarAdressevask er ikke implementeret. Saet ADDRESS_WASHER=simpel, '
      + 'eller byg DAR-opslaget faerdigt.',
    )
  }
}

// ─── Valg ──────────────────────────────────────────────────────

const VASKERE: Record<string, () => Adressevask> = {
  simpel: () => new SimpelAdressevask(),
  dar: () => new DarAdressevask(),
}

let valgt: Adressevask | null = null

export function adressevask(): Adressevask {
  if (!valgt) {
    const navn = process.env.ADDRESS_WASHER ?? 'simpel'
    const lav = VASKERE[navn]
    if (!lav) throw new Error(`ukendt ADDRESS_WASHER: ${navn}. Kendte: ${Object.keys(VASKERE).join(', ')}`)
    valgt = lav()
  }
  return valgt
}

/** Bekvemmelighed — kalderne i normalize.ts roeres ikke ved skift. */
export const vaskAdresse = (raw: string, hint?: { postalCode?: string | null }) =>
  adressevask().vask(raw, hint)
