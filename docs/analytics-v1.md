# Analytics v1 — first-party produktmåling

Designet for Bofindas egen måling. **Intet af det er bygget endnu.** Filen er
skrevet før implementationen, fordi begrundelserne er dyrere at genfinde end at
skrive ned — og fordi hver eneste af de beslutninger, der står her, er nem at
lave om til noget, der ser rigtigt ud og tæller forkert.

**Status pr. 7. september 2026: bygget, men slukket.** Migration 0020 er kørt,
koden er på plads, privatlivsteksten er opdateret, og banneret findes. Der
skrives **ingenting**, fordi `MAALING_AKTIV` ikke er sat noget sted.

> ### Skærpelse efter godkendelsen
>
> **Uden analytics-samtykke gemmes der ikke ét individuelt event.** Designet
> havde oprindeligt et lag nedenunder, som skrev de samme server-events uden
> identifikator, så aggregerede tal dækkede 100 % af trafikken. Det lag er
> **fjernet**. Der er ingen «aggregeret før samtykke»-mekanik, og intet, der
> først gemmer individuelle events og aggregerer dem bagefter.
>
> Konsekvensen er reel og skal stå tydeligt: **alle tal i systemet dækker kun
> de brugere, der har sagt ja** — også de rent aggregerede spørgsmål som «hvor
> mange søgninger» og «hvor ofte nul resultater». Andelen af ja'er bliver
> dermed selv et tal, man skal kende, før nogen af de andre kan tolkes.
>
> Skærpelsen er håndhævet **i databasen**, ikke kun i koden: `anonymous_id` og
> `session_id` er `not null`, så en række uden samtykke fysisk ikke kan
> skrives.

---

## Hvorfor overhovedet en egen tabel

Der er ingen analytics i Bofinda i dag. Ingen provider, intet event, ingen
tracking-kode, ingen consent-logik — søgt over hele repoet efter `analytics`,
`posthog`, `plausible`, `umami`, `matomo`, `mixpanel`, `amplitude`, `gtag`,
`googletagmanager`, `segment`, `telemetry` og `track(`. De eneste træffere er
danske kommentarer og `statistik()` i `lib/omraade.ts`, som er **boligtal til
områdesider**, ikke brugeradfærd.

Valget faldt på en egen førsteparts-tabel frem for en tredjepart af tre grunde:

1. **Privatlivspolitikken navngiver hver databehandler.** En ny tredjepart er en
   ny linje dér og en ny overførsel. Vores egen tabel ligger i den Supabase, der
   allerede står på listen.
2. **Produktet er server-renderet.** De handlinger, der betyder noget, er
   HTTP-requests, serveren i forvejen behandler. En tredjepartsklient ville måle
   det samme dårligere, fra browseren, hvor adblockere sidder.
3. **Vi kan stille spørgsmålene i SQL mod vores egen base**, hvor boligerne og
   kilderne allerede ligger. Kildeperformance er et join, ikke en eksport.

---

## Auditens fund, som resten hviler på

| Fund | Konsekvens for designet |
|---|---|
| Alle ruter er server components; `/` og `/bolig/[id]` har `dynamic = 'force-dynamic'` | Hver visning rammer serveren. Ingen cache skjuler noget, og der er ingen re-render at dobbelttælle |
| Søgeformularen er `<form method="get">` | En søgning er en fuld navigation, ikke et klik i en SPA |
| Kun seks filer har `'use client'` | Klienttrackeren skal være lille, fordi der næsten ikke er klientkode at hænge den på |
| `/` er både forside og resultatside | Skellet er `harFiltre()`, aldrig pathname |
| Udvikling og produktion deler database | `environment` er obligatorisk fra første række |
| `bekraeft()` kan ikke skelne en reel bekræftelse fra «allerede bekræftet» | `alert_confirmed` skal instrumenteres inde i UPDATE-grenen |
| Brugerens `sted` og `by` er fritekst | Kun kanoniske byer fra `facetter()` må gemmes |

---

## 1 · Event-taxonomi

**22 events i v1. 17 måles på serveren, 5 i browseren.**

Bofinda er ikke en SPA, og tre af de navne, en almindelig taxonomi bruger,
ville tælle det samme to gange her. De er derfor defineret gensidigt
udelukkende:

| Event | Fyrer præcis når |
|---|---|
| `search` | Hver request til `/` hvor `harFiltre()` er sand |
| `search_results_view` | Samme request, når `result_count > 0` |
| `empty_results` | Samme request, når `result_count = 0` |

> **Invarianten:** `count(search) = count(search_results_view) + count(empty_results)`
> i ethvert tidsvindue. Går det ikke op, er instrumenteringen i stykker — ikke
> markedet. Det er en prøve, og et bevidst brud på den er en af break-testene.

### Serverside (17)

| Event | Hvor | Påkrævet | Valgfrit | **Forbudt** | Kardinalitet | PII-risiko |
|---|---|---|---|---|---|---|
| `homepage_view` | `app/page.tsx`, `harFiltre() === false` | — | `boliger_i_alt`, `kilder_i_alt`, `referrer_vaert`, `utm_source/medium/campaign` | Hele referrer-URL'en, query-strengen | Lav | Lav |
| `search` | `app/page.tsx`, `harFiltre() === true` | `result_count`, `antal_filtre`, `sorter`, `sted_slags` | `canonical_city`, `postnr`, `price_min`, `price_max`, `rooms_min`, `area_min`, `property_types[]`, `kilde`, `overtagelse`, `venteliste`, `reserveret`, `full_economy`, `facilities[]`, `kort_vist`, `result_view_id` | **Rå `sted`, rå `by`** | Middel | **Høj** |
| `search_results_view` | Samme request | `result_count`, `viste_antal`, `viste_pr_kilde`, `result_view_id` | Filteruddrag som `search` | Som `search` | Middel | Høj |
| `empty_results` | Samme request | `antal_filtre` | Filteruddrag som `search` | Som `search` | Lav | Høj |
| `filter_applied` | `app/page.tsx`, diff mod `Referer` | `felt` | `til`, `fra`, `antal_filtre_efter` | **Referer-strengen og alle dens parametre** | Lav (16 værdier) | **Høj** |
| `filter_cleared` | Samme | `felt` | `fra`, `antal_ryddet` | Samme | Lav | Høj |
| `sort_changed` | Samme | `til`, `fra` | — | Samme | Lav | Lav |
| `listing_view` | `app/bolig/[id]/page.tsx` | `listing_id`, `source_slug` | `postnr`, `property_type`, `timing_status`, `ansoegning_status`, `marked_status`, `egen_annonce`, `total_kendt`, `antal_billeder`, `fra_result_view_id` | `adresse`, `vej`, `husnr`, `contact_*`, `source_url` | Høj på `listing_id` | Middel, indirekte |
| `group_opened` | `app/gruppe/page.tsx` | `listing_id`, `gruppe_antal` | `source_slug`, `postnr` | Som `listing_view` | Lav | Lav |
| `source_click` | `app/go/[id]/route.ts` | `listing_id`, `source_slug`, `maal` | `postnr`, `property_type`, `fra_route` | `source_url` og enhver anden del af kildens payload | Lav | Lav |
| `contact_reveal` | `app/bolig/[id]/kontakthandling.ts` | `listing_id`, `har_mail`, `har_telefon` | — | **Mailen og telefonnummeret** | Lav | **Høj** |
| `alert_created` | `app/GemSoegning.tsx`, kun `slags === 'sendt'` | `filtertyper[]`, `antal_filtre` | Filterfelter som `search` | **`mail`, `navn`, `saved_search_id`, tokens** | Lav | **Højest** |
| `alert_confirmed` | `lib/alarm.ts`, i UPDATE-grenen | `filtertyper[]` | Samme | Samme | Lav | Højest |
| `signup_started` | `app/udlejer/handlinger.ts`, når `signUp()` lykkes | — | — | `email`, adgangskode, Supabases fejltekst | Lav | Høj |
| `signup_completed` | `lib/auth.ts`, første binding af `auth_user_id` | `user_id` | `bandt_eksisterende` | Samme | Lav | Høj |
| `login_completed` | `app/udlejer/handlinger.ts`, `error === null` | `user_id` | — | Samme, plus tokens | Lav | Høj |
| `server_action_failed` | Catch-grenene | `handling`, `fejlklasse` | — | **Fejlbeskeden** | Lav | Middel |

### Klientside (5)

| Event | Hvorfor ikke serverside | Påkrævet | Note |
|---|---|---|---|
| `filter_opened` | `<details class="flere">`-toggle når aldrig serveren | — | Én `toggle`-lytter |
| `map_interaction` | Leaflet er allerede klientkode | `slags` (`zoom`/`pan`/`maerke_klik`) | Strubet: højst ét pr. 2 sek. pr. slags pr. sidevisning |
| `alert_started` | Et tastetryk før indsendelse | — | **Aldrig feltets indhold.** Taxonomiens eneste hensigt — se advarslen nedenfor |
| `contact_click` | `mailto:`/`tel:` forlader siden uden at ramme os | `listing_id`, `maal` | **Aldrig adressen eller nummeret** |
| `listing_impression` | Kræver viewport | `listing_id`, `source_slug`, `result_view_id`, `position`, `sample_andel` | Stikprøvet, kræver samtykke |

