import { notFound } from 'next/navigation'
import { hentBolig, type BoligDetalje } from '../../../lib/soeg'
import { billedUrl } from '../../../lib/billede'
import { Galleri } from './Galleri'

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

const TYPENAVN: Record<string, string> = {
  lejlighed: 'Lejlighed', raekkehus: 'Rækkehus', hus: 'Hus',
  vaerelse: 'Værelse', studiebolig: 'Studiebolig', andet: 'Bolig',
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

  const galleri = b.billeder
    .map((x) => ({ lille: billedUrl(x.url, 800), stor: billedUrl(x.url, 1600) }))
    .filter((x): x is { lille: string; stor: string } => !!x.lille && !!x.stor)

  const acontoIalt = b.total != null && b.leje != null ? b.total - b.leje : null
  // Kilden oplyser summen, ikke fordelingen mellem depositum og forudbetalt.
  // Resten regnes ud, men praesenteres som ét tal — ikke som et gaet paa to.
  const depositumMv = b.indflytning != null && b.leje != null
    ? b.indflytning - b.leje - (acontoIalt ?? 0)
    : null

  const noegletal = [
    b.areal != null ? { v: `${b.areal}`, e: 'm²' } : null,
    b.vaerelser != null ? { v: `${b.vaerelser}`, e: b.vaerelser === 1 ? 'værelse' : 'værelser' } : null,
    b.type ? { v: TYPENAVN[b.type] ?? b.type, e: '' } : null,
  ].filter((x): x is { v: string; e: string } => !!x)

  return (
    <article className="detalje">
      <a className="tilbage" href="/">← Alle boliger</a>

      {galleri.length > 0
        ? <Galleri billeder={galleri} />
        : (
          /* Ikke "kilden har ingen billeder": for nogle boliger HAR kilden
             billeder, men skriver selv, at de kan vaere af en anden bolig,
             og saa viser vi dem ikke. Sætningen skal vaere sand i begge
             tilfaelde — se reglen om forbeholdet i CLAUDE.md. */
          <div className="ingen-billeder">Ingen billeder at vise for denne bolig.</div>
        )}

      <header className="hoved">
        <div className="hoved-tekst">
          <h1>{adresselinje(b)}</h1>
          <p className="sted">{b.postnr} {b.by}</p>
          <ul className="noegletal">
            {noegletal.map((n, i) => (
              <li key={i}><strong>{n.v}</strong>{n.e && <span> {n.e}</span>}</li>
            ))}
          </ul>
        </div>
        <div className="maerkater">
          {b.status === 'delisted' && <span className="maerkat m-vaek">ikke længere ledig</span>}
          {b.ansoegning === 'waiting_list'
            ? <span className="maerkat m-vent">Venteliste · efter anciennitet</span>
            : b.ansoegning === 'regular'
              ? <span className="maerkat m-ny">Først til mølle</span>
              : null}
        </div>
      </header>

      <div className="spalter">
        {/* ── Økonomien. Sidens vigtigste element, og derfor det første
              øjet lander på. Alt andet er understøttende. ── */}
        <aside className="oekonomi">
          <div className="oek-kort">
            {b.total != null ? (
              <>
                <div className="oek-etiket">Reel månedlig udgift</div>
                <div className="oek-tal">{kr(b.total)}<span className="enhed"> kr.</span></div>
                <ul className="oek-poster">
                  <li><span>Husleje</span><b>{kr(b.leje)}</b></li>
                  {b.varme != null && <li><span>Aconto varme</span><b>{kr(b.varme)}</b></li>}
                  {b.vand != null && <li><span>Aconto vand</span><b>{kr(b.vand)}</b></li>}
                  {b.el != null && <li><span>Aconto el</span><b>{kr(b.el)}</b></li>}
                  {b.oevrig != null && <li><span>Øvrig aconto</span><b>{kr(b.oevrig)}</b></li>}
                </ul>
                {b.el == null && (
                  <p className="oek-note">
                    {b.elEgenMaaler
                      ? 'Udlejer oplyser, at el afregnes direkte med elselskabet. Det indgår ikke i beløbet.'
                      : 'El indgår ikke i beløbet. Udlejer oplyser ikke, hvordan el afregnes — '
                        + 'i dansk udlejning har lejeren som regel sin egen måler, men spørg for en sikkerheds skyld.'}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="oek-etiket">Månedlig udgift</div>
                <div className="oek-tal ukendt-tal">
                  {kr(b.leje) ?? '—'}<span className="enhed"> kr.</span>
                </div>
                <p className="oek-etiket-under">kun husleje</p>
                <div className="oek-mangler">
                  <strong>Udlejer oplyser ikke aconto.</strong>
                  <span>Spørg om varme og vand, før du regner på det —
                    den samlede udgift kendes ikke.</span>
                </div>
              </>
            )}

            {b.indflytning != null && (
              <div className="oek-indflytning">
                <div className="oek-etiket">At betale ved indflytning</div>
                <div className="oek-tal2">{kr(b.indflytning)}<span className="enhed"> kr.</span></div>
                <ul className="oek-poster">
                  {b.leje != null && <li><span>Første måneds husleje</span><b>{kr(b.leje)}</b></li>}
                  {acontoIalt != null && acontoIalt > 0 && (
                    <li><span>Aconto</span><b>{kr(acontoIalt)}</b></li>
                  )}
                  {depositumMv != null && depositumMv > 0 && (
                    <li><span>Depositum og forudbetalt leje</span><b>{kr(depositumMv)}</b></li>
                  )}
                </ul>
                <p className="oek-note">
                  Kilden oplyser summen, ikke fordelingen mellem depositum og
                  forudbetalt leje — så den er ikke delt op her.
                </p>
              </div>
            )}

            <a className="knap" href={b.url} target="_blank" rel="noopener noreferrer">
              Se annoncen hos {b.kildeNavn}
            </a>
            <p className="oek-kilde">
              Kontaktoplysninger vises hos kilden. Annonceret{' '}
              {b.hosKilden ? siden(b.hosKilden) : 'på ukendt tidspunkt'} · set af os {siden(b.foerstSet)}.
            </p>
          </div>
        </aside>

        <div className="indhold">
          <section className="blok">
            <h2>Boligen</h2>
            <dl className="fakta2">
              {b.type && <><dt>Boligtype</dt><dd>{TYPENAVN[b.type] ?? b.type}</dd></>}
              {b.areal != null && <><dt>Areal</dt><dd>{b.areal} m²</dd></>}
              {b.vaerelser != null && <><dt>Værelser</dt><dd>{b.vaerelser}</dd></>}
              {b.etage && (
                <><dt>Etage</dt>
                  <dd>{b.etage === 'st' ? 'Stuen' : b.etage === 'kl' ? 'Kælder' : `${b.etage}.`}</dd></>
              )}
              {b.doer && <><dt>Dør</dt><dd>{b.doer}</dd></>}
              <dt>Ledig fra</dt>
              <dd>{b.ledigFra
                ? (b.ledigFra.getTime() <= Date.now() ? 'Nu' : dato(b.ledigFra))
                : <span className="mangler">ikke oplyst</span>}</dd>
              {b.aabentHus && <><dt>Åbent hus</dt><dd>{dato(b.aabentHus)}</dd></>}
              <dt>Kilde</dt><dd>{b.kildeNavn}</dd>
            </dl>
          </section>

          {b.faciliteter && b.faciliteter.length > 0 && (
            <section className="blok">
              <h2>Faciliteter</h2>
              <ul className="chips">{b.faciliteter.map((f) => <li key={f}>{f}</li>)}</ul>
            </section>
          )}

          {b.beskrivelse && (
            <section className="blok">
              <h2>Beskrivelse</h2>
              <p className="brodtekst">{b.beskrivelse}</p>
              <p className="note">
                Teksten er skrevet ud fra boligens oplysninger — ikke kopieret fra kilden.
              </p>
            </section>
          )}

          <section className="blok">
            <h2>Beliggenhed</h2>
            {b.lat && b.lng ? (
              <>
                <iframe
                  className="landkort" loading="lazy" title="Kort"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                    Number(b.lng) - 0.006},${Number(b.lat) - 0.003},${
                    Number(b.lng) + 0.006},${Number(b.lat) + 0.003}&layer=mapnik&marker=${b.lat},${b.lng}`}
                />
                <p className="note">
                  {b.match === 'unit'
                    ? 'Adressen er stedfæstet på den enkelte bolig.'
                    : 'Adressen er stedfæstet på opgangen — kilden oplyser ikke etage og dør.'}
                </p>
              </>
            ) : (
              <p className="mangler">Kilden oplyser ingen koordinater.</p>
            )}
          </section>
        </div>
      </div>
    </article>
  )
}
