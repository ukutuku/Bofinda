// ═══════════════════════════════════════════════════════════════
//  Kvitteringen efter en gennemført gendannelse. ÉN visning.
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

import type { Kvittering } from '../../lib/kontovej'

/**
 * Hvor blokken står — og dermed hvad der er sandt at sige bagefter.
 *
 *   · `udlogget`  ved siden af kontoformularen: hun skal logge ind
 *   · `indlogget` på hendes eget område: hun ER logget ind, og «log ind
 *                 herunder» ville pege på en formular, der ikke findes
 *
 * Det er ikke pynt. Ved et mislykket logud er forskellen hele pointen:
 * den ene tekst taler om en session et ANDET sted, den anden om den
 * session, hun sidder i lige nu.
 */
export type Visning = 'udlogget' | 'indlogget'

/** Overskriften er den samme i alle fire tilfælde: koden ER skiftet. */
const OVERSKRIFT = 'Din adgangskode er skiftet.'

const BESKED: Record<Kvittering, Record<Visning, { klasse: string; krop: string }>> = {
  skiftet: {
    udlogget: {
      klasse: 'kontook',
      krop: 'Log ind herunder med den nye. Er du logget ind på en anden enhed, '
        + 'mister den adgangen, når dens session udløber.',
    },
    // Hun kan nå herhen inden for kvitteringens to minutter ved at logge
    // ind igen med det samme. Så er «log ind herunder» allerede sket.
    indlogget: {
      klasse: 'kontook',
      krop: 'Du er logget ind her med den nye. Er du logget ind på en anden '
        + 'enhed, mister den adgangen, når dens session udløber.',
    },
  },
  'skiftet-uden-logud': {
    udlogget: {
      klasse: 'kontofejl',
      krop: 'Brug den nye, når du logger ind — du skal ikke skifte den igen. '
        + 'Vi kunne ikke afslutte udlogningen, så er du stadig logget ind et '
        + 'andet sted, så log ud dér.',
    },
    indlogget: {
      klasse: 'kontofejl',
      krop: 'Du skal ikke skifte den igen. Vi kunne ikke afslutte udlogningen '
        + 'bagefter, så du er stadig logget ind her på den adgang, linket gav '
        + 'dig. Vil du afslutte den, så log ud herfra og log ind igen med den '
        + 'nye adgangskode.',
    },
  },
}

/**
 * Ingen kvittering, ingen blok. `null` er det almindelige tilfælde —
 * de fleste sidevisninger har ikke lige haft et kodeskift.
 */
export function Kvitteringsblok(
  { kvittering, visning }: { kvittering: Kvittering | null; visning: Visning },
) {
  if (!kvittering) return null
  const { klasse, krop } = BESKED[kvittering][visning]
  return (
    <div className={`blok ${klasse}`} role="status">
      <p><strong>{OVERSKRIFT}</strong></p>
      <p>{krop}</p>
    </div>
  )
}
