# Bofinda — regler for denne mappe

Læs `BRIEF.md` for opgaven. Reglerne her gælder altid, i hver session.

## Må aldrig ske

- **Opfind aldrig data.** Fandt adapteren ikke et billede, indsættes ingen
  placeholder. Fandt den ikke arealet, står feltet `null` og vises ikke.
  Ingen eksempelbilleder, ingen estimerede arealer, ingen opdigtede tal.
  Rentola gør det modsatte — det er derfor deres udbudstal ikke kan
  sammenlignes med vores.
- **Ingen omgåelse af bot-beskyttelse.** Ingen CAPTCHA-løsning, ingen
  proxy-rotation for at skjule os, ingen fingerprint-spoofing, ingen
  falsk User-Agent. Crawleren præsenterer sig med kontakt-URL. Kilder der
  spærrer, tages som feed-aftale eller slet ikke.
- **Testkilder kører kun, når nogen navngiver dem.** `npm run import` uden
  argument springer alt med `kunUdvikling` over. En testbolig til 4.200 kr
  står i søgelisten præcis som en rigtig, og `NODE_ENV` er ikke sat lokalt.
- **Kanonisering hører til i nøglen, ikke i data.** `listings.door` gemmer
  kildens skrivemåde (`dør2`), mens dedup-nøglen kanoniserer (`doer2`).
  Blandes de to, ender kildens egen stavemåde forvansket i basen.
- **Ingen kilde uden en linje i `sources`.** Alt der skrives til `listings`
  skal have et `source_id` og et `source_type`. Ingen løse import-scripts.
- **Adapteren læser felter fra en allowlist, aldrig fra en denylist.**
  Hver adapter navngiver eksplicit de felter, den læser ud af kildens
  objekt, og kasserer resten ulæst. Aldrig `...raw`, aldrig en løkke over
  `Object.keys`, aldrig et felt hvis indhold ikke er set på mindst ti
  rigtige poster.
  **Hvorfor:** kildernes datamodeller bærer interne sagsbehandlernoter med
  navne, telefonnumre og mailadresser på *nuværende* lejere. Hos
  findbolig.nu hedder feltet `comment`. Dem har vi hverken ret til eller
  brug for, og de må ikke læses, skrives eller logges. En denylist dækker
  i dag og svigter i morgen: tilføjer kilden et nyt felt med samme slags
  indhold, flyder det lige igennem. En allowlist svigter den anden vej —
  nye felter ignoreres, indtil nogen bevidst tilføjer dem.
  Af samme grund henter findbolig-adapteren aldrig detaljesiden: det, vi
  ikke modtager, kan vi ikke komme til at gemme.
- **Slå aldrig TLS-verifikation fra.** `NODE_TLS_REJECT_UNAUTHORIZED=0`
  gælder hele processen og ville også ramme Supabase. Mangler en kilde et
  mellemcertifikat, lægges det i `certs/` og peges på med
  `NODE_EXTRA_CA_CERTS`.
- **Kopiér aldrig kildens brødtekst.** `description` bygges af egne
  strukturerede felter. Fakta er frie, prosa er ikke.
- **Kopiér aldrig kildens billeder.** Gem `external_url`, servér gennem
  signeret proxy.
- **Slå aldrig Row Level Security fra.** Supabase eksponerer `public` gennem
  PostgREST; en tabel uden RLS kan læses med den offentlige nøgle, og så er
  betalingsmuren pynt. Ny tabel = `enable row level security` i samme
  migration. Fejler et kald, er det politikken der er forkert — ikke RLS.
- **Secret-nøglen (tidl. `service_role`) må aldrig i frontend.** Kun den
  offentlige publishable-nøgle når browseren.
- **Migrationer må aldrig køre gennem transaction pooleren (:6543).**
  `drizzle-kit` bruger `DATABASE_URL_DIRECT` på 5432. Transaction mode kan
  ikke holde en session, og DDL kræver en.
- **`prepare: false` når koden kører på Vercel.** Prepared statements bag
  Supavisor i transaction mode fejler først under belastning.
- **Betalingsmuren håndhæves server-side**, i selve query'en. Aldrig ved at
  skjule et felt i klienten.
- **BoligPortal er ikke en kilde.** Deres robots.txt forbyder crawling
  udtrykkeligt på skrift. Kræver skriftlig aftale først.

## Arbejdsform

- Vis planen, før du ændrer filer.
- Fase 1 er projektets port. Gå ikke videre, før én kørsel har været stabil.
- Normalisering, adressevask, dedup og upsert ligger centralt i `lib/`,
  ikke i adapteren. En ny kilde er én fil i `adapters/`.
- Adressenøgler fra `SimpelAdressevask` er **interne**, ikke DAR-UUID'er.
  De bærer præfikset `intern:v1:`. Ændres normaliseringen, skal versionen
  hæves — ellers skifter gamle rækker gruppe uden at blive skrevet om.
