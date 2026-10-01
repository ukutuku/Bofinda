# Kildetilladelser

Hvem har givet os lov til hvad, hvornår, og af hvem.

**Grundlaget for samtlige kilder er en mundtlig tilladelse, givet pr.
telefon, optaget med samtykke.** Ikke robots.txt. Robots.txt er kun det,
vi tjekker ved siden af — et signal til fremmede, ikke en aftale.

Filen findes, fordi et `Disallow`, vi ignorerer, om et halvt år ligner en
fejl, og fordi den eneste måde at kende forskel på "vi har fået lov" og
"vi tog os den" er at have skrevet det ned, da det skete.

> **Optagelserne ligger IKKE i dette repo.** De indeholder
> personoplysninger om navngivne mennesker — stemme, navn, stilling — og
> skal ikke i git. Se `CLAUDE.md`.

---

## Sådan udfyldes omfangs-kolonnen

Den sidste kolonne er den vigtige, og den er ikke en formalitet.
Balder-sagen viste hvorfor. Vi havde noteret *"vi må bruge deres API"*,
og det så præcist nok ud. Det var det ikke:

- Dataene lå ikke på `www.balder.dk`, men på **`api.balder.dk`** — en
  anden vært med sin egen robots.txt, der siger `Disallow: /` til alle.
- Adgangen krævede en **nøgle**, som ikke var udleveret, men lå i deres
  eget frontend-bundt.

Forskellen på de to formuleringer afgjorde, om adapteren skulle skrabe
HTML eller hente JSON. Skriv derfor altid fire ting:

1. **Hvilke værter** må vi hente fra? (Ikke "deres site" — det fulde værtsnavn.)
2. **Hvilke endpoints**? (Sti eller API-navn.)
3. **Hvilken nøgle**, og hvor kommer den fra? (Udleveret? Hvorfra?)
4. **Billeder**: må vi hotlinke, og fra hvilken vært? (Ofte et CDN, ikke deres eget domæne.)

Står der `[UDFYLDES]`, mangler oplysningen, og linjen kan ikke bæres.

---

## Kilderne

| Kilde | Navn | Rolle | Dato | Form | Hvad der konkret er givet lov til |
|---|---|---|---|---|---|
| **findbolig.nu** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` |
| **Propstep** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` |
| **Dacas** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` |
| **LokalBolig** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — bemærk at deres `Content-Signal` beder om mindre end tilladelsen; spørg om billedbredder |
| **Balder** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | **Udfyldt, se nedenfor.** Værter: `api.balder.dk` (data) og `www.balder.dk` (sider). Endpoint: `POST /indexes/leases/search` (Meilisearch, indeks `leases`). Nøgle: søgenøglen fra Balders eget frontend-bundt, **efter Balders egen anvisning**. Billeder: `images.ctfassets.net` (Contentful) |
| **CityApartment** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` |
| **HomeConnector** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — billederne ligger på `app.propstep.com`, så spørg om DEN vært |
| **Jeudan** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — data ligger på `nova-api.jeudan.dk`, ikke på `www.jeudan.dk` |
| **C.W. Obel** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — **samme API som Jeudan** (`nova-api.jeudan.dk`); afklar om det er to tilladelser eller én |
| **Kereby** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — data via `kereby.dk/wp-json/wp/v2/jorato-cases` |
| **CEJ** | `[UDFYLDES]` | `[UDFYLDES]` | `[UDFYLDES]` | telefon, optaget med samtykke | `[UDFYLDES — værter: ? · endpoints: ? · nøgle: ? · billeder fra hvilken vært: ?]` — white-label fra `bolig.io`; afklar hvem der ejer dataene |
| **Laros A/S** | `[UDFYLDES]` | `[UDFYLDES]` | 2026-09-07 | telefon, optaget med samtykke | **Udfyldt, se nedenfor.** Bred tilladelse til at hente, behandle og vise deres offentlige boligannoncer og billeder på Bofinda — liste- og detaljesider, alle relevante offentlige boligfelter, brug og visning af billeder, relevante nuværende værter/endpoints, link tilbage til Laros og deres ansøgningsflow, løbende opdatering. Ingen begrænsninger eller forbehold stillet. |
| **Alabu Bolig** | `[UDFYLDES]` | `[UDFYLDES]` | 2026-09-07 | telefon, optaget med samtykke | **Udfyldt, se nedenfor.** Fuld tilladelse til at hente, behandle og vise alle deres offentlige boligannoncer på Bofinda — liste- og detaljedata, alle relevante offentlige boligfelter, brug og visning af billeder, løbende crawling og opdatering, relevante nuværende værter/endpoints, link tilbage til Alabu Bolig og deres ansøgningsflow. Ingen begrænsninger eller forbehold stillet. |

