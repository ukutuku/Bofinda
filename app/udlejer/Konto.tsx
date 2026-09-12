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
import { K_PARAM, type Kontekst, type Kvittering } from '../../lib/kontovej'
import { Kvitteringsblok } from './Kvitteringsblok'
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

export function Konto({ kontekst, linkfejl = false, kvittering = null }: {
  kontekst: Kontekst
  /** Bekræftelseslinket kunne ikke veksles. Se app/auth/callback/route.ts. */
  linkfejl?: boolean
  /**
   * Hvad `gemNyKode` faktisk nåede at gøre — læst af en cookie, SERVEREN
   * satte, aldrig af adressen.
   *
   * Kvitteringen står ikke på nulstillingssiden, fordi `gemNyKode`
   * lukker sessionen og sender hende videre — og en bekræftelse, hun
   * ikke kan se, er ingen bekræftelse. Af nøjagtig samme grund står den
   * ikke KUN her: fejler udlogningen, er hun stadig logget ind og ser
   * aldrig denne formular. Så gengiver hendes eget område blokken.
   */
  kvittering?: Kvittering | null
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

      {/* Teksten ligger i Kvitteringsblok, ikke her. Den skal staa PRAECIS
          det samme sted paa hendes eget omraade, naar udlogningen fejlede
          og hun derfor stadig er logget ind — og to kopier af den samme
          besked driver fra hinanden. Her er visningen «udlogget», fordi
          formularen staar lige nedenfor. */}
      <Kvitteringsblok kvittering={kvittering} visning="udlogget" />

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
