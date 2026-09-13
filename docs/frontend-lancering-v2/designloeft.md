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

Fotoet er ikke lagt i repoet. Det peges på med `NEXT_PUBLIC_HERO_FOTO`,
og krediteringen med `NEXT_PUBLIC_HERO_FOTO_KREDIT` — samme mønster som
kortflisernes `NEXT_PUBLIC_FLISE_URL`/`_KREDIT`, og af samme grund: et
billedaktiv har en licens og en ophavsmand, og begge dele hører dårligt
hjemme i git. Er variablen ikke sat, står hero'en med brandets gradient;
layoutet er det samme, kun fladen skifter. **Variablerne er valgfri og
er ikke sat noget sted uden for testmiljøet.**

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
| `scripts/cloud/lancering.mjs` | alt grønt — 1440 og 390 px, fokus, kontrast, lang adresse, kort uden foto |

`scripts/cloud/lancering.mjs` er rettet to steder, fordi designet flyttede
det, den målte: `.storsoeg input` hedder nu `.soegebar input`, og
resultatsidens bevidste feltstørrelse er 14,5 px i stedet for 15 px.
Kontrollernes hensigt er uændret. Ingen funktionel kontrol er ændret.

**Ikke kørt:** `npm run test:prod` (skriver i produktionen) og enhver
import eller scheduler.

---

## Skærmbillederne

I `designloeft/`. `-hele` er hele siden; uden endelse er første
skærmbillede.

| Fil | Bredde |
|---|---|
| `forside-{desktop,mellem,mobil}.png` | 1440 · 1100 · 390 |
| `soegeresultater-{desktop,mellem,mobil}.png` | med tre aktive filtre og sortering |
| `boligdetalje-{desktop,mobil}.png` | bolig med flest billeder |
| `boligdetalje-ukendt-udgift-{desktop,mobil}.png` | ukendt total |
| `boligdetalje-uden-foto-{desktop,mobil}.png` | ingen billeder |
| `gruppeside-{desktop,mellem,mobil}.png` | gruppeannonce |

Alle er taget af **produktionsbygget**, ikke af `next dev`, og samtykket
er afvist med den rigtige knap — aldrig skjult med CSS.

**Dataene er syntetiske.** De stribede flader på kortene er testaktiver,
ikke boligfotos. Kun hero'en bruger et rigtigt fotografi, og det er
mærket som stockfoto på siden.
