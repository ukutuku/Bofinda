-- ═══════════════════════════════════════════════════════════════
--  Gennemgangens ni fund. Det, de har til faelles, er at en
--  HALVFAERDIG tilstand ikke kunne goeres faerdig bagefter.
--
--  1 · `stripe_events.nyttelast` — haendelsen gemmes.
--      Ruten svarede 200 paa `afventer`, men der var INTET at
--      genbehandle: kun id, type og tidsstempel blev gemt, aldrig
--      selve payloaden. En kvittering uden en koe bag sig er en
--      kvittering for noget, ingen kan tage op igen. Nu gemmes
--      payloaden, og `behandlUbehandlede()` kan koere den om.
--
--      Kolonnen baerer en ALLOWLIST, ikke hele Stripe-objektet — se
--      `kunDetViLaeser` i lib/webhook.ts. Stripes haendelser rummer
--      kundens navn, mail, faktureringsadresse og kortets sidste fire
--      cifre; vi laeser ingen af dem og gemmer dem derfor heller ikke.
--      Vaerdien saettes til null igen, naar haendelsen er faerdig.
--
--  2 · `checkout_forsoeg.stripe_session_id` maa vaere NULL.
--      Reservationen blev skrevet EFTER Stripe-kaldet, saa noeglen
--      ikke kunne bindes til forsoeget — og taberen af et kaploeb
--      lukkede vinderens session. Nu reserveres FOERST, og raekkens
--      eget id er idempotensnoeglen. Sessionen skrives bagefter.
--
--  3 · `checkout_forsoeg.stripe_status` og `lukke_fejl` — vi
--      bogfoerer kun en lukning, Stripe har bekraeftet.
-- ═══════════════════════════════════════════════════════════════

alter table "stripe_events"
  add column "nyttelast" jsonb;

alter table "checkout_forsoeg"
  alter column "stripe_session_id" drop not null,
  add column "stripe_status" text,
  add column "lukke_fejl" text,
  add column "lukke_forsoeg" integer not null default 0;

-- Unikheden skal stadig gaelde, men kun naar der ER et session-id.
--
-- BEGGE NAVNE STAAR HER, og det er ikke en gardering paa maa og faa.
-- 0024 skrev `"stripe_session_id" text not null unique` som en INLINE
-- begraensning, og PostgreSQL navngiver den selv:
-- `checkout_forsoeg_stripe_session_id_key`. Drizzles egen `.unique()`
-- ville have givet `..._unique`. Foerste udgave af den her migration
-- droppede kun `_unique` — og saa BLEV den gamle begraensning staaende,
-- mens migrationen sagde, at den var vaek. Efterproevet paa en frisk
-- base: `pg_constraint` havde stadig `..._key` bagefter.
--
-- En begraensning, der overlever sin egen afskaffelse, er praecis den
-- slags, ingen opdager: `unique` paa en nullbar kolonne tillader mange
-- NULL'er, saa den ville ikke fejle paa noget — den ville bare vaere en
-- anden regel end den, der staar her.
drop index if exists "checkout_forsoeg_stripe_session_id_unique";
alter table "checkout_forsoeg"
  drop constraint if exists "checkout_forsoeg_stripe_session_id_unique";
alter table "checkout_forsoeg"
  drop constraint if exists "checkout_forsoeg_stripe_session_id_key";
create unique index "checkout_session_unik"
  on "checkout_forsoeg" ("stripe_session_id")
  where "stripe_session_id" is not null;
