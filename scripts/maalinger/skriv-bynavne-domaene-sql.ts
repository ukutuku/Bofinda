// ═══════════════════════════════════════════════════════════════
//  Skriver målingerne ud som SELECT-blokke, der kan indsættes direkte i
//  Supabases SQL-editor. Den, der kører dem, behøver kun editoren — intet
//  checkout og ingen terminal. Scriptet selv kalder ingen forespørgsel: det
//  bygger tekst. (Det importerer lib/soeg og dermed db/client, som først
//  forbinder ved første forespørgsel — og her kommer der ingen.)
//
//    npx tsx --tsconfig tsconfig.scripts.json scripts/maalinger/skriv-bynavne-domaene-sql.ts
//    npm run maaling:sql      skriver filen ved siden af, maalinger-til-supabase.sql
//
//  Filen er committet, så den, der skal køre målingerne, kan hente den
//  uden at klone og køre generatoren. proev-sql-fil.ts (npm test) fejler,
//  hvis den committede fil ikke er det, generatoren skriver i dag — en
//  ændring i appens prædikater gør den altså rød, til filen er skrevet
//  igen.
//
//  Hver blok er ÉT resultatsæt, kun SELECT, ingen temp-tabeller og ingen
//  skrivende CTE'er. Prædikaterne er appens egne, gengivet af drizzle
//  (scripts/maalinger/gengiv.ts) — `synlig` og `bynavn` fra lib/omraade.ts,
//  `hvor`, `ikkeRepraesentant`, `DEDUPNOEGLE` og `dansk` fra lib/soeg.ts og
//  kildekontrakterne fra lib/kildekontrakt.ts. Intet er skrevet af.
//
//  Prøvet mod et facit, skrevet ud på forhånd: proev-bynavne-domaene-sql.ts
//  — i testbasen (npm test) og mod en rigtig Postgres med ICU.
// ═══════════════════════════════════════════════════════════════

import { QueryBuilder } from 'drizzle-orm/pg-core'
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm'
import { listings, sources } from '../../db/schema'
import { bynavn, synlig } from '../../lib/omraade'
import { DEDUPNOEGLE, dansk, hvor, ikkeRepraesentant } from '../../lib/soeg'
import { KILDEKONTRAKTER } from '../../lib/kildekontrakt'
import { gengiv } from './gengiv'

const qb = () => new QueryBuilder()

// ── Bynavne ─────────────────────────────────────────────────────

/**
 * Et udtryk alene som tekst: gengivet i en select og skåret ud mellem
 * `select ` og ` from`. Bruges til `bynavn()` over en CTE-kolonne, så
 * vinderen er appens eget udtryk og ikke en afskrift af det.
 */
function gengivUdtryk(u: SQL): string {
  const hel = gengiv(qb().select({ u }).from(listings))
  const m = /^select ([\s\S]*) from "listings"$/.exec(hel)
  if (!m) throw new Error(`kunne ikke skære udtrykket ud af: ${hel.slice(0, 120)}`)
  return m[1]!
}

/** De fem CTE'er for ét sæt: rækkerne, optællingen, vinderne, top og de lige. */
function bynavneCte(navn: string, grundlag: SQL): string {
  // Sættet gengives ÉN gang. Resten er almindelig SQL over det.
  const raekker = gengiv(qb()
    .select({
      postnr: sql`${listings.postalCode}`.as('postnr'),
      bynavn: sql`${listings.city}`.as('bynavn'),
    })
    .from(listings)
    .where(and(grundlag, isNotNull(listings.postalCode))))
  // Vinderen er appens eget udtryk, `bynavn()`, over sættets bykolonne. De
  // to andre er samme udtryk under en anden collation: dansk og testbasens C.
  const BY = sql.raw('bynavn')
  return `${navn}_raekker as (${raekker}),
${navn}_stave as (
  select postnr, bynavn, count(*) as n from ${navn}_raekker where bynavn is not null group by postnr, bynavn),
${navn}_vinder as (
  select postnr,
    ${gengivUdtryk(bynavn(BY))} as vinder_produktion,
    ${gengivUdtryk(bynavn(dansk(BY)))} as vinder_dansk,
    ${gengivUdtryk(bynavn(sql`${BY} collate "C"`))} as vinder_testbasen
  from ${navn}_raekker group by postnr),
${navn}_top as (
  select postnr, max(n) as top, count(*) as stavemaader from ${navn}_stave group by postnr),
${navn}_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from ${navn}_stave s join ${navn}_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr)`
}

