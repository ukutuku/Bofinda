# Boligkortet og resultatlayoutet

Samlet designændring, september 2026. Skærmbilleder i `docs/kortdesign/`,
kontrollog i `docs/kortdesign/kortkontrol.log`.

Alt herunder er målt i det isolerede testmiljø på loopback
(`scripts/cloud/*`, 264 syntetiske boliger) på det byggede output, ikke i
dev-serveren. Før- og efterbillederne er taget på **samme data og samme
bredde**.

---

## 1 · Resultatlayout: højst to kolonner, målt på listeområdet

Gitteret stod som `repeat(auto-fill, minmax(286px, 1fr))`, som tæller så
mange kort, der kan være. Det gav:

| Bredde | Landkort | Liste | Før | Efter |
|---|---|---|---|---|
| 390 | ja | 346 px | 1 à 346 px | 1 à 346 px |
| 768 | stablet under | 724 px | 2 à 352 px | 2 à 352 px |
| 1100 | ja | 684 px | 2 à 332 px | 2 à 332 px |
| 1100 | nej | 1056 px | **3 à 339 px** | 2 à 518 px |
| 1440 | ja | 928 px | **3 à 296 px** | 2 à 454 px |
| 1440 | nej | 1300 px | **4 à 310 px** | 2 à 640 px |

Et kort på 296 px er ikke et kort, det er en spalte: adressen brækker,
prisen og indflytningsprisen kan ikke stå ved siden af hinanden, og fotoet
bliver 166 px højt.

**En container kan ikke forespørge sin egen bredde.** `.liste` bar
`container-type: inline-size`, men en `@container`-regel om `.liste`s egne
kolonner ville aldrig fyre. Derfor er `.listeomraade` lagt uden om — et lag,
hvis eneste opgave er at kunne måles. Det findes tre steder: søgesiden,
gruppesiden og områdesiderne. Kolonnetallet afgøres ét sted.

Reglen i `CLAUDE.md` — kortene brydes efter deres egen bredde, ikke efter
vinduets — er intakt: forespørgslen går på listeområdet, som bliver smalt,
når landkortet står ved siden af. Ingen `@media` er involveret.

### Sidegevinst: de tre eksisterende containerforespørgsler virkede ikke

`@container (max-width: 460px)` og `(max-width: 250px)` var **unavngivne**,
og den nærmeste container var `.liste`. Ved to kolonner over 620 px så
forespørgslen altså 620 px, mens kortet var 300. Reglerne fyrede aldrig.
Containerne hedder nu `listeomraade` og `boligkort`, og kortets indre
justeringer forespørger kortet.

### Det brede kort er vandret

Over 1020 px listebredde er hvert kort ~500 px, og et 16/9-foto i fuld
bredde ville være 280 px højt — på 1440 px uden landkort 360 px. To kort i
højden per skærm er ikke en resultatliste. Vandret er fotoet 240 px bredt,
og korthøjden ved 1440 px uden landkort er 229–295 px. Den samme liste i
lodret form — 928 px med landkortet ved siden af — er 464–528 px.

### Kort uden foto strækkes ikke

`.liste` har `align-items: start`. Før blev et kort uden foto strakt til
rækkens højde. Målt som forholdet mellem det højeste kort uden foto og det
højeste med foto i samme visning:

| Bredde | Landkort | Før | Efter |
|---|---|---|---|
| 768 | stablet under | 1,01 | 0,65 |
| 1100 | nej | 0,99 | 0,77 |
| 1440 | ja | 0,99 | 0,48 |
| 1440 | nej | 0,99 | 0,90 |

Ved 768 px faldt kortet uden foto fra 471 til 304 px — 167 px, der før var
tom søjle. Kontrollen måler det på blandede rækker: et kort uden foto må
ikke have samme højde som et med.

---

## 2 · Informationshierarki

Rækkefølgen er nu foto → adresse → by → boligtype, værelser, m² →
månedspris → indflytningspris → forbehold → kilde.

