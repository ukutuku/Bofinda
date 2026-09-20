-- ═══════════════════════════════════════════════════════════════
--  Betalingsmodulet: driftstilstand, abonnementstilstand og
--  idempotens for Stripes webhooks.
--
--  ── Hvorfor en TABEL og ikke en env-variabel ──
--  Tilstanden skal kunne skiftes UDEN ny deployment. En env-variabel
--  paa Vercel kraever et nyt byg for at tage effekt, og en fil i repoet
--  kraever en commit. En raekke i basen kan aendres af ejeren med det
--  samme — enten gennem den beskyttede adminhandling eller direkte i
--  Supabases dashboard.
--
--  ── Hvorfor det IKKE blev `listings.is_blurred` ──
--  Den kolonne findes allerede, skrives altid til `true`, og LAESES
--  aldrig af nogen kodevej, der afgoer noget. BRIEF'en siger, at den
--  «afgoer i API-laget om kontaktfelter returneres»; det er ikke sandt
--  i koden i dag. Det er samme moenster som `sources.enabled`, og
--  CLAUDE.md siger hvorfor det er farligt: en knap, der ikke virker,
--  bruges i en noedsituation. Muren skal staa ét sted, det laeses.
-- ═══════════════════════════════════════════════════════════════

create type "drift_tilstand" as enum ('gratis', 'betaling');

-- Én global raekke. `id` er en boolean med en check-constraint, saa der
-- fysisk ikke KAN staa to raekker: uden den ville «hvilken raekke gaelder»
-- vaere et nyt spoergsmaal, ingen havde svaret paa.
create table "drift" (
  "id" boolean primary key default true,
  "tilstand" "drift_tilstand" not null default 'betaling',
  "aendret_af" uuid references "users"("id"),
  "aendret_at" timestamp with time zone not null default now(),
  "note" text,
  constraint "drift_kun_en_raekke" check ("id")
);

alter table "drift" enable row level security;
revoke all on "drift" from anon, authenticated;

-- Lanceringstilstanden. Kolonnens DEFAULT er 'betaling' med vilje:
-- opstaar raekken nogensinde igen uden at nogen tog stilling, er det
-- sikre udfald at naegte adgang, ikke at give den vaek.
insert into "drift" ("id", "tilstand", "note")
values (true, 'gratis', 'Lancering: muren er slaaet fra.');

-- ── Stripes faktiske statusvaerdier ──────────────────────────
-- Enummet manglede fire af dem. En status, Postgres ikke kender,
-- kaster ved indsaettelse — og saa taber vi en webhook, vi allerede
-- har kvitteret for.
--
-- ── HVORFOR TYPEN GENSKABES I STEDET FOR AT UDVIDES ──
-- `alter type ... add value` ser enklere ud, men en vaerdi tilfoejet
-- saadan kan IKKE BRUGES i den samme transaktion:
--     ERROR: unsafe use of new value "incomplete" of enum type sub_status
--     HINT:  New enum values must be committed before they can be used.
-- `drizzle-kit migrate` koerer alle ventende migrationer i ÉN
-- transaktion, saa det delvist unikke indeks i 0023 — som naevner
-- netop de nye vaerdier — braekkede paa en frisk base. Det var IKKE
-- synligt i PGlite-hjaelperen, som koerer filerne hver for sig.
--
-- `status::text in (...)` loeser det ikke: castet er STABLE, ikke
-- IMMUTABLE, og et indekspraedikat kraever IMMUTABLE.
--
-- En NYOPRETTET type har ikke den begraensning. Derfor: ny type med
-- alle ni vaerdier, kolonnen skiftes over, den gamle type droppes, og
-- den nye overtager navnet. Efterproevet paa en rigtig Postgres:
-- variant A (add value + indeks) fejler, variant B (den her) gaar
-- igennem i samme transaktion.
create type "sub_status_v2" as enum (
  'trialing', 'active', 'past_due', 'canceled', 'expired',
  'incomplete', 'incomplete_expired', 'paused', 'unpaid'
);
alter table "subscriptions"
  alter column "status" type "sub_status_v2" using "status"::text::"sub_status_v2";
drop type "sub_status";
alter type "sub_status_v2" rename to "sub_status";
