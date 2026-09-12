# Fotokontrollen — status: IKKE GENNEMFØRT

Hører til [PR #6](https://github.com/ukutuku/Bofinda/pull/6), kandidat
[`fa522eb`](https://github.com/ukutuku/Bofinda/commit/fa522eb).

**Fotokontrollen er ikke bestået og er ikke kørt.** De udvalgte
fotografier kunne ikke hentes: sessionens egress-politik afviser begge
værter. Nedenfor står præcis hvad der blev forsøgt, hvad der i stedet er
målt, og hvad der skal til for at gøre kontrollen færdig.

## Fotografierne der skulle bruges

Udvalgt og licenskontrolleret uden for denne session. Kilde, fotograf og
licens bevares her, som aftalt — også selv om ingen af de to licenser
kræver kreditering.

| # | Motiv | Fotograf | Kilde | Licens |
|---|---|---|---|---|
| 1 | Sommerhus ved Vesterhavet — liggende, mørk træfacade, græs, lys himmel | Johannes Sejer | [unsplash.com/photos/…Xn3vcIpPi1E](https://unsplash.com/photos/a-house-on-top-of-a-grassy-hill-Xn3vcIpPi1E) | [Unsplash License](https://unsplash.com/license) |
| 2 | Stue/interiør, København — stående, dybe skygger og direkte sollys | Alla Hetman | [unsplash.com/photos/…nPXpvb06yc4](https://unsplash.com/photos/gray-padded-sofa-inside-pink-room-nPXpvb06yc4) | [Unsplash License](https://unsplash.com/license) |
| 3 | Badeværelse, Holbæk — stående, lyse installationer, grå fliser | Christian Cortsen | [pexels.com/photo/27460871](https://www.pexels.com/photo/bathroom-interior-27460871/) | [Pexels License](https://www.pexels.com/license/) |
| 4 | Gule byhuse, København *(ekstra, ikke visuelt gennemset)* | Anastasia Haritonov | [pexels.com/photo/30225599](https://www.pexels.com/photo/historic-yellow-houses-in-copenhagen-denmark-30225599/) | [Pexels License](https://www.pexels.com/license/) |

Stedsangivelserne bygger på kildesidernes egne oplysninger, ikke på en
uafhængig geolokation. Ingen af billederne dokumenterer et faktisk
lejemål.

## Hvorfor hentningen ikke lykkedes

Ét forsøg pr. adresse, med almindelig `curl` gennem sessionens proxy.
Alle tre blev afvist i CONNECT-fasen:

```
curl: (56) CONNECT tunnel failed, response 403
```

Proxyens egen fejllog (`$HTTPS_PROXY/__agentproxy/status`):

```
connect_rejected  unsplash.com:443
    gateway answered 403 to CONNECT (policy denial or upstream failure)
connect_rejected  unsplash.com:443
    gateway answered 403 to CONNECT (policy denial or upstream failure)
connect_rejected  images.pexels.com:443
    gateway answered 403 to CONNECT (policy denial or upstream failure)
```

Hverken `unsplash.com` eller `pexels.com` står på proxyens no-proxy-liste,
så begge går gennem politikken, og politikken siger nej.

**Der er ikke prøvet igen, og der er ikke søgt uden om.** Proxyens egen
vejledning er utvetydig — *"Do not retry or route around it — report the
blocked host"* — og opgaven siger det samme. Et andet billede fra en
tredje vært ville være den samme omgåelse med en anden adresse, og er
derfor heller ikke hentet.

## Sådan gøres kontrollen færdig

Filerne lægges i `/var/lib/bofinda-test/fotos/` (uden for repoet —
fotografier med licens og fotograf hører ikke i et kodelager, og reglen i
`scripts/cloud/aktiver.mjs` om ingen binære filer står ved magt):

```bash
scripts/cloud/op.sh                     # miljøet op
node scripts/cloud/fotokontrol.mjs skaermbilleder/fotokontrol
```

Aktivserveren serverer dem på `/foto/<filnavn>`, og
`scripts/cloud/fotokontrol.mjs` bruger dem automatisk. Uden filer svarer
`/foto` med en tom liste, scriptet siger det højt og slutter med **status
2** — den kan aldrig forveksles med en bestået kontrol.

Kontrollen sætter selv motiverne på to syntetiske annoncer i den
isolerede base og **sætter rækkerne tilbage bagefter**, også hvis noget
fejler undervejs.

## Hvad der SÅ blev målt — geometri, ikke fotografi

Med genererede former i stedet: stående 600×900, liggende 1800×600, og en
næsten hvid og en næsten sort i 1200×900. De svarer på beskæring, stræk,
højde og overløb. **De svarer ikke på, hvordan et rigtigt motiv ser ud.**

Kørt mod `next start` på det byggede output i det isolerede loopback-miljø,
på 1440 × 1000 og 390 × 844 px. Samtykket afvist med den normale knap.
Alle visninger bærer et mærkat nederst i billedet.

| Målt | 1440 px | 390 px |
|---|---|---|
| Kortets motiv dekodet | 400×600 px | 400×600 px |
| Kortet beskærer (`object-fit`) | `cover` | `cover` |
| Kortets højde med et stående motiv | 214 / 221 px | 452 / 453 px |
| Galleriets højde | **400 px** (loftet) | 260 px |
| Galleriet beskærer | `cover` | `cover` |
| «+N billeder» inde i galleriet | ja | ja |
| Lysbordet viser hele motivet | `contain` · 0,67 = 0,67 | `contain` · 0,67 = 0,67 |
| Lysbordet lukker med Escape | ja | ja |
| Vandret overløb | 0 px | 0 px |

**26 kontroller, alle grønne.** `object-fit: cover` beskærer og strækker
ikke — forskellen på et beskåret og et forvrænget motiv. Ternene i de
genererede former er kvadratiske i alle udsnit, hvilket er den visuelle
bekræftelse af det samme.

### Billedknappen

Knappens egne farver er `rgb(20,22,26)` på `rgba(255,255,255,.94)`, uændret
af motivet. Fordi baggrunden er delvis gennemsigtig, er kontrasten regnet
mod **begge** yderpunkter — et helt hvidt og et helt sort motiv — i
`scripts/cloud/lancering.mjs`: **15,9:1 normalt og 18,1:1 ved hover og
fokus**. Det holder for ethvert motiv derimellem, også et fotografi.

Billederne nedenfor viser knappen over et næsten hvidt og et næsten sort
motiv. Det er den visuelle side af det samme; det erstatter ikke et
rigtigt fotografi.

## Billederne

I [`geometri/`](geometri/) — mærket, så de ikke kan forveksles med
fotokontrollen:

| | 1440 px | 390 px |
|---|---|---|
| Boligkort i listen | [kort-desktop.png](geometri/kort-desktop.png) | [kort-mobil.png](geometri/kort-mobil.png) |
| Galleri, lyst motiv under knappen | [galleri-desktop.png](geometri/galleri-desktop.png) | [galleri-mobil.png](geometri/galleri-mobil.png) |
| Galleri, mørkt motiv under knappen | [galleri-desktop-moerkt-motiv.png](geometri/galleri-desktop-moerkt-motiv.png) | [galleri-mobil-moerkt-motiv.png](geometri/galleri-mobil-moerkt-motiv.png) |
| Lysbord | [lysbord-desktop.png](geometri/lysbord-desktop.png) | [lysbord-mobil.png](geometri/lysbord-mobil.png) |

Mærkatet er sat af **kontrollen**, ikke af appen — applikationskoden er
urørt under kørslen. Teksten er tilpasset sandheden: med fotografier
skriver scriptet *«Stockfotos til layouttest — ikke en virkelig
boligannonce.»*, og uden dem *«Genererede testmotiver til layouttest —
ikke fotografier, ikke en virkelig boligannonce.»* Et mærkat, der lovede
stockfotos, hvor der ingen var, ville selv være usandt.

## Det står stadig tilbage

- **Beskæring med et rigtigt motiv.** Geometrien er rigtig; om
  sommerhusets facade eller stuens sofa overlever et 4:3-udsnit på
  248 px er ikke set.
- **Galleriets 400 px med et fotografi.** Loftet holder, men om et
  liggende landskabsmotiv bærer den højde er en vurdering, ikke en måling.
- **Knappens læsbarhed over et fotografi med struktur.** Kontrasten
  holder analytisk mod begge yderpunkter; et motiv med detaljer lige under
  knappen er ikke set.
- **Farver og hudtoner.** Intet i kontrollen rører farvegengivelse.

Der er ikke rørt produktionsdata, ingen billeder er sat ind på rigtige
annoncer, og produktions-billedproxyens værtstilladelser er uændrede.
