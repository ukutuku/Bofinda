-- ═══════════════════════════════════════════════════════════════
--  Adgang til bucket'en `boliger`.
--
--  Bucket'en er PRIVAT og bliver det. Ingen politik giver `anon` noget:
--  en anonym besoegende kan hverken liste eller hente et objekt direkte.
--
--  Vejen ud til laeseren gaar gennem vores egen billedproxy. Ved upload
--  signerer udlejeren selv en langtidsholdbar URL til sin egen fil, og
--  DEN gemmes i listing_images. Proxyen henter den server-side, skalerer
--  og sender WebP videre — praecis som med de hotlinkede kilder. Browseren
--  ser aldrig lager-URL'en.
--
--  Alternativet var en select-politik for `anon`, men saa var bucket'en
--  privat kun af navn.
--
--  Mappen er udlejerens auth-uid. Politikken haandhaever det, saa én
--  udlejer ikke kan skrive i en andens mappe, uanset hvad UI'et sender.
-- ═══════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='boliger: udlejer skriver i egen mappe') then
    create policy "boliger: udlejer skriver i egen mappe"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'boliger' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='boliger: udlejer laeser egen mappe') then
    -- Laeseretten er ogsaa det, der giver ret til at signere en URL.
    create policy "boliger: udlejer laeser egen mappe"
      on storage.objects for select to authenticated
      using (bucket_id = 'boliger' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='boliger: udlejer sletter i egen mappe') then
    create policy "boliger: udlejer sletter i egen mappe"
      on storage.objects for delete to authenticated
      using (bucket_id = 'boliger' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
