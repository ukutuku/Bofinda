-- ═══════════════════════════════════════════════════════════════
--  Robusthed i betalingsmodulet. Otte fund fra gennemgangen, hvoraf
--  seks er REPRODUCERET mod 832d483 (se rapportens fund-tabel).
--
--  1 · `stripe_events.paabegyndt_at` — et ATOMISK krav paa haendelsen.
--      Foer laeste behandleren `behandlet_at` og fortsatte, hvis den var
--      null. To samtidige leveringer af samme haendelse laeste begge
--      null og fortsatte begge. Primaernoeglen forhindrer to RAEKKER,
--      ikke to BEHANDLERE. Kravet tages nu med en betinget UPDATE, der
--      enten rammer én raekke eller nul.
--
--  2 · `subscriptions.plan_*` — planlaegningen som sin egen, vedvarende
--      tilstand. Foer sank en fejl i `laegPlan()` sporloest ned, og
--      haendelsen blev markeret faerdig, saa den aldrig blev proevet
--      igen. Abonnementet kunne derfor blive ved med at koere til
--      9 kr./dag. `plan_status` skelner desuden 'oprettet' fra
--      'konfigureret': et schedule-id alene beviser ikke, at faserne
--      er rigtige.
--
--  3 · `checkout_forsoeg` — én reservation pr. konto.
--      Foer skrev `startKoeb()` ingenting, og idempotensnoeglen skiftede
--      med minuttet. To faner eller to minutter gav to BETALBARE
--      Checkout-forloeb, og det lokale unikke indeks greb foerst ind
--      EFTER, Stripe havde oprettet abonnement nummer to. Et delvist
--      unikt indeks paa 'aaben' goer reservationen til basens ansvar.
-- ═══════════════════════════════════════════════════════════════

alter table "stripe_events"
  add column "paabegyndt_at" timestamp with time zone;

create type "plan_status" as enum ('mangler', 'oprettet', 'konfigureret', 'fejlet');

alter table "subscriptions"
  add column "plan_status" "plan_status",
  add column "plan_fejl" text,
  add column "plan_forsoegt_at" timestamp with time zone,
  add column "plan_forsoeg" integer not null default 0;

-- De abonnementer, der mangler en plan, skal kunne findes uden at
-- scanne hele tabellen — driftstilsynet spoerger om dem hver time.
-- `plan_status` er et NYOPRETTET enum i den her migration, ikke en
-- udvidelse af et eksisterende. En ny type maa gerne bruges i samme
-- transaktion — se noten i 0021.
create index "sub_plan_mangler_idx" on "subscriptions" ("plan_status")
  where "plan_status" is not null and "plan_status" <> 'konfigureret';

create type "koeb_status" as enum ('aaben', 'betalt', 'udloebet', 'afbrudt');

create table "checkout_forsoeg" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null references "users"("id") on delete cascade,
  "stripe_session_id" text not null unique,
  "stripe_customer_id" text,
  "pris_id" text not null,
  "status" "koeb_status" not null default 'aaben',
  "oprettet_at" timestamp with time zone not null default now(),
  "udloeber_at" timestamp with time zone not null,
  "lukket_at" timestamp with time zone
);

-- ÉN aaben pr. konto. Vagten ligger i basen, ikke kun i koden: to
-- samtidige faner rammer den samme constraint.
create unique index "checkout_en_aaben_pr_bruger"
  on "checkout_forsoeg" ("user_id") where "status" = 'aaben';

create index "checkout_session_idx" on "checkout_forsoeg" ("stripe_session_id");

alter table "checkout_forsoeg" enable row level security;
revoke all on "checkout_forsoeg" from anon, authenticated;
