-- ═══════════════════════════════════════════════════════════════
--  Vinduet bag lib/alarm.ts' status-filter: hvor mange traef staar i
--  koeen til en bolig, der ikke laengere er aktiv?
--
--  Det tal afgoer, om fejlen er SKET — ikke om den kan ske. Den kan
--  ske; det er laest i koden og nu daekket af en proeve. Om nogen har
--  faaet en mail om en nedtaget bolig, kan kun basen svare paa.
--
--      psql "$DATABASE_URL_DIRECT" -f scripts/maal-alarmkoe.sql
--
--  SKRIVEBESKYTTET. Kun `select`. Koer den fra en checkout af main med
--  .env, eller fra ejerens maskine; sessionen, der skrev filen, har
--  ingen databaseadgang.
-- ═══════════════════════════════════════════════════════════════

-- 1 · USENDTE traef, hvor boligen ikke laengere er aktiv.
--     Det er dem, der VILLE gaa ud i naeste koersel uden filteret.
select l.status,
       count(*)                           as traef,
       count(distinct am.saved_search_id) as soegninger,
       count(distinct s.user_id)          as brugere,
       min(am.matched_at)                 as aeldste_match,
       max(am.matched_at)                 as nyeste_match
from alert_matches am
join listings l      on l.id = am.listing_id
join saved_searches s on s.id = am.saved_search_id
where am.sent_at is null
  and s.confirmed_at is not null          -- kun bekraeftede, som alarmen
  and s.notify_email                      -- kun dem, der faar mail
  and s.unsubscribed_at is null
  and l.status <> 'active'
group by l.status
order by traef desc;

-- 2 · ER DET SKET? Traef, der ER sendt, hvor boligen var nedtaget paa
--     afsendelsestidspunktet. `delisted_at` findes ikke, saa dette er
--     en NEDRE graense: en bolig, der blev nedtaget EFTER mailen, ser
--     her ud som en fejl, og en bolig, der er aktiv igen, ser ud som
--     ingen fejl. Tallet skal laeses med det forbehold.
select count(*) as sendte_traef_til_nedtagne_boliger
from alert_matches am
join listings l on l.id = am.listing_id
where am.sent_at is not null
  and l.status <> 'active'
  and l.last_seen_at < am.sent_at;        -- kilden saa den sidst FOER mailen

-- 3 · Hvor laenge kan et traef ligge? Spaerretiden er 60 min., men en
--     fejlet afsendelse og ALARM_TILLADTE_MODTAGERE lader raekken staa.
select date_trunc('day', am.matched_at) as dag,
       count(*) as usendte,
       round(avg(extract(epoch from (now() - am.matched_at)) / 3600)::numeric, 1) as snit_timer
from alert_matches am
join saved_searches s on s.id = am.saved_search_id
where am.sent_at is null and s.confirmed_at is not null
group by 1 order by 1 desc limit 14;
