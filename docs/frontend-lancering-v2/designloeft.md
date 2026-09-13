# Designløftet mod de tre mockups

Gennemført 13. september 2026 på `feature/frontend-lancering-v2`.
Udgangspunkt: HEAD `9a06f68`, uændret ved påbegyndelsen.

Referencerne i designpakken blev åbnet visuelt før implementeringen —
alle tre kunne læses: `reference/forside.png`, `reference/soegeresultater.png`
og `reference/boligdetalje.png`.

**Hvad der er efterprøvet, og hvad der ikke er.** Alt nedenfor er målt i
det isolerede Cloud-testmiljø (loopback-base, 264 syntetiske boliger,
lokale testfliser og ét stockfoto). Det er LAYOUT med syntetiske data.
Der er ikke kørt mod produktionsdata, produktionshemmeligheder eller
betalt infrastruktur, og intet er deployet.

---

## Hvad hver reference bidrog med

**`forside.png`** → helskærms hero med foto, øjenbryn over en todelt
overskrift, den brede hvide søgebjælke som et kort, der flyder ned over
billedets underkant, en talstribe med ikoner, en række infokort med
ikonflise og et mørkegrønt udlejerbånd.

**`soegeresultater.png`** → brødkrumme, stor sidetitel med
resultatunderrubrik, filterbjælken og de aktive filterchips som ÉT felt,
«N boliger fundet» til venstre med sortering til højre, og et gitter med
tre billedkort pr. række med kortspalten ved siden af.

**`boligdetalje.png`** → galleri og prispanel ved siden af hinanden fra
toppen, titel og nøgletalsstribe under galleriet i samme spalte, og en
fanerække over indholdsafsnittene.

---

## Hvad der IKKE er overført

Mockuppens browserramme, baggrund uden for siden og telefonillustrationer
er præsentation og er ikke bygget.

Disse elementer i mockuppen er produktpåstande, vi ikke kan dække, og de
er derfor udeladt — ikke glemt:

| I mockuppen | Hvorfor den ikke er med |
|---|---|
| «12.500+ boliger», «98 byer», «94 % får svar inden for 24 timer», «Tusindvis har fundet hjem» | Tre af de fire er opdigtede, og de sidste to er påstande, produktet ikke kan måle. Talstriben viser i stedet fire REGNEDE tal fra `forsidetal()`. |
| Presselogoer (DR, Børsen, TechSavvy, Boliga, Finans) | Vi er ikke omtalt de steder. |
| Citatet fra «Mikkel R., udlejer i Aarhus» med fem stjerner | Opdigtet anmeldelse fra en navngiven person. |
| «Verificeret»-mærkat på hvert kort, «Verificeret af BOFINDA», CVR- og identitetstjek | Der findes ingen verificering. |
| «94 % match», «Hurtig svartid», «Sikker ansøgning» | Ingen af delene måles. |
| «AI-assistenten hjælper dig», «Optimér min ansøgning» | Modulet findes ikke. |
| «Ansøg nu», «Book fremvisning», «Stil spørgsmål» | Der er hverken ansøgning, booking eller beskedsystem. Den rigtige handling er «Se annoncen hos {kilde}» eller udlejerens egne kontaktoplysninger. |
| Hjerte/«Gem bolig», «Del bolig», «Se udlejers andre boliger» | Favoritter og udlejerprofiler hører til det senere arbejde med Min side. |
| «Priser» og «Inbox» i topmenuen | Siderne findes ikke på denne gren. |
| Fanerne «Lejeboliger / Værelser / Kort» over søgebjælken | Der er kun én søgetilstand. |
| «Transport og afstande», «I nærheden», gåtider | Vi har ingen data om det. |

**Integrationspunkter noteret til favoritter/Min side** (ingen ny
integration foretaget): kortets `.kort-maerkater` og `.kort-fod` er de to
steder, et hjerte naturligt ville lande; boligsidens `.detalje-sti` har
plads i højre side til «Del/Gem»; og `.oekonomi`-panelet er det sted, en
«Gem bolig»-knap ville høre hjemme under den primære handling.

---

## Konkrete ændringer

### Rammen om alle sider

