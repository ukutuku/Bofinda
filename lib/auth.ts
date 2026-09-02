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

export interface Udlejer {
  id: string
  authUserId: string
  email: string
  navn: string | null
}

/**
 * Den indloggede bruger som VORES brugerrække, oprettet efter behov.
 *
 * Findes mailadressen allerede fra en gemt søgning, bindes den række til
 * kontoen i stedet for at lave en ny. Ellers ville den samme person have
 * to rækker, og hendes søgninger ville høre til den forkerte.
 */
export async function hentUdlejer(): Promise<Udlejer | null> {
  if (!konfigureret()) return null
  const sb = await supabase()
  const { data } = await sb.auth.getUser()
  const konto = data.user
  if (!konto?.email) return null

  const [alt] = await db.select().from(users).where(eq(users.authUserId, konto.id)).limit(1)
  if (alt) return { id: alt.id, authUserId: konto.id, email: alt.email, navn: alt.name }

  // Bind en eksisterende raekke paa mailadressen, ellers opret.
  const [paaMail] = await db.select().from(users).where(eq(users.email, konto.email)).limit(1)
  if (paaMail) {
    const [r] = await db.update(users)
      .set({ authUserId: konto.id, role: 'landlord' })
      .where(eq(users.id, paaMail.id))
      .returning()
    return { id: r!.id, authUserId: konto.id, email: r!.email, navn: r!.name }
  }
  const [ny] = await db.insert(users)
    .values({ email: konto.email, authUserId: konto.id, role: 'landlord' })
    .returning()
  return { id: ny!.id, authUserId: konto.id, email: ny!.email, navn: ny!.name }
}

/** Adgangstoken til Storage. Uploaden sker som brugeren selv — se
 *  politikkerne i migration 0014. */
export async function adgangstoken(): Promise<string | null> {
  if (!konfigureret()) return null
  const sb = await supabase()
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}
