// ═══════════════════════════════════════════════════════════════
//  Favoritforløbet, UDFØRT — ikke læst.
//
//  ═══ HVORFOR DEN FINDES VED SIDEN AF test-favoritforloeb.ts ═══
//
//  Den anden prøve måler lagene hver for sig og LÆSER kilden for de to
//  led, der ikke kan kaldes uden en Next-request. Det er bedre end
//  ingenting, men en kildekontrol beviser, at vi kalder en funktion —
//  ikke at brugeren får sin bolig gemt.
//
//  Her kører den RIGTIGE `login()` i den rigtige app, i en rigtig
//  browser, mod den isolerede testbase. Ingen af de tre led, fejlen lå
//  i, er erstattet:
//
//      login()              den ægte server action i app/udlejer/handlinger.ts
//      hentBrugerStatus()   den ægte sessionskontrol, der verificerer mod Auth
//      gemFavorit()         den ægte INSERT mod den rigtige tabel
//
//  Kun Auth-SERVEREN er en attrap, og den har en rigtig adgangskodedør,
//  så et forkert kodeord faktisk afvises.
//
//  ═══ FORLØBET, DER PRØVES ═══
//
//      renderet hjerte → /min-side?gem= → FORKERT kode → ØNSKET OVERLEVER
//                      → RIGTIG kode → gemt → synlig under Gemte boliger
//
//  Og de fire tilfælde, der kan gå galt hver for sig: en allerede gemt
//  bolig, hjertet på et gruppekort, en bolig der forsvinder undervejs,
//  og en databasefejl EFTER at login er lykkedes.
//
//      DATABASE_URL=… node scripts/test-favoritforloeb-e2e.mjs
//
//  Bygget skal være lavet UDEN NEXT_PUBLIC_SUPABASE_URL — ellers er
//  attrapporten bagt over. Prøven siger det selv, se vagten nedenfor.
// ═══════════════════════════════════════════════════════════════
import net from 'node:net'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.PLAYWRIGHT_MODUL ?? 'playwright'
const { chromium } = await import(PW).then((m) => m.default ?? m)

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Vagt 1: der skal være en isoleret base ────────────────────
const DBURL = process.env.DATABASE_URL ?? ''
if (!DBURL) {
  console.log('\n  ⚠ PRØVEN KØRTE IKKE — der er ingen DATABASE_URL.')
  console.log('    Rejs basen med scripts/cloud/db-op.sh og sæt DATABASE_URL.\n')
  process.exit(2)
}
{
  const u = new URL(DBURL)
  const isoleret = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    && u.port === '55432' && u.pathname === '/bofinda_test'
  if (!isoleret) {
    console.log('\n  ⚠ PRØVEN KØRTE IKKE — målet er ikke den isolerede testbase.')
    console.log(`    fik ${u.hostname}:${u.port}${u.pathname}\n`)
    process.exit(2)
  }
}

// ─── Vagt 2: bygget må ikke bære en indbagt Auth-adresse ───────
//
// `NEXT_PUBLIC_*` bages ind ved BYG. Er bygget lavet med byg.sh — som
// sætter adressen til testaktivserveren — bliver attrapporten ignoreret,
// `getUser()` går til den forkerte vært, og login fejler i et timeout
// uden at sige hvorfor. Den fejl kostede en fejlsøgning i
// gendannelsesprøven; her siger den sig selv med det samme.
{
  const bagt = []
  const gaa = (d, dybde = 0) => {
    if (dybde > 4) return
    let poster
    try { poster = readdirSync(d) } catch { return }
    for (const n of poster) {
      const sti = join(d, n)
      let st
      try { st = statSync(sti) } catch { continue }
      if (st.isDirectory()) gaa(sti, dybde + 1)
      else if (n.endsWith('.js')) {
        let t
        try { t = readFileSync(sti, 'utf8') } catch { continue }
        for (const x of t.match(/https?:\/\/127\.0\.0\.1:\d+/g) ?? []) {
          if (!bagt.includes(x)) bagt.push(x)
        }
      }
    }
  }
  gaa('.next/server/app/min-side')
  gaa('.next/server/app/udlejer')
  if (bagt.length) {
    console.log('\n  ⚠ PRØVEN KØRTE IKKE — bygget bærer en indbagt loopback-adresse:')
    for (const x of bagt.slice(0, 4)) console.log(`      ${x}`)
    console.log('    Byg med «npm run build» UDEN NEXT_PUBLIC_SUPABASE_URL sat.\n')
    process.exit(2)
  }
}

