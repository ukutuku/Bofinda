'use server'

// ═══════════════════════════════════════════════════════════════
//  Brugerområdets server actions.
//
//  BRUGEREN KOMMER FRA SESSIONEN, ALDRIG FRA FORMULAREN. Ingen af
//  handlingerne her tager imod et bruger-id. Klienten sender kun, HVILKEN
//  bolig det handler om — hvem hun er, afgør cookien.
//
//  Det er ikke en detalje: et `user_id` i en formular ville kunne rettes i
//  en browserkonsol, og saa var favoritlisten faelles ejendom. Serveren er
//  autoritativ, fordi den er det eneste sted, identiteten laeses.
// ═══════════════════════════════════════════════════════════════

import { hentBrugerStatus } from '../../lib/auth'
import { erFavorit, fjernFavorit, gemFavorit } from '../../lib/favoritter'
import { erBoligId } from '../../lib/gemoenske'

export type Favoritsvar =
  | { gemt: boolean }
  | { fejl: 'ikke-logget-ind' }
  | { fejl: 'konto-konflikt' }
  | { fejl: 'ugyldig' }

/**
 * Slå favorit til eller fra.
 *
 * Skiftet regnes ud paa SERVEREN ud fra det, der staar i basen — ikke ud
 * fra hvad klienten mener tilstanden var. To faner aabne paa den samme
 * bolig maa ikke kunne skubbe hinanden ud af trit, og en klient, der
 * paastaar «den var ikke gemt», maa ikke kunne slette noget.
 */
export async function skiftFavorit(listingId: string): Promise<Favoritsvar> {
  if (!erBoligId(listingId)) return { fejl: 'ugyldig' }
  const svar = await hentBrugerStatus()
  // En afvist binding er ikke det samme som «ikke logget ind». Skelnes de
  // ikke, faar hun beskeden «log ind» hver gang hun trykker paa hjertet —
  // og hun ER logget ind.
  if (svar.slags === 'konflikt' || svar.slags === 'ubekraeftet-mail') {
    return { fejl: 'konto-konflikt' }
  }
  if (svar.slags !== 'ok') return { fejl: 'ikke-logget-ind' }
  const bruger = svar.bruger

  if (await erFavorit(bruger.id, listingId)) {
    await fjernFavorit(bruger.id, listingId)
    return { gemt: false }
  }
  await gemFavorit(bruger.id, listingId)
  return { gemt: true }
}

/** Fjern fra Min side. Idempotent — knappen maa gerne trykkes to gange. */
export async function fjernFraMinSide(f: FormData): Promise<void> {
  const id = String(f.get('bolig') ?? '')
  if (!erBoligId(id)) return
  const svar = await hentBrugerStatus()
  if (svar.slags !== 'ok') return
  await fjernFavorit(svar.bruger.id, id)
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/min-side')
}
