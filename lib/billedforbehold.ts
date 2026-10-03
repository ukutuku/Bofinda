// ═══════════════════════════════════════════════════════════════
//  BILLEDFORBEHOLDET OG DETS SPÆND.
//
//  Nogle kilder skriver i brødteksten, at billederne kan være fra en
//  anden bolig. Vi gemmer ikke brødteksten — men vi udtrækker det ene
//  faktum og viser vores egen sætning om det.
//
//  Indtil nu gemte vi `true` og intet andet. Det er den fejl, reglen
//  her findes for: **omformulerer kilden sin sætning i morgen, bliver
//  feltet `false` uden spor**, og en bolig begynder at vise billeder,
//  kilden tager forbehold for. Ingen prøve kan se det, fordi der ikke
//  er noget at holde det op imod.
//
//  Derfor bærer faktummet det TEKSTSPÆND, det kom fra. Formen er
//  `availability_facts`' — evidens pr. række, hydreret gennem én parser,
//  fail closed — med `hvor`-disciplinen fra `Belaeg` i
//  lib/kildekontrakt.ts: spændet alene er ikke nok, der skal stå HVILKEN
//  regel der ramte, ellers kan det ikke efterprøves igen.
//
//  ── ÉT UDTRYK, IKKE TO ──────────────────────────────────────
//  Booleanen UDLEDES af spændet (`findForbehold() != null`). Den er
//  ikke et felt, adapteren sætter ved siden af. Sattes de hver for sig,
//  havde vi to udtryk for ét spørgsmål — præcis den fejlform CLAUDE.md
//  har en tabel over, og præcis den, der gav 47 gruppekort med både
//  «udlejer oplyser ikke aconto» og en el-linje.
//
//  ── HVAD VI IKKE GØR ────────────────────────────────────────
//  Spændet VISES aldrig. Det er en attest, ikke indhold, og CLAUDE.mds
//  «kopiér aldrig kildens brødtekst» står uændret: vi gemmer de få ord,
//  der bærer faktummet, for at kunne efterprøve det — ikke for at
//  gengive dem. `MAKS_UDDRAG` sætter en øvre grænse, så et regex, der
//  en dag griber for bredt, ikke gør attesten til en kopi.
// ═══════════════════════════════════════════════════════════════

/**
 * Reglerne, pr. kilde der tager forbeholdet.
 *
 * De stod før som to `const FORBEHOLD` i hver sin adapter. Her kan de
 * navngives, og navnet er det, der gemmes — så en senere efterprøvning
 * ved, hvilket mønster spændet skal holdes op imod.
 */
export const FORBEHOLDSREGLER = {
  // CEJ: «Bemærk, at billederne ikke nødvendigvis er fra den udbudte bolig»
  cej: /billeder\w*[^.]{0,60}?ikke[^.]{0,60}?fra\s+(den|denne|det)\b/i,
  // LokalBolig: «Bemærk venligst, at billederne kan være fra en anden bolig.»
  lokalbolig: /billederne\s+kan\s+v(æ|ae)re\s+fra\s+en\s+anden\s+bolig/i,
} as const

export type Forbeholdsregel = keyof typeof FORBEHOLDSREGLER

/** Så langt et uddrag må være. Over det er attesten blevet en kopi. */
export const MAKS_UDDRAG = 240

export interface Forbeholdsbelaeg {
  /** De ord, reglen ramte. Vises ALDRIG. */
  uddrag: string
  /** Hvilken regel. `hvor`-disciplinen: det skal kunne prøves igen. */
  regel: Forbeholdsregel
}

/**
 * Fandt reglen forbeholdet i teksten?
 *
 * Returnerer BELÆGGET og ikke en boolean, så kalderen ikke kan komme til
 * at gemme det ene uden det andet. Et faktum uden spænd findes ikke.
 */