const { default: postgres } = await import('postgres')
const sql = postgres(DBURL, { ssl: false, max: 4, onnotice: () => {} })

// ─── Grundlaget ────────────────────────────────────────────────
const MAERKE = `e2e-favorit-${Date.now()}`
const POSTNR = '9903'                     // prøvens eget; ingen anden række må ligge der
const BRUGER_ID = '11111111-2222-4333-8444-666666666666'
const MAIL = 'favorit-proeve@invalid.test'
const KODE = 'den-rigtige-kode-42'

const ryd = async () => {
  await sql`delete from favorites where user_id in (select id from users where email = ${MAIL})`
  await sql`delete from listings where postal_code = ${POSTNR}`
  await sql`delete from sources where slug like ${'e2e-favorit-%'}`
  await sql`delete from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID}`
  await sql`delete from auth.users where id = ${BRUGER_ID}`
}
await ryd()

const [{ n: fremmede }] = await sql`
  select count(*)::int as n from listings where postal_code = ${POSTNR}`
if (fremmede > 0) {
  console.log(`\n  ⚠ ${fremmede} fremmede rækker i ${POSTNR} — prøven ville blande sig.\n`)
  process.exit(2)
}

const [kilde] = await sql`
  insert into sources (slug, name, source_type)
  values (${MAERKE}, 'Prøvekilde favoritforløb e2e', 'spider') returning id`
const kildeId = kilde.id

const lavBolig = async (noegle, vej, husnr, vaerelser) => {
  const [r] = await sql`
    insert into listings (source_id, source_type, external_key, source_url, status,
      address_raw, street, house_number, postal_code, city,
      property_type, size_m2, rooms, rent_monthly, total_monthly, total_monthly_components,
      address_match_level, access_address_uuid)
    values (${kildeId}, 'spider', ${`${MAERKE}-${noegle}`},
      ${`https://eksempel.invalid/${noegle}`}, 'active',
      ${`${vej} ${husnr}, ${POSTNR} Hjerteby`}, ${vej}, ${husnr}, ${POSTNR}, 'Hjerteby',
      'lejlighed', 70, ${vaerelser}, 900000, 1000000, ${['heating']},
      'access', ${`U-${MAERKE}-${noegle}`})
    returning id`
  return r.id
}

// Én bolig til enkeltkortet og boligsiden.
const boligId = await lavBolig('enkelt', 'Hjertevej', '1', 2)
// Tre ens til gruppekortet: samme kilde, postnr, vej og værelsestal, hver
// sin opgang, så de ikke dedupes mod hinanden.
const gruppe = []
for (const n of ['g1', 'g2', 'g3']) gruppe.push(await lavBolig(n, 'Gruppevej', String(gruppe.length * 2 + 1), 3))

// Auth-kontoen skal findes, før vores egen række kan bindes til den:
// `users.auth_user_id` har fremmednøgle til auth.users (migration 0013).
// public.users sås IKKE — bindingen skal ske for rigtigt i `bindKonto`
// ved første login, præcis som for en ny bruger.
await sql`insert into auth.users (id, email) values (${BRUGER_ID}, ${MAIL})`

console.log(`\n  · sået: 1 enkeltbolig + 3 gruppeboliger i ${POSTNR}, auth-konto ${MAIL}`)

// ─── Op med attrappen og appen ─────────────────────────────────
const ledigPort = () => new Promise((ok) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const ATTRAP = await ledigPort(), APP = await ledigPort()
const AUTH = `http://127.0.0.1:${ATTRAP}`, B = `http://127.0.0.1:${APP}`

const boern = []
const start = (cmd, args, env) => {
  const b = spawn(cmd, args, {
    env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'ignore'], detached: true,
  })
  boern.push(b); return b
}
let browser
const luk = () => {
  try { browser?.close() } catch { /* lukket */ }
  for (const b of boern) { try { if (b.pid) process.kill(-b.pid, 'SIGTERM') } catch { /* væk */ } }
  boern.length = 0
}
process.on('exit', luk)
process.on('SIGINT', () => { luk(); process.exit(130) })

