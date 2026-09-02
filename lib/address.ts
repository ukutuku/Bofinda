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
 *  Versionsnummeret skal haeves, hvis noeglen dannes anderledes — ogsaa naar
 *  det skyldes bedre parsning og ikke aendret normalisering. Ellers aendrer
 *  gamle raekker gruppe uden at blive skrevet om, og man kan ikke se hvilke.
 *
 *  v1 -> v2 (31. aug. 2026): parsningen laeser nu etage og doer, ogsaa naar
 *  de staar uden komma efter husnummeret. 111 af 686 Propstep-adresser fik
 *  foer enten intet husnummer eller etagen med i vejnavnet.
 *
 *  v2 -> v3 (31. aug. 2026): noegleordene "lejl.", "Lejl.", "dør" og "Dør"
 *  mellem etage og doer laeses nu. 29 af findboligs 50 access-adresser var
 *  i virkeligheden enhedsadresser — "Godsbanen 101, 2. lejl. 1". Et
 *  efterstillet lejlighedsnummer ("4. tv 35") ignoreres. */
export const INTERN_PRAEFIKS = 'intern:v3:'

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

  // Etage og doer staar IKKE altid efter et komma. Nogle kilder skriver
  //   "Marielundvej 47E st. th., 2730 Herlev"
  //   "Honningvaenget 85 2. 3, 8381 Tilst"
  // hvor alt staar i samme del. Uden det her bliver etagen en del af
  // vejnavnet, eller doeren bliver laest som husnummer.
  const vejDel = dele[0] ?? ''
  const vej = vejDel.match(/^(.*?)\s+(\d+\s*[A-Za-z]?)(?:\s+(.+))?$/)
  const street = vej ? vej[1]!.trim() : (vejDel || null)
  const houseNumber = vej ? vej[2]!.replace(/\s+/g, '').toUpperCase() : null
  const restEfterHusnr = vej?.[3]?.trim()

  let floor: string | null = null
  let door: string | null = null
  // Baade det der stod efter husnummeret og det der stod efter et komma.
  for (const d of [restEfterHusnr, ...dele.slice(1)].filter((x): x is string => !!x)) {
    // ── Bygning + enhed ────────────────────────────────────────
    //   "Bygning 4. 15"   Stenlængegårdens Kvarter, Næstved
    //   "B1 Nr. 8"        Valdemarsgade 96, Vordingborg
    //
    // Det er IKKE en etage. Bygning 4 er en blok, ikke fjerde sal, og
    // kortet skriver `etage. doer` — saa en bolig i stueetagen ville staa
    // som "4. sal". Derfor bliver `floor` staaende som null, og hele
    // betegnelsen gemmes som doeren, ordret som kilden skrev den.
    // Noeglen kanoniserer den alligevel (se normaliserDoer), saa
    // "Bygning 4. 15" og "bygning 4, 15" giver samme nøgle.
    // Den korte form KRAEVER "nr": uden det er "B1 8" for tvetydigt til at
    // laese som bygning og enhed. Den lange staar med "Bygning" selv.
    const byg = d.match(/^bygning\s*\d+[a-zæøå]?\s*[.,]?\s*(?:nr\.?\s*)?\d+[a-zæøå]?$/i)
      ?? d.match(/^[a-zæøå]\d+\s*[.,]?\s*nr\.?\s*\d+[a-zæøå]?$/i)
    if (byg) {
      floor = null
      door = d.toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '').trim()
      break
    }

    // Etage, saa evt. "sal", saa evt. nøgleordet "lejl."/"dør", saa doeren,
    // og til sidst et evt. lejlighedsnummer vi ikke bruger.
    //   "0."          -> etage st, ingen doer
    //   "2. lejl. 1"  -> etage 2, doer 1
    //   "1. Dør 3"    -> etage 1, doer 3
    //   "4. tv 35"    -> etage 4, doer tv   (35 er lejlighedsnummeret)
    //   "0."             -> etage st, ingen doer
    //   "2. lejl. 1"     -> etage 2, doer 1
    //   "2. sal - dør 3" -> etage 2, doer 3   (bindestreg mellem sal og doer)
    const m = d.match(
      /^(st|stuen|kl|k(?:æ|ae)lder|\d{1,2})\.?\s*(?:sal)?\.?\s*(?:[-–—]\s*)?(?:(?:lejl|lejlighed|d(?:ø|oe)r)\.?\s*)?([a-zæøå0-9.-]{1,6})?\.?(?:\s+\d{1,4})?$/i,
    )
    if (m) {
      floor = normaliserEtage(m[1]!)
      door = m[2] ? paenDoer(m[2]) : null
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

/**
 * Doeren som den GEMMES: smaa bogstaver, uden afsluttende punktum, og med
 * de klassiske forkortelser ensrettet. Danske bogstaver bevares — "Dør2"
 * bliver "dør2", ikke "doer2".
 *
 * Kanoniseringen (ae/oe/aa) hoerer til i noeglen, ikke i data. Blander man
 * de to, ender kildens egen skrivemaade forvansket i basen.
 */
export function paenDoer(s: string): string {
  const t = s.trim().toLowerCase().replace(/\.+$/, '')
  const uden = t.replace(/[^a-z0-9æøå]/g, '')
  if (uden === 'tv' || uden === 'venstre') return 'tv'
  if (uden === 'th' || uden === 'højre' || uden === 'hoejre') return 'th'
  if (uden === 'mf' || uden === 'midt' || uden === 'midtfor') return 'mf'
  return t
}

/** "t.v.", "TV", "venstre" -> "tv". Til NOEGLEN — kanoniserer æøå. */
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

    // Enheden kraever en DOER. Etage uden doer peger paa flere boliger —
    // "3. sal" er otte lejligheder. Omvendt peger en doer alene paa netop
    // én: "bygning 4 nr 15" og "tv" i en opgang med én bolig pr. side.
    //
    // Manglende etage skrives som '-' i noeglen. Raekker der har begge
    // dele beholder derfor praecis den noegle, de havde — kun boliger der
    // FOER stod uden enhed, faar en ny.
    const enhed = p.door != null
      ? `${adgang}:${p.floor != null ? normaliserEtage(p.floor) : '-'}:${normaliserDoer(p.door)}`
      : null
    const harEnhed = enhed != null

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
