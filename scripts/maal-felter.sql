-- ═══════════════════════════════════════════════════════════════
--  Daekningen af de felter, vi GEMMER men ikke bruger.
--
--  `genererBeskrivelse` i lib/normalize.ts tager 13 felter. Disse syv er
--  ikke blandt dem, og vi udfylder dem paa hver bolig. Spoergsmaalet er,
--  hvilke der er vaerd at tage ind foerst — og det afgoeres af daekning,
--  ikke af skoen.
--
--      psql "$DATABASE_URL_DIRECT" -f scripts/maal-felter.sql
--
--  SKRIVEBESKYTTET. Kun `select`, ingen DDL, ingen DML.
--
--  ── FORBEHOLD ───────────────────────────────────────────────
--  IKKE koert mod produktionen. Sessionen, der skrev filen, havde hverken
--  .env eller databaseadgang. Saetningerne er derimod koert mod TESTBASEN
--  (PGlite med de rigtige migrationer), saa syntaks og typer holder paa
--  det rigtige skema — men tallene er aldrig set. Se
--  scripts/test-maal-felter.ts.
--
--  `amenities` er JSONB og ikke text[]. Foerste udkast brugte `unnest()`
--  og `<> '{}'`; begge fejler paa jsonb, og den anden tier endda, fordi
--  '{}' er et tomt OBJEKT i jsonb og ikke en tom liste. Derfor
--  `jsonb_array_elements_text` og `jsonb_array_length` — samme form som
--  lib/soeg.ts bruger.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1 · Daekning pr. felt, pr. kilde.
--     Kun aktive. Dedup er IKKE anvendt: spoergsmaalet er, hvad vi HAR,
--     ikke hvad vi viser.
-- ─────────────────────────────────────────────────────────────
select s.name                                                        as kilde,
       count(*)::int                                                 as aktive,
       round(100.0 * count(*) filter (
         where jsonb_array_length(coalesce(l.amenities, '[]'::jsonb)) > 0
       ) / count(*), 1)                                              as pct_amenities,
       round(100.0 * count(l.floor)         / count(*), 1)            as pct_floor,
       round(100.0 * count(l.door)          / count(*), 1)            as pct_door,
       round(100.0 * count(l.deposit)       / count(*), 1)            as pct_deposit,
       round(100.0 * count(l.prepaid_rent)  / count(*), 1)            as pct_prepaid,
       round(100.0 * count(l.move_in_cost)  / count(*), 1)            as pct_moveincost,
       round(100.0 * count(l.open_house_at) / count(*), 1)            as pct_openhouse
from listings l
  join sources s on s.id = l.source_id
where l.status = 'active'
group by s.name
order by aktive desc;

-- ─────────────────────────────────────────────────────────────
-- 2 · amenities-ordforraadet, som det FAKTISK staar i basen.
--     Maaler praecis det, en kodemaaling ikke kan: hvad alabu og laros
--     har skrevet. De to er de eneste adaptere, der sender kildens egne
--     strenge igennem uoversat (alabu.ts:255, laros.ts:152) — de oevrige
--     oversaetter gennem en afgraenset tabel.
-- ─────────────────────────────────────────────────────────────
select lower(trim(ord))                     as ord,
       count(*)::int                        as forekomster,
       count(distinct l.source_id)::int     as kilder,
       string_agg(distinct s.name, ', ')     as hvilke
from listings l
  join sources s on s.id = l.source_id
  cross join lateral jsonb_array_elements_text(coalesce(l.amenities, '[]'::jsonb)) as ord
where l.status = 'active'
group by 1
order by forekomster desc;

-- ─────────────────────────────────────────────────────────────
-- 3 · Hvor mange DISTINKTE ord, og hvor mange der ikke kan filtreres.
--     De fem filtrerbare staar i FACILITET i lib/faciliteter.ts. Er
--     tallet i naevneren stoerre end her, er forskellen ord, brugeren
--     ikke kan soege paa.
--
--     NB: listen her er skrevet AF fra lib/faciliteter.ts og er dermed
--     det andet udtryk for samme spoergsmaal. Den kan drive. Derfor
--     taeller scripts/test-maal-felter.ts efter, at de fem ord i denne
--     fil er praecis `Facilitetsord`.
-- ─────────────────────────────────────────────────────────────
select count(*)::int                                     as distinkte_ord,
       count(*) filter (where ord not in (
         'altan', 'terrasse', 'altan eller terrasse', 'elevator', 'kæledyr tilladt'
       ))::int                                            as ufiltrerbare
from (
  select distinct lower(trim(o)) as ord
  from listings l
    cross join lateral jsonb_array_elements_text(coalesce(l.amenities, '[]'::jsonb)) as o
  where l.status = 'active'
) t;
