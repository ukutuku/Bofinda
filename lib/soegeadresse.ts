// ═══════════════════════════════════════════════════════════════
//  Én adresse pr. søgning — reglen ét sted.
//
//  Ren logik: ingen database, ingen next-import.
//
//  En GET-formular sender ALLE sine felter, også de tomme, og siden
//  svarer 307 til den rene adresse (app/page.tsx). Det er rigtigt for
//  adresserne, men det kostede en ekstra fuld rundtur ved HVER søgning
//  og hvert «Vis resultater»: browser → server → 307 → browser → server.
//  På en simuleret telefonforbindelse var det ~150 ms ekstra før første
//  byte; i produktionen er det en funktionskørsel mere.
//
//  Nu rydder formularen selv op, før den sender (app/RenSoegeformular.tsx),
//  og redirectet bliver stående for den, der ikke har JavaScript. De to
//  steder bruger SAMME funktion, så browseren går direkte til den adresse,
//  serveren ellers ville have sendt den videre til. Svarede de hver for
//  sig, kunne de drive fra hinanden, og så ville redirectet stille komme
//  tilbage — eller værre: browseren rydde noget væk, serveren havde beholdt.
// ═══════════════════════════════════════════════════════════════

/** En tom værdi, eller standardsorteringen («nyeste» er det samme som ingen). */
export const overfloedig = (navn: string, vaerdi: string): boolean =>
  vaerdi === '' || (navn === 'sorter' && vaerdi === 'nyeste')

/**
 * Fjerner de overflødige parametre og samler gentagne navne i den orden,
 * navnet FØRST optræder — præcis som serveren gør, når den løber
 * `Object.entries(searchParams)` igennem og bygger den rene adresse.
 *
 * `snavs` er sand, når mindst én parameter blev fjernet; da er `rent` den
 * adresse, serverens redirect peger på.
 */
export function renSoegning(par: Iterable<readonly [string, string]>): {
  rent: [string, string][]
  snavs: boolean
} {
  const pr = new Map<string, string[]>()
  let snavs = false
  for (const [navn, vaerdi] of par) {
    const liste = pr.get(navn) ?? []
    if (!pr.has(navn)) pr.set(navn, liste)
    if (overfloedig(navn, vaerdi)) { snavs = true; continue }
    liste.push(vaerdi)
  }
  const rent: [string, string][] = []
  for (const [navn, vaerdier] of pr) for (const v of vaerdier) rent.push([navn, v])
  return { rent, snavs }
}
