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
import { FUNKTION, maaBruge } from '../../../lib/adgang'
import { spor } from '../../../lib/maaling-server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Ukendt bolig', { status: 404 })

  // ── BETALINGSMUREN, FOER opslaget ───────────────────────────
  // Ruten er den eneste vej til kildens egen adresse, og adressen maa
  // ikke forlade databasen for en bruger uden adgang. Derfor spoerges
  // der FOER select'en: det, vi ikke henter, kan ikke lække i en
  // header, en fejlside eller en log.
  //
  // Svaret er en 303 til koebssiden med vejen tilbage, ikke en 404.
  // En 404 ville paastaa, at boligen ikke findes — og det er loegn.
  const adgang = await maaBruge(FUNKTION.kildelink)
  if (!adgang.ok) {
    await spor({
      navn: 'paywall_blocked',
      listingId: id,
      props: { funktion: FUNKTION.kildelink, grund: adgang.grund, tilstand: adgang.tilstand },
    }, '/go/[id]')
    const retur = encodeURIComponent(`/go/${id}`)
    // Begge veje gaar til /abonnement, som selv skelner: mangler der
    // login, viser den «Log ind for at fortsaette» med returvejen i
    // linket. /min-side laeser ingen `retur`-parameter i dag, og en
    // halvbygget loginvej ville tabe boligen paa gulvet — samme fejl
    // som hjerteklikket foer 00c546a.
    const maal = `/abonnement?retur=${retur}&grund=${adgang.grund}`
    // RELATIV Location, bygget af vores egne konstanter. Ikke
    // `NextResponse.redirect(new URL(..., req.url))`: den ville lade en
    // Host-header fra en mellemliggende proxy bestemme, hvilket domaene
    // brugeren landede paa. HTTP tillader en relativ Location, og den
    // kan per definition ikke pege ud af vores eget site.
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: maal,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    })
  }

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
    headers: {
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      // Svaret afhaenger af HVEM der spoerger, naar muren staar. Uden
      // den her linje var ruten kun ucachebar, fordi den tilfaeldigvis
      // er `force-dynamic` — og et mellemled kunne gemme ét menneskes
      // adgang og give den til det naeste.
      'Cache-Control': 'private, no-store',
    },
  })
}
