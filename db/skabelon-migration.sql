-- ═══════════════════════════════════════════════════════════════
--  SKABELON for en ny migration. Ligger UDEN FOR db/migrations/, så
--  den aldrig forveksles med en rigtig. Kopiér indholdet ind i den fil,
--  drizzle-kit genererer, og slet det, du ikke bruger.
--
--  De to sidste linjer er ikke pynt. Supabase har ALTER DEFAULT
--  PRIVILEGES i skema public, der giver anon og authenticated arwdDxtm
--  — læs, indsæt, opdatér, slet — på enhver NY tabel, og
--  pgrst_ddl_watch eksponerer den gennem PostgREST uden forsinkelse.
--  Glemmer du dem, er tabellen offentligt læs- og skrivbar for enhver
--  med den offentlige nøgle, fra det sekund den findes.
--
--  npm run tjek:rettigheder fanger det. Skabelonen her forhindrer det.
-- ═══════════════════════════════════════════════════════════════

create table "min_nye_tabel" (
  "id" uuid primary key default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now()
);

-- OBLIGATORISK for hver ny tabel i public:
alter table "min_nye_tabel" enable row level security;
revoke all on "min_nye_tabel" from anon, authenticated;
