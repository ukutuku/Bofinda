-- ═══════════════════════════════════════════════════════════════
--  UDESTAAENDE ARBEJDE FAAR SIT EGET FELT — OG SIN EGEN KOE.
--
--  0027 gav kundens beslutning et felt. Genoptagelsen hvilede
--  derefter paa en UDLEDNING: «besluttet, men `cancel_at_period_end`
--  er false». Det er to fejl i ét:
--
--   · `cancel_at_period_end` svarer paa «fornyes abonnementet?».
--     Koeen brugte den til at svare paa «er der udestaaende arbejde?».
--     Er opsigelsen bekraeftet, men en PLAN staar tilbage uafklaret
--     hos Stripe, er svaret paa det foerste ja og paa det andet nej —
--     og raekken blev derfor aldrig valgt. Den aktive plan var usynlig
--     for hver eneste koe i modulet.
--   · Udvaelgelsen havde ingen tilbagetraekning. De samme 25 raekker
--     kunne vaelges hver gang, og kunde nummer 26 kom aldrig til.
--     Praecis den fejlklasse loeste `stripe_events.naeste_forsoeg_at`
--     for haendelseskoeen; her mangler den.
--
--  Derfor et EKSPLICIT felt for skylden, uafhaengigt af ethvert flag,
--  og en naeste-forsoegstid med tilbagetraekning. Skylden saettes flere
--  steder — kundens opsigelse, en plan vi ikke fik bekraeftet, vores
--  eget sikkerhedsstop — og ryddes ÉT sted: af en afstemning, der har
--  laest Stripes autoritative sluttilstand.
-- ═══════════════════════════════════════════════════════════════

alter table "subscriptions"
  add column "afstemning_skyldig_at" timestamp with time zone,
  add column "afstemning_naeste_at" timestamp with time zone,
  add column "afstemning_forsoeg" integer not null default 0,
  add column "afstemning_fejl" text;

-- BACKFILL. Raekker, der allerede staar med en besluttet, ubekraeftet
-- opsigelse, var skyldige efter den GAMLE udledning. Skifter koeen
-- praedikat uden det her, bliver de usynlige for baade den gamle og den
-- nye — og en kunde, der sagde op i gaar, ville aldrig blive opsagt.
update "subscriptions"
   set "afstemning_skyldig_at" = coalesce("opsagt_af_kunde_at", now())
 where "opsagt_af_kunde_at" is not null
   and "cancel_at_period_end" = false;

-- Koeen spoerger «hvad er skyldigt og klar NU», og tager de mest
-- presserende foerst. Delvist, fordi skyld er undtagelsen: de fleste
-- raekker har ingen. Begge kolonner med, saa baade klarheden og
-- raekkefoelgen kan laeses af indekset.
create index "sub_afstemning_idx"
  on "subscriptions" ("afstemning_naeste_at", "afstemning_forsoeg", "current_period_end")
  where "afstemning_skyldig_at" is not null;

-- 0027's indeks er doedt nu. Det svarede paa den UDLEDNING, der var
-- fejlen — «besluttet og ikke bekraeftet» — og koeen spoerger ikke
-- laengere om den. Et indeks, ingen laeser, koster kun skrivninger.
drop index if exists "sub_skyldig_opsigelse_idx";