`.ramme` er nu et trespaltet gitter — luft · indhold · luft — så hero'en
kan nå skærmkanten med `grid-column: fuld-start / fuld-slut` uden
`100vw`. `100vw` tæller rullebjælken med og ville give vandret rul.

**Rettet undervejs:** korthånden `grid-column: ind` slår `ind-start` og
`ind-end` op, men slutlinjen hed `ind-slut`. Uden en `ind-end` faldt
slutningen tilbage på en implicit linje yderst i gitteret, så hvert
eneste barn spændte hen over højre luftspalte. Målt: 22 px luft til
venstre og **0 til højre** på 390 px, og 70 px mod **0** på 1440 px. Det
lignede en centrering og var det ikke. Begge linjenavne skrives nu ud.

Efter rettelsen, målt på `/?sted=Attrapby`:

| Bredde | Venstre | Højre | Vandret overløb |
|---|---|---|---|
| 1440 px | 70 px | 70 px | 0 |
| 1280 px | 22 px | 22 px | 0 |
| 1100 px | 22 px | 22 px | 0 |
| 768 px | 22 px | 22 px | 0 |
| 390 px | 22 px | 22 px | 0 |
| 360 px | 22 px | 22 px | 0 |

Hero'en dækker `0..1440` af 1440 px og `0..390` af 390 px.

### Forside

- Brandbjælken: BOFINDA i versaler som ordmærke, navigation med kun de
  destinationer, der findes, og en mørkegrøn pilleknap til højre.
- Hero med foto, øjenbryn, todelt overskrift, manchet og den hvide
  søgebjælke som et kort, der rækker ned over hero'ens underkant.
- Søgebjælken: fire eksisterende filtre som felter med ikon, etiket over
  værdi og lodrette skillelinjer, og en grøn søgeknap yderst. Felterne er
  **flyttet** ud af filterpanelet, ikke kopieret: to felter med samme
  `name` ville sende værdien to gange, og `filtreFraParametre` læser den
  første — panelets tomme felt ville slette bjælkens værdi.
- «Populære søgninger» bygges af `facetter().byer`, ikke af en liste i
  koden.
- Talstriben: fire tal med ikon, alle regnet.
- Fire infokort med ikonflise + det mørkegrønne udlejerbånd.

### Søgeresultater

- Brødkrumme og stor sidetitel over filterbjælken.
- Filterbjælken og de aktive chips er ét felt, som i referencen.
- «N boliger fundet» til venstre; sortering og «Vis/Skjul kort» til højre
  på samme linje.
- Kortgitteret er `repeat(auto-fill, minmax(286px, 1fr))` i en
  `container-type: inline-size`. Med kortspalten ved siden af giver det
  tre kort pr. række på 1440 px og to på 1100 px — altså færre kolonner,
  før teksten klemmes, som opgaven beder om.
- Boligkortet: foto øverst, status som mærkat PÅ fotoet, adresse, sted,
  **pris**, derefter nøgletalschips og en fod med kilden. Prisen er
  flyttet op over chipsene, som i referencen.
- Pagination, sidetal, Forrige/Næste, 48-kortsgrænsen og forskellen
  mellem antal boliger og antal kort er uændrede.

### Boligdetalje og grupper

- `.spalter` er nu et gitter med navngivne felter: `visning` (galleri +
  titel + nøgletal) og `afsnit` i venstre spalte, `oekonomi` klæbende i
  højre — galleri og prispanel ved siden af hinanden fra toppen.
- Navngivne felter og ikke `order`, fordi rækkefølgen på en telefon skal
  være **billeder → titel → pris → afsnit**. Med ét indholdsfelt kunne
  prispanelet kun ligge enten før billederne eller efter hele teksten.
- Brødkrumme i stedet for «← Alle boliger».
- Afsnitsnavigation som referencens fanerække. Listen bygges af `afsnit`,
  som udledes af de SAMME betingelser, afsnittene selv står på — et anker,
  der ikke rammer noget, ville være en påstand om indhold, vi ikke har.
- Gruppesiden og områdesiderne bruger nu samme brødkrumme og sidetitel.
  Deres data, tal og navigation er uændrede.

### Mobil

