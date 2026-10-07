// ═══════════════════════════════════════════════════════════════
//  Boligkortet og formateringen omkring det.
//  Deles af søgesiden og områdesiderne, så en rettelse ét sted slår
//  igennem begge steder.
// ═══════════════════════════════════════════════════════════════

import type { Bolig, Filtre, Gruppe, Visning } from '../lib/soeg'
import { availabilityFor, gruppeUrl } from '../lib/soeg'
import type { Availability, Gruppesammenfatning } from '../lib/availability'
import { billedUrl, breddeTilladt } from '../lib/billede'
import { eltilstand, type Eltilstand } from '../lib/eloplysning'
// Typens navn kommer ÉT sted fra. Kortet og filtrene sagde før hver sit
// om `andet`, og `villa` fandtes kun i den ene liste. Se lib/boligtype.ts.
import { stort, typeord } from '../lib/boligtype'
import { dageMellem, kalenderdag } from '../lib/dato'
import { KortRamme } from './KortBilleder'
import { Fragment } from 'react'

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

/**
 * «ny»-maerkaten. ÉT sted, begge korttyper — samme grund som `Ellinje`.
 *
 * TO fejl rettet paa én gang. De er den samme fejl set fra hver sin side:
 * et spoergsmaal, der blev besvaret to steder.
 *
 * 1. DATOEN. Maerkaten regnede sin egen `b.hosKilden ?? b.foerstSet`,
 *    mens sorteringen brugte `NYHEDSDATO` i lib/soeg.ts. De svarer paa
 *    det samme — «hvornaar blev den her ny?» — og vores var det
 *    STAERKESTE faldback: `?? foerstSet` kan ikke give null, mens
 *    NYHEDSDATO giver null for et bagkatalog. Foelgen var, at en kilde
 *    ved sin foerste import stod med «ny» paa hele bestanden i tre
 *    doegn, mens «nyeste» lagde praecis de samme raekker SIDST. Kortet
 *    og listen, det stod i, sagde hver sit.
 *    Datoen kommer nu som et FELT fra forespoergslen (`nyhedMs`).
 *
 * 2. TEKSTEN. `siden()` runder et tidsrum: «for 1 dag siden» daekker
 *    23,5–35,5 timer. Kl. 08 om morgenen hed alt, vi havde set siden
 *    kl. 08:30 i gaar, altsaa «i dag» — ogsaa en bolig fra kl. 12 i
 *    gaar. Kalenderen er et andet spoergsmaal end uret, og den findes
 *    som `kalenderdag()` i lib/dato.ts, i dansk zone.
 *
 * 3. URET. Enkeltkortet regnede paa `Date.now()`, gruppekortet paa
 *    `nu`. Kommentaren ovenfor sagde allerede «aldrig fra Date.now():
 *    referenceNow kommer eksplicit fra siden». Nu gaelder det begge.
 */
const NY_DAGE = 2

function nyhedsmaerkat(nyhed: Date | null, nu: Date, gruppe = false) {
  // Null = bagkatalog (eller ingen dato overhovedet). Ingen maerkat —
  // samme svar som sorteringens `nulls last`.
  if (nyhed == null) return null
  // En kildedato i fremtiden klemmes til i dag. «Ny · -2 dage» er
  // meningsloest, og at skjule maerkaten paa en annonce, kilden selv
  // kalder helt ny, ville vaere at skjule en oplysning, vi har.
  const dage = Math.max(0, dageMellem(kalenderdag(nyhed), kalenderdag(nu)))
  if (dage > NY_DAGE) return null
  const hvad = gruppe ? 'Ny bolig' : 'Ny'
  return (
    <span className="maerkat m-ny">
      {dage === 0 ? `${hvad} i dag` : dage === 1 ? `${hvad} i går` : `${hvad} · ${dage} dage`}
    </span>
  )
}

