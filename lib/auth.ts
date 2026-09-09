// ═══════════════════════════════════════════════════════════════
//  Adgang. Supabase Auth ejer adgangskoderne — vi gør ikke.
//
//  BRIEF: "Supabase Auth. Erstatter den auth, fase 0 oprindeligt lagde op
//  til — vi bygger ikke vores egen." Vi gemmer aldrig et kodeord, aldrig
//  et hash, aldrig en nulstillingskode.
//
//  Auth bruges KUN til identitet. Alle vores tabeller har RLS med
//  `revoke all from anon, authenticated`, så browseren kan ikke læse dem
//  direkte gennem PostgREST, uanset hvem der er logget ind. Data hentes
//  gennem vores egen server med Drizzle, som hidtil.
//
//  `public.users` er vores egen brugerrække. Den bindes til auth-kontoen
//  med `auth_user_id`, og oprettes ved første besøg efter login. Alarmens
//  brugere findes allerede på mailadressen alene og har ingen konto — de
//  bindes til den, hvis de senere opretter én, i stedet for at få en
//  dublet.
// ═══════════════════════════════════════════════════════════════

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const NOEGLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export function konfigureret(): boolean {
  return Boolean(URL && NOEGLE)
}

/** Klient bundet til brugerens cookies. Kun til identitet, ikke til data. */
export async function supabase() {
  if (!URL || !NOEGLE) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL eller _PUBLISHABLE_KEY mangler')
  }
  const jar = await cookies()
  return createServerClient(URL, NOEGLE, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (sat) => {
        // I en server component kan cookies ikke saettes. Det er fint:
        // opdateringen sker i server actions og i middleware.
        try { for (const { name, value, options } of sat) jar.set(name, value, options) }
        catch { /* laeses kun */ }
      },
    },
  })
}

export interface Bruger {
  id: string
  authUserId: string
  email: string
  navn: string | null
}

/** Navnet bevares for de kaldere, der handler om udlejersiden. */
export type Udlejer = Bruger

/**
 * Den verificerede auth-konto. Rører ikke databasen.
 *
 * `getUser()` og ikke `getSession()`: getSession laeser cookien og
 * stoler paa den, mens getUser spoerger Auth-serveren og faar et svar,
 * en klient ikke kan forfalske. Autorisation maa aldrig hvile paa den
 * foerste.
 *
 * Fejl, manglende bruger og manglende mail behandles hver for sig og
 * giver alle null — der gaettes ikke paa en identitet.
 */
export interface AuthKonto {
  id: string
  email: string
  /**
   * Har Auth-serveren en bekraeftelse paa mailadressen?
   *
   * ⚠ IKKE I SIG SELV BEVIS FOR, AT BRUGEREN HAR BEKRAEFTET.
   * Er «Confirm Email» slaaet FRA i Supabase, saetter serveren selv
   * `email_confirmed_at` ved oprettelsen — uden at nogen har aabnet en
   * mail. Feltet er derfor en NOEDVENDIG, men ikke en tilstraekkelig
   * betingelse: den anden halvdel er en indstilling i Auth-miljoeet, som
   * skal efterproeves dér. Se `KRAEVER_CONFIRM_EMAIL` nedenfor.
   */
  mailBekraeftet: boolean
}

/**
 * RELEASE-FORUDSAETNING, ikke en kodeantagelse.
 *
 * Bindingen af en eksisterende brugerraekke til en konto hviler paa, at
 * mailadressen er bevist. Det er kun sandt, naar «Confirm Email» er slaaet
 * TIL i Supabase Auth. Er den slaaet fra, kan enhver oprette en konto paa
 * en fremmed adresse og arve hendes gemte soegninger.
 *
 * Koden kan ikke se indstillingen, og den maa ikke lade som om. Den
 * tjekker det, den KAN se (`email_confirmed_at`), og lader resten staa
 * som en gate, et menneske skal verificere i det rigtige Auth-miljoe foer
 * release. Se docs/auth-binding.md.
 */
export const KRAEVER_CONFIRM_EMAIL = true