- Søgebjælken stabler i én kolonne, og inputtene er 16 px, så iOS ikke
  zoomer ved fokus.
  **Rettet undervejs:** `form.filtre.soegt .soegebar` (tre klasser)
  stod uden medieforespørgsel og vandt over stablingen i
  `@media (max-width: 520px)`. Resultatet var, at resultatsidens bjælke
  **aldrig** stablede: på 390 px stod pris, størrelse og værelser stadig
  ved siden af hinanden, og «Værelser» lå ude over skærmkanten. Reglen
  ligger nu i `@media (min-width: 901px)`.
- Boligdetaljen stabler i den rækkefølge, der er beskrevet ovenfor.
  Målt på 390 px: den primære handling ligger 429–482 px nede og dækkes
  ikke af den klæbende bjælke.
- Ingen vandret rulning nogen steder — 0 px overløb på alle 15 målte
  visninger.

---

## Rettet efter den uafhængige gennemgang

Tre punkter fra gennemgangen af `4a1d2af`. Designretningen og
opbygningen er uændret.

### 1 · Søgeknappen på mobile søgeresultater

`form.filtre.soegt .soegeknap { padding: 0 24px }` — tre klasser og et
element — stod uden medieforespørgsel og slog mobilens
`padding: 14px 24px` i `@media (max-width: 900px)`. Knappen mistede al
lodret polstring på resultatsiden, mens forsidens knap, der ikke er
`.soegt`, var rigtig.

**Det er tredje gang samme fælde rammer den samme bjælke** — først
kolonnerne, nu knappen. To rigtige regler om det samme, hvor den ene
aldrig fyrer.

Rettet to steder: nedskaleringen er flyttet ind i `@media (min-width: 901px)`,
hvor den gælder, og `.soegeknap` har fået `min-height: 48px` i
mobilblokken som gulv under berøringsmålet — polstring alene afhænger af
skriftstørrelsen og af, at ingen anden regel når at overskrive den, og
netop dét skete.

Målt på begge sider og tre bredder, samme build før og efter:

| Bredde | Side | Før | Efter |
|---|---|---|---|
| 390 px | forside | 48 px | 48 px |
| 390 px | **søgeresultater** | **19 px** | **48 px** |
| 768 px | forside | 48 px | 48 px |
| 768 px | **søgeresultater** | **19 px** | **48 px** |
| 1440 px | forside | 63 px | 63 px |
| 1440 px | søgeresultater | 58 px | 58 px |

«Før» er målt på `app/globals.css` udtjekket fra `4a1d2af` og bygget på
ny — ikke skønnet ud fra reglerne.

Målingen er lagt ind i `scripts/cloud/lancering.mjs` som seks faste
kontroller. Den kører på 390, 768 **og** 1440 px og på **begge** sider,
fordi fejlen netop var, at kun den ene side var gal, og fordi 768 px er
den bredde, hvor mobilreglerne stadig gælder, men ingen så efter.

### 2 · Tilbage-navigationen på boligsiden

Linket hed «Tilbage til søgeresultater», men pegede på `/` uden
parametre — altså ikke den søgning, brugeren kom fra: filtre, sortering
og sidetal var væk. Det hedder nu **«Forside»**, som er hvad linket gør.

Bylinket ved siden af er uændret og peger fortsat på `/?sted={by}` —
samme parameter som filterbjælken bruger, så dét link rammer nøjagtig
den søgning, navnet lover.

Et link, der lover at føre tilbage og i stedet nulstiller søgningen, er
samme slags usandhed som en total, der lader som om aconto er kendt:
den opdages først, når nogen har brugt den.

### 3 · Hero-fotoet — stadig udestående

Se afsnittet nedenfor. Fotoet kunne **ikke** skaffes i dette miljø.

---

## Det manglende billedaktiv

**Der findes ikke et lyst interiørfoto til hero'en.** Referencens hero er
et lyst, møbleret opholdsrum. Det eneste fotografi, der er tilgængeligt i
dette miljø, er `dk-vesterhavet-sommerhus.jpg` — et **udendørs** motiv af
et sommerhus i gråt lys. Det er brugt i skærmbillederne herunder, og det
er mærket på siden med linjen *«Stockfoto til layouttest — ikke en
virkelig boligannonce.»*

Layoutet omkring det er færdigt; **fladen er det ikke.** Det konkrete,
manglende aktiv er:

