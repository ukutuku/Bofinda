import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { db } from '../../../../db/client'
import { listingImages, listings } from '../../../../db/schema'
import { hentUdlejer } from '../../../../lib/auth'
import { Annonceformular } from '../../Annonceformular'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Redigér annonce — Bofinda', robots: { index: false } }

export default async function Side({ params }: { params: Promise<{ id: string }> }) {
  const u = await hentUdlejer()
  if (!u) redirect('/udlejer')
  const { id } = await params

  // Ejerskabet ligger i where-betingelsen. Er boligen ikke hendes, findes
  // den ikke — vi svarer ikke forskelligt paa "findes ikke" og "ikke din".
  const [b] = await db.select().from(listings)
    .where(and(eq(listings.id, id), eq(listings.landlordId, u.id))).limit(1)
  if (!b) notFound()

  const billeder = await db.select({ url: listingImages.externalUrl })
    .from(listingImages).where(eq(listingImages.listingId, id))
    .orderBy(listingImages.position)

  return (
    <div className="udlejer">
      <a className="tilbage" href="/udlejer/boliger">← Mine annoncer</a>
      <h1>Redigér annonce</h1>
      <Annonceformular start={{
        id: b.id,
        adresse: b.addressRaw, postnr: b.postalCode ?? '',
        boligtype: b.propertyType ?? 'lejlighed',
        areal: b.sizeM2, vaerelser: b.rooms,
        husleje: b.rentMonthly, varme: b.utilitiesHeat, vand: b.utilitiesWater,
        el: b.utilitiesElectricity, oevrig: b.utilitiesOther,
        depositum: null, forudbetalt: null,
        ledigFra: b.availableFrom ? b.availableFrom.toISOString().slice(0, 10) : null,
        beskrivelse: b.description, kontaktMail: b.contactEmail, kontaktTlf: b.contactPhone,
        billeder: billeder.map((x) => x.url),
      }} />
    </div>
  )
}
