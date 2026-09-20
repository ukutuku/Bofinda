'use server'

// Server actions for abonnementet. Hver af dem henter brugeren fra den
// VERIFICEREDE session — ingen af dem tager et bruger-id, et kunde-id,
// en pris eller en status som argument.

import { sigOp, startKoeb } from '../../lib/abonnement'
import { hentBrugerId } from '../../lib/auth'
import { hentTilstand } from '../../lib/adgang'
import { saetTilstand } from '../../lib/driftskift'
import { spor } from '../../lib/maaling-server'

/** En intern sti — aldrig en fremmed URL, og aldrig et protokolskift. */
function renRetur(r: string | null | undefined): string {
  if (!r || !r.startsWith('/') || r.startsWith('//')) return '/'
  return r
}

export async function koeb(retur: string) {
  const svar = await startKoeb(renRetur(retur))
  if (svar.ok) {
    await spor({
      navn: 'checkout_started',
      props: { funktion: 'kontakt', tilstand: 'betaling' },
    }, '/abonnement')
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
