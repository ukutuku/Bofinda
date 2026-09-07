// ═══════════════════════════════════════════════════════════════
//  Produktanalytics — typer, allowlist og værn.
//
//  Hele designet står i docs/analytics-v1.md. Filen her er den ene
//  sandhed om, hvilke events der findes, og hvad de må bære.
//
//  DENNE FIL MÅ ALDRIG IMPORTERE DATABASEN. Klienttrackeren importerer
//  eventtyperne, og et værdi-import derfra trak engang `postgres` med ind
//  i browserbundtet og væltede hele appen på `Can't resolve 'net'` — se
//  reglen om lib/faciliteter.ts i CLAUDE.md. Skrivningen ligger i
//  lib/maaling-server.ts.
//
//  Værnet er en ALLOWLIST, ikke en blocklist. En liste over forbudte ord
//  kan aldrig blive komplet; en liste over tilladte kan.
// ═══════════════════════════════════════════════════════════════

// ─── Miljø ─────────────────────────────────────────────────────

export const MILJOEER = ['produktion', 'preview', 'udvikling', 'proeve'] as const
export type Miljoe = (typeof MILJOEER)[number]

/**
 * Sættes KUN af scripts/testbase.ts, på samme måde som `indsaetBase`.
 *
 * En spærring, der hviler på en miljøvariabel, nogen skal huske at sætte,
 * er ingen spærring — se `tilladTestkilder` i adapters/index.ts og noten
 * om NODE_ENV i CLAUDE.md. Derfor sprøjtes den ind af den kodevej, der
 * rejser testbasen, i stedet for at blive læst fra omgivelserne.
 */
let _paatvungetMiljoe: Miljoe | null = null
export function saetMiljoe(m: Miljoe | null) { _paatvungetMiljoe = m }

/**
 * Miljøet, eller null. **Der er ingen gæt-gren.**
 *
 * Kan miljøet ikke afgøres, skrives eventet ikke. Rapporter filtrerer
 * altid på `environment = 'produktion'`, så et manglende filter kan ikke
 * give et forkert tal — kun ingen tal. Et gæt på 'produktion' ville
 * blande lokale klik ind i produktionens tal, og udvikling og produktion
 * deler database.
 */
export function miljoe(): Miljoe | null {
  if (_paatvungetMiljoe) return _paatvungetMiljoe
  if (process.env.VERCEL_ENV === 'production') return 'produktion'
  if (process.env.VERCEL_ENV === 'preview') return 'preview'
  if (process.env.VERCEL_ENV === 'development') return 'udvikling'
  if (process.env.NEXT_RUNTIME) return 'udvikling' // next dev lokalt
  return null
}

/**
 * Tændknappen. Slået FRA, medmindre `MAALING_AKTIV=1`.
 *
 * Målingen må ikke gå live, fordi koden er deployet. Knappen er sat uden
 * for koden, så aktiveringen er en bevidst handling i Vercel-panelet — og
 * så den kan slukkes igen uden en deploy.
 */
let _paatvungetAktiv: boolean | null = null
export function saetAktiv(v: boolean | null) { _paatvungetAktiv = v }
export function aktiv(): boolean {
  if (_paatvungetAktiv != null) return _paatvungetAktiv
  return process.env.MAALING_AKTIV === '1'
}

// ─── Retention ─────────────────────────────────────────────────

export const DAGE_PRODUKT = 365
export const DAGE_RESEARCH = 90
export const DAGE_IMPRESSION = 60

/** Andelen af sessioner, der bidrager med impressions. 0-100. */
export function impressionPct(): number {
  const n = Number(process.env.MAALING_IMPRESSION_PCT ?? 25)
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.trunc(n))) : 25
}

/**
 * Stikprøven er deterministisk PR. SESSION, aldrig pr. event.
 *
 * Tilfældig udvælgelse pr. event ville give sessioner med huller, og så er
 * et forløb — «hun så kortet, men åbnede det ikke» — ikke længere til at
 * læse. En halv session er værre end ingen. Samme session giver samme svar
 * hver gang, også efter en re-render og på tværs af requests.
 */
export function iStikproeve(sessionId: string, pct = impressionPct()): boolean {
  if (pct <= 0) return false
  if (pct >= 100) return true
  // FNV-1a. Ikke kryptografisk — den skal kun fordele jævnt og deterministisk.
  let h = 0x811c9dc5
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 100 < pct
}

// ─── Ruter ─────────────────────────────────────────────────────

