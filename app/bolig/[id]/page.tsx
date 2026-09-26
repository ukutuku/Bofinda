import { notFound } from 'next/navigation'
import {
  availabilityFor, hentBolig, kvadratmeterpris, MINDST_TIL_SAMMENLIGNING,
  type BoligDetalje,
} from '../../../lib/soeg'
import { forklar } from '../../../lib/availability'
import { billedUrl } from '../../../lib/billede'
import { siden } from '../../../lib/dato'
import { eltilstand } from '../../../lib/eloplysning'
import { erEgenAnnonce, kildeetiket } from '../../../lib/kilde'
import { Galleri } from './Galleri'
import { Kontakt } from './Kontakt'
import { Maaling } from '../../Maaling'
import { Landkort } from '../../Landkort'
import { Favoritknap } from '../../Favoritknap'
import { favoritIder, statusFor } from '../../../lib/favoritter'
import { maalingstilstand, spor } from '../../../lib/maaling-server'
import { RETUR_PARAM, returUrl } from '../../../lib/retur'
import { typenavn } from '../../../lib/boligtype'

export const dynamic = 'force-dynamic'

// ─── Formatering ───────────────────────────────────────────────

const kr = (o: number | null) =>
  o == null ? null : (o / 100).toLocaleString('da-DK', { maximumFractionDigits: 2 })

const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december']

const dato = (d: Date | null) =>
  d ? `${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}` : null

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

