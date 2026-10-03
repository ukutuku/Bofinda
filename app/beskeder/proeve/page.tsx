// ═══════════════════════════════════════════════════════════════
//  Prøvevisning af beskedmodulet — UDEN FOR produktets ruter.
//
//  ═══ DEN FINDES IKKE I PRODUKTION ═══
//
//  Uden `BESKEDER_PROEVE=1` i miljøet svarer ruten 404 — ikke en tom
//  side, ikke en advarsel: `notFound()`. Variablen sættes kun, når
//  nogen selv starter appen for at se på modulet, og den står ikke i
//  deploykonfigurationen. En prøvevisning, der kunne nås af en kunde,
//  ville være et produkt, ingen har bygget.
//
//  `force-dynamic`, fordi svaret afhænger af miljøet ved KØRSELSTID. En
//  prærendret side ville bære sit svar fra byggetidspunktet.
//
//  ═══ HVAD DEN EFTERPRØVER ═══
//
//  Brugerfladen. Ikke beskedlevering. Der er ingen database, ingen
//  konto, ingen adgangskontrol og intet netværk bag; samtalerne er
//  opdigtede og ligger i hukommelsen. Det står også på siden selv, så
//  et skærmbillede herfra ikke kan forveksles med produktet.
// ═══════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation'
import { Proeve } from './Proeve'
import './proeve.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Prøvevisning — beskeder',
  robots: { index: false, follow: false },
}

export default function Side() {
  if (process.env.BESKEDER_PROEVE !== '1') notFound()

  return (
    <main className="proeve">
      <div className="proeve-banner" role="note">
        <strong>Prøvevisning af brugerfladen.</strong> Samtalerne er opdigtede og
        ligger i hukommelsen. Der er ingen database, ingen konto og ingen
        adgangskontrol bag — og der sendes ingen beskeder til nogen.
        Dette efterprøver <em>brugerfladen</em>, ikke beskedlevering.
      </div>
      <h1 className="proeve-titel">Beskeder</h1>
      <Proeve />
    </main>
  )
}
