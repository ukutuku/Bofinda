-- ═══════════════════════════════════════════════════════════════
--  DEMOKOORDINATER — KUN Bofinda Staging, project_id prgmenbwabwkgitjclrj.
--  Aldrig en migration, aldrig et buildtrin, aldrig produktion.
--
--  HVORFOR: `staging-demo.sql` indsatte 16 fiktive boliger UDEN
--  koordinater, og LAES-MIG.md siger det udtrykkeligt: «Datasættet
--  afprøver derfor ikke kortplacering.» Følgen er, at landkortet står
--  tomt i previewet — ikke fordi kortet er i stykker, men fordi der
--  ikke er noget at sætte på det.
--
--  Denne fil giver koordinater til 8 af de 16. De øvrige 8 BLIVER uden,
--  så begge situationer kan afprøves i det samme preview:
--
--    9001 Prøveby  · 4 lejligheder  → koordinater
--    9001 Prøveby  · 4 værelser     → INGEN  (samme søgning som ovenfor)
--    9002 Attrapby · 4 lejligheder  → koordinater
--    9003 Fiktivby · 4 rækkehuse    → INGEN  (hele søgningen uden kort)
--
--  Hvorfor pr. GRUPPE og ikke pr. bolig: de 16 danner fire gruppekort,
--  og kortet viser ét mærke pr. KORT med gruppens antal. Fik kun nogle
--  af en gruppes boliger en koordinat, ville mærket forsvinde den dag
--  repræsentanten skifter — den vælges på billedantal, så kendt total,
--  så alder. Hele gruppen eller ingen af den.
--
--  KOORDINATERNE ER FIXTUREVÆRDIER, ikke opslag i adresseregistret —
--  samme slags værdi som `address_match_level='unit'` i det oprindelige
--  datasæt. De ligger i et REGELMÆSSIGT GITTER med 0,004° / 0,006°
--  mellemrum nord for Aalborg. Gitteret er med vilje: fire mærker på
--  snorlige rækker ligner ikke rigtige adresser, og det er meningen.
--  Postnumrene 9001–9003 er fiktive, men 9000 er Aalborg, så området
--  er i det mindste ikke i modstrid med sig selv.
--  Ingen af punkterne svarer til en rigtig adresse, og ingen af dem
--  siger noget om, hvor en rigtig bolig ligger.
--
--  SIKKERHED: hver sætning kræver BÅDE et id fra manifest.json OG
--  demokildens `source_id`. Køres filen ved en fejl mod en base uden
--  demodata, rammer den nul rækker. Den kan aldrig røre en rigtig bolig.
--
--  IDEMPOTENT: det er faste værdier, så en gentagelse ændrer intet.
--  Rulles tilbage med sætningen nederst.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 9001 Prøveby · de 4 lejligheder ────────────────────────────
UPDATE listings SET lat = 57.0400000, lng = 9.9100000
 WHERE id = '20791203-99d8-5293-b106-6d12902b4d48' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0400000, lng = 9.9160000
 WHERE id = '0a58650a-5b72-54d5-bd5e-c61e4e953081' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0440000, lng = 9.9100000
 WHERE id = 'd15521c7-cb0f-5a50-bf3e-67be1414513b' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0440000, lng = 9.9160000
 WHERE id = '4ca5aa18-80a4-5645-a059-de9bc94c5d32' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';

-- ── 9002 Attrapby · de 4 lejligheder ───────────────────────────
UPDATE listings SET lat = 57.0200000, lng = 9.9500000
 WHERE id = '13809c09-81e8-536b-a1c6-afc02133ae97' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0200000, lng = 9.9560000
 WHERE id = '4aae27ad-9125-568e-8e8d-03deab9d4f93' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0240000, lng = 9.9500000
 WHERE id = '235a3992-8559-542e-834d-bfcdab828e71' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
UPDATE listings SET lat = 57.0240000, lng = 9.9560000
 WHERE id = '00c87a6b-e428-581f-886d-7ee2d33ecb49' AND source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';

COMMIT;

-- ── Efterprøv i SQL Editor: 8 med, 8 uden ──────────────────────
SELECT city, postal_code, property_type,
       count(*) AS boliger,
       count(lat) AS med_koordinat,
       count(*) - count(lat) AS uden_koordinat
  FROM listings
 WHERE source_id = 'f8029b90-0729-5995-8fd2-808d50800c70'
 GROUP BY 1, 2, 3
 ORDER BY 2, 3;

-- ── Tilbagerulning, hvis koordinaterne skal væk igen ───────────
-- UPDATE listings SET lat = NULL, lng = NULL
--  WHERE source_id = 'f8029b90-0729-5995-8fd2-808d50800c70';
