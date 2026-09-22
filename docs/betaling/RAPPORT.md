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
| `d8bd15f` | Tredje gennemgangs seks fund |
| `fa3e11e` | Modstandsgennemgang: seksten fund i rettelserne selv |
| `c8aa05b` | Fjerde gennemgang: hændelsesbevaring, opsigelse, planafstemning |
| `aca19df` | Femte gennemgang: anmodning, bekræftet sluttilstand, udestående arbejde |
| *denne* | Sjette gennemgang: atomisk beslutning, kvittering kun på set arbejde |

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

## Fjerde gennemgang: hændelsesbevaring, opsigelse, planafstemning

Fjerde gennemgang bekræftede, at alle tidligere scenarier består, og
fandt **fire nye reproduktioner i tre problemområder**. Alle fire
reproducerede mod både den afleverede kildepakke og repoets eget træ.
De er rettet som én sammenhængende ændring, ikke fire lapper: de
hænger sammen om én ting — **hvad vi faktisk ved, og hvornår vi ved
det.**

### R1 · en terminal hændelse gik tabt, fordi rækken ikke fandtes endnu

`spejl()` svarede `forael` på to forskellige ting: «din spejling er
forældet» og «der er ingen række at spejle i». Det andet betyder «prøv
igen senere», og det første betyder «færdig». En
`customer.subscription.deleted`, der ankom **før** sin checkout, blev
derfor kvitteret 200, nyttelasten slettet — og da den ældre checkout og
faktura så ankom, stod rækken `active`, mens Stripe sagde `canceled`.
Genleveringen svarede «gentagelse», og kontoen kunne ikke købe igen.

Terminalvagten kunne ikke fange det: den beskytter en **eksisterende**
terminal række.

Nu svarer `spejl()` `'afventer'`, når rækken ikke findes. Ruten svarer
409, nyttelasten bevares, og tilsynet tager hændelsen op igen, når
`kassen()` har skrevet rækken. Den betalte periode bogføres uanset —
adgangen er urørt af reparationen.

### R2 · opsigelsen kunne ikke genoptages efter en delvis gennemførelse

`release` lykkedes hos Stripe; den efterfølgende lokale skrivning
fejlede én gang; funktionen svarede `stripe_fejlede` — og
`cancel_at_period_end` var aldrig blevet sat. Hvert genforsøg døde så
på et `release` af den plan, Stripe **allerede havde sluppet**
(`release` virker kun på `not_started`/`active`), længe før det nåede
opsigelsen. Kunden sad fast, og tilsynet greb ikke ind, fordi den
lokale `planStatus` stod `konfigureret`.

Tre ting ændrede sig:

1. **Beslutningen skrives først.** `opsagt_af_kunde_at` er ankeret —
   uden det var der intet at genoptage fra.
2. **Planen afstemmes, før den slippes.** Gælder den ikke længere, er
   der intet at slippe, og opsigelsen går videre i stedet for at dø.
3. **Bogføringen er én skrivning til sidst.** Stripe først, vores egen
   række bagefter. Fejler den, er opsigelsen i kraft dér, hvor pengene
   er, og tilsynet skriver rækken hjem.

`fuldfoerSkyldigeOpsigelser` i `betalingstilsyn` er den genoptagelse.
Begge Stripe-kald er idempotente, så den kan køre igen og igen.

### R3 · kundens opsigelse spærrede ikke automatisk planlægning

Beskyttelsen fandtes kun mod systemets **eget** sikkerhedsstop
(`fornyelse_stoppet_at`). Kundens almindelige opsigelse havde ingen:
tilsynet og en forsinket introfaktura sendte nye
`subscriptionSchedules.create`/`update` ind i den betalingsplan, hun
lige havde afmeldt.

Nu spærrer både `opsagt_af_kunde_at` og `cancel_at_period_end` i
`laegPlan` og i udvælgelsen. Og `laegPlan` **gentjekker efter** de
eksterne kald: siger hun op, mens vi er i luften, slippes den plan, vi
netop har lagt. Hendes beslutning vinder, også når den kommer et
sekund for sent.

