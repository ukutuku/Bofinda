-- ═════════════════════════════════════════════════════════════
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
--
--  ── GENERERET. RET IKKE I HAANDEN ───────────────────────
--  scripts/generer-alarmkoe-sql.ts skriver filen, og
--  scripts/test-alarmkoe-sql.ts fejler, hvis det committede ikke
--  laengere er det, generatoren laver — og koerer desuden de tre
--  select'er mod en saaet base, saa en gyldig, men forkert select
--  ikke kan staa groen.
--
--  Spoergsmaal 1 og 3 baerer appens EGEN `from … where`, klippet ud af
--  `ventendeForespoergsel().toSQL()`. De maaler derfor praecis den koe,
--  `ventende()` henter — ikke en afskrift, der kan drive fra den.
--  Spoergsmaal 2 er haandskrevet, og det kan ikke vaere andet; se der.
-- ═════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1 · HELE KOEEN, DELT PAA STATUS.            [halen: GENERERET]
--
--     Raekkerne er dem, `ventende()` ville hente lige nu. `delisted`
--     er dem, der ville gaa ud i naeste koersel, hvis filteret i
--     `sendAlarmer` ikke fandtes. `active` staar ved siden af, saa
--     andelen kan ses i stedet for at skulle gaettes.
--
--     `kan_mailes` er sendAlarmers to JS-betingelser som en KOLONNE og
--     ikke som et where-led. De staar ikke i appens forespoergsel, og
--     at skrive dem ind i halen ville vaere at haandskrive koden igen
--     — praecis det, generatoren findes for at undgaa.
-- ─────────────────────────────────────────────────────────
select "listings"."status",
       count(*)::int                              as traef,
       count(distinct "saved_searches"."id")::int as soegninger,
       count(distinct "users"."id")::int          as brugere,
       count(*) filter (where "saved_searches"."notify_email"
                          and "saved_searches"."unsubscribed_at" is null)::int
                                                  as kan_mailes,
       min("alert_matches"."matched_at")          as aeldste_match,
       max("alert_matches"."matched_at")          as nyeste_match
from "alert_matches"
  inner join "saved_searches" on "saved_searches"."id" = "alert_matches"."saved_search_id"
  inner join "users" on "users"."id" = "saved_searches"."user_id"
  inner join "listings" on "listings"."id" = "alert_matches"."listing_id"
  inner join "sources" on "sources"."id" = "listings"."source_id"
  where ("alert_matches"."sent_at" is null and "saved_searches"."confirmed_at" is not null)
group by "listings"."status"
order by traef desc;

-- ─────────────────────────────────────────────────────────
-- 2 · ER DET SKET?                        [HAANDSKREVET — og det
--                                          KAN ikke genereres]
--
--     Appens hale baerer `sent_at is null`. Dette spoergsmaal handler
--     om det modsatte: de traef, der ER sendt. Halen ville udelukke
--     hver eneste raekke, saa her staar en haandskrevet select, og det
--     er et valg og ikke en forglemmelse.
--
--     `delisted_at` saettes af lib/ingest.ts, naar afmeldingen tager
--     boligen ned. Sammenligningen er derfor praecis: boligen var
--     nede, FOER mailen gik ud. Den gamle udgave af filen paastod, at
--     kolonnen ikke fandtes, og brugte `last_seen_at` som stedfortraeder
--     — det var forkert, kolonnen har vaeret der siden migration 0002.
--
--     Det er stadig en NEDRE graense. Kommer boligen tilbage, nulstiller
--     ingest `delisted_at`, og saa forsvinder den historiske fejl
--     herfra. Tallet kan vaere for lavt; det kan ikke vaere for hoejt.
-- ─────────────────────────────────────────────────────────
select count(*)::int   as sendte_traef_til_nedtagne,
       min(am.sent_at) as tidligste_mail,
       max(am.sent_at) as seneste_mail
from alert_matches am
join listings l on l.id = am.listing_id
where am.sent_at is not null
  and l.delisted_at is not null
  and l.delisted_at < am.sent_at;

-- ─────────────────────────────────────────────────────────
-- 3 · HVOR LAENGE KAN ET TRAEF LIGGE?          [halen: GENERERET]
--
--     Spaerretiden er 60 min., men en fejlet afsendelse og
--     ALARM_TILLADTE_MODTAGERE lader raekken staa. Samme hale som 1,
--     saa de to taeller det samme grundlag.
-- ─────────────────────────────────────────────────────────
select date_trunc('day', "alert_matches"."matched_at") as dag,
       count(*)::int                                          as usendte,
       round(avg(extract(epoch from (now() - "alert_matches"."matched_at")) / 3600)::numeric, 1)
         as snit_timer
from "alert_matches"
  inner join "saved_searches" on "saved_searches"."id" = "alert_matches"."saved_search_id"
  inner join "users" on "users"."id" = "saved_searches"."user_id"
  inner join "listings" on "listings"."id" = "alert_matches"."listing_id"
  inner join "sources" on "sources"."id" = "listings"."source_id"
  where ("alert_matches"."sent_at" is null and "saved_searches"."confirmed_at" is not null)
group by 1
order by 1 desc
limit 14;
