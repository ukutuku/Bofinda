// ═══════════════════════════════════════════════════════════════
//  Samtykke og de pseudonyme identifikatorer.
//
//  Filen er REN: den importerer hverken next/headers, databasen eller
//  noget andet. Den regner på cookieværdier og siger, hvad der skal
//  sættes. Middleware og lib/maaling-server.ts er dem, der taler med
//  browseren — og de er de eneste, der kan.
//
//  Grunden er den samme som for lib/maaling.ts: lib/alarm.ts skal
//  instrumenteres, og den importeres af scripts/import.ts, som kører i
//  tsx på Railway UDEN Next omkring sig. Et import af next/headers her
//  ville vælte workeren.
//
//  FØR SAMTYKKE SÆTTES INTET. Ingen anonymous_id, ingen session_id,
//  ingen events. Der er ikke noget «aggregeret lag» nedenunder — se
//  docs/analytics-v1.md.
// ═══════════════════════════════════════════════════════════════

/** Registrerer brugerens EGET valg. Strengt nødvendig, kræver ikke samtykke. */
export const C_SAMTYKKE = 'bofinda_samtykke'
/** Pseudonymt browsernummer. Sættes kun efter et ja. */
export const C_ANONYM = 'bofinda_aid'
/** Pseudonymt besøgsnummer. Sættes kun efter et ja. */
export const C_SESSION = 'bofinda_sid'
/** Holdnummer under en modereret brugertest. */
export const C_FORSOEG = 'bofinda_forsoeg'

export const SAMTYKKE_SEK = 365 * 24 * 3600
/** Inaktivitet. Browseren smider cookien selv — ingen serverside tilstand. */
export const SESSION_SEK = 30 * 60
/** Absolut loft. Uden det ville en, der åbner siden hver 25. minut i en
 *  uge, have ÉN session — og så måler feltet ikke en session, men en person. */
export const SESSION_MAKS_MS = 12 * 3600 * 1000
export const ANONYM_SEK = 180 * 24 * 3600
export const FORSOEG_SEK = 4 * 3600

export type Samtykke = 'ja' | 'nej' | 'uvalgt'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KODE = /^[a-z0-9][a-z0-9_-]{0,39}$/i

export type Laeser = (navn: string) => string | undefined

export function laesSamtykke(faa: Laeser): Samtykke {
  const v = faa(C_SAMTYKKE)
  return v === 'ja' ? 'ja' : v === 'nej' ? 'nej' : 'uvalgt'
}

export function laesForsoeg(faa: Laeser): string | null {
  const v = faa(C_FORSOEG)
  return v && KODE.test(v) ? v : null
}

/**
 * Tilfældigt, ikke udledt.
 *
 * Ingen IP, ingen user-agent, ingen canvas, ingen skærmopløsning. Værdien
 * KAN ikke genskabes, hvis brugeren sletter den — det er forskellen på et
 * pseudonym og et fingeraftryk.
 */
export function nytId(): string {
  return crypto.randomUUID()
}

export interface Sessionstilstand {
  id: string
  startMs: number
  /** Sand, hvis der skal skrives en ny cookie ud. */
  ny: boolean
}

/** `<uuid>.<startMs>` — begge grænser kan aflæses af værdien alene. */
export function sessionFra(vaerdi: string | undefined, nu: Date): Sessionstilstand {
  if (vaerdi) {
    const skaer = vaerdi.lastIndexOf('.')
    if (skaer > 0) {
      const id = vaerdi.slice(0, skaer)
      const start = Number(vaerdi.slice(skaer + 1))
      if (UUID.test(id) && Number.isFinite(start) && start > 0) {
        // Inaktiviteten håndhæves af cookiens Max-Age; her er kun loftet.
        if (nu.getTime() - start < SESSION_MAKS_MS) {
          return { id, startMs: start, ny: false }
        }
      }
    }
  }
  return { id: nytId(), startMs: nu.getTime(), ny: true }
}

export const sessionVaerdi = (s: Sessionstilstand) => `${s.id}.${s.startMs}`

export function anonymFra(vaerdi: string | undefined): { id: string; ny: boolean } {
  if (vaerdi && UUID.test(vaerdi)) return { id: vaerdi, ny: false }
  return { id: nytId(), ny: true }
}

/** Én beskrivelse af en cookie, som både middleware og ruter kan sætte. */
export interface Cookieplan {
  navn: string
  vaerdi: string
  maxAge: number
}

export const BASISCOOKIE = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const

/**
 * Samtykkecookien er IKKE HttpOnly, og det er med vilje.
 *
 * Den bærer brugerens eget valg og intet andet — der er intet at
 * beskytte. Til gengæld skal banneret kunne afgøre, om det skal vises,
 * uden at layoutet læser cookies på serveren; gjorde det det, ville hver
 * eneste områdeside blive dynamisk og falde ud af den statiske
 * gengivelse, SEO-ruterne lever af.
 *
 * `bofinda_aid`, `bofinda_sid` og `bofinda_forsoeg` er og bliver HttpOnly.
 */
export const VALGCOOKIE = {
  httpOnly: false,
  sameSite: 'lax',
  path: '/',
} as const

/**
 * Hvad der skal sættes for et samtykkende besøg.
 *
 * Sessionen fornyes ved HVER request — det er dét, der gør de 30 minutter
 * til inaktivitet og ikke til en fast levetid.
 */
export function planFor(
  faa: Laeser, nu: Date,
): { anonymId: string; sessionId: string; saet: Cookieplan[] } | null {
  if (laesSamtykke(faa) !== 'ja') return null
  const a = anonymFra(faa(C_ANONYM))
  const s = sessionFra(faa(C_SESSION), nu)
  const saet: Cookieplan[] = [
    { navn: C_SESSION, vaerdi: sessionVaerdi(s), maxAge: SESSION_SEK },
  ]
  if (a.ny) saet.push({ navn: C_ANONYM, vaerdi: a.id, maxAge: ANONYM_SEK })
  return { anonymId: a.id, sessionId: s.id, saet }
}

/**
 * Ved tilbagetrækning slettes analytics-identifikatorerne — og KUN dem.
 * Auth- og sikkerhedscookies røres ikke.
 */
export const RYD_VED_NEJ = [C_ANONYM, C_SESSION, C_FORSOEG] as const
