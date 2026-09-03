# Bofinda — regler for denne mappe

Læs `BRIEF.md` for opgaven. Reglerne her gælder altid, i hver session.

## Må aldrig ske

- **En manglende oplysning skal være synlig, ikke fraværende.** Kender vi
  ikke totalen, skriver kortet "Udlejer oplyser ikke aconto — spørg om varme
  og vand." Vi kan ikke skelne "udlejer opkræver intet" fra "udlejer oplyser
  intet", så vi påstår ingen af delene — vi siger, hvad brugeren skal spørge
  om. Et gæt her ville love hende noget om hendes økonomi, som ikke holder.
- **Prissammenligningen på boligsiden viser altid sit grundlag, og vises
  slet ikke under 5 boliger i postnummeret.** En median af to boliger er
  ikke en markedspris. Der står hvad afvigelsen er, hvad den måles mod, og
  hvor mange boliger medianen er regnet af — "6 % under medianen for 2300
  (baseret på 129 boliger)". **Ingen farveskala uden tal bag.** Kun boliger
  med KENDT total og areal tæller med: en bolig hvor vi kun kender huslejen,
  ville trække medianen ned og sammenligne to forskellige ting. Grundlaget
  er dedupet, så den samme bolig hos to kilder ikke tæller dobbelt. Se
  `MINDST_TIL_SAMMENLIGNING` i `lib/soeg.ts`.
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
- **Søgesiden og gem-formularen skal læse URL-parametrene samme sted.**
  `filtreFraParametre()` i `lib/soeg.ts` bruges af begge. Læste de to hver
  sin vej, ville den gemte søgning matche noget andet, end brugeren havde
  på skærmen, da hun trykkede — og det ville ingen opdage.
- **En gemt søgning uden filtre gemmes ikke.** Det er "alle boliger i
  landet" og giver modtageren hundredvis af mails. `harFiltre()` afgør det.
- **Alarmen skal matche præcis som søgesiden filtrerer.** `hvor()` i
  `lib/soeg.ts` er eksporteret og bruges begge steder. To implementeringer
  ville betyde, at beskeden rammer noget andet, end brugeren så, da hun
  oprettede søgningen — og det ville hverken kunne ses eller fejles på.
- **Dedup mellem kilder kører på to niveauer.** Den samme
  bolig annonceres flere steder — 19 grupper i dag, 18 af dem
  Propstep + LokalBolig. Adressevasken giver dem allerede samme unit-uuid,
  og `ikkeRepraesentant()` i `lib/soeg.ts` skjuler alle på nær én.
  · **Access-niveauet KRÆVER et husnummer.** Nøglen er opgang + areal +
  værelser + husleje, og uden husnummer er "opgangen" hele vejen:
  Nordskovvej i 7184 Vandel er 30 boliger med den samme adressestreng,
  "Nordskovvej, 7184 Vandel", og kilden siger ikke hvilken bolig der er
  hvilken. Uden kravet skjuler reglen 26 af dem som dubletter af hinanden.
  Med kravet skjuler den 2, og begge er den samme bolig annonceret to
  steder. Fjern aldrig kravet uden at tælle efter igen.
  · Nøglen står to steder: `DEDUPNOEGLE` i `lib/soeg.ts`, som kører, og
  `dedupNoegle` i `lib/dedup.ts`, som beskriver den. De skal ændres sammen.
  Det samme gælder `SAMME_BOLIG_ANDEN_KILDE`, som kortets kildemærkater
  bygger på — den har sit eget alias og kan ikke genbruge nøglen.
  · **Rangeringen regnes på det FILTREREDE sæt.** Ellers taber en søgning
  på "kilde: LokalBolig" de boliger, hvor Propstep blev repræsentant —
  boligen ville forsvinde helt i stedet for at stå én gang.
  · Repræsentanten er den med flest billeder, så den med kendt total, så
  den ældste række. Sidste led er der, så valget er stabilt mellem kørsler.
  · **Alt der viser eller TÆLLER en liste skal gennem `udenDubletter`** —
  også områdesidernes statistik. Tæller brødteksten andet end listen under
  den, er den ene forkert.
  · Kortet navngiver alle kilderne. På et gruppekort kun når det gælder
  HELE gruppen: repræsentanten må ikke tale for de andre.
  · `hvor()` er urørt. Alarmen matcher stadig på de enkelte rækker.
