// ═══════════════════════════════════════════════════════════════
//  Skriver de to skrivebeskyttede SELECT-forespørgsler ud, som nogen med
//  adgang kan indsætte direkte i Supabases SQL-editor.
//
//  HVORFOR GENERERET OG IKKE SKREVET I HÅNDEN
//
//  «Synlig» og dedup er appens egne prædikater (`synlig` i
//  lib/omraade.ts, som er `udenDubletter(...)` fra lib/soeg.ts). Skrev
//  jeg dem af i SQL, ville der findes to udtryk for det samme
//  spørgsmål, og målingen kunne svare på et andet grundlag end
//  områdesiden viser. Her RENDERES appens eget udtryk til tekst.
//
//  Den rører ingen database: drizzles `QueryBuilder` bygger sætningen
//  uden en forbindelse. Parametrene skrives ind i teksten, så det, der
//  kommer ud, kan indsættes som det er.
//
//    npx tsx --tsconfig tsconfig.scripts.json scripts/maalinger/skriv-maal-sql.ts
// ═══════════════════════════════════════════════════════════════
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { listings } from '../../db/schema'
import { synlig } from '../../lib/omraade'
import { MINDST_BOLIGER } from '../../lib/slug'
// Én gengivelse af parametrene for alle målinger. Den, der stod her, erstattede
// højeste nummer først med split/join; gengiv.ts gør det i ét gennemløb og
// afviser ukendte typer. Samme spørgsmål, ét sted.
import { indsaetParametre } from './gengiv'

/** Appens eget synligheds- og dedup-prædikat, renderet til ren SQL. */
function synligSql(): string {
  const q = new QueryBuilder()
    .select({ x: sql<number>`1` })
    .from(listings)
    .where(synlig)
    .toSQL()
  const hel = indsaetParametre(q.sql, q.params)
  const i = hel.indexOf(' where ')
  if (i < 0) throw new Error('fandt ikke where-leddet i den renderede sætning')
  return hel.slice(i + ' where '.length)
}


const SYNLIG = synligSql()