// `synlig` — det, områdesiderne viser. Alle med postnummer og by — det,
// `byForPostnr` stemmer over, uanset status.
const SAET = [
  { navn: 'synlige', etiket: 'synlige — områdesidernes navn', grundlag: synlig! },
  { navn: 'alle', etiket: 'alle rækker — byForPostnr, det udlejeren får gemt', grundlag: isNotNull(listings.city) },
] as const
const ALLE_CTE = `with\n${SAET.map((s) => bynavneCte(s.navn, s.grundlag)).join(',\n')}`

// To vindere med hver sin collation kan ikke sammenlignes direkte —
// Postgres kan ikke vælge collation til `=`. `collate "C"` på begge sider
// er ren byte-lighed, og lighed er byte-lighed under begge.
const ANDEN = (a: string, b: string) => `(${a} collate "C" is distinct from ${b} collate "C")`

const B1 = `-- ═══════════════════════════════════════════════════════════════
-- B1 · Bynavne: hvor ofte afgør collationen, hvad et postnummer hedder?
--
-- Kun SELECT. Én række pr. sæt.
--
-- Navnet er den hyppigste stavemåde (\`bynavn()\` i lib/omraade.ts, mode()).
-- Står to stavemåder LIGE øverst, vinder den, der sorterer først under
-- basens collation — her en_US. Ingen har valgt den orden til formålet.
--   · synlige: navnet på postnummersiden og i dens meta-beskrivelse.
--   · alle rækker: byForPostnr — det bynavn, en udlejerannonce får GEMT.
--     Udlejerannoncerne stemmer selv med, også de afmeldte.
-- «dansk_ville_vaelge_andet» og «testbasen_vaelger_andet» tæller kun de
-- uafgjorte; uden uafgjort vælger alle collationer det samme.
-- ═══════════════════════════════════════════════════════════════
${ALLE_CTE}
${SAET.map((s) => `select '${s.etiket}' as saet,
  (select count(*) from ${s.navn}_top) as postnumre,
  (select count(*) from ${s.navn}_top where stavemaader >= 2) as med_flere_stavemaader,
  (select count(*) from ${s.navn}_lige where lige >= 2) as med_uafgjort_oeverst,
  (select count(*) from ${s.navn}_lige l join ${s.navn}_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and ${ANDEN('v.vinder_produktion', 'v.vinder_dansk')}) as dansk_ville_vaelge_andet,
  (select count(*) from ${s.navn}_lige l join ${s.navn}_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and ${ANDEN('v.vinder_produktion', 'v.vinder_testbasen')}) as testbasen_vaelger_andet`).join('\nunion all\n')};`

const B2 = `-- ═══════════════════════════════════════════════════════════════
-- B2 · De uafgjorte postnumre, én række hver.
--
-- Kun SELECT. Én række pr. postnummer, hvor to eller flere stavemåder
-- står LIGE øverst — i hvert af de to sæt fra B1.
--
-- «vinder_i_dag» er det, produktionen viser og gemmer nu. «vinder_dansk»
-- er samme udtryk med collate "da-x-icu"; «vinder_i_testbasen» med "C",
-- som PGlite bruger. Er de tre ens, er uafgjortheden uden følger i dag.
-- ═══════════════════════════════════════════════════════════════
${ALLE_CTE}
${SAET.map((s) => `select '${s.navn}' as saet, l.postnr, t.stavemaader, l.lige_stavemaader as lige_oeverst,
  l.hver as boliger_hver, v.vinder_produktion as vinder_i_dag, v.vinder_dansk,
  v.vinder_testbasen as vinder_i_testbasen
from ${s.navn}_lige l join ${s.navn}_top t on t.postnr = l.postnr join ${s.navn}_vinder v on v.postnr = l.postnr
where l.lige >= 2`).join('\nunion all\n')}
order by 1 desc, 2;`

const GEMTE = gengiv(qb()
  .select({
    postnr: sql`${listings.postalCode}`.as('postnr'),
    gemt: sql`${listings.city}`.as('gemt_by'),
    aktiv: sql<boolean>`(${listings.status} = 'active')`.as('aktiv'),
  })
  .from(listings)
  .where(and(eq(listings.sourceType, 'native'), isNotNull(listings.postalCode))))

