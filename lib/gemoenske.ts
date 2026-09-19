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
//  Ingen database, ingen next/headers, ingen React, ingen node:crypto.
//  `Konto` er en KLIENTKOMPONENT og importerer `GEM_PARAM` herfra — et
//  vaerdi-import fra et modul, der traekker `postgres` med ind, vaeltede
//  engang hele appen paa `Can't resolve 'net'`. Se noten om
//  `lib/faciliteter.ts` i CLAUDE.md. Derfor ligger id-tjekket her og ikke
//  i `lib/favoritter.ts`: et rent modul kan importeres af et
//  databasemodul, aldrig omvendt. Cookielaget bor i
//  `lib/gemkvittering.ts`, som er serverens alene.
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
 * Oensket, som vi laeste det. TRE tilstande, ikke to.
 *
 * ═══ HVORFOR «INTET» OG «UGYLDIGT» IKKE MAA SLAAS SAMMEN ═══
 *
 * Foerste udgave gav `null` for begge. Foelgerne kunne foelges hele
 * vejen: `min-side/page.tsx` fik null, udelod derfor det skjulte felt i
 * formularen, `login()` saa ingen `gem`-vaerdi og behandlede forloebet
 * som et helt almindeligt login — og hun landede paa Min side uden sin
 * bolig og uden et ord om hvorfor. Udfaldet `ugyldigt-link` fandtes i
 * koden og kunne ikke naas fra forloebet.
 *
 * Forskellen er ikke teknisk, den er brugerens:
 *
 *   · `intet`      hun loggede ind. Der er intet at fortaelle.
 *   · `ugyldigt`   hun trykkede paa et hjerte, og linket knaekkede
 *                  undervejs. Hun venter paa en bolig, der aldrig kommer.
 *   · `id`         der er en bolig at gemme.
 *
 * Det er den samme regel som forbeholdet om el: «el er ikke med» og «vi
 * ved ikke hvad der er i tallet» er to udsagn, og kun det ene kan
 * aflaeses. Et fravaer og en fejl ser ens ud i en `null`, og netop derfor
 * maa de ikke dele den.
 */
export type Gemoenske =
  | { slags: 'intet' }
  | { slags: 'ugyldigt' }
  | { slags: 'id'; id: string }

/**
 * Oensket fra en klientvaerdi — en URL-parameter eller et formularfelt.
 *
 * `searchParams` giver `string | string[] | undefined`; `FormData.get`
 * giver `string | File | null`. Begge ender her, saa formen laeses ét
 * sted.
 *
 * Er der flere, tages den FOERSTE: `?gem=a&gem=b` er ét hjerteklik, der
 * er blevet duplikeret undervejs, ikke en anmodning om at gemme to
 * boliger. Og et gaet paa hvilken hun mente, ville vaere et gaet.
 *
 * Kun `undefined` og `null` er «intet» — altsaa at parameteren eller
 * feltet slet ikke var der. Alt andet, ogsaa den tomme streng, er et
 * oenske, vi ikke kunne laese: `?gem=` er en adresse, der HAR baaret et
 * hjerteklik og tabt det.
 *
 * Der kastes aldrig. En knaekket adresse maa ikke kunne vaelte login.
 */
export function laesGemOenske(v: unknown): Gemoenske {
  const raa = Array.isArray(v) ? v[0] : v
  if (raa === undefined || raa === null) return { slags: 'intet' }
  const t = typeof raa === 'string' ? raa.trim() : raa
  return erBoligId(t) ? { slags: 'id', id: t } : { slags: 'ugyldigt' }
}

/** Id'et alene, naar det er dét, kalderen skal bruge. Afledt, ikke en kopi. */
export function gemOenskeFra(v: unknown): string | null {
  const o = laesGemOenske(v)
  return o.slags === 'id' ? o.id : null
}

/**
 * Maerket, formularen baerer for et oenske, vi ikke kunne laese.
 *
 * ═══ HVORFOR IKKE BARE SENDE DEN RAA VAERDI VIDERE ═══
 *
 * Fordi siden allerede HAR svaret. At sende den ulaeselige tekst med i
 * POST'en ville stille det samme spoergsmaal to gange — én gang i
 * `page.tsx` og én gang i `login()` — og det er netop den form, fem af
 * fejlene i CLAUDE.md's tabel har. Det ville desuden baere en vilkaarlig
 * lang fremmed streng ind i et skjult felt og videre til serveren, uden
 * at nogen har brug for indholdet. Vi baerer KONKLUSIONEN, ikke
 * spoergsmaalet.
 *
 * Maerket er med vilje ikke et bolig-id, saa den samme `laesGemOenske`
 * klassificerer det som `ugyldigt` uden en eneste undtagelse undervejs.
 * Proeven laaser den binding fast.
 */
export const GEM_KNAEKKET = 'knaekket'

/** Hvad LOGIN-formularen skal baere — eller null, hvis der intet er at baere. */
export function feltvaerdiFor(o: Gemoenske): string | null {
  if (o.slags === 'id') return o.id
  return o.slags === 'ugyldigt' ? GEM_KNAEKKET : null
}

