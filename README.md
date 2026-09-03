# Bofinda

Dansk lejeboligportal. Aggregerer ledige lejeboliger fra flere kilder,
lader brugeren søge gratis, og tager betaling for at kontakte udlejeren.

Se `BRIEF.md` for produktet og `CLAUDE.md` for reglerne i mappen.

---

## Topologi

Databasen ligger på Supabase. Railway beholdes udelukkende til
scraper-workeren.

```
   Vercel                    Supabase
   ┌──────────┐              ┌─────────────────────────┐
   │ Next.js  │──── :6543 ──▶│ Supavisor               │
   │ frontend │  transaction │  transaction mode       │
   └──────────┘              │         │               │
                             │         ▼               │
   Railway                   │   ┌───────────┐         │
   ┌──────────┐              │   │ Postgres  │         │
   │  worker  │──── :5432 ──▶│   │           │         │
   │ (scraper)│ session/direct   └───────────┘         │
   └──────────┘              └─────────────────────────┘
```

Supavisor er indbygget, så der skal ikke køre en pooler-service nogen
steder. Workeren går uden om den: den er én lang proces med sin egen
pool, den har intet at multiplekse, og session/direct lader den beholde
prepared statements.

## To connection strings, og de er ikke ombyttelige

| Variabel | Port | Peger på | Bruges af |
|---|---|---|---|
| `DATABASE_URL` | 6543 | Supavisor, transaction mode | Vercel-frontenden |
| `DATABASE_URL_DIRECT` | 5432 | Session pooler eller direct | Worker og `drizzle-kit` |

**Migrationer skal køre på `DATABASE_URL_DIRECT`.** DDL og advisory locks
kræver en session, og transaction mode giver en tilfældig
server-forbindelse per transaktion. `drizzle.config.ts` peger derfor
bevidst på 5432.

Direct connection (`db.<ref>.supabase.co:5432`) er IPv6-only på nye
Supabase-projekter. Virker din maskine eller Railway ikke på IPv6, så tag
**session pooleren** på port 5432 i stedet — den er IPv4 og kan lige så
godt holde en session.

## Faldgruben: prepared statements

`postgres.js` bruger prepared statements som standard. Bag Supavisor i
transaction mode lander næste transaktion måske på en anden
server-forbindelse, og så fejler den med *"prepared statement does not
exist"* — typisk først under belastning, hvilket gør den ubehagelig at
finde.

`db/client.ts` sætter derfor `prepare: false`, når koden kører på Vercel,
og lader dem være slået til i workeren.

## RLS er ikke valgfrit her

Supabase eksponerer `public`-skemaet gennem PostgREST. En tabel uden RLS
kan læses af enhver med den offentlige publishable-nøgle — også
`listings.contact_email`, som er præcis det, betalingsmuren sælger.

Migration `0001_enable_rls.sql` slår RLS til på samtlige tabeller og
opretter med vilje **ingen** politikker: Bofinda taler med databasen over
en almindelig Postgres-forbindelse som ejer-rollen, og den går uden om
RLS. `anon` og `authenticated` får dermed adgang til ingenting.

Ny tabel skal have `enable row level security` i samme migration.

## Forbindelsesbudget

Tallene afhænger af Supabase-planen. Slå dem op under
**Project Settings → Database**, og fordel dem sådan:

| Forbruger | Går på | Forbindelser |
|---|---|---:|
| Vercel-lambdaer | Supavisor `:6543` | 1 hver, mange klienter |
| Worker på Railway | `:5432` | 10 |
| `drizzle-kit`, psql, ad hoc | `:5432` | 5 |

Frontenden tæller mod Supavisors klientgrænse, ikke mod Postgres'
`max_connections`. Rykker tallene sig, er pool size i Supabase-dashboardet
knappen der skal drejes på — ikke `max` i Drizzle-klienten.

## Kom i gang

```bash
npm install
cp .env.example .env        # udfyld begge DATABASE_URL'er
npm run db:generate         # laver migration af db/schema.ts
npm run db:push             # kører den — mod DATABASE_URL_DIRECT
```

| Kommando | Gør |
|---|---|
| `npm run dev` | Next.js lokalt |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Migration ud fra skemaet |
| `npm run db:push` | Kører migrationer (direkte forbindelse) |
| `npm run import` | Kører importen én gang |
| `npm run db:backup` | Dumper hele databasen til `backup/` |
| `npm run db:backup:proev` | Genskaber nyeste dump i en lokal base og tæller efter |
| `npm run tjek:noegler` | Prøver kodeord og nøgler i `.env` — printer ingen værdier |

