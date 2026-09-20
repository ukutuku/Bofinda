// ═══════════════════════════════════════════════════════════════
//  Syntetiske samtaler til prøvevisningen.
//
//  ⚠ DET HER ER IKKE BESKEDLEVERING. Ingen database, ingen konto, ingen
//  mail, intet netværk. Porten svarer ud af hukommelsen og glemmer alt
//  ved genindlæsning. Den findes for at kunne afprøve BRUGERFLADEN —
//  tilstandene, tastaturet, mobilvisningen og de måder, et kald kan gå
//  galt på.
//
//  Navne og adresser er opdigtede og skrevet, så det kan ses: «Attrup»,
//  «Prøvegade», «Attrapby». Filen ligger under `proeve/` og importeres
//  ikke af modulet selv — `Beskedmodul` kender kun grænsefladen.
//
//  ═══ FORSINKELSERNE ER STYREDE, IKKE TILFÆLDIGE ═══
//
//  Flere af scenarierne findes for at kunne ramme et bestemt kapløb:
//  et langsomt svar, der lander EFTER et hurtigt, en kvittering der
//  kommer, når brugeren har skiftet samtale, og en låsning der falder,
//  mens et andet kald er undervejs. De tal, der styrer det, står i
//  `FORSINKELSE` — ikke spredt ud i koden — så et scenarie kan læses
//  som det kapløb, det er.
//
//  ═══ INGEN PARALLEL ADGANGSKONTROL ═══
//
//  Attrappen REGNER ikke, om nogen har adgang. Den får en tilstand
//  stillet ind af prøvevisningen og svarer med den — præcis som Supplys
//  serverlag vil gøre. Den dag det rigtige lag findes, byttes ÉN
//  implementering af `Beskedport` ud, og ikke en linje i komponenterne.
// ═══════════════════════════════════════════════════════════════

import type {
  Besked, Beskedport, Indbakke, Laasegrund, Samtalehoved, Samtaletraad, Sendesvar,
} from '../kontrakt'

export type Scenarie =
  | 'normal'
  | 'tom'
  | 'langsom'
  | 'hentefejl'
  | 'traadfejl'
  | 'findes-ikke'
  | 'omvendt'
  | 'sendefejl'
  | 'sende-exception'
  | 'langsom-afsendelse'
  | 'laas-ved-afsendelse'
  | 'laas-under-skift'
  | 'kvittering-efter-genlaesning'
  | 'gammelt-snapshot'
  | Laasegrund

/** De tal, kapløbene er bygget af. Millisekunder. */
const FORSINKELSE = {
  hurtig: 120,
  langsom: 1400,
  /** Den samtale, der skal svare SIDST i «omvendt» og «laas-under-skift». */
  efternoeler: 1500,
  /** Den, der skal svare først og udløse låsen. */
  foerstemand: 200,
  sendHurtig: 350,
  sendLangsom: 1500,
  /** «Serveren» har gemt, men kvitteringen er laenge undervejs. */
  kvitteringSen: 2200,
  /** Skrivningen lander MIDT i en langsom laesning. */
  kvitteringMidt: 900,
  /** Laesningen svarer saa sent, at den er aeldre end skrivningen. */
  laesningSen: 1800,
} as const

const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

interface Raa { hoved: Samtalehoved; beskeder: Besked[] }

/** Bygges ved kaldet, ikke ved import: tidspunkterne skal være relative
 *  til DET ØJEBLIK, prøvevisningen åbnes. */
