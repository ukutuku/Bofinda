-- Bestand af distinkte billed-URL'er paa aktive boliger.
--
-- Navnet er historisk: dette er IKKE et loft over HTTP-kald og kan ikke
-- fortaelle, at en cacheopvarmning er faerdig. En URL kan hentes i flere
-- bredder, i flere cachelag eller igen efter fejl/udloeb. Nogle billeder
-- bliver slet ikke efterspurgt. URL'er uden for denne bestand taelles ikke.
--
-- En rotation af BILLED_HEMMELIGHED aendrer nygenererede proxy-URL'er.
-- Nye cachemisses kan derfor give flere hentninger fra kilderne.
-- Billedproxyen bruger fetch, ikke crawlerens politeFetch; crawlerens
-- takttabel begraenser ikke billedproxyens kald.
--
--   psql "$DATABASE_URL_DIRECT" -f scripts/maal-billedloft.sql
--
-- SKRIVEBESKYTTET: kun SELECT. TALLENE ER ALDRIG SET i produktionen.
-- Koert mod PGlite med projektets migrationer og et syntetisk forlaeg
-- i scripts/test-maal-billedloft.ts; det maaler ikke produktionsbestanden.
--
-- DISTINCT taeller en delt URL én gang. Statusfilteret afgraenser bevidst
-- maengden til aktive boliger; det er ikke en paastand om, hvilke URL'er
-- der kan efterspoerges. URL'erne er ikke normaliseret af denne optaelling.
--
-- 1. Bestand pr. vaert, billedraekker og aktive boliger med billeder.
select substring(i.external_url from '^https?://([^/?#]+)')  as vaert,
       count(distinct i.external_url)::int                   as distinkte_billeder,
       count(*)::int                                         as billedraekker,
       count(distinct i.listing_id)::int                      as aktive_boliger
from listing_images i
join listings l on l.id = i.listing_id
where l.status = 'active'
group by 1
order by 2 desc;

-- 2. Den samme afgraensede bestand, samlet.
select count(distinct i.external_url)::int as distinkte_billeder_i_alt,
       count(distinct i.listing_id)::int   as aktive_boliger_med_billeder
from listing_images i
join listings l on l.id = i.listing_id
where l.status = 'active';
