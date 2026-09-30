// ═══════════════════════════════════════════════════════════════
//  Favoritforløbet, UDFØRT — ikke læst.
//
//  ═══ HVORFOR DEN FINDES VED SIDEN AF test-favoritforloeb.ts ═══
//
//  Den anden prøve måler lagene hver for sig og LÆSER kilden for de led,
//  der ikke kan kaldes uden en Next-request. Det er bedre end ingenting,
//  men en kildekontrol beviser, at vi kalder en funktion — ikke at
//  brugeren får sin bolig gemt.
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
//  så et forkert kodeord faktisk afvises — og to konti, så et kontoskift
//  kan prøves.
//
//  ═══ FORLØBET, DER PRØVES ═══
//
//      renderet hjerte → /min-side?gem= → FORKERT kode → ØNSKET OVERLEVER
//                      → RIGTIG kode → gemt → synlig under Gemte boliger
//
//  Og de tilfælde, der kan gå galt hver for sig: en allerede gemt bolig,
//  hjertet på et gruppekort, en bolig der forsvinder undervejs, et
//  KNÆKKET hjertelink, en gammel kvittering der møder det næste login
//  eller en anden konto, og en databasefejl EFTER at login er lykkedes.
//
//      DATABASE_URL=… node scripts/test-favoritforloeb-e2e.mjs
//
//  Bygget skal være lavet UDEN NEXT_PUBLIC_SUPABASE_URL — ellers er
//  attrapporten bagt over. Prøven siger det selv, se vagten nedenfor.
//
//  ═══ PRØVEN RYDDER KUN SIT EGET OP ═══
//
//  Den slettede før ALT i postnummer 9903 — og gjorde det FØR den
//  kontrollerede, om der lå fremmede rækker der. Kontrollen kunne derfor
//  aldrig fyre: den talte i en tabel, prøven lige havde tømt. Nu går
//  kontrollen forud, oprydningen rammer kun prøvens egne kilder, og
//  afsnit 0 planter en fremmed række og efterviser, at den står der
//  bagefter. Se `ryd()` og afsnit 0 og 11.
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
const STEMPEL = Date.now()
const MAERKE = `e2e-favorit-${STEMPEL}`          // prøvens EGEN kilde
const FREMMED = `e2e-fremmed-${STEMPEL}`         // står for «en andens række»
const POSTNR = '9903'
const BRUGER_ID = '11111111-2222-4333-8444-666666666666'
const MAIL = 'favorit-proeve@invalid.test'
const KODE = 'den-rigtige-kode-42'
// Den anden konto. Kvitteringen fra den ene må ikke kunne læses af den
// anden — og det kan kun prøves, hvis der ER en anden.
const BRUGER_ID2 = '33333333-2222-4333-8444-666666666666'
const MAIL2 = 'favorit-fremmed@invalid.test'
const KODE2 = 'den-anden-rigtige-kode-42'

const VORES = `slug like 'e2e-favorit-%'`
const PROEVENS = `slug like 'e2e-favorit-%' or slug like 'e2e-fremmed-%'`

/**
 * Oprydningen. KUN prøvens egne rækker.
 *
 * Den slettede før alt i postnummeret. Det er ikke oprydning, det er en
 * fejning: en anden prøve, en fejlsøgning eller et sået udsnit i samme
 * base ville blive taget med, uden at nogen fik det at vide. Nøglen er
 * prøvens egen kilde-slug — den kan ingen andre have.
 *
 * `e2e-fremmed-%` røres IKKE. Den står for rækker, der ikke er vores, og
 * afsnit 0 og 11 efterviser, at de overlever.
 */
