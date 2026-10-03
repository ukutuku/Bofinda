// ═══════════════════════════════════════════════════════════════
//  ISOLATIONSVAGTEN — ét sted, så kontrolscripterne ikke kan ramme
//  andet end den isolerede testbase.
//
//  ── PRINCIPPET ────────────────────────────────────────────────
//
//  TO UDTRYK, DER SKAL VÆRE ENIGE, FREM FOR ÉT, DER SKAL VÆRE RIGTIGT.
//
//  Det er hele begrundelsen. Et værn, der hviler på ÉT udtryk, er kun så
//  godt som det udtryk — og et udtryk kan være forkert kopieret, forældet
//  eller skrevet om en virkelighed, der har flyttet sig. Tre uafhængige
//  signaler, der skal pege på det samme, kan ikke alle tre være forkerte
//  på samme måde.
//
//  Formen er taget fra scripts/staging/maal.ts, som gør netop det for
//  staging: projektets ref udtrækkes af BÅDE databasens URL og API-URL'en,
//  og de to skal være enige. Her er signalerne:
//
//    1 · FORMEN.     URL'en siger, at målet er 127.0.0.1:55432/bofinda_test.
//    2 · SERVERENS   Forbindelsen SPØRGER serveren, hvad den selv hedder
//        EGET SVAR.  (`current_database()`, `inet_server_port()`), og de
//                    to svar skal stemme med URL'en. URL'en er en PÅSTAND;
//                    serverens svar er et FAKTUM. En tunnel, en pooler
//                    foran, en forkert kopieret streng — alt det kan få
//                    påstanden til at lyve. Svaret kan den ikke.
//    3 · INDHOLDET.  Et loft på rækkeantallet. Finder scriptet 10.000
//                    boliger, taler det ikke med testbasen, uanset hvad
//                    URL'en og serveren sagde. Det er IKKE en
//                    ressourcegrænse — det er et tredje identitetssignal,
//                    og det eneste, der ser på data. Det kan kun narres af
//                    en testbase, nogen har fyldt med produktionsdata, og
//                    så er den ikke en testbase længere.
//
//  ── HVORFOR DET HER MODUL FINDES ──────────────────────────────
//
//  Målt 1. oktober 2026: vagten fandtes i NI kopier i FIRE stavemåder i
//  scripts/cloud/ — og SEKS forbindelser havde ingen vagt overhovedet.
//  Kopierne var hver især rigtige nok; det var mængden af dem, der
//  skabte hullerne. En tiende kopi gør det værre, også når den er rigtig.
//
//  Et værn, der driver, er værre end en regel, der driver: en regel giver
//  forkerte svar, som kan ses, mens et værn giver INGEN svar — scriptet
//  kører videre og melder produktionens tal som det syntetiske sæts.
//
//  ── TESTBARHED ────────────────────────────────────────────────
//
//  De tre krav er RENE funktioner. De tager tal og svar, kalderen har
//  hentet, så modulet ikke selv skal kende databasen — samme greb som
//  `kraevTom` i scripts/staging/maal.ts. Derfor kan de prøves uden en
//  forbindelse, og `aabnIsoleret` er de tre linjer, der binder dem.
//
//  `env` gives ind frem for at læse `process.env` direkte, så en prøve kan
//  række en håndlavet blok ind — igen som maal.ts.
// ═══════════════════════════════════════════════════════════════

/** Vagtens egen fejltype, så en kalder kan skelne den fra en netværksfejl. */
export class Isolationsfejl extends Error {
  constructor(besked) { super(besked); this.name = 'Isolationsfejl' }
}

/** Testbasen, ét sted. Samme tal som BOFINDA_PGPORT/PGDB i miljoe.sh. */
export const TESTBASE = Object.freeze({
  vaerter: Object.freeze(['127.0.0.1', 'localhost', '[::1]']),
  port: '55432',
  database: 'bofinda_test',
})

/** Loftet. 280 er det nuværende seed; 2.000 giver luft uden at nå
 *  produktionens ~1.800 synlige + bagkatalog. Se noten i hovedet: det er
 *  et identitetssignal, ikke en ressourcegrænse. */
export const LOFT = 2000

/**
 * SIGNAL 1 · Formen. Hvad URL'en PÅSTÅR.
 *
 * Alle tre loopback-skrivemåder tælles, fordi `localhost` og `[::1]` er
 * samme maskine som `127.0.0.1` — en vagt, der kun kender den ene, afviser
 * en rigtig kørsel og bliver slået fra i stedet for rettet.
 *
 * Stien sammenlignes med `===`, ikke med `endsWith`. Et suffiksmatch lader
 * `/prod_bofinda_test` passere, og det er den fejl, der skulle rettes.
 */
