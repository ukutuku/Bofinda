# Fældetabellen — én fil pr. række

Tabellen «Dækker ét tilfælde mindre, end man tror» i CLAUDE.md er
**genereret** af filerne her. Ret filen, ikke tabellen.

## En ny række

1. Læg en fil `faelder/<slug>.md`. Filnavnet er `slug(navn)` fra
   `lib/slug.ts`: æ → ae, ø → oe, å → aa, alt andet end a-z0-9 → bindestreg.
   `værktøjets-kvittering` ligger i `vaerktoejets-kvittering.md`.
2. Kør `npm run faelder`. Den skriver blokken i CLAUDE.md.
3. `npm test` er rød, hvis du glemte trin 2, eller hvis filen ikke kan læses.

```
---
navn: værktøjets-kvittering
form: 3
faelde: `Successfully rebased and updated refs/heads/…`
kort: (valgfri) én sætning, der står efter navnet i formlisten
kostet: (valgfri) nej — fundet ved en måling, før nogen prøve var bygget på den
kilde: (valgfri) #59 på 99a8c30, CLAUDE.md linje 1117
---
Teksten i kolonnen «Hvad den IKKE dækker». Linjeskift bliver til
mellemrum, så den må gerne brydes. En lodret streg skrives \| som i
tabellen — ellers splitter den rækken, og filen afvises.
```

- `form` er `1`, `2`, `3`, `4` eller `ikke-vaern`. Formernes overskrifter og
  beskrivelser står i `FORMER` i `scripts/faelder.ts`. En ny form er en
  bevidst ændring dér.
- `kostet` udelades for en fælde, der har kostet mindst én omgang. Den
  sætning står under formlisterne, med undtagelserne navngivet.
- `kilde` står på en række, hvis tekst er **flyttet hertil fra en anden
  gren** frem for skrevet her. PR og sha, så citatet kan efterprøves mod
  sit forlæg. Den står ikke i tabellen — den er til den, der læser filen og
  spørger «er det her nogens ord?». Fire rækker har den i dag; se afsnittet
  om dem nedenfor.
- Rækkefølgen i tabellen er form og derefter navn i dansk orden. Der er
  ingen numre: navnet er identifikatoren.

## Hvordan en række må være skrevet

Reglen om den lodrette streg ovenfor — «En lodret streg skrives `\|` som i
tabellen — ellers splitter den rækken, og filen afvises» — er ét tilfælde af
en bredere egenskab ved denne mappe:

> **En dokumentation, der udløser sin egen kontrol, gør baselinen til en
> undtagelsesliste.**

Det gælder enhver kontrol, hvis beskrivelse ligger inden for det, den
scanner. **Beskriv kodepunktet, udstil det ikke.**

### Fyret to gange på den samme celle, i to tegnklasser

`include-filteret` fik en kontrol for tegn uden for det forventede
skriftsystem, og en baseline, der gør den til en måling frem for en
anbefaling.

| hvad cellen gjorde | hvad kontrollen så |
|---|---|
| viste homoglyffen som glyf | `0x43c CYRILLIC SMALL LETTER EM` + `0x1f3e0 HOUSE BUILDING` — to distinkte tegn, hvor baselinen sagde ét |
| viste `0x1f3e0` som glyf i selve baselinesætningen | `main` 1 forekomst, grenen 2 — mens baselinen sagde «ét tegn» |
| kodepunktet navngivet begge steder | ét distinkt tegn i én forekomst, på både `main` og #59 |

**Den anden er ikke en homoglyf.** Det var et synligt emoji i den sætning,
der *dokumenterer* kontrollen. Tallet var sandt om distinkte tegn og usandt
om forekomster, og **dokumentationen var selv årsagen til forskellen.** To
gange på én celle, i to tegnklasser, er grunden til, at egenskaben ikke er
en regel om homoglyffer.

Derfor står enheden ved tallet: **ét distinkt tegn i én forekomst**, ikke
«ét tegn».

### Tre måder at holde beskrivelsen uden for kontrollens vej

De tre er ikke en rangorden. Hver har sin betingelse, og den rigtige
afhænger af, om formatet har en escape, og af hvad kontrollen skal dække:

