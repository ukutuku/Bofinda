# Testfotos — rettigheder og herkomst

Fire filer i `/var/lib/bofinda-test/fotos/`. **Uden for repoet**, som alt
andet i testmiljøet: et kodelager er et dårligt sted at opbevare
fotografier, og reglen i `scripts/cloud/aktiver.mjs` om ingen binære filer
i git står ved magt.

**Det er stockfotos til en layouttest. Ingen af dem viser et lejemål på
Bofinda**, og ingen af dem må ende i en annonce.

## De to originaler

| | Stue | Sommerhus |
|---|---|---|
| Fil | `test-stue-liggende-3x2.jpg` | `dk-vesterhavet-sommerhus.jpg` |
| Motiv | Skandinavisk stue, lyst indendørs | Sommerhus ved Vesterhavet, mørk facade mod lys himmel |
| Fotograf | Taryn Elliott | Johannes Sejer |
| Kilde | [pexels.com/photo/9565782](https://www.pexels.com/photo/scandinavian-interior-of-a-living-room-9565782/) | [unsplash.com/photos/Xn3vcIpPi1E](https://unsplash.com/photos/a-house-on-top-of-a-grassy-hill-Xn3vcIpPi1E) |
| Licens | [Pexels-licensen](https://www.pexels.com/license/) — fri til kommerciel brug | [Unsplash-licensen](https://unsplash.com/license) |
| Mål | 2048 × 1365 (3:2) | 2048 × 1638 (5:4) |
| Bytes | 636.485 | 841.514 |
| SHA256 | `a2b2795193c96f2508593dc1dca77f62ea986a10dd2600cef331e64e245d5b5f` | `ae4cd85ad5980361422077f3bade43012185c6398354e922f9024b31325d00c7` |

Stuefotoet er **de samme bytes** som `public/hero-stue.jpg`, der allerede
ligger i repoet og bruges på forsiden — samme sha256. Sommerhusfotoet lå
allerede i testmappen; se `docs/frontend-lancering-v2/fotokontrol.md`.

## De to stående

**Begge er beskæringer, ikke selvstændige optagelser.** Det skal stå,
fordi det er forskellen på at prøve «hvordan beskærer rammen et stående
motiv» og «hvordan ser et stående fotografi taget i et smalt rum ud».
Det første er prøvet. Det andet er ikke.

| Fil | Mål | Bytes | SHA256 |
|---|---|---|---|
| `test-stue-staaende-2x3.jpg` | 910 × 1365 | 243.353 | `ebb22861feb9e7e4b4dd8ae02bda0a8a4f865b05288d0982e4034fe3eb5ace02` |
| `test-sommerhus-staaende-2x3.jpg` | 1092 × 1638 | 397.509 | `a9f6b052f1e3a9db312e1da89c57dd5af0af3196eee7fb3b13f7c6b2fe102bf1` |

Fremstillet af originalerne med `sharp`, `fit: 'cover'` og
`position: sharp.strategy.attention` — altså den udsnitsstrategi, der
vælger det mest indholdsrige område, ikke bare midten. Højden er
originalens, bredden er `højde × 2/3`. JPEG-kvalitet 88. Rettighederne
følger originalen: begge licenser tillader bearbejdning.

Kommandoen står i sessionens log og kan gentages:

```js
sharp(kilde).resize(Math.round(h * 2 / 3), h,
  { fit: 'cover', position: sharp.strategy.attention })
  .jpeg({ quality: 88 }).toFile(ud)
```

## Hvorfor ikke flere motiver

Egress-politikken afviser `unsplash.com`, `images.pexels.com` og
`upload.wikimedia.org` — efterprøvet én gang, ikke gentaget og ikke
omgået. Der kan altså ikke hentes nye motiver herfra. De to originaler er
dem, der allerede var rettighedsafklarede i projektet.

**Det, prøven derfor IKKE svarer på:** hvordan et smalt badeværelse, et
mørkt soveværelse eller et køkken taget på langs beskæres. Det kræver
flere motiver, og de skal komme udefra.
