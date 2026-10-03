// ═══════════════════════════════════════════════════════════════
//  Udlevering af kontaktoplysninger — HÅNDHÆVELSEN.
//
//  ═══ BESLUTNINGEN BOR IKKE HER ═══
//
//  Der står ikke én regel i denne fil om abonnementer, tilstande,
//  perioder eller konti. Den SPØRGER og adlyder. Beslutningen er
//  `maaBruge(FUNKTION.kontakt)` i `lib/adgang.ts`, og den ejes af
//  betalingsserien.
//
//  Grunden er CLAUDE.md's dyreste regel: to udtryk for det samme
//  spørgsmål driver fra hinanden, og begge ser rigtige ud hver for sig.
//  En mur, der står to steder, er to mure — og den ene bliver glemt.
//
//  Hvad der SÅ er her, er det andet spørgsmål: *hvor* håndhæves det.
//  Svaret er «i serverlaget, før forespørgslen», og det er ikke det
//  samme spørgsmål som «må hun».
//
//  ═══ VED NEJ RØRER VI IKKE DATABASEN ═══
//
//  Rækkefølgen er reglen. Spørg først, læs bagefter. Læste vi først og
//  filtrerede bagefter, ville mailen og nummeret have forladt basen og
//  ligge i en variabel i processen — og så er det kun disciplin, der
//  holder dem ude af svaret, af en log, af et event eller af en
//  fejlbesked. Et felt, der aldrig forlader databasen, kan ikke lække
//  ved en uopmærksom ændring et andet sted.
//
//  Derfor er `laes` en parameter og ikke et direkte kald: så kan en
//  prøve måle, at den ALDRIG blev kaldt — ikke bare at svaret var tomt.
//  Et tomt svar kan opstå på to måder; kun den ene er en mur.
//
//  ═══ «INTET OPLYST» ER IKKE «DU MÅ IKKE SE DET» ═══
//
//  Dagens handling returnerer `{ mail: null, telefon: null }` i begge
//  tilfælde. De to er ikke det samme, og brugeren skal ikke se samme
//  besked: den ene siger «udlejeren har ikke oplyst noget», den anden
//  «din adgang er lukket». Derfor er svaret en union og ikke to felter.
// ═══════════════════════════════════════════════════════════════

/**
 * Hvorfor adgangen blev nægtet.
 *
 * ⚠ SKAL VÆRE ORDRET DEN SAMME som `Grund` i `lib/adgang.ts`. Den fil
 * findes ikke på denne gren endnu, så typen kan ikke importeres —
 * derfor står strengene her, og derfor findes `scripts/test-kontaktmur.ts`,
 * som fejler, hvis `lib/adgang.ts` dukker op uden at blive brugt.
 *
 * `ukendt_tilstand` er IKKE en lås. Den betyder, at vi ikke kunne
 * bekræfte adgangen — altså vores fejl. Se `tilLaasegrund` i
 * app/kontakt-ui/server/.
 */
export type Muregrund = 'abonnement_kraeves' | 'login_kraeves' | 'ukendt_tilstand'

/** Præcis formen af `Adgangssvar` i `lib/adgang.ts`, reduceret til det, muren bruger. */
export type Beslutning =
  | { ok: true }
  | { ok: false; grund: Muregrund }

export interface Kontaktraekke {
  mail: string | null
  telefon: string | null
}

export type Udlevering =
  /** Adgangen var god. Felterne kan stadig være tomme — det er udlejerens valg. */
  | { slags: 'udleveret'; mail: string | null; telefon: string | null }
  /** Adgangen var lukket. Der blev ikke læst noget. */
  | { slags: 'naegtet'; grund: Muregrund }
  /** Boligen findes ikke, er ikke native, eller er ikke aktiv. */
  | { slags: 'ukendt-bolig' }

/**
 * Den eneste vej til en udlejers kontaktoplysninger.
 *
 * @param beslut  Adgangsbeslutningen. Skal komme fra `lib/adgang.ts`.
 *                Kaldes FØR `laes`, og et nej stopper her.
 * @param laes    Selve opslaget. Kaldes KUN ved ja.
 */
export async function udleverKontakt(
  id: string,
  beslut: () => Promise<Beslutning>,
  laes: (id: string) => Promise<Kontaktraekke | null>,
): Promise<Udlevering> {
  // ── Spørg. Før alt andet. ──────────────────────────────────
  const svar = await beslut()
  if (!svar.ok) return { slags: 'naegtet', grund: svar.grund }

  // ── Først her rører vi basen ───────────────────────────────
  const r = await laes(id)
  if (!r) return { slags: 'ukendt-bolig' }
  return { slags: 'udleveret', mail: r.mail, telefon: r.telefon }
}
