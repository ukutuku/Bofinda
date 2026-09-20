-- ═══════════════════════════════════════════════════════════════
--  Tre rettelser, som kun en gennemgang mod Stripes FAKTISKE
--  typer kunne afsloere.
--
--  1 · `current_period_end` maa vaere NULL.
--      Kolonnen blev lavet NOT NULL, dengang Stripes Subscription-objekt
--      havde feltet. Det har det ikke laengere: i den installerede SDK
--      (stripe@22, API 2026-08-26.dahlia) ligger `current_period_end` paa
--      SubscriptionItem, ikke paa Subscription —
--      node_modules/stripe/esm/resources/Subscriptions.d.ts:90 opregner
--      objektets felter, og de to periodefelter er der ikke.
--      En handler, der skrev `sub.current_period_end`, ville skrive
--      `undefined` i en NOT NULL-kolonne og kaste paa hver eneste
--      webhook. Og alternativet — at regne perioden ud selv — ville
--      vaere et opdigtet tal om nogens penge.
--
--  2 · Én LEVENDE abonnementsraekke pr. bruger.
--      `sub_user_idx` er et almindeligt indeks, ikke unikt, saa intet i
--      basen forhindrede to samtidige abonnementer paa samme konto —
--      praecis det, et dobbeltklik laver. Indekset er DELVIST: en
--      afsluttet raekke skal kunne blive liggende som historik.
--
--  3 · Én bruger pr. Stripe-kunde.
--      `users.stripe_customer_id` havde ingen constraint. To konti, der
--      pegede paa samme Stripe-kunde, ville dele betalingshistorik.
-- ═══════════════════════════════════════════════════════════════

alter table "subscriptions" alter column "current_period_end" drop not null;

-- Almindelig enum-sammenligning. Den ER immutable og duer i et
-- indekspraedikat — nu hvor 0021 GENSKABER typen i stedet for at
-- udvide den, er vaerdierne ikke «nye i samme transaktion».
create unique index "sub_en_levende_pr_bruger"
  on "subscriptions" ("user_id")
  where "status" in ('trialing', 'active', 'past_due', 'incomplete', 'paused', 'unpaid');

create unique index "users_stripe_customer_unik"
  on "users" ("stripe_customer_id")
  where "stripe_customer_id" is not null;