| måde | her i mappen | betingelse |
|---|---|---|
| **beskriv, udstil ikke** | `U+043C CYRILLIC SMALL LETTER EM`, `0x1f3e0 HOUSE BUILDING` | formatet har ingen escape for tegnet — og for en homoglyf er navnet desuden mere oplysende, for glyffen viser læseren ingenting |
| **escape tegnet** | `\|` i en celletekst, som reglen ovenfor kræver | formatet HAR en escape |
| **afgræns kontrollen** | pibetællingen ser kun linjer, der begynder med `\| **` | **afgrænsningen er valgt og skrevet ned.** En tabelkontrol må gerne være afgrænset til tabellen; det er dét, den er til |

Om afgrænsningen: den er legitim, og den er et valg. Det, der skal skrives
ned, er **omfanget** — så en senere udvidelse er en synlig beslutning. Den
dag pibetællingen udvides fra tabelrækkerne til hele filen, bliver prosaen
om pibereglen rød, og det er en forudset følge af udvidelsen, ikke en fejl
i prosaen.

### En baseline dokumenterer ikke bevarelse

Enheden ved tallet siger, hvad tallet betyder. Den siger ikke, at indholdet
er der. Målt ved prøvefletning 3. oktober: en opløsning, der kastede hele
dokumentationen bort, gav **1 distinkt tegn og 1 forekomst** — samme tal som
den rigtige tilstand. Et tal, der er grønt både når sætningen er rigtig og
når den er slettet, er `nullet-der-betyder-to-ting`. Tælling og
tilstedeværelse er to påstande, og kun den anden handler om bevarelse.

## Når to grene støder sammen

To grene, der hver lægger en fil, kolliderer kun i den genererede blok i
CLAUDE.md. Tag en af siderne og kør `npm run faelder`. Blokken er
bestemt af filerne alene, så resultatet er det samme, uanset hvilken side
du tog.

**Det gælder kun, hvis begge sider har deres rækker som FILER.** En gren,
der skriver sin række som tekst i blokken, taber den — i begge
fletterækkefølger, og den ene af dem tavst.

### De fire rækker fra #59 — hvorfor de ligger her

`ordet-målt`, `den-lånte-årsag`, `det-reproducerbare-tal` og
`sammenlagte-påstande` er **ikke skrevet her**. De er flyttet ordret fra
#59's tabel på `99a8c30`, hvor de står som håndskrevet tekst uden fil.
Hver af de fire bærer `kilde:` med PR og sha.

Grunden er mekanisk. **Revisionsgrundlag: målt 3. oktober mod #59 på
`99a8c30`** — den sha, de fire `kilde:`-felter navngiver. #61's egen sha ved
målingen er ikke skrevet ned her. Målingen: `git merge-tree refs/remotes/pr/59
refs/remotes/pr/61` giver konflikt i `CLAUDE.md`, to hunks. Begge
fletterækkefølger blev kørt igennem, med og uden filerne, og opløst på de
to måder nogen faktisk ville gøre det:

| | de fire rækker | `test-faelder` |
|---|---|---|
| **uden filerne**, hel fil (`--ours`/`--theirs`) | **tabt** | **ALT GRØNT** |
| **uden filerne**, hunk for hunk, #59's prosa beholdt | **tabt** | rød: `ukendte: ordet-maalt, den-lånte-årsag` |
| **med filerne**, hel fil | bevaret | grøn |
| **med filerne**, hunk for hunk, #59's prosa beholdt | bevaret | rød: `ukendte: ordet-maalt` — omdøbningen, se nedenfor |

**Den første række er grunden til, at filerne ligger her, og den
modsiger det, man ville tro.** Tabet blev antaget at være rødt, fordi
blokken så ikke ville passe til filerne. Det gør den: generatoren skriver
19 rækker, blokken har 19 rækker, prosakontrollen finder 9 henvisninger,
alle gyldige. **Prosakontrollen er det eneste, der kunne have set de fire
forsvinde — og den hele-fil-opløsning, der fjerner rækkerne, fjerner
#59's prosa i samme træk.** Værnet fyrer kun for den, der opløser hunk
for hunk; for den, der tager hele filen, er tabet lydløst. Det er den
samme form som rækkerne i tabellen: et værn, der læses som dækkende, og
hvis blinde vinkel er korreleret med selve fejlen.

