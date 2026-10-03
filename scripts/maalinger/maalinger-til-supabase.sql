-- ═══════════════════════════════════════════════════════════════
-- B1 · Bynavne: hvor ofte afgør collationen, hvad et postnummer hedder?
--
-- Kun SELECT. Én række pr. sæt.
--
-- Navnet er den hyppigste stavemåde (`bynavn()` i lib/omraade.ts, mode()).
-- Står to stavemåder LIGE øverst, vinder den, der sorterer først under
-- basens collation — her en_US. Ingen har valgt den orden til formålet.
--   · synlige: navnet på postnummersiden og i dens meta-beskrivelse.
--   · alle rækker: byForPostnr — det bynavn, en udlejerannonce får GEMT.
--     Udlejerannoncerne stemmer selv med, også de afmeldte.
-- «dansk_ville_vaelge_andet» og «testbasen_vaelger_andet» tæller kun de
-- uafgjorte; uden uafgjort vælger alle collationer det samme.
-- ═══════════════════════════════════════════════════════════════
with
synlige_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ((("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed') and not "listings"."id" in (
    select d.id from (
      select "listings"."id" as id,
        row_number() over (
          partition by case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end
          order by
            -- Kildens annonce foer udlejerens — se UDLEJERANNONCE.
            ("listings"."source_type" is not distinct from 'native') asc,
            -- UNIKKE billeder, ikke raekker — se UNIKKE_BILLEDER.
            (select count(distinct i.external_url)::int
  from listing_images i where i.listing_id = "listings".id and substring(i.external_url from '^https?://([^/?#]+)') = any(array['app.propstep.com', 'findbolig.nu', 'dacas.dk', 'lokalbolig.io', 'images.ctfassets.net', 'alvis.b-cdn.net', 'home.mindworking.eu', 'boligio-media-production.s3.eu-central-1.amazonaws.com', 'hos.laros.dk', 'boligspot.b-cdn.net', 'birchejendomme.dk', 'alabubolig.dk']::text[])) desc,
            ("listings"."total_monthly" is not null) desc,
            "listings"."id"
        ) as rn
      from "listings"
      inner join "sources" on "sources"."id" = "listings"."source_id"
      where ("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed')
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end in (
          select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end from "listings"
          where "listings"."status" = 'active' and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1)) and "listings"."postal_code" is not null)),
synlige_stave as (
  select postnr, bynavn, count(*) as n from synlige_raekker where bynavn is not null group by postnr, bynavn),
synlige_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from synlige_raekker group by postnr),
synlige_top as (
  select postnr, max(n) as top, count(*) as stavemaader from synlige_stave group by postnr),
synlige_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from synlige_stave s join synlige_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr),
alle_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ("listings"."city" is not null and "listings"."postal_code" is not null)),
alle_stave as (
  select postnr, bynavn, count(*) as n from alle_raekker where bynavn is not null group by postnr, bynavn),
alle_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from alle_raekker group by postnr),
alle_top as (
  select postnr, max(n) as top, count(*) as stavemaader from alle_stave group by postnr),
alle_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from alle_stave s join alle_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr)
select 'synlige — områdesidernes navn' as saet,
  (select count(*) from synlige_top) as postnumre,
  (select count(*) from synlige_top where stavemaader >= 2) as med_flere_stavemaader,
  (select count(*) from synlige_lige where lige >= 2) as med_uafgjort_oeverst,
  (select count(*) from synlige_lige l join synlige_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and (v.vinder_produktion collate "C" is distinct from v.vinder_dansk collate "C")) as dansk_ville_vaelge_andet,
  (select count(*) from synlige_lige l join synlige_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and (v.vinder_produktion collate "C" is distinct from v.vinder_testbasen collate "C")) as testbasen_vaelger_andet
