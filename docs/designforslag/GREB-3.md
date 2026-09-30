# Runde 3: mobilen, fotoet, to fejl og farven på «Søg»

30. september 2026. Runde 2 er godkendt som retning ([GREB.md](GREB.md)). Her
er de fire rettelser i den rækkefølge, de blev bedt om, plus observationen
om mærkaten og status for netværket.

**Dataene er stadig syntetiske.** Værterne svarer stadig 403 fra proxyen
(efterprøvet 30. september kl. 14.34). Og listen over de fem værter fra
runde 2 var forkert. Se [Netværket](#netværket-og-hvad-der-skal-køres-når-det-er-åbent)
for den rigtige liste. Når de er åbne, tager
[`gengivelse/runde3.sh`](gengivelse/runde3.sh) alle billeder og tal om med én
kommando.

`app/globals.css` og `app/Boligkort.tsx` er ikke rørt. Alt ligger i laget
(`forslag.css`, `greb.css`, `greb.js`) og i [`heltefoto.json`](heltefoto.json).

## 1 · Mobilen

Målt i 390 og 360 på forsiden. «Tegning tilbage» er, hvor meget af fotoets
kanter og detaljer der står tilbage, som siden tegner det, over den del af
fotoet, der står fri af søgekortet (1 = urørt). Kontrasten er den værste mod
de faktiske pixels bag teksten. «Populære søgninger» er målt med seks lange
danske bynavne (København NV, Frederiksberg C …) som en belastningsprøve,
fordi seedets fire korte byer aldrig brækker. Alt kommer fra `maal.json` i
[`greb3/`](greb3).

| Bredde | Tilstand | Første kort (px) | Tegning tilbage (fri højde) | Øjenbryn | h1 | Manchet | Kreditering | Populære søgninger | Vandret rul |
|---|---|---|---|---|---|---|---|---|---|
| 390 | Før (appen i dag) | 571 | 0,39 (221 px) | 7,64 | 9,39 | 6,40 | øverst, i første visning | 3 rækker, 2 venstrekanter, mellemrum 16 px | 0 |
| 390 | Runde 2 | 622 | 0,19 (267 px) | 6,87 | 14,50 | 14,40 | øverst, i første visning | 3 rækker, 2 venstrekanter, mellemrum 24/28 px | 0 |
| 390 | A · fotobånd | 671 | 1,00 (130 px) | 7,13 | 16,63 | 16,63 | fodnoten | 3 rækker, 1 venstrekant, mellemrum 16 px | 0 |
| 390 | B · mørkt slør | 605 | 0,43 (251 px) | 5,72 | 7,08 | 6,21 | fodnoten | 3 rækker, 1 venstrekant, mellemrum 16 px | 0 |
| 360 | Før (appen i dag) | 571 | 0,39 (221 px) | 7,69 | 9,39 | 6,40 | øverst, i første visning | 3 rækker, 2 venstrekanter, mellemrum 16 px | 0 |
| 360 | Runde 2 | 645 | 0,20 (291 px) | 6,87 | 14,63 | 14,36 | øverst, i første visning | 4 rækker, 2 venstrekanter, mellemrum 24/28 px | 0 |
| 360 | A · fotobånd | 684 | 1,00 (120 px) | 7,13 | 16,63 | 16,63 | fodnoten | 4 rækker, 1 venstrekant, mellemrum 16 px | 0 |
| 360 | B · mørkt slør | 628 | 0,43 (275 px) | 5,72 | 7,05 | 5,95 | fodnoten | 4 rækker, 1 venstrekant, mellemrum 16 px | 0 |

**Fotoet.** I runde 2 stod fotoet med 0,19 af sin tegning på 390, mod 0,39 i
appen i dag. Runde 2 gjorde altså telefonen værre, ikke bedre. Du så
rigtigt: sløret er 92–95 % hvidt over de øverste 55 % af heroen, fordi en
smal skærm ikke har en venstre side at lægge teksten i. De to løsninger:

- **A · fotobånd** (`.m-baand`). Fotoet står som et lavt bånd på 3:1 øverst
  i fuld bredde, uden slør. Teksten står under det, på papiret. Intet står
  på fotoet, så kontrasten afhænger ikke af det. Fotoet står helt (1,00),
  men lavt: 130 px på 390. Prisen er folden. Første kort flytter fra 622 til
  671 px på 390, og fra 645 til 684 på 360. Jeg prøvede også 12:5 og 5:2: de
  viste det samme motiv og kostede 26–32 px mere.
- **B · mørkt slør** (`.m-moerk`). Teksten står på fotoet, hvid på et mørkt
  slør, der er tættest bag teksten og letter mod søgekortet. Folden er bedre
  end i runde 2: 605 px på 390. Men fotoet står med 0,43 af sin tegning,
  fordi dette foto er lyst og kræver 0,50 slør for hvid tekst (se 2). Et
  foto med mellemtoner kræver mindre, og så står mere af det.

**Min anbefaling er A.** Det er det eneste af de to, hvor fotoet ikke
betaler for teksten, og det er et velsat regnskabs form: billedet som en
plade, teksten på papir. Kontrasten kan ikke gå tabt, uanset hvilket foto
John finder. Prisen er 49 px fold på 390. Vejer folden tungere, er B rigtig,
men så afgør det nye foto, hvor meget af det der kan ses.

**Krediteringen** står ikke længere øverst. Den er flyttet til sidens
fodnote (`footer.bund`, som `page.tsx` selv tegner, så foto og navn stadig
er ét objekt). Den står som en sætning i 12 px, kontrast 7,13. Pillen var
10,5 px hvid på mørkegrå og stod som det første i første visning. Den
fjernede også en binding: heroen behøver ikke længere 48 px luft foroven for
at holde øjenbrynet fri af pillen.

Kræver et fremtidigt fotos licens kreditering VED billedet (typisk
bureauer), er det feltet `kreditVedBilledet` i fotoobjektet. Så skal den i A
stå som billedtekst under båndet. Det er ikke bygget, fordi Pexels-licensen
ikke kræver det.

**«Populære søgninger»** fik to rettelser:

- **Hullet.** Runde 2 lagde en margin oven i gap'en, så mellemrummene blev
  24 og 28 px mellem nogle led og 16 mellem andre. Afstanden er nu gap'ens
  alene.
- **Skævheden.** Etiketten stod i første række, så første række begyndte
  under etiketten og anden under byerne: to venstrekanter i én blok. På en
  telefon får etiketten nu sin egen linje, og hver række begynder med en by,
  ved samme kant.

**1440** er uændret i folden (første kort 649 px mod 599 i dag).

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
  sloer: 0.95, sloerSmal: 0.60,   // sat efter maal-foto.mjs, ikke efter øjemål
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
- **Tegning tilbage.** Det er fotoets luminansspredning, som siden tegner
  det, delt med det rå fotos. Der måles over den del, der står fri af
  søgekortet: 1 betyder urørt, og 0,4 betyder, at sløret har taget 60 %.

**Dommen er AFVIST**, hvis én tekst i én bredde falder under tærsklen med det
slør, objektet angiver. Den er også AFVIST, hvis variant B kun kan bære
teksten med et slør over 0,70. Over det loft er fotoet bag teksten et mørkt
felt med en anelse motiv, og så er svaret variant A eller et andet foto, ikke
et tykkere slør. Kommandoen slutter med exit 1 ved et afslag. Mangler
fotoobjektet kreditering eller licens, står det i rapporten.

**Selvprøven** (`--selvproeve`) viser, at målingen kan sige nej. Den har tre
tilfælde med kendt facit, og alle tre fik deres facit:

| Tilfælde | Facit | Resultat |
|---|---|---|
| Det nuværende foto med sit objekt | bestået | bestået i alle fem kombinationer |
| Samme foto, variant B's slør sat ned til 0,20 | afvist | afvist i 390 og 360: øjenbryn 2,41, h1 2,68/2,64, manchet 2,35/2,21 |
| Mørklagt udgave af samme foto (prøveattrap), bredt underlag 0,20 | afvist | afvist i 1440: øjenbryn 1,00, h1 1,39, manchet 1,39 |

Det nuværende foto, målt:

<!-- FOTOTABEL -->

**Det nuværende foto består, og det er ikke et argument for det.** Hvid tekst
kræver 0,50 slør i variant B, fordi fotoet er lyst. Mørk tekst på bred
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
og en acceptprøve, der fejler i dag: <!-- ISSUE -->. Scriptet, der giver
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

**Fejningen.** På alle fire sider, i begge bredder og i begge tilstande, er
hvert synligt element gennemgået, med pseudo-elementer og svg. Der er ledt
efter grøn i `color`, baggrund, kant, `fill`, `stroke`, outline og
understregning. I runde 2 stod grøn **tekst** fire steder:

- `.kort-pris` (160 forekomster): kendt beløb.
- `.oek-tal`: railens beløb, kendt.
- `dt.kendt` på båndet: 252. Det er et **antal** boliger med kendt total,
  ikke et beløb.
- `a.maerke`: ordmærket.

Grøn **flade** stod tre steder: «Søg», «Se annoncen» og udlejerbåndet. Den
ene fremmede farve var Leaflets blå link på kortets kreditering, `#0078a8`.

**Og ved hover.** Fejningen måler hvilefarver. Farveagenten målte også
hover: «Søg» gik til `#0b4a42`, som ligger **ΔE00 1,27** fra `--kendt`. Knappen
blev altså den kendte teal, netop når nogen rørte den.

**Rettet i runde 3:**

- **Hover** går nu mørkere, til `#052a25`. Den ligger ΔE00 11,3 fra
  `--kendt` og 5,1 fra hvilefarven, så skridtet er lige så synligt som før,
  bare den anden vej.
- **252 på båndet** er blæk som 279 over den. Grøn tekst står kun på et
  beløb.
- **Ordmærket** er blæk.
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
  døgn delt med bestanden, og skønnet giver 1–5 %.
- **På forsidens første side bliver den flertallet.** «Nyeste» er
  standardsorteringen, så de 48 kort er netop de nyeste. Dagens mærkat
  (under 72 t) står på alle 48, så snart der kommer 16 nye i døgnet. «Ny i
  dag» (under 24 t) står på flertallet fra cirka 24 nye i døgnet.
- **Skønnet er 25–35 nye pr. døgn.** Så står «Ny i dag» på cirka 25–35 af 48
  kort (52–73 %).
- **Mekanismen kan ses i den syntetiske base.** Kun 12,9 % af bestanden har
  mærkaten, men den står på 12 af de første 12 kort.

**Hvor skønnet kommer fra:** bestanden er 1.864 synlige (23. september,
`lib/grundlag.ts:19`). Levetiden er afledt af den eneste måling i repoet, der
siger noget om den: bagkatalogets medianalder på 37 dage (`lib/alarm.ts:29–31`).
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
  docs/designforslag/maalinger/maal-ny.mjs --base
```

Scriptet gør følgende:

- Det går gennem sidens egne `soeg()` og `soegGrupperet()`.
- Det læser mærkaten ud af de rigtige kort, gengivet med
  `renderToStaticMarkup`.
- Forbindelsen står som `default_transaction_read_only = on`, og det
  efterprøves før og efter målingen.
- Port 6543 afvises.

`--proeve` kører mod PGlite med 18 boliger på hver side af grænserne og
består. Tre bevidst indførte fejl gjorde den rød: kalender i UTC, 48 t i
stedet for 72, og kildens dato ignoreret.


## Netværket, og hvad der skal køres, når det er åbent

**Listen fra runde 2 var forkert.** Den nævnte `nova-api.jeudan.dk`, men
Jeudan har ingen adapter og hentes ikke. Og den manglede to værter:

- `app.propstep.com`, hvor Propsteps billeder ligger (`lib/billede.ts:41`);
- `api.balder.dk`, som er Balders API (`adapters/balder.ts:45`).

Uden `app.propstep.com` får Propsteps 764 boliger ingen billeder. Så ville
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
scripts/cloud/op.sh                                   # base + app, som før
source scripts/cloud/miljoe.sh && export DATABASE_URL="$(test_url)"   # testbasen, intet andet
npm run import -- propstep                            # én kilde ad gangen
npm run import -- dacas                               # (balder kræver BALDER_API_KEY)
docs/designforslag/gengivelse/runde3.sh <udmappe>     # alle billeder og tal om
```

`runde3.sh` tager før, runde 2 og begge runde 3-varianter i 1440, 390 og 360.
Den kører også fotomålingens selvprøve. Hver måling ender i en `maal.json`
ved siden af billederne. Importen går mod `DATABASE_URL` fra
`scripts/cloud/miljoe.sh`, som afviser alt andet end testbasen.

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css) | § 0 fotoets variabler, § 6 telefonvarianterne, § 7 krediteringen, § 8 links, og `--handlingsflade` øverst |
| [`greb.js`](greb.js) | mockup: fotoobjektet, telefonvariant, krediteringen til fodnoten |
| [`heltefoto.json`](heltefoto.json) | fotoet som ét objekt (= `HERO_STANDARD` i appen) |
| [`gengivelse/runde3.sh`](gengivelse/runde3.sh) | alle runde 3-billeder og -tal med én kommando |
| [`gengivelse/app-skud.mjs`](gengivelse/app-skud.mjs) | skærmbilleder + `maal.json` pr. variant |
| [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs) | kan dette foto bære teksten? (exit 1 ved afslag) |
| [`gengivelse/hero-maal.mjs`](gengivelse/hero-maal.mjs) | de delte målinger: kontrast, slør krævet, fotoets tegning, linjebrud, kreditering |
| [`maalinger/`](maalinger) | prisspænd, chips og ny-mærkat: scripts (kun `select`, med prøve) og de målte tal |
| [`greb3/`](greb3) | billederne og `maal.json` fra den kørsel, der står i denne fil |