const naaet = async (url, n = 80) => {
  for (let i = 0; i < n; i++) { try { await fetch(url); return true } catch { await vent(400) } }
  return false
}

start('node', ['scripts/favorit-attrap.mjs'], {
  ATTRAP_PORT: String(ATTRAP), ATTRAP_BRUGER_ID: BRUGER_ID,
  ATTRAP_MAIL: MAIL, ATTRAP_KODE: KODE,
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
if (!await naaet(`${B}/privatliv`)) { console.log('  ✗ appen kom ikke op'); process.exit(1) }
console.log(`  · appen kører på ${B}, attrappen på ${AUTH}`)

browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_STI || process.env.PLAYWRIGHT_CHROMIUM
    || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
})

const nyBruger = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const p = await c.newPage()
  // Samtykkebanneret ligger oven på og ville opsnappe klik.
  await p.goto(`${B}/privatliv`, { waitUntil: 'domcontentloaded' })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click().catch(() => {}); await vent(400) }
  return { c, p }
}

const antalFavoritter = async () => {
  const [r] = await sql`
    select count(*)::int as n from favorites f
    join users u on u.id = f.user_id where u.email = ${MAIL}`
  return r.n
}
const harFavorit = async (id) => {
  const [r] = await sql`
    select count(*)::int as n from favorites f
    join users u on u.id = f.user_id
    where u.email = ${MAIL} and f.listing_id = ${id}`
  return r.n > 0
}

/** Log ind gennem den RIGTIGE formular. Ingen genveje. */
const logInd = async (p, kode) => {
  await p.fill('#ind-mail', MAIL)
  await p.fill('#ind-kode', kode)
  // FOERSTE .kontoform er login; den anden er «Opret konto». En
  // tekstselektor paa «Log ind» ville ogsaa ramme formularens <h2>.
  await p.locator('form.kontoform').first().locator('button[type=submit]').click()
  await p.waitForLoadState('networkidle').catch(() => {})
  await vent(1600)
}

// ═══ 1 · Det renderede hjerte på boligsiden ═══
console.log('\n══ 1 · hjertet på boligsiden peger på login med boligen ══')
const { c: c1, p } = await nyBruger()
{
  await p.goto(`${B}/bolig/${boligId}`, { waitUntil: 'networkidle' })
  const hjerte = p.locator('a.favoritknap-login')
  tjek('1A · den udloggede ser et hjerte', await hjerte.count() === 1,
    `${await hjerte.count()} fundet`)
  const href = await hjerte.first().getAttribute('href')
  tjek('1B · og det peger på /min-side med boligen',
    href === `/min-side?gem=${boligId}`, href ?? 'intet href')
}

// ═══ 2 · Klikket lander på loginformularen MED ønsket ═══
console.log('\n══ 2 · klikket bærer ønsket hele vejen til formularen ══')
{
  await p.click('a.favoritknap-login')
  await p.waitForLoadState('networkidle')
  tjek('2A · hun er landet på Min side med ønsket i adressen',
    p.url().endsWith(`/min-side?gem=${boligId}`), p.url().replace(B, ''))
  tjek('2B · loginformularen står der', await p.locator('#ind-mail').count() === 1)
  const skjult = p.locator(`form.kontoform input[type=hidden][name=gem]`)
  tjek('2C · og formularen bærer boligen som skjult felt',
    await skjult.count() === 1 && await skjult.first().getAttribute('value') === boligId,
    await skjult.count() ? `value=${await skjult.first().getAttribute('value')}` : 'FELTET MANGLER')
  tjek('2D · siden siger hvorfor hun bliver bedt om at logge ind',
    (await p.locator('.manchet').innerText()).includes('gemmer vi boligen'))
}

// ═══ 3 · FORKERT adgangskode: ønsket overlever ═══
console.log('\n══ 3 · et mislykket login koster ikke hjerteklikket ══')
{
  await logInd(p, 'helt-forkert-kode')
  const fejltekst = await p.locator('.formfejl').first().innerText().catch(() => '')
  tjek('3A · login blev afvist, og der står hvorfor', fejltekst.length > 0, fejltekst.slice(0, 60))
  tjek('3B · hun er stadig på formularen', await p.locator('#ind-mail').count() === 1)
  const skjult = p.locator(`form.kontoform input[type=hidden][name=gem]`)
  tjek('3C · ØNSKET STÅR STADIG i formularen',
    await skjult.count() === 1 && await skjult.first().getAttribute('value') === boligId,
    await skjult.count() ? 'feltet er der' : 'ØNSKET GIK TABT')
  tjek('3D · og intet blev gemt i basen', await antalFavoritter() === 0,
    `${await antalFavoritter()} favoritter`)
}