### R4 · en sluppet plan blev genindsat og bekræftet som gyldig

To ting i ét fund:

· **Bindingen kom tilbage.** `spejl()` skrev kun `stripe_schedule_id`,
  når feltet havde en **værdi**. En autoritativ `schedule: null` —
  Stripes egen måde at sige «dette abonnement styres ikke af en plan»
  — kunne derfor ikke rydde bindingen. Nu afgør det, om **nøglen** er
  der, ikke om værdien er sand.

· **Og den blev godkendt.** Sikkerhedskontrollen målte kun faserne. En
  frigivet plan beholder sine faser; Stripe fjerner kun dens
  `subscription`. Den svarede derfor `plan_er_rigtig` om en plan, der
  ikke styrede noget, og skrev `konfigureret` på den. Nu kræves begge
  led — se `planGaelder`.

Dertil: en forsinket `subscription.updated`, oprettet **før**
opsigelsen, kunne skrive `cancel_at_period_end` tilbage til false.
Flaget er et spejl; beslutningen er det ikke. Kun en hændelse, der er
nyere end beslutningen, må rydde flaget — og «Mit abonnement» læser
begge felter, så siden aldrig siger «fornyes» til en kunde, der har
trykket op.

### Attrappen blev strengere, og det var nødvendigt

`scripts/stripefalsk` tog imod `release` på hvad som helst og lod en
frigivet plan blive ændret. Begge dele afviser Stripe. En attrap, der
er mildere end virkeligheden, gør prøver grønne om forløb, der ville
fejle — og det var netop dén forskel, der skjulte, at opsigelsen sad
fast på sit eget genforsøg. Attrappen håndhæver nu reglen, og en plan
dér bærer sin `subscription`, som hos Stripe.

Fem prøvefixtures måtte rettes, fordi de beskrev en plan, der ikke
styrede noget, og alligevel forventede et `release`. Det var ikke
prøverne, der blev svækket — det var beskrivelsen, der blev sand.

### Hvad der er prøvet, og hvordan

| Niveau | Hvad |
|---|---|
| Kodeforløb | gennemgangens egen probe, vendt om: alle fire fund væk (`logs/10-probe-efter.log`) |
| PGlite | `scripts/test-betaling-runde4.ts` gennem HTTP-ruten, `sigOpFor()` og `betalingstilsyn()` |
| Rigtig PostgreSQL | to nye kapløb: dobbeltklik på opsigelsen, og opsigelse mod et planlægningskald i luften |
| Stripe-sandbox | **uafprøvet.** Intet er kørt mod Stripe |

## Femte gennemgang: anmodning, sluttilstand og udestående arbejde

Fire fund (N1-N4), alle bekræftet ved egen måling før rettelse. Under
arbejdet fandt to modlæsninger **fire fund mere i rettelserne selv**
(K1, K2, K6, K7) — også de er målt, rettet og dækket af regressioner.

### Det, de fire fund er ÉN fejl om

Rækken bar to kendsgerninger, hvor der skulle være tre. «Hun har bedt
om det» og «Stripe har bekræftet det» blev OR'et sammen til «opsagt» —
og **et OR kan kun gøre et udsagn stærkere.** Den svageste oplysning
kom derfor ud som det stærkeste løfte: et fejlet Stripe-kald viste
«Opsagt / Intet — fornyes ikke», knappen forsvandt, og fejlteksten sagde
«der er ikke ændret noget», mens `opsagt_af_kunde_at` netop var skrevet.

Den tredje kendsgerning — **udestående arbejde** — fandtes slet ikke
som felt. Den blev udledt: «besluttet, men `cancel_at_period_end` er
false». Den udledning svarer på et andet spørgsmål end det, den blev
brugt til, og hullet er præcis N2: er opsigelsen bekræftet, mens en
PLAN står uafklaret hos Stripe, er rækken ikke «skyldig» efter
udledningen — og den aktive plan var usynlig for hver eneste kø.

