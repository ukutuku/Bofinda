// ═══════════════════════════════════════════════════════════════
//  Annoncen, som rejsen begynder ved.
//
//  Ingen hooks, ingen `'use client'` — den er ren visning og kan
//  gengives fra en serverkomponent.
//
//  Kortet påstår KUN det, annoncen har med. Er stedet ikke oplyst,
//  står der ikke et tomt felt; er annonceringsdatoen ukendt, skrives
//  den ikke. Ingen pladsholdere, ingen opdigtede tal — samme regel som
//  boligkortene.
//
//  Kildemærket står KUN på en ekstern annonce. På en udlejerannonce er
//  svaret ikke kildens navn: der ER ingen kilde.
// ═══════════════════════════════════════════════════════════════

import { siden } from '../../lib/dato'
import type { Annonce } from './kontrakt'

export function Annoncekort({ annonce }: { annonce: Annonce }) {
  return (
    <article className="kui-annonce">
      <div className="kui-annonce-hoved">
        <h2 className="kui-annonce-titel">{annonce.overskrift}</h2>
        {annonce.slags === 'ekstern' && (
          <span className="kui-kilde">{annonce.kilde}</span>
        )}
      </div>
      <p className="kui-adresse">
        {annonce.adresse}
        {annonce.sted && <span className="kui-sted"> · {annonce.sted}</span>}
      </p>
      <p className="kui-annonce-fod">
        {annonce.slags === 'native'
          ? `Oprettet af udlejeren selv på Bofinda ${siden(new Date(annonce.setAfOs))}.`
          : [
            annonce.annonceret
              ? `Annonceret ${siden(new Date(annonce.annonceret))}`
              : 'Annonceret på ukendt tidspunkt',
            `set af os ${siden(new Date(annonce.setAfOs))}`,
          ].join(' · ') + '.'}
      </p>
    </article>
  )
}
