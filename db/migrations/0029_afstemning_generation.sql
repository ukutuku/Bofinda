-- ═══════════════════════════════════════════════════════════════
--  EN KVITTERING MAA KUN DAEKKE DET ARBEJDE, DEN HAR SET.
--
--  0028 gav udestaaende arbejde sit eget felt. Men kvitteringen —
--  `ryd()` i slutningen af `afstemAbonnement` — ryddede UBETINGET.
--  Den spurgte ikke, om der var kommet NYT arbejde, siden Stripe-
--  svaret blev laest.
--
--  Det er et vindue med en netvaerkstur i: mellem den afsluttende
--  `subscriptions.retrieve` og skrivningen hjem kan `laegPlan` vende
--  tilbage fra et forsinket `create`, opdage opsigelsen og registrere
--  en ny, KORREKT skyld. Den gamle kvittering sletter den saa — og
--  planen staar aktiv hos Stripe, usynlig for enhver koe. Maalt: tre
--  tilsynskoersler, nul kald, plan `active`, skyld null.
--
--  `coalesce(afstemning_skyldig_at, now())` duer IKKE som markoer for
--  det: den BEVARER med vilje det gamle tidspunkt, saa en ny skyld
--  registreret oven i en gammel faar praecis samme vaerdi. To
--  generationer af arbejde bliver umulige at skelne.
--
--  Derfor en taeller, der stiger ved HVER registrering af arbejde.
--  Afstemningen laeser den ved start og kvitterer kun, hvis den er
--  uaendret. Er den steget, staar det nye arbejde tilbage — og det er
--  det rigtige: vi har ikke set det, saa vi kan ikke sige, det er
--  gjort.
--
--  Ingen RLS eller revoke her: `subscriptions` findes i forvejen, og
--  0002 har allerede lukket den for anon og authenticated. Kontrollen
--  `npm run tjek:rettigheder` maaler basen og fanger det, hvis ikke.
-- ═══════════════════════════════════════════════════════════════

alter table "subscriptions"
  add column "afstemning_gen" bigint not null default 0;

-- Ingen backfill af selve taelleren. Nul er en gyldig foerste
-- generation: en raekke, der staar med en skyld i dag, faar sin naeste
-- kvittering maalt mod nul, og enhver ny registrering haever den. Der
-- findes ikke et «forkert» udgangspunkt, kun et fast et.

-- ── MEN DE FORAELDRELOESE BESLUTNINGER SKAL SAMLES OP ─────────
-- Indtil nu skrev `noterOpsigelse` beslutningen og skylden i TO
-- selvstaendige saetninger. Fejlede den anden, stod beslutningen uden
-- en vej til udfoerelse, og ingen koe saa raekken igen. Rettelsen goer
-- tilstanden uopnaaelig fremover, men den fjerner ikke de raekker, der
-- allerede maatte staa saadan.
--
-- Samme praedikat som 0028's backfill, og af samme grund: en kunde,
-- der har sagt op, og hvis opsigelse ikke er bekraeftet, HAR
-- udestaaende arbejde. Saetningen er idempotent — `is null` paa
-- skylden goer, at en raekke, der allerede er i koeen, ikke roeres, og
-- dens generation ikke haeves.
update "subscriptions"
   set "afstemning_skyldig_at" = coalesce("opsagt_af_kunde_at", now()),
       "afstemning_fejl" = 'samlet op ved 0029: beslutning uden koearbejde'
 where "opsagt_af_kunde_at" is not null
   and "cancel_at_period_end" = false
   and "afstemning_skyldig_at" is null;
