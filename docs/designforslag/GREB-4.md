# Runde 4: B, krediteringen, meta-beskrivelsen og kommandoen i dokumentationen

1. oktober 2026. Runde 3 er godkendt ([GREB-3.md](GREB-3.md)). Her er de fire
ting fra runde 4 i den rækkefølge, de blev bedt om.

**Dataene er stadig syntetiske.** Værterne svarede 403 fra proxyen, senest
efterprøvet 1. oktober kl. 09.18 UTC (`propstep.com`, `app.propstep.com`,
`dacas.dk`, `www.balder.dk`, `api.balder.dk` og `images.ctfassets.net`), og
`BALDER_API_KEY` er ikke sat i miljøet. Alt herunder er layout uden
fotografi. Når værterne er åbne, tager to kommandoer det hele om
([Netværket](#netværket)).

`app/globals.css`, `app/Boligkort.tsx` og `app/page.tsx` er ikke rørt.

## 1 · B, målt på det, siden er til for

**Du har ret, og min regel målte det forkerte.** Runde 3's regel («B, hvis
fotoet kræver højst 0,45 slør») optimerede, hvor meget FOTO der overlever. Den
gav A, fordi A beholder 100 % af et foto, der ikke er værd at beholde, og
betalte med en annonce. Det nye mål er dit: **hvor stor en andel af det første
boligkort står over folden?** Det står nu ved siden af de andre tal, målt i
den kørende app med samme kode for alle fem tilstande
([`hero-maal.mjs`](gengivelse/hero-maal.mjs) › `foersteKort`).

- **Folden** er vindueshøjden i skærmbillederne: 844 px på 390 og
  780 på 360. Der måles ved indlæsning, før der rulles, **efter
  samtykke**: det er en tilbagevendende besøgende.
- **«Første besøg»** er samme måling uden samtykke. Samtykkebanneret står
  fast i bunden, og folden er dér, hvor det begynder (635 px på 390,
  553 på 360). Skærmbillederne `*-foerste-besoeg` viser det.
- **«Over folden»** er den synlige del af kortets højde. Kolonnerne efter
  siger, om hver del af kortet står **helt** over folden.
- **«Prisen kræver fold»** er den vindueshøjde, prisen skal bruge. Det er det
  tal, der kan holdes op mod en anden telefon: en browser med værktøjslinjer
  viser mindre end skærmens højde.
- **Første kort** er det samme i alle tilstande, fordi kørslen er ét
  øjebliksbillede af testbasen: «Rækkehus · 3 vær. · 76 m²».

| Bredde | Tilstand | Kortets top (px) | Kortets højde (px) | Over folden | Første besøg | Billede | Titel | Adresse | Overtagelse | Pris | Prisen kræver fold (px) | Fotoets tegning | Øjenbryn | Manchet |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 390 | I dag | 571 | 401 | **68 %** | 11 % | ja | ja | ja | **nej** | **nej** | 882 | 0,18 | 7,64 | 6,47 |
| 390 | Runde 2 | 622 | 461 | **48 %** | 2 % | ja | **nej** | **nej** | **nej** | **nej** | 942 | 0,14 | 6,87 | 14,40 |
| 390 | Runde 3 · B | 573 | 461 | **59 %** | 13 % | ja | ja | ja | **nej** | **nej** | 893 | 0,43 | 5,48 | 5,67 |
| 390 | A | 671 | 461 | **38 %** | 0 % | **nej** | **nej** | **nej** | **nej** | **nej** | 991 | 1,00 | 7,13 | 16,63 |
| 390 | **B** | 573 | 461 | **59 %** | 13 % | ja | ja | ja | **nej** | **nej** | 893 | 0,43 | 6,93 | 6,15 |
| 360 | I dag | 571 | 403 | **52 %** | 0 % | ja | **nej** | **nej** | **nej** | **nej** | 865 | 0,18 | 7,69 | 6,47 |
| 360 | Runde 2 | 645 | 444 | **30 %** | 0 % | **nej** | **nej** | **nej** | **nej** | **nej** | 949 | 0,14 | 6,87 | 14,36 |
| 360 | Runde 3 · B | 596 | 444 | **41 %** | 0 % | ja | **nej** | **nej** | **nej** | **nej** | 900 | 0,43 | 5,48 | 5,84 |
| 360 | A | 684 | 444 | **22 %** | 0 % | **nej** | **nej** | **nej** | **nej** | **nej** | 988 | 1,00 | 7,13 | 16,63 |
| 360 | **B** | 596 | 444 | **41 %** | 0 % | ja | **nej** | **nej** | **nej** | **nej** | 900 | 0,43 | 6,93 | 6,34 |

**På 390** står 59 % af kortet over folden i B
mod 38 % i A og 68 % i dag. Helt over folden står i B: billede, titel og adresse;
i A: ingen hel del. **På 360** er det 41 % mod 22 %; helt over folden står i B:
billede, i A: ingen hel del. Krediteringen under søgekortet koster
ingen fold: B's første kort står på 573 px, som runde 3's B (573).

**Ved første besøg dækker samtykkebanneret næsten alt.**

- **På 390:** 13 % af kortet er synligt i B, 0 % i A og 11 % i dag.
- **På 360:** 0 % i B og 0 % i dag.

Rækkefølgen mellem A og B er den samme. Men det første indtryk på en telefon
er i dag banneret og ikke en bolig, og det gælder alle tilstande.
Bannerets højde er ikke designforslagets at ændre; tallet står her, fordi
det er det, siden er til for.

**Mod i dag skal én ting siges.** B viser de samme hele dele som i dag
(billede, titel og adresse), og kortets top står næsten samme sted (571 mod
573 px). Alligevel er andelen lavere: 59 % mod 68 %. Grunden er ikke heroen, men
kortet. Laget gør det højere, 401 → 461 px, og en større del af et
højere kort står under folden. Billedet er lige højt (194 px i begge); forskellen ligger i kortets krop, 206 → 266 px: økonomilinjen går fra 69 til 118 px, og polstringen fra 12px 16px til 16px. Målt i synlige pixels er de ens
(273 mod 271). Skal B også slå i dag på andel, er det kortets højde, der skal
ned, ikke heroens. Det er et spørgsmål til næste runde, ikke et argument for A.

**Første kort er ikke det samme som på dine billeder fra i går.** Dengang var
det «Hus · 3 vær. · 77 m²» med «3 billeder» (greb3/efter-moerk/forside-390.png).
Testbasen blev sået igen, da containeren startede forfra i morges, og
«Nyeste» følger tiden. Nu er første kort «Rækkehus · 3 vær. · 76 m²» uden billedtæller. Tallene
er derfor for dette kort, i alle fem tilstande.

**Anbefalingen er vendt til B.** B er nu standarden i laget og kræver ingen
klasse (`greb.css` § 6). Står CSS'en i appen, er B der; der er ingen markup at
vente på. A er dokumenteret som klassen `.m-baand` og er rigtig, når
`maal-foto.mjs` siger «KUN A»: et foto, der kræver mere end 0,60 slør i B.

### Forbeholdet 5,48 er blevet et gulv

I runde 3 var øjenbrynet i B hvidt à .84, og manchetten à .94. Målt med
samme kode over et helt hvidt foto står runde 3's B kun øjenbryn
3,85:1 og manchet 4,37:1 på 390. Kontrasten hang altså på netop dette fotos
pixels, og derfor var 5,48 et tal, der skulle overvåges.

**Nu er teksten i B ren hvid**, samme greb som kreditpillen i `globals.css`
(«ren hvid og ikke .92»). Blæk over hvidt blander til 255 − 235·a, ved 0,60 til
114, og ren hvid tekst står da 4,7:1.

- **Målt over et helt hvidt foto:** al tekst i B står 4,69:1 i alle ni
  telefonbredder (320, 360, 375, 390, 414, 430, 600, 768 og 900). Det er over
  AA's 4,5, uden at kende fotoet.
- **Hvor det gælder:** kun for tekst i gradientens fulde tæthed (0–58 % af
  heroen). Manchettens bund står ved 39–45 % (målt i 320–900, med og uden
  fanerne).
- **Hvis det ændrer sig:** flytter en længere tekst ned i overgangen, falder
  tallet dér, og dommen siger hvorfor.

**Gulvet er ét tal, målt ét sted.** Det tyndeste slør, hvormed teksten holder
AA over det hvide foto, er **0,6** (`vaerstTaenkelige › gulv`). Slørreglen er
nu `max(gulvet, krævet + 0,05)`, højst loftet 0,60, og den står ens i
`heltefoto.json` og i `maal-foto.mjs`' anvisning. Den gamle regel, «krævet +
0,05», gav 0,55 med hvid tekst, og ved 0,55 er gulvet væk: under 4,5:1 over hvidt
(regnet af blandingen: 4,02:1; efterprøvningen målte 3,96:1 i siden). Efterprøvningen
fandt de to udtryk.

**Det nuværende foto i B**, målt i alle ni bredder:

- øjenbryn 6,26–7,27:1 (runde 3: 5,48 på 390);
- h1 5,90–7,15:1;
- manchet 6,15–6,74:1.

Fotoet kræver selv 0,45–0,50 slør; objektet har 0,60, gulvet.

**Målemetoden er præciseret**, ikke skærpet: kontrasten måles nu linje for
linje (afsnit 2). Det udelader pixels mellem og ved siden af linjerne og kan
kun give samme eller højere tal.

- **På 390 er tallene de samme:** runde 3's B målt igen giver øjenbryn 5,48 og
  manchet 5,67 (committet i runde 3: 5,48 og 5,67).
- **På 360** hæver linjemålingen manchetten fra 5,67 til 5,84 (tre linjer).

Forskellen til B's 6,93 på 390 er altså den rene hvide tekst og ikke målingen.

### Tærsklen i `maal-foto.mjs`

AA-tærsklen for B stod der allerede, men kun i 390 og 360. Nu:

- **Hele telefonintervallet.** B gælder op til 900 px, så B måles i alle ni
  bredder fra 320 til 900.
- **Det værst tænkelige foto.** Fotoet byttes ud med en helt hvid flade (lys
  tekst) eller sort (mørk tekst) med objektets slør, og gulvet regnes af
  samme pixels.
- **Loftet 0,60** gælder både det krævede slør («KUN A») og objektets eget
  (et tykkere slør afvises: fotoet forsvinder bag det).
- **Krediteringen er en del af dommen:** den skal kunne ses i hver bredde og
  stå på én linje.
- **Fire domme:**
  - **B:** består på fotoet og over det værst tænkelige.
  - **B · OVERVÅGES:** objektets slør er under gulvet. Teksten består på
    netop dette foto, men ikke på ethvert; et fotoskift skal måles igen.
  - **KUN A:** fotoet kræver mere end 0,60.
  - **AFVIST:** rettigheder, kreditering, bred skærm, for tyndt eller for
    tykt slør, eller tekst uden for gradientens fulde tæthed. Grunden siger
    hvilken, og hvad sløret skal være.
- **Exit 0** ved B og B · OVERVÅGES (overvågningen skrives ud), ellers 1.

Med ren hvid tekst kan intet foto kræve over 0,60. «KUN A» kan derfor kun
komme, hvis laget ændres, og så er det netop det, tærsklen skal fange.

**Det nuværende foto, alle bredder:**

| Bredde | Variant | Øjenbryn | h1 | Manchet | Værst tænkelige | Gulv | Slør (objekt) | Slør krævet | Fotoets tegning | Første kort (fold) | Krediteringens linjer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1440 | bred | 6,40 | 14,80 | 14,35 | 6,34 | 0,85 | 0,95 | 0,8 | 0,65 | 52 % (900) | 1 |
| 320 | B | 7,02 | 6,72 | 6,34 | 4,69 | 0,6 | 0,6 | 0,5 | 0,44 | 38 % (780) | 1 |
| 360 | B | 6,93 | 6,83 | 6,34 | 4,69 | 0,6 | 0,6 | 0,5 | 0,43 | 41 % (780) | 1 |
| 360 | A | 7,13 | 16,63 | 16,63 | – | – | – | – | 1,00 | 22 % (780) | 1 |
| 375 | B | 6,93 | 6,83 | 6,25 | 4,69 | 0,6 | 0,6 | 0,5 | 0,43 | 60 % (844) | 1 |
| 390 | B | 6,93 | 6,83 | 6,15 | 4,69 | 0,6 | 0,6 | 0,5 | 0,43 | 59 % (844) | 1 |
| 390 | A | 7,13 | 16,63 | 16,63 | – | – | – | – | 1,00 | 38 % (844) | 1 |
| 414 | B | 6,93 | 6,83 | 6,15 | 4,69 | 0,6 | 0,6 | 0,5 | 0,43 | 57 % (844) | 1 |
| 430 | B | 7,12 | 6,83 | 6,25 | 4,69 | 0,6 | 0,6 | 0,5 | 0,43 | 59 % (844) | 1 |
| 600 | B | 7,27 | 7,13 | 6,72 | 4,69 | 0,6 | 0,6 | 0,45 | 0,38 | 56 % (900) | 1 |
| 768 | B | 6,88 | 7,15 | 6,72 | 4,69 | 0,6 | 0,6 | 0,45 | 0,39 | 61 % (900) | 1 |
| 900 | B | 6,26 | 5,90 | 6,74 | 4,69 | 0,6 | 0,6 | 0,5 | 0,40 | 59 % (900) | 1 |

**Selvprøven** har 8 tilfælde med kendt facit, ét for hver dom og hver vej
til AFVIST. Alle 8 fik deres facit.

| Tilfælde | Hvad | Facit | Dom | Hvorfor |
|---|---|---|---|---|
| `nuvaerende` | det nuværende foto med sit objekt | B | **B** | består i alle ni telefonbredder og over et helt hvidt foto |
| `tyndere-sloer-050` | samme foto, B's slør 0,50 (under gulvet) | B · OVERVÅGES | **B · OVERVÅGES** | består på dette foto; værst tænkelige (3,41:1 i 320): objektets slør 0,5 er under gulvet 0,6 |
| `tyndt-sloer-020` | samme foto, B's slør 0,20 | AFVIST | **AFVIST** | B 320: øjenbryn 2,73:1 < 4,5:1; h1 2,6:1 < 3:1; manchet 2,38:1 < 4,5:1 — objektets slør 0,2 er for tyndt; fotoet kræver 0,5, så sæt sloerSmal til 0,6 |
| `tykt-sloer-090` | samme foto, B's slør 0,90 (over loftet) | AFVIST | **AFVIST** | objektets slør 0,9 er over loftet 0,6: fotoet forsvinder bag sløret — sæt sloerSmal til 0,6 |
| `moerkt-foto` | mørklagt attrap, bred skærms underlag 0,20 | AFVIST | **AFVIST** | bred 1440: øjenbryn 1:1 < 4,5:1; h1 1,39:1 < 3:1; manchet 1,39:1 < 4,5:1 |
| `loftet` | overbelyst attrap, og laget med runde 3's øjenbryn (hvid à .84) | KUN A | **KUN A** | B 320: kræver slør 0,65 > loftet 0,6 |
| `uden-licens` | det nuværende foto uden licens | AFVIST | **AFVIST** | Ingen licens i fotoobjektet. Uden licens bruges fotoet ikke. |
| `lang-kredit` | det nuværende foto med en CC BY-kreditering på 67 tegn | AFVIST | **AFVIST** | kreditering B 320: brækker over 2 linjer; laget har plads til én — forkort den |

«loftet» bryder laget og ikke målingen: den lægger runde 3's øjenbryn ind i
CSS'en, fordi intet foto kan kræve over 0,60, så længe teksten er ren hvid.

## 2 · Krediteringen kan ikke forsvinde

**Formen: CSS flytter det element, page.tsx allerede tegner.** `page.tsx`
tegner `p.hero-kredit` som heroens sidste barn, med teksten fra samme objekt
som fotoet (`HERO_STANDARD`, eller `NEXT_PUBLIC_HERO_FOTO_KREDIT`, når fotoet
er skiftet med miljøvariablen). `greb.css` § 7 flytter netop det element: fra
pillen øverst til højre til en lille linje under søgekortet, ved kortets
højrekant, på papiret. Reglen skjuler intet og skriver ingen tekst.

Runde 3 flyttede krediteringen i markuppen, ind i `footer.bund`. Det er
trukket tilbage. Den form krævede, at laget lod være med at skjule pillen, og
så hang en licensforpligtelse på rækkefølgen af to udrulninger. **`page.tsx`
skal ikke røres for krediteringens skyld.**

**Hvorfor ikke `content:` med teksten fra heltefoto.json,** som du foreslog:

- **Teksten i CSS'en.** Så stod fotografens navn to steder. Et foto, der
  skiftes med `NEXT_PUBLIC_HERO_FOTO`, ville blive tilskrevet Taryn Elliott,
  og det er netop den fejl, kommentaren ved `HERO_STANDARD` i `page.tsx`
  advarer mod: «ellers tilskriver siden en fotograf et billede, hun ikke har
  taget».
- **`content: attr(…)`.** Attributten er en ny markupændring, og så er
  rækkefølgen tilbage.

**Mit første svar var for stort.** Jeg skrev, at der «ikke findes nogen
delvis udrulning». Efterprøvningen viste to, hvor krediteringen forsvandt,
fordi laget selv er flere filer i en bestemt rækkefølge:

- **greb.css uden forslag.css.** Krediteringens `top` læste `--l-2`, som kun
  forslag.css definerer. Uden den blev `top` ugyldig, og linjen havnede oven i
  søgekortet: over «Populære søgninger» på 320–390 og over Søg-knappen på
  1440 (1,06:1).
- **Laget foldet ind i globals.css**, som README'ens «Sådan lander det»
  beskriver. Globals' egne ≤760-regler for `.hero` og `.hero-soeg` står
  senere i filen og vandt. Linjen havnede så oven i «Nyeste boliger» på 390.

**Rettet:**

- Alle `var()` i de regler, der placerer kortet og krediteringen, har en
  bogstavelig reserveværdi.
- Reglerne står på `.hero.fuldbredde` (0,2,0), så globals' `.hero` og
  `.hero-soeg` (0,1,0) ikke kan vinde ved en indfoldning.
- Overhænget er ét tal, `--hero-soeg-loeft`, som både kortets `translateY`
  og krediteringens `top` læser.

Begge tilstande prøves nu. Modprøverne genindfører den gamle form af laget
og bliver røde.

**Prøven fejler synligt.**
[`gengivelse/kredit-udrulning.mjs`](gengivelse/kredit-udrulning.mjs)
gengiver hver tilstand i 1440, 768, 390, 360, 320 og 280. Globals' regler i
«foldet» læses af den rigtige `app/globals.css`, når prøven kører; de er ikke
skrevet af. Prøven kræver præcis én kreditering, der er:

- synlig: ikke `display:none`, `visibility` eller `opacity`, heller ikke via
  en forælder;
- ikke dækket: `elementFromPoint` i hver linjes kasse rammer krediteringen
  selv;
- ikke oven på anden tekst: under de samme punkter (`elementsFromPoint`)
  ligger ingen anden tekstlinje. Krediteringen har `z-index: 1`, så den
  ville stå øverst og se «synlig» ud, også midt i en overskrift;
- læselig: mindst 4,5:1 mod de faktiske pixels.

Modprøverne indfører fejlen i laget, dér hvor appen læser, og skal blive
røde. Ellers er hele kørslen rød.

| Tilstand | 1440 | 768 | 390 | 360 | 320 | 280 |
|---|---|---|---|---|---|---|
| i dag (intet landet) | hero 7,14 | hero 6,20 | hero 6,49 | hero 6,49 | hero 6,49 | hero 6,49 |
| kun laget (forslag.css + greb.css) | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 |
| laget + mockuppen | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 |
| laget med A (`.m-baand`) | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 |
| greb.css uden forslag.css | hero 4,77 | hero 4,77 | hero 4,77 | hero 4,77 | hero 4,77 | hero 4,77 |
| laget foldet ind i globals.css (globals' regler efter) | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 | hero 6,40 |
| runde 3's markupflytning, uden laget | fodnote 5,08 | fodnote 5,08 | fodnote 5,08 | fodnote 5,08 | fodnote 5,08 | fodnote 5,08 |
| runde 3's markupflytning + laget | fodnote 7,13 | fodnote 7,13 | fodnote 7,13 | fodnote 7,13 | fodnote 7,13 | fodnote 7,13 |
| **Modprøver (skal være røde)** | | | | | | |
| `.hero-kredit { display: none }` | rød | rød | rød | rød | rød | rød |
| lagt bag søgekortet (`z-index: -1`) | rød | rød | rød | rød | rød | rød |
| tekstfarve `#d9d6cf` | rød | rød | rød | rød | rød | rød |
| en ekstra i fodnoten (to steder) | rød | rød | rød | rød | rød | rød |
| lagt oven på h1 | rød | rød | rød | rød | rød | rød |
| greb.css alene, reserveværdierne fjernet (lagets første form) | rød | · | rød | rød | rød | · |
| foldet, med `.hero` i stedet for `.hero.fuldbredde` (lagets første form) | · | · | rød | rød | · | · |
| `NEXT_PUBLIC_HERO_FOTO` uden `_KREDIT` | rød | rød | rød | rød | rød | rød |

Tallene er krediteringens kontrast mod de faktiske pixels; «·» betyder, at modprøven kun køres i de bredder, hvor fejlen er målt. Alle 8 tilstande har præcis én synlig, læselig kreditering i alle 6 bredder, og alle 8 modprøver blev røde.

**Grænsen: én linje.** Krediteringen står uden for flowet, så der er kun
plads til én linje. En længere tekst kan ikke skubbe noget ned. En
CC BY-kreditering på 67 tegn brækker på en telefon og løber ind i «Nyeste
boliger», og det er netop den slags licens, hvor kreditering er en pligt.

- **`maal-foto.mjs` afviser derfor et foto, hvis kreditering brækker**, målt
  i browseren i hver bredde. Selvprøvens `lang-kredit` viser det.
- **Under 240 px** brækker også standardteksten. Siden har allerede vandret
  rul ved 260 px i dag.

At reservere to linjer ville koste 16 px fold på hver telefon for et
tilfælde, målingen kan afvise.

**To målefejl, fundet af prøven selv.** Begge gav rødt på en kreditering, der
var i orden. Begge er rettet i `hero-maal.mjs`, så alle kontrastmålinger nu
regnes linje for linje.

- **Fodnoten på 360 (runde 3's markupflytning) blev meldt «dækket» og
  «1,0:1».** Linjen brækker der over to linjer, og to ting gik galt:
  - Prøvepunkterne lå midt i den samlede kasse, altså mellem linjerne og ved
    siden af teksten.
  - Kontrasten blev målt over den samlede kasse. Den rummer fodnotens anden
    tekst i samme farve.
- **Modprøven «dækket» var først bygget forkert.** Linjen blev lagt op under
  kortet, men har `z-index: 1` og blev derfor tegnet *oven på* kortet,
  synlig og læselig. Den måtte have `z-index: -1` for faktisk at blive
  dækket. En modprøve, der bliver grøn, var den, der fandt det.

**Fund til Frontend (ikke rettet her).** Miljøvariablen kan sætte et foto
uden om målingen:

- `page.tsx` sætter `kredit: process.env.NEXT_PUBLIC_HERO_FOTO_KREDIT || null`.
  Sættes et foto med `NEXT_PUBLIC_HERO_FOTO` uden kreditering, tegnes fotoet
  uden navn. Prøven fanger det (modprøven `modproeve-env-uden-kredit`).
- En lang kreditering den vej er heller ikke målt.

Formen, hvor det er gratis at glemme: et foto uden kreditering falder
tilbage på standardfotoet.

## 3 · Områdesidernes meta-beskrivelse står øverst i #36

[ukutuku/Bofinda#36](https://github.com/ukutuku/Bofinda/issues/36) er opdateret (1. oktober, se [kommentaren](https://github.com/ukutuku/Bofinda/issues/36#issuecomment-5928899754)). **Områdesidernes meta-beskrivelse er punkt 1**, af den
grund du gav. Siderne står i sitemap'et og er self-canonical og
indekserbare, og en søgemaskine, der har gemt beskrivelsen, viser den, til
den henter siden igen. Fejlen overlever altså rettelsen i cachen, side for
side. Chippen er rettet, i det øjeblik koden er udrullet. (Om Google viser
netop denne beskrivelse som uddrag, er ikke målt herfra. Der er ingen Search
Console-data, og Google erstatter undertiden beskrivelsen med sidetekst.)

**Målt i produktionen** 1. oktober kl. 07.28–07.30 UTC, kun på de offentlige
sider (ingen databaseadgang):

- **188 områdesider** i `https://bofinda.dk/sitemap.xml`: 93 postnumre og 95
  byer, plus forsiden. Dertil kommer hver sides side 2…N. De er
  self-canonical og bærer samme beskrivelse, for `generateMetadata` bygger
  den uafhængigt af `side`. Antallet af URL'er med beskrivelsen er altså
  større end 188.
- **`/lejeboliger/2300`:** «280 lejeboliger i 2300 København S. **Husleje
  7.395–36.900 kr. om måneden.** …»
- **Begge endepunkter er kendte totaler.** Søgesiden for 2300, sorteret
  efter pris, viser:
  - billigst først: «7.395–9.400 kr/md **til udlejer**» (Jorisvej);
  - dyrest først: «36.900 kr/md **til udlejer**» (Yderlandsvej 17A, 3. 1).
- **Ikke målt herfra:** hvor mange af de 188, der har et total-endepunkt.
  Det kræver basen. En høj andel kendte totaler siger ikke, hvor
  endepunkterne ligger: i testbasen, med ca. 90 % totaler, var den nedre
  ende en husleje i 2 af 8 søgninger.

**Et nyt fund, også i #36:** områdesidens tekst tæller noget andet end
listen under den.

- `statistik()` tæller byen med `eq`, mens listen bruger søgningens
  `ilike '%by%'`.
- På `/lejeboliger/koebenhavn-s` er **9 af 48 kort på side 1 fra København
  SV**, mens teksten siger «251 lejeboliger i København S».
- **7 af de 95 bysider** har et navn, der er en delstreng af en anden bys.

CLAUDE.md: «Tæller brødteksten andet end listen under den, er den ene
forkert.»

**Hvad der ellers er ændret i issuet:**

- **Rækkefølgen:** meta-beskrivelsen kan rettes først og alene. Spændet
  regnes kun af kendte totaler og står ved sit antal; findes ingen kendt
  total, udelades sætningen.
- **`lastmod` kan ikke melde rettelsen.** `app/sitemap.ts` sætter
  `lastModified: nu` på hver URL. Efter udrulningen er det sikre at bede om
  genindeksering i Search Console.
- **Linjenumrene** er efterprøvet mod `main` (45a161a) og `opgave/kontakt-ui`
  (fdb61f5).
- **Acceptprøvens punkt 6 og 7 kunne bestå uden at prøve noget.** Punkt 6
  såede kun huslejer som endepunkter og lå præcis på grænsen for en side
  (3 boliger). Punkt 7 søgte efter «til udlejer», som også står i sidens
  faste sætning. Nu har punkt 6 et positivt tjek, fire boliger og
  totaler som endepunkter, og punkt 7 bruger mønsteret «til udlejer
  <beløb>».
- **Produktionskommandoen** kører med `ROD` på en checkout af `main`, den
  kode produktionen kører, og med `--maal prod` (afsnit 4). Grenens `lib/` er
  ældre end `main` og klassificerer anderledes med samme rækker.

## 4 · Kommandoen i dokumentationen

**Rækken er foreslået på #22**, hvor Git & Release har fældetabellen i denne
uge: [kommentaren på #22](https://github.com/ukutuku/Bofinda/pull/22#issuecomment-5928907305). Jeg har ikke rørt `CLAUDE.md`. Den samme vej tog en anden
session med sin række i morges. Rækken er skrevet i tabellens navneform, med
værnet til venstre:

| Fælden | Hvad den IKKE dækker |
|---|---|
| **dokumentets-kommando** · vagten i scriptet (`krav_isoleret`, storage-prøvens exit 3, backfillens krav om en frisk sikkerhedskopi) | Kommandoen i en kodeblok i en `.md`-fil, som et menneske kopierer. Den kan gå uden om scriptets vagt — et andet indgangspunkt, en anden variabel, en `.env`, der tilfældigvis ligger der — og ligner alligevel noget, der er vogtet. |

**Reglen:** en kommando skrevet i dokumentation er en kommando, nogen kører.
Den navngiver sit mål og afviser som standard, præcis som en kommando i et
script.

1. **Målets NAVN står i kommandoen.** Forbindelsen må komme fra `.env` eller
   skallen, men den skal svare til navnet. Produktionens adresse står ingen
   steder i repoet, så den kan ikke stå i kommandoen.
2. **Vagten er en del af den samme kommando** og ikke en linje før den.
3. **Svarer forbindelsen ikke til navnet, exit 3, før noget åbnes eller
   skrives.** Det gælder begge veje: «prod» mod en lokal base giver tal, der
   bliver skrevet ned som produktionens. Kravet er positivt (hvad målet ER),
   og basen spørges selv bagefter.

**To steder, reglen ville ramme på `main` i dag** (45a161a). Begge står i
kommentaren på #22 som eksempler, ikke som rettelser; filerne er ikke mine.

- **`CLAUDE.md:1356–1357`: `npm run genparse -- --skriv`.** Det er en
  masseopdatering mod den base, `.env` peger på, uden navngivet mål.
  `scripts/genparse-adresser.ts` har ingen backup-vagt, modsat
  `genskriv-beskrivelse.ts`.
- **`README.md:158–164`:** første linje sætter målet, og tredje kører
  `db/toem-public.sql`, som tømmer alle tabeller i `public` uden vagt.

**Søgningerne, så de ikke læses som udtømmende:**

- **`main`:** kun `.md`-filer (31), kun kodeblokke (både
  ```` ``` ````-blokke og indrykkede), og kun disse mønstre: `npm run`
  for import/worker/alarm/genparse/genskriv-beskrivelse/db:*/test:prod/puls/tjek:*,
  `--env-file` og `psql`. Resultat: 14 linjer i 3 filer.
  - Min første optælling talte kun ```` ``` ````-blokke og fik 11.
  - Efterprøvningen fandt de tre indrykkede, heriblandt `genparse --skriv`.
- **Designforslagets egen mappe:** alle 51 tekstfiler (md, mjs, json, sh,
  sql, css, js, txt), samme mønstre plus `DATABASE_URL=` og `import.ts`.
  - Min første søgning så kun på .md, .sh og .mjs.
  - Efterprøvningen fandt en produktionskommando i en SQL-kommentar
    (`greb/forsidetal.sql`) og en forældet i `maalinger/prisspaend.json`.

**Anvendt på mine egne filer:**

| Hvor | Før | Nu |
|---|---|---|
| Importen (GREB-3.md) | fem løse linjer; vagten var én af dem | [`gengivelse/importer-testbase.sh <slug>`](gengivelse/importer-testbase.sh): sætter selv sit mål, kører `krav_isoleret`, exit 3 hvis skallen har `DATABASE_URL`, `DATABASE_URL_DIRECT` eller `RESEND_API_KEY` |
| `maal-prisspaend.mjs`, `maal-ny.mjs`, `maal-chips.mjs` | `--base` (eller `--prod`); målet var det, der stod i miljøet, og `maal-ny.mjs` faldt tilbage på `DATABASE_URL` og havde sin egen kopi af forbindelsen | `--maal test\|prod` ([`laast-base.mjs`](maalinger/laast-base.mjs) › `kraevMaal`); alt andet end `--proeve` går gennem vagten. Basen spørges bagefter (`current_database`, `inet_server_port`), og første linje viser mål og kodens commit. Til sidst: stadig read-only og samme forbindelse, ellers exit 1 |
| `greb/forsidetal.sql` | en produktionskommando i en kommentar, uden mål og read-only, som ikke gjorde noget | [`maalinger/maal-forsidetal.mjs`](maalinger/maal-forsidetal.mjs) `--maal prod` |
| `app-skud.mjs` | slog op i den base, `DATABASE_URL_DIRECT` pegede på, og skrev før vagten | altid `test`, vagten før første skrivning, og basen spørges via psql |
| `runde4.sh` | appens adresse kom fra skallen | sættes af `BOFINDA_APPPORT`; en anden i skallen giver exit 3 |
| GREB-3.md, `ny-maerkat.md`, `prisspaend.json` og #36 | `--base` | `--maal prod`, med `ROD` på `main` |

**Vagten var først en denyliste.** `prod` afviste kun loopback-navnene og
staging, og efterprøvningen fik den til at godkende testbasen som
«produktionen» via `0.0.0.0`, `127.1`, `LOCALHOST`, `[::ffff:127.0.0.1]` og
en multihost-URL. Nu er kravet positivt:

- **`test`:** port og base læses af `scripts/cloud/miljoe.sh`, ikke af
  miljøet.
- **`prod`:** en Supabase-vært (`*.pooler.supabase.com` eller
  `db.<ref>.supabase.co`) med stien `/postgres`, og ikke staging, heller ikke
  med versaler.
- **Begge:** kun forespørgselsparametrene `sslmode` og `pgbouncer`, og basen
  spørges selv, som `scripts/cloud/app-op.sh` gør.

[`maalinger/proev-maal.mjs`](maalinger/proev-maal.mjs) kører **38 tilfælde** mod de rigtige kommandoer, hvert i sin egen
proces: `kraevMaal`, de fire målescripts, importen og `app-skud.mjs`.

- **Importen** køres mod en attrap af `npx` forrest i PATH, som kun skriver sit miljø ud. Prøven bekræfter, at målet er
  testbasen, og at der ingen mailnøgle er. Det gør også modprøven ufarlig, når netværket er åbent.
- **`app-skud.mjs`** skal afvise uden at have skrevet noget: udmappen må ikke findes bagefter.

Modprøverne er kørt i de rigtige filer og sat tilbage:

- **Værtskravet for `prod` slået helt fra:** de otte alias-tilfælde blev røde. Første gang gav samme modprøve ingen røde,
  fordi alle aliasene havde stien `/bofinda_test`, som stitjekket afviste i forvejen. Nu har de stien `/postgres`, så
  værtskravet er den eneste barriere, de prøver.
- **Importvagten slået fra:** de tre tilfælde med en nøgle i skallen blev røde. Importen nåede kun attrappen.

## Netværket

Status 1. oktober kl. 09.18 UTC: alle seks værter svarede 403 fra proxyen
(«CONNECT tunnel failed»).
Netværksadgangen ændres i miljøets indstillinger: miljømenuen i sessionens
titellinje → Edit → Network access. Enten vælges et bredere niveau, eller
værterne lægges på listen over tilladte domæner. `BALDER_API_KEY` lægges ind
som hemmelighed i samme miljø.

Når værterne er åbne:

```sh
scripts/cloud/op.sh                                          # base + app
docs/designforslag/gengivelse/importer-testbase.sh propstep  # én kilde ad gangen
docs/designforslag/gengivelse/importer-testbase.sh dacas
docs/designforslag/gengivelse/importer-testbase.sh balder    # kræver BALDER_API_KEY
docs/designforslag/gengivelse/runde4.sh <udmappe>            # alle billeder og tal om
```

[`runde4.sh`](gengivelse/runde4.sh) tager i dag, runde 2, runde 3's B, A og B
med første kort ved folden (efter samtykke og ved første besøg), plus
kreditprøven, fotomålingens selvprøve og vagtprøven. Det er første gang,
nogen ser siden, som den er.

## Hvad efterprøvningen fandt

Fire uafhængige efterprøvere prøvede at gendrive runden, før noget blev
committet eller postet: laget og krediteringen, målingerne og tallene, #36
og kommentaren til #22, og kommandoreglen. Deres fund er rettet og står i
afsnittene ovenfor. Det vigtigste:

- **Krediteringen kunne forsvinde ved en delvis udrulning af CSS'en selv**
  (afsnit 2).
- **Gulvet for B's slør stod to steder.** Slørreglen i heltefoto.json
  («krævet + 0,05») gav 0,55, og ved 0,55 er gulvet 3,96:1. Nu måles gulvet
  ét sted (`vaerstTaenkelige › gulv`), og reglen er max(gulv, krævet + 0,05).
  Et slør over loftet afvises.
- **Folden var målt efter samtykke.** Første besøg måles nu for sig
  (afsnit 1).
- **Vagten var en denyliste** og godkendte testbasen som produktionen
  (afsnit 4). Prøven af den var også for svag: en modprøve, der slog
  værtskravet helt fra, gav ingen røde tilfælde, fordi stitjekket afviste
  dem i forvejen. Nu prøves værtskravet alene, og samme modprøve giver otte
  røde.
- **#36 og kommentaren til #22 var ikke klar til at blive postet.** De
  linkede til ucommittet kode og havde påstande uden måling bag. De blev
  rettet, committet og postet bagefter, med permalinks.

## Filer

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css) | § 0 `--hero-soeg-loeft` og reserveværdierne; § 6 B som standard, A som `.m-baand`, ren hvid tekst; § 7 krediteringen flyttet med CSS alene, på `.hero.fuldbredde` |
| [`greb.js`](greb.js) | mockuppen flytter ikke længere krediteringen; teksten følger fotoobjektet, når fotoet skiftes |
| [`heltefoto.json`](heltefoto.json) | slørreglen med gulvet og loftet; krediteringen på én linje |
| [`gengivelse/hero-maal.mjs`](gengivelse/hero-maal.mjs) | `foersteKort` (efter samtykke og ved første besøg), `vaerstTaenkelige` med `gulv`, `tekstBund`; kontrast og dækning linje for linje; `kreditering` med dækning, overlap og linjer |
| [`gengivelse/kredit-udrulning.mjs`](gengivelse/kredit-udrulning.mjs) | otte udrulningstilstande og otte modprøver i seks bredder; exit 1 ved fejl |
| [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs) | B i 320–900 og over det værst tænkelige foto; gulv og loft; krediteringen i dommen; selvprøven med otte tilfælde |
| [`gengivelse/app-skud.mjs`](gengivelse/app-skud.mjs) | første kort ved folden (to folde); exit 1 uden præcis én læselig kreditering; altid testbasen, vagten før første skrivning |
| [`gengivelse/importer-testbase.sh`](gengivelse/importer-testbase.sh) | importen til testbasen, med målet i scriptet |
| [`gengivelse/runde4.sh`](gengivelse/runde4.sh) | alle runde 4's billeder og tal med én kommando |
| [`maalinger/laast-base.mjs`](maalinger/laast-base.mjs) | `kraevMaal` (positivt mål, exit 3) og `laastBase` (spørger basen, read-only til sidst) |
| [`maalinger/maal-forsidetal.mjs`](maalinger/maal-forsidetal.mjs) | båndets tal fra produktionen, med navngivet mål |
| [`maalinger/proev-maal.mjs`](maalinger/proev-maal.mjs) | prøven af vagterne mod de rigtige kommandoer |
| [`greb4/`](greb4) | billederne og JSON fra den kørsel, der står i denne fil |