---

## Balder — den udfyldte, som forbillede

| | |
|---|---|
| **Hvad er givet** | Adgang til deres søge-API frem for at skrabe HTML |
| **Værter** | `api.balder.dk` (data), `www.balder.dk` (bolig-sider) |
| **Endpoint** | `POST https://api.balder.dk/indexes/leases/search` — Meilisearch, indeks `leases` |
| **Nøgle** | Søgenøglen fra Balders eget offentlige frontend-bundt på `www.balder.dk`. **Balder har selv anvist, at det er den, vi skal bruge.** Den er ikke gravet ud på egen hånd. Ligger i `BALDER_API_KEY`, aldrig hardkodet |
| **Billeder** | `images.ctfassets.net` (Contentful) — ikke balder.dk |
| **Oplyst af** | `[UDFYLDES — navn]`, `[UDFYLDES — rolle]` |
| **Dato** | `[UDFYLDES]` |
| **Form** | Telefon, optaget med samtykke |

**robots.txt siger nej begge steder.** `www.balder.dk` har `Disallow: /api/`;
`api.balder.dk` har `Disallow: /` til alle. Vi henter alligevel, fordi
rettighedshaveren selv har givet lov. Det er en bevidst undtagelse, ikke
en forglemmelse — se `CLAUDE.md`.

---

## Laros A/S — bred tilladelse, tekniske facts holdt adskilt

Tilladelsen blev givet telefonisk 7. september 2026 og optaget med samtykke.
Den er **ikke** begrænset til bestemte endpoints, felter eller billedværter:
Laros har givet lov til alt, vi har brug for i forbindelse med at hente,
behandle og vise deres offentlige boligannoncer på Bofinda. Der blev ikke
stillet særlige begrænsninger eller forbehold.

| | |
|---|---|
| **Hvad er givet** | Crawling/hentning af offentlige boligannoncer (liste- og detaljesider) · alle relevante offentlige boligfelter · brug og visning af billeder · relevante nuværende værter og endpoints · link tilbage til Laros og deres ansøgningsflow · løbende opdatering af data |
| **Begrænsninger** | Ingen stillet |
| **Oplyst af** | `[UDFYLDES — navn]`, `[UDFYLDES — rolle]` |
| **Dato** | 2026-09-07 |
| **Form** | Telefon, optaget med samtykke |

**Tekniske facts — fra research og robots.txt, ikke fra samtalen.** Det
her er, hvad vi *bruger* under den brede tilladelse; det er ikke ord,
Laros-medarbejderen nødvendigvis sagde:

| | |
|---|---|
| **Værter** | `www.laros.dk` (liste og detaljesider). Boligbilleder ligger på `hos.laros.dk` under `/lejere/billeder/…`; billederne på `www.laros.dk` er temaets bannere og partner-badges, ikke boliger — derfor allowlistes kun `hos.laros.dk` til hotlinking. |
| **Endpoints** | `/ledige-lejemal/?pg=N` (9 kort pr. side) og `/ledige-detaljer/<slug>/<id>/` |
| **Nøgle** | Ingen — alt er offentlig HTML |
| **Takt** | `robots.txt` siger `Crawl-delay: 20`. Vi kalder aldrig hurtigere end ét kald pr. 20 sekunder (`VAERTSTAKT` i `lib/fetch.ts`), og detaljesider hentes kun for nye, ændrede og forældede boliger (detaljevagten). |
| **Ansøgning** | Knappen «Ansøg via Boligportal» sender ansøgningen gennem BoligPortal. Vi linker til Laros' egen boligside; BoligPortal-linket hentes ikke. |
| **Persondata** | Ingen set i payloaden. Adapteren plukker kun boligfelter. |

## Alabu Bolig — fuld tilladelse, tekniske facts holdt adskilt

Tilladelsen blev givet telefonisk 7. september 2026 og optaget med samtykke.
Den er **ikke** begrænset til bestemte endpoints, felter eller billedværter:
Alabu Bolig har givet lov til alt, vi har brug for i forbindelse med at
hente, behandle og vise deres offentlige boligannoncer på Bofinda. Der blev
ikke stillet særlige begrænsninger eller forbehold.

