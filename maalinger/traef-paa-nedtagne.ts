// ═══════════════════════════════════════════════════════════════
//  MÅLING · Hvor mange træf venter på en bolig, vi selv har taget ned?
//
//  Spørgsmålet: hvor mange rækker i `alert_matches` står med
//  `sent_at = null` og en `listings`-række med `status <> 'active'` —
//  altså hvor mange mails, der ville varsle en bolig, der ikke findes
//  mere. Og hvor gamle er de træf?
//
//  ── HVORFOR SELECT'EN GENERERES OG IKKE SKRIVES ──────────────
//  Måler man med en håndskrevet kopi af appens where-klausul, måler man
//  kopien. `ventendeForespoergsel()` i lib/alarm.ts ER appens egen
//  forespørgsel; `.toSQL()` giver dens præcise SQL. Herunder klippes
//  dens `from … where`-hale ud, og min egen aggregatliste sættes foran.
//  Halen er altså GENERERET af produktionskoden — ændres betingelsen i
//  `ventende()`, ændres målingen med.
//
//  Klippet er bevogtet: findes delepunktet ikke præcis én gang,
//  afbrydes der. Et klip, der rammer et andet sted, ville give en
//  SELECT, der stadig kører og svarer på noget andet.
//
//  Drizzle sætter INGEN aliaser: select-listen har to bare `"id"` og to
//  `"name"`. Derfor kan appens SQL ikke pakkes i en CTE — kolonnerne
//  ville kollidere. Derfor klippes halen i stedet.
//
//      npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/testbase.ts maalinger/traef-paa-nedtagne.ts
//
//  Den SÅR sit eget forlæg og skal derfor køre under testbasen.
//  SELECT'en, den printer, er ren læsning med nul parametre og er den,
//  der skal i Supabases editor.
// ═══════════════════════════════════════════════════════════════

import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { ventendeForespoergsel } from '../lib/alarm'

// ── VAGT · den SÅR, og derfor må den ikke kunne ramme produktionen.
//    Kommandoen i hovedet er en kommando, nogen kopierer, og kører den
//    uden `scripts/testbase.ts` foran, peger `db` på det, `.env` siger.
//    Kravet er positivt om målet: der må IKKE være en base i processen,
//    for testbasen injiceres af `indsaetBase` og står ikke i miljøet.
//    Samme form som vagterne i scripts/proeve-storage og `krav_isoleret`.
for (const v of ['DATABASE_URL', 'DATABASE_URL_DIRECT'] as const) {
  if (process.env[v]) {
    process.stderr.write(`maaling: AFBRUDT — ${v} staar i miljoeet.\n`
      + '  Maalingen SAAR sit eget forlaeg og maa kun koere mod testbasen:\n'
      + '    npx tsx --tsconfig tsconfig.scripts.json \\\n'
      + '      scripts/testbase.ts maalinger/traef-paa-nedtagne.ts\n'
      + '  SELECT\'en, den printer, er ren laesning og koeres i Supabases editor.\n')
    process.exit(3)
  }
}

const DELEPUNKT = ' from "alert_matches"'
const ORDER = ' order by '

function haleFraAppen(): { uden: string; med: string } {
  const q = ventendeForespoergsel().toSQL()
  if (q.params.length !== 0) {
    throw new Error(`appens forespoergsel har ${q.params.length} bind-parametre — `
      + "SELECT'en kan da ikke pastes ren i editoren")
  }
  const dele = q.sql.split(DELEPUNKT)
  if (dele.length !== 2) {
    throw new Error(`delepunktet «${DELEPUNKT}» findes ${dele.length - 1} gange, ikke 1`)
  }
  const ob = (DELEPUNKT + dele[1]!).split(ORDER)
  if (ob.length !== 2) throw new Error(`«${ORDER}» findes ${ob.length - 1} gange, ikke 1`)
  const hale = ob[0]!
  if (!hale.includes('"alert_matches"."sent_at" is null')) {
    throw new Error('halen baerer ikke appens sent_at-led — har ventende() aendret form?')
  }
  return { uden: hale, med: `${hale} and "listings"."status" <> 'active'` }
}

const ALDER = 'extract(epoch from (now() - "alert_matches"."matched_at")) / 3600'

export function byg(): string {
  const { uden, med } = haleFraAppen()
  return `select
  count(*)::int                                                    as traef,
  count(distinct "saved_searches"."id")::int                       as soegninger,
  count(distinct "listings"."id")::int                             as boliger,
  count(*) filter (where "saved_searches"."notify_email"
                     and "saved_searches"."unsubscribed_at" is null)::int
                                                                   as kan_mailes,
  count(*) filter (where "listings"."delisted_at"
                       > "alert_matches"."matched_at")::int         as ned_efter_traef,
  max(round(${ALDER}))::int                                        as aeldste_timer,
  min(round(${ALDER}))::int                                        as nyeste_timer,
  round(percentile_cont(0.5) within group (order by ${ALDER}))::int as median_timer,
  -- Hele koeen uanset status, saa andelen kan ses. Underforespoergslen
  -- har ingen korreleret reference, saa de ens tabelnavne skygger uden
  -- virkning: count(*) binder til den INDERSTE from.
  (select count(*)::int ${uden})                                   as traef_i_alt
${med}`
}

