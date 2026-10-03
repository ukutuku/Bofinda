// ═══════════════════════════════════════════════════════════════
//  En skrivebeskyttet forbindelse, håndhævet af basen — ikke af, at
//  scriptet tilfældigvis kun indeholder select. Og et mål, der er
//  NAVNGIVET i kommandoen og efterprøvet mod basen selv — ikke det, der
//  tilfældigvis står i miljøet.
//
//  DATABASE_URL_DIRECT (aldrig transaction-pooleren på :6543, der ikke kan
//  holde en session), én forbindelse, `set session characteristics as
//  transaction read only`, og SHOW før og efter. Forbindelsen sættes ind
//  i appens db/client.ts med indsaetBase, så sidens egne funktioner (soeg,
//  opsummering, forsidetal …) kører gennem den.
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const stop = (m) => { console.error(`FEJL: ${m}`); process.exit(3) }

/**
 * Testbasens port og navn står ÉT sted: scripts/cloud/miljoe.sh, som
 * krav_isoleret også læser. De læses af filen, ikke af miljøet — en
 * BOFINDA_PGPORT i skallen må ikke kunne udvide, hvad «test» betyder.
 */
function testbasen(rod) {
  let t
  try { t = readFileSync(join(rod, 'scripts/cloud/miljoe.sh'), 'utf8') } catch {
    stop(`kan ikke læse testbasens krav fra ${join(rod, 'scripts/cloud/miljoe.sh')} (sæt ROD til roden af checkout'en).`)
  }
  const port = (/^BOFINDA_PGPORT=(\d+)\s*$/m.exec(t) || [])[1], navn = (/^BOFINDA_PGDB=([a-z0-9_]+)\s*$/m.exec(t) || [])[1]
  if (!port || !navn) stop('fandt ikke BOFINDA_PGPORT og BOFINDA_PGDB i scripts/cloud/miljoe.sh.')
  return { port, navn }
}

/**
 * Projekternes refs og aflæsningen af en forbindelsesstreng står ÉT sted:
 * scripts/staging/maal.ts (STAGING_REF, PRODUKTION_REF, refFraDatabaseUrl),
 * staging-værnets egen fil. De importeres derfra og skrives ikke af her.
 */
async function projekter(rod) {
  const sti = join(rod, 'scripts/staging/maal.ts')
  try { return await import(sti) } catch (e) { stop(`kan ikke læse projekternes refs fra ${sti} (${e.message}).`) }
}

/**
 * KOMMANDOEN NAVNGIVER SIT MÅL — der er ingen standard.
 *
 * En kommando i dokumentationen er en kommando, nogen kører. Den første
 * importkommando i GREB-3.md (ca32bb2) tog sit mål fra miljøet og kunne
 * have ramt produktionen og sendt alarmmails. Reglen herfra: `--maal test`
 * eller `--maal prod` står i kommandoen, og forbindelsen — fra .env eller
 * skallen — skal SVARE til navnet, ellers afbrydes der med exit 3, før
 * nogen forbindelse åbnes (samme kode som storage-prøvens vagter.ts:
 * 3 = kunne ikke køre). Kravet er POSITIVT begge veje: hvad målet ER, ikke
 * hvad det ikke må være. En denyliste («ikke 127.0.0.1») godkendte i
 * efterprøvningen testbasen via 0.0.0.0, 127.1 og LOCALHOST som
 * «produktionen».
 *
 *   test   127.0.0.1 eller localhost · port og base fra
 *          scripts/cloud/miljoe.sh (55432/bofinda_test).
 *   prod   en Supabase-vært: *.pooler.supabase.com (session-pooleren)
 *          eller db.<ref>.supabase.co (direkte) · basen /postgres · og
 *          projektet er PRODUKTION_REF. Ref'en læses af den kanal, der
 *          afgør, HVOR der forbindes: værten i den direkte form, brug-
 *          ernavnet hos pooleren (som alle projekter i regionen deler).
 *          Et andet projekts direkte vært afvises derfor, uanset hvad
 *          brugernavnet bærer. Bærer både værten og brugernavnet en ref,
 *          skal de desuden være ens: det fanger en fejlkopieret streng
 *          med produktionens vært og et andet projekts bruger.
 * Begge: kun forespørgselsparametrene sslmode og pgbouncer — psql følger
 * ?host=, ?dbname= og ?port= og ville ellers kunne omdirigeres bag om
 * vagten. Bagefter spørger laastBase basen selv (current_database og
 * inet_server_port), som scripts/cloud/app-op.sh gør. For prod siger
 * svaret kun, at basen hedder postgres — det gør den i alle Supabase-
 * projekter. Projektet afgøres af værten og ref'en, før der forbindes.
 */