/**
 * MØNSTRE, ikke adresser. `/bolig/[id]`, aldrig `/bolig/9f3c…?sted=…`.
 * Den faktiske URL bærer brugerens fritekst; mønsteret har lav
 * kardinalitet og lækker ingenting.
 */
export const RUTER = [
  '/', '/bolig/[id]', '/gruppe', '/lejeboliger/[slug]',
  '/bekraeft/[token]', '/afmeld/[token]', '/privatliv',
  '/udlejer', '/udlejer/boliger', '/udlejer/opret', '/udlejer/boliger/[id]',
  '/go/[id]', '/forsoeg/[kode]', '/api/maaling',
] as const
export type Rute = (typeof RUTER)[number]

// ─── Eventmodellen ─────────────────────────────────────────────

export type StedSlags = 'postnr' | 'by_kendt' | 'by_ukendt' | 'ingen'

/** Felterne i søgeformularen, som en diff kan pege på. */
export const FILTERFELTER = [
  'by', 'postnr', 'prisMin', 'prisMax', 'vaerelser', 'areal', 'type', 'kilde',
  'sorter', 'overtagelse', 'venteliste', 'reserveret', 'fuld',
  'kaeledyr', 'elevator', 'udeplads', 'alle',
] as const
export type Filterfelt = (typeof FILTERFELTER)[number]

export interface Envelope {
  listingId?: string
  sourceSlug?: string
}

/**
 * Ét eventnavn, én lukket property-type. Et forkert navn, en ukendt
 * property eller en forkert type er en BYGGEFEJL — den nås aldrig af
 * produktion, fordi `npm run typecheck` og `next build` begge fejler.
 */
export type Haendelse = Envelope & (
  | { navn: 'homepage_view'; props: ForsideProps }
  | { navn: 'search'; props: SoegeProps }
  | { navn: 'search_results_view'; props: ResultatProps }
  | { navn: 'empty_results'; props: TomProps }
  | { navn: 'filter_applied'; props: FilterProps }
  | { navn: 'filter_cleared'; props: FilterProps }
  | { navn: 'sort_changed'; props: SorteringProps }
  | { navn: 'listing_view'; props: BoligProps }
  | { navn: 'listing_impression'; props: ImpressionProps }
  | { navn: 'group_opened'; props: GruppeProps }
  | { navn: 'source_click'; props: KildeProps }
  | { navn: 'contact_reveal'; props: KontaktProps }
  | { navn: 'contact_click'; props: KontaktklikProps }
  | { navn: 'alert_started'; props: Tom }
  | { navn: 'alert_created'; props: AlarmProps }
  | { navn: 'alert_confirmed'; props: AlarmProps }
  | { navn: 'signup_started'; props: Tom }
  | { navn: 'signup_completed'; props: KontoProps }
  | { navn: 'login_completed'; props: Tom }
  | { navn: 'filter_opened'; props: Tom }
  | { navn: 'map_interaction'; props: KortProps }
  | { navn: 'server_action_failed'; props: FejlProps }
)

export type Eventnavn = Haendelse['navn']
export type Tom = Record<string, never>

/** Filteruddraget. Delt af search, search_results_view og empty_results. */
export interface Filteruddrag {
  /** KUN fra facetter().byer. Matcher input ikke en kendt by, udelades den. */
  canonical_city?: string
  postnr?: string
  price_min?: number
  price_max?: number
  rooms_min?: number
  area_min?: number
  property_types?: string[]
  kilde?: string
  overtagelse?: 'nu' | 'senere'
  venteliste?: boolean
  reserveret?: boolean
  full_economy?: boolean
  facilities?: string[]
  kort_vist?: boolean
}