union all
select 'alle rækker — byForPostnr, det udlejeren får gemt' as saet,
  (select count(*) from alle_top) as postnumre,
  (select count(*) from alle_top where stavemaader >= 2) as med_flere_stavemaader,
  (select count(*) from alle_lige where lige >= 2) as med_uafgjort_oeverst,
  (select count(*) from alle_lige l join alle_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and (v.vinder_produktion collate "C" is distinct from v.vinder_dansk collate "C")) as dansk_ville_vaelge_andet,
  (select count(*) from alle_lige l join alle_vinder v on v.postnr = l.postnr
    where l.lige >= 2 and (v.vinder_produktion collate "C" is distinct from v.vinder_testbasen collate "C")) as testbasen_vaelger_andet;


-- ═══════════════════════════════════════════════════════════════
-- B2 · De uafgjorte postnumre, én række hver.
--
-- Kun SELECT. Én række pr. postnummer, hvor to eller flere stavemåder
-- står LIGE øverst — i hvert af de to sæt fra B1.
--
-- «vinder_i_dag» er det, produktionen viser og gemmer nu. «vinder_dansk»
-- er samme udtryk med collate "da-x-icu"; «vinder_i_testbasen» med "C",
-- som PGlite bruger. Er de tre ens, er uafgjortheden uden følger i dag.
-- ═══════════════════════════════════════════════════════════════
with
synlige_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ((("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed') and not "listings"."id" in (
    select d.id from (
      select "listings"."id" as id,
        row_number() over (
          partition by case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end
          order by
            -- Kildens annonce foer udlejerens — se UDLEJERANNONCE.
            ("listings"."source_type" is not distinct from 'native') asc,
            -- UNIKKE billeder, ikke raekker — se UNIKKE_BILLEDER.
            (select count(distinct i.external_url)::int
  from listing_images i where i.listing_id = "listings".id and substring(i.external_url from '^https?://([^/?#]+)') = any(array['app.propstep.com', 'findbolig.nu', 'dacas.dk', 'lokalbolig.io', 'images.ctfassets.net', 'alvis.b-cdn.net', 'home.mindworking.eu', 'boligio-media-production.s3.eu-central-1.amazonaws.com', 'hos.laros.dk', 'boligspot.b-cdn.net', 'birchejendomme.dk', 'alabubolig.dk']::text[])) desc,
            ("listings"."total_monthly" is not null) desc,
            "listings"."id"
        ) as rn
      from "listings"
      inner join "sources" on "sources"."id" = "listings"."source_id"
      where ("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed')
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end in (
          select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end from "listings"
          where "listings"."status" = 'active' and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1)) and "listings"."postal_code" is not null)),
synlige_stave as (
  select postnr, bynavn, count(*) as n from synlige_raekker where bynavn is not null group by postnr, bynavn),
synlige_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from synlige_raekker group by postnr),
synlige_top as (
  select postnr, max(n) as top, count(*) as stavemaader from synlige_stave group by postnr),
synlige_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from synlige_stave s join synlige_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr),
alle_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ("listings"."city" is not null and "listings"."postal_code" is not null)),
alle_stave as (
  select postnr, bynavn, count(*) as n from alle_raekker where bynavn is not null group by postnr, bynavn),
alle_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from alle_raekker group by postnr),
alle_top as (
  select postnr, max(n) as top, count(*) as stavemaader from alle_stave group by postnr),
alle_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from alle_stave s join alle_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr)
select 'synlige' as saet, l.postnr, t.stavemaader, l.lige_stavemaader as lige_oeverst,
  l.hver as boliger_hver, v.vinder_produktion as vinder_i_dag, v.vinder_dansk,
  v.vinder_testbasen as vinder_i_testbasen
from synlige_lige l join synlige_top t on t.postnr = l.postnr join synlige_vinder v on v.postnr = l.postnr
where l.lige >= 2
union all
select 'alle' as saet, l.postnr, t.stavemaader, l.lige_stavemaader as lige_oeverst,
  l.hver as boliger_hver, v.vinder_produktion as vinder_i_dag, v.vinder_dansk,
  v.vinder_testbasen as vinder_i_testbasen
from alle_lige l join alle_top t on t.postnr = l.postnr join alle_vinder v on v.postnr = l.postnr
where l.lige >= 2
order by 1 desc, 2;


