# Designforslaget, del A: det, der kan lande uden fotos

Et udsnit af designforslaget på grenen `claude/ecstatic-goodall-foq06c`.
Med i udsnittet er de dele, der hverken afhænger af rigtige boligfotos eller af valget
mellem telefonvarianterne. Resten bliver på designgrenen
([GREB-4.md](https://github.com/ukutuku/Bofinda/blob/a588236/docs/designforslag/GREB-4.md)).

**Intet her ændrer en side.** `app/layout.tsx` indlæser kun
`app/globals.css`, og intet på `main` læser `docs/designforslag/`. Reglerne
er et forslag, som Frontend folder ind i `globals.css`. `app/globals.css`,
`app/Boligkort.tsx` og `app/page.tsx` er ikke rørt.

## Filerne

| Fil | Hvad |
|---|---|
| [`forslag.css`](forslag.css) | Farven: tokens og regler, se nedenfor. |
| [`greb.css`](greb.css) | `--handlingsflade` (Søg, Se annoncen/Kontakt i boligsidens økonomikort og udlejerbåndet), Leaflets links og to rettelser af fejl, appen har i dag uden noget lag. |
| [`maalinger/`](maalinger) | Vagten `laast-base.mjs` (navngivet mål, exit 3) og prøven af den. Desuden de to målinger til [#36](https://github.com/ukutuku/Bofinda/issues/36): `maal-prisspaend.mjs` og `maal-chips.mjs`. Deres resultater fra 30. september (testbasen) bliver på designgrenen. |
| [`gengivelse/importer-testbase.sh`](gengivelse/importer-testbase.sh) | Importen af én kilde til den isolerede testbase. Målet står i scriptet. |
| [`bevis/`](bevis) | Målingen på `main`'s egen app, før og med udsnittet. |

### Hvad farven ændrer

- **Tokens:**
  - `--accent` og `--accent-mrk` peges om til blæk (`#14161a` og `#2d3138`), og `--accent-lys` til sand (`#ecebe6`). Det er 94 anvendelser i `globals.css`.
  - `--daempet` og `--svag` bliver én mørkere grå (`#4d5452`, 7,1:1 mod sand). Al sekundær tekst bliver altså mørkere.
  - `--linje` og `--linje-svag` justeres.
- **De kendte beløb** (`.kort-pris`, `.oek-tal`) peges tilbage på `--kendt`, så grøn tekst stadig betyder «kendt beløb».
- **Ordmærket, de valgte tilstande og de små rester af teal** bliver blæk:
  - ordmærket;
  - sorteringspillen (med en hvid fokusring inde i den blæk-fyldte pille) og afkrydsningerne;
  - trinbjælken og kortmærkerne;
  - det fremhævede kort, slipfeltet og den aktuelle side;
  - filterchippens kant og «×».
- **Links** understreges i `--daempet`. Det gælder links i løbende tekst og fire links, som `globals.css` giver `text-decoration: none`, og som før kun blev kendt på deres teal: tilbagelinket, udlejerens handlinger, kontaktlisten og `.ik-link`.
- **Noten om tavse kilder** får `globals.css`' egne farver igen: tekst `#7a5416`, `<strong>` `#8a5300`. Den er i dag grå, fordi `.resultathoved .prisnote` vinder over `.prisnote.advarsel`.

### Rækkefølgen: udsnittet skal stå SIDST i globals.css

Omkring ti af reglerne har samme specificitet som den regel i
`globals.css`, de overstyrer, og vinder kun, fordi de står efter den.
Foldes de ind øverst, kommer fejlene tilbage:

- `.kort-pris` og `.oek-tal` bliver blæk, og de kendte totaler bliver sorte;
- den valgte sorteringspille bliver sand, og den hvide fokusring forsvinder på den (1,19:1);
- linkenes understregning, noten om tavse kilder, Søg og båndet vender tilbage til `globals.css`' værdier.

Målingen nedenfor lagde udsnittet sidst. Leaflets links har to klasser,
fordi `leaflet.css` indlæses efter `globals.css`.

## Målt på main's app

`main` 45a161a kørte med `next dev` mod den isolerede testbase. Testbasen har 280 syntetiske
boliger, og fotoet er heltefotoet. Udsnittet er lagt på i browseren, **sidst i
kaskaden**, med `app-skud.mjs --lag` fra designgrenen (a588236), uden mockup
(tom `greb.js`) og uden ekstra skrifter (tom `.fonte/fonte.css` i udmappen):

- forsiden, `/?sted=<by>` og to boligsider (den med flest billeder og en
  uden billeder);
- bredderne 1440, 768, 390, 360 og 320.

Farverne er læst med `getComputedStyle` i en engangskontrol, der ikke er
committet (`bevis/*-farver.json`):

- forsiden, `/?sted=Prøveby N&elevator=1` og boligen bag forsidens første
  kort;
- bredderne 1440, 390 og 320.

Fokusringen er læst for sig (`bevis/fokus.jsonl`): på 390, med
sorteringen åbnet og fokus fra tastaturet, så `:focus-visible` matcher.
«Se annoncen» er læst på de to målte boliger i 1440
(`bevis/se-annoncen.jsonl`). Kontakt-knappen på en udlejerannonce, som
samme regel rammer, er ikke målt.

| | Før | Med A |
|---|---|---|
| Krediteringen (1440 / 768 / 390 / 360 / 320) | pillen, 7,14 / 6,20 / 6,49 / 6,49 / 6,49:1 | **uændret** |
| Første boligkort, 1440 / 768 / 390 / 360 | 599 / 530 / 571 / 571 px | **uændret** |
| Første boligkort, 320 | 571 px | **596 px** |
| «Populære» ≤ 560 px, venstrekanter | to (144 og 0 px) | **én** |
| Boligsiden, vandret rul, 360 (de to målte boliger) | 15 px | **0** |
| Boligsiden, vandret rul, 320 (de to målte boliger) | 55 px | **11 px** |
| Søgesidens første kort | 361–383 px | **uændret** |
| «Søg» | `#0f4d43` | `#083a34` (`--handlingsflade`) |
| «Se annoncen» (1440, de to målte boliger) | `#0f4d43` | `#083a34`, hvid tekst |
| «Opret annonce», ordmærket | `#0f4d43` | blæk `#14161a` |
| Kendt total (`.kort-pris`), `.oek-tal` | `#0f4d43` | **`#0f4d43`** |
| Kun husleje (`.kort-pris.kun-leje`) | blæk | blæk |
| Udlejerbåndet | gradient | flad `#083a34` |
| Noten om tavse kilder, tekst / `<strong>` | grå `#626975` / `#5f6672` | `#7a5416` / `#8a5300` |
| Fokusring, valgt sorteringspille (390) | teal på lys teal | hvid 2 px på blæk |
| Understregning af links i løbende tekst | ingen | `#4d5452` |

**«Populære» koster en række, og hvor afhænger af navnene.** Etiketten står
på sin egen linje, så byerne begynder ved samme kant.

- **Med testbasens fire korte navne** koster det 25 px på 320, mens 360 og
  derover er uændret.
- **Med seks lange, rigtige bynavne** (målingens belastningsprøve) koster
  det 26 px på 360 (3 → 4 rækker), og 390 og 320 er uændret.
- **Over 560 px** er intet rørt. Med de lange navne har 768 stadig to
  kanter.

**Boligsiden** blev målt på to boliger. En tredje (forsidens første kort)
rullede ikke før A. Rullet afhænger altså af indholdet. Kilden til de
11 px, der er tilbage på 320, er ikke fundet.

## Hvad der ikke er med, og hvorfor

- **Krediteringens flytning** (designgrenens `greb.css` § 7) flytter
  pillen ned under søgekortet. Placeringen læser søgekortets overhæng, og
  på telefonen er overhænget netop valget mellem variant A (0 px) og B
  (24 px). Flytningen hører til heroens komposition og bliver på
  designgrenen. Her røres krediteringen ikke, og målingen ovenfor viser
  den uændret i alle bredder.
- **`maal-foto.mjs`** er instrumentet for telefonvarianterne. Loftet
  0,60, sløret og dommen læser alle § 6, som ikke er med.
- **Søgesidens titel** var ingen rettelse. Bruddet («Prøveby / N» på
  360) opstår først med designgrenens `forslag.css`, som sætter titlen
  til 32/28 px over `globals.css`' 22/20 px. Designgrenens titelregel
  kan ikke virke mod `globals.css`' `nowrap`. Det skal rettes på
  designgrenen.
- **Typografien, boligkortet og boligsiden** fra runde 1 er skrevet mod
  `opgave/kontakt-ui`, og laget gør kortet højere (401 → 461 px på 390).
- **Mockuppen** (`greb.js`: faner, felter, nul-chippen, «Ny i dag»,
  båndets kort) er markup til `page.tsx` og er Frontends.
- **Taget ud efter gendrivelsen:**
  - **En fælles blæk `:focus-visible`.** Den forsvinder på udlejerbåndet (1,44:1) og på lysbordets næsten sorte knapper.
  - **`.m-vent` i neutral hvid.** «Vises ikke» kom til at ligne «udgivet» (1,19:1). CLAUDE.md: en udgivet annonce, der ikke kan findes, må ikke stå som udgivet.
  - **`.gemt-pris`.** Klassen findes ikke på `main`, og reglen brugte vægt-tokens, som heller ikke gør.

## Grænser

- **Farvefejningen er ikke kørt om på udsnittet.** Den kørte på hele
  designlaget (610a9ef) med mockuppen og begge telefonvarianter. På
  udsnittet er kun de farver, tabellen nævner, læst i browseren.
- **Hårdkodet teal peges ikke om.** Det gælder bl.a. hover-tilstanden på
  filterchips (`#dceae4`) og på «Tilbage» og afsnitsnavigationen
  (`#cfe0d9`), gruppekortets antal (`rgba(15,77,67,.88)`) og
  sorteringsmenuens skygge.
- **«Ny»-mærkatet** (`.m-ny`) mister sin teal og får sand fyld med blæk
  tekst, som kildemærkatet ved siden af. De skilles nu kun af tekstfarven
  og ordet.
- **`var(--accent)` uden for `globals.css`.** På `main` står der 16 mere i
  `app/beskeder/beskeder.css`, `app/beskeder/proeve/proeve.css` og
  `app/kontakt-ui/kontakt-ui.css` (indtil videre kun på prøvesider), og
  `opgave/kontakt-ui` og S4 lægger 18 og 13 til i `globals.css`. Ingen
  fejning har set dem.
- **Intet her kører i `npm test` eller CI.** Vagtprøven og målingerne
  beskytter kun, når nogen kører dem.

## Vagten og målingerne

Målet står i kommandoen: `--maal test` eller `--maal prod`, og
forbindelsen skal svare til navnet, ellers exit 3, før noget åbnes. Under
`prod` læses produktionens og stagings ref af `scripts/staging/maal.ts`
(`PRODUKTION_REF`, `STAGING_REF`, `refFraDatabaseUrl`), samme sted som
staging-værnet læser dem.

- **Ref'en læses af den kanal, der afgør, hvor der forbindes:** værten i
  den direkte form og brugernavnet hos pooleren.
- **Et andet projekts direkte vært afvises derfor**, uanset hvad
  brugernavnet bærer.
- **Bærer begge en ref, skal de være ens.** Det fanger en fejlkopieret
  streng med produktionens vært og et andet projekts bruger.
- **Fejl i procentkodningen afvises med exit 3.**
- **Porten gives udtrykkeligt videre**, så `PGPORT` i skallen ikke kan
  sende en URL uden port til transaction-pooleren.
- **Kræver Node ≥ 22.18**, som stripper typerne af `.ts` i plain node.

```sh
# Prøven af vagten: 41 tilfælde mod de rigtige kommandoer, ingen forbindelse
node docs/designforslag/maalinger/proev-maal.mjs

# #36's tal fra produktionen, skrivebeskyttet (fra en checkout af main)
env -u DATABASE_URL -u DATABASE_URL_DIRECT ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json \
  docs/designforslag/maalinger/maal-prisspaend.mjs --proeve
ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json --env-file=.env \
  docs/designforslag/maalinger/maal-prisspaend.mjs --maal prod --json /tmp/prisspaend-prod.json
```

Kørt 1. oktober på denne gren (= `main` 45a161a + udsnittet):

- `proev-maal.mjs` gav 41 af 41.
- `maal-prisspaend.mjs --proeve` gav exit 0.
- `maal-chips.mjs --maal test` gav exit 0.

Modprøver:

- med ref-kravet slået fra blev de to tilfælde med en anden ref røde;
- med kravet om ens refs slået fra blev tilfældet med produktionens vært og et andet projekt i brugernavnet rødt;
- med værtslinjen slået fra blev intet rødt, for uden for pooleren læses ref'en af værten. En fremmed vært giver ingen ref og afvises af ref-kravet. Barrieren er dobbelt.
