# Anden runde: tallene, mobiltoppen, kolonnerne og sproget

Bygger på `2883578437b8f83f4c873bffd1f2997b7c9ebd8b`. Udgangspunktet er en
visuel gennemgang af alle 45 skærmbilleder fra den commit, holdt op mod
BoligPortal-referencerne. Fem fund, fem rettelser.

## 1. Boligtypernes tal beskrev en anden søgning

**Fundet.** På en søgning i Prøveby N med 76 boliger stod typeknapperne på
75 · 58 · 54 · 53 · 34 · 6 — tilsammen **280**, altså hele bestanden — ved
siden af et resultatantal på 76 og facilitetslinjer, der summerede til 76.
Tre tal om tre forskellige sæt på den samme skærm.

**Årsagen.** `fac.typer` kom fra `facetterCached()`, som tæller hele
bestanden og caches i fem minutter. Knapperne lignede facetter og var det
ikke.

**Rettelsen.** Tallene kommer nu fra `opsummering()`, som i forvejen
scanner præcis det sæt, listen viser. Ét aggregat pr. boligtype oven på den
scanning, der alligevel sker — samme argument som facetternes fire tal i én
forespørgsel, og det koster ingen ekstra forespørgsel.

Grundlaget er søgningen **uden typefilteret selv** — `boligtypegrundlag` i
`lib/soeg.ts`, samme mønster som `facilitetsgrundlag` og
`oekonomigrundlag`. Uden den regel ville hver anden type stå på 0, så snart
én var valgt, og knapperne kunne kun bruges til at fravælge, aldrig til at
skifte type. Er der ikke sat et typefilter, er forespørgslen ordret den
samme som `sum`, og svaret genbruges.

Synligheden følger med: et valg, der ikke kan give træf **i denne søgning**,
vises ikke. En type, hun allerede har valgt, bliver dog stående, også hvis
de øvrige filtre har talt den til nul — ellers ville afkrydsningen forsvinde
under fingeren på hende.

**Målt** i to geografier og tre kombinationer:

| Søgning | Resultat | Typerne |
|---|---:|---|
| Prøveby N | 76 | Værelse 24 · Lejlighed 17 · Studiebolig 13 · Rækkehus 12 · Hus 8 · Anden 2 = **76** |
| Attrapby | 71 | Lejlighed 19 · Studiebolig 17 · Værelse 16 · Hus 10 · Rækkehus 8 · Anden 1 = **71** |
| Prøveby N + pris ≥ 9.000 | 68 | 20 · 17 · 11 · 10 · 8 · 2 = **68** |
| Attrapby + 2 vær. + 40 m² | 58 | 15 · 14 · 12 · 9 · 8 = **58** |
| Prøveby N + type=hus | 8 | uændret 76 — grundlaget er søgningen uden typefilteret |

Fem tilfælde er lagt ind som en blivende kontrol i `filterkontrol.mjs`.

## 2. Mobilbrugeren mødte betjeningen, ikke boligerne

**Fundet.** På 390 × 844 begyndte første bolig **563 px** nede, og prisen
på den første 852 px nede — altså under skærmkanten på en resultatside,
hvor hun allerede havde søgt.

**Rettelsen.** Intet er fjernet. Brødkrummen, titlen med antallet,
sorteringen, stedfeltet, søgehandlingen og datakvalitetslinjen står alle
stadig. Fire greb:

- **Søgelinjen gik fra tre rækker til to.** «Søg» havde sin egen række;
  nu deler den række med «Filtre» og kortvalget, `flex: 1 1 0` så ingen af
  dem brækker. Berøringsmålet er 48 px, ikke 46 — lanceringskontrollen
  kræver 48 på søgeknappen, og to pixels er ikke en handel værd.
- **Titlen og sorteringen deler række.** `flex-wrap: wrap` gav sorteringen
  en egen række — 44 px knap plus to mellemrum = 64 px tom bredde. `nowrap`
  koster titlen en tekstlinje på 24 px. 64 mod 24.
- **Rytmen strammet**: brødkrumme, titel, panel og resultathoved.
- **Titlen 20 px under 430 px skærm**, så den kan være på to linjer ved
  siden af knappen i stedet for tre.

**Målt: første kort fra 563 px til 359 px.** Prisen på det første kort står
med bund i y=670 og prisforbeholdet «Udlejer oplyser ikke aconto» i y=727 —
begge inden for 844 px, altså synlige uden at rulle.

**Forsiden.** Talstriben var 202 px med 22 px accentfarvede tal i en
kortflade. Tallene og ordene er de samme, og begge tal i pengelinjen står
stadig. Kun vægten er ændret: tallet går foran teksten på samme linje,
16 px i stedet for 22, og kortfladen er blevet til tynde skillelinjer.
**202 px til 164 px.** Første kort på forsiden ligger stadig under folden —
hero'en fylder 430 px, og den er ikke rørt i denne omgang.

## 3. To kort på hele desktopbredden blev for store

**Fundet.** 1440 px uden landkort gav to kort à 640 px med 360 px høje
fotos. Billedet fyldte mere end oplysningerne.

**Rettelsen.** Et tredje trin i `@container listeomraade`. Trinene er valgt,
så et kort aldrig bliver smallere end ~380 px:

| Listens bredde | Kolonner |
|---|---|
| under 620 px | 1 |
| 620–1179 px | 2 |
| 1180 px og op | 3 |

**Målt på de fire bredder:**

| | uden landkort | med landkort |
|---|---|---|
| 390 px | 1 à 346 | listen skjult, kortet fylder bredden |
| 768 px | 2 à 352 | listen skjult |
| 1100 px | 2 à 518 | 2 à 330 |
| 1440 px | **3 à 420** | 2 à 355 |