**Faktachipsene flyttede op over beløbet.** Før gik kortet fra adresse til
pris og fortalte først bagefter, hvad prisen var for.

**Skillelinjerne gik fra to til én.** Chiprækken havde en `border-top`, og
foden har en. To streger i et kort er inddeling, der er blevet dekoration.
Afstanden gør arbejdet; foden beholder sin ene. Kontrollen tæller dem.

**Gentagelsen på gruppekortet.** Antallet stod tre steder: mærkatet på
fotoet, stedlinjen («9003 Attrapby · 4 boliger») og linket («Se de 4
adresser»). Stedlinjen er nu postnummer og by; antal og type står i
chiprækken, hvor hierarkiet vil have dem. Mærkatet og linket bliver — de er
signalet på fotoet og handlingen.

**«hver» på værelseschippen.** Er gruppens type `vaerelse`, skrev de to
første chips ellers «4 værelser · 5 værelser»: fire udlejede værelser med
fem rum i hvert, men samme ord om to forskellige ting. Ordet siger, at
tallet gælder per bolig. Værelsestallet er en nøgledel i grupperingen, så
alle medlemmer har det samme — «hver» er efterprøvet, ikke et forbehold.

**Statusmærkaterne er der stadig, alle fire.** «ny», «venteliste»,
«reserveret» og «bopælspligt» er oplysninger, ikke pynt. At skjule
«reserveret» for at begrænse antallet af mærkater ville være projektets egen
ærlighedsregel vendt på hovedet.

---

## 3 · Billeder

**Rammen har ét forhold per visning.** 16/9 i den lodrette form, 1/1 i den
vandrette. Første forsøg lod fotoet fylde rækkens højde, så spalten ikke
stod halvtom ved siden af en høj tekst — og så fik hvert kort sin egen
billedform: målt 0,82 · 0,83 · 0,85 · 0,89 · 0,90 · 0,93 · 0,96 · 1,03 ·
1,06 på den samme side. En
ramme, der retter sig efter tekstens længde, er ikke en ramme. Kontrollen
måler spændet mellem forholdene og kræver det under 0,02.

**Stående og liggende er prøvet.** 600×900 og 1800×600 lægges i rammen, og
billedets kasse skal være rammens kasse på millimeteren, med `object-fit:
cover`. Testaktivernes ruder er kvadratiske — bliver de rektangler, er noget
strakt. Prøven skriver i testbasen og skriver tilbage igen.

**Ingen opdigtede billeder.** Kortet uden foto har ingen pladsholder og
intet eksempelbillede. Det står i sin egen højde med en strammere krop, så
formen læser som et valg. Mangler kilden billeder, står det i stedlinjen —
det er en oplysning, ikke en dekoration.

**Billedforbeholdet er bevaret** og står 0–8 px under det foto, det handler
om, på alle fire bredder. Det fandtes ikke i testdataene, så det stod
utestet; kontrollen sætter det nu og skriver tilbage.

---

## 4 · Priser og grupper — uændret

Intet i priselogikken er rørt. Efterprøvet i kontrollen og i `npm test`:

- Grøn total = «kr/md til udlejer». Kendes totalen ikke, står huslejen i
  sort med «kr/md i husleje» — de to kan ikke forveksles på afstand.
- «Udlejer oplyser ikke aconto — spørg om varme og vand.» står, hvor den
  stod.
- El-forbeholdets fire tilstande kommer stadig fra `eltilstand`.
- Gruppens «fra X» bliver til hele spændet over 25 %.
- Gruppelinket bærer filtrene: `/gruppe?b=<id>&by=Attrapby`. Nøglen er
  fortsat udledt af repræsentantens bolig-id.
- «N af M boliger matcher din søgning» står uændret på det blandede kort.
- Gruppens antal, areal og værelser foregiver ikke at beskrive én bolig:
  antallet er mærket som antal, arealet som spænd, værelserne med «hver».

**Ingen afkortning.** Kontrollen læser `text-overflow`, `-webkit-line-clamp`
og `scrollWidth > clientWidth` på pris, indflytningspris, `.ukendt`, `.el`,
`.poster`, `.gruppe-match` og `.gruppe-flere` på alle fire bredder. Nul
træffere.

