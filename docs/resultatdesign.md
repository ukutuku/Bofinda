# Søgeresultater og filtre — samlet designretning

September 2026. Skærmbilleder i `docs/resultatdesign/`, kontrollogge i
`docs/resultatdesign/kontrol/`.

Alt målt i det isolerede testmiljø på loopback (`scripts/cloud/*`) på det
byggede output, ikke i dev-serveren. Før- og efterbillederne er taget på
**samme data og samme bredde**: testdataene blev udvidet med koordinater
først, og «før» blev bygget fra den uændrede app-kode mod netop det
datasæt.

> **Referencen kom sent.** De første to gange nåede skærmbillederne ikke
> frem — ingen nye filer i uploads, ingen billedblok i beskeden — så
> første udgave blev lavet efter den skrevne specifikation alene.
> `BoligPortal_designreference.zip` (fire skærmbilleder) kom undervejs,
> og opbygningen er derefter rettet til efter den. Hvad der blev ændret
> af referencen, står i afsnit 5.

> **Referencebillederne er ikke lagt i repoet.** De er skærmbilleder af
> en konkurrents brugerflade, og de hører ikke til i vores historik. De
> ligger hos ejeren sammen med opgaven.

> **Hvad vi IKKE kopierer.** «Fremhævet»-mærkatet er en betalt placering,
> vi ikke har et produkt til. Billedprikkerne på fotoet er et karrusel-
> element uden funktion hos os. Prisdiagrammet og «Vis 119 resultater»
> kræver et tal, der er regnet af den samme søgning som listen — se
> afsnit 3. Filtrene for møblering, ladestander, seniorvenlig og
> minimums lejeperiode har vi hverken data eller søgelogik til.

---

## 1 · Boligkortet

| | Før | Efter |
|---|---|---|
| Overskrift | adressen | `Hus · 3 vær. · 77 m²` |
| Adresse og by | to linjer, den ene med et nåle-ikon | **én linje** |
| Nøgletal | tre chips i egen række | i overskriften |
| Overtagelse | en fjerde chip | metalinje |
| Mærkater på fotoet | op til fire | ét |
| Skillelinjer | én | én |

**Overskriften er, hvad boligen ER.** Adressen var overskriften, og de
tre tal stod som chips under den. Det er den forkerte vej rundt: et sted
afgør først noget, når størrelsen passer.

**`vær.` og ikke `værelser`.** Er boligtypen selv `vaerelse`, står der
ellers «Værelse · 5 værelser» — det samme ord om to forskellige ting i
den samme linje. På gruppekortet er det værre: «4 værelser · 5 værelser».
Forkortelsen er den, danske boligannoncer bruger, og den kan ikke
forveksles med typen.

**Fra fire mærkater til ét.** «ny», «venteliste», «reserveret» og
«bopælspligt» lå alle fire oven på fotoet. Fire farvede piller over et
billede er ikke et hierarki. Kun «ny» bliver; den er tidsbestemt og
gælder få kort ad gangen, så den betyder noget, netop fordi den er
sjælden.

**De tre andre BLIVER** — som ord i metalinjen. Det er ikke en nedtoning,
det er en flytning: at skjule «reserveret» for at få færre mærkater ville
være projektets egen ærlighedsregel vendt på hovedet. En bolig, der ser
ledig ud og ikke er det, er samme fejl som en total, der lader som om
aconto er kendt.

**Gruppekortet beskriver gruppen.** `5 rækkehuse · 3 vær. hver ·
45–101 m²` — antallet foran, så kortet ikke kan læses som én bolig, og
arealet som et spænd. «hver» er ikke pynt: er gruppens type `vaerelse`,
står der ellers «5 værelser · 3 vær.» — fem udlejede værelser med tre rum
i hvert, og forkortelsen alene bærer ikke forskellen. Værelsestallet ER
en nøgledel i grupperingen, så alle medlemmer har det samme. Prisspændet, `matchende`-linjen, blandet ansøgningsform og
delvis reservation er uændrede.