Med filerne her er «tag den genererede side» det rigtige træk i begge
ordener — **men kun under to betingelser, og de stod ikke i første udgave
af dette afsnit.**

**Betingelse 1 · filerne skal være aktuelle med grenens rækker.** Målingen
ovenfor står på #59 `99a8c30`. Målt igen 3. oktober mod #59 `64faa72` —
fire commits senere (`aaf3a93`, `5498748`, `74cec45`, `64faa72`) — er tre
filer ældre end #59's rækker: `include-filteret.md` 111 mod 5.003 tegn,
`ordet-maalt.md` 1.689 mod 2.165, `det-staerkeste-faldback.md` 107 mod 224.
**5.485 tegn ville gå tabt, mens generatoren melder `uændret` og
`test-faelder` melder ALT GRØNT.** Filerne beskytter de rækker, der ER i
dem; de beskytter ikke mod, at en fil er forældet. Kontrollen «blokken er
det, filerne genererer» er en **konsistenskontrol, ikke en
aktualitetskontrol** — en forældet fil stemmer med en forældet blok.

**Betingelse 2 · «den genererede side» er de to konflikthunks, ikke hele
filen.** Målt: `git checkout --ours CLAUDE.md` kaster også #59's ændringer
**uden for** konflikten bort, altså alt det git ellers havde auto-flettet.
Mod `64faa72` er det 226 diff-linjer prosa, heraf to afsnit uden
forbindelse til tabellen. Konflikten er kun **to** hunks; resten flettes af
sig selv, og den, der tager hele filen, tager dem med.

**«Tag den genererede side» er derfor ikke en ubetinget bevaringsopskrift.**
Opskriften er: opløs de to hunks — blokken fra denne gren, prosaen fra
#59's side — opdatér de filer, hvis rækker den anden gren har skrevet
videre på, kør `npm run faelder`, og sammenhold så resultatet med BEGGE
indgangsrevisioner, række for række og for prosaen uden for blokken.
**Tegnantal og en grøn `test-faelder` dokumenterer ikke bevarelse.**

**Et tab, der IKKE er løst her.** Hele-fil-opløsningen kaster også #59's
prosanote om `ordet-målt`s (d) bort — den står efter tabellen, inde i den
samme konflikthunk. Filerne redder rækkerne, ikke prosaen. Den, der
fletter, skal beholde teksten efter slutmarkøren fra #59's side.

**Tre ting blev afgjort her og kan omgøres med én linje hver.**

1. **Rækken hedder `ordet-målt`, ikke `ordet-maalt`.** Den var den eneste
   række, hvor en dansk form fandtes og ikke blev brugt; filnavnet er
   `ordet-maalt.md` uanset, fordi det er `slug(navn)`. **Følgen er en
   KENDT rød:** #59's prosa nævner `ordet-maalt` to gange uden for
   blokken, og prøvens prosakontrol kræver, at et navn med bindestreg i
   `**…**` eller `` `…` `` findes som række. Lander #59's prosa, står der
   `ukendte: ordet-maalt`. **Rettelsen er de to omtaler i prosaen, ikke
   rækkenavnet** — det er netop den kontrol, der findes for, at en
   omdøbning ikke efterlader en henvisning, der peger på ingenting.
2. **Formen på tre af dem er vores valg.** #59's formlister nævner ikke de
   fire, så der var intet at citere. `ordet-målt` → form 3, fordi rækken
   handler om et svar, der er sandt om noget smallere, end ordet læses som
   — samme familie som `rørets-exitkode` og `transpilerede-positioner`.
   `det-reproducerbare-tal` → form 1: gentagelsen ER forsvaret, og den
   læses som udtømmende. `sammenlagte-påstande` → form 1, fordi én
   påstand læses som tre; dens egen tekst peger på `prøvens-eget-forlæg`s
   familie (form 2), men form 2 er defineret som et værn, der *ikke måler
   det, det handler om*, og det måler den. #59's ejer kan flytte dem ved
   at rette `form:` i filen og køre `npm run faelder`.
3. **Én lodret streg i `den-lånte-årsag` er undsluppet til `\|`.** Den stod
   rå inde i `` `| **navn** ·` `` og ville splitte rækken. Det er
   tabelformatets krav og den eneste ændring i de 5.769 tegn tekst, der blev flyttet.

## Prosaen omkring tabellen