> Ét liggende fotografi af et **lyst, møbleret dansk opholdsrum**, mindst
> 2400 px bredt, med dokumenteret licens og ophavsmand, og med plads i
> venstre halvdel til overskrift og manchet.

### Forsøgt skaffet — miljøet tillader det ikke

Gennemgangen bad om at finde et lyst interiørfoto med dokumenteret
brugsret. **Det kan ikke lade sig gøre herfra.** Ét opslag mod fem
oplagte værter — Wikimedia Commons og `upload.wikimedia.org` (CC/CC0 med
navngiven ophavsmand), Unsplash, Pexels og Openverse — svarede alle:

    curl: (56) CONNECT tunnel failed, response 403

Det er miljøets egen netværkspolitik, ikke en fejl hos værterne. Der er
**ikke** forsøgt igen og ikke forsøgt uden om: hverken proxy, anden rute
eller genereret erstatning. Et genereret billede ville i øvrigt ikke
løse opgaven — det har ingen ophavsmand at kreditere, og siden ville
påstå et hjem, der ikke findes.

### To veje ind, når fotoet foreligger

**A · Statisk i repoet** (det gennemgangen foreslår, så billedet følger
koden). Læg filen i en ny `public/`-mappe — projektet har ikke en i dag —
og sæt `NEXT_PUBLIC_HERO_FOTO=/hero-stue.jpg`. Kreditering og licens
skrives ind i `NEXT_PUBLIC_HERO_FOTO_KREDIT` og i
`docs/kildetilladelser.md`, som allerede er stedet, hvor rettigheder
noteres pr. kilde.

**B · Ekstern vært.** Samme to variabler, blot med en fuld URL. Vær
opmærksom på, at værten IKKE skal i `TILLADTE_VAERTER` i
`lib/billede.ts`: hero'en går uden om billedproxyen, fordi den ikke er
et boligbillede fra en kilde.

Ingen kodeændring er nødvendig for nogen af de to veje. Der er bevidst
**ikke** bygget maskineri til en fil, der ikke findes: en
eksistenskontrol mod en tom `public/`-mappe ville være plumbing uden et
aktiv, og en hardkodet sti til en manglende fil ville give et 404 i
hero'en.

Fotoet er ikke lagt i repoet i dag. Det peges på med
`NEXT_PUBLIC_HERO_FOTO`, og krediteringen med
`NEXT_PUBLIC_HERO_FOTO_KREDIT` — samme mønster som kortflisernes
`NEXT_PUBLIC_FLISE_URL`/`_KREDIT`. Er variablen ikke sat, står hero'en
med brandets gradient; layoutet er det samme, kun fladen skifter.
**Variablerne er valgfri og er ikke sat noget sted uden for
testmiljøet.**

---

## Resterende afvigelser fra mockupsene

Ud over det manglende hero-foto og de udeladte produktpåstande ovenfor:

1. **Søgebjælken har fire felter, ikke fem.** Referencen viser også
   «Husdyr tilladt». Det filter og «Indflytning» bliver i panelet, fordi
   begge bærer en grundlagslinje («N oplyser det · M oplyser ikke · K
   vises ikke»). Et felt uden sin linje ville ligne et almindeligt filter
   og i stedet skjule hele kilder uden at sige det.
2. **Sorteringen er seks pilleknapper, ikke en `<select>`.** En select
   uden JS skifter ingenting, og en submit-knap mere ville være en
   kontrol, der ligner filtrene uden at være dem.
3. **Ingen «Viser 1–6 af N boliger» ved pagineringen.** Vi har allerede
   en linje om udsnittet, og den taler om KORT, ikke boliger. To linjer,
   der tæller to forskellige ting med næsten samme ord, ville være værre
   end én.
4. **Højre spalte på boligsiden holder kun prispanelet.** Referencens to
   øvrige paneler (AI-assistent, udlejerprofil med anmeldelser) er
   funktioner, der ikke findes. Panelet klæber, så spalten ikke står tom
   under rulning.
5. **Udlejerbåndet har ingen bygningsfoto i højre side.** Samme grund som
   hero'en: aktivet findes ikke.
6. **Infokortene har kun «Læs mere →», hvor der er noget at gå til.**
   Referencen har linket på alle fire.