### N1-N4, punkt for punkt

| # | Fund | Rettelse |
|---|---|---|
| **N1** | Et fejlet kald blev vist som gennemført opsigelse | Tre adskilte felter. `sigOpFor` svarer `{ok:false, fejl:'afventer'}`, siden siger «Opsigelse undervejs», knappen bliver og hedder «Prøv opsigelsen igen» |
| **N2** | En uafklaret aktiv plan blev glemt, fordi `cancel_at_period_end` allerede var true | `afstemning_skyldig_at` som eget felt. Oprydningen gemmes, til Stripes sluttilstand er **læst tilbage** |
| **N3** | To opsigelser med hvert sit `active`-snapshot: den ene fik en fejl på noget, der var lykkedes | Genlæsning i release-catch'en. En **rigtig** fejl kastes videre |
| **N4** | 25 vedvarende fejl kunne udsulte nummer 26 | Tilbagetrækning med loft, og **færrest forsøg først** i udvælgelsen |

### K1, K2, K6, K7 — fundet i rettelserne selv

| # | Fund | Målt |
|---|---|---|
| **K1** | Skylden blev **sat** på `opsagtAf ‖ cancel_at_period_end` og **indfriet** på `opsagtAf ‖ fornyelse_stoppet_at`. Sætterens mængde var en ægte overmængde | 0 `release`, skyld ryddet, plan stadig `active` og bundet. N2's sluttilstand, nået gennem køen der skulle fjerne den |
| **K2** | `stopForkertFornyelse` skrev sin beslutning **efter** try-blokken, så catch-grenens skyld pegede på et tomt felt | 0 `release`, 0 `update`, skyld ryddet, fornyelsen ikke stoppet |
| **K6** | Dødsvagten læste **vores spejl**, ikke Stripes svar. Gik `subscription.deleted` tabt, blev skylden forsøgt igen for evigt | tre kørsler, tre fejl, `afstemning_forsoeg` 1-2-3, ingen ende |
| **K7** | Rækken læses én gang; et tryk mellem læsning og rydning tabte opsigelsen | `opsagt_af_kunde_at` sat, `cancel_at_period_end` false, skyld ryddet — usynlig for enhver kø |

K1 og K2 er **den samme fejlform som N1-N4 selv**, og de er værd at
holde fast i: begge udtryk var rigtige hver for sig, og der var ingen
forkert linje at pege på. Prædikatet beregnes nu ét sted,
`skalFornyelsenStoppes`, med SQL-siden `INGEN_BESLUTNING` ved siden af
og en prøve, der holder de to op mod hinanden på alle otte
kombinationer.

**K2's første rettelse var værre end fejlen.** Beslutningen blev
skrevet øverst i funktionen — men `plan_er_rigtig`-grenen griber netop
IKKE ind, og så bar et abonnement, der intet fejlede, vores beslutning
om at stoppe det, med en blivende advarsel i driftsrapporten. Runde 3's
prøve 10 fangede det. Beslutningen skrives nu dér, hvor den **tages**:
efter planen er undersøgt og fundet forkert.

### En prøve, der ikke kunne blive rød

Kapløbsprøvens §E hed «og der blev sluppet ÉN gang» og tællede KALD.
Den kunne ikke fejle: `Promise.all` giver ingen interleaving af sig
selv — den første opsigelse når hele vejen gennem
`retrieve → planGaelder → release`, før den anden når sit
`planGaelder`. Målt på både PGlite og rigtig PostgreSQL, med og uden
rettelsen: «1 release, begge ok».

§E har nu en **port** på `subscriptionSchedules.retrieve`, som holder
begge kaldere, til begge har deres svar. Så har de begge et
`active`-snapshot, og de kalder begge `release` — det er ikke til at
undgå uden distribueret låsning. Assertionen måler derfor **virkning**:
præcis ét release tager effekt, ingen af de to melder fejl, og
forsøgstallet bevises at have været over ét. Uden det sidste ville
prøven igen kun måle én bestemt planlægning.

