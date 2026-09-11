'use client'

// ═══════════════════════════════════════════════════════════════
//  «Vælg ny adgangskode» — selve formularen.
//
//  Der er INTET skjult felt med mailadresse eller bruger-id. Hvem
//  koden skiftes for, afgøres af sessionen på serveren; se
//  `gemNyKode` i app/udlejer/handlinger.ts.
//
//  Der er heller ingen «det lykkedes»-tilstand her: lykkes den,
//  omdirigerer serveren til log ind med en kvittering. En besked i
//  denne komponent ville kunne staa paa skaermen, uden at Supabase
//  havde godtaget noget.
// ═══════════════════════════════════════════════════════════════

import { useActionState } from 'react'
import { KODEKRAV, MINDST_TEGN } from '../../lib/adgangskode'
import type { Kontekst } from '../../lib/kontovej'
import { gemNyKode, type Svar } from '../udlejer/handlinger'

const tom: Svar = {}

export function NyKode({ kontekst }: { kontekst: Kontekst }) {
  const [svar, action, venter] = useActionState(gemNyKode.bind(null, kontekst), tom)

  return (
    <div className="kontoenkelt">
      <form className="blok kontoform" action={action}>
        <h2>Vælg ny adgangskode</h2>
        <p className="note">
          Når du har gemt, logger vi dig ud, så du kan logge ind med den nye
          adgangskode. Det gælder også på dine andre enheder.
        </p>

        <label htmlFor="nulstil-kode">Ny adgangskode</label>
        {/* `minLength` er en hjaelp i browseren. Kravet haandhaeves paa
            serveren med tjekAdgangskode() — begge laeser MINDST_TEGN. */}
        <input
          id="nulstil-kode" name="kode" type="password" required
          minLength={MINDST_TEGN} autoComplete="new-password"
          aria-describedby="nulstil-krav" autoFocus
        />
        <p id="nulstil-krav" className="note">{KODEKRAV}</p>

        <label htmlFor="nulstil-gentag">Gentag den nye adgangskode</label>
        <input
          id="nulstil-gentag" name="gentag" type="password" required
          minLength={MINDST_TEGN} autoComplete="new-password"
        />

        {svar?.fejl && <p className="formfejl">{svar.fejl}</p>}

        <button type="submit" disabled={venter}>
          {venter ? 'Gemmer …' : 'Gem ny adgangskode'}
        </button>
      </form>
    </div>
  )
}
