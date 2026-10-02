-- ═══════════════════════════════════════════════════════════════
--  Tælleren for målinger, rens() kasserede.
--
--  HÅNDSKREVET, som 0013-0020: drizzle-kit's snapshots stopper ved 0012.
--  Posten står i meta/_journal.json. `npm run db:status` fælder en fil
--  uden post.
--
--  ═══ HVORFOR ═══
--
--  Et kasseret event har ingen række i `haendelser`. Uden en tæller ved
--  siden af kan ingen sige, hvor ofte det sker, eller hvad der tabes — og
--  et fald i en tragt kan ikke skelnes fra «vi holdt op med at måle».
--
--  ═══ MÅLEAPPARATET GÅR UDEN OM DET, DET MÅLER ═══
--
--  Tælleren skrives direkte af spor() med rens()'s svar — aldrig som et
--  event GENNEM rens(). Gik den gennem rens(), ville den holde op med at
--  tælle netop når rens() gik i stykker. Kaster rens() selv, tælles det
--  under grunden 'rens-kastede'.
--
--  ═══ ET NUL SKAL KUNNE SIGE, AT DET IKKE BLEV MÅLT ═══
--
--  Rækken med grund 'talt' (event_name og noegle tomme, antal 0) skrives
--  UBETINGET hver dag, der måles — før rens() kaldes. Læsereglen:
--    · findes 'talt' for (dato, environment), er en manglende
--      (event, nøgle, grund) for den dag et rigtigt NUL;
--    · findes den ikke, blev der ikke talt den dag — og så er der intet
--      nul at læse, kun et hul.
--  `sidst_skrevet` står på hver række, så også «holdt op i går
--  eftermiddags» kan ses.
--
--  ═══ INGEN IDENTIFIKATORER ═══
--
--  Dato, miljø, eventnavn, nøgle og grund. Eventnavnet er et kendt navn
--  eller '(ukendt)'. Nøglen er en nøgle fra allowlisten, et af
--  kontekstfelterne i rens() eller '(ukendt)' — aldrig en nøgle, en
--  afsender selv har fundet på, og aldrig en værdi. Derfor ingen
--  udløbsdato, ligesom haendelser_daglig.
--
--  ═══ FLETTEFARE: claude/betaling-og-adgangskontrol ═══
--
--  Den gren har 0021-0029. drizzle's migrator (drizzle-orm 0.38.4,
--  pg-core/dialect.js) kører KUN en migration, hvis dens `when` er større
--  end den senest kørte. `when` for denne er 1788811312600: efter 0020
--  (…592) og før grenens 0021 (…613). Flettes denne først, kører grenens
--  migrationer bagefter som de skal. Flettes grenen FØRST, skal denne
--  have nyt nummer og et `when` efter grenens sidste — ellers springes den
--  over uden en fejl. `db:status` opdager det, fordi den tæller kørte mod
--  journalposter, men den navngiver de SIDSTE poster, ikke den oversprungne.
-- ═══════════════════════════════════════════════════════════════

create table "maaling_afvisninger" (
  "dato"          text not null,
  "environment"   text not null,
  -- '' og ikke null: en primærnøgle med en nullable kolonne kan ikke
  -- upserte på konflikt. Samme greb som haendelser_daglig.
  "event_name"    text not null default '',
  "noegle"        text not null default '',
  "grund"         text not null,
  "antal"         integer not null default 0,
  "sidst_skrevet" timestamp with time zone not null default now(),
  constraint "maaling_afvisninger_pk"
    primary key ("dato","environment","event_name","noegle","grund"),
  constraint "maaling_afvisninger_miljoe"
    check ("environment" in ('produktion','preview','udvikling','proeve')),
  -- Ingen liste over grunde her: den ville være en afskrift af typen i
  -- lib/maaling.ts, og en ny grund, der manglede i SQL'en, ville få hver
  -- optælling af den til at fejle i stilhed. Værdierne kommer kun fra
  -- vores egen kode, og længden holder fritekst ude.
  constraint "maaling_afvisninger_laengder"
    check (char_length("dato") = 10
           and char_length("event_name") <= 40
           and char_length("noegle") <= 40
           and char_length("grund") between 1 and 40),
  constraint "maaling_afvisninger_antal"
    check ("antal" >= 0)
);
--> statement-breakpoint

-- OBLIGATORISK for hver ny tabel i public. Se db/skabelon-migration.sql.
alter table "maaling_afvisninger" enable row level security;
--> statement-breakpoint
revoke all on "maaling_afvisninger" from anon, authenticated;
