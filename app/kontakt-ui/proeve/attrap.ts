// ═══════════════════════════════════════════════════════════════
//  Syntetiske svar til prøvevisningen af kontaktrejsen.
//
//  ⚠ DET HER ER IKKE ET SERVERLAG. Ingen database, ingen konto, ingen
//  betaling, ingen afsendelse, intet netværk. Attrappen svarer ud af
//  hukommelsen og glemmer alt ved genindlæsning. Den findes for at
//  kunne afprøve BRUGERFLADEN og de otte tilstande.
//
//  Navne, adresser og numre er opdigtede og skrevet, så det kan ses:
//  «Attrup», «Prøvegade» og `attrapudlejer.invalid` — `.invalid` er
//  RFC 2606's reserverede topdomæne og kan aldrig slå op.
//
//  ⚠ Telefonnummeret har IKKE en tilsvarende garanti. En tidligere
//  udgave af denne kommentar kaldte det «Energistyrelsens reserverede
//  prøveinterval». Det er der ikke belæg for: Danmark har ingen
//  almindeligt kendt prøveserie som den britiske 07700 900xxx, og
//  20-serien er en ganske almindelig mobilserie, der kan være tildelt
//  en rigtig abonnent. Nummeret er opdigtet af os, ikke reserveret af
//  nogen — og det bør skiftes til noget, der beviseligt ikke kan
//  tildeles, før prøvevisningen bruges i materiale, andre ser. Skriv
//  aldrig en garanti, du ikke har efterprøvet.
//
//  ═══ ATTRAPPEN REGNER INGEN ADGANGSREGEL ═══
//
//  Den får en tilstand stillet ind af prøvevisningen og svarer med den
//  — præcis som Supplys serverlag vil gøre. Den dag det rigtige lag
//  findes, byttes ÉN implementering af `Kontaktport` ud, og ikke en
//  linje i komponenterne.
//
//  ═══ `hentKontakt` AFVISER, NÅR ADGANGEN ER LUKKET ═══
//
//  Ikke som en høflighed, men fordi det er dét, serverlaget SKAL gøre:
//  `hentAdgang` gav en visningstilladelse, ikke en adgangskontrol, og
//  adgangen kan være ændret siden. Attrappen opfører sig som en server,
//  der kontrollerer igen — ellers ville prøven vænne os til et
//  serverlag, der ikke gør.
// ═══════════════════════════════════════════════════════════════

import type {
  Adgangsindhold, Annonce, Kontaktoplysninger, Kontaktport, Kontaktsvar, Startsvar,
} from '../kontrakt'

export type Scenarie =
  | 'native-adgang'
  | 'gratis'
  | 'aktivt-abonnement'
  | 'opsagt-med-adgang'
  | 'ingen-kontaktoplysninger'
  | 'betaling-uden-adgang'
  | 'udloebet'
  | 'login-kraevet'
  | 'teknisk-fejl'
  | 'porten-kaster'
  | 'langsom'
  | 'lange-tekster'
  | 'start-fejler'
  | 'start-laaser'
  | 'ekstern-home'
  | 'ekstern-cej'
  | 'ekstern-propstep'
  // Eksterne annoncer under de OEVRIGE adgangstilstande. De findes,
  // fordi en ekstern annonce nu spoerger adapteren som alle andre —
  // og fordi et filter, der kun maaler den aabne tilstand, ville
  // fastholde den gamle, forkerte regel uden at kunne se det.
  | 'ekstern-betaling'
  | 'ekstern-udloebet'
  | 'ekstern-login'
  | 'ekstern-fejl'
  | 'ekstern-opsagt'
  // Styrede kaploeb. Se noten ved ARMERET_EFTER.
  | 'kaploeb-gammelt-svar'
  | 'kaploeb-ordnet'

const FORSINKELSE = { hurtig: 140, langsom: 1500 } as const
const vent = (ms: number) => new Promise((r) => setTimeout(r, ms))
const timer = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()

/**
 * Id'erne er UUID-FORMEDE med vilje.
 *
 * `/go/[id]` afviser alt, der ikke matcher `^[0-9a-f-]{36}$` — et
 * kortere attrap-id ville falde paa rutens egen vagt, og saa maalte
 * proeven ikke den vej, den ser ud til at maale. Formen er rigtig;
 * boligen findes ikke, og ruten svarer derfor «Ukendt bolig». Det er
 * dét, en SIMULERET handling skal goere: have den rigtige form og
 * ingen virkning.
 *
 * Og `videreHref` peger ALDRIG paa kildens egen URL. Ruten maa ikke
 * kunne tage en URL som parameter — det ville vaere et aabent
 * redirect. Se app/go/[id]/route.ts.
 */