Afsnittene efter tabellen er stadig skrevet i hånden. Prøven tjekker, at
hvert navn med bindestreg, de nævner i `**…**` eller `` `…` ``, findes som
række. Omdøber du en række, skal teksten, der nævner den, med.

## Åben post: den næste sektion — IKKE bygget

faelder/ løser én sektion af CLAUDE.md. Her står, hvor den næste ville
passe, og hvorfor den ikke er bygget. **Én sektion ad gangen:** denne
skal først have vist, at den virker gennem en rigtig fletning.

**Målt 2. oktober 2026.** Ejeren talte kl. 13.35 tolv af nitten åbne PR'er,
der skriver i CLAUDE.md: #38 #48 #50 #51 #52 #54 #55 #56 #57 #59 #60 #61.
Samme tolv er efterprøvet herfra kort efter. CLAUDE.md er 115.078 bytes på
main (`b39329a`).

**At tolv skriver i filen, er ikke det samme som at tolv støder sammen.**
Git fletter hunk for hunk; kun hunks, der overlapper eller ligger op ad
hinanden, giver konflikt. Tabellen er prøveflettet med `git merge-tree`,
par for par. Den er målt igen samme eftermiddag på friske hoveder, over de
17 af 22 åbne PR'er, der bygger på dagens main, og med stakkene talt som
stakke (se næste afsnit). #3, #9, #19, #35 og #40 står på ældre baser og er
ikke med. Formiddagens udgave talte 11 PR'er og #52 og #56 hver for sig;
den er erstattet.

| sted | skrives af (egne ændringer) | par i konflikt | enhedspar |
|---|---|---|---|
| package.json · prøvekædens linjer | 9 — #48 #49 #50 #52 #56 #57 #58 #61 #63 | **36** | **17** |
| CLAUDE.md · fældeafsnittet | 7 — #38 #50 #52 #55 #56 #59 #61 | 11 | 8 |
| CLAUDE.md · «Må aldrig ske» | 7 — #48 #50 #51 #54 #57 #59 #60 | **0** | **0** |
| package.json · øvrige scripts | 6 — #48 #49 #50 #55 #60 #61 | 2 | 2 |
| `db/migrations/meta/_journal.json` | 2 — #51 #57 | 2 | 1 |
| CLAUDE.md · «Testbasen» | 2 — #50 #60 | 1 | 1 |

(Et afsnit er den `## `-overskrift, der står over konfliktblokken. «Egne
ændringer» er målt mod PR'ens base: #56 mod #52, #60 mod #57 og #63 mod
#58. Et **enhedspar** tæller en stak som én PR: et par mod #52 og et mod
#56 er samme konflikt, når den kommer af #52's commit. Prøvekædens linjer
er `test`, `test:kerne`, `test:adaptere`, `test:oekonomi` og `test:besked`.
De står side om side, og #49 skriver dem alle om, så en konflikt i én af
dem er en konflikt i blokken. Målt kl. 15.12 UTC: 48 af de 136 par
konflikter et sted, 38 i package.json og 12 i CLAUDE.md, og 5 af dem i
begge.)

**Første udgave af tabellen talte 34 og 4 her.** Den lagde et par under
prøvekæden, når `test:kerne` stod i konfliktblokken, og under «øvrige»
ellers. Så havnede to par om `test:oekonomi` og `test:besked` under
«øvrige», selv om rækken hedder prøvekædens linjer. Det er
`delmængde-påstanden` i tabellen selv: overskriften lovede alle fem
nøgler, og klassificeringen så på én. Fanget, fordi ejerens måling af de
samme 17 gav 36 og 2.

Tre ting står i tabellen:

- **Fældeafsnittet var det sted i CLAUDE.md, der støder sammen**, og det er
  det, denne mappe er til. Lander #61 efter #54 og #49, bliver seks PR'er
  beskidte i CLAUDE.md, i fem enheder: #38, #50, #52, #55, #56 og #59,
  netop dem, der skriver rækker. Opløsningen er mekanisk: en fil og
  `npm run faelder`. Tre af dem lægger også en ny form, og det er en
  ændring i `FORMER`: #52 lægger «et værn, der findes i KOPIER»; #56, der
  står på #52, lægger «forbrugeren og leverandøren mødes aldrig» oven i; og
  #38 lægger «et værn, der dømmer rigtigt, mens handlingen løber videre ved
  siden af». #52 og #38 kalder begge deres «Form 5»: to forskellige former
  med samme nummer. Formen er nævnt ved sin titel her, ikke ved nummeret,
  af samme grund som rækkerne.
