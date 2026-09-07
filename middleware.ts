// ═══════════════════════════════════════════════════════════════
//  Analytics-identifikatorerne sættes her, og kun her.
//
//  En server component kan LÆSE cookies, men ikke sætte dem. Sessionen
//  skal fornys ved hver request for at de 30 minutter er inaktivitet og
//  ikke en fast levetid — og det kan kun ske i middleware.
//
//  UDEN SAMTYKKE GØR FILEN INGENTING. Den ser efter én cookie, finder
//  den ikke, og sender requestet videre urørt. Der sættes ingen
//  identifikator, og der findes ikke noget lag nedenunder, som alligevel
//  gemmer individuelle events. Se docs/analytics-v1.md.
// ═══════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server'
import { BASISCOOKIE, planFor, type Laeser } from './lib/samtykke'

export function middleware(req: NextRequest) {
  const faa: Laeser = (n) => req.cookies.get(n)?.value
  const plan = planFor(faa, new Date())
  if (!plan) return NextResponse.next()

  // Skriv ind i REQUESTET også, så den sidevisning, der lige nu bliver
  // renderet, ser den nye session — ikke først den næste.
  for (const c of plan.saet) req.cookies.set(c.navn, c.vaerdi)
  const svar = NextResponse.next({ request: { headers: req.headers } })
  for (const c of plan.saet) {
    svar.cookies.set(c.navn, c.vaerdi, {
      ...BASISCOOKIE,
      maxAge: c.maxAge,
      secure: req.nextUrl.protocol === 'https:',
    })
  }
  return svar
}

export const config = {
  // Billed-proxyen og statiske filer skal ikke gennem noget som helst.
  // /go/[id] SKAL med: klikket hører til sessionen.
  matcher: ['/((?!_next/static|_next/image|api/billede|favicon.ico|robots.txt|sitemap.xml).*)'],
}