Attrappen returnerer nu `structuredClone` på **alle tre** veje ud af
`gennem()` — også afspilningen fra idempotensnøglen. Et HTTP-svar er et
øjebliksbillede, ikke en levende reference. Det gav en vagt tilbage
gratis: fjerner man tilbagelæsningen i `laegPlan`, er suiten grøn med
den gamle attrap og **8 assertions røde** med kopierne.

### Den fjerde skriver af `cancel_at_period_end`

`spejl()` er den tredje skriver af kolonnen, og den kan skrive
**false**. Vagten dér spurgte kun kundens beslutning — men vores eget
sikkerhedsstop skriver samme kolonne **uden** at sætte
`opsagt_af_kunde_at`. På sådan en række var der altså ingen vagt
overhovedet: en forsinket hændelse, dannet før stoppet, ryddede flaget,
mens Stripe stadig sagde `true`, og hverken opsigelseskøen eller
fornyelsesvagten tog rækken op.

Vagten spørger nu den **seneste af de to beslutninger**. To forløb, to
forskellige rigtige svar:

* hændelsen er **ældre** end beslutningen → den ved intet om den, og
  der skrives ikke.
* hændelsen er **nyere** → den er et ægte svar, flaget ryddes, og der
  sættes en **skyld**, så afstemningen genopretter.

**Regressionen for den kunne først ikke blive rød.** Første udgave
målte kun egenskaben — «base og Stripe er enige, ELLER der står en
skyld» — og den egenskab overlever, at vagten fjernes: så skriver
spejlingen `false`, den anden vagt sætter skylden, og afstemningen
retter det. Udfaldet er rigtigt, og prøven beviste ingenting. Målt ved
at rulle vagten tilbage: prøven blev grøn.

Den pinner nu selve vagten: en ældre hændelse skal skrive **slet
ikke** — ikke skrive forkert og blive repareret bagefter. Forskellen
er en Stripe-tur og et vindue, hvor basen er forkert.

**Og den var stadig grøn anden gang**, af en anden grund: tidspunktet
lå så langt tilbage, at den almindelige rækkefølgevagt forkastede
hændelsen, før beslutningsvagten blev spurgt. Prøven målte en anden
vagt, end den sagde. Hændelsen ligger nu mellem rækkens
`stripe_opdateret_at` og beslutningen, og tidspunkterne er begrundet i
koden.

Begge gange var det modprøven, der fandt det. Det er dét, den er til:
en regression, der ikke kan blive rød, ligner en, der dækker noget.

### To tal og to lister, der sagde det samme to steder

Fundet i gennemlæsningen af mine egne rettelser, efter de fire K-fund:

**Tilsynslinjens sidste tal måles før runden.** Den sagde «N venter på
tilbagetrækning», som en operatør ville læse som «nu» — men de rækker,
runden selv skubber bagud, er ikke med. Den siger nu «var i
tilbagetrækning ved kørslens start», og definitionen står både ved
tallet og i betjeningsvejledningen. Målte vi bagefter, ville tallet
altid være mindst så stort som `kunne ikke endnu`, og de to ville sige
det samme.

**`TERMINALE` og `DOEDE` var to identiske lister** — samme tre
statusser, samme spørgsmål, hver sin fil. Kommentaren ved den ene
påstod oven i købet, at de var delt; det var de ikke, den var
kopieret. Dødsvagten (K6) gjorde den ene bærende et nyt sted, og så er
den samlet ét sted. Samme regel og samme tegn som prædikatet ovenfor:
et udtryk, der findes to steder og ikke kan afledes af sig selv.

### To fejl, rettelserne selv lavede

Fundet ved at vende modlæsningen mod runde 5's egen kode, og målt før
de blev rettet:

