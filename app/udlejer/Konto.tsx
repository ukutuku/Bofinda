'use client'

// ═══════════════════════════════════════════════════════════════
//  Kontoformularen. ÉN formular, to sammenhænge.
//
//  Den står både på /udlejer og på /min-side. Før kendte den ikke
//  forskellen: `login()` sendte alle til udlejersiden, og opret-teksten
//  talte om annoncer til en, der ledte efter en bolig. Konteksten bindes
//  nu på serveren med `.bind`, så destinationen ikke kommer fra et
//  skjult felt — og bordet i lib/kontovej.ts er stadig det eneste, der
//  afgør, hvor forløbet ender.
// ═══════════════════════════════════════════════════════════════

import Link from 'next/link'
import { useActionState } from 'react'
import { K_PARAM, type Kontekst } from '../../lib/kontovej'
import { login, tilmeld, type Svar } from './handlinger'

const tom: Svar = {}

/** Teksten, der skal passe til den, der læser den. */
const TEKST: Record<Kontekst, { hvorfor: string }> = {
  bolig: {
    hvorfor: 'Boligbeskeden kræver kun en mailadresse. En konto er til det, der skal '
      + 'kunne findes igen: dine gemte boliger og søgninger følger med på telefonen '
      + 'og på computeren.',
  },
  udlejer: {
    hvorfor: 'Modsat boligbeskeden, hvor mailen er nok, kræver en annonce en konto '
      + 'med adgangskode. Den skal kunne rettes og fjernes igen — og kun af dig.',
  },
}

export function Konto({ kontekst, linkfejl = false, nulstillet = false }: {
  kontekst: Kontekst
  /** Bekræftelseslinket kunne ikke veksles. Se app/auth/callback/route.ts. */
  linkfejl?: boolean
  /**
   * Hun kommer lige fra «Vælg ny adgangskode».
   *
   * Kvitteringen staar HER og ikke paa nulstillingssiden, fordi
   * `gemNyKode` lukker sessionen og sender hende herhen — og en
   * bekraeftelse, hun ikke kan se, er ingen bekraeftelse.
   */
  nulstillet?: boolean
}) {
  const [ind, indAction, indVenter] = useActionState(login.bind(null, kontekst), tom)
  const [ny, nyAction, nyVenter] = useActionState(tilmeld.bind(null, kontekst), tom)

  return (
    <>
      {/* Én besked for fire årsager, brugeren ikke kan skelne: ugyldig,
          udløbet, allerede brugt, eller åbnet i en anden browser. Vi
          påstår ikke at vide hvilken — men hver vej videre står der. */}
      {linkfejl && (
        <div className="blok kontofejl" role="status">
          <p><strong>Linket virkede ikke.</strong></p>
          <p>
            Bekræftelseslinks kan kun bruges én gang, og de udløber. Er din konto
            allerede bekræftet, så log ind herunder. Ellers kan du udfylde
            «Opret konto» igen med den samme mailadresse — så sender vi et nyt link.
          </p>
        </div>
      )}

      {nulstillet && (
        <div className="blok kontook" role="status">
          <p><strong>Din adgangskode er skiftet.</strong></p>
          <p>
            Vi har logget dig ud overalt. Log ind herunder med den nye adgangskode.
          </p>
        </div>
      )}

      <div className="kontogitter">
        <form className="blok kontoform" action={indAction}>
          <h2>Log ind</h2>
          <label htmlFor="ind-mail">Mailadresse</label>
          <input id="ind-mail" name="mail" type="email" required autoComplete="email" />
          <label htmlFor="ind-kode">Adgangskode</label>
          <input id="ind-kode" name="kode" type="password" required autoComplete="current-password" />
          {ind?.fejl && <p className="formfejl">{ind.fejl}</p>}
          <button type="submit" disabled={indVenter}>{indVenter ? 'Logger ind …' : 'Log ind'}</button>
          {/* Konteksten foelger med, saa hun efter nulstillingen lander
              dér, hvor hun kom fra — ikke paa den anden kontos side. */}
          <p className="note kontoglemt">
            <Link href={`/glemt?${K_PARAM}=${kontekst}`}>Glemt adgangskode?</Link>
          </p>
        </form>

        <form className="blok kontoform" action={nyAction}>
          <h2>Opret konto</h2>
          <p className="note">{TEKST[kontekst].hvorfor}</p>
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
    </>
  )
}