- **Gruppering er en visning, aldrig et filter.** Ens boliger — samme kilde,
  postnummer, vejnavn og værelsestal — vises som ét kort med et link til de
  enkelte adresser. Det sker i `soegGrupperet()`, som ligger UDEN OM
  `hvor()`. Alarmen matcher stadig på de enkelte boliger, og en gruppe må
  aldrig kunne skjule en bolig for et match. Fire ting følger med:
  · **Prisen er ikke i nøglen.** Var den det, delte Ammendrup Parks 21
  rækkehuse sig i ti kort på et par hundrede kroners forskel. Uden den er de
  to, og kortets "fra" har et rigtigt spænd bag sig.
  · Er en nøgledel ukendt, grupperes boligen ikke — to ukendte værelsestal
  er ikke "det samme". Prisen tæller med her, selv om den ikke er en
  nøgledel: kortet siger "fra X kr/md" om hele gruppen.
  · Nøglen bærer, om totalen er kendt. Prisen er `coalesce(total, husleje)`,
  så en gruppe med begge slags ville skrive "i alt" om boliger, hvor vi kun
  kender huslejen.
  · Kortet påstår kun det, der gælder for hele gruppen. Forskellige arealer
  bliver et spænd, forskellige ledigdatoer bliver "flere ledigdatoer" — ikke
  den tidligste, som om den var alles — uens aconto-poster står slet ikke, og
  en blandet boligtype bliver til "boliger", ikke til repræsentantens type.
  · **Er den dyreste mere end 25 % over den billigste, står hele spændet i
  stedet for "fra".** "fra 17.700" er sandt om en gruppe, der går til 35.900,
  og alligevel vildledende for en, der skimmer. Brugeren skal ikke kunne
  blive overrasket af noget, vi vidste.
- **Tællelinjen tæller boliger, ikke kort.** "Viser de 62 nyeste af 904" er
  boliger. Et gruppekort dækker flere, så kortenes antal ville være forkert.
- **Et filter vises kun, hvis en kilde faktisk oplyser feltet.** Boligtyper
  og faciliteter tælles i `facetter()`, og tælles de til nul, kommer valget
  ikke på skærmen. Et filter, der aldrig kan give træf, er værre end intet
  filter.
- **Faciliteter er en POSITIV liste.** Står `elevator` ikke i `amenities`,
  betyder det "ikke oplyst" — ikke "ingen elevator". Kun Propstep oplyser
  dem overhovedet, så et facilitetsfilter skjuler 400+ boliger, fordi deres
  kilde tier. Det SKAL stå på skærmen, når filteret er slået til; noten på
  søgesiden navngiver kilderne og tallet.
- **Webappens pulje er fem, ikke én, og den går på TRANSACTION-pooleren.**
  Session-poolerens 15 pladser er workerens budget, ikke webappens.
  `max: 1` serialiserede alt i en lambda-instans — både sidens egne
  forespørgsler og de samtidige requests, instansen betjener. Lokalt hang
  hver listeside i minutter; i produktionen blev det 504
  FUNCTION_INVOCATION_TIMEOUT.
- **Sider med flere forespørgsler kører dem efter hinanden, ikke i
  `Promise.all`.** Samtidige kæder bliver til pipelinede sætninger gennem
  Supavisor i transaction mode, og det var dét, der væltede ved den ottende
  forespørgsel. Rækkefølgen koster ingenting nu, hvor `facetter()` og
  `forsidetal()` er cachede: to forespørgsler pr. sidevisning mod otte før.
- **`facetter()` og `forsidetal()` caches i fem minutter** i `app/cache.ts`.
  De regnes på hele bestanden, og importen kører én gang i timen. Cachen
  ligger i app-laget og ikke i `lib/`: `next/cache` hører til webappen, og
  workeren og alarmen kører i tsx uden Next omkring sig.
- **Forsidens hastighedstal måler kun boliger, der dukkede op MENS vi
  kiggede.** Grænsen går et døgn efter den enkelte KILDES første kørsel. Ved
  første import får hele bagkataloget `first_seen_at = nu`, og en kilde med
  årsgamle annoncer ville ellers se ud som en forsinkelse på vores side —
  LokalBolig sendte p90 fra 57 min. til 2.209 timer. Samme fælde og samme
  svar som alarmens "ny er ikke vi så den nu"; grænsen skal være pr. kilde,
  ikke global.
