-- ═══════════════════════════════════════════════════════════════
--  Row Level Security paa samtlige tabeller.
--
--  Supabase eksponerer public-skemaet gennem PostgREST. En tabel uden
--  RLS kan laeses af enhver med den offentlige publishable-noegle —
--  ogsaa listings.contact_email og listings.contact_phone, som er hele
--  det, betalingsmuren saelger. Uden det her er muren pynt.
--
--  Der oprettes med vilje INGEN politikker. Bofinda taler med databasen
--  over en almindelig Postgres-forbindelse som ejer-rollen, og den gaar
--  uden om RLS. anon og authenticated faar dermed adgang til ingenting
--  gennem PostgREST, hvilket er praecis det, vi vil.
--
--  Skal en tabel senere laeses direkte fra browseren, skrives en
--  politik til netop den tabel og netop de kolonner. Aldrig ved at slaa
--  RLS fra.
-- ═══════════════════════════════════════════════════════════════

alter table "sources"        enable row level security;
alter table "users"          enable row level security;
alter table "subscriptions"  enable row level security;
alter table "listings"       enable row level security;
alter table "listing_images" enable row level security;
alter table "saved_searches" enable row level security;
alter table "favorites"      enable row level security;
alter table "conversations"  enable row level security;
alter table "messages"       enable row level security;

-- Ingen skal kunne naa tabellerne gennem PostgREST-rollerne.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
