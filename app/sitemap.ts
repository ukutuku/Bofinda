import type { MetadataRoute } from 'next'
import { alleOmraader } from '../lib/omraade'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bofinda.dk'

/**
 * Kun omraader over graensen kommer med — `alleOmraader` filtrerer dem fra.
 * En URL i sitemap'et, der giver 404 eller viser to boliger, koster mere
 * end den giver.
 *
 * Boligsiderne staar med vilje IKKE her: de forsvinder, naar boligen bliver
 * udlejet, og et sitemap fuldt af doede adresser er et daarligt signal.
 * Omraadesiderne bestaar.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const omraader = await alleOmraader()
  const nu = new Date()

  return [
    { url: BASE, lastModified: nu, changeFrequency: 'hourly', priority: 1 },
    ...omraader.map((o) => ({
      url: `${BASE}/lejeboliger/${o.slug}`,
      lastModified: nu,
      changeFrequency: 'daily' as const,
      // Et omraade med mange boliger er en vigtigere side end et med fire.
      priority: Math.min(0.9, 0.4 + Math.log10(o.antal) / 5),
    })),
  ]
}