// ─── Billedets hentning ────────────────────────────────────────
//
//  Alle kortbilleder var `loading="lazy"`, også det øverste på en
//  resultatside. Et lazy billede kan først bestilles, når layoutet er
//  regnet — så de første kort startede samtidig ved første maling og
//  delte linjen med hinanden. Målt i Chromium (simuleret 1,6 Mbit/s,
//  4× CPU): på søgesiden kom det første kortbillede ~1,2 s efter FCP og
//  var sidens LCP. Se docs/hastighed-2026-10.md.
//
//  `'hoej'` gives KUN til det øverste kort, og kun af en side, der ved,
//  at kortet står øverst: resultatsiden og gruppesiden. Forsiden giver
//  den ikke — dér er hero-fotoet LCP, og et tidligt kortbillede længere
//  nede ville tage linjen fra det. Resten forbliver lazy.
//
//  Kun `eager`, ingen `fetchPriority`. Det er målt: med og uden «high»
//  gav samme LCP (10 runder, mobil og desktop), så prioriteten tog kun
//  linjen fra skrift og CSS. React forhenter billedet af sig selv.
//
//  Det er ikke `position`. Den er analysens globale plads (side 2
//  begynder på 49) og må ikke også styre hentningen.
export type Billedprioritet = 'hoej'
const hentning = (p?: Billedprioritet) => p === 'hoej'
  ? { loading: 'eager' as const }
  : { loading: 'lazy' as const }

// ─── Den kompakte kortfront ────────────────────────────────────
//
//  Listens kort (forside, resultatside, områdesider) viser omtrent det
//  samme som Rentola: billedet, en kort titel og ÉN prislinje. Adresse,
//  overtagelse, aconto-poster, kilde og indflytningspris står på bolig-
//  og gruppesiden, ikke på fronten — brugerens beslutning 7. oktober
//  2026. Intet er slettet fra data; gruppesidens kort er stadig de fulde.
//
//  TO TING BLIVER, i kompakt form, fordi de er prisens og billedets
//  sandhed og ikke metadata:
//    · prislinjen skelner «til udlejer» fra «husleje» og siger kort, hvad
//      tallet ikke dækker (el, eller en aconto, udlejer ikke oplyser) —
//      CLAUDE.md: en grøn total står aldrig uden at el er gjort rede for,
//      og en manglende oplysning skal være synlig.
//    · billedforbeholdet står på billedet, når kilden tager det.
//  Status (reserveret, venteliste, bopælspligt) og «ny» er mærkater PÅ
//  billedet, så de ikke gør ét kort højere end naboerne.

/** El-forbeholdet i prislinjens korte form. Bundet til hele unionen, så
 *  en femte `Eltilstand` er en oversætterfejl og ikke et tavst fald. */
const KORT_EL = {
  med: null,
  'egen-maaler': 'el afregnes direkte',
  'ikke-med': 'el indgår ikke',
  'ukendt-daekning': 'aconto samlet — el uvist',
} satisfies Record<Eltilstand, string | null>

/** «3-værelses lejlighed på 52 m²». Manglende dele udelades — en
 *  pladsholder ville være et opdigtet tal. */
function kortTitel(type: string | null, vaerelser: number | null, areal: string | null): string {
  const ord = type === 'andet' || !type ? 'bolig' : typeord(type)!
  const hvad = type === 'vaerelse' || vaerelser == null ? ord : `${vaerelser}-værelses ${ord}`
  return stort(areal ? `${hvad} på ${areal} m²` : hvad)
}

function Prislinje({ beloeb, total, forbehold }: {
  beloeb: React.ReactNode; total: boolean; forbehold: string | null
}) {
  return (
    <p className="kort-prislinje">
      <span className={total ? 'kort-pris' : 'kort-pris kun-leje'}>
        {beloeb} <small>kr/md</small>
      </span>
      {/* Betydningen bliver på beløbets linje (`white-space: nowrap`);
          er der ikke plads, er det forbeholdet, der ombrydes — ikke ordet,
          der siger, hvad tallet ER. */}
      <span className="kp-betyder">{total ? 'til udlejer' : 'husleje'}</span>
      {forbehold && <span className="kp-forbehold">· {forbehold}</span>}
    </p>
  )
}

