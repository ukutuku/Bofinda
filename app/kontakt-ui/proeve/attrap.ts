// ═══════════════════════════════════════════════════════════════
//  Syntetiske svar til prøvevisningen af kontaktrejsen.
//
//  ⚠ DET HER ER IKKE ET SERVERLAG. Ingen database, ingen konto, ingen
//  betaling, ingen afsendelse, intet netværk. Attrappen svarer ud af
//  hukommelsen og glemmer alt ved genindlæsning. Den findes for at
//  kunne afprøve BRUGERFLADEN og de otte tilstande.
//
//  Navne, adresser og numre er opdigtede og skrevet, så det kan ses:
//  «Attrup», «Prøvegade», «attrapudlejer.invalid», og telefonnummeret
//  er Energistyrelsens reserverede prøveinterval.
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
  Annonce, Kontaktoplysninger, Kontaktport, Kontaktsvar, Startsvar,
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
export function annoncenFor(s: Scenarie): Annonce {
  if (s === 'ekstern-home') return EKSTERN.home
  if (s === 'ekstern-cej') return EKSTERN.cej
  if (s === 'ekstern-propstep') return EKSTERN.propstep
  if (s === 'lange-tekster') return LANG
  return NATIV
}

const OPLYSNINGER: Kontaktoplysninger = {
  mail: 'mette@attrapudlejer.invalid',
  telefon: '+45 20 00 00 00',
}

export function lavKontaktattrap(scenarie: Scenarie): Kontaktport {
  const grund = scenarie === 'langsom' ? FORSINKELSE.langsom : FORSINKELSE.hurtig

  /** Ét sted afgør, om attrappen «har adgang». Bruges af begge kald. */
  const svaret = (): Kontaktsvar => {
    switch (scenarie) {
      case 'betaling-uden-adgang': return { tilstand: 'abonnement-kraevet' }
      case 'udloebet': return { tilstand: 'abonnement-udloebet' }
      case 'login-kraevet': return { tilstand: 'login-kraevet' }
      case 'teknisk-fejl': return { tilstand: 'fejl' }
      case 'gratis':
        // Kontaktoplysningerne er aabne; samtalen kraever en konto.
        // Login staar dér, hvor funktionen kraever det — og intet andet
        // sted. Ingen pris, ingen abonnementsknap.
        return {
          tilstand: 'adgang',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'kraever-login' },
          ophoerer: null,
        }
      case 'aktivt-abonnement':
        return {
          tilstand: 'adgang',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'i-gang', samtaleId: 's1' },
          ophoerer: null,
        }
      case 'opsagt-med-adgang':
        return {
          tilstand: 'adgang',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'kan-starte' },
          // Opsagt, men betalt til og med denne dato. Adgangen er
          // afgjort af `tilstand` — datoen er en oplysning ved siden af.
          ophoerer: new Date(Date.now() + 19 * 86_400_000).toISOString(),
        }
      case 'ingen-kontaktoplysninger':
        return {
          tilstand: 'adgang',
          kontakt: { harMail: false, harTelefon: false },
          samtale: { slags: 'kan-starte' },
          ophoerer: null,
        }
      default:
        return {
          tilstand: 'adgang',
          kontakt: { harMail: true, harTelefon: true },
          samtale: { slags: 'kan-starte' },
          ophoerer: null,
        }
    }
  }

  return {
    async hentAdgang() {
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
      if (!s.kontakt.harMail && !s.kontakt.harTelefon) return { mail: null, telefon: null }
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