- **Afmeldning skal altid gennem sikringen i `koerKilde`.** Tre grunde til
  at springe over: intet skrevet, over 20 % fejlede udtræk, eller under
  halvdelen af medianen. En knækket parser må aldrig tømme basen.
- Maks 1 request/sekund per domæne. Backoff på 429 og 503.
- Databasen ligger på Supabase, workeren på Railway, frontenden på Vercel.
  Se README for topologi og forbindelsesbudget.
- Al brugervendt tekst på dansk. Identifiers uden æøå.
- Alle beløb i øre. Aldrig float.

## Noterede kilder

Beslutninger om enkeltkilder. Skrevet ned, fordi begrundelsen er dyrere at
genfinde end at skrive ned — og fordi et fravalg uden begrundelse bliver
lavet om af den næste, der kigger på tallene.

### findbolig.nu — i brug, med allowlist

`POST /api/search`, filtre i body'ens `filters`, ikke som query-parametre.
Gyldige værdier fra `GET /api/search/suggestions/{tekst}`.

Svaret blander `$type: "Property"` (ejendomme med venteliste) og
`$type: "Residence"` (enkelte lejemål). Kun `Residence` er et lejemål.
`totalResults` tæller på tværs af ejendomme og er **ikke** længden af
`results` — pagineringen kører til `results` er tom.

**Adapteren henter aldrig detaljesiden.** Søge-API'et giver hele objektet,
så `discover()` cacher det og `extract()` læser fra cachen. Det er ikke en
optimering, det er privatlivsgrænsen: det, vi ikke modtager, kan vi ikke
komme til at gemme. Feltet `comment` med interne sagsbehandlernoter fandtes
ikke i søge-API'ets svar (72 poster gennemgået), men allowlisten står, fordi
det kan ændre sig uden varsel.

Serveren sender ikke sit mellemcertifikat. Se `certs/`.

### Propstep — i brug, med allowlist

White-label af Rotation CRM. `__NEXT_DATA__` læses ud af HTML'en på to sider:
`/da-DK/lejebolig?page=N` (søgegitteret, 29 sider à 24) og
`/da-DK/bolig/{id}-{slug}` (økonomi og boligdetaljer).

Der findes også `/_next/data/{buildId}/…json`. **Brug den ikke.** `buildId`
skifter ved hver deploy, og en adapter, der skal gætte deres deploy-id,
knækker stille. HTML'en koster ~100 kB ekstra og har ingen bevægelige dele.

Beløb er allerede i mindste enhed — `transactionDetails.unit = 'cents'`.
Er `unit` noget andet, forstår vi ikke tallene, og så oplyses ingen økonomi.

**Fravalgt 30. august, taget ind igen samme dag.** Baggrunden skal stå, for
den kan blive relevant igen: `__NEXT_DATA__` på en offentlig boligside
serverer også `propertyGroup.contractBankAccount`, `owner.emails`,
`property.note`, `application` og `statusHistory[].authorId`. Ejeren har
efterset én annonce: felterne findes i modellen, men står tomme, og
`owner.emails` indeholder kun Propsteps egen firmamail. Det er altså tomme
DTO-felter, ikke et læk. Vi har **ikke** scannet flere annoncer for at
bekræfte det, og det er en bevidst beslutning.

Indvendingen var aldrig, at vi kunne komme til at læse felterne — det
forhindrer allowlisten. Den var, at en kilde, der lækker den slags, bliver
lukket eller låst, når nogen opdager det, og så står vi med en adapter, der
skal laves om. Den risiko er vurderet og accepteret.

Discovery filtrerer på postnummer **i gitteret**, før nogen detaljeside
hentes. Gitterobjektet har 19 felter, alle harmløse. Kun `extract()` rører
detaljesiden, og kun `propertyOverview.property`.

Aldrig: `note` · `owner` · `propertyGroup` · `application` ·
`statusHistory` · `transactionStatusHistory` · `accountId` · `companyId` ·
`ownerId` · `transactionId` · `settings`.

Kun `propertyDetails.type = 1` er verificeret (renderer som "Lejlighed").
Andre værdier giver `null` og logges — de gættes ikke, heller ikke ud fra
rækkefølgen i deres i18n-nøgler.

### Ikke undersøgt endnu

Cepheus (tom robots.txt, intet sitemap), Lokalbolig (robots tillader
`User-agent: *` og `Content-Signal: search=yes`, men sitemap svarer 502).

### BoligPortal — må ikke bruges

Deres robots.txt forbyder crawling udtrykkeligt på skrift. Kræver skriftlig
aftale først. Se reglen ovenfor.

## Om projektet

Bofinda samler ledige lejeboliger fra flere kilder, lader brugeren søge
gratis og tager betaling for at kontakte udlejeren.

To ting adskiller os fra Rentola og Bolivo: **hastighed** (nye boliger
inden for minutter, drevet af `first_seen_at`) og **fuld økonomi**
(indflytningspris og reel månedlig udgift, ikke bare husleje).

Begge løfter afhænger af, at data er ægte. Et estimeret areal eller et
gættet aconto-beløb ødelægger dem begge.
