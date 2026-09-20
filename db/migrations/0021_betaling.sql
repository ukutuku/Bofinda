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
alter type "sub_status" add value if not exists 'incomplete';
alter type "sub_status" add value if not exists 'incomplete_expired';
alter type "sub_status" add value if not exists 'paused';
alter type "sub_status" add value if not exists 'unpaid';
