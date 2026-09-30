'use client'

// ═══════════════════════════════════════════════════════════════
//  Billedfeltet på et gemt kort.
//
//  ═══ HVORFOR DEN ER EN KLIENTKOMPONENT ═══
//
//  Der er TO måder, et billede kan udeblive på, og kun den ene kan ses
//  på serveren:
//
//      ingen URL, eller en vaert uden for allowlisten
//          `billedUrl()` giver null. Serveren ved det og tegner feltet.
//
//      URL'en er god, men hentningen fejler
//          Det sker foerst i browseren. Serveren har ingen mulighed for
//          at vide det.
//
//  Vi proevede at lade CSS klare begge: fallback'et som baggrund under
//  billedet, saa et `img` med tom `alt` bare ville vaere gennemsigtigt.
//  Maalt i Chrome er det ikke sandt — den tegner sit eget lille
//  brudt-billede-ikon oven i feltet, ogsaa med tom `alt`. Et graat
//  ikon i et ellers tomt felt er praecis det uroligige, fallback'et
//  skulle fjerne. Derfor `onError`, og derfor de faa linjer tilstand.
//
//  ═══ OG DE TO SIGER IKKE DET SAMME ═══
//
//  «Intet billede» og «billedet kunne ikke hentes» er to forskellige
//  udsagn. Kilden har ingen billeder — eller den har, og vi naaede dem
//  ikke lige nu. At skrive det foerste om det andet ville vaere en
//  paastand om kilden, vi ikke har daekning for. Samme skel som el-
//  forbeholdets «indgaar ikke» og «vi ved ikke hvad der er i tallet».
// ═══════════════════════════════════════════════════════════════

import {
  BILLEDE_FEJLEDE, Bladrepile, INTET_BILLEDE, useBladring,
} from '../Billedbladring'

export function Gemtfoto({ boligId, foto, srcSet, sizes, href, antal, etiket }: {
  /** Boligen, de øvrige billeder hentes for. */
  boligId: string
  /** Den signerede proxy-adresse, eller null naar der ikke er et billede
   *  vi kan vise. Beregnes ÉT sted i `Gemtkort` og bruges baade til
   *  klassen og til billedet. */
  foto: string | null
  srcSet?: string
  sizes?: string
  href: string | null
  antal: number
  /** Navngiver boligen i pilenes etiketter. */
  etiket: string
}) {
  // Tilstanden, hentningen, svirpet og eftersynet ved montering ligger i
  // `useBladring` — det samme sted, søgekortene spørger. Noten ovenfor om
  // `onError` og hydrering gælder stadig; den er bare flyttet derhen,
  // hvor svaret gives, så de to flader ikke kan drive fra hinanden.
  const b = useBladring({ boligId, forside: foto, forsideSrcSet: srcSet, sizes, antal })
  const vis = Boolean(foto) && !b.fejlet

  return (
    <div className={`gemt-foto${vis ? '' : ' uden-foto'}`} {...b.flade}>
      {vis && href ? (
        /* Linket er en genvej for musen. Adressen i kroppen er den
           rigtige indgang: den har teksten, den har fokusringen, og den
           er ét tabstop. To links til det samme sted ville laese som to
           forskellige boliger for en skaermlaeser.
           PILENE LIGGER UDEN FOR DET: et fokuserbart element inde i et
           `aria-hidden`-undertrae er skjult for skaermlaeseren og
           naabart med Tab paa én gang. */
        <a href={href} aria-hidden="true" tabIndex={-1} className="gemt-fotolink"
          {...b.linkvagt}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.src} srcSet={b.srcSet} sizes={sizes} alt="" loading="lazy"
            {...b.billedvagt} />
          {b.taeller && <span className="gemt-antal">{b.taeller}</span>}
        </a>
      ) : (
        <span className="gemt-intetfoto">
          {b.fejlet ? BILLEDE_FEJLEDE : INTET_BILLEDE}
        </span>
      )}
      {/* PILENE BLIVER, OGSÅ NÅR ET BILLEDE FEJLEDE.
          Stod der `vis &&`, ville ét billede, der ikke kunne hentes,
          fjerne både billedet OG vejen videre — og så var kortet låst
          fast på præcis det billede, der ikke virker. Betingelsen er
          derfor, om der ER noget at bladre i: `taeller` er tom ved ét
          billede og ved intet billede, og det er det rigtige svar begge
          steder. */}
      {b.taeller && <Bladrepile b={b} etiket={etiket} />}
    </div>
  )
}
