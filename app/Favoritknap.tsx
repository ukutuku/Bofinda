'use client'

// ═══════════════════════════════════════════════════════════════
//  Gem-knappen på et boligkort.
//
//  ═══ HVORFOR DEN LIGGER UDEN FOR KORTETS <a> ═══
//
//  Kortet ER et link. En <button> inde i et <a> er ugyldig HTML, og
//  browserne haandterer det forskelligt — nogle aktiverer linket alligevel.
//  Knappen er derfor en soeskende til linket inde i `.kort-hylster`, lagt
//  oven paa med `position: absolute`. Saa kan et klik ikke naa linket, og
//  linket er uroert: `a.kort[data-bolig]` er stadig den samme selektor,
//  som impression-maalingen i app/Maaling.tsx bygger paa.
//
//  ═══ OPTIMISTISK, MEN MED VEJ TILBAGE ═══
//
//  Knappen skifter med det samme og ruller tilbage, hvis serveren siger
//  noget andet. Serveren er den, der afgoer: den regner skiftet ud fra
//  basen, ikke fra det klienten troede. To faner paa samme bolig kan
//  derfor ikke skubbe hinanden ud af trit.
//
//  ═══ IKKE FARVE ALENE ═══
//
//  Tilstanden staar tre steder: hjertet er fyldt eller tomt (form),
//  knappen har en tydelig ramme naar den er gemt (kontrast), og
//  `aria-label` + `aria-pressed` siger det med ord. En skaerm i graatoner
//  og en skaermlaeser giver det samme svar.
// ═══════════════════════════════════════════════════════════════

import { useState, useTransition } from 'react'
import type { Favoritstatus } from '../lib/favoritter'
import { skiftFavorit } from './min-side/handlinger'

function Hjerte({ fyldt }: { fyldt: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">
      <path
        d="M12 20.3 4.3 12.9a4.7 4.7 0 0 1 0-6.7 4.9 4.9 0 0 1 6.8 0l.9.9.9-.9a4.9 4.9 0 0 1 6.8 0 4.7 4.7 0 0 1 0 6.7Z"
        fill={fyldt ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Dispatcher. De to veje er ADSKILTE komponenter, ikke to grene i én.
 *
 * Ellers ville den udloggede vej kalde `useState` og `useTransition` for
 * ingenting — og den kunne ikke gengives i en proeve, hvor der ikke er
 * nogen React-rod til at holde en transition.
 */
export function Favoritknap({ listingId, status, adresse }: {
  listingId: string
  status: Favoritstatus
  /** Til skærmlæseren, så «Gem» ikke står ni gange uden forskel. */
  adresse?: string
}) {
  return status.logget
    ? <Gemknap listingId={listingId} gemtFra={status.gemt} adresse={adresse} />
    : <Loginvej listingId={listingId} adresse={adresse} />
}

/**
 * Ikke logget ind.
 *
 * Ingen pseudofavoritter i localStorage. En liste, der kun findes i én
 * browser, ser ud som en konto uden at vaere det: den forsvinder ved
 * naeste enhed eller ryddet cache, og brugeren opdager det foerst, naar
 * hun leder efter noget, hun troede var gemt. En aerlig vej til login er
 * bedre end en gemt liste, der ikke findes.
 */
export function Loginvej({ listingId, adresse }: { listingId: string; adresse?: string }) {
  return (
    <a
      className="favoritknap favoritknap-login"
      href={`/min-side?gem=${listingId}`}
      aria-label={adresse ? `Log ind for at gemme ${adresse}` : 'Log ind for at gemme boligen'}
      title="Log ind for at gemme"
    >
      <Hjerte fyldt={false} />
    </a>
  )
}

export function Gemknap({ listingId, gemtFra, adresse }: {
  listingId: string; gemtFra: boolean; adresse?: string
}) {
  const [gemt, setGemt] = useState(gemtFra)
  const [fejl, setFejl] = useState(false)
  const [venter, start] = useTransition()

  const tryk = () => {
    const oensket = !gemt
    setGemt(oensket)          // optimistisk
    setFejl(false)
    start(async () => {
      const svar = await skiftFavorit(listingId)
      // Serverens svar vinder — ogsaa naar det er det samme.
      if ('gemt' in svar) setGemt(svar.gemt)
      else { setGemt(!oensket); setFejl(true) }
    })
  }

  const navn = adresse ?? 'boligen'
  return (
    <button
      type="button"
      className={`favoritknap${gemt ? ' er-gemt' : ''}${fejl ? ' fejlede' : ''}`}
      onClick={tryk}
      disabled={venter}
      aria-pressed={gemt}
      aria-label={gemt ? `Fjern ${navn} fra gemte` : `Gem ${navn}`}
      title={fejl ? 'Kunne ikke gemmes — prøv igen' : gemt ? 'Gemt' : 'Gem'}
    >
      <Hjerte fyldt={gemt} />
    </button>
  )
}