async function authKonto(): Promise<AuthKonto | null> {
  if (!konfigureret()) return null
  const sb = await supabase()
  const { data, error } = await sb.auth.getUser()
  if (error) return null
  const k = data.user
  if (!k) return null
  // Mailen tages fra Auth-serverens brugerobjekt — aldrig fra en
  // formular, og aldrig fra user_metadata, som brugeren selv kan rette.
  if (!k.email) return null
  return { id: k.id, email: k.email, mailBekraeftet: Boolean(k.email_confirmed_at) }
}

/**
 * Brugerrækkens id, hvis den findes. OPRETTER INTET.
 *
 * Til læsninger, der sker på hver sidevisning — om et boligkort skal vise
 * en fyldt hjerteknap. En læsning må ikke have en bivirkning: ellers ville
 * det at kigge på forsiden oprette en brugerrække for enhver, der er
 * logget ind, uanset om hun nogensinde gemte noget.
 */
export async function hentBrugerId(): Promise<string | null> {
  const k = await authKonto()
  if (!k) return null
  const [r] = await db.select({ id: users.id }).from(users)
    .where(eq(users.authUserId, k.id)).limit(1)
  return r?.id ?? null
}

/**
 * Den indloggede bruger som VORES brugerrække, oprettet efter behov.
 *
 * Findes mailadressen allerede fra en gemt søgning, bindes den række til
 * kontoen i stedet for at lave en ny. Ellers ville den samme person have
 * to rækker, og hendes søgninger ville høre til den forkerte.
 */
/**
 * Hvorfor en binding ikke lykkedes. Kaldere skal kunne SIGE det —
 * «log ind» er et forkert svar til en, der ER logget ind.
 */
export type Bindingssvar =
  | { slags: 'ok'; bruger: Bruger }
  | { slags: 'ingen-session' }
  | { slags: 'ubekraeftet-mail'; email: string }
  | { slags: 'konflikt'; email: string }

const somBruger = (r: { id: string; email: string; name: string | null }, authId: string): Bruger =>
  ({ id: r.id, authUserId: authId, email: r.email, navn: r.name })

/** Raekken der ALLEREDE er bundet til denne konto. Den eneste sikre laesning. */
async function paaAuthId(authId: string): Promise<Bruger | null> {
  const [r] = await db.select().from(users).where(eq(users.authUserId, authId)).limit(1)
  return r ? somBruger(r, authId) : null
}

/**
 * Bind en auth-konto til vores egen brugerraekke.
 *
 * ═══ KONTOEN KOMMER IND SOM ARGUMENT ═══
 *
 * Den laeses ikke her. Det er dét, der goer bindingen proevbar UDEN en
 * injektionsluge: proeverne kalder denne funktion med en konto, de selv
 * bygger, og rammer dermed den RIGTIGE logik — ikke en kopi af den. I
 * produktion er `sikreBruger` den eneste kalder, og den henter kontoen
 * fra Auth-serveren selv. Der findes altsaa ingen vej fra en request til
 * en forfalsket identitet.
 *
 * ═══ AUTORITETEN ER auth_user_id, IKKE MAILEN ═══
 *
 * Mailen kan skifte. Den kan skifte til en, en anden havde. Derfor er
 * `auth_user_id` det, der afgoer ejerskabet, og mailen kun det, der kan
 * aabne en ENGANGSbinding af en raekke, ingen konto ejer endnu.
 *
 * Fem regler, og de haandhaeves i forespoergslerne — ikke i en
 * forudgaaende laesning:
 *
 *  A · Er raekken allerede bundet til kontoen, er det den samme interne
 *      bruger for altid — ogsaa hvis mailen siden er aendret.
 *  B · En raekke bundet til en ANDEN konto roeres aldrig. Ikke bindingen,
 *      ikke rollen, ikke noget. Et mailmatch er ikke et ejerskabsbevis.
 *  C · En ubundet raekke bindes kun med en bekraeftet mailadresse.
 *  D · «Ubundet» staar i UPDATE'ens egen WHERE. En SELECT foerst og en
 *      UPDATE bagefter er et vindue: naaede en anden request at binde
 *      raekken imellem de to, ville vi overskrive HENDES binding.
 *  E · Ramte UPDATE'en nul raekker, udleveres den fundne raekke ALDRIG.
 *      Der genlaeses kun paa vores eget verificerede `auth_user_id`.
 *  F · Samtidige foerstegangsrequests loeses af databasens egen
 *      unikhed, ikke af et gaet. Gentagne requests er idempotente.
 */
