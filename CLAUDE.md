# Bofinda — regler for denne mappe

Læs `BRIEF.md` for opgaven. Reglerne her gælder altid, i hver session.

## Må aldrig ske

- **Udlejerens egne adressefelter er autoritative. `address_raw` må aldrig
  genparses for `source_type = 'native'`.** Hun taster vej, husnummer, etage
  og dør i hvert sit felt; `address_raw` er en streng, VI bygger af dem til
  visning. At læse den tilbage er at smide oplysningerne væk og gætte dem
  igen — og gættet går galt: "Vestergade 1, 8000" bliver til etage 80, dør
  00. Det var netop den fejl, de adskilte felter blev indført for at fjerne.
  `scripts/genparse-adresser.ts` har derfor `ne(sourceType, 'native')`.
  For de scrapede er strengen kildens egen, og der er ikke andet — der giver
  genparsning mening.
- **`city` udledes af postnummeret på serveren og må aldrig være null.**
  `city` er præcis det, bysøgningen og områdesiderne filtrerer på. En
  udlejer, der skriver "Kbh N" i stedet for "København N", ville falde ud
  af hver eneste bysøgning uden at kunne se hvorfor — og et tomt felt
  falder ud af dem alle. `byForPostnr` i `lib/omraade.ts` slår op i de
  boliger, vi allerede har, med samme `mode()`-forespørgsel som
  områdesiderne bygger deres navne af. Feltet står i formularen, men vores
  egen stavemåde vinder; kun for et postnummer vi ikke kender, bruges det,
  hun skriver.
- **Adressefelter, der ville ødelægge nøglen, afvises ved indtastning.**
  Vejnavnet skal indeholde mindst ét bogstav (`\p{L}` — æøå og andre
  alfabeter tæller) **og** efterlade noget i `kanonisk()`. Husnummeret skal
  indeholde mindst ét ciffer. Døren skal være en kendt form: tv, th, mf, et
  tal eller ét bogstav. Grundene, i rækkefølge: "🏠", "---" og "..." gav
  alle nøglen `intern:v3:2200::30` uden vej; et husnummer på "-" ophæver
  husnummerkravet i access-dedup og bringer Nordskovvej-fejlen tilbage; og
  fri tekst i Dør hæver niveauet til `unit`, hvorved areal, værelser og
  leje falder ud af nøglen, så to vidt forskellige boliger bliver til én.
  Reglerne står i `tjekAdresse` i `lib/udlejer.ts` — ikke i server
  action'en, så de kan prøves uden en formular.
- **Faciliteterne har én definition, og den ligger i `lib/faciliteter.ts`.**
  Filen må ikke importere databasen: udlejerformularen er en
  klientkomponent, og et værdi-import derfra trak engang `postgres` med ind
  i browserbundtet og væltede hele appen på `Can't resolve 'net'`.
  `FACILITETER` er typebundet til `FACILITET`, så en tastefejl i et
  facilitetsord ikke kan oversættes. Formularen spørger om dem, fordi
  filtrene ellers skjuler hver eneste udlejerannonce for altid.
- **Rækkefølgen i `billeder`-arrayet ER `listing_images.position`, og det
  første billede er forsidebilledet.** Udlejeren bestemmer den ved at
  trække miniaturerne eller bruge pilene; de skjulte felter sendes i
  DOM-orden, og `opretBolig`/`opdaterBolig` skriver `position` ud fra
  indekset. Boligsiden, redigér-siden og søgekortets `forside` sorterer
  alle på `position` — falder ét af de fire led fra, vælger vi et
  tilfældigt forsidebillede for hende. `npm test` prøver hele kæden.
  Træk-og-slip er en genvej, aldrig den eneste vej: pileknapperne skal
  blive, for HTML5-træk findes ikke på en telefon og virker ikke med
  tastatur.
- **En udgivet annonce, der ikke kan findes, må ikke stå som "udgivet".**
  Mærkatet på Mine annoncer spørger om synlighed, ikke om `status`. Taber
  annoncen repræsentantvalget til en dublet, står der hvad der sker, hvilken
  annonce der vises i stedet, og hvorfor den vandt. Det er vores eget
  princip vendt indad: en udlejer, der tror hun er synlig, mens hun ikke er,
  er samme fejl som en total, der lader som om aconto er kendt.
  Repræsentanten vælges stadig på billedantal — bureauannoncen med tyve
  billeder er den bedre visning for den, der søger bolig. Løsningen er at
  fortælle udlejeren det, ikke at lade hende vinde. Se `repraesentantFor`
  i `lib/soeg.ts`; den bygger ikke sin egen rangering.
- **En manglende oplysning skal være synlig, ikke fraværende.** Kender vi
  ikke totalen, skriver kortet "Udlejer oplyser ikke aconto — spørg om varme
  og vand." Vi kan ikke skelne "udlejer opkræver intet" fra "udlejer oplyser
  intet", så vi påstår ingen af delene — vi siger, hvad brugeren skal spørge
  om. Et gæt her ville love hende noget om hendes økonomi, som ikke holder.