---

## 5 · Interaktion — uændret

Kortet er ét `<a>`. Kontrollen fejler, hvis der er et `a`, `button`,
`input`, `select`, `textarea`, `[tabindex]` eller `[role=button]` inde i
det. Der er ingen favoritknap og ingen billedpile — hverken før eller nu.
Tastaturfokus giver 2 px ring på alle fire bredder. `id` og `data-bolig`
til landkortets sammenkobling er urørt.

---

## 6 · Hvad der faktisk er kørt

| Kontrol | Resultat |
|---|---|
| `node scripts/cloud/kortkontrol.mjs` (ny) | 129 kontroller grønne |
| `npm test` | ALT GRØNT |
| `scripts/cloud/kontrol.sh` (browserkontrol) | ALT GRØNT |
| `scripts/cloud/kontrol-pagination.sh` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt |
| `npx tsc --noEmit` | rent |

Dækket: 390, 768, 1100 og 1440 px, med og uden landkort, på søgesiden,
forsiden, områdesiden og gruppesiden. Enkeltkort, gruppekort, kort uden
foto, lang adresse, kendt og ukendt aconto, stående og liggende foto,
indflytningspris, billedforbehold, navigation fra et filtreret gruppekort.

**Ikke kørt:** `npm run test:prod` (skriver i produktionen) og de fire
prøver, der måler det rigtige udbud. Ingen Vercel-preview — værten er
spærret af miljøpolitikken.

### Fejl fundet undervejs i mine egne målinger

To målefejl, begge rettet, begge dokumenteret i kontrollen:

1. `getBoundingClientRect()` regner transformer med, og
   `.kort:hover .kort-billede img` skalerer 1,025. Musen lå tilfældigt over
   et kort efter et klik, og kontrollen meldte «463×261 ≠ 452×254» om et
   billede, der sad præcist — 452 · 1,025 = 463,3. Musen flyttes nu væk, og
   rammen måles på `offsetWidth`/`clientWidth`, som ingen transform rører.
2. Prøven for billedformater valgte to boliger med `order by id limit 2`.
   De stod hverken på første side eller som enkeltkort, så prøven målte
   ingenting og meldte sig grøn på kontroller, der aldrig kørte. Boligerne
   vælges nu fra siden.

### En prøve, der ikke kørte, er ikke en bestået prøve

Da kontrollen var skrevet, havde den selv det hul, den var lavet for at
lukke. Prøven for billedformater målte i en løkke over de fundne kort:

    for (const x of r) { prøve(...) }

Er `r` tom, kører løkken nul gange. Nul påstande, og filen slutter grønt
på noget, der aldrig blev målt. Det skete én gang under arbejdet, fordi
prøveboligerne blev valgt med `order by id limit 2` og hverken stod på
første side eller som enkeltkort.

Tre værn er tilføjet:

1. **`blok(navn, forventet, fn)`** tæller, hvor mange påstande der faktisk
   blev kaldt indenfor, og fejler, hvis tallet ikke passer. Tallet er
   strukturelt — 2 bredder à 6 målinger, 4 bredder à 5 — så en ny kontrol
   et andet sted i filen ikke får det til at ryge. Et samlet gulv for hele
   filen ville have netop den svaghed.
2. **Antallet af prøveboliger er skrevet ud som et tal.** Første udgave
   sagde `r.length === emner.length`, og den er værdiløs: er begge tomme,
   er den sand. Afprøvet ved at pege prøven på to bolig-id'er, der ikke
   findes — påstanden meldte «0 af 0» og gik **grøn**. Nu står der `=== 2`.
3. **At det swappede foto nåede browseren.** Proxyen leverer 400 px bredt,
   så formen aflæses på forholdet: 600×900 bliver 400×600 (0,67), 1800×600
   bliver 400×133 (3,0). Rammer den 1,33, er opdateringen ikke slået
   igennem, og prøven måler det såede standardbillede i stedet.

