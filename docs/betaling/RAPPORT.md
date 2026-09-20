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
| `0e75b1c` | Anden gennemgangs ni fund |
| *denne* | Tredje gennemgangs seks fund |

Historikken er ikke omskrevet undervejs. De tidligere revisioner står,
som de blev afleveret.

**Rettelse til den tidligere rapport.** Den sagde «to nye
rettelsescommits». Det var forkert: patch-serien indeholdt den
oprindelige `832d483` **plus én** rettelsescommit, `fbfb4dc`. Én
rettelsescommit, ikke to. Gennemgangen havde ret.

## Manglende verifikation — Stripe

**Intet i dette modul er kørt mod Stripe.** Ikke mod produktion, og
ikke mod sandbox. `api.stripe.com` er spærret i det miljø, modulet er
bygget i, og der er ingen nøgler. Det står her særskilt, fordi det ikke
ændrer sig af, at prøverne er grønne:

> **Rettelse til forrige aflevering.** Stripe-adgangsloggen viste
> `curl`-fejl 56, HTTP 403 ved tunnelen og HTTP-kode `000` — og sluttede
> alligevel på `exitkode=0`. Nullet var ekkoets, ikke curls. En log, der
> ser bestået ud på en måling, der mislykkedes, er værre end ingen log.
> Nu står **kommandoens egen exitkode adskilt fra wrapperens** i hver
> log, og `logs/06-stripe-adgang.log` skriver sin tolkning ud: om der
> var forbindelse eller ikke.

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
`logs/04-migrationer.log`:

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
| `npm test` | PGlite | hele suiten, inkl. **fire** betalingsprøver |
| `npm run test:kaploeb` | rigtig PostgreSQL, egen database | kapløbene |

`scripts/test-betaling-runde3.ts` kører tredje rundes seks fund gennem
de faktiske indgange. Kapløbsprøven har fået **B3** (gratis-skift mod et
gennemført køb) og **B4** (skift mod et kald i luften, hvor oprydningen
fejler) — netop det forløb, gennemgangen bad om at få målt på rigtig
PostgreSQL.

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

## Tredje runde — hvad der blev rettet

Seks fund, alle reproduceret mod `0e75b1c` med gennemgangens egen probe
og derefter mod repoets arbejdstræ:

| Fund | Kernen | Rettelsen |
|---|---|---|
| 1 | `complete` blev læst som «død betalingsside» | ny tilstand `gennemfoert`, som **spærrer** |
| 2 | et tomt sessions-id blev læst som «intet kører» | uafklaret indtil reservationen udløber |
| 3 | forsøg blev lukket på **kunde**-id | bundet på sessions-id og fakturaens metadata |
| 4 | gemt 500 brændte nøglen; «fejlet» stoppede intet | afstem via `subscription.schedule`; **stop fornyelsen** |
| 5 | `<=` lod samme sekund genoplive `canceled` | særskilt **terminalvagt**, tiden urørt |
| 6 | de 50 ældste udsultede køen | `naeste_forsoeg_at` med tilbagetrækning |

Tilstandsmodellen, de ti invarianter og bindingerne mellem forsøg,
session, abonnement og driftsstatus står i
[`docs/betaling/tilstande.md`](tilstande.md).

### Det, der KRÆVEDE en beslutning

Fund 4's anden halvdel kunne ikke løses med kode alene. En plan, der
ikke kan bekræftes, betyder, at abonnementet fornyes til **introprisen
hver dag** — og `plan_status = 'fejlet'` er en markering i vores base,
ikke en handling hos Stripe.

**Valgt:** slip planen og sæt `cancel_at_period_end`. Kunden beholder
den periode, hun har betalt for; der kommer ingen opkrævning på vilkår,
vi ikke kan levere.

**Fravalgt:** lade den løbe videre til 9 kr./dag med en advarsel i
loggen. Det er den nuværende adfærd, og det *er* en anden prismodel end
den aftalte — bare en, ingen har besluttet.

**Prismodellen er uændret:** 9 kr. for de første 24 timer, derefter
349 kr. hver 28. dag. Det, der er ændret, er, hvad vi gør, når vi ikke
kan levere den. Skal en kunde i den situation have et andet tilbud — en
forlænget introperiode, en rabat — er det en produktbeslutning, ikke en
kodeændring, og den er ikke taget her.

## Reproduktion før og efter

Anden gennemgang kom med sin egen `probe.mjs` — en selvstændig harness
med en in-memory SQL-adapter og leverancens Stripe-erstatning. Den
**hævder**, at fejlene er der: exit 0 betyder «reproduceret».

Begge retninger er kørt:

