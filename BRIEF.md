# Bofinda — brief til Claude Code

Dansk lejeboligportal. Aggregerer ledige lejeboliger fra flere kilder,
lader brugeren søge gratis, og tager betaling for at kontakte udlejeren.
Differentiator: hastighed (nye boliger inden for minutter) og hele udgiften
til udlejeren — husleje plus aconto, plus indflytningsprisen. Ikke bare
huslejen.

## Stack

- Next.js 15 (App Router) + TypeScript, Vercel
- Supabase Postgres + Drizzle ORM. Pooling er indbygget (Supavisor):
  transaction mode pa 6543 til serverless, session/direct pa 5432 til
  migrationer og worker.
- Supabase Auth. Erstatter den auth, fase 0 oprindeligt lagde op til —
  vi bygger ikke vores egen. Bemaerk at `users`-tabellen i skemaet dermed
  skal binde til `auth.users`, ikke eje adgangskoder selv.
- Worker: separat proces pa Railway. Railway beholdes udelukkende til
  denne — databasen ligger pa Supabase.
  **Importerne kan ikke køre på Vercel** — serverless timeout er sekunder,
  en discovery-kørsel tager minutter. Byg worker fra dag ét.
- Stripe Billing til abonnementer
- Resend til mail
- imgproxy eller Cloudflare Images som signeret billed-proxy

## Fem arkitekturvalg, der er dyre at ændre senere

### 1. `source_type` på hver bolig
Værdier: `feed` | `spider` | `native`.
Styrer hvilke felter der må vises, og om kontakt sker internt eller via link.
`native` = udlejer har oprettet den selv og har en bruger → intern samtale.
`feed` og `spider` → link videre til kilden.

### 2. `external_key` = hash af kilde-URL
Ikke et løbenummer. Uden en stabil ekstern nøgle indsætter re-scrape
dubletter i stedet for at opdatere. Upsert altid på
`(source_id, external_key)`.

### 3. Billeder hotlinkes, aldrig kopieres
Gem kildens `external_url` i `listing_images`. Servér gennem signeret
proxy der resizer og konverterer til WebP on-the-fly. HMAC i stien, så
proxyen ikke kan bruges af fremmede. Nul lagerplads, aldrig forældede
billeder.

### 4. Beskrivelser genereres fra strukturerede felter
Kopiér aldrig kildens brødtekst. Byg teksten af egne felter:
areal, pris, værelser, adresse, faciliteter. Giver samtidig ensartet
tone på tværs af alle kilder.

### 5. Betalingsmuren står ved kontakt, håndhæves server-side
`is_blurred` afgør i API-laget om kontaktfelter returneres.
Aldrig klient-side. Nulstil felterne i selve query'en, ikke i UI.

På Supabase er der et lag mere: `public`-skemaet eksponeres gennem
PostgREST. En tabel uden RLS kan læses direkte med den offentlige
nøgle, og så er muren ligegyldig, uanset hvad API-laget gør.
RLS skal være slået til på hver eneste tabel.

### 6. Manglende felter forbliver tomme
Fandt adapteren ikke et billede, indsættes ingen placeholder. Fandt den
ikke arealet, står feltet null og vises ikke. Udfyld aldrig et manglende
felt med et estimat eller et eksempelbillede — det ødelægger
datakvaliteten og gør alarmerne upålidelige.

Rentola har et `exampleImageUrl` og et `estimatedArea`-flag i deres API,
altså den modsatte beslutning. Værd at kende, hvis du senere sammenligner
udbudstal med dem: deres tælling og din tæller ikke det samme.

## Kildeprioritering

Gå efter **administrationssystemer**, ikke portaler. Én integration
giver mange udlejere:

Laros · Propstep · Cepheus · Dacas · Lokalbolig · GoBolig

Kontakt dem om partner-feed før der skrives en scraper. Deres kunder
vil gerne eksponeres — det er hele deres formål.

Portaler (BoligPortal, Bolivo, Rentola) er lavere prioritet. Deres data
er deres produkt, de overvåger for det og blokerer, og du ville arve
deres forsinkelser og døde annoncer — hvilket trækker direkte fra
hastighedsløftet.

Kendte forhindringer pr. kilde: Heimstaden kører Wordfence og afviser
allerede ved første kald fra en server. De har til gengæld et
`api/feed/rentals/`-endpoint, der regenereres hver nat, så vejen dertil
går via deres udlejningsafdeling.

## Byggerækkefølge

**Fase 0 — fundament (2-3 dage)**
Repo, Supabase-projekt, Drizzle-skema, RLS pa alle tabeller,
Supabase Auth, deploy, domæne, mail.

**Fase 1 — forsyning (5-7 dage)**
Adapter-kontrakt, tre kilder, discovery/extract/normalize, adressevask
mod det officielle adresseregister, dedup på adresse-UUID, worker,
scheduler.

Mål: 1.000+ boliger der opdaterer sig selv dagligt.

**Dette er projektets port.** Virker fase 1 ikke, er resten værdiløst.
Gå ikke videre før en kørsel har været stabil i tre døgn i træk.

**Fase 2 — offentligt produkt (4-5 dage)**
Søgeside, filtre, kort, boligside. Programmatiske SEO-ruter
(by × type × prisinterval) med sitemaps — det er den kanal, der driver
konkurrenternes organiske trafik. Gemte søgninger med alarm på
`first_seen_at`.

**Fase 3 — penge (3-4 dage)**
Stripe Checkout, webhooks, kundeportal, muren ved kontakt, opsigelse.

**Fase 4 — udlejerside (4-5 dage)**
Registrering, opret annonce, billedupload, samtaler, beskeder,
abonnementsspærring, notifikationer.

Udlejersiden ligger sidst, fordi den har nul brugere på dag ét.

## Adapter-kontrakt

```ts
interface RawListing {
  externalKey: string        // hash af kilde-URL, stabil på tværs af kørsler
  sourceUrl: string
  address: string            // rå adressestreng fra kilden
  postalCode?: string
  sizeM2?: number
  rooms?: number
  rentMonthly?: number
  utilitiesHeat?: number
  utilitiesWater?: number
  utilitiesElectricity?: number
  moveInCost?: number
  availableFrom?: string     // ISO-dato
  propertyType?: string
  amenities?: string[]
  imageUrls: string[]        // kildens egne URL'er, hotlinkes
}

interface SourceAdapter {
  id: string
  sourceType: 'feed' | 'spider'
  discover(): Promise<{ externalKey: string; url: string }[]>
  extract(url: string): Promise<RawListing>
}
```

Normalisering, adressevask, dedup og upsert ligger centralt — ikke i
adapteren. En ny kilde skal være én fil, ikke en ombygning.

## Drift

- Maks 1 request/sekund per domæne. Backoff på 429 og 503.
- Ærlig User-Agent med kontakt-URL.
- Discovery hvert 15. minut. Mængdedifference mod sidste kørsel:
  nye URL'er → `first_seen_at`. Forsvundne → `delisted_at`.
- Alarm når en kilde falder >30 % i antal eller returnerer nul.
  Scrapers dør stille.

## Første session

Byg ikke portalen. Byg dette og stop:

1. Next.js 15 + TypeScript + Drizzle + Neon, skemaet fra `schema.ts`
2. Adapter-kontrakten
3. Én adapter mod en kilde med åbent feed
4. Et script der kører adapteren og skriver til databasen

Ingen frontend. Når én bolig ligger korrekt i databasen, er resten
gentagelse.
