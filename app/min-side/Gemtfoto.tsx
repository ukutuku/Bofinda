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

import { useEffect, useRef, useState } from 'react'

export function Gemtfoto({ foto, srcSet, sizes, href, antal }: {
  /** Den signerede proxy-adresse, eller null naar der ikke er et billede
   *  vi kan vise. Beregnes ÉT sted i `Gemtkort` og bruges baade til
   *  klassen og til billedet. */
  foto: string | null
  srcSet?: string
  sizes?: string
  href: string | null
  antal: number
}) {
  const [fejlet, setFejlet] = useState(false)
  const ref = useRef<HTMLImageElement>(null)

  // `onError` alene er ikke nok, og grunden er tidslig: siden gengives
  // paa serveren, browseren henter billedet med det samme, og
  // hentningen kan vaere fejlet FOER React har hydreret og sat sin
  // lytter paa. Saa fyrer `onError` aldrig, og feltet staar tilbage med
  // Chromes eget brudt-billede-ikon — netop dét, vi maalte i et
  // skaermbillede, foer den her linje kom til.
  //
  // `complete` er true ogsaa for en FEJLET hentning; det er
  // `naturalWidth === 0`, der skiller de to. Er billedet stadig
  // undervejs — eller ikke begyndt, fordi det er `loading="lazy"` og
  // uden for skaermen — er `complete` false, og saa er `onError` den,
  // der svarer. De to daekker hver sin halvdel af det samme spoergsmaal.
  useEffect(() => {
    const i = ref.current
    if (i && i.complete && i.naturalWidth === 0) setFejlet(true)
  }, [])

  const vis = Boolean(foto) && !fejlet

  return (
    <div className={`gemt-foto${vis ? '' : ' uden-foto'}`}>
      {vis && href ? (
        /* Linket er en genvej for musen. Adressen i kroppen er den
           rigtige indgang: den har teksten, den har fokusringen, og den
           er ét tabstop. To links til det samme sted ville laese som to
           forskellige boliger for en skaermlaeser. */
        <a href={href} aria-hidden="true" tabIndex={-1} className="gemt-fotolink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} src={foto!} srcSet={srcSet} sizes={sizes} alt="" loading="lazy"
            onError={() => setFejlet(true)} />
          {antal > 1 && <span className="gemt-antal">{antal} billeder</span>}
        </a>
      ) : (
        <span className="gemt-intetfoto">
          {fejlet ? 'Billedet kunne ikke hentes' : 'Intet billede'}
        </span>
      )}
    </div>
  )
}
