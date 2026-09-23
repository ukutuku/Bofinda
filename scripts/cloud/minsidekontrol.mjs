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
//  selv har startet.
//
//  ═══ TRE SPÆRRINGER, OG DEN TREDJE ER DEN VIGTIGE ═══
//
//  Prøven SKRIVER. Derfor tre lag, i den rækkefølge:
//
//      1  DATABASE_URL'ens FORM      loopback, 55432, bofinda_test
//      2  bygget                     ingen indbagt Auth-adresse
//      3  den FAKTISKE forbindelse   basen SPØRGES, hvem den er
//
//  Kun den tredje er et bevis. En URL kan pege på det rigtige og
//  alligevel ramme noget andet — en tunnel, en videresendelse, en
//  omdirigering — og så er de to første linjer noget, ingen burde stole
//  på. Derfor `current_database()`, `inet_server_addr()` og
//  `inet_server_port()` FØR første skrivning, ligesom
//  `scripts/cloud/app-op.sh`, `rooms-repraesentant.ts` og
//  `tastaturkontrol.mjs` gør det.
//
//  ═══ OPRYDNINGEN RAMMER KUN DENNE KØRSELS EGNE RÆKKER ═══
//
//  Identiteterne er unikke pr. kørsel — kilde-slug, mailadresse og
//  auth-uuid bærer alle et løbenummer — og oprydningen sletter på de
//  ID'er, kørslen selv har oprettet. Den ryddede før på
//  `slug like 'minside-kontrol-%'` og en FAST mailadresse, og begge dele
//  ville ramme en anden kørsel af den samme prøve. Der ryddes heller
//  ikke længere NOGET, før der er skrevet: en prøve, der begynder med at
//  slette, kan ikke vide, hvis rækker den sletter.
//
//  Afsnit 0 efterviser begge dele med en stand-in, der ligner en anden
//  kørsel til forveksling.
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
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { knib, nulstilZoom, svirp, touchsession, tryk, zoom } from './touch.mjs'
import { fokusinfo, scriptetRute } from './fokus.mjs'

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

// ─── Vagt 1: DATABASE_URL'ens FORM ─────────────────────────────
// Formen alene er ikke et bevis — se vagt 3. Den er her, fordi en
// åbenlyst forkert URL skal afvises, før der overhovedet åbnes en
// forbindelse til den.
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

// ─── Vagt 3: DEN FAKTISKE FORBINDELSE ──────────────────────────
//
// Ikke formen på strengen: SPØRG basen, hvem den er, og lad SVARET
// afgøre. En loopback-adresse i URL'en, der i virkeligheden ender et
// andet sted, fanges her og ingen andre steder.
//
// ═══ HVORFOR PRÆDIKATET STÅR FOR SIG ═══
//
// Der findes ingen fremmed base at forbinde til for at prøve linjen
// udefra, så prædikatet skilles fra kaldet og prøves med SIMULEREDE
// værdier — samme greb som `scripts/cloud/rooms-adressevagt.ts` bruger
// mod `erIsoleret` i `rooms-repraesentant.ts`. Afsnit 0 gør begge dele:
// simulerede værdier mod prædikatet, OG en rigtig forbindelse til en
// rigtig forkert base på den samme klynge.
//
// ═══ DEN SAMME VAGT FINDES TRE STEDER ═══
//
// `rooms-repraesentant.ts` (tsx), `tastaturkontrol.mjs` (node) og her.
// Det er ét udtryk på tre steder, og CLAUDE.md's regel siger ét sted.
// De to andre kan ikke importeres herfra: den ene er TypeScript, den
// anden har sideeffekter i modultoppen. Den rigtige rettelse er ét delt
// modul, alle tre importerer — den hører ikke til i denne afgrænsede
// rettelse, men ændres den ene, skal de to andre med.

/**
 * De adresser, en isoleret testforbindelse må komme fra.
 *
 * NULL fra `inet_server_addr()` betyder unix-domæne-socket. Den er per
 * definition lokal og kan ikke nå en fremmed vært, så den godkendes.
 */
const LOKALE_ADRESSER = new Set(['loopback', '127.0.0.1', '::1'])

/**
 * `127.0.0.1/32` → `127.0.0.1`.
 *
 * `inet_server_addr()` er af typen `inet` og bærer præfikslængden med,
 * når den castes til text. Masken hører til typen, ikke til værten —
 * uden strippet ville hver eneste adresse se forkert ud, og vagten være
 * en linje, ingen turde stole på.
 */
const udenPraefiks = (a) => String(a).split('/')[0] ?? String(a)

/** Navn OG port OG vært. Alle tre, ellers er det ikke testbasen. */
const erIsoleret = (d, a, p) =>
  d === 'bofinda_test' && Number(p) === 55432 && LOKALE_ADRESSER.has(udenPraefiks(a))

// Rækkefølgen mellem vagten og første skrivning er selve pointen, og den
// måles i afsnit 0 frem for at blive påstået. Flytter nogen vagten ned
// under såningen — eller lægger nogen en oprydning over den — bliver 0I
// rød. Tælleren sættes af `skriv()` og af `ryd()`/`rydFremmed()`, så den
// dækker BÅDE skrivninger og sletninger. Kravet er «før første skrivning
// eller sletning», og en tæller, der kun så den ene slags, ville svare
// på et snævrere spørgsmål end det, der blev stillet.
let trin = 0, vagtTrin = null, skrivTrin = null
const noterSkrivning = () => { if (skrivTrin == null) skrivTrin = ++trin }

// ─── Afbrydelse: hovedstrømmen skal STOPPE med at skrive ───────
//
// Et SIGINT afslutter ikke `try`-blokken. Rydder signalhåndteringen op
// med det samme, vælger `ryd()` sine rækker, MENS såningen stadig
// indsætter nye — og så fejler `delete from sources` på
// `listings_source_id_sources_id_fk`, som er `on delete no action`.
// Fejlen blev slugt, processen afsluttede 130, og kilden plus de
// boliger, der nåede at komme til, stod tilbage i 9904 uden for ethvert
// spor. Vinduet er smalt — nogle titals millisekunder — men det er
// præcis dét, en oprydning skal kunne tåle.
//
// Derfor: flaget stopper hovedstrømmen ved næste skrivning, og
// oprydningen venter på, at der er ro, før den vælger noget.
let afbrudt = null
let iLuften = 0
const stopHvisAfbrudt = () => { if (afbrudt) throw new Error(`afbrudt (${afbrudt})`) }

/**
 * ALLE skrivninger går herigennem.
 *
 * Tre ting ét sted: tælleren til 0I, afbrydelsesflaget, og hvor mange
 * skrivninger der er i luften. En ny indsættelse kan ikke tilføjes uden
 * at blive talt med — det var indvendingen mod en tæller, hver kalder
 * selv skulle huske at røre.
 */
const skriv = async (fn) => {
  stopHvisAfbrudt()
  noterSkrivning()
  iLuften++
  try { return await fn() } finally { iLuften-- }
}

/** Venter på, at hovedstrømmen holder op med at skrive. */
const roligt = async (frist = 5000) => {
  const slut = Date.now() + frist
  while (iLuften > 0 && Date.now() < slut) await vent(40)
  return iLuften === 0
}

/** Spørger basen, hvem den er. Kaldes FØR første skrivning. */
const hvemErBasen = async (klient) => {
  const [r] = await klient`select current_database() d,
    coalesce(inet_server_addr()::text, 'loopback') a,
    inet_server_port() p, current_user u`
  return { d: String(r.d), a: String(r.a), p: Number(r.p), u: String(r.u) }
}

