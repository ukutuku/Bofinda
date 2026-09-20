// ═══════════════════════════════════════════════════════════════
//  Syntetiske samtaler til prøvevisningen.
//
//  ⚠ DET HER ER IKKE BESKEDLEVERING. Ingen database, ingen konto, ingen
//  mail, intet netværk. Porten svarer ud af hukommelsen og glemmer alt
//  ved genindlæsning. Den findes for at kunne afprøve BRUGERFLADEN —
//  tilstandene, tastaturet, mobilvisningen og en afsendelse, der fejler.
//
//  Navne og adresser er opdigtede og skrevet, så det kan ses: «Attrup»,
//  «Prøvegade», «Attrapby». Filen ligger under `proeve/` og importeres
//  ikke af modulet selv — `Beskedmodul` kender kun grænsefladen.
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
  | 'skrivebeskyttet'
  | 'sendefejl'
  | Laasegrund

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
  // Afsendte beskeder lægges i hukommelsen, så tråden opfører sig som en
  // tråd. De forsvinder ved genindlæsning — og det er meningen.
  const laast = (scenarie === 'login-kraevet' || scenarie === 'abonnement-kraevet'
    || scenarie === 'abonnement-udloebet') ? scenarie : null
  const forsinkelse = scenarie === 'langsom' ? 1400 : 120
  let nr = 100

  return {
    async hentIndbakke() {
      await vent(forsinkelse)
      if (scenarie === 'hentefejl') throw new Error('attrap: hentning fejlede med vilje')
      // Den låste variant sendes UDEN samtaler. Det er ikke en høflighed
      // — typen tillader ikke andet, og det er hele pointen.
      if (laast) return { tilstand: laast } satisfies Indbakke
      if (scenarie === 'tom') return { tilstand: 'adgang', samtaler: [] }
      return { tilstand: 'adgang', samtaler: sager.map((s) => ({ ...s.hoved })) }
    },

    async hentTraad(id) {
      await vent(forsinkelse)
      if (laast) return { tilstand: laast } satisfies Samtaletraad
      const s = sager.find((x) => x.hoved.id === id)
      if (!s) return { tilstand: 'findes-ikke' }
      // KOPIER, ikke attrappens egne arrays. Et serverlag serialiserer
      // sit svar, og modulet regner med at eje det, det får. Udleverede
      // attrappen sin levende liste, ville modulets `[...beskeder, ny]`
      // og attrappens eget `push` lægge den samme besked i to gange —
      // hvilket den gjorde, og hvilket kontrollen fangede som «4 → 6».
      return {
        tilstand: 'adgang',
        hoved: { ...s.hoved },
        beskeder: s.beskeder.map((b) => ({ ...b })),
        skriv: scenarie === 'skrivebeskyttet' ? 'skrivebeskyttet' : 'kan-skrive',
      }
    },

    async send(samtaleId, tekst): Promise<Sendesvar> {
      await vent(scenarie === 'langsom' ? 1400 : 450)
      if (scenarie === 'sendefejl') return { ok: false, fejl: 'netvaerk' }
      const s = sager.find((x) => x.hoved.id === samtaleId)
      if (!s) return { ok: false, fejl: 'ukendt' }
      const b: Besked = {
        id: `attrap-${nr++}`, fra: 'mig', tekst, tidspunkt: new Date().toISOString(),
      }
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
