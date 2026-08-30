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
- **Ingen kilde uden en linje i `sources`.** Alt der skrives til `listings`
  skal have et `source_id` og et `source_type`. Ingen løse import-scripts.
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
- Maks 1 request/sekund per domæne. Backoff på 429 og 503.
- Databasen ligger på Supabase, workeren på Railway, frontenden på Vercel.
  Se README for topologi og forbindelsesbudget.
- Al brugervendt tekst på dansk. Identifiers uden æøå.
- Alle beløb i øre. Aldrig float.

## Om projektet

Bofinda samler ledige lejeboliger fra flere kilder, lader brugeren søge
gratis og tager betaling for at kontakte udlejeren.

To ting adskiller os fra Rentola og Bolivo: **hastighed** (nye boliger
inden for minutter, drevet af `first_seen_at`) og **fuld økonomi**
(indflytningspris og reel månedlig udgift, ikke bare husleje).

Begge løfter afhænger af, at data er ægte. Et estimeret areal eller et
gættet aconto-beløb ødelægger dem begge.
