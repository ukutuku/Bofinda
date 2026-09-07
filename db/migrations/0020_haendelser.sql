-- ═══════════════════════════════════════════════════════════════
--  Produktanalytics. Se docs/analytics-v1.md for hele designet.
--
--  HAANDSKREVET, ikke genereret. drizzle-kit's snapshots stopper ved
--  0012, saa `db:generate` bygger sin diff paa en forældet baseline og
--  vil genskabe host_blocks og syv listings-kolonner, der allerede
--  findes. Samme greb som 0013-0019: skriv SQL'en, og skriv posten i
--  meta/_journal.json. `npm run db:status` faelder en fil uden post.
-- ═══════════════════════════════════════════════════════════════

create table "haendelser" (
  "id"                  uuid primary key default gen_random_uuid(),
  "occurred_at"         timestamp with time zone not null default now(),
  "event_name"          text not null,
  "schema_version"      smallint not null default 1,
  "environment"         text not null,

  -- NOT NULL er skaerpelsen udtrykt som en spaerring, ikke som en aftale:
  -- uden analytics-samtykke maa der ikke gemmes ÉT individuelt event.
  -- Var de nullable, ville en fejl i samtykkelaesningen skrive raekker med
  -- null-identifikatorer, og ingen ville opdage det.
  "anonymous_id"        uuid not null,
  "session_id"          uuid not null,

  -- Vores egen brugerraekke. ALDRIG mailadressen. Nulstilles ved sletteret.
  "user_id"             uuid,
  "research_session_id" text,

  -- MOENSTERET, /bolig/[id] — aldrig den faktiske URL. Den baerer fritekst.
  "route"               text not null,

  "listing_id"          uuid,
  "source_slug"         text,
  "properties"          jsonb not null default '{}'::jsonb,
  "expires_at"          timestamp with time zone not null,

  constraint "haendelser_miljoe"
    check ("environment" in ('produktion','preview','udvikling','proeve')),
  constraint "haendelser_navn_laengde"
    check (char_length("event_name") between 1 and 40),
  constraint "haendelser_forsoeg_laengde"
    check ("research_session_id" is null
           or char_length("research_session_id") between 1 and 40)
);
--> statement-breakpoint

-- Dagsaggregat. Ingen identifikatorer overhovedet, derfor ingen udloebsdato.
-- sample_andel er IKKE pynt: listing_impression er stikproevet, og et
-- aggregat, der gemmer 25 % af sandheden som om det var 100 %, er en loegn,
-- ingen opdager. For alle andre events er den 1.
create table "haendelser_daglig" (
  "dato"         text not null,
  "environment"  text not null,
  "event_name"   text not null,
  -- '' og ikke null: en primaernoegle med en nullable kolonne kan ikke
  -- upserte paa konflikt, og raekker uden kilde ville blive duplikeret.
  "source_slug"  text not null default '',
  "antal"        integer not null,
  "sample_andel" numeric(5,4) not null default 1,
  constraint "haendelser_daglig_pk"
    primary key ("dato","environment","event_name","source_slug")
);
--> statement-breakpoint

-- ── Indekser ────────────────────────────────────────────────────────
-- Hvert indeks koster paa hver insert. Der er fire, og hvert af dem
-- svarer til en foresproergsel i docs/analytics-v1.md afsnit 17. Flere
-- tilfoejes, naar en rapport faktisk er langsom — ikke paa forhaand.

-- Alle tidsserier og taellinger.
create index "haendelser_navn_tid"
  on "haendelser" ("environment", "event_name", "occurred_at" desc);
--> statement-breakpoint
-- Funnel-rekonstruktion pr. session.
create index "haendelser_session"
  on "haendelser" ("session_id", "occurred_at");
--> statement-breakpoint
-- Kildeperformance. Partiel: de fleste events har ingen kilde.
create index "haendelser_kilde"
  on "haendelser" ("source_slug", "event_name", "occurred_at" desc)
  where "source_slug" is not null;
--> statement-breakpoint
-- Oprydningen. Uden den scanner hver time hele tabellen.
create index "haendelser_udloeb" on "haendelser" ("expires_at");
--> statement-breakpoint

-- OBLIGATORISK for hver ny tabel i public. Supabase har ALTER DEFAULT
-- PRIVILEGES, der giver anon og authenticated arwdDxtm paa nye tabeller,
-- og pgrst_ddl_watch eksponerer dem gennem PostgREST uden forsinkelse.
-- Glemmes de fire linjer, er tabellen offentligt laes- OG skrivbar fra
-- det sekund den findes. `npm run tjek:rettigheder` faelder det.
alter table "haendelser" enable row level security;
--> statement-breakpoint
revoke all on "haendelser" from anon, authenticated;
--> statement-breakpoint
alter table "haendelser_daglig" enable row level security;
--> statement-breakpoint
revoke all on "haendelser_daglig" from anon, authenticated;
