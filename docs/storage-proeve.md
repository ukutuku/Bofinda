# Storage-integrationsproeven

Hvad HAANDHAEVER adgangspolitikken for bucket `boliger` faktisk — ikke hvad
den er tænkt at håndhæve? Denne prøve måler det mod den rigtige Supabase
Storage på **staging** (`prgmenbwabwkgitjclrj`), med to konti og et
anonymt kald. Det er den prøve, CLAUDE.md siger mangler:

> Den prøve, der mangler, er en integrationsprøve mod den rigtige Supabase
> med to konti, hvor den ene forsøger at signere en upload til den andens
> mappe og bliver afvist — og som bevises ved at politikken midlertidigt
> svækkes.

Den kan **ikke** køre mod PGlite (som ikke har Storage) og **må aldrig**
køre mod produktionen.

## Hvorfor den findes

En anden undersøgelse viste, at `billedUrl()` lægger den signerede
Storage-URL — med et token, der gælder i ti år — i HTML'en på hver
udlejerannonce, selv om kommentarerne i `0014_storage.sql` og
`app/api/billede/route.ts` siger, at browseren aldrig ser adressen. Så
spørgsmålet er ikke, hvad politikken er tænkt til, men hvad den gør. Det
kan kun måles mod den rigtige Storage — RLS på `storage.objects` er den
eneste håndhævelse af mappegrænsen mellem udlejere, og der findes ingen
prøve for den nogen steder.

## Kør den

```bash
npm run proeve:storage:staging
```

Tre ting skal være på plads først:

1. **SQL-funktionerne** fra `db/staging/storage-proeve.sql` er kørt **én
   gang** i stagings SQL-editor. De ligger uden for `db/migrations` med
   vilje — migrationerne køres mod produktionen, og disse hører kun til
   staging. Mangler de, svarer prøven exit 3 og siger det.
2. **`STAGING_SUPABASE_PUBLISHABLE_KEY`** og
   **`STAGING_SUPABASE_SECRET_KEY`** ligger som **Environment variables**
   (ikke som API credentials — dem er en header-injektion i proxyen, som
   scriptet ikke kan læse). Secret-nøglen er en **dedikeret**
   `sb_secret_`-nøgle, oprettet til formålet, så den kan tilbagekaldes
   alene.
3. Netværkspolitikken tillader `prgmenbwabwkgitjclrj.supabase.co`.
   `NODE_USE_ENV_PROXY=1` sætter npm-scriptet selv (Nodes `fetch` når ellers
   ikke staging gennem proxyen; flaget er harmløst uden `HTTPS_PROXY`).

Kørslen opretter to prøvekonti, sår sine egne objekter under
`<uid>/proeve/…`, kører prøverne, og rydder alt i `finally` — konti,
objekter og enhver svækkelse. En dræbt kørsel efterlader intet, der
betyder noget: svækkelserne udløber af sig selv efter et par minutter, og
næste kørsels start rydder rester, før den måler.

## Hvordan den ikke kan ramme produktionen

Spærringen står i koden (`scripts/proeve-storage/vagter.ts`), ikke som en
aftale:

- Projekt-ref'en er en **konstant**. Hver URL, prøven henter, går gennem
  `sikkerUrl()`, som afviser enhver vært, der ikke er staging.
- Prøven **nægter at køre**, hvis `DATABASE_URL`, `DATABASE_URL_DIRECT`
  eller `RESEND_API_KEY` ligger i processen — så den hverken kan nå
  produktions-basen eller sende mail. npm-scriptet loader ikke `.env`.
- Første privilegerede kald spørger basen, hvem den er
  (`proeve_storage_metadata`), og bekræfter, at den privilegerede rolle
  omgår RLS (ellers ville sandhedsmålingen selv være filtreret).

## Hvorfor den kan fejle

En prøve, der ikke kan bevises at fejle, beviser ingenting. Derfor:

- **Alt måles på body og på sandheden i basen**, aldrig på HTTP-status
  alene. Storage svarer HTTP 400 på næsten alle afvisninger, og fire er
  **tavse** (HTTP 200 med tom liste): listning, batch-signering,
  batch-sletning og bucket-listning. For dem læser prøven `storage.objects`
  uden om RLS og sammenligner offerets fil før og efter (findes den stadig,
  samme version/eTag?) og kører en **positiv kontrol** med samme kald, der
  beviseligt lykkes.
