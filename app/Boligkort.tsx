// ═══════════════════════════════════════════════════════════════
//  Boligkortet og formateringen omkring det.
//  Deles af søgesiden og områdesiderne, så en rettelse ét sted slår
//  igennem begge steder.
// ═══════════════════════════════════════════════════════════════

import type { Bolig, Gruppe, Visning } from '../lib/soeg'
import { gruppeUrl } from '../lib/soeg'
import { billedUrl } from '../lib/billede'

// ─── Formatering ───────────────────────────────────────────────

export const kr = (oere: number | null) =>
  oere == null ? null : (oere / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })

const MDR = ['januar','februar','marts','april','maj','juni',
             'juli','august','september','oktober','november','december']

const dato = (d: Date | null) => d ? `${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}` : null

/** "for 3 timer siden". Bygget paa first_seen_at — hvornaar VI saa den. */
function siden(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'lige nu'
  if (min < 60) return `for ${min} min. siden`
  const t = Math.round(min / 60)
  if (t < 24) return `for ${t} ${t === 1 ? 'time' : 'timer'} siden`
  const dg = Math.round(t / 24)
  if (dg < 31) return `for ${dg} ${dg === 1 ? 'dag' : 'dage'} siden`
  const m = Math.round(dg / 30)
  return `for ${m} ${m === 1 ? 'måned' : 'måneder'} siden`
}

/** Adressen som VI har forstaaet den — af de parsede felter, ikke af
 *  kildens streng. Er parsningen gaaet galt, kan man se det her. */
function parsetAdresse(b: Bolig): string {
  const vej = [b.vej, b.husnr].filter(Boolean).join(' ')
  let etage: string | null = null
  if (b.etage === 'st') etage = 'st.'
  else if (b.etage === 'kl') etage = 'kælder'
  else if (b.etage) etage = b.doer ? `${b.etage}.` : `${b.etage}. sal`
  const etageDoer = [etage, b.doer].filter(Boolean).join(' ')
  return [vej, etageDoer].filter(Boolean).join(', ') || b.adresse
}

/**
 * Er der forskel ud over det, vi normaliserer med vilje, vises kildens egen
 * streng ved siden af. Linjen er oplysende, ikke en fejlmelding: kilder
 * skriver stednavne ("Fjerbregnevej 2, Trøstrup") og lejlighedsnumre
 * ("4. tv 35"), som vi ikke har felter til. Den fangede til gengaeld to
 * rigtige parsningsfejl under indkoeringen, saa den bliver staaende.
 */
const nogenlunde = (a: string, b: string) => {
  // "sal" og "lejl" er ord, vores normalisering med rette taber. De taeller
  // ikke som forskel — ellers advarer vi om hver eneste bolig, og saa holder
  // ingen op med at se advarslen.
  const skrael = (s: string) => s.toLowerCase()
    .replace(/\b(sal|lejl|lejlighed|dør|doer|vaer|vær)\b/g, '')
    // Kilder skriver stueetagen som baade "0" og "st". Det er samme etage.
    .replace(/\b0\b/g, 'st')
    .replace(/[^a-z0-9æøå]/g, '')
  return skrael(a) === skrael(b)
}

const POSTNAVN: Record<string, string> = {
  rent: 'husleje', heat: 'varme', water: 'vand',
  electricity: 'el', other: 'øvrig aconto',
}

/** Kilderne gemmer typen uden danske bogstaver. Ental og flertal. */
const TYPEORD: Record<string, [string, string]> = {
  lejlighed: ['lejlighed', 'lejligheder'],
  raekkehus: ['rækkehus', 'rækkehuse'],
  hus: ['hus', 'huse'],
  villa: ['villa', 'villaer'],
  vaerelse: ['værelse', 'værelser'],
}
/** Kender vi ikke typen — eller er den blandet i en gruppe — siger vi "bolig",
 *  ikke noget vi ikke ved. */
function typeord(t: string | null, flertal = false): string | null {
  if (!t) return flertal ? 'boliger' : null
  const par = TYPEORD[t]
  return par ? par[flertal ? 1 : 0] : t
}