Efterprøvet ved at genindføre fejlen i tre former:

| Brud | Før værnene | Efter |
|---|---|---|
| Prøveboligerne findes ikke i basen | grøn | `FEJL: 0 af 2 prøveboliger har et billede i basen`, exit 1 |
| Valgt fra basen, ikke fra siden (den oprindelige fejl) | **grøn** | `✗ 0 af 2 fundet` · `✗ 2 målinger kørte, 6 forventet`, exit 1 |
| Opdateringen slår ikke igennem | grøn | `✗ stående foto nåede browseren — 400x300 → 1.33, ventet 0.67`, exit 1 |

Testbasen er urørt efter alle tre brud: 0 `form-*`-billeder, 0
indflytningspriser, 0 billedforbehold, 595 billedrækker, 264 boliger.

### En fejl i testopsætningen, ikke i designet

`NEXT_PUBLIC_*` bages ind i klientbundtet ved **byg**, ikke ved start.
`app-op.sh` satte flise-URL'en på processen, men `Landkort.tsx` er en
klientkomponent, så værdien var allerede låst. Et byg med `npm run build`
bar standardværdien, og browserkontrollen hentede tre fliser fra
`tile.openstreetmap.org` midt i et miljø, der ellers kun rører loopback.

`scripts/cloud/byg.sh` bygger nu med de rigtige variabler, og `app-op.sh`
nægter at starte et byg, der bærer OpenStreetMaps URL.

---

## Filer

| Fil | Ændring |
|---|---|
| `app/globals.css` | `.listeomraade`, kolonneloft, vandret kort, kompakt variant uden foto, chiprækken over beløbet, navngivne containere |
| `app/Boligkort.tsx` | Chiprækken flyttet op og omordnet på begge korttyper; gruppens antal og type flyttet fra stedlinjen til chiprækken; «hver» på værelseschippen |
| `app/page.tsx`, `app/gruppe/page.tsx`, `app/lejeboliger/[slug]/page.tsx` | `.listeomraade` om listen |
| `scripts/cloud/kortkontrol.mjs` | Ny kontrol, 120 målinger |
| `scripts/cloud/byg.sh`, `scripts/cloud/app-op.sh` | Byg til testmiljøet uden eksterne flise-URL'er |

---

# Informationshierarkiet · 23. september 2026

Kortet bar op til **fem** særskilte udsagn om økonomi. Hver enkelt var
sand; det var samlingen, der ikke var til at læse. Det her er
omlægningen, og **den hviler på målinger af produktionen**, ikke på
smag — tallene står ved hvert valg, så den næste kan se, hvorfor der
er fire former og ikke tre.

## Grundlaget · 1.864 synlige boliger

| | antal | andel |
|---|---|---|
| kendt total («til udlejer») | 1.360 | 73,0 % |
| kun husleje («i husleje») | 504 | 27,0 % |
| med indflytningspris | 1.497 | 80,3 % |
| posterlinje (kendt total) | 1.360 | 73,0 % |

**El-tilstanden — de fire reelle grupper:**

| tilstand | antal | andel |
|---|---|---|
| `ikke-med` · el indgår ikke, total kendt | 857 | 46,0 % |
| *ingen linje* · total ukendt | 504 | 27,0 % |
| `ukendt-daekning` · aconto er ét samlet beløb | 466 | 25,0 % |
| `egen-maaler` | 20 | 1,1 % |
| `med` · el er en navngiven post | 17 | 0,9 % |

**De tre store er næsten lige store.** 46 · 27 · 25. Det er den
vigtigste enkeltoplysning i hele omlægningen: *der findes ingen
normaltilstand at afvige fra.* Et design, der gør én af dem til
hovedreglen, gør de to andre til undtagelser — på 52 % af kortene.

Derfor er der **fire former og ikke tre**, og derfor er «højst ét
forbehold» det forkerte greb. Et forbehold forudsætter en
normaltilstand. Den findes ikke her.

## Diagnosen · to linjer, ét spørgsmål

