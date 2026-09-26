// ═══════════════════════════════════════════════════════════════
//  Koerselsgraenserne.
//
//  Spoergsmaalet pr. trin er ét: GOER dette trins fejl de foelgende trin
//  forkerte? Er svaret nej, hoerer trinet bag sin egen graense.
//
//  Baggrunden er maalt og ikke formodet: `ryd()` kastede hver time i fem
//  doegn, og fordi den stod ubeskyttet i scripts/import.ts, faldt
//  dagsaggregatet, alarmmatchningen OG udsendelsen bort med den. Ingen
//  bekraeftet bruger fik varsel i den periode. Det eneste indpakkede trin
//  var analytics-retention — det trin, hvis fejl betyder mindst, fordi
//  `haendelser_daglig` laeses af ingen fil i app/.
//
//  Orkestreringen ligger HER og ikke i scripts/import.ts, fordi en
//  graense, ingen har set fejle, ikke er en graense. Trinnene er
//  indsprøjtede, saa en proeve kan lade ét af dem kaste og efterse, at de
//  foelgende stadig koerte — og at det MODSATTE sker uden graensen. Samme
//  greb og samme begrundelse som `indsaetBase` i db/client.ts og
//  `_saetKontekst` i lib/maaling-server.ts.
//
//  Filen importerer med vilje HVERKEN databasen eller Next: den skal
//  kunne proeves uden noget omkring sig.
// ═══════════════════════════════════════════════════════════════

export type Trinnavn = 'opstart' | 'kilder' | 'oprydning' | 'maaling' | 'match' | 'mail'

export interface Trin {
  navn: Trinnavn
  /**
   * Falsk = dette trins fejl standser hele koerslen, med vilje.
   *
   * Kun `opstart` er uisoleret: uden kilderegistret er der intet at
   * arbejde paa, og de foelgende trin ville arbejde paa et tomt grundlag.
   */
  isoleret: boolean
  koer: () => Promise<void>
}

export interface Udfald {
  /** Isolerede trin, der fejlede. Koerslen fortsatte forbi dem. */
  fejlede: Trinnavn[]
  /** Sat, hvis et UISOLERET trin kastede. Koerslen naaede ikke videre. */
  afbrudt: { trin: Trinnavn; fejl: string } | null
}

/** En kastet vaerdi behoever ikke vaere en Error, og `message` kan vaere tom. */
export function besked(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  return String(e)
}

/**
 * Koerer trinnene i orden og respekterer hver enkelts graense.
 *
 * Kaster aldrig selv: det er hele formaalet. Et isoleret trins fejl
 * logges og huskes; et uisoleret trins fejl afslutter koerslen og
 * returneres, saa kalderen kan skrive slutlinjen.
 */
export async function koerTrin(
  trin: Trin[],
  ud: (s: string) => void,
): Promise<Udfald> {
  const fejlede: Trinnavn[] = []
  for (const t of trin) {
    try {
      await t.koer()
    } catch (e) {
      if (!t.isoleret) return { fejlede, afbrudt: { trin: t.navn, fejl: besked(e) } }
      fejlede.push(t.navn)
      // Samme form som `[maaling] oprydning fejlede: …` havde i forvejen.
      // Den var den rigtige model; de oevrige trin manglede den bare.
      ud(`[${t.navn}] FEJLEDE: ${besked(e)}`)
    }
  }
  return { fejlede, afbrudt: null }
}

/**
 * Slutlinjen. Koerslen skal ALTID ende paa «afsluttet» eller «afbrudt».
 *
 * Railway har `restartPolicyType: NEVER` og `startCommand: npm run import`,
 * saa containeren afslutter uanset udfald. Foer denne linje var det eneste
 * succes-maerke `import afsluttet` som SIDSTE saetning i filen: et kast hvor
 * som helst ovenfor gav en log, der blot stoppede — og som var et PRAEFIKS
 * af en gennemfoert koersels log. En nedbrudt og en gennemfoert koersel saa
 * derfor ens ud udefra, og `crawl_runs` saa oveni koebet sund ud, fordi
 * importen naaede at skrive sine raekker foer nedbrudspunktet.
 *
 * Ender loggen paa INGEN af de to linjer, er processen draebt udefra
 * (OOM, SIGKILL) — og det er i sig selv et laesbart signal.
 */
export function slutlinje(u: Udfald): string {
  if (u.afbrudt) return `import afbrudt: ${u.afbrudt.trin} — ${u.afbrudt.fejl}`
  if (u.fejlede.length) return `import afsluttet · fejl i: ${u.fejlede.join(', ')}`
  return 'import afsluttet'
}

/** 0 kun naar hele koerslen gjorde, hvad den skulle. */
export function exitkode(u: Udfald): 0 | 1 {
  return u.afbrudt || u.fejlede.length ? 1 : 0
}