// ── Forlægget. Facit står i maalinger/FACIT-forventet.md, skrevet først.
const FACIT = {
  traef: 3, soegninger: 2, boliger: 2, kan_mailes: 2,
  ned_efter_traef: 2, aeldste_timer: 30, nyeste_timer: 5,
  median_timer: 20, traef_i_alt: 4,
}

async function saa() {
  // PGlite tager ÉN saetning pr. execute. Derfor en saetning pr. kald.
  await db.execute(sql`insert into sources (id, slug, name, source_type) values
    ('11111111-0000-0000-0000-000000000001', 'maaling-nedtagne', 'Maalingskilde', 'spider')`)

  await db.execute(sql`insert into users (id, email) values
    ('22222222-0000-0000-0000-000000000001', 'maaling@proeve.invalid')`)

  await db.execute(sql`insert into saved_searches
    (id, user_id, name, criteria, notify_email, confirmed_at) values
    ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
     'S1 bekraeftet, mail til', '{}'::jsonb, true,  now()),
    ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001',
     'S2 bekraeftet, mail fra', '{}'::jsonb, false, now()),
    ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001',
     'S3 ubekraeftet',          '{}'::jsonb, true,  null)`)

  await db.execute(sql`insert into listings
    (id, source_id, source_type, external_key, source_url, address_raw, status, delisted_at) values
    ('44444444-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
     'spider', 'aktiv',     'https://proeve.invalid/1', 'Aktivvej 1, 2200',    'active',   null),
    ('44444444-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
     'spider', 'ned-efter', 'https://proeve.invalid/2', 'Nedeftervej 2, 2200', 'delisted', now() - interval '1 hour'),
    ('44444444-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
     'spider', 'ned-foer',  'https://proeve.invalid/3', 'Nedfoervej 3, 2200',  'delisted', now() - interval '9 hours'),
    ('44444444-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
     'spider', 'ned-sendt', 'https://proeve.invalid/4', 'Nedsendtvej 4, 2200', 'delisted', now() - interval '1 hour')`)

  // M1 aktiv, usendt, bekraeftet          → i koeen, men ikke nedtaget
  // M2 nedtaget EFTER traeffet, usendt    → fejlen, 30 t gammel
  // M3 nedtaget FOER traeffet, usendt     → ogsaa i maalingen, 5 t
  // M4 nedtaget, men ALLEREDE sendt       → ude
  // M5 nedtaget, usendt, men mail er fra  → i maalingen, ikke i kan_mailes
  // M6 nedtaget, usendt, UBEKRAEFTET      → ude
  await db.execute(sql`insert into alert_matches
    (saved_search_id, listing_id, matched_at, sent_at) values
    ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', now() - interval '10 hours', null),
    ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', now() - interval '30 hours', null),
    ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000003', now() - interval '5 hours',  null),
    ('33333333-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000004', now() - interval '50 hours', now()),
    ('33333333-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002', now() - interval '20 hours', null),
    ('33333333-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', now() - interval '40 hours', null)`)
}

const s = byg()
process.stdout.write(`\n${'═'.repeat(68)}\n  SELECT'EN — ren læsning, nul bind-parametre\n${'═'.repeat(68)}\n${s}\n\n`)

await saa()
// postgres-js giver et array; pglite giver { rows }. Begge former
// haandteres, saa maalingen kan koere mod begge drivere uden at skifte.
const svar = await db.execute(sql.raw(s)) as unknown
const raekker = (Array.isArray(svar) ? svar : (svar as { rows: unknown[] }).rows) as Record<string, number>[]
if (raekker.length !== 1) throw new Error(`forventede 1 raekke, fik ${raekker.length}`)
const r = raekker[0]!

process.stdout.write(`${'─'.repeat(68)}\n  MOD FORLÆGGET I PGLITE — målt mod facit skrevet FØRST\n${'─'.repeat(68)}\n`)
let fejl = 0
for (const [k, v] of Object.entries(FACIT)) {
  const faktisk = Number(r[k])
  const ok = faktisk === v
  if (!ok) fejl++
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${k.padEnd(16)} facit ${String(v).padStart(3)}   målt ${String(faktisk).padStart(3)}\n`)
}
const ukendte = Object.keys(r).filter((k) => !(k in FACIT))
if (ukendte.length) process.stdout.write(`  ⚠ kolonner uden facit: ${ukendte.join(', ')}\n`)
process.stdout.write(fejl === 0
  ? '\n  ALT GRØNT — SELECT\'en svarer som forudsagt\n'
  : `\n  ${fejl} AFVIGELSER — SELECT'en måler ikke det, facit beskriver\n`)
process.exitCode = fejl === 0 ? 0 : 1