export async function kraevMaal(argv = process.argv.slice(2), url = process.env.DATABASE_URL_DIRECT, rod = process.env.ROD) {
  const i = argv.indexOf('--maal'), maal = i >= 0 ? argv[i + 1] : null
  if (maal !== 'test' && maal !== 'prod') {
    stop('navngiv målet: --maal test (den isolerede testbase) eller --maal prod (produktionen). Der er ingen standard.')
  }
  if (!url) stop('DATABASE_URL_DIRECT er ikke sat. Der er ingen standardbase — og DATABASE_URL bruges ikke.')
  let u
  try { u = new URL(url) } catch { stop('DATABASE_URL_DIRECT er ikke en gyldig URL.') }
  if (!/^postgres(ql)?:$/.test(u.protocol)) stop(`ukendt skema ${u.protocol}`)
  let bruger
  try { bruger = decodeURIComponent(u.username).toLowerCase() } catch { stop('brugernavnet i DATABASE_URL_DIRECT er ikke gyldigt procentkodet.') }
  const vaert = u.hostname.toLowerCase()
  const hvor = `${vaert}:${u.port || 5432}${u.pathname}`
  for (const k of u.searchParams.keys()) {
    if (!['sslmode', 'pgbouncer'].includes(k)) stop(`forespørgselsparameteren «${k}» er ikke tilladt: den kan flytte forbindelsen bag om vagten.`)
  }
  if (u.port === '6543') stop('transaction-pooleren (:6543) kan ikke holde en read-only-session. Brug DATABASE_URL_DIRECT på 5432.')
  const rodSti = rod ?? join(new URL('.', import.meta.url).pathname, '../../..')
  if (maal === 'test') {
    const t = testbasen(rodSti)
    // Ikke [::1]: postgres.js deler værten ved «:» og kan ikke forbinde til den.
    if (!['127.0.0.1', 'localhost'].includes(vaert) || u.port !== t.port || u.pathname !== `/${t.navn}`) {
      stop(`--maal test, men målet er ${hvor}; forventet 127.0.0.1:${t.port}/${t.navn}.`)
    }
    return { maal, url: u, hvor, forventet: { base: t.navn, port: Number(t.port) } }
  }
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(vaert)
  if (!pooler && !/^db\.[a-z0-9]{20}\.supabase\.co$/.test(vaert)) stop(`--maal prod, men værten ${vaert} er ikke en Supabase-vært (*.pooler.supabase.com eller db.<ref>.supabase.co).`)
  const { STAGING_REF, PRODUKTION_REF, refFraDatabaseUrl } = await projekter(rodSti)
  if (vaert.includes(STAGING_REF) || bruger.includes(STAGING_REF)) stop(`--maal prod, men målet er staging (${hvor}).`)
  // Hver kanal for sig, med samme aflæsning som staging-værnet: værtens
  // ref (brugernavnet «postgres» bærer ingen) og brugernavnets ref (en
  // vært, der ikke bærer nogen).
  const iVaert = refFraDatabaseUrl(`postgres://postgres@${u.host}/postgres`)
  const iBruger = refFraDatabaseUrl(`postgres://${u.username}@ingen.invalid/postgres`)
  if (iVaert && iBruger && iVaert !== iBruger) stop(`--maal prod, men værten er projekt ${iVaert} og brugernavnet ${iBruger}.`)
  const ref = pooler ? iBruger : iVaert
  if (ref !== PRODUKTION_REF) stop(`--maal prod, men projektets ref er ${ref ?? 'ulæselig'}, ikke produktionens ${PRODUKTION_REF} (scripts/staging/maal.ts).`)
  if (u.pathname !== '/postgres') stop(`--maal prod, men basen er ${u.pathname}; Supabase-basen hedder /postgres.`)
  return { maal, url: u, hvor, ref, forventet: { base: 'postgres', port: null } }
}

/** ROD's commit — så det står i første linje, hvilken kode der målte med. */
function kode(rod) {
  try { return execFileSync('git', ['-C', rod, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'ukendt' }
}

export async function laastBase(ROD) {
  const { maal, url: u, ref, forventet } = await kraevMaal(undefined, undefined, ROD)
  u.searchParams.delete('pgbouncer')
  const postgres = (await import('postgres')).default
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const schema = await import(`${ROD}/db/schema.ts`)
  const { indsaetBase, tlsFor } = await import(`${ROD}/db/client.ts`)
  const k = postgres(u.toString(), {
    // Porten udtrykkeligt: uden den tager postgres.js PGPORT fra skallen,
    // og en URL uden port kunne så ende på transaction-pooleren (:6543).
    port: Number(u.port || 5432),
    max: 1, prepare: false, ssl: tlsFor(u.toString()),
    idle_timeout: 0, max_lifetime: null, connect_timeout: 15, onnotice: () => {},
  })
  await k`set session characteristics as transaction read only`
  // Spørg basen, hvem den er — ikke kun strengen.
  const [{ d, p, pid }] = await k`select current_database() d, inet_server_port() p, pg_backend_pid() pid`
  if (d !== forventet.base || (forventet.port != null && Number(p) !== forventet.port)) {
    await k.end(); stop(`--maal ${maal}, men basen svarer, at den er ${d} på port ${p}.`)
  }
  const laast = async () => (await k`show default_transaction_read_only`)[0].default_transaction_read_only
  if (await laast() !== 'on') { console.error('FEJL: forbindelsen blev ikke read-only'); process.exit(1) }
  indsaetBase(drizzle(k, { schema }), () => k.end())
  return {
    // Aldrig brugernavn eller kode.
    navn: `${u.hostname}:${u.port || 5432}${u.pathname}  (--maal ${maal}${maal === 'test' ? ': den isolerede testbase' : `: PRODUKTIONEN, projekt ${ref}`}) · kode ${kode(ROD)}`,
    maal,
    laast,
    /** Til sidst: stadig read-only, og stadig SAMME forbindelse? En
     *  genopkobling midt i kørslen ville have mistet indstillingen. */
    afslut: async () => {
      const [{ v, pid2 }] = await k`select current_setting('default_transaction_read_only') v, pg_backend_pid() pid2`
      await k.end()
      if (v !== 'on' || pid2 !== pid) { console.error(`FEJL: read-only til sidst: ${v}, forbindelse ${pid} → ${pid2}. Tallene kan ikke stoles på som skrivebeskyttede.`); process.exit(1) }
      return 'on'
    },
    slut: () => k.end(),
  }
}