// `listings` har alias `listings` i den renderede tekst; underforespørgslerne
// i dedup binder til det. Derfor skal yderste from hedde det samme.
const BLOK1 = `-- ═══════════════════════════════════════════════════════════════
-- BLOK 1 · Prisspændet pr. område: hvem sætter endepunkterne?
--
-- KUN SELECT. Ingen writes, ingen temp-tabeller, ingen skrivende CTE'er.
--
-- Hver række er ÉN områdeside. Med er kun de sider, hvor mindst én bolig
-- bidrager med en REN HUSLEJE til spændet — resten har intet at svare.
-- Nederst to SAMLET-rækker, én pr. slags, regnet af ALLE sider af den
-- slags (også dem der ikke står her). Byer og postnumre tælles hver for
-- sig, fordi den samme bolig ligger på begge slags sider.
--
-- «Vist» = det, områdesiden skriver i dag: min/max af
--   coalesce(total_monthly, rent_monthly) — og kalder «husleje».
-- «Kun totaler» = samme spænd regnet af de boliger, hvor vi FAKTISK
--   kender hele betalingen til udlejeren.
-- Uafgjort (samme beløb i begge grupper) tælles som total.
-- Beløb er i KRONER; i basen er de i øre.
--
-- «Synlig» og dedup nedenfor er appens egne prædikater, renderet ud af
-- lib/omraade.ts og lib/soeg.ts af scripts/maalinger/skriv-maal-sql.ts.
-- De er ikke skrevet af i hånden.
-- ═══════════════════════════════════════════════════════════════
with synlige as (
  select listings.city, listings.postal_code, listings.rent_monthly, listings.total_monthly
  from listings
  where ${SYNLIG}
),
pr_omraade as (
  select 'by' as slags, city as omraade, rent_monthly, total_monthly
    from synlige where city is not null
  union all
  select 'postnummer', postal_code, rent_monthly, total_monthly
    from synlige where postal_code is not null
),
paa_side as (
  -- Kun områder, der faktisk FÅR en side. Grænsen er MINDST_BOLIGER.
  select slags, omraade, rent_monthly, total_monthly from (
    select slags, omraade, rent_monthly, total_monthly,
           count(*) over (partition by slags, omraade) as i_omraadet
    from pr_omraade
  ) x where i_omraadet >= ${MINDST_BOLIGER}
)
select
  slags,
  case when grouping(omraade) = 1 then 'SAMLET (alle sider)' else omraade end
                                                                   as omraade,
  count(distinct omraade)                                          as sider_i_tallet,
  count(*)                                                         as boliger,
  count(*) filter (where total_monthly is null and rent_monthly is not null)
                                                                   as kun_husleje_boliger,
  count(*) filter (where coalesce(total_monthly, rent_monthly) is null)
                                                                   as uden_pris_boliger,
  min(coalesce(total_monthly, rent_monthly)) / 100                 as vist_spaend_fra_kr,
  max(coalesce(total_monthly, rent_monthly)) / 100                 as vist_spaend_til_kr,
  min(total_monthly) / 100                                         as kun_totaler_fra_kr,
  max(total_monthly) / 100                                         as kun_totaler_til_kr,
  case
    when min(coalesce(total_monthly, rent_monthly)) is null then null
    when min(total_monthly) is not null
         and min(total_monthly) <= min(coalesce(total_monthly, rent_monthly))
      then 'total'
    else 'ren husleje'
  end                                                              as nedre_endepunkt_er,
  case
    when max(coalesce(total_monthly, rent_monthly)) is null then null
    when max(total_monthly) is not null
         and max(total_monthly) >= max(coalesce(total_monthly, rent_monthly))
      then 'total'
    else 'ren husleje'
  end                                                              as oevre_endepunkt_er,
  (min(coalesce(total_monthly, rent_monthly)) = max(coalesce(total_monthly, rent_monthly)))
                                                                   as spaend_er_et_beloeb
from paa_side
group by grouping sets ((slags, omraade), (slags))
having grouping(omraade) = 1
    or count(*) filter (where total_monthly is null and rent_monthly is not null) > 0
order by grouping(omraade) desc, slags,
         count(*) filter (where total_monthly is null and rent_monthly is not null) desc,
         count(*) desc;`

const BLOK2 = `-- ═══════════════════════════════════════════════════════════════
-- BLOK 2 · Områdesidernes meta-beskrivelse: hvor mange kalder en kendt
-- total «husleje»?
--
-- Kun SELECT. Ét resultatsæt, ÉN række.
--
-- Beskrivelsen skriver i dag «Husleje X–Y kr. om måneden», hvor X og Y
-- er min/max af coalesce(total_monthly, rent_monthly). En side «kalder
-- en kendt total husleje», når mindst én bolig i grundlaget HAR en
-- total — for så dækker etiketten også den.
--
-- FORBEHOLD FOR SIDETALLET: \`alleOmraader\` i lib/omraade.ts kollapser to
-- områder, der giver samme slug, til ét (den med flest boliger vinder).
-- Det kan SQL'en ikke gøre, fordi slug'en beregnes i JS med vilje. Tallet
-- her er derfor en ØVRE grænse. Det nøjagtige antal sider står i
-- sitemap.xml, som er hentet: 188 den 1. oktober 2026.
-- ═══════════════════════════════════════════════════════════════
with synlige as (
  select listings.city, listings.postal_code, listings.rent_monthly, listings.total_monthly
  from listings
  where ${SYNLIG}
),
pr_omraade as (
  select 'by' as slags, city as omraade, rent_monthly, total_monthly
    from synlige where city is not null
  union all
  select 'postnummer', postal_code, rent_monthly, total_monthly
    from synlige where postal_code is not null
),
sider as (
  select
    slags, omraade,
    count(*)                                                       as boliger,
    count(total_monthly)                                           as kendte_totaler,
    min(coalesce(total_monthly, rent_monthly))                     as vist_fra,
    max(coalesce(total_monthly, rent_monthly))                     as vist_til,
    case
      when min(coalesce(total_monthly, rent_monthly)) is null then null
      when min(total_monthly) is not null
           and min(total_monthly) <= min(coalesce(total_monthly, rent_monthly))
        then 'total' else 'ren husleje'
    end                                                            as nedre_er,
    case
      when max(coalesce(total_monthly, rent_monthly)) is null then null
      when max(total_monthly) is not null
           and max(total_monthly) >= max(coalesce(total_monthly, rent_monthly))
        then 'total' else 'ren husleje'
    end                                                            as oevre_er
  from pr_omraade
  group by slags, omraade
  having count(*) >= ${MINDST_BOLIGER}
)
select
  count(*)                                                         as omraadesider_i_alt,
  count(*) filter (where vist_fra is not null)                     as med_prisspaend_i_beskrivelsen,
  count(*) filter (where vist_fra is not null and kendte_totaler > 0)
                                                                   as kalder_en_kendt_total_husleje,
  count(*) filter (where vist_fra is not null and kendte_totaler = 0)
                                                                   as spaendet_er_rene_huslejer,
  count(*) filter (where vist_fra is null)                         as uden_prisspaend,
  count(*) filter (where vist_fra = vist_til)                      as spaend_tegnet_som_x_til_x,
  count(*) filter (where nedre_er = 'ren husleje')                 as sider_hvor_nedre_endepunkt_er_husleje,
  count(*) filter (where oevre_er = 'ren husleje')                 as sider_hvor_oevre_endepunkt_er_husleje
from sider;`