export default async function Side({ params, searchParams }: {
  params: Promise<{ id: string }>
  // Kun til returadressen. Siden er i forvejen `force-dynamic`, saa den
  // koster ingen gengivelsesstrategi.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Vejen tilbage til den soegning, hun kom fra. GENOPBYGGET, aldrig
  // ekkoet: `returUrl` parser vaerdien og bygger et nyt svar af en
  // literal sti og de noegler, hvidlisten navngiver. Er der ingen — et
  // delt link, et bogmaerke, en soegemaskine — er den null, og stien
  // staar praecis som foer. Se lib/retur.ts.
  const tilbage = returUrl((await searchParams)[RETUR_PARAM])
  const b = await hentBolig(id)
  // ReferenceNow: ét eksplicit nu pr. request. Availability kommer fra
  // DOMÆNET — aldrig fra legacy ledigFra/ansoegning.
  const nu = new Date()
  const avail = b ? availabilityFor(b, nu) : null
  if (!b) notFound()

  // Ét udtryk for «hvem har oprettet den», delt med begge korttyper,
  // gruppesiden og Min side. Se lib/kilde.ts.
  const egenAnnonce = erEgenAnnonce(b)

  const galleri = b.billeder
    .map((x) => ({ lille: billedUrl(x.url, 800), stor: billedUrl(x.url, 1600) }))
    .filter((x): x is { lille: string; stor: string } => !!x.lille && !!x.stor)

  // `acontoIalt` er vaek. Den havde to forbrugere: restbeloebet
  // «Depositum og forudbetalt leje» (fjernet i 5bab5c7) og
  // «Aconto»-linjen i indflytningsblokken (fjernet her). Maanedsblokken
  // viser de navngivne poster hver for sig og har aldrig brugt summen.

  // ── Indflytning: OPLYSTE beloeb, aldrig udledte ──────────────
  //
  //  Her stod en udregning: `indflytning - leje - aconto`, vist som ét
  //  tal under overskriften «Depositum og forudbetalt leje», med noten
  //  «Kilden oplyser summen, ikke fordelingen». Begge dele var forkerte.
  //
  //  Kolonnerne `deposit` og `prepaid_rent` har vaeret der siden 0015.
  //  Fem adaptere GEMMER dem — alabu og birch (kun depositum), cej,
  //  heimstaden og laros (begge) — og det goer hver eneste
  //  udlejerannonce ogsaa (`fraFormular` i lib/udlejer.ts). Og for
  //  Propstep og LokalBolig LAESER adapteren dem fra kilden og bruger
  //  dem til at regne `move_in_cost` — den gemmer dem bare ikke. Kilden
  //  oplyste altsaa fordelingen i begge tilfaelde. Restbeloebet var
  //  vores eget regnestykke praesenteret som kildens oplysning.
  //
  //  Kontrakten staar i lib/adapter.ts: delene er kildens EGNE beloeb,
  //  aldrig udledt af maanedsantal, og sum og dele blandes ikke.
  //  Baglaens-udledningen her broed netop den regel.
  //
  //  `!= null` og ikke truthiness: **0 kr. i depositum er en oplysning**,
  //  ikke et fravaer. `0 && …` ville tie om et beloeb, kilden har sagt.
  const harDepositum = b.depositum != null
  const harForudbetalt = b.forudbetalt != null
  //  Blokken vises ogsaa UDEN en samlet indflytningspris: kender vi det
  //  ene, er det bedre end ingenting, og et beloeb, vi har, maa ikke
  //  forsvinde fordi et andet mangler.
  const visIndflytning = b.indflytning != null || harDepositum || harForudbetalt

  //  Der regnes IKKE et restbeloeb ud af totalen. Hvad `move_in_cost`
  //  daekker, er ikke det samme hos alle kilder — Propstep lægger
  //  leje + depositum + forudbetalt + aconto sammen, home.dk goer det
  //  udtrykkeligt ikke — saa en subtraktion ville vaere en paastand om
  //  en sammensaetning, vi ikke har faaet oplyst.
  //
  //  Og teksten siger «vi har ikke», ikke «kilden oplyser ikke».
  //  Det sidste ville kraeve belaeg, og det findes ikke: en adapter, der
  //  aldrig laeser feltet, er ikke et bevis paa, at kilden tier. Det er
  //  den samme skelnen som for el — `electricity_own_meter` saettes kun,
  //  naar kilden udtrykkeligt siger det.
  const manglende = [
    !harDepositum ? 'depositummet' : null,
    !harForudbetalt ? 'den forudbetalte leje' : null,
  ].filter(Boolean)

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
  const favkontekst = await favoritIder()
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
      egen_annonce: egenAnnonce,
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
    b.type ? { ikon: 'hus', v: typenavn(b.type), e: 'boligtype' } : null,
  ].filter((x): x is { ikon: string; v: string; e: string } => !!x)

  /**
   * Afsnittene paa siden — og dermed ogsaa afsnitsnavigationen.
   *
   * Betingelserne er de SAMME som afsnittene selv staar paa. Skrev vi
   * listen af i haanden, ville et link kunne pege paa et afsnit, som
   * ikke blev gengivet — og et anker, der ikke rammer noget, er en
   * paastand om indhold, vi ikke har.
   */
  const afsnit = [
    kvm && afvigelse != null && egenKvm != null
      ? { id: 'kvadratmeterpris', navn: 'Pris pr. m²' } : null,
    { id: 'boligen', navn: 'Boligen' },
    b.faciliteter && b.faciliteter.length > 0
      ? { id: 'faciliteter', navn: 'Faciliteter' } : null,
    b.beskrivelse ? { id: 'beskrivelse', navn: 'Beskrivelse' } : null,
    { id: 'beliggenhed', navn: 'Beliggenhed' },
  ].filter((x): x is { id: string; navn: string } => !!x)

  return (
    <article className="detalje">
      <Maaling aktiv={mt.aktiv} impressions={false} visning={null} rute="/bolig/[id]" />
      {/* ── Stien ─────────────────────────────────────────────
          Referencens broedkrumme: forsiden, byen, og «Denne bolig» som
          det sted, man staar.

          NAVNET FOELGER LINKET, IKKE OMVENDT. Det hed engang «Tilbage
          til soegeresultater» og pegede paa `/` — og `/` uden parametre
          er ikke den soegning, hun kom fra: filtre, sortering og sidetal
          var vaek. Et link, der lover at foere tilbage og i stedet
          nulstiller soegningen, er den samme slags usandhed som en
          total, der lader som om aconto er kendt. Derfor blev det
          doebt om til «Forside», som var sandt om det, linket gjorde.

          Nu FOERER det tilbage, naar vi har adressen — den baeres med
          fra kortet og genopbygges her — og saa maa navnet ogsaa sige
          det. Har vi den ikke, staar der «Forside» og peger paa
          forsiden, noejagtig som foer. Praemissen er fjernet, ikke
          beslutningen omgjort.

          Byen peger paa soegesiden med `sted` — samme parameter som
          filterbjaelken bruger, saa dét link rammer noejagtig den
          soegning, navnet lover. Ikke omraadesiden: den findes kun over
          `MINDST_BOLIGER`, og et link, der kan give 404, er ikke en sti. */}
      <nav className="detalje-sti" aria-label="Sti">
        <a className="sti-tilbage" href={tilbage ?? '/'}>
          <span aria-hidden="true">←</span>{' '}
          {tilbage ? 'Tilbage til søgeresultaterne' : 'Forside'}
        </a>
        {b.by && (
          <>
            <span className="sti-skil" aria-hidden="true">/</span>
            <a href={`/?sted=${encodeURIComponent(b.by)}`}>{b.by}</a>
          </>
        )}
        <span className="sti-skil" aria-hidden="true">/</span>
        <span aria-current="page">Denne bolig</span>
      </nav>

      <div className="spalter">
        {/* ── Økonomien. Sidens vigtigste element, og derfor det første
              øjet lander på. Alt andet er understøttende. ── */}
        <aside className="oekonomi">
          <div className="oek-kort">
            {b.total != null ? (
              <>
                {/* ── «Betaling til udlejer», ikke «reel udgift» ──
                    Tallet er husleje plus den aconto, kilden opkræver —
                    alt hvad der betales TIL UDLEJEREN. «Reel månedlig
                    udgift» lovede mere end det: el står uden for hos
                    næsten alle kilder, så en læser, der tog ordet for
                    pålydende, ville regne med et tal, der ikke var
                    hendes reelle udgift.

                    Det er den samme rettelse, prisetiketten på
                    boligkortet allerede har fået — der står «kr/md til
                    udlejer», og det var «i alt» før. Nu siger begge
                    flader det samme om det samme tal. */}
                <div className="oek-etiket">Månedlig betaling til udlejer</div>
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
                {/* Kender vi kun huslejen, hedder tallet husleje. «Månedlig
                    udgift» stod her og var det, tallet netop IKKE var —
                    aconto er ukendt, så udgiften er større end det, der
                    står. Underlinjen «kun husleje» skulle bære hele
                    forbeholdet for en etiket, der sagde noget andet;
                    etiketten siger det nu selv, og linjen gentager ikke
                    overskriften. Boligkortet siger «i husleje» om det
                    samme tal. */}
                <div className="oek-etiket">Månedlig husleje</div>
                <div className="oek-tal ukendt-tal">
                  {kr(b.leje) ?? '—'}<span className="enhed"> kr.</span>
                </div>
                <p className="oek-etiket-under">aconto ikke oplyst</p>
                <div className="oek-mangler">
                  <strong>Udlejer oplyser ikke aconto.</strong>
                  <span>Spørg om varme og vand, før du regner på det —
                    den samlede udgift kendes ikke.</span>
                </div>
              </>
            )}

            {visIndflytning && (
              <div className="oek-indflytning">
                {/* Overskriften lover kun det, vi har. Uden en samlet pris
                    staar der ikke «At betale ved indflytning» over to
                    poster, der ikke er hele regningen. */}
                {b.indflytning != null ? (
                  <>
                    <div className="oek-etiket">At betale ved indflytning</div>
                    <div className="oek-tal2">{kr(b.indflytning)}<span className="enhed"> kr.</span></div>
                  </>
                ) : (
                  <div className="oek-etiket">Ved indflytning</div>
                )}
                <ul className="oek-poster">
                  {/* ── Husleje og aconto staar IKKE her ──────────────
                      De stod her paa betingelsen `b.indflytning != null`
                      — altsaa alene fordi feltet fandtes. Ingen kolonne
                      siger, hvad `move_in_cost` daekker.

                      Sammenlign med den MAANEDLIGE total: den har
                      `total_monthly_components`, en liste over de poster,
                      den bestaar af, haandhaevet af check-constraint'en
                      `listing_total_monthly_honest`. Indflytningsprisen
                      har ingen tilsvarende kolonne, og sammensaetningen
                      er forskellig fra kilde til kilde: Propstep og
                      LokalBolig laegger leje + aconto + depositum +
                      forudbetalt sammen, mens balder gemmer kildens
                      `combined_upfront_payment`, dacas, heimstaden og
                      laros kildens egen «Indflytningspris», og findbolig
                      ganger maanedsantal op. Rækken siger ikke hvilken.

                      MAALT paa proevens «begge»-tilfaelde: totalen stod
                      som 55.000, mens de fire viste poster summerede til
                      57.000. De 2.000 var acontoen, som siden selv havde
                      lagt til. Tallene modsagde hinanden paa skaermen.

                      Huslejen og acontoen staar i maanedsblokken ovenfor,
                      hvor deres rolle ER dokumenteret. De hoerer foerst
                      til her, den dag en kolonne siger, at de er med i
                      indflytningsprisen. */}
                  {harDepositum && (
                    <li data-post="depositum">
                      <span>Depositum</span><b>{kr(b.depositum)}</b>
                    </li>
                  )}
                  {harForudbetalt && (
                    <li data-post="forudbetalt">
                      <span>Forudbetalt leje</span><b>{kr(b.forudbetalt)}</b>
                    </li>
                  )}
                </ul>
                {b.indflytning != null && (harDepositum || harForudbetalt) && (
                  <p className="oek-note" data-note="ikke-opdeling">
                    {/* Uden den her linje ville to beloeb under en total
                        laese som en opdeling af den — og de gaar ikke op,
                        fordi vi ikke ved, hvad totalen bestaar af. Det er
                        ikke et forbehold om kilden, men om os: vi har
                        ingen oplysning om sammensaetningen. */}
                    Vi ved ikke, hvordan den samlede pris er sammensat.
                    Beløbene herover er dem, vi har oplysninger om — ikke
                    en opdeling af de {kr(b.indflytning)} kr.
                  </p>
                )}
                {b.indflytning == null && (
                  <p className="oek-note" data-note="uden-total">
                    {/* Her stod «det, der står her, er ikke hele det, der skal
                        betales — første måneds husleje kommer oveni». Ingen af
                        de to udsagn følger af, at totalen mangler. Vi ved ikke,
                        om beløbene er hele regningen, og vi ved ikke, om
                        udlejeren opkræver første måneds husleje ved
                        indflytning. Det var samme fejl som den, blokken lige
                        var blevet rettet for: en påstand uden belæg, skrevet
                        med sikker stemme.

                        Det eneste, en manglende total dokumenterer, er at
                        totalen mangler. Resten er et spørgsmål til udlejeren. */}
                    Vi kender ikke den samlede indflytningspris. Her vises de
                    beløb, vi har oplysninger om. Spørg udlejeren, hvad der
                    samlet skal betales ved indflytning.
                  </p>
                )}
                {manglende.length > 0 && (
                  <p className="oek-note" data-note="mangler">
                    {/* «Vi har ikke», ikke «kilden oplyser ikke». Der er
                        ingen kolonne, der siger, at kilden tier — og en
                        adapter, der ikke læser feltet, er ikke et bevis. */}
                    Vi har ikke {manglende.join(' og ')} for denne bolig.
                    {' '}Spørg udlejeren, før du regner på indflytningen.
                  </p>
                )}
              </div>
            )}

            {egenAnnonce ? (
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

        {/* ── Venstre spalte, oeverste felt ─────────────────────
            Galleriet og titlen. De to felter er adskilt, fordi
            raekkefoelgen skal kunne vaere en anden paa en telefon:
            der staar billeder og adresse foerst, saa prispanelet, og
            derefter afsnittene. Med ét felt kunne prispanelet kun
            ligge enten foer billederne eller efter hele teksten. */}
        <div className="detalje-visning">

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
          {/* ── Overskrift og gem-knap ──────────────────────────
              Knappen staar ved siden af navnet, ikke inde i det:
              `.hoved-titel` er den flexraekke, der holder dem sammen,
              og h1'en tager pladsen. Paa boligkortene ligger knappen
              uden for kortets <a>, fordi kortet ER et link — her er
              overskriften ikke et link, saa der er intet at ligge
              uden for, og knappen kan staa som soeskende til h1'en.
              Tilstanden kommer fra `favkontekst`, som hentes én gang
              for hele sidevisningen. */}
          <div className="hoved-titel">
            <h1>{adresselinje(b)}</h1>
            <Favoritknap
              listingId={b.id}
              status={statusFor(favkontekst, b.id)}
              adresse={adresselinje(b)}
            />
          </div>
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
        </div>

        <div className="detalje-afsnit">
          {/* ── Afsnitsnavigation ─────────────────────────────────
              Referencens fanerække over indholdet. Det ER faner i
              billedet; her er det ankerlinks til de afsnit, der
              faktisk staar paa siden. Listen bygges af `afsnit`, som
              udledes af de samme betingelser, afsnittene selv staar
              paa — ét udtryk, to steder, saa navigationen ikke kan
              komme til at pege paa et afsnit, der ikke blev gengivet. */}
          {afsnit.length > 1 && (
            <nav className="afsnitsnav" aria-label="Afsnit på siden">
              {afsnit.map((a) => (
                <a key={a.id} href={`#${a.id}`}>{a.navn}</a>
              ))}
            </nav>
          )}


          {/* ── Prissammenligning ──────────────────────────────
              Ingen farveskala uden tal bag. Der staar hvad afvigelsen er,
              hvad den maales mod, og hvor mange boliger medianen er regnet
              af — saa laeseren selv kan afgoere, om tallet betyder noget. */}
          {kvm && afvigelse != null && egenKvm != null && (
            <section className="blok sammenligning" id="kvadratmeterpris">
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
              {/* ── Forbeholdet bliver stående, metoden foldes ─────
                  Blokken skal kunne aflæses på ét blik: afvigelsen, de
                  to beløb og hvor mange boliger medianen er regnet af —
                  de tre står ovenfor og røres ikke. Men den fulde
                  metodetekst er fem linjer, og på en telefon skubbede
                  den resten af siden ned uden at være det, læseren kom
                  efter.

                  Det ENE, der ikke må foldes væk, er forbeholdet om
                  datagrundlaget: et tal, der lyder som en markedspris
                  uden at være det, er præcis den slags påstand, resten
                  af fladen er bygget om at undgå. Det står derfor
                  synligt, og metoden ligger under det.

                  `<details>` og ikke en knap: browseren giver
                  udfoldningen, tastaturet og den rigtige rolle gratis,
                  og den virker uden JavaScript. Samme valg som
                  filtervinduets `<details class="flere">`. */}
              <p className="note">
                Tallet er talt af de boliger, vi har hentet, og er ikke et udtryk
                for hele markedet.
              </p>
              <details className="metode">
                <summary>Sådan beregner vi</summary>
                <div className="metode-krop">
                  <p>
                    Denne bolig: {kr(b.total)} kr. om måneden delt med {b.areal} m²
                    {' = '}
                    {(egenKvm / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })} kr/m²
                    {' '}pr. md.
                  </p>
                  <p>
                    Medianen er regnet af den samlede månedlige betaling til udlejer på
                    de {kvm.antal} boliger i {b.postnr}, vi har hentet, og som oplyser
                    både aconto og areal. Boliger, hvor kun huslejen er kendt, indgår
                    ikke — de ville trække medianen ned og sammenligne to forskellige
                    ting.
                  </p>
                  <p>
                    Grundlaget er dedupet, så den samme bolig annonceret hos to kilder
                    kun tæller én gang. Er der færre end {MINDST_TIL_SAMMENLIGNING} boliger
                    i postnummeret, vises sammenligningen slet ikke: en median af nogle få
                    boliger er ikke en markedspris.
                  </p>
                </div>
              </details>
            </section>
          )}

          <section className="blok" id="boligen">
            <h2>Boligen</h2>
            <dl className="fakta2">
              {b.type && <><dt>Boligtype</dt><dd>{typenavn(b.type)}</dd></>}
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
              <dd>{kildeetiket(b)}</dd>
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
            <section className="blok" id="faciliteter">
              <h2>Faciliteter</h2>
              <ul className="chips">{b.faciliteter.map((f) => <li key={f}>{f}</li>)}</ul>
            </section>
          )}

          {b.beskrivelse && (
            <section className="blok" id="beskrivelse">
              <h2>Beskrivelse</h2>
              <p className="brodtekst">{b.beskrivelse}</p>
              <p className="note">
                Teksten er skrevet ud fra boligens oplysninger — ikke kopieret fra kilden.
              </p>
            </section>
          )}

          <section className="blok" id="beliggenhed">
            <h2>Beliggenhed</h2>
            {b.lat && b.lng ? (
              <>
                {/* ── SAMME kort som ved resultatlisten ──────────────
                    Her stod en `<iframe>` til
                    `openstreetmap.org/export/embed.html`. OSM's egen
                    indlejring renderer i dag med WebGL, og i en browser
                    uden WebGL viste beliggenheden derfor en fejl, mens
                    søgeresultaternes kort — Leaflet med rasterfliser —
                    virkede fint på den samme side.

                    Det var ikke kun en WebGL-sag. Indlejringen var en
                    ANDEN kortløsning end resten af appen, og den brød
                    tre ting, `Landkort.tsx` er bygget til at holde:

                    · Flise-URL'en var hardkodet til openstreetmap.org.
                      Reglen er, at kilden skiftes med
                      `NEXT_PUBLIC_FLISE_URL` og ikke med en
                      kodeændring — Tile Usage Policy afsnit 7 siger, at
                      adgang kan trækkes uden varsel.
                    · Krediteringen lå inde i en fremmed side. Nu er den
                      Leaflets egen, synlig og vores at stå inde for,
                      med «Meld en fejl i kortet» som politikken beder om.
                    · Kortet kunne ikke afprøves i det isolerede
                      testmiljø: det pegede ud af maskinen, mens
                      søgekortet bruger de lokale prøvefliser. Derfor
                      var beliggenheden aldrig målt.

                    Ét mærke, ét svar på «hvordan viser vi et kort». */}
                <div className="landkort">
                  <Landkort
                    etiket={`Kort over ${b.adresse}`}
                    maerker={[{
                      id: b.id,
                      lat: Number(b.lat),
                      lng: Number(b.lng),
                      antal: 1,
                      etiket: b.adresse,
                    }]}
                  />
                </div>
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
