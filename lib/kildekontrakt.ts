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

// ═══════════════════════════════════════════════════════════════
//  De syv kontrakter.
//
//  Hver regel har et belæg med art, sted og dato. Ingen regel er udfyldt
//  ud fra feltnavnet alene — det var netop den fejl, Balders datofelt
//  kunne have ført til.
//
//  TOMME FELTER ER EN DEL AF RESULTATET. `statusser: {}` betyder «kilden
//  har intet statusord, vi kender betydningen af», og det er noget andet
//  end en kilde med tre dokumenterede statusser. Læs kommentaren ved hver
//  tom post: den siger, om vi har undersøgt og fundet ingenting, eller om
//  vi endnu ikke har undersøgt.
// ═══════════════════════════════════════════════════════════════

const INTET: Evidens = { marked: [], tid: [], ansoegning: [], adgang: [] }

export const KILDEKONTRAKTER: Record<string, Kildekontrakt> = {
  // ── Balder ───────────────────────────────────────────────────
  balder: {
    kilde: 'balder',
    statusser: {
      Ledig: {
        ...INTET,
        marked: ['paa_markedet'],
        belaeg: {
          art: 'kildens-ui',
          hvor: 'balder.dk · lease_card "available":"Udlejes nu"; handling "Bestil fremvisning"',
          naar: '2026-09-05',
          note: 'Betyder PÅ MARKEDET, ikke «kan overtages nu». Bevis: en bolig '
              + 'med passeret overtagelsesdato (1. aug.) og en med dato 3,5 md. '
              + 'ude (15. dec.) bærer SAMME status. Tid ligger i acquisition_date.',
        },
      },
      Reserveret: {
        ...INTET,
        marked: ['reserveret'],
        belaeg: {
          art: 'kildens-api',
          hvor: 'api.balder.dk · index leases · facet status (6 dokumenter)',
          naar: '2026-09-05',
          note: 'Frasorteres i dag af adapters/balder.ts:161 og når os aldrig. '
              + 'Betydningen er ikke efterprøvet mod deres UI.',
        },
      },
      Udlejet: {
        ...INTET,
        marked: ['udlejet'],
        belaeg: {
          art: 'kildens-api',
          hvor: 'api.balder.dk · index leases · facet status (4.345 dokumenter)',
          naar: '2026-09-05',
          note: 'Publiceres af kilden, men er ude af markedet. Frasorteres i dag.',
        },
      },
      // 54 dokumenter har INTET status-felt. De er ikke boliger —
      // parkerings- og kælderrum, number_of_rooms: 0, rent: null.
    },
    datofelt: {
      betydning: 'overtagelse',
      brugbarSomTiming: true,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'acquisition_date · 5 boligsider holdt op mod faktablokken',
        naar: '2026-09-05',
        note: 'Kilden binder SELV feltet til ordet: "tabs":{"lease_facts":'
            + '{"acquisition_date":"Overtagelsesdato"}} og filteret "Overtagelse:". '
            + '1:1-sammenfald på fem sider, inkl. kontrollen hvor null renderer '
            + 'som "Invalid Date" — labelen hænger direkte på feltet uden fallback. '
            + 'Projekt-/afleveringstolkning aktivt AFVIST: alle 61 datoer ligger i '
            + 'et 4-måneders vindue og klumper på den 1. og 15. '
            + 'Datoen er et GULV: passeret dato + "Ledig" = kan overtages nu.',
      },
    },
    // Undersøgt: kilden har intet felt om ansøgningsform.
    ansoegningsform: null,
    // Undersøgt: ingen fri overtagelsestekst; datoen er maskinlæsbar.
    overtagelsestekst: null,
    // Undersøgt: ingen boolske signaler i lease-dokumentet.
    direkteSignaler: {},
  },

  // ── Propstep ─────────────────────────────────────────────────
  propstep: {
    kilde: 'propstep',
    statusser: {
      Available: {
        ...INTET,
        marked: ['paa_markedet'],
        belaeg: {
          art: 'kildens-dokumentation',
          hvor: 'propstep.com · i18n: Available = "Ledig"',
          naar: '2026-09-05',
          note: '145 af 173 gitterrækker. Siger intet om overtagelse.',
        },
      },
      Reserved: {
        ...INTET,
        marked: ['reserveret'],
        belaeg: {
          art: 'kildens-ui',
          hvor: 'propstep.com · orange «Reserveret»-mærkat i gitteret',
          naar: '2026-09-05',
          note: 'Betyder IKKE ude af markedet: boligen bliver i gitteret, har '
              + 'egen side og egen «Henvend dig her»-knap, og kilden har en '
              + 'automatisk besked for, at en reservation ANNULLERES. En anden '
              + 'har fået første ret — den kan stadig søges. 28 af 173.',
        },
      },
      Rented: {
        ...INTET,
        marked: ['udlejet'],
        belaeg: {
          art: 'egen-efterproevning',
          hvor: 'tre ejendomssider · transactionStatus 3 på 200 af 236 lejemål',
          naar: '2026-09-05',
          note: 'IKKE SET I GITTERET. Ordet stammer fra kildens etiketkatalog, '
              + 'ikke fra en observeret værdi — en modbeviser væltede læsningen '
              + 'af kataloget som et værdisæt. Kendt fra DETALJESIDENS '
              + 'transactionStatus = 3, hvor alle 200 har onMarketSince null. '
              + 'Kan derfor ikke nå os gennem gitteret.',
        },
      },
      Unknown: {
        ...INTET,
        belaeg: {
          art: 'kildens-dokumentation',
          hvor: 'propstep.com · i18n-etiket: Unknown = "Ukendt"',
          naar: '2026-09-05',
          note: 'ALDRIG OBSERVERET — hverken i gitteret eller på en detaljeside. '
              + 'Ordet kommer fra et ETIKETKATALOG, og et katalog er ikke et '
              + 'værdisæt: kilden kan have etiketter, den aldrig bruger. Posten '
              + 'står her, så en fremtidig forekomst ikke bliver læst som ny '
              + 'og ukendt — ikke som dokumentation for, at værdien findes.',
        },
      },
      // TO STATUSFLADER, ikke én. Gitteret har `availabilityStatus` som
      // STRENG; detaljesiden har `transactionStatus` som TAL (1/2/3). De to
      // er ikke efterprøvet som ækvivalente ud over Skanørgade 12
      // (Reserved ↔ 2). Værdisættets fulde omfang er UAFKLARET.
    },
    datofelt: {
      betydning: 'uafklaret',
      brugbarSomTiming: false,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'transactionDetails.availableFrom · produktionen',
        naar: '2026-09-05',
        note: 'IKKE brugbar. Ældste værdi er 2002-08-31, 9 boliger ligger over '
            + '180 dage tilbage, og alle er bekræftet hos kilden inden for 24 '
            + 'timer. Kilden dokumenterer ingen betydning af feltet, og der '
            + 'findes ingen brugervendt tekst at holde det op mod. Indtil den '
            + 'findes, giver feltet ingen tidsevidens.',
      },
    },
    // UNDERSØGT OG KONSTATERET UTILGÆNGELIG: ventelisten slås til på
    // UDLEJEREN (owner.waitingList.isEnabled, owner.waitingListSeniorityRule),
    // og `owner` er uden for adapterens allowlist. `onWaitingListSince` er
    // kun modstykket til onMarketSince. Fravær af den er derfor ikke bevis
    // for normal ansøgning — beviset ligger et sted, vi ikke læser.
    ansoegningsform: null,
    overtagelsestekst: null,
    // UNDERSØGT OG KONSTATERET UTILGÆNGELIGE: upcomingProject, projectMode,
    // deadlineDays og interestListId ligger alle på `propertyGroup`, uden
    // for allowlisten. Dertil: interestListId er en interesseliste UDEN
    // anciennitet («få besked når en bolig passer dine kriterier») og må
    // ALDRIG oversættes til venteliste. deadlineDays er uafklaret — der
    // findes to felter med samme navn og ingen brugervendt tekst.
    direkteSignaler: {},
  },

  // ── home.dk ──────────────────────────────────────────────────
  home: {
    kilde: 'home',
    // UNDERSØGT: kildens tilstandsvokabularium (isRented, isSold,
    // isUnlisted, isComingSoon …) står på detaljesiden, men adapteren
    // læser intet af det, og katalogets eget udvalg er den de facto
    // filtrering. Ingen statusord med dokumenteret betydning endnu.
    statusser: {},
    datofelt: {
      betydning: 'overtagelse',
      brugbarSomTiming: true,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: '__NUXT_DATA__ · detaljesidens SAGSOBJEKT (ikke listerækken, '
            + 'ikke de beslægtede annoncer) · availability.rentalAvailableFrom',
        naar: '2026-09-05',
        note: 'Enig med kildens eget isRentalAvailableNow på alle 8 målte, '
            + 'også i grænsetilfældet 2026-09-01 (true) mod 2026-10-01 (false). '
            + 'TO FORBEHOLD fra modbeviserne: home.dk leverer TRE projektioner '
            + 'af en sag, og `availability` findes kun i den ene — projektionen '
            + 'skal derfor bindes, ikke søges. Og feltets tidsformat varierer '
            + 'mellem sager; kun datodelen må bruges.',
      },
    },
    ansoegningsform: null,
    overtagelsestekst: null,
    direkteSignaler: {
      rentalAvailableNow: {
        sand: ['kan_overtages_nu'],
        falsk: ['kan_ikke_overtages_nu'],
        belaeg: {
          art: 'egen-efterproevning',
          hvor: '__NUXT_DATA__ · detaljesidens sagsobjekt · '
              + 'availability.isRentalAvailableNow · 8 sager',
          naar: '2026-09-05',
          note: 'MÅLT, IKKE DOKUMENTERET AF KILDEN. På alle otte målte sager er '
              + 'feltet sandt præcis når rentalAvailableFrom ligger på eller før '
              + 'i dag — også i grænsetilfældet 2026-09-01 (true) mod 2026-10-01 '
              + '(false). Der er altså fuld enighed mellem booleanen og datoen. '
              + 'Det er en KORRELATION, vi selv har målt: der er ikke fundet '
              + 'nogen oversættelsesnøgle eller anden tekst fra home.dk, der '
              + 'siger, hvad feltet betyder. Til sammenligning binder Balder '
              + 'selv acquisition_date til ordet «Overtagelsesdato» i sin egen '
              + 'oversættelsestabel — det har vi ikke her. '
              + 'At signalet er AFLEDT af datoen gør det ikke til ikke-evidens: '
              + 'det er samme evidens sagt to gange. At sammenfatte to enige '
              + 'signaler til én konklusion er domænefunktionens opgave, ikke '
              + 'kontraktens. Blev signalet ladt tomt, ville en fremtidig '
              + 'uenighed mellem dato og boolean være umulig at opdage — og den '
              + 'uenighed er netop en datakvalitetskonflikt, vi vil se.',
        },
      },
      residencyRequired: {
        sand: ['bopaelskrav'],
        falsk: [],
        belaeg: {
          art: 'kildens-dokumentation',
          hvor: '__NUXT_DATA__ · ordbog: noResidenceRequired = "Ingen bopælspligt"',
          naar: '2026-09-05',
          note: 'BOPÆLSPLIGT, ikke venteliste. home.dk har intet ventelistefelt '
              + 'overhovedet. `falsk` er tom: «ingen bopælspligt» er fravær af '
              + 'et krav, ikke evidens om adgang.',
        },
      },
    },
  },

  // ── findbolig.nu ─────────────────────────────────────────────
  findbolig: {
    kilde: 'findbolig',
    // UNDERSØGT: `$type` (Property/Residence) er en FORM-skelnen, ikke en
    // status — Property er en ejendom, ikke et lejemål. Intet statusfelt
    // læses, og allowlisten kasserer alt ulæst.
    statusser: {},
    datofelt: {
      betydning: 'uafklaret',
      brugbarSomTiming: false,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'findbolig.ts:151 · availableFrom, læst råt uden rimelighedskontrol',
        naar: '2026-09-05',
        note: 'IKKE EFTERPRØVET MOD KILDEN. Deres søge-API er POST-only, og '
            + 'undersøgelsen måtte kun bruge GET, så ingen boligside er hentet. '
            + 'Betydningen er derfor ukendt, ikke bekræftet. Skal efterprøves, '
            + 'før feltet må give tidsevidens.',
      },
    },
    ansoegningsform: {
      raaVaerdier: {
        Regular: ['normal'],
        WaitingList: ['venteliste'],
      },
      belaeg: {
        art: 'kildens-api',
        hvor: 'applicationType · korreleret 1:1 med rentModel (Advert/WaitingList)',
        naar: '2026-09-05',
        note: 'Den ENESTE kilde, der oplyser ansøgningsform eksplicit. Udfyldt '
            + 'på alle 182 rækker; ingen tredje værdi set. rentModel gemmes '
            + 'uoversat og bekræfter parvis.',
      },
    },
    overtagelsestekst: null,
    direkteSignaler: {},
  },

  // ── LokalBolig ───────────────────────────────────────────────
  lokalbolig: {
    kilde: 'lokalbolig',
    // UNDERSØGT OG KONSTATERET TOMT: kilden HAR et statusobjekt,
    // caseStatus {state, text, textLong}, men det stod {null, null, ""}
    // på alle fire hentede sider. `sold` var false på alle 238 sager,
    // også på én hvis side var væk. Der er altså et felt uden indhold —
    // ikke et fravær af felt.
    statusser: {},
    datofelt: {
      betydning: 'uafklaret',
      brugbarSomTiming: false,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'acquisitionDate · lokalbolig.ts:253',
        naar: '2026-09-05',
        note: 'IKKE EFTERPRØVET MOD KILDENS SIDE. Feltnavnet lover en '
            + 'overtagelsesdato, men det gjorde Propsteps også. 2 boliger '
            + 'ligger over et år tilbage, ældste 2021-04-01.',
      },
    },
    ansoegningsform: null,
    overtagelsestekst: null,
    direkteSignaler: {},
  },

  // ── Dacas ────────────────────────────────────────────────────
  dacas: {
    kilde: 'dacas',
    // UNDERSØGT OG KONSTATERET: kilden publicerer INTET statusfelt. Ingen
    // taksonomi, intet ordforråd om udlejet/reserveret/venteliste. Den de
    // facto status er binær: står boligen i sitemappet, er den i udbud.
    statusser: {},
    datofelt: {
      betydning: 'overtagelse',
      brugbarSomTiming: true,
      belaeg: {
        art: 'kildens-ui',
        hvor: 'dacas.dk · feltet «Overtagelsesdato:» på boligsiderne',
        naar: '2026-09-06',
        note: 'Kilden binder SELV datoen til ordet: etiketten er ordret '
            + '«Overtagelsesdato:», bekræftet på 9 af 17 sider — samme '
            + 'ordklasse og samme belægsart, som gav Balder sit ja. Datoen '
            + 'står som dansk FRITEKST («1. november 2026») og parses '
            + 'deterministisk til en kalenderdag i adapteren; det er '
            + 'kildens dato, ikke vores. «Snarest» giver ALDRIG en dato — '
            + 'den bærer sin evidens gennem overtagelsestekst nedenfor, og '
            + 'de to veje kan ikke dobbelt-tælle: en side har enten en '
            + 'dato eller «Snarest» i feltet.',
      },
    },
    ansoegningsform: null,
    overtagelsestekst: {
      ord: {
        Snarest: ['kan_overtages_nu'],
      },
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'dacas.dk · feltet «Overtagelsesdato:» på 9 boligsider',
        naar: '2026-09-05',
        note: 'To former set: «Snarest» (2 sider) og dansk tekstdato som '
            + '«1. november 2026» (7 sider). 8 af 17 sider er UAFPRØVEDE inden '
            + 'for kaldsgrænsen, så en tredje form kan findes. Tekstdatoen hører '
            + 'ikke her — den skal parses som dato, ikke som tilstandsord.',
      },
    },
    direkteSignaler: {},
  },

  // ── Bofinda (udlejerens egne annoncer) ───────────────────────
  native: {
    kilde: 'native',
    // Der ER ingen kilde at have en status fra. Udlejeren trykker udgiv.
    statusser: {},
    datofelt: {
      betydning: 'overtagelse',
      brugbarSomTiming: true,
      belaeg: {
        art: 'egen-efterproevning',
        hvor: 'app/udlejer · feltet «ledig fra» i annonceformularen',
        naar: '2026-09-05',
        note: 'Udlejeren skriver den selv om sin egen bolig. Det er den eneste '
            + 'kilde, hvor datoens betydning ikke kan misforstås.',
      },
    },
    // Formularen SPØRGER ikke om ansøgningsform. Fravær er ikke bevis for
    // normal ansøgning — heller ikke her.
    ansoegningsform: null,
    overtagelsestekst: null,
    direkteSignaler: {},
  },
}
