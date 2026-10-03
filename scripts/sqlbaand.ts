// ═══════════════════════════════════════════════════════════════
//  SQL-båndet — hvad basen FAKTISK blev spurgt om.
//
//  Findes for ét spørgsmål, som ingen returværdi kan svare på: skete
//  det beskyttede opslag?
//
//  En adgangsvagt kan gå tabt på to måder. Fjernes den, bærer svaret
//  pludselig data, og det kan ses. FLYTTES den derimod om BAG det
//  beskyttede opslag, svarer den stadig nej, og svaret er bit for bit
//  det samme som det rigtige nej — mens felterne har forladt
//  databasen. Forskellen findes ét eneste sted: i de sætninger, der
//  nåede basen.
//
//  Båndet ligger i en TESTHJÆLPER, ikke i produktionskoden. Drizzles
//  egen `logger` er indgangen; den kaldes for hver sætning, og når
//  ingen optager, gør den ingenting. Produktionen bygger sin klient i
//  db/client.ts uden logger og rører den aldrig.
//
//  BÅNDET ER IKKE EN TEKSTSØGNING I EN KILDEFIL. Det er den SQL,
//  driveren sendte under en rigtig kørsel af kaldestedet. En vagt, der
//  står i en gren, ingen når, sætter intet på båndet.
// ═══════════════════════════════════════════════════════════════

let baand: string[] | null = null

/** Gives til drizzle i scripts/testbase.ts. Tavs, når ingen optager. */
export const sqllogger = {
  logQuery(forespoergsel: string) {
    if (baand) baand.push(forespoergsel)
  },
}

/**
 * Kør `f`, og få BÅDE dens svar og den SQL, den udløste.
 *
 * Det forrige bånd gemmes og lægges tilbage, så en optagelse inde i en
 * anden optagelse ikke stjæler dens sætninger.
 */
export async function optag<T>(f: () => Promise<T>): Promise<{ svar: T; sql: string[] }> {
  const foer = baand
  const mit: string[] = []
  baand = mit
  try {
    return { svar: await f(), sql: mit }
  } finally {
    baand = foer
  }
}

/**
 * De sætninger, der rører et navngivet navn — en tabel eller en kolonne.
 *
 * Drizzle citerer begge dele, og citationstegnene er dét, der gør prøven
 * præcis: `"listings"` rammer hverken tabellen `"listing_images"` eller
 * kolonnen `"listing_id"`, som målingens egen skrivning bærer. Uden dem
 * ville en `paywall_blocked`-række ligne et beskyttet opslag.
 *
 * Returnerer RÆKKERNE og ikke en boolean: en prøve, der fejler, skal
 * kunne sige HVILKEN sætning der ikke burde have været der.
 */
export const roerer = (sql: string[], navn: string): string[] =>
  sql.filter((q) => q.includes(`"${navn}"`))
