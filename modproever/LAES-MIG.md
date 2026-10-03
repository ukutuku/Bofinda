# Modprøver

CLAUDE.md siger princippet:

> Kan du ikke få det rødt ved at indføre fejlen med vilje, måler det ikke
> det, du tror.

Mappen her er **mekanikken**, så princippet ikke hviler på, at nogen husker
det. Én mutation pr. fil, og `scripts/modproeve.mjs` kører den.

```bash
git add -A                     # vagt 1: træet bygges af INDEKSET
node scripts/modproeve.mjs modproever/synken-brydes.mjs -- npm run test:kerne
```

Sidste linje siger udfaldet **i ord**:

```
  ══════════════════════════════════════════════════
   MUTATIONEN BLEV FANGET — 2 roede (proeven gav exit 1)
  ══════════════════════════════════════════════════
```

eller `MUTATIONEN SLAP IGENNEM — proeven blev groen`. Exitkoden følger
ordene — `0` = fanget — men man skal ikke læse tallet alene, for den er
**vendt om** i forhold til den indre `npm test`.

## Den naturlige orden overlever

Man skriver kode, skriver prøven, beviser at den kan blive rød, og
committer **derefter**. Så arbejdstræet bygges fra **indekset**, ikke fra
`HEAD`:

    git write-tree          →  et træ af det iscenesatte
    git commit-tree …       →  et HÆNGENDE commit; ingen ref peger på det
    git worktree add        →  træet, mutationen sker i

Første udgave krævede et *rent* træ og forbød dermed rækkefølgen i
praksis: modprøven kunne først køres, efter at det, den kontrollerer, var i
historikken.

## Hvorfor den laver sit eget arbejdstræ

Første udgave muterede det træ, den blev kaldt fra. Det gik galt på præcis
den måde, man ikke ser: en `git add -A` i en anden kommando ramte, mens
mutationen var aktiv, og **indekset fangede den muterede fil**. Havde den
commit gået igennem, var fejlen landet sammen med den modprøve, der lige
havde bevist den. Det blev opdaget, fordi `git status` viste `MM` — ikke
fordi noget i prøveoutputtet antydede det.

## De fem vagter

| Vagt | Afviser | Hvorfor | Efterprøvet |
|---|---|---|---|
| **1** | noget uden for indekset | `write-tree` ser kun det iscenesatte. Uiscenesat arbejde og nye filer ville ikke være under prøve, og en grøn modprøve uden dem ser ud som et bevis. | to ændrede filer uden `git add` → `AFVIST` |
| **2** | en mutation, der ikke ændrer nogen fil | Prøven ville køre mod **uændret** kode og blive grøn — hvilket læser som «vagten virker ikke». | dækket af vagt 4 i praksis; står som bagstopper |
| **3** | en mutation, der ikke bliver rød | Hele formålet, og derfor exitkoden. | `ellinje-vaek-*.mjs` → rødt |
| **4** | en mutation, der rammer et andet sted end den erklærer | **Det er sket tre gange i dette repo:** linjeankeret, `/tilbud === null/` i en kommentar, og `ellinje-vaek` der påstod gruppekortet og ramte enkeltkortet. Vagt 2 ser det ikke — mutationen *gjorde* noget, bare ikke det, den sagde. | `rammer-ikke.mjs` (0 træffere mod 1) og `lyver-om-stedet.mjs` (rigtigt antal, holdepunkt 231 linjer væk) → begge `AFVIST` |
| **5** | at køreren selv efterlader et arbejdstræ | `process.exit()` inde i `try` springer `finally` over, og første udgave lækkede derfor et træ ved hver afvisning. Fundet ved at **læse** `git worktree list` — et værktøjs tavshed er ikke et bevis, så nu tælles der. | tælleren er prøvet i isolation (fyrer på et lækket træ, tier når oprydningen virkede). **Ikke** prøvet med en rigtig fejlende oprydning — det kan ikke fremkaldes uden at sabotere koden, og det står her frem for at kaldes verificeret. |

## Mutationsformen

