// ═══════════════════════════════════════════════════════════════
//  Kontoforløbets server actions og kvitteringer — UDFØRT i en
//  rigtig browser.
//
//  Hed før «gendannelsens». Siden kvitteringen blev ét sted for begge
//  forløb, prøver scenarie 8 også bekræftelsen: samme cookie, samme
//  visning, andre ord. To prøver ville betyde to harnesk om den samme
//  komponent.
//
//  ═══ HVORFOR DENNE PRØVE FINDES VED SIDEN AF DEN ANDEN ═══
//
//  scripts/test-gendannelse.ts prøver målbordet og callbacken med ægte
//  kode, men de to server actions kunne den kun læse i kilden. En
//  kildekontrol finder ordet `signOut()` — den beviser ikke, at fejlen
//  fra det kald bliver håndteret. Præcis dét hul lod en ignoreret
//  signOut-fejl passere.
//
//  ═══ HVORFOR EN BROWSER OG IKKE ET RÅT POST ═══
//
//  Første udgave POSTede formularen ad Next's no-JS-vej ($ACTION-felter).
//  Det virker for en action, der OMDIRIGERER, men enhver action, der
//  RETURNERER et svar, hænger uden nogensinde at sende headere — målt
//  på både /nulstil og /glemt, også for en ren valideringsfejl, der
//  aldrig rører Supabase. Det er testkanalen, ikke koden: med
//  JavaScript, som en rigtig bruger har, svarer de samme handlinger
//  omgående. Prøven driver derfor formularerne, som brugeren gør.
//
//  ═══ OG HVORFOR DEN NU KRÆVER EN RIGTIG TESTBASE ═══
//
//  Uden database faldt `hentBrugerStatus()` igennem, og /min-side gengav
//  sin UDLOGGEDE gren — med kontoformularen og dermed med kvitteringen.
//  Prøven så altså beskeden og gik grøn, mens den bruger, der faktisk
//  havde været igennem forløbet, ikke gjorde: fejler udlogningen, ER hun
//  logget ind, og den indloggede gren viste ingenting.
//
//  Det er samme fælde som en kildekontrol, der finder ordet `signOut()`.
//  Målingen ramte ved siden af det, den skulle måle. Prøven kræver derfor
//  den isolerede testbase med en KORREKT BUNDET brugerrække, og den
//  kontrollerer udtrykkeligt, at siden er den indloggede.
//
//  ⚠ FORUDSÆTNING: `playwright` skal kunne indlæses, Chromium skal
//  findes, og den isolerede testbase skal køre. Derfor er prøven IKKE med
//  i `npm test` — den ville gøre testkørslen afhængig af begge dele:
//
//      scripts/cloud/db-op.sh                     # 127.0.0.1:55432
//      DATABASE_URL=… node scripts/test-gendannelse-actions.mjs
//
//  Sæt PLAYWRIGHT_MODUL, hvis pakken ligger uden for projektet, og
//  CHROMIUM_STI, hvis browseren ikke ligger, hvor playwright tror.
//
//  Alt lytter på 127.0.0.1. Ingen rigtige mails, ingen eksterne
//  Auth-kald, ingen rigtig konto.
//
//  ⚠ STADIG IKKE EN E2E-PRØVE. Attrappen svarer, som vi TROR GoTrue
//  svarer.
// ═══════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process'
import net from 'node:net'
import { setTimeout as vent } from 'node:timers/promises'

let chromium
try {
  // Playwright er CommonJS: via en sti-import ligger eksporterne under
  // `default`, via pakkenavnet som named exports. Begge skal virke.
  const m = await import(process.env.PLAYWRIGHT_MODUL ?? 'playwright')
  chromium = m.chromium ?? m.default?.chromium
  if (!chromium) throw new Error('ingen chromium-eksport')
} catch {
  console.log('\n  ⚠ playwright kunne ikke indlæses — prøven kræver en browser.')
  console.log('    Sæt PLAYWRIGHT_MODUL til pakkens sti, eller installér playwright.\n')
  process.exit(2)
}

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