// ═══ 4 · RIGTIG adgangskode: boligen gemmes og vises ═══
console.log('\n══ 4 · korrekt login gennemfører hjerteklikket ══')
{
  await logInd(p, KODE)
  tjek('4A · hun er logget ind og landet på Min side',
    p.url().endsWith('/min-side'), p.url().replace(B, ''))
  const krop = await p.locator('body').innerText()
  tjek('4B · siden kvitterer for gemningen', krop.includes('Boligen er gemt'),
    krop.includes('Boligen er gemt') ? '' : krop.slice(0, 120).replace(/\n/g, ' '))
  tjek('4C · boligen står under «Gemte boliger»',
    (await p.locator('.gemte-liste .adresse').allInnerTexts()).some((t) => t.includes('Hjertevej 1')),
    (await p.locator('.gemte-liste .adresse').allInnerTexts()).join(' | ') || 'listen er tom')
  tjek('4D · og rækken ER i basen', await harFavorit(boligId))
  tjek('4E · præcis én række', await antalFavoritter() === 1, `${await antalFavoritter()}`)
  // Brugerrækken blev bundet for rigtigt — ikke sået af prøven.
  const [b] = await sql`select auth_user_id, role from users where email = ${MAIL}`
  tjek('4F · brugerrækken blev bundet af bindKonto()',
    b?.auth_user_id === BRUGER_ID, `auth_user_id=${b?.auth_user_id} role=${b?.role}`)
}

// ═══ 5 · En allerede gemt bolig BLIVER gemt ═══
//
// Kernen i «brug ikke skiftFavorit». Hun logger ud, trykker på det samme
// hjerte igen og logger ind. Et skift ville FJERNE boligen.
console.log('\n══ 5 · det samme hjerte igen fjerner ikke boligen ══')
{
  await p.click('.minside-top button[type=submit]')     // Log ud
  await p.waitForLoadState('networkidle')
  await vent(800)
  tjek('5A · hun er logget ud', await p.locator('#ind-mail').count() === 1,
    p.url().replace(B, ''))

  await p.goto(`${B}/bolig/${boligId}`, { waitUntil: 'networkidle' })
  await p.click('a.favoritknap-login')
  await p.waitForLoadState('networkidle')
  await logInd(p, KODE)

  tjek('5B · boligen er der stadig', await harFavorit(boligId))
  tjek('5C · og stadig kun ÉN række', await antalFavoritter() === 1,
    `${await antalFavoritter()} rækker`)
  tjek('5D · den står stadig på listen',
    (await p.locator('.gemte-liste .adresse').allInnerTexts()).some((t) => t.includes('Hjertevej 1')))
}

// ═══ 6 · Hjertet på et GRUPPEKORT ═══
console.log('\n══ 6 · gruppekortets hjerte virker på samme måde ══')
{
  await p.click('.minside-top button[type=submit]')
  await p.waitForLoadState('networkidle')
  await vent(800)

  await p.goto(`${B}/?postnr=${POSTNR}`, { waitUntil: 'networkidle' })
  const gruppekort = p.locator('.kort-hylster:has(a.kort[data-gruppe])')
  tjek('6A · der ER et gruppekort i udsnittet', await gruppekort.count() >= 1,
    `${await gruppekort.count()} gruppekort`)
  const hjerte = gruppekort.first().locator('a.favoritknap-login')
  const href = await hjerte.getAttribute('href')
  const gruppeBolig = (href ?? '').split('gem=')[1] ?? ''
  tjek('6B · gruppekortets hjerte bærer et bolig-id', gruppe.includes(gruppeBolig),
    href ?? 'intet href')

  await hjerte.click()
  await p.waitForLoadState('networkidle')
  await logInd(p, KODE)
  tjek('6C · gruppens bolig blev gemt', await harFavorit(gruppeBolig))
  tjek('6D · nu to gemte boliger', await antalFavoritter() === 2, `${await antalFavoritter()}`)
  tjek('6E · Gruppevej står på listen',
    (await p.locator('.gemte-liste .adresse').allInnerTexts()).some((t) => t.includes('Gruppevej')),
    (await p.locator('.gemte-liste .adresse').allInnerTexts()).join(' | '))
}

