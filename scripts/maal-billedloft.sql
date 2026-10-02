-- ═══════════════════════════════════════════════════════════════
--  LOFTET FOR GENHENTNING AF BILLEDER.
--
--  `BILLED_HEMMELIGHED` signerer hver billed-URL. Roteres den, skifter
--  HVER URL paa én gang, browser- og CDN-cache bliver irrelevante, og
--  hvert DISTINKTE billede paa en aktiv bolig hentes igen fra kilderne —
--  ad en vej, der ikke pacer (`app/api/billede/route.ts:47` bruger plain
--  `fetch`, ikke `politeFetch`).
--
--  Tallet herunder ER det loft. Koereseddelen i `.env.example` kraever,
--  at det kendes FOER en rotation, saa der er noget at holde Vercels
--  kantcache-statistik op mod.
--
--      psql "$DATABASE_URL_DIRECT" -f scripts/maal-billedloft.sql
--
--  SKRIVEBESKYTTET. Kun `select`, ingen DDL, ingen DML.
--
--  ── FORBEHOLD · TALLENE ER ALDRIG SET; SYNTAKS OG TYPER HOLDER ──
--  Konventionen staar i CLAUDE.md: «uproevet» er ikke én tilstand.
--
--    tallene er ikke set         uundgaaeligt uden basen · acceptabelt
--    syntaks og typer ikke koert undgaaeligt · ALDRIG acceptabelt her
--
--  Denne fil er den foerste slags. Sessionen, der skrev den, havde hverken
--  .env eller databaseadgang, saa tallene er aldrig set. Men begge
--  saetninger ER koert mod testbasen — PGlite med de rigtige migrationer —
--  mod et forlaeg med facit skrevet i haanden FOERST.
--  Proeven er scripts/test-maal-billedloft.ts.
--
--  ── TO AENDRINGER FRA FORESPOERGSLEN I CLAUDE.md ────────────────
--  CLAUDE.md's egen vaertsoptaelling bruger `count(*)` over ALLE raekker.
--  Her er begge aendret, og begge er noedvendige for at tallet er et loft:
--
--    1. `count(distinct i.external_url)` — ét kald pr. DISTINKT billede.
--       Den samme URL kan staa paa flere boliger (samme ejendom, samme
--       galleri), og proxyen henter den én gang pr. (url, bredde).
--    2. `where l.status = 'active'` — en afmeldt bolig vises ikke, saa
--       dens billeder hentes ikke. Uden filteret er loftet for hoejt, og
--       et loft, der er for hoejt, er ikke et loft: man venter paa et tal,
--       der aldrig naas.
--
--  ── HVAD TALLET IKKE ER ────────────────────────────────────────
--  Det er et loft, ikke en forudsigelse. Proxyen henter pr.
--  `(url, bredde)`, og `BREDDER_PR_VAERT` giver nogle vaerter to bredder
--  og andre tre — saa det FAKTISKE antal kald er mellem én og tre gange
--  tallet her, afhaengigt af hvilke bredder brugerne beder om. Og det
--  siger intet om, HVORNAAR genhentningen er ovre: /api/billede logger
--  ingenting, og det er en kendt mangel, ikke noget denne fil kan daekke.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1 · Loftet pr. VAERT. Vaerten er det, der betyder noget: det er den,
--     der rammes, og de fire overlappende vaerter (dacas.dk,
--     findbolig.nu, birchejendomme.dk, alabubolig.dk) pacer crawlen i
--     forvejen. Dedup paa bolig er IKKE anvendt — spoergsmaalet er, hvad
--     proxyen henter, ikke hvad soegningen viser.
-- ─────────────────────────────────────────────────────────────
select substring(i.external_url from '^https?://([^/?#]+)')  as vaert,
       count(distinct i.external_url)::int                   as distinkte_billeder,
       count(*)::int                                         as billedraekker,
       count(distinct i.listing_id)::int                      as aktive_boliger
from listing_images i
join listings l on l.id = i.listing_id
where l.status = 'active'
group by 1
order by 2 desc;

-- ─────────────────────────────────────────────────────────────
-- 2 · Loftet i alt. Ét tal til at holde kantstatistikken op mod.
--     `distinct` gaelder HELE bestanden og ikke pr. vaert, saa summen af
--     saetning 1 er den samme — men den skal staa for sig, for det er
--     dette tal, koereseddelen beder om.
-- ─────────────────────────────────────────────────────────────
select count(distinct i.external_url)::int as distinkte_billeder_i_alt,
       count(distinct i.listing_id)::int   as aktive_boliger_med_billeder
from listing_images i
join listings l on l.id = i.listing_id
where l.status = 'active';