- **"Fuld økonomi" er ikke det samme som "total kendt".** Kravet er husleje
  plus mindst én NAVNGIVEN aconto-post — varme, vand eller el. En kilde, der
  kun skriver "Aconto pr. md.: 900 kr." uden at sige hvad den dækker (Dacas
  og LokalBolig), giver os en rigtig total: den står på kortet som "i alt",
  og prisfilteret regner med den. Men vi ved ikke, OM varme og vand er med,
  og "hele økonomien oplyst" ville være en påstand om noget, vi ikke har
  fået. Reglen står to steder og skal være ens begge: `erFuldOekonomi` i
  `lib/normalize.ts` og `FULD` i `lib/soeg.ts`.
- **"Ny" er ikke "vi så den nu".** Ved første import af en kilde får hele
  bagkataloget `first_seen_at = nu`. En bolig varsles kun, når kilden siger,
  den er oprettet efter søgningen — eller, for kilder uden dato, når den
  dukkede op efter mindst et døgns overvågning af den kilde. Uden reglen gav
  en prøvekørsel 68 falske varsler ud af 87, med en medianalder på 37 dage.
- **Privatlivspolitikken skal beskrive det, koden gør — ikke omvendt.**
  Sletningsfristerne i `/privatliv` og konstanterne i `ryd()` er ét og samme
  løfte. Ændres den ene, skal den anden med i samme ændring:
  30 dage ubekræftet · 90 dage efter afmelding · 24 måneder fra oprettelsen,
  medmindre brugeren har en nyere søgning.
- **Vi måler ikke åbninger eller klik i mails**, og skal ikke. Det ville
  kræve sporingspixels og omdirigerede links — altså præcis det, cookie- og
  sporingsafsnittet lover, vi ikke gør. Derfor er 24-måneders-reglen bundet
  til oprettelsestidspunktet, ikke til aktivitet i indbakken.
- **Dobbelt tilmelding er ikke valgfri.** En søgning oprettet på
  søgesiden er `confirmed_at = null` og varsler intet, før adressens ejer
  har trykket i bekræftelsesmailen. Uden det kunne enhver tilmelde en
  fremmed til en strøm af post. `matchAlarmer` og `ventende` filtrerer
  ubekræftede fra i selve forespørgslen.
- **Bekræftelseslinket må heller aldrig bekræfte på et GET.** Samme grund
  som afmeldingen: mailscannere henter hvert link, og et GET der aktiverer
  ville betyde, at modtagerens egen mailserver bekræftede for hende. Så var
  den dobbelte tilmelding ingenting værd. GET viser en knap, POST aktiverer.
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
- **Kortfliserne kommer fra OpenStreetMaps donationsdrevne tjeneste, og
  deres Tile Usage Policy er bindende.** Vores brug ligger inden for den:
  et menneske ser et kort, browseren henter kun fliserne til det udsnit.
  Kravene er bygget ind i `app/Landkort.tsx` — præcis URL'en, synlig
  kreditering der aldrig må skjules, "Meld en fejl i kortet"-link, ingen
  forhentning og ingen offline. Browserens egen User-Agent og cache
  opfylder resten; vi sætter ingen Referrer-Policy, og det skal blive
  sådan — en restriktiv ville fjerne den Referer, de identificerer os på.
  **Flise-URL'en er ikke hardkodet.** Politikkens afsnit 7 siger, at
  adgang kan trækkes uden varsel, og at kommercielle tjenester særligt
  skal regne med det. Bofinda er en kommerciel tjeneste. Skift kilde med
  `NEXT_PUBLIC_FLISE_URL` og `NEXT_PUBLIC_FLISE_KREDIT` — ikke med en
  kodeændring.
- **Kortet vises kun, når der er filtreret.** Uden en søgning spænder
  mærkerne over hele landet, og udsnittet siger ingenting. Samme regel som
  gem-boksen og prisnoten — på forsiden er det svar på et spørgsmål,
  brugeren ikke har stillet. Der fylder listen hele bredden.
- **Boligkortene brydes efter DERES egen bredde, ikke efter vinduets.**
  `.liste` er en `container-type: inline-size`, og kortenes brydning ligger
  i `@container`, ikke i `@media`. Med kortvisningen ved siden af er listen
  smal på en bred skærm, og en medieforespørgsel ville ikke opdage det:
  adresserne brød i to linjer på en 1180 px skærm.