Lokalt sættes `VERCEL` ikke, så klienten vælger worker-profilen og går på
`DATABASE_URL_DIRECT`. Det er det rigtige til udvikling.

---

## Backup og genskabelse

Free-planen hos Supabase tager **ingen** automatiske backups, og der er kun
én database — udvikling og produktion er den samme. Går den tabt, er
boligerne, alarmtilmeldingerne og udlejerkontiene væk.

```bash
npm run db:backup           # → backup/bofinda-<tidsstempel>.sql
npm run db:backup:proev     # genskaber den nyeste og tæller efter
```

`backup/` er i `.gitignore`. **Filen indeholder adgangskode-hashes fra
`auth.users`.** Den må ikke committes eller sendes nogen steder hen.

### Hvad filen er, og hvad den ikke er

Der er ingen `pg_dump` på maskinen — og ingen `brew` til at hente den — så
dumpet skrives med databasens eget COPY-format gennem `postgres.js`. Det
svarer til `pg_dump --data-only`:

| | |
|---|---|
| **med** | alle rækker i `public`, og `auth.users` (udlejerkontiene) |
| **ikke med** | tabeldefinitioner — dem laver `db/migrations`, som ligger i git |
| **ikke med** | filerne i storage-bucket'en. Se nedenfor. |

Hele dumpet tages i én transaktion (`repeatable read`), så alle tabeller
ses i samme øjeblik. Uden det ville `listings` blive læst kl. 12.00.01 og
`listing_images` kl. 12.00.31, og et billede oprettet derimellem ville
pege på en bolig, filen ikke har.

Filen indeholder **ingen** `truncate` og **ingen** `delete`. Køres den mod
en base med data i, fejler den på en nøglekonflikt. Det er med vilje: en
backupfil, man kommer til at køre, må ikke kunne slette noget.

Til sidst i filen står et manifest med rækketal og en SHA-256 pr. tabel.
Mangler halen `-- FÆRDIG`, blev dumpet afbrudt. Passer en kontrolsum ikke,
har filen taget skade siden.

### Sådan læses den tilbage

Ind i en **tom** base — et nyt Supabase-projekt eller en lokal Postgres:

```bash
export DATABASE_URL_DIRECT="postgresql://…:5432/postgres"   # den nye base
npm run db:migrate                                          # skemaet
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f db/toem-public.sql
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f backup/bofinda-<stempel>.sql
npm run db:status                                           # kontrol
```

`db/toem-public.sql` er nødvendig, fordi `0013_udlejer.sql` selv indsætter
kilden `native` i `sources`. En base bygget af migrationer er altså ikke
tom, og dumpets egen `sources`-række ville støde ind i den.

**`auth.users` er et forbehold.** Skemaet ejer Supabase, ikke os. Rækkerne
er med i dumpet, fordi de er den eneste kopi af udlejerkontiene, men i et
nyt projekt kan `auth`-skemaet have skiftet form, og vi har ikke rettigheder
til at skrive i det som `postgres`-rollen. Regn med, at kontiene skal
oprettes igen, og at udlejerne skal bede om ny adgangskode. `public.users`
og annoncerne kommer tilbage uanset.

### Beviset

`npm run db:backup:proev` bygger en helt ny, tom Postgres i hukommelsen
(PGlite — rigtig Postgres i WebAssembly, ingen installation), kører
`db/migrations` på den, læser dumpet ind og sammenligner. Den rører aldrig
produktionsdatabasen; den har ikke engang en forbindelse ud af maskinen.

Den kontrollerer fire ting: at halen er der, at kontrolsummerne passer, at
rækketallene stemmer med manifestet, og at hver linje kommer **uændret**
tilbage, når tabellen skrives ud igen — ingen afkortet tekst, ingen tabt
tidszone, ingen `jsonb`, der skiftede form.

Afprøvet på tre skadede kopier af et rigtigt dump: en afbrudt fil, en med
én række fjernet, og en med én værdi ændret. Alle tre afvises med exit 1.

### Filerne i storage-bucket'en

Et SQL-dump kan ikke tage dem med — de ligger hos Supabase, ikke i basen.
`db:backup` skriver derfor en sidefil, `backup/…-filer.txt`, med hvad der
lå der. Den er ikke en backup, men den siger præcis, hvad der manglede.

I dag er det 35 filer på 4,4 MB: billeder fra én prøveannonce. Det er
ikke værd at bygge noget for. Skal det gøres, er det en løkke over
`storage.objects`, en signeret download-URL pr. fil og en `tar` ved siden af
dumpet — en halv times arbejde, som med fordel kan vente, til der er
annoncer fra fremmede udlejere i bucket'en. Fra det øjeblik er billederne
noget, vi har lovet at passe på, og de findes kun ét sted.