const NATIV: Annonce = {
  slags: 'native',
  id: '00000000-0000-4000-8000-00000000a001',
  adresse: 'Prøvegade 12, 2. th',
  sted: '2300 Attrapby S',
  overskrift: 'Lejlighed · 3 vær. · 72 m²',
  setAfOs: timer(30),
}

/** Lange tekster: bryder panelet, eller holder det? */
const LANG: Annonce = {
  ...NATIV,
  adresse: 'Dronning Alexandrines Allé ved Frederiksberggade 248 B, 4. sal til venstre',
  sted: '2000 Frederiksberg og Omegn Nordvest',
  overskrift: 'Rækkehus i to plan med udbygget havestue · 5 vær. · 184 m²',
}

const EKSTERN: Record<'home' | 'cej' | 'propstep', Annonce> = {
  home: {
    slags: 'ekstern',
    id: '00000000-0000-4000-8000-00000000a002',
    adresse: 'Attrapvej 3, st.',
    sted: '9000 Prøveby N',
    overskrift: 'Lejlighed · 2 vær. · 58 m²',
    kilde: 'home.dk',
    videreHref: '/go/00000000-0000-4000-8000-00000000a002',
    annonceret: timer(70),
    setAfOs: timer(26),
  },
  cej: {
    slags: 'ekstern',
    id: '00000000-0000-4000-8000-00000000a003',
    adresse: 'Fiktivvej 44, 4. mf',
    sted: '8000 Attrapby C',
    overskrift: 'Lejlighed · 4 vær. · 96 m²',
    kilde: 'CEJ',
    videreHref: '/go/00000000-0000-4000-8000-00000000a003',
    annonceret: null,
    setAfOs: timer(9),
  },
  propstep: {
    slags: 'ekstern',
    id: '00000000-0000-4000-8000-00000000a004',
    adresse: 'Opdigtet Allé 9',
    sted: '5000 Prøveby C',
    overskrift: 'Rækkehus · 4 vær. · 112 m²',
    kilde: 'Propstep',
    videreHref: '/go/00000000-0000-4000-8000-00000000a004',
    annonceret: timer(4),
    setAfOs: timer(3),
  },
}

/** Hvilken annonce hører scenariet til? */
const EKSTERNE_SCENARIER: Scenarie[] = [
  'ekstern-home', 'ekstern-cej', 'ekstern-propstep',
  'ekstern-betaling', 'ekstern-udloebet', 'ekstern-login',
  'ekstern-fejl', 'ekstern-opsagt',
]

export function annoncenFor(s: Scenarie): Annonce {
  if (s === 'ekstern-cej') return EKSTERN.cej
  if (s === 'ekstern-propstep') return EKSTERN.propstep
  if (EKSTERNE_SCENARIER.includes(s)) return EKSTERN.home
  if (s === 'lange-tekster') return LANG
  return NATIV
}

const OPLYSNINGER: Kontaktoplysninger = {
  mail: 'mette@attrapudlejer.invalid',
  telefon: '+45 20 00 00 00',
}

/**
 * Hvornaar et styret kaploeb er «armeret», maalt fra attrappen blev
 * lavet.
 *
 * ═══ HVORFOR TID OG IKKE KALDNUMMER ═══
 *
 * Proevevisningen koerer i StrictMode, og en monteringseffekt kaldes
 * derfor setup → cleanup → setup. `hent()` loeber altsaa TO gange ved
 * montering, ikke én. Et kaploeb, der talte kald («det tredje kald er
 * det langsomme»), ville afhaenge af et tal, StrictMode aendrer — og
 * proeven ville maale sig selv i stedet for produktet.
 *
 * Doeren aabner derfor paa TID: monteringens kald er faerdige laenge
 * inden, og kontrollen venter bevidst, foer den trykker. Saa er det
 * TRYKKENE, der danner kaploebet, uanset hvor mange gange React
 * monterede.
 */
const ARMERET_EFTER = 800

