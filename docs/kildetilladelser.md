# Kildetilladelser

Hvem har givet os lov til hvad, hvornår, og af hvem.

**Grundlaget for samtlige kilder er en mundtlig tilladelse, givet pr.
telefon, optaget med samtykke** — for EDC er det dog ikke oplyst, om
samtalen er optaget. Ikke robots.txt. Robots.txt er kun det, vi tjekker
ved siden af — et signal til fremmede, ikke en aftale.

**Ingen af tilladelserne kan i dag dokumenteres.** Alle 14 kilder i
tabellen nedenfor mangler i det mindste navnet på den, der gav lov. For de
13 står det som pladsholder — den 26. september 2026 var der 54 på 17
tabelrækker. For EDC står der «ikke oplyst», fordi navnet ikke huskes. At
tilladelserne er mundtlige, er stadig rigtigt. Men en mundtlig tilladelse
uden navn, rolle og dato kan ingen efterprøve. Tal pladsholderne efter med
`grep '^|' docs/kildetilladelser.md | grep -o UDFYLDES | wc -l`.

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
| **EDC** | ikke oplyst | formentlig administrativ medarbejder, usikkert | ikke oplyst | telefon — **ejerens gengivelse, ingen skriftlig dokumentation**; om samtalen er optaget, er ikke oplyst | **Se nedenfor.** Ret til at scrape, hvad vi vil, på deres hjemmeside, og til at køre bot på `www.edc.dk` (ejerens gengivelse). Kan kun dække EDC's egne sager — ikke boligportal.dk-annoncerne i deres lejeindeks. **Ubesvaret:** om § 11 b-forbeholdet er ophævet udtrykkeligt · om løbende import og visning er dækket. **Uafklaret:** om tilladelsen overhovedet binder EDC — se forbeholdet nedenfor |

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

## EDC — mundtlig, ejerens gengivelse, uden dokumentation, om den binder EDC er uafklaret

Det, der står her, er projektejerens gengivelse af en telefonsamtale med
EDC, skrevet ned efter hukommelsen den 26. september 2026. Der findes
ingen skriftlig dokumentation, og det er ikke oplyst, om samtalen er
optaget. Tilladelsen blev samme dag først omtalt som skriftlig og derefter
rettet til mundtlig; det er den rettede udgave, der står her. Navn og dato
huskes ikke, og rollen er usikker.

| | |
|---|---|
| **Hvad er givet** (ejerens gengivelse) | Ret til at scrape, hvad vi vil, på deres hjemmeside. Bot-spørgsmålet blev afklaret i samme samtale: vi må gerne køre bot på `www.edc.dk`. |
| **Hvad den ikke kan dække** | EDC's lejeindeks viser også annoncer fra boligportal.dk via feed — ved proben 7. september ca. 97 % af det samlede udbud, kendetegnet ved `source: "boligportal.dk"`, `isEdcCase: false` og en absolut boligportal-URL (`docs/supply-kortlaegning-2026-09-06.md`). Det er BoligPortals indhold. EDC kan ikke give lov til det, og BoligPortal kræver sin egen skriftlige aftale (`CLAUDE.md`). Tilladelsen gælder derfor kun EDC's egne sager. |
| **Ubesvaret: § 11 b** | EDC's vilkår havde ved proben 7. september et forbehold mod tekst- og datamining efter ophavsretslovens § 11 b og krævede skriftlig aftale for enhver brug. Om aftalen ophæver forbeholdet udtrykkeligt, er ikke besvaret — og heller ikke, hvordan en mundtlig aftale forholder sig til vilkårenes krav om skriftlighed. |
| **Ubesvaret: omfang** | Om tilladelsen dækker løbende import og visning på Bofinda, eller kun målingen. |
| **Forbehold — ejeren tager stilling** | Tilladelsen blev givet af en medarbejder, der formentlig var administrativ. En administrativ medarbejder har næppe stillingsfuldmagt til at fravige selskabets egne vilkår. **Om tilladelsen binder EDC, er derfor uafklaret** — ud over de to ubesvarede spørgsmål ovenfor. |
| **Begrænsninger** | Ingen nævnt i gengivelsen. |
| **Oplyst af** | Navn: ikke oplyst. Rolle: formentlig administrativ medarbejder, usikkert. |
| **Dato** | Ikke oplyst. Skrevet ned 2026-09-26. |
| **Form** | Telefon. Ejerens gengivelse efter hukommelsen. Ingen skriftlig dokumentation. Om samtalen er optaget: ikke oplyst. |

**Tekniske facts — målt, ikke fra samtalen.** Tilføjes, når bot-testen og
kvalitetsmålingen er kørt.

## BoligPortal — ikke en kilde

Deres robots.txt forbyder crawling udtrykkeligt på skrift, og der er
ingen tilladelse. Kræver skriftlig aftale først.

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