| | |
|---|---|
| **Hvad er givet** | Crawling/hentning af alle offentlige boligannoncer · liste- og detaljedata · alle relevante offentlige boligfelter · brug og visning af billeder · løbende crawling og opdatering · relevante nuværende værter og endpoints · link tilbage til Alabu Bolig og deres ansøgningsflow |
| **Begrænsninger** | Ingen stillet |
| **Oplyst af** | `[UDFYLDES — navn]`, `[UDFYLDES — rolle]` |
| **Dato** | 2026-09-07 |
| **Form** | Telefon, optaget med samtykke |

**Tekniske facts — fra research og robots.txt, ikke fra samtalen.** Det
her er, hvad vi *bruger* under den fulde tilladelse; det er ikke ord,
Alabu-medarbejderen nødvendigvis sagde:

| | |
|---|---|
| **Værter** | `alabubolig.dk` — data, sider og billeder på én vært, ingen CDN. Boligbilleder ligger under `/Media/TempDepartmentImages/<selskab>_<afdeling>_<lejemål>/…`, plantegninger under `/media/…`. Afdelingsbilleder (`/Media/TempDepartmentImages/<selskab>_<afdeling>/…`) viser afdelingen, ikke lejemålet, og hentes ikke. |
| **Endpoints** | Liste: `GET /umbraco/api/AvailableTenanciesPage/GetAllAvailableTenancies` — ét kald, hele udbuddet som JSON; det er det kald, listesiden selv laver. Detalje: `GET /umbraco/api/AvailableTenanciesPage/GetInfoForTenancy?companyId=&departmentId=&tenancyId=` (aconto varme/vand, boligart, faciliteter, plantegning; ~600 bytes). Boligens side for mennesker: `/se-og-soeg-bolig/soeg-ledig-lejebolig/?ten=<selskab>_<afdeling>_<lejemål>` — den linker vi til. |
| **Nøgle** | Ingen — alt er offentligt og kræver ikke login (sidens eget svar: `RequiresAuthentication: false`). Værten svarer 406 på en snæver `Accept`-header; vi sender den, browseren sender. |
| **Takt** | `robots.txt` har kun en `Sitemap:`-linje — ingen `Disallow`, ingen `Crawl-delay`. Standardtakten (højst ét kald pr. sekund pr. vært) gælder. Detaljekald kun for nye, ændrede og forældede boliger (detaljevagten), under `ALABU_DETALJEBUDGET`. |
| **Ansøgning** | Knappen «Jeg vil gerne kontaktes» ved hver bolig åbner en kontaktformular (navn, telefon, e-mail, besked), som sendes til Alabu. Vi linker til boligens egen side; formularen hentes ikke og udfyldes ikke. Om en ansøger skal være opskrevet på deres venteliste, siger siderne ikke — se `lib/kildekontrakt.ts`. |
| **Persondata** | Ingen i liste- eller detaljepayloadet ud over Alabus egne kontaktoplysninger i fritekstfeltet `Description`, som ikke gemmes. Adapteren plukker kun boligfelter ved navn; billedernes `Name`/`Description`/`Photographer` læses ikke. |

## BoligPortal — ikke en kilde

Deres robots.txt forbyder crawling udtrykkeligt på skrift, og der er
ingen tilladelse. Kræver skriftlig aftale først.

## Én identitet pr. forpligtelse

**Deler to forhold samme identifikator, forplanter en sanktion i det ene
sig til det andet.** Reglen er almen og gælder alt, en modpart kan
blokere, spærre, afvise eller miskreditere: User-Agents, API-nøgler,
afsenderdomæner, IP-omdømme og kontoidentiteter.

Eksemplet, der gjorde den konkret: `BofindaBot/1.0` er **boligcrawlens**
identitet. Skulle nogen en dag proxye kortfliser gennem vores egen server,
ville det være nærliggende at genbruge den — den er jo vores, og den
identificerer sig pænt. Men spærrede OpenStreetMap så `BofindaBot` for at
have hentet fliser for hurtigt, ville spærringen ramme **boligcrawlen**,
som aldrig havde hentet en flise. To forpligtelser over for to forskellige
modparter, ét navn, og ingen måde at skille dem ad bagefter.