> **`alert_started` er det eneste bløde tal i taxonomien.** Alle andre events
> måler et udfald, serveren har set. Dette måler, at nogen begyndte at skrive.
> Ingen JavaScript, intet event; blokeret beacon, intet event. **Brug det som
> forholdstal mod `alert_created`, aldrig som et absolut tal**, og skriv det i
> den rapport, det står i.

### Udeladt med vilje

`favorite`, `checkout`, `subscription`, `message`, `landlord_reply` — funktionerne
findes ikke. `client_error` er defineret og slået fra i v1: `message` og stack kan
begge bære brugerinput, og uden dem er værdien tynd. Performance-events udelades:
LCP og TTFB kræver klientkode på hver eneste side for et tal, ingen af målene
spørger om.

**Senere trin kræver ingen skemaændring.** Et nyt event er en ny variant i unionen
og en linje i allowlisten. `conversation_id` og `subscription_id` hører i
`properties`, indtil en rapport beviser, at de skal forfremmes til en kolonne.

---

## 2 · Sådan måles filtre uden en linje klientkode

Ved en formularindsendelse fra `/` sender browseren `Referer` med **hele den
forrige URL, inklusive query** — det gør standardpolitikken
`strict-origin-when-cross-origin` for samme oprindelse, og Next sætter ingen
anden. Serveren kører `filtreFraParametre()` på begge og sammenligner de to
*filterobjekter*. Diffen er svaret.

Det virker **uden JavaScript, uden cookie og uden samtykke**, og det tæller kun
filtre, der faktisk blev sendt af sted — ikke en dropdown, brugeren rørte og
fortrød. Mangler `Referer`, fyrer der intet: så ændrede hun ikke et filter, hun
åbnede en adresse.

> ### Referer-fælden
>
> **Vores egen URL bærer brugerens rå `sted`- og `by`-fritekst.** Et søgefelt
> med «Anna Hansen, Vestergade 12» står i `?sted=` og dermed i næste requests
> `Referer`.
>
> Referer-strengen og dens parametre må **aldrig** ind i et event. Kun feltnavne
> og typede, kanoniske værdier kommer ud af diffen. Værnet i afsnit 9 ville
> afvise resten, men koden skal ikke læne sig på det — der er en prøve, der
> fodrer et navn og en adresse ind gennem referer'en og hævder, at ingen
> property indeholder nogen del af den strengen.

«Nulstil» går til `/` fra en filtreret URL. Det kollapser til **ét**
`filter_cleared` med `felt: 'alle'` og `antal_ryddet`, ikke en byge på fem
events.

---

## 3 · canonical_city

`facetter()` er allerede hentet på søgesiden og indeholder `byer` fra vores egen
bestand. Matcher brugerens input en by dér, gemmes den; ellers gemmes den ikke,
og `sted_slags` bliver `by_ukendt`.

Det koster **ingen ekstra forespørgsel**, og det er dét, der gør feltet
kategorisk i stedet for fritekst. Værdien kommer fra en lukket mængde, vi selv
ejer — ikke fra tastaturet.

`sted_slags` har fire værdier: `postnr`, `by_kendt`, `by_ukendt`, `ingen`. Selv
når byen ikke gemmes, kan man altså se, at nogen søgte på et sted, vi ikke
kender — hvilket er en interessant oplysning i sig selv.

---

## 4 · Event-envelope

```
id                  uuid          altid
occurred_at         timestamptz   serverens ur, altid
event_name          text          ikke en enum — se nedenfor
schema_version      smallint      2 bytes, gør en taxonomi-ændring læsbar bagud
environment         text          lukket enum, ingen default
anonymous_id        uuid null     null uden samtykke
session_id          uuid null     null uden samtykke
user_id             uuid null     vores egen uuid, aldrig mail
research_session_id text null     tag ovenpå normale events
route               text          MØNSTERET /bolig/[id], aldrig den faktiske URL
listing_id          uuid null     forfremmet: hvert boligjoin går gennem det
source_slug         text null     forfremmet: slug, ikke uuid
properties          jsonb         alt der ikke er forfremmet
expires_at          timestamptz   retention pr. række
```

**Hvorfor `event_name` er `text` og ikke en Postgres-enum:** et nyt event ville
ellers kræve en migration. Den typede union er værnet, og validatoren afviser
ukendte navne.

**Hvorfor `source_slug` og ikke `source_id`:** slug'en er `notNull().unique()` i
`sources` og stabil. En uuid ville kræve et join i hver eneste kilderapport.

**Hvorfor `route` er mønsteret:** `/bolig/[id]` har lav kardinalitet og lækker
intet fra query-strengen. Den faktiske URL indeholder fritekst.

**Fravalgt:** `session_seq` (ville kræve en læsning før hver skrivning), et
`consent`-felt (overflødigt — alt i tabellen kræver enten samtykke eller er
identifikatorfrit), `ip` og `user_agent` (vi persisterer dem ikke, punktum).

### Ingen fremmednøgler — heller ikke på user_id

Det er en bevidst afvigelse fra resten af skemaet:

- **Analytics må aldrig kunne fejle en produktskrivning.** En FK fra en tabel med
  millioner af rækker til `users` eller `listings` betyder, at en sletning i
  produktdata kan låse eller fejle på grund af logningen.
- **Loggen er append-only, ikke relationel tilstand.** Joins hører til i
  forespørgslerne.
- **Sletteretten løses bedre eksplicit:**
  `update haendelser set user_id = null where user_id = $1` af-identificerer, så
  aggregatet overlever, mens personen forsvinder.

---

## 5 · Identitetsmodellen

### anonymous_id

| | |
|---|---|
| Hvad | Tilfældig UUIDv4, dannet **på serveren** ved første svar efter samtykke |
| Hvor | Cookie `bofinda_aid` · `HttpOnly` · `Secure` · `SameSite=Lax` |
| Levetid | **180 dage.** Ikke to år: en boligsøgning varer en sæson |
| Ikke fingerprinting | Ingen IP, ingen user-agent, ingen canvas, ingen skærmopløsning. Ren `crypto.randomUUID()` — den *kan* ikke genskabes, hvis brugeren sletter den |
| HttpOnly | Trackeren kan ikke læse den og behøver den ikke: beacon-endpointet er samme oprindelse, så browseren sender den selv |

### session_id

| | |
|---|---|
| Starter | Første request efter samtykke uden en gyldig `bofinda_sid` |
| Slutter | **30 minutters inaktivitet** (cookien fornyes ved hver request) **og** en **absolut grænse på 12 timer** fra start |
| Hvordan | Cookieværdien er `<uuid>.<starttidspunkt>`. Serveren tjekker begge grænser |
| Hvorfor absolut grænse | Uden den ville en bruger, der åbner siden hver 25. minut i en uge, have **én** session — og så måler feltet ikke længere en session, men en person |

### user_id og sammensyningen

`user_id` er `public.users.id` — vores egen uuid. Mailadressen står i en anden
kolonne, og analytics rører den ikke.

**Det anonyme forløb kobles til det indloggede uden at kopiere noget:**
`anonymous_id` ændrer sig ikke ved login. Rækken fra `login_completed` bærer
begge felter og *er* sammensyningen. Vil man se, hvad en bruger gjorde før hun
loggede ind, slår man hendes seneste `anonymous_id` op og læser dét forløb. Ingen
backfill, ingen kopiering, ingen PII.

### research_session_id

Moderator åbner `bofinda.dk/forsoeg/<kode>` på testenheden. Ruten viser en kort,
ærlig side om hvad der optages, deltageren siger ja, og der sættes to cookies:
analytics-samtykke og `bofinda_forsoeg=<kode>` med 4 timers levetid.

Derefter producerer deltageren **helt almindelige events**, som blot også bærer
taggen. Nulstilling mellem deltagere: åbn ruten med næste kode. **Taggen giver
ingen produktrettigheder** — den læses kun, når et event skrives. Koden er et
løbenummer, aldrig initialer, navn eller mail.

---

## 6 · Server / klient-splittet

**17 af 22 events måles på serveren.** Det er ikke en præference, det er hvad
arkitekturen tillader.

### Den mindste klienttracker

Ingen ramme. Én klientkomponent monteret i `app/layout.tsx`, i størrelsesordenen
90 linjer, som:

- holder køen og en `Set` af allerede sendte nøgler **på modulniveau**, ikke i
  state. Det er dét, der overlever React StrictMode's dobbelt-mount i udvikling,
  og som gør dubletprøven meningsfuld;
- sender køen samlet til `POST /api/maaling` ved `visibilitychange` og
  `pagehide` med `navigator.sendBeacon`, med `fetch(keepalive)` som reserve;
- sender **ingen identifikatorer**. Cookien følger med af sig selv, fordi
  endpointet er samme oprindelse — trackeren kender hverken `anonymous_id` eller
  `session_id` og kan derfor ikke forfalske dem;
- observerer kort med **én delt** `IntersectionObserver`, ikke én pr. kort;
- gør ingenting overhovedet uden samtykke. Den mounter, ser en
  `data-samtykke`-attribut sat af serveren, og går i dvale.

`/api/maaling` validerer hvert event gennem **samme** allowlist som serversiden.
Klienten kan altså ikke sende et event, serveren ikke ville have accepteret.