- **Kortet indlæses først, når det er synligt**, og der er højst ét mærke
  pr. KORT — en gruppe er ét mærke med sit antal, så de 48 viste kort
  giver højst 48 mærker. Målingen sker med både IntersectionObserver og
  en afstandsmåling ved scroll: en indlæsning, der stille lader være med
  at ske, er værre end en, der koster en scroll-lytter.
- **Har en vært bedt om mindre, får den mindre.** `lokalbolig.io` svarer med
  `Content-Signal: search=yes,ai-train=no,use=reference`, og filen definerer
  selv `search` som "hyperlinks and short excerpts". Et billede i 1600 px er
  ikke et kort uddrag, så den vært får kun 400 og 800 — se `BREDDER_PR_VAERT`.
  Deres robots.txt tillader os teknisk alt (`User-agent: *` er `Allow: /`, og
  BofindaBot står ikke blandt de ni AI-crawlere, de afviser), men når nogen
  har taget udtrykkeligt stilling, retter vi os efter den. Grænsen håndhæves
  BÅDE i `billedUrl` (som skærer ned) og i ruten (som afviser).
- **Siger kilden selv, at billedet kan være af en anden bolig, viser vi
  ingen.** LokalBolig skriver det i brødteksten på nogle sager: "Bemærk
  venligst, at billederne kan være fra en anden bolig." Et billede af noget
  andet end den bolig, brugeren kigger på, er værre end intet billede — hun
  tror, hun har set den.
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
- **En fil må aldrig gå gennem en Server Action.** Grænsen er 1 MB, og et
  telefonbillede sprænger den — det gav `500 Body exceeded 1 MB limit` og en
  formular, der frøs. **Hæv den ikke.** Serveren udsteder en signeret
  upload-URL, og browseren sender filen direkte til bucket'en. Serveren
  rører kun JSON på nogle få hundrede bytes.
- **Billeder skaleres og EXIF strippes i browseren, før de sendes.** Et
  telefonbillede bærer GPS for, hvor det er taget — altså hvor boligen
  ligger, ofte på meteren. Det er ikke vores at videregive, og udlejeren har
  ikke tænkt over det. Omtegningen på et canvas gør begge dele på én gang.
- **Migrationer køres IKKE af Vercel-bygget** — et byg skal kunne lykkes
  uden en database. Derfor opdager ingenting en migration, der aldrig blev
  kørt: 0014 lå uden for produktionen, indtil en upload fejlede. **Kør
  `npm run db:status` efter hver deploy.** Den fejler med exit 1 og siger
  hvad der mangler — også en håndskrevet .sql-fil uden post i
  `meta/_journal.json`, som drizzle-kit ellers springer over i tavshed.
- **Bucket-navne er versalfølsomme.** Bucket'en blev oprettet som `Boliger`
  mens politikker og kode sagde `boliger`; ingen upload kunne ramme den.
  Alt vores hedder små bogstaver.
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

Aldrig: `note` · `owner` · `application` · `statusHistory` ·
`transactionStatusHistory` · `accountId` · `companyId` · `ownerId` ·
`transactionId` · `settings`.

Fra `propertyGroup` læses **aldrig andet end disse to navngivne stier**:

    propertyGroup.images[].name
    propertyGroup.imagesDefault[].name

De er billedfilnavne. `contractBankAccount`, `paymentDetails` og
`emailsWithDetails` ligger i samme objekt og forbliver utilgængelige — der
læses aldrig objektet, aldrig et spread, aldrig andre felter. `laesBilleder`
er det eneste sted, der rører `propertyGroup`.

**Hvorfor undtagelsen findes:** når et lejemål ikke har egne billeder,
falder Propstep tilbage på ejendommens fælles — det er hvad
`useDefaultImages: true` betyder, og filerne har præfikset `pg-`. Uden
fallbacket stod 370 af 736 Propstep-boliger uden billeder hos os, mens
kildens egen side viste 6-30 stykker. Flaget kræves: er det ikke sat, har
kilden fravalgt at vise ejendommens billeder, og så gætter vi ikke.

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

### Bygning + enhed