const B3 = `-- ═══════════════════════════════════════════════════════════════
-- B3 · Udlejernes GEMTE bynavne i postnumre med flere stavemåder.
--
-- Kun SELECT. Én række pr. (postnummer, gemt bynavn).
--
-- \`byForPostnr\` kører, når udlejeren gemmer, og resultatet bliver LIGGENDE
-- i listings.city — det er det, bysøgningen og områdesiderne filtrerer på.
-- En rettelse af koden ændrer kun FREMTIDIGE gem. Rækker, der allerede
-- står her med et andet navn end den rettede regel ville give, skal
-- skrives om af en migration.
--
-- FORBEHOLD: «gemt_er_dagens_vinder» sammenligner med vinderen I DAG. Ved
-- gemningen kan grundlaget have været et andet, så en uoverensstemmelse
-- kan skyldes, at bestanden har flyttet sig — ikke collationen. Og
-- udlejerannoncerne stemmer selv med i grundlaget.
-- ═══════════════════════════════════════════════════════════════
${ALLE_CTE},
gemte as (${GEMTE})
select g.postnr, g.gemt_by, count(*) as udlejerannoncer,
  count(*) filter (where g.aktiv) as heraf_aktive,
  (l.lige >= 2) as uafgjort_oeverst_i_dag, l.lige_stavemaader as lige_oeverst,
  v.vinder_produktion as vinder_i_dag, v.vinder_dansk,
  (g.gemt_by collate "C" = v.vinder_produktion collate "C") as gemt_er_dagens_vinder,
  ${ANDEN('v.vinder_produktion', 'v.vinder_dansk')} as dansk_ville_vaelge_andet
from gemte g
join alle_top t on t.postnr = g.postnr
join alle_lige l on l.postnr = g.postnr
join alle_vinder v on v.postnr = g.postnr
where t.stavemaader >= 2
group by g.postnr, g.gemt_by, l.lige, l.lige_stavemaader, v.vinder_produktion, v.vinder_dansk
order by 1, 2;`

// ── Domænefiltre efter dedup ────────────────────────────────────

const KONTRAKTKILDER = Object.keys(KILDEKONTRAKTER).map((k) => `'${k.replace(/'/g, "''")}'`).join(', ')

// Én række pr. annonce, der har en dedup-nøgle, med repræsentanten som
// appen vælger den. Et rent domænefilter ændrer ikke SQL-sættet, så
// repræsentanten under filteret er den samme som her.
const ANNONCER = gengiv(qb()
  .select({
    noegle: sql`${DEDUPNOEGLE}`.as('noegle'),
    rep: sql<boolean>`not ${ikkeRepraesentant(hvor({}))}`.as('er_repraesentant'),
    kilde: sql`${sources.slug}`.as('kilde'),
    fakta: sql`${listings.availabilityFacts}`.as('fakta'),
  })
  .from(listings)
  .innerJoin(sources, eq(sources.id, listings.sourceId))
  .where(and(hvor({}), sql`${DEDUPNOEGLE} is not null`)))

const DOMAENE_CTE = `with annoncer as (${ANNONCER}),
boliger as (
  select noegle, count(*) as annoncer,
    count(*) filter (where er_repraesentant) as repraesentanter,
    count(*) filter (where kilde in (${KONTRAKTKILDER})) as med_kontrakt,
    -- Domænet afhænger KUN af kildens kontrakt og annoncens fakta (og
    -- tidspunktet, som er det samme for alle). Er de ens, falder
    -- annoncerne ens ud. Uden kontrakt er alt «ukendt».
    count(distinct case when kilde in (${KONTRAKTKILDER})
                        then kilde || ' ' || coalesce(fakta::text, '{}')
                        else 'ingen kontrakt' end) as signaturer
  from annoncer group by noegle having count(*) >= 2)`

const D1 = `-- ═══════════════════════════════════════════════════════════════
-- D1 · Domænefiltre: hvor mange boliger KAN tabe, fordi repræsentanten
-- ikke passer, mens en anden annonce for samme bolig gør?
--
-- Kun SELECT. Én række.
--
-- Overtagelse, ansøgningsform og markedsstatus afgøres i JS, på
-- repræsentanten, efter SQL har valgt den. Passer den ikke, vælges ingen
-- afløser — boligen forsvinder fra søgningen.
--
-- FORBEHOLD: SQL kan ikke afgøre domænet. Det kræver kildekontrakten og
-- tidspunktet nu (lib/availability.ts), og en kopi i SQL ville være et
-- andet udtryk for det samme. Tallet her er derfor en ØVRE GRÆNSE: boliger,
-- hvis annoncer har forskellig kontrakt eller forskellige fakta, og altså
-- KAN stå på hver sin side af et filter. Er den 0, er sagen afgjort. Er den
-- over 0, giver D2 de præcise tal.
-- «uden_praecis_en_repraesentant» skal være 0 — ellers er målingen ugyldig.
-- ═══════════════════════════════════════════════════════════════
${DOMAENE_CTE}
select count(*) as boliger_med_flere_annoncer,
  count(*) filter (where med_kontrakt > 0) as heraf_med_en_kildekontrakt,
  count(*) filter (where signaturer > 1) as heraf_kan_staa_paa_hver_sin_side_hoejst,
  count(*) filter (where repraesentanter <> 1) as uden_praecis_en_repraesentant
from boliger;`