---

## 7 · Listing impressions

### Definitionen

| | |
|---|---|
| Tæller når | Kortet er **≥50 % synligt i ≥1000 ms**. Ikke ved render, ikke ved et enkelt frames gennemsving under en hurtig scroll |
| Dedup | `(session_id, listing_id, result_view_id)`. Samme bolig i samme resultatvisning tælles **én gang**, uanset hvor mange gange den scrolles forbi. Nøglerne holdes i en `Set` på modulniveau, så de overlever en re-render |
| Kræver samtykke | Dedup uden session-id er ikke muligt, og uden dedup er tallet oppustet. Impressions er derfor det ene event, der **kun** findes for samtykkende sessioner |
| Et gruppekort | Ét kort er **én** impression med `er_gruppe` og `gruppe_antal` — aldrig én pr. bolig bag kortet. Samme regel som produktets egen: tællelinjen tæller boliger, kortene tæller kort |

**Valgt B, ikke A.** «Server-renderet kort = impression» ville tælle alle 48 kort
ved hver søgning, også dem ingen scrollede ned til. Det er ikke et mindre præcist
tal, det er et andet tal — og det ville se ud som om bunden af listen bliver
læst.

### sample_andel

144 impressions pr. bruger pr. dag mod taxonomiens øvrige sytten. Ved fuld
dækning ville impressions alene være omkring 90 % af alle rækker. Derfor
stikprøve — men **pr. session, aldrig pr. event**.

- Deterministisk: `hash(session_id) mod 100 < MAALING_IMPRESSION_PCT`. En session
  er enten fuldt med eller helt ude.
- **Hvorfor pr. session:** tilfældig udvælgelse pr. event ville give sessioner med
  huller, og så er et forløb — «hun så kortet, men åbnede det ikke» — ikke
  længere til at læse. En halv session er værre end ingen.
- Standard **25 %** nu, hvor Pro er aktiv. Skru ned ved 10.000+ daglige brugere.
  `MAALING_IMPRESSION_PCT=0` slukker helt uden en deploy.

> **Regnereglen, og hvorfor feltet er påkrævet:** hver række bærer den andel, den
> blev optaget under. **Enhver optælling skal skaleres med `1 / sample_andel`.**
> Uden feltet er tallet fire gange for lavt på en måde, ingen opdager —
> impressions ser bare lave ud. Dagsaggregatet har sin egen kolonne til det.

`result_view_id` — en uuid dannet pr. resultat-render, båret i
`search_results_view`, i kortenes links og videre til `listing_view` — er det led,
der binder «hvad blev vist» til «hvad blev åbnet» for præcis det resultatsæt.
Uden den kan impressions ikke dedupes.

---

## 8 · Source-click: valgt B

| Kriterium | A · klient-event + direkte link | B · `/go/[id]` redirect |
|---|---|---|
| Pålidelighed | Middel. `target="_blank"` hjælper, men et beacon kan tabes, og midterklik rammes ujævnt | **Høj.** Serveren ser hvert klik, uanset hvordan linket blev åbnet |
| Uden JavaScript | Måler intet | **Måler alt.** Resten af produktet virker uden JS; det bør målingen også |
| Adblock | Reel risiko. Blokeringslister rammer beacon-endpoints, også førsteparts | **Ingen.** En almindelig navigation på vores eget domæne |
| UX | Uændret | Ét ekstra hop, typisk under 100 ms i en ny fane |
| Kompleksitet | Klienttracker på detaljesiden | Én route handler, ~30 linjer |
| Samtykke | Fyrer ikke uden samtykke | Redirecter **altid**, registrerer kun med samtykke. Rent skel |

**Privatlivsdetaljen, der skal huskes:** i dag har linket `rel="noopener
noreferrer"`, så kilden får **ingen** referrer. Det skal bevares med
`Referrer-Policy: no-referrer` på redirect-svaret, ellers ændrer vi stiltiende,
hvad kilderne ser om os.

> ### Sikkerhedskrav
>
> Destinationen slås op i `listings.source_url` ud fra `id`. **Ruten må aldrig
> acceptere en URL som parameter** — det ville være et åbent redirect, som enhver
> kunne bruge til at sende folk hvorhen som helst med bofinda.dk i adressefeltet.
> Ukendt eller ikke-aktiv id → 404, intet event. `robots: noindex`, ikke i
> sitemap.

---

## 9 · PII-værnet

### Lag 1 · compile-time

Diskrimineret union i `lib/maaling.ts`. Hvert eventnavn har én lukket
property-type. Et forkert eventnavn, en ukendt property eller en forkert type er
en **byggefejl** — den når aldrig produktion, fordi `npm run typecheck` og
`next build` begge fejler.

### Lag 2 · runtime

En **allowlist, ikke en blocklist**. En liste over forbudte ord kan aldrig blive
komplet; en liste over tilladte kan.

| Kontrol | Reaktion | Hvorfor ikke omvendt |
|---|---|---|
| Ukendt eventnavn | Hele eventet droppes | Vi ved ikke, hvad det indeholder |
| Ukendt property-nøgle | **Nøglen** droppes, eventet skrives | At kassere en hel søgning på grund af én stray-nøgle taber ægte data. Nøglen tælles og logges |
| Værdi matcher mail | Hele eventet droppes | En mailadresse i en property betyder, at nogen har koblet forkert. Der skal larmes |
| Værdi matcher telefon (8+ cifre) | Hele eventet droppes | Samme |
| Streng > 120 tegn | Hele eventet droppes | Ingen legitim kategorisk værdi er så lang. Det er fritekst |
| `Bearer `, `eyJ`, `sb_secret`, `sb_publishable` | Hele eventet droppes | Tokens |
| Absolut URL med vært ≠ bofinda.dk | Hele eventet droppes | Fanger både kilde-payloads og hele referrer-URL'er |
| `canonical_city` ikke i `facetter().byer` | Nøglen droppes, `sted_slags='by_ukendt'` | Det er dét, der gør feltet kategorisk |
| `environment` ikke i enum | Hele eventet droppes | Se afsnit 10 |

**Droppet er ikke stille.** Hver afvisning logger eventnavn og den *nøgle*, der
udløste den — aldrig værdien. Ellers ville værnet skjule den fejl, det findes for
at afsløre.

### Fail-open

Hele `spor()` ligger i try/catch, og selve skrivningen ligger efter svaret. En
fejl i målingen kan hverken kaste ind i en server action, forsinke en sidevisning
eller ændre et returneret resultat.

> ### Modulgrænserne — to fælder, der begge har ramt før
>
> **1. `lib/maaling.ts` må ikke importere databasen.** Typer, allowlist og værn
> ligger dér; skrivningen i `lib/maaling-server.ts`. Det er præcis reglen fra
> `lib/faciliteter.ts`: et værdi-import fra en klientkomponent trak engang
> `postgres` ind i browserbundtet og væltede appen på `Can't resolve 'net'`.
> Klienttrackeren skal bruge eventtyperne, så grænsen skal stå fra dag ét.
>
> **2. `lib/maaling-server.ts` må ikke importere `next/server` på modulniveau.**
> `lib/alarm.ts` skal instrumenteres, og den importeres af `scripts/alarm.ts` og
> `scripts/import.ts`, som kører i **tsx uden Next omkring sig**. Et
> topniveau-import af `after()` ville vælte workeren på Railway. Løsningen er et
> dynamisk import bag `if (process.env.NEXT_RUNTIME)`: i webappen lægges
> skrivningen i `after()`, i workeren skrives den direkte. Samme grund som at
> `app/cache.ts` ligger i app-laget og ikke i `lib/`.

---

## 10 · Miljøadskillelse

Udvikling og produktion deler database. Resolveren har derfor **ingen
gæt-gren**:

```ts
export type Miljoe = 'produktion' | 'preview' | 'udvikling' | 'proeve'

// Saettes KUN af scripts/testbase.ts, som indsaetBase(). En spaerring, der
// hviler paa en miljoevariabel, nogen skal huske at saette, er ingen spaerring.
let _paatvunget: Miljoe | null = null
export function saetMiljoe(m: Miljoe) { _paatvunget = m }

export function miljoe(): Miljoe | null {
  if (_paatvunget) return _paatvunget
  if (process.env.VERCEL_ENV === 'production')  return 'produktion'
  if (process.env.VERCEL_ENV === 'preview')     return 'preview'
  if (process.env.VERCEL_ENV === 'development') return 'udvikling'
  if (process.env.NEXT_RUNTIME)                 return 'udvikling'  // next dev
  return null                                                       // intet skrives
}
```

- **Produktion:** `VERCEL_ENV=production` sættes af Vercel selv — intet at huske
  i panelet.
- **Lokalt:** `next dev` sætter `NEXT_RUNTIME`, ikke `VERCEL_ENV` → `udvikling`.
- **Prøver:** `rejsTestbase()` kalder `saetMiljoe('proeve')` i samme åndedrag som
  `indsaetBase()`. Prøven kan ikke *glemme* det, og den kan ikke nå produktionen:
  `npm test` loader ikke `.env`, så der er ingen `DATABASE_URL` i processen.
