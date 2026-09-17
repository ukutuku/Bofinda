// ═══════════════════════════════════════════════════════════════
//  Min side — gemte boliger, UDFØRT i en rigtig browser.
//
//  Prøven gengiver ikke komponenten; den henter siden fra den kørende
//  app, logger ind gennem den rigtige formular og MÅLER det, der står
//  på skærmen. Forskellen er ikke akademisk: et kort kan gengives
//  korrekt i markup og alligevel stå i én spalte, have et 0 px højt
//  billedfelt eller en fokusring, der ikke kan ses. Markup-prøverne
//  ligger i scripts/test-brugeromraade.ts og dækker indholdet; her
//  måles LAYOUTET og TASTATURET.
//
//      DATABASE_URL=… node scripts/cloud/minsidekontrol.mjs
//      … --skaerm ../kontrol-minside      gem også skærmbilleder
//
//  ═══ DEN EJER SIN EGEN APP ═══
//
//  Prøven starter appen selv, på en ledig port, med den isolerede
//  testbase og en falsk Auth-attrap. Den rører aldrig en app, den ikke
//  selv har startet, og den rydder kun sine egne rækker op.
//
//  ═══ INTET GÅR UD AF MASKINEN ═══
//
//  Browseren afviser hver eneste forespørgsel, der ikke går til
//  loopback. Billedbytes leveres af prøven selv gennem en rute i
//  browseren: `/api/billede` svarer ellers med en hentning mod kildens
//  rigtige vært, og den skal ikke ske under en kontrol. Det er samtidig
//  det, der gør det MULIGT at prøve et billede, der fejler undervejs —
//  den ene rute svarer 404 med vilje.
// ═══════════════════════════════════════════════════════════════
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.PLAYWRIGHT_MODUL ?? 'playwright-core'
const { chromium } = await import(PW).then((m) => m.default ?? m)

let fejl = 0, groenne = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (ok) groenne++; else fejl++
}
const vent = (ms) => new Promise((r) => setTimeout(r, ms))

const args = process.argv.slice(2)
const skaermIdx = args.indexOf('--skaerm')
const SKAERMMAPPE = skaermIdx >= 0 ? args[skaermIdx + 1] : null
if (SKAERMMAPPE) mkdirSync(SKAERMMAPPE, { recursive: true })

// ─── Vagt 1: isoleret base ─────────────────────────────────────
const DBURL = process.env.DATABASE_URL ?? ''
if (!DBURL) {
  console.log('\n  ⚠ PRØVEN KØRTE IKKE — der er ingen DATABASE_URL.\n')
  process.exit(2)
}
{
  const u = new URL(DBURL)
  const isoleret = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    && u.port === '55432' && u.pathname === '/bofinda_test'
  if (!isoleret) {
    console.log(`\n  ⚠ PRØVEN KØRTE IKKE — ${u.hostname}:${u.port}${u.pathname} er ikke testbasen.\n`)
    process.exit(2)
  }
}

// ─── Vagt 2: bygget må ikke bære en indbagt Auth-adresse ───────
// `NEXT_PUBLIC_*` bages ind ved BYG. Er bygget lavet med byg.sh, peger
// Auth på testaktivserveren, attrapporten ignoreres, og login fejler i
// et timeout uden at sige hvorfor. Samme vagt som favoritforløbets e2e.
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
const MAERKE = `minside-kontrol-${STEMPEL}`
const POSTNR = '9904'
const BRUGER_ID = '55555555-2222-4333-8444-777777777777'
const MAIL = 'minside-kontrol@invalid.test'
const KODE = 'kontrolkode-til-min-side-42'
const VORES = `slug like 'minside-kontrol-%'`

// Værten ER i TILLADTE_VAERTER, så `billedUrl()` udsteder en signeret
// adresse. Bytes'ene kommer aldrig derfra — se ruten i browseren.
const VAERT = 'https://app.propstep.com'
const UTILLADT = 'https://ikke-en-tilladt-vaert.invalid'

const ryd = async () => {
  await sql`delete from saved_searches where user_id in (select id from users where email = ${MAIL})`
  await sql`delete from favorites where user_id in (select id from users where email = ${MAIL})`
  await sql.unsafe(
    `delete from listings where source_id in (select id from sources where ${VORES})`)
  await sql.unsafe(`delete from sources where ${VORES}`)
  await sql`delete from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID}`
  await sql`delete from auth.users where id = ${BRUGER_ID}`
}