// ─── Den isolerede testbase ────────────────────────────────────
//
// Samme stramme maal som scripts/cloud/klargoer.mjs og saa.mjs: loopback
// OG port 55432 OG databasen bofinda_test. Ikke «en base» — DEN base.
// Proeven skriver en brugerraekke, og en forkert forbindelse ville skrive
// den et sted, ingen kiggede efter.
const DBURL = process.env.DATABASE_URL ?? ''
if (!DBURL) {
  console.log('\n  ⚠ PRØVEN KØRTE IKKE — der er ingen DATABASE_URL.')
  console.log('    Den indloggede kvittering kan kun måles med en rigtig brugerrække.')
  console.log('    Rejs basen med scripts/cloud/db-op.sh og sæt DATABASE_URL.\n')
  process.exit(2)
}
{
  const u = new URL(DBURL)
  const ok = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    && u.port === '55432' && u.pathname === '/bofinda_test'
  if (!ok) {
    console.log(`\n  ✗ ${u.hostname}:${u.port}${u.pathname} er ikke den isolerede testbase.`)
    console.log('    Prøven skriver en brugerrække og nægter at gøre det andre steder.\n')
    process.exit(1)
  }
}

const { default: postgres } = await import('postgres')
const sql = postgres(DBURL, { ssl: false, max: 1, onnotice: () => {} })

/**
 * Den syntetiske BOFINDA-bruger.
 *
 * En RIGTIG uuid, fordi `users.auth_user_id` er en uuid-kolonne — og
 * korrekt BUNDET, saa `bindKonto()` rammer sin foerste gren (A) og svarer
 * `ok` uden at skulle binde noget undervejs. Det er den tilstand, en
 * bruger har, naar hun kommer tilbage fra et gendannelseslink.
 */
const BRUGER_ID = '11111111-2222-4333-8444-555555555555'
const MAIL = 'gendannelse-proeve@invalid.test'

// Ryd foerst: en raekke fra en afbrudt koersel maa ikke goere den naeste
// groen eller roed af den forkerte grund.
const ryd = async () => {
  // public.users foerst: fremmednoeglen er `on delete set null`, saa den
  // modsatte raekkefoelge ville efterlade en raekke uden binding.
  await sql`delete from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID}`
  await sql`delete from auth.users where id = ${BRUGER_ID}`
}
await ryd()
// `users.auth_user_id` peger paa auth.users — samme fremmednoegle som i
// produktionen (0013). Auth-kontoen skal altsaa findes, foer vores egen
// raekke kan bindes til den; det er netop den tilstand, en rigtig bruger
// har, naar hun kommer tilbage fra et gendannelseslink.
await sql`insert into auth.users (id, email) values (${BRUGER_ID}, ${MAIL})`
await sql`insert into users (email, role, auth_user_id)
          values (${MAIL}, 'landlord', ${BRUGER_ID})`
const [{ n: bundne }] = await sql`
  select count(*)::int as n from users where auth_user_id = ${BRUGER_ID}`
if (bundne !== 1) { console.log('  ✗ kunne ikke så den bundne bruger'); process.exit(1) }
console.log(`\n  · syntetisk bruger sået og bundet: ${MAIL}`)

