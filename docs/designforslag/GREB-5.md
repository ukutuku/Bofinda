# Runde 5: B er valgt, og tre regler bliver mekaniske

1. oktober 2026. Del A er godkendt som #39. Runde 4 står i
[GREB-4.md](GREB-4.md). Alt herunder er målt mod `main`'s app (45a161a) og
den isolerede testbase.

## 1 · Telefonens hero er B

**Valgt på kompositionen, ikke på tallene.** I B står der en rigtig bolig
på første skærm: billede, titel, adresse og overtagelsesdato. Foto, tekst
og det svævende kort er ét objekt. A var tre stablede blokke, og
3:1-udsnittet skar rummet over. Rigtige annoncer flytter foldtallene og
viser kompositionen, men de ændrer ikke valget.

**Variant A er fjernet:**

- `greb.css` § 6 har kun B. Klassen `.m-baand` findes ikke mere.
- `greb.js` sætter ingen klasse.
- `runde4.sh` tager ikke A, og `kredit-udrulning.mjs` prøver ikke A.

**Forbeholdet om kontrasten overvåges af `maal-foto.mjs`, ikke af en
antagelse.** Tallet 5,48 var runde 3's øjenbryn i hvid à .84. B's tekst er
nu ren hvid, og på det nuværende foto, i alle ni telefonbredder (320–900),
er den laveste kontrast:

| Tekst | Mod fotoet | Over et helt hvidt foto |
|---|---|---|
| Øjenbryn | 6,26–7,27:1 | 4,69:1 |
| h1 | 5,90–7,15:1 | 4,69:1 |
| Manchet | 6,15–6,74:1 | 4,69:1 |

Ved hvert fotoskift måler `maal-foto.mjs` mod AA i alle bredder og over det
værst tænkelige foto:

- **Kræver fotoet mere slør end loftet 0,60, er dommen AFVIST:** «kræver
  slør 0,65 > loftet 0,6 — fotoet kan ikke bære teksten; vælg et andet
  foto».
- **Der er ingen variant at falde tilbage på.** Før hed den dom «KUN A».

Selvprøven: alle otte tilfælde fik deres facit. Det er B, B · OVERVÅGES og
AFVIST ad seks veje: for tyndt slør, for tykt slør, over loftet, bred
skærm, rettighederne og krediteringen.

**Krediteringsprøven:** syv tilstande i seks bredder har præcis én synlig,
læselig kreditering, og alle otte modprøver blev røde.

## 2 · B's færdige form: rettelserne fra del A og titlen

Gendrivelsen af #39 fandt fejl, som også var designlagets. De er ført ind
her:

- **Fokusringen:** ingen fælles blæk-ring, og ringen i den valgte
  sorteringspille er hvid.
- **Understregningen** står i `--daempet` og gælder også de fire links, der
  før kun blev kendt på deres teal.
- **`.m-vent` er taget ud**, så «vises ikke» ikke ligner «udgivet».
- **Noten om tavse kilder** har `globals.css`' egne to farver.
- **Leaflets links** har to klasser.

**Søgesidens titel var lagets egen fejl.** Laget satte titlen til 32/28 px
over `globals.css`' 22/20 px, og ved den størrelse brækker bynavnet. Den
«rettelse», laget lagde ved siden af, kunne ikke virke mod `globals.css`'
`nowrap`. Nu gælder titelstørrelsen kun over 620 px, og den virkningsløse
regel er fjernet. [GREB-3.md](GREB-3.md) er rettet, der hvor påstanden
står.

| Søgesidens første kort | Uden lag | Med laget, runde 4 | Med laget nu |
|---|---|---|---|
| 390 | 361 px | 398 px | **379 px** |
| 360 | 361 px | 434 px | **377 px** |
| 1440 | 380 px | 398 px | 398 px (titlen er stor over 620 px) |

## 3 · En gengivelse mod rigtige annoncer er en kopi af kildens billeder

**Reglen:** et skærmbillede af en side med rigtige annoncer er en kopi af
kildens billeder, uanset hvem der laver det, og hvorfor. Det må ikke
committes, ikke udgives i et artefakt og ikke lægges i `docs/` (CLAUDE.md:
«Kopiér aldrig kildens billeder»). Rækken er foreslået til fældetabellen
på #22.

**Den mekaniske form** er `hero-maal.mjs` › `skaermbillede`. Alle fire
værktøjer, der skriver billeder (`app-skud.mjs`, `kredit-udrulning.mjs`,
`maal-foto.mjs` og `foto.mjs`), går gennem den.

- **Hvad der må skrives:** kun en side, hvor hvert billede er vores. Det
  betyder loopback (heltefotoet i `public/` og testaktivernes syntetiske
  mønstre og fliser) samt `data:`, `blob:` og `file:`.
- **Proxyer:** `/api/billede` og `/_next/image` afgøres på den adresse, de
  henter.
- **Ellers skrives filen ikke.** Tallene måles stadig, og `maal.json` lister
  de afviste under `afviste`.
