// ═══════════════════════════════════════════════════════════════
//  Gengiv en drizzle-forespørgsel som ren SQL-tekst — uden en database.
//
//  Målinger, der skal køres i Supabases SQL-editor, må ikke skrive appens
//  prædikater af i hånden: så fandtes der to udtryk for det samme
//  spørgsmål. Her bygges forespørgslen af appens EGNE udtryk med drizzles
//  `QueryBuilder`, og parametrene skrives ind som literaler, så teksten
//  kan indsættes, som den er.
//
//  Parametrene erstattes i ÉT gennemløb over skabelonen. At erstatte
//  `$10` før `$1` med split/join virker også, men så kan en indsat værdi,
//  der selv indeholder `$1`, blive erstattet igen. Ukendte typer afvises
//  frem for at blive gættet.
// ═══════════════════════════════════════════════════════════════

export function indsaetParametre(skabelon: string, params: readonly unknown[]): string {
  return skabelon.replace(/\$(\d+)/g, (hel, n: string) => {
    const i = Number(n) - 1
    if (i < 0 || i >= params.length) throw new Error(`parameter ${hel} findes ikke (${params.length} parametre)`)
    const v = params[i]
    if (v == null) return 'null'
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
    throw new Error(`parameter ${hel} har en type, gengivelsen ikke kender: ${typeof v}`)
  })
}

/** Forespørgslen som tekst, parametrene skrevet ind. */
export function gengiv(q: { toSQL(): { sql: string; params: unknown[] } }): string {
  const { sql, params } = q.toSQL()
  return indsaetParametre(sql, params)
}