const ledigPort = () => new Promise((ok) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const ATTRAP = await ledigPort(), APP = await ledigPort()
const AUTH = `http://127.0.0.1:${ATTRAP}`, B = `http://127.0.0.1:${APP}`

const boern = []
/** Egen procesgruppe pr. barn: en TERM til `npx` alene efterlader next-server kørende. */
const start = (cmd, args, env) => {
  const b = spawn(cmd, args, {
    env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
  })
  boern.push(b); return b
}
let browser
const luk = () => {
  try { browser?.close() } catch {}
  for (const b of boern) { try { if (b.pid) process.kill(-b.pid, 'SIGTERM') } catch {} }
  boern.length = 0
}
process.on('exit', luk)
process.on('SIGINT', () => { luk(); process.exit(130) })

const naaet = async (url, n = 80) => {
  for (let i = 0; i < n; i++) { try { await fetch(url); return true } catch { await vent(400) } }
  return false
}

// ─── Op ────────────────────────────────────────────────────────
start('node', ['scripts/gendannelse-attrap.mjs'], {
  ATTRAP_PORT: String(ATTRAP), ATTRAP_BRUGER_ID: BRUGER_ID, ATTRAP_MAIL: MAIL,
})
if (!await naaet(`${AUTH}/__kald`)) { console.log('  ✗ attrappen kom ikke op'); process.exit(1) }
start('npx', ['next', 'start', '-p', String(APP)], {
  NEXT_PUBLIC_SUPABASE_URL: AUTH,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_kun_til_proever',
  NEXT_PUBLIC_BASE_URL: B,
  DATABASE_URL: DBURL,
  DATABASE_URL_DIRECT: DBURL,
  BILLED_HEMMELIGHED: 'proeve-hemmelighed-kun-til-proever',
})
if (!await naaet(`${B}/glemt`)) { console.log('  ✗ appen kom ikke op'); process.exit(1) }

const RENT = {
  ingenBruger: false, updateFejler: false, updateKaster: false,
  signOutFejler: false, mailFejler: false,
}
const sat = (t) => fetch(`${AUTH}/__tilstand`, {
  method: 'POST', body: JSON.stringify({ ...RENT, ...t }),
}).then((r) => r.json())
const kald = () => fetch(`${AUTH}/__kald`).then((r) => r.json()).then((d) => d.kald)

browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_STI || undefined,
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
})

/** En session i @supabase/ssr's cookieform. Værten 127.0.0.1 → «127». */
const sessionsvaerdi = 'base64-' + Buffer.from(JSON.stringify({
  access_token: 'AT', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'RT',
  user: { id: BRUGER_ID, email: MAIL, aud: 'authenticated' },
})).toString('base64')

async function side({ session = false, kvittering = null } = {}) {
  const ctx = await browser.newContext()
  const cookies = []
  if (session) cookies.push({ name: 'sb-127-auth-token', value: sessionsvaerdi, domain: '127.0.0.1', path: '/' })
  if (kvittering) cookies.push({ name: 'bofinda_kvittering', value: kvittering, domain: '127.0.0.1', path: '/' })
  if (cookies.length) await ctx.addCookies(cookies)
  return { ctx, p: await ctx.newPage() }
}
const kvitteringsCookie = async (ctx) =>
  (await ctx.cookies()).find((c) => c.name === 'bofinda_kvittering')?.value ?? null
const LANG = 'et-langt-nok-kodeord'

/**
 * Vent til handlingen faktisk er faerdig.
 *
 * `networkidle` duer ikke: useActionState sender med fetch, og
 * ventetilstanden kan naa at begynde og slutte, uden at siden nogensinde
 * «navigerer». Vi venter derfor paa DET, handlingen skal foere til —
 * enten en ny sti eller en besked i formularen.
 */
async function faerdig(p, fraSti, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (new URL(p.url()).pathname !== fraSti) return 'navigeret'
    if (await p.locator('.formfejl, .formok').count() > 0) return 'besked'
    await vent(150)
  }
  return 'timeout'
}

/**
 * Vent paa en bestemt sti. Udlejerens vej er TO omdirigeringer —
 * /nulstil → /udlejer → /udlejer/boliger — og et enkelt opslag paa
 * p.url() kan ramme midt imellem dem.
 */
async function venterPaa(p, sti, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (new URL(p.url()).pathname === sti) return true
    await vent(150)
  }
  return false
}

/** Som venterPaa, men paa en tekst: et login skifter ikke sti. */
async function venterPaaTekst(p, tekst, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await p.getByText(tekst).count() > 0) return true
    await vent(150)
  }
  return false
}

