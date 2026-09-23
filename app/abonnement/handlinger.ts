'use server'

// Server actions for abonnementet. Hver af dem henter brugeren fra den
// VERIFICEREDE session — ingen af dem tager et bruger-id, et kunde-id,
// en pris eller en status som argument.

import { sigOp, startKoeb } from '../../lib/abonnement'
import { hentBrugerId } from '../../lib/auth'
import { hentTilstand, koebsstart } from '../../lib/adgang'
import { saetTilstand } from '../../lib/driftskift'
import { renRetur } from '../../lib/retur'
import { spor } from '../../lib/maaling-server'

export async function koeb(retur: string) {
  // Den RENSEDE sti bruges begge steder: til koebet og til maalingen.
  // To kald til `renRetur` ville vaere to udtryk for ét spoergsmaal.
  const rent = renRetur(retur)
  const svar = await startKoeb(rent)
  if (svar.ok) {
    // Endnu en sessionslaesning. Den koster ét indeksopslag paa en
    // handling, der sker sjaeldent, og alternativet — at lade
    // `startKoeb` udlevere id'et — ville aendre en graenseflade, hvis
    // hele pointe er, at den henter brugeren selv.
    const brugerId = await hentBrugerId()
    // Ingen bruger, intet event. Det kan ikke ske efter `ok` (koebet
    // kraever en session), og et gaet her ville vaere et tal uden
    // daekning.
    if (brugerId) {
      await spor({
        navn: 'checkout_started',
        props: await koebsstart(brugerId, rent),
      }, '/abonnement')
    }
  }
  return svar
}

export async function opsig() {
  const svar = await sigOp()
  if (svar.ok) {
    await spor({ navn: 'subscription_canceled', props: {} }, '/min-side')
  }
  return svar
}

/** Adminhandlingen. Rollen slaas op i basen af `saetTilstand`. */
export async function skiftTilstand(til: 'gratis' | 'betaling', note?: string) {
  return saetTilstand(til, await hentBrugerId(), note)
}

export async function laesTilstand() {
  return hentTilstand()
}