function data(): Raa[] {
  return [
    {
      hoved: {
        id: 's1',
        bolig: { id: 'b1', adresse: 'Prøvegade 12, 2. th', sted: '2300 Attrapby S' },
        modpart: { navn: 'Mette Attrup', rolle: 'udlejer' },
        sidsteAktivitet: min(14),
        uddrag: 'Ja, den er stadig ledig. Kunne du kigge forbi på torsdag?',
        ulaeste: 2,
      },
      beskeder: [
        { id: 'm1', fra: 'mig', tekst: 'Hej Mette. Er lejligheden stadig ledig fra 1. november?', tidspunkt: min(2900) },
        { id: 'm2', fra: 'modpart', tekst: 'Hej! Ja, den er stadig ledig.', tidspunkt: min(2860) },
        { id: 'm3', fra: 'mig', tekst: 'Super. Er der vaskemaskine i lejligheden, eller er det fællesvaskeri?', tidspunkt: min(40) },
        { id: 'm4', fra: 'modpart', tekst: 'Der er fællesvaskeri i kælderen.\n\nKunne du kigge forbi på torsdag kl. 16?', tidspunkt: min(14) },
      ],
    },
    {
      hoved: {
        id: 's2',
        bolig: { id: 'b2', adresse: 'Attrapvej 3, st.', sted: '9000 Prøveby N' },
        modpart: { navn: 'Ejendomsattrappen ApS', rolle: 'udlejer' },
        sidsteAktivitet: min(1500),
        uddrag: 'Vi vender tilbage, når vi har set ansøgningerne igennem.',
        ulaeste: 0,
      },
      beskeder: [
        { id: 'm5', fra: 'mig', tekst: 'Hej. Jeg er interesseret i boligen. Hvornår kan den overtages?', tidspunkt: min(1560) },
        { id: 'm6', fra: 'modpart', tekst: 'Tak for din henvendelse. Vi vender tilbage, når vi har set ansøgningerne igennem.', tidspunkt: min(1500) },
      ],
    },
    {
      hoved: {
        id: 's3',
        bolig: { id: 'b3', adresse: 'Fiktivvej 44, 4. mf', sted: '8000 Attrapby C' },
        modpart: { navn: null, rolle: 'udlejer' },
        sidsteAktivitet: min(46_000),
        uddrag: null,
        ulaeste: 0,
      },
      beskeder: [
        { id: 'm7', fra: 'mig', tekst: 'Hej. Er det muligt at se boligen i denne uge?', tidspunkt: min(46_000) },
      ],
    },
  ]
}

