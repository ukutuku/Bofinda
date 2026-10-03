// ═══════════════════════════════════════════════════════════════
//  Prøvevisning af kontaktrejsen — UDEN FOR produktets ruter.
//
//  ═══ DEN FINDES IKKE I PRODUKTION ═══
//
//  Uden `KONTAKT_PROEVE=1` i miljøet svarer ruten 404 — ikke en tom
//  side, ikke en advarsel: `notFound()`. Variablen sættes kun, når
//  nogen selv starter appen for at se på rejsen, og den står ikke i
//  deploykonfigurationen. Samme spærring som
//  `/beskeder/proeve` og `BESKEDER_PROEVE`.
//
//  `force-dynamic`, fordi svaret afhænger af miljøet ved KØRSELSTID. En
//  prærendret side ville bære sit svar fra byggetidspunktet.
//
//  ═══ INTET ER TILSLUTTET PRODUKTIONSRUTERNE ═══
//
//  Hverken boligsiden, betalingen eller beskedruten kender til den her.
//  Der er ingen afsendelse, ingen kontooprettelse og ingen betaling —
//  alle handlinger er simulerede, og alle oplysninger er opdigtede.
// ═══════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation'
import { Proeve } from './Proeve'
import '../../beskeder/proeve/proeve.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Prøvevisning — kontakt og beskeder',
  robots: { index: false, follow: false },
}

export default function Side() {
  if (process.env.KONTAKT_PROEVE !== '1') notFound()

  return (
    <main className="proeve">
      <div className="proeve-banner" role="note">
        <strong>Prøvevisning af brugerfladen.</strong> Annoncer,
        kontaktoplysninger og samtaler er opdigtede og ligger i hukommelsen.
        Der er ingen database, ingen konto, ingen betaling og ingen
        adgangskontrol bag — og der sendes ingen beskeder til nogen.
        Dette efterprøver <em>brugerfladen</em>, ikke kontakt eller betaling.
      </div>
      <h1 className="proeve-titel">Fra annonce til besked</h1>
      <Proeve />
    </main>
  )
}