export function lavKontaktattrap(scenarie: Scenarie): Kontaktport {
  const grund = scenarie === 'langsom' ? FORSINKELSE.langsom : FORSINKELSE.hurtig
  const eksternAnnonce = annoncenFor(scenarie).slags === 'ekstern'
  const foedt = Date.now()
  let armerede = 0

  /**
   * Adgangsverdikten. ÉT sted, og den er den SAMME for begge
   * annoncetyper — det er hele rettelsen: en ekstern annonce faar
   * ikke laengere en undtagelse.
   */
  const tilstanden = (): Kontaktsvar['tilstand'] => {
    switch (scenarie) {
      case 'betaling-uden-adgang':
      case 'ekstern-betaling': return 'abonnement-kraevet'
      case 'udloebet':
      case 'ekstern-udloebet': return 'abonnement-udloebet'
      case 'login-kraevet':
      case 'ekstern-login': return 'login-kraevet'
      case 'teknisk-fejl':
      case 'ekstern-fejl': return 'fejl'
      default: return 'adgang'
    }
  }

  /** Hvad et ja aabner for. Afgjort af ANNONCEN, ikke af tilstanden. */
  const indholdet = (): Adgangsindhold => {
    if (eksternAnnonce) return { slags: 'ekstern' }
    switch (scenarie) {
      case 'gratis':
        // Kontaktoplysningerne er aabne; samtalen kraever en konto.
        // Login staar dér, hvor funktionen kraever det — og intet
        // andet sted. Ingen pris, ingen abonnementsknap.
        return {
          slags: 'native',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'kraever-login' },
        }
      case 'aktivt-abonnement':
        return {
          slags: 'native',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'i-gang', samtaleId: 's1' },
        }
      case 'ingen-kontaktoplysninger':
        return {
          slags: 'native',
          kontakt: { harMail: false, harTelefon: false },
          samtale: { slags: 'kan-starte' },
        }
      default:
        return {
          slags: 'native',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'kan-starte' },
        }
    }
  }

  /** Opsagt, men betalt til og med denne dato. */
  const ophoeret = (): string | null =>
    (scenarie === 'opsagt-med-adgang' || scenarie === 'ekstern-opsagt')
      ? new Date(Date.now() + 19 * 86_400_000).toISOString()
      : null

  const svaret = (): Kontaktsvar => {
    const t = tilstanden()
    if (t !== 'adgang') return { tilstand: t }
    return { tilstand: 'adgang', indhold: indholdet(), ophoerer: ophoeret() }
  }

  /**
   * De styrede kaploeb. Foer doeren aabner svarer attrappen `fejl`, saa
   * panelet har en «Proev igen»-knap at trykke paa; derefter danner
   * trykkene selv kaploebet.
   *
   * · `kaploeb-gammelt-svar`: foerste tryk henter et LANGSOMT «adgang»,
   *   andet tryk et HURTIGT «udloebet». Det aeldste svar lander altsaa
   *   sidst. Den rigtige slutning er LAAST.
   * · `kaploeb-ordnet`: samme to svar, men de lander i den raekkefoelge,
   *   de blev bedt om. Kontrollen er der, saa rettelsen ikke maa
   *   «loese» kaploebet ved bare at kassere alt, der kommer sent.
   */
  const kaploeb = async (): Promise<Kontaktsvar> => {
    if (Date.now() - foedt < ARMERET_EFTER) {
      await vent(FORSINKELSE.hurtig)
      return { tilstand: 'fejl' }
    }
    armerede += 1
    const foerste = armerede === 1
    if (scenarie === 'kaploeb-ordnet') {
      await vent(foerste ? 200 : 700)
    } else {
      await vent(foerste ? 1400 : 150)
    }
    return foerste
      ? { tilstand: 'adgang', indhold: indholdet(), ophoerer: null }
      : { tilstand: 'abonnement-udloebet' }
  }

  const erKaploeb = scenarie === 'kaploeb-gammelt-svar' || scenarie === 'kaploeb-ordnet'

  return {
    async hentAdgang() {
      if (erKaploeb) return kaploeb()
      await vent(grund)
      if (scenarie === 'porten-kaster') {
        // En AFVIST Promise — ikke et svar, der siger nej. Sådan ser en
        // afbrudt forbindelse og en server action, der kaster, ud.
        throw new Error('attrap: adgangsopslaget kastede med vilje')
      }
      return svaret()
    },

    async hentKontakt() {
      await vent(grund)
      const s = svaret()
      // Serveren kontrollerer IGEN. Se noten i hovedet.
      if (s.tilstand !== 'adgang') throw new Error('attrap: ingen adgang til kontaktoplysninger')
      // En ekstern annonce har ingen kontaktoplysninger HOS OS. Kaldet
      // hoerer ikke hjemme her, og attrappen lader som en server, der
      // siger fra frem for at finde paa et svar.
      if (s.indhold.slags !== 'native') throw new Error('attrap: ekstern annonce har ingen kontakt hos os')
      if (!s.indhold.kontakt.harMail && !s.indhold.kontakt.harTelefon) return { mail: null, telefon: null }
      return OPLYSNINGER
    },

    async startSamtale(): Promise<Startsvar> {
      await vent(grund)
      if (scenarie === 'start-fejler') return { ok: false, grund: 'fejl' }
      // Adgangen aendrede sig, mens hun trykkede. Hele panelet laases.
      if (scenarie === 'start-laaser') return { ok: false, grund: 'abonnement-udloebet' }
      return { ok: true, samtaleId: 's1' }
    },
  }
}