**Uændret og efterprøvet:** husleje mod kendt betaling til udlejer (grøn
total mod sort husleje), «Udlejer oplyser ikke aconto», de fire
el-tilstande, billedforbeholdet, gruppens spænd over 25 %, den kompakte
variant uden foto, kortet som ét klikmål. Ingen favoritknapper, ingen
billedpile.

### Ét navn pr. boligtype

`TYPENAVN` i `app/page.tsx` og `TYPEORD` i `app/Boligkort.tsx` var to
lister over det samme, og de var uenige: `andet` hed «Anden bolig» i
filteret og «andet» på kortet, og `villa` og `studiebolig` fandtes kun i
den ene hver. Begge er nu afledt af `lib/boligtype.ts`.

---

## 2 · Resultatsiden

**Søgelinjen** er område, «Filter og sortering», kortvalg og søg. Pris,
størrelse og værelser stod i bjælken og står nu i vinduet.

| Bredde | Søgelinjen før | Efter |
|---|---|---|
| 390 | 243 px høj | **178 px** |
| 768 | 236 px høj | **68 px** |
| 1100 | 58 px | 68 px |
| 1440 | 58 px | 68 px |

**Området blev ét felt.** `stedet()` i `lib/soeg.ts` lader `sted` vinde
over `by` og `postnr`, så panelet havde allerede to felter, hvor det ene
tabte tavst: skrev man «Aarhus» i bjælken og «2300» i panelet, blev
postnummeret kasseret uden et ord. `by` og `postnr` er væk fra vinduet;
gamle adresser med dem foldes ind i feltets værdi og virker uændret.

**Landkortet fik brugbar bredde.** Spalten var 348 px fast — et
miniature ved siden af en liste på 900. Nu en andel med et gulv:

Referencen deler bredden 50/50 mellem liste og kort. Vi tager 42 % og
lægger et gulv under listen — `minmax(680px, 1fr)`, altså to kort à
330 px plus gitterets mellemrum. Bliver der ikke plads til begge dele,
giver KORTET sig; det er listen, der er produktet.

| Bredde | Kort før | Kort efter | Liste efter |
|---|---|---|---|
| 1100 | 348 px | 352 px | 2 × 330 px |
| 1440 | 348 px | **546 px** | 2 × 355 px |

**På mobil er kort og liste et SKIFT**, ikke en stabel. De lå under
hinanden: hele listen, og så kortet nederst, hvor ingen kom hen.
Kortvalget i søgelinjen skifter mellem dem. Listen skjules, ikke fjernes
— landkortet lytter på `.liste` for at fremhæve det kort, et mærke peger
på.

**Uden koordinater vises listen, og der står hvorfor.** Kilderne
navngives af `udenPlacering` og skrives ikke ind: begynder en kilde at
oplyse placering, retter linjen sig selv.

> **Testdataene havde nul koordinater — 0 af 264.** Kortet har altså
> hele tiden været et tomt lærred på hver eneste søgning, uden at nogen
> kunne se det. Tre af de fire fiktive områder har nu koordinater;
> «Fiktivby» har bevidst ingen, så begge veje kan måles.

---

## 3 · Filtervinduet

Centreret dialog på desktop (640 px), fuldskærm under 620 px. Fast hoved
med lukknap, rullende midte, fast bund med «Ryd filtre» og «Vis
resultater». Afsnit: boligtype · pris · værelser · størrelse ·
overtagelse · faciliteter · øvrige valg.

**`<dialog>` og ikke en div.** Escape, fokusfælde og fokus tilbage til
knappen er browserens — skrevet i hånden er det tre ting, der kan gå galt
hver for sig, og fokusfælden er den, alle glemmer.

**En opgradering, ikke en afhængighed.** Uden JavaScript er `?flere=1`
stadig det, der åbner vinduet: serveren renderer `<dialog open>`, «Vis
resultater» indsender formularen, og «Luk» er et link tilbage til den
samme søgning. Efterprøvet med JavaScript slået fra.

**Kladden er gratis.** En GET-formular ændrer ingenting, før den
indsendes. Det eneste, vi selv gør, er at nulstille felterne ved lukning
— uden det ville en forladt kladde stå og se ud som den gældende søgning
næste gang.