const D2 = `-- ═══════════════════════════════════════════════════════════════
-- D2 · Domænefiltre: de boliger fra D1, der kan tabe — til fortolkning.
--
-- Kun SELECT. Én række, med én celle JSON.
--
-- Kopiér cellen «til_fortolkning» og send den tilbage. Den fortolkes af
-- appens EGEN availabilityFor og matcherDomaene
-- (scripts/maalinger/fortolk-domaene.ts), som giver det præcise antal
-- tabte boliger pr. filterværdi. «bolig» er en md5 af dedup-nøglen, ikke
-- en adresse. Cellen indeholder kildens slug og availability-fakta —
-- status, datoer og ansøgningsform. Ingen kontaktoplysninger.
-- ═══════════════════════════════════════════════════════════════
${DOMAENE_CTE}
select count(distinct a.noegle) as boliger, count(*) as annoncer,
  coalesce(json_agg(json_build_object(
    'bolig', md5(a.noegle), 'repraesentant', a.er_repraesentant,
    'kilde', a.kilde, 'fakta', a.fakta)
    order by md5(a.noegle), a.er_repraesentant desc, a.kilde collate "C"), '[]'::json) as til_fortolkning
from annoncer a join boliger b on b.noegle = a.noegle
where b.signaturer > 1;`

// ── FULD-NULL og JIT ────────────────────────────────────────────

const F1 = `-- ═══════════════════════════════════════════════════════════════
-- F1 · En kendt total uden komponentliste.
--
-- Kun SELECT. Én række pr. kilde, der har mindst én.
--
-- Totalen skrives kun af \`beregnTotal\` (lib/normalize.ts), som altid
-- sætter total og poster sammen. Står der en total uden poster, kommer
-- den fra en ældre kodeversion, fra SQL i hånden eller fra prøvedata.
-- CHECK'en lader den passere, for cardinality(NULL) er NULL.
-- Følgen på kortet: en grøn total, og \`eltilstand\` giver «ikke-med» —
-- «El indgår ikke», en påstand, der kræver udspecificerede poster.
-- ═══════════════════════════════════════════════════════════════
select s.name as kilde,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null) as total_uden_poster,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null
                     and l.status = 'active') as heraf_aktive,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null
                     and l.status = 'active' and l.utilities_electricity is null
                     and l.electricity_own_meter is not true) as heraf_med_linjen_el_indgaar_ikke
from listings l join sources s on s.id = l.source_id
group by s.name
having count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null) > 0
order by 2 desc;`

// Indstillingerne, der kan ændre en konklusion. Navnene står ét sted, så
// prøven kan holde blokken op mod dem.
export const INDSTILLINGER: readonly [string, readonly string[]][] = [
  ['version', ['server_version', 'server_version_num']],
  ['planlaegger', ['random_page_cost', 'seq_page_cost', 'effective_cache_size', 'cpu_tuple_cost',
    'cpu_index_tuple_cost', 'cpu_operator_cost', 'plan_cache_mode', 'join_collapse_limit',
    'from_collapse_limit', 'enable_seqscan', 'enable_indexscan', 'enable_bitmapscan', 'enable_hashjoin',
    'enable_mergejoin', 'enable_nestloop', 'enable_hashagg', 'enable_sort', 'enable_incremental_sort',
    'enable_memoize']],
  ['statistik', ['default_statistics_target']],
  ['hukommelse', ['work_mem', 'hash_mem_multiplier', 'shared_buffers', 'maintenance_work_mem',
    'temp_buffers', 'effective_io_concurrency']],
  ['parallelitet', ['max_parallel_workers_per_gather', 'max_parallel_workers', 'max_worker_processes',
    'parallel_setup_cost', 'parallel_tuple_cost', 'min_parallel_table_scan_size', 'min_parallel_index_scan_size']],
  ['jit', ['jit', 'jit_above_cost', 'jit_inline_above_cost', 'jit_optimize_above_cost']],
  ['tid', ['statement_timeout']],
]
const OENSKET = INDSTILLINGER.flatMap(([g, navne]) => navne.map((n) => [g, n] as const))
  .map(([g, n], i) => `('${g}', '${n}', ${i + 1})`).join(',\n  ')

