'use client'

// ═══════════════════════════════════════════════════════════════
//  Boligkortets skal: linket, billedfeltet og pilene.
//
//  ═══ HVORFOR KORTET SKAL HAVE EN KLIENTSKAL ═══
//
//  Pilene skifter billedet. Billedet ligger inde i kortets `<a>`, og
//  pilene må IKKE ligge der: en `<button>` i et `<a>` er ugyldig HTML,
//  browserne håndterer det forskelligt, og `kortkontrol.mjs` afviser
//  hvert eneste fokuserbart element inde i `a.kort`. De to skal altså
//  dele tilstand hen over en DOM-grænse, og det kan kun ét fælles
//  ophav gøre. Derfor tegner skallen HER både linket og pilene, mens
//  kortets krop kommer ind som `children` fra serveren — den er stadig
//  serverkode og bliver ikke til klientbundt.
//
//  ═══ HVAD DER IKKE MÅ ÆNDRE SIG ═══
//
//  · `<a class="kort …">` med `class` FØRST — `test-redigering.ts`
//    finder kortet med `indexOf('<a class="kort')`.
//  · Linkets direkte børn er præcis `kort-billedblok` og `kort-krop`.
//  · Præcis ÉT `<img>` i `.kort-billede`. Billedet skiftes med `src`,
//    ikke ved at stable slides: et spor på N × 100 % ville gøre et barn
//    bredere end kortet, og det afviser `kortkontrol.mjs` også.
//  · `data-bolig` én gang pr. kort.
// ═══════════════════════════════════════════════════════════════

import type { ReactNode } from 'react'
import { BILLEDE_FEJLEDE, Bladrepile, useBladring } from './Billedbladring'

export interface Kortbillede {
  /** Boligen, billederne hentes for. På et gruppekort: REPRÆSENTANTENS. */
  boligId: string
  /** Forsidens signerede adresse, allerede skåret til 400 px. */
  forside: string
  srcSet?: string
  sizes?: string
  /** Antal visbare billeder. Under 2 vises hverken pile eller tæller. */
  antal: number
}

export function Bladrekort({
  klasse, href, id, data, billede, maerkat, forbehold, etiket, children,
}: {
  klasse: string
  href: string
  id: string
  data: Record<string, string | number | undefined>
  /** null = ingen forside, vi kan vise. Så er der intet billedfelt. */
  billede: Kortbillede | null
  maerkat: ReactNode
  forbehold: ReactNode
  /** Navngiver boligen i pilenes etiketter. */
  etiket: string
  children: ReactNode
}) {
  const b = useBladring({
    boligId: billede?.boligId ?? '',
    forside: billede?.forside ?? null,
    forsideSrcSet: billede?.srcSet,
    sizes: billede?.sizes,
    antal: billede?.antal ?? 0,
  })

  return (
    <>
      <a
        className={klasse}
        href={href}
        // Landkortet peger paa kortet med id'et og laeser data-bolig, naar
        // musen er over. De to skal vaere den samme noegle som maerket.
        id={id}
        data-bolig={data.bolig}
        data-kilde={data.kilde}
        data-position={data.position}
        data-gruppe={data.gruppe}
        data-gruppe-antal={data.gruppeAntal}
        // Et svirp må ikke åbne annoncen. Vagten ligger på LINKET og ikke
        // på billedet: klikket bobler op hertil, og det er her, det skal
        // stoppes, hvis det var enden på en vandret bevægelse.
        {...b.linkvagt}
      >
        {/* Billedet og forbeholdet er ÉT gitterfelt. Var forbeholdet et felt
            for sig, skubbede det kroppen en raekke ned — se .kort-billedblok
            i globals.css. */}
        {billede && (
          <div className="kort-billedblok">
            <div className={`kort-billede${b.fejlet ? ' billede-fejlede' : ''}`} {...b.flade}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* 800 tilbydes KUN, hvis vaerten maa levere den. `billedUrl`
                  skaerer stille ned til naermeste tilladte bredde i
                  BREDDER_PR_VAERT — den returnerer ikke null og fejler ikke.
                  Uden vagten ville en vaert med et loft paa 400 faa den
                  SAMME fil udpeget som baade «400w» og «800w», og browseren
                  ville straekke 400 px op paa en taet skaerm. En deskriptor,
                  der lyver om filens bredde, er vaerre end ingen deskriptor. */}
              <img src={b.src} srcSet={b.srcSet} sizes={billede.sizes}
                alt="" loading="lazy" {...b.billedvagt} />
              {/* Ét maerkat paa fotoet. Uden et foto er der ingen flade
                  at ligge paa, og saa staar det oeverst i kroppen — samme
                  udtryk, ét sted i koden. */}
              {maerkat && <div className="kort-maerkater">{maerkat}</div>}
              {b.taeller && <span className="kort-antal">{b.taeller}</span>}
              {/* Den eksisterende reserve: rammens egen flade. Billedet
                  bliver stående i DOM'en — `.kort-billede` skal indeholde
                  præcis ét `<img>` — men det tegnes ikke, og feltet siger
                  hvad der skete i stedet for at vise browserens brudte
                  billede. Samme skel som på Gemte boliger: «intet billede»
                  og «billedet kunne ikke hentes» er to forskellige udsagn. */}
              {b.fejlet && <span className="billede-fejl">{BILLEDE_FEJLEDE}</span>}
            </div>
            {forbehold}
          </div>
        )}
        {children}
      </a>
      {/* UDEN FOR LINKET. Se noten i toppen af filen. */}
      <Bladrepile b={b} etiket={etiket} />
    </>
  )
}