- **428 af 1.226 synlige boliger har ingen facilitetsdata overhovedet, og
  frafaldet er ikke jævnt fordelt.** Målt 4. september 2026:

  | Kilde | Synlige | Tavse | Andel |
  |---|---|---|---|
  | LokalBolig | 224 | 224 | 100 % |
  | findbolig.nu | 158 | 158 | 100 % |
  | Propstep | 764 | 27 | 4 % |
  | Dacas | 17 | 17 | 100 % |
  | Balder | 62 | 1 | 2 % |
  | Bofinda (native) | 1 | 1 | 100 % |

  **Tre af kilderne oplyser aldrig faciliteter** — LokalBolig, findbolig.nu
  og Dacas, tilsammen 399 boliger. (Den fjerde 100 %-linje er vores egen
  native-kilde med én annonce.) Et facilitetsfilter fjerner de tre kilder
  fuldstændigt, og bliver dermed også et kildefilter, uden at nogen har
  bedt om det.

  **Rettelse til en tidligere opgørelse:** tallet 262 har stået som antallet
  af boliger uden facilitetsdata. Det var forkert. Det kom af en gruppering
  på `source_type`, hvor "spider: 0 af 261" så udtømmende ud — men den
  skjulte, at findbolig.nu er en `feed`-kilde og lige så tavs som
  spider-kilderne. Grupper på kilde, ikke på kildetype, når spørgsmålet er,
  hvem der oplyser hvad.

  Når et facilitetsfilter er sat, står der desuden, hvilke kilder der
  forsvinder helt: *"Dacas, LokalBolig og findbolig.nu oplyser aldrig
  faciliteter. Med et facilitetsfilter er alle 399 boliger derfra ude — også
  dem der har det, du søger."* Navnene beregnes af `tavseKilder` i
  `lib/soeg.ts`, ikke skrives ind, så linjen retter sig selv, hvis en kilde
  skifter praksis. **Vores egen native-kilde tælles ikke med der:**
  udlejerformularen spørger om faciliteter, så "oplyser aldrig" ville være
  faktuelt forkert om den — at én annonce ikke har krydset noget af, er ikke
  en datapraksis. De native tavse tælles stadig i "oplyser ingen".

  Grundlagslinjen under hver afkrydsning nævner derfor **tre** grupper, ikke
  to: hvor mange der oplyser faciliteten, hvor mange der oplyser faciliteter
  uden den, og hvor mange der intet oplyser. Tallene skal gå op med det
  samlede antal — gør de ikke det, mangler brugeren en gruppe uden at kunne
  se hvilken. `npm test` tæller de tre uafhængigt og sammenligner; en prøve,
  der udleder mellemgruppen som resten, ville gå op per definition og aldrig
  kunne fejle.
- **Et filter skal gøre rede for, hvad det udelader.** De tre
  facilitetsfiltre udelukker boliger, hvor faciliteterne er ukendte — det
  er det eneste ærlige, for vi ved ikke om de har elevator. Men så skal der
  stå under afkrydsningen, hvor mange der oplyser det, og hvor mange der
  tier og derfor forsvinder: "92 boliger oplyser det. 68 oplyser ikke
  faciliteter og vises ikke." Kun Propstep oplyser faciliteter; 435 af
  boligerne tier. Uden linjen ligner et facilitetsfilter en udtalelse om
  markedet, og det er det ikke.
  Tallene beregnes, aldrig hardkodes, og de følger den aktuelle søgning —
  men **uden** de tre facilitetsfiltre selv, ellers ville der stå "0 tier"
  under et filter, der lige havde skjult 435 boliger. `facilitetsgrundlag`
  i `lib/soeg.ts` er `opsummering` på netop det grundlag; er ingen af de tre
  sat, er forespørgslen ordret den samme, og forsiden genbruger svaret i
  stedet for at spørge igen. Forsiden kører to forespørgsler pr. visning,
  og det tal har været dyrt at få ned.
- **Prisetiketten hedder "til udlejer", ikke "i alt".** Tallet er husleje
  plus den aconto, kilden opkræver — alt hvad der betales til udlejeren.
  Det er sandt, uanset om el er oplyst. "I alt" var det ikke: el står
  udenfor hos næsten alle kilder (9 boliger ud af 1.200 har et el-beløb),
  så etiketten lovede en fuldstændighed, tallet ikke havde. Står i
  prisblokken på begge korttyper i `app/Boligkort.tsx`.
