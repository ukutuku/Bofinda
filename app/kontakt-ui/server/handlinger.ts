'use server'
// ═══════════════════════════════════════════════════════════════
//  Server action'en for kontaktrejsen.
//
//  ═══ HVORFOR MUREN STÅR HER OG IKKE I PANELET ═══
//
//  En server action er et OFFENTLIGT endepunkt. Den kan kaldes direkte,
//  uden at den side, der plejer at kalde den, har vist noget som helst
//  — uden knap, uden panel, uden at `Kontaktpanel` nogensinde er
//  gengivet. At panelet skjuler knappen er en konvention mellem os og
//  os selv; den binder ingen.
//
//  Hele kontaktrejsens brugerflade er indtil nu målt mod en attrap, og
//  kontrollen beviser, at fladen ikke VISER låst indhold. Den beviser
//  ikke, at serveren nægter at UDLEVERE det. Det er dét, filen her er
//  til for.
//
//  ═══ DEN AFGØR STADIG INGENTING ═══
//
//  Beslutningen kommer fra `beslutning.ts`, som kommer fra
//  `lib/adgang.ts`. Håndhævelsen er `udleverKontakt` i
//  `lib/kontaktmur.ts`. Denne fil binder de tre ting sammen og gør
//  ikke andet — den har ingen regel, ingen dato, ingen tilstand.
//
//  ═══ INGEN MÅLING ENDNU, OG DET ER MED VILJE ═══
//
//  `lib/maaling.ts` er et LUKKET navnesæt — en hændelse, der ikke står
//  der, kan ikke oversættes. Betalingsserien tilføjer `paywall_blocked`
//  dér på sin egen gren. Skrev jeg den ind her også, ville der være to
//  definitioner af Supplys hændelse, og de ville støde sammen i
//  fletningen. Og ruten `/kontakt-ui` findes ikke i sættet, fordi
//  rejsen ikke er tilsluttet en produktionsrute; en måling på en rute,
//  der ikke findes, ville være en logline, der ikke svarer til
//  virkeligheden — CLAUDE.md's egen advarsel.
//
//  Når rejsen tilsluttes, hører der to linjer til, på samme form som i
//  `app/bolig/[id]/kontakthandling.ts`: `paywall_blocked` ved nej
//  (funktion + grund, ALDRIG hvem eller hvad hun ville have set) og
//  `contact_reveal` ved ja (kun `har_mail`/`har_telefon`, aldrig
//  værdierne). Se SERVERINTEGRATION.md.
// ═══════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { listings } from '../../../db/schema'
import { udleverKontakt, type Muregrund, type Udlevering } from '../../../lib/kontaktmur'
import { kontaktbeslutning } from './beslutning'
import type { Laasegrund } from '../kontrakt'

/**
 * Murens grund → brugerfladens låsegrund.
 *
 * ⚠ `ukendt_tilstand` bliver til `null`, IKKE til en lås. Vi kunne ikke
 * bekræfte adgangen — det er vores fejl, ikke en manglende betaling, og
 * at sende hende til kassen for vores egen fejl er den samme løgn som
 * et gættet aconto-beløb. Kaldet ovenfor viser den neutrale fejl.
 *
 * ⚠ Der er INGEN vej til `abonnement-udloebet`. Beslutningens `Grund`
 * kan ikke skelne «udløbet» fra «kræver abonnement»: en udløbet periode
 * falder ud af opslaget og bliver `abonnement_kraeves`. Tilstand 7 i
 * brugerfladen — «Dit abonnement er udløbet … Dine samtaler er ikke
 * slettet» — kan derfor ikke nås gennem serverlaget endnu. Det er et
 * fund til Supply, ikke noget vi gætter os ud af her. Se
 * SERVERINTEGRATION.md.
 */
export async function tilLaasegrund(grund: Muregrund): Promise<Laasegrund | null> {
  switch (grund) {
    case 'login_kraeves': return 'login-kraevet'
    case 'abonnement_kraeves': return 'abonnement-kraevet'
    case 'ukendt_tilstand': return null
  }
}

/** Selve opslaget. Muren i SQL'en: kun native, kun aktiv. */
const laesKontaktraekke = async (id: string) => {
  const [r] = await db
    .select({ mail: listings.contactEmail, telefon: listings.contactPhone })
    .from(listings)
    .where(and(
      eq(listings.id, id),
      eq(listings.sourceType, 'native'),
      eq(listings.status, 'active'),
    ))
    .limit(1)
  return r ? { mail: r.mail, telefon: r.telefon } : null
}

export async function hentKontaktServerside(id: string): Promise<Udlevering> {
  return udleverKontakt(id, kontaktbeslutning, laesKontaktraekke)
}
