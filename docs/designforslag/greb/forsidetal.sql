-- ═══════════════════════════════════════════════════════════════
--  Tallene i båndets kort («Talt i dag»): forsidetal() i lib/soeg.ts:1644.
--  Det er den forespørgsel, Postgres modtog, logget med
--  log_min_duration_statement = 0 mod den lokale testbase 26.9.2026.
--  Kortet må kun vise disse tal — ikke nogen anden optælling.
--
--  Resultat mod den LOKALE, SYNTETISKE base (scripts/cloud/saa.mjs):
--    boliger 279 · kendtTotal 252 · fuldOekonomi 195 · kilder 4
--  Produktionens tal skal hentes af nogen med adgang til basen:
--    ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json --env-file=.env \
--      -e "import('./lib/soeg.ts').then(async m => console.log(await m.forsidetal()))"
--
--  Parametre: $1 = 'active', $2 = 'failed', $15 = 'active', $16 = 'failed';
--  $3–$14 er TILLADTE_VAERTER fra lib/billede.ts (billedtællingen i
--  repræsentantvalget). «kilder» tæller native med som én kilde.
-- ═══════════════════════════════════════════════════════════════
select count(*)::int, count("listings"."total_monthly")::int, count(*) filter (where
	        "listings"."total_monthly" is not null
	        and "listings"."total_monthly_components" && array['heat','water','electricity']::text[])::int, count(distinct "listings"."source_id")::int from "listings" inner join "sources" on "sources"."id" = "listings"."source_id" where (("listings"."status" = $1 and "listings"."address_match_level" <> $2) and not "listings"."id" in (
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
	            (select count(*) from listing_images i
	              where i.listing_id = "listings"."id" and substring(i.external_url from '^https?://([^/?#]+)') = any(array[$3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14]::text[])) desc,
	            ("listings"."total_monthly" is not null) desc,
	            "listings"."id"
	        ) as rn
	      from "listings"
	      inner join "sources" on "sources"."id" = "listings"."source_id"
	      where ("listings"."status" = $15 and "listings"."address_match_level" <> $16)
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
	    ) d where d.rn > 1))
