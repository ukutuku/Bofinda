// ═══════════════════════════════════════════════════════════════
//  Fra kildens fakta til Bofindas domæneresultat.
//
//  ÉN regel bærer hele filen: EVIDENS ER FAKTA, IKKE STEMMER.
//
//  To signaler, der siger det samme, giver én konklusion — ikke en
//  stærkere. Der findes ikke «mere nu» eller «2 mod 0». Og siger to
//  dokumenterede signaler på samme akse noget MODSAT, vælger funktionen
//  ikke: den siger `conflict`. Ingen prioritet, ingen «status slår dato»,
//  ingen «flest vinder». En uenighed er et datakvalitetsfund, og et fund,
//  der bliver skjult af en prioritetsregel, opdages aldrig.
//
//  `unknown` og `conflict` er IKKE det samme:
//    unknown   vi har ikke tilstrækkelig dokumenteret evidens.
//    conflict  vi HAR evidens, og den er indbyrdes uenig.
//  De skal kunne tælles og overvåges hver for sig.
//
//  FRISKHED INDGÅR IKKE. `last_seen_at`, discovery og `status = active`
//  er en anden dimension. At kilden stadig viser annoncen, er evidens for
//  at den stadig publiceres — ikke for at boligen kan overtages nu. En
//  Propstep-bolig med ledigdato fra 2002 og last_seen_at fra i nat
//  beviser kun det første.
//
//  Funktionen er DETERMINISTISK. Den kalder aldrig `new Date()`;
//  `referenceNow` er et argument. Det er samme lære som Dacas-fejlen,
//  hvor «Snarest» blev til vores eget ur.
// ═══════════════════════════════════════════════════════════════

import type { AvailabilityFacts } from './adapter'
import { kalenderdag } from './dato'
import type {
  Adgangsevidens, Ansoegningsevidens, Evidens, Kildekontrakt,
  Markedsevidens, Tidsevidens,
} from './kildekontrakt'

// ─── Domænetyper ───────────────────────────────────────────────

export type Markedsstatus =
  'paa_markedet' | 'reserveret' | 'udlejet' | 'unknown' | 'conflict'
export type Timingstatus = 'nu' | 'senere' | 'unknown' | 'conflict'
export type Ansoegningsstatus = 'normal' | 'venteliste' | 'unknown' | 'conflict'

/**
 * Adgang er IKKE en enum.
 *
 * Bopælskrav og medlemskrav kan være sande samtidig — de udelukker ikke
 * hinanden, og en single-value enum ville tvinge et valg, virkeligheden
 * ikke kræver. Derfor et sæt.
 *
 * Aksen kan heller ikke komme i konflikt: begge evidensværdier er
 * POSITIVE påstande («der er et bopælskrav»), og der findes ingen
 * modsat værdi at være uenig med. Fravær er unknown, ikke «intet krav».
 */
export type Adgangskrav = Adgangsevidens

/** Ét led i sporet: fra råt faktum, gennem kontraktregel, til evidens. */
export interface Evidensspor {
  /** Hvilket råt faktum. Bundet til AvailabilityFacts' nøgler. */
  faktum: keyof AvailabilityFacts
  /** Værdien, som den stod hos kilden. */
  vaerdi: string
  /** Hvilken kontraktregel der fortolkede den. */
  regel: string
  /** Hvilken domæneevidens det gav. */
  evidens: string
}

export interface Akse<S extends string> {
  status: S
  /** ALLE spor, der bidrog. To spor med samme evidens er stadig én
   *  konklusion — sporet viser dem begge, konklusionen tæller dem ikke. */
  evidens: readonly Evidensspor[]
  /** Kun ved `conflict`: sporene grupperet efter den evidens, de gav, så
   *  det fremgår PRÆCIS hvilke signaler der er uenige. */
  uenighed?: Readonly<Record<string, readonly Evidensspor[]>>
}

export interface Availability {
  marked: Akse<Markedsstatus>
  timing: Akse<Timingstatus>
  ansoegning: Akse<Ansoegningsstatus>
  /** Sæt, ikke enum. Tomt = ingen dokumenteret evidens, ikke «ingen krav». */
  adgang: { krav: readonly Adgangskrav[]; evidens: readonly Evidensspor[] }
}

// ─── Indsamling ────────────────────────────────────────────────

const AKSER = ['marked', 'tid', 'ansoegning', 'adgang'] as const

/** De boolske fakta, kontrakten kan udtale sig om. */
const BOOLSKE = ['rentalAvailableNow', 'upcomingProject', 'residencyRequired'] as const

