// ═══════════════════════════════════════════════════════════════
//  Alarmmailens tre usande udsagn.
//
//  Hver af dem var en sætning til en navngiven person, der landede
//  uopfordret i hendes indbakke:
//
//    1. et varsel om en bolig, kilden har taget ned
//    2. «kan være dyrere end din grænse» til en søgning uden grænse
//    3. «el indgår ikke» som fald-igennem for en ukendt tilstand
//
//  ── HVOR HVER TING PRØVES, OG HVORFOR DÉR ────────────────────
//  Teksterne prøves mod `byggBesked`, en ren funktion uden database og
//  netværk. FILTRET prøves mod den rigtige `sendAlarmer`: et løfte om
//  et andet lag kan ikke prøves i den rene fil — det er tiende række i
//  CLAUDE.md's fældetabel.
//
//  ⚠ HVAD DEN IKKE PRØVER. At `sent_at` sættes for de SENDBARE og ikke
//  for de nedtagne, er ikke udøvet. Det kræver en afsendelse, der
//  lykkes, og `sendMail` kan ikke lykkes her: `RESEND_API_KEY` er ikke
//  sat (npm test loader ikke .env), så den returnerer `sendt: false`
//  før sit fetch. En negativ påstand om de nedtagnes `sent_at` ville
//  derfor være grøn, fordi INTET blev sendt — grøn af den forkerte
//  grund. Den halvdel kræver en sender-søm; PR #19 indfører `_saetSender`
//  i lib/alarm.ts, og prøven hører dér, når den er landet.
// ═══════════════════════════════════════════════════════════════

