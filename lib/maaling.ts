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
  | { navn: 'search_submitted'; props: Tom }
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
  /** Hvilken slags sted der blev søgt på. Følger uddraget overalt, så
   *  `empty_results` kan besvare «hvor giver søgningen aldrig noget». */
  sted_slags?: StedSlags
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

/**
 * Pagineringens metadata. VALGFRI paa alle tre soegeevents.
 *
 * Valgfri er ikke sjusk, det er kontrakten: et `kraevet: true`-felt, som en
 * afsender ikke sender, draeber eventet lydloest — det kostede hver eneste
 * listing_impression i tre uger. Gamle raekker og en halvt udrullet frontend
 * skal passere `rens()` uaendret.
 */
export interface Sidevisning {
  /** 1-baseret. Fravaerende betyder «foer pagineringen fandtes», ikke side 1. */
  side?: number
  /** KUN naar `komplet` er true. Se krydsfeltsreglen i `rens`. */
  sider_i_alt?: number
  /** Naaede vi hele udbuddet igennem, eller ramte vi kandidatloftet? */
  komplet?: boolean
}

export interface SoegeProps extends Filteruddrag, Sidevisning {
  result_count: number
  antal_filtre: number
  sorter: string
  sted_slags: StedSlags
  result_view_id?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export interface ResultatProps extends Filteruddrag, Sidevisning {
  result_count: number
  /** Kort på skærmen, højst 48. Ikke det samme som result_count. */
  viste_antal: number
  /** { propstep: 31, cej: 9 } — antal KORT pr. kilde. */
  viste_pr_kilde: Record<string, number>
  result_view_id: string
}

export interface TomProps extends Filteruddrag, Sidevisning {
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

type Slags = 'tal' | 'bool' | 'tekst' | 'liste' | 'kort' | 'skalar'
interface Spec {
  slags: Slags
  kraevet?: true
  af?: readonly string[]
  /** Kun for 'tal': vaerdien skal vaere et heltal. */
  heltal?: true
  /** Kun for 'tal': nedre graense, inklusiv. */
  mindst?: number
}

const FILTERUDDRAG: Record<string, Spec> = {
  // sted_slags hoerer til uddraget, ikke kun til `search`: uden det kan
  // «hvilke soegninger giver aldrig noget» ikke besvares paa
  // empty_results alene, og det er praecis dét, eventet findes for.
  sted_slags: { slags: 'tekst', af: ['postnr', 'by_kendt', 'by_ukendt', 'ingen'] },
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

/**
 * Pagineringens tre felter, delt af de tre soegeevents.
 *
 * `Number.isFinite` afviser baade NaN og Infinity, `heltal` afviser 1,5, og
 * `mindst` afviser 0 og negative sider. En `Number()` af vilkaarlig URL-tekst
 * ville give NaN for «?side=abc» og slippe igennem et blot `typeof === number`.
 */
const SIDEVISNING: Record<string, Spec> = {
  side: { slags: 'tal', heltal: true, mindst: 1 },
  sider_i_alt: { slags: 'tal', heltal: true, mindst: 0 },
  komplet: { slags: 'bool' },
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
    result_view_id: { slags: 'tekst' },
    ...FILTERUDDRAG,
    sted_slags: { slags: 'tekst', kraevet: true, af: ['postnr', 'by_kendt', 'by_ukendt', 'ingen'] },
    ...SIDEVISNING,
    ...UTM,
  },
  /**
   * En OBSERVERET indsendelse af soegeformularen. Ikke en rendering.
   *
   * Ingen properties overhovedet — og det er et valg, ikke en mangel.
   * Filterkonteksten staar allerede paa det `search`, der foelger i samme
   * session; et klientberegnet `antal_filtre` ville vaere et ANDET udtryk for
   * det samme spoergsmaal end serverens, og de to ville drive fra hinanden.
   * Se reglen om to udtryk i CLAUDE.md.
   */
  search_submitted: {},
  search_results_view: {
    result_count: { slags: 'tal', kraevet: true },
    viste_antal: { slags: 'tal', kraevet: true },
    viste_pr_kilde: { slags: 'kort', kraevet: true },
    result_view_id: { slags: 'tekst', kraevet: true },
    ...FILTERUDDRAG,
    ...SIDEVISNING,
  },
  empty_results: {
    antal_filtre: { slags: 'tal', kraevet: true },
    ...FILTERUDDRAG,
    ...SIDEVISNING,
  },
  filter_applied: {
    felt: { slags: 'tekst', kraevet: true, af: FILTERFELTER },
    // Tal bliver som TAL. Et beloeb i oere stringificeret til '12000000'
    // er otte cifre i traek og ville blive laest som et telefonnummer.
    til: { slags: 'skalar' },
    fra: { slags: 'skalar' },
    antal_filtre_efter: { slags: 'tal' },
  },
  filter_cleared: {
    felt: { slags: 'tekst', kraevet: true, af: FILTERFELTER },
    fra: { slags: 'skalar' },
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

/**
 * Events, der udledes af AT EN SIDE RENDERES.
 *
 * De må ikke fyre, når renderingen ikke svarer til en sidevisning. Next
 * kører sidekomponenten igen som en del af svaret på en Server Action —
 * så ét klik på «Vis kontaktoplysninger» gav to `listing_view`, selv om
 * brugeren kun havde set siden én gang. Se `erGenrendering`.
 *
 * Events, der udledes af en HANDLING — `contact_reveal`, `alert_created`,
 * `alert_confirmed`, `signup_*`, `login_completed`, `server_action_failed`
 * — står med vilje IKKE her: de fyrer netop inde i en Server Action og
 * skal blive ved med det.
 */
export const RENDEREVENTS: readonly Eventnavn[] = [
  'homepage_view', 'search', 'search_results_view', 'empty_results',
  'filter_applied', 'filter_cleared', 'sort_changed',
  'listing_view', 'group_opened',
]

export type Hovedlaeser = (navn: string) => string | null | undefined

/**
 * Er denne rendering noget ANDET end en sidevisning?
 *
 * Målt, ikke antaget. Sonde i `app/bolig/[id]/page.tsx` mod en rigtig
 * Next-server, 7. september 2026:
 *
 *   rigtig navigation          GET   next-action: null
 *                                    accept: text/html,application/xhtml+…
 *   Server Action-revalidering POST  next-action: 4042a2540e1ee29a68e80f9d41c0
 *                                    accept: text/x-component
 *
 * `next-router-prefetch` er med af samme grund: en side, der er hentet på
 * forhånd, er aldrig blevet set. Appen bruger ingen `next/link` i dag, så
 * den gren er forebyggende — men den koster ingenting.
 *
 * `rsc` tjekkes IKKE. En klientside-navigation ER en sidevisning; den dag
 * appen får `next/link`, skal den stadig tælle.
 */
export function erGenrendering(faa: Hovedlaeser): boolean {
  return Boolean(faa('next-action') || faa('next-router-prefetch'))
}

/** Kun disse fyres fra browseren. Alt andet fra /api/maaling er en fejl. */
export const KLIENTEVENTS: readonly Eventnavn[] = [
  'filter_opened', 'map_interaction', 'alert_started',
  'contact_click', 'listing_impression', 'search_submitted',
]

/**
 * `search_submitted` staar med vilje IKKE i RENDEREVENTS.
 *
 * Den udledes af en HANDLING, ikke af at en side blev renderet — samme
 * klasse som contact_reveal og alert_created. Vagten mod
 * Server Action-genrendering maa ikke ramme den, og serveren kan i
 * oevrigt ikke se forskel paa en formularindsendelse og et klik paa et
 * pagineringslink: begge er en GET-navigation med de samme headere.
 * Derfor observeres den i browseren eller slet ikke.
 */

// ─── Værdiværnet ───────────────────────────────────────────────

const MAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
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
  | { grund: 'ufuldstaendigt-sideantal'; detalje: string }

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
  // En uuid er en identifikator, ikke en oplysning om et menneske — og
  // dens cifferloeb ('…-8000-000000000003') ville ellers blive laest som
  // et telefonnummer. Det kostede result_view_id paa BAADE search,
  // search_results_view og listing_impression, foer det blev opdaget.
  if (UUID.test(v)) return false
  if (MAIL.test(v)) return true
  if (telefonagtig(v)) return true
  if (TOKEN.test(v)) return true
  if (ABSOLUT_URL.test(v) && !/^https?:\/\/(?:[a-z0-9-]+\.)*bofinda\.dk(?:[/:?#]|$)/i.test(v)) return true
  return false
}

/**
 * 8-15 cifre, naar adskillere er strippet.
 *
 * Praecist frem for graadigt: det gamle moenster taalte vilkaarlige tegn
 * mellem cifrene og fangede derfor baade uuid'er og ISO-datoer. Ingen
 * legitim vaerdi i taxonomien er en ren cifferstreng paa otte eller flere
 * — postnumre er fire, og beloeb er TAL, ikke tekst.
 */
function telefonagtig(v: string): boolean {
  return /^\d{8,15}$/.test(v.replace(/[\s\-.()+]/g, ''))
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

export interface Renset {
  raekke: Raekke
  /** Noegler uden for allowlisten. Droppet, eventet skrevet. */
  droppedeNoegler: string[]
  /** Noegler droppet af en KRYDSFELTSREGEL, ikke fordi de er ukendte. */
  ufuldstaendigeNoegler: string[]
}

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

  // ── Krydsfeltsregel: et sideantal uden komplethed er ikke et sideantal.
  //
  // `kortIAlt` afkortes ved kandidatloftet, og saa er «5 sider» ikke 5 sider
  // — det er «mindst 5». Et tal, der ligner en eksakt total og ikke er det,
  // er praecis den slags loegn, ingen opdager: siden siger allerede «mindst
  // N kort», mens maalingen ville sige N.
  //
  // NOEGLEN droppes, eventet skrives. At kassere en hel resultatvisning paa
  // grund af ét metadatafelt ville tabe selve maalingen — men droppet
  // logges med sin egen grund, saa afsenderens fejl er synlig frem for
  // stille. Samme afvejning som for ukendte noegler ovenfor.
  const ufuldstaendige: string[] = []
  if (ud.sider_i_alt !== undefined && ud.komplet !== true) {
    delete ud.sider_i_alt
    ufuldstaendige.push('sider_i_alt')
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
      ufuldstaendigeNoegler: ufuldstaendige,
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
    case 'tal': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'type'
      if (s.heltal && !Number.isInteger(v)) return 'type'
      if (s.mindst != null && v < s.mindst) return 'type'
      return 'ok'
    }
    case 'bool':
      return typeof v === 'boolean' ? 'ok' : 'type'
    case 'tekst': {
      if (typeof v !== 'string') return 'type'
      if (farligTekst(v)) return 'pii'
      if (s.af && !s.af.includes(v)) return 'type'
      return 'ok'
    }
    case 'skalar': {
      if (typeof v === 'number') return Number.isFinite(v) ? 'ok' : 'type'
      if (typeof v === 'boolean') return 'ok'
      if (typeof v !== 'string') return 'type'
      return farligTekst(v) ? 'pii' : 'ok'
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
