'use client'

// ═══════════════════════════════════════════════════════════════
//  Filtervinduet.
//
//  EN OPGRADERING, IKKE EN AFHÆNGIGHED. Uden JavaScript er `?flere=1`
//  stadig det, der åbner vinduet, præcis som før: serveren renderer
//  <dialog open>, indholdet står i siden, «Vis resultater» indsender
//  formularen, og «Luk» er et almindeligt link tilbage til den samme
//  søgning uden `flere`. Alt virker.
//
//  Med JavaScript bliver den samme <dialog> åbnet med `showModal()`, og
//  så følger tre ting med, som ingen CSS kan give: Escape lukker,
//  fokus fanges inde i vinduet, og fokus vender tilbage til knappen,
//  der åbnede det. Browseren gør det; vi skriver det ikke selv.
//
//  TO KOMPONENTER, IKKE ÉN. Knappen står i søgelinjen, vinduet EFTER
//  den — og rækkefølgen i DOM'en er ikke et layoutvalg. Formularens
//  standardknap er den FØRSTE submit-knap i træet, og lå vinduet inde i
//  søgelinjen, var det «Vis resultater» inde i et lukket vindue. Enter i
//  søgefeltet ramte altså en knap, ingen kunne se. Det gjorde det samme
//  — begge indsender formularen — men en prøve, der klikker på «den
//  første submit-knap», ventede i tyve sekunder på et element, der
//  aldrig blev synligt. Med vinduet efter bjælken er standardknappen
//  «Søg», og tastaturets orden følger den, øjet ser.
//
//  De to taler sammen gennem faste id'er og ikke gennem en context:
//  det er ét vindue på siden, og en context ville være tre filer og en
//  udbyder for at flytte en `showModal()`.
//
//  KLADDEN ER GRATIS. En GET-formular ændrer ingenting, før den
//  indsendes — så «ændringer er kladde indtil Vis resultater» er ikke
//  noget, vi skal bygge, men noget vi skal lade være med at ødelægge.
//  Det eneste, vi selv gør, er at nulstille felterne ved lukning: uden
//  det ville en forladt kladde stå og se ud som den gældende søgning,
//  næste gang vinduet åbnes.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'

/** Faste id'er: knappen og vinduet skal kunne finde hinanden uden en
 *  context, og fokus skal kunne vende tilbage til netop den knap. */
const KNAP_ID = 'filterknap'
const DIALOG_ID = 'filterdialog'

/**
 * Knappen i søgelinjen.
 *
 * Et LINK og ikke en knap: `?flere=1` er den vej ind, der virker uden
 * JavaScript, og et link kan åbnes i en ny fane. Med JavaScript holdes
 * navigationen tilbage, og vinduet åbnes modalt i stedet.
 */
export function Filterknap({ aabnHref, etiket, antal }: {
  aabnHref: string; etiket: string; antal: number
}) {
  const [klar, setKlar] = useState(false)
  useEffect(() => { setKlar(true) }, [])
  return (
    <a
      id={KNAP_ID}
      className={antal > 0 ? 'filterknap har-filtre' : 'filterknap'}
      href={aabnHref}
      aria-haspopup="dialog"
      aria-controls={DIALOG_ID}
      onClick={(e) => {
        // Først når React har overtaget, må knappen holde navigationen
        // tilbage. Sker det før, kan et klik i det sekund, siden
        // hydrerer, ramme en knap, der hverken navigerer eller åbner.
        if (!klar) return
        const d = document.getElementById(DIALOG_ID) as HTMLDialogElement | null
        if (!d) return
        e.preventDefault()
        d.showModal()
      }}
    >
      <span className="fk-ikon" aria-hidden="true" />
      {etiket}
      {antal > 0 && <span className="fk-tal">{antal}</span>}
    </a>
  )
}

export function Filterdialog({
  aaben, lukHref, children, fod,
}: {
  /** Serverens tilstand: `?flere=1`. Uden JS er det den eneste. */
  aaben: boolean
  /** Samme søgning uden `flere` — lukningen, der virker uden JS. */
  lukHref: string
  /** Det rullende indhold: filtrene selv. */
  children: React.ReactNode
  /** Den faste bund: «Ryd filtre» og «Vis resultater». Et eget felt og
   *  ikke en del af `children`, fordi den skal ligge UDEN FOR den
   *  rullende kasse — ellers ruller knapperne væk, netop når listen er
   *  lang nok til, at man har brug for dem. */
  fod: React.ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [klar, setKlar] = useState(false)
  useEffect(() => { setKlar(true) }, [])
  const tilKnappen = () => document.getElementById(KNAP_ID)?.focus()

  // Serveren renderede <dialog open> — altså IKKE modal: ingen backdrop,
  // ingen fokusfælde, ingen Escape. Den lukkes og åbnes igen som modal,
  // så de tre ting gælder fra første øjeblik.
  useEffect(() => {
    const d = dialog.current
    if (!d || !klar) return
    if (aaben && !d.open) d.showModal()
    else if (aaben && d.open) { d.close(); d.showModal() }
  }, [klar, aaben])

  const luk = () => {
    const d = dialog.current
    if (!d) return
    // Felterne tilbage til det, søgningen FAKTISK er sat til. `reset()`
    // sætter dem til deres `defaultValue`, og den kommer fra de gældende
    // filtre — så en forladt kladde ikke overlever som noget, der ligner
    // en gældende søgning.
    d.closest('form')?.reset()
    d.close()
  }

  return (
      <dialog
        ref={dialog}
        id={DIALOG_ID}
        className="filterdialog"
        open={aaben || undefined}
        aria-label="Filtre"
        // Escape udløser `cancel` før `close`. Uden den her ville
        // felterne blive stående som kladde efter en Escape, mens de
        // nulstilles ved et klik på «Luk» — to veje ud, to udfald.
        onCancel={(e) => { e.preventDefault(); luk() }}
        onClose={tilKnappen}
      >
        <div className="fd-ramme">
          <div className="fd-hoved">
            <h2>Filtre</h2>
            <a
              className="fd-luk" href={lukHref} aria-label="Luk filtre"
              onClick={(e) => { if (klar && dialog.current) { e.preventDefault(); luk() } }}
            >
              <span aria-hidden="true">×</span>
            </a>
          </div>
          <div className="fd-krop">{children}</div>
          <div className="fd-fod">{fod}</div>
        </div>
      </dialog>
  )
}
