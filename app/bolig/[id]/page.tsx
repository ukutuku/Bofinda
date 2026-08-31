import { notFound } from 'next/navigation'
import { hentBolig, type BoligDetalje } from '../../../lib/soeg'
import { billedUrl } from '../../../lib/billede'

export const dynamic = 'force-dynamic'

// ─── Formatering ───────────────────────────────────────────────

const kr = (o: number | null) =>
  o == null ? null : (o / 100).toLocaleString('da-DK', { maximumFractionDigits: 2 })

const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december']

const dato = (d: Date | null) =>
  d ? `${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}` : null

function siden(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 60) return `${min} min. siden`
  const t = Math.round(min / 60)
  if (t < 24) return `${t} ${t === 1 ? 'time' : 'timer'} siden`
  const dg = Math.round(t / 24)
  if (dg < 31) return `${dg} ${dg === 1 ? 'dag' : 'dage'} siden`
  const m = Math.round(dg / 30)
  return `${m} ${m === 1 ? 'måned' : 'måneder'} siden`
}

const POSTNAVN: Record<string, string> = {
  rent: 'husleje', heat: 'varme', water: 'vand',
  electricity: 'el', other: 'øvrig aconto',
}

function adresselinje(b: BoligDetalje): string {
  const vej = [b.vej, b.husnr].filter(Boolean).join(' ')
  let etage: string | null = null
  if (b.etage === 'st') etage = 'st.'
  else if (b.etage === 'kl') etage = 'kælder'
  else if (b.etage) etage = b.doer ? `${b.etage}.` : `${b.etage}. sal`
  return [vej, [etage, b.doer].filter(Boolean).join(' ')].filter(Boolean).join(', ') || b.adresse
}

// ─── Siden ─────────────────────────────────────────────────────