- **El-forbeholdet har FIRE tilstande, ikke tre.** De tre første handler om
  det samme spørgsmål — er el med i tallet? Den fjerde handler om noget
  andet: ved vi overhovedet, hvad tallet dækker?

  | Tilstand | Hvornår | Hvad vi siger |
  |---|---|---|
  | `med` | el er en navngiven post | ingenting |
  | `egen-maaler` | kilden siger det selv | "el afregnes direkte med elselskabet" |
  | `ikke-med` | posterne er udspecificerede, el er ikke blandt dem | "El indgår ikke — udlejer oplyser ikke hvordan" |
  | `ukendt-daekning` | aconto er ét samlet beløb uden specifikation | "Aconto er ét samlet beløb — det fremgår ikke om el er med" |

  **"El er ikke med i tallet" og "vi ved ikke hvad der er i tallet" er to
  forskellige udsagn, og kun det første kan aflæses af udspecificerede
  poster.** Skriver LokalBolig "Aconto pr. md.: 1.783 kr." og intet andet,
  kan el ligge i klumpen. Vi hentede tre af deres sider og søgte hele
  brødteksten på varme, vand, el, forbrug, antenne, internet og inkl. — der
  er ingen overskrift, ingen note og ingen specifikation. Kilden siger
  beløbet og intet mere. At sige "El indgår ikke" om det ville være en
  påstand, vi ikke har fået dækning for. Det stod på **254 boliger**
  (LokalBolig 230, Propstep 23, Dacas 1), før tilstanden fandtes.

  Skellet ligger i dataene og kræver ingen ny kolonne: `other` i
  `total_monthly_components` uden en eneste navngiven post, og
  `electricity_own_meter` ikke true. Udledningen er `eltilstand` i
  `lib/eloplysning.ts` — ét sted, brugt af begge korttyper, boligsiden og
  alarmmailen. Teksterne er forskellige de fire steder, fordi der er
  forskellig plads; spørgsmålet besvares kun ét sted.
- **En grøn total må aldrig stå uden at el er gjort rede for.** Prisblokken
  bliver grøn (`.kort-pris` uden `.kun-leje`), så snart `total` er sat —
  uanset hvad totalen dækker. Mangler el i den, skal kortet sige det.
  Linjen bor ét sted, `Ellinje` i `app/Boligkort.tsx`, fordi de to
  korttyper ellers driver fra hinanden: gruppekortet manglede den helt,
  mens enkeltkortet havde den, og det stod på **171 gruppekort over 675
  boliger**, før nogen så det. Balder gjorde det synligt — alle dens 59
  boliger har varme og vand uden el — men fejlen var der i forvejen hos
  Propstep, LokalBolig og findbolig.
  For en gruppe er spørgsmålet ikke "har repræsentanten el?" men "mangler
  NOGEN i gruppen den?" (`nogenUdenEl`). Ét kort taler for flere boliger,
  og fravær af oplysning er ikke et nej. Den stærkere formulering "el
  afregnes direkte med elselskabet" bruges kun, når kilden selv siger det
  om hver enkelt (`alleUdenElHarEgenMaaler`). `npm test` gengiver begge
  korttyper og fejler, hvis en grøn total kan stå uden forbeholdet — også
  hvis nogen "løser" det ved at skrive linjen på alting.
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
- **Udlejerannoncer går ALDRIG ud i en alarmmail.** Umodereret
  brugerindhold, der lander i fremmedes indbakker, er en spamvej, der er
  svær at lukke bagefter. Native boliger bliver i søgningen, hvor brugeren
  selv opsøger dem, og ude af mailen — `ne(listings.sourceType, 'native')`
  i `matchAlarmer`. Spærringen står udtrykkeligt, fordi de FØR faldt ud ved
  et tilfælde: filteret slår kildens første kørsel op i `crawl_runs`, og
  `native` har ingen kørsler. Den dag nogen sætter `source_created_at` på
  en udlejerannonce — hvad "udgivet den" naturligt ville være — ville de
  begynde at gå ud. `npm test` prøver netop det tilfælde.
  Ophæves spærringen, kræver det moderation først.
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
  så en gruppe med begge slags ville skrive "til udlejer" om boliger, hvor
  vi kun kender huslejen.
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
  og LokalBolig), giver os en rigtig total: den står på kortet som
  "til udlejer", og prisfilteret regner med den. Men vi ved ikke, OM varme og vand er med,
  og "hele økonomien oplyst" ville være en påstand om noget, vi ikke har
  fået. Reglen står to steder og skal være ens begge: `erFuldOekonomi` i
  `lib/normalize.ts` og `FULD` i `lib/soeg.ts`.
- **"Ny" er ikke "vi så den nu".** Ved første import af en kilde får hele
  bagkataloget `first_seen_at = nu`. En bolig varsles kun, når kilden siger,
  den er oprettet efter søgningen — eller, for kilder uden dato, når den
  dukkede op efter mindst et døgns overvågning af den kilde. Uden reglen gav
  en prøvekørsel 68 falske varsler ud af 87, med en medianalder på 37 dage.
- **Politikken er først gyldig, når `info@bofinda.dk` modtager mail.**
  Domænet er ikke købt — `bofinda.dk` slår op med NXDOMAIN. En
  privatlivspolitik, der henviser til en adresse, ingen læser, giver ikke
  den indsigtsret, den lover. **Det skal være på plads, før en fremmed
  udlejer opretter en annonce** — indtil da er den eneste native annonce
  ejerens egen, med hans egne oplysninger.
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
- **Grundlaget for HVER kilde er en mundtlig tilladelse, givet pr. telefon
  og optaget med samtykke — ikke robots.txt.** Robots.txt tjekkes ved
  siden af, men den er et signal til fremmede, ikke en aftale. Hvem der
  har givet lov til præcis hvad, står i `docs/kildetilladelser.md`, og
  omfangs-kolonnen skal nævne værter, endpoints, nøgler og billedvært —
  "vi må bruge deres API" er ikke præcist nok, som Balder-sagen viste.
  **Optagelserne må ikke i git.** De indeholder personoplysninger om
  navngivne mennesker — stemme, navn, stilling — og opbevares uden for
  repoet. En optagelse i et git-repo kan ikke slettes igen.
