# Bofinda — regler for denne mappe

Læs `BRIEF.md` for opgaven. Reglerne her gælder altid, i hver session.

## Må aldrig ske

- **En manglende oplysning skal være synlig, ikke fraværende.** Kender vi
  ikke totalen, skriver kortet "Udlejer oplyser ikke aconto — spørg om varme
  og vand." Vi kan ikke skelne "udlejer opkræver intet" fra "udlejer oplyser
  intet", så vi påstår ingen af delene — vi siger, hvad brugeren skal spørge
  om. Et gæt her ville love hende noget om hendes økonomi, som ikke holder.
- **Områdesidernes tekst må kun indeholde tal, vi kan pege på rækkerne bag.**
  Ingen påstande om markedet, ingen "populært område". Kan et tal ikke
  regnes, udelades sætningen frem for at blive fyldt med noget, der lyder
  rigtigt. Der står altid, at tallene er talt af de boliger, vi har hentet,
  og ikke er et udtryk for hele markedet.
- **Sig aldrig, at el afregnes direkte, medmindre kilden siger det.**
  `electricity_own_meter` sættes kun, når kilden udtrykkeligt oplyser det.
  Null betyder "ikke oplyst" — ikke "udlejer opkræver ikke el". Boligsiden
  skelnede før ikke: den skrev "El afregnes direkte med elselskabet" på hver
  bolig uden el-aconto, hvilket er en antagelse præsenteret som en oplysning.
  En check-constraint forhindrer, at en bolig både har el-aconto og "egen
  måler" — sker det, har vi læst kilden forkert.
- **Alarmen skal matche præcis som søgesiden filtrerer.** `hvor()` i
  `lib/soeg.ts` er eksporteret og bruges begge steder. To implementeringer
  ville betyde, at beskeden rammer noget andet, end brugeren så, da hun
  oprettede søgningen — og det ville hverken kunne ses eller fejles på.
- **"Ny" er ikke "vi så den nu".** Ved første import af en kilde får hele
  bagkataloget `first_seen_at = nu`. En bolig varsles kun, når kilden siger,
  den er oprettet efter søgningen — eller, for kilder uden dato, når den
  dukkede op efter mindst et døgns overvågning af den kilde. Uden reglen gav
  en prøvekørsel 68 falske varsler ud af 87, med en medianalder på 37 dage.
- **Afmeldingslinket må aldrig afmelde på et GET.** Mailscannere og
  forhåndsvisninger henter hvert link i en mail. `/afmeld/<token>` viser en
  knap; `POST /api/afmeld` afmelder. Mailklienternes ét-klik-afmelding
  (`List-Unsubscribe-Post`) rammer POST-ruten og virker derfor uden at åbne
  siden. Tokenet er den eneste nøgle — modtageren skal ikke oprette en konto
  for at slippe af med os.
- **Mailen sendes FØR `sent_at` sættes.** Fejler afsendelsen, står træffene
  stadig i køen og prøves igen. Modsat ville en fejlet mail betyde, at
  boligerne var markeret sendt uden nogensinde at være det — og det opdager
  ingen.
- **`ALARM_TILLADTE_MODTAGERE` er indkøringsventilen.** Er den sat, får kun
  de adresser mail; alle andre springes over og logges. Fjern den først, når
  nogen har set, hvad der faktisk lander i en indbakke.
- **Matchning og afsendelse er adskilt.** `alert_matches` skabes ved match;
  `sent_at` sættes først, når beskeden faktisk er sendt. En afsendelse der
  fejler, mister ikke træffet — og træfsikkerheden kan efterses, før nogen
  får mails. En mail kan ikke kaldes tilbage.
- **Opfind aldrig data.** Fandt adapteren ikke et billede, indsættes ingen
  placeholder. Fandt den ikke arealet, står feltet `null` og vises ikke.
  Ingen eksempelbilleder, ingen estimerede arealer, ingen opdigtede tal.
  Rentola gør det modsatte — det er derfor deres udbudstal ikke kan
  sammenlignes med vores.