// Fremmede rækker i prøvens postnummer betyder, at den ville blande sig
// med noget, den ikke rydder op. Kontrollen går FORUD for oprydningen.
{
  const fremmede = await sql.unsafe(`
    select coalesce(s.slug, '(uden kilde)') as slug, count(*)::int as n
      from listings l left join sources s on s.id = l.source_id
     where l.postal_code = '${POSTNR}'
       and l.source_id not in (select id from sources where ${VORES})
     group by 1 order by 2 desc`)
  if (fremmede.length) {
    const i = fremmede.reduce((a, r) => a + r.n, 0)
    console.log(`\n  ⚠ PRØVEN KØRTE IKKE — ${i} fremmede rækker i ${POSTNR}:`)
    for (const r of fremmede.slice(0, 6)) console.log(`      ${r.n} · ${r.slug}`)
    await sql.end(); process.exit(2)
  }
}
await ryd()

/**
 * Boligerne. Hver række er ét af de tilfælde, opgaven beder om at se:
 * kendt total, kun husleje, slet ingen pris, ukendte boligoplysninger,
 * manglende billede, fejlende billede, afmeldt.
 */
const RAEKKER = [
  { n: 'total', vej: 'Fuldvej', husnr: '1', type: 'lejlighed', m2: 84, vaer: 3,
    leje: 1200000, total: 1380000, poster: ['rent', 'heat', 'water'],
    billeder: ['a1.jpg', 'a2.jpg', 'a3.jpg'], status: 'active' },
  { n: 'klump', vej: 'Klumpvej', husnr: '3', type: 'raekkehus', m2: 112, vaer: 4,
    leje: 1650000, total: 1828300, poster: ['rent', 'other'],
    billeder: ['b1.jpg', 'b2.jpg'], status: 'active' },
  { n: 'kunleje', vej: 'Lejevej', husnr: '5', type: 'lejlighed', m2: 62, vaer: 2,
    leje: 890000, total: null, poster: null,
    billeder: ['c1.jpg'], status: 'active' },
  { n: 'uoplyst', vej: 'Tavsevej', husnr: '7', type: null, m2: null, vaer: null,
    leje: null, total: null, poster: null,
    billeder: [], status: 'active' },
  { n: 'utilladt', vej: 'Fremmedvaertsvej', husnr: '9', type: 'vaerelse', m2: 24, vaer: 1,
    leje: 450000, total: 520000, poster: ['rent', 'heat'],
    billeder: [], utilladteBilleder: ['d1.jpg'], status: 'active' },
  { n: 'fejler', vej: 'Fejlvej', husnr: '11', type: 'lejlighed', m2: 95, vaer: 4,
    leje: 1400000, total: 1400000, poster: ['rent', 'electricity'], el: 25000,
    billeder: ['FEJLER.jpg'], status: 'active' },
  { n: 'afmeldt', vej: 'Nedtagetvej', husnr: '13', type: 'lejlighed', m2: 70, vaer: 3,
    leje: 1000000, total: 1120000, poster: ['rent', 'heat', 'water'],
    billeder: ['e1.jpg'], status: 'delisted' },
]

const [kilde] = await sql`
  insert into sources (slug, name, source_type)
  values (${MAERKE}, 'Prøvekilde Min side', 'spider') returning id`
const kildeId = kilde.id

const ider = {}
for (const r of RAEKKER) {
  const [l] = await sql`
    insert into listings (source_id, source_type, external_key, source_url, status,
      address_raw, street, house_number, postal_code, city,
      property_type, size_m2, rooms, rent_monthly, utilities_electricity,
      total_monthly, total_monthly_components,
      address_match_level, unit_address_uuid)
    values (${kildeId}, 'spider', ${`${MAERKE}-${r.n}`},
      ${`https://eksempel.invalid/${r.n}`}, ${r.status},
      ${`${r.vej} ${r.husnr}, ${POSTNR} Kontrolby`}, ${r.vej}, ${r.husnr}, ${POSTNR}, 'Kontrolby',
      ${r.type}, ${r.m2}, ${r.vaer}, ${r.leje}, ${r.el ?? null},
      ${r.total}, ${r.poster},
      'unit', ${`intern:v3:minside:${MAERKE}-${r.n}`})
    returning id`
  ider[r.n] = l.id
  let pos = 0
  for (const f of r.utilladteBilleder ?? []) {
    await sql`insert into listing_images (listing_id, external_url, position)
      values (${l.id}, ${`${UTILLADT}/${r.n}/${f}`}, ${pos++})`
  }
  for (const f of r.billeder) {
    await sql`insert into listing_images (listing_id, external_url, position)
      values (${l.id}, ${`${VAERT}/${r.n}/${f}`}, ${pos++})`
  }
}
await sql`insert into auth.users (id, email) values (${BRUGER_ID}, ${MAIL})`
console.log(`\n  · sået: ${RAEKKER.length} boliger i ${POSTNR}, konto ${MAIL}`)

// ─── Op med attrappen og appen ─────────────────────────────────
const ledigPort = () => new Promise((ok) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})
const ATTRAP = await ledigPort(), APP = await ledigPort()
const AUTH = `http://127.0.0.1:${ATTRAP}`, B = `http://127.0.0.1:${APP}`