- **Balder er undtaget robots.txt-reglen — for `www.balder.dk`.**
  `www.balder.dk/robots.txt` har `Disallow: /api/`. Rettighedshaveren har
  selv givet os lov til at bruge deres API, og robots.txt er et signal til
  fremmede, ikke en aftale: har ejeren sagt ja, gælder deres ja. Derfor
  ignorerer vi den linje bevidst, og det er ikke en forglemmelse.
  Se `docs/kildetilladelser.md` for hvem der gav lov og hvornår.
  **Undtagelsen dækker også `api.balder.dk`**, som har `Disallow: /` til
  alle. Balder har bekræftet, at tilladelsen gælder den vært, og at vi skal
  bruge søgenøglen fra deres eget frontend-bundt. Nøglen ligger i
  `BALDER_API_KEY` og aldrig i adapteren: den kan skifte uden varsel, og så
  skal den kunne rettes ét sted.
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
- **`landlord_id` er en del af grupperingsnøglen, og den skal blive der.**
  Den ser overflødig ud: kolonnen er NULL på hver eneste scrapede bolig, og
  `group by` samler NULL i én gruppe, så de eksisterende grupper er
  bit for bit uændrede (efterprøvet: samme SHA før og efter). Men
  `sources.slug` er `'native'` for ALLE udlejerannoncer, så uden ejeren
  ville to forskellige udlejere med hver sin lejlighed på samme vej, samme
  postnummer og samme værelsestal blive ét kort, der påstod, at det var
  samme udbud. Én udlejer med fem ens lejligheder skal stadig blive ét kort
  — det er dét, gruppering findes for — og derfor er ejeren en nøgledel og
  ikke en spærring. `npm test` prøver begge veje.
  Nøglen bæres ikke længere i `/gruppe`-adressen; den udledes af
  repræsentantens bolig-id (`?b=<id>`), så en udlejers konto-id aldrig
  havner i en delbar URL. De gamle parameter-links virker uændret — de
  kunne kun være dannet af scrapede boliger, hvis `landlord_id` er null.
