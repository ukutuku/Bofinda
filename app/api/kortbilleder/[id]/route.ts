// ═══════════════════════════════════════════════════════════════
//  Boligkortets billeder, til bladring direkte på kortet.
//
//  Kaldes af `app/KortBilleder.tsx` FØRST ved interaktion — når musen
//  kommer ind over et kort med flere billeder, når en pil får fokus, eller
//  når en finger rører billedet. Aldrig ved sidevisning: søgesidens 48 kort
//  skal ikke hente billedlister, ingen bladrer i.
//
//  Svaret er de SAMME signerede proxyadresser, boligsiden bruger
//  (`billedUrl`), i to bredder til `srcset`. Kildens rå adresse står i
//  `u` i hver af dem, præcis som på boligsiden — se noten øverst i
//  app/api/billede/route.ts. Ruten udleverer altså intet, siderne ikke
//  allerede viser.
// ═══════════════════════════════════════════════════════════════

import { billedUrl, breddeTilladt } from '../../../../lib/billede'
import { hentKortbilleder } from '../../../../lib/soeg'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) {
    return Response.json({ fejl: 'ugyldigt id' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  const billeder = (await hentKortbilleder(id)).flatMap((u) => {
    const lille = billedUrl(u, 400)
    if (!lille) return []
    // 800 KUN, hvis værten må levere den — samme vagt som kortets srcset.
    return [{ src: lille, srcSet: breddeTilladt(u, 800) ? `${lille} 400w, ${billedUrl(u, 800)} 800w` : null }]
  })
  return Response.json({ billeder }, {
    // Fem minutter, som facetterne: importen kører én gang i timen.
    headers: { 'cache-control': 'public, max-age=300' },
  })
}
