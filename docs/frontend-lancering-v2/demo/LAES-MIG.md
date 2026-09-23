# Forside og demoboliger

Denne revision gør heroen kortere, viser boliglisten før informationskortene,
forenkler teksterne og gør udlejerafsnittet mindre. Søgningens filtre,
pagination og beregning af udgifter er bevaret.

## Demodata — kun staging

`staging-demo.sql` er et separat, manuelt datasæt til **Bofinda Staging**,
Supabase-projekt `prgmenbwabwkgitjclrj`. Det er ikke en migration og må aldrig
køres i produktion eller under et Vercel-build.

Datasættet indsætter 16 fiktive boliger og 48 billedrækker under sin egen
kilde `demo-design-20260913` med typen `native`. Det indeholder ingen
kontakter, brugere, favoritter, kilde-oprettelsestider eller crawl-historik.
Den eksisterende favoritprøve og alle øvrige rækker ændres ikke. Alle priser
er heltal i øre; fire boliger mangler bevidst aconto og total.

Adresser og byer er opdigtede. `address_match_level=unit` er en
fixtureværdi, så kortene kan vises, ikke et faktisk opslag i adresseregistret.
Enhederne har tydelige interne prøve-id’er (`intern:v3:proeve:…`).
Der er ingen DAR-identifikatorer, og datasættet afprøver ikke adressevask
eller rigtige udlejerannoncer.

## Koordinater — `staging-demo-koordinater.sql`

Datasættet havde oprindelig **ingen** koordinater, og følgen var, at
landkortet stod tomt i previewet. Ikke fordi kortet var i stykker, men
fordi der ikke var noget at sætte på det.

`staging-demo-koordinater.sql` giver koordinater til **8 af de 16**. De
øvrige 8 bliver bevidst uden, så begge situationer kan afprøves i det
samme preview:

| Søgning | Boliger | Kortet viser |
| --- | --- | --- |
| 9001 Prøveby · 4 lejligheder | 4 | ét mærke med tallet 4 |
| 9001 Prøveby · 4 værelser | 4 | intet mærke — nævnt i noten under kortet |
| 9002 Attrapby · 4 lejligheder | 4 | ét mærke med tallet 4 |
| 9003 Fiktivby · 4 rækkehuse | 4 | intet mærke — hele søgningen uden kort |

En søgning på 9001 viser altså **begge tilstande på én skærm**: et mærke
for lejlighederne og «… oplyser ikke placering» for værelserne. En
søgning på 9003 viser den tredje: «Kortet kan ikke vise denne søgning».

**Koordinaterne gives pr. GRUPPE, ikke pr. bolig.** De 16 danner fire
gruppekort, og kortet viser ét mærke pr. KORT med gruppens antal. Fik
kun nogle af en gruppes boliger en koordinat, ville mærket forsvinde den
dag repræsentanten skifter — den vælges på billedantal, så kendt total,
så alder.

**Værdierne er fixtureværdier**, af samme slags som
`address_match_level='unit'`. De ligger i et regelmæssigt gitter med
0,004° / 0,006° mellemrum nord for Aalborg; gitteret er med vilje, for
fire mærker på snorlige rækker ligner ikke rigtige adresser. Ingen af
punkterne svarer til en rigtig adresse.

Hver sætning kræver **både** et id fra `manifest.json` **og** demokildens
`source_id`. Køres filen ved en fejl mod en base uden demodata, rammer
den nul rækker; den kan aldrig røre en rigtig bolig. Den er idempotent,
og nederst står en udkommenteret tilbagerulning.

### Sådan afprøves den

```sql
-- 1) i Supabase SQL Editor, projekt prgmenbwabwkgitjclrj
--    (staging-demo.sql skal være kørt først)
\i staging-demo-koordinater.sql
```

Derefter i previewet: søg på `9001` (mærke + note), `9002` (kun mærker)
og `9003` (intet kort, men en forklaring). `scripts/cloud/kortsynk.mjs`
måler det samme automatisk mod en base, der har demodataene.

`manifest.json` angiver alle egne UUID'er. Indsættelsen er idempotent med
`ON CONFLICT (id) DO NOTHING`; den opdaterer eller sletter ingen eksisterende
rækker. En gentagelse ændrer heller ikke eventuelle senere redigeringer.

## Fotos

Fire forskellige stemningsfotos genbruges på de 16 boliger; tre pr. galleri.
De viser to forskellige indretninger, ikke 16 faktiske boliger.
To fotos er stående, to liggende. Beskrivelserne, kilden og previewets banner
angiver tydeligt, at boligerne er fiktive og ikke kan lejes.

| Pexels-id | Fotograf | Format ved gennemgang |
| --- | --- | --- |
| 7404938 | cottonbro studio | 1125 × 750, liggende |
| 7404941 | cottonbro studio | 4043 × 6064, stående |
| 7404940 | cottonbro studio | 4391 × 6587, stående |
| 29953440 | Thới Nam Cao | 1000 × 750, liggende |

Kilder:
- https://www.pexels.com/photo/white-couch-in-the-living-room-7404938/
- https://www.pexels.com/photo/modern-apartment-living-room-with-city-view-29953440/
- De to stående motiver er downloadlinks under relaterede fotos på førstnævnte side.
- https://www.pexels.com/license/

Downloadadresserne er i manifestet. Billederne hentes gennem den eksisterende
signerede billedproxy; de kopieres ikke ind i repoet. Proxyen skalerer til
sine eksisterende bredder og WebP, uden AI-redigering. Pexels-værten og
previewbanneret aktiveres kun ved **både** `VERCEL_ENV=preview` og det præcise
staging-projekts URL. Produktionens værtsliste udvides ikke.
Heroens lokale Taryn Elliott-foto og kreditering er uændrede.