- **Svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted.**
  Ikke "holdes ens" — beregnes ét sted og bruges derfra. Fem fejl i denne
  omgang havde nøjagtig den form, og i hver eneste var *begge* udtryk
  korrekte hver for sig. Det er derfor de er svære at få øje på i en
  gennemlæsning: der er ingen forkert linje at pege på, kun to rigtige, der
  driver fra hinanden.

  | Spørgsmålet | Det ene udtryk | Det andet |
  |---|---|---|
  | Kan vi vise billedet? | `b.forside` (URL'en findes) | `billedUrl(...)` (værten er tilladt) |
  | Hvor mange billeder? | `count(*)` i `listing_images` | det `billedUrl()` slap igennem |
  | Er el med i totalen? | enkeltkortet spurgte | gruppekortet spurgte slet ikke |
  | Hvad hedder facilitererne? | `FACILITETER` i formularen | `FACILITET` i filtrene |
  | Er økonomien fuld? | `erFuldOekonomi` | `FULD` i søgelaget |

  Rettelsen er den samme hver gang: én kilde, og de andre afledt af den.
  `Ellinje` er én komponent, begge korttyper kalder den. `VISBAR_VAERT`
  bygges af `TILLADTE_VAERTER`, så allowlisten ikke er skrevet af i SQL.
  `FACILITETER` er typebundet til `FACILITET`. `billedUrl()` beregnes én
  gang pr. kort og bruges til både klassen og billedet.

  **Tegnet at holde øje med:** et prædikat, der findes både i JS og i SQL,
  eller et tal, der tælles ét sted og filtreres et andet. Så snart de to
  ikke kan afledes af hinanden, er det et spørgsmål om tid.

- **En ny kilde skal tilføjes til `TILLADTE_VAERTER` i `lib/billede.ts` i
  SAMME ændring som adapteren.** Glemmes værten, returnerer `billedUrl()`
  null, og billederne forsvinder uden en fejl nogen steder. Det skete for
  dacas.dk: 177 billeder blev bare ikke vist. Bemærk at værten ofte IKKE er
  kildens eget domæne — Balders billeder ligger på `images.ctfassets.net`,
  Propsteps på `app.propstep.com`.
  **En manglende post ødelægger også layoutet, ikke kun billedet.** Kortets
  gitter har en 216 px billedkolonne, og klassen `uden-billede` fjerner den.
  Afgøres klassen af den rå URL, mens billedet afgøres af `billedUrl()`,
  bliver kolonnen stående tom, når værten mangler — og adressen brækker ét
  ord per linje i den klemte tekstkolonne. Begge korttyper skal derfor
  beregne `billedUrl()` ÉN gang og bruge samme værdi til klassen og til
  billedet. `npm test` gengiver kortene med en vært uden for allowlisten og
  fejler, hvis klassen udebliver — også hvis nogen "løser" det ved at sætte
  `uden-billede` på alting.
- **Kopiér aldrig kildens billeder.** Gem `external_url`, servér gennem
  `/api/billede`. Signaturen dækker `(url, bredde)`, så en fremmed hverken
  kan bruge proxyen til vilkårlige adresser eller bede om vilkårlige
  størrelser. Værtslisten i `lib/billede.ts` er andet lag og tjekkes **før**
  signaturen — slipper hemmeligheden ud, kan proxyen stadig kun pege på de
  kilder, vi allerede henter fra. Nye kilder skal tilføjes dér.
- **Muren er ÅBEN for native boliger indtil videre.** `hentBolig` udleverer
  `harKontaktMail` og `harKontaktTlf` — om der er oplyst noget, ikke hvad —
  og `hentKontakt` i `app/bolig/[id]/kontakthandling.ts` giver selve
  værdierne, når et menneske trykker. Betingelsen `sourceType = 'native'`
  står i SQL'en begge steder, aldrig i skabelonen.

  **Hvorfor åben:** en scrapet bolig har en kilde at henvise til, og der
  linker vi. En udlejerannonce har ingen. Muren gjorde den til en annonce,
  ingen kunne svare på, mens udlejeren troede hun var i gang.

  **Når betalingsmodellen kommer:** muren skal lukkes igen for native — men
  som en betalingsmur, ikke som i dag, hvor felterne bare ikke blev hentet.
  Betingelsen i `kontakthandling.ts` skal da udvides med et abonnementstjek,
  og `harKontaktMail`/`harKontaktTlf` skal blive stående, så siden fortsat
  kan sige, at der ER en vej — ellers ser annoncen tom ud.
- **Mailadresser står aldrig som rå tekst på en offentlig side.** Adresse-
  høstere læser markup på minutter. Værdien hentes med en server action,
  når nogen trykker, så den ikke er i svaret. Det rigtige på sigt er en
  formular, der sender beskeden videre på serveren, så adressen aldrig
  forlader os — den kan ikke bygges, før afsenderdomænet er ægte. I dag er
  `ALARM_AFSENDER` Resends delte testdomæne, som kun leverer til kontoens
  egen ejer, og en formular ville tie og tabe henvendelsen.
- **Kontaktfelterne må aldrig stå i en select-liste.** `hentBolig` og `soeg`
  henter dem ikke. Muren står i query-laget, ikke i skabelonen: et felt der
  aldrig forlader databasen, kan ikke lække ved en uopmærksom UI-ændring.
- **En redigering må kun røre de kolonner, formularen selv styrer.** Listen
  står eksplicit i `fraFormular` i `lib/udlejer.ts`. Før skrev opdateringen
  hele normaliseringens output, og det er farligt to gange: felter
  formularen ikke kender blev nulstillet, og felter den ikke kunne INDLÆSE
  blev skrevet tomme hen over det gemte. Det kostede en udlejer hendes
  indflytningspris, fordi depositum og forudbetalt leje kun fandtes som en
  udregnet sum og ikke som kolonner.
- **Kan et felt redigeres, skal det gemmes særskilt.** En sum er nok for en
  scrapet bolig, hvor kilden kun oplyser totalen. Skal en udlejer kunne
  åbne sin annonce igen, skal delene kunne læses tilbage.
- **`npm test` kører rundturen:** gem en bolig uden at ændre noget, og
  bekræft at rækken er identisk kolonne for kolonne. Den er billig og
  fanger hele klassen — afprøvet ved at genindføre fejlen, som den fangede.
  Kør den, når noget i udlejerformularen ændres.
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
- **Prøver må aldrig låne en rigtig kilde.** `test-redigering.ts` skal bruge
  noget ikke-native for at prøve dedup og repræsentantvalg — men den lagde
  rækken på findbolig.nu's kilde-id, og så arvede den kildens historik i
  `crawl_runs`. Dermed passerede den alarmens indkøringsvagt: native-spærringen
  i `lib/alarm.ts` rammer ikke `feed`, prisen lå under en rigtig brugers
  bekræftede alarm, og `scripts/import.ts` matcher og **sender** i samme
  kørsel. En mail om en bolig, der ikke findes, manglede kun, at kørslen blev
  afbrudt i det rigtige sekund. Prøven opretter nu sin egen kilde med egen
  slug pr. kørsel og sletter den igen; en kilde uden kørsler kasseres af
  `foersteKoersel`. `source_created_at` sættes udtrykkeligt til null — er den
  sat, springes vagten helt over. En lokal database løser det ikke:
  `RESEND_API_KEY` ligger i samme `.env` som databasen.

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

## Backup — hvornår den skal køre

Supabases free-plan tager ingen backups. Udvikling og produktion er den
samme base. Der er ingen anden kopi end den, nogen selv har taget.

```bash
npm run db:backup          # dumper til backup/
npm run db:backup:proev    # genskaber nyeste dump lokalt og tæller efter
```

**Minimum: før hver migration.** En migration er det eneste, vi selv gør,
som kan ødelægge data uigenkaldeligt — `0015_depositum.sql` blev til,
fordi to kolonner manglede og tal gik tabt. Kør `db:backup`, se at den
siger `FÆRDIG`, og kør så `db:migrate`.

Derudover:

- **før `db/toem-public.sql` eller nogen anden `truncate` eller `delete`**
- **efter en udlejer har oprettet eller rettet en annonce.** Boliger fra
  kilderne kan hentes igen; det en fremmed selv har skrevet, kan ikke.
- **før en `genparse` eller anden masseopdatering** af eksisterende rækker

Kør `db:backup:proev` mindst en gang imellem — helst på den nyeste fil, og
altid efter en ændring i `db/migrations`. Prøven kører migrationerne på en
tom base, så den fanger også en migration, der ikke kan køre fra bunden.
En backup, ingen har genskabt fra, er ikke en backup.

**Automatisering.** Der er ingen oplagt måde uden at bygge infrastruktur.
Railway-workeren kunne køre det efter importen, men så skulle dumpet
lægges et sted, og det indeholder adgangskode-hashes — det ville flytte
problemet, ikke løse det. Det billigste rigtige skridt er ikke et script,
men Supabases Pro-plan: den giver daglige backups med en uges historik.
Indtil da er det manuelt, og listen ovenfor er hvornår.

**`backup/` er i `.gitignore` og skal blive der.** Filen indeholder
`auth.users` med adgangskode-hashes. Den må ikke committes, ikke lægges i
en delt mappe og ikke sendes i en mail.

Se README for hvad dumpet indeholder, hvordan det læses tilbage, og hvad
der skal til for også at sikre filerne i storage-bucket'en.

## Testbasen

`npm test` kører mod **PGlite** — rigtig PostgreSQL oversat til WASM, rejst i
processen af `scripts/testbase.ts`. Skemaet er de rigtige migrationer i
journalens rækkefølge, og Supabase-stubbene deles med `proev-genskab.mjs`
gennem `scripts/pglite-skema.mjs`. Kommandoen loader **ikke** `.env`: uden
`DATABASE_URL` i processen kan prøven ikke nå produktionen, uanset hvad koden
gør. Det er spærringen — ikke en aftale om at lade være.

Før dette skrev `npm test` i produktionsdatabasen: 3 brugere, 8 boliger, 55
billedrækker, alle `active` og dermed synlige på forsiden, mens prøven kørte.

`npm run test:prod` kører de fire prøver, der måler det rigtige udbud — byen
fra et postnummer, at et filter udelukker de ukendte, og de to om tavse
kilder. Den **skriver i produktionen**. Den skal skrives med vilje.

Kilderne sås ikke i testbasen. `sources` er et register, hvis sandhed ligger i
`KILDER` i `adapters/index.ts`; rækkerne materialiseres af `sikreKilde()`.
Migration 0013 sår `native`, fordi den er den eneste kilde uden adapter. Får
en prøve brug for det rigtige register, er svaret `sikreKilde()` over
`KILDER` — ikke ny SQL.

### RLS er ikke dækket. Noget andet er værre

**RLS på `storage.objects` er den eneste håndhævelse af mappegrænsen mellem
udlejere, og der findes ingen prøve for den nogen steder.**

`signerUpload` i `app/udlejer/handlinger.ts` udsteder den signerede upload-URL
med udlejerens **egen JWT** og den **offentlige** publishable-nøgle. Supabase
vurderer altså kaldet som hende, med rollen `authenticated`. Politikken i
`0014` — `with check ((storage.foldername(name))[1] = auth.uid()::text)` — er
derfor ikke et ekstra lag bag en serverside-kontrol. Den er det eneste, der
står i vejen, hvis nogen kalder Storage-API'et direkte med sin egen konto og
den offentlige nøgle. Og nøglen er offentlig ved design.

Testbasen kommer ikke til den: `auth.uid()` er en stub, der giver null,
`storage.objects` er en attrap med tre kolonner, og der er hverken
Storage-API eller JWT-vurdering. Politikkerne **oprettes** i testbasen og kan
melde sig grønne uden at håndhæve noget. Skriv derfor aldrig en RLS-prøve
mod PGlite: den ville måle, at politikken findes, ikke at den virker.

Den prøve, der mangler, er en integrationsprøve mod den rigtige Supabase med
to konti, hvor den ene forsøger at signere en upload til den andens mappe og
bliver afvist — og som bevises ved at politikken midlertidigt svækkes.

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

### Undersøgt 3. september 2026, ikke bygget

Syv kilder, undersøgt i én omgang med Balder som den ottende. Alle otte
svarede 200 på vores ærlige `BofindaBot`-User-Agent. **Ingen af dem har
LokalBoligs udtrykkelige AI-bot-forbud, og ingen har BoligPortals
skriftlige forbud mod crawling.** Alle elleve kilder har givet mundtlig
tilladelse pr. telefon — se `docs/kildetilladelser.md`.

Rangeret efter **boliger der kan nå fuld økonomi**, ikke efter volumen. En
kilde med 400 mørke boliger flytter ikke det tal, vi sælger på; den
fortynder det.

> **Rangeringen er overhalet af en beslutning, 5. september 2026.**
> home.dk, CEJ og Kereby er ikke længere fravalgt. Se afsnittet nedenfor om
> hvorfor. Adapterne er ikke bygget endnu, og de bygges én ad gangen.

**Jeudan — 4 boliger · fuld økonomi: JA**
robots.txt: tom `Disallow` — alt tilladt.
Teknisk den reneste efter Balder: **åbent JSON uden nøgle** på
`GET https://nova-api.jeudan.dk/api/leases/search?lease_type=bolig`,
CORS-åbent. Bemærk at dataene ligger på `nova-api.jeudan.dk`, ikke på
`www.jeudan.dk`.
Økonomi: "Leje pr. md. (ex. drift og forbrug)", "Aconto energibidrag",
"Aconto el" og undertiden "Aconto vand". **Aldrig "varme"** på nogen af de
fire sider vi åbnede. El er navngivet, så kriteriet rammes. Depositum står
som tekst ("Svarende til 3 måneders leje"), forudbetalt leje oplyses.
Fire boliger er lidt, men de er billige at hente.

**CityApartment — 4 boliger · fuld økonomi: JA**
robots.txt: `Disallow: /wp-admin/`. Vilkårssiden handler udelukkende om
LEJEvilkår; nul træffere på crawl, robot, scrap, automat, indsaml, mining.
**Advarsel om tallet:** siden viser 27 "ledige lejemål", men **kun 4 er
boliger**. Resten er erhverv, garager (1.375 kr./md.) og p-pladser
(625–1.875 kr./md.), som en boligportal skal filtrere fra. Sitemap og
REST-API rummer desuden udlejede lejemål (`x-wp-total: 56`). Det
geografiske filter kan ikke stoles på: den "københavnske" side viser også
en lejlighed i Odense.
Økonomi: varme som selvstændigt månedligt beløb, vand står som ordet
"Inkluderet" uden tal, el nævnes ikke. Depositum og forudbetalt = 3
måneders leje hver.
Teknisk: server-HTML. WP REST-API duer kun til discovery —
`content.rendered` er tom på alle boliger, og `acf` er en tom liste, så
økonomien skal hentes fra HTML'en. Felterne ligger i generiske
Elementor-widgets med hashede id'er og uden semantiske klasser; en adapter
skal ankre på etikettteksten ("Varme", "Depositum") og tage næste element.
**Det holder, men brækker den dag skabelonen redigeres.**

**home.dk — 229 boliger · kendt total, ukendt sammensætning · TAGET**
robots.txt: `Allow: /`.
Klart størst i volumen, og teknisk let: Nuxt 3 med hele datasættet i
`__NUXT__`-payloaden, server-renderet på både liste og detaljeside.
Sitemap findes, men kun via robots.txt — `/sitemap.xml` er en blød 404.
**Aconto er ét samlet tal.** Detaljesiden skriver "Leje pr. måned 20.200 kr." og "Aconto forbrug
pr. måned 1.100 kr." — intet om hvad de 1.100 dækker. Depositum og
forudbetalt leje oplyses som beløb.
Boligerne er ikke mørke — totalen er kendt, og den fjerde el-tilstand
siger ærligt, at sammensætningen ikke er det. Se beslutningen ovenfor.

**CEJ — 35 ledige af 60 · kendt total, ukendt sammensætning · TAGET**
robots.txt: **404** — der er ingen. En Next.js-fejlside, ikke en ren 404.
Ingen robots.txt betyder ingen begrænsning.
Teknisk pæn: Remix-app (white-label fra `bolig.io`), hele datasættet i
`window.__remixContext`. Ingen sitemap.
Data er komplette: pris, aconto, depositum og forudbetalt leje udfyldt på
**60 af 60**. **Men `onAccountMonthly` har præcis ét felt, `amount`.** Nul
forekomster af "water", "electricity" eller "utilities" som feltnavne i
hele payloaden. De 32 træffere på "heating" er alle
`heatSource: "districtHeating"` — altså varmekilden, ikke et beløb.
Fravalgt af samme grund som home.dk, med færre boliger til at opveje det.

**Kereby — 4 ledige af 18 · kendt total, ukendt sammensætning · TAGET**
robots.txt: `Disallow: /files/*`.
Teknisk: WordPress med en custom post type udstillet i WP REST API,
`/wp-json/wp/v2/jorato-cases` (`x-wp-total: 79`). Sitemap findes, men
indeholder **ikke** de enkelte lejemål — kun statiske sider.
Økonomi: "Leje 32.938 kr./md." og "Månedlig aconto 3.000 kr./md." — ét
samlet tal. Nul træffere på "varme" i hele detaljesidens HTML. Bag et
tooltip ligger indflytningsprisen pænt opdelt (første huslejebetaling,
forudbetalt leje, depositum, samlet), og depositum svarer til 3 måneders
leje, forudbetalt til 1.
Fravalgt: fire ledige boliger uden specificeret aconto er ikke arbejdet
værd. Bliver deres aconto en dag opdelt, ændrer regnestykket sig.

#### Taget alligevel: home.dk, CEJ og Kereby

Besluttet 5. september 2026. De tre stod som fravalgt, fordi deres aconto
er ét samlet tal. **Det var den forkerte grund.**

De tre kilder er **ikke mørke.** De har kendt total og ukendt
sammensætning — nøjagtig som de 254 boliger fra LokalBolig, Propstep og
Dacas, vi henter i forvejen. Og siden den fjerde el-tilstand kom til,
behandles den slags ærligt: kortet skriver *"Aconto er ét samlet beløb —
det fremgår ikke om el er med"* i stedet for at påstå, at el ikke er med.
Boligerne kan altså vises redeligt. 268 boliger med kendt total.

**Fravalget hvilede på et forsidetal, ikke på om boligerne kunne vises
redeligt.** Forsiden lovede "N med hele økonomien oplyst", målt med
`erFuldOekonomi`, og de tre kilder ville have trukket den andel ned fra
54 % til 44 %. Men tallet målte sammensætningen, ikke hvad brugeren får:
for 76 % af boligerne kan vi vise hele det beløb, der betales til
udlejeren, og det er dét, løftet handler om. Da forsidens tal skiftede til
kendt total, forsvandt indvendingen — og andelen STIGER med de tre kilder,
fra 75 % til 79 %.

Læren er værd at holde fast i: **et mål, der er sat op som et løfte, kan
komme til at styre beslutninger, det ikke var beregnet til.** `erFuldOekonomi`
er stadig rigtigt og måles stadig — det står nu ved sit eget filter, hvor
det hører hjemme, i stedet for på forsiden.

#### Fravalgt: samme beholdning set fra en anden side

To kilder ser ud som nye kilder og er det ikke. Begge viser en beholdning,
vi allerede henter — bare gennem et andet vindue. **Nul nye boliger hver.**

Det er en fejltype, der er værd at kunne genkende, næste gang en kilde
ligner et fund: et white-label-CRM eller en samarbejdspartner præsenterer
den samme bagvedliggende beholdning under sit eget domæne. Kendetegnene er
de samme begge steder — fremmede bolig-id'er i URL'en, billeder fra en
tredje vært, og et boligtal, der ligner nyt indtil man holder det op mod
det, man har.

**C.W. Obel — 0 nye · fravalgt**
robots.txt: navngivne bots får frit lejde; `User-agent: *` får
`Disallow: /portfolio-types/` og **`Disallow: */page/`** — altså er
pagineringen lukket for os.
**Men det er ligegyldigt, for kilden er reelt Jeudan.** Samme API
(`nova-api.jeudan.dk`), samme fire lejemål, alle med `city.area = "capitol"`
(København K). Ingen af dem ligger i Storkøbenhavn, som URL'en ellers
lover. Byg den ikke som selvstændig kilde — den ville give nul nye boliger
og fire dubletter.

**HomeConnector — 0 nye · fravalgt**
robots.txt: Yoast, tom `Disallow` — alt tilladt. Kilden er teknisk fin;
det er ikke derfor den er fravalgt.
**Den kører på Propstep.** Bolig-URL'erne ER Propsteps ejendoms-id'er
(24-cifret hex), og billederne serveres fra `app.propstep.com`.

Forskellen på de to sites er, hvad de VISER, ikke hvad de har:
**HomeConnector viser hele porteføljen inklusive udlejede boliger, som et
udstillingsvindue. Propsteps gitter viser kun boliger, der er på markedet.**
De 9 boliger, der findes hos HomeConnector men ikke i gitteret, står alle
som **"Udlejet"** hos HomeConnector selv — nul af dem er ledige. I
`__NEXT_DATA__` på Propsteps boligside har de `onMarketSince: null` og
`transactionStatus: 3`, hvor boliger i gitteret har en dato og status 1
eller 2.

Alle **13 ledige** hos HomeConnector har vi i forvejen, alle `[active]`.
Ledige boliger vi ikke har: **0**.

*Hvordan fejlen opstod.* Kilden blev første gang vurderet til "~10 nye
boliger" på, at Propstep-URL'erne for de manglende id'er svarede **200**.
Det er ikke et svar på det spørgsmål, der blev stillet: **en 200 betyder,
at siden findes, ikke at boligen kan lejes.** Statussen blev aldrig
aflæst. Det rigtige tjek var at hente HELE gitteret (33 sider) og at læse
kildens egen statusmarkering — ikke at slå enkelte id'er op og se, at de
svarer.

Skal HomeConnectors næste ledige boliger med, kommer de af sig selv
gennem Propstep, den dag de sættes på markedet.

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
inden for minutter, drevet af `first_seen_at`) og **hele udgiften til
udlejeren** — husleje plus aconto, plus indflytningsprisen. Ikke bare
huslejen.

Bemærk formuleringen: **hele udgiften til udlejeren**, ikke "hele
økonomien". Vi kender totalen for tre fjerdedele af boligerne, men
sammensætningen — om acontoen er delt op i varme, vand og el — kun for
godt halvdelen. Forsiden lover det første. Det andet måles stadig af
`erFuldOekonomi` og står ved sit eget filter.

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