-- ═══════════════════════════════════════════════════════════════
-- B3 · Udlejernes GEMTE bynavne i postnumre med flere stavemåder.
--
-- Kun SELECT. Én række pr. (postnummer, gemt bynavn).
--
-- `byForPostnr` kører, når udlejeren gemmer, og resultatet bliver LIGGENDE
-- i listings.city — det er det, bysøgningen og områdesiderne filtrerer på.
-- En rettelse af koden ændrer kun FREMTIDIGE gem. Rækker, der allerede
-- står her med et andet navn end den rettede regel ville give, skal
-- skrives om af en migration.
--
-- FORBEHOLD: «gemt_er_dagens_vinder» sammenligner med vinderen I DAG. Ved
-- gemningen kan grundlaget have været et andet, så en uoverensstemmelse
-- kan skyldes, at bestanden har flyttet sig — ikke collationen. Og
-- udlejerannoncerne stemmer selv med i grundlaget.
-- ═══════════════════════════════════════════════════════════════
with
synlige_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ((("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed') and not "listings"."id" in (
    select d.id from (
      select "listings"."id" as id,
        row_number() over (
          partition by case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end
          order by
            -- Kildens annonce foer udlejerens — se UDLEJERANNONCE.
            ("listings"."source_type" is not distinct from 'native') asc,
            -- UNIKKE billeder, ikke raekker — se UNIKKE_BILLEDER.
            (select count(distinct i.external_url)::int
  from listing_images i where i.listing_id = "listings".id and substring(i.external_url from '^https?://([^/?#]+)') = any(array['app.propstep.com', 'findbolig.nu', 'dacas.dk', 'lokalbolig.io', 'images.ctfassets.net', 'alvis.b-cdn.net', 'home.mindworking.eu', 'boligio-media-production.s3.eu-central-1.amazonaws.com', 'hos.laros.dk', 'boligspot.b-cdn.net', 'birchejendomme.dk', 'alabubolig.dk']::text[])) desc,
            ("listings"."total_monthly" is not null) desc,
            "listings"."id"
        ) as rn
      from "listings"
      inner join "sources" on "sources"."id" = "listings"."source_id"
      where ("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed')
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end in (
          select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end from "listings"
          where "listings"."status" = 'active' and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1)) and "listings"."postal_code" is not null)),
synlige_stave as (
  select postnr, bynavn, count(*) as n from synlige_raekker where bynavn is not null group by postnr, bynavn),
synlige_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from synlige_raekker group by postnr),
synlige_top as (
  select postnr, max(n) as top, count(*) as stavemaader from synlige_stave group by postnr),
synlige_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from synlige_stave s join synlige_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr),
alle_raekker as (select "postal_code" as "postnr", "city" as "bynavn" from "listings" where ("listings"."city" is not null and "listings"."postal_code" is not null)),
alle_stave as (
  select postnr, bynavn, count(*) as n from alle_raekker where bynavn is not null group by postnr, bynavn),
alle_vinder as (
  select postnr,
    mode() within group (order by bynavn) as vinder_produktion,
    mode() within group (order by bynavn collate "da-x-icu") as vinder_dansk,
    mode() within group (order by bynavn collate "C") as vinder_testbasen
  from alle_raekker group by postnr),
alle_top as (
  select postnr, max(n) as top, count(*) as stavemaader from alle_stave group by postnr),
alle_lige as (
  select s.postnr, count(*) as lige, max(s.n) as hver,
         string_agg(s.bynavn, ' | ' order by s.bynavn collate "C") as lige_stavemaader
  from alle_stave s join alle_top t on t.postnr = s.postnr and s.n = t.top
  group by s.postnr),
gemte as (select "postal_code" as "postnr", "city" as "gemt_by", ("status" = 'active') as "aktiv" from "listings" where ("listings"."source_type" = 'native' and "listings"."postal_code" is not null))
select g.postnr, g.gemt_by, count(*) as udlejerannoncer,
  count(*) filter (where g.aktiv) as heraf_aktive,
  (l.lige >= 2) as uafgjort_oeverst_i_dag, l.lige_stavemaader as lige_oeverst,
  v.vinder_produktion as vinder_i_dag, v.vinder_dansk,
  (g.gemt_by collate "C" = v.vinder_produktion collate "C") as gemt_er_dagens_vinder,
  (v.vinder_produktion collate "C" is distinct from v.vinder_dansk collate "C") as dansk_ville_vaelge_andet