const S1 = `-- ═══════════════════════════════════════════════════════════════
-- S1 · Indstillinger, der kan ændre en konklusion — kør den BEGGE steder.
--
-- Kun SELECT. Én række pr. indstilling; grupperet; ingen af de 400 andre.
--
-- En måling på den lokale maskine er en måling af den lokale maskine. Den
-- siger intet om produktionen, før den er gentaget dér, eller før
-- indstillingerne er sammenholdt. 1. oktober 2026 ændrede en forskel en
-- konklusion tre gange: version, collation og JIT — og hver gang blev den
-- fundet bagefter. Kør blokken lokalt og i produktionen, og sammenlign
-- rækkerne, FØR en lokal måling bruges om produktionen.
--
-- «findes = false» betyder, at motoren ikke kender indstillingen — den
-- forsvinder ikke stille. «kilde» siger, hvor værdien kommer fra (default,
-- configuration file, database, user, session).
--
-- FORBEHOLD: pg_settings viser værdierne for DENNE session og rolle.
-- Appen forbinder gennem pooleren med sin egen rolle, og Supabase sætter
-- nogle værdier pr. rolle — fx statement_timeout. Kan en rolleindstilling
-- ændre konklusionen, så læs den for appens rolle:
--   select rolname, rolconfig from pg_roles where rolconfig is not null;
-- Statistikrækkerne er data, ikke indstillinger: hvor mange rækker
-- planlæggeren regner med, og hvornår den sidst fik nye tal.
-- ═══════════════════════════════════════════════════════════════
with oensket(gruppe, navn, nr) as (values
  ${OENSKET}
)
select o.nr, o.gruppe, o.navn, s.setting as vaerdi, s.unit as enhed, s.source as kilde,
       (s.name is not null) as findes
from oensket o left join pg_settings s on s.name = o.navn
union all
select 900 + x.i, 'collation', 'database: ' || x.k, x.v, null, 'pg_database', true
from pg_database d,
     lateral (values (1, 'datcollate', d.datcollate::text), (2, 'datctype', d.datctype::text),
                     (3, 'udbyder', case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu'
                                                          when 'b' then 'builtin' end),
                     (4, 'icu-locale', coalesce(to_jsonb(d) ->> 'datlocale', to_jsonb(d) ->> 'daticulocale')))
       as x(i, k, v)
where d.datname = current_database()
union all
select 910 + x.i, 'collation', 'da-x-icu: ' || x.k, x.v, null, 'pg_collation', true
from pg_collation c,
     lateral (values (1, 'skema', c.collnamespace::regnamespace::text), (2, 'collversion', c.collversion),
                     (3, 'locale', coalesce(to_jsonb(c) ->> 'colllocale', to_jsonb(c) ->> 'colliculocale')))
       as x(i, k, v)
where c.collname = 'da-x-icu'
union all
select 950 + x.i, 'statistik', t.relname || ': ' || x.k, x.v, null, 'pg_stat_user_tables', true
from pg_stat_user_tables t,
     lateral (values (1, 'levende raekker', t.n_live_tup::text),
                     (2, 'sidst analyseret', greatest(t.last_analyze, t.last_autoanalyze)::text)) as x(i, k, v)
where t.schemaname = 'public' and t.relname in ('listings', 'listing_images')
order by 1, 3;`

export function blokke(): { navn: string; sql: string }[] {
  return [
    { navn: 'B1', sql: B1 }, { navn: 'B2', sql: B2 }, { navn: 'B3', sql: B3 },
    { navn: 'D1', sql: D1 }, { navn: 'D2', sql: D2 },
    { navn: 'F1', sql: F1 }, { navn: 'S1', sql: S1 },
  ]
}

/** Den committede fil. Stien står ét sted: her. */
export const SQL_FIL = 'scripts/maalinger/maalinger-til-supabase.sql'

/** Hele teksten, som den skrives — til stdout, til filen og i prøven. */
export function tekst(): string {
  return blokke().map((b) => b.sql).join('\n\n\n') + '\n'
}

if (process.argv[1]?.endsWith('skriv-bynavne-domaene-sql.ts')) {
  if (process.argv.includes('--skriv')) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(SQL_FIL, tekst())
    process.stdout.write(`skrevet: ${SQL_FIL}\n`)
  } else {
    process.stdout.write(tekst())
  }
}
