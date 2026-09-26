-- ═══════════════════════════════════════════════════════════════
--  Adgang til bucket'en `boliger`.
--
--  Bucket'en er PRIVAT og bliver det. Ingen politik giver `anon` noget:
--  med den offentlige noegle kan en anonym besoegende hverken liste
--  bucket'en eller hente et objekt. En SIGNERET URL er noget andet — se
--  nedenfor.
--
--  Vejen ud til laeseren gaar gennem vores egen billedproxy. Ved upload
--  signerer udlejeren selv en langtidsholdbar URL til sin egen fil, og
--  DEN gemmes i listing_images. Proxyen henter den server-side, skalerer
--  og sender WebP videre — praecis som med de hotlinkede kilder.
--
--  ⚠ BROWSEREN SER LAGER-URL'EN. Her stod foer det modsatte, og det var
--  forkert fra foerste dag. `billedUrl()` i lib/billede.ts sender den raa
--  URL med til proxyen som parameteren `u`, saa den fulde signerede URL —
--  tokenet, der gaelder i ti aar, og udlejerens auth-uid som mappenavn —
--  staar i HTML'en paa hvert kort og hver boligside. Et signeret link er
--  et baererbevis: politikkerne herunder ser det ikke, og enhver kan hente
--  filen direkte hos Supabase med det, uden om proxyen, til det udloeber.
--  At kommentaren sagde andet, er grunden til, at ingen saa, at en udlejer
--  kunne kopiere en andens URL ind i sin egen annonce.
--
--  Forskellen til en select-politik for `anon` er derfor mindre end den
--  lyder: filer, der er brugt i en annonce, er i praksis offentlige. Det,
--  bucket'en stadig beskytter, er listningen og de filer, der aldrig blev
--  vist — uploads fra en formular, der ikke blev gemt, og billeder, en
--  udlejer har fjernet igen.
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
