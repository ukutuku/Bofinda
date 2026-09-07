// ═══════════════════════════════════════════════════════════════
//  Beacon-endpointet for de fem klient-events.
//
//  Ruten koerer SAMME allowlist som serversiden gennem `spor()`, saa
//  klienten ikke kan sende noget, serveren ikke ville have accepteret.
//  Identiteten opløses her ud fra cookies — browseren sender dem selv,
//  fordi ruten er samme oprindelse — saa klienten kan ikke forfalske den.
//
//  Uden samtykke er der ingen cookies, ingen kontekst og dermed intet
//  event. Svaret er 204 uanset hvad: en beacon skal ikke kunne bruges
//  til at afgøre, om nogen har sagt ja.
// ═══════════════════════════════════════════════════════════════

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  KLIENTEVENTS, RUTER, miljoe, type Eventnavn, type Haendelse, type Kontekst, type Rute,
} from '../../../lib/maaling'
import { spor } from '../../../lib/maaling-server'
import { C_ANONYM, C_FORSOEG, C_SESSION, laesForsoeg, laesSamtykke, type Laeser } from '../../../lib/samtykke'

const TOMT = new NextResponse(null, { status: 204 })
const MAKS = 40

export async function POST(req: Request) {
  try {
    const jar = await cookies()
    const faa: Laeser = (n) => jar.get(n)?.value
    if (laesSamtykke(faa) !== 'ja') return TOMT
    const anonymousId = faa(C_ANONYM)
    const sessionId = faa(C_SESSION)?.split('.')[0]
    const m = miljoe()
    if (!anonymousId || !sessionId || !m) return TOMT

    const krop = await req.json() as { events?: unknown }
    if (!Array.isArray(krop.events)) return TOMT

    for (const raa of krop.events.slice(0, MAKS)) {
      const e = raa as { navn?: string; props?: unknown; listingId?: string; sourceSlug?: string; rute?: string }
      // Kun de fem. Alt andet fra en browser er en fejl eller et forsoeg.
      if (!e.navn || !(KLIENTEVENTS as readonly string[]).includes(e.navn)) continue
      const rute: Rute = (RUTER as readonly string[]).includes(e.rute ?? '')
        ? e.rute as Rute : '/api/maaling'
      const k: Kontekst = {
        miljoe: m, anonymousId, sessionId,
        userId: null, researchSessionId: laesForsoeg(faa), rute,
      }
      await spor({
        navn: e.navn as Eventnavn,
        props: (e.props ?? {}) as never,
        listingId: e.listingId,
        sourceSlug: e.sourceSlug,
      } as Haendelse, rute, { kontekst: k })
    }
  } catch {
    // Fail-open. En daarlig beacon maa ikke give en fejl i browseren.
  }
  return TOMT
}
