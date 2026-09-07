'use server'

// ═══════════════════════════════════════════════════════════════
//  Brugerens valg om statistik.
//
//  Server action, ikke en route: den skal kunne kaldes fra banneret uden
//  at siden genindlæses, og en server action er det ene sted ud over
//  middleware, hvor cookies kan sættes.
//
//  Ingen dark patterns. `nej` er en rigtig knap med en rigtig virkning:
//  identifikatorerne slettes med det samme, og der skrives ikke flere
//  events. Auth- og sikkerhedscookies røres ikke.
// ═══════════════════════════════════════════════════════════════

import { cookies } from 'next/headers'
import {
  BASISCOOKIE, C_SAMTYKKE, RYD_VED_NEJ, SAMTYKKE_SEK, VALGCOOKIE,
} from '../lib/samtykke'

export async function saetSamtykke(svar: 'ja' | 'nej'): Promise<void> {
  const jar = await cookies()
  jar.set(C_SAMTYKKE, svar, { ...VALGCOOKIE, maxAge: SAMTYKKE_SEK })

  if (svar === 'nej') {
    // Tilbagetrækning: identifikatorerne forsvinder her og nu. Siger hun
    // ja igen senere, dannes et NYT anonymt id — det gamle forløb kan
    // ikke genoptages, og det er meningen.
    for (const n of RYD_VED_NEJ) jar.set(n, '', { ...BASISCOOKIE, maxAge: 0 })
  }
  // Ved 'ja' sættes identifikatorerne af middleware ved næste request.
  // De hører til dér, fordi sessionen skal fornys ved hver request.
}

/**
 * «Slet det, I har målt om mig.»
 *
 * Vi kender ikke brugeren, men browseren bærer nøglen, så hun kan bede om
 * det uden at identificere sig. Rækkerne slettes på anonymous_id, og
 * cookierne ryddes bagefter.
 */
export async function sletMineHaendelser(): Promise<{ slettet: number }> {
  const jar = await cookies()
  const aid = jar.get('bofinda_aid')?.value
  if (!aid) return { slettet: 0 }
  const { sletForAnonym } = await import('../lib/maaling-server')
  const slettet = await sletForAnonym(aid)
  for (const n of RYD_VED_NEJ) jar.set(n, '', { ...BASISCOOKIE, maxAge: 0 })
  jar.set(C_SAMTYKKE, 'nej', { ...VALGCOOKIE, maxAge: SAMTYKKE_SEK })
  return { slettet }
}
