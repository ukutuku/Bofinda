// ═══════════════════════════════════════════════════════════════
//  Det ventende gemmeønske — hjerteklikket, der mangler en konto.
//
//  ═══ HVORFOR FILEN FINDES ═══
//
//  En udlogget bruger trykker paa hjertet og sendes til
//  `/min-side?gem=<id>`. Adressen bar oensket hele vejen; ingen samlede
//  det op. `min-side/page.tsx` laeste kun `linkfejl`, `Konto` fik intet
//  at vide, og `login()` omdirigerede direkte. Oensket doede paa gulvet
//  mellem tre filer, der hver for sig saa rigtige ud.
//
//  Rettelsen er ikke et felt mere i hver af dem. Det er ÉT sted, hvor
//  navnet, valideringen og udfaldene bor — samme regel som
//  `lib/kontovej.ts` for destinationen og `filtreFraParametre()` for
//  soegningen: svarer to steder paa det samme spoergsmaal, skal svaret
//  beregnes ét sted.
//
//  ═══ FILEN ER REN ═══
//
//  Ingen database, ingen next/headers, ingen React. `Konto` er en
//  KLIENTKOMPONENT og importerer `GEM_PARAM` herfra — et vaerdi-import
//  fra et modul, der traekker `postgres` med ind, vaeltede engang hele
//  appen paa `Can't resolve 'net'`. Se noten om `lib/faciliteter.ts` i
//  CLAUDE.md. Derfor ligger id-tjekket her og ikke i `lib/favoritter.ts`:
//  et rent modul kan importeres af et databasemodul, aldrig omvendt.
//
//  ═══ ET ID, ALDRIG EN HANDLING ═══
//
//  Parameteren baerer et bolig-id og intet andet. Den giver ingen
//  adgang: hvem der gemmer, afgoeres af sessionen paa serveren, og
//  raekken skrives med `user_id` fra `hentBrugerStatus()`. Et haandskrevet
//  `?gem=<fremmed-uuid>` kan derfor kun gemme en bolig paa ens EGEN
//  liste — praecis som et hjerteklik.
// ═══════════════════════════════════════════════════════════════

/** Parameternavnet i adressen OG feltnavnet i login-formularen. */
export const GEM_PARAM = 'gem'

/**
 * Bolig-id'ets form.
 *
 * Stod foer som en privat `UUID` i `app/min-side/handlinger.ts`. To
 * kopier af den samme regel er to steder, den kan slappes det ene sted —
 * og et husnummer paa «-» i dedup-noeglen er den samme historie. Nu
 * laeser baade `skiftFavorit`, `fjernFraMinSide` og forloebet her det
 * samme udtryk.
 */
const BOLIG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function erBoligId(v: unknown): v is string {
  return typeof v === 'string' && BOLIG_ID.test(v)
}

/**
 * Oensket fra en klientvaerdi — en URL-parameter eller et formularfelt.
 *
 * `searchParams` giver `string | string[] | undefined`. Er der flere,
 * tages den FOERSTE: `?gem=a&gem=b` er ét hjerteklik, der er blevet
 * duplikeret undervejs, ikke en anmodning om at gemme to boliger. Og et
 * gaet paa hvilken hun mente, ville vaere et gaet.
 *
 * Kender vi ikke formen, er svaret null — aldrig vaerdien selv, aldrig
 * et kast. En knaekket adresse maa ikke kunne vaelte login.
 */
export function gemOenskeFra(v: unknown): string | null {
  const foerste = Array.isArray(v) ? v[0] : v
  return erBoligId(foerste) ? foerste : null
}

/**
 * Hvad serveren naaede at goere med oensket.
 *
 * Tre udfald, fordi de kraever hver sin besked — og fordi «intet skete»
 * ikke maa se ud som «det lykkedes»:
 *
 *   · `gemt`           boligen ligger nu paa hendes liste
 *   · `ukendt-bolig`   id'et er velformet, men der findes ingen saadan bolig
 *   · `ugyldigt-link`  parameteren var ikke et bolig-id
 *
 * De to sidste er adskilt med vilje. «Boligen findes ikke laengere» er en
 * oplysning om boligen; «linket var ikke gyldigt» er en oplysning om
 * linket. Slaar man dem sammen, faar hun at vide, at en bolig er
 * forsvundet, i et tilfaelde hvor den maaske aldrig har eksisteret.
 */
export const GEMUDFALD = ['gemt', 'ukendt-bolig', 'ugyldigt-link'] as const
export type Gemudfald = (typeof GEMUDFALD)[number]

/** Kender vi ikke ordet, er der intet udfald at vise — aldrig et gaet. */
export function gemudfaldFra(v: unknown): Gemudfald | null {
  return typeof v === 'string' && (GEMUDFALD as readonly string[]).includes(v)
    ? (v as Gemudfald)
    : null
}

/**
 * Udfaldet baeres i en cookie, SERVEREN satte — ikke i adressen.
 *
 * Samme grund som `KVITTERINGSCOOKIE` i lib/kontovej.ts: et
 * haandskrevet `?gemt=1` skal ikke kunne faa Min side til at paastaa, at
 * en bolig lige blev gemt. En kvittering er en oplysning om, hvad
 * serveren gjorde, saa den skal komme fra serveren.
 *
 * Cookien er HttpOnly, baerer kun HVAD der skete — aldrig hvilken bolig
 * eller hvem — og er derfor hverken en session eller et bevis paa adgang.
 */
export const GEMCOOKIE = 'bofinda_gemoenske'

/**
 * Hvor laenge udfaldet ligger og venter paa at blive vist.
 *
 * Kort, fordi den ikke kan slettes ved visningen: Min side er en GET, og
 * en side maa ikke saette cookies under gengivelsen. Samme loesning og
 * samme tal som kvitteringen efter et kodeskift.
 */
export const GEMUDFALDSSEK = 120