- **Kan ikke bestemmes:** `null` → **eventet skrives ikke.** Rapporter filtrerer
  altid på `environment = 'produktion'`, så et manglende filter kan ikke give et
  forkert tal — kun *ingen* tal.

---

## 11 · Samtykke

Den afgørende grænse er ikke «analyse eller ej», men om noget **gemmes på
brugerens enhed**. Cookiereglerne kræver samtykke til det første; GDPR regulerer,
hvad der derefter behandles. Derfor to lag:

| | Uden samtykke | Med samtykke |
|---|---|---|
| Gemmer på enheden | Intet | `bofinda_aid` (180 d), `bofinda_sid` (30 min / 12 t) |
| Skriver | **Ingenting.** Ikke ét event, hverken med eller uden identifikator | Alle 22 events |
| Kan svare på | Intet | Alt |

**Håndhævet i fire lag:**

1. `middleware.ts` sætter ingen cookie uden `bofinda_samtykke=ja` — den ser
   efter én cookie, finder den ikke, og sender requestet videre urørt.
2. `kontekst()` i `lib/maaling-server.ts` returnerer `null` uden samtykke, og
   `spor()` stopper dér.
3. `/api/maaling` svarer 204 uden at røre kroppen.
4. `anonymous_id` og `session_id` er `not null` i basen. Slap noget forbi de
   tre første lag, ville insert'en fejle.

Det fjerner samtidig den juridiske gråzone, designet havde: der er ikke
længere et lag, hvis lovlighed hviler på, at identifikatorfrie serverside-log
ikke er personoplysninger. Prisen er, at alle tal kun dækker dem, der sagde
ja.

### Banneret

- **To ligestillede knapper.** «Tillad statistik» og «Kun det nødvendige» — samme
  størrelse, samme vægt, samme kontrast. Ingen forudkrydsning, ingen cookie-mur,
  ingen «for at give dig den bedste oplevelse».
- **Det kan lukkes uden at vælge.** At lukke er *ikke* samtykke; ingen cookies
  sættes, og banneret kommer igen næste besøg.
- **Det siger, hvad der måles.** Én linje: at vi tæller søgninger og klik for at
  forbedre siden, at intet deles med tredjepart, og et link til `/privatliv`.
- Kategorier: **nødvendige** (auth, sikkerhed, teknisk funktion) og **statistik**.
  Ingen marketingkategori — der er ingen marketing at samtykke til.

### Tilbagetrækning

| | |
|---|---|
| Gemmes | `bofinda_samtykke=ja\|nej`, 12 måneder. «Strengt nødvendig» i cookiereglernes forstand — den registrerer brugerens eget valg — og kræver derfor ikke selv samtykke |
| Hvor | Link i sidefoden og et afsnit på `/privatliv`. Ét klik |
| Hvad der sker | `bofinda_aid` og `bofinda_sid` **slettes** (`Max-Age=0`). Nye events skrives uden identifikatorer. Nødvendige cookies røres ikke |
| Nyt ja senere | Danner et **nyt** `anonymous_id`. Det gamle forløb kan ikke genoptages, og det er meningen |
| Sletning bagud | «Slet det, I har målt om mig» → `sletForAnonym()`, én `delete … where anonymous_id = $1`. Vi kender ikke brugeren, men browseren bærer nøglen, så hun kan bede om det uden at identificere sig. **Knappen findes** i `app/privatliv/Valg.tsx`: teksten lover den, så den skal være der |

Brugertestdeltageren får det at vide mundtligt **og** på `/forsoeg/<kode>`-siden
før noget starter og trykker selv. Samtykket er informeret og frivilligt i samme
forstand som alle andres — moderator sætter det ikke på deltagerens vegne.

---

## 12 · alert_confirmed — den autoritative transition

`bekraeft()` i `lib/alarm.ts` returnerer i dag **samme form** ved en reel
bekræftelse (UPDATE med `isNull(confirmedAt)`) og ved «allerede bekræftet»
(fallback-SELECT). Et naivt `if (s)` ville tælle hver gang nogen genåbner linket i
mailen — **og mailscannere åbner links**. Det er præcis den grund til, at
bekræftelsen overhovedet kræver et POST.

**Instrumenteringen lægges inde i den succesfulde UPDATE-gren**, ikke hos
kalderen:

```ts
const [s] = await db.update(savedSearches)
  .set({ confirmedAt: sql`now()` })
  .where(and(eq(savedSearches.confirmToken, token), isNull(savedSearches.confirmedAt)))
  .returning({ navn: savedSearches.name, kriterier: savedSearches.criteria })
if (s) {
  await spor({ navn: 'alert_confirmed', props: { filtertyper: typerAf(s.kriterier) } })
  return s          // ← eventet ligger HER, hvor overgangen faktisk skete
}
// allerede bekraeftet — ingen event
```

Fordelen ved at lægge det her frem for at udvide returtypen: **ingen signatur
ændres, intet kaldested skal rettes, og ingen brugeradfærd ændres.** Overgangen
`confirmed_at: NULL → timestamp` er atomisk i UPDATE'en, så eventet kan ikke fyre
to gange, heller ikke ved to samtidige requests.

`saved_search_id` må ikke med i eventet: det er en direkte join-nøgle til en række
med en mailadresse. Konsekvensen er, at `alert_created` og `alert_confirmed` kun
kan kobles gennem `session_id`/`anonymous_id` — altså for brugere med samtykke.
Det er den rigtige afvejning.

---

## 13 · signup_completed hører ikke, hvor man tror

`tilmeld()` i `app/udlejer/handlinger.ts` kalder `signUp()` og svarer:

> «Tjek din mail. Vi har sendt et link, du skal trykke på, før kontoen er aktiv.»

**Kontoen findes altså ikke endnu.** Kontooprettelsen er dobbelt opt-in ligesom
boligbeskeden. At kalde det `signup_completed` dér ville tælle alle dem, der
aldrig kom tilbage.

| Event | Hvor | Hvorfor |
|---|---|---|
| `signup_started` | `tilmeld()`, når `signUp()` lykkes | Bekræftelsesmailen er sendt. Det er så langt, brugeren er nået |
| `signup_completed` | `hentUdlejer()` i `lib/auth.ts`, **første** binding af `auth_user_id` | En reel overgang i vores egen base — nøjagtig samme form som `alert_confirmed` |
| `login_completed` | `login()`, `error === null`, før `redirect()` | Bærer både `anonymous_id` og `user_id`; det er sammensyningen |

Ingen af dem er et tastetryk i et felt. Alle tre er serverside.

---

## 14 · Migration 0020 (udkast — ikke kørt)

```sql
-- Produktanalytics. Append-only. Ingen fremmednoegler med vilje: loggen
-- maa aldrig kunne laase eller fejle en produktskrivning. Se docs/analytics-v1.md.

create table "haendelser" (
  "id"                  uuid primary key default gen_random_uuid(),
  "occurred_at"         timestamp with time zone not null default now(),
  "event_name"          text not null,
  "schema_version"      smallint not null default 1,
  "environment"         text not null,
  "anonymous_id"        uuid,
  "session_id"          uuid,
  "user_id"             uuid,
  "research_session_id" text,
  "route"               text not null,
  "listing_id"          uuid,
  "source_slug"         text,
  "properties"          jsonb not null default '{}'::jsonb,
  "expires_at"          timestamp with time zone not null,

  constraint "haendelser_miljoe"
    check ("environment" in ('produktion','preview','udvikling','proeve')),
  constraint "haendelser_navn_laengde"
    check (char_length("event_name") between 1 and 40),
  constraint "haendelser_forsoeg_laengde"
    check ("research_session_id" is null
           or char_length("research_session_id") between 1 and 40)
);

-- Dagsaggregat. Ingen identifikatorer overhovedet, derfor ingen udloebsdato.
--
-- sample_andel er IKKE pynt: listing_impression er stikproevet, og et aggregat,
-- der gemmer 25 % af sandheden som om det var 100 %, er en loegn, ingen
-- opdager. For alle andre events er den 1.
create table "haendelser_daglig" (
  "dato"         date not null,
  "environment"  text not null,
  "event_name"   text not null,
  "source_slug"  text,
  "antal"        bigint not null,
  "sample_andel" numeric(5,4) not null default 1,
  primary key ("dato","environment","event_name","source_slug")
);

-- ── Indekser ────────────────────────────────────────────────────────
-- Hvert indeks koster paa hver insert. Der er fire, og hvert af dem svarer
-- til en foresproergsel nedenfor. Flere tilfoejes, naar en rapport faktisk
-- er langsom — ikke paa forhaand.

create index "haendelser_navn_tid"
  on "haendelser" ("environment", "event_name", "occurred_at" desc);

create index "haendelser_session"
  on "haendelser" ("session_id", "occurred_at")
  where "session_id" is not null;

create index "haendelser_kilde"
  on "haendelser" ("source_slug", "event_name", "occurred_at" desc)
  where "source_slug" is not null;

create index "haendelser_udloeb" on "haendelser" ("expires_at");

-- OBLIGATORISK for hver ny tabel i public. Supabase giver anon og
-- authenticated fulde rettigheder paa nye tabeller, og pgrst_ddl_watch
-- eksponerer dem uden forsinkelse. npm run tjek:rettigheder faelder det,
-- hvis en af de fire linjer glemmes.
alter table "haendelser" enable row level security;
revoke all on "haendelser" from anon, authenticated;
alter table "haendelser_daglig" enable row level security;
revoke all on "haendelser_daglig" from anon, authenticated;

-- Ingen politikker. Tabellen naas kun af vores egen server gennem Drizzle,
-- ligesom listings. Browseren har intet aerinde her, og der er ingen
-- PostgREST-skrivevej ind.
```