const ryd = async () => {
  await sql`delete from favorites where user_id in (
    select id from users where email = ${MAIL} or email = ${MAIL2})`
  await sql.unsafe(
    `delete from listings where source_id in (select id from sources where ${VORES})`)
  await sql.unsafe(`delete from sources where ${VORES}`)
  await sql`delete from users
    where email = ${MAIL} or email = ${MAIL2}
       or auth_user_id = ${BRUGER_ID} or auth_user_id = ${BRUGER_ID2}`
  await sql`delete from auth.users where id = ${BRUGER_ID} or id = ${BRUGER_ID2}`
}
const rydFremmed = async () => {
  await sql.unsafe(
    `delete from listings where source_id in (select id from sources where slug like 'e2e-fremmed-%')`)
  await sql.unsafe(`delete from sources where slug like 'e2e-fremmed-%'`)
}
const voresRaekker = async () => {
  const [r] = await sql.unsafe(`select
    (select count(*) from listings where source_id in (select id from sources where ${VORES}))
    + (select count(*) from users where email in ('${MAIL}','${MAIL2}'))
    + (select count(*) from auth.users where id in ('${BRUGER_ID}','${BRUGER_ID2}')) as n`)
  return Number(r.n)
}

// ─── KONTROLLEN FØR SLETNINGEN ────────────────────────────────
//
// Den stod før EFTER `ryd()`, som havde tømt hele postnummeret — altså
// talte den i en tabel, den selv lige havde ryddet, og kunne aldrig
// fyre. Nu er den det første, der sker, og den tæller kun rækker, der
// IKKE er prøvens egne.
{
  const fremmede = await sql.unsafe(`
    select coalesce(s.slug, '(uden kilde)') as slug, count(*)::int as n
      from listings l left join sources s on s.id = l.source_id
     where l.postal_code = '${POSTNR}'
       and l.source_id not in (select id from sources where ${PROEVENS})
     group by 1 order by 2 desc`)
  if (fremmede.length) {
    const i = fremmede.reduce((a, r) => a + r.n, 0)
    console.log(`\n  ⚠ PRØVEN KØRTE IKKE — ${i} fremmede rækker i ${POSTNR}:`)
    for (const r of fremmede.slice(0, 6)) console.log(`      ${r.n.toString().padStart(4)} · ${r.slug}`)
    console.log('    Prøven ville blande sig med dem, og den rydder dem ikke op.\n')
    await sql.end()
    process.exit(2)
  }
}

await rydFremmed()
await ryd()

const lavKilde = async (slug, navn) => {
  const [k] = await sql`
    insert into sources (slug, name, source_type)
    values (${slug}, ${navn}, 'spider') returning id`
  return k.id
}
const lavBoligI = async (kildeId, praefiks, noegle, vej, husnr, vaerelser) => {
  const [r] = await sql`
    insert into listings (source_id, source_type, external_key, source_url, status,
      address_raw, street, house_number, postal_code, city,
      property_type, size_m2, rooms, rent_monthly, total_monthly, total_monthly_components,
      address_match_level, access_address_uuid)
    values (${kildeId}, 'spider', ${`${praefiks}-${noegle}`},
      ${`https://eksempel.invalid/${praefiks}-${noegle}`}, 'active',
      ${`${vej} ${husnr}, ${POSTNR} Hjerteby`}, ${vej}, ${husnr}, ${POSTNR}, 'Hjerteby',
      'lejlighed', 70, ${vaerelser}, 900000, 1000000, ${['rent', 'heat']},
      'access', ${`U-${praefiks}-${noegle}`})
    returning id`
  return r.id
}

let kildeId = 0
const lavBolig = (noegle, vej, husnr, vaerelser) =>
  lavBoligI(kildeId, MAERKE, noegle, vej, husnr, vaerelser)

/** Sår prøvens eget grundlag. Kaldes to gange — se afsnit 0. */
const saa = async () => {
  kildeId = await lavKilde(MAERKE, 'Prøvekilde favoritforløb e2e')
  // Én bolig til enkeltkortet og boligsiden.
  const enkelt = await lavBolig('enkelt', 'Hjertevej', '1', 2)
  // Tre ens til gruppekortet: samme kilde, postnr, vej og værelsestal, hver
  // sin opgang, så de ikke dedupes mod hinanden.
  const gr = []
  for (const n of ['g1', 'g2', 'g3']) gr.push(await lavBolig(n, 'Gruppevej', String(gr.length * 2 + 1), 3))
  // Auth-kontiene skal findes, før vores egne rækker kan bindes til dem:
  // `users.auth_user_id` har fremmednøgle til auth.users (migration 0013).
  // public.users sås IKKE — bindingen skal ske for rigtigt i `bindKonto`
  // ved første login, præcis som for en ny bruger.
  await sql`insert into auth.users (id, email) values (${BRUGER_ID}, ${MAIL})`
  await sql`insert into auth.users (id, email) values (${BRUGER_ID2}, ${MAIL2})`
  return { enkelt, gr }
}

// ═══ 0 · Oprydningen rammer kun prøvens egne rækker ═══
//
// Den her står FØRST, fordi den er den eneste, der kan fange, at
// oprydningen er blevet for bred igen. Den fremmede række ligger i
// prøvens eget postnummer — præcis hvor den gamle `delete from listings
// where postal_code = …` ville have taget den.
console.log('\n══ 0 · oprydningen rammer kun prøvens egne rækker ══')
const fremmedKilde = await lavKilde(FREMMED, 'Fremmed række — prøven må ikke røre den')
const fremmedId = await lavBoligI(fremmedKilde, FREMMED, 'staar-fast', 'Fremmedvej', '99', 5)
const findes = async (id) => {
  const [r] = await sql`select count(*)::int as n from listings where id = ${id}`
  return r.n === 1
}
{
  tjek('0A · en fremmed række ligger i prøvens postnummer', await findes(fremmedId))
  await saa()
  tjek('0B · og prøvens eget grundlag står der', await voresRaekker() > 0, `${await voresRaekker()} rækker`)
  await ryd()
  tjek('0C · ryd() fjerner ALT prøvens eget', await voresRaekker() === 0,
    `${await voresRaekker()} tilbage`)
  const staar = await findes(fremmedId)
  tjek('0D · og lader den fremmede række stå', staar,
    staar ? '' : 'DEN FREMMEDE RÆKKE BLEV SLETTET')
}