Nogle kilder skriver blokken i stedet for etagen:

    "Stenlængegårdens Kvarter 4, Bygning 4. 15, 4700 Næstved"   23 boliger
    "Valdemarsgade 96, B1 Nr. 8, 4760 Vordingborg"              19 boliger

**Bygning er ikke etage.** Bygning 4 er en blok, ikke fjerde sal, og kortet
skriver `etage. dør` — så en bolig i stueetagen ville stå som "4. sal".
Derfor bliver `floor` stående null, og hele betegnelsen gemmes som `door`,
ordret som kilden skrev den. Nøglen kanoniserer den alligevel, så
"Bygning 4. 15" og "bygning 4, 15" giver samme nøgle.

Den korte form kræver "Nr." — uden det er `B1 8` for tvetydigt.

**Enheden kræver derfor kun en dør, ikke etage OG dør.** "3. sal" alene er
otte lejligheder; en dør alene peger på netop én. Manglende etage skrives
som `-` i nøglen, så rækker der har begge dele beholder præcis den nøgle,
de havde.

Ændrer vasken sig, skal de gamle rækker genparses — ikke hentes hjem igen.
Kildens streng er den samme; det er kun vores læsning, der er blevet bedre:

    npm run genparse             viser hvad der ville ske
    npm run genparse -- --skriv  skriver

### Kendt begrænsning: stednavne

Nogle kilder skriver et stednavn mellem husnummer og postnummer —
`"Fjerbregnevej 2, Trøstrup, 5210 Odense NV"`. Vi har ingen kolonne til det,
så det droppes. Adressenøglen er postnr + vej + husnr, hvilket i teorien kan
kollidere, hvis samme vejnavn og husnummer findes i to stednavne inden for
ét postnummer. Efterset på Fjerbregnevej: Trøstrup har nr. 2–25, Slukefter
27–45, altså én vej gennem to stednavne og ingen kollision. Rigtig
adressevask mod DAR løser det endeligt.

## LokalBolig

Mæglerkæde. 232 lejemål ved siden af et salgsudbud på ~2.200.

`discover()` henter `/api/cases/map?caseType=rented` — hele udbuddet i ét
kald, med `lastUpdated` på hver sag. Sitemap'et duer IKKE som indgang: dets
2.186 URL'er er overvejende salg, og det skelner ikke leje fra salg.

`extract()` læser boligsiden. Det er Next.js App Router, så hele sagen ligger
som JSON i `self.__next_f`-brudstykkerne.

**Grænsen `"relatedCases"`.** Alt før den hører til DENNE bolig. Payloaden
bærer elleve andre sager i et "lignende boliger"-felt med de samme nøgler —
`address`, `coordinates`, `roomCount`, `floorArea` — så uden grænsen ville et
regex lige så gerne ramme naboens tal. Adapteren tjekker ved hver hentning, at
hver læst nøgle findes præcis én gang i hoveddelen, og springer boligen over,
hvis payloaden har ændret form.

Aldrig: `caseAgent` (navngiven mægler), `shop` (butikkens adresse og telefon),
`caseAnalytics` (deres visningstal), `project` (projektets billeder — ikke af
denne bolig), `description` (kildens brødtekst; vi skriver vores egen).

Acontoen findes kun som én uspecificeret klump, "Aconto pr. md.", og kun som
tekst. Den lander i `utilities_other`. Se reglen om fuld økonomi ovenfor.

Nøglen er sagsnummeret (`49-x0003644`), ikke URL'en: rettes adressen, skifter
URL'en, og en URL-nøgle ville gøre boligen til en ny bolig.

**Kilden er ustabil.** `www.lokalbolig.dk` svarede 503 "Backend is unhealthy"
fra Varnish gennem hele undersøgelsen og den første import. Derfor fem forsøg
i stedet for tre, og derfor tæller 502 og 504 nu som midlertidige i
`lib/fetch.ts`. Deres eget indeks indeholder også sager, hvis side er væk.

### Ikke undersøgt endnu

Cepheus: tom robots.txt (3 bytes, kun en BOM), sitemap 404, og hverken
`/lejemaal/` eller `/ejendomme/` indeholder boliger — begge er samme skal som
forsiden, hvis meta stadig er pladsholdertekst. Der er intet at hente. Det er
desuden én udlejer i Randers, ikke et administrationssystem.

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