export interface ForsideProps {
  boliger_i_alt?: number
  kilder_i_alt?: number
  referrer_vaert?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export interface SoegeProps extends Filteruddrag {
  result_count: number
  antal_filtre: number
  sorter: string
  sted_slags: StedSlags
  result_view_id?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export interface ResultatProps extends Filteruddrag {
  result_count: number
  /** Kort på skærmen, højst 48. Ikke det samme som result_count. */
  viste_antal: number
  /** { propstep: 31, cej: 9 } — antal KORT pr. kilde. */
  viste_pr_kilde: Record<string, number>
  result_view_id: string
}

export interface TomProps extends Filteruddrag {
  antal_filtre: number
}

export interface FilterProps {
  felt: Filterfelt
  til?: string | number | boolean
  fra?: string | number | boolean
  antal_filtre_efter?: number
  antal_ryddet?: number
}

export interface SorteringProps { til: string; fra: string }

export interface BoligProps {
  postnr?: string
  property_type?: string
  timing_status?: string
  ansoegning_status?: string
  marked_status?: string
  egen_annonce?: boolean
  total_kendt?: boolean
  antal_billeder?: number
  fra_result_view_id?: string
}

export interface ImpressionProps {
  result_view_id: string
  position: number
  sample_andel: number
  er_gruppe?: boolean
  gruppe_antal?: number
  postnr?: string
}

export interface GruppeProps { gruppe_antal: number; postnr?: string }
export interface KildeProps {
  maal: 'kilde'
  postnr?: string
  property_type?: string
  fra_route?: string
}
export interface KontaktProps { har_mail: boolean; har_telefon: boolean }
export interface KontaktklikProps { maal: 'mail' | 'telefon' }
export interface AlarmProps { filtertyper: string[]; antal_filtre?: number }
export interface KontoProps { bandt_eksisterende?: boolean }
export interface KortProps { slags: 'zoom' | 'pan' | 'maerke_klik' }
export interface FejlProps { handling: string; fejlklasse: string }

// ─── Allowlisten ───────────────────────────────────────────────

type Slags = 'tal' | 'bool' | 'tekst' | 'liste' | 'kort'
interface Spec { slags: Slags; kraevet?: true; af?: readonly string[] }

const FILTERUDDRAG: Record<string, Spec> = {
  canonical_city: { slags: 'tekst' },
  postnr: { slags: 'tekst' },
  price_min: { slags: 'tal' },
  price_max: { slags: 'tal' },
  rooms_min: { slags: 'tal' },
  area_min: { slags: 'tal' },
  property_types: { slags: 'liste' },
  kilde: { slags: 'tekst' },
  overtagelse: { slags: 'tekst', af: ['nu', 'senere'] },
  venteliste: { slags: 'bool' },
  reserveret: { slags: 'bool' },
  full_economy: { slags: 'bool' },
  facilities: { slags: 'liste' },
  kort_vist: { slags: 'bool' },
}

const UTM: Record<string, Spec> = {
  utm_source: { slags: 'tekst' },
  utm_medium: { slags: 'tekst' },
  utm_campaign: { slags: 'tekst' },
}

/**
 * Hvert event, og præcis de nøgler det må bære.
 *
 * Der står INGEN felter her, som brugeren har tastet. `sted` og `by` er
 * fritekst; `canonical_city` er den kanoniserede erstatning og skal have
 * været slået op i facetter() af kalderen — se `renser` og docs.
 */
export const ALLOWLIST: Record<Eventnavn, Record<string, Spec>> = {
  homepage_view: {
    boliger_i_alt: { slags: 'tal' },
    kilder_i_alt: { slags: 'tal' },
    referrer_vaert: { slags: 'tekst' },
    ...UTM,
  },
  search: {
    result_count: { slags: 'tal', kraevet: true },
    antal_filtre: { slags: 'tal', kraevet: true },
    sorter: { slags: 'tekst', kraevet: true },
    sted_slags: { slags: 'tekst', kraevet: true, af: ['postnr', 'by_kendt', 'by_ukendt', 'ingen'] },
    result_view_id: { slags: 'tekst' },
    ...FILTERUDDRAG,
    ...UTM,
  },
  search_results_view: {
    result_count: { slags: 'tal', kraevet: true },
    viste_antal: { slags: 'tal', kraevet: true },
    viste_pr_kilde: { slags: 'kort', kraevet: true },
    result_view_id: { slags: 'tekst', kraevet: true },
    ...FILTERUDDRAG,
  },
  empty_results: {
    antal_filtre: { slags: 'tal', kraevet: true },
    ...FILTERUDDRAG,
  },
  filter_applied: {
    felt: { slags: 'tekst', kraevet: true, af: FILTERFELTER },
    til: { slags: 'tekst' },
    fra: { slags: 'tekst' },
    antal_filtre_efter: { slags: 'tal' },
  },
  filter_cleared: {
    felt: { slags: 'tekst', kraevet: true, af: FILTERFELTER },
    fra: { slags: 'tekst' },
    antal_ryddet: { slags: 'tal' },
  },
  sort_changed: {
    til: { slags: 'tekst', kraevet: true },
    fra: { slags: 'tekst', kraevet: true },
  },
  listing_view: {
    postnr: { slags: 'tekst' },
    property_type: { slags: 'tekst' },
    timing_status: { slags: 'tekst' },
    ansoegning_status: { slags: 'tekst' },
    marked_status: { slags: 'tekst' },
    egen_annonce: { slags: 'bool' },
    total_kendt: { slags: 'bool' },
    antal_billeder: { slags: 'tal' },
    fra_result_view_id: { slags: 'tekst' },
  },
  listing_impression: {
    result_view_id: { slags: 'tekst', kraevet: true },
    position: { slags: 'tal', kraevet: true },
    sample_andel: { slags: 'tal', kraevet: true },
    er_gruppe: { slags: 'bool' },
    gruppe_antal: { slags: 'tal' },
    postnr: { slags: 'tekst' },
  },
  group_opened: {
    gruppe_antal: { slags: 'tal', kraevet: true },
    postnr: { slags: 'tekst' },
  },
  source_click: {
    maal: { slags: 'tekst', kraevet: true, af: ['kilde'] },
    postnr: { slags: 'tekst' },
    property_type: { slags: 'tekst' },
    fra_route: { slags: 'tekst', af: RUTER },
  },
  contact_reveal: {
    har_mail: { slags: 'bool', kraevet: true },
    har_telefon: { slags: 'bool', kraevet: true },
  },
  contact_click: {
    maal: { slags: 'tekst', kraevet: true, af: ['mail', 'telefon'] },
  },
  alert_started: {},
  alert_created: {
    filtertyper: { slags: 'liste', kraevet: true },
    antal_filtre: { slags: 'tal' },
  },
  alert_confirmed: {
    filtertyper: { slags: 'liste', kraevet: true },
    antal_filtre: { slags: 'tal' },
  },
  signup_started: {},
  signup_completed: { bandt_eksisterende: { slags: 'bool' } },
  login_completed: {},
  filter_opened: {},
  map_interaction: {
    slags: { slags: 'tekst', kraevet: true, af: ['zoom', 'pan', 'maerke_klik'] },
  },
  server_action_failed: {
    handling: { slags: 'tekst', kraevet: true },
    fejlklasse: { slags: 'tekst', kraevet: true },
  },
}

/** Kun disse fyres fra browseren. Alt andet fra /api/maaling er en fejl. */
export const KLIENTEVENTS: readonly Eventnavn[] = [
  'filter_opened', 'map_interaction', 'alert_started',
  'contact_click', 'listing_impression',
]

// ─── Værdiværnet ───────────────────────────────────────────────

const MAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const TELEFON = /(?:\+?\d[\s\-.]?){8,}/
const TOKEN = /(?:^|\s)(?:Bearer\s|eyJ|sb_secret|sb_publishable|sbp_)/i
const ABSOLUT_URL = /^[a-z][a-z0-9+.-]*:\/\//i
const MAKS_TEGN = 120

export type Afvisning =
  | { grund: 'ukendt-event'; detalje: string }
  | { grund: 'ukendt-property'; detalje: string }
  | { grund: 'manglende-property'; detalje: string }
  | { grund: 'pii'; detalje: string }
  | { grund: 'forkert-type'; detalje: string }
  | { grund: 'ugyldig-kontekst'; detalje: string }

/**
 * Er strengen kategorisk, eller er den noget, et menneske har skrevet?
 *
 * Ingen legitim kategorisk værdi i taxonomien er over 120 tegn, indeholder
 * en mailadresse, et telefonnummer, et token eller en fremmed URL. Slår
 * én af dem til, er der koblet forkert et sted, og så skal der larmes —
 * hele eventet droppes, ikke bare nøglen.
 */
function farligTekst(v: string): boolean {
  if (v.length > MAKS_TEGN) return true
  if (MAIL.test(v)) return true
  if (TELEFON.test(v)) return true
  if (TOKEN.test(v)) return true
  if (ABSOLUT_URL.test(v) && !/^https?:\/\/(?:[a-z0-9-]+\.)*bofinda\.dk(?:[/:?#]|$)/i.test(v)) return true
  return false
}

export interface Kontekst {
  miljoe: Miljoe
  anonymousId: string
  sessionId: string
  userId?: string | null
  researchSessionId?: string | null
  rute: Rute
}

export interface Raekke {
  eventName: Eventnavn
  environment: Miljoe
  anonymousId: string
  sessionId: string
  userId: string | null
  researchSessionId: string | null
  route: string
  listingId: string | null
  sourceSlug: string | null
  properties: Record<string, unknown>
  expiresAt: Date
}

export interface Renset { raekke: Raekke; droppedeNoegler: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/
const FORSOEG = /^[a-z0-9][a-z0-9_-]{0,39}$/i

/** Udløbstidspunktet for eventets klasse. Den KORTESTE frist vinder. */
export function udloeb(navn: Eventnavn, forsoeg: string | null, nu: Date): Date {
  let dage = DAGE_PRODUKT
  if (navn === 'listing_impression') dage = Math.min(dage, DAGE_IMPRESSION)
  if (forsoeg) dage = Math.min(dage, DAGE_RESEARCH)
  return new Date(nu.getTime() + dage * 24 * 3600 * 1000)
}

/**
 * Renser et event til en række — eller afviser det.
 *
 * Returnerer aldrig noget, der ikke må skrives. Kalderen skriver blot
 * resultatet; der er ingen «husk også at tjekke»-aftale.
 */
export function rens(
  h: Haendelse, k: Kontekst, nu: Date = new Date(),
): { ok: true; renset: Renset } | { ok: false; fejl: Afvisning } {
  const spec = ALLOWLIST[h.navn]
  if (!spec) return { ok: false, fejl: { grund: 'ukendt-event', detalje: String(h.navn) } }

  if (!(MILJOEER as readonly string[]).includes(k.miljoe)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'environment' } }
  }
  if (!UUID.test(k.anonymousId) || !UUID.test(k.sessionId)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'identifikator' } }
  }
  if (k.userId != null && !UUID.test(k.userId)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'user_id' } }
  }
  if (k.researchSessionId != null && !FORSOEG.test(k.researchSessionId)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'research_session_id' } }
  }
  if (!(RUTER as readonly string[]).includes(k.rute)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'route' } }
  }
  if (h.listingId != null && !UUID.test(h.listingId)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'listing_id' } }
  }
  if (h.sourceSlug != null && !SLUG.test(h.sourceSlug)) {
    return { ok: false, fejl: { grund: 'ugyldig-kontekst', detalje: 'source_slug' } }
  }

  const ud: Record<string, unknown> = {}
  const droppede: string[] = []
  const raa = (h.props ?? {}) as Record<string, unknown>

  for (const [noegle, vaerdi] of Object.entries(raa)) {
    if (vaerdi == null) continue
    const s = spec[noegle]
    // Ukendt nøgle: NØGLEN droppes, eventet skrives. At kassere en hel
    // søgning på grund af én stray-nøgle taber ægte data — men den tælles
    // og logges, så en fejl er synlig frem for stille.
    if (!s) { droppede.push(noegle); continue }

    const t = tjekVaerdi(s, vaerdi)
    if (t === 'pii') {
      return { ok: false, fejl: { grund: 'pii', detalje: noegle } }
    }
    if (t === 'type') {
      return { ok: false, fejl: { grund: 'forkert-type', detalje: noegle } }
    }
    ud[noegle] = vaerdi
  }

  for (const [noegle, s] of Object.entries(spec)) {
    if (s.kraevet && ud[noegle] === undefined) {
      return { ok: false, fejl: { grund: 'manglende-property', detalje: noegle } }
    }
  }

  const forsoeg = k.researchSessionId ?? null
  return {
    ok: true,
    renset: {
      droppedeNoegler: droppede,
      raekke: {
        eventName: h.navn,
        environment: k.miljoe,
        anonymousId: k.anonymousId,
        sessionId: k.sessionId,
        userId: k.userId ?? null,
        researchSessionId: forsoeg,
        route: k.rute,
        listingId: h.listingId ?? null,
        sourceSlug: h.sourceSlug ?? null,
        properties: ud,
        expiresAt: udloeb(h.navn, forsoeg, nu),
      },
    },
  }
}

function tjekVaerdi(s: Spec, v: unknown): 'ok' | 'pii' | 'type' {
  switch (s.slags) {
    case 'tal':
      return typeof v === 'number' && Number.isFinite(v) ? 'ok' : 'type'
    case 'bool':
      return typeof v === 'boolean' ? 'ok' : 'type'
    case 'tekst': {
      if (typeof v !== 'string') return 'type'
      if (farligTekst(v)) return 'pii'
      if (s.af && !s.af.includes(v)) return 'type'
      return 'ok'
    }
    case 'liste': {
      if (!Array.isArray(v) || v.length > 20) return 'type'
      for (const x of v) {
        if (typeof x !== 'string') return 'type'
        if (farligTekst(x)) return 'pii'
      }
      return 'ok'
    }
    case 'kort': {
      // Kun { slug: heltal }. Nøglerne er kildeslugs, ikke fritekst.
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'type'
      const e = Object.entries(v as Record<string, unknown>)
      if (e.length > 30) return 'type'
      for (const [k2, v2] of e) {
        if (!SLUG.test(k2)) return 'type'
        if (typeof v2 !== 'number' || !Number.isInteger(v2)) return 'type'
      }
      return 'ok'
    }
  }
}
