// ═══════════════════════════════════════════════════════════════
//  Billederne til ÉN bolig — hentet, når nogen faktisk vil bladre.
//
//  ═══ HVORFOR EN RUTE OG IKKE ET FELT PÅ KORTET ═══
//
//  Søgesiden viser 48 kort. Lagde vi hele billedlisten på hvert kort,
//  ville svaret bære adresserne på alle boligernes billeder, hver eneste
//  gang nogen åbner forsiden — også for de mange, der aldrig bladrer.
//  Kortet får derfor kun forsiden og ET ANTAL, som før, og resten hentes
//  her, første gang en bruger viser, at hun vil se dem.
//
//  ═══ ADRESSERNE SIGNERES HER, IKKE I BROWSEREN ═══
//
//  `billedUrl()` bruger `node:crypto` og hemmeligheden i
//  BILLED_HEMMELIGHED. En klientkomponent kan altså ikke selv danne
//  adressen på billede 2..N — og det er meningen: signaturen er det, der
//  forhindrer, at proxyen bliver en gratis billedtjeneste for fremmede
//  adresser. Ruten udleverer PRÆCIS de samme signerede adresser, som
//  serveren ville have lagt på kortet.
//
//  ═══ HVAD DEN ALDRIG RØRER ═══
//
//  `listing_images` og intet andet. Fire kolonner, hvoraf den læser to.
//  `listings` røres kun for at afgøre, om boligen findes — og der
//  vælges ét felt, `id`. Kontaktfelterne kan altså ikke lække herfra,
//  heller ikke ved en uopmærksom udvidelse: de står ikke i nogen
//  select-liste i filen. Se CLAUDE.md om muren i query-laget.
// ═══════════════════════════════════════════════════════════════

import { and, asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { NextResponse } from 'next/server'
import { db } from '../../../db/client'
import { listingImages, listings } from '../../../db/schema'
import { billedUrl, breddeTilladt } from '../../../lib/billede'
import { VISBAR_VAERT } from '../../../lib/soeg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Loftet.
 *
 * Den mest billedrige bolig i produktionen har 30. Loftet er ikke en
 * optimering, men en grænse for, hvad ét kald kan koste os: uden det
 * afgør kildens data, hvor mange HMAC'er og hvor stort et svar en
 * fremmed kan udløse med ét kald.
 *
 * DET LIGGER HØJT MED VILJE. Kortets tæller siger «2/8», og de 8 kommer
 * fra en SQL-tælling uden loft. Skar ruten listen ned under det tal,
 * ville kortet love billeder, der ikke kan nås — to udtryk for det samme
 * spørgsmål. Bladringen retter sig selv, så snart listen er hentet
 * (tælleren bruger da listens længde), men vinduet inden da ville være
 * en usandhed. 60 er det dobbelte af det højeste, vi har målt.
 */
const LOFT = 60

/** Et uuid og intet andet. En fri streng ville gå videre til databasen. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const afvis = (grund: string, kode: number) =>
  NextResponse.json({ fejl: grund }, { status: kode, headers: { 'cache-control': 'no-store' } })

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('b')
  if (!id || !UUID.test(id)) return afvis('ugyldigt bolig-id', 400)

  // Findes boligen overhovedet? Uden opslaget ville et gættet id give et
  // tomt svar, der ikke er til at skelne fra «boligen har ingen billeder».
  const [bolig] = await db.select({ id: listings.id }).from(listings)
    .where(eq(listings.id, id)).limit(1)
  if (!bolig) return afvis('ukendt bolig', 404)

  // SAMME filter som kortets egen tælling og forside — `VISBAR_VAERT` er
  // importeret, ikke skrevet af. Tælleren på kortet siger «2/8», og de 8
  // skal være de samme 8, der kan bladres til; to udtryk for det tal ville
  // være den fejlform, CLAUDE.md samler seks tilfælde af.
  //
  // ALIASET «i» ER IKKE PYNT. `VISBAR_VAERT` er skrevet som
  // `substring(i.external_url ...)` — den forudsætter, at tabellen hedder
  // `i`, fordi den i lib/soeg.ts altid står i en underforespørgsel med
  // netop det alias. Uden aliaset her ville forespørgslen fejle med
  // «missing FROM-entry for table i» ved FØRSTE rigtige kald. Det er
  // prisen for at genbruge udtrykket frem for at skrive det af — og den
  // pris er den rigtige: en afskrift ville drive fra allowlisten.
  const i = alias(listingImages, 'i')
  const raekker = await db
    .select({ url: i.externalUrl })
    .from(i)
    .where(and(eq(i.listingId, id), sql`${VISBAR_VAERT}`))
    .orderBy(asc(i.position), asc(i.id))
    .limit(LOFT)

  // `billedUrl` kan skære ned til en mindre bredde, når værten har bedt om
  // det (lokalbolig.io). `breddeTilladt` afgør, om 800 overhovedet må
  // tilbydes — samme vagt som kortets srcSet, så en deskriptor aldrig
  // lyver om filens bredde.
  const billeder = raekker.flatMap((r) => {
    const lille = billedUrl(r.url, 400)
    if (!lille) return []          // vært uden for allowlisten: findes ikke for os
    return [{ lille, stor: breddeTilladt(r.url, 800) ? billedUrl(r.url, 800) : null }]
  })

  return NextResponse.json({ billeder }, {
    headers: {
      // Adresserne er signerede og stabile, og listen ændrer sig kun, når
      // importen henter boligen igen. Et kvarter er kort nok til, at et
      // nyt billede kommer med, og langt nok til at en bladring ikke
      // koster et kald pr. kort.
      'cache-control': 'private, max-age=900',
    },
  })
}
