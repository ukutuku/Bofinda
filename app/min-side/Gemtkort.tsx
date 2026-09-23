// ═══════════════════════════════════════════════════════════════
//  Ét gemt boligkort paa Min side.
//
//  Ligger i sin EGEN fil og ikke i page.tsx, saa den kan gengives af en
//  proeve uden at trække hele siden — auth-opslag, cookies og
//  soegningslisten — med ind. Prøven i scripts/test-brugeromraade.ts
//  gengiver den med rigtige raekker fra testbasen.
// ═══════════════════════════════════════════════════════════════

import type { GemtBolig } from '../../lib/favoritter'
// Kortet laaner soegekortets egne byggesten frem for at skrive dem af.
// `Ellinje` og `udenSted` er eksporteret netop derfor: en kopi ville
// vaere to rigtige udtryk, der driver fra hinanden.
import { Grundlag, kr, udenSted } from '../Boligkort'
import { billedUrl, breddeTilladt } from '../../lib/billede'
import { eltilstand } from '../../lib/eloplysning'
import { stort, typeord } from '../../lib/boligtype'
import { fjernFraMinSide } from './handlinger'
import { Gemtfoto } from './Gemtfoto'

/** Datoformatet paa Min side. Ét sted, saa gemte boliger og gemte
 *  soegninger ikke skriver den samme slags dato paa to maader. */
export const dato = (d: Date) =>
  d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })

// ─── Gemt bolig ────────────────────────────────────────────────

/**
 * Ét gemt boligkort.
 *
 * ═══ HVORFOR DET ER ET KORT OG IKKE EN RAEKKE ═══
 *
 * Listen var adresse, sted og et tal. Den kunne laeses, men den kunne
 * ikke genkendes: hun har gemt boligerne, fordi hun HUSKER dem, og det
 * hun husker er billedet og stoerrelsen. Kortet viser derfor det samme
 * som soegekortet gjorde, da hun trykkede paa hjertet.
 *
 * ═══ HVAD DET ALDRIG GOER ═══
 *
 * Det opfinder ingenting. Mangler boligtypen, vaerelsestallet eller
 * arealet, udelades leddet — en pladsholder som «— vaer.» ville vaere et
 * opdigtet tal. Mangler billedet, staar der et roligt felt med «Intet
 * billede», ikke et eksempelfoto. Og prisen siger med ord, HVAD tallet
 * er: hele beloebet til udlejeren, eller huslejen alene.
 */
