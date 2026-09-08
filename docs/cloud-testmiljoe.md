# Cloud-testmiljøet

Et isoleret udviklingsmiljø til Claude Code på web: rigtig PostgreSQL på
loopback, projektets egne migrationer, syntetiske boliger og en
browserkontrol med den præinstallerede Chromium.

Det findes, fordi en cloud-session **ikke har en database**. Uden den
svarer hver side 500 med «DATABASE_URL mangler» — alle DB-ramte ruter er
`force-dynamic` — og så kan hverken en ændring ses i appen eller en
browserkontrol køres.

**Produktionen røres aldrig.** Der kopieres ingen `.env`, ingen nøgler og
ingen rækker. Hvert script afviser at køre mod andet end
`127.0.0.1:55432/bofinda_test`, og et manglende `DATABASE_URL` giver en
fejl — aldrig et fald tilbage til noget andet.

## Denne udgave prøver IKKE paginering

Miljøet er fælles for Frontend, Supply, Analytics og Git & Release, og
det ligger derfor på **main**. På main findes der ingen pager: `?side=N`
læses ikke af nogen rute, `soegGrupperet()` tager tre argumenter og
returnerer altid det første udsnit, og `.side-tal`, `.side-nu` og
`nav.sider` findes ikke i markuppen.

**`/?side=2` er altså ikke en main-funktion.** Den svarer 200 og viser
nøjagtig de samme 48 kort som forsiden, fordi parameteren kasseres. Det
er værd at kende, for det er en fælde: en browserkontrol, der henter
`/?side=2` og tæller kort, bliver **grøn uden at måle noget**. Netop
sådan en kontrol lå her og er fjernet igen.

Derfor:

- `browserkontrol.mjs` prøver tre **ægte forskellige** visninger —
  forsiden, `?postnr=9001` og `?areal=100` — ikke tre sidetal.
- Pageren **måles** stadig (`sidetal`, `aktuelSide` i `maal()`) og
  printes, men den er intet krav. Kontrollen bliver hverken grøn eller
  rød af, om den er der. Så kan den ses komme, uden at filen skal
  skrives om.
- `tjek.ts` skriver et sideantal, men det er `kortIAlt / 48` — et udsagn
  om **datasættets størrelse**, ikke om at siderne kan nås.

**De pagineringsspecifikke kontroller hører til pagineringsgrenen og
følger dens egne prøver.** Lander en pager i main, hører de hjemme i
samme ændring som den — ikke her, og aldrig som en kontrol, der kan
bestå uden en pager.

## Kom i gang

```bash
scripts/cloud/op.sh          # base + skema + syntetiske data + app
scripts/cloud/kontrol.sh     # browserkontrol med skærmbilleder
scripts/cloud/ned.sh         # stop det hele igen
```

`op.sh` er idempotent. Kør den igen efter en genstart af containeren —
den samler op, hvor den slap, og kører `npm ci`, hvis `node_modules`
mangler.

## De enkelte trin

| Kommando | Hvad den gør |
|---|---|
| `scripts/cloud/db-op.sh` | `initdb` + start på 127.0.0.1:55432. Opretter rolle og database. |
| `scripts/cloud/klargoer.mjs` | Supabase-stubbe + de 21 migrationer i journalens rækkefølge. |
| `scripts/cloud/saa.mjs` | Syntetiske boliger. Sletter og skriver kun sine egne. |
| `scripts/cloud/app-op.sh` | Starter `next dev` på 3100 — efter at have efterprøvet basen. |
| `scripts/cloud/maal.sh` | Måler datasættet gennem appens egen `soegGrupperet()`. |
| `scripts/cloud/kontrol.sh` | Browserkontrol: DOM, skærmbilleder, analytics. Ikke paginering — se afsnittet ovenfor. |
| `scripts/cloud/app-ned.sh` | Stopper app og testaktiver. |
| `scripts/cloud/db-ned.sh` | Stopper basen. Data bliver liggende. |

## Isolationen

Fire lag, og det inderste er det, der tæller:

1. **Loopback alene.** `listen_addresses = '127.0.0.1'`, og `pg_hba.conf`
   har kun `127.0.0.1/32` og `::1/128`. Basen kan ikke nås udefra.
2. **Port 55432, ikke 5432.** En fejlrettet forbindelse rammer ingenting
   frem for en tilfældig anden base.
3. **`krav_isoleret`** i `miljoe.sh` afviser enhver URL, der ikke er
   præcis `127.0.0.1:55432/bofinda_test` — på vært, port og databasenavn.
4. **`app-op.sh` SPØRGER basen, hvem den er** (`current_database()`,
   `inet_server_port()`), før den starter appen. En URL kan pege på det
   rigtige og alligevel ramme noget andet.

`MAALING_AKTIV=1` sættes **først efter** trin 4 er bestået, og kun i
app-processen. Rækkefølgen er hele pointen: målingen må aldrig kunne
tændes mod en base, ingen har set på.

### Hemmeligheder

Databasens adgangskode og `BILLED_HEMMELIGHED` genereres på maskinen og
gemmes i `/var/lib/bofinda-test/hemmeligheder.env` (`chmod 600`) — uden
for repoet, så de ikke kan committes. De udskrives aldrig. Det er ikke
produktionsnøgler og må heller ikke forveksles med nogen.

Datamappen ligger samme sted, af samme grund: en databasefil kan ikke
committes ved et uheld, hvis den aldrig har været i træet.

## Ingen skjulte eksterne forudsætninger