const IDENT = await hvemErBasen(sql).catch((e) => {
  console.log(`\n  ⚠ PRØVEN KØRTE IKKE — kunne ikke spørge basen: ${e.message}\n`)
  process.exit(2)
})
if (!erIsoleret(IDENT.d, IDENT.a, IDENT.p)) {
  console.log(`\n  ⚠ PRØVEN KØRTE IKKE — forbundet til ${IDENT.d} på ${IDENT.a}:${IDENT.p}.`)
  console.log('    Kravet er databasen bofinda_test, porten 55432 OG en lokal adresse')
  console.log('    (loopback, 127.0.0.1 eller ::1). Prøven SKRIVER.\n')
  await sql.end()
  process.exit(2)
}
vagtTrin = ++trin

// ─── Grundlaget: UNIKKE identiteter pr. kørsel ─────────────────
//
// Løbenummeret er tid PLUS en uuid-stump. Tiden alene er ikke nok: to
// kørsler startet i det samme millisekund ville få den samme, og så er
// «unik pr. kørsel» en antagelse i stedet for en egenskab.
const LOEB = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
const MAERKE = `minside-kontrol-${LOEB}`
const POSTNR = '9904'
const BRUGER_ID = randomUUID()
const MAIL = `minside-kontrol-${LOEB}@invalid.test`
const KODE = `kontrolkode-${LOEB}`

// Værten ER i TILLADTE_VAERTER, så `billedUrl()` udsteder en signeret
// adresse. Bytes'ene kommer aldrig derfra — se ruten i browseren.
const VAERT = 'https://app.propstep.com'
const UTILLADT = 'https://ikke-en-tilladt-vaert.invalid'

// ─── Sporet: præcis det, DENNE kørsel har oprettet ─────────────
//
// Oprydningen sletter herfra og intet andet sted. Den brugte før
// `slug like 'minside-kontrol-%'` og en fast mailadresse — to mønstre,
// der matcher enhver anden kørsel af den samme prøve lige så godt som
// denne. Sporet fyldes UNDERVEJS, så en såning, der brækker halvvejs,
// stadig har noget at rydde op efter. Se `ryd()` og afsnit 0.
const spor = { kilder: [], boliger: [], brugere: [], authBrugere: [] }

/**
 * Oprydningen. Kun ID'er fra `spor` og kørslens egen identitet.
 *
 * `MAIL` og `BRUGER_ID` bærer løbenummeret, så de ER kørslens egne, og
 * de står med fordi `users`-rækken skabes af `bindKonto` ved login —
 * brækker prøven mellem login og opsamlingen, er ID'et ikke i sporet
 * endnu, mens rækken er der.
 *
 * Rækkefølgen er eksplicit frem for at hvile på cascade: barnetabellerne
 * først. En oprydning, der forudsætter en fremmednøgles opførsel, går i
 * stykker den dag nøglen ændres, og gør det tavst.
 */
const ryd = async () => {
  // Også en SLETNING tæller som «første skrivning» for 0I. Lægger nogen
  // en oprydning over vagten, er det netop den ødelæggende vej.
  noterSkrivning()
  const brugere = spor.brugere.length ? spor.brugere : null
  if (brugere) {
    await sql`delete from saved_searches where user_id in ${sql(brugere)}`
    await sql`delete from favorites where user_id in ${sql(brugere)}`
  }
  await sql`delete from saved_searches where user_id in (
    select id from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID})`
  await sql`delete from favorites where user_id in (
    select id from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID})`
  if (spor.kilder.length) {
    // Boligerne slettes på KILDENS id, ikke kun på de bolig-id'er, der
    // nåede at komme i sporet. En bolig under en kilde, DENNE kørsel har
    // oprettet, kan kun være denne kørsels — og så er der ingen luge
    // mellem `insert ... returning` og `spor.boliger.push()`, hvor en
    // række kan blive hængende. `listings.source_id` er `on delete no
    // action`, så en overset bolig ville ellers have blokeret sletningen
    // af kilden og efterladt begge dele.
    await sql`delete from listing_images where listing_id in (
      select id from listings where source_id in ${sql(spor.kilder)})`
    await sql`delete from listings where source_id in ${sql(spor.kilder)}`
  }
  if (spor.boliger.length) {
    await sql`delete from listing_images where listing_id in ${sql(spor.boliger)}`
    await sql`delete from listings where id in ${sql(spor.boliger)}`
  }
  if (spor.kilder.length) await sql`delete from sources where id in ${sql(spor.kilder)}`
  if (brugere) await sql`delete from users where id in ${sql(brugere)}`
  await sql`delete from users where email = ${MAIL} or auth_user_id = ${BRUGER_ID}`
  if (spor.authBrugere.length) {
    await sql`delete from auth.users where id in ${sql(spor.authBrugere)}`
  }
  await sql`delete from auth.users where id = ${BRUGER_ID}`
  spor.kilder.length = 0; spor.boliger.length = 0
  spor.brugere.length = 0; spor.authBrugere.length = 0
}

/** Hvor mange rækker kørslen har tilbage i basen. 0 = ryddet helt. */
const voresRaekker = async () => {
  const [r] = await sql`select
    (select count(*)::int from sources where slug = ${MAERKE})
    + (select count(*)::int from listings where external_key like ${`${MAERKE}-%`})
    + (select count(*)::int from users where email = ${MAIL})
    + (select count(*)::int from auth.users where id = ${BRUGER_ID}) as n`
  return Number(r.n)
}

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

/**
 * Sår kørslens eget grundlag. Hver indsættelse noteres i `spor`, FØR
 * den næste sker — brækker såningen halvvejs, rydder `finally` det op,
 * der allerede står i basen.
 */