// ═══ 7 · Boligen forsvinder mellem klik og login ═══
console.log('\n══ 7 · en bolig, der er væk, siges højt ══')
{
  await p.click('.minside-top button[type=submit]')
  await p.waitForLoadState('networkidle')
  await vent(800)

  const forsvinder = await lavBolig('vaek', 'Forsvindervej', '9', 2)
  await p.goto(`${B}/min-side?gem=${forsvinder}`, { waitUntil: 'networkidle' })
  await sql`delete from listings where id = ${forsvinder}`   // væk, mens hun skriver
  await logInd(p, KODE)

  const krop = await p.locator('body').innerText()
  tjek('7A · hun er logget ind trods alt', p.url().endsWith('/min-side'), p.url().replace(B, ''))
  tjek('7B · og der står, at boligen ikke blev gemt',
    krop.includes('findes ikke længere'), krop.slice(0, 140).replace(/\n/g, ' '))
  tjek('7C · der blev ikke gemt noget ekstra', await antalFavoritter() === 2,
    `${await antalFavoritter()}`)
}

// ═══ 8 · DATABASEFEJL efter et vellykket login ═══
//
// Det farligste tilfælde: sessionen ER oprettet, og så knækker skrivningen.
// Går fejlen ud gennem `login()`, ser hun en fejlside — mens hun i
// virkeligheden ER logget ind. En gemning, der fejler, må aldrig kunne
// vælte det login, den hang på.
//
// Fejlen laves i BASEN, ikke i koden: en trigger på `favorites`, der
// kaster. `gemFavorit` er altså den ægte INSERT hele vejen ned.
console.log('\n══ 8 · en databasefejl vælter ikke login ══')
{
  await p.click('.minside-top button[type=submit]')
  await p.waitForLoadState('networkidle')
  await vent(800)

  // Kvitteringen fra sektion 7 lever GEMUDFALDSSEK sekunder. Den ventes
  // ud med vilje: staar den stadig, naar sektion 8 laeser siden, kan en
  // gammel besked goere den groen — det skete, foer den her linje kom til.
  await vent(32_000)

  await sql.unsafe(`
    create or replace function e2e_favorit_braek() returns trigger as $$
    begin raise exception 'e2e: skrivningen knaekkede med vilje'; end $$ language plpgsql;
    create trigger e2e_favorit_braek before insert on favorites
      for each row execute function e2e_favorit_braek();`)

  const foer = await antalFavoritter()
  const nyBoligId = await lavBolig('braek', 'Braekvej', '3', 2)
  await p.goto(`${B}/min-side?gem=${nyBoligId}`, { waitUntil: 'networkidle' })
  await logInd(p, KODE)

  const url = p.url().replace(B, '')
  const krop = await p.locator('body').innerText().catch(() => '')
  tjek('8A · login LYKKEDES trods skrivefejlen', url.endsWith('/min-side'), url)
  tjek('8B · hun er logget ind og ser sit eget område',
    krop.includes('Logget ind som') && krop.includes('Gemte boliger'),
    krop.slice(0, 120).replace(/\n/g, ' '))
  // PRAECIS den besked, det her udfald giver. En loes proeve paa «ikke
  // gemt» blev groen af sektion 7's gamle kvittering, som stadig laa i
  // cookien — altsaa et svar paa et ANDET spoergsmaal. En kontrol, der
  // kan bestaa af den forkerte grund, er ingen kontrol.
  tjek('8C · og beskeden er VORES fejl, ikke «boligen findes ikke»',
    krop.includes('vi kunne ikke gemme boligen')
    && !krop.includes('findes ikke længere'),
    (krop.match(/Du er logget ind[^\n]*|Boligen findes ikke[^\n]*/) ?? ['ingen besked'])[0])
  tjek('8D · intet blev skrevet', await antalFavoritter() === foer,
    `${await antalFavoritter()} mod ${foer}`)

  await sql.unsafe(`drop trigger if exists e2e_favorit_braek on favorites;
                    drop function if exists e2e_favorit_braek();`)
}

// ─── Ryd op ────────────────────────────────────────────────────
await c1.close().catch(() => {})
await ryd()
await sql.end()
luk()

console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
