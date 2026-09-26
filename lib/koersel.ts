// ═══════════════════════════════════════════════════════════════
//  Koerselsgraenserne.
//
//  Spoergsmaalet pr. trin er ét: GOER dette trins fejl de foelgende trin
//  forkerte? Er svaret nej, hoerer trinet bag sin egen graense. Er svaret
//  ja, skal koerslen stoppe — eller det afhaengige trin springes over.
//
//  Baggrunden er maalt: `ryd()` kastede hver time i fem doegn, og fordi
//  den stod ubeskyttet i scripts/import.ts, faldt dagsaggregatet,
//  alarmmatchningen OG udsendelsen bort med den. Ingen bekraeftet bruger
//  fik varsel. Det eneste indpakkede trin var analytics-retention — det
//  trin, hvis fejl betyder mindst.
//
//  GRAENSERNE STAAR HER OG KUN HER. `GRAENSER` og `AFHAENGIGHEDER` er
//  tabellerne; scripts/import.ts bygger sine trin af dem, og
//  scripts/test-koersel.ts proever dem. Foer laa flagene i trinlisten i
//  scripts/import.ts, hvor ingen proeve kunne se dem: hele saettet blev
//  groent, selv naar hvert eneste flag var vendt om. Flagene og deres
//  proeve skal laese det SAMME sted, ellers proever de hver sin ting.
//
//  Filen importerer med vilje HVERKEN databasen eller Next.
// ═══════════════════════════════════════════════════════════════

export type Trinnavn = 'opstart' | 'kilder' | 'oprydning' | 'maaling' | 'match' | 'mail'

/**
 * Er trinets fejl dets EGEN sag? Falsk = koerslen stopper.
 *
 * `opstart` · FALSK. Kaster kilderegistret, ved vi ikke, hvad vi blev bedt
 *   om. De senere trin laeser ikke registret og ville teknisk kunne koere
 *   — men en koersel, der ikke kan afgoere sit eget grundlag, skal ses paa
 *   af et menneske, ikke logges som halvt gennemfoert.
 *
 * `oprydning` · FALSK, og det er en RETTELSE. Den var isoleret i foerste
 *   udgave med begrundelsen, at afsendelsen har egne vaern. Det er kun
 *   sandt for to af `ryd()`s tre sletninger. Den tredje — «for gammel»,
 *   `ALDER_MAANEDER = 24` i lib/alarm.ts — har INTET andet vaern: en 24
 *   maaneder gammel soegning er bekraeftet, er ikke afmeldt og har
 *   `notify_email` sat, saa den passerer baade `isNotNull(confirmedAt)` i
 *   `matchAlarmer`/`ventende` og `!paaMail || afmeldt` i `sendAlarmer`.
 *   `ryd()`s sletning 3 er det eneste sted i produktionen, der haandhaever
 *   loeftet i /privatliv om sletning efter 24 maaneder. Isoleret ville
 *   `match` og `mail` koere videre i SAMME koersel og sende til en adresse,
 *   vi har skrevet at vi havde slettet — og en mail kan ikke kaldes
 *   tilbage. Cascade ved naeste gennemfoerte `ryd()` retter ikke det.
 *   Det er samtidig det, `ryd()` selv skriver: kaster den, SKAL koerslen
 *   stoppe. De to steder siger nu det samme.
 *   Skal trinet isoleres igen, skal aldersproeven foerst bo ÉT sted og
 *   afledes derfra, saa en udeblevet `ryd()` ikke kan blive en afsendelse.
 *
 * Resten er isolerede: deres fejl gør de foelgende ufuldstaendige, ikke
 * forkerte.
 */
export const GRAENSER: Record<Trinnavn, boolean> = {
  opstart: false,
  kilder: true,
  oprydning: false,
  maaling: true,
  match: true,
  mail: true,
}

/**
 * Trin, der ikke maa koere, hvis et andet trin fejlede.
 *
 * `mail` kraever `match`. `matchAlarmer` indsaetter i portioner à 500 pr.
 * soegning; kaster portion 2 af 5, staar soegningen med en HALV koe. Koerer
 * `mail` alligevel, bygger `sendAlarmer` emnet af `g.length` og paastaar et
 * antal, vi ved er for lavt — og saetter saa `lastNotifiedAt`, saa resten
 * udskydes mindst en time af 60-minutters-uret. Paa main var det umuligt,
 * fordi et kast fra `matchAlarmer()` forhindrede, at `sendAlarmer()`
 * overhovedet blev naaet. Isoleringen af `match` maa ikke koebe den
 * mulighed. En afkortet koe er ikke en ufuldstaendig levering; den er en
 * forkert paastand om, hvor mange boliger der er.
 */
export const AFHAENGIGHEDER: Partial<Record<Trinnavn, Trinnavn>> = {
  mail: 'match',
}

export interface Trin {
  navn: Trinnavn
  koer: () => Promise<void>
}

export interface Udfald {
  /** Isolerede trin, der fejlede. Koerslen fortsatte forbi dem. */
  fejlede: Trinnavn[]
  /** Trin, der blev sprunget over, fordi det de kraever fejlede. */
  sprunget: Trinnavn[]
  /** Sat, hvis et UISOLERET trin kastede. Koerslen naaede ikke videre. */
  afbrudt: { trin: Trinnavn; fejl: string } | null
}

