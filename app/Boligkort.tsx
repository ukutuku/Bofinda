// ═══════════════════════════════════════════════════════════════
//  Boligkortet og formateringen omkring det.
//  Deles af søgesiden og områdesiderne, så en rettelse ét sted slår
//  igennem begge steder.
// ═══════════════════════════════════════════════════════════════

import type { Bolig, Gruppe, Visning } from '../lib/soeg'
import { availabilityFor, gruppeUrl } from '../lib/soeg'
import type { Availability, Gruppesammenfatning } from '../lib/availability'
import { billedUrl } from '../lib/billede'
import { eltilstand, type Eltilstand } from '../lib/eloplysning'

// ─── Formatering ───────────────────────────────────────────────

export const kr = (oere: number | null) =>
  oere == null ? null : (oere / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })

const MDR = ['januar','februar','marts','april','maj','juni',
             'juli','august','september','oktober','november','december']

const dato = (d: Date | null) => d ? `${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}` : null
/** «2026-11-01» → «1. november 2026». Kalenderdag, ingen tidszone-regning. */
const datoIso = (iso: string) => {
  const [aar, md, dag] = iso.split('-').map(Number)
  return `${dag}. ${MDR[md! - 1]} ${aar}`
}

/**
 * Overtagelseslinjen for ÉN bolig. Domænet klassificerer til filtrering;
 * visningen må være MERE præcis, når den rå evidens tillader det —
 * derfor viser Dacas' «Snarest» ordet frem for klassifikationen.
 * `unknown` får ORD, aldrig tomhed: fravær af viden skal kunne ses.
 */
function overtagelsesTekst(a: Availability): string {
  switch (a.timing.status) {
    case 'nu': {
      const kunTekst = a.timing.evidens.length > 0
        && a.timing.evidens.every((e) => e.faktum === 'takeoverText')
      return kunTekst ? 'overtagelse: snarest' : 'kan overtages nu'
    }
    case 'senere': {
      const d = a.timing.evidens.find((e) => e.faktum === 'sourceAvailabilityDate')?.vaerdi
      return d ? `kan overtages fra ${datoIso(d)}` : 'kan overtages senere'
    }
    case 'conflict': return 'modstridende oplysninger om overtagelse'
    default: return 'overtagelse ikke afklaret'
  }
}

/** Gruppens overtagelseslinje — tællinger, aldrig én status for alle. */
function gruppeOvertagelse(g: Gruppesammenfatning): string {
  const t = g.timing
  const kun = (x: number) => x > 0 && t.nu + t.senere + t.unknown + t.conflict === x
  if (kun(t.nu)) return 'kan overtages nu'
  if (kun(t.unknown)) return 'overtagelse ikke afklaret'
  if (kun(t.senere)) {
    if (!g.tidligstSenere) return 'kan overtages senere'
    // «tidligst» siger udtrykkeligt, at det er den TIDLIGSTE dokumenterede
    // mulighed — ikke at alle deler datoen.
    return g.ensSenereDato
      ? `kan overtages fra ${datoIso(g.tidligstSenere)}`
      : `tidligst fra ${datoIso(g.tidligstSenere)}`
  }
  const dele: string[] = []
  if (t.nu) dele.push(`${t.nu} kan overtages nu`)
  if (t.senere) dele.push(`${t.senere} senere`)
  if (t.conflict) dele.push(`${t.conflict} med modstridende oplysninger`)
  if (t.unknown) dele.push(`${t.unknown} uden afklaret overtagelse`)
  return dele.join(' · ')
}

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

