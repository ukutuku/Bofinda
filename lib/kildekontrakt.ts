// ═══════════════════════════════════════════════════════════════
//  Kildekontrakten.
//
//  Adapteren svarer på ét spørgsmål:      «Hvad sagde kilden?»
//  Kontrakten svarer på et andet:         «Hvad må Bofinda udlede?»
//
//  Uden den skillelinje ender vi med syv forskellige fortolkninger af
//  «ledig», gemt i syv adaptere. Vi har allerede set to af dem gå hver sin
//  vej: Balder frasorterer «Reserveret», Propstep lader den passere som
//  almindelig bolig. Samme begreb, modsat behandling, ingen af stederne
//  skrevet ned.
//
//  GRUNDREGLEN: alt, der ikke er dækket af positiv, dokumenteret evidens,
//  er ukendt. Fravær af oplysning bliver hverken positiv eller negativ
//  oplysning. Propsteps `onWaitingListSince === null` er ikke bevis for
//  almindelig ansøgning — det er fravær af bevis for venteliste.
// ═══════════════════════════════════════════════════════════════

import type { AvailabilityFacts } from './adapter'

// ─── Belæg ─────────────────────────────────────────────────────

/**
 * Hvad en fortolkning hviler på.
 *
 * `hvor` og `naar` er der, fordi en påstand ellers ikke kan efterprøves
 * igen. En kilde kan omskrive sin side, og så skal det kunne ses, hvornår
 * vi sidst så det, reglen bygger på.
 */
export interface Belaeg {
  art:
    | 'kildens-ui'            // det brugeren ser på kildens egen side
    | 'kildens-api'           // et felt i deres API-svar
    | 'kildens-dokumentation' // deres egen tekst om feltets betydning
    | 'egen-efterproevning'   // rå værdi holdt op mod deres side
  /** URL eller feltsti. Skal kunne slås op igen. */
  hvor: string
  /** ISO-dato for hvornår det sidst blev efterprøvet. */
  naar: string
  note: string
}

// ─── De fire akser ─────────────────────────────────────────────
//
// Adskilte typer, ikke én liste. En mærket liste ville stadig tillade tre
// timing-fakta og ingen ansøgningsform, uden at nogen opdagede det.

/** Står boligen til rådighed hos kilden? */
export type Markedsevidens = 'paa_markedet' | 'reserveret' | 'udlejet'
/** Hvornår kan den overtages? */
export type Tidsevidens = 'kan_overtages_nu' | 'kan_ikke_overtages_nu'
/** Hvordan tildeles den? */
export type Ansoegningsevidens = 'normal' | 'venteliste'
/** Hvem må overhovedet søge? */
export type Adgangsevidens = 'bopaelskrav' | 'medlemskrav'

export type Evidensart =
  Markedsevidens | Tidsevidens | Ansoegningsevidens | Adgangsevidens

/**
 * Alle fire akser, hver for sig. ALLE skal skrives ud, også som tom liste
 * — så er «vi har set efter, og status siger intet om tid» forskelligt fra
 * «vi har ikke set efter».
 *
 * Kun rå status må udtale sig på flere akser: et statusord kan hos en
 * kilde bære flere betydninger. De specialiserede signaler nedenfor er
 * bundet til én akse hver, så en semantisk forkert mapping bliver en
 * typefejl frem for en fejl, nogen skal opdage.
 */
export interface Evidens {
  marked: readonly Markedsevidens[]
  tid: readonly Tidsevidens[]
  ansoegning: readonly Ansoegningsevidens[]
  adgang: readonly Adgangsevidens[]
}

// ─── Boolske fakta, afledt af AvailabilityFacts ────────────────

/**
 * De felter i `AvailabilityFacts`, der er boolske — UDLEDT, ikke skrevet
 * af. Omdøbes et faktum uden at kontrakten følger med, forsvinder nøglen
 * fra unionen, og kontraktens post bliver en typefejl.
 */
export type BoolskeFakta = {
  [K in keyof AvailabilityFacts]-?:
    NonNullable<AvailabilityFacts[K]> extends boolean ? K : never
}[keyof AvailabilityFacts]

/**
 * Hvilken akse hvert boolsk faktum må udtale sig om.
 *
 * `upcomingProject` står som `never`, fordi kildeundersøgelsen endnu ikke
 * har dokumenteret, hvad feltet betyder. Det er ikke en forglemmelse: med
 * `never` kan man kun skrive tomme lister — altså «signalet siger intet»
 * — indtil nogen har afgjort aksen på et belæg.
 */
export interface Signalakse {
  rentalAvailableNow: Tidsevidens
  residencyRequired: Adgangsevidens
  upcomingProject: never
}

/** Håndhæver, at Signalakse dækker PRÆCIS de boolske fakta. Tilføjes et
 *  nyt boolsk faktum, fejler den her, indtil nogen har valgt dets akse. */
type TjekSignalakse =
  Signalakse extends Record<BoolskeFakta, Evidensart>
    ? BoolskeFakta extends keyof Signalakse ? true : never
    : never
const _signalakserDaekker: TjekSignalakse = true
void _signalakserDaekker

/** Hvad hver af de to værdier betyder. Konklusionen ligger HER, ikke i
 *  feltnavnet. Må signalet ikke bruges, står der tomme lister begge steder. */
export interface Boolskbetydning<A extends Evidensart> {
  sand: readonly A[]
  falsk: readonly A[]
  belaeg: Belaeg
}

// ─── Kontrakten ────────────────────────────────────────────────

export interface Statusbetydning extends Evidens {
  belaeg: Belaeg
}

export interface Kildekontrakt {
  kilde: string

  /** Kildens egne statusord → betydning. Et ord, der IKKE står her, er
   *  ukendt: hverken positiv eller negativ evidens. */
  statusser: Record<string, Statusbetydning>

  /** Hvad kildens datofelt betyder. `null` = kilden har intet. */
  datofelt: null | {
    betydning: 'overtagelse' | 'forventet_indflytning' | 'projektaflevering' | 'uafklaret'
    brugbarSomTiming: boolean
    belaeg: Belaeg
  }

  /** Kildens eget ord for ansøgningsform. KUN ansøgningsevidens. */
  ansoegningsform: null | {
    raaVaerdier: Record<string, readonly Ansoegningsevidens[]>
    belaeg: Belaeg
  }

  /** Fri tekst om overtagelse, fx Dacas «Snarest». KUN tidsevidens. */
  overtagelsestekst: null | {
    ord: Record<string, readonly Tidsevidens[]>
    belaeg: Belaeg
  }

  /** Kildens boolske signaler, hver bundet til sin akse. */
  direkteSignaler: { [K in BoolskeFakta]?: Boolskbetydning<Signalakse[K]> }
}
