// ═══════════════════════════════════════════════════════════════
//  Source-click. Førsteparts-redirect, ikke et klient-event.
//
//  Serveren ser hvert klik — også midterklik og «åbn i ny fane» — det
//  virker uden JavaScript ligesom resten af produktet, og en adblocker
//  kan ikke ramme en almindelig navigation paa vores eget domaene.
//
//  DESTINATIONEN SLAAS OP I BASEN. Ruten accepterer ALDRIG en URL som
//  parameter: det ville vaere et aabent redirect, som enhver kunne bruge
//  til at sende folk hvorhen som helst med bofinda.dk i adressefeltet.
//  Eventuelle query-parametre ignoreres fuldstaendigt.
//
//  Referrer-Policy: no-referrer bevarer det, `rel="noopener noreferrer"`
//  gjorde foer — kilden faar ingen referrer fra os. Uden linjen ville vi
//  stiltiende aendre, hvad kilderne ser om deres trafik.
//
//  ANALYTICS MAA ALDRIG FORHINDRE REDIRECTET. spor() kaster ikke, og
//  opslaget er det eneste, der kan give 404.
// ═══════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '../../../db/client'
import { listings, sources } from '../../../db/schema'
import { spor } from '../../../lib/maaling-server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Ukendt bolig', { status: 404 })

  const [b] = await db
    .select({
      url: listings.sourceUrl,
      kilde: sources.slug,
      postnr: listings.postalCode,
      type: listings.propertyType,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    .where(and(eq(listings.id, id), eq(listings.status, 'active')))
    .limit(1)

  if (!b?.url) return new NextResponse('Ukendt bolig', { status: 404 })

  await spor({
    navn: 'source_click',
    listingId: id,
    sourceSlug: b.kilde,
    props: {
      maal: 'kilde',
      ...(b.postnr ? { postnr: b.postnr } : {}),
      ...(b.type ? { property_type: b.type } : {}),
    },
  }, '/go/[id]')

  return NextResponse.redirect(b.url, {
    status: 302,
    headers: { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' },
  })
}
