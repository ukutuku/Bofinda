# Runde 2: de fem greb

26. september 2026. Grundarbejdet fra runde 1 står: IBM Plex Sans, seks
trin, 4 px-gitter, og teal betyder kun «hele betalingen til udlejer er
kendt» ([README.md](README.md)). Her er laget ovenpå: fuldbreddefoto,
svævende elevation, luft og farvebånd, taget fra de fire referencebilleder
som layout-vokabular — ikke som indhold.

**Målet.** Bofinda er ærlig boligøkonomi. Siden skal se ud som et velsat
regnskab — sikre tal, rigelig luft, ingen udsmykning. Tonen er en dansk
banks rentetavle, strukturen er referencernes.

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css) | De fem greb som CSS, oven på `forslag.css` |
| [`greb.js`](greb.js) | **Mockup** af den markup, `app/page.tsx` skal have (faner, felter, kortet på båndet, håndskrift). Kun til skærmbillederne |
| [`greb/foer/`](greb/foer), [`greb/efter/`](greb/efter), [`greb/efter-haand/`](greb/efter-haand) | Otte billeder pr. variant + forsidens bund, og `maal.json` |
| [`greb/forsidetal.sql`](greb/forsidetal.sql) | Forespørgslen bag tallene i båndets kort |
| [`gengivelse/app-skud.mjs`](gengivelse/app-skud.mjs) | Tager det hele om mod den kørende app |

`app/globals.css` og `app/Boligkort.tsx` er ikke rørt.

---

## Trin 1 — den rigtige side, set i en browser

Appen kører med `next dev` mod den isolerede lokale Postgres fra
`scripts/cloud/op.sh` (127.0.0.1:55432, de 21 rigtige migrationer). Det
lykkedes denne gang; intet blev nægtet.

**Dataene er syntetiske, ikke rigtige annoncer.** Miljøets netværkspolitik
afviser alle kilderne (`dacas.dk`, `propstep.com`, `nova-api.jeudan.dk`,
`balder.dk`, `images.ctfassets.net`: 403 fra proxyen), så importøren kan
ikke hente noget. Seedet er 280 opdigtede boliger med genererede
stribebilleder. Layout, CSS, komponenter og tal-logik er de rigtige;
fotokvaliteten kan ikke bedømmes. Next's udviklingsmarkør er skjult i alle
billeder.

### Hvad jeg ser

**Forsiden har allerede det meste af referencens ordforråd** — det er
udførelsen, der skiller:

- **Hero i fuld bredde med et rigtigt, licenseret foto** (Pexels, Taryn
  Elliott) findes. Men sløret er 94–97 % hvidt over venstre 38 % og 8–32 %
  over resten, så motivet står som en grå skygge, og bunden under fotoet
  har en teal-tone.
- **Øjenbrynet findes** — «LEJEBOLIGER MED OVERBLIK», 12,5 px, spatieret
  .14em — men i teal.
- **Søgekortet svæver allerede** 38 px ind over heroens underkant. Men det
  er ét felt, der er 1.000 px bredt med tom hvid flade, en hårstreg og en
  flad skygge. Der er ingen faner.
- **«Populære søgninger»** findes som tekstlinks, i teal uden understregning.
- **Udlejerbåndet findes** — men som en afrundet kasse inden for rammen,
  med en gradient, der ender i den udfasede `#14624f`, og uden kort.
- **Kortene ligger fladt** på sandbunden med en hårstreg. Ingen elevation.
- Det første kort står **599 px** nede på 1440 og **571 px** på 390.

**Søgesiden** har ingen hero (rigtigt). Søgekortet er igen ét felt i
1.300 px bredde. Datakvalitetschippene ligner knapper.

**Boligsiden med billeder** er den mest færdige skabelon: galleri, rail og
nøgletal. h1 og beløb er begge 38 px.

**Boligsiden uden billeder** starter med en stiplet kasse på 100 px med
«Ingen billeder at vise». Den ligner et element, der ikke nåede at indlæse.

---

## Trin 3 — de fem greb, målt

Kontrasten er målt mod **det faktiske foto**: teksten gøres usynlig,
baggrunden bag dens egen udstrækning fotograferes, og det værste pixel
tæller.

### 1 · Hero i fuld bredde

Sløret flyttes: rent underlag under teksten (venstre 40 %), og derefter
**intet slør** — fotoet skal ses. På en smal skærm går sløret lodret.

| Værste kontrast mod fotoet | Før 1440 | Efter 1440 | Før 390 | Efter 390 |
|---|---|---|---|---|
| Øjenbryn | 8,52 | 6,58 | 7,64 | 6,87 |
| h1 | 15,56 | 15,35 | 9,39 | 14,50 |
| Manchet | 10,88 | 14,35 | 6,40 | 14,40 |
| Håndskrift (variant) | – | 10,67 | – | 10,02 |