- **«Må aldrig ske» har samme form og lige så mange skrivere, men nul
  konflikter.** Punkterne er selvstændige, hvert med sin fede overskrift,
  og de syv PR'er indsætter dem forskellige steder. Den er den næste
  kandidat efter FORM, ikke efter måling. Byg den, den dag en prøvefletning
  viser par i konflikt dér.
  «Noterede kilder» har også samme form (én post pr. kilde), og ingen åben
  PR skriver i den. Bemærk, at kildenoterne står under TO `## `-overskrifter:
  «Noterede kilder» og «LokalBolig». Den sidste har sit eget niveau og
  rummer også de undersøgte kilder. En opdeling skal samle dem først. #57
  skriver i «LokalBolig».
- **Det sted, der støder mest sammen, ligger ikke i CLAUDE.md.** Det er
  prøvekædens linjer i package.json: 36 af de 38 rå par og 17 af de 19
  enhedspar, hvor package.json konflikter. `test:kerne` alene er én værdi på
  755 tegn, som hver PR med en ny prøve skriver i. Det er samme form som
  tabellen var: ét fælles sted, alle føjer til. **#49 bygger svaret**
  uafhængigt af denne mappe og med samme mønster: hver prøvefil bærer sit
  eget `// gruppe:`-mærke, kæden udledes af filerne, og `test:kerne` bliver
  61 tegn i stedet for 755. Den skal lande FØR denne PR; begrundelsen står
  i #61.

### Stakke — to detektorer, og unionen er svaret

En stablet PR kan ikke læses mod main uden at overtage sin bases arbejde,
og et par-tal, der tæller basen og grenen hver for sig, tæller samme
konflikt to gange. Ejeren målte stakkene over alle 22 åbne PR'er (462
ordnede par), og målingen er efterprøvet herfra:

| stak | base-feltet | `--is-ancestor` | |
|---|---|---|---|
| #3 → #9 | **misser** — feltet siger main | ser den | #9 bærer alle 11 af #3's commits uden for main, plus 43 egne |
| #52 → #56 | ser den | ser den | |
| #57 → #60 | ser den | **misser** | søskende: #57 fik en commit, efter #60 blev skåret. 4 fælles, 1 kun i #57, 2 kun i #60 |
| #58 → #63 | ser den | ser den | |

**At køre én detektor og skrive tallet ned er `delmængde-påstanden` på
selve detektoren.** Begge kommandoer, hver gang, og unionen er svaret:

```sh
# 1 · erklæret: PR'ens base.ref (API'et eller PR-listen) er ikke main
# 2 · forfader: exit 0 = B bærer hele A
git merge-base --is-ancestor refs/remotes/pr/A refs/remotes/pr/B
```

En tredje kontrol, fælles commits uden for main, fandt de samme fire
alene. Den erstatter ikke de to. Målt i et kasseret repo: rebases basen,
efter grenen er skåret, får den nye SHA'er, og så misser både
`--is-ancestor` og de fælles commits stakken, mens grenen stadig bærer
basens ændring. Kun base-feltet ser den da.

**Tvungne rækkefølger:** #3 før #9, #52 før #56 og #58 før #63. #57 og #60
er ikke en rækkefølge, men to grene med fælles ophav, og de flettes som to
grene. **Fletter nogen #9, flettes hele #3 med**, og GitHub lukker #3 som
flettet, uden at nogen har set på den for sig.

**Med CI er to af dem mere end en fletterækkefølge.** Målt 3. oktober: #56
og #63 står på baser uden `proever.yml`, og en PR's workflow læses af
flettecommitten af hoved og base. De får intet check, før #52's og #58's
gren bærer #54. **#52 før #56 og #58 før #63 er dermed også betingelsen
for, at den afhængige PR overhovedet kan MÅLES.** Det er en anden slags
tvang end fletterækkefølgen, og derfor står den her ved den. Alle tre
baser har konflikt med #49 i package.json, så lander #49 som nummer to,
går alle tre kæder gennem den:

    #54 → #49 → #52 opdateres mod main → #56 fletter basen og pushes
    #54 → #49 → #58 opdateres mod main → #63 fletter basen og pushes
    #54 → #49 → #57 opdateres mod main → #60 rettes op mod #57 og pushes