from gemte g
join alle_top t on t.postnr = g.postnr
join alle_lige l on l.postnr = g.postnr
join alle_vinder v on v.postnr = g.postnr
where t.stavemaader >= 2
group by g.postnr, g.gemt_by, l.lige, l.lige_stavemaader, v.vinder_produktion, v.vinder_dansk
order by 1, 2;


-- ═══════════════════════════════════════════════════════════════
-- D1 · Domænefiltre: hvor mange boliger KAN tabe, fordi repræsentanten
-- ikke passer, mens en anden annonce for samme bolig gør?
--
-- Kun SELECT. Én række.
--
-- Overtagelse, ansøgningsform og markedsstatus afgøres i JS, på
-- repræsentanten, efter SQL har valgt den. Passer den ikke, vælges ingen
-- afløser — boligen forsvinder fra søgningen.
--
-- FORBEHOLD: SQL kan ikke afgøre domænet. Det kræver kildekontrakten og
-- tidspunktet nu (lib/availability.ts), og en kopi i SQL ville være et
-- andet udtryk for det samme. Tallet her er derfor en ØVRE GRÆNSE: boliger,
-- hvis annoncer har forskellig kontrakt eller forskellige fakta, og altså
-- KAN stå på hver sin side af et filter. Er den 0, er sagen afgjort. Er den
-- over 0, giver D2 de præcise tal.
-- «uden_praecis_en_repraesentant» skal være 0 — ellers er målingen ugyldig.
-- ═══════════════════════════════════════════════════════════════
with annoncer as (select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end as "noegle", not "listings"."id" in (
    select d.id from (
      select "listings"."id" as id,
        row_number() over (
          partition by case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end
          order by
            -- Kildens annonce foer udlejerens — se UDLEJERANNONCE.
            ("listings"."source_type" is not distinct from 'native') asc,
            -- UNIKKE billeder, ikke raekker — se UNIKKE_BILLEDER.
            (select count(distinct i.external_url)::int
  from listing_images i where i.listing_id = "listings".id and substring(i.external_url from '^https?://([^/?#]+)') = any(array['app.propstep.com', 'findbolig.nu', 'dacas.dk', 'lokalbolig.io', 'images.ctfassets.net', 'alvis.b-cdn.net', 'home.mindworking.eu', 'boligio-media-production.s3.eu-central-1.amazonaws.com', 'hos.laros.dk', 'boligspot.b-cdn.net', 'birchejendomme.dk', 'alabubolig.dk']::text[])) desc,
            ("listings"."total_monthly" is not null) desc,
            "listings"."id"
        ) as rn
      from "listings"
      inner join "sources" on "sources"."id" = "listings"."source_id"
      where ("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed')
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end in (
          select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end from "listings"
          where "listings"."status" = 'active' and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1) as "er_repraesentant", "sources"."slug" as "kilde", "listings"."availability_facts" as "fakta" from "listings" inner join "sources" on "sources"."id" = "listings"."source_id" where (("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed') and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null)),
boliger as (
  select noegle, count(*) as annoncer,
    count(*) filter (where er_repraesentant) as repraesentanter,
    count(*) filter (where kilde in ('balder', 'propstep', 'home', 'findbolig', 'lokalbolig', 'dacas', 'cej', 'heimstaden', 'birch', 'laros', 'alabu', 'native')) as med_kontrakt,
    -- Domænet afhænger KUN af kildens kontrakt og annoncens fakta (og
    -- tidspunktet, som er det samme for alle). Er de ens, falder
    -- annoncerne ens ud. Uden kontrakt er alt «ukendt».
    count(distinct case when kilde in ('balder', 'propstep', 'home', 'findbolig', 'lokalbolig', 'dacas', 'cej', 'heimstaden', 'birch', 'laros', 'alabu', 'native')
                        then kilde || ' ' || coalesce(fakta::text, '{}')
                        else 'ingen kontrakt' end) as signaturer
  from annoncer group by noegle having count(*) >= 2)
select count(*) as boliger_med_flere_annoncer,
  count(*) filter (where med_kontrakt > 0) as heraf_med_en_kildekontrakt,
  count(*) filter (where signaturer > 1) as heraf_kan_staa_paa_hver_sin_side_hoejst,
  count(*) filter (where repraesentanter <> 1) as uden_praecis_en_repraesentant
from boliger;


-- ═══════════════════════════════════════════════════════════════
-- D2 · Domænefiltre: de boliger fra D1, der kan tabe — til fortolkning.
--
-- Kun SELECT. Én række, med én celle JSON.
--
-- Kopiér cellen «til_fortolkning» og send den tilbage. Den fortolkes af
-- appens EGEN availabilityFor og matcherDomaene
-- (scripts/maalinger/fortolk-domaene.ts), som giver det præcise antal
-- tabte boliger pr. filterværdi. «bolig» er en md5 af dedup-nøglen, ikke
-- en adresse. Cellen indeholder kildens slug og availability-fakta —
-- status, datoer og ansøgningsform. Ingen kontaktoplysninger.
-- ═══════════════════════════════════════════════════════════════
with annoncer as (select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end as "noegle", not "listings"."id" in (
    select d.id from (
      select "listings"."id" as id,
        row_number() over (
          partition by case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end
          order by
            -- Kildens annonce foer udlejerens — se UDLEJERANNONCE.
            ("listings"."source_type" is not distinct from 'native') asc,
            -- UNIKKE billeder, ikke raekker — se UNIKKE_BILLEDER.
            (select count(distinct i.external_url)::int
  from listing_images i where i.listing_id = "listings".id and substring(i.external_url from '^https?://([^/?#]+)') = any(array['app.propstep.com', 'findbolig.nu', 'dacas.dk', 'lokalbolig.io', 'images.ctfassets.net', 'alvis.b-cdn.net', 'home.mindworking.eu', 'boligio-media-production.s3.eu-central-1.amazonaws.com', 'hos.laros.dk', 'boligspot.b-cdn.net', 'birchejendomme.dk', 'alabubolig.dk']::text[])) desc,
            ("listings"."total_monthly" is not null) desc,
            "listings"."id"
        ) as rn
      from "listings"
      inner join "sources" on "sources"."id" = "listings"."source_id"
      where ("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed')
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
        -- Kun de adresser der OVERHOVEDET har mere end én raekke. Uden det
        -- rangeres alle 729 unit-boliger, og billedtaellingen i order by
        -- koeres 729 gange i stedet for 38. Det kostede over et sekund pr.
        -- sidevisning i produktion.
        --
        -- Undersaettet er ufiltreret med vilje: det afgoer kun HVILKE
        -- adresser der er vaerd at rangere. Selve rangeringen — og dermed
        -- valget af repraesentant — sker stadig paa det filtrerede saet.
        and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end in (
          select case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end from "listings"
          where "listings"."status" = 'active' and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null
          group by 1 having count(*) > 1)
    ) d where d.rn > 1) as "er_repraesentant", "sources"."slug" as "kilde", "listings"."availability_facts" as "fakta" from "listings" inner join "sources" on "sources"."id" = "listings"."source_id" where (("listings"."status" = 'active' and "listings"."address_match_level" <> 'failed') and case
  when "listings"."address_match_level" = 'unit' and "listings"."unit_address_uuid" is not null
    then 'unit:' || "listings"."unit_address_uuid"
  when "listings"."address_match_level" = 'access' and "listings"."access_address_uuid" is not null
       and "listings"."house_number" is not null
    then 'access:' || "listings"."access_address_uuid"
      || ':' || coalesce("listings"."size_m2"::text, '?')
      || ':' || coalesce("listings"."rooms"::text, '?')
      -- Huslejen rundes til naermeste hundrede kroner, saa et gebyr til
      -- forskel mellem to kilder ikke deler boligen i to.
      || ':' || coalesce(round("listings"."rent_monthly" / 10000.0)::text, '?')
  else null
end is not null)),
boliger as (
  select noegle, count(*) as annoncer,
    count(*) filter (where er_repraesentant) as repraesentanter,
    count(*) filter (where kilde in ('balder', 'propstep', 'home', 'findbolig', 'lokalbolig', 'dacas', 'cej', 'heimstaden', 'birch', 'laros', 'alabu', 'native')) as med_kontrakt,
    -- Domænet afhænger KUN af kildens kontrakt og annoncens fakta (og
    -- tidspunktet, som er det samme for alle). Er de ens, falder
    -- annoncerne ens ud. Uden kontrakt er alt «ukendt».
    count(distinct case when kilde in ('balder', 'propstep', 'home', 'findbolig', 'lokalbolig', 'dacas', 'cej', 'heimstaden', 'birch', 'laros', 'alabu', 'native')
                        then kilde || ' ' || coalesce(fakta::text, '{}')
                        else 'ingen kontrakt' end) as signaturer
  from annoncer group by noegle having count(*) >= 2)
select count(distinct a.noegle) as boliger, count(*) as annoncer,
  coalesce(json_agg(json_build_object(
    'bolig', md5(a.noegle), 'repraesentant', a.er_repraesentant,
    'kilde', a.kilde, 'fakta', a.fakta)
    order by md5(a.noegle), a.er_repraesentant desc, a.kilde collate "C"), '[]'::json) as til_fortolkning
from annoncer a join boliger b on b.noegle = a.noegle
where b.signaturer > 1;


-- ═══════════════════════════════════════════════════════════════
-- F1 · En kendt total uden komponentliste.
--
-- Kun SELECT. Én række pr. kilde, der har mindst én.
--
-- Totalen skrives kun af `beregnTotal` (lib/normalize.ts), som altid
-- sætter total og poster sammen. Står der en total uden poster, kommer
-- den fra en ældre kodeversion, fra SQL i hånden eller fra prøvedata.
-- CHECK'en lader den passere, for cardinality(NULL) er NULL.
-- Følgen på kortet: en grøn total, og `eltilstand` giver «ikke-med» —
-- «El indgår ikke», en påstand, der kræver udspecificerede poster.
-- ═══════════════════════════════════════════════════════════════
select s.name as kilde,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null) as total_uden_poster,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null
                     and l.status = 'active') as heraf_aktive,
  count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null
                     and l.status = 'active' and l.utilities_electricity is null
                     and l.electricity_own_meter is not true) as heraf_med_linjen_el_indgaar_ikke
from listings l join sources s on s.id = l.source_id
group by s.name
having count(*) filter (where l.total_monthly is not null and l.total_monthly_components is null) > 0
order by 2 desc;


-- ═══════════════════════════════════════════════════════════════
-- S1 · Indstillinger, der kan ændre en konklusion — kør den BEGGE steder.
--
-- Kun SELECT. Én række pr. indstilling; grupperet; ingen af de 400 andre.
--
-- En måling på den lokale maskine er en måling af den lokale maskine. Den
-- siger intet om produktionen, før den er gentaget dér, eller før
-- indstillingerne er sammenholdt. 1. oktober 2026 ændrede en forskel en
-- konklusion tre gange: version, collation og JIT — og hver gang blev den
-- fundet bagefter. Kør blokken lokalt og i produktionen, og sammenlign
-- rækkerne, FØR en lokal måling bruges om produktionen.
--
-- «findes = false» betyder, at motoren ikke kender indstillingen — den
-- forsvinder ikke stille. «kilde» siger, hvor værdien kommer fra (default,
-- configuration file, database, user, session).
--
-- FORBEHOLD: pg_settings viser værdierne for DENNE session og rolle.
-- Appen forbinder gennem pooleren med sin egen rolle, og Supabase sætter
-- nogle værdier pr. rolle — fx statement_timeout. Kan en rolleindstilling
-- ændre konklusionen, så læs den for appens rolle:
--   select rolname, rolconfig from pg_roles where rolconfig is not null;
-- Statistikrækkerne er data, ikke indstillinger: hvor mange rækker
-- planlæggeren regner med, og hvornår den sidst fik nye tal.
-- ═══════════════════════════════════════════════════════════════
with oensket(gruppe, navn, nr) as (values
  ('version', 'server_version', 1),
  ('version', 'server_version_num', 2),
  ('planlaegger', 'random_page_cost', 3),
  ('planlaegger', 'seq_page_cost', 4),
  ('planlaegger', 'effective_cache_size', 5),
  ('planlaegger', 'cpu_tuple_cost', 6),
  ('planlaegger', 'cpu_index_tuple_cost', 7),
  ('planlaegger', 'cpu_operator_cost', 8),
  ('planlaegger', 'plan_cache_mode', 9),
  ('planlaegger', 'join_collapse_limit', 10),
  ('planlaegger', 'from_collapse_limit', 11),
  ('planlaegger', 'enable_seqscan', 12),
  ('planlaegger', 'enable_indexscan', 13),
  ('planlaegger', 'enable_bitmapscan', 14),
  ('planlaegger', 'enable_hashjoin', 15),
  ('planlaegger', 'enable_mergejoin', 16),
  ('planlaegger', 'enable_nestloop', 17),
  ('planlaegger', 'enable_hashagg', 18),
  ('planlaegger', 'enable_sort', 19),
  ('planlaegger', 'enable_incremental_sort', 20),
  ('planlaegger', 'enable_memoize', 21),
  ('statistik', 'default_statistics_target', 22),
  ('hukommelse', 'work_mem', 23),
  ('hukommelse', 'hash_mem_multiplier', 24),
  ('hukommelse', 'shared_buffers', 25),
  ('hukommelse', 'maintenance_work_mem', 26),
  ('hukommelse', 'temp_buffers', 27),
  ('hukommelse', 'effective_io_concurrency', 28),
  ('parallelitet', 'max_parallel_workers_per_gather', 29),
  ('parallelitet', 'max_parallel_workers', 30),
  ('parallelitet', 'max_worker_processes', 31),
  ('parallelitet', 'parallel_setup_cost', 32),
  ('parallelitet', 'parallel_tuple_cost', 33),
  ('parallelitet', 'min_parallel_table_scan_size', 34),
  ('parallelitet', 'min_parallel_index_scan_size', 35),
  ('jit', 'jit', 36),
  ('jit', 'jit_above_cost', 37),
  ('jit', 'jit_inline_above_cost', 38),
  ('jit', 'jit_optimize_above_cost', 39),
  ('tid', 'statement_timeout', 40)
)
select o.nr, o.gruppe, o.navn, s.setting as vaerdi, s.unit as enhed, s.source as kilde,
       (s.name is not null) as findes
from oensket o left join pg_settings s on s.name = o.navn
union all
select 900 + x.i, 'collation', 'database: ' || x.k, x.v, null, 'pg_database', true
from pg_database d,
     lateral (values (1, 'datcollate', d.datcollate::text), (2, 'datctype', d.datctype::text),
                     (3, 'udbyder', case d.datlocprovider when 'c' then 'libc' when 'i' then 'icu'
                                                          when 'b' then 'builtin' end),
                     (4, 'icu-locale', coalesce(to_jsonb(d) ->> 'datlocale', to_jsonb(d) ->> 'daticulocale')))
       as x(i, k, v)
where d.datname = current_database()
union all
select 910 + x.i, 'collation', 'da-x-icu: ' || x.k, x.v, null, 'pg_collation', true
from pg_collation c,
     lateral (values (1, 'skema', c.collnamespace::regnamespace::text), (2, 'collversion', c.collversion),
                     (3, 'locale', coalesce(to_jsonb(c) ->> 'colllocale', to_jsonb(c) ->> 'colliculocale')))
       as x(i, k, v)
where c.collname = 'da-x-icu'
union all
select 950 + x.i, 'statistik', t.relname || ': ' || x.k, x.v, null, 'pg_stat_user_tables', true
from pg_stat_user_tables t,
     lateral (values (1, 'levende raekker', t.n_live_tup::text),
                     (2, 'sidst analyseret', greatest(t.last_analyze, t.last_autoanalyze)::text)) as x(i, k, v)
where t.schemaname = 'public' and t.relname in ('listings', 'listing_images')
order by 1, 3;