import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { byggBesked, maaMailes, sendAlarmer, type BeskedBolig } from '../lib/alarm'
import { eltilstand } from '../lib/eloplysning'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}\n`)
  if (!ok) fejl++
}
const afsnit = (s: string) => process.stdout.write(`\n══ ${s} ══\n`)

const BOLIG: BeskedBolig = {
  adresse: 'Prøvevej 1, 2200 København N',
  areal: 60, vaerelser: 2, leje: 900000, total: null, indflytning: null,
  el: null, elEgenMaaler: null, poster: null,
  boligId: 'aaaaaaaa-0000-0000-0000-00000000000a', kilde: 'Prøvekilde',
}
const byg = (b: Partial<BeskedBolig>, kriterier: Record<string, unknown> = {}) =>
  byggBesked({ navn: 'min søgning', kriterier, boliger: [{ ...BOLIG, ...b }],
    afmeldUrl: 'https://proeve.invalid/afmeld/t' })

// ═══ 2 · PRISGRÆNSEN, HUN ALDRIG HAR SAT ═══════════════════════
afsnit('2 · forbeholdet om prisgrænsen')

const GRAENSE = /dyrere end din grænse/i
{
  const u = byg({ total: null }, {})
  tjek('uden prisMax: står ikke i ren tekst', !GRAENSE.test(u.tekst))
  tjek('uden prisMax: står ikke i HTML', !GRAENSE.test(u.html))
}
{
  const m = byg({ total: null }, { prisMax: 1_500_000 })
  tjek('MED prisMax: står i ren tekst', GRAENSE.test(m.tekst))
  tjek('MED prisMax: står i HTML', GRAENSE.test(m.html))
}
{
  // Kendt total: der er intet at tage forbehold for, uanset graensen.
  const k = byg({ total: 1_100_000 }, { prisMax: 1_500_000 })
  tjek('kendt total + prisMax: står ikke', !GRAENSE.test(k.tekst) && !GRAENSE.test(k.html))
}
{
  // Farven er et ANDET spoergsmaal end forbeholdet. Groen betyder kendt
  // total (CLAUDE.md), saa en ren husleje skal vaere sort — ogsaa naar
  // forbeholdet udebliver, fordi soegningen ingen prisgraense har. Da de
  // to delte navnet `uvis`, blev farven groen netop der.
  const GROEN = '#14624f'
  const uG = byg({ total: null }, {})
  tjek('kun husleje, ingen grænse: prisen er IKKE grøn', !uG.html.includes(GROEN))
  const mG = byg({ total: null }, { prisMax: 1_500_000 })
  tjek('kun husleje, med grænse: prisen er IKKE grøn', !mG.html.includes(GROEN))
  const kt = byg({ total: 1_100_000 }, {})
  tjek('kendt total: prisen ER grøn', kt.html.includes(GROEN))
}

// ═══ 3 · EL-TILSTANDEN, UDEN FALD-IGENNEM ══════════════════════
afsnit('3 · el-forbeholdet')

const EL_IKKE_MED = /el indgår ikke/i
{
  // Udspecificeret uden el → 'ikke-med' → den staerke paastand er SAND.
  const a = byg({ total: 1_100_000, poster: ['rent', 'heat', 'water'] })
  tjek("udspecificeret uden el → 'el indgår ikke'", EL_IKKE_MED.test(a.tekst))
}
{
  // Én samlet klump → 'ukendt-daekning' → maa IKKE sige 'indgaar ikke'.
  const b = byg({ total: 1_100_000, poster: ['rent', 'other'] })
  tjek('samlet klump → ikke «el indgår ikke»', !EL_IKKE_MED.test(b.tekst))
  tjek('samlet klump → «ét samlet beløb»', /ét samlet beløb/i.test(b.tekst))
}
{
  const c = byg({ total: 1_100_000, poster: ['rent', 'other'], elEgenMaaler: true })
  tjek('egen måler → «direkte med elselskabet»', /direkte med elselskabet/i.test(c.tekst))
  tjek('egen måler → ikke «el indgår ikke»', !EL_IKKE_MED.test(c.tekst))
}
{
  const d = byg({ total: 1_100_000, el: 20_000, poster: ['rent', 'electricity'] })
  tjek('el er navngivet → ingen el-linje', !/\bel (indgår|afregnes)|samlet beløb/i.test(d.tekst))
}
{
  // Ukendt total → ingen tilstand, ingen linje.
  const e = byg({ total: null })
  tjek('ukendt total → ingen el-linje', eltilstand({ ...BOLIG, total: null }) == null
    && !/samlet beløb|el indgår ikke/i.test(e.tekst))
}
// ── Her stod to kald til `elTekst` med prøvens EGEN tabel. De er
//    fjernet med vilje. Modprøven for fejl 3 er en femte `Eltilstand`
//    plus typekontrollen, og med prøvens egne kald blev den roed, OGSAA
//    naar rettelsen i lib/alarm.ts var vendt tilbage til ternaerkaeden:
//    det var prøvefilens tabel, der manglede noeglen, ikke
//    produktionens. Maalt — med ternaerkaeden tilbage fejlede tsc kun i
//    scripts/test-alarmbesked.ts, mens lib/alarm.ts var ren.
//
//    Det er niende raekke i faeldetabellen i min egen modproeve: et
//    vaern, der maaler sit eget forlaeg. Opslaget er i forvejen daekket
//    gennem `byggBesked` ovenfor, hvor produktionen laeser tabellen.

// ═══ Tallet i emnet må svare til listen ════════════════════════
afsnit('tallet i emnet')
{
  const to = byggBesked({
    navn: 'to boliger', kriterier: {},
    boliger: [BOLIG, { ...BOLIG, adresse: 'Anden vej 2, 2200', boligId: 'bbbbbbbb-0000-0000-0000-00000000000b' }],
    afmeldUrl: 'https://proeve.invalid/afmeld/t',
  })
  tjek('emnet siger 2', to.emne.startsWith('2 nye boliger'))
  tjek('overskriften siger 2', to.tekst.startsWith('2 nye boliger matcher'))
  tjek('HTML siger 2', to.html.includes('<strong>2 nye boliger</strong>'))
  const en = byg({})
  tjek('én bolig bøjes i ental', en.emne.startsWith('1 ny bolig —')
    && en.tekst.startsWith('1 ny bolig matcher'))
}

// ═══ 1 · FILTRET, GENNEM DEN RIGTIGE sendAlarmer ═══════════════
afsnit('1 · nedtagne boliger mailes ikke')

tjek('maaMailes: active ja, delisted nej',
  maaMailes({ status: 'active' }) && !maaMailes({ status: 'delisted' }))

const K = '55555555-0000-0000-0000-000000000001'
const U = '66666666-0000-0000-0000-000000000001'
const S_BLANDET = '77777777-0000-0000-0000-000000000001'
const S_ALLE_NED = '77777777-0000-0000-0000-000000000002'
const L_AKTIV = '88888888-0000-0000-0000-000000000001'
const L_NED = '88888888-0000-0000-0000-000000000002'
const L_NED2 = '88888888-0000-0000-0000-000000000003'

await db.execute(sql`insert into sources (id, slug, name, source_type)
  values (${K}, 'proeve-besked', 'Prøvekilde', 'spider')`)
await db.execute(sql`insert into users (id, email) values (${U}, 'besked@proeve.invalid')`)
await db.execute(sql`insert into saved_searches (id, user_id, name, criteria, confirmed_at) values
  (${S_BLANDET},  ${U}, 'blandet',  '{}'::jsonb, now()),
  (${S_ALLE_NED}, ${U}, 'alle ned', '{}'::jsonb, now())`)
await db.execute(sql`insert into listings
  (id, source_id, source_type, external_key, source_url, address_raw, rent_monthly, status, delisted_at) values
  (${L_AKTIV}, ${K}, 'spider', 'b-aktiv', 'https://proeve.invalid/a', 'Aktivvej 1, 2200',  900000, 'active',   null),
  (${L_NED},   ${K}, 'spider', 'b-ned',   'https://proeve.invalid/b', 'Nedtagetvej 2, 2200', 900000, 'delisted', now()),
  (${L_NED2},  ${K}, 'spider', 'b-ned2',  'https://proeve.invalid/c', 'Nedtagetvej 3, 2200', 900000, 'delisted', now())`)
// Boligen blev taget ned EFTER traeffet blev fundet — hele sagen.
await db.execute(sql`insert into alert_matches (saved_search_id, listing_id, matched_at) values
  (${S_BLANDET},  ${L_AKTIV}, now() - interval '2 hours'),
  (${S_BLANDET},  ${L_NED},   now() - interval '2 hours'),
  (${S_ALLE_NED}, ${L_NED2},  now() - interval '2 hours')`)

const r = await sendAlarmer()
const blandet = r.find((x) => x.soegning === 'blandet')
const alleNed = r.find((x) => x.soegning === 'alle ned')

tjek('blandet gruppe: antal = 1 (ikke 2)', blandet?.antal === 1,
  `antal=${blandet?.antal}`)
tjek('blandet gruppe: udeladt = 1', blandet?.udeladt === 1,
  `udeladt=${blandet?.udeladt}`)
tjek('kun nedtagne: intet sendt', alleNed?.sendt === false)
tjek('kun nedtagne: grunden siger hvorfor',
  /taget ned/.test(alleNed?.grund ?? ''), alleNed?.grund)
tjek('kun nedtagne: antal = 0, udeladt = 1',
  alleNed?.antal === 0 && alleNed?.udeladt === 1)

process.stdout.write(fejl === 0
  ? '\n✓ ALT GRØNT\n'
  : `\n✗ ${fejl} FEJL\n`)
process.exitCode = fejl === 0 ? 0 : 1