| Indeks | Understøtter |
|---|---|
| `(environment, event_name, occurred_at desc)` | Alle tidsserier og tællinger. Den ledende kolonne gør også, at et vindue for ét miljø kan scannes uden `event_name` |
| `(session_id, occurred_at)` partiel | Funnel A og D. Partiel, fordi rækker uden samtykke har `null` — indekset dækker kun de rækker, en funnel kan bruge |
| `(source_slug, event_name, occurred_at desc)` partiel | Funnel C — kildesammenligningen |
| `(expires_at)` | Den timelige oprydning. Uden den scanner hver kørsel hele tabellen |

**Bevidst udeladt nu:** indeks på `anonymous_id` og på `listing_id`. De hører til
rapporter, der endnu ikke er skrevet, og et indeks, ingen bruger, er ren
omkostning på hver insert.

**Partitionering: ikke nu.** Genbesøg ved 10 mio. rækker — se afsnit 16. Overvej
først et **BRIN-indeks på `occurred_at`**: på en append-only, tidsordnet tabel er
det få kilobyte og kan erstatte en del af det, en btree ellers ville koste.

**Skrivevejen er kun serverside.** Klienten POSTer til `/api/maaling`, som
validerer, opløser identiteten fra cookies og skriver. Browseren rører aldrig
tabellen.

---

## 15 · Retention og oprydning

| Data | Retention | Hvorfor |
|---|---|---|
| Rå produktevents | **12 måneder** | Pro er aktiv; se afsnit 16 for hvad det koster |
| `listing_impression` | **60 dage** | Den store post og den mindst holdbare: en impression fra i fjor siger intet, når listen imens har skiftet indhold |
| Research-events | **90 dage** | En brugertest er analyseret inden for uger |
| Events med `user_id` | Som rå | Sletteret håndteres separat: `user_id` nulstilles, rækken bliver |
| Dagsaggregater | Ubegrænset | Ingen identifikatorer overhovedet. Det er dét, der gør en kortere rå-retention acceptabel |

`expires_at` sættes ved insert ud fra eventets klasse. Det gør reglen synlig pr.
række, og en ændring i politikken rammer kun nye events — gamle beholder det
løfte, de blev skrevet under.

### Sletteprocessen — eksisterende mekanik, ikke ny infrastruktur

Railway kører allerede `npm run import` hver time (`0 * * * *`), og
`scripts/import.ts` kalder allerede `ryd()` fra `lib/alarm.ts` efter importen.
Oprydningen lægges **præcis samme sted**: to kald mere i samme fil. Ingen ny cron,
ingen ny service, ingen ny afhængighed.

```ts
/**
 * Bundet oprydning. Koerer hver time efter importen, sammen med ryd().
 *
 * Bundet med vilje: en ubundet delete paa en tabel med millioner af raekker
 * holder laasen laenge og risikerer Supabases statement timeout. Med 20.000
 * ad gangen og hoejst 5 runder pr. koersel er loftet 100.000 raekker i timen
 * — rigeligt over tilvaeksten i ethvert af scenarierne i afsnit 16.
 */
export async function ryddHaendelser(): Promise<number> {
  let slettet = 0
  for (let runde = 0; runde < 5; runde++) {
    const r = await db.execute(sql`
      delete from haendelser
      where id in (select id from haendelser where expires_at < now() limit 20000)
    `)
    slettet += r.count ?? 0
    if ((r.count ?? 0) < 20000) break
  }
  return slettet
}
```

> **«Et `expires_at`-felt uden en faktisk sletteproces er ikke retention.»**
> Netop. Derfor er der en prøve, der indsætter en udløbet række, kører
> `ryddHaendelser()` og hævder, at den er væk — og en, der hævder, at en række
> med fremtidig dato stadig er der. Uden dem er retention en påstand.

---

## 16 · Volumen på Supabase Pro

Supabase Pro er aktiv pr. 7. september 2026. **8 GB database inkluderet**, disk
kan købes derover — slå den aktuelle pris op, før et scenarie planlægges.

**Antagelse:** ca. **17 events pr. daglig bruger** uden impressions — 1
forsidevisning, 3 søgninger med hver sin resultat- eller tom-hændelse, ca. 3
filter- og sorteringsændringer, 4 boligvisninger, 0,5 kildeklik, resten fordelt på
kort, gruppe, alarm og konto.

**Rækkestørrelsen er målt, ikke skønnet:** 20.000 repræsentative rækker i den
rigtige tabel med de fire indekser fylder 7,4 MB — **388 bytes pr. række**, hvoraf
1,3 MB er indekser. Skønnet i designet var 0,5 KB, altså 29 % for højt.
Tallene nedenfor er regnet med det målte. Impressions: 144 pr. bruger pr. dag × samtykkeandel (regnet med 50 %) ×
stikprøve.

### Rækker og vækst

| DAU | Events/dag uden impr. | Med impr. 25 % | MB/dag (25 %) | Vækst/md. | Rækker/md. |
|---|---:|---:|---:|---:|---:|
| 1.000 | 17.000 | 35.000 | 17,5 | **0,5 GB** | 1,1 mio. |
| 10.000 | 170.000 | 350.000 | 175 | **5,3 GB** | 10,5 mio. |
| 100.000 | 1.700.000 | 3.500.000 | 1.750 | **53 GB** | 105 mio. |

### Hvad der så faktisk ligger i basen i ligevægt

Med 12 måneders rå retention, 60 dages impressions og 25 % stikprøve:

| DAU | Basisevents (12 mdr.) | Impressions (60 dage) | **I alt** | Passer i 8 GB? |
|---|---:|---:|---:|---|
| 1.000 | 2,2 GB | 0,4 GB | **2,6 GB** | **Ja — 33 % af pladsen** |
| 10.000 | 22,4 GB | 3,7 GB | **26 GB** | Nej — køb disk, eller sæt rå retention til 90 dage (≈ 6,4 GB) |
| 100.000 | 224 GB | 37 GB | **261 GB** | Nej. Her hører rå events ikke længere hjemme i produktionsbasen |

### Skrivelast

| DAU | Snit | Spids (×5) | Vurdering |
|---|---:|---:|---|
| 1.000 | 0,4/s | 2/s | Almindelig Postgres-tabel er rigeligt |
| 10.000 | 4/s | 20/s | Stadig triviel. Pladsen er begrænsningen, ikke ydelsen |
| 100.000 | 40/s | 200/s | Til at bære, men deler nu pulje med produktet |

### Hvornår skifter noget

| | Tærskel | Handling |
|---|---|---|
| Impressions ned | 10.000 DAU | `MAALING_IMPRESSION_PCT` fra 25 til 10 halverer nær nok impression-volumen |
| Batching | Vedvarende > 50 skrivninger/s | Indtil da er én insert pr. event enklere og lettere at ræsonnere om |
| Partitionering | ~10 mio. rækker — nået efter ca. **10 måneder** ved 1.000 DAU, ca. **en måned** ved 10.000 | Declarative range-partitionering pr. måned. Så bliver retention en `drop partition` i stedet for en `delete`, hvilket er gratis |
| Warehouse | ~100.000 DAU | Rå events ud af produktionsbasen; dagsaggregater bliver den primære kilde |

**Symptomet at holde øje med er ikke rækketallet, men at en rapport gør en
sidevisning langsom.** Det er allerede undgået ved at køre rapporter på
`DATABASE_URL_DIRECT` fra et script — som `scripts/puls.mjs` — og ikke gennem
webappens transaction-pool, der kun har fem pladser og deles med hver eneste
sidevisning.

**Konklusionen for i dag:** ved den trafik Bofinda realistisk får det næste år er
en almindelig Postgres-tabel på Pro rigelig. Ingen kø, ingen ClickHouse, ingen
event-bus. Det eneste, der presser, er disk, og det løses med retention og en
plan — ikke med arkitektur.

---

## 17 · Funnel-forespørgsler

> Kør dem **aldrig** gennem webappen. Rapporter køres fra et script på
> `DATABASE_URL_DIRECT`, som `scripts/puls.mjs` allerede gør.

### A · Landing → søgning → boligvisning → videre til kilden

```sql
with s as (
  select session_id,
         bool_or(event_name = 'homepage_view') as saa_forside,
         bool_or(event_name = 'search')        as soegte,
         bool_or(event_name = 'listing_view')  as aabnede,
         bool_or(event_name = 'source_click')  as gik_videre
  from haendelser
  where environment = 'produktion'
    and session_id is not null
    and occurred_at >= now() - interval '30 days'
  group by session_id
)
select count(*)                                       as sessioner,
       count(*) filter (where saa_forside)            as forside,
       count(*) filter (where soegte)                 as soegning,
       count(*) filter (where aabnede)                as boligvisning,
       count(*) filter (where gik_videre)             as videre_til_kilde,
       round(100.0 * count(*) filter (where gik_videre)
             / nullif(count(*) filter (where soegte), 0), 1) as pct_soeg_til_kilde
from s;
```

