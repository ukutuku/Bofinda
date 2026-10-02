# Fletning af designgrenen ind i `main`

Skrevet 2. oktober 2026 mod `main` på `b39329a`, med #39 (del A) merget,
og mod #49's gren på `277f01d`, som ikke er merget.
Grenen bygger på `683a9fc`. Dette er opskriften. Den skal **ikke** udledes
under fletningen.

En prøvefletning (`git merge --no-commit origin/main`) gav konflikter i
**otte filer**, ikke én. Derudover gav den to ting, der fletter uden
konflikt:

- én ændring, der alligevel knækker (§ 2);
- ti billeder, der gør `npm test` rød (§ 4). Det skal de, men posterne til
  undtagelseslisten står færdige her.

## 1 · `package.json` — `"test"`-linjen

Løsningen afhænger af, om [#49](https://github.com/ukutuku/Bofinda/pull/49)
(prøvekæden udledt af filerne) er landet. Se på main's `"test"`-linje:

### 1a · Står der `npm run test:kerne && …` (#49 er ikke landet)

De to sider har hver sin linje:

```
main:    "test": "npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked",
grenen:  "test": "npm run proev:billedkontrol && BILLED_HEMMELIGHED=… scripts/test-redigering.ts && … scripts/test-beskrivelse.ts",
```

**Begge oplagte løsninger er grønne og forkerte:**

- **Tag main's:** billedkontrollen forsvinder.
- **Tag grenens:** `test:kerne`, `test:adaptere`, `test:oekonomi` og
  `test:besked` forsvinder, og syv prøvefiler køres ikke mere.

Begge gav exit 0 før prøven nedenfor.

**Den rigtige løsning, ordret:** behold main's fire nøgler, som de står i
konfliktblokken, og erstat `"test"`-linjen med

```json
    "test": "npm run proev:billedkontrol && npm run test:kerne && npm run test:adaptere && npm run test:oekonomi && npm run test:besked",
```

### 1b · Står der `tsx … scripts/proever.ts` (#49 er landet)

**Tag main's blok, som den står.** Der skal ikke skrives noget ind i
`"test"`. Opdageren finder hver `test-*.ts` i repoet og kører den i den
gruppe, filens `// gruppe:`-mærke siger. Grenens
[`gengivelse/test-billedkontrol.ts`](gengivelse/test-billedkontrol.ts) er
mærket `gruppe: kerne/2` og kører det samme som `proev:billedkontrol`.

Målt på en prøvefletning af grenen ind i #49's gren (`277f01d`).
`proever.ts --vis` viser filen i `kerne` som nummer 2, lige efter
`test-rene-filer` og `test-kildetjek`:

```
  kerne     i npm test
      0  npx tsx … scripts/test-rene-filer.ts
      1  npx tsx … scripts/test-kildetjek.ts
      2  npx tsx … docs/designforslag/gengivelse/test-billedkontrol.ts
```

Det er #49's pointe: konflikten om linjen forsvinder.

### Begge udgaver

`"proev:billedkontrol"` står længere nede, lige før `"test:prod"`, uden
for konfliktblokken. Den fletter ind af sig selv.

**Prøven, der gør de forkerte løsninger røde:**
[`gengivelse/proev-testkaede.mjs`](gengivelse/proev-testkaede.mjs). Den
genkender, hvilken slags kæde `"test"` er:

- **Håndskrevet kæde:** den følger hvert `npm run X` og kræver, at
  `proev:billedkontrol` nås, og at hver `scripts/test-*.ts` på disken
  nævnes.
- **Afledt kæde:** den kræver, at `test-billedkontrol.ts` findes og er
  mærket med en gruppe, opdageren kører i `npm test`. Gruppen læses af
  opdagerens egen `GRUPPER`. Kontrollen af resten er opdagerens egen.

Prøven kaldes fra `scripts/test-redigering.ts`, ikke fra `"test"`-linjen.
En prøve i den linje, fletningen erstatter, forsvinder med den. Men
`test-redigering.ts` køres af alle tre kæder (grenens, main's og #49's),
og tilføjelsen fletter rent ind i begge main-udgaver.

Målt på prøvefletningerne:

| main | Løsning | Prøven |
|---|---|---|
| før #49 | den rigtige linje i 1a | grøn |
| før #49 | main's blok / `checkout --theirs` | **rød:** «proev:billedkontrol står ikke i test-kæden» |
| før #49 | grenens blok / `checkout --ours` | **rød:** syv filer «køres ikke af npm test» |
| med #49 | main's blok (1b) | grøn |
| med #49 | main's blok, `test-billedkontrol.ts` mærket `manuel` | **rød:** «ikke kører i npm test» |
| med #49 | grenens `package.json` | **rød:** prøvefilerne «køres ikke af npm test» |

Med main's blok før #49 blev prøven også kørt, sådan som kæden kører den.
Main's `test-redigering.ts` under `testbase.ts` stoppede med exit 1, før
den første påstand.

## 2 · `kraevMaal` blev async — fletter rent og knækker

I #39 blev `kraevMaal` i `maalinger/laast-base.mjs` async, fordi den nu
læser refs'ene af `scripts/staging/maal.ts`. Grenens
`gengivelse/app-skud.mjs` kaldte den synkront:

```js
const MAAL = kraevMaal(['--maal', 'test'])
```

Linjen findes kun på grenen, så den fletter uden konflikt. Med main's
`laast-base.mjs` bliver `MAAL` et Promise, og `MAAL.url` er undefined.
Det fejlede højlydt med en TypeError, men først efter fletningen.

**Rettet på grenen før fletningen:** `await kraevMaal(…)`. Det virker mod
begge udgaver, for `await` på en almindelig værdi giver værdien. De andre
kaldere bruger `laastBase`, som var async begge steder.

## 3 · De syv andre konflikter

De opstod, fordi #39 blev skåret ud af denne gren og rettet undervejs.

| Fil | Tag | Hvorfor |
|---|---|---|
| `maalinger/laast-base.mjs` | **main** | Vagten fra #39 er strengere. Den læser produktionens ref fra `scripts/staging/maal.ts`, har kanalreglen (vært for direkte forbindelse, bruger for pooler), afviser fejl i procentkodningen med exit 3 og kræver Node ≥ 22.18. Grenens udgave godkender ethvert projekt, der ikke er staging. |
| `maalinger/proev-maal.mjs` | **main**, plus grenens to `app-skud.mjs`-tilfælde | Main's har de nye ref-tilfælde (41). #39 tog app-skud-tilfældene ud, fordi `app-skud.mjs` ikke landede. Det gør den nu, så de skal ind igen, med `await` i kaldet. |
| `maalinger/maal-prisspaend.mjs` | **main** | Kun kommentarer: `--base` → `--maal`. |
| `gengivelse/importer-testbase.sh` | **main** | Kun en kommentar om exit 3 og storage-grenen. |
| `forslag.css`, `greb.css` | **grenen** | #39 er en delmængde af grenens lag med de samme rettelser, og runde 5 har dem allerede (`GREB-5`, «Filer»). Grenens udgave er lagets fulde form: B, heroen og § 7. Tjek efter fletningen, at #39's fire rettelser stadig står: linkunderstregning i `--daempet`, de fire teal-links, `.sort-pille.valgt:focus-visible`, prisnoten i `#7a5416`. |
| `README.md` | **grenen**, plus #39's bevis-afsnit | Grenens README er rundernes forløb. Main's er A's. Afsnittet om `bevis/` fra #39 findes kun på main og skal med. |

## 4 · De ti billeder fra #39

#39 lagde ti billeder i `docs/designforslag/bevis/`. Grenen har dem
ikke, så de står ikke på
[`billedundtagelser.json`](gengivelse/billedundtagelser.json). Efter
fletningen er `npm test` rød på dem: «et nyt billede i repoet». Det er
meningen, for kontrollen kan ikke vide, at de kommer fra en fletning.

**Posterne skal ind i SAMME merge-commit som vagten, ikke i den næste.**
Grunden står i § 5.

**De kan ikke lægges på listen nu.** Filerne findes ikke på grenen, og en
post for en fil, der ikke findes, er også rød.

Posterne er udregnet af `main`'s bytes (`b39329a`). Sæt dem ind i
`"filer"`, ordret:

```json
{"fil": "docs/designforslag/bevis/a-bolig-billeder-320.jpg", "sha256": "7999172dc83c362f85705f2f004b710c513353fa732be662bd850ad97031aafc", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/a-bolig-billeder-360.jpg", "sha256": "a646ea784b25015a4ac1c5741030edc7b92f7af76b42ceac5bbb1bb2e6a57e52", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/a-forside-1440-bund.jpg", "sha256": "095bbfe28223026da0ee472178981706ad9f1242ef287e13b13e63ed03cafeb3", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/a-forside-320.jpg", "sha256": "4f5b59434baccc7c9a488c8e877d1f6f00121c754731f6853ba3088217964ca3", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/a-forside-390.jpg", "sha256": "add91c8d291be713ca589fed80229d892f7498eedcf7df55abce43eac0f3720e", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/foer-bolig-billeder-320.jpg", "sha256": "39b74d28f1a707fa8467caedf58faa177376719e9ab984ed0c1685d55a7e8b80", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/foer-bolig-billeder-360.jpg", "sha256": "015e313663876da4cb6d0e7280622177e9c50d5f0ad1d77c6b6fc4f4836a012a", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/foer-forside-1440-bund.jpg", "sha256": "ff4c9d3c2c3b539b5c8edde9126d804aaa025a6db207e4107b62a026710cea0d", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/foer-forside-320.jpg", "sha256": "ea789cfa82737cfc89c15c083fd87a593a6d657bfd03b4258cfaf839ad3c6607", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/designforslag/bevis/foer-forside-390.jpg", "sha256": "b86072f715270d7dfd413b01da57419a201f4230230f4bad260d1c2c79c2fcf7", "dato": "2026-10-01", "herkomst": "kendt", "grund": "Del A's måling på main's egen app (#39, 1. oktober 2026) mod testbasens 280 syntetiske boliger, før og med udsnittet. Skrevet før vagten fandtes, derfor uden kvittering. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."}
```

Datoen er 1. oktober, samme dag som lukningen, så posterne er gyldige.
Herkomsten er kendt: de er gengivet af denne session mod den syntetiske
testbase, og netværket var lukket.

## 5 · Rækkefølgen afgør, om vagten fødes grøn eller rød

**Når en vagt og det, den skal vogte, kommer fra hver sin gren, afgør
merge-rækkefølgen, om vagten fødes grøn eller rød.**

- Lander indholdet efter vagten, er det indholdets egen merge, der bliver
  rød. Det er det rigtige sted, for dér sidder den, der ved, hvad indholdet
  er.
- Lander indholdet før vagten, er vagten rød i det øjeblik, den lander, på
  noget, der allerede står på `main`, og som ingen i vagtens merge har
  lavet.

**En vagt, der fødes rød på eksisterende indhold, bliver slået fra i stedet
for rettet.** Den, der merger, ser en rød prøve på filer, de ikke har rørt,
i en ændring, der handler om noget andet. Den nemmeste vej til grønt er at
fjerne vagten eller lægge en undtagelse, der er bredere end nødvendigt. Det
er derfor, posterne skal ligge klar og ind i samme merge som vagten. Står
de i en opskrift til «bagefter», er vagten allerede væk, når bagefter
kommer.

Billedkontrollen har to sådanne tilfælde i dag:

| Indhold | Hvor | Kom/kommer | Hvad der skal ske |
|---|---|---|---|
| 10 billeder i `docs/designforslag/bevis/` | `main`, via #39 | før vagten: #39 er merget | § 4's poster i vagtens merge-commit |
| 8 billeder i `docs/kontomails/eksempler/` | #35, #9 og #3, alle åbne og alle `dirty`, med samme 8 filer og samme bytes | afhænger af rækkefølgen | posterne nedenfor i den merge, der kommer sidst af de to |

Optalt 2. oktober 2026 over alle 55 PR-hoveder, hentet udtrykkeligt
(`refs/pull/*/head`), så optællingen ikke kun ser de grene, der
tilfældigvis lå lokalt. Ingen anden åben PR lægger billeder i `docs/`.

**Kontomails-billederne, to veje:**

- **Lander #35 (eller #9 eller #3) før designgrenen:** de 8 poster skal ind
  i designgrenens merge-commit sammen med § 4's ti.
- **Lander designgrenen først:** #35's merge bliver rød på de 8. Posterne
  skal ind i #35's merge-commit. Det er #35's session, der skal efterse
  herkomsten. Herfra er den ikke set.

Datoen er 30. september, før lukningen, så posterne er gyldige. Herkomsten
er «ikke efterset», og fristen er den samme som for de 157: 30. december
2026. Udregnet af bytes på #35's hoved, der er identiske i #3, #5 og #9:

- **Datoen gælder #35.** I #3 og #9 blev filerne lagt til i en anden
  commit, `83fbf25`, 12. september. Lander en af dem, er det dens dato.
  Begge ligger før lukningen.
- **#3, #9 og #35 er alle `dirty` mod `main`**, målt med `git merge-tree`
  og på hvert sit enkelt-endpoint. De skal rebases, før de kan lande, og
  en rebase kan ændre billedfilerne. **Regn sha'erne om EFTER rebasen**
  (`sha256sum docs/kontomails/eksempler/*.png`), ikke før. Det er samme
  regel som overalt i kontrollen: ændres et billede før merge, passer dets
  post ikke.
- **Hvorfor datoen holder, mens sha'en ikke gør:** posten bærer to slags
  oplysninger, og en rebase behandler dem forskelligt. Datoen er
  forfatterdatoen på den commit, der lagde filen til (`git log
  --diff-filter=A --format=%ad`). En rebase skriver commits om, men
  beholder forfatterdatoen, så datoen er den samme før og efter. Sha'en er
  regnet af filens bytes, og dem kan en rebase ændre: en konflikt i filen,
  en anden version på `main` eller en opløsning, der vælger den anden side.
  Datoen kan derfor skrives i dag. Sha'en kan først skrives, når det hoved,
  der skal lande, findes. Det er sagt på [#35](https://github.com/ukutuku/Bofinda/pull/35),
  [#3](https://github.com/ukutuku/Bofinda/pull/3#issuecomment-5958688796)
  og [#9](https://github.com/ukutuku/Bofinda/pull/9#issuecomment-5958691647).

```json
{"fil": "docs/kontomails/eksempler/kvittering-bolig-desktop.png", "sha256": "ad95c070166a2412f3a1761ac76f735ef288c5476578f2f0bfb0e9a43b25efcb", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/kvittering-bolig-mobil.png", "sha256": "ed5e67b16dae9a62a6140c134de83ed658986e8b6d2c88cc6bec28cb4eda35a3", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/kvittering-udenlogin-desktop.png", "sha256": "d6a43eaa544676225237b4dd310d9d7a21c9941be9273d25a0e19b6ce2e6515a", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/kvittering-udenlogin-mobil.png", "sha256": "aa5f111430465b5dc8e02877a072bc9da1e842b6f07171501d797970db09c438", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/kvittering-udlejer-desktop.png", "sha256": "b0119e74077064689f2d8026cd46a5d03de498f63003e7976c16d3c8a83a7f17", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/kvittering-udlejer-mobil.png", "sha256": "ff523d129d9f007cc33a5fdee0eaf2dd96b71c16362ab4dd7423b5586171f525", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/mail-desktop.png", "sha256": "c55f3cb8830b9fe96f9cc4b1aa46d9ed3f1d8b85d68d513d34257939a889d5ab", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."},
{"fil": "docs/kontomails/eksempler/mail-mobil.png", "sha256": "17f9b72d2df31168092f53493b7442a27e019b6c490a17c0bc1a92f2aea6a19f", "dato": "2026-09-30", "herkomst": "ikke efterset", "grund": "Mailskabelonernes eksempler fra kontomails-arbejdet (698ef85, «Gendannelse af adgangskode, og kontomails med BOFINDAs maerke»), skrevet 30. september 2026, før vagten fandtes. Herkomsten er ikke efterset af denne session. Beholdt af samme grund som designforslagets: omskreven historik er værre end vægten (GREB-5 § 5)."}
```

**Efter fletningen, i rækkefølge:**

1. `npm test`: billedkontrollen (med § 4's ti poster, og § 5's otte, hvis
   #35 er landet), test-kæden og main's fire nøgler.
2. `node docs/designforslag/maalinger/proev-maal.mjs`: vagten, med
   app-skud-tilfældene.
3. `node docs/designforslag/gengivelse/proev-kildebilleder.mjs` mod
   `scripts/cloud/op.sh`: vagten mod kildebilleder i browseren.