- **Vagten er forsigtig:** den ser på hele siden, også uden for et
  klip.

[`gengivelse/proev-kildebilleder.mjs`](gengivelse/proev-kildebilleder.mjs)
prøver vagten mod `main`'s app:

| Tilfælde | Resultat |
|---|---|
| Testbasens forside | skrives (0 fremmede billeder) |
| Kildens billede direkte | afvist |
| Kildens billede gennem `/api/billede` | afvist |
| Kildens billede som CSS-baggrund | afvist |
| Kildens billede i `<picture>` | afvist |

Med vagten tømt blev de fire kildetilfælde røde.

**Hvad den ikke dækker:** på `main` skriver 16 værktøjer i `scripts/cloud/`
skærmbilleder med 69 kald, og ingen af dem har vagten. De kører i dag mod
testbasen, men intet forhindrer en kørsel mod rigtige annoncer.

## 4 · Testbasen tømmes, og tømningen måles

[`gengivelse/toem-testbase.sh`](gengivelse/toem-testbase.sh) sletter de
syntetiske boliger fra testbasen. Det er dem fra `test-`-kilderne, de
seedede udlejerannoncer og enhver bolig med et billede fra testaktivernes
stribemønstre. Samtaler slettes først, for de sletter ikke kaskadevis.
Bagefter tæller scriptet de tre slags hver for sig og afbryder med exit 1,
hvis én af dem ikke er 0.

`runde4.sh <udmappe> --rigtige propstep,dacas,balder` kører i denne
rækkefølge:

1. tøm testbasen;
2. importér hver kilde (`importer-testbase.sh`);
3. kontrollér, at der er 0 syntetiske tilbage og mindst én aktiv bolig.

Først derefter måles der. Kørslen giver tal, ikke billeder (§ 3).

Prøvet på testbasen 1. oktober:

| Trin | Med stribemønster | Fra test-kilder | Native | Aktive | Exit |
|---|---|---|---|---|---|
| Kontrol før tømning | 237 | 244 | 36 | 280 | 1 |
| Tømning og kontrol | 0 | 0 | 0 | 0 | 0 |
| `--kontrol --rigtige` uden import | 0 | 0 | 0 | 0 | 1 (ingen aktive) |

Bagefter blev testbasen sået igen med `scripts/cloud/saa.mjs` (280 boliger).

## 5 · Billedernes vægt i git

Kun tal. Beslutningen er ikke truffet.

| | Pakket |
|---|---|
| `main` i dag, alle blobs | 33,0 MB (heraf billeder 31,7 MB) |
| Grenens egne blobs | 25,5 MB |
| heraf billeder (220 versioner) | 25,0 MB |
| `.git` i denne klon | 67 MB |

Billederne i grenens HEAD (213 filer, 24,5 MB), genkodet med `sharp`:

| Form | Størrelse |
|---|---|
| Som i dag | 24,5 MB |
| JPEG q75, samme størrelse | 8,1 MB |
| Halv bredde, JPEG q75 | 2,9 MB |
| Halv bredde, JPEG q60 | 2,2 MB |

Vejene og hvad de koster:

- **Merges grenen som i dag**, bærer hver klon af `main` alle 25,0 MB for
  altid. Det gælder også gamle versioner af billederne, fordi en almindelig
  merge gør hele grenens historik nåbar.
- **Squash-merge** gør kun HEAD's billeder nåbare fra `main`. Det er
  24,5 MB, eller 2,2–8,1 MB, hvis billederne genkodes før merge.
- **Billederne i artefaktet** frem for i repoet: 0 MB i git. Prisen er, at
  dokumenternes billedhenvisninger peger ud af repoet og afhænger af, at
  artefaktet findes.
- **Kun den nyeste runde (`greb4/`, 4,0 MB) og ingen historiske mapper:**
  kan kombineres med en af de andre.

Tallene for billederne i dag er målt på billeder, der ikke viser kilders
fotos. Efter § 3 kommer der ikke flere af den slags fra rigtige annoncer.

## Filer

| Fil | Hvad |
|---|---|
| [`greb.css`](greb.css), [`greb.js`](greb.js) | B alene; #39's rettelser; den virkningsløse titelregel er fjernet |
| [`forslag.css`](forslag.css) | titelstørrelsen kun over 620 px; #39's rettelser |
| [`gengivelse/hero-maal.mjs`](gengivelse/hero-maal.mjs) | `fremmedeBilleder` og `skaermbillede` |
| [`gengivelse/proev-kildebilleder.mjs`](gengivelse/proev-kildebilleder.mjs) | prøven af vagten |
| [`gengivelse/toem-testbase.sh`](gengivelse/toem-testbase.sh) | tømningen og kontrollen |
| [`gengivelse/runde4.sh`](gengivelse/runde4.sh) | `--rigtige`; A er ude |
| [`gengivelse/maal-foto.mjs`](gengivelse/maal-foto.mjs) | over loftet er AFVIST |
| [`GREB-3.md`](GREB-3.md) | titelpåstanden rettet, hvor den står |