**Hastværket vendte om.** «Færrest forsøg først» — rettelsen for N4 —
straffer den række, køen lige har prioriteret rigtigt. Fristen er anden
nøgle, så den mest presserende vælges først; fejler kørslen, forlader
hun `forsoeg = 0`-laget, hvor alle uprøvede står. Målt: hundrede
opsigelser under en Stripe-nedetid, én med fornyelse om 40 minutter —
**nul** kald i den kørsel, hvor Stripe virkede, og nået fire timer
senere. Fristloftet redder hende ikke: det bestemmer hvornår en række
bliver **klar**, aldrig hvilken **rang** den får.

Rettet med en hasteklasse før forsøgstallet, smal i begge ender (to
timer frem, én tilbage), så hasteklassen ikke selv bliver en
udsultning.

**Et dødt abonnement lovede en automatik, der ikke fandtes.**
Dødsvagten rydder skylden, når Stripe siger abonnementet er lukket —
rigtigt for køen. Men siden blev stående og sagde *«Opsigelse
undervejs … der kan blive trukket som normalt. Vi prøver automatisk
igen»*, mens køen var tom. Begge sætninger usande, knappen permanent.

Det er N1's fejl spejlvendt — for lidt lovet i stedet for for meget —
og svaret er det samme: udsagnet skal hvile på den bekræftede
sluttilstand. Et dødt abonnement ER en bekræftet sluttilstand.

Begge har nu en regression og en modprøve.

**Tre af denne rundes prøver kunne først ikke blive røde**, og formen
var den samme hver gang: opstillingen var ikke skarp nok, så prøven
målte noget andet, end den sagde. Én målte kun udfaldet, som en anden
vagt reparerede. Én havde et tidsstempel så gammelt, at en anden vagt
afviste hændelsen, før den under prøve blev spurgt. Én havde for få
konkurrenter, så rækken slap igennem alligevel.

Alle tre blev fanget af modprøven, ingen af gennemlæsningen. Tallene og
tidspunkterne er nu begrundet i koden, så den næste, der flytter dem,
kan se hvad de bærer.

### Modprøven

Hver rettelse er rullet tilbage for sig i en separat kopi, og netop dens
regression **skal** blive rød. Alle otte:

| rullet tilbage |
|---|
| N1 · «afventer» fjernet |
| N2 · blind rydning genindført |
| N3 · genlæsning fjernet |
| N4 · «færrest forsøg først» fjernet |
| K1 · det spejlede flag ude af prædikatet |
| K2 · beslutningen skrevet til sidst |
| K6 · dødsvagten læser kun vores spejl |
| K7 · ubetinget rydning |
| M5 · spejlingens vagt spørger kun kundens beslutning |
| HAST · hasteklassen fjernet fra sorteringen |
| DOED · et dødt abonnement tæller ikke som bekræftet |

**Alle elleve blev røde.** Hvor mange assertions hver af dem væltede står
i `logs/06-modproeve.log` — og kun dér. Et tal skrevet af i hånden i en
rapport holder til næste gang nogen rører prøven.

En regression, der ikke kan fejle, måler ingenting. Det er derfor
modprøven findes, og derfor §E blev skrevet om.

### Migrationen

`0028_afstemning_skyld` er prøvet **to veje** mod rigtig PostgreSQL:
bygget fra bunden (29 migrationer i journalens rækkefølge), og
opgraderet fra 0027 med rækker i basen, så backfill'en havde noget at
ramme. De otte skemasnit er identiske — kolonner 209, begrænsninger 47,
indekser 57, RLS 18, enums 42, alle med samme sha256.

Tre snit er tomme, og det er **med vilje**: `rettigheder` = 0 er selve
kravet fra CLAUDE.md, politikkerne ligger i `storage` og ikke i
`public`, og vi definerer ingen funktioner i `public`. En sammenligning
af to tomme baser beviser intet, så prøven fejler nu, hvis et af de fem
substantielle snit er tomt.

Backfill'en er aflæst: af tre rækker fik **kun** den besluttede,
ubekræftede opsigelse en skyld.

### Hvad der IKKE er verificeret

