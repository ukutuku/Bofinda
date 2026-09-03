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

## De elleve kilder

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

## BoligPortal — ikke en kilde

Deres robots.txt forbyder crawling udtrykkeligt på skrift, og der er
ingen tilladelse. Kræver skriftlig aftale først.