`scripts/cloud/aktiver.mjs` er en lille server på 55433, der **genererer**
boligbilleder og kortfliser i hukommelsen. Ingen binære filer i repoet.

- **Billeder.** Appen kender værten, fordi `NEXT_PUBLIC_SUPABASE_URL`
  peger på den, og `lib/billede.ts` udleder `EGEN_LAGERVAERT` af netop
  den variabel. Allowlisten er **uændret** — der kaldes aldrig til en
  udlejers billedserver.
- **Kortfliser.** `NEXT_PUBLIC_FLISE_URL` peger på den samme server.
  OpenStreetMaps donationsdrevne tjeneste hører til mennesker, der ser et
  kort — ikke til en automatiseret kørsel.
- **Browserkontrollen afbryder alt uden for 127.0.0.1** i en
  route-handler og fælder kontrollen, hvis noget forsøger. En ekstern
  tjeneste kan altså ikke snige sig ind som en tavs forudsætning.

## Hvad testmiljøet IKKE dækker

Sig aldrig, at disse er verificeret her:

- **Paginering.** Se afsnittet ovenfor. Miljøet kører på main, hvor
  pageren ikke findes; en grøn browserkontrol siger intet om den.

- **Supabase-login.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` er en
  attrap. Udlejerruterne er ikke prøvet.
- **Storage og upload.** Ingen bucket, ingen signerede URL'er.
- **RLS.** Politikkerne oprettes af migrationerne, men `auth.uid()` er en
  stub, der giver null. De kan meldes grønne uden at håndhæve noget —
  samme begrænsning som PGlite-testbasen, se CLAUDE.md.
- **Mail.** Ingen `RESEND_API_KEY`. Alarmmail hører ikke til her, og en
  halvt konfigureret afsender er værre end ingen.
- **Kildekontrakter for prøvekilder.** `availabilityFor()` giver
  bevidst alt-`unknown` for en kilde uden kontrakt. Derfor ligger de
  boliger, der skal vise «kan overtages nu/senere», på `native`, hvis
  kontrakt er vores egen.

## Datasættet

Deterministisk **i indholdet**: én fast frø (`20260908`) driver hvert
valg, så adresser, priser, arealer, værelsestal, faciliteter, økonomi og
`availability_facts` er de samme ved hver kørsel. Efterprøvet felt for
felt over to kørsler: 21 kolonner er bit for bit identiske.

**Fire felter er det med vilje ikke**, og det skal de ikke være:

| Felt | Hvorfor det flytter sig |
|---|---|
| `available_from`, `first_seen_at`, `source_created_at` | Regnet ud fra `Date.now()`. Var de faste datoer, ville «kan overtages nu» og «ny bolig» holde op med at være sande efter et par uger — og så prøvede miljøet noget andet, end det gav sig ud for. |
| `unit_address_uuid` | `randomUUID()` pr. bolig, så ingen bolig utilsigtet dedupes mod en anden. Det bevidste dublet-par har en **fast** delt nøgle (`delt-enhed-0001`), så dedup-adfærden er stabil, selv om værdierne ikke er. |

Sig derfor ikke, at to kørsler er «bit for bit ens». Sig, at **det
kontrollerne måler**, er stabilt: kortantal, gruppering, priser og
faciliteter giver samme resultat hver gang.

264 boliger → **144+ kort efter gruppering** (målt: 172). Det er mere,
end der er plads til i ét udsnit à 48 — sættet er med andre ord stort
nok til at fylde mindst tre sider, den dag en pager findes. På main
vises kun de første 48; resten er nåbare gennem filtrene. Sættet
indeholder med vilje:

- gruppekort (2–6 boliger) og enkeltkort
- grupper med ens priser, og grupper hvor spændet er over 25 %
- varierende areal **inden for** en gruppe, så et arealfilter kun rammer
  nogle medlemmer og kortet må skrive «x af y matcher»
- alle fire el-tilstande, inkl. «Aconto er ét samlet beløb»
- NULL-værdier: boliger uden areal, uden total, uden billeder
- boliger uden værelsestal, som derfor **ikke** kan grupperes
- overtagelse nu · senere · ukendt, og én gruppe der blander alle tre
- én kilde, der aldrig oplyser faciliteter (`test-gamma`)
- ét bevidst dublet-par: samme enhedsadresse hos to kilder, hvor
  repræsentantvalget skal skjule den ene
- en søgning uden resultater: `/?by=Findesikke`

Alt er tydeligt opdigtet — «Prøveby», «Attrapvænget», `eksempel.invalid`.
Ingen række er kopieret fra produktionen.

**Genkørsel giver ingen dubletter.** `saa.mjs` sletter kun rækker på sine
egne `test-`-kilder, og for `native` kun sine egne `native-`-nøgler —
aldrig en rigtig udlejerannonce, og aldrig en anden database.

## Almindelige kommandoer er upåvirkede

`npm install`, `npm run build` og en deploy rører **intet** af det her.
Der er ingen postinstall-hook, intet automatisk seed og ingen forbindelse
til produktionen. Testmiljøet findes kun, når nogen kalder
`scripts/cloud/`.

`npm test` er uændret: den kører mod PGlite i processen og loader ikke
`.env`.

## Efter en container-genstart

Cloud-containeren er flygtig. Alt under `/var/lib/bofinda-test` forsvinder
med den, og det gør ikke noget:

```bash
scripts/cloud/op.sh
```

bygger det hele op igen fra repoet alene. Ingen session afhænger af, at
en anden sessions databaseproces stadig kører.