Det samme gælder den anden vej: en kilde, der blokerer os for crawl, ville
samtidig lukke kortet.

Konkret, for hver slags:

| Identifikator | Én pr. | Hvorfor |
|---|---|---|
| User-Agent | forpligtelse, ikke pr. app | En værts spærring rammer navnet, ikke formålet |
| API-nøgle | modpart og miljø | En roteret eller spærret nøgle må ikke tage andet med sig |
| Afsenderdomæne | postslags | Et alarmdomæne på en spamliste må ikke tage kontomails med |
| IP / udgående vært | takt-regime | Heimstadens CDN spærrede **IP'en**, ikke UA'en (målt 2026-09-06) |

Den sidste række er ikke en formodning: Heimstaden mødte alle kald fra
vores IP med 503 efter ~17 minutter, **uanset User-Agent** — se
`VAERTSTAKT` i `lib/fetch.ts`. Det er netop derfor identiteten skal være
delt op, før den bliver det for os.

**Undtagelsen, der ikke er en undtagelse:** `lib/fetch.ts` lader
`User-Agent` stå SIDST i header-objektet, så et enkelt kald ikke kan
overskrive den. Det ser ud som stædighed og er det modsatte — det er dét,
der holder én identitet knyttet til én forpligtelse. Se EDC-læren i
`docs/supply-kortlaegning-2026-09-06.md` (revision 2026-09-07, afsnittet
«Metodisk caveat»): en probe fik adgang med en **forkortet** UA uden
bot-URL og kontakt, efter at den selvidentificerende var blokeret. Det er
udtrykkeligt noteret som noget, der **ikke** må bruges som
implementationsteknik.

## Billedaktiver i repoet

Ikke en kilde til boligdata, men materiale, vi selv viser. Samme krav:
hvem har lavet det, hvad giver licensen lov til, og hvor står det.

### `public/hero-stue.jpg` — forsidens stemningsfoto

| | |
|---|---|
| Motiv | Skandinavisk indrettet opholdsrum |
| Fotograf | Taryn Elliott |
| Kilde | https://www.pexels.com/photo/scandinavian-interior-of-a-living-room-9565782/ |
| Licens | https://www.pexels.com/license/ |
| Fil | 2048 × 1365 px · 636.485 bytes · JPEG, sRGB |
| SHA256 | `a2b2795193c96f2508593dc1dca77f62ea986a10dd2600cef331e64e245d5b5f` |

Pexels-licensen tillader kommerciel brug uden kreditering. **Vi krediterer
alligevel** — «Stemningsfoto: Taryn Elliott / Pexels» står på hero'en
selv, af samme grund som kortflisernes kreditering står på kortet: den,
der har lavet motivet, skal kunne ses af den, der ser det.

Ordet **«stemningsfoto»** er ikke pynt. Billedet er ikke en bolig, vi har
til leje, og en forside, der viser en stue uden at sige hvad den er,
lader læseren tro, at det er en annonce. Teksten siger, hvad billedet er.

Bytes er **uændrede fra kilden** — ingen omkodning, ingen skalering,
ingen retouchering. Beskæringen sker i CSS (`object-fit: cover` +
`object-position`), så filen i repoet altid kan holdes op mod kildens.

Licensen forbyder at identificerbare personer fremstilles i et
nedsættende lys, og at billedet sælges videre som et selvstændigt
produkt. Ingen af delene er på tale: der er ingen personer i motivet, og
det bruges som baggrund på vores egen forside.

---

## OpenStreetMap — kortfliser

Ikke en boligkilde og ikke en mundtlig tilladelse. Den står her alligevel,
fordi det er samme spørgsmål: **hvem har givet os lov til hvad, og hvad gør
vi den dag, de trækker det tilbage.**

| | |
|---|---|
| **Hvad vi bruger** | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| **Grundlag** | [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) — en offentlig politik, ikke en aftale med os |
| **Hvem henter** | **Brugerens browser, direkte.** Fliserne går ikke gennem vores server, så OSM ser den besøgendes IP-adresse |
| **Hvad de modtager** | IP-adressen, flisens `{z}/{x}/{y}` og `Referer: https://bofinda.dk/` — origin, målt; hverken sti eller query |
| **Hvor vi bruger det** | `app/Landkort.tsx`, gengivet fra `app/bolig/[id]/page.tsx` og `app/page.tsx` (kun når der er filtreret). Begge er betingede: boligsiden kræver koordinater (`page.tsx:671`), søgesiden kræver mindst ét mærke (`kortMuligt`) |