const BLOK3 = `-- ═══════════════════════════════════════════════════════════════
-- BLOK 3 · Afmeldte boliger: hvor mange bærer en indefrosset tekst?
--
-- KUN SELECT. Ét resultatsæt, ÉN række.
--
-- En afmeldt (delisted) bolig forsvinder fra kildens søgegitter og
-- kommer derfor aldrig ind i genopfriskningsløkken igen. Dens
-- \`description\` står, som den stod den dag, boligen blev afmeldt.
-- Og \`hentBolig\` i lib/soeg.ts filtrerer IKKE på status — /bolig/<id>
-- åbner stadig, med mærkaten «ikke længere ledig».
-- Her tælles, hvor mange rækker det er.
-- ═══════════════════════════════════════════════════════════════
select
  count(*)                                                         as afmeldte_i_alt,
  count(*) filter (where description is not null)                  as heraf_med_beskrivelse,
  count(*) filter (where description like '%er den samlede månedlige udgift%')
                                                                   as med_den_gamle_paastand,
  count(*) filter (where source_type = 'native')                   as heraf_udlejerannoncer,
  min(delisted_at)::date                                           as aeldste_afmelding,
  max(delisted_at)::date                                           as nyeste_afmelding
from listings
where status = 'delisted';`

const BLOK4 = `-- ═══════════════════════════════════════════════════════════════
-- BLOK 4 · De 22 rækker: drev adressen, efter beskrivelsen blev skrevet?
--
-- KUN SELECT.
--
-- \`genererBeskrivelse\` (lib/normalize.ts:111-128) læser tretten felter,
-- og fire af dem er adressefelter: street, house_number, postal_code,
-- city (:115-118). Første sætning bliver derfor «… på <vej> <husnr> i
-- <postnr> <by>».
--
-- \`scripts/genparse-adresser.ts:77-83\` skriver præcis de fire felter og
-- skriver IKKE description. Det er den eneste skrivevej i hele repoet
-- (efterprøvet over alle 31 hentede grene) der ændrer et input til
-- beskrivelsen uden at skrive beskrivelsen med.
--
-- Står vejnavnet ikke længere i beskrivelsen, er adressen flyttet EFTER
-- teksten. Det er beviset — eller modbeviset.
-- ═══════════════════════════════════════════════════════════════
select
  count(*)                                                         as raekker_i_alt,
  count(*) filter (where position(street in description) = 0)
                                                                   as beskrivelse_naevner_ikke_egen_vej,
  count(*) filter (where position(coalesce(postal_code, '~') in description) = 0)
                                                                   as beskrivelse_naevner_ikke_egen_postnr
from listings
where source_type <> 'native'
  and description is not null
  and street is not null;`

process.stdout.write(BLOK1 + '\n\n\n' + BLOK2 + '\n\n\n' + BLOK3 + '\n\n\n' + BLOK4 + '\n')