export function kraevIsoleretUrl(url) {
  if (!url) {
    throw new Isolationsfejl(
      'ingen DATABASE_URL. Der er ingen standardbase — kør gennem scripts/cloud/.')
  }
  let u
  try { u = new URL(url) } catch {
    throw new Isolationsfejl(`DATABASE_URL kan ikke læses som en URL: ${url.slice(0, 40)}`)
  }
  const ok = TESTBASE.vaerter.includes(u.hostname)
    && u.port === TESTBASE.port
    && u.pathname === `/${TESTBASE.database}`
  if (!ok) {
    // Navngiver hvad den SÅ. En vagt, der kun siger «forkert mål», tvinger
    // den næste til at gætte, og et gæt bliver et `|| true`.
    throw new Isolationsfejl(
      `målet er ikke den isolerede testbase.\n`
      + `      forventet 127.0.0.1:${TESTBASE.port}/${TESTBASE.database}\n`
      + `      fik       ${u.hostname}:${u.port}${u.pathname}`)
  }
  return u
}

/**
 * SIGNAL 2 · Serverens eget svar. Hvad serveren SIGER, den er.
 *
 * `svar` er `{ database, port }`, hentet af kalderen med
 * `select current_database(), inet_server_port()`. Stemmer de ikke med
 * URL'en, taler vi med en anden base end den, vi tror — og det er netop
 * det tilfælde, signal 1 ikke kan se.
 */
export function kraevSammeBase(svar) {
  const database = svar?.database ?? null
  const port = svar?.port == null ? null : String(svar.port)
  if (database !== TESTBASE.database || port !== TESTBASE.port) {
    throw new Isolationsfejl(
      `serveren siger noget andet end URL'en.\n`
      + `      URL'en lovede  ${TESTBASE.database} på ${TESTBASE.port}\n`
      + `      serveren svarer ${database ?? '(intet)'} på ${port ?? '(intet)'}`)
  }
}

/**
 * SIGNAL 3 · Indholdet. Hvad basen INDEHOLDER.
 *
 * `tal` er tællinger, kalderen har hentet. Over loftet er det ikke
 * testbasen, hvad end de to andre signaler sagde.
 */
export function kraevLilleBase(tal, loft = LOFT) {
  for (const [navn, n] of Object.entries(tal ?? {})) {
    if (typeof n === 'number' && n > loft) {
      throw new Isolationsfejl(
        `basen indeholder ${n} ${navn}. Over ${loft} ligner det ikke testbasen.\n`
        + `      Stoppet — kontrollér målet. Intet er skrevet.`)
    }
  }
}

/**
 * Alle tre, og en åben forbindelse.
 *
 * `ssl: false` er IKKE et gæt her. Signal 1 har allerede krævet loopback,
 * og loopback går ikke over nettet — samme begrundelse som `tlsFor()` i
 * db/client.ts fravælger TLS for loopback, og samme som `sslmode=disable`
 * i `test_url()` i miljoe.sh. Før lå `{ ssl: false }` hardkodet i hvert
 * script UDEN at nogen havde krævet loopback, og dér var det et gæt, der
 * tilfældigvis også stoppede noget.
 *
 * `DATABASE_URL_DIRECT` læses FØR `DATABASE_URL`, samme rækkefølge som de
 * ni kopier brugte. Begge læses, fordi wrapperne sætter hver sin:
 * kontrol.sh sætter `_DIRECT`, app-op.sh sætter den anden — og et script,
 * der kun kender én af dem, ser det omgivende miljø i stedet.
 */
export async function aabnIsoleret(env = process.env, { loft = LOFT, taelFra = ['listings'] } = {}) {
  const url = env.DATABASE_URL_DIRECT || env.DATABASE_URL || ''
  kraevIsoleretUrl(url)

  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })
  try {
    const [id] = await sql`
      select current_database() as database, inet_server_port()::int as port`
    kraevSammeBase(id)

    const tal = {}
    for (const tabel of taelFra) {
      const [r] = await sql`select count(*)::int as n from ${sql(tabel)}`
      tal[tabel] = r.n
    }
    kraevLilleBase(tal, loft)
  } catch (f) {
    await sql.end({ timeout: 5 }).catch(() => {})
    throw f
  }
  return sql
}

/**
 * Til et script, der vil fejle højt og tydeligt frem for at kaste.
 * Exit 1 og aldrig 0: en vagt, der springer over med exit 0, er en vagt,
 * der ikke findes. Det var præcis `gruppeadgang.mjs`' fejl.
 */
export async function aabnIsoleretEllerStop(env = process.env, opts) {
  try {
    return await aabnIsoleret(env, opts)
  } catch (f) {
    if (f instanceof Isolationsfejl) {
      process.stderr.write(`FEJL: ${f.message}\n`)
      process.exit(1)
    }
    throw f
  }
}