| Lag | Status |
|---|---|
| Kodeforløb | gennemgangens egen probe, vendt om: alle fire fund væk, exit 0 |
| PGlite | `test-betaling-runde5.ts` gennem `sigOpFor`, `abonnementForBruger`, `laegPlan` og `betalingstilsyn`. Antallet af assertions står i loggen, ikke her — et tal skrevet af i hånden holder ikke |
| Rigtig PostgreSQL | §E med port, plus to nye kapløb (E2, E3) |
| Migration | to veje mod rigtig PostgreSQL, otte snit sammenlignet |
| **Stripe-sandbox** | **UAFPRØVET.** `api.stripe.com` er spærret i miljøet |

**Attrappen er ikke Stripe.** Den håndhæver Stripes dokumenterede regel
om, at `release` kun virker på `not_started`/`active`, og at en frigivet
plan slipper sit abonnement — læst af SDK'ens egne typer
(`SubscriptionSchedules.d.ts:39`, `:104-116`, `:267`). Men **om Stripe
accepterer netop det `create`-forløb, N2c modellerer, og hvad det gør
ved en igangværende opsigelse, er ikke målt.** Det kræver sandbox, og
gennemgangens egen instruks er læst som den står: fundet afvises ikke
på en uafprøvet antagelse om Stripe. Intet her siger noget om, hvorvidt
en opkrævning ville ske eller udeblive.

## Sjette gennemgang: atomisk beslutning, kvittering kun på set arbejde

To fund, begge reproduceret før rettelse — af gennemgangen med dens egen
probe, og af mig selv gennem de faktiske indgange mod PGlite.

**Grundlaget er efterprøvet mod Git,** hvilket gennemgangen udtrykkeligt
ikke havde gjort: pakkens 37 kildefiler er byte-identiske med `aca19df`,
og dens `input_zip_sha256` er identisk med den ZIP, jeg afleverede.

### M1 · En gemt beslutning kunne mangle sin vej til udførelse

`noterOpsigelse()` lavede TO selvstændige skrivninger: kundens
beslutning, og derefter `skyldAfstemning()`. En enkelt databasefejl i den
anden var nok.

Målt: beslutningen gemt, ingen skyld, **tre tilsynskørsler med nul
Stripe-kald og tom logliste**, `cancel_at_period_end` aldrig sat hos
Stripe — mens «Mit abonnement» sagde *«Opsigelse undervejs … Vi prøver
automatisk igen»* om en kø, der var tom. Oven i det afviste `sigOpFor()`
sit promise, så kunden mødte en ubehandlet fejl frem for en besked.

Rettelsen er **ét `update`**. Ét statement er atomisk i PostgreSQL, så
de to felter ikke kan skilles ad — og der er ingen transaktion, og
dermed heller ingen transaktion, der holdes åben over et netværkskald.
`coalesce` på beslutningen gør det, `isNull`-vagten gjorde: det første
tidspunkt vinder. `sigOpFor()` svarer nu `afventer` i stedet for at kaste.

**Fristelsen, der blev modstået:** køen kunne have fået et
reserveprædikat — «besluttet, men ikke bekræftet». Det ville være to
udtryk for samme spørgsmål, og det er netop den fejlform, hele runde 5
handlede om. Ét sted, og det er skylden. De rækker, der allerede måtte
stå forældreløse, samles op af 0029's backfill.

### M2 · En gammel kvittering kunne slette nyere køarbejde

K7 beskyttede rydningen i grenen UDEN en stopbeslutning. Grenen, der
GENNEMFØRER en opsigelse, ryddede fortsat ubetinget — og mellem den
afsluttende Stripe-læsning og skrivningen hjem ligger en netværkstur.

Målt: et forsinket `create` vender tilbage, `laegPlan` opdager
opsigelsen og registrerer korrekt ny skyld — og den gamle kvittering
sletter den. Plan `active` hos Stripe, skyld null, binding null, tre
tilsynskørsler med nul kald. Tavs og blivende.

**Tidsstemplet duer ikke som markør, og det er målt:**
`coalesce(afstemning_skyldig_at, now())` bevarer med vilje det gamle
tidspunkt, så to registreringer får præcis samme værdi.