---

## Workeren på Railway

Importen kører som en **cron-service**, ikke som en evigt kørende proces.
Kørslen tager omkring fem minutter; en proces der sover de resterende 55
koster containertid uden at lave noget, og hver cron-kørsel bliver sin egen
aflæselige log i dashboardet.

**Servicen bygger ikke frontenden.** `buildCommand` er sat til et `echo`,
fordi Railpack ellers opdager Next.js og kører `next build` — et byg denne
service aldrig bruger, men som kan vælte importen. Det skete: efter
design-ændringerne fejlede deployet på `next build`, mens importen selv var
uberørt. Frontenden bygges på Vercel, hvor den hører hjemme.

Servicen kører `npm run import`, som afslutter af sig selv.
`restartPolicyType: NEVER` sikrer, at Railway ikke genstarter den i ring —
cron-planen er det, der starter den igen.

### Miljøvariabler i Railway-panelet

| Variabel | Værdi | Hvorfor |
|---|---|---|
| `DATABASE_URL_DIRECT` | Supabase **session pooler**, port 5432 | Det eneste, workeren bruger. `VERCEL` er ikke sat, så `db/client.ts` vælger worker-profilen: pool på 10, prepared statements slået til. |
| `ADDRESS_WASHER` | `simpel` | Indtil DAR er bygget. |
| `CRAWLER_USER_AGENT` | `BofindaBot/1.0 (+https://bofinda.dk/bot; kontakt@bofinda.dk)` | Crawleren præsenterer sig altid. |
| `CRAWLER_RATE_MS` | `1000` | Ét request i sekundet per domæne. |
| `TZ` | `Europe/Copenhagen` | Så logtidspunkter kan læses uden hovedregning. |
| `RUNNER` | `railway` | Skrives i `crawl_runs.runner`. Uden den kan to importører ikke skelnes i basen. |
| `BALDER_API_KEY` | Balders søgenøgle | Uden den springer Balder-kilden over med en klar fejl. Nøglen ligger i Balders eget frontend-bundt og bruges dér **efter Balders egen anvisning** — se `docs/kildetilladelser.md`. Kan skifte uden varsel; rettes her og i `.env`, aldrig i adapteren. |
| `RESEND_API_KEY` | Resend-nøgle med **kun** sende-rettighed | Alarmmails sendes af importøren, ikke af frontenden. Stod ikke i denne tabel før — men den ER sat på Railway, og mails er gået ud derfra. |
| `ALARM_AFSENDER` | `Bofinda <alarm@dit-domæne>` | Uden den sendes ingenting. |
| `ALARM_TILLADTE_MODTAGERE` | Ejerens egen adresse, mens der indkøres | Indkøringsventilen. Er den sat, får kun de adresser mail; alle andre springes over og logges. Fjern den, når fremmede skal have alarmer. |

**Sæt ikke** `DATABASE_URL` — det er poolerens URL til Vercel-frontenden, og
workeren skal netop uden om transaction-pooleren.

**Sæt ikke** `PROPSTEP_POSTNR` eller `FINDBOLIG_OMRAADE` — tomme betyder
fuld dækning.

`NODE_EXTRA_CA_CERTS` sættes ikke i panelet: den står i `npm run import` og
peger på `certs/rapidssl-tls-rsa-ca-g1.pem`, som er committet og følger med
deployet. findbolig.nu sender ikke sit mellemcertifikat — uden det fejler
kilden med `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

### Cron-planen

Sættes på servicen i Railway: **Settings → Cron Schedule → `0 * * * *`**
(hver time, minut 0). Nøglen findes ikke pålideligt i `railway.json`, så den
skal sættes i panelet.

### Kontrol efter første kørsel

Loggen skal vise to linjer som disse:

    [findbolig] ✓ fandt 147 · 0 nye · 0 hentet igen · 147 bekræftet · 0 afmeldt · 0 fejl
    [propstep]  ✓ fandt 692 · 0 nye · 60 hentet igen · 626 bekræftet · 0 afmeldt · 6 fejl

De 6 fejl hos Propstep er 404 på ejendommen Kochsgade 21B: gitteret viser
dem, detaljesiderne er væk. Kilden er ude af trit med sig selv.

Bagefter lokalt: `npm run puls` — kørslerne skal fortsætte i samme takt.

---

## Frontenden på Vercel

Repoet er `ukutuku/Bofinda`. Vercel bygger `main` med **standard `next build`** —
modsat Railway-servicen, hvor byggekommandoen bevidst er slået fra, fordi den
kun kører importøren.

### Miljøvariabler i Vercel-panelet

| Variabel | Værdi | Hvorfor |
|---|---|---|
| `DATABASE_URL` | Supabase **transaction pooler**, port **6543** | `NEXT_RUNTIME` er sat på Vercel, så `db/client.ts` vælger serverless-profilen: pool på 1, `prepare: false`. |
| `BILLED_HEMMELIGHED` | **nøjagtig samme værdi som lokalt** | Signerer `/api/billede`. En anden værdi gør hver eneste udsendt billed-URL ugyldig på én gang. |
| `NEXT_PUBLIC_BASE_URL` | `https://<dit-domæne>` | Bruges i alarmmailens links og i `sitemap.xml`. Peger den forkert, virker afmeldingslinket ikke. |
| `CRAWLER_USER_AGENT` | `BofindaBot/1.0 (+https://bofinda.dk/bot; kontakt@bofinda.dk)` | Billed-proxyen præsenterer sig over for kilderne. |
| `NODE_EXTRA_CA_CERTS` | `./certs/rapidssl-tls-rsa-ca-g1.pem` | **Nem at glemme.** Se nedenfor. |

