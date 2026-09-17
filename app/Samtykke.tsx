'use client'

// ═══════════════════════════════════════════════════════════════
//  Samtykkebanneret.
//
//  To knapper, samme størrelse, samme vægt, samme kontrast. Ingen
//  forudkrydsning, ingen cookie-mur, ingen «for at give dig den bedste
//  oplevelse». Banneret kan lukkes uden at vælge — det er IKKE samtykke,
//  der sættes ingen identifikator, og boksen kommer igen næste besøg.
//
//  Kategorier: nødvendige (auth, sikkerhed, teknisk funktion) og
//  statistik. Der er ingen marketingkategori, fordi der ikke er nogen
//  marketing at samtykke til.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react'
import { C_SAMTYKKE } from '../lib/samtykke'
import { saetSamtykke } from './samtykkehandling'

export function Samtykke() {
  // Valget laeses i browseren, ikke paa serveren: en cookielaesning i
  // layoutet ville goere hver eneste omraadeside dynamisk og tage dem ud
  // af den statiske gengivelse, SEO-ruterne lever af.
  const [aaben, setAaben] = useState(false)
  const [venter, start] = useTransition()
  const boks = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const valgt = document.cookie.split('; ').some((c) => c.startsWith(`${C_SAMTYKKE}=`))
    if (!valgt) setAaben(true)
  }, [])

  // ── Escape lukker uden at vælge ───────────────────────────────
  //
  //  Samme handling som ×'et: `setAaben(false)`, og INTET andet. Der
  //  sættes ingen cookie, ingen identifikator, og målingen tændes ikke.
  //  Boksen kommer igen næste besøg. En lukning er ikke et svar.
  //
  //  ── HVORFOR DEN IKKE TAGER ESCAPE FRA ANDRE ─────────────────
  //
  //  Lytteren sidder på `document`, og det gør den, fordi banneret skal
  //  kunne lukkes, uanset hvor på siden fokus står. Men så kan den også
  //  komme til at spise et tryk, der var ment for noget andet. To ting
  //  holder den tilbage, og de dækker hver sin slags panel:
  //
  //    · `dialog[open]` — filtervinduet og lysbordet er rigtige modale
  //      dialoger. De lukker sig selv på Escape, men gør det i appen og
  //      ikke i browseren: begge har `onCancel` med `preventDefault()`,
  //      så der er ÉN vej ud gennem deres eget `luk()`. Trykket bobler
  //      alligevel hertil, og det er ikke markeret som brugt.
  //      Vagten holder, fordi rækkefølgen er på vores side: `keydown`
  //      leveres FØR browserens standardhandling, altså før `cancel`
  //      overhovedet fyrer — dialogen står derfor stadig som `open`, når
  //      vi kigger. Er der en åben dialog, er trykket ikke vores.
  //    · `defaultPrevented` — sorteringsmenuen markerer sit eget tryk
  //      (og stopper det oven i købet i bobningen). Markeringen står
  //      her alligevel: den næste, der laver noget, der lukker på
  //      Escape, skal kunne sige fra uden at rette i denne fil.
  //
  //  Mens et valg er undervejs, er knapperne slået fra. Så er Escape
  //  det også — ellers ville boksen forsvinde midt i en handling, der
  //  genindlæser siden bagefter.
  //
  //  ── HVOR FOKUS LANDER, NÅR BOKSEN FORSVINDER ────────────────
  //
  //  Banneret er et `role="dialog"`, og det fjernes fra DOM'en, når det
  //  lukkes. Stod fokus inde i det, falder fokus til <body>: skærm-
  //  læseren siger ingenting om, at dialogen er væk, og næste Tab
  //  begynder forfra i toppen af dokumentet.
  //
  //  Fokus flyttes derfor til det, der kommer EFTER banneret i
  //  rækkefølgen — wordmarket i bjælken — så Tab fortsætter, hvor
  //  boksen slap. Men KUN hvis fokus var inde i boksen: trykker hun
  //  Escape midt nede på siden, skal hun blive, hvor hun er. At rykke
  //  hende til toppen ville være værre end ingenting.
  const luk = () => {
    const iBoksen = boks.current?.contains(document.activeElement)
    setAaben(false)
    if (iBoksen) {
      const naeste = document.querySelector<HTMLElement>('header.top a.maerke')
      naeste?.focus()
    }
  }

  useEffect(() => {
    if (!aaben || venter) return
    const paaTast = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('dialog[open]')) return
      luk()
    }
    document.addEventListener('keydown', paaTast)
    return () => document.removeEventListener('keydown', paaTast)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aaben, venter])

  if (!aaben) return null

  const svar = (v: 'ja' | 'nej') => start(async () => {
    await saetSamtykke(v)
    setAaben(false)
    // GENINDLÆS RUTEN. Uden det tabes den første søgeindsendelse efter et ja.
    //
    // Server action'en sætter KUN samtykkecookien. `bofinda_aid` og
    // `bofinda_sid` sættes af MIDDLEWARE ved næste request, og
    // `maalingstilstand()` kræver begge — så siden står tilbage med
    // `aktiv: false`, klientlytterne i Maaling er aldrig koblet på, og
    // indsendelsen når ikke engang køen. Den er ikke forsinket; den er væk.
    //
    // MÅLT, IKKE FORMODET. Først med en `router.refresh()`: cookierne kom
    // med det samme, men genrenderingen med `aktiv: true` kom senere, og
    // vinduet var 500-1000 ms EFTER at cookien var sat — på denne maskine.
    // En indsendelse i det vindue var stadig tabt. En rettelse, der virker,
    // hvis brugeren er langsom nok, er ikke en rettelse.
    //
    // En fuld genindlæsning lukker vinduet: det nye dokument renderes på
    // serveren MED identiteten, `aktiv` beregnes rigtigt — tændknappen
    // MAALING_AKTIV bliver stadig respekteret — og lytterne kobles på
    // under helt almindelig hydrering. Tilbage er kun det hydreringsvindue,
    // enhver sideindlæsning har, og det er ikke noget samtykket indfører.
    //
    // En GENINDLÆSNING, ikke en omdirigering: `location.reload()` bruger
    // den adresse, der allerede står i linjen. Der er intet mål at
    // validere, ingen vej til et åbent redirect, intet at loope i, og
    // brugerens sti, filtre og sidetal er præcis de samme bagefter.
    //
    // Også ved 'nej': så forsvinder lytterne med det samme dokument i
    // stedet for at hænge til næste navigation. Fravalget bliver
    // stærkere, ikke svagere.
    window.location.reload()
  })

  return (
    <div className="samtykke" role="dialog" aria-label="Statistik" ref={boks}>
      <div className="samtykke-tekst">
        <strong>Må vi måle, hvordan siden bruges?</strong>
        <span>
          Vi tæller søgninger og klik for at gøre boligsøgningen bedre. Målingen
          er vores egen — ingen tredjepart, ingen markedsføring, og vi gemmer
          hverken din mailadresse, din adresse eller det, du skriver i
          søgefeltet. <a href="/privatliv">Sådan behandler vi dine oplysninger</a>.
        </span>
      </div>
      <div className="samtykke-knapper">
        {/* Rækkefølgen er bevidst: afvis står først og er ikke svagere. */}
        <button type="button" onClick={() => svar('nej')} disabled={venter}>
          Kun det nødvendige
        </button>
        <button type="button" onClick={() => svar('ja')} disabled={venter}>
          Tillad statistik
        </button>
      </div>
      <button
        type="button" className="samtykke-luk" aria-label="Luk uden at vælge"
        onClick={luk} disabled={venter}
      >
        ×
      </button>
    </div>
  )
}
