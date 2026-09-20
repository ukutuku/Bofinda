-- ═══════════════════════════════════════════════════════════════
--  Tredje gennemgangs fund. Det, de har til faelles, er at en
--  UAFKLARET tilstand blev behandlet som afgjort.
--
--  1 · `koeb_status` faar vaerdien 'gennemfoert'.
--      Stripes Checkout Session har TO akser: `status`
--      (open/complete/expired) og `payment_status`
--      (unpaid/paid/no_payment_required). Koden laeste kun den
--      foerste og kaldte `complete` for en doed betalingsside — saa
--      et nyt koeb blev aabnet oven i et, der lige var gennemfoert,
--      og gratis-skiftet meldte alt klar, mens abonnementet levede
--      hos Stripe.
--
--      'gennemfoert' betyder: Stripe siger complete, og vi har IKKE
--      bogfoert abonnementet endnu. Den spaerrer som 'aaben', men af
--      modsat grund — 'aaben' fordi sessionen KAN betales,
--      'gennemfoert' fordi den maaske allerede ER det.
--
--      Den kunne have vaeret baaret paa `stripe_status = 'complete'`
--      uden en migration. Det er fravalgt: `opgivSession` skriver
--      udtrykkeligt en raekke TILBAGE til 'aaben' for at sige «denne
--      session kan stadig betales», og adminteksten siger det samme
--      til ejeren. To betydninger paa én vaerdi er `sources.enabled`
--      om igen — et felt, hvis betydning kun findes i hovedet paa
--      den, der skrev det.
--
--  2 · bindingerne forsoeg → session → abonnement → faktura.
--      Et koebsforsoeg blev lukket paa KUNDE-id alene. En forsinket
--      faktura fra et gammelt, opsagt abonnement lukkede derfor
--      kundens NYE reservation, hvis betalingsside stadig var aaben.
--      Kunde-id er ikke en binding: én kunde kan have et doedt
--      abonnement og et levende koeb samtidig.
--
--  3 · `stripe_events.naeste_forsoeg_at` — koeen maa ikke udsultes.
--      Tilsynet tog altid de 50 AELDSTE ubehandlede. Femoghalvtreds
--      haendelser, hvis forudsaetning aldrig kommer, spaerrede derfor
--      den 51., som var klar. Samme svar som `fetch_failures`:
--      en naeste-forsoegstid med tilbagetraekning.
--
--  4 · `subscriptions.fornyelse_stoppet_*` — beskyttelsen mod at
--      forny paa vilkaar, vi ikke kan levere. En plan i 'fejlet'
--      stopper ingen opkraevning hos Stripe; en loglinje er ikke en
--      beskyttelse. Naar planen ikke kan bekraeftes inden
--      doegnfornyelsen, slippes den og fornyelsen stoppes — og HER
--      staar det, saa det kan ses og laves om.
-- ═══════════════════════════════════════════════════════════════

-- ── 1 · enumvaerdien ──────────────────────────────────────────
-- `alter type ... add value` kan IKKE bruges: drizzle-kit koerer alle
-- ventende migrationer i ÉN transaktion, og en vaerdi tilfoejet med
-- `add value` kan ikke bruges i samme transaktion. Indeksets praedikat
-- naevner netop den nye vaerdi. Typen genskabes derfor — samme
-- moenster som 0021, og af samme grund.
--
-- Raekkefoelgen er ikke valgfri: indekset hænger paa den GAMLE type og
-- skal droppes foerst; defaulten ligeledes.
drop index if exists "checkout_en_aaben_pr_bruger";

alter table "checkout_forsoeg" alter column "status" drop default;

create type "koeb_status_v2" as enum (
  'aaben', 'gennemfoert', 'betalt', 'udloebet', 'afbrudt'
);
alter table "checkout_forsoeg"
  alter column "status" type "koeb_status_v2" using "status"::text::"koeb_status_v2";
drop type "koeb_status";
alter type "koeb_status_v2" rename to "koeb_status";

alter table "checkout_forsoeg" alter column "status" set default 'aaben';

-- ÉN UAFSLUTTET reservation pr. konto — begge spaerrende tilstande.
-- Vagten skal ligge i BASEN og ikke kun i koden: to samtidige
-- forespoergsler kan ikke se hinandens ucommittede raekker, og kun et
-- unikt indeks kan afgoere det.
create unique index "checkout_uafsluttet_pr_bruger"
  on "checkout_forsoeg" ("user_id")
  where "status" in ('aaben', 'gennemfoert');

-- ── 2 · bindingerne ───────────────────────────────────────────
alter table "checkout_forsoeg"
  -- Hvilket abonnement sessionen blev til. Oplyst af sessionen selv.
  add column "stripe_subscription_id" text,
  -- Stripes ANDEN akse. Gemmes kun naar vi har faaet den bekraeftet.
  add column "stripe_payment_status" text,
  -- Hvornaar forsoeget blev afstemt med sit abonnement.
  add column "afstemt_at" timestamp with time zone;

-- Afstemningen slaar op paa abonnementet; koeb er faa, men opslaget
-- sker i hver tilsynskoersel.
create index "checkout_sub_idx"
  on "checkout_forsoeg" ("stripe_subscription_id")
  where "stripe_subscription_id" is not null;

-- ── 3 · koeens naeste-forsoegstid ─────────────────────────────
alter table "stripe_events"
  add column "naeste_forsoeg_at" timestamp with time zone;

-- Udvaelgelsen spoerger «hvilke ubehandlede er klar NU» hver time.
create index "stripe_events_naeste_forsoeg_idx"
  on "stripe_events" ("naeste_forsoeg_at")
  where "behandlet_at" is null;

-- ── 4 · beskyttelsen mod forkert fornyelse ────────────────────
alter table "subscriptions"
  add column "fornyelse_stoppet_at" timestamp with time zone,
  add column "fornyelse_stoppet_grund" text;