export async function bindKonto(
  konto: AuthKonto, rolle: 'tenant' | 'landlord', rute: '/udlejer' | '/min-side',
): Promise<Bindingssvar> {
  // ── A · Allerede bundet ────────────────────────────────────
  // Foerst, og uden nogen betingelse om mailen. Har hun skiftet adresse
  // hos Supabase, er hun stadig den samme hos os.
  const bundet = await paaAuthId(konto.id)
  if (bundet) return { slags: 'ok', bruger: bundet }

  // ── C · Binding kraever en bekraeftet mail ─────────────────
  // Herfra og ned er mailen det eneste, der peger paa en raekke. Er den
  // ikke bevist, er der intet at binde paa.
  if (!konto.mailBekraeftet) return { slags: 'ubekraeftet-mail', email: konto.email }

  // ── D-F · To forsoeg ───────────────────────────────────────
  // Hvorfor en loekke og ikke ét gennemloeb: en SAMTIDIG request kan naa
  // at INDSAETTE raekken mellem vores UPDATE og vores laesning. Foerste
  // runde finder saa ingenting at binde og ingenting at oprette — men
  // raekken findes nu, og anden runde binder den.
  //
  // Fundet af den rigtige samtidighedsproeve mod PostgreSQL: med tolv
  // parallelle foerstegangsrequests fra SAMME konto fejlede én, fordi
  // konflikt-tjekket kun saa, AT der laa en raekke paa adressen — ikke
  // at den var vores egen. PGlite kunne ikke vise det; den koerer paa én
  // forbindelse. Se scripts/cloud/samtidighed.ts.
  for (let forsoeg = 0; forsoeg < 2; forsoeg++) {
    // D · «Ubundet» staar i skrivningen selv. Databasen afgoer, om
    //     raekken var ledig — ikke en laesning, der kan blive foraeldet.
    const [nyBundet] = await db.update(users)
      .set({ authUserId: konto.id, role: rolle })
      .where(and(eq(users.email, konto.email), isNull(users.authUserId)))
      .returning()
    if (nyBundet) {
      await sporOprettet(nyBundet.id, true, rute)
      return { slags: 'ok', bruger: somBruger(nyBundet, konto.id) }
    }

    // F · Naaede en samtidig request fra DENNE konto at binde raekken,
    //     er svaret hendes egen. Det er dét, idempotensen betyder.
    const imellemtiden = await paaAuthId(konto.id)
    if (imellemtiden) return { slags: 'ok', bruger: imellemtiden }

    // E · Nul raekker ramt. Hvem ejer adressen?
    const [optaget] = await db
      .select({ id: users.id, email: users.email, name: users.name,
        authUserId: users.authUserId })
      .from(users).where(eq(users.email, konto.email)).limit(1)

    if (optaget) {
      // Vores egen — samme konto, en anden request var hurtigere.
      if (optaget.authUserId === konto.id) {
        return { slags: 'ok', bruger: somBruger(optaget, konto.id) }
      }
      // B · Bundet til en ANDEN konto. Her kunne man «loese» konflikten
      //     ved at binde om. Det ville overfoere en fremmeds gemte
      //     soegninger og annoncer til den, der tilfaeldigvis fik hendes
      //     gamle mailadresse. En konto-konflikt maa koste et menneskes
      //     hjaelp; den maa ikke koste en andens data.
      if (optaget.authUserId !== null) return { slags: 'konflikt', email: konto.email }
      // Ubundet, men indsat efter vores UPDATE. Anden runde binder den.
      continue
    }

    // F · Opret. `onConflictDoNothing` i stedet for et forudgaaende
    //     «findes den?»: to samtidige foerstegangsrequests skal ikke
    //     kunne kaste paa unikhedsspaerringen.
    const [ny] = await db.insert(users)
      .values({ email: konto.email, authUserId: konto.id, role: rolle })
      .onConflictDoNothing()
      .returning()
    if (ny) {
      await sporOprettet(ny.id, false, rute)
      return { slags: 'ok', bruger: somBruger(ny, konto.id) }
    }
    // Konflikt ved indsaettelsen: nogen naaede foerst. Naeste runde.
  }

  // Efter to runder: sidste laesning paa vores EGET verificerede
  // auth_user_id. Er den der ikke, faar hun ingenting — aldrig en
  // fremmed raekke.
  const efter = await paaAuthId(konto.id)
  return efter
    ? { slags: 'ok', bruger: efter }
    : { slags: 'konflikt', email: konto.email }
}