/** Udfyld «Vælg ny adgangskode» og send. */
async function gem(p, kode = LANG, gentag = LANG) {
  await p.fill('#nulstil-kode', kode)
  await p.fill('#nulstil-gentag', gentag)
  await p.click('form.kontoform button[type=submit]')
  return faerdig(p, '/nulstil')
}

// ═══ 1 · Vellykket skift og logud ═══════════════════════════════
console.log('\n══ 1 · alt lykkes ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  tjek('1A · formularen vises for en verificeret bruger',
    await p.locator('#nulstil-kode').count() === 1)
  await gem(p)
  const k = await kald()
  tjek('1B · updateUser blev faktisk kaldt', k.includes('PUT /auth/v1/user'), k.join(' · '))
  tjek('1C · logud blev faktisk kaldt', k.some((x) => x.includes('/logout')))
  tjek('1D · hun er sendt til log ind', new URL(p.url()).pathname === '/min-side', p.url())
  tjek('1E · kvitteringen siger «skiftet»', await kvitteringsCookie(ctx) === 'skiftet')
  tjek('1F · og det står på skærmen',
    await p.getByText('Din adgangskode er skiftet').count() > 0)
  tjek('1G · uden at påstå, at alt er logget ud med det samme',
    await p.getByText('logget dig ud overalt').count() === 0)
  await ctx.close()
}

// ═══ 2 · Ingen verificeret bruger ═══════════════════════════════
console.log('\n══ 2 · manglende session — intet updateUser ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  await sat({ ingenBruger: true })          // sessionen falder bort, mens formularen står åben
  await gem(p)
  const k = await kald()
  tjek('2A · updateUser blev IKKE kaldt', !k.includes('PUT /auth/v1/user'), k.join(' · '))
  tjek('2B · logud blev IKKE kaldt', !k.some((x) => x.includes('/logout')))
  tjek('2C · ingen kvittering', await kvitteringsCookie(ctx) === null)
  tjek('2D · hun får en vej videre',
    await p.getByText('Linket er ikke længere gyldigt').count() > 0)
  await ctx.close()
}
{
  await sat({ ingenBruger: true })
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  tjek('2E · siden viser slet ikke formularen uden verificeret bruger',
    await p.locator('#nulstil-kode').count() === 0)
  await ctx.close()
}

// ═══ 3 · updateUser afvist ══════════════════════════════════════
console.log('\n══ 3 · Auth afviser den nye kode ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  await sat({ updateFejler: true })
  await gem(p)
  const k = await kald()
  tjek('3A · updateUser blev forsøgt', k.includes('PUT /auth/v1/user'), k.join(' · '))
  tjek('3B · logud blev IKKE kaldt', !k.some((x) => x.includes('/logout')))
  tjek('3C · INGEN kvittering — intet blev skiftet', await kvitteringsCookie(ctx) === null)
  tjek('3D · hun bliver på siden', new URL(p.url()).pathname === '/nulstil')
  tjek('3E · og får en fejl at se', await p.locator('.formfejl').count() > 0)
  tjek('3F · uden rå Auth-tekst',
    await p.getByText('Password should be at least').count() === 0)
  await ctx.close()
}