Derfor `afstemning_gen` (0029), en tæller der stiger ved hver
registrering. Afstemningen læser den ved start og kvitterer kun, hvis den
står uændret. Planbindingen ryddes kun, hvis den stadig peger på den
plan, vi undersøgte. Samme vagt på alle fire kvitteringssteder.

Er generationen steget, er det ikke en fejl: vores arbejde ER gjort, og
kunden får sit ja. Men vi har ikke set det nye, så vi siger ikke, det er
gjort.

### Kapløbet måles, hvor det kan måles

Gennemgangen siger det selv om sin egen probe: ingen transaktions­-
isolering, ingen modellering af PostgreSQL. Derfor ligger M2's egentlige
egenskab i `test-betaling-kaploeb.ts` **§E4** mod rigtig, isoleret
PostgreSQL, med en port på den afsluttende læsning og en anden
forbindelse, der registrerer arbejde i vinduet.

**§E4 er modprøvet:** rulles generationsvagten tilbage, bliver den rød
(`skyldig=null`) på rigtig PostgreSQL.

### Tre fund i rettelserne selv

Modlæsning af runde 6's egen kode fandt tre defekter, alle målt før de
blev rettet:

**S1 · Et miss var usynligt.** `ryd()` returnerede `void`, så en
kvittering, generationsvagten afviste, forsvandt sporløst: udfaldet blev
`afstemt`, og tilsynet skrev «1 skyldige · 1 taget · 1 afstemt · 0 kunne
ikke endnu» om en række, der stadig var skyldig. Det er CLAUDE.md's egen
regel — *en manglende oplysning skal være synlig, ikke fraværende* —
vendt indad mod vores eget tilsyn. `ryd()` svarer nu, om den ramte,
udfaldet `nyt_arbejde` findes, og tilsynslinjen tæller det.

**S2 · De to vagter kunne komme i utakt.** Bindingsvagten og
generationsvagten stod på hver sin skrivning. Med en forældet lokal
binding missede den ene, mens den anden ramte — så blev skylden ryddet,
mens bindingen stod, og rækken påstod «plan konfigureret» uden
køarbejde. De er nu ÉT statement under samme vagt, og vagten tager
**begge** observerede plan-id'er: vores eget og Stripes.

Grunden til at generationen ikke kan bære bindingen alene er målt:
`laegPlan` skriver `stripe_schedule_id` straks efter sit `create` og
**før** den noterer nogen skyld. I det vindue er generationen urørt,
mens bindingen er ny.

**S3 · `besluttetAfOs` havde M1's fejl.** Den skrev beslutningen alene;
skylden blev sat i en catch langt nede. Fejlede DEN skrivning, stod
`fornyelse_stoppet_at` uden køarbejde, og tre tilsynskørsler gjorde
intet. Nu ét statement, som `noterOpsigelse`.

Modstykket fulgte med: et indgreb, der LYKKEDES, må ikke efterlade
evigt arbejde. Kvitteringen sker nu på successvejen — betinget på den
generation, vores egen beslutning skrev, så den ikke rydder noget, en
anden har registreret imens.

### S5 · Én dårlig række slog sikringen fra for alle andre

`iFareForForkertFornyelse` er den **sidste** sikring før en forkert
fornyelse. Løkken over den lå i ét stort `try`, og
`stopForkertFornyelse` kunne kaste — selv om dens egen docstring lovede
«KASTER IKKE».

Målt: fejler den første rækkes skyld-skrivning, får de øvrige **nul**
forsøg, og loggen siger kun «fornyelsesbeskyttelsen fejlede». To
abonnementer på vej mod en forkert fornyelse blev tavst sprunget over.

To rettelser, fordi der er to fejl:

* `stopForkertFornyelse` holder nu sit løfte — catch-grenens egen
  skrivning er selv vagtet.
* Løkken bærer fejlen **pr. række**. Den dårlige får sin egen ⚠⚠-linje
  med sit eget abonnements-id; de øvrige bliver forsøgt.