| Runde | Kilder | Exit 0 betyder |
|---|---|---|
| 2 · før | `fbfb4dc`, byte-verificeret mod git | alle ni fund reproducerer |
| 2 · efter | repoets filer, assertionerne vendt om | alle ni fund er væk |
| 3 · før | `0e75b1c`, byte-verificeret mod git (28 filer) | alle syv scenarier reproducerer |
| 3 · efter | repoets filer, assertionerne vendt om | alle syv er væk |

| 3 · efter modstandsgennemgangen | repoets filer, assertionerne vendt om | alle syv er stadig væk |

Efter-kørslen er **den samme harness**, ikke en ny. Tre ting blev føjet
til adapteren i runde 3 og intet andet: en transaktion, der kører sit
tilbagekald, `execute` til låsesætningen på drift-rækken, og
`raekker()`-shimmet. Modstandsgennemgangen kostede to til, begge
adapterens begrænsninger og ikke kodens: `UAFSLUTTET` som binding
(loaderen stripper imports, og konstanten flyttede til `db/schema.ts`)
og `coalesce()` i dens `sql`-tag.

**Én af dem fandt noget.** Loaderen kunne ikke oversætte en
`export { X }`-genudstilling, og det viste sig, at den genudstilling
ikke havde en eneste kalder: den var indført «for kompatibilitet» med
ingenting. Den er væk. Adapteren er ikke et bevis om Stripe, men den
kan altså stadig pege på noget. Adapteren er enkelttrådet og har ingen isolation,
så den måler kontrolflow — kapløbene er prøvet på rigtig Postgres ved
siden af.