/**
 * Hvad serveren naaede at goere med oensket.
 *
 * Fire udfald, fordi de kraever hver sin besked — og fordi «intet skete»
 * ikke maa se ud som «det lykkedes»:
 *
 *   · `gemt`           boligen ligger nu paa hendes liste
 *   · `ukendt-bolig`   id'et er velformet, men der findes ingen saadan bolig
 *   · `ugyldigt-link`  parameteren var ikke et bolig-id
 *   · `ikke-gemt`      skrivningen knaekkede — hun ER logget ind, men
 *                      boligen naaede ikke listen
 *
 * De tre sidste er adskilt med vilje. «Boligen findes ikke laengere» er
 * en oplysning om boligen; «linket var ikke gyldigt» er en oplysning om
 * linket; «vi kunne ikke gemme den» er en oplysning om OS. Slaar man dem
 * sammen, faar hun at vide, at en bolig er forsvundet, i et tilfaelde
 * hvor den maaske aldrig har eksisteret — eller hvor det var vores egen
 * base, der svigtede.
 *
 * ═══ HVORFOR `ikke-gemt` FINDES ═══
 *
 * Maalt, ikke formodet. Foerste udgave lod `gemOenske` kaste videre ud
 * gennem `login()`: en proeve med en kastende trigger paa `favorites`
 * viste, at sessionen BLEV oprettet, men omdirigeringen aldrig skete —
 * hun blev staaende paa `/min-side?gem=…` med en gammel besked fra et
 * tidligere forsoeg. Hun var logget ind og fik at vide, at en anden
 * bolig ikke fandtes. En gemning maa aldrig kunne vaelte det login, den
 * hang paa.
 */
export const GEMUDFALD = ['gemt', 'ukendt-bolig', 'ugyldigt-link', 'ikke-gemt'] as const
export type Gemudfald = (typeof GEMUDFALD)[number]

/**
 * Udfaldet baeres i en cookie, SERVEREN satte — ikke i adressen.
 *
 * Samme grund som `KVITTERINGSCOOKIE` i lib/kontovej.ts: et
 * haandskrevet `?gemt=1` skal ikke kunne faa Min side til at paastaa, at
 * en bolig lige blev gemt. En kvittering er en oplysning om, hvad
 * serveren gjorde, saa den skal komme fra serveren.
 *
 * Cookien er HttpOnly og baerer aldrig hvilken bolig det drejede sig om.
 * Den er hverken en session eller et bevis paa adgang.
 */
export const GEMCOOKIE = 'bofinda_gemoenske'

/**
 * Hvor laenge udfaldet ligger og venter paa at blive vist.
 *
 * Kort, fordi den ikke kan slettes ved visningen: Min side er en GET, og
 * en side maa ikke saette cookies under gengivelsen. Den lever derfor sit
 * vindue ud, og et genindlaes inden for det viser beskeden igen.
 *
 * KORTERE end kvitteringen efter et kodeskift (120 s). Den her handler om
 * det ene klik, hun lige lavede, og en besked om en bolig, der stadig
 * staar to minutter senere, kan naa at blive et svar paa et andet
 * spoergsmaal.
 *
 * ═══ MEN TIDEN ER IKKE SPAERRINGEN ═══
 *
 * Levetiden er en oprydning, ikke en sikring. Det maalte problem var, at
 * kvitteringen overlevede baade en udlogning og det naeste almindelige
 * login — inden for de 30 sekunder kunne en ANDEN konto logge ind paa den
 * samme maskine og faa «Boligen er gemt.» om en bolig, hun aldrig havde
 * set. En spaerring, der bestaar i at vente, er ingen spaerring; se
 * `gemudfaldFor` nedenfor og `ryddGemkvittering` i lib/gemkvittering.ts.
 */
export const GEMUDFALDSSEK = 30

/**
 * Cookiens vaerdi: udfaldet OG et maerke for den, den blev sat til.
 *
 * Maerket er ikke bruger-id'et, men en envejsafledning af det — se
 * `maerkeFor` i lib/gemkvittering.ts. Cookien navngiver altsaa stadig
 * ingen; kun serveren, som kender den nuvaerende brugers id, kan afgoere,
 * om kvitteringen er hendes.
 */
export function kvitteringsvaerdi(udfald: Gemudfald, maerke: string): string {
  return `${udfald}:${maerke}`
}

/**
 * Udfaldet i cookien — men kun hvis det tilhoerer den, der kigger.
 *
 * Passer maerket ikke, findes der intet udfald at vise. Det er den anden
 * af to uafhaengige spaerringer mod en misvisende kvittering: den foerste
 * er, at den ryddes ved udlogning, ved et login uden oenske og ved enhver
 * nyere favorithandling. Overlever en cookie alligevel en vej, vi ikke
 * har taenkt paa, kan den stadig ikke tale til en fremmed konto.
 *
 * En vaerdi uden maerke — den gamle form, eller noget haandskrevet —
 * giver null. Det er den sikre vej: en kvittering, vi ikke kan tilskrive
 * nogen, vises ikke.
 */
export function gemudfaldFor(raa: unknown, maerke: string): Gemudfald | null {
  if (typeof raa !== 'string' || maerke === '') return null
  const skille = raa.indexOf(':')
  if (skille <= 0) return null
  if (raa.slice(skille + 1) !== maerke) return null
  const udfald = raa.slice(0, skille)
  return (GEMUDFALD as readonly string[]).includes(udfald) ? (udfald as Gemudfald) : null
}
