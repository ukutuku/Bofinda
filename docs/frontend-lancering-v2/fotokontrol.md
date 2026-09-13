# Fotokontrollen — DELVIST gennemført: ét af tre motiver

Hører til [PR #6](https://github.com/ukutuku/Bofinda/pull/6), kandidat
[`fa522eb`](https://github.com/ukutuku/Bofinda/commit/fa522eb).
Applikationskoden er urørt under kontrollen.

**Stockfotos til layouttest — ikke en virkelig boligannonce.**

Ét rigtigt fotografi er nået frem og er kørt igennem kort, galleri,
billedknap og lysbord på 390 og 1440 px. **37 kontroller, alle grønne.**
De to øvrige motiver mangler stadig — se nederst.

## Fotografiet der blev brugt

| | |
|---|---|
| Fil | `dk-vesterhavet-sommerhus.jpg` |
| Motiv | Sommerhus ved Vesterhavet — **liggende**, mørk trælamelfacade over marehalm, lys overskyet himmel |
| Fotograf | Johannes Sejer |
| Kilde | [unsplash.com/photos/…Xn3vcIpPi1E](https://unsplash.com/photos/a-house-on-top-of-a-grassy-hill-Xn3vcIpPi1E) |
| Licens | [Unsplash License](https://unsplash.com/license) |
| Sted | Vesterhavet, Danmark, ifølge fotografens egen beskrivelse på kildesiden |
| Mål | **2048 × 1638 px** (5:4) |
| Bytes | 841.514 |
| SHA256 | `ae4cd85ad5980361422077f3bade43012185c6398354e922f9024b31325d00c7` |

Filen kom som base64 i en tekstpakke, ikke fra nettet: egress-politikken
afviser `unsplash.com` og `images.pexels.com`, og det er hverken prøvet
igen eller omgået. **Den oplyste SHA256, filstørrelse og dimensioner er
efterprøvet mod de afkodede bytes og matcher alle tre.** Filen ligger i
`/var/lib/bofinda-test/fotos/` — uden for repoet, som aftalt.

Stedsangivelsen bygger på kildesidens egen oplysning. Fotografiet
dokumenterer ikke et lejemål på Bofinda.

## Sådan blev den kørt

```bash
scripts/cloud/op.sh
node scripts/cloud/fotokontrol.mjs skaermbilleder/fotokontrol
```

Mod `next start` på det byggede output i det isolerede loopback-miljø, med
testvariablerne indlæst af `scripts/cloud/miljoe.sh`. Samtykket afvist med
den normale knap. Hvert skærmbillede bærer mærkatet nederst, sat af
kontrollen — ikke af appen.

Fotografiet blev lagt på to syntetiske annoncer, og **rækkerne blev sat
tilbage bagefter**. Galleriet viser tre ruder plus «+N billeder», så det
ene motiv er gentaget fire gange for at kunne fylde dem — det er det
samme fotografi, ikke fire forskellige. Det står også i scriptets
udskrift.

## Det målte

| | 1440 px | 390 px |
|---|---|---|
| Kortets motiv, leveret af billedproxyen | 400 × 320 px | 400 × 320 px |
| Kortets billedramme | 248 × 186 px | 326 × 183 px |
| `object-fit` på kort og galleri | `cover` | `cover` |
| Kortets samlede højde | 214 / 221 px | 452 / 453 px |
| Galleriets højde | **400 px** (loftet) | 260 px |
| Galleriets ruder, dekodet | 800 × 640 ×3 | 800 × 640 |
| «+N billeder» inde i galleriet | ja | ja |
| Knappens farver over motivet | `rgb(20,22,26)` på `rgba(255,255,255,.94)` | samme |
| Lysbordet | `contain` · **1,25 = 1,25** | `contain` · **1,25 = 1,25** |
| Lysbordet lukker med Escape | ja | ja |
| Vandret overløb | 0 px | 0 px |

Forholdet 1,25 er fotografiets eget (2048/1638). At det viste forhold er
det samme, er beviset for, at lysbordet ikke beskærer og ikke forvrænger.

## Vurdering af beskæringen — set, ikke kun målt

**Boligkortet, 1440 px** ([kort-desktop.png](fotokontrol/kort-desktop.png)).
Rammen er 248 × 186, altså 4:3, mod fotografiets 5:4. Beskæringen tager
fra top og bund — mest himmel og forgrundsgræs. **Hele huset overlever:**
tagryg, skorsten, den mørke trælamelfacade og vinduesbåndet står frit, og
græsset under giver det kontekst. Motivet er stadig genkendeligt ved 248 px.

**Boligkortet, 390 px** ([kort-mobil.png](fotokontrol/kort-mobil.png)).
Kortet stabler, og billedet bliver et bånd i 16:9 over teksten. Det er den
strammeste beskæring i hele fladen, og den holder: huset fylder den øverste
halvdel, græsset den nederste. Intet væsentligt er skåret væk i siderne.

**Galleriet, 1440 px** ([galleri-desktop.png](fotokontrol/galleri-desktop.png)).
Den store rude er ~608 × 400 (1,52 mod motivets 1,25) og tager derfor en
vandret skive: lidt himmel i toppen og lidt græs i bunden falder væk. Huset
står helt. De to små ruder er ~310 × 195 og beskærer hårdere — i den øverste
er husets venstre ende skåret af kanten. Det er `cover` der arbejder som
den skal, ikke en fejl, men det er værd at vide: **de små ruder viser et
udsnit, ikke motivet.** Den store rude bærer helheden.

**Galleriet, 390 px** ([galleri-mobil.png](fotokontrol/galleri-mobil.png)).
Én rude i 260 px. Huset og græsset er med; ingen af delene er klemt.

**Lysbordet** ([lysbord-desktop.png](fotokontrol/lysbord-desktop.png) ·
[lysbord-mobil.png](fotokontrol/lysbord-mobil.png)). Hele fotografiet, uden
beskæring, med tæller «1 / 4», miniaturer, pile og lukkeknap. Det er her
motivet kan ses som fotografen tog det, og det virker på begge bredder.

**Billedknappen.** «+1 billeder» ligger på den nederste højre rude, altså
over marehalmen — et mellemtonet, uroligt motiv med struktur, hvilket er
det sværeste tilfælde for læsbarhed. Den lyse pille med mørk tekst står
tydeligt. Knappens egne farver er uændrede af motivet, og kontrasten er
regnet mod både helt hvidt og helt sort underlag i
`scripts/cloud/lancering.mjs`: 15,9:1 normalt, 18,1:1 ved hover og fokus.

**Ingen produktfejl fundet.**

## Det står stadig tilbage

**To af tre motiver mangler.** Tekstpakken indeholdt kun sommerhuset:

| Motiv | Status |
|---|---|
| Sommerhus ved Vesterhavet (liggende) | ✅ kørt igennem |
| Stue/interiør, København (stående) — Alla Hetman | ❌ ikke i pakken |
| Badeværelse, Holbæk (stående) — Christian Cortsen | ❌ ikke i pakken |

Derfor er følgende **ikke** afgjort med et fotografi:

- **Et stående motiv i en liggende ramme.** Det er den hårdeste beskæring
  fladen laver, og de to manglende fotografier er netop stående. Geometrien
  er målt med en genereret stående form (se [`geometri/`](geometri/)), men
  om en sofa eller en håndvask overlever udsnittet er ikke set.
- **Et motiv med kraftige skygger og direkte sollys.** Stuebilledet er
  valgt netop for det; sommerhuset er jævnt, overskyet lys.
- **Et lyst, detaljerigt motiv under billedknappen.** Her lå der grønt
  græs; badeværelsets lyse fliser ville være en anden prøve.
- **Farvegengivelse.** Intet i kontrollen rører det.

Kommer de to filer gennem samme tekstpakke, er kontrollen ét kald væk:
`node scripts/cloud/fotokontrol.mjs`.

## Afgrænsning

Skærmbillederne verificerer **layoutet med et fotografi** — ikke
billedlevering fra Bofindas rigtige annoncekilder. Adresser og beløb er
syntetiske. Der er ikke rørt produktionsdata, ingen billeder er sat ind på
rigtige annoncer, og produktions-billedproxyens værtstilladelser er
uændrede. De rå fotografier er ikke i repoet.
