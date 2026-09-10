import { notFound } from 'next/navigation'
import { availabilityFor, hentBolig, kvadratmeterpris, type BoligDetalje } from '../../../lib/soeg'
import { forklar } from '../../../lib/availability'
import { billedUrl } from '../../../lib/billede'
import { eltilstand } from '../../../lib/eloplysning'
import { Galleri } from './Galleri'
import { Kontakt } from './Kontakt'
import { Maaling } from '../../Maaling'
import { maalingstilstand, spor } from '../../../lib/maaling-server'

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

const MDR_ISO = ['januar','februar','marts','april','maj','juni',
  'juli','august','september','oktober','november','december']
const datoIso = (iso: string) => {
  const [aar, md, dag] = iso.split('-').map(Number)
  return `${dag}. ${MDR_ISO[md! - 1]} ${aar}`
}

export default async function Side({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await hentBolig(id)
  // ReferenceNow: ét eksplicit nu pr. request. Availability kommer fra
  // DOMÆNET — aldrig fra legacy ledigFra/ansoegning.
  const nu = new Date()
  const avail = b ? availabilityFor(b, nu) : null
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

  // ── Prissammenligning ────────────────────────────────────────
  // Kun med kendt total OG areal: ellers sammenligner vi to forskellige
  // slags tal. Og kun hvor der er nok boliger bag medianen — se
  // MINDST_TIL_SAMMENLIGNING.
  const kvm = b.total != null && b.areal != null && b.areal > 0 && b.postnr
    ? await kvadratmeterpris(b.postnr)
    : null
  const egenKvm = kvm && b.total != null && b.areal ? b.total / b.areal : null
  const afvigelse = kvm && egenKvm != null
    ? Math.round((egenKvm / kvm.median - 1) * 100)
    : null

  // ── Måling ───────────────────────────────────────────────────
  // Én request, én visning: siden er force-dynamic, saa der er ingen
  // cache, der kan skjule den, og ingen re-render at dobbelttaelle.
  // Adressen, kontaktfelterne og kildens URL kommer ALDRIG med — kun
  // id'et, som i forvejen staar i adressefeltet.
  const mt = await maalingstilstand()
  await spor({
    navn: 'listing_view',
    listingId: b.id,
    sourceSlug: b.kilde,
    props: {
      ...(b.postnr ? { postnr: b.postnr } : {}),
      ...(b.type ? { property_type: b.type } : {}),
      timing_status: avail!.timing.status,
      ansoegning_status: avail!.ansoegning.status,
      marked_status: avail!.marked.status,
      egen_annonce: b.egenAnnonce,
      total_kendt: b.total != null,
      antal_billeder: galleri.length,
    },
  }, '/bolig/[id]')

  /**
   * Noegletals-strippen.
   *
   * Kun felter, KILDEN har oplyst. En post uden vaerdi udelades — der
   * skrives aldrig «—» eller «ikke oplyst» her: strippen er et overblik,
   * og det, vi ikke ved, staar i «Boligen» nedenfor, hvor der er plads
   * til at sige hvorfor. Konceptbilledet viser fem faste felter; vi viser
   * dem, der findes, og laver ikke resten om til tomme kasser.
   *
   * `ikon` peger paa en CSS-maske i globals.css — ingen ikonpakke, ingen
   * nye filer, ingen netvaerkskald.
   */
  const noegletal = [
    b.total != null
      ? { ikon: 'moent', v: `${kr(b.total)} kr.`, e: 'pr. md. til udlejer' }
      : b.leje != null ? { ikon: 'moent', v: `${kr(b.leje)} kr.`, e: 'husleje pr. md.' } : null,
    b.indflytning != null
      ? { ikon: 'moent', v: `${kr(b.indflytning)} kr.`, e: 'ved indflytning' } : null,
    b.areal != null ? { ikon: 'maal', v: `${b.areal} m²`, e: 'boligareal' } : null,
    b.vaerelser != null
      ? { ikon: 'doer', v: `${b.vaerelser}`, e: b.vaerelser === 1 ? 'værelse' : 'værelser' } : null,
    b.type ? { ikon: 'hus', v: TYPENAVN[b.type] ?? b.type, e: 'boligtype' } : null,
  ].filter((x): x is { ikon: string; v: string; e: string } => !!x)

  return (
    <article className="detalje">
      <Maaling aktiv={mt.aktiv} impressions={false} visning={null} rute="/bolig/[id]" />
      <a className="tilbage" href="/">← Alle boliger</a>

      {galleri.length > 0
        ? (
          <>
            <Galleri billeder={galleri} />
            {/* Kildens eget forbehold, givet videre. Citatet er VORES tekst
                her i koden, skrevet af efter kilden — vi gemmer ikke deres
                brødtekst, jf. noten ved `description` i db/schema.ts.
                Feltet i basen siger kun AT forbeholdet står der.

                Før blev billederne kasseret, når forbeholdet stod der. Men
                det er også en påstand: den siger implicit "der er ingen",
                og det er usandt — der er 115 på de 20 boliger. */}
            {b.billedforbehold && (
              <p className="billedforbehold">
                Udlejer oplyser: «Billederne kan være fra en anden bolig,
                hvorfor indretning, beliggenhed og udsigt kan variere.»
              </p>
            )}
          </>
        )
        : (
          /* Nu er sætningen ren: har kilden ingen billeder, står der
             ingen. Forbeholdet fjerner dem ikke længere. */
          <div className="ingen-billeder">Ingen billeder at vise for denne bolig.</div>
        )}


      {/* ── Titelbaandet ───────────────────────────────────────
          Stod foer inde i venstre spalte, altsaa NEDE ved siden af
          priskortet — sidens navn laa lavere end sidens pris. Nu ligger
          det i fuld bredde lige under galleriet, hvor man laeser det
          foerst, og noegletallene staar som en stribe under. */}
      <div className="detalje-hoved">
        <div className="maerkater">
          {b.status === 'delisted' && <span className="maerkat m-vaek">ikke længere ledig</span>}
          {avail!.ansoegning.status === 'venteliste'
            && <span className="maerkat m-vent">Venteliste · efter anciennitet</span>}
          {avail!.ansoegning.status === 'normal'
            && <span className="maerkat m-ny">Almindelig ansøgning</span>}
          {avail!.marked.status === 'reserveret'
            && <span className="maerkat m-vent">Reserveret</span>}
          {avail!.adgang.krav.includes('bopaelskrav')
            && <span className="maerkat m-kilde">Bopælspligt</span>}
        </div>
        <h1>{adresselinje(b)}</h1>
        <p className="sted">{b.postnr} {b.by}</p>
        <ul className="noegletal">
          {noegletal.map((n, i) => (
            <li key={i} className={`nt-${n.ikon}`}>
              <strong>{n.v}</strong>
              {n.e && <span>{n.e}</span>}
            </li>
          ))}
        </ul>
      </div>

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
                {/* Samme spoergsmaal som kortet stiller, besvaret ét sted.
                    Teksten er laengere her, fordi der er plads — men
                    tilstanden er den samme. */}
                {(() => {
                  const t = eltilstand(b)
                  if (t == null || t === 'med') return null
                  return (
                    <p className="oek-note">
                      {t === 'egen-maaler'
                        ? 'Udlejer oplyser, at el afregnes direkte med elselskabet. Det indgår ikke i beløbet.'
                        : t === 'ukendt-daekning'
                          ? 'Udlejeren oplyser aconto som ét samlet beløb og skriver ikke, hvad det '
                            + 'dækker. El kan være med i beløbet eller afregnes særskilt — spørg udlejeren.'
                          : 'El indgår ikke i beløbet. Udlejer oplyser ikke, hvordan el afregnes — '
                            + 'i dansk udlejning har lejeren som regel sin egen måler, men spørg for en sikkerheds skyld.'}
                    </p>
                  )
                })()}
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

            {b.egenAnnonce ? (
              /* Udlejeren har oprettet annoncen her. Der er ingen ekstern
                 kilde at sende laeseren til — knappen linkede i ring.
                 Kontaktoplysningerne findes, men muren staar foran dem:
                 de hentes ikke i query'en, saa der er intet at vise endnu. */
              <>
                {b.harKontaktMail || b.harKontaktTlf ? (
                  <Kontakt
                    id={b.id}
                    harMail={b.harKontaktMail}
                    harTelefon={b.harKontaktTlf}
                  />
                ) : (
                  /* Kan ske, hvis udlejeren har ryddet begge felter. Saa
                     siger vi det, i stedet for at lade som om der er en vej. */
                  <div className="kontaktboks">
                    <strong>Ingen kontaktoplysninger</strong>
                    <span>Udlejeren har ikke oplyst, hvordan hun kan nås.</span>
                  </div>
                )}
                <p className="oek-kilde">
                  Boligen er oprettet af udlejeren selv på Bofinda{' '}
                  {siden(b.foerstSet)}.
                </p>
              </>
            ) : (
              <>
                {/* Gaar gennem vores egen /go/[id], saa klikket kan maales
                    ogsaa uden JavaScript og uden at en adblocker kan tomme
                    tallet. Ruten slaar destinationen op i basen — den tager
                    ALDRIG en URL som parameter — og saetter
                    Referrer-Policy: no-referrer, saa kilden faar noejagtig
                    lige saa lidt at vide som foer. */}
                <a className="knap" href={`/go/${b.id}`} target="_blank" rel="noopener noreferrer">
                  Se annoncen hos {b.kildeNavn}
                </a>
                <p className="oek-kilde">
                  Kontaktoplysninger vises hos kilden. Annonceret{' '}
                  {b.hosKilden ? siden(b.hosKilden) : 'på ukendt tidspunkt'} · set af os {siden(b.foerstSet)}.
                </p>
              </>
            )}
          </div>
        </aside>

        <div className="indhold">

          {/* ── Prissammenligning ──────────────────────────────
              Ingen farveskala uden tal bag. Der staar hvad afvigelsen er,
              hvad den maales mod, og hvor mange boliger medianen er regnet
              af — saa laeseren selv kan afgoere, om tallet betyder noget. */}
          {kvm && afvigelse != null && egenKvm != null && (
            <section className="blok sammenligning">
              <h2>Pris pr. kvadratmeter</h2>
              <p className="sml-dom">
                {Math.abs(afvigelse) < 3 ? (
                  <>Boligen ligger <strong>på niveau med</strong> medianen for {b.postnr}</>
                ) : (
                  <>
                    Boligen ligger <strong>{Math.abs(afvigelse)} % {afvigelse > 0 ? 'over' : 'under'}</strong>
                    {' '}medianen for {b.postnr}
                  </>
                )}
                {' '}<span className="sml-grundlag">(baseret på {kvm.antal} boliger)</span>
              </p>
              <dl className="sml-tal">
                <div>
                  <dt>Denne bolig</dt>
                  <dd>{(egenKvm / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr/m² pr. md.</dd>
                </div>
                <div>
                  <dt>Median i {b.postnr}</dt>
                  <dd>{(kvm.median / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr/m² pr. md.</dd>
                </div>
              </dl>
              <p className="note">
                Regnet af den samlede månedlige udgift på de {kvm.antal} boliger i {b.postnr},
                vi har hentet, og som oplyser både aconto og areal. Boliger, hvor kun huslejen
                er kendt, indgår ikke — de ville trække medianen ned og sammenligne to
                forskellige ting. Tallet er ikke et udtryk for hele markedet.
              </p>
            </section>
          )}

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
              {/* Domænet klassificerer; visningen må være MERE præcis, når
                  den rå evidens tillader det: «Snarest» vises som kildens
                  eget ord, ikke som klassifikationen. Og unknown får ORD —
                  fravær af viden skal kunne ses. */}
              <dt>Overtagelse</dt>
              <dd>{(() => {
                const t = avail!.timing
                if (t.status === 'nu') {
                  const kunTekst = t.evidens.length > 0
                    && t.evidens.every((e) => e.faktum === 'takeoverText')
                  return kunTekst ? 'Snarest' : 'Kan overtages nu'
                }
                if (t.status === 'senere') {
                  const d = t.evidens.find((e) => e.faktum === 'sourceAvailabilityDate')?.vaerdi
                  return d ? `Kan overtages fra ${datoIso(d)}` : 'Kan overtages senere'
                }
                if (t.status === 'conflict') return 'Modstridende oplysninger fra kilden'
                return <span className="mangler">
                  Bofinda kan ikke fastslå, hvornår boligen kan overtages ud fra
                  de oplysninger, vi har fra kilden.
                </span>
              })()}</dd>
              <dt>Ansøgning</dt>
              <dd>{avail!.ansoegning.status === 'venteliste' ? 'Venteliste — efter anciennitet'
                : avail!.ansoegning.status === 'normal' ? 'Almindelig ansøgning'
                : <span className="mangler">Kilden oplyser ikke ansøgningsformen.</span>}</dd>
              {avail!.marked.status !== 'paa_markedet' && (
                <><dt>Status hos kilden</dt>
                  <dd>{avail!.marked.status === 'reserveret'
                    ? 'Reserveret — en anden har fået første ret'
                    : avail!.marked.status === 'udlejet' ? 'Udlejet'
                    : <span className="mangler">ikke oplyst</span>}</dd></>
              )}
              {b.aabentHus && <><dt>Åbent hus</dt><dd>{dato(b.aabentHus)}</dd></>}
              <dt>Kilde</dt>
              <dd>{b.egenAnnonce ? 'Udlejeren selv' : b.kildeNavn}</dd>
            </dl>
            {avail!.timing.status === 'conflict' && (
              /* Konflikten er et datakvalitetsfund og skjules ikke: begge
                 sider af uenigheden vises, som domænet så dem. */
              <p className="note">
                Kilden giver modstridende oplysninger om overtagelsen:{' '}
                {forklar(avail!.timing).filter((l) => !l.startsWith('──')).join(' · ')}
              </p>
            )}
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
