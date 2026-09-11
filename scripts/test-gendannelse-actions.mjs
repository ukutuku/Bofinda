// ═══════════════════════════════════════════════════════════════
//  Gendannelsens server actions — UDFØRT i en rigtig browser.
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
//  ⚠ FORUDSÆTNING: `playwright` skal kunne indlæses, og Chromium skal
//  findes. Derfor er prøven IKKE med i `npm test` — den ville gøre
//  testkørslen afhængig af en browser. Kør den selv:
//
//      node scripts/test-gendannelse-actions.mjs
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
start('node', ['scripts/gendannelse-attrap.mjs'], { ATTRAP_PORT: String(ATTRAP) })
if (!await naaet(`${AUTH}/__kald`)) { console.log('  ✗ attrappen kom ikke op'); process.exit(1) }
start('npx', ['next', 'start', '-p', String(APP)], {
  NEXT_PUBLIC_SUPABASE_URL: AUTH,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_kun_til_proever',
  NEXT_PUBLIC_BASE_URL: B,
})
if (!await naaet(`${B}/glemt`)) { console.log('  ✗ appen kom ikke op'); process.exit(1) }

const RENT = { ingenBruger: false, updateFejler: false, signOutFejler: false, mailFejler: false }
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
  user: { id: 'u1', email: 'proeve@invalid.test', aud: 'authenticated' },
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

luk()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
