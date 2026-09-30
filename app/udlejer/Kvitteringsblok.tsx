// ═══════════════════════════════════════════════════════════════
//  Kvitteringen for det, serveren lige nåede at gøre. ÉN visning.
//
//  To forløb ender her: en gennemført gendannelse (`gemNyKode`) og en
//  verificeret mailbekræftelse (callback-ruten). De stiller det samme
//  spørgsmål — hvad skete der, lige før hun blev sendt herhen? — og
//  besvares derfor ét sted. Teksterne er forskellige; mekanikken er én.
//
//  ═══ HVORFOR DEN FLYTTEDE UD AF Konto.tsx ═══
//
//  Den stod inde i kontoformularen, og formularen vises kun for en, der
//  IKKE er logget ind. Men det udfald, kvitteringen først og fremmest
//  findes for — «koden er skiftet, men udlogningen fejlede» — betyder
//  netop, at hun STADIG er logget ind. Beskeden kunne altså ikke nå den
//  eneste, der havde brug for den: udlejeren blev omdirigeret til Mine
//  annoncer, og Min side gengav sin indloggede gren uden et ord om, at
//  koden lige var skiftet.
//
//  Visningen hører derfor ikke til formularen. Den hører til hver af de
//  sider, gendannelsen kan ende på, og teksten beregnes ét sted — samme
//  regel som `Ellinje` i app/Boligkort.tsx: to korttyper, ét svar.
//
//  ═══ DEN GIVER INGEN RETTIGHEDER ═══
//
//  Kvitteringen er en OPLYSNING om, hvad serveren gjorde. Cookien bærer
//  kun HVAD der skete, aldrig hvem, og ingen af siderne her afgør adgang
//  af den: `hentBrugerStatus()` og `hentUdlejer()` spørger Auth-serveren
//  præcis som før, og blokken gengives først bagefter. En håndskrevet
//  cookie kan derfor højst få en besked på skærmen — ikke en side at se.
//
//  Filen er REN: ingen hooks, ingen database, ingen next/headers. Den
//  gengives på serveren fra siderne og i klientbundtet fra Konto.
// ═══════════════════════════════════════════════════════════════

import type { Kontekst, Kvittering } from '../../lib/kontovej'

/**
 * Hvor blokken står — og dermed hvad der er sandt at sige bagefter.
 *
 *   · `udlogget`   ved siden af kontoformularen: hun skal logge ind
 *   · `indlogget`  på hendes eget område: hun ER logget ind, og «log ind
 *                  herunder» ville pege på en formular, der ikke findes
 *   · `begraenset` hun er logget ind, men området kunne ikke åbnes —
 *                  bindingen blev afvist, og siden forklarer det nedenfor
 *
 * Det er ikke pynt. Ved et mislykket logud er forskellen på de to første
 * hele pointen: den ene tekst taler om en session et ANDET sted, den
 * anden om den session, hun sidder i lige nu. Og den tredje findes,
 * fordi en kvittering, der lover adgang til et område, siden lige har
 * sagt nej til, er den samme fejl vendt om.
 */
export type Visning = 'udlogget' | 'indlogget' | 'begraenset'

/** Hvad hendes eget område hedder, set fra den kontekst hun kom fra. */
const OMRAADE: Record<Kontekst, string> = {
  bolig: 'Min side',
  udlejer: 'Mine annoncer',
}

interface Besked {
  klasse: string
  overskrift: string
  /** Konteksten bruges kun, hvor den faktisk ændrer noget. */
  krop: (k: Kontekst) => string
}

const SKIFTET = 'Din adgangskode er skiftet.'

/**
 * ⚠ «Velkommen til BOFINDA» hører til bekræftelsen og INTET andet.
 * Et gendannelseslink må aldrig kunne vise den — hun har haft kontoen
 * længe. Spærringen står i callback-ruten, som kun sætter `bekraeftet`
 * for bekræftelsesforløbet.
 */