**Ingen min./maks. hvor basen kun har min.** Prisen har to grænser og får
to felter. Værelser og størrelse har kun en nedre; værelser er
valgknapper (`Alle · 1+ · 2+ …`), størrelse ét felt med etiketten
«Mindst». To felter ville love et interval, søgningen ikke kan holde.

**Intet prisdiagram og intet dynamisk resultatantal.** De skulle regnes
af den samme søgning som listen, og det kan de ikke uden en ny
forespørgsel pr. tastetryk. Et tal, der er regnet på noget andet end
resultatet, er værre end intet tal.

**Alle filterforbehold er uændrede** — grundlagslinjerne under
faciliteter, overtagelse, venteliste, reserveret og «hele økonomien
oplyst» står ordret som før, med de samme tre grupper, der går op med
antallet.

### Vinduet står EFTER søgelinjen, ikke inde i den

Formularens standardknap — den, Enter i søgefeltet rammer — er den
**første** submit-knap i træet. Lå vinduet inde i bjælken, var det «Vis
resultater» inde i et lukket vindue: usynligt, og alligevel det, Enter
ramte. Det gjorde i praksis det samme, men paginationskontrollen, som
klikker «den første submit-knap», ventede tyve sekunder på et element,
der aldrig blev synligt, og kastede. Fundet af prøven, ikke af
gennemlæsningen.

### Én adresse pr. søgning

En GET-formular sender alle sine felter, også de tomme. Med filtrene
samlet i ét vindue er det syv felter, så «Vis resultater» gav

    /?sted=Aarhus&prisMin=&prisMax=&vaerelser=&areal=&overtagelse=&kilde=&sorter=nyeste

hvor der stod ét filter — og siden har hverken canonical eller noindex,
så alle varianterne er indekserbare. Tomme parametre og den
underforståede `sorter=nyeste` fjernes nu med en omdirigering, der står
før målingen, så en søgning ikke tælles to gange. Adressen er nu
`/?sted=Prøveby+N&prisMin=9000`.

---

## 4 · Hvad der faktisk er kørt

| Kontrol | Resultat |
|---|---|
| `scripts/cloud/filterkontrol.mjs` **(ny)** | 103 kontroller grønne |
| `scripts/cloud/kortkontrol.mjs` | 114 kontroller grønne |
| `npm test` | ALT GRØNT |
| `scripts/cloud/kontrol.sh` | ALT GRØNT |
| `scripts/cloud/kontrol-pagination.sh` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt |
| `npx tsc --noEmit` | rent |

**Dækket:** 390, 768, 1100 og 1440 px · med og uden landkort · forside,
resultatside, områdeside og gruppeside · åbent mobiltastatur (390 × 340
px) · lange tekster (39 tegn i vejnavnet) · nul resultater · ukendte
priser · grupper · boliger med og uden billeder · boliger med og uden
koordinater · uden JavaScript.

**Funktionelt efterprøvet i filterkontrollen:** at fokusprøven kan fejle
(afsnit 7) · ingen dobbelte feltnavne ·
vinduet åbner, lukker på Escape og på lukknappen · fokus står inde i
vinduet og kan ikke forlade det · fokus vender tilbage til knappen ·
lukning uden «Vis resultater» lader søgningen stå · den forladte kladde
er væk ved næste åbning · genindlæsning, tilbageknap, sortering og
gruppelink bevarer filtrene · ingen tomme parametre i adressen.

**Ikke kørt:** `npm run test:prod` (skriver i produktionen).

### Fejl i mine egne kontroller, fundet og rettet

1. **«fokus kan ikke forlade vinduet» var for stram.** Ét af 25
   tab-tryk gav `document.activeElement === BODY` — Chromiums eget
   ombrydningspunkt i en modal, ikke et element uden for vinduet. En
   prøve, der kalder det en fejl, lærer den næste at se bort fra en rød
   linje.
2. **«lange adresser» målte 18 tegn** og bestod på et krav om mindst 15.
   Det er ikke en prøve af lang tekst, det er en prøve af, at der står
   noget. En rigtig lang vej sættes nu ind i testbasen og skrives tilbage
   igen.