- **Ingen omgåelse af bot-beskyttelse.** Ingen CAPTCHA-løsning, ingen
  proxy-rotation for at skjule os, ingen fingerprint-spoofing, ingen
  falsk User-Agent. Crawleren præsenterer sig med kontakt-URL. Kilder der
  spærrer, tages som feed-aftale eller slet ikke.
- **Testkilder kører kun, når nogen navngiver dem** — `npm run import -- dummy`.
  `rigtigeKilder()` er det eneste, `koerAlle` og startlinjen må bruge.
  Spærringen hviler **aldrig** på `NODE_ENV`: den er ikke sat lokalt, den var
  ikke sat på Railway, og en spærring der afhænger af en variabel, ingen
  husker at sætte, er ingen spærring. Kun kodevejen, der navngiver en kilde,
  kalder `tilladTestkilder()`.
- **Log kun det, der faktisk køres.** Startlinjen printede engang hele
  registret, mens `koerAlle` filtrerede. Det så ud som om testkilderne kørte
  i produktion, og kostede en fejlsøgning. En logline, der ikke svarer til
  virkeligheden, er værre end ingen logline.
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
- **En ny kilde skal tilføjes til `TILLADTE_VAERTER` i `lib/billede.ts` i
  SAMME ændring som adapteren.** Glemmes værten, returnerer `billedUrl()`
  null, og billederne forsvinder uden en fejl nogen steder. Det skete for
  dacas.dk: 177 billeder blev bare ikke vist.
- **Kopiér aldrig kildens billeder.** Gem `external_url`, servér gennem
  `/api/billede`. Signaturen dækker `(url, bredde)`, så en fremmed hverken
  kan bruge proxyen til vilkårlige adresser eller bede om vilkårlige
  størrelser. Værtslisten i `lib/billede.ts` er andet lag og tjekkes **før**
  signaturen — slipper hemmeligheden ud, kan proxyen stadig kun pege på de
  kilder, vi allerede henter fra. Nye kilder skal tilføjes dér.
- **Kontaktfelterne må aldrig stå i en select-liste.** `hentBolig` og `soeg`
  henter dem ikke. Muren står i query-laget, ikke i skabelonen: et felt der
  aldrig forlader databasen, kan ikke lække ved en uopmærksom UI-ændring.
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

## Slug-reglen — må aldrig ændres

Områdesidernes URL er `/lejeboliger/{slug}`. Reglen står ét sted,
`lib/slug.ts`, og bruges både til at bygge sitemap'et og til at slå
området op. Den er:

    æ Æ → ae        mellemrum → bindestreg
    ø Ø → oe        alt andet end a-z0-9 → bindestreg
    å Å → aa        gentagne bindestreger → én

    "København S"  →  koebenhavn-s
    "Aarhus C"     →  aarhus-c
    "Smørum"       →  smoerum

**Postnumre står alene i stien** — `/lejeboliger/2300`, aldrig
`/lejeboliger/2300-koebenhavn-s`. Byen kan skifte navn i kildernes data;
postnummeret gør ikke.

Hver slug er en URL, Google har indekseret. Ændres reglen, brækker alle
indekserede adresser på én gang, og den optjente placering starter forfra.
Skal formen laves om, sker det som en **ny rute med 301 fra den gamle** —
aldrig ved at rette i `slug()`.

Slug'en beregnes i JS, ikke i SQL. Ellers ville reglen findes to steder,
og to steder driver fra hinanden.

**Områder under `MINDST_BOLIGER` (3) får ingen side** og kommer ikke i
sitemap'et. En tynd side bliver ikke placeret og trækker resten ned.
`findOmraade` returnerer kun områder over grænsen, så en for tynd side
giver 404 — grænsen håndhæves ét sted og gælder både ruten og sitemap'et.

## Arbejdsform

- Vis planen, før du ændrer filer.
- Fase 1 er projektets port. Gå ikke videre, før én kørsel har været stabil.
- Normalisering, adressevask, dedup og upsert ligger centralt i `lib/`,
  ikke i adapteren. En ny kilde er én fil i `adapters/`.
