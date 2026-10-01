# Runde 3: mobilen, fotoet, to fejl og farven på «Søg»

> **Runde 4 vender anbefalingen til B** og måler den på første boligkort over folden. Krediteringen flyttes nu med CSS alene, og markupflytningen nedenfor er trukket tilbage: [GREB-4.md](GREB-4.md). Det, der står her, gælder, hvor runde 4 ikke siger andet.

30. september 2026. Runde 2 er godkendt som retning ([GREB.md](GREB.md)). Her
er de fire rettelser i den rækkefølge, de blev bedt om, plus observationen
om mærkaten og status for netværket.

**Dataene er stadig syntetiske.** Værterne svarer stadig 403 fra proxyen
(efterprøvet 30. september kl. 14.34 UTC). Og listen over de fem værter fra
runde 2 var forkert. Se [Netværket](#netværket-og-hvad-der-skal-køres-når-det-er-åbent)
for den rigtige liste. Når de er åbne, tager
[`gengivelse/runde3.sh`](gengivelse/runde3.sh) alle billeder og tal om med én
kommando.

`app/globals.css` og `app/Boligkort.tsx` er ikke rørt. Alt ligger i laget
(`forslag.css`, `greb.css`, `greb.js`) og i [`heltefoto.json`](heltefoto.json).

## 1 · Mobilen

Målt i 390 og 360 på forsiden. Alt kommer fra `maal.json` i
[`greb3/`](greb3).

- **Tegning tilbage** er, hvor meget af fotoets kanter og detaljer der står
  tilbage, som siden tegner det. Det måles over den del af fotoet, der står
  fri af søgekortet. 1 betyder urørt. Slørets egen dithering er målt over en
  flad flade og trukket fra (nulpunkt ~0,1), og tallet er klippet til 0–1.
- **Kontrasten** er den værste mod de faktiske pixels bag teksten.
- **«Populære søgninger»** er målt to gange: med seedets fire byer, sådan
  som siden står, og med seks lange danske bynavne (København NV,
  Frederiksberg C …) som belastningsprøve. Kolonnerne viser rækker,
  venstrekanter og mellemrum.

| Bredde | Tilstand | Første kort (px) | Mod i dag | Tegning tilbage (fri højde) | Øjenbryn | h1 | Manchet | Kreditering | Populære, seed | Populære, belastet | Vandret rul |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 390 | Før (appen i dag) | 571 | +0 | 0,18 (221 px) | 7,64 | 9,39 | 6,40 | øverst, i første visning | 2 r · 2 kanter · 16 px | 3 r · 2 kanter · 16 px | 0 |
| 390 | Runde 2 | 622 | +51 | 0,14 (267 px) | 6,87 | 14,50 | 14,40 | øverst, i første visning | 2 r · 2 kanter · 24/28 px | 3 r · 2 kanter · 24/28 px | 0 |
| 390 | A · fotobånd | 671 | +100 | 1,00 (130 px) | 7,13 | 16,63 | 16,63 | fodnoten | 2 r · 1 kant · 16 px | 3 r · 1 kant · 16 px | 0 |
| 390 | B · mørkt slør | 573 | +2 | 0,43 (195 px) | 5,48 | 6,83 | 5,67 | fodnoten | 2 r · 1 kant · 16 px | 3 r · 1 kant · 16 px | 0 |
| 360 | Før (appen i dag) | 571 | +0 | 0,18 (221 px) | 7,69 | 9,39 | 6,40 | øverst, i første visning | 2 r · 2 kanter · 16 px | 3 r · 2 kanter · 16 px | 0 |
| 360 | Runde 2 | 645 | +74 | 0,14 (291 px) | 6,87 | 14,63 | 14,36 | øverst, i første visning | 2 r · 2 kanter · 24/28 px | 4 r · 2 kanter · 24/28 px | 0 |
| 360 | A · fotobånd | 684 | +113 | 1,00 (120 px) | 7,13 | 16,63 | 16,63 | fodnoten | 2 r · 1 kant · 16 px | 4 r · 1 kant · 16 px | 0 |
| 360 | B · mørkt slør | 596 | +25 | 0,43 (219 px) | 5,48 | 6,83 | 5,67 | fodnoten | 2 r · 1 kant · 16 px | 4 r · 1 kant · 16 px | 0 |

**Fotoet.** I runde 2 stod fotoet med 0,14 af sin tegning på 390, mod 0,18 i
appen i dag. Runde 2 gjorde altså telefonen værre, ikke bedre. Du så
rigtigt: sløret er 92–95 % hvidt over de øverste 55 % af heroen, fordi en
smal skærm ikke har en venstre side at lægge teksten i. De to løsninger:

- **A · fotobånd** (`.m-baand`). Fotoet står som et lavt bånd på 3:1 øverst
  i fuld bredde, uden slør. Teksten står under det, på papiret. Intet står
  på fotoet, så kontrasten afhænger ikke af det. Fotoet står helt (1,00),
  men lavt: 130 px på 390. 12:5 og 5:2 viste det samme motiv og kostede 32
  og 26 px mere på 390
  ([`maalinger/hero-detaljer.json`](maalinger/hero-detaljer.json)).
- **B · mørkt slør** (`.m-moerk`). Teksten står hvid på fotoet. Sløret er af
  blæk, tættest bag teksten, og letter mod søgekortet. Fotoet står med 0,43
  af sin tegning med objektets slør på 0,60, som er det krævede 0,55 plus
  0,05 i margen (se 2). Et foto med mellemtoner kræver mindre slør, og så
  står mere af det.

**Folden, målt mod appen i dag** (første kort 571 px på 390, 571 på 360):

| | 390 | 360 |
|---|---|---|
| A · fotobånd | +100 px | +113 px |
| B · mørkt slør | +2 px | +25 px |
| A mere end B | +98 px | +88 px |

Tallene skal læses med luften: begge varianter har 32 px mellem søgekortet
og «Nyeste boliger». Appen i dag har 2 px, og runde 2 havde 8
([`maalinger/hero-detaljer.json`](maalinger/hero-detaljer.json)). Runde 2's
telefonregler for luften var døde: de blev overstyret af reglerne for bred
skærm, som stod senere med samme specificitet. Omkring 30 af de pixels, en
variant koster mod i dag, er altså luft, som mangler i dag.

**Anbefalingen afhænger af det nye foto, og målingen afgør den.**

- **B** koster næsten ingen fold: +2 px på 390 og +25 på 360 mod i dag. Den
  ligner bred skærm, med teksten på fotoet. Men med det nuværende, lyse foto
  står kun 0,43 af tegningen tilbage, og det er for lidt til, at fotoet
  bærer siden.
- **A** koster +100 og +113 px. Til gengæld kan kontrasten aldrig gå tabt,
  uanset foto.

**Reglen:** kræver Johns foto højst 0,45 slør i variant B i `maal-foto.mjs`,
er B rigtig. Så bliver objektets slør 0,50, og mindst halvdelen af fotoets
tegning står tilbage bag teksten (målt: 0,53 ved 0,50 og 0,43 ved 0,60,
[`maalinger/hero-detaljer.json`](maalinger/hero-detaljer.json)). Kræver det
mere, er A rigtig. Med det nuværende foto er svaret A.

**Krediteringen** står ikke længere øverst. Den er flyttet til sidens
fodnote, `footer.bund`, som `page.tsx` selv tegner, så foto og navn stadig
er ét objekt. Den står som en sætning i 12 px med kontrast 7,13. Pillen var
10,5 px hvid tekst på mørkegråt og stod som det første i første visning.

Flytningen er en ændring i markuppen og ikke i CSS'en. Laget skjuler ikke
`.hero-kredit`: landede CSS'en uden markuppen, forsvandt krediteringen helt.
Kræver et fremtidigt fotos licens kreditering ved billedet, er det feltet
`kreditVedBilledet`. Så længe billedteksten under båndet ikke er bygget,
afviser `maal-foto.mjs` sådan et foto.

**«Populære søgninger»** fik to rettelser:

- **Hullet.** Runde 2 lagde margin oven i gap'en, så mellemrummene blev 24
  og 28 px, hvor gap'en er 16. Nu er afstanden gap'ens alene.
- **Skævheden.** Etiketten stod i første række, så første række begyndte
  under etiketten og anden under byerne: to venstrekanter i én blok. På en
  telefon får etiketten nu sin egen linje, og hver række begynder med en by
  ved samme kant. Blokken står under nålen i søgefeltet og ikke 14 px
  længere ude end den.

**Tre ting mere på telefonen,** fundet ved at se på billederne:

- ~~**Søgesidens titel** brækkede bynavnet midt over, «København / N». Titlen
  får nu hele bredden, og «Sortér» går under den. Stednavnet bør desuden stå
  i et span med `white-space: nowrap` (Frontend).~~

  > **Rettet 1. oktober 2026: det var ingen rettelse, og fejlen var lagets
  > egen.** Bruddet opstår først med laget. `forslag.css` satte søgetitlen
  > til 32/28 px over `globals.css`' 22/20 px, og ved den størrelse brækker
  > bynavnet («Prøveby / N» på 360). Uden laget står titlen hel
  > («Lejeboliger i / Prøveby N (76)», `greb3/foer/soegning-360.png`).
  > Reglen, der skulle rette det, kunne ikke virke: `globals.css` sætter
  > `flex-wrap: nowrap` på `.sidetitel.resultat-titel` under 620 px.
  > Eksemplet «København / N» havde intet billede bag sig; testbasens byer er
  > opdigtede. Den blev givet videre til Frontend som en fejl i appen, og
  > forslaget om et span med `nowrap` i `page.tsx` løser ikke noget, appen
  > har. Rettet i laget: titelstørrelsen gælder kun over 620 px
  > (`forslag.css`), og den virkningsløse regel er fjernet (`greb.css` § 9).
  > Fundet af kortlægningen før del A (#39).
- **Boligsiden på 360** havde ingen højre margen (22 px til venstre, 1 til
  højre). Det er en ældre fejl: i dag giver den 15 px vandret rul.
- **«Filtre»** er nu den samme indrammede knap på forsiden som på søgesiden.

**1440** er uændret i folden: første kort står 649 px nede mod 599 i dag.
Runde 2's 649 står i [GREB.md](GREB.md).

## 2 · Fotoet: ét sted at skifte det, og en måling der kan sige nej

Det nuværende foto er rigtigt og licenseret, men hvidt på hvidt: højlys,
blæst vindue, intet fokuspunkt. Det løser ingen CSS. John finder tre
kandidater efter kriterierne i [GREB.md](GREB.md#1--hero-i-fuld-bredde).
Her er det, der skal til, for at de kan prøves og skiftes ind.

### Ét sted

`page.tsx` samler allerede url og kreditering i `HERO_STANDARD`, fordi «hvilket
billede, og hvem har taget det» er ét spørgsmål. Forslaget lægger de felter
til, der afhænger af MOTIVET: fokuspunkt og slør. Alt andet i laget er
uafhængigt af, hvilket foto der står.

| Felt | I dag | Hvad det styrer |
|---|---|---|
| `url`, `kredit` | findes i `HERO_STANDARD` | billedet, og fodnoten (se 1) |
| `licens`, `kreditVedBilledet` | nyt | om fotoet må bruges, og om krediteringen må stå i fodnoten |
| `fokus`, `fokusSmal` | nyt (i dag hårdkodet i CSS) | `object-position` på bred skærm og på telefon |
| `sloer`, `sloerSmal` | nyt (i dag hårdkodet i CSS) | underlaget bag teksten på bred skærm, og variant B's mørke slør |

I forslaget er objektet [`heltefoto.json`](heltefoto.json). `greb.js` sætter
felterne som CSS-variabler på `.hero`, og `greb.css` læser kun variablerne.
I appen bliver det til:

```tsx
const HERO_STANDARD = {
  url: '/hero-stue.jpg',
  kredit: 'Stemningsfoto: Taryn Elliott / Pexels',
  licens: 'Pexels', kreditVedBilledet: false,
  fokus: '60% 50%', fokusSmal: '50% 66%',
  sloer: 0.95, sloerSmal: 0.60,   // krævet (maal-foto.mjs) + 0,05; 0,95 er runde 2's godkendte værdi, krævet er 0,80
} as const
// …
<section className="hero …" style={{
  '--hero-fokus': hero.fokus, '--hero-fokus-smal': hero.fokusSmal,
  '--hero-sloer': hero.sloer, '--hero-sloer-smal': hero.sloerSmal,
} as React.CSSProperties}>
```

`NEXT_PUBLIC_HERO_FOTO` kan fortsat overstyre url og kreditering, men så skal
fokus og slør også kunne følge med. Ellers står et nyt motiv med det gamle
fotos fokuspunkt.

### Målingen: [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs)

```sh
node docs/designforslag/gengivelse/maal-foto.mjs <udmappe> kandidat1.jpg kandidat2.jpg kandidat3.jpg
```

Kandidaten serveres gennem en opsnappet rute og sættes ind via fotoobjektet.
Det er samme vej, et nyt foto skal ind i appen, og hverken `public/` eller
koden røres. Ligger der en `kandidat1.json` ved siden af, bruges dens
kreditering, licens, fokus og slør. For hver kandidat måles 1440 px, samt
begge telefonvarianter i 390 og 360:

- **Værste kontrast** for øjenbryn, h1 og manchet mod de faktiske pixels bag
  dem. Teksten gøres gennemsigtig, fladen bag dens egen udstrækning
  fotograferes, og det dårligste pixel tæller. Gennemsigtig tekst regnes som
  den blanding, øjet ser. Tærsklen er WCAG AA: 4,5:1, og 3:1 for h1.
- **Slør krævet.** Det er det tyndeste ensartede slør, der ville få al tekst
  igennem på netop dette foto. Det regnes på de rå fotopixels med sløret
  slukket.
- **Tegning tilbage.** Det er fotoets kanter og detaljer (lokal
  luminansforskel mellem nabopixels), som siden tegner det, delt med det rå
  fotos. Der måles over den del, der står fri af søgekortet. Slørets egen
  dithering er målt over en flad flade og trukket fra. 1 betyder urørt, og
  0,4 betyder, at sløret har taget 60 %.

**Dommen er AFVIST** i tre tilfælde:

- **Kontrasten.** Én tekst i én bredde falder under tærsklen med det slør,
  objektet angiver.
- **Loftet.** Variant B kan kun bære teksten med et slør over 0,60. Et næsten
  sort slør kan altid bære hvid tekst, også over hvidt (det kræver cirka
  0,6–0,65), så spørgsmålet er ikke, om teksten kan bæres. Det er, hvad det
  koster fotoet: ved 0,60 står 43 % af dets tegning tilbage bag teksten, og
  over loftet mindre.
  Så er svaret variant A eller et andet foto, ikke et tykkere slør.
- **Rettighederne.** Fotoobjektet mangler licens eller kreditering, eller
  licensen kræver kreditering ved billedet, som laget endnu ikke kan.

Kommandoen slutter med exit 1 ved et afslag.

**Slør-reglen:** objektets slør er det krævede plus mindst 0,05. Variant B's
0,60 er det krævede 0,55 plus 0,05. Med sløret af blæk kræver fotoet 0,55;
med den grønne tone, sløret havde før, krævede det 0,50. Bred skærms 0,95 er runde 2's godkendte
værdi og ligger over reglen, for målingen kræver 0,80.

**Selvprøven** (`--selvproeve`) viser, at målingen kan sige nej, og ad alle
tre veje. Den har fem tilfælde med kendt facit, og alle fik deres facit:

| Tilfælde | Facit | Dom | Hvorfor |
|---|---|---|---|
| Det nuværende foto med sit objekt | bestået | bestået | bestået i alle fem kombinationer |
| Samme foto, variant B's slør sat ned til 0,20 | afvist på kontrasten | afvist | 390 moerk: øjenbryn 2,38:1 < 4,5:1; h1 2,63:1 < 3:1; manchet 2,17:1 < 4,5:1 · 360 moerk: øjenbryn 2,38:1 < 4,5:1; h1 2,63:1 < 3:1; manchet 2,16:1 < 4,5:1 |
| Mørklagt udgave (prøveattrap), bredt underlag 0,20 | afvist på kontrasten | afvist | 1440 bred: øjenbryn 1:1 < 4,5:1; h1 1,39:1 < 3:1; manchet 1,39:1 < 4,5:1 |
| Overbelyst udgave (prøveattrap), B's slør sat op til 0,80 | afvist på loftet | afvist | 390 moerk: kræver slør 0,65 > loftet 0,6 · 360 moerk: kræver slør 0,65 > loftet 0,6 |
| Det nuværende foto uden licens i objektet | afvist på rettighederne | afvist | kun rettighederne: ingen licens i fotoobjektet |

Det nuværende foto, målt:

| Bredde | Variant | Øjenbryn | h1 | Manchet | Slør (objekt) | Slør krævet | Tegning tilbage |
|---|---|---|---|---|---|---|---|
| 1440 | bred | 6,40 | 14,80 | 14,35 | 0,95 | 0,80 | 0,65 |
| 390 | baand | 7,13 | 16,63 | 16,63 | – | – | 1,00 |
| 390 | moerk | 5,48 | 6,83 | 5,67 | 0,60 | 0,55 | 0,43 |
| 360 | baand | 7,13 | 16,63 | 16,63 | – | – | 1,00 |
| 360 | moerk | 5,48 | 6,83 | 5,67 | 0,60 | 0,55 | 0,44 |

**Det nuværende foto består, og det er ikke et argument for det.** Hvid tekst
kræver 0,55 slør i variant B, fordi fotoet er lyst. Mørk tekst på bred
skærm kræver 0,80, fordi en dørkarm i mørkt træ og et køleskab står bag
øjenbrynet i fotoets venstre kant: 39 % af pixelene bag det er mørke
(luminans under 110 af 255). Målingen svarer på, om et foto kan bære tekst, ikke på, om det
har et motiv. Det sidste afgør et øje.


## 3 · To fejl, der står i mine egne billeder

### Prisspændet: målt og sendt til Frontend

Chippen «7.270–25.390 kr/md» er `min`/`max` af `coalesce(total, husleje)`
(`lib/soeg.ts:119`, `:1180–1181`, `:1263–1264`). Målingen går gennem sidens
egne `soeg()` og `opsummering()`, altså samme filtre og dedup. Hver søgning er
krydstjekket mod det viste tal. Alle tal er fra den syntetiske base.

| | Attrapby (71) | Prøveby N (76) |
|---|---|---|
| Kun husleje | **6**: 7.360 · 10.320 · 10.390 · 20.780 · 21.290 · 23.200 | **7**: 6.110 … 18.430 |
| Vist spænd | 7.270–25.390 | 6.110–24.010 |
| Kun kendte totaler | **7.270–25.390**, det samme | **7.450–24.010** |
| Endepunkt, der er en husleje | ingen | den nedre, 6.110 (Enkeltvej 36 26) |

Attrapbys spænd er altså rigtigt ved et tilfælde: de 6 huslejer ligger inden
for det. Linjen dækker stadig 6 boliger, den ikke kan stå inde for, og de 6
kan ikke ses. I Prøveby N er selve tallet forkert. Af 8 søgninger (4 steder)
blander alle 8, og 2 har en husleje som endepunkt.

**Samme udtryk med omvendt etiket på områdesiderne.** `statistik()` i
`lib/omraade.ts:122–124` har sin egen kopi af `coalesce(total, husleje)`, og
siden kalder resultatet «husleje». Det gælder både metabeskrivelsen, som
Google viser («Husleje 7.270–25.390 kr. om måneden»), og brødteksten. 7.270 er
en kendt total. På alle 8 områdesider er mindst ét «husleje»-endepunkt en
total.

Sendt som issue til Frontend med tallene, kodestederne, forslaget fra runde 1
og en acceptprøve, der fejler i dag: [ukutuku/Bofinda#36](https://github.com/ukutuku/Bofinda/issues/36). Scriptet, der giver
produktionens tal, er [`maalinger/maal-prisspaend.mjs`](maalinger/maal-prisspaend.mjs)
(kun `select`, med `--proeve` mod PGlite). Det er ikke rettet her.

### «0 med indflytningspris»: tærsklen er N = 0, og fraværet får en sætning

Chipsene er rene udsagn og ikke filtre (ingen href, ingen fokus). På desktop
har de dog præcis en filterchips form: 29 px, pilleradius. En pille med «0»
ligner derfor en facet uden træf.

Men nul-chippen er i dag det **eneste** sted, fraværet står. Enkeltkortet
tegner kun indflytningslinjen, når prisen findes (`Boligkort.tsx:340–344`).
Boligsiden viser kun blokken, når indflytningspris, depositum eller
forudbetalt leje findes (`bolig/[id]/page.tsx:106`, `:303`). At skjule chippen
uden erstatning ville bryde «En manglende oplysning skal være synlig, ikke
fraværende».

**Forslaget:**

- **«N med indflytningspris»** tegnes kun ved N ≥ 1.
- **Ved N = 0** står der i stedet én linje under rækken: *«Ingen
  indflytningspris for de 71 — spørg udlejeren.»*
- **Ingen andelstærskel.** «2 med indflytningspris» ud af 400 *er*
  advarslen. En andelstærskel ville kun vise tallet, når det flatterer os.
- **«N med samlet pris til udlejer» får ingen tærskel.** Den kvalificerer
  spændet ved siden af den. Ved 0 er hele spændet huslejer, og det er det
  vigtigste, rækken kan sige.

Målt i browseren med DOM'en ændret:

- **1440:** sætningen fylder én linje, og hovedet vokser 23 px.
- **390 og 360:** hovedet vokser 4 px, og rækken holder sig på én linje. I
  dag brækker den i to, og anden linje begynder med «·».

Seedet har 0 indflytningspriser (0 af 280), så nullet står i alle 234
søgninger, rækken vises i. Det er en egenskab ved seedet. I produktionen
sætter home.dk, CEJ, Birch og Alabu aldrig feltet (`adapters/home.ts:24–26`
m.fl.), så nullet står ved hvert kildefilter på dem.
[`maalinger/maal-chips.mjs`](maalinger/maal-chips.mjs) måler det, når nogen
med adgang kører den.

**Fundet undervejs, kun læst i koden.** Gruppekortets indflytningspris
(`Boligkort.tsx:567–576`, `lib/soeg.ts:821–822`) er `min`/`max` af
`move_in_cost`, og null springes over. Et kort kan derfor skrive «indflytning
15.000 kr.» om fem boliger, hvor kun én har prisen. Det strider mod «Kortet
påstår kun det, der gælder for hele gruppen». Fejlen kan ikke gengives her
(seedet har ingen priser) og står i samme issue.


## 4 · Er «Søg» --kendt? Nej, men ordmærket var

Målt med `getComputedStyle` i browseren og ikke læst i CSS'en. Den farve,
øjet ser, er regnet med elementets egen dækning. Værdierne er ens i 1440, 390
og 360 og på alle fire sider, hvor elementet findes.

| Element | Før (appen i dag) | Runde 2 | Runde 3 | Token i runde 3 |
|---|---|---|---|---|
| «Opret annonce» (flade) | `#0f4d43` | `#14161a` | `#14161a` | `--blaek` |
| «Søg» (flade) | `#0f4d43` | `#083a34` | `#083a34` | `--handlingsflade` |
| Ordmærket «BOFINDA» (tekst) | `#0f4d43` | **`#0f4d43`** | `#14161a` | `--blaek` |
| Nålen i søgefeltet | `#0f4d43` à 72 % → ses som `#527f78` | `#14161a` à 72 % → `#56575a` | uændret | `--blaek` |
| Nålen ved adressen på boligsiden | `#5f6672` à 60 % → `#9c9fa5` | `#4d5452` à 60 % → `#919492` | uændret | `--daempet` |
| Markørerne på kortet | `#0f4d43` | `#14161a` | uændret | `--blaek` |

**«Søg» er ikke `--kendt`.** Den er `#083a34`, og i runde 2 hed den
`--flade-groen`. Det er i øvrigt appens eget `--accent-mrk` (hover-farven på
den gamle accent), ikke en ny farve.

**Ordmærket var `--kendt`.** Runde 1 satte det dér med vilje, som «brandets
ene plads» (`forslag.css`). Det gjorde teal til to ting, og netop det
fangede du. **Kortnålene var teal i appen i dag**, men ikke i runde 2: dér
var de blæk, fordi runde 1 peger `--accent` om til `--blaek`.

**Fejningen af runde 2** gik alle fire sider igennem i 1440 og 390, hvert
synligt element med pseudo-elementer og svg
([`maalinger/farver.md`](maalinger/farver.md)). Den ledte efter grøn i
`color`, baggrund, kant, `fill`, `stroke`, outline og understregning. Grøn
**tekst** stod fire steder:

- `.kort-pris` (160 forekomster): kendt beløb.
- `.oek-tal`: railens beløb, kendt.
- `dt.kendt` på båndet: 252. Det er et **antal** boliger med kendt total,
  ikke et beløb.
- `a.maerke`: ordmærket.

Grøn **flade** stod tre steder: «Søg», «Se annoncen» og udlejerbåndet. Den
ene fremmede farve var Leaflets blå link på kortets kreditering, `#0078a8`.

**Fejningen af runde 3** gik videre end det. Den tog alle kulører, ikke kun
grøn, og læste også gradienter, skygger og `accent-color`. Den kørte på alle
fire sider plus en søgning med filterchips, i 1440, 390 og 360 og i begge
telefonvarianter. Den fandt de tre rester nedenfor, som ikke var set før:
chipsene, skyggen og B's slør. Efter rettelserne er den kørt igen
([`maalinger/farver-runde3-fejning.txt`](maalinger/farver-runde3-fejning.txt)),
og hex-værdierne i tabellen er målt i den kørsel
([`maalinger/farver-runde3.json`](maalinger/farver-runde3.json)). To kulører står
uden for rollerne med vilje:

- `--advarsel` (`#8a5300`) står på en note om udeladte data. Den er en
  advarsel og ikke en handling.
- Leaflets flag står i kortets kreditering. Det er Leaflets eget præfiks og
  kan fjernes med `attributionControl.setPrefix(…)` i `Landkort.tsx` uden at
  røre OSM-krediteringen (Frontend).

**Og ved hover.** Fejningen måler hvilefarver. Farveagenten målte også
hover: «Søg» gik til `#0b4a42`, som ligger **ΔE00 1,27** fra `--kendt`. Knappen
blev altså den kendte teal, netop når nogen rørte den.

**Rettet i runde 3:**

- **Hover** går nu mørkere, til `#052a25`. Den ligger ΔE00 11,2 fra
  `--kendt` og 5,1 fra hvilefarven, så skridtet er lige så synligt som før,
  bare den anden vej.
- **252 på båndet** er blæk som 279 over den. Grøn tekst står kun på et
  beløb.
- **Ordmærket** er blæk.
- **Filterchipsene** (en valgt tilstand) havde kant og «×» i `--kendt`s RGB,
  og **den valgte side** i sidevælgeren havde en teal skygge. Begge er blæk.
- **Variant B's mørke slør** var bygget af `rgb(10 20 18)`, en tredje,
  unavngiven grøn flade. Det er nu blæk.
- **Håndskriftsvarianten** er blæk; den var grøn tekst.
- **Kortets kreditering** er blæk. Den står stadig og er synlig.
- **Den anden grønne** hedder nu `--handlingsflade` og har sin egen
  begrundelse i `greb.css`, lige under `:root`.

Reglen, som den står der:

> Grøn **tekst** (`--kendt`) = hele betalingen til udlejer er kendt. Kun på
> et beløb. Grøn **flade** (`--handlingsflade`) = her handler du. Kun som
> baggrund: sidens ene primære knap og udlejerbåndet. De bytter aldrig. Alt
> andet, der kan trykkes på eller er valgt, er blæk.

**Nuancen bærer ikke forskellen, og det skal den heller ikke.**
ΔE00 mellem `#0f4d43` og `#083a34` er **6,2**: samme familie, kun til at
skelne side om side. Mellem `#083a34` og blæk er den 19,3. Formlen er prøvet
mod alle 34 af Sharmas testpar før brug. Et øje, der ikke
skelner de to grønne, læser stadig rollen rigtigt. Den ene er altid en flade
med hvid tekst, den anden altid et tal med «til udlejer» efter sig.

Skal farven selv skille dem, er alternativet «Søg» i blæk som «Opret
annonce». Så er grøn kun kendt beløb og båndet. Det er ikke lagt ind, fordi
runde 2 bad om én mørkegrøn handling.


## Observationen: «Ny i dag» på næsten hvert kort

Produktionen kan ikke nås herfra, så tallet er et **skøn**, og kommandoen, der
måler det, ligger klar. Hele gennemgangen står i
[`maalinger/ny-maerkat.md`](maalinger/ny-maerkat.md).

**Svaret:**

- **Af hele bestanden bliver «Ny i dag» aldrig flertallet.** Andelen er nye pr.
  døgn delt med bestanden: cirka 1,3–1,9 % ved skønnet, og 1–5 % over hele
  følsomhedstabellen i notatet.
- **På forsidens første side bliver den flertallet.** «Nyeste» er
  standardsorteringen, så de 48 kort er netop de nyeste. Dagens mærkat
  (under 72 t) står på alle 48, så snart der kommer 16 nye i døgnet. «Ny i
  dag» (under 24 t) står på flertallet fra cirka 24 nye i døgnet.
- **Skønnet er 25–35 nye pr. døgn.** Så står «Ny i dag» på cirka 25–35 af 48
  kort (52–73 %).
- **Mekanismen kan ses i den syntetiske base.** Kun 12,9 % af bestanden har
  mærkaten, men den står på 12 af de første 12 kort.

**Hvor skønnet kommer fra:** bestanden er 1.864 synlige (23. september,
`lib/grundlag.ts:19`). Levetiden er afledt af det eneste tal i repoet, der
siger noget om den: en medianalder på 37 dage ved første syn for varslerne i
én prøvekørsel (`lib/alarm.ts:29–31`). Det er et spinkelt grundlag.
Tilgangen pr. døgn står intet sted i repoet. `npm run puls` regner den, men
dens udskrift er aldrig gemt.

**To rettelser til premissen:**

- **Registret har 11 rigtige kilder, ikke seks** (`adapters/index.ts:51–119`).
  Kun fire af dem sætter kildens egen dato: CEJ, findbolig, LokalBolig og
  Propstep. For de øvrige syv er «ny» det tidspunkt, vi så boligen.
- **Min omdøbning i runde 2 var forkert.** `greb.js` gættede dagen ud fra
  `siden()`'s afrundede tekst. «Ny i dag» betød derfor under 23,5 timer og
  ikke i dag: kl. 08 kaldes en bolig fra i går kl. 12 «Ny i dag». Kun
  ordlyden er forslaget. I appen skal ordet regnes af `NYHEDSDATO` (så
  indkøringsvagten følger med) og kalenderdagen i København. Den findes
  allerede som `kalenderdag()` i `lib/dato.ts:45`. Kommentaren i `greb.js`
  siger det nu.

**Beslutningsreglen:** mål på den side, brugeren ser, ikke på bestanden.

1. Står mærkaten på over halvdelen af forsidens side 1, skal 72-timers
   vinduet væk. Reservér mærkaten til «Ny i dag» efter kalenderdag, regnet
   som ovenfor.
2. Står «Ny i dag» stadig på over halvdelen (målt om eftermiddagen), skal den
   ikke vises pr. kort under «nyeste». Listen er allerede ordnet efter alder,
   så mærkaten siger kun, hvor de nye holder op. Vis det som ét skel i
   listen, fx «I dag · 31» over de første kort. Pladsen på fotoet kan så gå
   til «Kan overtages nu».
3. Behold mærkaten pr. kort under andre sorteringer, og i søgninger, hvor den
   står på under halvdelen af side 1. Dér skelner den.

Tærsklen er 50 % af den viste side, og den gælder alle mærkater på fotoet.
Kortets egen kommentar (`Boligkort.tsx:207–208`: mærkaten betyder noget,
«netop fordi den er sjælden») holder for bestanden, men ikke for en liste
sorteret nyeste først.

**Kommandoen**, kørt fra roden af en checkout med `.env`, to gange: cirka kl.
08 og kl. 17, fordi kalenderdagen afhænger af klokkeslættet.

```sh
ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json --env-file=.env \
  docs/designforslag/maalinger/maal-ny.mjs --maal prod
```

(Rettet i runde 4: `--maal prod` står i kommandoen og skal svare til den
base, `.env` peger på, ellers exit 3. Før stod der `--base`, og målet var
det, der tilfældigvis stod i miljøet. Se [GREB-4.md](GREB-4.md#4--kommandoen-i-dokumentationen).)

Scriptet gør følgende:

- Det går gennem sidens egne `soeg()` og `soegGrupperet()`.
- Det læser mærkaten ud af de rigtige kort, gengivet med
  `renderToStaticMarkup`.
- Forbindelsen står som `default_transaction_read_only = on`, og det
  efterprøves før og efter målingen.
- Port 6543 afvises.

`--proeve` kører mod PGlite med 18 boliger, lagt på begge sider af
grænserne, og består. Tre bevidst indførte fejl gjorde den rød: kalender i UTC, 48 t i
stedet for 72, og kildens dato ignoreret.


## Netværket, og hvad der skal køres, når det er åbent

**Listen fra runde 2 var forkert.** Den nævnte `nova-api.jeudan.dk`, men
Jeudan har ingen adapter og hentes ikke. Og den manglede to værter:

- `app.propstep.com`, hvor Propsteps billeder ligger (`lib/billede.ts:41`);
- `api.balder.dk`, som er Balders API (`adapters/balder.ts:45`).

Uden `app.propstep.com` får Propsteps 764 boliger (4. september) ingen billeder. Så ville
billederne være lige så syntetiske som i dag, bare tomme.

| Kilde | Sider/data | Billeder | Andet |
|---|---|---|---|
| Propstep (flest boliger og billeder) | `propstep.com` | `app.propstep.com` | — |
| Dacas | `dacas.dk` | `dacas.dk` | — |
| Balder | `www.balder.dk`, `api.balder.dk` | `images.ctfassets.net` | `BALDER_API_KEY` som hemmelighed i miljøet |

Propstep alene giver et forside-net med rigtige fotos. Netværksadgangen
ændres i miljøets indstillinger: miljømenuen i sessionens titellinje →
Edit → Network access, enten med et bredere niveau eller med værterne ovenfor
på listen over tilladte domæner. Når de er åbne:

```sh
scripts/cloud/op.sh                                          # base + app, som før
docs/designforslag/gengivelse/importer-testbase.sh propstep  # én kilde ad gangen
docs/designforslag/gengivelse/importer-testbase.sh dacas
docs/designforslag/gengivelse/importer-testbase.sh balder    # kræver BALDER_API_KEY
docs/designforslag/gengivelse/runde4.sh <udmappe>            # alle billeder og tal om
```

(Rettet i runde 4. Blokken stod før som fem løse linjer, hvor vagten var én
af dem — den, der kun kopierede importlinjen, fik ingen vagt.
`importer-testbase.sh` sætter selv sit mål, afviser alt andet end testbasen
og afbryder med exit 3, hvis skallen har `DATABASE_URL`,
`DATABASE_URL_DIRECT` eller `RESEND_API_KEY` sat. Se
[GREB-4.md](GREB-4.md#4--kommandoen-i-dokumentationen).)

`runde3.sh` tager før og runde 3's variant A i 1440, 390 og 360 på alle fire
sider, og runde 2 og variant B på forsiden i 390 og 360. Den kører også
fotomålingens selvprøve. Hver måling ender i en `maal.json` ved siden af
billederne.

**Hvorfor ikke `npm run import`:** scriptet kører med `--env-file-if-exists=.env`.
I en checkout med `.env` kommer `DATABASE_URL_DIRECT` derfra, og så er målet
produktionen, med alarmmatchning, afsendelse og oprydning i samme kørsel.
Importøren læser `DATABASE_URL_DIRECT` (`db/client.ts:52–54`), ikke
`DATABASE_URL`. Uden `--env-file` og med `krav_isoleret` kan kommandoen kun
ramme testbasen, og der er ingen nøgler at sende mail med. Den første udgave
af denne fil (ca32bb2) satte den forkerte variabel. Den var farlig og er
rettet — først i kommandoen (15019de), og i runde 4 i et script, så
rettelsen ikke afhænger af, at alle linjer kopieres.

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css) | § 0 fotoets variabler, § 6 telefonvarianterne, § 7 krediteringen, § 8 links, og `--handlingsflade` øverst |
| [`greb.js`](greb.js) | mockup: fotoobjektet, telefonvariant, krediteringen til fodnoten |
| [`heltefoto.json`](heltefoto.json) | fotoet som ét objekt (= `HERO_STANDARD` i appen) |
| [`gengivelse/runde3.sh`](gengivelse/runde3.sh) | alle runde 3-billeder og -tal med én kommando |
| [`gengivelse/app-skud.mjs`](gengivelse/app-skud.mjs) | skærmbilleder + `maal.json` pr. variant |
| [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs) | kan dette foto bære teksten? (exit 1 ved afslag) |
| [`gengivelse/hero-maal.mjs`](gengivelse/hero-maal.mjs) | de delte målinger: kontrast, slør krævet, fotoets tegning, linjebrud, kreditering |
| [`maalinger/`](maalinger) | prisspænd, chips, ny-mærkat og farver: scripts og de målte tal. Scripts mod en base kører i en read-only-session, som basen håndhæver (`laast-base.mjs`). Prisspænd og ny-mærkat har `--proeve` mod PGlite, chips har ingen |
| [`greb3/`](greb3) | billederne og `maal.json` fra den kørsel, der står i denne fil |

