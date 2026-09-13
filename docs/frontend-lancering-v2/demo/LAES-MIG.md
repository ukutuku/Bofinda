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
Der er ingen koordinater eller DAR-identifikatorer. Datasættet afprøver
derfor ikke kortplacering, adressevask eller rigtige udlejerannoncer.

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
