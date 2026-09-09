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
import { eq } from 'drizzle-orm'
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

/** Auth-kontoen alene. Rører ikke databasen. */
async function authKonto(): Promise<{ id: string; email: string } | null> {
  if (!konfigureret()) return null
  const sb = await supabase()
  const { data } = await sb.auth.getUser()
  const k = data.user
  return k?.email ? { id: k.id, email: k.email } : null
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
async function sikreBruger(
  rolle: 'tenant' | 'landlord', rute: '/udlejer' | '/min-side',
): Promise<Bruger | null> {
  const konto = await authKonto()
  if (!konto) return null

  const [alt] = await db.select().from(users).where(eq(users.authUserId, konto.id)).limit(1)
  if (alt) return { id: alt.id, authUserId: konto.id, email: alt.email, navn: alt.name }

  // Bind en eksisterende raekke paa mailadressen, ellers opret.
  const [paaMail] = await db.select().from(users).where(eq(users.email, konto.email)).limit(1)
  if (paaMail) {
    const [r] = await db.update(users)
      .set({ authUserId: konto.id, role: rolle })
      .where(eq(users.id, paaMail.id))
      .returning()
    await sporOprettet(r!.id, true, rute)
    return { id: r!.id, authUserId: konto.id, email: r!.email, navn: r!.name }
  }
  const [ny] = await db.insert(users)
    .values({ email: konto.email, authUserId: konto.id, role: rolle })
    .returning()
  await sporOprettet(ny!.id, false, rute)
  return { id: ny!.id, authUserId: konto.id, email: ny!.email, navn: ny!.name }
}

/**
 * Udlejeren. Uændret adfærd: rollen sættes til `landlord`, og
 * `signup_completed` bogfoeres paa /udlejer.
 */
export const hentUdlejer = (): Promise<Udlejer | null> => sikreBruger('landlord', '/udlejer')

/**
 * Den boligsoegende. Samme mekanik, anden rolle og anden rute.
 *
 * Rollen er ikke adgangskontrol — den bruges ingen steder til at afgoere
 * noget — men en boligsoegende, der opretter konto paa Min side, skal ikke
 * staa i basen som udlejer. Det ville vaere en usandhed om vores egne
 * data, og den slags bliver dyr, den dag rollen FAAR betydning.
 */
export const hentBruger = (): Promise<Bruger | null> => sikreBruger('tenant', '/min-side')

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