3. **Tre ældre kontroller kendte ikke skiftet mellem liste og kort.**
   `kortkontrol.mjs` målte «42 kolonner à 0 px» om en skjult liste;
   `browserkontrol.mjs` og `browserkontrol-pagination.mjs` kastede en
   `TimeoutError` på `scrollIntoViewIfNeeded()`. Alle tre er rettet: den
   skjulte liste har nu sine egne påstande i stedet for at blive målt som
   en synlig.

---

## 5 · Hvad referencen ændrede

Første udgave var bygget på specifikationen alene. Da skærmbillederne
kom, blev seks ting rettet til:

1. **Landkortet fra 32 % til 42 %.** Referencen deler 50/50; vores gulv
   under listen holder to kolonner. Kortet gik fra 416 til 546 px på
   1440.
2. **Adresse og by på én linje.** De stod på hver sin, og den ene bar et
   nåle-ikon — to linjer og et ikon om ét sted. Forbeholdene om adressen
   («uden etage/dør») og om billederne flyttede til metalinjen; de
   handler om, hvad vi VED, ikke om hvor boligen er.
3. **Antallet i overskriften.** Referencen skriver «Lejeboliger på
   Østerbro (116)» og lader det være. Vores stod tre steder: under
   titlen, i «N boliger fundet» og i tællelinjen. Nu ét.
4. **Vinduet fra 640 til 720 px**, og afsnitsoverskrifterne fra 13 til
   16 px. Referencens er store nok til at dele vinduet op; 13 px gjorde
   dem til fodnoter.
5. **«Min.» og «Max.» OVER felterne** med enheden inde i feltet og en
   tankestreg imellem, som i referencen. Vores etiket stod inde i
   feltet, og så sagde «Fra» og pladsholderen «Min» det samme to gange
   på den samme linje.
6. **De booleske filtre er piller**, ikke afkrydsningsfelter — samme
   knapsprog som boligtype. Grundlagslinjen står under hver pille;
   referencen har den ikke, men den er vores, og den er ikke til
   forhandling.

**Hvad vi beholdt imod referencen.** Værelser er valgknapper og ikke
Min./Max.-dropdowns, og størrelse har kun ét felt: basen har
`vaerelserMin` og `arealMin`, ikke øvre grænser. Et «Max.»-felt, der
ikke filtrerer, ville love et interval, søgningen ikke kan holde.

---

## 6 · Kortkontrollen gik fra 129 til 114 målinger

Tallet faldt, og et faldende kontroltal er præcis den slags, der skal
gøres rede for. Her er hele forskellen, målt ved at sammenligne
`docs/kortdesign/kortkontrol.log` (129, fra `8a8b04e`) med
`docs/resultatdesign/kontrol/kortkontrol.log`.

**Ingen egenskab er holdt op med at blive målt.** Faldet ligger i to af
de seksten viste flader: `390 px · med-kort` og `768 px · med-kort`.

Under 901 px er kort og liste nu et **skift**, ikke en stabel — og
testdataene har koordinater, så kortet ER valgt på de to flader. Listen
er skjult. De elleve listepåstande har dermed intet at måle: der er ingen
synlig liste at tælle kolonner i, ingen kort at måle billedrammen på.

Før målte de den alligevel, og svaret var vrøvl: «42 kolonner à 0 px» og
«4 strakte». Tre af dem stod røde af den grund.

| | 390 px · med-kort | 768 px · med-kort |
|---|---|---|
| Listepåstande før | 11 | 10 |
| Listepåstande nu | 0 | 0 |
| Kortvisningspåstande nu | 3 | 3 |
| **Netto** | **−8** | **−7** |

−15 i alt. 129 − 15 = 114.

### De tre nye påstande

Den skjulte liste er ikke en undtagelse, den er **den anden flade**, og
den har sine egne påstande — så ingen af de to kan slippe igennem umålt:

- **«listen skjules kun på smal skærm»** — falder gitteret sammen over
  901 px, er det en fejl.
- **«listen skjules kun, når kortet er valgt»** — skjules den i
  listevisningen, er der ingen resultater at se.