- Adressenøgler fra `SimpelAdressevask` er **interne**, ikke DAR-UUID'er.
  De bærer præfikset `intern:v1:`. Ændres normaliseringen, skal versionen
  hæves — ellers skifter gamle rækker gruppe uden at blive skrevet om.
- **Skriv resultatet, så snart en kilde er færdig — aldrig til sidst.**
  findbolig tager 5 sekunder, Propstep to minutter. Samles output og skrives
  efter begge, mister man ALT, hvis den anden bliver dræbt midt i. Det var
  præcis dét, der gjorde Railway-loggen tom, mens `crawl_runs` viste
  aktivitet. Brug `process.stdout.write`, ikke `console.log` — til et rør
  bufres console.log, og bufferen går tabt ved SIGKILL.
- **Hver kørsel skal skrive `runner`.** Sat af `RUNNER`, ellers værtsnavnet.
  Uden det kan to importører ikke skelnes i basen, og man kan ikke afgøre,
  om en fjern kilde overhovedet nåede at køre.
- **En detaljeside, der ikke kan hentes, må ikke koste kald i al fremtid.**
  `fetch_failures` husker nøglen på tværs af kørsler og trækker sig tilbage:
  1.–2. fejl → næste kørsel, 3.–4. → et døgn, 5. og derefter → en uge.
  Første succes sletter rækken, så en midlertidig fejl ikke hænger ved.
  **Hvorfor tabellen findes:** Propstep viser seks lejemål i sit søgegitter,
  hvis detaljesider svarer 404. De får aldrig en række i `listings`, så de så
  nye ud ved hver eneste kørsel — 144 spildte kald i døgnet, og seks fejl i
  hver rapport. Uden et sted at huske nøglen på tværs af kørsler kan det ikke
  løses; `last_fetched_at` virker kun for boliger, vi allerede kender.
- **En bolig i tilbagetrækning tæller aldrig som fejl.** Den har sin egen
  tæller (`skipped_count`) og sin egen linje i kørselsrapporten. Talte den
  med i `error_count`, ville støjen være flyttet i stedet for fjernet — og
  fejlprocenten er en sikring, der skal kunne stoles på.
- **Fejlprocenten kræver mindst 20 hentninger for at tælle som signal.**
  Med inkrementel import kan en time have seks hentninger; er de seks de
  samme kendte 404-sider, er andelen 100 %, uden at kilden fejler noget.
- **Afmeldning skal altid gennem sikringen i `koerKilde`.** Tre grunde til
  at springe over: intet skrevet, over 20 % fejlede udtræk, eller under
  halvdelen af medianen. En knækket parser må aldrig tømme basen.
- Maks 1 request/sekund per domæne. Backoff på 429 og 503.
- **Kendte boliger hentes ikke igen ved hver kørsel.** Discovery kører hver
  time; detaljesiden hentes kun for nye boliger plus en rullende
  genopfriskning (`GENOPFRISK_PR_KOERSEL`), så alt fornyes over et døgn.
  Uden det ville en timekørsel af Propstep koste 17.000 kald i døgnet mod
  en lille udlejerplatform. Boliger der kun bekræftes, får `last_seen_at`
  flyttet — ellers ville afmeldningen tage dem.
- `last_seen_at` = set i discovery. `last_fetched_at` = detaljesiden hentet.
  Adskillelsen er det, der gør inkrementel import mulig.
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

### Dacas — i brug, med allowlist

Ren HTML. WordPress med Divi; posttypen `lejlighed` er ikke eksponeret i
REST-API'et (404, og typen mangler i `/types`), så der er intet JSON.
`lejlighed-sitemap.xml` er hele udbuddet — 19 boliger — og hentes i ét kald.

**Siden læses på navngivne etiketter, ikke på position i markuppen**, og
udtrækket er typebestemt: beløb matches som beløb, tal som tal. Et generisk
"alt efter etiketten indtil næste etiket" knækkede to gange på ting, kilden
ikke havde fortalt os om, og gav tomme felter uden at fejle.