const saa = async () => {
  const [kilde] = await skriv(() => sql`
    insert into sources (slug, name, source_type)
    values (${MAERKE}, 'Prøvekilde Min side', 'spider') returning id`)
  spor.kilder.push(kilde.id)

  const ud = {}
  for (const r of RAEKKER) {
    const [l] = await skriv(() => sql`
      insert into listings (source_id, source_type, external_key, source_url, status,
        address_raw, street, house_number, postal_code, city,
        property_type, size_m2, rooms, rent_monthly, utilities_electricity,
        total_monthly, total_monthly_components,
        address_match_level, unit_address_uuid)
      values (${kilde.id}, 'spider', ${`${MAERKE}-${r.n}`},
        ${`https://eksempel.invalid/${r.n}`}, ${r.status},
        ${`${r.vej} ${r.husnr}, ${POSTNR} Kontrolby`}, ${r.vej}, ${r.husnr}, ${POSTNR}, 'Kontrolby',
        ${r.type}, ${r.m2}, ${r.vaer}, ${r.leje}, ${r.el ?? null},
        ${r.total}, ${r.poster},
        'unit', ${`intern:v3:minside:${MAERKE}-${r.n}`})
      returning id`)
    spor.boliger.push(l.id)
    ud[r.n] = l.id
    let pos = 0
    for (const f of [...(r.utilladteBilleder ?? []).map((f) => `${UTILLADT}/${r.n}/${f}`),
                     ...r.billeder.map((f) => `${VAERT}/${r.n}/${f}`)]) {
      const i = pos++
      await skriv(() => sql`insert into listing_images (listing_id, external_url, position)
        values (${l.id}, ${f}, ${i})`)
    }
  }
  // `public.users` sås IKKE. Bindingen skal ske for rigtigt i
  // `bindKonto` ved første login, præcis som for en ny bruger.
  await skriv(() => sql`insert into auth.users (id, email) values (${BRUGER_ID}, ${MAIL})`)
  spor.authBrugere.push(BRUGER_ID)
  return ud
}

// ─── Stand-in'en: «en anden kørsel» ────────────────────────────
//
// Den ligner denne prøves egne rækker til forveksling — samme
// slug-præfiks, samme mail-præfiks, samme postnummer — og den må
// overleve `ryd()`. Gør den ikke det, rammer oprydningen bredt igen.
const FLOEB = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
const FREMMED = { slug: `minside-kontrol-${FLOEB}`, mail: `minside-kontrol-${FLOEB}@invalid.test`,
  auth: randomUUID(), kilde: null, bolig: null, bruger: null }

const saaFremmed = async () => {
  const [k] = await skriv(() => sql`insert into sources (slug, name, source_type)
    values (${FREMMED.slug}, 'En ANDEN kørsels kilde', 'spider') returning id`)
  FREMMED.kilde = k.id
  const [l] = await skriv(() => sql`
    insert into listings (source_id, source_type, external_key, source_url, status,
      address_raw, street, house_number, postal_code, city,
      property_type, size_m2, rooms, rent_monthly, total_monthly,
      total_monthly_components, address_match_level, unit_address_uuid)
    values (${k.id}, 'spider', ${`${FREMMED.slug}-staar-fast`},
      ${`https://eksempel.invalid/${FREMMED.slug}`}, 'active',
      ${`Fremmedvej 99, ${POSTNR} Kontrolby`}, 'Fremmedvej', '99', ${POSTNR}, 'Kontrolby',
      'lejlighed', 80, 3, 1000000, 1100000, ${['rent', 'heat']},
      'unit', ${`intern:v3:minside:${FREMMED.slug}`})
    returning id`)
  FREMMED.bolig = l.id
  await skriv(() => sql`insert into auth.users (id, email)
    values (${FREMMED.auth}, ${FREMMED.mail})`)
  const [u] = await skriv(() => sql`insert into users (email, role, auth_user_id)
    values (${FREMMED.mail}, 'tenant', ${FREMMED.auth}) returning id`)
  FREMMED.bruger = u.id
  await skriv(() => sql`insert into favorites (user_id, listing_id) values (${u.id}, ${l.id})`)
  await skriv(() => sql`insert into saved_searches (user_id, name, criteria, confirmed_at)
    values (${u.id}, 'En anden kørsels søgning', ${sql.json({ by: 'Kontrolby' })}, now())`)
}

/**
 * Tæller stand-in'ens SYV kendsgerninger. 7 = alt står der, 0 = alt væk.
 *
 * `auth.users` og bindingen står med, og det er ikke pynt:
 * `users_auth_user_id_fkey` er `on delete set null` (0013). Ryddede
 * nogen bredt i `auth.users`, ville den anden kørsels `users`-række
 * BLIVE stående og bare miste sin login-binding — lydløst. En optælling
 * uden de to led ville melde «alt står der» om en konto, der ikke
 * længere kan logge ind.
 */
const FREMMEDE_FAKTA = 7
const fremmedeRaekker = async () => {
  const [r] = await sql`select
    (select count(*)::int from sources where id = ${FREMMED.kilde})
    + (select count(*)::int from listings where id = ${FREMMED.bolig})
    + (select count(*)::int from users where id = ${FREMMED.bruger})
    + (select count(*)::int from favorites where user_id = ${FREMMED.bruger})
    + (select count(*)::int from saved_searches where user_id = ${FREMMED.bruger})
    + (select count(*)::int from auth.users where id = ${FREMMED.auth})
    + (select count(*)::int from users
        where id = ${FREMMED.bruger} and auth_user_id = ${FREMMED.auth}) as n`
  return Number(r.n)
}

const rydFremmed = async () => {
  noterSkrivning()
  if (FREMMED.bruger) {
    await sql`delete from saved_searches where user_id = ${FREMMED.bruger}`
    await sql`delete from favorites where user_id = ${FREMMED.bruger}`
  }
  if (FREMMED.bolig) {
    await sql`delete from listing_images where listing_id = ${FREMMED.bolig}`
    await sql`delete from listings where id = ${FREMMED.bolig}`
  }
  if (FREMMED.kilde) await sql`delete from sources where id = ${FREMMED.kilde}`
  if (FREMMED.bruger) await sql`delete from users where id = ${FREMMED.bruger}`
  await sql`delete from auth.users where id = ${FREMMED.auth}`
}

let ider = {}

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

/**
 * ÉN oprydning, som alle veje venter på.
 *
 * Ikke «første kalder rydder, resten går videre»: den form kostede en
 * måling i `tastaturkontrol.mjs`, hvor det andet kalds `process.exit()`
 * nåede at slukke, før det førstes oprydning var færdig. Her holdes
 * arbejdet i én promise, så den anden kalder venter på den samme.
 *
 * Fejl LOGGES. En oprydning, der siger den ryddede op og ikke gjorde
 * det, er samme fejlklasse som en knap, der ikke virker.
 */
let rydning = null
const rydAlt = () => (rydning ??= (async () => {
  await ryd().catch((e) => console.log(`  ⚠ oprydningen fejlede: ${e.message}`))
  await rydFremmed().catch((e) => console.log(`  ⚠ stand-in'en blev ikke ryddet: ${e.message}`))
})())

