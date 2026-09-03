import { and, eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { db } from '../../../../db/client'
import { listingImages, listings } from '../../../../db/schema'
import { hentUdlejer } from '../../../../lib/auth'
import { billedUrl } from '../../../../lib/billede'
import { somFormular } from '../../../../lib/udlejer'
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
        ...somFormular(b),
        id: b.id,
        // Med forhaandsvisning. Uden den stod de gemte billeder som graa
        // "Gemt billede"-felter, og udlejeren kunne ikke se hvilke hun havde.
        billeder: billeder.map((x) => ({ url: x.url, vis: billedUrl(x.url, 400) ?? '' })),
      }} />
    </div>
  )
}
