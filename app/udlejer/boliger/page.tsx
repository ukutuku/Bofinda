import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { hentUdlejer } from '../../../lib/auth'
import { mineBoliger } from '../../../lib/udlejer'
import { KVITTERINGSCOOKIE, kvitteringFra } from '../../../lib/kontovej'
import { fjern, genudgiv, logUd } from '../handlinger'
import { Kvitteringsblok } from '../Kvitteringsblok'
import { kr } from '../../Boligkort'
import { erEgenAnnonce } from '../../../lib/kilde'
import type { Repraesentant } from '../../../lib/soeg'

/**
 * Hvorfor vandt den anden annonce repraesentantvalget?
 *
 * Raekkefoelgen her SKAL svare til `ikkeRepraesentant` i lib/soeg.ts:
 * billedantal → kendt total → laveste total → id. Vi siger kun den
 * grund, der faktisk afgjorde det — «flere billeder» om to annoncer med
 * lige mange ville vaere en paastand, vi ikke kan staa inde for.
 *
 * ⚠ TRIN 3 KOM TIL EFTER RANGERINGEN. Da «laveste total» blev indfoert,
 * stod den her funktion tilbage med tre grene: flere billeder, kendt
 * total, eller «de to staar lige». Den sidste ville saa vaere USAND i
 * netop de tilfaelde, det nye trin afgjorde — de staar ikke lige, den
 * anden er billigere. En rangering og forklaringen paa den er to udtryk
 * for samme spoergsmaal, og de skal aendres sammen.
 */
function grunden(min: { billeder: number; total: number | null }, af: Repraesentant): string {
  if (af.billeder > min.billeder)
    return `den viser flere billeder — ${af.billeder} mod dine ${min.billeder}`
  if (af.harTotal && min.total == null)
    return 'den oplyser en samlet månedlig udgift, og det gør din ikke'
  if (af.total != null && min.total != null && af.total < min.total)
    return `den er billigere i alt — ${kr(af.total)} mod dine ${kr(min.total)} kr/md`
  return 'de to står lige på billeder og oplysninger, og valget faldt på den anden'
}

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mine annoncer — Bofinda', robots: { index: false } }

export default async function Side() {
  const u = await hentUdlejer()
  if (!u) redirect('/udlejer')
  const boliger = await mineBoliger(u)

  // ── Kvitteringen efter en gendannelse ──────────────────────────
  //
  // Den staar HER og ikke paa /udlejer, fordi /udlejer sender en
  // indlogget udlejer videre hertil, FOER cookien overhovedet laeses.
  // Fejler udlogningen i `gemNyKode`, er hun netop stadig logget ind —
  // saa er denne side den eneste, hun faktisk ser, og uden blokken
  // landede hun paa Mine annoncer uden et ord om, at koden var skiftet.
  //
  // Laesningen ligger EFTER `hentUdlejer()`: adgangen afgoeres af
  // sessionen som foer, og cookien tilfoejer kun en besked. En
  // haandskrevet kvittering giver derfor ingen adgang — den redirect,
  // der staar ovenfor, sker uanset hvad der staar i den.
  const kvittering = kvitteringFra((await cookies()).get(KVITTERINGSCOOKIE)?.value)

  return (
    <div className="udlejer">
      <div className="udlejerhoved">
        <div>
          <h1>Mine annoncer</h1>
          <p className="sted">{u.email}</p>
        </div>
        <div className="udlejerknapper">
          <a className="knap" href="/udlejer/opret">Opret annonce</a>
          <form action={logUd.bind(null, 'udlejer')}><button className="nulstil" type="submit">Log ud</button></form>
        </div>
      </div>

      <Kvitteringsblok kvittering={kvittering} visning="indlogget" kontekst="udlejer" />

      {boliger.length === 0 ? (
        <div className="tom">
          <p>Du har ingen annoncer endnu.</p>
          <p><a href="/udlejer/opret">Opret den første →</a></p>
        </div>
      ) : (
        <div className="liste">
          {boliger.map((b) => {
            const synlig = b.synlighed
            return (
            <div key={b.id} className="kort udlejerkort">
              <div className="kort-krop">
                <div className="raek1">
                  <div>
                    <div className="adresse">{b.adresse}</div>
                    <div className="sted">{b.postnr} {b.by}</div>
                  </div>
                  <div className="hoejre">
                    <span className={`maerkat ${
                      synlig.slags === 'udgivet' ? 'm-ny'
                      : synlig.slags === 'fjernet' ? 'm-vaek' : 'm-vent'}`}>
                      {synlig.slags === 'udgivet' ? 'udgivet'
                       : synlig.slags === 'fjernet' ? 'fjernet' : 'vises ikke'}
                    </span>
                  </div>
                </div>
                <div className="fakta">
                  {b.areal != null && <span><b>{b.areal}</b> m² · </span>}
                  {b.vaerelser != null && <span><b>{b.vaerelser}</b> værelser · </span>}
                  <span>{kr(b.total ?? b.leje)} kr/md {b.total != null ? 'til udlejer' : 'i husleje'}</span>
                </div>
                {synlig.slags === 'dublet' && (
                  <div className="synlighed">
                    <p>
                      <strong>Vises ikke i søgningen.</strong> Vi har fundet
                      en anden annonce for den samme bolig og viser den i
                      stedet: <a href={`/bolig/${synlig.af.id}`}>{synlig.af.adresse}</a>
                      {/* «hos udlejeren selv», ikke «hos Bofinda»: den
                          vindende annonce er heller ikke hentet nogen
                          steder. Samme spørgsmål som kortets mærkat,
                          men midt i en sætning — se lib/kilde.ts. */}
                      {' '}hos {erEgenAnnonce(synlig.af) ? 'udlejeren selv' : synlig.af.kildeNavn}.
                    </p>
                    <p className="note">
                      Den blev valgt, fordi {grunden(b, synlig.af)}. Din annonce
                      er ikke fjernet — den kan stadig åbnes på sit eget link,
                      og du kan rette den.
                    </p>
                  </div>
                )}
                {synlig.slags === 'uden-adresse' && (
                  <div className="synlighed">
                    <p>
                      <strong>Vises ikke i søgningen.</strong> Adressen kunne
                      ikke stedfæstes, så vi ved ikke hvor boligen ligger.
                    </p>
                    <p className="note">Ret adressen under Redigér, så kommer den med.</p>
                  </div>
                )}
                <div className="udlejerhandlinger">
                  <a href={`/bolig/${b.id}`}>Se annoncen</a>
                  <a href={`/udlejer/boliger/${b.id}`}>Redigér</a>
                  {b.status === 'active' ? (
                    <form action={fjern}>
                      <input type="hidden" name="id" value={b.id} />
                      <button type="submit" className="fjernknap">Fjern</button>
                    </form>
                  ) : (
                    <form action={genudgiv}>
                      <input type="hidden" name="id" value={b.id} />
                      <button type="submit" className="fjernknap">Udgiv igen</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