/** Statusord som mærkater på billedet — kun det, der gælder. */
const statusMaerkater = (ord: string[]) => ord.map((o) => (
  <span key={o} className="maerkat m-status">{stort(o)}</span>
))

/** Billedfeltet på den kompakte front. Uden et foto står rammen alligevel —
 *  med ordene «Ingen billeder», ikke et eksempelbillede — så kortet har
 *  samme højde som naboerne. */
function KompaktBillede({ forside, srcSet, sizes, prioritet, maerkater, forbehold }: {
  forside: string | null | false | undefined; srcSet?: string; sizes?: string
  prioritet?: Billedprioritet; maerkater: React.ReactNode[]; forbehold: boolean
}) {
  return (
    <div className="kort-billedblok">
      <div className="kort-billede">
        {forside
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={forside} srcSet={srcSet} sizes={sizes} alt="" {...hentning(prioritet)} />
          : <span className="ingen-foto">Ingen billeder</span>}
        {maerkater.length > 0 && (
          <div className="kort-maerkater">
            {maerkater.map((m, i) => <Fragment key={i}>{m}</Fragment>)}
          </div>
        )}
        {forside && forbehold && <Billedforbehold />}
      </div>
    </div>
  )
}

// ─── Kortet ────────────────────────────────────────────────────

/** `kompakt` er listens kort. `fuld` er gruppesidens: dér er adressen,
 *  overtagelsen og kilden selve grunden til at åbne siden. */
export type Kortform = 'kompakt' | 'fuld'