// ═══ 4 · DELVIS SUCCES · koden skiftet, logud fejlede ═══════════
// Fundet, hele opfoelgningen handler om.
console.log('\n══ 4 · koden skiftet, men logud fejlede ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  await sat({ signOutFejler: true })
  await gem(p)
  const k = await kald()
  tjek('4A · updateUser lykkedes', k.includes('PUT /auth/v1/user'))
  tjek('4B · logud blev forsøgt og fejlede', k.some((x) => x.includes('/logout')))
  tjek('4C · kvitteringen siger «skiftet-uden-logud»',
    await kvitteringsCookie(ctx) === 'skiftet-uden-logud', String(await kvitteringsCookie(ctx)))
  tjek('4D · hun sendes videre — ikke tilbage til formularen',
    new URL(p.url()).pathname !== '/nulstil', p.url())
  tjek('4E · og får at vide, at koden ER skiftet',
    await p.getByText('Din adgangskode er skiftet').count() > 0)
  tjek('4F · men IKKE at udlogningen lykkedes',
    await p.getByText('kunne ikke afslutte udlogningen').count() > 0)
  // 4G-4H er hele forskellen paa den gamle proeve og denne. Uden en
  // brugerraekke faldt /min-side tilbage paa sin UDLOGGEDE gren, og
  // kvitteringen stod i kontoformularen — altsaa et andet sted end det,
  // hun faktisk ser, naar udlogningen fejlede og sessionen lever videre.
  // ⚠ MAALT, IKKE ANTAGET. @supabase/auth-js fjerner den LOKALE session,
  // ogsaa naar serverens logud svarede med en fejl: `_signOut` kalder
  // `removeCurrentSession()` og returnerer FOERST derefter fejlen. Hun er
  // altsaa logget ud i denne browser, og kvitteringen lander ved
  // kontoformularen. «Logud fejlede» betyder derfor «vi fik ikke
  // bekraeftet, at sessionen blev tilbagekaldt paa serveren» — ikke «hun
  // er stadig logget ind her».
  tjek('4G · den lokale session ER ryddet, selv om serveren fejlede',
    await p.getByText('Logget ind som').count() === 0)
  tjek('4H · og hun kan logge ind igen med det samme',
    await p.locator('#ind-kode').count() === 1)
  await ctx.close()
}
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=udlejer`, { waitUntil: 'networkidle' })
  await sat({ signOutFejler: true })
  await gem(p)
  tjek('4I · udlejeren lander paa kontoformularen med samme kvittering',
    await venterPaa(p, '/udlejer') && await p.getByText('Din adgangskode er skiftet').count() > 0,
    p.url())
  await ctx.close()
}

// ═══ 4b · R1 · KVITTERINGEN FOR EN, DER ER LOGGET IND ═══════════
//
// ═══ HVORFOR DEN TILSTAND OVERHOVEDET OPSTAAR ═══
//
// Kvitteringscookien lever to minutter, og det foerste, beskeden beder
// hende om, er at logge ind med den nye kode. Saa snart hun goer det, er
// hun en INDLOGGET bruger med en levende kvittering — og indtil nu viste
// hverken Min side eller Mine annoncer et ord om, at koden lige var
// skiftet. Den tilstand saettes her direkte med de to cookies, praecis
// som den ser ud paa serveren; 4c koerer hele vejen udenom.
console.log('\n══ 4b · indlogget bruger med kvittering ══')
for (const [navn, sti, ender, kendetegn] of [
  ['bolig', '/min-side', '/min-side', 'Logget ind som'],
  // /udlejer omdirigerer en indlogget udlejer videre, FOER cookien
  // laeses. Blokken skal derfor staa paa den side, hun faktisk lander paa.
  ['udlejer', '/udlejer', '/udlejer/boliger', 'Mine annoncer'],
]) {
  await sat({})
  const { ctx, p } = await side({ session: true, kvittering: 'skiftet-uden-logud' })
  await p.goto(B + sti, { waitUntil: 'networkidle' })
  tjek(`4b · ${navn} · hun ender paa ${ender}`, new URL(p.url()).pathname === ender, p.url())
  tjek(`4b · ${navn} · og siden er den indloggede`,
    await p.getByText(kendetegn).count() > 0)
  tjek(`4b · ${navn} · KVITTERINGEN STAAR PAA SKAERMEN`,
    await p.getByText('Din adgangskode er skiftet').count() > 0)
  tjek(`4b · ${navn} · med forbeholdet om udlogningen`,
    await p.getByText('kunne ikke afslutte udlogningen').count() > 0)
  tjek(`4b · ${navn} · og uden «log ind herunder», som intet peger paa`,
    await p.getByText('Log ind herunder').count() === 0)
  await ctx.close()
}
// Kvitteringen OPLYSER. Den maa ikke kunne aabne noget: uden en session
// er en haandskrevet cookie stadig kun en besked paa en udlogget side.
{
  await sat({})
  const { ctx, p } = await side({ kvittering: 'skiftet-uden-logud' })
  await p.goto(`${B}/udlejer/boliger`, { waitUntil: 'networkidle' })
  tjek('4b · uden session giver kvitteringen ingen adgang til Mine annoncer',
    new URL(p.url()).pathname === '/udlejer', p.url())
  tjek('4b · og der staar ingen annonceliste', await p.getByText('Mine annoncer').count() === 0)
  await ctx.close()
}

// ═══ 4c · R1 · HELE VEJEN, UDEN EN HAANDSAT COOKIE ══════════════
// Samme tilstand som 4b, men naaet som hun naar den: skift koden, faa
// logud til at fejle, og log saa ind igen inden for kvitteringens to
// minutter. Ingen cookie er sat af proeven.
console.log('\n══ 4c · skift, mislykket logud, og log ind igen ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  await sat({ signOutFejler: true })
  await gem(p)
  tjek('4cA · hun er paa kontoformularen med kvitteringen',
    await p.locator('#ind-kode').count() === 1
    && await p.getByText('Din adgangskode er skiftet').count() > 0)
  const foer = await kvitteringsCookie(ctx)
  await p.fill('#ind-mail', MAIL)
  await p.fill('#ind-kode', LANG)
  await p.click('form.kontoform button[type=submit]')
  tjek('4cB · og logger ind igen med den nye kode',
    await venterPaaTekst(p, 'Logget ind som'), p.url())
  tjek('4cC · kvitteringen er den SAMME cookie, serveren satte',
    await kvitteringsCookie(ctx) === foer && foer === 'skiftet-uden-logud', String(foer))
  tjek('4cD · og den staar stadig paa skaermen, nu paa hendes eget omraade',
    await p.getByText('Din adgangskode er skiftet').count() > 0)
  await ctx.close()
}

// ═══ 5 · Mailafsendelsen fejler ═════════════════════════════════
console.log('\n══ 5 · SMTP svigter — ingen falsk afsendelsespåstand ══')
{
  const tekst = async (mailFejler) => {
    await sat({ mailFejler })
    const { ctx, p } = await side()
    await p.goto(`${B}/glemt?k=bolig`, { waitUntil: 'networkidle' })
    await p.fill('#glemt-mail', 'proeve@invalid.test')
    await p.click('form.kontoform button[type=submit]')
    await faerdig(p, '/glemt')
    const t = (await p.locator('.formok, .formfejl').allTextContents()).join(' ')
    await ctx.close(); return t
  }
  const fejlede = await tekst(true)
  const lykkedes = await tekst(false)
  tjek('5A · svaret er der stadig', fejlede.length > 0)
  tjek('5B · og påstår IKKE, at en mail er afsendt',
    !fejlede.includes('har vi sendt et link'), fejlede.slice(0, 60))
  tjek('5C · ingen rå Auth-fejltekst på skærmen',
    !/Error sending recovery email|unexpected_failure/.test(fejlede))
  tjek('5D · ordret samme besked, om mailen blev sendt eller ej',
    fejlede === lykkedes && lykkedes.includes('Vi har modtaget din anmodning'))
  // Neutraliteten var paa plads; loeftet var ikke. «Har adressen en konto
  // hos os, KOMMER der en mail» er en ubetinget forudsigelse — og i netop
  // det tilfaelde, hvor SMTP lige har fejlet, ved vi allerede, at den er
  // usand. Betingelsen skal ogsaa daekke, om anmodningen kan gennemfoeres.
  tjek('5E · og lover ikke en mail, den kan ikke staa inde for',
    !/kommer der en mail/i.test(fejlede), fejlede.slice(0, 90))
  tjek('5F · afsendelsen er gjort betinget, ikke fortiet',
    /kan gennemføres/i.test(fejlede))
}

// ═══ 6 · URL-parameteren alene ══════════════════════════════════
console.log('\n══ 6 · ?nulstillet=1 uden serverresultat ══')
{
  await sat({})
  for (const sti of ['/udlejer?nulstillet=1', '/min-side?nulstillet=1',
                     '/udlejer?kvittering=skiftet', '/min-side?bofinda_kvittering=skiftet']) {
    const { ctx, p } = await side()
    await p.goto(B + sti, { waitUntil: 'networkidle' })
    tjek(`6 · ${sti} påstår intet om et kodeskift`,
      await p.getByText('Din adgangskode er skiftet').count() === 0)
    await ctx.close()
  }
  // Samme spærring for bekræftelsen. «Velkommen til BOFINDA» er en
  // påstand om, at Auth-serveren lige har verificeret en adresse — den
  // må en adresselinje ikke kunne fremkalde.
  for (const sti of ['/min-side?bekraeftet=1', '/min-side?kvittering=bekraeftet',
                     '/udlejer?bekraeftet=1', '/min-side?bofinda_kvittering=bekraeftet']) {
    const { ctx, p } = await side()
    await p.goto(B + sti, { waitUntil: 'networkidle' })
    tjek(`6 · ${sti} påstår ingen bekræftelse`,
      await p.getByText('Din mailadresse er bekræftet').count() === 0)
    await ctx.close()
  }
  for (const [navn, v, vent2] of [
    ['6E · serverens egen cookie viser kvitteringen', 'skiftet', true],
    ['6F · en ukendt værdi giver ingen kvittering', 'vroevl', false],
  ]) {
    const { ctx, p } = await side({ kvittering: v })
    await p.goto(`${B}/udlejer`, { waitUntil: 'networkidle' })
    tjek(navn, (await p.getByText('Din adgangskode er skiftet').count() > 0) === vent2)
    await ctx.close()
  }
}

// ═══ 7 · SVARET GIK TABT · udfaldet er UKENDT ══════════════════
//
// Forbindelsen brydes midt i PUT /user. Ingen af siderne ved, om GoTrue
// naaede at skrive den nye kode — og netop derfor maa svaret hverken
// love, at den gamle stadig virker, eller at den nye goer.
console.log('\n══ 7 · updateUser mistede svaret ══')
{
  await sat({})
  const { ctx, p } = await side({ session: true })
  await p.goto(`${B}/nulstil?k=bolig`, { waitUntil: 'networkidle' })
  await sat({ updateKaster: true })
  await gem(p)
  const k = await kald()
  const forsoeg = k.filter((x) => x === 'PUT /auth/v1/user').length
  const t = (await p.locator('.formfejl').allTextContents()).join(' ')
  tjek('7A · updateUser blev forsøgt', forsoeg >= 1, k.join(' · '))
  tjek('7B · og PRÆCIS én gang — ingen automatisk gentagelse',
    forsoeg === 1, `${forsoeg} forsøg`)
  tjek('7C · logud blev IKKE kaldt', !k.some((x) => x.includes('/logout')))
  tjek('7D · ingen kvittering — vi ved ikke, om noget blev skiftet',
    await kvitteringsCookie(ctx) === null)
  tjek('7E · hun bliver på siden og får en besked',
    new URL(p.url()).pathname === '/nulstil' && t.length > 0, p.url())
  // Selve fundet: garantien var en påstand om serverens tilstand, som
  // vi ikke kan se herfra. Et tabt svar kan ligge både før og efter, at
  // koden blev skrevet.
  tjek('7F · og vi garanterer IKKE, at den gamle kode stadig virker',
    !/virker stadig/i.test(t), t.slice(0, 90))
  tjek('7G · vi siger, at udfaldet er ukendt',
    /kunne ikke bekræfte/i.test(t), t.slice(0, 90))
  tjek('7H · og peger på begge veje videre',
    /logge ind/i.test(t) && /gendannelseslink/i.test(t))
  // SDK'et laver et tabt svar om til en RETURNERET fejl, ikke et kast.
  // Slap den igennem til `oversaet()`, ville brugeren se auth-js' egen
  // engelske tekst — og det er ikke et svar, hun kan handle på.
  tjek('7I · ingen rå SDK-tekst på skærmen',
    !/fetch failed|terminated|AuthRetryableFetchError|socket/i.test(t), t.slice(0, 90))
  await ctx.close()
}

// ═══ 8 · BEKRÆFTELSESKVITTERINGEN ══════════════════════════════
//
// Cookien er serverens egen, sat af callback-ruten efter en verificeret
// veksling (prøvet i scripts/test-kontovej.ts, sektion 5B). Her prøves
// det, brugeren SER — og at teksten retter sig efter, om hun faktisk er
// logget ind, i stedet for at påstå det.
console.log('\n══ 8 · «Din mailadresse er bekræftet» ══')
for (const [navn, sti, ender, kendetegn] of [
  ['bolig', '/min-side', '/min-side', 'Logget ind som'],
  ['udlejer', '/udlejer', '/udlejer/boliger', 'Mine annoncer'],
]) {
  await sat({})
  const { ctx, p } = await side({ session: true, kvittering: 'bekraeftet' })
  await p.goto(B + sti, { waitUntil: 'networkidle' })
  tjek(`8 · ${navn} · hun ender paa ${ender}`, new URL(p.url()).pathname === ender, p.url())
  tjek(`8 · ${navn} · siden er den indloggede`, await p.getByText(kendetegn).count() > 0)
  tjek(`8 · ${navn} · KVITTERINGEN STAAR PAA SKAERMEN`,
    await p.getByText('Din mailadresse er bekræftet. Velkommen til BOFINDA.').count() > 0)
  tjek(`8 · ${navn} · og siger, at hun ER logget ind`,
    await p.getByText('Du er logget ind').count() > 0)
  tjek(`8 · ${navn} · uden «log ind herunder», som intet peger paa`,
    await p.getByText('Log ind herunder').count() === 0)
  await ctx.close()
}
{
  // Vekslingen lykkedes, men sessionen naaede ikke frem til siden. Vi
  // paastaar ikke, at hun er logget ind — vi siger, hvad vi ved, og
  // peger paa formularen, der faktisk staar der.
  await sat({})
  const { ctx, p } = await side({ kvittering: 'bekraeftet' })
  await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
  tjek('8E · uden session staar bekræftelsen stadig',
    await p.getByText('Din mailadresse er bekræftet. Velkommen til BOFINDA.').count() > 0)
  tjek('8F · men den paastaar ikke, at hun er logget ind',
    await p.getByText('Du er ikke logget ind her').count() > 0)
  tjek('8G · og peger paa kontoformularen, der faktisk staar der',
    await p.locator('#ind-kode').count() === 1)
  tjek('8H · kvitteringen gav ingen adgang til det personlige omraade',
    await p.getByText('Logget ind som').count() === 0)
  await ctx.close()
}
{
  // De to forloeb maa ikke kunne vise hinandens besked.
  await sat({})
  const { ctx, p } = await side({ session: true, kvittering: 'skiftet-uden-logud' })
  await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
  tjek('8I · et kodeskift byder ikke velkommen til BOFINDA',
    await p.getByText('Din mailadresse er bekræftet').count() === 0)
  await ctx.close()
}
{
  await sat({})
  const { ctx, p } = await side({ session: true, kvittering: 'bekraeftet' })
  await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
  tjek('8J · og en bekræftelse paastaar ikke et kodeskift',
    await p.getByText('Din adgangskode er skiftet').count() === 0)
  await ctx.close()
}

luk()
// Ryd den syntetiske bruger. Basen er isoleret, men en efterladt raekke
// ville goere den naeste koersel groen af den forkerte grund.
await ryd()
await sql.end()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