### Hvad flise-koordinaterne røber

`{z}/{x}/{y}` ER udsnittet. Målt for en bolig på Vesterbrogade 1:

| Zoom | Hvornår | Flisens bredde |
|---|---|---|
| 6 | forsiden uden filtrering | 353 km — siger ingenting |
| 15 | én bolig, `fitBounds`' `maxZoom` | **690 m**, med markøren midt i |
| 18 | brugeren har zoomet helt ind | **86 m** |

OSM får altså IP'en sammen med omtrent hvor boligen ligger. Over et besøg
er rækken af flise-requests hendes boligsøgning.

**`/privatliv` nævner dem ikke i dag — det lukkes af [#29].** På `main`
navngiver siden fire databehandlere (Supabase, Vercel, Railway, Resend)
og ingen af dem er OSM. Det er ikke en usand sætning, for OSM er ikke
vores databehandler: browseren kontakter dem direkte, og vi er aldrig i
vejen. Men hun kan ikke se det nogen steder, og oplysningen er, hvor hun
kigger på bolig.

[#29] (`claude/privatliv-tekst-ned-til-virkeligheden`, commit `b8dcfcb`)
tilføjer præcis det: en «direkte»-blok adskilt fra databehandlerne, med
**OpenStreetMap-fonden (Storbritannien)**, flise-URL'ens koordinater
`{z}/{x}/{y}` og hjemlen — artikel 6, stk. 1, litra f.
**Dette er altså ikke et åbent punkt, men en afhængighed.** Lander [#29],
er det dækket; lander den ikke, skal sætningen skrives ind i den gren,
der overtager filen. Skriv den ikke som en syvende samtidig gren.

[#29]: https://github.com/ukutuku/Bofinda/pull/29

### De fem krav, og hvor vi står på hver

Politikken er ikke en liste med pæne hensigter — den er betingelserne for,
at vi må hente af en donationsdrevet tjeneste. Hvert krav er målt, og
målingen står ved siden af, så den kan efterprøves i stedet for at blive
troet.

**Forbehold om kilden.** Denne session kunne ikke hente politikken selv —
udgående trafik til `operations.osmfoundation.org` er spærret i miljøet.
Citaterne nedenfor er ordrette, som de blev givet af ejeren, og
formuleringen af krav 4 (de syv dage) kommer samme vej. **Læs politikken
igen**, næste gang nogen rører kortet; den kan være ændret, og vi måler
mod vores notat, ikke mod kilden.

| # | Kravet | Vores status | Hvor det er målt |
|---|---|---|---|
| 1 | **Gyldig Referer. Ingen restriktiv Referrer-Policy.** «Web traffic requires a valid Referer header»; brugere «must not» sætte «a restrictive Referrer-Policy» | **Opfyldt.** Vi sætter ingen på fliserne. Browserens standard sender `Referer: https://bofinda.dk/` — origin, hverken sti eller query | Målt i Chromium, krydsoprindelse, `/bolig/<id>?filtre=2200`. `next.config.ts` har ingen `headers()`; `Landkort.tsx` sætter ingen `referrerPolicy` |
| 2 | **Ingen forhentning, ingen bulk, ingen offline-kopi, ingen bot** | **Opfyldt, og bygget fast.** Leaflets flisekø er viewporten uden margen. Ingen service worker. De hovedløse kørsler bruger lokale fliser | Se de tre afsnit nedenfor |
| 3 | **Synlig kreditering** | **Opfyldt.** Leaflets egen `attributionControl`, aldrig skjult, med «Meld en fejl i kortet» | `Landkort.tsx:106-107`. `beliggenhedkontrol.mjs` fejler, hvis krediteringen er tom |
| 4 | **Fliserne skal caches lokalt (mindst syv dage), og vi må ikke sende `no-cache`** | **Opfyldt ved ikke at blande os.** Fliserne hentes af browseren direkte fra OSM, så deres egen `Cache-Control` gælder. Vi rører den ingen steder | Eneste `cache-control`, vi sætter, er på `/api/billede` — vores egen billedproxy, som aldrig ser en flise |
| 5 | **Identificerbar User-Agent — ingen generisk eller proxy-UA** | **Opfyldt, fordi vi ikke proxyer.** Browserens egen UA når OSM. `BofindaBot` rører aldrig fliser | `lib/fetch.ts:11` er crawlerens UA og bruges ikke af kortet. `tile.openstreetmap.org` står IKKE i `TILLADTE_VAERTER` i `lib/billede.ts`, så `/api/billede` kan ikke bruges til fliser |

#### Krav 2a — hentes der fliser uden for udsnittet?

**Nej, og det er ikke en indstilling, vi har sat — det er Leaflets
konstruktion.** Målt i `node_modules/leaflet/dist/leaflet-src.js` (1.9.4):

- Køen af fliser, der hentes, løber fra `tileRange.min` til
  `tileRange.max`, hvor `tileRange = _pxBoundsToTileRange(_getTiledPixelBounds(center))`
  og `_getTiledPixelBounds` er `pixelCenter ± getSize()/2` — **viewporten,
  uden margen** (linje 11736-11800).
- `keepBuffer: 2` ser ud som en forhentning og er det ikke. Den bruges kun
  til `noPruneRange`, der afgør, hvilke ALLEREDE hentede fliser der må
  ryddes væk. Den indgår aldrig i køen (linje 11759).

Mærkerne kan derfor ikke trække fliser ind uden for udsnittet: `fitBounds`
sætter udsnittet, så det rummer mærkerne — efter det ER mærkerne udsnittet.
Og uden filtrering vises kortet slet ikke (`kortMuligt` i `app/page.tsx:363`).

**OPFØLGER: målingen hører ved indstillingen, ikke kun her.** Den næste,
der vil «optimere» kortet, læser navnet `keepBuffer` — ikke
`leaflet-src.js:11759`. Og vi bruger i dag Leaflets standard uden at
skrive den, så der er ingenting at læse ved siden af. Linjen hører i
`app/Landkort.tsx` ved `L.tileLayer(...)` (**linje 107** på `main` i dag):

```ts
// keepBuffer er IKKE en forhentning og maa ikke haeves «for at
// optimere». Flisekoeen i _update() er viewporten uden margen
// (leaflet-src.js 1.9.4:11755-11756); keepBuffer indgaar kun i
// noPruneRange og afgoer, hvilke ALLEREDE hentede fliser der maa
// ryddes (11759). Haeves den, beholdes flere fliser — men OSM's
// politik handler om, hvad vi HENTER, og det tal aendrer sig ikke.
// Saet den kun med en maaling ved siden af.
```

Den ligger **ikke** i denne ændring: fire grene rører `Landkort.tsx`, og
deres første hunk begynder på linje 22. Den hører i den gren, der
alligevel rører filen — sammen med citatet til headerens linje 14.

#### Krav 2b — henter noget af vores værktøj fliser som bot?

**Nej, og spærringen er et byg, ikke en aftale.** Repoet har 17 scripts,
der kører hovedløs Chromium, og flere af dem åbner sider med kort
(`/bolig/<id>`, `/?sted=…&kort=1`) og venter på `networkidle`. Uden en
spærring ville hver kørsel være præcis den botkørsel, politikken forbyder.

`scripts/cloud/byg.sh:23-24` bygger derfor testmiljøet med

    NEXT_PUBLIC_FLISE_URL="http://127.0.0.1:$BOFINDA_AKTIVPORT/flise/{z}/{x}/{y}.png"
    NEXT_PUBLIC_FLISE_KREDIT="Testfliser — lokalt genereret, ikke OpenStreetMap"

og — det afgørende — **fejler bygget**, hvis `tile.openstreetmap.org`
alligevel står i `.next/static` (`byg.sh:28-31`).

**Spærringen ER set fyre.** En spærring, ingen har set fyre, er en
antagelse — så den har fået sin modprøve. To arme, samme byg, forskel
kun i variablen:

| Arm | `NEXT_PUBLIC_FLISE_URL` | Byg | Vagten |
|---|---|---|---|
| muteret | **fjernet** | lykkes | **FYRER** — 1 fil i `.next/static` | 
| kontrol | som `byg.sh` sætter den | lykkes | tav |

Filen er `.next/static/chunks/444-<hash>.js` — klientbundtet med
`Landkort.tsx`. Bemærk, at **bygget selv lykkes i begge arme**: uden
vagten ville en droppet variabel ikke ytre sig nogen steder, og
kontrollerne ville stille begynde at hente rigtige fliser. Det er
præcis den slags fejl, der ikke har nogen rød linje at pege på.

Samme bundt bar også `fixthemap` — altså faldt både URL og kreditering
tilbage til OSM's, som `??` i `Landkort.tsx:41-45` foreskriver. De to
falder sammen, og det er meningen. Fliserne genereres i
hukommelsen af `scripts/cloud/aktiver.mjs`; der ligger ingen flisefiler i
repoet. To kontroller blokerer desuden al ikke-loopback-trafik ved roden
(`browserkontrol.mjs:71-75`, `browserkontrol-pagination.mjs:127`).

Den rækkefølge er værd at forstå: `NEXT_PUBLIC_*` bages ind ved **bygget**,
ikke ved start. At sætte variablen på processen, der starter appen, er for
sent — `Landkort.tsx` er en klientkomponent, og værdien er allerede låst.
Derfor findes `byg.sh` overhovedet.

#### Krav 2c — offline-kopi, prefetch, arkiv?

Målt: ingen service worker, ingen `caches.open`, intet `next-pwa`, intet
workbox, ingen flisefiler i `public/` (kun `hero-stue.jpg`), og
`next.config.ts` har ingen `headers()`. Der er ingen kode, der gemmer en
flise nogen steder.

#### Krav 5 — betingelsen for den dag, nogen proxyer fliserne

I dag henter browseren direkte, og OSM ser browserens egen User-Agent.
Lægger nogen en dag fliserne bag vores egen server — det er den eneste
måde at bruge en nøglebaseret udbyder uden at lægge nøglen i browseren —
så **skifter kravet fra at være opfyldt af sig selv til at være vores
ansvar.** Betingelsen, skrevet ned nu, mens der ikke er travlt:

- UA'en skal navngive Bofinda og bære en kontaktvej. En generisk
  `node-fetch`, `axios` eller `Mozilla/5.0` er netop det, politikken
  afviser, fordi den gør det umuligt at kontakte den, der belaster.
- Den må **ikke** være `BofindaBot` fra `lib/fetch.ts` — se reglen om én
  identitet pr. forpligtelse nedenfor.
- Proxyen skal sende en Referer videre (krav 1 gælder stadig), respektere
  flisernes `Cache-Control` i stedet for at hente på ny (krav 4), og
  aldrig hente en flise, ingen bruger har bedt om (krav 2).
- Og `tile.openstreetmap.org` skal da tilføjes `TILLADTE_VAERTER` i
  `lib/billede.ts` **i samme ændring** — ellers returnerer `billedUrl()`
  null, og kortet forsvinder uden en fejl nogen steder. Samme fælde som
  Balder og home.dk.

### Beredskabet: det er en miljøvariabel, ikke en ombygning

Politikkens afsnit 7, ordret:

> «Commercial services … should be especially aware that access may be
> withdrawn at any point.»
> — <https://operations.osmfoundation.org/policies/tiles/>

Bofinda ER en kommerciel tjeneste. «Uden varsel» betyder, at valget skal
være truffet FØR kortene forsvinder, ikke bagefter — derfor står
alternativerne nedenfor og ikke i hovedet på den, der er på vagt den dag.

Derfor er flise-URL'en ikke hardkodet. Forsvinder kortene:

```bash
NEXT_PUBLIC_FLISE_URL="https://<ny-udbyder>/{z}/{x}/{y}.png"
NEXT_PUBLIC_FLISE_KREDIT="<den nye udbyders krævede kreditering>"
```

Begge er `NEXT_PUBLIC_*` og bages ind ved **bygget**, ikke ved start — et
skift kræver derfor en ny deploy, men ingen kodeændring og ingen ny PR.

**Tre ting skal følge med skiftet**, ellers bytter vi ét problem for et
andet:

1. **Krediteringen** skal være den nye udbyders egen ordlyd. Den er
   synlig på kortet og må aldrig skjules — det er et krav hos OSM og hos
   stort set enhver anden flisetjeneste.
   Sættes variablen, **erstatter den hele strengen**, også OSM-linket
   «Meld en fejl i kortet». Det er med vilje, og det virker, fordi `??`
   binder løsere end `+` i `Landkort.tsx:43-45`: reservestrengen er
   sammenkædningen, ikke kun første led. Efterprøvet — med variablen sat
   er der nul forekomster af `fixthemap`. Havde det været omvendt, ville
   et fremmed kort bære OSM's fejlmeldingslink.
2. **`/privatliv`** skal navngive den nye udbyder som den tredjepart,
   browseren kontakter direkte — og den dag er sætningen der nok ikke
   endnu: siden nævner i dag ingen flisetjeneste (se det åbne punkt
   ovenfor). Skiftes udbyder, før den sætning er skrevet, skal den
   skrives med det samme og med det NYE navn. Står den allerede, er
   det et navn, der bliver usandt samme sekund.
3. **Den nye udbyders politik** skal læses efter for de krav, vi allerede
   opfylder — gå tabellen «De fem krav» igennem punkt for punkt mod
   hendes politik. Tallet står ét sted, i tabellen, så det ikke kan
   drive fra den: her stod engang «de samme fire krav», mens tabellen
   havde fem.

Vælges en udbyder med API-nøgle, hører nøglen i miljøet og **aldrig** i
`Landkort.tsx` — samme regel som `BALDER_API_KEY`. Bemærk dog, at en
`NEXT_PUBLIC_`-variabel når browseren og derfor ikke er en hemmelighed;
en nøglebaseret udbyder kræver enten en domænebegrænset nøgle eller en
proxy gennem vores egen server.

#### Hvad et skift koster — navngivne alternativer

**Om prisen.** Beløbene herunder er IKKE efterprøvet i denne session:
udgående trafik var spærret, og en pris, der er gættet, er værre end
ingen pris. Hvert punkt navngiver derfor den side, der skal slås op, og
beskriver i stedet den del af omkostningen, der **ikke** svinger —
nøglen, krediteringen og hvem der ser brugerens IP. Det er som regel dét,
der afgør valget.

**1 · MapTiler** — `api.maptiler.com/maps/<stil>/{z}/{x}/{y}.png?key=…`
OSM-baseret, rasterfliser i samme form som nu, så `NEXT_PUBLIC_FLISE_URL`
kan pege direkte på den.
· *Penge:* gratis niveau med et månedligt loft, derover abonnement.
  Slå op på `maptiler.com/cloud/pricing`.
· *Nøgle:* ja, i URL'en — og `NEXT_PUBLIC_*` når browseren, så den ER
  offentlig. Brugbar kun med en oprindelsesbegrænset nøgle.
· *Kreditering:* deres egen ordlyd, oven i OSM-bidragydernes.
· *IP:* stadig en tredjepart, der ser den besøgendes IP. `/privatliv`
  skal have nyt navn, ikke færre navne.

**2 · Thunderforest** — `tile.thunderforest.com/<stil>/{z}/{x}/{y}.png?apikey=…`
Også OSM-baseret raster, også et rent URL-skift.
· *Penge:* gratis niveau med månedligt flise-loft, derover abonnement i
  GBP. Slå op på `thunderforest.com/pricing`.
· *Nøgle:* ja, i URL'en. Samme offentlighedsproblem som ovenfor.
· *Kreditering:* deres egen, oven i OSM's.
· *IP:* tredjepart, som nu.

**3 · Vores egne fliser** — PMTiles af et Danmarks-udtræk, bygget med
planetiler/OpenMapTiles og lagt på vores eget lager.
· *Penge:* ingen licens. Lager og båndbredde, plus et byg der skal
  gentages, når kortet skal være friskt. Et Danmarks-udtræk er lille nok
  til at ligge i en almindelig bucket; en planet er det ikke.
· *Nøgle:* ingen.
· *Kreditering:* OSM-bidragydernes, stadig — dataene er deres.
· *IP:* **ingen tredjepart ser brugerens IP.** Det er den eneste af de
  tre, der fjerner den linje fra `/privatliv` i stedet for at skrive et
  nyt navn i den. Omvendt flytter den driften til os: forsvinder vores
  bucket, forsvinder kortet, og der er ingen at ringe til.

Stadia Maps hører med på listen over dem, der skal slås op
(`stadiamaps.com/pricing`); de tilbyder domænebegrænset adgang uden nøgle
i URL'en, hvilket er den ene ting, 1 og 2 ikke kan.

**Det hurtige valg den dag kortene er væk:** 1 eller 2, fordi de er ét
miljøvariabel-skift plus en deploy. **Det rigtige valg på sigt** er 3,
hvis kortet skal blive ved med at være vores — men den skal bygges, før
den skal bruges, og det er grunden til at skrive det ned nu.