Alle er over 4,5:1. På 390 px ramte øjenbrynet først fotokrediteringen
(1,24:1), da heroens top-luft var 32 px — samme kollision som db4746b løste.
Luften er derfor 48 px.

**Fotoet.** Det nuværende er et rigtigt foto med Pexels-licens, og det
opfylder kravet. Jeg har **ikke** kunnet se kandidater: Unsplash, Pexels,
Colourbox og Ritzau Scanpix er spærret både for containeren og for
hentning. Jeg anbefaler ikke et foto, jeg ikke har set. Det, jeg kan
dokumentere:

- **Unsplash License:** gratis til kommerciel brug, ingen kreditering
  krævet, ingen skadesløsholdelse.
- **Unsplash+:** betalt. Skadesløsholdelse op til 10.000 dollar pr. fil.
  Startede til 7 dollar/md. som introduktionspris. Den aktuelle pris er
  ikke verificeret.
- **Colourbox** (dansk): abonnement, én licens til al brug. Prisen kunne
  ikke ses herfra.

Kriterier for en afløser: en rigtig dansk etagelejlighed (plankegulv,
dagslys, ikke opstillet), rolig venstre tredjedel til teksten, ingen
mennesker. Kilder:
[picdefense.io](https://picdefense.io/resources/source-intel/unsplash/),
[licenseorg.com](https://www.licenseorg.com/blog/unsplash-license-attribution-required),
[linkstartai.com](https://www.linkstartai.com/en/agents/unsplash),
[colourbox.dk/pricing](https://www.colourbox.dk/pricing).

### 2 · Øjenbryn

Findes allerede. Farven skifter fra teal til `--daempet`: teal er et
udsagn om et beløb. Reglen: **et øjenbryn står over en overskrift, aldrig
over et tal.** Railens etiket forbliver i sætningsstil.

### 3 · Søgekortet

- **Faner hæftet ovenpå kortet:** boligtyper med antal fra filtervinduets
  egne tællere (`facetter()`). En fane vises kun, hvis typen har boliger.
  Fanen «På kort» er fravalgt: kortet vises kun efter en søgning, så den
  ville ikke gøre noget på forsiden.
- **Fire felter** med tynd lodret streg imellem, label over og værdi
  under: område, pris, størrelse og værelser. **Kun fra 900 px.** Mobilen
  beholder den kompakte linje, som bevidst blev skåret fra 243 til 178 px
  (resultatdesign.md). Felterne skal *flyttes* fra filtervinduet, ikke
  kopieres: to `prisMax` i samme formular er den tavse fejl, `stedet()`
  blev rettet for.
- **Én mørkegrøn handling pr. side:** «Søg» i søgekortet og «Se
  annoncen» i boligsidens rail. Alt andet, der kan trykkes på, er blæk.
- «Populære søgninger» står som understregede tekstlinks.
- Under 560 px er der ingen faner. De koster en række over kortet, og
  typerne står i «Filtre».

### 4 · Konstant billedforhold

**Det er allerede løst, og nu målt.** Alle 12 første kort har rammen
16:9 (1,778) med `object-fit: cover` (`globals.css:367`). Letterboxing
eller strakte fotos kan ikke opstå, uanset hvad kilden leverer.
Kildebillederne i seedet er alle 4:3, så variationen fra rigtige kilder
kan ikke måles her — men den kan heller ikke ses.

**Det, der faktisk bryder nettet, er kortene uden foto.** 2 af de første
12 på forsiden er 249–271 px høje mod ca. 440 px. To muligheder:

- **(a) Behold den kompakte form.** Det er besluttet før: «en strammere
  krop, så formen læser som et valg» (kortdesign.md).
- **(b) Behold 16:9-rammen som en flad sandflade** med linjen «Kilden har
  ingen billeder». Det er en oplysning på billedets plads, ikke et
  opdigtet billede. Nettet får én rytme.

(b) omgør en beslutning, så den er jeres. Den er ikke lagt ind i
billederne.

Kortene får **elevation**: ingen hårstreg og en blød skygge, der løfter
sig ved hover.

### 5 · Farvebånd i fuld bredde

Udlejerbåndet går til skærmkanten (procent af gitterfeltet, ikke `100vw`),
flad mørk teal `#083a34` — gradienten sluttede i den udfasede `#14624f`.
Ovenpå svæver ét hvidt kort (se trin 4).

**Mørk teal som flade og teal som tal er to ting.** Teal i tekst og på
tal betyder stadig kun «kendt». Mørk teal som flade er afsender: ét bånd
og én primær handling pr. side, og aldrig på et tal.

---

## Trin 4 — mærkater, anbefalingskort og pris

### Anbefalingskortet: tal vi kan dokumentere

Ingen fiktive anmeldelser nogen steder, heller ikke som pladsholder —
opdigtede forbrugeranmeldelser står på sortlisten i bilag 1 til
markedsføringsloven. Kodens kommentar ved `.udlejerbaand` siger det
allerede.

Kortet viser **«Talt i dag»**:

| Tal | Lokal base | Kilde |
|---|---|---|
| ledige lejeboliger | 279 | `forsidetal().boliger` |
| kilder | 4 | `forsidetal().kilder` (native tæller som én) |
| med hele den månedlige betaling til udlejer | 252 (90 %) | `forsidetal().kendtTotal` — teal, fordi det er «kendt» |

Tallene er målt her mod den **syntetiske** base. Forespørgslen, som
Postgres modtog, står i [`greb/forsidetal.sql`](greb/forsidetal.sql), og
produktionens tal hentes med kommandoen dér. Mockuppen læser tallene af
sidens egen talstribe, som bygger på samme funktion, og talstriben afgiver
de to tal, så de ikke står to steder. Den dag der er rigtige brugere, passer
en rigtig udtalelse i nøjagtig samme kort.

### Mærkaten øverst til venstre

Én mærkat på fotoet, som i dag.

| Mærkat | Kan vi bære den? | Hvor tallet kommer fra |
|---|---|---|
| **«Ny i dag» / «Ny i går» / «Ny · 2 dage»** (under 3 døgn) | Ja, **på én betingelse** | `source_created_at`, ellers `first_seen_at` (`paaMarkedet` i Boligkort). **Betingelsen:** mærkaten mangler indkøringsvagten. Sorteringen bruger `NYHEDSDATO`, som giver bagkatalog null (`lib/soeg.ts:354`), men kortet regner selv `hosKilden ?? foerstSet`. Kobles en kilde uden datoer på, står hele dens bagkatalog med «ny» i tre døgn. Det er en korrekthedsfejl og hører til Frontend. |
| «Kan overtages nu» | Ja | `availability.timing.status = 'nu'` fra kildekontrakten. 12 af 279 i seedet, så den er sjælden nok til at betyde noget. Står i dag i metalinjen. Kan blive mærkat nr. 2, hvis «ny» ikke er der. |
| «Udlejeren selv» | Ja | `source_type = 'native'`. Står i dag som kilde i foden. |
| «Populær», «Mest set», «Anbefalet» | **Nej** | Vi har hverken visninger eller favoritter nok til at påstå det. |
| «Prisfald» | **Nej** | Der er ingen prishistorik i skemaet. |
| «Verificeret», «Tjekket» | **Nej** | Vi tjekker ikke boliger. |

### Prisen på kortet

Referencens skal — fed pris, enhed, en faktalinje — og vores økonomi:

- teal 700 og «kr/md til udlejer», når totalen er kendt
- blæk 400 og «i husleje + aconto (ikke oplyst)», når den ikke er
- grundlagslinjen i kursiv under tallet («el kommer oveni», «uvist om el
  er med»)

Aldrig et nøgent «12.900 kr./md.».

### Håndskriften «Hjem starter her»

Vist som variant ([`greb/efter-haand/`](greb/efter-haand)). Kontrasten er
10,67:1 mod fotoet. Den koster 50 px på 1440 og 41 px på 390, før det første
kort kommer. **Min anbefaling er uden:** det er det eneste element på siden,
der ikke er regnskab, og målet siger «ingen udsmykning».

---

## Hvad det koster, målt

| Første kort, px fra toppen | 1440 | 390 |
|---|---|---|
| Før | 599 | 571 |
| Efter | 649 (+50) | 622 (+51) |
| Efter med håndskrift | 699 (+100) | 663 (+92) |

Prisen er det svævende søgekort (48 px ind over heroens underkant) og
fanerne. Vandret overløb er 0 i alle 24 billeder.

## Uden for designet, til Frontend

- **Prisspændet** «6.110–24.010 kr/md» blander kendte totaler med rene
  huslejer. Det er beskrevet i forrige runde og hører ikke til her.
- **«Ny»-mærkaten** mangler indkøringsvagten (se ovenfor).
- `app/page.tsx` ændres også på kontakt-ui. Fanerne, felterne og kortet
  på båndet skal koordineres med den gren.

## Sådan tages billederne om

```bash
scripts/cloud/op.sh                               # base + seed + next dev
. scripts/cloud/miljoe.sh && export DATABASE_URL_DIRECT=$(test_url)
node docs/designforslag/gengivelse/app-skud.mjs /tmp/ud/foer foer
node docs/designforslag/gengivelse/app-skud.mjs /tmp/ud/efter efter
node docs/designforslag/gengivelse/app-skud.mjs /tmp/ud/efter-haand efter-haand
```
