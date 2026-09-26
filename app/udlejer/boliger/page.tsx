import { redirect } from 'next/navigation'
import { hentUdlejer } from '../../../lib/auth'
import { mineBoliger } from '../../../lib/udlejer'
import { fjern, genudgiv, logUd } from '../handlinger'
import { kr } from '../../Boligkort'
import { forklaring } from './forklaring'

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
            const f = synlig.slags === 'dublet' ? forklaring(b, synlig.af) : null
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
                {synlig.slags === 'dublet' && f && (
                  <div className="synlighed">
                    <p>
                      <strong>Vises ikke i søgningen.</strong> Vi har fundet
                      en anden annonce for den samme bolig og viser den i
                      stedet: <a href={`/bolig/${synlig.af.id}`}>{synlig.af.adresse}</a>
                      {/* Er vinderen selv en udlejerannonce, er «hos Bofinda»
                          maerkeligt for en, der staar paa Bofinda. Samme felt
                          som forklaringen — ikke en kopi af praedikatet. */}
                      {synlig.af.udlejerannonce
                        ? ' — en anden annonce her på Bofinda.'
                        : <>{' '}hos {synlig.af.kilde}.</>}
                    </p>
                    <p className="note">
                      Den blev valgt, fordi {f.grund}. {f.slutning}
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