async function sikreBruger(
  rolle: 'tenant' | 'landlord', rute: '/udlejer' | '/min-side',
): Promise<Bindingssvar> {
  const konto = await authKonto()
  if (!konto) return { slags: 'ingen-session' }
  return bindKonto(konto, rolle, rute)
}

const kunBruger = (s: Bindingssvar): Bruger | null =>
  s.slags === 'ok' ? s.bruger : null

/**
 * Udlejeren. Rollen saettes til `landlord`, og `signup_completed`
 * bogfoeres paa /udlejer — som foer.
 */
export const hentUdlejer = async (): Promise<Udlejer | null> =>
  kunBruger(await sikreBruger('landlord', '/udlejer'))

/**
 * Den boligsoegende. Samme mekanik, anden rolle og anden rute.
 *
 * Rollen er ikke adgangskontrol — den bruges ingen steder til at afgoere
 * noget — men en boligsoegende, der opretter konto paa Min side, skal ikke
 * staa i basen som udlejer.
 */
export const hentBruger = async (): Promise<Bruger | null> =>
  kunBruger(await sikreBruger('tenant', '/min-side'))

/**
 * Som `hentBruger`, men med GRUNDEN til et nej.
 *
 * Min side bruger den, saa en bruger, der ER logget ind, ikke faar
 * «log ind» som svar paa en kontokonflikt. At tie om en afvist binding
 * ville se ud som en fejl paa siden — og hun ville proeve igen i stedet
 * for at soege hjaelp.
 */
export const hentBrugerStatus = (): Promise<Bindingssvar> =>
  sikreBruger('tenant', '/min-side')


/**
 * `signup_completed` hoerer HER, ikke i `tilmeld()`.
 *
 * `signUp()` sender kun en mail og svarer «Tjek din mail … foer kontoen er
 * aktiv» — kontoen findes ikke endnu. Et event dér ville taelle alle dem,
 * der aldrig kom tilbage. Kontooprettelsen er dobbelt opt-in noejagtig som
 * boligbeskeden, og den reelle overgang er FOERSTE binding af
 * auth_user_id paa en brugerraekke. Grenen ovenfor er den eneste, der
 * naas én gang pr. konto; ved senere login rammer `alt`-grenen.
 *
 * `bandt_eksisterende` er en rigtig produktoplysning: hvor mange udlejere
 * kommer fra alarmsiden med en mailadresse, vi kendte i forvejen.
 * Mailadressen selv naar aldrig et event — kun vores egen uuid.
 */
async function sporOprettet(
  brugerId: string, bandtEksisterende: boolean, rute: '/udlejer' | '/min-side',
) {
  const { spor } = await import('./maaling-server')
  await spor(
    { navn: 'signup_completed', props: { bandt_eksisterende: bandtEksisterende } },
    rute,
    { brugerId },
  )
}

/** Adgangstoken til Storage. Uploaden sker som brugeren selv — se
 *  politikkerne i migration 0014. */
export async function adgangstoken(): Promise<string | null> {
  if (!konfigureret()) return null
  const sb = await supabase()
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}