0 vandret overløb i alle 20 visninger. 1100 px uden landkort bliver stående
på to: tre ville give 338 px dér, og det er under gulvet.

**Kontrollen er skrevet om.** Påstanden var «højst to kolonner» og ville nu
være forkert. Den måler i stedet egenskaben: er kolonnetallet det højeste,
gulvet tillader? Prøven skriver ikke breakpointsene af fra CSS'en — så
ville den samme regel stå to steder. Sættes breakpointet forkert, fejler
den.

## 4. Filtrene lød som en rapport

Alle tal og alle tre uafhængige grupper står stadig. Ordene er skiftet:

| Før | Nu |
|---|---|
| «34 oplyser det · 18 oplyser faciliteter uden det · 24 oplyser ingen og vises ikke» | «34 nævner det · 18 nævner andre faciliteter · 24 mangler oplysninger og vises ikke» |
| «0 venteliste · 0 almindelig ansøgning · 76 uoplyst ansøgningsform» | «0 har venteliste · 0 søges direkte · 76 mangler oplysninger» |
| «0 reserveret · 0 på markedet · 76 uden oplyst markedsstatus» | «0 er reserveret · 0 er på markedet · 76 mangler oplysninger» |
| «Specificeret aconto» | «Aconto delt op» |
| «Husleje og mindst én oplyst post for varme, vand eller el.» | «Kun boliger hvor udlejer skriver, hvad varmen, vandet eller strømmen koster — ikke bare ét samlet beløb.» |
| «59 oplyser varme, vand eller el hver for sig · 10 oplyser kun én samlet aconto · 7 oplyser ingen total» | «59 har delt aconto op · 10 oplyser kun ét samlet beløb · 7 oplyser kun huslejen» |
| «5 har oplyst overtagelse nu · … uden afklaret tidspunkt — de vises ikke med filteret slået til» | «5 kan overtages nu · … uden oplyst dato — de vises ikke, hvis du vælger et tidspunkt» |
| «69 med kendt total» | «69 med samlet pris til udlejer» |

**De 18 er ikke blevet til boliger uden elevator.** «nævner andre
faciliteter» siger, hvad vi ved: de har oplyst noget, og elevator var ikke
blandt det. Udeladelsen står stadig i samme linje.

Chippen over listen hedder nu også «aconto delt op» — den og pillen er ét
udsagn og må ikke kunne sige hver sit.

## 5. Rigtige fotos

To rettighedsafklarede motiver, begge i liggende og stående format. Kilder,
licenser, mål og sha256 står i [`docs/testfotos/README.md`](../testfotos/README.md).
Filerne ligger uden for repoet, i `/var/lib/bofinda-test/fotos/`, og
visningen bærer et mærkat: «Stockfotos til layouttest — ikke en virkelig
boligannonce.»

**De stående er beskæringer, ikke selvstændige optagelser.** Det er
forskellen på at prøve, hvordan rammen beskærer et stående motiv, og
hvordan et stående fotografi taget i et smalt rum ser ud. Det første er
prøvet; det andet er ikke. Egress-politikken afviser `unsplash.com`,
`images.pexels.com` og `upload.wikimedia.org` — prøvet én gang, ikke
gentaget og ikke omgået.

**De to dokumentationsfejl er rettet.** `uden-js.png` blev taget nederst i
blokken, altså efter at nulstillingsprøven havde navigeret videre, og viste
derfor en almindelig resultatliste i stedet for et åbent filtervindue.
Billedet tages nu, mens vinduet står åbent. Og fotokontrollen tager nu hvert
motiv som sit eget element, så det ikke kan ligge uden for udsnittet.

## Kontroller

Isoleret testmiljø på loopback, produktionsbyg fra rent `.next`, syntetiske
data.

| Kontrol | Resultat |
|---|---|
| `npx tsc --noEmit` | rent |
| `npm test` (PGlite) | ALT GRØNT |
| `scripts/cloud/kortkontrol.mjs` | **124** (118 før + 6 om kolonnetallet) |
| `scripts/cloud/filterkontrol.mjs` | **129** (119 før + 10 om typetallene) |
| `scripts/cloud/browserkontrol.mjs` | ALT GRØNT |
| `scripts/cloud/browserkontrol-pagination.mjs` | ALT GRØNT |
| `scripts/cloud/lancering.mjs` | alt grønt |
| `scripts/cloud/fotokontrol.mjs` | alt grønt, med rigtige motiver |

Sortering, filterbevarelse, nulstilling, fokus, Escape, kladder, brug uden
JavaScript og paginering er alle kørt igen, fordi ændringerne rører
filtervinduet og resultattoppen.

**En reduceret viewport er en simulering af pladsmangel, ikke bevis for
adfærd med et fysisk mobiltastatur.**

## Udeståender

1. **Kun to motiver.** Et smalt badeværelse, et mørkt soveværelse eller et
   køkken taget på langs er ikke prøvet, og de stående er beskæringer.
2. **Forsidens første bolig ligger stadig under folden** på 390 × 844.
   Hero'en fylder 430 px og er ikke rørt her.
3. **1100 px uden landkort bliver på to kolonner à 518 px.** Tre ville give
   338 px, under gulvet. Er 518 px stadig for bredt, er svaret en smallere
   ydre ramme, ikke et lavere gulv.
4. **Ingen produktionsdata.** Syntetiske prøveboliger hele vejen.
5. **Maksimum for værelser og areal findes ikke.** Basen har kun
   `vaerelserMin` og `arealMin`; et «Max.»-felt, der ikke filtrerer, ville
   love et interval, søgningen ikke kan holde. Det er et selvstændigt
   funktionsarbejde.