Måler «nåede trinnet i løbet af sessionen», ikke streng rækkefølge. Vil man have
rækkefølgen, erstattes `bool_or` med `min(occurred_at) filter (where …)` og
trinene sammenlignes parvis.

### B · Tomme søgninger

```sql
select date_trunc('day', occurred_at)::date as dag,
       count(*) filter (where event_name = 'search')        as soegninger,
       count(*) filter (where event_name = 'empty_results') as tomme,
       round(100.0 * count(*) filter (where event_name = 'empty_results')
             / nullif(count(*) filter (where event_name = 'search'), 0), 1) as pct
from haendelser
where environment = 'produktion'
  and event_name in ('search','empty_results')
  and occurred_at >= now() - interval '30 days'
group by 1 order by 1;

-- Og hvor de tomme sidder:
select properties->>'canonical_city' as by,
       properties->>'postnr'         as postnr,
       count(*)                       as tomme_soegninger
from haendelser
where environment = 'produktion' and event_name = 'empty_results'
  and occurred_at >= now() - interval '30 days'
group by 1, 2 order by 3 desc limit 25;
```

### C · Kildeperformance

```sql
with vist as (
  -- viste_pr_kilde er {"propstep":31,"cej":9,...} paa hvert search_results_view
  select k.key as slug, sum(k.value::int) as visninger
  from haendelser h,
       lateral jsonb_each_text(h.properties -> 'viste_pr_kilde') k
  where h.environment = 'produktion' and h.event_name = 'search_results_view'
    and h.occurred_at >= now() - interval '30 days'
  group by 1
),
set_i_viewport as (
  -- SKALERET. Uden 1/sample_andel er tallet fire gange for lavt ved PCT=25.
  select source_slug as slug, sum(1.0 / (properties->>'sample_andel')::numeric)::bigint as sete
  from haendelser
  where environment = 'produktion' and event_name = 'listing_impression'
    and occurred_at >= now() - interval '30 days'
  group by 1
),
aabnet as (
  select source_slug as slug, count(*) as boligvisninger
  from haendelser
  where environment = 'produktion' and event_name = 'listing_view'
    and occurred_at >= now() - interval '30 days'
  group by 1
),
klik as (
  select source_slug as slug, count(*) as kildeklik
  from haendelser
  where environment = 'produktion' and event_name = 'source_click'
    and occurred_at >= now() - interval '30 days'
  group by 1
)
select s.name                                   as kilde,
       coalesce(v.visninger, 0)                 as vist_i_liste,
       coalesce(w.sete, 0)                      as set_i_viewport,
       coalesce(a.boligvisninger, 0)            as aabnet,
       coalesce(k.kildeklik, 0)                 as videre,
       round(100.0 * coalesce(a.boligvisninger,0) / nullif(v.visninger,0), 2) as pct_aabnet,
       round(100.0 * coalesce(k.kildeklik,0) / nullif(a.boligvisninger,0), 2) as pct_videre
from sources s
left join vist           v on v.slug = s.slug
left join set_i_viewport w on w.slug = s.slug
left join aabnet         a on a.slug = s.slug
left join klik           k on k.slug = s.slug
where s.slug <> 'native'
order by aabnet desc nulls last;
```

**Det er dén tabel, hele kildesporet handler om:** reel brugerinteresse pr.
kilde, ikke antal annoncer. En kilde med 800 boliger og 0,4 % åbningsrate leverer
mindre end en med 60 boliger og 6 %. Sammenlign CEJ, Birch, Heimstaden og
Propstep her — ikke i `supply-baseline`.

### D · Én brugertestsession

```sql
select occurred_at, event_name, route, source_slug, listing_id, properties
from haendelser
where research_session_id = $1
order by occurred_at, id;
```

### E · Fra anonym til indlogget

```sql
-- anonymous_id aendrer sig ikke ved login, saa login-raekken ER sammensyningen.
with hendes as (
  select distinct anonymous_id
  from haendelser
  where user_id = $1 and anonymous_id is not null
)
select h.occurred_at, h.event_name, h.route,
       h.user_id is not null as var_logget_ind
from haendelser h
join hendes using (anonymous_id)
where h.environment = 'produktion'
order by h.occurred_at;
```

Ingen mailadresse indgår, ingen backfill er nødvendig, og forløbet før login er
synligt uden at noget personhenførbart nogensinde blev kopieret ind i loggen.

---

## 18 · Prøvestrategi

Ny fil `scripts/test-maaling.ts` i samme form som `scripts/test-redigering.ts` —
nummereret hovedkommentar, `tjek(navn, ok, note)`, kørt mod PGlite. Tilføjes til
`npm test`.

| # | Prøve | Hævder |
|---|---|---|
| 1 | Forside vs. søgning | `/` uden filtre giver præcis ét `homepage_view` og nul `search`. Med filtre omvendt |
| 2 | **Invarianten** | `count(search) = count(search_results_view) + count(empty_results)` over konstruerede requests med både tomme og fyldte resultater |
| 3 | Ét event pr. request | To kald til `spor()` for samme event i én `cache()`-kontekst giver én række |
| 4 | Klient-dubletter | Trackerens `Set` ligger på modulniveau: to mounts (StrictMode) giver ét event i køen |
| 5 | `alert_created` | Kun ved `slags === 'sendt'`. `ugyldig-mail`, `for-mange`, `for-hurtigt`, `spaerret` giver nul rækker |
| 6 | `alert_confirmed` | `bekraeft(token)` to gange giver **ét** event |
| 7 | `source_click` | `/go/[id]` giver 302 til `listings.source_url` og præcis ét event. Ukendt id → 404, nul events. `?url=` ignoreres fuldstændigt |
| 8 | canonical city | Kendt by → `canonical_city` sat, `sted_slags='by_kendt'`. Ukendt → nøglen mangler, `sted_slags='by_ukendt'` |
| 9 | PII afvises | Event med mailadresse i en property skriver **nul** rækker. Samme for telefon, JWT og fremmed URL |
| 10 | Ukendte properties | Nøglen forsvinder, eventet skrives, afvisningen tælles |
| 11 | Fail-open | Med en skriver, der altid kaster: `tilmeld()` returnerer stadig `sendt`, og rækken i `saved_searches` findes |
| 12 | Samtykke = nej | Rækker skrives, men `anonymous_id`, `session_id` og `user_id` er alle null, og ingen cookie sættes |
| 13 | Samtykke = ja | Identifikatorerne er sat og er de samme på tværs af to requests |
| 14 | Tilbagetrækning | Nye events har ingen identifikatorer, og et nyt ja giver et **andet** `anonymous_id` |
| 15 | Session udløber | Efter 30 min. simuleret inaktivitet **og** efter 12 timer skifter `session_id`, mens `anonymous_id` består |
| 16 | Miljø | Alle rækker fra prøven har `environment = 'proeve'`. Ingen har `'produktion'` |
| 17 | Research-tagging | Events under en forsøgssession bærer taggen **og** er ellers helt normale |
| 18 | Retention | Række med `expires_at` i fortiden er væk efter `ryddHaendelser()`; en med fremtidig dato er der stadig |
| 19 | Impression-dedup | Samme `(session_id, listing_id, result_view_id)` to gange giver **én** række, også efter scroll ud og ind |
| 20 | Impression-stikprøve | Deterministisk pr. session: samme `session_id` giver samme svar hver gang, og en session er enten fuldt med eller helt ude. `PCT=0` → nul impressions |
| 21 | `sample_andel` | Hver impression bærer den andel, den blev optaget under |
| 22 | Filterdiff | Referer `?by=Aarhus` → request `?by=Aarhus&prisMax=1200000` giver præcis ét `filter_applied` med `felt=prisMax` og nul `filter_cleared`. Omvendt vej giver det modsatte |
| 23 | Nulstil kollapser | Fra fem satte filtre til `/` giver **ét** `filter_cleared` med `felt='alle'` og `antal_ryddet=5` |
| 24 | Ingen Referer | Uden `Referer`, og med en fremmed oprindelse, fyrer nul filter- og sorteringsevents. `search` fyrer normalt |
| 25 | **Referer lækker ikke** | En referer med `?sted=Anna%20Hansen%2C%20Vestergade%2012` giver events, hvor *ingen* property indeholder nogen del af strengen |
| 26 | `signup_completed` | Fyrer ved **første** binding af `auth_user_id`, ikke ved `signUp()` og ikke ved andet login |
| 27 | Retention pr. klasse | Impression → 60 dage, research → 90, almindeligt → retention-konstanten. Målt på `expires_at` |

### Bevidste brud

Hvert brud laves midlertidigt, køres, ses rød, og rulles tilbage. **En prøve, der
ikke kan blive rød, er et grønt flueben uden dækning.**

