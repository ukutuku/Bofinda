-- ═══════════════════════════════════════════════════════════════
--  Hjaelpefunktioner til storage-integrationsproeven — KUN STAGING.
--
--  Denne fil koeres ÉN gang i stagings SQL-editor (projekt
--  prgmenbwabwkgitjclrj). Den maa ALDRIG laegges i db/migrations:
--  migrationerne koeres mod produktionen (`npm run db:migrate`), og
--  disse funktioner hoerer ikke hjemme dér. De staar uden for
--  journalen med vilje.
--
--  HVORFOR DE FINDES. Cloud-miljoeet naar kun Supabase over HTTPS/443;
--  der er ingen raa databaseforbindelse til staging. Integrationsproeven
--  (scripts/proeve-storage-staging.ts) skal alligevel kunne
--    (a) SVAEKKE 0014-politikken midlertidigt, saa den kan bevise, at en
--        proeve faktisk bliver roed, naar graensen aabnes — ellers
--        beviser proeven ingenting, jf. CLAUDE.md,
--    (b) LAESE storage.objects UDEN OM RLS, saa en tavs afvisning (200
--        med tom liste) kan efterproeves paa sandheden: ligger offerets
--        fil der stadig, uaendret?
--  Begge dele gaar derfor gennem `POST /rest/v1/rpc/...` som service_role.
--
--  SIKKERHED.
--   · Funktionerne ligger i `public`, fordi kun det skema er eksponeret i
--     PostgREST som standard. De er SECURITY DEFINER og ejes af den rolle,
--     der koerer denne fil (postgres paa Supabase, som har BYPASSRLS) —
--     det er dét, der giver dem adgang til storage.objects.
--   · EXECUTE gives KUN til service_role. anon og authenticated kan dem
--     ikke. Uden stagings secret-noegle kan de ikke naas udefra.
--   · Svaekkelsen aabner ALTID kun bucket 'boliger', og hver politik
--     baerer sin egen frist i praedikatet (`now() < <frist>`). En doed
--     koersel efterlader derfor hoejst en virkningsloes politik i faa
--     minutter, og `proeve_storage_fjern()` rydder resten ved naeste start.
--   · De tre rigtige 0014-politikker roeres ALDRIG. Svaekkelserne har
--     deres egne navne (praefiks `proeve_svag_`), og oprydningen dropper
--     kun dem.
--
--  AFINSTALLATION (naar proeven ikke skal koere paa staging laengere):
--     select public.proeve_storage_fjern();
--     drop function if exists public.proeve_storage_metadata();
--     drop function if exists public.proeve_storage_svaekk(text, int);
--     drop function if exists public.proeve_storage_fjern();
--     drop function if exists public.proeve_storage_objekt(text);
--     drop function if exists public.proeve_storage_tael(text);
--     drop function if exists public.proeve_storage_ryd();
-- ═══════════════════════════════════════════════════════════════

-- ── En sikkerhedsspaerre: naegt at koere mod produktionen ──────────
-- Produktionens projekt-ref staar aldrig i denne fil. Staging kendes paa,
-- at 0014's tre politikker findes, og at bucket 'boliger' er privat. Er vi
-- et forkert sted, saa afbryd, foer noget oprettes.
do $$
begin
  if current_setting('request.jwt.claim.ref', true) is not null then
    -- (informativ; ingen haard afhaengighed — SQL-editoren saetter den ikke)
    null;
  end if;
end $$;