**Mellem #54 og #49 står et vindue, og det lukker.** Det er et tidsrum,
ikke en rækkefølge: en rækkefølge kan tages i eget tempo, et vindue
lukker, når #49 lander. I det kan alle seks få CI uden en eneste
opløsning. Målt ved prøvefletning 3. oktober: hver af de tre baser
opdateres rent mod main med #54, og hver stablet PR fletter sin
opdaterede base rent og får `proever.yml` med. Efter #49 får en base kun
#54 sammen med sin opløsning mod #49.

**Vinduet sparer ingen opløsning; det flytter den.** En base, der er
opdateret i vinduet, har stadig konflikt med main efter #49, nøjagtig som
en, der ikke er. De tre kan heller ikke flettes før #49 for at slippe: de
har konflikt med hinanden parvis, også i package.json. Det, vinduet
køber, er en MÅLING FØR OPLØSNINGEN: seks PR'er får CI tidligere, og en
rød kørsel efter opløsningen mod #49 kan skelnes fra én, der var rød i
forvejen. Prisen er to opdateringer af hver base i stedet for én, og at
#49 og alt bag den venter, så længe vinduet holdes åbent.

**#60 er den vanskelige.** Dens base peger på #57's gren, men #57 er ikke
forfader: fælles ophav `9aa215c`, og #57 har nu to commits, #60 mangler
(`7ff1f1d` og `6bebccb`, begge lagt efter #60's sidste; i går én). At
flette basen ind er samme kommando som for #56 og #63 og går rent i dag,
men det er en anden opgave: den bringer kode ind, #60 aldrig er kørt med,
og den mangler allerede nu, uafhængigt af #54. Opdateres #57's gren med
rebase i stedet for fletning, får de fire fælles commits nye SHA'er, og så
er det en `rebase --onto`, en tredje opgave. Og GitHubs egen prøvefletning
for #60 står stadig på `9aa215c` (`base.sha` og flettecommittens første
forælder), mens grenen står på `6bebccb`: «ren» på PR-listen er målt mod
en base, grenen har forladt.

**Og tæl commits mod `origin/main` efter en fetch.** Talt mod main, som den
stod 6. september (`81a2edf`, 167 commits bag), var #9, #40, #35 og #19 på
129, 135, 126 og 122 commits; mod main i dag er de 54, 1, 4 og 2. Hvem der
er en stak, ændrer det ikke. Men det ændrer, hvor stor en gren er, og hvor
meget af konflikttallet den kan forklare.

### Trufne valg — så de ikke genbesluttes

Begge er tilbageholdenhed, og den slags er svær at se som arbejde. Derfor
står de her som beslutninger, besluttet 2. oktober 2026.

- **Afsnitstilskrivningen er IKKE automatiseret.** Målingen ovenfor lægger
  hver hunk på den `## `-overskrift, der står over den. Det er en grov
  regel: en hunk i tabellen og en i prosaen under samme overskrift ser
  ens ud. Og det er et øjebliksbillede, der er forældet ved næste push. Et
  script, der kørte den på hver PR, ville give et tal, der så præcist ud
  og ikke var det. I stedet skriver hver session i sin PR-tekst, hvilke
  afsnit af CLAUDE.md den rører, og om den har rækker i tabellen.
- **«Må aldrig ske» er IKKE delt op.** Formen passer, men målingen bad
  ikke om det: syv skrivere og nul konfliktpar. At dele den nu ville løse
  et problem, der ikke er målt, i en fil, syv åbne PR'er skriver i. Byg
  den, når en prøvefletning viser par i konflikt dér.

Grundfejlen, de to valg værner imod, er at tælle berørte filer og slutte
om konflikter. Det er form 1 igen: et tal, der svarer på et smallere
spørgsmål end det, man læser det som.

**Mål igen, før noget af det bygges** — tallene ovenfor er et øjebliksbillede:

```sh
git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'
git merge-tree --write-tree --name-only refs/remotes/pr/50 refs/remotes/pr/61
# exit 1 = konflikt; de konfliktende filer står på linjerne efter træ-id'et
```
