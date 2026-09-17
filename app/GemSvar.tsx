'use client'

// ═══════════════════════════════════════════════════════════════
//  Svaret paa en gemt soegning — og hvorfor det faar fokus.
//
//  Indsendelsen ender i en omdirigering, altsaa en HEL sideindlaesning.
//  Foer denne komponent stod svaret bare i markuppen dér, hvor boksen
//  ligger: maalt 7.921 px nede i dokumentet, i et vindue paa 800 px.
//  Fokus stod paa <body> i toppen. Altsaa: brugeren trykker «Send mig
//  besked», siden blinker, og der sker tilsyneladende ingenting —
//  hverken for den, der ser, eller for den, der lytter.
//
//  ── HVORFOR FOKUS OG IKKE BARE ET LEVENDE OMRAADE ────────────
//
//  Et `aria-live`-omraade annoncerer AENDRINGER i noget, der allerede
//  stod i tilgaengelighedstraeet. Her er beskeden med fra foerste byte
//  af det nye dokument — den aendrer sig aldrig. Skaermlaesere laeser
//  derfor ikke paalideligt et levende omraade, der er til stede ved
//  indlaesning. Det, der VIRKER, er at flytte fokus: et fokusskift
//  laeses op, hver gang.
//
//  Rollen staar alligevel. Den koster ingenting, og den er rigtig, hvis
//  beskeden en dag kommer uden en ny sideindlaesning. `alert` til fejl,
//  `status` til kvitteringen — det er forskellen paa «du skal gribe ind»
//  og «det gik godt».
//
//  Rullningen er sin egen linje, og fokus tages UDEN rulning bagefter.
//  `focus()` alene ruller ogsaa, men til naermeste kant; beskeden vil
//  staa midt i billedet, ikke klemt i underkanten.
//
//  ── HVORFOR EFFEKTEN IKKE HAR EN AFHAENGIGHEDSLISTE ──────────
//
//  Den havde `[]`, altsaa «koer ved montering». Det er forkert her, og
//  det blev MAALT: foerste indsendelse virkede, den anden gjorde ikke.
//
//  `redirect()` i en Server Action laver en BLOED navigation — dokumentet
//  genindlaeses ikke. Foerste gang gaar GemSvar fra ikke-gengivet til
//  gengivet, saa den monteres, og effekten koerer. Anden gang staar
//  komponenten allerede dér, saa React OPDATERER den i stedet, og en
//  effekt med `[]` koerer ikke igen. Maalt: efter anden indsendelse blev
//  fokus staaende paa «Send mig besked», og beskeden blev ikke laest op.
//
//  En `key` ville heller ikke hjaelpe: to indsendelser i traek med samme
//  fejl giver samme vaerdi, og saa genmonteres der ingenting.
//
//  Uden liste koerer effekten efter hver gengivelse af GemSvar — og en
//  gengivelse sker her kun, naar serveren sender et nyt svar. `gemt`
//  fjernes fra alle adresser paa siden (se app/page.tsx), saa enhver
//  ANDEN navigation tager beskeden helt ud af traeet i stedet for at
//  gengive den. Et nyt svar er altsaa den eneste vej hertil.
//  scripts/cloud/tastaturkontrol.mjs indsender to gange og maaler, at
//  fokus flytter begge gange — uden den proeve er den her note bare en
//  paastand.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, type ReactNode } from 'react'

export function GemSvar({ id, fejl, children }: {
  id: string
  /** Fejl = noget skal gøres om. Kvittering = det gik godt. */
  fejl: boolean
  children: ReactNode
}) {
  const boks = useRef<HTMLDivElement>(null)

  // Med vilje UDEN afhaengighedsliste — se noten oeverst.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = boks.current
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
  })

  return (
    <div
      ref={boks}
      id={id}
      // `-1`: den kan faa fokus af os, men ligger ikke i
      // tabulatorraekkefoelgen bagefter. Beskeden er ikke en kontrol.
      tabIndex={-1}
      role={fejl ? 'alert' : 'status'}
      className={`gem-svar ${fejl ? 'advarsel' : 'ok'}`}
    >
      {children}
    </div>
  )
}