| Brud | Skal fælde |
|---|---|
| Fjern mail-mønsteret fra `renser()` | 9 |
| Lad `alert_confirmed` fyre på begge grene i `bekraeft()` | 6 |
| Fjern `isNull(confirmedAt)` fra UPDATE'en | 6 — og afslører, at bekræftelsen aldrig var idempotent |
| Flyt trackerens `Set` fra modulniveau ind i `useState` | 4 |
| Lad `miljoe()` falde tilbage på `'produktion'` i stedet for `null` | 16 |
| Accepter `?url=` i `/go/[id]` | 7 — det åbne redirect |
| Fyr `search_results_view` på hver søgning, også de tomme | 2 |
| Læg referer-URL'en i `filter_applied.fra` | 25 |
| Fjern impression-dedup | 19 |
| Stikprøv impressions pr. *event* i stedet for pr. session | 20 |
| Drop `sample_andel` fra impression-eventet | 21 |
| Fyr `signup_completed` allerede i `tilmeld()` | 26 |

> ### Hvad PGlite ikke kan prøve
>
> Cookies, `after()` og browserens beacon findes ikke i testbasen. Prøve 12–15
> tester derfor **funktionerne** — `laesSamtykke(jar)`, `sessionFra(cookie, nu)`
> — med en cookie-attrap, ikke en rigtig HTTP-runde. Det er den samme ærlige
> begrænsning, CLAUDE.md allerede beskriver for RLS på `storage.objects`: skriv
> aldrig en prøve, der måler at noget *findes*, og lad som om den måler, at det
> *virker*. Den fulde kæde skal ses én gang manuelt i en browser, og det skal
> stå i dokumentationen, at det er sådan.

---

## 19 · Udkast til privatlivsteksten

**`app/privatliv/page.tsx` er urørt.** Teksten nedenfor er et udkast. Kommentaren i
filen siger, at teksten er ejerens — den skal ikke skrives på hans vegne.

**To eksisterende sætninger skal erstattes, ikke suppleres.** Begge bliver usande
den dag, målingen tændes:

> «Bruger du kun boligsøgningen uden at oprette en alarm, behandler vi ingen
> personoplysninger om dig.»
>
> «Vi bruger ingen cookies til statistik, markedsføring eller sporing.»

```
Statistik om brugen af siden

Vi måler, hvordan Bofinda bliver brugt, så vi kan gøre søgningen bedre.
Målingen er vores egen: den kører på vores eget domæne, og der er ingen
tredjepart involveret. Vi bruger ikke Google Analytics eller lignende
tjenester, og vi sælger eller deler ikke tal om din adfærd med nogen.

Hvad vi registrerer

Vi registrerer hændelser — at noget skete, ikke hvem der gjorde det:
  · at forsiden blev vist
  · at der blev søgt, hvilke filtre der var sat, og om de blev ændret
  · hvor mange resultater søgningen gav
  · at en bolig blev vist i listen eller åbnet, og hvilken kilde den kom fra
  · at nogen gik videre til kilden eller fik vist en udlejers kontaktoplysninger
  · at en boligbesked blev oprettet og bekræftet
  · at nogen oprettede sig som udlejer eller loggede ind

Til hver hændelse gemmer vi kategoriske oplysninger: postnummer, bynavn fra
vores egen liste over byer, prisinterval, antal værelser, boligtype, hvilken
kilde boligen kom fra, og hvor mange resultater der var.

Hvad vi aldrig gemmer i statistikken
  · din mailadresse, dit navn eller dit telefonnummer
  · det du selv har skrevet i søgefeltet eller i en formular
  · navnet du gav din gemte søgning
  · din adresse
  · indholdet af beskeder
  · din IP-adresse
  · adgangskoder eller sikkerhedsnøgler

Vi gemmer ikke din IP-adresse. Vores leverandører kan have den i deres egne
driftslogs i kort tid, men vi henter den ikke ind i vores statistik og bruger
den ikke til at genkende dig.

Genkendelse på tværs af besøg

Siger du ja til statistik, gemmer vi to tilfældige numre i din browser:
  · et besøgsnummer, der udløber efter 30 minutters pause og senest efter 12 timer
  · et browsernummer, der gemmes i 180 dage

Numrene er tilfældige. De indeholder ingen oplysninger om dig, de kan ikke
regnes tilbage til hverken din mailadresse eller din maskine, og vi kan ikke
genskabe dem, hvis du sletter dem. Vi laver ikke fingeraftryk af din browser.

Er du logget ind som udlejer, kobles hændelserne desuden til dit interne
bruger-id — et tilfældigt nummer i vores egen database. Din mailadresse indgår
aldrig i statistikken.

Samtykke

Vi måler ikke med numre, før du har sagt ja. Siger du nej, eller lukker du bare
boksen, registrerer vi stadig at siden blev brugt — men uden numre, så
hændelserne ikke kan sættes sammen til et forløb, og uden at gemme noget i din
browser. Retsgrundlaget for statistikken er dit samtykke, jf.
databeskyttelsesforordningens artikel 6, stk. 1, litra a.

Du kan trække samtykket tilbage når som helst nederst på enhver side. Så sletter
vi de to numre i din browser med det samme, og vi holder op med at koble
hændelser sammen. Vil du også have slettet det, vi allerede har målt, kan du
bede om det samme sted — så sletter vi alle hændelser med dit browsernummer.

Hvor længe

Hændelser slettes automatisk efter 12 måneder; oplysninger om hvilke boliger
der blev vist i en liste, efter 60 dage. Vi beholder sammentalte dagstal — hvor
mange søgninger, hvor mange visninger pr. kilde — uden numre af nogen art. De
kan ikke føres tilbage til nogen.

Brugertests

Deltager du i en brugertest, hvor vi sidder med, tilføjer vi et tilfældigt
holdnummer til hændelserne, så vi kan finde netop den session igen. Du får det
at vide og trykker selv ja, før testen begynder. Holdnummeret slettes efter
90 dage.

Cookies                              ← ERSTATTER det nuværende afsnit

Vi bruger cookies til tre ting og ikke andet:
  · at holde dig logget ind, hvis du er udlejer
  · at huske, om du har sagt ja eller nej til statistik
  · statistik, hvis du har sagt ja — de to numre beskrevet ovenfor

Ingen af dem bruges til markedsføring, og ingen af dem deles med nogen.
```

**Sætningen om alarmer bliver stående uændret.** Skellet, teksten skal gøre klart,
er, at mailadressen hører til *boligbeskeden* — den behandles for at kunne sende
en mail — mens statistikken aldrig ser den. To formål, to retsgrundlag, og de må
ikke blandes sammen i én sektion.

> Politikken er i forvejen først gyldig, når `info@bofinda.dk` modtager mail. Det
> gælder også de nye afsnit. Se CLAUDE.md.

---

## 20 · Filer, der senere skal ændres

### Nye

| Fil | Indhold |
|---|---|
| `lib/maaling.ts` | Typet union, allowlist, `renser()`, `miljoe()`. **Importerer ikke databasen** |
| `lib/maaling-server.ts` | `spor()`, skrivningen, `ryddHaendelser()`, dagsrullup. **Importerer ikke `next/server` på modulniveau** |
| `lib/samtykke.ts` | Cookies: samtykke, `anonymous_id`, `session_id`, forsøgstag |
| `app/api/maaling/route.ts` | Beacon-endpoint for klient-events |
| `app/go/[id]/route.ts` | Source-click-redirect |
| `app/forsoeg/[kode]/route.ts` | Start af brugertestsession |
| `app/Samtykke.tsx` | Banneret. Klient, lille |
| `app/Maaling.tsx` | Klienttrackeren, ~90 linjer |
| `db/migrations/0020_haendelser.sql` | Afsnit 14, plus `meta/`-snapshot og journal fra `db:generate` |
| `scripts/test-maaling.ts` | Afsnit 18 |

### Ændrede

| Fil | Ændring | Omfang |
|---|---|---|
| `db/schema.ts` | To tabeldefinitioner | Tilføjelse |
| `app/layout.tsx` | Monterer banner + tracker | 2 linjer |
| `app/page.tsx` | `homepage_view`/`search`, resultat-eller-tom, filterdiff mod `Referer` | Fem kald. Alt udledes af data, siden allerede har hentet |
| `app/bolig/[id]/page.tsx` | `listing_view`; linje 222 peger på `/go/[id]` | Ét kald + ét `href` |
| `app/gruppe/page.tsx` | `group_opened` | Ét kald |
| `app/Boligkort.tsx` | `data-listing`, `data-kilde`, `data-position` så trackeren kan observere kortet | Tre attributter, ingen logik |
| `app/GemSoegning.tsx` | `alert_created` på `'sendt'` | Ét kald |
| **`lib/alarm.ts`** | `alert_confirmed` **inde i UPDATE-grenen** | Ét kald. Ingen signatur ændres |
| `lib/auth.ts` | `signup_completed` ved første binding af `auth_user_id` | Ét kald |
| `app/udlejer/handlinger.ts` | `signup_started`, `login_completed`, `server_action_failed` | Tre kald |
| `app/bolig/[id]/Kontakt.tsx` | `contact_click` på `mailto:`/`tel:` | To `onClick` |
| `app/bolig/[id]/kontakthandling.ts` | `contact_reveal` | Ét kald |
| `app/Landkort.tsx` | `map_interaction` | To Leaflet-lyttere |
| `scripts/import.ts` | `ryddHaendelser()` + rullup, ved siden af `ryd()` | To linjer |
| `scripts/testbase.ts` | `saetMiljoe('proeve')` | Én linje |
| `package.json` | `test`-scriptet får den nye prøvefil | Én linje |
| `app/globals.css` | Banneret | Ét regelsæt |
| `app/privatliv/page.tsx` | Afsnit 19 — **først når teksten er godkendt** | To afsnit erstattet, ét tilføjet |
| `CLAUDE.md`, `README.md` | Reglerne der ikke må brydes | Ét afsnit hvert sted |

