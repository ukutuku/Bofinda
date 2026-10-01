# Modprøver

CLAUDE.md siger princippet:

> Kan du ikke få det rødt ved at indføre fejlen med vilje, måler det ikke
> det, du tror.

Mappen her er **mekanikken**, så princippet ikke hviler på, at nogen husker
det. Én mutation pr. fil, og `scripts/modproeve.mjs` kører den.

```bash
node scripts/modproeve.mjs modproever/<mutation>.mjs -- <prøvekommando>

# fx
node scripts/modproeve.mjs modproever/ellinje-vaek.mjs -- npm run test:kerne
```

**Exitkoden svarer på det rigtige spørgsmål.** `0` betyder *«mutationen BLEV
fanget»* — ikke *«kommandoen kørte»*. En grøn prøve mod indført fejl er et
**fund**, og det er `exit 1`.

## Hvorfor den laver sit eget arbejdstræ

Første udgave muterede det træ, den blev kaldt fra. Det gik galt på præcis
den måde, man ikke ser: en `git add -A` i en anden kommando ramte, mens
mutationen var aktiv, og **indekset fangede den muterede fil**. Havde den
commit gået igennem, var fejlen landet sammen med den modprøve, der lige
havde bevist den. Det blev opdaget, fordi `git status` viste `MM` — ikke
fordi noget i prøveoutputtet antydede det.

Derfor muteres der aldrig i kalderens træ. `git worktree add` giver et eget
træ, mutationen sker dér, og det fjernes igen — også når noget går i
stykker.

## De tre vagter

| Vagt | Afviser | Hvorfor |
|---|---|---|
| **1** | et træ med uforpligtede ændringer | Et arbejdstræ skabes fra et **commit**. Er der uforpligtet arbejde, ligger det ikke i træet — så modprøven måler en anden kode end den, du afleverer. En grøn modprøve mod det forkerte træ ser ud som et bevis og er det modsatte. |
| **2** | en mutation, der ikke ændrer nogen fil | Ramte mønstret ikke, kører prøven mod **uændret** kode og bliver grøn. Uden vagten læser det som «vagten virker ikke» — den præcist omvendte konklusion. |
| **3** | en mutation, der ikke bliver rød | Det er hele formålet. Derfor er det exitkoden. |

Alle tre er efterprøvet ved at fremkalde dem, ikke ved at læse koden.

## Sådan skriver du en mutation

En mutation er en `.mjs`-fil, der får **arbejdstræets rod** som `argv[2]`:

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const p = join(process.argv[2], 'app/Boligkort.tsx')
const s = readFileSync(p, 'utf8')
const gl = /\n\s*<Ellinje tilstand=\{[\s\S]*?\} \/>/
if (!gl.test(s)) { console.error('mutation: mønstret ramte ikke'); process.exit(1) }
writeFileSync(p, s.replace(gl, ''))
```

Tre ting:

1. **Fejl højt, hvis mønstret ikke rammer.** Vagt 2 fanger det også, men din
   egen fejlbesked siger hvad der blev ledt efter.
2. **Bryd ÉN ting.** En mutation, der bryder to, kan ikke sige hvilken af
   dem prøven fanger. Skal to brydes, er det to filer.
3. **Sig i kommentaren, hvad den faktisk gør** — ikke hvad du havde tænkt.
   `ellinje-vaek.mjs` sagde først «fra gruppekortet»; mønstret er
   ikke-grebigt og ramte enkeltkortet. Begge er gyldige mutationer, men
   beskrivelsen skal passe på den, der køres.

## Hvad der ligger her

| Fil | Bryder | Fanges af |
|---|---|---|
| `ellinje-vaek.mjs` | enkeltkortets el-linje | `test-redigering.ts` · 3 røde, heraf `GRØN UDEN EL-LINJE` |
| `rammer-ikke.mjs` | ingenting, med vilje | vagt 2 — den findes for at prøve køreren selv |

## Til den, der samler et fælles hjælperlag

Køreren her gør to ting, som et hjælperlag bør arve: den **isolerer** (eget
træ, kalderens arbejdskopi urørt) og den **vender exitkoden** om til det
spørgsmål, man faktisk stiller. Den kender ingenting om prøvernes form, så
den virker med `npm run test:kerne` lige så godt som med en enkelt
`tsx`-kommando. Gøres den til en del af et større hjælperlag, er det de to
egenskaber, der skal overleve — resten er implementering.