const areal = (min: number | null, max: number | null) =>
  min == null ? null : min === max ? <><b>{min}</b> m²</> : <><b>{min}–{max}</b> m²</>

/**
 * Kildemærkaterne. Én bolig kan annonceres flere steder; vi viser den én
 * gang og navngiver dem alle. `ogsaaHos` er de ANDRE kilder med samme
 * enhedsadresse — se dedup i lib/soeg.ts.
 */
function Kilder({ navn, ogsaa }: { navn: string; ogsaa: string[] }) {
  if (!ogsaa?.length) return <span className="maerkat m-kilde">{navn}</span>
  return (
    <span className="kilder" title={`Samme bolig annonceret hos ${[navn, ...ogsaa].join(' og ')}`}>
      {[navn, ...ogsaa].map((k) => (
        <span key={k} className="maerkat m-kilde">{k}</span>
      ))}
    </span>
  )
}

// ─── Kortet ────────────────────────────────────────────────────

export function Kort({ b }: { b: Bolig }) {
  // Hvor laenge boligen har vaeret til leje, ikke hvor laenge den har ligget
  // i vores base. Ved foerste import er alt "set for 9 min. siden", og et
  // maerkat der siger "ny" om en annonce fra juli er en loegn.
  const paaMarkedet = b.hosKilden ?? b.foerstSet
  const nyligt = Date.now() - paaMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3
  const fakta = [
    b.areal != null ? <><b>{b.areal}</b> m²</> : null,
    b.vaerelser != null ? <><b>{b.vaerelser}</b> {b.vaerelser === 1 ? 'værelse' : 'værelser'}</> : null,
    typeord(b.type),
    // En dato i fortiden betyder ikke "ledig 15. juni" — den betyder ledig nu.
    b.ledigFra ? (b.ledigFra.getTime() <= Date.now() ? 'ledig nu' : `ledig fra ${dato(b.ledigFra)}`) : null,
  ].filter(Boolean)

  const aconto = (b.poster ?? []).filter((p) => p !== 'rent').map((p) => POSTNAVN[p] ?? p)
  const vist = parsetAdresse(b)
  // Kildens streng baerer ofte postnr og by med. Vi viser dem én gang.
  const raaUdenSted = b.adresse
    .replace(new RegExp(`,?\\s*${b.postnr ?? ''}\\s*${b.by ?? ''}\\s*$`, 'i'), '')
    .replace(/,\s*$/, '').trim()
  const parsningTabteNoget = !nogenlunde(vist, raaUdenSted)

  return (
    <a
      className={`kort${b.forside ? '' : ' uden-billede'}`}
      href={`/bolig/${b.id}`}
      // Landkortet peger paa kortet med id'et og laeser data-bolig, naar
      // musen er over. De to skal vaere den samme noegle som maerket.
      id={`kort-${b.id}`}
      data-bolig={b.id}
    >
      {b.forside && billedUrl(b.forside, 400) && (
        <div className="kort-billede">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={billedUrl(b.forside, 400)!} alt="" loading="lazy" />
          {b.billeder > 1 && <span className="kort-antal">{b.billeder} billeder</span>}
        </div>
      )}

      <div className="kort-krop">
        <div className="raek1">
          <div>
            <div className="adresse">{vist}</div>
            <div className="sted">
              {b.postnr} {b.by}
              {b.match === 'access' && ' · uden etage/dør'}
              {b.billeder === 0 && ' · ingen billeder'}
            </div>
            {parsningTabteNoget && (
              <div className="afvig">kilden skriver: {raaUdenSted}</div>
            )}
          </div>
          <div className="hoejre">
            {b.ansoegning === 'waiting_list' && <span className="maerkat m-vent">venteliste</span>}
            {nyligt && <span className="maerkat m-ny">ny {siden(paaMarkedet)}</span>}
            {/* Boligen vises én gang, selv om flere kilder annoncerer den.
                Så skal kortet også sige, hvem der har den — ikke lade som
                om den kun findes ét sted. */}
            <Kilder navn={b.kildeNavn} ogsaa={b.ogsaaHos} />
          </div>
        </div>

        <div className="fakta">
          {fakta.map((f, i) => <span key={i}>{i > 0 && ' · '}{f}</span>)}
        </div>

        {/* Det store tal er alt, hvad der betales TIL UDLEJEREN — husleje
            plus den aconto, kilden opkraever. Etiketten sagde foer "i alt",
            og det var ikke sandt: el staar udenfor hos naesten alle kilder,
            saa "i alt" lovede en fuldstaendighed, tallet ikke havde.
            "Til udlejer" er sandt, uanset om el er oplyst.
            Kender vi ikke totalen, staar huslejen der i stedet — men uden
            accentfarven, saa de to aldrig kan forveksles paa afstand. */}
        <div className="oekonomi-linje">
          {b.total != null ? (
            <div className="kort-pris">
              {kr(b.total)} <small>kr/md til udlejer</small>
            </div>
          ) : (
            <div className="kort-pris kun-leje">
              {kr(b.leje) ?? '—'} <small>kr/md i husleje</small>
            </div>
          )}

          {b.indflytning != null && (
            <div className="total">indflytning <b>{kr(b.indflytning)} kr.</b></div>
          )}

          {b.total == null && (
            /* Manglen skal vaere synlig for brugeren, ikke bare fravaerende.
               Vi kan ikke skelne "udlejer opkraever intet" fra "udlejer
               oplyser intet", saa vi paastaar ingen af delene — vi siger,
               hvad hun skal spoerge om. */
            <span className="ukendt">
              Udlejer oplyser ikke aconto — spørg om varme og vand.
            </span>
          )}
          <Ellinje vis={b.total != null && b.el == null} egenMaaler={!!b.elEgenMaaler} />
          {!nyligt && (
            <div className="total">
              {b.hosKilden ? `annonceret ${siden(b.hosKilden)}` : `set ${siden(b.foerstSet)}`}
            </div>
          )}
          {/* Egen linje nederst: den forklarer det store tal og skal staa
              under det, ikke klemmes ind mellem de andre oplysninger. */}
          {b.total != null && (
            <div className="poster">{['husleje', ...aconto].join(' + ')}</div>
          )}
        </div>
      </div>
    </a>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Gruppekortet.
//
//  Femten rækkehuse på samme vej til samme pris er femten kort, der
//  siger det samme. De vises som ét, og klikket åbner adresserne.
//
//  Kortet påstår kun det, der gælder for HELE gruppen. Er arealerne
//  forskellige, står der et spænd. Er ledigdatoerne forskellige, står
//  der, at de er forskellige — ikke den tidligste, som om den var alles.
//  Er aconto-posterne ikke ens, står de slet ikke.
// ═══════════════════════════════════════════════════════════════

export function Gruppekort({ g }: { g: Gruppe }) {
  const { noegle: n, repraesentant: r } = g
  const nyligt = Date.now() - g.nyesteMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3

  const ensLedig = g.ledigUkendte === 0 && g.ledigMin != null && g.ledigMax != null
    && g.ledigMin.getTime() === g.ledigMax.getTime()
  const ledig = ensLedig
    ? (g.ledigMin!.getTime() <= Date.now() ? 'ledig nu' : `ledig fra ${dato(g.ledigMin!)}`)
    : g.ledigUkendte === g.antal ? null
    : 'flere ledigdatoer'

  // Typen staar allerede i underlinjen ("3 ledige raekkehuse") — den skal
  // ikke ogsaa staa her.
  const fakta = [
    areal(g.arealMin, g.arealMax),
    <><b>{n.vaerelser}</b> {n.vaerelser === 1 ? 'værelse' : 'værelser'}</>,
    ledig,
  ].filter(Boolean)

  const aconto = (r.poster ?? []).filter((p) => p !== 'rent').map((p) => POSTNAVN[p] ?? p)
  const forside = r.forside && billedUrl(r.forside, 400)

  // Er den dyreste mere end en fjerdedel over den billigste, skjuler et
  // "fra" for meget: 17 boliger "fra 17.500" med 27.900 i den anden ende
  // er sandt og alligevel vildledende for en, der skimmer. Så står hele
  // spændet. Brugeren skal ikke kunne blive overrasket af noget, vi vidste.
  const SPREDT = 1.25
  const spredt = g.prisMax > g.prisMin * SPREDT

  return (
    <a
      className={`kort gruppekort${forside ? '' : ' uden-billede'}`}
      href={gruppeUrl(n)}
      id={`kort-${r.id}`}
      data-bolig={r.id}
    >
      {forside && (
        <div className="kort-billede">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={forside} alt="" loading="lazy" />
          <span className="kort-antal">{g.antal} boliger</span>
        </div>
      )}

      <div className="kort-krop">
        <div className="raek1">
          <div>
            <div className="adresse">{n.vej}</div>
            <div className="sted">
              {n.postnr} {r.by} · {g.antal} ledige {typeord(g.type, true)}
            </div>
          </div>
          <div className="hoejre">
            {/* "ny bolig", ikke "ny": det er én i gruppen, der er kommet
                til — ikke dem alle. */}
            {nyligt && <span className="maerkat m-ny">ny bolig {siden(g.nyesteMarkedet)}</span>}
            {/* Kun naar det gaelder hele gruppen — ellers ville
                repraesentanten tale for de andre. */}
            <Kilder navn={r.kildeNavn} ogsaa={g.alleOgsaaAndetsteds ? r.ogsaaHos : []} />
          </div>
        </div>

        <div className="fakta">
          {fakta.map((f, i) => <span key={i}>{i > 0 && ' · '}{f}</span>)}
        </div>

        <div className="oekonomi-linje">
          <div className={n.total ? 'kort-pris' : 'kort-pris kun-leje'}>
            {spredt
              ? <>{kr(g.prisMin)}–{kr(g.prisMax)}</>
              : <>fra {kr(g.prisMin)}</>}
            {' '}<small>kr/md {n.total ? 'til udlejer' : 'i husleje'}</small>
          </div>

          {g.indflytningMin != null && (
            <div className="total">
              indflytning{' '}
              <b>
                {g.indflytningMin === g.indflytningMax
                  ? `${kr(g.indflytningMin)} kr.`
                  : `fra ${kr(g.indflytningMin)} kr.`}
              </b>
            </div>
          )}

          {!n.total && (
            <span className="ukendt">
              Udlejer oplyser ikke aconto — spørg om varme og vand.
            </span>
          )}
          {/* Gruppen taler for flere boliger. Mangler blot ÉN af dem el,
              kan totalen ikke staa som hele udgiften for dem alle. */}
          <Ellinje vis={n.total != null && g.nogenUdenEl}
            egenMaaler={g.alleUdenElHarEgenMaaler} />

          <div className="gruppe-flere">Se de {g.antal} adresser →</div>

          {/* Kun naar posterne er ens i hele gruppen. Ellers ville
              repraesentantens saet staa som om det var alles. */}
          {n.total && g.ensPoster && (
            <div className="poster">{['husleje', ...aconto].join(' + ')}</div>
          )}
        </div>
      </div>
    </a>
  )
}

/** Ét element i listen: enten en bolig eller en gruppe af ens boliger. */
/**
 * El-forbeholdet under en groen total.
 *
 * Ligger her og ikke i hvert kort, fordi de to korttyper ellers driver fra
 * hinanden: gruppekortet manglede den her linje helt, mens enkeltkortet
 * havde den. Resultatet var 171 gruppekort over 675 boliger, der viste et
 * groent tal uden at naevne, at el ikke var med. Én komponent kan ikke
 * mangle ét af stederne.
 *
 * `egenMaaler` bruges KUN naar kilden selv siger det. Foer stod der "El
 * afregnes direkte med elselskabet" paa alt uden el-aconto — en antagelse
 * praesenteret som en oplysning.
 */
function Ellinje({ vis, egenMaaler }: { vis: boolean; egenMaaler: boolean }) {
  if (!vis) return null
  return egenMaaler
    ? <div className="el">Udlejer oplyser: el afregnes direkte med elselskabet</div>
    : <div className="el">El indgår ikke — udlejer oplyser ikke hvordan</div>
}

export function Visningskort({ v }: { v: Visning }) {
  return v.slags === 'gruppe' ? <Gruppekort g={v.gruppe} /> : <Kort b={v.bolig} />
}