```
husleje + varme + vand                          ← posterlinjen: hvad ER med
El indgår ikke — udlejer oplyser ikke hvordan   ← el-linjen: hvad er IKKE med
```

To linjer, to pladser i rækkefølgen (`order: 9` og `order: 6`), som
skal læses sammen for at give ét svar på ét spørgsmål: **hvad dækker
tallet?** Det er CLAUDE.md's dyreste mønster — to udtryk for det samme
— og det stod på 71 % af kortene.

Sammenlægningen fjerner **niveauet**, ikke oplysningen.

## Hierarkiet

**Niveau 1 · Tallet, og om vi kender det.** Skellet bæres af ordene,
ikke af farven. Farven må blive, men den var før det eneste — og den
forsvinder i gråtone, for en farveblind, og på et skærmbillede.

```
kendt   (73 %)   7.750 kr/md til udlejer
ukendt  (27 %)   7.350 kr/md i husleje + aconto (ikke oplyst)
```

Manglen står i selve tallet. **Det fjerner den gule advarselsboks** —
der er ikke noget tilbage at sætte i en advarselsfarve. 27 % er for
ofte til at råbe og for tit til at skjule.

**Niveau 2 · Grundlagslinjen.** Ét svar, altid præcis én linje, altid
samme plads:

| form | tilstand | linjen |
|---|---|---|
| **A** 46 % | `ikke-med` | husleje + varme + vand · el kommer oveni |
| **B** 27 % | total ukendt | Spørg udlejeren om varme og vand |
| **C** 25 % | `ukendt-daekning` | husleje + ét samlet acontobeløb · uvist om el er med |
| **D** 0,9 % | `med` | husleje + varme + vand + el |
| **D'** 1,1 % | `egen-maaler` | husleje + varme + vand · el betaler du selv til elselskabet |

**Niveau 3 · Indflytningsprisen.** 80,3 %, og jævnt fordelt — 81,3 %
blandt kendt total mod 77,8 % blandt kun husleje. Den følger altså
ikke prisen. Den er sin egen oplysning på fire ud af fem kort, og den
svarer på *kan jeg flytte ind*, hvor prisen svarer på *kan jeg blive
boende*. Egen række, ikke et detaljeringsniveau af tallet ovenfor.

**Flyttet til detaljesiden:** alderslinjen («set/annonceret for N
siden»). Ny-mærkatet bliver — hastighed er produktets løfte. Men hvor
gammel en *ikke*-ny annonce er, hører ikke til i økonomiblokken.

## Hvad det koster i udsagn

| gruppe | før | efter |
|---|---|---|
| A · el udenfor | 5 | **3** |
| C · klump | 5 | **3** |
| B · kun husleje | 4 | **3** |
| D · el med / egen måler | 5 | **3** |

De to, der forsvinder, er dem, der sagde det samme to gange.

## Reglerne, der skal overleve

- **Grundlagslinjen står præcis ÉN gang.** Er der nul, mangler svaret
  på «hvad dækker tallet»; er der to, er den gamle dobbelthed tilbage.
- **El-oplysningen findes ét sted.** Der er ingen `Ellinje` mere.
  Vender den tilbage ved siden af grundlagslinjen, er vi tilbage til
  to udtryk for ét spørgsmål.
- **`egen-maaler`-formuleringen er STÆRKERE end de andre.** «Du betaler
  selv til elselskabet» er en påstand om kundens forhold, ikke om vores
  data. Den må kun stå, når kilden selv har sagt det
  (`electricity_own_meter`), og den må aldrig blive standardteksten for
  de 857, hvor vi netop ikke ved det. CLAUDE.md er skarp på det, og
  `scripts/test-kortudsagn.ts` måler det.
- **Gruppekortet må ikke lade repræsentanten tale.** Er posterne ikke
  ens i gruppen, kan linjen ikke opregne dem — så siger den «husleje +
  aconto», som er sandt for alle. Og det svageste el-udsagn vinder: er
  der bare én, hvis aconto vi ikke kender indholdet af, kan kortet ikke
  sige «el indgår ikke» om dem alle.
