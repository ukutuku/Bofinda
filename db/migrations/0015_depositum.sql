-- ═══════════════════════════════════════════════════════════════
--  Depositum og forudbetalt leje som egne kolonner.
--
--  De blev regnet ind i `move_in_cost` og derefter kastet vaek. For en
--  scrapet bolig gaar det an: kilden oplyser tit kun summen. For en
--  udlejer, der skal kunne REDIGERE sin annonce, gaar det ikke — der var
--  ikke noget at laese tilbage i formularen, og et gem skrev en tom
--  vaerdi hen over summen.
--
--  Alt i oere, som resten af beloebene.
-- ═══════════════════════════════════════════════════════════════

alter table "listings" add column if not exists "deposit" integer;
alter table "listings" add column if not exists "prepaid_rent" integer;

comment on column "listings"."deposit" is
  'Depositum i oere. Kun udfyldt naar kilden eller udlejeren oplyser det saerskilt.';
comment on column "listings"."prepaid_rent" is
  'Forudbetalt leje i oere. Se noten paa deposit.';
