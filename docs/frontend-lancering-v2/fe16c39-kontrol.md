# Browserkontrol af `fe16c39` — og rettelserne oven på

Kørt 14. september 2026 mod det isolerede Cloud-testmiljø: loopback-base
på 127.0.0.1:55432, 264 syntetiske boliger, lokale kortfliser,
produktionsbygget, bygget **uden** hero-miljøvariabler. Samtykket afvist
med den rigtige knap — aldrig skjult med CSS.

Tre flader × tre bredder: **forsiden**, **de åbne filtre** (`/?flere=1`)
og **boligdetaljen**, på 390, 768 og 1440 px.

`fe16c39` oplyste selv i `mobilopstramning.md` og `mobilafslutning.md`,
at der ikke var taget browserbilleder, og at visuel kontrol udestod.
Det er dét, der er gjort her.

---

## ⚠️ Ugyldig måling i den første kørsel: «afstand før sidefoden = 0 px»

Den første kørsel skrev denne linje for alle tre flader på alle tre
bredder:

    ✓ 390 · forside: afstand før sidefoden er rimelig (≤ 140 px)  — 0 px
    ✓ 768 · forside: afstand før sidefoden er rimelig (≤ 140 px)  — 0 px
    ✓ 1440 · forside: afstand før sidefoden er rimelig (≤ 140 px) — 0 px
    … og tilsvarende for «filtre-aabne» og «boligdetalje»

**Alle ni af de linjer er ugyldige. Tallet 0 px er ikke en måling af
noget.**

Målingen tog «bunden af det nederste element i dokumentet» og trak den
fra sidefodens top. Indholdsrammen `.ramme` **har** bundpolstring og når
derfor selv helt ned til sidefoden — så differencen blev nul på hver
eneste bredde og hver eneste flade. Nul var rammens egen kasse, ikke
afstanden under det, en læser ser.

Den var desuden grøn, hvilket er det værste ved den: en måling, der
altid giver nul og altid består, ser ud som en kontrol og er det ikke.

### De korrekte målinger

Målt fra **det sidste indholdsfelt i rammen** til sidefodens top:

| Flade | 390 px | 768 px | 1440 px |
|---|---|---|---|
| Forside | **28 px** | **72 px** | **72 px** |
| Filtre åbne | **28 px** | **72 px** | **72 px** |
| Boligdetalje | **28 px** | **72 px** | **72 px** |

Det svarer præcis til det, `fe16c39`s egen `mobilafslutning.md`
beskriver: «den ydre indholdsrammes [bundpadding reduceres] fra 72 til
28 px» på mobil. Ingen fejl i produktet — kun i målingen.

Den rettede måling ligger nu i `scripts/cloud/lancering.mjs`, så den er
gentagelig. Den har ikke et fast måltal, fordi afstanden er en
designbeslutning; den fanger, at afstanden er positiv og ikke løber
løbsk (8–160 px).

---

## Fundet og rettet: berøringsmål

Tre kontroller fik kun deres højde af regler i
`@media (max-width: 560px)` og faldt tilbage til basispolstringen over
560 px. En 768 px-skærm er også en finger.

| Kontrol | 390 px | 768 px | 1440 px | |
|---|---|---|---|---|
| «Søg boliger» (hero/bjælke) | 48 | 48 | 63 | ✓ holdt |
| «Opret annonce» (udlejerbånd) | 49 | 49 | 49 | ✓ holdt |
| «Se annoncen hos …» (boligside) | 53 | 53 | 53 | ✓ holdt |
| **«Flere filtre»** (åbner filtrene) | **43** | **36** | **36** | ✗ |
| **«Søg»** (indsender panelet) | 48 | **40** | **40** | ✗ |
| **«Nulstil»** | 48 | **40** | **40** | ✗ |
| **«+N billeder»** (galleriet) | **31** | **31** | **31** | ✗ |

`mobilafslutning.md` skriver selv, at «kontrollinjer er mindst 44 px
høje» — de var det bare kun på telefonen.

### Efter

| Kontrol | 390 px | 768 px | 1440 px |
|---|---|---|---|
| «Flere filtre» | 44 | 44 | 44 |
| «Søg» | 48 | 44 | 44 |
| «Nulstil» | 48 | 44 | 44 |
| «+N billeder» | **44 × 96** | **44 × 96** | **44 × 96** |

`min-height` er sat på **basisreglerne**, ikke i endnu en
medieforespørgsel. Polstringen på smal skærm løfter dem stadig til 48 px.
Galleriknappen har også `min-width: 44px` — gulvet hører til kontrollen,
ikke til den tekst, der tilfældigvis står i den.

### Galleriknappen virker stadig

Ikke bare målt, men **klikket**: i pillens øverste venstre hjørne, i
dens nederste højre hjørne og i midten, på alle tre bredder. Alle ni
klik åbner lysbordet (`.lysbord` findes præcis én gang bagefter, og
Escape lukker det igen).

Knappen er den eneste vej ind i lysbordet fra galleriet — og på en
telefon den eneste vej ind overhovedet, fordi de små ruder skjules under
720 px.

Ingen klippet tekst i pillen, og den holder sig inden for galleriets
ramme på alle tre bredder.

---

## Det, der blev efterprøvet og holdt

På alle tre flader og alle tre bredder, efter rettelserne:

- **Vandret overløb: 0 px** overalt
- **Intet element uden for viewporten**
- **Ingen klippet tekst** — målt på overskrifter, adresser, priser,
  faktachips, filteretiketter, grundlagstal, mærkater, chips og knapper
- **Udlejeropfordringen står ét sted:** det grønne bånd. Det ekstra
  udlejerkort fra før `fe16c39` er væk, og der er tre infokort tilbage.
  Båndet er 244 px højt på 390, 171 på 768, 154 på 1440.

## Kontroller kørt

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` | ingen fejl |
| `npm test` (PGlite) | ALT GRØNT |
| `npx next build` | Compiled successfully |
| `git diff --check` | bestået |
| `scripts/cloud/kontrol.sh` | ALT GRØNT |
| `scripts/cloud/kontrol-pagination.sh` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt, inkl. de nye berøringsmål og den rettede sidefodsmåling |
| `scripts/cloud/hero.sh` | alt grønt |

**Ikke kørt:** `npm run test:prod`, importer og scheduler. Ingen
produktionsdata, ingen merge, intet deployment; `vercel.json` og
deployspærringen er urørte.

## Billederne

I `fe16c39-kontrol/`. Boligdataene er syntetiske — de stribede flader på
boligkortene er testaktiver, ikke boligfotos.

| Fil | Viser |
|---|---|
| `galleriknap-{390,768,1440}.png` | boligsiden med den rettede pille |
| `filtre-aabne-{390,768,1440}.png` | det åbne filterpanel |
| `sidefod-390.png` | mobilens udlejerbånd og sidefod |