- **`totalKendt` gives EKSPLICIT.** Enkeltkortets `b.total` er et beløb,
  der kan være null; gruppens `n.total` er en boolean, der aldrig er
  det. Samme ord, to typer — det kostede 47 gruppekort sidst. Derfor
  tager `grundlagstekst` den som sit eget argument og udleder den ikke.

## Målinger, der mangler

- **Blok 21R** binder de sidste 20: `egen-maaler` afgøres før
  `samletKlump` i `eltilstand`, så dens acontoposter er de eneste, der
  ikke kan udledes af el-fordelingen. Formen ændrer sig ikke — kun
  hvilken af D'-linjens to varianter de 20 får.
- **Blok 16** ville give fire rigtige kort til dokumentationen. Kun
  Tolderlundsvej 48, 1. 9 i Odense er aflæst, og dens acontoposter er
  ikke målt, så det vides ikke, om den er form A eller C.

Ingen af dem ændrer strukturen. De blev ikke kørt, fordi
containerens netværkspolitik spærrer 5432 og 6543.

## Hvad modprøven fandt

Modprøven — genindfør den separate el-linje, og se prøven blive rød —
gav rødt som ventet, men først i **fjerde** forsøg fortalte den noget,
vi ikke vidste. De tre forsøg er værd at skelne, fordi kun det sidste
var en prøve af prøven og ikke af koden.

| # | Hvad blev genindført | Rødt? | Hvad det viste |
|---|---|---|---|
| 1 | `Ellinje` ordret, på enkeltkortet | 3 røde i `test-grundlag`, 1 i `test-kortudsagn` | vagten virker |
| 2 | en el-note med NY ordlyd og FRISK klassenavn, på enkeltkortet | 1 rød | indholdsvagten virker, ikke kun klassenavnet |
| 3 | samme, men på **gruppekortet** | **grøn i begge filer** | **hul** |
| 4 | samme, efter rettelsen | rød | hullet er lukket |

**Hullet.** Enkeltkortet havde indholdsvagten («el-udsagnet står i
grundlagslinjen og INTET andet sted»). Gruppekortet havde den ikke — det
havde kun `klasser(gm, 'el') === 0` og «præcis én `.kort-grundlag`».
Begge er tællinger af klassenavne, og et nyt klassenavn glider under
dem begge. Gruppekortet er netop dér, denne fejl er landet før: 171
kort uden el-linjen, siden 47 med to modstridende udsagn.

Forsøg 1 alene ville have bekræftet, at vagten virker, og ladet hullet
stå. **En modprøve, der kun genindfører fejlen i dens gamle form, prøver
hukommelsen, ikke reglen.**

Vagten henter nu de tre el-udsagn fra `grundlagstekst` selv — sidste led
efter « · » — og tjekker **alle tre**, ikke kun gruppens egen. Ellers
ville en genindført linje med en anden tilstands ordlyd glide igennem,
hvilket er præcis hvad forsøg 3 gjorde.

### Og en fejl i prøvens eget fixture

`test-kortudsagn.ts` skrev `poster: ['rent', 'heating', 'water']`.
Ordet hedder **`heat`**. `posterTekst` faldt tilbage på
`POSTNAVN[p] ?? p`, så kortet gengav

    husleje + heating + vand · el kommer oveni

— et engelsk ord midt i en dansk sætning, på et prøvekort, i månedsvis,
uden at noget blev rødt. Fixturet går gennem `as never`, så compileren
så det ikke. Det er tredje gang `heating` for `heat` har ugyldiggjort
noget i denne omgang.

Fallbacket er nu væk. De to nærliggende udveje er begge løgne: at printe
nøglen siger ingenting til hende, og at springe den over siger «acontoen
dækker kun vand» om et beløb, der også dækker varme. Kan ét led ikke
oversættes, kan listen ikke opregnes — og «husleje + aconto» er sandt,
uanset hvad det ukendte led er. El-forbeholdet står der stadig.
