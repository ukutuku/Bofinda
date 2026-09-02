'use client'

import { useActionState } from 'react'
import { login, tilmeld, type Svar } from './handlinger'

const tom: Svar = {}

export function Konto() {
  const [ind, indAction, indVenter] = useActionState(login, tom)
  const [ny, nyAction, nyVenter] = useActionState(tilmeld, tom)

  return (
    <div className="kontogitter">
      <form className="blok kontoform" action={indAction}>
        <h2>Log ind</h2>
        <label htmlFor="ind-mail">Mailadresse</label>
        <input id="ind-mail" name="mail" type="email" required autoComplete="email" />
        <label htmlFor="ind-kode">Adgangskode</label>
        <input id="ind-kode" name="kode" type="password" required autoComplete="current-password" />
        {ind?.fejl && <p className="formfejl">{ind.fejl}</p>}
        <button type="submit" disabled={indVenter}>{indVenter ? 'Logger ind …' : 'Log ind'}</button>
      </form>

      <form className="blok kontoform" action={nyAction}>
        <h2>Opret konto</h2>
        <p className="note">
          Modsat boligbeskeden, hvor mailen er nok, kræver en annonce en konto
          med adgangskode. Den skal kunne rettes og fjernes igen — og kun af dig.
        </p>
        <label htmlFor="ny-mail">Mailadresse</label>
        <input id="ny-mail" name="mail" type="email" required autoComplete="email" />
        <label htmlFor="ny-kode">Adgangskode</label>
        <input
          id="ny-kode" name="kode" type="password" required minLength={10}
          autoComplete="new-password" aria-describedby="kodekrav"
        />
        <p id="kodekrav" className="note">Mindst 10 tegn. Længde slår krøllede tegn.</p>
        {ny?.fejl && <p className="formfejl">{ny.fejl}</p>}
        {ny?.besked && <p className="formok">{ny.besked}</p>}
        <button type="submit" disabled={nyVenter}>{nyVenter ? 'Opretter …' : 'Opret konto'}</button>
      </form>
    </div>
  )
}