export function findForbehold(
  tekst: string | null | undefined, regel: Forbeholdsregel,
): Forbeholdsbelaeg | null {
  if (!tekst) return null
  const m = FORBEHOLDSREGLER[regel].exec(tekst)
  if (!m) return null
  // Normaliseret hvidrum: spændet skal kunne sammenlignes og læses i en
  // fejlmeddelelse, og kildens linjeskift bærer ingen oplysning.
  const uddrag = m[0].replace(/\s+/g, ' ').trim().slice(0, MAKS_UDDRAG)
  return { uddrag, regel }
}

/**
 * EFTERPRØVNINGEN: bærer spændet stadig faktummet?
 *
 * Samme form som billedvagten — attestér ved skrivning, efterprøv ved
 * visning. Her er det billigt, for reglen er ren tekst: kør den igen på
 * de ord, den selv udpegede.
 *
 * Fejler den, er ÉN af to ting sket: reglen er ændret, uden at rækkerne
 * er hentet igen, eller spændet er blevet forvansket på vej gennem
 * basen. Begge skal opdages — og ingen af dem må gøre forbeholdet
 * usynligt. Se `visForbehold`.
 */
export function belaegHolder(b: Forbeholdsbelaeg): boolean {
  if (b.uddrag.length > MAKS_UDDRAG) return false
  return FORBEHOLDSREGLER[b.regel].test(b.uddrag)
}

/**
 * jsonb → belæg eller null. FAIL CLOSED, som `laesAvailabilityFacts`.
 *
 * Kolonnen har været gennem databasen og kan indeholde hvad som helst.
 * En `as Forbeholdsbelaeg` ville være den ukontrollerede cast, lib/fakta.ts
 * blev skrevet for at undgå.
 */
export function laesForbeholdsbelaeg(v: unknown): Forbeholdsbelaeg | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object' || Array.isArray(v)) {
    console.error(`[billedforbehold] belægget er ikke et objekt: ${typeof v}`)
    return null
  }
  const o = v as Record<string, unknown>
  const uddrag = o['uddrag']
  const regel = o['regel']
  if (typeof uddrag !== 'string' || !uddrag) {
    console.error('[billedforbehold] uddrag mangler eller er ikke en streng')
    return null
  }
  if (typeof regel !== 'string' || !(regel in FORBEHOLDSREGLER)) {
    console.error(`[billedforbehold] ukendt regel: ${JSON.stringify(regel)}`)
    return null
  }
  return { uddrag, regel: regel as Forbeholdsregel }
}

/**
 * Skal forbeholdet VISES?
 *
 * **Ja, hver gang kilden har taget det — også når belægget ikke holder.**
 *
 * Det er bevidst og det modsatte af billedvagten, hvor en vært uden for
 * allowlisten får billedet fjernet. Forskellen er, hvilken vej fejlen
 * koster: et billede, vi ikke viser, er en mangel, mens et forbehold, vi
 * ikke viser, er en PÅSTAND om, at billedet er af boligen. Gjorde vi
 * visningen betinget af, at belægget holder, ville en ændret regel
 * SLETTE forbeholdet fra skærmen — altså præcis den fejl, spændet blev
 * indført for at fange, med et ekstra lag til at skjule den.
 *
 * Belægget er derfor til efterprøvning, ikke til portvagt. Rækker, hvis
 * belæg ikke holder, findes af `npm run test:prod`.
 */
export const visForbehold = (imagesMayDiffer: boolean): boolean => imagesMayDiffer

/**
 * Belæg → kolonneværdi. Skrivesiden af `laesForbeholdsbelaeg`.
 *
 * Findes, fordi kolonnen med VILJE er typet `Record<string, unknown>`:
 * en `$type<Forbeholdsbelaeg>()` ville gøre hver læsning til den
 * ukontrollerede cast, hydratoren er skrevet for at undgå. Felterne
 * listes eksplicit, så et nyt felt på `Forbeholdsbelaeg` tvinger en
 * beslutning HER i stedet for at flyde med ulæst.
 */
export const belaegTilKolonne = (
  b: Forbeholdsbelaeg | null | undefined,
): Record<string, unknown> | null => (b ? { uddrag: b.uddrag, regel: b.regel } : null)