7. **Boligkortene har ingen rund pileknap nede i fotoets hjørne.** Hele
   kortet er ét link; en knap ved siden af ville se ud som en anden
   handling.
8. **Første boligkort på forsiden ligger 2.842 px nede på 390 px**
   (1.636 px på 1440 px). Det er en følge af mockuppens opbygning —
   hero, talstribe, infokort og udlejerbånd før listen. Søgningen selv
   ligger i første skærmbillede.

---

## Kontroller

Alle kørt mod det isolerede testmiljø efter den sidste ændring.

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` | ingen fejl |
| `npm test` (PGlite, uden `DATABASE_URL`) | ALT GRØNT |
| `npx next build` | Compiled successfully · 18 ruter |
| `scripts/cloud/kontrol.sh` | ALT GRØNT — kort, billeder dekodet, gruppekort, samtykke og analytics |
| `scripts/cloud/kontrol-pagination.sh` | ALT GRØNT — sideudsnit, canonical, tomt udsnit ≠ nulresultat |
| `scripts/cloud/lancering.mjs` | alt grønt · 88 kontroller — 1440, 768 og 390 px, fokus, kontrast, lang adresse, kort uden foto, søgeknappens højde |

`scripts/cloud/lancering.mjs` er rettet to steder og udvidet ét, fordi
designet flyttede det, den målte:

- `.storsoeg input` hedder nu `.soegebar input`
- resultatsidens bevidste feltstørrelse er 14,5 px i stedet for 15 px
- **nyt:** seks kontroller af søgeknappens højde — begge sider, tre
  bredder. Se «Rettet efter den uafhængige gennemgang» ovenfor.

Kontrollernes hensigt er uændret. Ingen funktionel kontrol er ændret.

**Ikke kørt:** `npm run test:prod` (skriver i produktionen) og enhver
import eller scheduler.

### Hvad der er målt hvornår

Alle seks kontroller i tabellen er kørt **efter** rettelserne fra
gennemgangen, mod samme build som skærmbillederne. Før/efter-tallene for
søgeknappen er begge målt i denne omgang: «før» ved at tjekke
`app/globals.css` ud fra `4a1d2af` og bygge på ny.

Rammegeometrien er efterprøvet igen efter rettelserne og er uændret —
symmetriske gutters og 0 px vandret overløb på 1440, 1280, 1100, 768,
390 og 360 px.

**Fotoafprøvning er noget andet end layoutafprøvning.** Alt ovenfor er
målt på **syntetiske** data: 264 prøveboliger, stribede testaktiver i
stedet for boligfotos, lokale kortfliser. Den eneste flade med et
rigtigt fotografi er hero'en, og det er et stockfoto af et udendørs
motiv, mærket som sådan på siden. Den egentlige fotokontrol — beskæring,
billedforhold, liggende motiv i kort, galleri og lysbord — er
dokumenteret særskilt i `fotokontrol.md` og blev kørt mod kandidat
`fa522eb` (13. september, resultatet skrevet ned i `9a06f68`). Den er
**ikke** gentaget i denne omgang: rettelserne rører hverken
billedproxyen, galleriet eller lysbordet.

---

## Skærmbillederne

I `designloeft/`. `-hele` er hele siden; uden endelse er første
skærmbillede.

| Fil | Bredde |
|---|---|
| `forside-{desktop,mellem,tablet,mobil}.png` | 1440 · 1100 · 768 · 390 |
| `soegeresultater-{desktop,mellem,tablet,mobil}.png` | med tre aktive filtre og sortering |
| `boligdetalje-{desktop,mobil}.png` | bolig med flest billeder |
| `boligdetalje-ukendt-udgift-{desktop,mobil}.png` | ukendt total |
| `boligdetalje-uden-foto-{desktop,mobil}.png` | ingen billeder |
| `gruppeside-{desktop,mellem,tablet,mobil}.png` | gruppeannonce |

Alle er taget af **produktionsbygget**, ikke af `next dev`, og samtykket
er afvist med den rigtige knap — aldrig skjult med CSS.

**Dataene er syntetiske.** De stribede flader på kortene er testaktiver,
ikke boligfotos. Kun hero'en bruger et rigtigt fotografi, og det er
mærket som stockfoto på siden.
