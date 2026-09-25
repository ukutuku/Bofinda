// ═══════════════════════════════════════════════════════════════
//  Opremsninger på dansk.
//
//  Footeren skrev «Boliger fra A og B og C og D …» — elleve «og» i
//  træk, fordi listen blev sat sammen med `join(' og ')`. Det er
//  rigtigt for to led og forkert for alle andre antal, og det blev
//  først forkert, da kilde nummer tre kom til. En sammenføjning, der
//  kun er sand for det antal, der var, da den blev skrevet, holder op
//  med at være sand uden at nogen rører den.
//
//  Dansk sætter komma mellem alle led på nær det sidste, og «og» foran
//  det sidste — uden komma før «og» (Retskrivningsordbogen; der er
//  ikke Oxford-komma på dansk).
// ═══════════════════════════════════════════════════════════════

/**
 * `['A']`            → «A»
 * `['A','B']`        → «A og B»
 * `['A','B','C']`    → «A, B og C»
 *
 * Tomme og blanke led kasseres, så en manglende værdi ikke bliver til
 * et hængende komma. Er der intet tilbage, er svaret den tomme streng —
 * kalderen afgør, hvad der så skal stå.
 */
export function paaDansk(ord: readonly (string | null | undefined)[]): string {
  const rene = ord.map((o) => (o ?? '').trim()).filter((o) => o.length > 0)
  if (rene.length === 0) return ''
  if (rene.length === 1) return rene[0]!
  return `${rene.slice(0, -1).join(', ')} og ${rene[rene.length - 1]}`
}