**De to rettelser er redundante med vilje**, og modprøven måtte lære
det: ruller man kun den ene tilbage, bliver prøven grøn — hver halvdel
holder egenskaben alene. Modprøven ruller derfor begge, og så bliver
den rød med 0 af 2. Redundansen er ikke tilfældig: den ene beskytter
mod den fejl vi kender, den anden mod dem vi ikke har set endnu.

Det er samme familie som N4's udsultning: noget, der stille undlader at
ske for alle på nær den første.

### To eksisterende kapløbsprøver beviser ikke, hvad de siger

Målt under denne runde, og de er ældre end den:

**§A i `test-betaling-kaploeb.ts` beviser ikke entydighedsindekset.**
Med BEGGE indeks droppet er §A grøn i **4 af 5 kørsler**. Årsagen er
§E's oprindelige fejl: `Promise.all` giver ingen interleaving af sig
selv, og §A har ingen port mellem eksistenskontrollen og indsættelsen.

Filens hoved påstod, at indekset bevises dér. **Den påstand er
rettet** — ikke prøven. En port ville kræve et sømt sted inde i
`startKoebFor` mellem dens SELECT og dens INSERT, og det er uden for
denne rundes omfang. Indtil det er bygget, er indekset ubevist af den
prøve, og nu står der det.

**§D har samme svaghed:** flyttes monotonien i `adgang_til` fra SQL til
JS, forbliver den grøn.

### Hvad PGlite kan og ikke kan bevise

Målt, ikke formodet: PGlite kan ikke holde to transaktioner åbne
samtidig — der er én forbindelse. To «samtidige» skrivninger får samme
`txid_current()`, og efter en ROLLBACK svarer PGlite **forkert** dér,
hvor rigtig PostgreSQL svarer rigtigt.

Det betyder, at en betinget skrivning, der skal blokere på rækkelåsen
og derefter genlæse sin WHERE mod udfaldet af en anden transaktion
(READ COMMITTED / EvalPlanQual), **aldrig udøves på PGlite**. Samme
gælder `for share`/`for update` og de delvise entydighedsindeks.

M2 er derimod målt til at give samme udfald begge steder, fordi den
ikke er et kapløb mellem to transaktioner: den er ét forløbs gamle
Stripe-øjebliksbillede, der driver en ubetinget skrivning. Derfor
ligger regressionen i `npm test` **og** kapløbet i §E4.

### Rettelser til mine egne påstande

To ting, jeg skrev og målte mig frem til var forkerte:

* Jeg skrev først, at `besluttetAfOs` **ikke** var den samme fejl som
  M1, fordi den kaster videre uden at skrive. Målt: den skriver
  beslutningen, og det er catch-grenens skyld-skrivning, der kan fejle.
  Gennemgangen havde ret i at bede mig se på den. Se S3.
* En assertion om, at den forældreløse plan ender sluppet, blev fjernet
  frem for gjort grøn: den kan ikke måles, fordi attrappens `release`
  rydder `subscription.schedule` ubetinget. Det står nu som uafprøvet
  frem for som en påstand.

### Rettelse til den forrige aflevering

`SVAR.md` i `betaling-runde5-aca19df.zip` angav `52838b5` som afleveret
revision. Det var forkert — linjen blev skrevet, før commit'en blev
amendet to gange mere. Slutrevisionen er `aca19df`, hvilket patch-serien
og loggene i samme pakke angiver korrekt. Gennemgangen har ret, og det
kræver ingen omskrivning af historik.

## Det, der ikke er løst

* **RLS på `storage.objects`** er stadig den eneste håndhævelse af
  mappegrænsen mellem udlejere, og der findes ingen prøve for den. Den
  kan ikke skrives mod PGlite: `auth.uid()` er en stub, der giver null.
  Se CLAUDE.md, «RLS er ikke dækket. Noget andet er værre».
* **Betalingsmuren er ikke slået til**, og der er ikke oprettet priser
  hos Stripe. GRATIS er den tilsigtede lanceringstilstand.
