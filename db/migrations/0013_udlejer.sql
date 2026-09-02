-- ═══════════════════════════════════════════════════════════════
--  Udlejersiden, fase 4: fundamentet.
--
--  1. `users` binder til Supabase Auth i stedet for at eje adgangskoder.
--     BRIEF: "vi bygger ikke vores egen [auth]". Kolonnen er NULLABLE,
--     fordi alarmens brugere oprettes paa mailadressen alene og aldrig
--     har en konto — de skal ikke tvinges til at faa en.
--
--  2. Kilden `native`. Boliger udlejeren selv opretter, hoerer ikke til
--     nogen adapter og hentes aldrig. Raekken skal findes, fordi
--     listings.source_id er NOT NULL.
-- ═══════════════════════════════════════════════════════════════

alter table "users"
  add column if not exists "auth_user_id" uuid unique;

-- Fremmednoegle til auth-skemaet. Slettes kontoen, beholder vi
-- brugerraekken (gemte soegninger skal ikke forsvinde med den) — derfor
-- set null og ikke cascade.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_auth_user_id_fkey'
  ) then
    alter table "users"
      add constraint "users_auth_user_id_fkey"
      foreign key ("auth_user_id") references auth."users"("id") on delete set null;
  end if;
end $$;

insert into "sources" ("slug", "name", "source_type", "base_url", "enabled")
values ('native', 'Bofinda', 'native', 'https://bofinda.dk', true)
on conflict ("slug") do nothing;
