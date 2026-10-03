'use client'

// ═══════════════════════════════════════════════════════════════
//  «Glemt adgangskode» — anmodningen.
//
//  Formularen spørger om ÉN ting og lover ingenting. Svaret er det
//  samme, uanset om adressen har en konto; se `GENDAN_SENDT` i
//  app/udlejer/handlinger.ts for hvorfor.
// ═══════════════════════════════════════════════════════════════

import { useActionState } from 'react'
import type { Kontekst } from '../../lib/kontovej'
import { anmodGendannelse, type Svar } from '../udlejer/handlinger'

const tom: Svar = {}

export function Glemt({ kontekst, linkfejl = false }: {
  kontekst: Kontekst
  /** Callbacken kunne ikke veksle gendannelseslinket. Hun skal bede om et nyt. */
  linkfejl?: boolean
}) {
  // Konteksten bindes paa serveren, praecis som i Konto.tsx: den vaelger
  // en destination, ikke en rettighed, og skal ikke kunne rettes i et
  // skjult felt.
  const [svar, action, venter] = useActionState(
    anmodGendannelse.bind(null, kontekst), tom,
  )

  return (
    <>
      {linkfejl && (
        <div className="blok kontofejl" role="status">
          <p><strong>Linket virkede ikke.</strong></p>
          <p>
            Gendannelseslinks kan kun bruges én gang, og de udløber efter kort tid.
            Åbnede du mailen i en anden browser end den, du bad om linket fra, virker
            det heller ikke. Bed om et nyt herunder.
          </p>
        </div>
      )}

      <div className="kontoenkelt">
        <form className="blok kontoform" action={action}>
          <h2>Glemt adgangskode</h2>
          <p className="note">
            Skriv den mailadresse, kontoen er oprettet med. Så sender vi et link,
            du kan vælge en ny adgangskode med.
          </p>

          <label htmlFor="glemt-mail">Mailadresse</label>
          <input
            id="glemt-mail" name="mail" type="email" required
            autoComplete="email" autoFocus
          />

          {svar?.fejl && <p className="formfejl">{svar.fejl}</p>}
          {svar?.besked && <p className="formok">{svar.besked}</p>}

          <button type="submit" disabled={venter}>
            {venter ? 'Sender …' : 'Send link'}
          </button>
        </form>
      </div>
    </>
  )
}