const BEKRAEFTET = 'Din mailadresse er bekræftet. Velkommen til BOFINDA.'

const BESKED: Record<Kvittering, Record<Visning, Besked>> = {
  skiftet: {
    udlogget: {
      klasse: 'kontook',
      overskrift: SKIFTET,
      krop: () => 'Log ind herunder med den nye. Er du logget ind på en anden '
        + 'enhed, mister den adgangen, når dens session udløber.',
    },
    // Hun kan nå herhen inden for kvitteringens to minutter ved at logge
    // ind igen med det samme. Så er «log ind herunder» allerede sket.
    indlogget: {
      klasse: 'kontook',
      overskrift: SKIFTET,
      krop: () => 'Du er logget ind her med den nye. Er du logget ind på en '
        + 'anden enhed, mister den adgangen, når dens session udløber.',
    },
    begraenset: {
      klasse: 'kontook',
      overskrift: SKIFTET,
      krop: (k) => `Brug den nye, næste gang du logger ind. ${OMRAADE[k]} kunne `
        + 'ikke åbnes for kontoen — se beskeden herunder.',
    },
  },
  'skiftet-uden-logud': {
    udlogget: {
      klasse: 'kontofejl',
      overskrift: SKIFTET,
      krop: () => 'Brug den nye, når du logger ind — du skal ikke skifte den igen. '
        + 'Vi kunne ikke afslutte udlogningen, så er du stadig logget ind et '
        + 'andet sted, så log ud dér.',
    },
    indlogget: {
      klasse: 'kontofejl',
      overskrift: SKIFTET,
      krop: () => 'Du skal ikke skifte den igen. Vi kunne ikke afslutte udlogningen '
        + 'bagefter, så du er stadig logget ind her på den adgang, linket gav '
        + 'dig. Vil du afslutte den, så log ud herfra og log ind igen med den '
        + 'nye adgangskode.',
    },
    begraenset: {
      klasse: 'kontofejl',
      overskrift: SKIFTET,
      krop: (k) => 'Du skal ikke skifte den igen. Vi kunne ikke afslutte udlogningen '
        + `bagefter, så du er stadig logget ind her. ${OMRAADE[k]} kunne ikke `
        + 'åbnes for kontoen — se beskeden herunder.',
    },
  },
  bekraeftet: {
    // Vekslingen lykkedes, men sessionen nåede ikke frem til denne side.
    // Vi påstår ikke, at hun er logget ind — vi siger, hvad vi ved.
    udlogget: {
      klasse: 'kontook',
      overskrift: BEKRAEFTET,
      krop: (k) => 'Du er ikke logget ind her. Log ind herunder med den '
        + `adgangskode, du valgte, så åbner ${OMRAADE[k]}.`,
    },
    indlogget: {
      klasse: 'kontook',
      overskrift: BEKRAEFTET,
      krop: (k) => k === 'udlejer'
        ? 'Du er logget ind. Opret din første annonce, når du er klar.'
        : 'Du er logget ind. Tryk på hjertet på en bolig, så ligger den her '
          + 'på Min side — også på telefonen.',
    },
    begraenset: {
      klasse: 'kontook',
      overskrift: BEKRAEFTET,
      krop: (k) => `${OMRAADE[k]} kunne ikke åbnes for kontoen endnu — se `
        + 'beskeden herunder.',
    },
  },
}

/**
 * Ingen kvittering, ingen blok. `null` er det almindelige tilfælde —
 * de fleste sidevisninger har ikke lige haft et kodeskift.
 */
export function Kvitteringsblok(
  { kvittering, visning, kontekst }: {
    kvittering: Kvittering | null
    visning: Visning
    kontekst: Kontekst
  },
) {
  if (!kvittering) return null
  const { klasse, overskrift, krop } = BESKED[kvittering][visning]
  return (
    <div className={`blok ${klasse}`} role="status">
      <p><strong>{overskrift}</strong></p>
      <p>{krop(kontekst)}</p>
    </div>
  )
}
