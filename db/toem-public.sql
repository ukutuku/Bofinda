-- Tømmer alle tabeller i public. Køres MELLEM migrationerne og dumpet.
--
-- Hvorfor det er nødvendigt: 0013_udlejer.sql indsætter selv kilden
-- 'native' i sources. En base bygget af migrationer er altså ikke tom, og
-- dumpets egen sources-række ville støde ind i den på slug.
--
-- Filen står for sig og ikke inde i dumpet med vilje: et backupfil må
-- kunne køres ved en fejl uden at slette noget. Det her skal man vælge.
--
--   psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f db/toem-public.sql
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('truncate public.%I cascade', t);
  end loop;
end $$;