const vent = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function lavAttrapport(scenarie: Scenarie): Beskedport {
  const sager = data()
  const laast: Laasegrund | null =
    (scenarie === 'login-kraevet' || scenarie === 'abonnement-kraevet'
      || scenarie === 'abonnement-udloebet') ? scenarie : null
  const grund = scenarie === 'langsom' ? FORSINKELSE.langsom : FORSINKELSE.hurtig
  let nr = 100

  /**
   * Hvor længe svarer DENNE tråd?
   *
   * I «omvendt» er den første samtale efternøler, så et klik på A og
   * derefter B lader A's svar lande SIDST. I «laas-under-skift» er det
   * omvendt: den anden er efternøler og svarer «adgang», mens den
   * første svarer LÅST med det samme — så låsen falder, mens et andet
   * kald stadig er undervejs.
   */
  function traadforsinkelse(id: string): number {
    if (scenarie === 'omvendt') return id === 's1' ? FORSINKELSE.efternoeler : FORSINKELSE.hurtig
    if (scenarie === 'laas-under-skift') {
      return id === 's1' ? FORSINKELSE.foerstemand : FORSINKELSE.efternoeler
    }
    if (scenarie === 'gammelt-snapshot') return FORSINKELSE.laesningSen
    return grund
  }

  /** Bygger den besked, «serveren» gemmer. */
  function nyBesked(tekst: string): Besked {
    return { id: `attrap-${nr++}`, fra: 'mig', tekst, tidspunkt: new Date().toISOString() }
  }

  return {
    async hentIndbakke() {
      await vent(grund)
      if (scenarie === 'hentefejl') throw new Error('attrap: hentning fejlede med vilje')
      // Den låste variant sendes UDEN samtaler. Typen tillader ikke
      // andet — men se advarslen i kontrakt.ts: det er udviklerhjælp,
      // ikke en filtrering, et rigtigt serverlag kan læne sig op ad.
      if (laast) return { tilstand: laast } satisfies Indbakke
      if (scenarie === 'tom') return { tilstand: 'adgang', samtaler: [] }
      return { tilstand: 'adgang', samtaler: sager.map((s) => ({ ...s.hoved })) }
    },

    async hentTraad(id) {
      // ═══ ØJEBLIKSBILLEDET TAGES FØR VENTETIDEN ═══
      //
      // Det ER hele pointen i «gammelt-snapshot»: læsningen skal være
      // ældre end den skrivning, der lander imens. Tages billedet efter
      // ventetiden, har serveren nået at gemme beskeden, og forløbet
      // kan ikke måles.
      const tidligt = scenarie === 'gammelt-snapshot'
        ? sager.find((x) => x.hoved.id === id)?.beskeder.map((b) => ({ ...b })) ?? null
        : null
      await vent(traadforsinkelse(id))
      if (scenarie === 'traadfejl') throw new Error('attrap: tråden fejlede med vilje')
      if (laast) return { tilstand: laast } satisfies Samtaletraad
      // Låsningen kommer HER i «laas-under-skift»: porten melder, at
      // adgangen er lukket, mens en anden tråd stadig er undervejs.
      if (scenarie === 'laas-under-skift' && id === 's1') {
        return { tilstand: 'abonnement-udloebet' }
      }
      if (scenarie === 'findes-ikke') return { tilstand: 'findes-ikke' }
      const s = sager.find((x) => x.hoved.id === id)
      if (!s) return { tilstand: 'findes-ikke' }
      if (tidligt) return { tilstand: 'adgang', hoved: { ...s.hoved }, beskeder: tidligt }
      // KOPIER, ikke attrappens egne arrays. Et serverlag serialiserer
      // sit svar, og modulet regner med at eje det, det får. Udleverede
      // attrappen sin levende liste, ville modulets `[...beskeder, ny]`
      // og attrappens eget `push` lægge den samme besked i to gange —
      // hvilket den gjorde, og hvilket kontrollen fangede som «4 → 6».
      return {
        tilstand: 'adgang',
        hoved: { ...s.hoved },
        beskeder: s.beskeder.map((b) => ({ ...b })),
      }
    },

    async send(samtaleId, tekst): Promise<Sendesvar> {
      // ═══ TO FORLØB, HVOR SKRIVNINGEN OG LÆSNINGEN OVERHALER HINANDEN ═══
      //
      // At gemme og at kvittere er to ting. Attrappen kan derfor gemme
      // FØR den kvitterer — og det er netop dér, de to fejl bor:
      //
      //  · «kvittering efter genlæsning»: gemt med det samme, kvitteret
      //    2,2 sek. senere. En læsning imellem har beskeden MED, og en
      //    kvittering, der bare lægger den i, giver den samme besked to
      //    gange med samme id.
      //  · «gammelt snapshot»: kvitteret efter 0,9 sek., altså EFTER at
      //    en langsom læsning har taget sit øjebliksbillede uden den.
      //    Kvitteringen lander, mens tråden henter.
      if (scenarie === 'kvittering-efter-genlaesning' || scenarie === 'gammelt-snapshot') {
        const s = sager.find((x) => x.hoved.id === samtaleId)
        if (!s) return { ok: false, fejl: 'ukendt' }
        if (scenarie === 'gammelt-snapshot') await vent(FORSINKELSE.kvitteringMidt)
        const b = nyBesked(tekst)
        s.beskeder.push(b)
        s.hoved.sidsteAktivitet = b.tidspunkt
        if (scenarie === 'kvittering-efter-genlaesning') await vent(FORSINKELSE.kvitteringSen)
        return { ok: true, besked: b }
      }
      await vent(scenarie === 'langsom-afsendelse' || scenarie === 'langsom'
        ? FORSINKELSE.sendLangsom : FORSINKELSE.sendHurtig)
      if (scenarie === 'sende-exception') {
        // En AFVIST Promise — ikke et svar, der siger nej. Det er sådan
        // en afbrudt forbindelse og en server action, der kaster, ser ud.
        throw new Error('attrap: afsendelsen kastede med vilje')
      }
      if (scenarie === 'sendefejl') return { ok: false, fejl: 'netvaerk' }
      if (scenarie === 'laas-ved-afsendelse') {
        return { ok: false, fejl: 'laast', grund: 'abonnement-udloebet' }
      }
      const s = sager.find((x) => x.hoved.id === samtaleId)
      if (!s) return { ok: false, fejl: 'ukendt' }
      const b = nyBesked(tekst)
      s.beskeder.push(b)
      s.hoved.sidsteAktivitet = b.tidspunkt
      return { ok: true, besked: b }
    },

    async markerLaest(samtaleId) {
      const s = sager.find((x) => x.hoved.id === samtaleId)
      if (s) s.hoved.ulaeste = 0
    },
  }
}