export function Kort({ b, nu }: { b: Bolig; nu: Date }) {
  // Availability fra DOMÆNET — aldrig fra legacy ledigFra/ansoegning, og
  // aldrig fra Date.now(): referenceNow kommer eksplicit fra siden.
  const avail = availabilityFor(b, nu)
  // Hvor laenge boligen har vaeret til leje, ikke hvor laenge den har ligget
  // i vores base. Ved foerste import er alt "set for 9 min. siden", og et
  // maerkat der siger "ny" om en annonce fra juli er en loegn.
  const paaMarkedet = b.hosKilden ?? b.foerstSet
  const nyligt = Date.now() - paaMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3
  const fakta = [
    b.areal != null ? <><b>{b.areal}</b> m²</> : null,
    b.vaerelser != null ? <><b>{b.vaerelser}</b> {b.vaerelser === 1 ? 'værelse' : 'værelser'}</> : null,
    typeord(b.type),
    overtagelsesTekst(avail),
  ].filter(Boolean)

  const aconto = (b.poster ?? []).filter((p) => p !== 'rent').map((p) => POSTNAVN[p] ?? p)
  const vist = parsetAdresse(b)
  // Kildens streng baerer ofte postnr og by med. Vi viser dem én gang.
  const raaUdenSted = b.adresse
    .replace(new RegExp(`,?\\s*${b.postnr ?? ''}\\s*${b.by ?? ''}\\s*$`, 'i'), '')
    .replace(/,\s*$/, '').trim()
  // ALDRIG paa vores egne annoncer. Linjen betyder "kilden skrev noget
  // andet, end vi kunne parse" — men for en udlejerannonce ER udlejeren
  // kilden, og `address_raw` er ikke hendes tekst: VI bygger den af hendes
  // fire felter (lib/udlejer.ts:210). Der findes altsaa ingen fremmed
  // originaltekst at tilskrive.
  //
  // Den udloestes alligevel, og grunden er vores egen: raa-strengen er
  // "Nørrebrogade 30, 2200", mens byen foerst blev sat bagefter. Regexen
  // nedenfor skaerer ", postnr by" af enden — den finder ikke "2200" alene,
  // saa postnummeret blev staaende og gjorde de to strenge forskellige.
  const parsningTabteNoget = b.kildetype !== 'native' && !nogenlunde(vist, raaUdenSted)

  // ÉN beregning, brugt begge steder. Foer afgjorde `b.forside` klassen og
  // `b.forside && billedUrl(...)` billedet. Er URL'en der, men vaerten ikke
  // i TILLADTE_VAERTER, giver billedUrl null: klassen blev saa IKKE sat,
  // gitteret beholdt sin 216px billedkolonne, og billedet blev ikke tegnet.
  // Tilbage stod 216 px tomhed og en klemt tekstkolonne, hvor adressen
  // braekker ét ord per linje. Det er Dacas-fejlen i visuel form — en
  // manglende allowlist-post fejler ikke, den oedelaegger layoutet.
  const forside = b.forside && billedUrl(b.forside, 400)

  return (
    <a
      className={`kort${forside ? '' : ' uden-billede'}`}
      href={`/bolig/${b.id}`}
      // Landkortet peger paa kortet med id'et og laeser data-bolig, naar
      // musen er over. De to skal vaere den samme noegle som maerket.
      id={`kort-${b.id}`}
      data-bolig={b.id}
    >
      {/* Billedet og forbeholdet er ÉT gitterfelt. Var forbeholdet et felt
          for sig, skubbede det kroppen en raekke ned — se .kort-billedblok
          i globals.css. */}
      {forside && (
        <div className="kort-billedblok">
          <div className="kort-billede">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={forside} alt="" loading="lazy" />
            {b.billeder > 1 && <span className="kort-antal">{b.billeder} billeder</span>}
          </div>
          {b.billedforbehold && <Billedforbehold />}
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
            {avail.ansoegning.status === 'venteliste'
              && <span className="maerkat m-vent">venteliste</span>}
            {avail.marked.status === 'reserveret'
              && <span className="maerkat m-vent">reserveret</span>}
            {avail.adgang.krav.includes('bopaelskrav')
              && <span className="maerkat m-kilde">bopælspligt</span>}
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
          <Ellinje tilstand={eltilstand(b)} />
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

export function Gruppekort({ g, nu }: { g: Gruppe; nu: Date }) {
  const { noegle: n, repraesentant: r } = g
  const nyligt = nu.getTime() - g.nyesteMarkedet.getTime() < 1000 * 60 * 60 * 24 * 3

  // Overtagelsen sammenfattes af MEDLEMMERNES domæneresultater — som
  // tællinger, aldrig som én status for alle. Aldrig legacy ledigMin/Max.
  const ledig = gruppeOvertagelse(g.availability)

  // Typen staar allerede i underlinjen ("3 ledige raekkehuse") — den skal
  // ikke ogsaa staa her.
  const fakta = [
    areal(g.arealMin, g.arealMax),
    <><b>{n.vaerelser}</b> {n.vaerelser === 1 ? 'værelse' : 'værelser'}</>,
    ledig,
  ].filter(Boolean)
  const av = g.availability
  // Blandet ansøgningsform/marked vises som tal — unknown forsvinder
  // aldrig ud af en blandet linje.
  const alleVenteliste = av.ansoegning.venteliste === g.antal
  const blandetAnsoegning = !alleVenteliste && av.ansoegning.venteliste > 0
    ? `${av.ansoegning.venteliste} venteliste · ${av.ansoegning.normal} almindelig`
      + (av.ansoegning.unknown ? ` · ${av.ansoegning.unknown} uoplyst` : '')
    : null
  const alleReserveret = av.marked.reserveret === g.antal
  const delvisReserveret = !alleReserveret && av.marked.reserveret > 0
    ? `${av.marked.reserveret} af ${g.antal} reserveret` : null
  const alleBopael = av.adgang.bopaelskrav === g.antal

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
      href={gruppeUrl(r.id)}
      id={`kort-${r.id}`}
      data-bolig={r.id}
    >
      {/* Billedet og forbeholdet er ÉT gitterfelt. Var forbeholdet et felt
          for sig, skubbede det kroppen en raekke ned — se .kort-billedblok
          i globals.css. */}
      {forside && (
        <div className="kort-billedblok">
          <div className="kort-billede">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={forside} alt="" loading="lazy" />
            <span className="kort-antal">{g.antal} boliger</span>
          </div>
          {/* Repraesentantens forbehold: det er HANS billede, kortet viser. */}
          {r.billedforbehold && <Billedforbehold />}
        </div>
      )}

      <div className="kort-krop">
        <div className="raek1">
          <div>
            <div className="adresse">{n.vej}</div>
            <div className="sted">
              {n.postnr} {r.by} · {g.antal} {typeord(g.type, true)}
            </div>
          </div>
          <div className="hoejre">
            {/* "ny bolig", ikke "ny": det er én i gruppen, der er kommet
                til — ikke dem alle. */}
            {nyligt && <span className="maerkat m-ny">ny bolig {siden(g.nyesteMarkedet)}</span>}
            {alleVenteliste && <span className="maerkat m-vent">venteliste</span>}
            {alleReserveret && <span className="maerkat m-vent">reserveret</span>}
            {alleBopael && <span className="maerkat m-kilde">bopælspligt</span>}
            {/* Kun naar det gaelder hele gruppen — ellers ville
                repraesentanten tale for de andre. */}
            <Kilder navn={r.kildeNavn} ogsaa={g.alleOgsaaAndetsteds ? r.ogsaaHos : []} />
          </div>
        </div>

        <div className="fakta">
          {fakta.map((f, i) => <span key={i}>{i > 0 && ' · '}{f}</span>)}
        </div>
        {/* Blandet ansøgningsform/markedsstatus vises som TAL — kortet må
            ikke lade en delmængdes status tale for hele gruppen, og
            unknown forsvinder aldrig ud af en blandet linje. */}
        {blandetAnsoegning && <div className="el">{blandetAnsoegning}</div>}
        {delvisReserveret && <div className="el">{delvisReserveret}</div>}

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
          {/* Gruppen taler for flere boliger, saa det SVAGESTE udsagn
              vinder. Er der bare én, hvis aconto vi ikke kender indholdet
              af, kan kortet ikke sige "el indgaar ikke" om dem alle. */}
          {/* `!n.total`, ikke `n.total == null`. Gruppenoegle.total er en
              BOOLEAN — «er priserne kendte totaler» — saa `== null` var
              aldrig sand, og vagten fyrede aldrig. Enkeltkortet spoerger
              paa `b.total`, som er et BELOEB og godt kan vaere null. Samme
              spoergsmaal, to typer, to udtryk. 47 gruppekort viste baade
              «udlejer oplyser ikke aconto» og en el-linje. */}
          <Ellinje tilstand={
            !n.total || !g.nogenUdenEl ? null
              : g.nogenUkendtDaekning ? 'ukendt-daekning'
                : g.alleUdenElHarEgenMaaler ? 'egen-maaler' : 'ikke-med'
          } />

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
 * Tilstanden UDLEDES ét sted, `eltilstand` i lib/eloplysning.ts, saa
 * kortet, boligsiden og alarmmailen ikke kan svare forskelligt paa det
 * samme spoergsmaal.
 *
 * Bemaerk forskellen paa de to sidste tilstande. "El indgaar ikke" kan vi
 * kun sige, naar posterne er udspecificerede og el ikke er blandt dem. Er
 * acontoen ét samlet beloeb, ved vi det ikke — el kan ligge i klumpen —
 * og saa siger vi DET i stedet for at paastaa noget.
 */
/**
 * Kildens eget forbehold, givet videre.
 *
 * Teksten er VORES, skrevet ud fra kildens — vi gemmer ikke deres
 * braedtekst, jf. noten ved `description` i db/schema.ts. Feltet i basen
 * siger kun AT forbeholdet staar der.
 *
 * Den skal staa ved BILLEDET, ikke i oekonomiblokken: den handler om det,
 * man kigger paa. Og den vises kun, naar der ER et billede — uden et
 * billede er der intet at tage forbehold for.
 */
function Billedforbehold() {
  return (
    <div className="billedforbehold">
      Udlejer oplyser: billederne kan være fra en anden bolig
    </div>
  )
}

function Ellinje({ tilstand }: { tilstand: Eltilstand | null }) {
  if (tilstand == null || tilstand === 'med') return null
  return (
    <div className="el">
      {tilstand === 'egen-maaler'
        ? 'Udlejer oplyser: el afregnes direkte med elselskabet'
        : tilstand === 'ukendt-daekning'
          ? 'Aconto er ét samlet beløb — det fremgår ikke om el er med'
          : 'El indgår ikke — udlejer oplyser ikke hvordan'}
    </div>
  )
}

export function Visningskort({ v, nu }: { v: Visning; nu: Date }) {
  return v.slags === 'gruppe' ? <Gruppekort g={v.gruppe} nu={nu} /> : <Kort b={v.bolig} nu={nu} />
}
