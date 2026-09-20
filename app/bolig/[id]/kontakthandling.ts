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
//
//  ── BETALINGSMUREN ──────────────────────────────────────────
//  Handlingen er en server action, og en server action kan kaldes
//  DIREKTE — uden at siden, der plejer at kalde den, har vist noget som
//  helst. Derfor spørges `maaBruge()` her, i selve handlingen, og ikke
//  i komponenten: en mur i skabelonen er ingen mur.
//
//  Beslutningen træffes ÉT sted, `lib/adgang.ts`. Den her fil har ingen
//  egen regel om tilstande eller abonnementer — den spørger og adlyder.
//  Nægtes adgangen, rører vi ikke databasen: felterne forlader den
//  aldrig, så de kan heller ikke lække ved en senere UI-ændring.
// ═══════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { listings } from '../../../db/schema'
import { FUNKTION, maaBruge, type Grund } from '../../../lib/adgang'
import { spor } from '../../../lib/maaling-server'

export interface Kontakt {
  mail: string | null
  telefon: string | null
  /** Sat NÅR og KUN når adgangen blev nægtet. Visningen vælger tekst. */
  naegtet?: Grund
}

export async function hentKontakt(id: string): Promise<Kontakt> {
  const adgang = await maaBruge(FUNKTION.kontakt)
  if (!adgang.ok) {
    // Registrér AT muren stoppede nogen — aldrig hvem eller hvad hun
    // ville have set. Uden det tal kan ingen se, om muren virker.
    await spor({
      navn: 'paywall_blocked',
      listingId: id,
      props: { funktion: FUNKTION.kontakt, grund: adgang.grund, tilstand: adgang.tilstand },
    }, '/bolig/[id]')
    return { mail: null, telefon: null, naegtet: adgang.grund }
  }

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
  // Handlingen RETURNERER kontaktoplysninger. Eventet registrerer kun, AT
  // den skete — hverken mailen eller nummeret maa naa et event.
  await spor({
    navn: 'contact_reveal',
    listingId: id,
    props: { har_mail: Boolean(r?.mail), har_telefon: Boolean(r?.telefon) },
  }, '/bolig/[id]')
  return { mail: r?.mail ?? null, telefon: r?.telefon ?? null }
}