export function Gemtkort({ b }: { b: GemtBolig }) {
  const utilgaengelig = b.status !== 'aktiv'
  // «Forsvundet» er ikke «afmeldt». Raekken i `listings` findes ikke
  // mere, saa hvert eneste felt er null — der er ikke en bolig at tegne,
  // kun en besked om, at den er vaek.
  const forsvundet = b.status === 'forsvundet'

  // ÉN beregning, brugt til BAADE klassen og billedet. Afgjorde `b.forside`
  // klassen og `billedUrl(...)` billedet, ville en vaert uden for
  // allowlisten give en tom billedkolonne og et klemt kort — det er
  // Dacas-fejlen i visuel form, og den fejler ingen steder.
  const foto = b.forside && billedUrl(b.forside, 400)

  // Hvad boligen ER. Samme led, samme raekkefoelge og samme udeladelser
  // som soegekortets overskrift; det er den samme bolig set to steder.
  const overskrift = [
    b.type ? stort(typeord(b.type)!) : null,
    b.vaerelser != null ? `${b.vaerelser} vær.` : null,
    b.areal != null ? `${b.areal} m²` : null,
  ].filter(Boolean).join(' · ')

  // Kildens streng baerer ofte postnummer og by med. Samme trimning som
  // soegekortet — se `udenSted` i app/Boligkort.tsx.
  const adresse = b.adresse ? udenSted(b.adresse, b.postnr, b.by) : null
  const sted = [b.postnr, b.by].filter(Boolean).join(' ')
  const href = `/bolig/${b.listingId}`

  return (
    <li className={`gemt-kort${utilgaengelig ? ' utilgaengelig' : ''}`}>
      {/* ── Billedet ────────────────────────────────────────────
          Feltet staar ALTID og har altid samme forhold. Det holder
          kortene ens hoeje, saa gitteret ikke hakker — og det roelige
          fallback er et valg, ikke et hul.

          `Gemtfoto` er en klientkomponent af én grund: en hentning, der
          fejler, kan kun ses i browseren. Se noten i filen. */}
      <Gemtfoto
        boligId={b.listingId}
        foto={foto}
        srcSet={foto && breddeTilladt(b.forside!, 800)
          ? `${foto} 400w, ${billedUrl(b.forside!, 800)} 800w`
          : undefined}
        /* Kortets bredde, ikke vinduets. Under 620 px staar kortene i
           én spalte inde i `.blok`: 100vw minus rammens 2×22, blokkens
           2×24 og kortets to 1 px kanter. Over 620 px er spalten den
           halve af 880-48 minus mellemrummet. En `sizes`, der lyver om
           bredden, faar browseren til at vaelge den forkerte fil. */
        sizes={foto && breddeTilladt(b.forside!, 800)
          ? '(max-width: 619px) calc(100vw - 94px), 406px' : undefined}
        href={forsvundet ? null : href}
        antal={b.billeder}
        etiket={adresse ?? 'boligen'}
      />

      <div className="gemt-indhold">
        {forsvundet ? (
          <h3 className="gemt-overskrift">Boligen findes ikke længere</h3>
        ) : (
          <>
            <h3 className="gemt-overskrift">{overskrift || 'Bolig'}</h3>
            {/* Adressen ER indgangen til boligen. Klassen `adresse`
                bliver staaende — den er selektoren, favoritregressionen
                laeser listen med. */}
            <a className="adresse" href={href}>{adresse}</a>
            {sted && <p className="gemt-sted">{sted}</p>}
          </>
        )}

        {/* ── Oekonomien ───────────────────────────────────────
            Skellet mellem huslejen og hele beloebet til udlejeren siges
            med ORD, ikke med farve alene. «Til udlejer» er sandt, uanset
            om el er oplyst; «i alt» ville det ikke vaere.
            Ingen oekonomi paa en forsvundet bolig — der er ingen kilde
            tilbage at tilskrive et tal. */}
        {!forsvundet && (
          <div className="gemt-oekonomi">
            {b.total != null ? (
              <p className="gemt-pris">{kr(b.total)} <small>kr/md til udlejer</small></p>
            ) : b.leje != null ? (
              <p className="gemt-pris kun-leje">{kr(b.leje)} <small>kr/md i husleje</small></p>
            ) : (
              /* Et beloeb, vi ikke har, staar som ord. En tankestreg
                 ville se ud som et tal, der var ved at blive hentet. */
              <p className="gemt-pris ingen-pris">Prisen er ikke oplyst</p>
            )}

            {/* ÉN grundlagslinje, som paa begge soegekort — samme
                komponent, samme regel, ét sted. Den afloeste den gule
                aconto-boks OG el-linjen; se lib/grundlag.ts.

                Er HVERKEN total eller husleje kendt, staar der ingen
                linje: prislinjen ovenfor har allerede sagt «Prisen er
                ikke oplyst», og to forbehold oven i hinanden hjaelper
                ingen. Det var ogsaa den gamle regel. */}
            {(b.total != null || b.leje != null) && (
              <Grundlag
                totalKendt={b.total != null}
                el={eltilstand(b)}
                poster={b.poster}
              />
            )}

            {/* Kildens forbehold hoerer til ved billedet — men vises kun,
                naar der ER et billede at tage forbehold for. */}
            {b.billedforbehold && foto && (
              <p className="billedforbehold">
                Udlejer oplyser: billederne kan være fra en anden bolig
              </p>
            )}
          </div>
        )}

        {/* En bolig, der er taget ned, forsvinder ikke fra listen. Hun har
            selv lagt den der; forsvandt den af sig selv, kunne hun ikke
            vide, om hun kom til at fjerne den. Der staar hvad der skete,
            og hun kan stadig fjerne den selv. */}
        {b.status === 'afmeldt' && (
          <p className="gemt-status">
            <strong>Ikke længere tilgængelig.</strong> Kilden har taget annoncen
            ned, siden du gemte den. Boligsiden kan stadig åbnes.
          </p>
        )}
        {forsvundet && (
          <p className="gemt-status">
            <strong>Annoncen er væk.</strong> Vi har ikke længere oplysninger om
            den. Du kan fjerne den fra listen.
          </p>
        )}

        {/* ── Foden ────────────────────────────────────────────
            Hvornaar hun gemte den, hvem der annoncerer den, og vejen ud
            igen. Alt tre er SEKUNDAERT: det er baggrundsstof om kortet,
            ikke om boligen. Derfor nederst, i mindste vaegt og adskilt
            af en linje.

            Fjern er stadig en rigtig <button> i en <form> — ingen
            JavaScript, tastatur virker af sig selv, og navnet siger
            HVILKEN bolig den fjerner, saa ti knapper ikke lyder ens.
            Den synlige tekst «Fjern» staar foerst i navnet, saa
            talestyring kan ramme den med det, der staar paa den. */}
        <div className="gemt-fod">
          <p className="gemt-spor">
            gemt {dato(b.gemtDen)}
            {b.kilde && <> · {b.kilde}</>}
          </p>
          <form action={fjernFraMinSide}>
            <input type="hidden" name="bolig" value={b.listingId} />
            <button className="nulstil gemt-fjern" type="submit"
              aria-label={adresse
                ? `Fjern ${adresse} fra gemte boliger`
                : 'Fjern boligen fra gemte boliger'}>
              Fjern
            </button>
          </form>
        </div>
      </div>
    </li>
  )
}