- **Mutationsbevis.** Hver grænseprøve har en navngiven svækkelse: en
  ekstra, tilladende politik med sin egen frist i prædikatet. Prøven kører
  igen under svækkelsen og **skal** nu skifte fra "blokeret" til "åben".
  Gør den ikke det, har den ikke målt grænsen (exit 2). Svækkelser af
  DELETE og UPDATE parres altid med en SELECT-politik — ellers lægger
  PostgreSQL SELECT-quals på som et tavst filter, og prøven kunne aldrig
  blive rød. De tre rigtige 0014-politikker røres aldrig; svækkelserne har
  deres egne navne (`proeve_svag_*`) og fjernes igen.
- Nogle grænser er **statisk krypto** (fx at en signatur er bundet til
  netop sin sti). De bevises af en indbygget positiv kontrol i selve
  prøven — den rigtige sti henter, den forkerte afvises — så prøven kan
  fejle begge veje uden en politik-svækkelse.

## Kendte huller: fund, ikke grønne prøver

Nogle ting er per design usikre i dag. En prøve, der krævede den ønskede
adfærd, ville stå permanent rød; en, der krævede dagens adfærd, ville
cementere hullet. Derfor har de deres egen status, **`◆ HUL`**: prøven
bekræfter, at hullet stadig er der, rapporterer det i et eget afsnit, og
fejler **ikke** kørslen. Ændrer adfærden sig — fx den dag et hul lukkes —
skifter prøven til rød og **tvinger** nogen til at opdatere den. Så kan et
hul hverken lukkes i stilhed eller stå grønt.

De bekræftede huller i dag:

- **Den signerede URL omgår politikken.** En anonym uden apikey og uden
  JWT henter A's fil med URL'en fra HTML'en. 0014 spørges kun ved
  udstedelsen, aldrig ved brug.
- **Tokenet er bundet til stien, ikke versionen.** Slettes objektet og
  lægges en ny fil på samme sti, serverer det gamle token det nye indhold.
  At slette er derfor ikke en tilbagekaldelse.
- **Udlejerens auth-uid står i den signerede URL** — og dermed i offentlig
  HTML. Samme klasse læk som den, `landlord_id`-reglen lukkede.

Rettelserne på de tre hører til hver sit kort uden for denne opgave. Når de
laves, vil `◆ HUL`-prøverne skifte status og pege på, at prøven skal
opdateres — det er meningen.

## Exit-koder

| Kode | Betyder |
|---|---|
| 0 | Alt bestået, og hver grænse bevist ved sin svækkelse |
| 1 | En grænse holdt ikke — eller et kendt hul har ændret sig og skal ses efter |
| 2 | Grønt, men en svækkelse ændrede intet, så grænsen er ubevist |
| 3 | Kørte ikke: en vagt afviste, en nøgle mangler, eller SQL-funktionerne er ikke installeret |

## Filer

| Fil | Rolle |
|---|---|
| `scripts/proeve-storage-staging.ts` | Kørslen og prøvelisten |
| `scripts/proeve-storage/vagter.ts` | Produktionsspærre og miljølæsning |
| `scripts/proeve-storage/klient.ts` | HTTP pr. identitet; læser body, ikke status; sha256 |
| `scripts/proeve-storage/privilegeret.ts` | Det privilegerede lag (RPC som service_role) |
| `scripts/proeve-storage/konti.ts` | Opret/slet prøvekonti via Auth-admin |
| `scripts/proeve-storage/harness.ts` | Udfald, mutationsbevis, rapport |
| `db/staging/storage-proeve.sql` | Staging-only SQL-funktioner — **aldrig** i `db/migrations` |

## Hvad den IKKE dækker

- **RLS på `storage.objects` i produktionen.** Prøven kører kun mod
  staging. Produktionens politikker skal måles med `proeve_storage_metadata`
  eller i dashboardet; 0014 opretter politikker med `if not exists` på
  navnet, så kun `pg_policies` viser, hvad der faktisk kører.
- **Vercels og Supabases CDN-cache.** Om en slettet fil stadig serveres fra
  kanten er platformadfærd og måles med `x-vercel-cache` / `cf-cache-status`,
  ikke herfra.
- **Nøglerotation som nødbremse.** Kan kun udløses på platformniveau, og den
  dræber alle signerede URL'er på én gang.