const { enkelt: boligId, gr: gruppe } = await saa()
console.log(`\n  · sået: 1 enkeltbolig + 3 gruppeboliger i ${POSTNR}, konti ${MAIL} og ${MAIL2}`)

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

const BRAEK_VAEK = `drop trigger if exists e2e_favorit_braek on favorites;
                    drop function if exists e2e_favorit_braek();`

let c1
try {
  start('node', ['scripts/favorit-attrap.mjs'], {
    ATTRAP_PORT: String(ATTRAP),
    ATTRAP_BRUGER_ID: BRUGER_ID, ATTRAP_MAIL: MAIL, ATTRAP_KODE: KODE,
    ATTRAP_BRUGER_ID2: BRUGER_ID2, ATTRAP_MAIL2: MAIL2, ATTRAP_KODE2: KODE2,
  })
  if (!await naaet(`${AUTH}/__kald`)) throw new Error('attrappen kom ikke op')

  start('npx', ['next', 'start', '-p', String(APP)], {
    NEXT_PUBLIC_SUPABASE_URL: AUTH,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_kun_til_proever',
    NEXT_PUBLIC_BASE_URL: B,
    DATABASE_URL: DBURL,
    DATABASE_URL_DIRECT: DBURL,
    BILLED_HEMMELIGHED: 'proeve-hemmelighed-kun-til-proever',
  })
  if (!await naaet(`${B}/privatliv`)) throw new Error('appen kom ikke op')
  console.log(`  · appen kører på ${B}, attrappen på ${AUTH}`)

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_STI || process.env.PLAYWRIGHT_CHROMIUM
      || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage'],
  })

  const nyBruger = async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    const s = await c.newPage()
    // Samtykkebanneret ligger oven på og ville opsnappe klik.
    await s.goto(`${B}/privatliv`, { waitUntil: 'domcontentloaded' })
    const k = s.getByRole('button', { name: 'Kun det nødvendige' })
    if (await k.count()) { await k.first().click().catch(() => {}); await vent(400) }
    return { c, p: s }
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
  const logInd = async (s, kode, mail = MAIL) => {
    await s.fill('#ind-mail', mail)
    await s.fill('#ind-kode', kode)
    // FOERSTE .kontoform er login; den anden er «Opret konto». En
    // tekstselektor paa «Log ind» ville ogsaa ramme formularens <h2>.
    await s.locator('form.kontoform').first().locator('button[type=submit]').click()
    await s.waitForLoadState('networkidle').catch(() => {})
    await vent(1600)
  }
  const logUd = async (s) => {
    await s.click('.minside-top button[type=submit]')
    await s.waitForLoadState('networkidle')
    await vent(800)
  }

  // ═══ 1 · Det renderede hjerte på boligsiden ═══
  console.log('\n══ 1 · hjertet på boligsiden peger på login med boligen ══')
  const { c: kontekst1, p } = await nyBruger()
  c1 = kontekst1
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
    await logUd(p)
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
    await logUd(p)

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
    await logUd(p)

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

  // ═══ 8 · Et KNÆKKET hjertelink ═══
  //
  // FEJLEN, DER BLEV RETTET HER: `gemOenskeFra()` gav null både for «ingen
  // parameter» og for «en parameter, vi ikke kunne læse». Siden udelod
  // derfor det skjulte felt, `login()` så et helt almindeligt login, og
  // hun landede på Min side uden sin bolig og uden et ord om hvorfor.
  // Udfaldet `ugyldigt-link` fandtes i koden og kunne ikke nås.
  console.log('\n══ 8 · et knækket hjertelink forsvinder ikke i stilhed ══')
  {
    await logUd(p)
    const foer = await antalFavoritter()

    await p.goto(`${B}/min-side?gem=ikke-et-bolig-id`, { waitUntil: 'networkidle' })
    const udlogget = await p.locator('body').innerText()
    // Hun skal have det at vide FØR hun bruger tid på at logge ind.
    tjek('8A · den udloggede får det at vide med det samme',
      udlogget.includes('Linket virkede ikke'),
      udlogget.slice(0, 140).replace(/\n/g, ' '))
    tjek('8B · og siden lover IKKE at gemme en bolig',
      !(await p.locator('.manchet').innerText()).includes('gemmer vi boligen'),
      (await p.locator('.manchet').innerText()).slice(0, 80))
    // Mærket skal med i POST'en. Uden det ser `login()` et almindeligt
    // login — og så er hele forskellen tabt igen.
    const skjult = p.locator(`form.kontoform input[type=hidden][name=gem]`)
    tjek('8C · formularen bærer mærket for et knækket link',
      await skjult.count() === 1 && await skjult.first().getAttribute('value') === 'knaekket',
      await skjult.count() ? `value=${await skjult.first().getAttribute('value')}` : 'FELTET MANGLER')

    await logInd(p, KODE)
    const krop = await p.locator('body').innerText()
    tjek('8D · hun er logget ind trods det knækkede link',
      p.url().endsWith('/min-side'), p.url().replace(B, ''))
    tjek('8E · og der står, at linket ikke virkede — ikke at boligen er gemt',
      krop.includes('Linket virkede ikke, så boligen blev ikke gemt')
      && !krop.includes('Boligen er gemt'),
      (krop.match(/Linket virkede ikke[^\n]*|Boligen er gemt[^\n]*/) ?? ['INGEN BESKED'])[0])
    tjek('8F · intet blev gemt', await antalFavoritter() === foer,
      `${await antalFavoritter()} mod ${foer}`)
  }

  // ═══ 9 · Kvitteringen må ikke overleve den, der lavede klikket ═══
  //
  // FEJLEN, DER BLEV RETTET HER: kvitteringen levede 30 sekunder og blev
  // aldrig ryddet. Inden for det vindue fik det næste login — hendes eget
  // UDEN et hjerteklik, eller en anden kontos — «Boligen er gemt.» om en
  // bolig, det login intet havde med at gøre.
  //
  // INTET HER VENTER COOKIEN UD. Ventede prøven, ville den måle uret og
  // ikke spærringen; hele pointen er, at kvitteringen ryddes og desuden
  // bærer, hvem den var til.
  console.log('\n══ 9 · en gammel kvittering møder ikke det næste login ══')
  let kvitteringscookie = ''
  {
    // Først en frisk, ægte kvittering at prøve imod.
    await logUd(p)
    await p.goto(`${B}/bolig/${boligId}`, { waitUntil: 'networkidle' })
    await p.click('a.favoritknap-login')
    await p.waitForLoadState('networkidle')
    await logInd(p, KODE)
    tjek('9A · der ER en frisk kvittering at prøve imod',
      (await p.locator('body').innerText()).includes('Boligen er gemt'))
    const ck = (await c1.cookies()).find((x) => x.name === 'bofinda_gemoenske')
    kvitteringscookie = ck?.value ?? ''
    tjek('9B · den ligger i en cookie, serveren satte',
      kvitteringscookie.length > 0 && ck?.httpOnly === true,
      ck ? `httpOnly=${ck.httpOnly}` : 'INGEN COOKIE')

    // ── Det hurtige forløb: ud og ind igen, UDEN et hjerteklik ──
    await logUd(p)
    await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await logInd(p, KODE)
    const igen = await p.locator('body').innerText()
    tjek('9C · et almindeligt login får INGEN kvittering',
      !igen.includes('Boligen er gemt') && igen.includes('Logget ind som'),
      igen.includes('Boligen er gemt') ? 'DEN GAMLE KVITTERING STOD DER' : '')

    // ── Kontoskiftet: den anden konto på den samme maskine ──
    await logUd(p)
    await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await logInd(p, KODE2, MAIL2)
    const anden = await p.locator('body').innerText()
    tjek('9D · den anden konto er logget ind', anden.includes(MAIL2),
      anden.slice(0, 120).replace(/\n/g, ' '))
    tjek('9E · og ser ikke den første kontos kvittering',
      !anden.includes('Boligen er gemt'),
      anden.includes('Boligen er gemt') ? 'EN FREMMED KONTOS KVITTERING' : '')

    // ── Og hvis cookien alligevel overlever en vej, vi ikke har tænkt på ──
    //
    // Den lægges tilbage i browseren MED en frisk udløbstid: det, der
    // måles her, er mærket i kvitteringen, ikke uret. Uden mærket ville
    // den anden konto læse den første kontos besked.
    await c1.addCookies([{
      name: 'bofinda_gemoenske', value: kvitteringscookie, url: B,
      httpOnly: true, sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 600,
    }])
    await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    const injiceret = await p.locator('body').innerText()
    tjek('9F · en indsat kvittering afvises af mærket',
      !injiceret.includes('Boligen er gemt') && injiceret.includes(MAIL2),
      injiceret.includes('Boligen er gemt') ? 'MÆRKET SPÆRREDE IKKE' : '')
    // Og den er stadig hendes egen, når det ER hende. Uden det her kunne
    // 9F bestå af den forkerte grund: fordi kvitteringen var holdt op med
    // at virke for nogen som helst.
    //
    // Cookien lægges tilbage EFTER logind, ikke før. Et login uden et
    // hjerteklik rydder den nemlig med vilje — se 9C — så en cookie lagt
    // ind før ville blive fejet væk af netop den spærring, og prøven
    // ville måle den i stedet for mærket. En GET rydder ingenting.
    await logUd(p)
    await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await logInd(p, KODE)
    await c1.addCookies([{
      name: 'bofinda_gemoenske', value: kvitteringscookie, url: B,
      httpOnly: true, sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 600,
    }])
    await p.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    const egen = await p.locator('body').innerText()
    tjek('9G · men den samme kvittering ER hendes egen',
      egen.includes('Boligen er gemt'),
      egen.includes('Boligen er gemt') ? '' : 'KVITTERINGEN VIRKER IKKE FOR NOGEN')
  }

  // ═══ 10 · DATABASEFEJL efter et vellykket login ═══
  //
  // Det farligste tilfælde: sessionen ER oprettet, og så knækker skrivningen.
  // Går fejlen ud gennem `login()`, ser hun en fejlside — mens hun i
  // virkeligheden ER logget ind. En gemning, der fejler, må aldrig kunne
  // vælte det login, den hang på.
  //
  // Fejlen laves i BASEN, ikke i koden: en trigger på `favorites`, der
  // kaster. `gemFavorit` er altså den ægte INSERT hele vejen ned.
  console.log('\n══ 10 · en databasefejl vælter ikke login ══')
  {
    await logUd(p)
    // Her stod før en pause på 32 sekunder, så kvitteringen fra afsnittet
    // ovenfor kunne udløbe — ellers kunne en gammel besked gøre 10C grøn.
    // Den er væk: kvitteringen ryddes nu ved udlogningen, og afsnit 9
    // efterviser netop det. En prøve, der venter et vindue ud, måler uret.
    const foer = await antalFavoritter()
    const nyBoligId = await lavBolig('braek', 'Braekvej', '3', 2)

    try {
      await sql.unsafe(`
        create or replace function e2e_favorit_braek() returns trigger as $$
        begin raise exception 'e2e: skrivningen knaekkede med vilje'; end $$ language plpgsql;
        create trigger e2e_favorit_braek before insert on favorites
          for each row execute function e2e_favorit_braek();`)

      await p.goto(`${B}/min-side?gem=${nyBoligId}`, { waitUntil: 'networkidle' })
      await logInd(p, KODE)

      const url = p.url().replace(B, '')
      const krop = await p.locator('body').innerText().catch(() => '')
      tjek('10A · login LYKKEDES trods skrivefejlen', url.endsWith('/min-side'), url)
      tjek('10B · hun er logget ind og ser sit eget område',
        krop.includes('Logget ind som') && krop.includes('Gemte boliger'),
        krop.slice(0, 120).replace(/\n/g, ' '))
      // PRAECIS den besked, det her udfald giver. En loes proeve paa «ikke
      // gemt» blev groen af en gammel kvittering fra et tidligere afsnit —
      // altsaa et svar paa et ANDET spoergsmaal. En kontrol, der kan
      // bestaa af den forkerte grund, er ingen kontrol.
      tjek('10C · og beskeden er VORES fejl, ikke «boligen findes ikke»',
        krop.includes('vi kunne ikke gemme boligen')
        && !krop.includes('findes ikke længere') && !krop.includes('Boligen er gemt'),
        (krop.match(/Du er logget ind[^\n]*|Boligen findes ikke[^\n]*|Boligen er gemt[^\n]*/)
          ?? ['ingen besked'])[0])
      tjek('10D · intet blev skrevet', await antalFavoritter() === foer,
        `${await antalFavoritter()} mod ${foer}`)
    } finally {
      // Triggeren må ALDRIG blive stående. Gjorde den det, ville hver
      // eneste senere kørsel mod den her base fejle i en INSERT, og fejlen
      // ville ligne en knækket favoritgemning i stedet for vores egen rest.
      await sql.unsafe(BRAEK_VAEK)
    }
  }
} catch (e) {
  console.log(`\n  ✗ PRØVEN KASTEDE: ${e?.stack ?? e}`)
  fejl++
} finally {
  // ─── Ryd op — og efterprøv, at oprydningen holder sig til sit ───
  //
  // Alt herunder skal ske, også når prøven knækkede undervejs: en
  // efterladt trigger, en åben browser eller en kørende `next start`
  // koster den næste kørsel, ikke den her.
  try { await sql.unsafe(BRAEK_VAEK) } catch { /* basen er allerede væk */ }
  try { await c1?.close() } catch { /* lukket */ }
  luk()

  console.log('\n══ 11 · oprydningen holder sig til prøvens egne rækker ══')
  try {
    await ryd()
    tjek('11A · alt prøvens eget er væk', await voresRaekker() === 0,
      `${await voresRaekker()} tilbage`)
    const staarEndnu = await findes(fremmedId)
    tjek('11B · og den fremmede række står der endnu', staarEndnu,
      staarEndnu ? '' : 'DEN FREMMEDE RÆKKE BLEV SLETTET')
    const [{ n: triggere }] = await sql`
      select count(*)::int as n from pg_trigger where tgname = 'e2e_favorit_braek'`
    tjek('11C · fejltriggeren er væk igen', triggere === 0, `${triggere} tilbage`)
    // Prøvens egen stand-in for en fremmed række ryddes til sidst — den
    // er trods alt vores, og den må ikke ligge og spærre næste kørsels
    // kontrol af fremmede rækker.
    await rydFremmed()
    tjek('11D · og stand-in\'en er ryddet bagefter', !(await findes(fremmedId)))
  } catch (e) {
    tjek('11 · oprydningen kunne køre', false, String(e?.message ?? e))
  }
  try { await sql.end() } catch { /* lukket */ }
}

console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
