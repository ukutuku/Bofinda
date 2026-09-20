// ═══════════════════════════════════════════════════════════════
//  Returadressen — vejen tilbage til den søgning, hun kom fra.
//
//  ═══ HVORFOR DEN IKKE KUNNE BYGGES AF `Filtre` ═══
//
//  Søgningen findes i to repræsentationer, og kun den ene er tabsfri:
//
//  · De rå `Soegeparametre`. Al navigation INDEN FOR resultatsiden
//    kopierer dem ordret og skifter én nøgle ud — `sideUrl` i
//    app/Sider.tsx, `kortLink` i app/page.tsx, `udenNavne` og
//    `soegeUrlSorteret` i lib/filterpanel.ts. Derfor overlever `sorter`,
//    `kort` og `side` et sideskift.
//  · `Filtre` i lib/soeg.ts. Den er en projektion til SQL. Den har slet
//    ikke `kort` og `side`, og `sorter` serialiseres ikke af `gruppeUrl`.
//
//  Ved kortets kant skiftede koden repræsentation, og det er dér,
//  sorteringen og listevisningen faldt på gulvet. `gruppeUrl` er RIGTIG
//  som svar på «hvilke boliger hører til i gruppens visning» — den er
//  bare ikke et svar på «hvor kom hun fra». Det er to spørgsmål, og de
//  får derfor hvert sit udtryk i stedet for at dele et forkert ét.
//
//  ═══ HVORFOR DEN ALDRIG KAN PEGE UD AF HUSET ═══
//
//  Værdien kommer fra en adresse, og en adresse er noget, enhver kan
//  skrive. Derfor ekkoes den aldrig. `returUrl` PARSER den og bygger et
//  NYT svar af en literal sti plus de nøgler, siden selv kender. Alt
//  andet falder væk, og kan stien ikke genkendes, er svaret null.
//
//  En præfikskontrol (`startsWith('/')`) ville ikke være nok:
//  `//fremmed.example` består den og er en absolut adresse til en anden
//  vært. Her findes den slags ikke, fordi uddata er bygget og ikke
//  videregivet.
//
//  Det er samme disciplin som `INTERNE_MAAL` i lib/kontovej.ts («den
//  sender ALDRIG en adresse») og `forrigeFiltre` i lib/maalingsoeg.ts
//  («strengen forlader aldrig denne funktion»).
// ═══════════════════════════════════════════════════════════════

/** Parameterens navn står ÉT sted. Den skrives tre steder og læses to. */
export const RETUR_PARAM = 'fra'

/**
 * Hvor lang en returadresse må være.
 *
 * Et loft, ikke en afkortning: en for lang værdi giver null, så der
 * aldrig bygges et halvt filter. Tallet er rundhåndet nok til alle
 * filtre sat på én gang med flere kilder og boligtyper.
 */
const MAKS = 512

/**
 * De nøgler, en resultatside kender. Hvidliste, ikke sortliste — samme
 * grund som adapternes felter: en ny parameter skal ignoreres, indtil
 * nogen bevidst tager den med.
 *
 * `gemt` står med vilje IKKE her. Den er forsidens besked om en fejlet
 * gemning, og at bære den tilbage ville vise en gammel fejl igen.
 */
const NOEGLER = [
  'sted', 'by', 'postnr', 'prisMin', 'prisMax', 'vaerelser', 'areal',
  'kilde', 'type', 'fuld', 'kaeledyr', 'elevator', 'udeplads',
  'overtagelse', 'venteliste', 'reserveret', 'sorter', 'kort', 'side',
  'flere',
] as const

/**
 * De baser, en returadresse må have.
 *
 * Søgesiden er `/`. Områdesiderne er `/lejeboliger/<slug>`, og slug'en
 * prøves mod formen fra lib/slug.ts — a-z, 0-9 og bindestreg og intet
 * andet. Begge bygges af en literal streng herunder.
 */
const OMRAADE = /^\/lejeboliger\/([a-z0-9-]+)$/

/** Kun det, der faktisk kan genkendes. Ellers ingen returadresse. */
function stien(raa: string): string | null {
  if (raa === '/') return '/'
  const m = OMRAADE.exec(raa)
  return m ? `/lejeboliger/${m[1]}` : null
}

/**
 * Returadressens VÆRDI, som den skrives i `?fra=`.
 *
 * `sti` er sidens egen, literale sti — `/` eller `/lejeboliger/<slug>` —
 * og `sp` er dens egne parametre, kopieret som `sideUrl` kopierer dem.
 *
 * Null når der ikke er noget at vende tilbage TIL: en forside uden
 * filtre er ikke en søgning, og en tom `fra=` ville desuden udløse
 * forsidens «én adresse pr. søgning»-omdirigering.
 */
export function returVaerdi(
  sti: string, sp: Record<string, string | string[] | undefined>,
): string | null {
  const rigtig = stien(sti)
  if (!rigtig) return null
  const p = new URLSearchParams()
  for (const n of NOEGLER) {
    const v = sp[n]
    if (v == null) continue
    for (const x of Array.isArray(v) ? v : [v]) if (x !== '') p.append(n, x)
  }
  const q = p.toString()
  // Forsiden uden parametre er ikke en søgning at vende tilbage til —
  // dér er «Forside» allerede det sande svar. En områdeside ER derimod
  // et sted, også uden filtre.
  if (!q && rigtig === '/') return null
  const v = q ? `${rigtig}?${q}` : rigtig
  return v.length <= MAKS ? v : null
}

/**
 * Værdien tilbage til en adresse, vi selv har bygget.
 *
 * Den parser og GENOPBYGGER. Der findes derfor ikke en streng, en
 * fremmed har skrevet, i uddata — kun en literal sti og de nøgler,
 * hvidlisten navngiver, i deres egen rækkefølge.
 */
export function returUrl(raa: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raa) ? raa[0] : raa
  if (!v || v.length > MAKS) return null
  const skaer = v.indexOf('?')
  const sti = stien(skaer === -1 ? v : v.slice(0, skaer))
  if (!sti) return null
  if (skaer === -1) return sti
  const ind = new URLSearchParams(v.slice(skaer + 1))
  const ud = new URLSearchParams()
  for (const n of NOEGLER) for (const x of ind.getAll(n)) if (x !== '') ud.append(n, x)
  const q = ud.toString()
  return q ? `${sti}?${q}` : sti
}

/** Hæng returadressen på et link, vi selv har bygget. */
export function medRetur(url: string, retur: string | null | undefined): string {
  if (!retur) return url
  const p = new URLSearchParams({ [RETUR_PARAM]: retur })
  return `${url}${url.includes('?') ? '&' : '?'}${p}`
}