function samleSpor(
  fakta: AvailabilityFacts, k: Kildekontrakt, referenceNow: Date,
): Evidensspor[] {
  const ud: Evidensspor[] = []
  const fra = (faktum: keyof AvailabilityFacts, vaerdi: string, regel: string, e: Evidens) => {
    for (const akse of AKSER) for (const v of e[akse]) ud.push({ faktum, vaerdi, regel, evidens: v })
  }

  // 1) Kildens eget statusord.
  if (fakta.rawStatus != null) {
    const b = k.statusser[fakta.rawStatus]
    // Et ord, kontrakten ikke kender, giver INGEN evidens — hverken
    // positiv eller negativ. Det er unknown, ikke «ikke på markedet».
    if (b) fra('rawStatus', fakta.rawStatus, `${k.kilde}.statusser["${fakta.rawStatus}"]`, b)
  }

  // 2) Datofeltet — KUN hvis kontrakten siger, det må bruges til timing.
  //    Propsteps 2002-dato er netop grunden til, at det er et krav.
  //
  //    KALENDERDAG mod kalenderdag, i Bofindas zone — aldrig dato-som-
  //    UTC-instant mod referenceNow. «Kan overtages 5. september» skal
  //    gælde HELE den 5. september i Danmark, også kl. 00:30 dansk tid,
  //    hvor UTC stadig skriver den 4. ISO-datoer sammenlignes leksikalsk.
  if (fakta.sourceAvailabilityDate != null && k.datofelt?.brugbarSomTiming) {
    const nu = fakta.sourceAvailabilityDate <= kalenderdag(referenceNow)
    ud.push({
      faktum: 'sourceAvailabilityDate',
      vaerdi: fakta.sourceAvailabilityDate,
      regel: `${k.kilde}.datofelt (${k.datofelt.betydning})`,
      evidens: nu ? 'kan_overtages_nu' : 'kan_ikke_overtages_nu',
    })
  }

  // 3) Fri overtagelsestekst, fx Dacas «Snarest».
  if (fakta.takeoverText != null && k.overtagelsestekst) {
    for (const v of k.overtagelsestekst.ord[fakta.takeoverText] ?? []) {
      ud.push({
        faktum: 'takeoverText', vaerdi: fakta.takeoverText,
        regel: `${k.kilde}.overtagelsestekst["${fakta.takeoverText}"]`, evidens: v,
      })
    }
  }

  // 4) Kildens eget ord for ansøgningsform.
  if (fakta.rawApplicationType != null && k.ansoegningsform) {
    for (const v of k.ansoegningsform.raaVaerdier[fakta.rawApplicationType] ?? []) {
      ud.push({
        faktum: 'rawApplicationType', vaerdi: fakta.rawApplicationType,
        regel: `${k.kilde}.ansoegningsform["${fakta.rawApplicationType}"]`, evidens: v,
      })
    }
  }

  // 5) De boolske signaler.
  for (const navn of BOOLSKE) {
    const v = fakta[navn]
    const s = k.direkteSignaler[navn]
    if (v == null || !s) continue
    for (const e of (v ? s.sand : s.falsk) as readonly string[]) {
      ud.push({
        faktum: navn, vaerdi: String(v),
        regel: `${k.kilde}.direkteSignaler.${navn}.${v ? 'sand' : 'falsk'}`, evidens: e,
      })
    }
  }
  return ud
}

/**
 * Fra evidens til status på ÉN akse.
 *
 * Nul evidens → unknown. Én distinkt konklusion → den, uanset hvor mange
 * spor der peger på den. To eller flere → conflict, og begge sider
 * bevares i `uenighed`.
 */
function afgoer<S extends string>(
  spor: readonly Evidensspor[], kort: Readonly<Record<string, S>>,
  tom: S, uenig: S,
): Akse<S> {
  const mine = spor.filter((s) => s.evidens in kort)
  const distinkte = [...new Set(mine.map((s) => kort[s.evidens]!))]
  if (distinkte.length === 0) return { status: tom, evidens: [] }
  if (distinkte.length === 1) return { status: distinkte[0]!, evidens: mine }
  const uenighed: Record<string, Evidensspor[]> = {}
  for (const s of mine) (uenighed[s.evidens] ??= []).push(s)
  return { status: uenig, evidens: mine, uenighed }
}

const MARKED: Record<Markedsevidens, Markedsstatus> = {
  paa_markedet: 'paa_markedet', reserveret: 'reserveret', udlejet: 'udlejet',
}
const TID: Record<Tidsevidens, Timingstatus> = {
  kan_overtages_nu: 'nu', kan_ikke_overtages_nu: 'senere',
}
const ANSOEG: Record<Ansoegningsevidens, Ansoegningsstatus> = {
  normal: 'normal', venteliste: 'venteliste',
}
const ADGANG: readonly Adgangskrav[] = ['bopaelskrav', 'medlemskrav']

/**
 * Kildens fakta + kontrakten + et eksplicit nu → domæneresultatet.
 *
 * `referenceNow` er et ARGUMENT, ikke systemuret. Samme input i morgen
 * med samme referenceNow giver samme resultat.
 */
export function fortolkAvailability(
  fakta: AvailabilityFacts, kontrakt: Kildekontrakt, referenceNow: Date,
): Availability {
  const spor = samleSpor(fakta, kontrakt, referenceNow)
  const adgangsspor = spor.filter((s) => (ADGANG as readonly string[]).includes(s.evidens))
  return {
    marked: afgoer<Markedsstatus>(spor, MARKED, 'unknown', 'conflict'),
    timing: afgoer<Timingstatus>(spor, TID, 'unknown', 'conflict'),
    ansoegning: afgoer<Ansoegningsstatus>(spor, ANSOEG, 'unknown', 'conflict'),
    adgang: {
      krav: [...new Set(adgangsspor.map((s) => s.evidens as Adgangskrav))],
      evidens: adgangsspor,
    },
  }
}

/** Sporet som læsbare linjer. Til prøver, logning og fejlsøgning. */
export function forklar(a: Akse<string>): string[] {
  const linje = (s: Evidensspor) => `${s.faktum} = ${s.vaerdi} → ${s.regel} → ${s.evidens}`
  if (a.status !== 'conflict') return a.evidens.map(linje)
  return Object.entries(a.uenighed ?? {}).flatMap(([e, ss]) =>
    [`── ${e} ──`, ...ss.map(linje)])
}