### Ikke rørt

`adapters/` · `lib/ingest.ts` · `lib/scheduler.ts` · `lib/fetch.ts` ·
`lib/vaertsspaerre.ts` · `lib/kildekontrakt.ts` · `lib/availability.ts` ·
`lib/soeg.ts` · `lib/fakta.ts` · crawler, import, sources · Heimstaden, CEJ,
Birch, EDC · Stripe · messaging · favorites.

---

## 21 · Åbne spørgsmål

1. **Cookie-banneret er den eneste synlige ændring for alle brugere.** Det afgør
   også, om funnels overhovedet findes. Skal det med fra start, eller skal v1
   køre en periode på de aggregerede tal alene?
2. **`alert_started`** er taxonomiens eneste bløde tal. Med på de vilkår, eller
   skal funnellen begynde ved `alert_created`?
3. **Impression-stikprøven på 25 %** — anbefalet, nu hvor Pro er aktiv. Skal den
   op eller ned?
4. **Juridisk gennemgang af laget uden samtykke.** Afsnit 11. Det eneste sted i
   designet uden et sikkert svar.
5. **`info@bofinda.dk` virker ikke endnu.** Forudsætning for at tænde målingen,
   ikke en detalje.


---

## 22 · Hvad implementationen ændrede

Designet holdt, men fire ting kom til undervejs. De står her, fordi de er
dyre at genopdage.

### Tændknappen

`MAALING_AKTIV=1` er den eneste vej til, at der bliver skrevet noget. Den er
ikke sat i Vercel, ikke i `.env`, og ikke i `.env.example` som andet end en
kommentar. **Målingen går ikke live, fordi koden er deployet** — aktiveringen
er en bevidst handling i panelet, og den kan slukkes igen uden en deploy.

`MAALING_IMPRESSION_PCT` styrer stikprøven, standard 25.

### drizzle-kit kan ikke generere migrationer i dette repo

Snapshots i `db/migrations/meta/` stopper ved 0012, så `db:generate` bygger
sin diff på en forældet baseline: den genererede 0020 ville have genskabt
`host_blocks` og syv `listings`-kolonner, der allerede findes. 0013–0019 er af
samme grund håndskrevne med journalpost, og 0020 følger dem.

Og en fælde mere, som kostede tid: drizzle-kit stemplede journalposten med
`when` **elleve timer før** 0019's. Migratoren springer alt over, hvis
`folderMillis` er mindre end den sidst kørte — så `db:migrate` meldte
«applied successfully» uden at oprette noget, mens `db:status` sagde, at 0020
manglede. **`when` skal være større end forrige post.**

### Modulgrænserne, bevist

`lib/alarm.ts` importeres af `scripts/import.ts`, som kører i tsx på Railway
uden Next. `lib/maaling-server.ts` henter derfor `next/server` og
`next/headers` **dynamisk** bag `process.env.NEXT_RUNTIME`. Efterprøvet: tsx
kan importere begge moduler, og `spor()` returnerer dér uden at kaste og uden
at skrive.

`lib/maaling.ts` og `lib/samtykke.ts` importerer hverken databasen eller
Next — den første fordi klienttrackeren bruger dens typer, den anden fordi
middleware kører på Edge.

### `_saetKontekst` findes af samme grund som `indsaetBase`

`next/headers` findes ikke i tsx, så uden en indsprøjtet kontekst ville hvert
eneste serverside-event være uprøveligt. En spærring, ingen har set fejle, er
ingen spærring. Samme greb, samme begrundelse — og den bruges kun af
`scripts/test-maaling.ts`.

### Én prøve kunne ikke blive rød

Det bevidste brud «læg referer-fritekst i `filter_applied.fra`» blev **ikke**
fanget første gang. Prøven brugte samme by på begge sider af diffen, så der
aldrig blev dannet et `by`-event at lække igennem — den var grøn, uanset hvor
galt det stod til. To forskellige *ukendte* byer virkede heller ikke: begge
bliver til `by_ukendt`. Prøven går nu fra ingen by til en ukendt by, og
bruddet fælder den.

Det er hele argumentet for bevidste brud i én sætning: **fejlen lå i prøven,
og kun et brud kunne finde den.**


---

## 23 · Smoke-test efter aktivering

Køres **én gang**, umiddelbart efter `MAALING_AKTIV=1` er sat i Vercel, og
før nogen stoler på et tal. Alt måles i basen, ikke i browserens netværksfane.

**Opslaget, alle trin bruger:**

```sql
select occurred_at, event_name, route, source_slug, listing_id,
       anonymous_id, session_id, user_id, research_session_id,
       environment, properties
from haendelser
where environment = 'produktion'
order by occurred_at desc limit 50;
```

### A · Afvist samtykke → nul events

1. Nyt privat vindue. Åbn `https://bofinda.dk/`.
2. Tryk **«Kun det nødvendige»**.
3. Søg på et postnummer, åbn en bolig, tryk «Se annoncen hos …».

| Skal gælde | Hvordan det ses |
|---|---|
| Ingen rækker overhovedet | `select count(*) from haendelser where environment='produktion'` er stadig 0 |
| Ingen analytics-cookies | Kun `bofinda_samtykke=nej` i browserens cookieliste — hverken `bofinda_aid` eller `bofinda_sid` |
| Kildelinket virker alligevel | Klikket lander hos kilden. **Målingen må aldrig kunne stoppe et redirect** |

### B · Accepteret samtykke → de fem events

Nyt privat vindue igen. Tryk **«Tillad statistik»**, og gør så, i rækkefølge:

| # | Handling | Forventet event | Nøglefelter at se efter |
|---|---|---|---|
| 1 | Forsiden vises | `homepage_view` | `boliger_i_alt`, evt. `referrer_vaert` |
| 2 | Søg på «2300» | `search` | `result_count`, `sted_slags='postnr'`, `postnr='2300'` |
| 3 | Samme request | `search_results_view` | `viste_antal`, `viste_pr_kilde`, samme `result_view_id` som `search` |
| 4 | Åbn en bolig | `listing_view` | `listing_id`, `source_slug`, `postnr` |
| 5 | Tryk «Se annoncen hos …» | `source_click` | samme `listing_id`, `maal='kilde'` |

### Kontrollerne

| Kontrol | Forespørgsel | Krav |
|---|---|---|
| **Miljø** | `select distinct environment from haendelser` | Kun `produktion`. Én `udvikling`-række betyder, at nogen kørte lokalt med `MAALING_AKTIV=1` |
| **Identiteterne hænger sammen** | `select count(distinct anonymous_id), count(distinct session_id) from haendelser where environment='produktion'` | **1 og 1.** Alle fem events fra samme besøg deler begge id'er |
| **Ingen null-identitet** | `select count(*) from haendelser where anonymous_id is null or session_id is null` | 0. (Kolonnerne er `not null`, så et andet tal ville betyde, at skemaet er ændret) |
| **Ingen dubletter** | `select event_name, count(*) from haendelser where environment='produktion' group by 1` | Præcis 1 af hver af de fem. To `homepage_view` fra ét besøg = dedup virker ikke |
| **Invarianten** | `count(search) = count(search_results_view) + count(empty_results)` | Skal gå op. Gør den ikke, er instrumenteringen i stykker |
| **Ingen PII** | Se forespørgslen nedenfor | Nul træf |
| **user_id** | `select count(*) from haendelser where user_id is not null` | 0 — ingen af de fem events bærer det. Kun `signup_completed` gør |
| **Redirect** | Browserens netværksfane på `/go/<id>` | 302 til kildens URL, `Referrer-Policy: no-referrer`. Kilden må ikke få en referrer |

**PII-forespørgslen:**

```sql
select id, event_name, properties
from haendelser
where environment = 'produktion'
  and (properties::text ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}'
    or properties::text ~ '"[0-9 ()+.-]{8,}"'
    or properties::text ~* '(bearer |eyJ|sb_secret|sb_publishable)'
    or properties::text ~* 'https?://(?!([a-z0-9-]+\.)*bofinda\.dk)');
-- Skal give NUL rækker. Bemærk at uuid'er i properties (result_view_id)
-- IKKE må tælle som telefonnumre — det var netop den falske positiv, der
-- kostede tre events, før værnet blev rettet. Mønsteret her kræver
-- anførselstegn omkring, så en uuid med bindestreger ikke rammer.
```

### Hvis noget fejler

**Sæt `MAALING_AKTIV` tom i Vercel igen.** Der er ingen grund til at fejlsøge
med målingen tændt — tabellen kan tømmes med
`delete from haendelser where environment = 'produktion'`, og der er ikke
noget, produktet mangler imens.

### Bagefter

Tøm smoke-testens egne rækker, så de ikke tælles med i de første rigtige tal:

```sql
delete from haendelser where anonymous_id = '<dit anonymous_id fra testen>';
```
