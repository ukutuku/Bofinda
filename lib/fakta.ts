// ═══════════════════════════════════════════════════════════════
//  Hydrering af availability_facts.
//
//  Kolonnen er jsonb og har vaeret gennem databasen — den KAN indeholde
//  hvad som helst. Derfor gaar al laesning gennem den her parser, aldrig
//  gennem en cast. Reglerne:
//
//    · kendte felter valideres mod deres praecise type. `false` er et
//      rigtigt kildefaktum — ingen truthy-tjek.
//    · fravaerende noegle forbliver fravaerende; eksplicit null bevares.
//      Persisteringen opfinder ikke forskellen vaek — domaenet maa selv
//      behandle begge som "ingen evidens".
//    · et MISDANNET kendt felt kasserer HELE objektet (fail closed).
//      Et halvt faktasaet i fortolkAvailability er vaerre end intet:
//      det ville ligne "kilden sagde intet" om praecis de felter, der
//      var i stykker.
//    · ukendte noegler ignoreres (fremadkompatibilitet), men registreres
//      og advares ÉN gang pr. noeglenavn — samme moenster som
//      `ukendteTyper` i adapterne. En tastefejl som `rentalAvailbleNow`
//      maa ikke vaelte objektet, men skal kunne opdages.
// ═══════════════════════════════════════════════════════════════

import type { AvailabilityFacts } from './adapter'
import { isoDato } from './dato'

const KENDTE = new Set([
  'rawStatus', 'sourceAvailabilityDate', 'takeoverText', 'rentalAvailableNow',
  'rawApplicationType', 'upcomingProject', 'interestListId', 'deadlineDays',
  'residencyRequired',
])

/** Advar én gang pr. ukendt nøgle — opdagelse uden logspam. */
const ukendteNoegler = new Set<string>()

const erStreng = (v: unknown) => typeof v === 'string'
const erBool = (v: unknown) => typeof v === 'boolean'
const erTal = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/**
 * unknown → AvailabilityFacts eller null.
 *
 * null betyder "kunne ikke laeses" — kalderen skal behandle det som
 * NULL-kolonnen: ingen facts, ingen evidens. Aarsagen logges.
 */
export function laesAvailabilityFacts(v: unknown): AvailabilityFacts | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object' || Array.isArray(v)) {
    console.error(`[fakta] availability_facts er ikke et objekt: ${typeof v}`)
    return null
  }
  const o = v as Record<string, unknown>
  const ud: Record<string, unknown> = {}

  for (const [noegle, vaerdi] of Object.entries(o)) {
    if (!KENDTE.has(noegle)) {
      if (!ukendteNoegler.has(noegle)) {
        ukendteNoegler.add(noegle)
        console.warn(`[fakta] ukendt nøgle i availability_facts (ignoreres): ${noegle}`)
      }
      continue
    }
    // Eksplicit null bevares som null — det er en del af snapshottet.
    if (vaerdi === null) { ud[noegle] = null; continue }

    let ok: boolean
    switch (noegle) {
      case 'sourceAvailabilityDate': {
        const d = isoDato(vaerdi)
        if (d === null) { ok = false; break }
        ud[noegle] = d; ok = true; break
      }
      case 'rentalAvailableNow':
      case 'upcomingProject':
      case 'residencyRequired':
        ok = erBool(vaerdi); if (ok) ud[noegle] = vaerdi; break
      case 'deadlineDays':
        ok = erTal(vaerdi); if (ok) ud[noegle] = vaerdi; break
      default: // rawStatus, takeoverText, rawApplicationType, interestListId
        ok = erStreng(vaerdi); if (ok) ud[noegle] = vaerdi; break
    }
    if (!ok) {
      console.error(`[fakta] misdannet felt i availability_facts: ${noegle} = ${JSON.stringify(vaerdi)} — hele objektet kasseres`)
      return null
    }
  }
  return ud as AvailabilityFacts
}