**Sæt ikke `DATABASE_URL_DIRECT`.** Det er session-pooleren, som workeren og
migrationerne bruger. Frontenden skal gennem transaction-pooleren, og en
serverless-funktion med session-forbindelser æder Supabases 15 pladser.

**Sæt ikke `RESEND_API_KEY` eller `ALARM_*`.** Mails sendes af importøren på
Railway, ikke af frontenden.

### Rotation af legitimation

Kodeord og nøgler ligger tre steder, og de skal opdateres i alle tre.
`npm run tjek:noegler` prøver dem på DIN maskine bagefter — den printer
aldrig en værdi, kun om den blev accepteret.

**Databasekodeordet** (Supabase → Project Settings → Database → Reset).
Det ligger inde i begge forbindelsesstrenge, så alle tre steder rammes:

| Sted | Variabel |
|---|---|
| `.env` lokalt | `DATABASE_URL` **og** `DATABASE_URL_DIRECT` |
| Railway | `DATABASE_URL_DIRECT` |
| Vercel | `DATABASE_URL` |

Kopiér de nye strenge fra Supabase-panelet — skriv dem ikke om i hånden.
Vært og brugernavn er forskellige for de to poolere (`postgres` mod
`postgres.<ref>`), og en håndrettet streng rammer let den forkerte.
Vercel læser miljøvariabler ved kold start, så et **nyt deploy** skal
udløses, før ændringen gælder. Rotér ikke midt i en Railway-kørsel; se
`crawl_runs` eller cron-planen først.

**`RESEND_API_KEY`** (Resend → API Keys → opret ny, brug den, slet den
gamle). Kun to steder: `.env` lokalt og Railway. **Sæt den ikke på
Vercel.** Giv den kun **sending access** — en nøgle med fuld adgang kan
læse og slette domæner, og alarmen skal kun sende.

### Certifikatet — det der ellers ville bide

findbolig.nu sender ikke sit mellemcertifikat. Lokalt løses det af
`NODE_EXTRA_CA_CERTS` i npm-scripterne, men **Vercels serverless-funktioner
kører ikke gennem npm**, så variablen skal sættes i panelet. Filen kommer med
i bundtet via `outputFileTracingIncludes` i `next.config.ts`.

Uden begge dele fejler 3.400 findbolig-billeder med
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` — og kun dem, så det ligner et problem med
enkelte boliger frem for en manglende indstilling.

### Klikvejen

1. **Add New → Project → Import Git Repository → `ukutuku/Bofinda`**
2. Framework: **Next.js** (registreres selv). Rør ikke Build Command,
   Output Directory eller Install Command.
3. **Environment Variables** → indsæt de fem ovenfor, for Production,
   Preview og Development.
4. **Deploy**.
5. Sæt domænet under **Settings → Domains**, og ret derefter
   `NEXT_PUBLIC_BASE_URL` til det, hvis du gættede forkert. Variablen
   bruges ved byg — så **redeploy** efter ændringen.

### Kontrol efter første deploy

    /                     søgesiden, 48 kort
    /lejeboliger/2300     områdeside med tal
    /bolig/<id>           galleri, økonomi, kort
    /api/billede?...      image/webp — prøv en findbolig- OG en dacas-bolig
    /sitemap.xml          128 URLer

Virker billederne på Propstep-boliger men ikke på findbolig-boliger, er det
`NODE_EXTRA_CA_CERTS`, der mangler.