- **«kortet fylder bredden i stedet»** — er listen væk uden at kortet
  træder i stedet, står fladen tom.

Dertil **«intet vandret overløb»**, som måles i BEGGE grene og derfor
stadig dækker alle seksten flader.

### Hvor de elleve så måles

Hver eneste af dem måles stadig på **den samme bredde** i listevisningen,
plus i begge visninger på 1100 og 1440 px:

| Egenskab | Før | Nu |
|---|---|---|
| højst to kolonner | 390M 390U 768M 768U 1100M 1100U 1440M 1440U | 390U 768U 1100M 1100U 1440M 1440U |
| én kolonne på mobil | 390M 390U | 390U |
| intet barn bredere end sit kort | alle otte | seks — 390M og 768M ude |
| billedet fylder rammen præcist | alle otte | seks |
| object-fit: cover på alle billeder | alle otte | seks |
| alle billeder er hentet | alle otte | seks |
| kort uden foto strækkes ikke | alle otte | seks |
| ingen afkortning i økonomi og forbehold | alle otte | seks |
| kortet er ét klikmål | alle otte | seks |
| højst én skillelinje per kort | alle otte | seks |
| gruppelinket bærer filtrene videre | alle otte | seks |
| **intet vandret overløb** | alle otte | **alle otte** |

M = med landkort · U = uden landkort

**Ingen bredde har mistet dækning.** 390, 768, 1100 og 1440 px måles
stadig på hver af de elleve egenskaber.

De øvrige forskelle i loggen er tal INDE i etiketten, ikke andre
påstande: «(39 fotos)» blev til «(38 fotos)» og «(3 blandede rækker)» til
«(4 blandede rækker)», fordi testdataene fik koordinater og dermed en
anden fordeling. Samme målinger, andre tal.

---

## 7 · Kan fokusprøven overhovedet fejle?

En prøve, der altid består, ser ud som en kontrol og er det ikke.
Fokusfælden er browserens, ikke vores — så «fokus kan ikke forlade
vinduet» ville stå grøn, selv om vores egen detektor var i stykker.

`filterkontrol.mjs` har derfor en **negativ kontrol**. Den åbner det
samme vindue med `show()` i stedet for `showModal()`. Det er den eneste
forskel — samme markup, samme CSS, samme indhold — og et ikke-modalt
`<dialog>` har ingen fælde. Påstanden er vendt om: her SKAL der slippe
noget ud.

    ✓ vinduet er åbnet UDEN fælde — open=true modal=false
    ✓ uden fælde slipper fokus ud — detektoren ser det
        — 6 af 25, bl.a. A.sort-pille valgt, A.sort-pille
    ✓ og det er kontroller bag vinduet — A.sort-pille valgt, A.sort-pille

Seks af 25 tabulatortryk lander på sorteringspillerne, som ligger BAG
vinduet. Detektoren ser dem, og den skelner dem fra `<body>` —
Chromiums eget ombrydningspunkt, som ikke er en lækage.

Den grønne linje i den positive prøve er altså et udsagn om vinduet, ikke
om prøven.

---

## Filer

| Fil | Ændring |
|---|---|
| `app/Filterdialog.tsx` | Ny. `Filterknap` i bjælken, `Filterdialog` efter den |
| `app/page.tsx` | Kompakt søgelinje · filtrene i afsnit · ét områdefelt · ren adresse · kortvalget ét sted · forklaring uden koordinater |
| `app/Boligkort.tsx` | Overskrift · metalinje · ét mærkat · ingen chipræk |
| `lib/boligtype.ts` | Ny. Ét navn pr. boligtype |
| `app/globals.css` | Søgelinje · filterknap · kortvalg · dialog · kortoverskrift · bredere landkort · skift på mobil |
| `scripts/cloud/saa.mjs` | Koordinater på tre af fire områder |
| `scripts/cloud/filterkontrol.mjs` | Ny, 100 målinger |
| `scripts/cloud/kortkontrol.mjs`, `browserkontrol.mjs`, `browserkontrol-pagination.mjs` | Kender skiftet mellem liste og kort |