export default async function Side({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await hentBolig(id)
  if (!b) notFound()

  const aconto = (b.poster ?? []).filter((p) => p !== 'rent')
  const galleri = b.billeder.map((x) => ({
    lille: billedUrl(x.url, 400),
    stor: billedUrl(x.url, 1600),
  })).filter((x) => x.lille)

  // Indflytningsprisen vises med sine led, saa tallet kan efterproeves.
  // Vi kender ikke kildens fordeling paa depositum og forudbetalt, kun
  // summen — og saa siger vi det i stedet for at gaette en opdeling.
  const restIndflytning =
    b.indflytning != null && b.leje != null ? b.indflytning - b.leje - (b.total != null ? b.total - b.leje : 0) : null

  return (
    <article className="detalje">
      <a className="tilbage" href="/">← Alle boliger</a>

      {galleri.length > 0 ? (
        <div className={`galleri g${Math.min(galleri.length, 5)}`}>
          {galleri.slice(0, 5).map((g, i) => (
            <a key={i} href={g.stor!} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.lille!} alt="" loading={i === 0 ? 'eager' : 'lazy'} />
            </a>
          ))}
          {galleri.length > 5 && (
            <div className="flere">+{galleri.length - 5} billeder</div>
          )}
        </div>
      ) : (
        <div className="ingen-billeder">Kilden har ingen billeder af denne bolig.</div>
      )}

      <header className="hoved">
        <div>
          <h1>{adresselinje(b)}</h1>
          <div className="sted">{b.postnr} {b.by}</div>
        </div>
        <div className="maerkater">
          {b.status === 'delisted' && <span className="maerkat m-vent">ikke længere ledig</span>}
          {b.ansoegning === 'waiting_list'
            ? <span className="maerkat m-vent">venteliste — efter anciennitet</span>
            : b.ansoegning === 'regular'
              ? <span className="maerkat m-ny">først til mølle</span>
              : null}
          <span className="maerkat m-kilde">{b.kildeNavn}</span>
        </div>
      </header>

      <section className="blok">
        <h2>Boligen</h2>
        <dl className="fakta2">
          {b.type && <><dt>Boligtype</dt><dd>{b.type === 'raekkehus' ? 'rækkehus' : b.type}</dd></>}
          {b.areal != null && <><dt>Areal</dt><dd>{b.areal} m²</dd></>}
          {b.vaerelser != null && <><dt>Værelser</dt><dd>{b.vaerelser}</dd></>}
          {b.etage && <><dt>Etage</dt><dd>{b.etage === 'st' ? 'stuen' : b.etage === 'kl' ? 'kælder' : `${b.etage}.`}</dd></>}
          {b.doer && <><dt>Dør</dt><dd>{b.doer}</dd></>}
          <dt>Ledig fra</dt>
          <dd>{b.ledigFra
            ? (b.ledigFra.getTime() <= Date.now() ? 'nu' : dato(b.ledigFra))
            : <span className="mangler">ikke oplyst</span>}</dd>
          {b.aabentHus && <><dt>Åbent hus</dt><dd>{dato(b.aabentHus)}</dd></>}
        </dl>
      </section>

      <section className="blok">
        <h2>Økonomi</h2>
        <table className="oek">
          <tbody>
            <tr>
              <th>Husleje</th>
              <td>{kr(b.leje) ?? <span className="mangler">ikke oplyst</span>}{b.leje != null && ' kr.'}</td>
            </tr>
            {b.varme != null && <tr><th>Aconto varme</th><td>{kr(b.varme)} kr.</td></tr>}
            {b.vand != null && <tr><th>Aconto vand</th><td>{kr(b.vand)} kr.</td></tr>}
            {b.el != null && <tr><th>Aconto el</th><td>{kr(b.el)} kr.</td></tr>}
            {b.oevrig != null && <tr><th>Øvrig aconto</th><td>{kr(b.oevrig)} kr.</td></tr>}
            {b.total != null ? (
              <tr className="sum">
                <th>Samlet pr. måned</th>
                <td>{kr(b.total)} kr.</td>
              </tr>
            ) : (
              <tr><td colSpan={2}>
                <p className="advarsel">
                  Udlejer oplyser ikke aconto — spørg om varme og vand.
                  Den samlede månedlige udgift kendes ikke.
                </p>
              </td></tr>
            )}
          </tbody>
        </table>

        {b.total != null && (
          <p className="note">
            Beregnet som {['husleje', ...aconto.map((p) => POSTNAVN[p] ?? p)].join(' + ')}.
            {b.el == null && ' El afregnes direkte med elselskabet og indgår ikke.'}
          </p>
        )}

        {b.indflytning != null && (
          <div className="indflytning">
            <div className="ibeloeb">{kr(b.indflytning)} kr. <small>at betale ved indflytning</small></div>
            <p className="note">
              {b.leje != null && restIndflytning != null && restIndflytning > 0 ? (
                <>Første måneds husleje {kr(b.leje)} kr.
                  {b.total != null && b.total > b.leje && <> plus aconto {kr(b.total - b.leje)} kr.</>}
                  {' '}plus depositum og forudbetalt leje {kr(restIndflytning)} kr.
                  {' '}Kilden oplyser summen, ikke fordelingen mellem depositum og
                  forudbetalt — så den er ikke delt op her.</>
              ) : (
                <>Beløbet er kildens eget. Fordelingen mellem første måneds leje,
                  depositum og forudbetalt leje er ikke oplyst.</>
              )}
            </p>
          </div>
        )}
      </section>

      {b.faciliteter && b.faciliteter.length > 0 && (
        <section className="blok">
          <h2>Faciliteter</h2>
          <ul className="chips">
            {b.faciliteter.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}

      {b.beskrivelse && (
        <section className="blok">
          <h2>Beskrivelse</h2>
          <p className="brodtekst">{b.beskrivelse}</p>
          <p className="note">
            Teksten er skrevet af os ud fra boligens oplysninger — ikke kopieret fra kilden.
          </p>
        </section>
      )}

      <section className="blok">
        <h2>Beliggenhed</h2>
        {b.lat && b.lng ? (
          <>
            <iframe
              className="kort"
              loading="lazy"
              title="Kort"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                Number(b.lng) - 0.006},${Number(b.lat) - 0.003},${
                Number(b.lng) + 0.006},${Number(b.lat) + 0.003}&layer=mapnik&marker=${b.lat},${b.lng}`}
            />
            <p className="note">
              {b.match === 'unit'
                ? 'Adressen er stedfæstet på den enkelte bolig.'
                : 'Adressen er stedfæstet på opgangen — kilden oplyser ikke etage og dør.'}
              {' '}Koordinater {Number(b.lat).toFixed(5)}, {Number(b.lng).toFixed(5)} fra kilden.
            </p>
          </>
        ) : (
          <p className="mangler">Kilden oplyser ingen koordinater.</p>
        )}
      </section>

      <section className="blok kontakt">
        <h2>Kontakt udlejer</h2>
        <p className="skjult">
          Kontaktoplysninger vises ikke her. Boligen er hentet fra {b.kildeNavn},
          og henvendelsen skal ske hos dem.
        </p>
        <a className="knap" href={b.url} target="_blank" rel="noopener noreferrer">
          Åbn annoncen hos {b.kildeNavn} →
        </a>
        <p className="note">
          Annonceret hos kilden {b.hosKilden ? siden(b.hosKilden) : 'på ukendt tidspunkt'}
          {' · '}set af os {siden(b.foerstSet)}
        </p>
      </section>
    </article>
  )
}
