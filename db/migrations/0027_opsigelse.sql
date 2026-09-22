-- ═══════════════════════════════════════════════════════════════
--  Kundens egen opsigelse er en BESLUTNING, ikke en spejling.
--
--  `cancel_at_period_end` er et spejl af Stripes felt: en forsinket
--  `subscription.updated`, der er oprettet FOER opsigelsen, skriver
--  det tilbage til false, og saa staar der «fornyes» paa Mit
--  abonnement, kort efter hun sagde op. Det er den samme fejltype som
--  `fornyelse_stoppet_at`, og svaret er det samme: beslutningen faar
--  sit eget felt, som kun en beslutning kan aendre.
--
--  Feltet er desuden ANKERET, der goer opsigelsen genoptagelig. Det
--  skrives FOER de eksterne kald, saa en opsigelse, der knaekker midt
--  i — release lykkedes, den lokale skrivning fejlede — kan tages op
--  igen af tilsynet i stedet for at staa halvt gennemfoert for evigt.
--  Uden ankeret var der intet at genoptage FRA.
-- ═══════════════════════════════════════════════════════════════

alter table "subscriptions"
  add column "opsagt_af_kunde_at" timestamp with time zone;

-- Tilsynet spoerger «hvilke opsigelser er skyldige NU»: besluttet, men
-- ikke bekraeftet hos Stripe. De er faa, og opslaget sker hver time.
create index "sub_skyldig_opsigelse_idx"
  on "subscriptions" ("opsagt_af_kunde_at")
  where "opsagt_af_kunde_at" is not null and "cancel_at_period_end" = false;