Det kostede én ændring i produktionskoden: `Koebsfejl` brugte
parameteregenskaber (`constructor(readonly slags)`), som er
TypeScript-syntaks, der *skaber* kode. Nodes egen typestripning afviser
den med `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Felterne er skrevet ud.

## Modstandsgennemgangen af rettelserne selv

Rettelserne blev derefter gået efter af fire uafhængige linser —
pengene, tilstandsmaskinen, migrationen og prøverne — med én opgave:
find det, RETTELSERNE indførte. Det gav otte fund, og de tre første
var alvorlige. **De er rettet i samme commit som de seks, de kom af.**

| # | Hvad | Hvorfor det betyder noget |
|---|---|---|
| A | `betalt()` slugte konflikten med `sub_en_levende_pr_bruger` | En BETALT faktura blev markeret færdig, nyttelasten slettet, og genleveringen svarede «gentagelse». Pengene var modtaget; adgangen blev aldrig skrevet |
| B | Tilsynet ophævede sin egen fornyelsesbeskyttelse | Kørsel 1 stoppede fornyelsen, kørsel 2 lagde en ny plan på det samme abonnement og markerede den `konfigureret` — mens basen og «Mit abonnement» sagde «der bliver ikke trukket mere» |
| C | `stopForkertFornyelse` slap en KORREKT plan uden at spørge Stripe | Ét mislykket opslag i de sidste 120 minutter var nok til at opsige et abonnement, der ikke fejlede noget |
| D | Den generelle fejltekst overskrev den præcise | «afventer forudsaetning» skrev hen over «kontoen har allerede et levende abonnement» — og netop den skal et menneske se |
| E | Den blivende advarsel kunne slukkes af en anden kolonne | Advarslen hvilede på to felter; nu på `fornyelse_stoppet_at` alene |
| F | Afstemningen stemplede med NU | De ægte hændelser fra købet blev derefter afvist som forældede: status, pris og periode blev aldrig spejlet |
| G | `uafklarede` blev udledt af et startantal | En række, der netop blev `gennemfoert`, talte både som uafklaret og som gennemført |
| H | `UAFSLUTTET` stod fire steder | Samme spørgsmål i SQL og i JS, uden at kunne udledes af hinanden |
| I | `opgivSession` genoplivede rækken til `aaben` | Ramte `checkout_uafsluttet_pr_bruger`, fejlen slap ud, og rækken blev lukket **uden** sessions-id: en betalbar session, ingen kunne se — og GRATIS-skiftet meldte «ok» |
| J | `fejlPaa.add('…expire')` fyrede aldrig | Tre prøver hed noget andet, end de målte. Oprydningen blev aldrig kørt, og rapporten lovede en dækning, der ikke fandtes |
| K | «release FØR update» målte ikke rækkefølge | Byttede man de to kald om, var prøven stadig grøn — og rækkefølgen er hele vagten |
| L | Prøven for `!ops && prisId → 'afventer'` var slettet | Reglen mod 9 kr./DAG stod helt udækket |
| M | §1c læste den række, §1b efterlod | `[0]!.id` på et tomt resultat afbrød hele filen: seks afsnit blev aldrig kørt, og der kom ingen optælling |
| N | Afstemningen lod Stripes `client_reference_id` vinde over `checkout_forsoeg.user_id` | Et svar udefra kunne bestemme, hvilken konto et abonnement blev bogført på. Vores egen række er NOT NULL, så den fjerne værdi vandt altid |
| O | `falsk.nulstil()` nulstillede ikke sessioner, planer og abonnementer | Et afsnit, der tæller «hvor mange sessioner er åbne hos Stripe», målte også de foregående afsnits. Ét afsnit kompenserede ad hoc |
| P | Kommentaren om idempotensnøglen beskrev en vagt, koden ikke har | Den sagde, nøglen «genbruges» efter en valideringsfejl. Den roterer ved hvert forsøg; sikkerheden ligger i afstemningen mod `subscription.schedule` — og en kommentar, der peger på den forkerte vagt, får nogen til at fjerne den rigtige |

Og tre grene, der ikke havde nogen prøve overhovedet, har fået en:
afstemningens «dødt abonnement → forsøget `afbrudt`» (§14),
`stopForkertFornyelse`s `'fejlede'` og dens ⚠⚠-linje (§15), og — uden om
koden, direkte i basen — den nye halvdel af
`checkout_uafsluttet_pr_bruger`, som 0026 indførte og ingen målte
(`scripts/test-migrationer.ts`).


**I er den, der kostede mest at finde, og den eneste, to linser måtte
give op på.** Pengelinsen skrev den som «usikker»: «Jeg KUNNE IKKE
konstruere forløbet.» Prøvelinsen konstruerede det — og målte
udgangen: `gratis-skift: {"ok":true}` med en betalbar session tilbage
hos Stripe. Det er invariant I2 brudt, og den var brudt på 0e75b1c.

Rettelsen er én sætning flyttet: **sessions-id'et skrives FØR kaldet,
ikke efter.** Fra det øjeblik Stripe har givet os et id, findes der
noget betalbart, og der må ikke være et vindue, hvor vores base ikke
kender det. Fejlgrenen rører derefter ikke `status` — den skriver kun,
hvad vi ved — og det nye prædikat `SPAERRER_SKIFTET` finder rækken
uanset hvilken status den står i. `lukAlleAabneKoeb` og `aabneKoeb()`
bruger det samme prædikat, så adminsidens tal ikke kan modsige
afvisningen ved siden af.

**J, K, L og M er prøver, ikke kode.** De hører med alligevel: en
prøve, der ikke måler det, den hedder, er værre end ingen prøve, fordi
rapporten bygger på den. J's flag fyrede aldrig; K's optælling var
ligeglad med rækkefølgen; L var slettet; M kunne afbryde hele filen.
Alle fire er rettet, og J har nu sit eget afsnit (§2c), hvor
oprydningen faktisk nås.

**A er den dyreste, og den var der før tredje gennemgang** — den blev
først synlig, da `bogfoerAbonnement()` lærte at håndtere den samme
forudsætning rigtigt. To kodeveje, der oprettede den samme række, og
kun den ene læste resultatet af sin indsættelse. Det er CLAUDE.md's
regel om ét beregningssted, endnu en gang.

**C er værd at holde fast i som mønster.** `laegPlan` fik i denne
omgang en «AFSTEM FØR DU OPRETTER»-vagt. Den modsatte handling — at
tage en plan fra nogen — havde ingen. Den dyre af de to var den uden
vagt: at oprette en plan for meget koster en oprydning, at slippe en
rigtig koster kunden hendes overgang til normalprisen og en opsigelse,
hun ikke har bedt om.

**H fik sin egen prøve, og den er ny af art.** `scripts/test-migrationer.ts`
kører journalens migrationer i ÉN transaktion — sådan som
`drizzle-kit migrate` faktisk gør — og sammenligner bagefter
`UAFSLUTTET` i `db/schema.ts` med indekspraedikatet, den finder i
basen. Begge dele var før udækket: `npm test` og cloud-klargøringen
kører filerne hver for sig, og det er netop dér, enum-fælden IKKE
bider. 0021 og 0026 måtte begge omgå den, og begge gange blev det
opdaget ved håndkraft.

Hver rettelse har en prøve, der er kørt **omvendt** i en separat kopi
af repoet: fejlen genindført, prøven fejler. Alle modprøver fejler som
de skal — en prøve, der ikke kan fejle, måler ingenting. Se
`logs/11-modproever.log`.

## Det, der ikke er løst

* **RLS på `storage.objects`** er stadig den eneste håndhævelse af
  mappegrænsen mellem udlejere, og der findes ingen prøve for den. Den
  kan ikke skrives mod PGlite: `auth.uid()` er en stub, der giver null.
  Se CLAUDE.md, «RLS er ikke dækket. Noget andet er værre».
* **Betalingsmuren er ikke slået til**, og der er ikke oprettet priser
  hos Stripe. GRATIS er den tilsigtede lanceringstilstand.
