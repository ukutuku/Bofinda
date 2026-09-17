'use client'

// ═══════════════════════════════════════════════════════════════
//  Sorteringsmenuen.
//
//  Den ER et `<details>`, og det skal den blive: knappen virker uden
//  JavaScript, valgene er almindelige links med rigtige adresser, og
//  tilstanden ligger i URL'en som alt andet paa siden.
//
//  Men et `<details>` er en UDFOLDNING, og denne her er tegnet som en
//  MENU: `.sortering-valg` er `position: absolute; z-index: 30` og
//  ligger oven paa indholdet. Forskellen er ikke kosmetisk. En
//  udfoldning skubber siden og kan blive staaende uden at genere nogen.
//  Et svaevende panel daekker noget, og saa skal der vaere en vej ud.
//
//  Der var ingen. Maalt paa 1440, 768, 390 og ved 200 % zoom:
//
//    ✗ Escape        — menuen blev staaende
//    ✗ Tab ud af den — menuen blev staaende
//    ✗ klik udenfor  — menuen blev staaende
//
//  Eneste vej tilbage var at tabulere tilbage til knappen og trykke
//  igen. Panelet daekkede «Søg →», overskriftsraekken og en del af
//  kortet imens.
//
//  ── DE TRE VEJE UD, OG HVEM DER FAAR FOKUS ───────────────────
//
//  Escape er en fortrydelse: brugeren staar i menuen og vil ud af den,
//  saa fokus skal tilbage til udloeseren — ellers taber hun sin plads
//  paa siden.
//
//  Tab og et klik udenfor er det modsatte: hun er allerede paa vej et
//  andet sted hen. At traekke fokus tilbage til knappen dér ville
//  afbryde den bevaegelse, hun selv har startet. Menuen lukker; fokus
//  bliver, hvor hun satte det.
//
//  ── HVORFOR LYTTEREN ER NATIV OG IKKE REACTS ─────────────────
//
//  `keydown` bindes paa elementet selv med `addEventListener`, ikke som
//  `onKeyDown`. Grunden er samtykkebanneret: det lytter paa `document`
//  for at kunne lukkes med Escape, og de to maa ikke fyre paa det samme
//  tryk. En native lytter paa `<details>` kan stoppe bobningen, foer den
//  naar `document`. Reacts egne lyttere sidder paa roden — altsaa
//  MELLEM os og document — og `stopPropagation` derfra er en aftale
//  mellem React og React, ikke en spaerring i DOM'en.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, type ReactNode } from 'react'

export function Sorteringsmenu({ etiket, children }: {
  /** Teksten paa <summary> — «Sortér: Nyeste». */
  etiket: ReactNode
  /** Selve valgene. Almindelige links, gengivet paa serveren. */
  children: ReactNode
}) {
  const boks = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const d = boks.current
    if (!d) return

    const luk = (tilbageTilKnappen: boolean) => {
      if (!d.open) return
      d.open = false
      if (tilbageTilKnappen) d.querySelector('summary')?.focus()
    }

    const paaTast = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !d.open) return
      // Baade `preventDefault` og `stopPropagation`: den foerste siger
      // til andre lyttere, at trykket er brugt; den anden sikrer, at de
      // slet ikke ser det.
      e.preventDefault()
      e.stopPropagation()
      luk(true)
    }

    // `pointerdown` og ikke `click`: et klik paa et link udenfor kan
    // naa at navigere foerst, og saa lukker vi en menu paa en side, der
    // allerede er paa vej vaek.
    const paaPeg = (e: PointerEvent) => {
      if (!d.open) return
      const maal = e.target as Node | null
      if (maal && d.contains(maal)) return
      luk(false)
    }

    // Fokus forlod menuen. `relatedTarget` er det, fokus gaar TIL — er
    // den null (fokus faldt ud af dokumentet eller til <body>), er den
    // ogsaa ude.
    const paaUd = (e: FocusEvent) => {
      const til = e.relatedTarget as Node | null
      if (til && d.contains(til)) return
      luk(false)
    }

    d.addEventListener('keydown', paaTast)
    d.addEventListener('focusout', paaUd)
    document.addEventListener('pointerdown', paaPeg)
    return () => {
      d.removeEventListener('keydown', paaTast)
      d.removeEventListener('focusout', paaUd)
      document.removeEventListener('pointerdown', paaPeg)
    }
  }, [])

  return (
    <details className="sortering" ref={boks}>
      <summary>{etiket}</summary>
      {children}
    </details>
  )
}
