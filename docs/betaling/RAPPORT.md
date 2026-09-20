# Betalingsmodulet — hvad der er efterprøvet, og hvad der ikke er

Denne fil hører til koden og opdateres med den. Den er den liste, nogen
skal kunne læse **før** muren slås til.

Gælder betalingsgrenen `claude/betaling-og-adgangskontrol`, som den står
efter anden gennemgangsrunde. Basis for hele arbejdet:
`2073eb1b16f10f26f22ee65ebd4c2218bd2e45bc`.

## Commitrækkefølgen

| Commit | Hvad |
|---|---|
| `832d483` | Betalingsmodulet og den centrale adgangskontrol — første aflevering |
| `fbfb4dc` | Første gennemgangs otte fund |
| *denne* | Anden gennemgangs ni fund |

**Rettelse til den tidligere rapport.** Den sagde «to nye
rettelsescommits». Det var forkert: patch-serien indeholdt den
oprindelige `832d483` **plus én** rettelsescommit, `fbfb4dc`. Én
rettelsescommit, ikke to. Gennemgangen havde ret.

## Manglende verifikation — Stripe

**Intet i dette modul er kørt mod Stripe.** Ikke mod produktion, og
ikke mod sandbox. `api.stripe.com` er spærret i det miljø, modulet er
bygget i (CONNECT svarer `000`), og der er ingen nøgler. Det står her
særskilt, fordi det ikke ændrer sig af, at prøverne er grønne:

> **De lokale prøver kan ikke bevise, at Stripe accepterer vores
> argumenter.** De beviser, at vores kode kalder det, vi siger den
> kalder, med de argumenter vi siger — og at den opfører sig rigtigt,
> når kaldet fejler.

`scripts/stripefalsk` er en kontrolleret erstatning uden netværk. Den
håndhæver to dokumenterede adfærd, så prøverne måler noget:

* **Idempotensnøgler** — samme nøgle med samme parametre afspiller det
  første svar; samme nøgle med **ændrede** parametre giver en fejl.
  ([docs.stripe.com/api/idempotent_requests](https://docs.stripe.com/api/idempotent_requests))
* **Fasernes tidspunkter** — en `duration` omsættes til konkrete
  `start_date`/`end_date`, og en fase begynder, hvor den foregående
  slipper. Uden det ville `planfejl()` måle sine egne inputfelter.

Det er en model af dokumentationen, ikke en observation hos Stripe.

### Skal køres i Stripe-sandbox, før muren slås til

1. Opret de to priser og bekræft, at `interval: 'day'` med
   `interval_count: 1` og `28` accepteres på et abonnementsprodukt.
2. `checkout.sessions.create` med `mode: 'subscription'`, `expires_at`
   og `idempotencyKey` — bekræft, at nøglen opfører sig som
   dokumenteret, herunder afvisningen ved ændrede parametre.
3. `subscriptionSchedules.create({ from_subscription })` efterfulgt af
   `update({ phases })` med `duration` på fase 1 — og **læs planen
   tilbage** og kør `planfejl()` på det svar. Det er den eneste kontrol,
   der kan falde på en forkert antagelse om Stripes felter.
4. Gennemfør en rigtig testbetaling og bekræft rækkefølgen og indholdet
   af `checkout.session.completed`, `invoice.paid` og
   `customer.subscription.updated`, herunder at perioden ligger på
   `items.data[0]` og ikke på abonnementet.
5. `checkout.sessions.expire` på en session i `open` og på en i
   `complete` — bekræft, hvad Stripe svarer i det andet tilfælde.
6. Webhook-signaturen mod den rigtige `STRIPE_WEBHOOK_SECRET`.

Indtil 1–6 er kørt, er modulet **uverificeret mod Stripe**, uanset hvad
de lokale prøver siger.

## Migrationsbeviset

Kørt med det rigtige værktøj (`drizzle-kit migrate`) mod rigtig,
isoleret PostgreSQL på `127.0.0.1:55432` — ikke mod PGlite. PGlite er
rigtig PostgreSQL, men den har fanget en forskel før: en migration, der
kørte dér, faldt på `drizzle-kit`.

To veje, begge med deres egen kommando og exitkode i
`logs/07-migrationer.log`:

* **frisk** — tom base, Supabase-stubbe, derefter alle 26 migrationer
* **opgradering** — journalen afkortet til 0024, migrér, gendan
  journalen, migrér igen (så kun `0025` kører)

### Hvad «ens skema» betyder her

Den tidligere rapport kaldte de to baser identiske på grundlag af en
**md5 over `information_schema.columns`**. Den påstand er for bred, og
gennemgangen havde ret i det: den hash siger noget om **kolonner**. Den
siger intet om en manglende unik begrænsning, et manglende indeks, en
RLS-politik der ikke blev oprettet, eller en glemt `revoke`.

Sammenligningen er derfor udvidet i stedet for at blive afgrænset.
`scripts/cloud/skemasammenlign.mjs` sammenligner **otte snit**:

| Snit | Kilde |
|---|---|
| kolonner | `information_schema.columns` |
| begrænsninger | `pg_constraint` + `pg_get_constraintdef` |
| indekser | `pg_indexes` |
| politikker | `pg_policies` |
| RLS til/fra | `pg_class.relrowsecurity` |
| rettigheder til `anon`/`authenticated`/`service_role` | `information_schema.role_table_grants` |
| funktioner | `pg_proc` |
| enum-værdier og rækkefølge | `pg_type` + `pg_enum` |

Det er stadig ikke «alt» — triggere, sekvensernes tilstand, kommentarer
og `storage`-skemaet er ikke med — og påstanden er derfor præcis så
bred som listen, ikke bredere.

**Fundet undervejs:** den første udgave af `0025` droppede den gamle
unikke begrænsning under navnet `checkout_forsoeg_stripe_session_id_unique`.
`0024` skrev den som en inline `unique`, og PostgreSQL navngav den selv
`checkout_forsoeg_stripe_session_id_key`. Migrationen sagde altså, at
begrænsningen var væk, mens den stod der stadig. En
kolonne-hash ville aldrig have vist det. `pg_constraint`-snittet viste
det med det samme.

## Hvad prøverne dækker

| Kommando | Base | Hvad |
|---|---|---|
| `npm test` | PGlite | hele suiten, inkl. tre betalingsprøver |
| `npm run test:kaploeb` | rigtig PostgreSQL, egen database | kapløbene |

Kapløbene kan **ikke** køre under `npm test`. PGlite er én forbindelse i
én proces: to «samtidige» transaktioner serialiseres, før de når
hinanden, og en prøve for et kapløb ville være grøn, uanset om vagten
fandtes.

`scripts/test-betaling-kaploeb.ts` opretter sin egen database i den
lokale testklynge, kører de rigtige migrationer i den og sletter den
igen. Den rører ikke `bofinda_test`. Målet efterprøves mod den
**faktiske forbindelse** (`current_database()`), før der skrives.

### Indgangene, prøverne kalder

Gennemgangen bad om «de faktiske HTTP-, købs- og driftsindgange». Det
er dem, `scripts/test-betaling-runde2.ts` kalder:

| Indgang | Funktion |
|---|---|
| HTTP | `POST` fra `app/api/stripe/route.ts`, rigtig `Request`, rå krop |
| Køb | `startKoebFor()` fra `lib/abonnement.ts` |
| Drift | `betalingstilsyn()` og `saetTilstand()` |

En kildetekstsøgning efter en vagts navn er stadig med ét sted
(`test-betaling.ts` afsnit 9, kaldestederne), men den er
**supplerende**: den kan ikke se, om vagten fyrer.

## Reproduktion før og efter

Anden gennemgang kom med sin egen `probe.mjs` — en selvstændig harness
med en in-memory SQL-adapter og leverancens Stripe-erstatning. Den
**hævder**, at fejlene er der: exit 0 betyder «reproduceret».

Begge retninger er kørt:

| | Kilder | Exit 0 betyder |
|---|---|---|
| **før** | `fbfb4dc`, byte-verificeret mod git | alle ni fund reproducerer |
| **efter** | repoets nuværende filer, assertionerne vendt om | alle ni fund er væk |

Efter-kørslen er **den samme harness**, ikke en ny. Tre ting er føjet
til adapteren og intet andet: en transaktion, der kører sit
tilbagekald, `execute` til låsesætningen på drift-rækken, og
`raekker()`-shimmet. Adapteren er enkelttrådet og har ingen isolation,
så den måler kontrolflow — kapløbene er prøvet på rigtig Postgres ved
siden af.

Det kostede én ændring i produktionskoden: `Koebsfejl` brugte
parameteregenskaber (`constructor(readonly slags)`), som er
TypeScript-syntaks, der *skaber* kode. Nodes egen typestripning afviser
den med `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Felterne er skrevet ud.

## Det, der ikke er løst

* **RLS på `storage.objects`** er stadig den eneste håndhævelse af
  mappegrænsen mellem udlejere, og der findes ingen prøve for den. Den
  kan ikke skrives mod PGlite: `auth.uid()` er en stub, der giver null.
  Se CLAUDE.md, «RLS er ikke dækket. Noget andet er værre».
* **Betalingsmuren er ikke slået til**, og der er ikke oprettet priser
  hos Stripe. GRATIS er den tilsigtede lanceringstilstand.