Aldrig: kontaktblokken. Hver boligside har en navngiven udlejningskonsulent
med direkte mailadresse og telefonnummer i brødteksten. Etiket-tilgangen gør,
at den aldrig læses — den står i en anden sektion og har ingen af vores
etiketter. Udvid **aldrig** til "tag alt i denne div".

Adressen står i `<h1>`, ikke i `<title>`: titlen har to formater, og fire af
nitten mangler postnummeret i den. Datoer er dansk tekst (`1. november 2026`),
ikke ISO. `Snarest` betyder ledig nu.

Kilden oplyser **Indflytningspris direkte**, så den regnes ikke ud, og den er
den eneste kilde, der skriver `El: Eget ansvar` — se reglen nedenfor.

### Kendt begrænsning: stednavne

Nogle kilder skriver et stednavn mellem husnummer og postnummer —
`"Fjerbregnevej 2, Trøstrup, 5210 Odense NV"`. Vi har ingen kolonne til det,
så det droppes. Adressenøglen er postnr + vej + husnr, hvilket i teorien kan
kollidere, hvis samme vejnavn og husnummer findes i to stednavne inden for
ét postnummer. Efterset på Fjerbregnevej: Trøstrup har nr. 2–25, Slukefter
27–45, altså én vej gennem to stednavne og ingen kollision. Rigtig
adressevask mod DAR løser det endeligt.

### Ikke undersøgt endnu

Cepheus (tom robots.txt, intet sitemap), Lokalbolig (robots tillader
`User-agent: *` og `Content-Signal: search=yes`, men sitemap svarer 502).

### BoligPortal — må ikke bruges

Deres robots.txt forbyder crawling udtrykkeligt på skrift. Kræver skriftlig
aftale først. Se reglen ovenfor.

## Den løbende import

Under indkøringen kører den som launchd-agent på ejerens Mac, hver time:

    ~/Library/LaunchAgents/dk.bofinda.import.plist  →  bin/import.sh
    logs/import.log     rå output pr. kørsel
    logs/launchd.err    tom, hvis launchd selv er tilfreds
    npm run puls        kørsler, nye pr. døgn, forsinkelse, afmeldinger

    launchctl unload ~/Library/LaunchAgents/dk.bofinda.import.plist   # stop
    launchctl load   ~/Library/LaunchAgents/dk.bofinda.import.plist   # start

**Projektet må ikke ligge i `~/Desktop`, `~/Documents` eller `~/Downloads`.**
macOS' TCC spærrer launchd-agenter fra de mapper — scriptet fejler med
`Operation not permitted` og exit 126, uden at noget andet ser forkert ud.
Derfor ligger repoet i `~/Bofinda`. Flyttes det tilbage, dør timekørslen
stille. Plist'en indeholder absolutte stier og skal rettes ved flytning.

Det er stadig midlertidigt. Produktionshjemmet er workeren på Railway: en
Mac der sover, springer kørsler over — og det forfalsker præcis de tal, vi
måler på.

## Om projektet

Bofinda samler ledige lejeboliger fra flere kilder, lader brugeren søge
gratis og tager betaling for at kontakte udlejeren.

To ting adskiller os fra Rentola og Bolivo: **hastighed** (nye boliger
inden for minutter, drevet af `first_seen_at`) og **fuld økonomi**
(indflytningspris og reel månedlig udgift, ikke bare husleje).

**Fuld økonomi** betyder huslejen og samtlige aconto-poster, *udlejeren*
opkræver. El indgår ikke i kravet: i dansk udlejning har lejeren normalt
egen elmåler og egen aftale med elselskabet, så el er ikke udlejerens
opkrævning. Opkræver en udlejer alligevel el aconto, tæller den med som
enhver anden post — derfor bliver `utilities_electricity` i skemaet.
Boligkortet siger "El afregnes direkte med elselskabet", men kun når vi har
gjort rede for hele udlejerens aconto. Kender vi ikke totalen, ved vi heller
ikke, om el mangler i opgørelsen eller ikke opkræves, og så siger vi intet.

Begge løfter afhænger af, at data er ægte. Et estimeret areal eller et
gættet aconto-beløb ødelægger dem begge.
