// ═══════════════════════════════════════════════════════════════
//  Bekræftelseslinkets landing.
//
//  ═══ HULLET DEN LUKKER ═══
//
//  `lib/auth.ts` bruger `createServerClient` fra @supabase/ssr, og den
//  kører PKCE. Bekræftelseslinket i mailen peger derfor på Supabase, som
//  verificerer adressen og sender browseren videre til OS med `?code=…`.
//  Den kode skal veksles til en session. Det gjorde ingen: der fandtes
//  ingen rute til det, og `middleware.ts` rører kun samtykkecookies.
//
//  Brugeren landede altså på en side med en uforklaret parameter i
//  adresselinjen, stadig logget ud — mens adressen FAKTISK var bekræftet
//  hos Supabase. Forløbet var ikke brudt, det var uafsluttet, og det er
//  den værste slags: der er ingen fejl at fejlsøge på.
//
//  ═══ INGEN KODER UD AF DEN HER FIL ═══
//
//  `code` logges ikke, måles ikke og videresendes ikke. Auth-serverens
//  fejltekst gør heller ikke: den er engelsk, teknisk og kan bære
//  brugerinput. Landingssiden får ét fast ord — `LINKFEJL` — og skriver
//  sin egen besked af det.
//
//  ═══ SVARET MÅ IKKE CACHES ═══
//
//  Det bærer sessionscookies for ét bestemt menneske. `no-store` sættes
//  udtrykkeligt; en delt cache foran appen ville ellers kunne udlevere
//  dem til den næste.
// ═══════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server'
import { K_PARAM, LINKFEJL, kontekstFra, vejFor } from '../../../lib/kontovej'
import { konfigureret, klientMed } from '../../../lib/supabase-klient'

/** Cookies og en kode pr. besøg: der er ikke noget at gengive på forhånd. */
export const dynamic = 'force-dynamic'

/**
 * Hvilken oprindelse redirect'et bygges på.
 *
 * `NEXT_PUBLIC_BASE_URL` er VORES egen indstilling og vinder derfor over
 * request'ets vært, som en fremmed kan sætte. Er den ikke sat, bruges
 * `nextUrl.origin` — og selv da kan svaret ikke pege ud af huset, for
 * stien kommer altid fra `INTERNE_MAAL` i lib/kontovej.ts og aldrig fra
 * noget, kalderen har sendt. Der er hverken `returnTo`, `next` eller
 * `Referer` inde i billedet.
 */
function oprindelse(req: NextRequest): string {
  const egen = process.env.NEXT_PUBLIC_BASE_URL
  if (egen) {
    try { return new URL(egen).origin } catch { /* forkert sat — brug request'ets */ }
  }
  return req.nextUrl.origin
}

function svarMed(sti: string, req: NextRequest): NextResponse {
  const svar = NextResponse.redirect(new URL(sti, oprindelse(req)))
  svar.headers.set('Cache-Control', 'no-store, max-age=0')
  return svar
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const kontekst = kontekstFra(req.nextUrl.searchParams.get(K_PARAM))
  const vej = vejFor(kontekst)
  const fejlsti = `${vej.vedLinkfejl}?${LINKFEJL}=1`

  // Miljøet uden Auth: siderne viser allerede «ikke sat op endnu», og en
  // veksling ville kaste. Landingssiden er stadig det rigtige svar.
  if (!konfigureret()) return svarMed(vej.vedLinkfejl, req)

  const kode = req.nextUrl.searchParams.get('code')
  // Ingen kode: nogen har åbnet ruten direkte, eller en mailklient har
  // klippet i adressen. Ikke en fejl at kaste over — en vej videre.
  if (!kode) return svarMed(fejlsti, req)

  // Svaret bygges FØRST, så SDK'et kan skrive sessionscookies direkte på
  // det. Skrev vi dem på et andet objekt og lavede redirect'et bagefter,
  // ville de falde på gulvet — og brugeren ville lande på Min side som
  // udlogget, hvilket er nøjagtig den fejl, ruten findes for at rette.
  const svar = svarMed(vej.efterBekraeftelse, req)

  const sb = klientMed({
    getAll: () => req.cookies.getAll(),
    setAll: (sat) => {
      for (const { name, value, options } of sat) svar.cookies.set(name, value, options)
    },
  })

  // Kan fejle på fire måder, som brugeren ikke kan skelne og heller ikke
  // behøver: koden er ugyldig, udløbet, allerede brugt, eller PKCE-
  // verifieren mangler (linket åbnet i en anden browser end den, der
  // oprettede kontoen). Alle fire ender samme sted med samme besked.
  // `catch` er der, fordi et netværksudfald mod Auth-serveren ellers
  // ville blive en 500 på et link fra en mail.
  try {
    const { error } = await sb.auth.exchangeCodeForSession(kode)
    if (error) return svarMed(fejlsti, req)
  } catch {
    return svarMed(fejlsti, req)
  }

  // Ingen løkke: `efterBekraeftelse` er /min-side eller /udlejer/boliger,
  // og ingen af dem sender nogensinde tilbage hertil.
  return svar
}