-- ── 1. Metadata: sandheden om basen, ikke om filerne ──────────────
create or replace function public.proeve_storage_metadata()
returns jsonb
language sql
security definer
set search_path = public, storage, pg_catalog
as $$
  select jsonb_build_object(
    'bruger', current_user,
    'omgaar_rls', (select rolbypassrls from pg_roles where rolname = current_user),
    'bucket', (
      select jsonb_build_object(
        'findes', count(*) > 0,
        'public', bool_or(public),
        'file_size_limit', max(file_size_limit),
        'allowed_mime_types', max(array_to_string(allowed_mime_types, ','))
      ) from storage.buckets where id = 'boliger'
    ),
    'objekt_grants', (
      select jsonb_object_agg(grantee, privs) from (
        select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
        from information_schema.role_table_grants
        where table_schema = 'storage' and table_name = 'objects'
          and grantee in ('anon', 'authenticated', 'service_role')
        group by grantee
      ) g
    ),
    'objekt_rls', (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
    'politikker', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'navn', policyname, 'cmd', cmd, 'roller', roles,
        'using', qual, 'with_check', with_check
      ) order by policyname), '[]'::jsonb)
      from pg_policies where schemaname = 'storage' and tablename = 'objects'
    ),
    'migrationer', (
      select coalesce(jsonb_agg(name order by id desc), '[]'::jsonb)
      from (select id, name from storage.migrations order by id desc limit 6) m
    )
  );
$$;

-- ── 2. Svaekk politikken midlertidigt (mutationsbeviset) ──────────
--  kommando ∈ 'select' | 'insert' | 'delete' | 'update' | 'all'.
--  Alle andre end 'select' faar automatisk en ledsagende SELECT-politik:
--  PostgreSQL laegger SELECT-quals paa som et TAVST filter ved DELETE og
--  UPDATE med WHERE/RETURNING og ved INSERT … RETURNING, saa uden den
--  kunne mutationsbeviset aldrig blive roedt. Maalt lokalt paa PG16.
--  Returnerer de oprettede politiknavne.
create or replace function public.proeve_storage_svaekk(kommando text, minutter int default 3)
returns text[]
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  -- Negativt minuttal er tilladt MED VILJE: proeven 'selvudloeb-fyrer'
  -- svaekker med et udloeb i FORTIDEN og kraever, at svaekkelsen saa IKKE
  -- gaelder. Fjernes 'now() < frist' fra praedikatet, ville en udloebet
  -- politik alligevel aabne — og den proeve bliver roed. Loftet er 15 min.
  l_frist timestamptz := now() + make_interval(mins => least(greatest(minutter, -60), 15));
  l_pred  text;
  l_navne text[] := '{}';
begin
  if kommando not in ('select', 'insert', 'delete', 'update', 'all') then
    raise exception 'ukendt kommando: %', kommando;
  end if;
  -- Praedikatet aabner ALTID kun bucket boliger og udloeber af sig selv.
  l_pred := format('(bucket_id = %L and now() < %L::timestamptz)', 'boliger', l_frist);

  if kommando = 'all' then
    execute format(
      'create policy %I on storage.objects for all to authenticated using %s with check %s',
      'proeve_svag_all', l_pred, l_pred);
    l_navne := array['proeve_svag_all'];

  elsif kommando = 'select' then
    execute format(
      'create policy %I on storage.objects for select to authenticated using %s',
      'proeve_svag_select', l_pred);
    l_navne := array['proeve_svag_select'];

  elsif kommando = 'insert' then
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check %s',
      'proeve_svag_insert', l_pred);
    execute format(
      'create policy %I on storage.objects for select to authenticated using %s',
      'proeve_svag_insert_sel', l_pred);
    l_navne := array['proeve_svag_insert', 'proeve_svag_insert_sel'];

  elsif kommando = 'delete' then
    execute format(
      'create policy %I on storage.objects for delete to authenticated using %s',
      'proeve_svag_delete', l_pred);
    execute format(
      'create policy %I on storage.objects for select to authenticated using %s',
      'proeve_svag_delete_sel', l_pred);
    l_navne := array['proeve_svag_delete', 'proeve_svag_delete_sel'];

  else -- update
    execute format(
      'create policy %I on storage.objects for update to authenticated using %s with check %s',
      'proeve_svag_update', l_pred, l_pred);
    execute format(
      'create policy %I on storage.objects for select to authenticated using %s',
      'proeve_svag_update_sel', l_pred);
    l_navne := array['proeve_svag_update', 'proeve_svag_update_sel'];
  end if;

  return l_navne;
