'use server'

// ═══════════════════════════════════════════════════════════════
//  Kontaktoplysninger på en udlejerannonce.
//
//  Hvorfor en handling og ikke bare tekst i HTML'en: siden er offentlig,
//  og adresse-høstere læser rå mailadresser i markup på minutter. Ligger
//  adressen ikke i svaret, er der intet at høste for en robot, der bare
//  henter siden. Den kommer først, når et menneske trykker.
//
//  Det rigtige på sigt er en formular, der sender beskeden videre på
//  serveren, så adressen aldrig forlader os. Den kan ikke bygges endnu:
//  vores afsender er Resends delte testdomæne, som kun leverer til
//  kontoens egen ejer — en formular ville tie og tabe henvendelsen.
//  Se noten i CLAUDE.md.
//
//  Muren står stadig i query'en: betingelsen på sourceType er i SQL'en,
//  ikke her. En scrapet bolig kan ikke få kontaktfelter ud ad denne vej.
// ═══════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { listings } from '../../../db/schema'

export interface Kontakt {
  mail: string | null
  telefon: string | null
}

export async function hentKontakt(id: string): Promise<Kontakt> {
  const [r] = await db
    .select({ mail: listings.contactEmail, telefon: listings.contactPhone })
    .from(listings)
    .where(and(
      eq(listings.id, id),
      // Kun udlejerens egne annoncer. Staar her, ikke i kaldet.
      eq(listings.sourceType, 'native'),
      eq(listings.status, 'active'),
    ))
    .limit(1)
  return { mail: r?.mail ?? null, telefon: r?.telefon ?? null }
}
