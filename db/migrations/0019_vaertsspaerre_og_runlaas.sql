-- ═══════════════════════════════════════════════════════════════
--  Crawler-tilstand paa tvaers af processer.
--
--  Railway-runs og den lokale launchd-import koerer i FORSKELLIGE
--  processer. Baade vaertsspaerren (429/503) og overlap-vaernet laa i
--  process memory og beskyttede derfor intet paa tvaers. Begge flyttes
--  til basen — den ene faelles tilstand, alle runnere allerede deler.
--
--  Haandskrevet: snapshots i meta/ slutter ved 0012, saa drizzle-kit
--  generate ville diffe mod en foraeldet tilstand. Samme fremgangsmaade
--  som 0018.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Strandede koersler lukkes, foer laasen anlaegges ──────────
-- Samme semantik som lukStrandede() i lib/ingest.ts: en 'running'-raekke
-- aeldre end 30 minutter er en proces, der blev draebt midt i. Uden det
-- her ville en enkelt strandet raekke blokere sin kilde for evigt, saa
-- snart det unikke indeks findes.
update "crawl_runs"
set "status" = 'failed',
    "finished_at" = now(),
    "notes" = coalesce("notes" || E'\n', '') ||
      'Lukket af migration 0019: strandet running-række før run-låsen.'
where "status" = 'running'
  and "started_at" < now() - interval '30 minutes';
--> statement-breakpoint

-- ── 2. Run-laasen ───────────────────────────────────────────────
-- Selve INSERT af 'running'-raekken ER laasen: to samtidige koersler mod
-- samme kilde kan ikke begge vinde. Erstatter et select-derefter-insert,
-- som havde et vindue imellem.
--
-- Partielt med vilje: kun ÉN aktiv koersel pr. kilde, men ubegraenset
-- historik af afsluttede.
create unique index "crawl_runs_one_running"
  on "crawl_runs" ("source_id")
  where "status" = 'running';
--> statement-breakpoint

-- ── 3. Vaertsspaerren ───────────────────────────────────────────
-- Naar en vaert svarer 429/503, holder vi op med at kalde den. Tilstanden
-- skal overleve processen: den lokale import starter en FRISK proces hver
-- time, og Railway genstarter ved deploy.
--
-- Noeglen er (runner, host), ikke host alene. En blokering hoerer til den
-- egress, der faktisk blev droevlet — Mac og Railway gaar ud ad hver sin
-- IP, og en blok set det ene sted siger intet om det andet. Runnere med
-- SAMME identitet (launchd-importen og en manuel koersel paa samme
-- maskine) deler derimod baade IP og blok, og det er praecis rigtigt.
create table "host_blocks" (
  "runner" text not null,
  "host" text not null,
  -- Foer dette tidspunkt kaldes vaerten ikke. Forlaenges kun opad, aldrig
  -- nedad — se GREATEST i lib/vaertsspaerre.ts.
  "blocked_until" timestamptz not null,
  -- Hvad der udloeste den. Fri tekst til drift.
  "reason" text,
  -- Hvor mange koersler spaerren har sprunget over. Uden det er
  -- «blokeret» og «scheduleren er doed» ikke til at skelne i basen.
  "skip_count" integer not null default 0,
  "last_skipped_at" timestamptz,
  "updated_at" timestamptz not null default now(),
  constraint "host_blocks_pkey" primary key ("runner", "host")
);
--> statement-breakpoint

-- Ny tabel = RLS i samme migration. Se reglen i CLAUDE.md.
--
-- Uden revoke ville enhver med den offentlige noegle kunne saette
-- blocked_until = '2099-01-01' for alle vaerter og standse hele crawleren.
-- Importoeren koerer som ejer og gaar uden om RLS, saa der er ingen
-- politik at skrive.
alter table "host_blocks" enable row level security;
--> statement-breakpoint
revoke all on "host_blocks" from anon, authenticated;