En mutation er en `.mjs`-fil, der **erklærer sin forventning** og intet
andet. Erklæringen er det, der gør vagt 4 mulig:

```js
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: '!n.total || !g.nogenUdenEl ? null',   // streng eller RegExp
  traeffere: 1,              // PRÆCIST antal — afvig = rammer et andet sted
  vaelg: 0,                  // hvilken træffer (0-baseret), hvis flere
  naer: 'Gruppenoegle.total', // holdepunkt, der pinner HVILKEN
  naerVindue: 15,            // … inden for så mange linjer (valgfrit)
  erstat: '!g.nogenUdenEl ? null',  // '' = fjern
}
```

Behøver mutationen mere end en erstatning, kan filen i stedet eksportere
`default function muter(indhold, fund, vaelg)` — men **erklæringen er
obligatorisk uanset**.

Tre ting at holde fast:

1. **`traeffere` er et præcist tal, ikke et minimum.** Rammer mønstret et
   andet antal, rammer det et andet sted.
2. **Bryd ÉN ting.** En mutation, der bryder to, kan ikke sige hvilken af
   dem prøven fanger. Skal to brydes, er det to filer.
3. **`naer` findes, fordi `vaelg` alene er skrøbeligt.** `vaelg: 1` peger
   på «den anden træffer» — og hvilken det er, kan skifte, når filen
   ændres. Holdepunktet gør valget til et udsagn om *koden* i stedet for om
   *rækkefølgen*.

## Hvad der ligger her

| Fil | Bryder | Udfald |
|---|---|---|
| `ellinje-vaek-enkeltkort.mjs` | enkeltkortets el-linje | fanget · **3 røde** |
| `ellinje-vaek-gruppekort.mjs` | gruppekortets el-linje | fanget · **7 røde** |
| `synken-brydes.mjs` | synken mellem de to korttyper | fanget · **2 røde** |
| `rammer-ikke.mjs` | ingenting — mønstret findes ikke | **afvist af vagt 4** |
| `lyver-om-stedet.mjs` | rigtigt sted, forkert erklæret holdepunkt | **afvist af vagt 4** |

De to sidste er ikke modprøver af produktet. De er modprøver af **køreren**,
og de hører her, så vagt 4 selv kan blive rød.

---

## Grænsefladen — til det fælles hjælperlag

Supply beskriver den anden halvdel: at **afvise træffere i kommentarer og
strenge**, og at **kræve et forventet antal**. Køreren her ejer antallet og
stedet; hjælperen ejer *kvaliteten* af en træffer. De er ét værktøj, og de
møder hinanden i `forventning`.

**Køreren garanterer tre ting, og de skal overleve en sammenlægning:**

| Invariant | Hvad det betyder |
|---|---|
| **Isolation** | Mutationen sker i et eget arbejdstræ, bygget af indekset. Kalderens arbejdskopi og indeks røres ikke, uanset hvad mutationen gør — og køreren efterlader intet (vagt 5). |
| **Exitkoden svarer på «blev den fanget»** | Ikke på «kørte kommandoen». En grøn prøve mod indført fejl er `exit 1`, og udfaldet står i ord på sidste linje. |
| **Erklæringen efterprøves FØR mutationen anvendes** | `fil`, `traeffere` og eventuelt `naer` tjekkes mod indholdet. En mutation, der ikke rammer som erklæret, kører aldrig. |

**Det naturlige sted at møde hinanden** er et ekstra felt i `forventning`,
som hjælperen fortolker og køreren blot giver videre — fx:

```js
export const forventning = {
  fil: 'lib/soeg.ts',
  moenster: /'Lejlighed'/,
  traeffere: 3,
  // Supplys halvdel: hvilke slags træffere tæller med
  kun: 'kode',          // 'kode' | 'alle' — udelader kommentarer og strenge
}
```

Køreren kender ikke `kun` i dag og ignorerer den. Skal den håndhæves, hører
fortolkningen i hjælperen, og køreren skal kun lære at kalde den **før**
`traeffere` tælles — altså ét sted, i stedet for at hver mutation selv
filtrerer. Så bliver `traeffere: 3` et udsagn om koden og ikke om filen.
