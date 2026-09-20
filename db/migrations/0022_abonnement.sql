-- ═══════════════════════════════════════════════════════════════
--  Abonnementstilstand og webhook-idempotens.
--
--  Egen migration, fordi 0021 tilfoejer vaerdier til `sub_status`, og
--  Postgres ikke tillader en ny enumvaerdi at blive BRUGT i samme
--  transaktion, som den blev tilfoejet i.
--
--  ── Hvad `subscriptions` manglede ──
--  Tabellen spejlede Stripe, men kunne ikke svare paa de tre
--  spoergsmaal, muren faktisk stiller:
--
--   1. «Har hun adgang NU?» — `current_period_end` er Stripes PLAN for
--      naeste traek. Den flyttes ogsaa, naar et traek MISLYKKES og
--      Stripe proever igen. Adgang maa kun foelge en GENNEMFOERT
--      betaling, saa den faar sin egen kolonne, `adgang_til`, der kun
--      skrives, naar en faktura er betalt.
--   2. «Er den her haendelse nyere end det, jeg allerede har skrevet?»
--      — en forsinket webhook maa ikke genaabne et udloebet abonnement.
--      `stripe_opdateret_at` baerer Stripes eget tidsstempel.
--   3. «Hvilken fase er hun i?» — introduktionen paa 24 timer og
--      normalprisen er to forskellige priser paa samme abonnement.
-- ═══════════════════════════════════════════════════════════════

alter table "subscriptions"
  add column "stripe_customer_id" text,
  add column "stripe_schedule_id" text,
  add column "stripe_price_id" text,
  add column "current_period_start" timestamp with time zone,
  -- Adgangen. Kun skrevet naar en faktura faktisk er BETALT.
  add column "adgang_til" timestamp with time zone,
  -- Stripes eget tidsstempel paa den nyeste haendelse, vi har skrevet.
  -- Vagten mod forsinkede og gentagne haendelser.
  add column "stripe_opdateret_at" timestamp with time zone,
  add column "oprettet_at" timestamp with time zone not null default now();

create index "sub_adgang_idx" on "subscriptions" ("user_id", "adgang_til");
create index "sub_customer_idx" on "subscriptions" ("stripe_customer_id");

-- ── Introduktionstilbuddet: én gang pr. konto ────────────────
-- Paa brugeren, ikke paa abonnementet: et abonnement kan slettes,
-- og saa ville tilbuddet vaere brugbart igen.
alter table "users"
  add column "intro_brugt_at" timestamp with time zone;

-- ── Webhook-idempotens ───────────────────────────────────────
-- Stripe leverer MINDST én gang og garanterer ikke raekkefoelgen.
-- Primaernoeglen er Stripes eget event-id, saa en gentagelse ikke kan
-- indsaettes to gange. `behandlet_at` skelner «modtaget» fra
-- «faerdigbehandlet», saa en haendelse, der kastede undervejs, kan
-- koeres igen uden at blive sprunget over som allerede set.
create table "stripe_events" (
  "id" text primary key,
  "type" text not null,
  "stripe_oprettet_at" timestamp with time zone not null,
  "modtaget_at" timestamp with time zone not null default now(),
  "behandlet_at" timestamp with time zone,
  "forsoeg" integer not null default 0,
  "fejl" text
);

create index "stripe_events_ubehandlet_idx"
  on "stripe_events" ("behandlet_at", "modtaget_at");

alter table "stripe_events" enable row level security;
revoke all on "stripe_events" from anon, authenticated;