export function Kort({ b, nu, position, billedprioritet, form = 'fuld' }: {
  b: Bolig; nu: Date; position?: number; billedprioritet?: Billedprioritet; form?: Kortform
}) {
  // Availability fra DOMÆNET — aldrig fra legacy ledigFra/ansoegning, og
  // aldrig fra Date.now(): referenceNow kommer eksplicit fra siden.
  const avail = availabilityFor(b, nu)
  // ── Overskriften ────────────────────────────────────────────
  // Boligtype, vaerelser, areal — ét led, ikke tre chips. Det er svaret
  // paa «hvad er det her», og det er dét, en der leder efter bolig
  // skimmer efter. Adressen staar under som sted; den afgoer foerst
  // noget, naar de tre tal passer.
  //
  // Manglende dele udelades. «Lejlighed» alene er et rigtigt svar; en
  // pladsholder som «— vaer.» ville vaere et opdigtet.
  const overskrift = [
    // Stort forbogstav: typen ER overskriften og står først i linjen.
    // På gruppekortet står antallet først, og dér bliver ordet med småt.
    b.type ? stort(typeord(b.type)!) : null,
    // «vær.» og ikke «vaerelser»: er boligtypen selv `vaerelse`, staar der
    // ellers «Vaerelse · 5 vaerelser» — det samme ord om to forskellige
    // ting i den samme linje. Forkortelsen er den, danske boligannoncer
    // bruger, og den kan ikke forveksles med typen.
    b.vaerelser != null ? `${b.vaerelser} vær.` : null,
    b.areal != null ? `${b.areal} m²` : null,
  ].filter(Boolean).join(' · ')

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

  // ── Ét maerkat, ikke fire ────────────────────────────────────
  // Kortet bar op til fire mærkater oven på fotoet: «ny», «venteliste»,
  // «reserveret» og «bopælspligt». Fire farvede piller over et billede er
  // ikke et hierarki, det er et slagsmål om opmærksomhed.
  //
  // Kun «ny» bliver på fotoet. Den er tidsbestemt og gælder få kort ad
  // gangen, så den betyder noget, netop fordi den er sjælden.
  //
  // De tre andre BLIVER — som ord i metalinjen under adressen. Det er
  // ikke en nedtoning af oplysningen, det er en flytning af den: at
  // skjule «reserveret» for at få færre mærkater ville være projektets
  // egen ærlighedsregel vendt på hovedet. En bolig, der ser ledig ud og
  // ikke er det, er samme fejl som en total, der lader som om aconto er
  // kendt.
  // Hvor laenge boligen har vaeret til leje, ikke hvor laenge den har
  // ligget i vores base — og med indkoeringsvagten, se `nyhedsmaerkat`.
  const nymaerkat = nyhedsmaerkat(b.nyhedMs == null ? null : new Date(b.nyhedMs), nu)
  const status = [
    avail.ansoegning.status === 'venteliste' ? 'venteliste' : null,
    avail.marked.status === 'reserveret' ? 'reserveret' : null,
    avail.adgang.krav.includes('bopaelskrav') ? 'bopælspligt' : null,
  ].filter(Boolean) as string[]

  if (form === 'kompakt') {
    const el = b.total != null ? KORT_EL[eltilstand(b) ?? 'med'] : null
    return (
      <KortRamme id={b.id} antal={forside ? b.billeder : 0}>
        <a
          className={`kort kompakt${forside ? '' : ' uden-billede'}`}
          href={`/bolig/${b.id}`}
          id={`kort-${b.id}`}
          data-bolig={b.id}
          data-kilde={b.kilde}
          data-position={position}
        >
          <KompaktBillede
            forside={forside}
            srcSet={b.forside && breddeTilladt(b.forside, 800)
              ? `${forside} 400w, ${billedUrl(b.forside, 800)} 800w` : undefined}
            sizes={b.forside && breddeTilladt(b.forside, 800)
              ? '(max-width: 620px) calc(100vw - 44px), 50vw' : undefined}
            prioritet={billedprioritet}
            maerkater={[...(nymaerkat ? [nymaerkat] : []), ...statusMaerkater(status)]}
            forbehold={!!b.billedforbehold}
          />
          <div className="kort-krop">
            <h3 className="kort-overskrift">
              {kortTitel(b.type, b.vaerelser, b.areal != null ? String(b.areal) : null)}
            </h3>
            <Prislinje
              beloeb={b.total != null ? kr(b.total) : (kr(b.leje) ?? '—')}
              total={b.total != null}
              forbehold={b.total != null ? el : 'aconto ikke oplyst'}
            />
          </div>
        </a>
      </KortRamme>
    )
  }

  return (
    <a
      className={`kort${forside ? '' : ' uden-billede'}`}
      href={`/bolig/${b.id}`}
      // Landkortet peger paa kortet med id'et og laeser data-bolig, naar
      // musen er over. De to skal vaere den samme noegle som maerket.
      id={`kort-${b.id}`}
      data-bolig={b.id}
      data-kilde={b.kilde}
      data-position={position}
    >
      {/* Billedet og forbeholdet er ÉT gitterfelt. Var forbeholdet et felt
          for sig, skubbede det kroppen en raekke ned — se .kort-billedblok
          i globals.css. */}
      {forside && (
        <div className="kort-billedblok">
          <div className="kort-billede">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* 800 tilbydes KUN, hvis vaerten maa levere den. `billedUrl`
                skaerer stille ned til naermeste tilladte bredde i
                BREDDER_PR_VAERT — den returnerer ikke null og fejler ikke.
                Uden vagten ville en vaert med et loft paa 400 faa den
                SAMME fil udpeget som baade «400w» og «800w», og browseren
                ville straekke 400 px op paa en taet skaerm. En deskriptor,
                der lyver om filens bredde, er vaerre end ingen deskriptor.

                I dag er ingen vaert under 800 — `lokalbolig.io` er skaaret
                ned fra 1600 til 400 og 800 — saa vagten aendrer intet nu.
                Den staar, fordi srcset'en og ruten skal svare paa det
                samme spoergsmaal ét sted: naeste gang en vaert beder om
                mindre, foelger kortet med af sig selv. */}
            <img src={forside}
              srcSet={breddeTilladt(b.forside!, 800)
                ? `${forside} 400w, ${billedUrl(b.forside!, 800)} 800w`
                : undefined}
              sizes={breddeTilladt(b.forside!, 800)
                ? '(max-width: 620px) calc(100vw - 44px), 50vw' : undefined}
              alt="" {...hentning(billedprioritet)} />
            {/* Ét maerkat paa fotoet. Uden et foto er der ingen flade
                at ligge paa, og saa staar det oeverst i kroppen — samme
                udtryk, ét sted i koden. */}
            {nymaerkat && <div className="kort-maerkater">{nymaerkat}</div>}
            {b.billeder > 1 && <span className="kort-antal">{b.billeder} billeder</span>}
          </div>
          {b.billedforbehold && <Billedforbehold />}
        </div>
      )}

      <div className="kort-krop">
        {!forside && nymaerkat && (
          <div className="kort-maerkater i-krop">{nymaerkat}</div>
        )}
        <div className="kort-titel">
          {/* Overskriften er hvad boligen ER. Adressen er hvor den er, og
              den staar under — et sted afgoer foerst noget, naar
              stoerrelsen passer. Er typen ukendt og arealet uoplyst,
              staar der kun det, vi ved; en pladsholder ville vaere et
              opdigtet tal. */}
          <h3 className="kort-overskrift">{overskrift || 'Bolig'}</h3>
          {/* Adresse OG by paa én linje, som i referencen. De stod paa
              hver sin, og den anden bar en naal foran sig — to linjer og
              et ikon om ét sted. Forbeholdene om adressen («uden
              etage/dør») og om billederne er flyttet til metalinjen; de
              handler om, hvad vi VED, ikke om hvor boligen er. */}
          <p className="adresse">{vist} · {b.postnr} {b.by}</p>
          {parsningTabteNoget && (
            <div className="afvig">kilden skriver: {raaUdenSted}</div>
          )}
        </div>

        {/* ── Metalinjen ────────────────────────────────────────
            Overtagelsen og de statusord, der foer var farvede maerkater
            paa fotoet. Samme oplysninger, mindre stoej: en linje graa
            tekst i stedet for tre piller oven paa et billede.
            Overtagelsen staar foerst — den er domaenets svar og findes
            paa hver bolig; statusordene er undtagelser. */}
        <p className="kort-meta">
          {[
            overtagelsesTekst(avail),
            ...status,
            // Forbehold om DATAENE, ikke om boligen. «uden etage/dør»
            // siger, at adressen er matchet paa opgangsniveau; «ingen
            // billeder» at kilden ikke har nogen. Begge hoerer til her
            // sammen med det oevrige, vi ved og ikke ved.
            b.match === 'access' ? 'uden etage/dør' : null,
            b.billeder === 0 ? 'ingen billeder' : null,
          ].filter(Boolean).join(' · ')}
        </p>

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

          {/* Indflytningsprisen er sidens ANDET beloeb, ikke en note.
              Den stod som 13,5 px graa tekst ved siden af en 27 px groen
              total og forsvandt i den — og det er netop det tal, der
              afgoer, om boligen overhovedet kan betales. Egen klasse,
              egen stoerrelse og en lodret streg imellem, saa de to kan
              skelnes paa et blik uden at vaere lige tunge.
              `.total` bliver staaende paa alderslinjen nedenfor; de to
              delte klasse foer, og et beloeb og en dato vejer ikke ens. */}
          {b.indflytning != null && (
            <div className="kort-indflytning">
              indflytning <b>{kr(b.indflytning)} kr.</b>
            </div>
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
          {/* Egen klasse, saa den kan saettes ned i vaegt uden at tage
              indflytningsprisen med: begge var `.total`, og alderen paa en
              annonce vejer ikke det samme som et beloeb, hun skal betale. */}
          {/* Herkomstlinjen staar, naar maerkaten IKKE goer — ét udtryk,
              ikke to. `nyligt` var en anden udregning af samme
              spoergsmaal og kunne drive fra maerkaten. */}
          {!nymaerkat && (
            <div className="total set-linje">
              {b.hosKilden ? `annonceret ${siden(b.hosKilden)}` : `set ${siden(b.foerstSet)}`}
            </div>
          )}
          {/* Egen linje nederst: den forklarer det store tal og skal staa
              under det, ikke klemmes ind mellem de andre oplysninger. */}
          {b.total != null && (
            <div className="poster">{['husleje', ...aconto].join(' + ')}</div>
          )}
        </div>

        {/* Kortets fod, som referencens «Fra BoligPortal». Boligen vises
            én gang, selv om flere kilder annoncerer den — saa skal kortet
            ogsaa sige, hvem der har den. */}
        <div className="kort-fod">
          <Kilder navn={b.kildeNavn} ogsaa={b.ogsaaHos} />
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

export function Gruppekort({ g, nu, position, filtre, billedprioritet }: {
  g: Gruppe; nu: Date; position?: number; filtre?: Filtre; billedprioritet?: Billedprioritet
}) {
  const { noegle: n, repraesentant: r } = g


  // ── Gruppens overskrift ─────────────────────────────────────
  // Samme form som enkeltkortet — antal og type, vaerelser, areal — saa
  // de to korttyper laeser ens i den samme liste. Forskellen er, at
  // gruppens tal ER gruppens: antallet foran, og arealet som et spaend,
  // naar medlemmerne ikke er ens.
  //
  // «vær.» og ikke «vaerelser»: er gruppens type `vaerelse`, staar der
  // ellers «4 vaerelser · 5 vaerelser» — fire udlejede vaerelser med fem
  // rum i hvert, men det samme ord om to forskellige ting. Forkortelsen
  // kan ikke forveksles med typen. Vaerelsestallet er en noegledel i
  // grupperingen, saa alle medlemmer har det samme; tallet gaelder den
  // enkelte bolig, arealet er et spaend over dem alle.
  const overskrift = [
    `${g.antal} ${typeord(g.type, true)}`,
    // «hver» er ikke pynt. Er gruppens type `vaerelse`, staar der ellers
    // «5 vaerelser · 3 vaer.» — fem udlejede vaerelser med tre rum i
    // hvert, og forkortelsen alene baerer ikke forskellen. Ordet siger,
    // at tallet gaelder PER BOLIG, mens antallet foran er gruppens og
    // arealet et spaend over dem alle. Vaerelsestallet ER en noegledel i
    // grupperingen, saa alle medlemmer har det samme; «hver» er
    // efterproevet, ikke et forbehold.
    `${n.vaerelser} vær. hver`,
    g.arealMin == null ? null
      : g.arealMin === g.arealMax ? `${g.arealMin} m²` : `${g.arealMin}–${g.arealMax} m²`,
  ].filter(Boolean).join(' · ')
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

  const forside = r.forside && billedUrl(r.forside, 400)

  // Er den dyreste mere end en fjerdedel over den billigste, skjuler et
  // "fra" for meget: 17 boliger "fra 17.500" med 27.900 i den anden ende
  // er sandt og alligevel vildledende for en, der skimmer. Så står hele
  // spændet. Brugeren skal ikke kunne blive overrasket af noget, vi vidste.
  const SPREDT = 1.25
  const spredt = g.prisMax > g.prisMin * SPREDT

  // Ét maerkat, som paa enkeltkortet. «ny bolig», ikke «ny» — det er én
  // i gruppen, der er kommet til. De tre statusord staar i metalinjen;
  // se noten paa enkeltkortet om hvorfor de BLIVER.
  const nymaerkat = nyhedsmaerkat(g.nyhed, nu, true)
  // Kun naar det gaelder HELE gruppen. Repraesentanten maa ikke tale for
  // de andre — det er den samme regel som for kildemaerkaterne.
  const status = [
    alleVenteliste ? 'venteliste' : null,
    alleReserveret ? 'reserveret' : null,
    alleBopael ? 'bopælspligt' : null,
  ].filter(Boolean) as string[]

  // ── Den kompakte front ──────────────────────────────────────
  //  Gruppekortet står kun i lister, så det har kun den kompakte form.
  //  Gruppens enkelte boliger — adresser, overtagelse, kilde, aconto —
  //  står på gruppesiden, hvor hver vises med sit fulde kort.
  //
  //  Det, kortet stadig SKAL sige, fordi det ellers påstår for meget:
  //  · prisen er gruppens spænd og siger «til udlejer» eller «husleje»;
  //  · el og manglende aconto som på enkeltkortet, med det SVAGESTE
  //    udsagn for gruppen (én ukendt dækning gør hele gruppen uvis);
  //  · «1 af 4 matcher», når kun nogle passer søgningen — pris og areal
  //    dækker alle fire, og det skal stå før klikket;
  //  · status, der kun gælder en del, som tal («1 af 3 reserveret»).
  const elTilstand: Eltilstand | null = !n.total || !g.nogenUdenEl ? null
    : g.nogenUkendtDaekning ? 'ukendt-daekning'
      : g.alleUdenElHarEgenMaaler ? 'egen-maaler' : 'ikke-med'
  const flertal = g.type === 'andet' || !g.type ? 'boliger' : typeord(g.type, true)
  const arealTekst = g.arealMin == null ? null
    : g.arealMin === g.arealMax ? `${g.arealMin} m²` : `${g.arealMin}–${g.arealMax} m²`
  const titel = [
    `${g.antal} ${flertal}`,
    g.type === 'vaerelse' ? null : `${n.vaerelser}-værelses`,
    arealTekst,
  ].filter(Boolean).join(', ')
  const maerkater = [
    ...(nymaerkat ? [nymaerkat] : []),
    ...(g.matchende != null && g.matchende < g.antal
      ? [<span key="match" className="maerkat m-status">{g.matchende} af {g.antal} matcher</span>] : []),
    ...statusMaerkater(status),
    ...(delvisReserveret ? [<span key="delvis" className="maerkat m-status">{delvisReserveret}</span>] : []),
    ...(blandetAnsoegning ? [<span key="ansoeg" className="maerkat m-status">{blandetAnsoegning}</span>] : []),
  ]

  return (
    <KortRamme id={r.id} antal={forside ? r.billeder : 0}>
      <a
        className={`kort kompakt gruppekort${forside ? '' : ' uden-billede'}`}
        href={gruppeUrl(r.id, filtre)}
        id={`kort-${r.id}`}
        data-bolig={r.id}
        data-kilde={r.kilde}
        data-position={position}
        data-gruppe="1"
        data-gruppe-antal={g.antal}
      >
        <KompaktBillede
          forside={forside}
          srcSet={r.forside && breddeTilladt(r.forside, 800)
            ? `${forside} 400w, ${billedUrl(r.forside, 800)} 800w` : undefined}
          sizes={r.forside && breddeTilladt(r.forside, 800)
            ? '(max-width: 620px) calc(100vw - 44px), 50vw' : undefined}
          prioritet={billedprioritet}
          maerkater={maerkater}
          // Repraesentantens forbehold: det er HANS billede, kortet viser.
          forbehold={!!r.billedforbehold}
        />
        <div className="kort-krop">
          <h3 className="kort-overskrift">{titel}</h3>
          <Prislinje
            beloeb={spredt ? <>{kr(g.prisMin)}–{kr(g.prisMax)}</> : <>fra {kr(g.prisMin)}</>}
            total={n.total}
            forbehold={n.total ? (elTilstand ? KORT_EL[elTilstand] : null) : 'aconto ikke oplyst'}
          />
        </div>
      </a>
    </KortRamme>
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

/**
 * `position` er kortets plads i listen, 1-baseret. Den baeres videre som en
 * data-attribut, saa klienttrackeren kan maale impressions uden at kende
 * lib/soeg — og saa spoergsmaalet «bliver position 40 nogensinde set?»
 * kan besvares. Uden den er en impression bare et tal uden sted.
 */
export function Visningskort({ v, nu, position, filtre, billedprioritet }: {
  v: Visning; nu: Date; position?: number; filtre?: Filtre; billedprioritet?: Billedprioritet
}) {
  return v.slags === 'gruppe'
    ? <Gruppekort g={v.gruppe} nu={nu} position={position} filtre={filtre} billedprioritet={billedprioritet} />
    : <Kort b={v.bolig} nu={nu} position={position} billedprioritet={billedprioritet} form="kompakt" />
}