// Et Ctrl-C er også en afbrydelse, og prøven har skrevet i basen. Uden
// de her to overlevede kørslens rækker et afbrudt forløb, og det næste
// menneske, der kiggede i 9904, fandt boliger, ingen kunne gøre rede for.
//
// RÆKKEFØLGEN ER IKKE LIGEGYLDIG: signalet standser ikke `try`-blokken.
// Flaget sættes først, så hovedstrømmen kaster ved sin næste skrivning;
// derefter ventes der på, at der ikke er flere skrivninger i luften; og
// FØRST DA vælger oprydningen sine rækker. Ryddede den med det samme,
// ville såningen nå at indsætte boliger efter, at `ryd()` havde valgt
// sine — og `delete from sources` ville fejle på fremmednøglen og
// efterlade både kilden og de nye boliger.
for (const [signal, kode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, async () => {
    if (afbrudt) return          // det andet Ctrl-C venter på det første
    afbrudt = signal
    console.log(`\n  AFBRUDT (${signal}) — stopper og rydder op efter det, kørslen selv oprettede`)
    luk()
    if (!await roligt()) console.log('  ⚠ der blev stadig skrevet — rydder op alligevel')
    await rydAlt()
    await sql.end().catch(() => {})
    process.exit(kode)
  })
}

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
  // ═══ 0 · Spærringerne og oprydningen ═══════════════════════════
  //
  // De her linjer måler prøvens EGNE værn. De står først, fordi et værn,
  // ingen har set fejle, ikke er et værn.
  console.log('\n══ 0 · spærringerne ══')

  tjek('0A · den faktiske forbindelse er efterprøvet, ikke kun URL\'en',
    erIsoleret(IDENT.d, IDENT.a, IDENT.p),
    `${IDENT.d} på ${IDENT.a}:${IDENT.p} som ${IDENT.u}`)

  // KERNEN: en RIGTIG forkert base. `postgres` ligger på den samme
  // klynge, på den samme port, på den samme loopback-adresse — og
  // rollen kan forbinde til den. Alt er altså rigtigt undtagen navnet,
  // og det er præcis den slags nærtræffer, en URL-kontrol ikke ser.
  {
    const u = new URL(DBURL)
    const forkert = postgres(
      `${u.protocol}//${u.username}:${u.password}@${u.hostname}:${u.port}/postgres?sslmode=disable`,
      { ssl: false, max: 1, onnotice: () => {}, connect_timeout: 8 })
    try {
      const id = await hvemErBasen(forkert)
      tjek('0B · en RIGTIG forkert base kunne nås (ellers måler 0C intet)',
        id.d === 'postgres', `${id.d} på ${id.a}:${id.p}`)
      tjek('0C · og vagten afviser den', !erIsoleret(id.d, id.a, id.p),
        `${id.d} på ${id.a}:${id.p}`)
    } finally { await forkert.end().catch(() => {}) }
  }

  // De led, der ikke kan prøves med en rigtig forbindelse: der findes
  // ingen fremmed VÆRT at forbinde til herfra. Simulerede værdier mod
  // prædikatet — samme greb som `rooms-adressevagt.ts`.
  tjek('0D · det FAKTISKE format 127.0.0.1/32 godkendes',
    erIsoleret('bofinda_test', '127.0.0.1/32', 55432))
  // IPv6-loopback. Unix-socket prøves IKKE: over en socket giver BÅDE
  // `inet_server_addr()` OG `inet_server_port()` null, så den tuple kan
  // basen ikke producere, og prøven ville påstå noget, den ikke måler.
  // 'loopback' bliver stående i `LOKALE_ADRESSER`, fordi de to søsterfiler
  // har den — men den er dækning, ikke en nået sti her: URL'en er TCP.
  tjek('0D · ::1/128 godkendes', erIsoleret('bofinda_test', '::1/128', 55432))
  tjek('0E · FREMMED vært afvises trods korrekt navn OG port',
    !erIsoleret('bofinda_test', '10.0.0.5/32', 55432), '10.0.0.5/32')
  tjek('0E · offentlig adresse afvises',
    !erIsoleret('bofinda_test', '203.0.113.9/32', 55432))
  tjek('0F · forkert port afvises', !erIsoleret('bofinda_test', '127.0.0.1/32', 5432))
  tjek('0G · forkert databasenavn afvises', !erIsoleret('postgres', '127.0.0.1/32', 55432))
  // En nærtræffer må ikke slippe igennem på præfiksstripningen.
  tjek('0H · 127.0.0.10 afvises — den er ikke loopback',
    !erIsoleret('bofinda_test', '127.0.0.10/32', 55432))

  // ── Rækkefølgen ────────────────────────────────────────────
  // Vagten skal fyre FØR første skrivning. Det er ikke en påstand her;
  // de to trin tælles, og flytter nogen vagten ned under såningen,
  // bliver linjen rød.
  await saaFremmed()
  tjek('0I · vagten kørte FØR første skrivning',
    vagtTrin != null && skrivTrin != null && vagtTrin < skrivTrin,
    `vagt=${vagtTrin} første skrivning=${skrivTrin}`)

  // ── Oprydningen rammer kun kørslens egne rækker ────────────
  console.log('\n══ 0 · oprydningen ══')
  tjek('0J · stand-in\'en ligner en anden kørsel af DENNE prøve',
    FREMMED.slug.startsWith('minside-kontrol-')
    && FREMMED.mail.startsWith('minside-kontrol-'),
    `${FREMMED.slug} · ${FREMMED.mail}`)
  tjek(`0K · og den står i basen med alle ${FREMMEDE_FAKTA} kendsgerninger`,
    await fremmedeRaekker() === FREMMEDE_FAKTA,
    `${await fremmedeRaekker()} af ${FREMMEDE_FAKTA}`)

  ider = await saa()
  tjek('0L · kørslens eget grundlag står der', await voresRaekker() > 0,
    `${await voresRaekker()} rækker`)

  await ryd()
  tjek('0M · ryd() fjerner ALT kørslens eget', await voresRaekker() === 0,
    `${await voresRaekker()} tilbage`)
  const overlevede = await fremmedeRaekker()
  tjek('0N · og lader den anden kørsels rækker stå', overlevede === FREMMEDE_FAKTA,
    overlevede === FREMMEDE_FAKTA ? `${FREMMEDE_FAKTA} af ${FREMMEDE_FAKTA}`
      : `KUN ${overlevede} AF ${FREMMEDE_FAKTA} TILBAGE`)

  // Og så det rigtige grundlag til resten af prøven.
  ider = await saa()

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

  const nyKontekst = async (bredde, hoejde, ekstra = {}) => {
    // `ekstra` er til touchkonteksten i 3E: `hasTouch` giver browseren
    // en berøringsskærm, og `isMobile` giver den visuelle viewport, som
    // knib-zoom overhovedet kan måles på.
    const c = await browser.newContext({ viewport: { width: bredde, height: hoejde }, ...ekstra })
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
  // Rækken er skabt af `bindKonto`, ikke af prøven. Den skal i sporet
  // med det samme, ellers har oprydningen kun mailen at gå efter.
  spor.brugere.push(bruger.id)

  for (const r of RAEKKER) {
    await skriv(() => sql`insert into favorites (user_id, listing_id)
      values (${bruger.id}, ${ider[r.n]})`)
  }
  // «Forsvundet» prøves IKKE her. Tilstanden kan kun opstå, hvis nogen
  // sletter en bolig direkte i basen — fremmednøglen er `on delete
  // cascade` — og prøven fremstillede den før ved at droppe og sætte
  // nøglen tilbage. Det er en ændring af det FÆLLES skema for at måle
  // én visning, og brækkede kørslen imellem de to, stod basen uden
  // fremmednøgle til den næste. Dækningen ligger i afsnit 10H i
  // `scripts/test-brugeromraade.ts`, hvor kortet gengives isoleret med
  // status 'forsvundet' — samme spørgsmål, ingen fælles skade.
  // Afmeldte boliger prøves stadig her, i afsnit 5.

  // Gemte søgninger i alle tre tilstande. De betyder ikke det samme —
  // en ubekræftet varsler INTET, og en afmeldt heller ikke — og siden
  // skal kunne skelne dem. Uden dem står afsnittet tomt, og så er
  // «læses som en helhed» ikke prøvet på noget.
  await skriv(() => sql`insert into saved_searches (user_id, name, criteria, confirmed_at)
    values (${bruger.id}, '3 vær. i Kontrolby',
      ${sql.json({ by: 'Kontrolby', vaerelserMin: 3 })}, now())`)
  await skriv(() => sql`insert into saved_searches (user_id, name, criteria)
    values (${bruger.id}, 'Billige boliger i 9904',
      ${sql.json({ postnr: POSTNR, prisMax: 1000000 })})`)
  await skriv(() => sql`insert into saved_searches
    (user_id, name, criteria, confirmed_at, unsubscribed_at)
    values (${bruger.id}, 'Rækkehuse', ${sql.json({ typer: ['raekkehus'] })}, now(), now())`)

  await p.reload({ waitUntil: 'networkidle' })
  await afvisBanner(p)
  const kort = p.locator('.gemte-kort > .gemt-kort')
  tjek('1C · alle gemte boliger står som kort',
    await kort.count() === RAEKKER.length, `${await kort.count()} kort`)
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
    tjek('3A · med tælleren på', (await medFoto.locator('.gemt-antal').innerText()).includes('1/3'),
      await medFoto.locator('.gemt-antal').innerText())

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

  // ═══ 3D · Billedbladring på et gemt kort ══════════════════════
  //
  // Gemte boliger bruger SAMME krog som søgekortene — `useBladring` i
  // app/Billedbladring.tsx. Feltet er et andet, og det er hele grunden
  // til, at det måles her også: pilene ligger inde i `.gemt-foto`, ikke
  // som søskende til et link, og de må ikke blive et ekstra tabstop
  // mellem adressen og Fjern.
  {
    const medFoto = kortFor('total')
    tjek('3D · kortet med tre billeder har to pile',
      await medFoto.locator('.bladrepil').count() === 2,
      `${await medFoto.locator('.bladrepil').count()}`)
    tjek('3D · og kortet med ét billede har ingen',
      await kortFor('afmeldt').locator('.bladrepil').count() === 0)
    const foer = p.url()
    await medFoto.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('3D · et pileklik skifter billede',
      (await medFoto.locator('.gemt-antal').innerText()).startsWith('2/'),
      await medFoto.locator('.gemt-antal').innerText())
    tjek('3D · og åbner IKKE boligen', p.url() === foer, p.url().replace(B, ''))
    tjek('3D · der er stadig præcis ét billede i feltet',
      await medFoto.locator('.gemt-foto img').count() === 1)
    // Og designet er urørt: feltet har stadig sit forhold.
    const f = await medFoto.locator('.gemt-foto').evaluate((x) => {
      const r = x.getBoundingClientRect()
      return { forhold: r.width / r.height, touch: getComputedStyle(x).touchAction }
    })
    tjek('3D · billedfeltet har stadig 16:9', Math.abs(f.forhold - 16 / 9) < 0.02,
      f.forhold.toFixed(3))
    tjek('3D · og den lodrette rulning og zoom er browserens',
      /pan-y/.test(f.touch) && /pinch-zoom/.test(f.touch), f.touch)
  }

  // ═══ 3E · Gemte boliger på 390 px — browserens EGEN touch ══════
  //
  // ═══ HVORFOR DET HER AFSNIT IKKE KUNNE SPRINGES OVER ═══
  //
  // Søgekortene og de gemte kort spørger den SAMME krog, men de tegner
  // hver sit felt: pilene ligger inde i `.gemt-foto` her og som søskende
  // til linket der, og fotolinket er et andet element end kortlinket.
  // `touch-action`, træfprøven og det syntetiske klik afgøres af det
  // felt, fingeren faktisk rammer — så en måling på søgesiden svarer
  // ikke for den her.
  //
  // Alt herunder går gennem browserens inputkø (CDP `Input.dispatch-
  // TouchEvent`), ikke gennem `dispatchEvent(new TouchEvent(…))`. Se
  // noten i scripts/cloud/touch.mjs for forskellen.
  {
    const { c: cm, p: m } = await nyKontekst(390, 844,
      { hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    await logInd(m)
    const mKort = (n) => m.locator(`.gemt-kort:has(a.adresse[href="/bolig/${ider[n]}"])`)
    const kort = mKort('total')
    const ts = await touchsession(m)

    tjek('3E · præmis: det gemte kort er der på 390 px',
      await kort.count() === 1)
    await kort.scrollIntoViewIfNeeded()
    await vent(600)
    tjek('3E · præmis: og det lover tre billeder',
      (await kort.locator('.gemt-antal').innerText()).startsWith('1/3'),
      await kort.locator('.gemt-antal').innerText())
    tjek('3E · ingen vandret rulning på 390 px',
      await m.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))

    const boks = await kort.locator('.gemt-foto').boundingBox()
    const y = boks.y + boks.height / 2
    const urlFoer = m.url()
    const gemteFoer = await m.locator('.gemt-kort').count()

    // 1 · Vandret svirp skifter billede — mellem pilene, som en tommel
    //     også ville ramme ved siden af.
    const t0 = await kort.locator('.gemt-antal').innerText()
    await svirp(ts, { x: boks.x + boks.width * 0.78, y }, { x: boks.x + boks.width * 0.22, y })
    await vent(1800)
    tjek('3E · vandret swipe (rigtigt touch) skifter billede',
      (await kort.locator('.gemt-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.gemt-antal').innerText()}`)
    tjek('3E · og åbner IKKE boligen', m.url() === urlFoer, m.url().replace(B, ''))
    tjek('3E · og fjerner ikke boligen fra Gemte boliger',
      await m.locator('.gemt-kort').count() === gemteFoer,
      `${gemteFoer} → ${await m.locator('.gemt-kort').count()}`)

    // 2 · Lodret fingerbevægelse over billedet ruller siden og skifter
    //     ikke billede. Retningslåsen OG `touch-action: pan-y` prøves
    //     her; en syntetisk hændelse ruller ingenting og kan derfor
    //     hverken bekræfte eller afkræfte det.
    const t1 = await kort.locator('.gemt-antal').innerText()
    const y0 = await m.evaluate(() => window.scrollY)
    tjek('3E · præmis: siden KAN rulles',
      await m.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 100))
    await svirp(ts, { x: boks.x + boks.width / 2, y: y + 60 }, { x: boks.x + boks.width / 2, y: y - 120 })
    await vent(900)
    const y1 = await m.evaluate(() => window.scrollY)
    tjek('3E · lodret fingerbevægelse RULLER siden', y1 > y0, `${y0} → ${y1}`)
    tjek('3E · og skifter ikke billede',
      (await kort.locator('.gemt-antal').innerText()) === t1,
      `${t1} → ${await kort.locator('.gemt-antal').innerText()}`)

    // 3 · Knib-zoom er bevaret. Erklæringen er `pinch-zoom` i
    //     `touch-action`; det her er målingen af, at browseren gør det.
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const kb = await kort.locator('.gemt-foto').boundingBox()
    const knibMidt = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    const zoomFoer = await zoom(m)
    await knib(ts, knibMidt)
    await vent(800)
    const zoomEfter = await zoom(m)
    tjek('3E · knib-zoom er bevaret', zoomEfter > zoomFoer * 1.3,
      `${zoomFoer.toFixed(2)} → ${zoomEfter.toFixed(2)}`)
    await nulstilZoom(ts, knibMidt)

    // 4 · Et almindeligt tryk åbner boligen. Målet læses af fotolinkets
    //     eget `href` — prøven gætter ikke.
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const maal = await kort.locator('a.gemt-fotolink').getAttribute('href')
    const tb = await kort.locator('.gemt-foto').boundingBox()
    await tryk(ts, tb.x + tb.width * 0.5, tb.y + tb.height * 0.75)
    await m.waitForLoadState('networkidle').catch(() => {})
    await vent(1200)
    tjek('3E · et almindeligt tryk åbner det rigtige mål',
      m.url().endsWith(maal), `${m.url().replace(B, '')} · ventet ${maal}`)

    // 5 · Den fastlåste fejltilstand — på DEN HER flade.
    //     Kortet hentes forfra, så tilstanden er urørt, og det første
    //     kald afvises i browseren. Appen og basen er ikke rørt.
    let kald = 0
    await m.route('**/api/boligbilleder*', (rute) => {
      kald++
      return kald === 1 ? rute.fulfill({ status: 503, body: 'nej' }) : rute.continue()
    })
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const t2 = await kort.locator('.gemt-antal').innerText()
    await kort.locator('.bladrepil-naeste').click()
    await vent(1500)
    tjek('3E · en fejlet hentning siger det — også på et gemt kort',
      await kort.locator('.bladrefejl').count() === 1)
    tjek('3E · med en udtrykkelig vej til at prøve igen',
      await kort.locator('.bladreigen').count() === 1)
    tjek('3E · og der prøves IKKE igen af sig selv', kald === 1, `${kald} kald`)
    await vent(1500)
    tjek('3E · heller ikke efter halvanden sekund', kald === 1, `${kald} kald`)
    // FOKUS FØRST, OG MÅL FØR KLIKKET.
    // Playwrights `click()` giver knappen fokus, FØR klikhændelsen —
    // og på Gemte boliger bobler `focusin` op i billedfladen. Uden den
    // her linje kunne prøven ikke skelne: før rettelsen var det
    // fokusset, der sendte genforsøget af sted, og kaldtælleren blev 2
    // uanset om klikket gjorde noget. «Det brugerinitierede forsøg
    // lykkes» var altså grønt på et forkert grundlag.
    await kort.locator('.bladreigen').focus()
    await vent(500)
    tjek('3E · fokus ALENE prøver ikke igen', kald === 1, `${kald} kald`)
    await kort.locator('.bladreigen').click()
    await vent(1600)
    tjek('3E · det brugerinitierede forsøg lykkes — og det var KLIKKET',
      kald === 2, `${kald} kald`)
    tjek('3E · beskeden forsvinder igen',
      await kort.locator('.bladrefejl').count() === 0)
    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('3E · og derefter kan kortet bladre',
      (await kort.locator('.gemt-antal').innerText()) !== t2,
      `${t2} → ${await kort.locator('.gemt-antal').innerText()}`)
    tjek('3E · uden at åbne boligen', m.url().endsWith('/min-side'),
      m.url().replace(B, ''))
    tjek('3E · og uden at fjerne den fra Gemte boliger',
      await m.locator('.gemt-kort').count() === gemteFoer,
      `${gemteFoer} → ${await m.locator('.gemt-kort').count()}`)

    // 6 · Ruten svarer «der er ikke mere». SQL-tallet på kortet kan være
    //     forældet; så skal pilene og tælleren holde op med at love mere
    //     i stedet for at blive stående. Det er ikke en fejlbesked —
    //     ruten svarede jo.
    await m.unroute('**/api/boligbilleder*')
    await m.route('**/api/boligbilleder*', (rute) =>
      rute.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ billeder: [{ lille: '/api/billede?x', stor: null }] }) }))
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    tjek('3E · præmis: kortet lovede flere, før ruten svarede',
      (await kort.locator('.gemt-antal').innerText()).startsWith('1/3'),
      await kort.locator('.gemt-antal').innerText())
    await kort.locator('.bladrepil-naeste').click()
    await vent(1500)
    tjek('3E · pilene forsvinder fra det gemte kort',
      await kort.locator('.bladrepil').count() === 0,
      `${await kort.locator('.bladrepil').count()} pile`)
    tjek('3E · og tælleren lover ikke længere flere',
      await kort.locator('.gemt-antal').count() === 0)
    tjek('3E · det er IKKE en fejlbesked — ruten svarede jo',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('3E · og forsiden står der endnu',
      await kort.locator('.gemt-foto img').count() === 1)
    // Klikket gav pilen fokus, og et øjeblik efter fandtes pilen ikke
    // længere. Der er ingen fejl i forløbet — ruten svarede pænt — og
    // derfor kan fejlbeskedens knap ikke være det eneste, fokusvagten
    // spørger efter.
    const f3e = await fokusinfo(m)
    tjek('3E · fokus faldt ikke til <body>, da pilen forsvandt under den',
      f3e.klasse !== '(body)', f3e.klasse)
    tjek('3E · den gik til adressen — kortets egen indgang',
      f3e.klasse === 'adresse' && f3e.kort === `/bolig/${ider.total}`,
      `${f3e.klasse} · ${f3e.kort}`)
    if (SKAERMMAPPE) await m.screenshot({ path: `${SKAERMMAPPE}/minside-390-bladring.png` })
    await cm.close()
  }

  // ═══ 3F · Fokus- og genforsøgsforløbet på Gemte boliger ════════
  //
  // ═══ DÉT ER HER, VAGTEN ER DET ENESTE VÆRN ═══
  //
  // På søgekortet ligger pilene UDEN FOR linket, og billedfladen har
  // ingen fokuserbare børn — `focusin` når aldrig derind. Her er det
  // omvendt: `Bladrepile` ligger INDE i `.gemt-foto`, som bærer
  // `flade.onFocus`, og `focusin` bobler. Et tabstop hen til «Prøv
  // igen» ramte derfor `hent()`, før brugeren havde aktiveret noget —
  // og et fingertryk på billedet gjorde det samme.
  //
  // Svaret er FORSINKET med vilje. Uden ventetiden findes der intet
  // øjeblik at aflæse fokus i, mens hentningen er undervejs, og prøven
  // ville kun kunne måle et resultat.
  {
    const { c: cf, p: m } = await nyKontekst(390, 844,
      { hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    await logInd(m)
    const kort = m.locator(`.gemt-kort:has(a.adresse[href="/bolig/${ider.total}"])`)
    let r = await scriptetRute(m, ['fejl', 'ok'])
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    const gemteFoer = await m.locator('.gemt-kort').count()

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('3F · præmis: hentningen fejlede, og beskeden står',
      await kort.locator('.bladrefejl').count() === 1
      && await kort.locator('.bladreigen').count() === 1)
    tjek('3F · præmis: ét kald er brugt', r.kald === 1, `${r.kald} kald`)

    // ── TAB IND I BLADRINGEN MÅ IKKE PRØVE IGEN ────────────────
    // Der tabbes BAGLÆNS fra adressen, så alle tre stop inde i fladen
    // rammes: næste-pilen, forrige-pilen og «Prøv igen». Alle tre bobler
    // `focusin` op i `.gemt-foto`.
    await kort.locator('a.adresse').focus()
    const stop = []
    for (let i = 0; i < 3; i++) {
      await m.keyboard.press('Shift+Tab')
      await vent(250)
      stop.push((await fokusinfo(m)).klasse)
    }
    tjek('3F · Shift+Tab går gennem begge pile og «Prøv igen»',
      stop.join(' → ') === 'bladrepil bladrepil-naeste → bladrepil bladrepil-foer → bladreigen',
      stop.join(' → '))
    tjek('3F · og INGEN af de tre tabstop har prøvet igen', r.kald === 1, `${r.kald} kald`)

    // ── EN ALMINDELIG BERØRING PÅ BILLEDET HELLER IKKE ─────────
    // Bevægelsen er lodret: den ruller siden i stedet for at blive et
    // svirp. Et svirp ER en bladringshandling og må gerne prøve igen.
    const ts = await touchsession(m)
    const boks = await kort.locator('.gemt-foto').boundingBox()
    const my = boks.y + boks.height / 2
    await svirp(ts, { x: boks.x + boks.width / 2, y: my + 50 },
      { x: boks.x + boks.width / 2, y: my - 90 })
    await vent(900)
    tjek('3F · en lodret fingerbevægelse over billedet prøver ikke igen',
      r.kald === 1, `${r.kald} kald`)
    tjek('3F · og beskeden står der endnu',
      await kort.locator('.bladrefejl').count() === 1)

    // ── ENTER ER DET, DER PRØVER IGEN ──────────────────────────
    await m.evaluate(() => window.scrollTo(0, 0))
    await kort.scrollIntoViewIfNeeded()
    await vent(400)
    await kort.locator('.bladreigen').focus()
    tjek('3F · præmis: fokus står på «Prøv igen»',
      (await fokusinfo(m)).klasse === 'bladreigen', (await fokusinfo(m)).klasse)
    await m.keyboard.press('Enter')
    await vent(350)
    tjek('3F · Enter starter genforsøget', r.kald === 2, `${r.kald} kald`)

    const under = await fokusinfo(m)
    tjek('3F · knappen står der stadig, mens der hentes',
      await kort.locator('.bladreigen').count() === 1)
    tjek('3F · og den har stadig fokus — på DET kort',
      under.klasse === 'bladreigen' && under.kort === `/bolig/${ider.total}`,
      `${under.klasse} · ${under.kort}`)
    tjek('3F · og den siger, at den er i gang', under.busy === 'true', String(under.busy))

    await vent(2200)
    tjek('3F · beskeden forsvinder, når hentningen lykkes',
      await kort.locator('.bladrefejl').count() === 0)
    const efter = await fokusinfo(m)
    tjek('3F · og fokus er ført til næste-pilen på samme kort',
      efter.klasse === 'bladrepil bladrepil-naeste' && efter.kort === `/bolig/${ider.total}`,
      `${efter.klasse} · ${efter.kort}`)
    tjek('3F · fokus faldt altså ALDRIG til <body>', efter.klasse !== '(body)', efter.klasse)
    const t0 = await kort.locator('.gemt-antal').innerText()
    await m.keyboard.press('Enter')
    await vent(900)
    tjek('3F · og et tryk mere bladrer',
      (await kort.locator('.gemt-antal').innerText()) !== t0,
      `${t0} → ${await kort.locator('.gemt-antal').innerText()}`)
    tjek('3F · boligen blev aldrig åbnet', m.url().endsWith('/min-side'), m.url().replace(B, ''))
    tjek('3F · og ingen bolig faldt ud af Gemte boliger',
      await m.locator('.gemt-kort').count() === gemteFoer,
      `${gemteFoer} → ${await m.locator('.gemt-kort').count()}`)

    // ═══ 3G · Endnu en fejl, Mellemrum, og intet fokustyveri ════
    await m.unroute('**/api/boligbilleder*')
    r = await scriptetRute(m, ['fejl', 'fejl', 'ok'])
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)

    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('3G · præmis: første hentning fejlede', r.kald === 1
      && await kort.locator('.bladreigen').count() === 1, `${r.kald} kald`)

    await kort.locator('.bladreigen').focus()
    await m.keyboard.press('Space')
    await vent(350)
    tjek('3G · Mellemrum prøver også igen', r.kald === 2, `${r.kald} kald`)
    // Dobbeltkaldsvagten er den samme `igang`-ref som før rettelsen.
    await m.keyboard.press('Space')
    await m.keyboard.press('Enter')
    await vent(400)
    tjek('3G · to tryk mere under hentningen bliver ikke til flere kald',
      r.kald === 2, `${r.kald} kald`)

    await vent(2200)
    tjek('3G · forsøget fejlede igen, og beskeden står stadig',
      await kort.locator('.bladrefejl').count() === 1)
    const andenFejl = await fokusinfo(m)
    tjek('3G · fokus er stadig på knappen — hun blev ikke smidt ud',
      andenFejl.klasse === 'bladreigen' && andenFejl.kort === `/bolig/${ider.total}`,
      `${andenFejl.klasse} · ${andenFejl.kort}`)
    tjek('3G · og knappen er ikke længere «i gang»',
      andenFejl.busy !== 'true', String(andenFejl.busy))

    // Hun går selv videre, mens tredje forsøg er undervejs. Fokus må
    // ikke springe tilbage, fordi et svar tilfældigvis lander: det sted,
    // hun selv har valgt, er hendes.
    await m.keyboard.press('Enter')
    await vent(300)
    tjek('3G · tredje forsøg går af sted', r.kald === 3, `${r.kald} kald`)
    // FORBI pilene, helt ud til adressen. Stoppede hun på næste-pilen,
    // ville hun stå præcis dér, hvor en fokustyveri-fejl ville flytte
    // hende hen — og så kunne prøven ikke længere fejle, uanset hvad
    // koden gjorde. Målet skal være et element, kodens fokusflytning
    // aldrig kunne vælge her.
    await m.keyboard.press('Tab')
    await m.keyboard.press('Tab')
    await m.keyboard.press('Tab')
    await vent(200)
    const valgt = await fokusinfo(m)
    tjek('3G · præmis: hun står nu et sted, koden aldrig ville vælge',
      valgt.klasse === 'adresse', valgt.klasse)
    await vent(2400)
    const tilSidst = await fokusinfo(m)
    tjek('3G · svaret landede, og fokus blev IKKE flyttet fra hende',
      tilSidst.klasse === valgt.klasse && tilSidst.kort === valgt.kort,
      `${valgt.klasse} → ${tilSidst.klasse}`)
    tjek('3G · beskeden er væk, for hentningen lykkedes',
      await kort.locator('.bladrefejl').count() === 0)

    // ═══ 3H · Når hele feltet forsvinder ved et lykket genforsøg ═
    // Ruten svarer, at der kun er ét billede: pile OG tæller går med
    // beskeden. Næste-pilen — det normale mål — findes ikke længere, og
    // fokus skal til noget, der bliver stående. På et gemt kort er det
    // adressen; fotolinket er `aria-hidden` og må aldrig blive målet.
    await m.unroute('**/api/boligbilleder*')
    r = await scriptetRute(m, ['fejl', 'tom'])
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    tjek('3H · præmis: første hentning fejlede', r.kald === 1
      && await kort.locator('.bladreigen').count() === 1, `${r.kald} kald`)
    await kort.locator('.bladreigen').focus()
    await m.keyboard.press('Enter')
    await vent(2400)
    tjek('3H · hele bladringen forsvandt — ruten sagde jo, der ikke er mere',
      await kort.locator('.bladrepil').count() === 0
      && await kort.locator('.gemt-antal').count() === 0
      && await kort.locator('.bladrefejl').count() === 0)
    const tilAdressen = await fokusinfo(m)
    tjek('3H · og fokus faldt ikke til <body>',
      tilAdressen.klasse !== '(body)', tilAdressen.klasse)
    tjek('3H · den gik til adressen — kortets egen indgang',
      tilAdressen.klasse === 'adresse' && tilAdressen.kort === `/bolig/${ider.total}`,
      `${tilAdressen.klasse} · ${tilAdressen.kort}`)
    tjek('3H · boligen blev ikke åbnet', m.url().endsWith('/min-side'), m.url().replace(B, ''))

    // ═══ 3I · Den ANDEN vej tilbage: en bladringshandling ═══════
    // Krav 1 nævner to veje ud af fejltilstanden — «Prøv igen» ELLER en
    // bladringshandling. Alt ovenfor bruger knappen. Her bruges et
    // vandret svirp, så begge veje er målt og ikke kun den ene.
    await m.unroute('**/api/boligbilleder*')
    r = await scriptetRute(m, ['fejl', 'ok'])
    await m.goto(`${B}/min-side`, { waitUntil: 'networkidle' })
    await afvisBanner(m)
    await vent(800)
    await kort.scrollIntoViewIfNeeded()
    await vent(500)
    await kort.locator('.bladrepil-naeste').click()
    await vent(1400)
    const t3i = await kort.locator('.gemt-antal').innerText()
    tjek('3I · præmis: hentningen fejlede, og beskeden står', r.kald === 1
      && await kort.locator('.bladrefejl').count() === 1, `${r.kald} kald`)
    const b3i = await kort.locator('.gemt-foto').boundingBox()
    const y3i = b3i.y + b3i.height / 2
    await svirp(ts, { x: b3i.x + b3i.width * 0.78, y: y3i },
      { x: b3i.x + b3i.width * 0.22, y: y3i })
    await vent(2600)
    tjek('3I · et vandret svirp prøver igen — uden at «Prøv igen» blev rørt',
      r.kald === 2, `${r.kald} kald`)
    tjek('3I · og beskeden forsvandt, fordi det lykkedes',
      await kort.locator('.bladrefejl').count() === 0)
    tjek('3I · og kortet bladrede',
      (await kort.locator('.gemt-antal').innerText()) !== t3i,
      `${t3i} → ${await kort.locator('.gemt-antal').innerText()}`)
    tjek('3I · boligen blev ikke åbnet', m.url().endsWith('/min-side'), m.url().replace(B, ''))
    await cf.close()
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
      kl.includes('Spørg udlejeren om varme og vand'))
    tjek('4B · og prisen er ikke den grønne',
      await kortFor('kunleje').locator('.gemt-pris.kun-leje').count() === 1)

    const u = await tekst('uoplyst')
    tjek('4C · uden pris står der ord, ikke et tomt tal',
      u.includes('Prisen er ikke oplyst') && !u.includes('kr/md'), u.slice(0, 90))
    tjek('4C · ukendt boligtype, værelser og areal udelades',
      !u.includes('vær.') && !u.includes('m²') && !u.includes('—'), u.slice(0, 90))

    // El: de fire tilstande, som de rammer et gemt kort.
    const klump = await tekst('klump')
    tjek('4D · samlet aconto: «ét samlet acontobeløb», ikke «indgår ikke»',
      klump.includes('ét samlet acontobeløb') && !klump.includes('el kommer oveni'), klump.slice(0, 120))
    tjek('4D · udspecificeret uden el: «el kommer oveni»',
      t.includes('el kommer oveni'))
    tjek('4D · el oplyst: ingen el-linje',
      !(await tekst('fejler')).includes('el kommer oveni'))

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
    // Udledt af grundlaget, ikke et løst gulv: et gulv på fire tålte, at
    // ét af de fem grønne kort faldt lydløst ud af målingen.
    const ventedeGroenne = RAEKKER.filter((r) => r.total != null).length
    tjek('4E · alle kort med kendt total er grønne',
      groenneKort.length === ventedeGroenne, `${groenneKort.length} af ${ventedeGroenne}`)
    // Af de fem grønne har KUN «Fejlvej 11» el som navngiven post.
    // Resten skal have linjen — ellers står et grønt tal uden at el er
    // gjort rede for, og det er fejlen fra de 171 gruppekort.
    const udenLinje = groenneKort.filter((x) => !x.el).map((x) => x.navn)
    tjek('4E · kun kortet med el som navngiven post står uden el-linjen',
      udenLinje.length === 1 && udenLinje[0] === 'Fejlvej 11',
      udenLinje.join(' | ') || 'ingen')
  }

  // ═══ 5 · Afmeldt ═══════════════════════════════════════════════
  // «Forsvundet» hører ikke til her — se noten ved såningen. Den er
  // dækket af afsnit 10H i scripts/test-brugeromraade.ts.
  console.log('\n══ 5 · afmeldt ══')
  {
    const a = kortFor('afmeldt')
    tjek('5A · afmeldt: kortet er mærket', await a.evaluate((x) => x.classList.contains('utilgaengelig')))
    tjek('5A · afmeldt: der står hvad der skete',
      (await a.innerText()).includes('Ikke længere tilgængelig'))
    tjek('5A · afmeldt: boligsiden kan stadig åbnes',
      await a.locator(`a.adresse[href="/bolig/${ider.afmeldt}"]`).count() === 1)
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

    // ── TASTATURTILSTAND FØRST ────────────────────────────────
    // `:focus-visible` er netop IKKE en ring efter et museklik — det er
    // hele pointen med den. Afsnit 3D klikker på en pil, og browseren
    // skifter derved til musetilstand; en programmatisk `.focus()`
    // bagefter giver da ingen ring, og 6A ville måle «0px» om en side,
    // hvor ringen virker fint for den, der bruger tastatur. Ét Tab
    // sætter tilstanden tilbage, og så måler linjen det, den siger.
    await p.keyboard.press('Tab')
    // Fra adressen på første kort: tab skal nå Fjern på samme kort.
    await kortFor('total').locator('a.adresse').focus()
    const paaAdresse = await synligRing()
    tjek('6A · adressen kan få fokus', paaAdresse?.klasse?.includes('adresse'), paaAdresse?.tekst)
    tjek('6A · og fokus kan SES', paaAdresse?.ring === true, paaAdresse?.bredde)

    await p.keyboard.press('Tab')
    const efter = await synligRing()
    tjek('6B · billedlinket er ikke et ekstra tabstop',
      !efter?.klasse?.includes('gemt-fotolink'), efter?.klasse ?? '(intet)')
    // Pilene ligger i `.gemt-foto`, altså FØR adressen i DOM-orden. Havde
    // de ligget efter, ville de skubbe sig ind mellem adressen og Fjern —
    // og så skulle en tastaturbruger forbi to billedknapper for at nå
    // handlingen på hvert eneste kort.
    tjek('6B · og pilene skubber sig ikke ind mellem adressen og Fjern',
      !efter?.klasse?.includes('bladrepil'), efter?.klasse ?? '(intet)')
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

  // ═══ 8 · Oprydningen, efter en hel kørsel ══════════════════════
  //
  // Afsnit 0 målte oprydningen på et grundlag, prøven lige havde sået.
  // Her måles den på et grundlag, der har været HELE vejen igennem:
  // login har skabt en `users`-række, browseren har fjernet en favorit,
  // og der er kommet gemte søgninger til. Det er dét grundlag, en
  // afbrudt kørsel ville efterlade.
  console.log('\n══ 8 · oprydningen efter kørslen ══')
  await ryd()
  tjek('8A · kørslens egne rækker er væk', await voresRaekker() === 0,
    `${await voresRaekker()} tilbage`)
  {
    const [r] = await sql`select count(*)::int n from favorites where user_id = ${bruger.id}`
    tjek('8B · også favoritterne og de gemte søgninger', Number(r.n) === 0, `${r.n} tilbage`)
  }
  const staar = await fremmedeRaekker()
  tjek('8C · og den anden kørsels rækker står der endnu', staar === FREMMEDE_FAKTA,
    staar === FREMMEDE_FAKTA ? `${FREMMEDE_FAKTA} af ${FREMMEDE_FAKTA}`
      : `KUN ${staar} AF ${FREMMEDE_FAKTA} TILBAGE`)
  await rydFremmed()
  tjek('8D · stand-in\'en er ryddet bagefter', await fremmedeRaekker() === 0)
} catch (e) {
  console.log(`\n  ✗ PRØVEN BRØD SAMMEN — ${e.message}`)
  fejl++
} finally {
  luk()
  // Oprydningen kører, uanset hvor kørslen brækkede — også midt i
  // såningen. `spor` bærer kun det, der faktisk nåede at blive skrevet,
  // og boligerne slettes desuden på kildens id, så der ikke er en luge
  // mellem indsættelsen og sporet. SAMME ene oprydning som
  // signalvejen — der er ikke to.
  await rydAlt()
  await sql.end()
}

console.log(fejl === 0
  ? `\n  ALT GRØNT — ${groenne} kontroller\n`
  : `\n  ${fejl} FEJLEDE af ${groenne + fejl} kontroller\n`)
process.exit(fejl ? 1 : 0)
