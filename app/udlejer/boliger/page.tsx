import { redirect } from 'next/navigation'
import { hentUdlejer } from '../../../lib/auth'
import { mineBoliger } from '../../../lib/udlejer'
import { fjern, genudgiv, logUd } from '../handlinger'
import { kr } from '../../Boligkort'
import type { Repraesentant } from '../../../lib/soeg'

/**
 * Hvorfor vandt den anden annonce repraesentantvalget?
 *
 * Rangeringen i `ikkeRepraesentant` er billedantal, saa om totalen er
 * kendt, saa id'et. Vi siger kun den grund, der faktisk afgjorde det —
 * "flere billeder" om to annoncer med lige mange ville vaere en paastand,
 * vi ikke kan staa inde for.
 */
function grunden(min: { billeder: number; total: number | null }, af: Repraesentant): string {
  if (af.billeder > min.billeder)
    return `den viser flere billeder — ${af.billeder} mod dine ${min.billeder}`
  if (af.harTotal && min.total == null)
    return 'den oplyser en samlet månedlig udgift, og det gør din ikke'
  return 'de to står lige på billeder og oplysninger, og valget faldt på den anden'
}

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mine annoncer — Bofinda', robots: { index: false } }

export default async function Side() {
  const u = await hentUdlejer()
  if (!u) redirect('/udlejer')
  const boliger = await mineBoliger(u)

  return (
    <div className="udlejer">
      <div className="udlejerhoved">
        <div>
          <h1>Mine annoncer</h1>
          <p className="sted">{u.email}</p>
        </div>
        <div className="udlejerknapper">
          <a className="knap" href="/udlejer/opret">Opret annonce</a>
          <form action={logUd}><button className="nulstil" type="submit">Log ud</button></form>
        </div>
      </div>

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
                      {' '}hos {synlig.af.kilde}.
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