/**
 * En kastet vaerdi behoever ikke vaere en Error.
 *
 * `String(e)` kaster selv paa en vaerdi uden primitiv konvertering — et
 * objekt fra `Object.create(null)`, eller et med en `toString`, der
 * kaster. Kastede den her, ville `koerTrin` bryde sit eget loefte om aldrig
 * at kaste, og et isoleret trins fejl ville alligevel tage resten med.
 */
export function besked(e: unknown): string {
  try {
    if (e instanceof Error) return enLinje(e.message || e.name)
    return enLinje(String(e))
  } catch {
    return 'ukendt fejl (kunne ikke laeses)'
  }
}

/**
 * Presser en besked ned paa én linje.
 *
 * Slutlinjen loever, at loggen ENDER paa den. En flerlinjet fejlbesked —
 * og Postgres' er flerlinjede, med `DETAIL:` og `HINT:` paa egne linjer —
 * ville skubbe halen af beskeden ud efter slutlinjen og braekke garantien.
 */
export function enLinje(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Koerer trinnene i orden og respekterer hver enkelts graense.
 *
 * Kaster aldrig selv: det er hele formaalet. `ud` kaldes derfor ogsaa bag
 * et vaern — en logfunktion, der kaster, maa ikke kunne vaelte koerslen,
 * som den netop skal rapportere om.
 */
export async function koerTrin(
  trin: Trin[],
  ud: (s: string) => void,
  graenser: Record<Trinnavn, boolean> = GRAENSER,
  afhaengigheder: Partial<Record<Trinnavn, Trinnavn>> = AFHAENGIGHEDER,
): Promise<Udfald> {
  const fejlede: Trinnavn[] = []
  const sprunget: Trinnavn[] = []
  const sig = (s: string) => { try { ud(s) } catch { /* loggen maa ikke vaelte koerslen */ } }

  for (const t of trin) {
    const kraever = afhaengigheder[t.navn]
    if (kraever && (fejlede.includes(kraever) || sprunget.includes(kraever))) {
      sprunget.push(t.navn)
      sig(`[${t.navn}] SPRUNGET OVER: ${kraever} fejlede`)
      continue
    }
    try {
      await t.koer()
    } catch (e) {
      if (!graenser[t.navn]) return { fejlede, sprunget, afbrudt: { trin: t.navn, fejl: besked(e) } }
      if (!fejlede.includes(t.navn)) fejlede.push(t.navn)
      sig(`[${t.navn}] FEJLEDE: ${besked(e)}`)
    }
  }
  return { fejlede, sprunget, afbrudt: null }
}

/**
 * Slutlinjen. Koerslen skal ALTID ende paa «afsluttet» eller «afbrudt»,
 * paa ÉN linje, og den skal navngive alt, der gik galt.
 *
 * Railway har `restartPolicyType: NEVER` og `startCommand: npm run import`,
 * saa containeren afslutter uanset udfald. Foer var det eneste succes-maerke
 * `import afsluttet` som SIDSTE saetning i filen: et kast hvor som helst
 * ovenfor gav en log, der blot stoppede — og som var et PRAEFIKS af en
 * gennemfoert koersels log. En nedbrudt og en gennemfoert koersel saa derfor
 * ens ud udefra, og `crawl_runs` saa oveni koebet sund ud, fordi importen
 * naaede at skrive sine raekker foer nedbrudspunktet.
 *
 * `fejlede` og `sprunget` staar med, OGSAA naar koerslen blev afbrudt:
 * foerste udgave returnerede paa afbrudt-grenen og tabte dem, og saa
 * manglede netop den oplysning, linjen findes for at give.
 *
 * Ender loggen paa INGEN af de to linjer, er processen draebt udefra
 * (OOM, SIGKILL) — og det er i sig selv et laesbart signal.
 */
export function slutlinje(u: Udfald): string {
  const dele: string[] = []
  if (u.fejlede.length) dele.push(`fejl i: ${u.fejlede.join(', ')}`)
  if (u.sprunget.length) dele.push(`sprunget: ${u.sprunget.join(', ')}`)
  const hale = dele.length ? ' · ' + dele.join(' · ') : ''
  if (u.afbrudt) {
    return enLinje(`import afbrudt: ${u.afbrudt.trin} — ${u.afbrudt.fejl}${hale}`)
  }
  return enLinje(`import afsluttet${hale}`)
}

/**
 * 0 kun naar hele koerslen gjorde, hvad den skulle.
 *
 * GRAENSEN FOR, HVAD DEN KAN SE: den ser kun, om et trin KASTEDE. Fejler
 * samtlige kilder, kaster kilder-trinet ikke, fordi `koerAlle` fanger pr.
 * kilde — og fejler hver enkelt modtager i `sendAlarmer`, kaster
 * mail-trinet heller ikke af sig selv. Begge trin RAPPORTERER derfor selv
 * ved at kaste, naar intet lykkedes; se scripts/import.ts. Uden det ville
 * en koersel, hvor ingen kilde og ingen mail kom igennem, afslutte med 0.
 */
export function exitkode(u: Udfald): 0 | 1 {
  return u.afbrudt || u.fejlede.length || u.sprunget.length ? 1 : 0
}