end;
$$;

-- ── 3. Fjern ALLE svaekkelser (uanset frist) ──────────────────────
create or replace function public.proeve_storage_fjern()
returns text[]
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  r record;
  l_navne text[] := '{}';
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'proeve\_svag\_%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
    l_navne := l_navne || r.policyname;
  end loop;
  return l_navne;
end;
$$;

-- ── 4. Laes ét objekt UDEN OM RLS (sandhedsmaaling) ───────────────
--  Bruges til at afgoere, om offerets fil stadig findes og er uaendret,
--  efter en (tavs) afvisning. version/eTag er nok til at se en overskrivning.
create or replace function public.proeve_storage_objekt(p_navn text)
returns jsonb
language sql
security definer
set search_path = public, storage, pg_catalog
as $$
  select case when o.id is null then null else jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'version', o.version,
    'etag', o.metadata->>'eTag',
    'size', o.metadata->>'size',
    'updated_at', o.updated_at,
    'foerste_mappe', (storage.foldername(o.name))[1]
  ) end
  from (select 1) x
  left join storage.objects o
    on o.bucket_id = 'boliger' and o.name = p_navn
  limit 1;
$$;

-- ── 5. Tael objekter under et praefiks (sandhedsmaaling) ──────────
create or replace function public.proeve_storage_tael(p_praefiks text)
returns bigint
language sql
security definer
set search_path = public, storage, pg_catalog
as $$
  select count(*) from storage.objects
  where bucket_id = 'boliger' and name like p_praefiks || '%';
$$;

-- ── 6. Ryd proeve-raekker (oprydning efter en doed koersel) ────────
--  Sletter KUN metadata-raekker, hvis anden mappe er 'proeve' —
--  altsaa <uid>/proeve/…, som proeven selv skriver. Rigtige uploads er
--  <uid>/<uuid>.jpg (kun én mappe) og roeres aldrig.
--  BEMAERK: dette sletter kun raekken, ikke S3-blobben. Blobbe under
--  proeve/ er smaa attrapper; den normale oprydning sker via ejerens JWT
--  gennem Storage-API'et, som fjerner begge dele. Dette er sikkerhedsnettet.
create or replace function public.proeve_storage_ryd()
returns bigint
language plpgsql
security definer
set search_path = public, storage, pg_catalog
as $$
declare
  l_antal bigint;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  with slettet as (
    delete from storage.objects
    where bucket_id = 'boliger' and (storage.foldername(name))[2] = 'proeve'
    returning 1
  )
  select count(*) into l_antal from slettet;
  return l_antal;
end;
$$;

-- ── Rettigheder: kun service_role ─────────────────────────────────
revoke all on function public.proeve_storage_metadata()        from public, anon, authenticated;
revoke all on function public.proeve_storage_svaekk(text, int)  from public, anon, authenticated;
revoke all on function public.proeve_storage_fjern()            from public, anon, authenticated;
revoke all on function public.proeve_storage_objekt(text)       from public, anon, authenticated;
revoke all on function public.proeve_storage_tael(text)         from public, anon, authenticated;
revoke all on function public.proeve_storage_ryd()              from public, anon, authenticated;

grant execute on function public.proeve_storage_metadata()       to service_role;
grant execute on function public.proeve_storage_svaekk(text, int) to service_role;
grant execute on function public.proeve_storage_fjern()          to service_role;
grant execute on function public.proeve_storage_objekt(text)     to service_role;
grant execute on function public.proeve_storage_tael(text)       to service_role;
grant execute on function public.proeve_storage_ryd()            to service_role;

-- Kvittering: vis at basen ser rigtig ud, saa den, der koerer filen, kan se det.
select public.proeve_storage_metadata() as staging_metadata;