const boern = []
const start = (cmd, a, env) => {
  const b = spawn(cmd, a, {
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

const naaet = async (url, n = 90) => {
  for (let i = 0; i < n; i++) { try { await fetch(url); return true } catch { await vent(400) } }
  return false
}

// Et lille SVG som billedbytes. Det er en ATTRAP og ser ud som én —
// ensfarvet flade med kortets navn. Der er ingen rigtige boligfotos i
// testmiljøet, og et hentet foto ville gå ud af maskinen.
const attrapfoto = (tekst, farve) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">
  <rect width="800" height="450" fill="${farve}"/>
  <text x="400" y="235" font-family="sans-serif" font-size="34" fill="#ffffff"
    text-anchor="middle" opacity="0.85">${tekst}</text></svg>`
const FARVER = ['#5b6b7a', '#6f6152', '#4f6b5d', '#6b5566', '#586b78', '#6b5f4c', '#55606b']

try {
  start('node', ['scripts/favorit-attrap.mjs'], {
    ATTRAP_PORT: String(ATTRAP),
    ATTRAP_BRUGER_ID: BRUGER_ID, ATTRAP_MAIL: MAIL, ATTRAP_KODE: KODE,
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

  // Samtykkebanneret ligger oven paa og opsnapper baade klik og
  // skaermbilleder. Det afvises paa hver side, prøven aabner — ikke kun
  // paa den foerste: valget gemmes i en cookie, og en cookie, der ikke
  // blev sat, ses ikke, foer et kort er daekket paa et skaermbillede.
  const afvisBanner = async (s) => {
    const k = s.getByRole('button', { name: 'Kun det nødvendige' })
    if (await k.count()) { await k.first().click().catch(() => {}); await vent(350) }
  }

  const nyKontekst = async (bredde, hoejde) => {
    const c = await browser.newContext({ viewport: { width: bredde, height: hoejde } })
    // Intet forlader maskinen. Alt der ikke er loopback, afvises.
    let udefra = 0, afvist = 0
    await c.route('**/*', async (rute) => {
      const u = new URL(rute.request().url())
      if (u.pathname === '/api/billede') {
        // Prøvens egne bytes. `FEJLER` er med vilje: et billede, der
        // ikke kan hentes, skal falde tilbage til det rolige felt og
        // ikke til browserens brudte-billede-ikon.
        const kilde = new URL(u.searchParams.get('u') ?? 'https://x.invalid/')
        if (kilde.pathname.includes('FEJLER')) {
          afvist++
          return rute.fulfill({ status: 404, body: '' })
        }
        const i = Math.abs([...kilde.pathname].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % FARVER.length
        return rute.fulfill({
          status: 200, contentType: 'image/svg+xml',
          body: attrapfoto(kilde.pathname.split('/')[1] ?? 'foto', FARVER[i]),
        })
      }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
        udefra++; return rute.abort()
      }
      return rute.continue()
    })
    const s = await c.newPage()
    await s.goto(`${B}/privatliv`, { waitUntil: 'domcontentloaded' })
    await afvisBanner(s)
    return { c, p: s, udefra: () => udefra, afvist: () => afvist }
  }

  const logInd = async (s) => {
    await s.goto(`${B}/min-side`, { waitUntil: 'domcontentloaded' })
    await s.fill('#ind-mail', MAIL)
    await s.fill('#ind-kode', KODE)
    await s.locator('form.kontoform').first().locator('button[type=submit]').click()
    await s.waitForLoadState('networkidle').catch(() => {})
    await vent(1500)
    await afvisBanner(s)
  }

  // ═══ Log ind og gem boligerne ══════════════════════════════════
  console.log('\n══ 1 · login og grundlag ══')
  const { c: c1, p, udefra, afvist } = await nyKontekst(1440, 1200)
  await logInd(p)
  tjek('1A · logget ind og landet på Min side', p.url().endsWith('/min-side'), p.url().replace(B, ''))

  const [bruger] = await sql`select id from users where email = ${MAIL}`
  tjek('1B · kontoen blev bundet ved første login', Boolean(bruger?.id))
  if (!bruger?.id) throw new Error('ingen brugerrække — resten kan ikke måles')

  for (const r of RAEKKER) {
    await sql`insert into favorites (user_id, listing_id) values (${bruger.id}, ${ider[r.n]})`
  }
  // «Forsvundet» kan kun opstå, hvis nogen sletter en bolig DIREKTE i
  // basen — fremmednøglen er `on delete cascade`. Tilstanden findes
  // alligevel i koden, og den skal kunne ses. Her fremstilles den
  // præcis sådan: spærringen løftes, rækken slettes, spærringen sættes
  // tilbage. Det sker kun i den isolerede testbase.
  await sql.unsafe(`alter table favorites drop constraint if exists favorites_listing_id_listings_id_fk`)
  const FORSVUNDET = '99999999-2222-4333-8444-888888888888'
  await sql`insert into favorites (user_id, listing_id) values (${bruger.id}, ${FORSVUNDET})`

  // Gemte søgninger i alle tre tilstande. De betyder ikke det samme —
  // en ubekræftet varsler INTET, og en afmeldt heller ikke — og siden
  // skal kunne skelne dem. Uden dem står afsnittet tomt, og så er
  // «læses som en helhed» ikke prøvet på noget.
  await sql`insert into saved_searches (user_id, name, criteria, confirmed_at)
    values (${bruger.id}, '3 vær. i Kontrolby',
      ${sql.json({ by: 'Kontrolby', vaerelserMin: 3 })}, now())`
  await sql`insert into saved_searches (user_id, name, criteria)
    values (${bruger.id}, 'Billige boliger i 9904',
      ${sql.json({ postnr: POSTNR, prisMax: 1000000 })})`
  await sql`insert into saved_searches (user_id, name, criteria, confirmed_at, unsubscribed_at)
    values (${bruger.id}, 'Rækkehuse', ${sql.json({ typer: ['raekkehus'] })}, now(), now())`

  await p.reload({ waitUntil: 'networkidle' })
  await afvisBanner(p)
  const kort = p.locator('.gemte-kort > .gemt-kort')
  tjek('1C · alle gemte boliger står som kort',
    await kort.count() === RAEKKER.length + 1, `${await kort.count()} kort`)
  tjek('1D · intet forlod maskinen under kontrollen', udefra() === 0, `${udefra()} forsøg`)

  // ═══ 2 · Layoutet ved tre bredder ══════════════════════════════
  console.log('\n══ 2 · layout ved 390, 768 og 1440 px ══')
  const maal = async (bredde) => {
    await p.setViewportSize({ width: bredde, height: 1200 })
    await vent(500)
    return p.evaluate(() => {
      const k = [...document.querySelectorAll('.gemte-kort > .gemt-kort')]
      const f = [...document.querySelectorAll('.gemt-foto')]
      return {
        spalter: new Set(k.map((x) => Math.round(x.getBoundingClientRect().left))).size,
        breddeKort: Math.round(k[0]?.getBoundingClientRect().width ?? 0),
        fotohoejder: [...new Set(f.map((x) => Math.round(x.getBoundingClientRect().height)))],
        fotobredder: [...new Set(f.map((x) => Math.round(x.getBoundingClientRect().width)))],
        // Ens høje kort i samme række er dét, der gør, at fodlinjerne
        // flugter. Måles på de to første kort, som ligger side om side.
        hoejder: k.slice(0, 2).map((x) => Math.round(x.getBoundingClientRect().height)),
        vandret: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        // Foden må ikke brække, så knappen falder ned under teksten med
        // et tomt felt ved siden af. Knappen skal stå TIL HØJRE FOR
        // sporlinjen og flugte med fodens højrekant. Målt på hvert kort
        // ved hver bredde — det er dét, en medieforespørgsel ikke kunne
        // se, da kortet var 329 px bredt på en 768 px skærm.
        fodbrud: [...document.querySelectorAll('.gemt-fod')].filter((f) => {
          const spor = f.querySelector('.gemt-spor')
          const knap = f.querySelector('.gemt-fjern')
          if (!spor || !knap) return false
          const s = spor.getBoundingClientRect(), b = knap.getBoundingClientRect()
          const r = f.getBoundingClientRect()
          return !(b.left >= s.right - 1 && Math.abs(b.right - r.right) < 2)
        }).length,
      }
    })
  }
  for (const [bredde, ventet] of [[390, 1], [768, 2], [1440, 2]]) {
    const m = await maal(bredde)
    tjek(`2 · ${bredde} px: ${ventet} spalte${ventet > 1 ? 'r' : ''}`,
      m.spalter === ventet, `målte ${m.spalter} · kort ${m.breddeKort} px`)
    tjek(`2 · ${bredde} px: ensartet billedformat`,
      m.fotohoejder.length === 1 && m.fotobredder.length === 1,
      `h: ${m.fotohoejder.join('/')} · b: ${m.fotobredder.join('/')}`)
    tjek(`2 · ${bredde} px: ingen vandret rulning`, !m.vandret)
    tjek(`2 · ${bredde} px: foden hænger ikke halvt`, m.fodbrud === 0,
      `${m.fodbrud} kort hvor Fjern ikke står til højre for sporlinjen`)
    if (ventet === 2) {
      tjek(`2 · ${bredde} px: kortene i en række er lige høje`,
        m.hoejder[0] === m.hoejder[1], m.hoejder.join(' / '))
    }
    if (SKAERMMAPPE) {
      // Rul til toppen først. Bjælken er `sticky`, og et fuldsides-
      // skærmbillede taget fra en rullet side sætter den ind midt i
      // billedet — det ligner en fejl på siden og er det ikke.
      await p.evaluate(() => window.scrollTo(0, 0))
      await vent(200)
      await p.screenshot({ path: `${SKAERMMAPPE}/minside-${bredde}.png`, fullPage: true })
    }
  }
  await p.setViewportSize({ width: 1440, height: 1200 })
  await vent(400)

  // ═══ 3 · Billeder: manglende og fejlende ═══════════════════════
  console.log('\n══ 3 · billeder ══')
  const kortFor = (n) => p.locator(`.gemt-kort:has(a.adresse[href="/bolig/${ider[n]}"])`)
  {
    const medFoto = kortFor('total')
    tjek('3A · kortet med billeder viser et billede',
      await medFoto.locator('.gemt-foto img').count() === 1)
    tjek('3A · og billedet er faktisk tegnet',
      await medFoto.locator('.gemt-foto img').evaluate((i) => i.naturalWidth > 0))
    tjek('3A · med antallet på', (await medFoto.locator('.gemt-antal').innerText()).includes('3 billeder'))

    for (const [navn, n] of [['ingen billedrække', 'uoplyst'], ['vært uden for allowlisten', 'utilladt']]) {
      const k = kortFor(n)
      tjek(`3B · ${navn}: roligt fallback, intet billede`,
        await k.locator('.gemt-foto.uden-foto').count() === 1
        && await k.locator('.gemt-foto img').count() === 0)
      const h = await k.locator('.gemt-foto').evaluate((x) => Math.round(x.getBoundingClientRect().height))
      tjek(`3B · ${navn}: feltet har stadig sin højde`, h > 100, `${h} px`)
    }

    // Det fejlende billede. URL'en er gyldig og værten tilladt, men
    // hentningen svarer 404. Feltet må ikke kollapse, og der må ikke stå
    // et brudt-billede-ikon — baggrunden er fallback'et, og den ligger
    // under billedet i forvejen.
    const fejler = kortFor('fejler')
    // BEVISET FOR AT TILFÆLDET ER ÆGTE ligger i ruten, ikke i DOM'en.
    // Det stod før som `img.naturalWidth === 0` — men netop fordi
    // rettelsen virker, er billedet udskiftet med fallback'et, når der
    // måles, og så var svaret «ingen img» og ikke «fejlet hentning».
    // Målingen skiftede altså betydning, da fejlen blev rettet. Ruten
    // talte den 404, browseren faktisk fik.
    tjek('3C · fejlende billede: browseren fik faktisk et 404',
      afvist() > 0, `${afvist()} afviste hentninger`)
    const fb = await fejler.locator('.gemt-foto').evaluate((x) => {
      const r = x.getBoundingClientRect()
      return { h: Math.round(r.height), b: Math.round(r.width) }
    })
    tjek('3C · og feltet står stadig i fuld højde', fb.h > 100, `${fb.h}×${fb.b} px`)
    tjek('3C · forholdet er det samme som de andres',
      Math.abs(fb.b / fb.h - 16 / 9) < 0.02, `${(fb.b / fb.h).toFixed(3)}`)
    // Og det ROLIGE fallback skal staa der — ikke browserens eget
    // brudt-billede-ikon. Det er hele grunden til, at `Gemtfoto` har
    // en `onError` og ikke bare en baggrund: Chrome tegner ikonet ogsaa
    // med tom `alt`, og maalt i et skaermbillede var det dét, der stod.
    tjek('3C · fallback\'et traadte i stedet for det brudte billede',
      await fejler.locator('.gemt-foto.uden-foto').count() === 1
      && await fejler.locator('.gemt-foto img').count() === 0)
    // Og de to grunde til et tomt felt siger ikke det samme.
    tjek('3C · teksten siger at billedet FEJLEDE, ikke at der ingen er',
      (await fejler.locator('.gemt-intetfoto').innerText()).includes('kunne ikke hentes'),
      await fejler.locator('.gemt-intetfoto').innerText())
    tjek('3B · og kilden uden billeder siger noget ANDET',
      (await kortFor('uoplyst').locator('.gemt-intetfoto').innerText()).trim() === 'Intet billede',
      await kortFor('uoplyst').locator('.gemt-intetfoto').innerText())
  }

  // ═══ 4 · Husleje, total og det ukendte ═════════════════════════
  console.log('\n══ 4 · beløb og ukendte oplysninger ══')
  {
    const tekst = async (n) => (await kortFor(n).innerText()).replace(/\s+/g, ' ')
    const t = await tekst('total')
    tjek('4A · kendt total siger «til udlejer»',
      t.includes('kr/md til udlejer') && !t.includes('i husleje'), t.slice(0, 90))
    tjek('4A · og prisen er den grønne',
      await kortFor('total').locator('.gemt-pris:not(.kun-leje)').count() === 1)

    const kl = await tekst('kunleje')
    tjek('4B · uden total siger den «i husleje»',
      kl.includes('kr/md i husleje') && !kl.includes('til udlejer'), kl.slice(0, 90))
    tjek('4B · og manglen siges højt',
      kl.includes('Udlejer oplyser ikke aconto'))
    tjek('4B · og prisen er ikke den grønne',
      await kortFor('kunleje').locator('.gemt-pris.kun-leje').count() === 1)

    const u = await tekst('uoplyst')
    tjek('4C · uden pris står der ord, ikke et tomt tal',
      u.includes('Prisen er ikke oplyst') && !u.includes('kr/md'), u.slice(0, 90))
    tjek('4C · ukendt boligtype, værelser og areal udelades',
      !u.includes('vær.') && !u.includes('m²') && !u.includes('—'), u.slice(0, 90))

    // El: de fire tilstande, som de rammer et gemt kort.
    const klump = await tekst('klump')
    tjek('4D · samlet aconto: «ét samlet beløb», ikke «indgår ikke»',
      klump.includes('ét samlet beløb') && !klump.includes('El indgår ikke'), klump.slice(0, 120))
    tjek('4D · udspecificeret uden el: «El indgår ikke»',
      t.includes('El indgår ikke'))
    tjek('4D · el oplyst: ingen el-linje',
      !(await tekst('fejler')).includes('El indgår ikke'))

    // Ingen grøn total uden el gjort rede for — målt på hvert kort på
    // skærmen, ikke på en gengivelse.
    // Prisblokken er GRØN, saa snart totalen er kendt — uanset hvad
    // totalen daekker. Er el ikke med i den, SKAL kortet sige det.
    // Maalt paa hvert eneste kort paa skaermen, ikke paa en gengivelse.
    const groenneKort = await p.evaluate(() => {
      const ud = []
      for (const k of document.querySelectorAll('.gemt-kort')) {
        const pris = k.querySelector('.gemt-pris')
        if (!pris || pris.classList.contains('kun-leje')
            || pris.classList.contains('ingen-pris')) continue
        ud.push({
          el: Boolean(k.querySelector('.el')),
          navn: (k.querySelector('.adresse')?.textContent ?? '?').trim(),
        })
      }
      return ud
    })
    tjek('4E · der ER grønne totaler at måle på', groenneKort.length >= 4,
      `${groenneKort.length}`)
    // Af de fem grønne har KUN «Fejlvej 11» el som navngiven post.
    // Resten skal have linjen — ellers står et grønt tal uden at el er
    // gjort rede for, og det er fejlen fra de 171 gruppekort.
    const udenLinje = groenneKort.filter((x) => !x.el).map((x) => x.navn)
    tjek('4E · kun kortet med el som navngiven post står uden el-linjen',
      udenLinje.length === 1 && udenLinje[0] === 'Fejlvej 11',
      udenLinje.join(' | ') || 'ingen')
  }

  // ═══ 5 · Afmeldt og forsvundet ═════════════════════════════════
  console.log('\n══ 5 · afmeldt og forsvundet ══')
  {
    const a = kortFor('afmeldt')
    tjek('5A · afmeldt: kortet er mærket', await a.evaluate((x) => x.classList.contains('utilgaengelig')))
    tjek('5A · afmeldt: der står hvad der skete',
      (await a.innerText()).includes('Ikke længere tilgængelig'))
    tjek('5A · afmeldt: boligsiden kan stadig åbnes',
      await a.locator(`a.adresse[href="/bolig/${ider.afmeldt}"]`).count() === 1)

    const v = p.locator('.gemt-kort:has-text("Boligen findes ikke længere")')
    tjek('5B · forsvundet: kortet siger det', await v.count() === 1)
    tjek('5B · forsvundet: der er ikke et link til en side, der ikke findes',
      await v.locator('a[href^="/bolig/"]').count() === 0)
    tjek('5B · forsvundet: men den kan stadig fjernes',
      await v.locator('button.gemt-fjern').count() === 1)
  }

  // ═══ 6 · Tastatur og fokus ═════════════════════════════════════
  console.log('\n══ 6 · tastatur og synligt fokus ══')
  {
    const synligRing = () => p.evaluate(() => {
      const e = document.activeElement
      if (!e) return null
      const s = getComputedStyle(e)
      const b = e.getBoundingClientRect()
      return {
        tag: e.tagName.toLowerCase(), klasse: e.className, tekst: (e.innerText ?? '').slice(0, 40),
        ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        bredde: s.outlineWidth, stoerrelse: [Math.round(b.width), Math.round(b.height)],
      }
    })

    // Fra adressen på første kort: tab skal nå Fjern på samme kort.
    await kortFor('total').locator('a.adresse').focus()
    const paaAdresse = await synligRing()
    tjek('6A · adressen kan få fokus', paaAdresse?.klasse?.includes('adresse'), paaAdresse?.tekst)
    tjek('6A · og fokus kan SES', paaAdresse?.ring === true, paaAdresse?.bredde)

    await p.keyboard.press('Tab')
    const efter = await synligRing()
    tjek('6B · billedlinket er ikke et ekstra tabstop',
      !efter?.klasse?.includes('gemt-fotolink'), efter?.klasse ?? '(intet)')
    tjek('6B · næste stop er Fjern på samme kort',
      efter?.klasse?.includes('gemt-fjern'), efter?.klasse ?? '(intet)')
    tjek('6B · og Fjern har en synlig fokusring', efter?.ring === true, efter?.bredde)
    tjek('6B · knappen er stor nok til at ramme',
      (efter?.stoerrelse?.[1] ?? 0) >= 44, `${efter?.stoerrelse?.join('×')} px`)
    if (SKAERMMAPPE) {
      // Fokus SES kun, hvis nogen kigger. Billedet tages, mens ringen
      // faktisk er der — ikke bagefter, hvor den er væk igen.
      await kortFor('total').scrollIntoViewIfNeeded()
      await vent(200)
      await p.screenshot({ path: `${SKAERMMAPPE}/minside-fokus-1440.png` })
    }

    const navn = await kortFor('total').locator('button.gemt-fjern').getAttribute('aria-label')
    tjek('6C · navnet siger hvilken bolig', (navn ?? '').includes('Fuldvej 1'), navn ?? '')
    tjek('6C · og den synlige tekst står først i navnet', (navn ?? '').startsWith('Fjern'), navn ?? '')

    // Og den VIRKER med tastaturet. Rækken skal være væk i basen
    // bagefter — ikke bare ude af DOM'en.
    const foer = await kort.count()
    await p.keyboard.press('Enter')
    await p.waitForLoadState('networkidle').catch(() => {})
    await vent(1200)
    const [r] = await sql`select count(*)::int as n from favorites
      where user_id = ${bruger.id} and listing_id = ${ider.total}`
    tjek('6D · Enter på Fjern fjernede rækken i basen', r.n === 0, `${r.n} tilbage`)
    tjek('6D · og kortet er væk fra listen', await kort.count() === foer - 1,
      `${await kort.count()} af ${foer}`)
  }

  // ═══ 7 · Siden som helhed ══════════════════════════════════════
  console.log('\n══ 7 · overskrifter og optælling ══')
  {
    const hoved = p.locator('.blok-hoved')
    tjek('7A · begge afsnit har samme hoved', await hoved.count() === 2, `${await hoved.count()}`)
    const b = (await hoved.nth(0).innerText()).replace(/\s+/g, ' ')
    tjek('7B · boligantallet står ved overskriften',
      /Gemte boliger \d+ boliger/.test(b), b)
    // Tallet TÆLLER boliger, ikke kort — og det skal passe med basen.
    const [n] = await sql`select count(*)::int as n from favorites where user_id = ${bruger.id}`
    tjek('7C · og tallet er det rigtige',
      b.includes(`${n.n} boliger`), `siden: ${b} · basen: ${n.n}`)
    tjek('7D · de utilgængelige er talt fra', /kan stadig lejes/.test(b), b)

    const s = (await hoved.nth(1).innerText()).replace(/\s+/g, ' ')
    tjek('7E · gemte søgninger har også sit hoved', s.startsWith('Gemte søgninger'), s)
    tjek('7F · og samme optælling, med de tre tilstande hver for sig',
      /3 søgninger · 1 mangler bekræftelse · 1 afmeldt/.test(s), s)
    const soeg = p.locator('.gemte-soegninger > .gemt-soegning')
    tjek('7G · søgningerne står som kort i én spalte',
      await soeg.count() === 3
      && new Set(await soeg.evaluateAll((xs) =>
        xs.map((x) => Math.round(x.getBoundingClientRect().left)))).size === 1,
      `${await soeg.count()} stk.`)
    tjek('7H · en ubekræftet søgning siger, at den ikke varsler endnu',
      (await p.locator('.gemt-soegning:has-text("Billige boliger")').innerText())
        .includes('Mangler bekræftelse'))
    tjek('7I · en afmeldt er mærket og har ikke et afmeld-link',
      await p.locator('.gemt-soegning.utilgaengelig').count() === 1
      && await p.locator('.gemt-soegning.utilgaengelig a[href^="/afmeld/"]').count() === 0)
    // Samme brydning som boligkortenes fod — også på telefonen, hvor
    // «Afmeld» før faldt ned under teksten og venstrestillet.
    for (const bredde of [390, 768, 1440]) {
      await p.setViewportSize({ width: bredde, height: 1200 })
      await vent(350)
      const hang = await p.evaluate(() => [...document.querySelectorAll('.gemt-soegning')]
        .filter((r) => {
          const a = r.querySelector('a[href^="/afmeld/"]')
          if (!a) return false
          const k = r.querySelector('.gemt-krop').getBoundingClientRect()
          const b = a.getBoundingClientRect(), x = r.getBoundingClientRect()
          return !(b.left >= k.right - 1 && b.right <= x.right + 1)
        }).length)
      tjek(`7J · ${bredde} px: «Afmeld» står til højre for teksten`, hang === 0, `${hang}`)
    }
    await p.setViewportSize({ width: 1440, height: 1200 })
    await vent(350)
  }

  if (SKAERMMAPPE) console.log(`\n  · skærmbilleder i ${SKAERMMAPPE}`)

  await c1.close()
} catch (e) {
  console.log(`\n  ✗ PRØVEN BRØD SAMMEN — ${e.message}`)
  fejl++
} finally {
  luk()
  // RÆKKKEFØLGEN ER IKKE LIGEGYLDIG. Oprydningen skal komme FØRST:
  // spærringen kan ikke sættes tilbage, så længe den forældreløse
  // «forsvundet»-række står der, og et mislykket forsøg her ville
  // efterlade basen uden fremmednøgle til næste kørsel — hvilket den
  // gjorde, første gang prøven brød sammen undervejs.
  await ryd().catch(() => {})
  await sql.unsafe(`alter table favorites add constraint favorites_listing_id_listings_id_fk
    foreign key (listing_id) references public.listings(id) on delete cascade`)
    .catch(() => { console.log('  ⚠ fremmednøglen på favorites.listing_id kunne ikke sættes tilbage') })
  await sql.end()
}

console.log(fejl === 0
  ? `\n  ALT GRØNT — ${groenne} kontroller\n`
  : `\n  ${fejl} FEJLEDE af ${groenne + fejl} kontroller\n`)
process.exit(fejl ? 1 : 0)
