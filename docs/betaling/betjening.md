# Sådan skifter ejeren driftstilstand

To tilstande. **GRATIS er lanceringstilstanden.**

| | GRATIS | BETALING |
|---|---|---|
| Kontaktoplysninger | åbne | kræver abonnement |
| Kildelink (`/go/[id]`) | åbent | kræver abonnement |
| Søgeresultater, beskrivelser, billeder | offentlige | offentlige |
| Betalingsbokse og køb | findes ikke | vises |

Ingen ny deployment. Ingen kodeændring.

## Vej 1 — i appen (normalvejen)

1. Log ind på en konto med `users.role = 'admin'`.
2. Gå til **`/admin/drift`**.
3. «Slå muren TIL» / «Slå muren FRA».

Er du ikke admin, svarer siden «Ikke fundet» — den røber ikke, at der
findes et adminområde.

**Sådan bliver en konto admin** (én gang, i Supabases SQL-editor):

```sql
update users set role = 'admin' where email = 'DIN-MAIL';
```

## Vej 2 — Supabases dashboard (nødudgangen)

Hvis appen ikke kan nås:

```sql
update drift set tilstand = 'betaling', aendret_at = now(),
                 note = 'nødskift fra dashboard';
```

Tilstanden virker **med det samme** — der er ingen cache.

> **Vej 2 omgår vagten nedenfor.** Skifter du til `gratis` i dashboardet,
> mens nogen har et løbende abonnement, bliver de ved med at blive
> trukket. Tjek først:
> ```sql
> select count(*) from subscriptions
> where status in ('trialing','active','past_due','incomplete','paused','unpaid');
> ```

## Hvorfor et skift til GRATIS kan blive afvist

Muren og Stripes opkrævninger er to forskellige ting. Er der løbende
abonnementer, afviser `/admin/drift` skiftet og siger hvor mange. Ellers
ville vi enten trække 349 kr. hver 28. dag for noget, alle andre får
gratis — eller opsige fremmede mennesker automatisk, hvilket er en
beslutning om deres penge, ingen har bedt om.

Tag stilling til hver enkelt i Stripe først (opsig — adgangen løber
perioden ud), og skift så.

### …og hvorfor det kan blive afvist en anden gang

Der er **to** afvisninger, ikke én:

| Fejl | Betyder |
|---|---|
| `levende_abonnementer` | nogen betaler lige nu — tag stilling i Stripe |
| `aabne_koeb` | en påbegyndt betaling kunne **ikke lukkes hos Stripe** |
| `gennemfoerte_koeb` | en betaling er **gennemført**, men ikke afstemt endnu |

`gennemfoerte_koeb` er ikke det samme som `aabne_koeb`, og svaret er
et andet. En **åben** betalingsside kan stadig betales; den skal lukkes.
En **gennemført** er der sandsynligvis betalt for — den skal afstemmes,
ikke lukkes. Timekørslens betalingstilsyn gør det selv inden for en
time; bliver den stående, så slå abonnementet op i Stripe og tag
stilling til det, som du ville til ethvert andet løbende abonnement.

#### Den ene gennemførte betaling, tilsynet IKKE kan afstemme

Har kontoen **i forvejen et løbende abonnement**, kan det nye ikke
bogføres: det delvist unikke indeks `sub_en_levende_pr_bruger` tillader
kun ét levende pr. konto, og det er med vilje. Tilsynet kan altså ikke
afgøre forsøget, og — det er pointen — **det ændrer sig ikke af at
vente.** Næste time rammer den samme vagt. Forsøget bliver stående som
`gennemfoert` og spærrer både nye køb og gratis-skiftet, indtil et
menneske gør noget.

Tilsynets detaljelinje siger det med de ord — «kan IKKE afstemmes
automatisk … den løser sig ikke af sig selv». Læser du den linje:

1. Slå begge abonnementer op i Stripe på kundens `customer`-id.
2. Afgør hvilket der gælder. Det er kundens penge, så det er en
   beslutning, ikke en oprydning — vi opsiger aldrig selv.
3. Er det overflødige opsagt hos Stripe, kommer
   `customer.subscription.deleted`, rækken bliver `canceled`, og næste
   kørsel af tilsynet afstemmer forsøget af sig selv.
4. Skal det NYE gælde i stedet, skal den gamle række opsiges først —
   ellers rammer bogføringen det samme indeks igen.

Kort sagt: tilsynet fortæller, at det ikke kan komme videre. Det
gætter ikke om nogens abonnement.

Vi opsiger hende **aldrig** automatisk for at få skiftet igennem. Det
ville være en beslutning om et fremmed menneskes penge.

`aabne_koeb` er den nye. En kunde kan stå med betalingssiden åben i
netop det sekund; betaler hun bagefter, har hun et løbende abonnement i
gratis tilstand. Derfor lukkes sessionerne **hos Stripe**, før
tilstanden skrives — og svarer Stripe ikke, skiftes der ikke.

**Tryk på «Slå muren FRA» igen.** Knappen er ikke deaktiveret, selv om
der allerede står GRATIS: står der åbne påbegyndte betalinger, er
knappen afstemningen af dem. Siden viser tallet. Kun en lukning, Stripe
har bekræftet, bogføres som lukket — hverken en netværksfejl eller en
manglende Stripe-opsætning tæller.

**En reservation uden betalingsside blokerer højst 35 minutter.** Ser
skiftet en reservation, hvor sessionen endnu ikke er oprettet, er det
ikke bevis for, at intet sker — et kald til Stripe kan være i luften
netop da. Det afvises derfor, men kun indtil reservationen udløber:
sessionens `expires_at` er det **samme tal** som reservationens
`udloeber_at`, så når det er passeret, kan en session, der måtte være
oprettet, heller ikke betales. Derefter går skiftet igennem af sig selv.

**En efterladt session tæller med — også når rækken er lukket.**
Blev en reservation lukket, mens Stripe-kaldet var i luften, forsøger vi
at udløbe sessionen med det samme. Lykkes det ikke, står der en
**betalbar session, som vores egen række har lukket** — rækkens status
siger «afgjort», Stripe siger «open». De to svarer på hvert sit
spørgsmål, og her står de forskelligt.

Sådan en række tælles derfor med i «påbegyndte betalinger, der ikke er
afgjort», og den spærrer skiftet, selv om dens status er `udloebet`
eller `afbrudt`. Den opløses af sig selv, så snart Stripe svarer på
`expire` — tryk «Slå muren FRA» igen, eller vent på timekørslen. Kun
rækkens `stripe_status` og `lukke_fejl` skrives; selve `status` røres
aldrig, netop fordi kontoen i mellemtiden kan have en ny reservation.

Siger Stripe derimod, at sessionen er **gennemført**, skrives der intet.
Så er der sandsynligvis betalt på en session, vores række har lukket, og
det er en beslutning, ikke en oprydning: slå abonnementet op i Stripe.

## Når en opsigelse ikke er nået helt igennem

Tilsynet skriver en linje som

    [betaling] afstemning: 2 skyldige · 2 taget · 1 afstemt · 1 kunne ikke endnu (0 var i tilbagetrækning ved kørslens start)

De fem tal svarer på hver sit spørgsmål, og de er bevidst ikke udledt
af hinanden:

| tal | betyder |
|---|---|
| `skyldige` | hvor mange rækker har udestående arbejde **i alt** |
| `taget` | hvor mange rækker kørslen FORSØGTE (se nedenfor — kan overstige 25) |
| `afstemt` | hvor mange blev færdige |
| `kunne ikke endnu` | hvor mange fejlede og prøves igen |
| `fik nyt arbejde undervejs` | vores arbejde lykkedes, men der kom mere, mens vi var i luften |
| `var i tilbagetrækning ved kørslens start` | hvor mange var skyldige uden at være forfaldne, **da runden begyndte** |

`skyldige` tælles med sin egen forespørgsel, ikke som længden af den
afkortede liste. Ellers ville 26 skyldige med en grænse på 25 stå som
«25 skyldige · 0 taget», og det ligner «ingenting at lave».

**`taget` kan være større end 25, og det er meningen.** Grænsen gælder
de rækker, kørslen faktisk FLYTTER. En række, kørslen ikke fik flyttet —
fordi bogføringen af forsøget ikke kunne skrives — bruger ikke en plads;
kørslen henter lige så mange nye i stedet, uden dem den allerede har
forsøgt. Uden det blev de samme 25 valgt time efter time, og kunde nr.
26 fik aldrig et forsøg. Se «Når køen ikke kommer videre» nedenfor.

**Det sidste tal er målt FØR runden**, og det står der derfor. De
rækker, runden selv skubber bagud, er ikke med — så et «0» betyder
ikke, at ingen er i tilbagetrækning nu. Målte vi bagefter, ville tallet
altid være mindst så stort som `kunne ikke endnu`, og de to ville sige
det samme.

### Hvorfor der er en generationstæller

**«Fik nyt arbejde undervejs» er ikke en fejl.** Kørslen gjorde sit
arbejde færdigt; imens registrerede noget andet mere, og det har den
ikke set. Rækken bliver i køen, og næste kørsel tager den. Ser du
tallet stige kørsel efter kørsel på den SAMME række, er der derimod et
kapløb, der ikke konvergerer — så skal nogen se på det.

`afstemning_gen` stiger, hver gang nogen registrerer udestående arbejde.
Afstemningen læser den, når den begynder, og **kvitterer kun, hvis den
står uændret**. Er den steget, har en anden registreret noget imens, og
det står tilbage.

Tidsstemplet kan ikke bruges til det. `afstemning_skyldig_at` er
`coalesce`'et med vilje — en ny skyld oven i en gammel BEVARER det gamle
tidspunkt, så to generationer får præcis samme værdi.

**Det betyder for dig:** ser du en række, hvor skylden står, og
`afstemning_fejl` alligevel ser ud som om alt gik godt, så er det
formentlig det her: en kørsel gjorde sit arbejde færdigt, og en anden nåede
at registrere nyt i vinduet. Næste kørsel tager det. Det er ikke en fejl,
og der skal ikke gøres noget.

**Ryd aldrig `afstemning_gen` i hånden.** Sætter du den ned, kan en
igangværende kørsel kvittere arbejde, den ikke har udført — præcis det,
tælleren findes for at forhindre.

### Når køen ikke kommer videre

To linjer handler om kørslens egen kapacitet:

    loftet på 100 forsøgte rækker er nået — 42 klare rækker blev ikke forsøgt. …
    kunne ikke hente flere rækker: <fejl> — resten tages næste kørsel

**Den første** betyder, at kørslen brugte hele sit loft på rækker, den
ikke kunne flytte. Loftet er `25 × 4`: kørslen må hente en ny portion,
når den forrige indeholdt rækker, den ikke fik bogført, men højst fire
portioner i alt. Uden loftet kunne en base, hvor hver eneste rækkes
skrivninger fejler, holde kørslen inde for evigt.

**Det betyder for dig:** står linjen én gang, tager næste kørsel resten.
Står den kørsel efter kørsel, kan skrivningerne til de forreste rækker
ikke gennemføres — og så er det basen, ikke Stripe, der er noget galt
med. `afstemning_forsoeg` bliver stående på sin gamle værdi netop for de
rækker, det gælder; det er kendetegnet.

**Der er en rest, og den skal stå her:** er der flere end `25 × 4`
rækker, hvis bogføring ikke kan skrives, når kørslen stadig ikke forbi
dem. Loftet er et krav — en ubundet løkke må ikke kunne løbe — og
linjen er der, så tilstanden ikke er tavs. Tallet i linjen siger, hvor
mange klare rækker der blev tilbage.

**Den anden linje** betyder, at kørslen ikke kunne hente sin næste
portion. Den rapporterer så det, den nåede, i stedet for at kaste hele
regnskabet væk — de rækker, der ER afstemt, står stadig i rapporten.

### Når selve afstemningen kaster

To linjer kommer kun, når noget andet end Stripe gik galt:

    sub_xxx: afstemningen kastede — <fejltekst>
    sub_xxx: kunne ikke afstemmes, og fejlteksten kunne ikke læses

Den første betyder, at `afstemAbonnement` selv røg på en fejl — typisk
en databasefejl, mens den skulle bogføre Stripes svar. Den anden
betyder, at afstemningen gik galt **og** at opslaget, der skulle hente
fejlteksten, også gik galt.

**Begge dele koster netop den ene række.** Køen fortsætter, de øvrige
rækker afstemmes, og den ramte række beholder sin skyld og tages igen
næste kørsel. Sådan var det ikke før: løkken stod af på den første
række, der kastede, og resten af køen fik intet forsøg — tavst.

**Det betyder for dig:** ser du linjen én gang, er der ikke noget at
gøre; næste kørsel tager rækken. Kommer den kørsel efter kørsel på den
samme række, er det ikke Stripe, der er nede — så er det vores egen
base eller den række, der er noget galt med. `afstemning_forsoeg`
stiger ikke nødvendigvis, netop fordi den skrivning er den, der
fejler, så tæl linjerne i loggen i stedet.

### «planen ligger rigtigt hos Stripe»

    [betaling] sub_xxx: planen ligger rigtigt hos Stripe — det var vores
    egen tilbagelæsning, der manglede. Fornyelsen er IKKE stoppet, og
    planen er nu bekræftet.

Linjen betyder, at sikkerhedsstoppet undersøgte abonnementet, fandt en
gyldig plan hos Stripe og lod kunden være. Den er ikke en fejl; den er
dokumentationen for, at vi IKKE greb ind.

**Hvorfor den er blevet hyppigere:** sikkerhedsstoppet og
planlægningen dømmer nu vores eget `stripe_schedule_id` med
`planGaelder`, og duer den ikke, spørger de Stripe, hvilken plan der
faktisk styrer abonnementet. Var vores binding forældet — plan A
frigivet, mens Stripe kørte videre med en korrekt plan B — undersøgte
vi før den forkerte plan og stoppede fornyelsen på et abonnement, der
ikke fejlede noget.

**Stripe spørges ikke, når vores egen binding holder.** En plan, der
selv siger, at den styrer abonnementet, er svar nok — og så koster den
sunde vej det samme som før. Det er med vilje: gjorde vi kildens svar
nødvendigt for at stå ned, ville en nedetid på netop dét opslag give
⚠⚠-alarmer om abonnementer, der ikke fejler noget.

**Det betyder for dig:** ser du linjen, er bindingen samtidig blevet
rettet til den plan, Stripe faktisk bruger. Er der noget at se efter,
er det, hvorfor vores bogføring kom bagud — ikke abonnementet.

### «planen skiftede, mens den blev kontrolleret»

    [betaling] sub_xxx: planen skiftede, mens den blev kontrolleret —
    vores svar gjaldt den forrige plan og er IKKE bogført. Fornyelsen er
    hverken stoppet eller bekræftet; rækken tages op igen i næste kørsel.

Linjen betyder, at sikkerhedsstoppet nåede at kontrollere én plan, og at
rækken imens kom til at pege på en anden. Godkendelsen gjaldt den
forrige plan, så den er ikke skrevet.

**Det er hverken en fejl eller en bekræftelse.** Der er ikke grebet ind,
og der er ikke bogført noget om den nye plan. Rækken står som
ikke-konfigureret og bliver taget op igen.

**Det betyder for dig:** ser du linjen én gang, klarer næste kørsel det.
Kommer den kørsel efter kørsel på den samme række, skifter noget planen
hurtigere, end vi kan bekræfte den — og så skal nogen se efter, hvem der
skriver `stripe_schedule_id`. `plan_fejl` på rækken siger hvilken plan
kontrollen gjaldt, og hvilken rækken peger på nu.

**Den samme regel gælder planlægningen.** `laegPlan` svarer `oprettet` i
stedet for `konfigureret`, når rækken er kommet til at pege på en anden
plan end den, funktionen læste tilbage. Den svarer **ikke** `opsagt` —
et planskift er ikke en kundebeslutning, og der registreres ikke
afstemningsarbejde på den påstand.

**Hvorfor det betyder noget:** `konfigureret` udelukker en række fra
både `laegPlan`, `stopForkertFornyelse` og fare-listen. En godkendelse,
der gjaldt en anden plan, gør derfor rækken usynlig — og den plan, der
faktisk styrer abonnementet, bliver aldrig konfigureret.

### Når en kunde siger, at opsigelsen ikke blev gemt

Har hun set beskeden

> *Vi kunne ikke få bekræftet, om din opsigelse blev gemt. Genindlæs
> siden om lidt og se under «Status»: står der, at abonnementet er
> opsagt eller undervejs, er den registreret. Står der ikke noget, så
> prøv igen — eller skriv til info@bofinda.dk.*

så ved **vi** det heller ikke. Skrivningen fejlede, og rækken kunne
ikke læses tilbage bagefter. Slå abonnementet op og se på de tre felter
i tabellen nedenfor:

- står `opsagt_af_kunde_at` og `afstemning_skyldig_at` begge, er
  opsigelsen registreret, og tilsynet fuldfører den. Sig det til hende.
- står ingen af dem, er der ikke sket noget. Hun skal trykke igen.
- står kun den ene, er det en tilstand, der ikke kan opstå af den
  normale vej — de skrives i ét statement. Notér rækken og se efter,
  om nogen har rettet i basen i hånden.

Beskeden **«Vi kunne ikke gemme din opsigelse lige nu, og der er IKKE
sket noget med dit abonnement»** er noget andet: dér har vi målt, at
rækken er urørt. Hun skal trykke igen, og der er ikke en kø, der
arbejder videre.

### Tre ting, der ikke er det samme

Rækken bærer **tre adskilte kendsgerninger**, og hele afsnittet her
handler om ikke at blande dem:

| felt | er |
|---|---|
| `opsagt_af_kunde_at` | **hun har bedt om det.** Hendes beslutning |
| `fornyelse_stoppet_at` | **vi har besluttet det.** Sikkerhedsstoppet |
| `cancel_at_period_end` | **Stripe har bekræftet det.** Et spejl af deres felt |
| `afstemning_skyldig_at` | **der er arbejde tilbage.** Sættes af alle tre veje |
| `afstemning_gen` | **hvilken generation af arbejde.** Stiger ved hver registrering |

En **skyldig** række er en, hvor der står arbejde tilbage — ikke en,
hvor et bestemt flag har en bestemt værdi. Det var netop den udledning,
der var fejlen: køen spurgte «besluttet, men `cancel_at_period_end` er
false», og en række, hvor opsigelsen var bekræftet, mens en **plan**
stod uafklaret hos Stripe, blev derfor aldrig valgt. Den aktive plan
var usynlig for hver eneste kø i modulet.

**Der skal som regel ikke gøres noget.** Beslutningen skrives, før de
eksterne kald, og afstemningen gør den færdig i næste kørsel: den
læser Stripes egen tilstand, slipper planen hvis den stadig gælder,
sætter `cancel_at_period_end`, **læser sluttilstanden tilbage** og
rydder først bindingen derefter.

**Kunden ser, hvad der faktisk er sket.** «Mit abonnement» siger
«Opsigelse undervejs», så længe Stripe ikke har bekræftet — ikke
«fornyes ikke». Knappen bliver stående og hedder «Prøv opsigelsen
igen», og der står, at vi prøver automatisk. Hun kan trykke igen uden
at det gør skade.

Det er en ændring fra før, og den er med vilje: siden sagde «fornyes
ikke», så snart beslutningen stod i basen. Det var et løfte om hendes
penge, vi ikke havde dækning for — og taber hun den næste opkrævning
på, at Stripe aldrig fik beskeden, er «vi skrev det i vores egen base»
ikke et svar.

Bliver den samme række ved at stå i «kunne ikke endnu» time efter time,
er det Stripe, der ikke svarer på netop det abonnement.
`afstemning_fejl` på rækken siger hvad der gik galt, og
`afstemning_forsoeg` hvor mange gange. Slå abonnementet op i Stripe og
sæt `cancel_at_period_end` i hånden; afstemningen holder så op af sig
selv, fordi den læser Stripes svar og ser, at sluttilstanden er nået.

**Køen giver aldrig op, og den udsulter ikke.** Tilbagetrækningen er
ingen ventetid på forsøg 1-2, ti minutter fra 3., og loftet er en time
— men aldrig ud over **fristen minus ti minutter**, så en fornyelse,
der er nær, altid når et forsøg mere.

Udvælgelsen sorterer på **fire** nøgler, og rækkefølgen betyder noget:

1. **hasteklassen** — en fornyelse inden for to timer frem eller én time
   tilbage kommer først. Smal i begge ender med vilje: en evigt forfalden
   række ville ellers ligge i hasteklassen for altid og udsulte resten.
2. **færrest forsøg først** — inden for hver klasse, uændret.
3. `current_period_end` — stabilt tiebreak.
4. `afstemning_skyldig_at` — stabilt tiebreak.

At sige «færrest forsøg først» alene er derfor for kort: 25 rækker, der
bliver ved at fejle, kan ikke holde nummer 26 ude **inden for samme
klasse** — men en hasteklasse-række går foran nummer 26, uanset hvor få
forsøg hun har. De to egenskaber køber ikke hinanden; det er derfor,
de står som to led og ikke som ét.

**Og køen forsøger ikke nødvendigvis alle klare rækker i én kørsel.**
Loftet er `25 × 4` = 100 forsøgte rækker, og er der flere end det,
venter resten på næste kørsel. Det er ikke en fejl, men det er heller
ikke en garanti for, at alle bliver forsøgt nu — se «Når køen ikke
kommer videre» nedenfor, hvor linjen om loftet står.

**Men kun når forsøget bliver bogført**, og det er værd at forstå.
Forsøgstallet er vores eget, og det skrives i samme sætning som
fejlteksten. Fejler DEN skrivning, står tallet på 0, næste forsøg er
stadig klar, og rækken har nøjagtig de samme sorteringsnøgler som før
— så den vinder udvælgelsen igen. Præcis dét skete: 26 opsigelser, de
25 første med brudt opslag OG brudt fejlbogføring, og kunde nr. 26 fik
nul kald, indtil nogle af de 25 faldt ud af hasteklassen fem
timekørsler senere.

Derfor bruger en række, kørslen ikke fik FLYTTET, ikke en plads; se
«Når køen ikke kommer videre» ovenfor. Færrest forsøg først er stadig
reglen — den er bare ikke nok i sig selv.

### Når vi selv har stoppet en fornyelse

Tilsynet skriver **to** linjer om vores eget sikkerhedsstop, og de
siger ikke det samme:

    [betaling] 1 abonnement(er) har stoppet fornyelse. …
    [betaling] ⚠ 1 abonnement(er) er BESLUTTET stoppet, men Stripe har ikke bekræftet det. …

Den første er en kendsgerning: Stripe har bekræftet, kunden fornyes
ikke. Den anden er en **beslutning, der ikke er nået igennem** —
abonnementet fornyes stadig. Afstemningen prøver igen hver kørsel.
Bliver den anden linje stående, skal nogen se efter i Stripe.

`fornyelse_stoppet_at` skrives nu **før** de eksterne kald, dér hvor
beslutningen faktisk tages — altså først når planen er undersøgt og
fundet forkert. Er planen rigtig, gribes der ikke ind, og der skrives
ingen beslutning. Uden ankeret kunne et fejlet indgreb ikke genoptages:
afstemningen udleder sin hensigt af netop det felt, og stod det til
sidst, var det tomt præcis på fejlvejen.

### Opskriften nedenfor skal blive ÉN sætning

Opskriften «fortryd et sikkerhedsstop» rydder `fornyelse_stoppet_at`,
`fornyelse_stoppet_grund` og `cancel_at_period_end` i **én** `update`.
Det er ikke pænhed — det er nødvendigt.

Afstemningen kører hver kørsel og genindfører `cancel_at_period_end`
for en række, der stadig bærer `fornyelse_stoppet_at`: beslutningen
står jo, og så er arbejdet ikke gjort. Deles opskriften i to sætninger,
kan en kørsel nå imellem dem og opsige kunden igen.

**Skylden skal ikke ryddes i hånden.** Når de tre felter er tomme, er
der ingen beslutning, og næste afstemning rydder `afstemning_skyldig_at`
selv. Rydder du den på forhånd, mens en beslutning stadig står, har du
bare gjort arbejdet usynligt for køen.

**Ryd aldrig `opsagt_af_kunde_at` for at få linjen væk.** Feltet er
kundens beslutning. Ryddes det, kan en forsinket hændelse skrive
opsigelsen om, og automatisk planlægning kan begynde igen på et
abonnement, hun har afmeldt.

**Et skift til BETALING opretter ingen abonnementer og opkræver ingen.**
Gratis brugere møder en betalingsboks og skal selv trykke.

## Før muren slås til første gang

1. Opret de to priser i Stripe (DKK, inkl. moms):
   - intro: **900 øre**, `recurring: { interval: 'day', interval_count: 1 }`
   - normal: **34900 øre**, `recurring: { interval: 'day', interval_count: 28 }`
2. Sæt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRIS_INTRO`,
   `STRIPE_PRIS_NORMAL`.
3. Peg Stripes webhook på `POST /api/stripe`.
4. **Kør sandbox-listen i `docs/betaling/RAPPORT.md` under «Manglende
   verifikation».** Intet Stripe-kald i dette modul er kørt mod Stripe.

Uden 1–3 virker GRATIS uændret; `startKoeb` svarer `stripe_mangler`.

## Hvis en kunde trykker «Køb» to gange

Der er **ét** åbent købsforsøg pr. konto — håndhævet af et delvist
entydighedsindeks i basen, ikke kun af kode. Møder et nyt tryk et
eksisterende, slås sessionen op hos Stripe, og der er fire udfald:

| Stripe siger | Hun får |
|---|---|
| sessionen er `open` | **samme** betalingsside igen |
| sessionen er `complete` | «Din betaling er gennemført. … Du skal ikke betale igen.» Reservationen **bevares** og spærrer et nyt køb, til afstemningen er på plads |
| sessionen er `expired` (eller en anden død status) | rækken lukkes, og der begyndes **forfra** |
| intet — opslaget fejlede | «du har et køb i gang», og rækken bliver stående |

**`complete` og `expired` er ikke det samme, og det er med vilje.** En
udløbet session kan ikke betales, og så er der intet at miste ved at
lukke rækken. En gennemført kan der være betalt på, og rækken er det
eneste, der står i vejen for, at kontoen får et køb mere oven i det.
Derfor sættes den til `gennemfoert` og bliver stående, til afstemningen
har bogført abonnementet.

**`complete` er ikke i sig selv bevis for, at der ER betalt.** Stripes
`payment_status` kan stadig være `unpaid`, og det betyder «betalingen
behandles endnu», ikke «der kom intet». Netop derfor lukker vi ikke
rækken på det: vi ved ikke nok til at kalde forsøget hverken betalt
eller dødt. Se `docs/betaling/tilstande.md` om afstemningen, som gør
det færdigt.

Det sidste udfald er med vilje forsigtigt: et opslag, der ikke kunne
laves, er ikke bevis for, at en session er ubetalbar. En reservation,
ingen færdiggør, ryddes af **tiden** — `udloeber_at`, 35 minutter —
ikke af det næste tryk.

## Timekørslens betalingstilsyn

`scripts/import.ts` kalder `betalingstilsyn()` i hver kørsel — også i
GRATIS tilstand, for et løbende abonnement skal have sin plan, uanset
hvad muren gør. Den gør to ting og skriver dem i kørselsrapporten:

```
[betaling] genbehandling: 2 taget · 1 færdige · 1 afventer · 0 fejlede · 1 ubehandlede tilbage
[betaling] planer: 1 forsøgt · 1 konfigureret · 0 opgivet efter 5 forsøg
```

* **genbehandling** — hændelser, der står med `behandlet_at = null`,
  køres om fra den gemte nyttelast. Stripes egne genforsøg holder op;
  denne gør ikke.
* **planer** — abonnementer, hvis `plan_status` ikke er
  `konfigureret`, forsøges igen.

Mangler Stripe-opsætningen i kørslen, **siger den det** i stedet for at
se ud som om der ikke var noget at gøre.

## Hvis introplanen ikke kan lægges inden døgnfornyelsen

> **Dette afsnit er ændret.** Før stod her, at en plan i `fejlet`
> krævede, at et menneske greb ind, og at abonnementet indtil da
> fornyedes til 9 kr. om dagen. Det var sandt og utilstrækkeligt: en
> advarsel er ikke en beskyttelse. **Nu griber systemet selv ind**, og
> afsnittet beskriver hvordan.

Det er det alvorligste, der kan gå galt i betalingsmodulet, og det
kræver et menneske. Læs afsnittet, før muren slås til.

**Hvad der sker.** Kunden betaler 9 kr. og får sin adgang — den del er
sikker, og en planlægningsfejl rører den aldrig. Men introprisen har
`interval: 'day', interval_count: 1`, altså **hver dag**. Overgangen til
349 kr./28 dage findes kun i den `SubscriptionSchedule`, vi lægger
bagefter. Lykkes den ikke, fornyes abonnementet hos Stripe til **9 kr.
om dagen**, indtil nogen griber ind.

**Hvor lang tid er der.** Til den første fornyelse: 24 timer fra
betalingen. Tilsynet kører hver time og prøver igen, så der er normalt
~23 forsøg inden da. Efter `PLAN_MAX_FORSOEG` (5) mislykkede forsøg
sættes `plan_status = 'fejlet'`, og de automatiske forsøg stopper.

**Hvad systemet gør af sig selv.** Når planen ikke er bekræftet, og
enten forsøgene er brugt op **eller** fornyelsen er mindre end
`STOP_FOER_FORNYELSE_MIN` (120 minutter) væk, stopper tilsynet
fornyelsen:

1. planen **slippes** (`release`) — ellers kan den skrive opsigelsen om
   ved næste faseskift, præcis som ved en almindelig opsigelse;
2. `cancel_at_period_end: true` sættes på abonnementet;
3. det skrives i basen med sin grund (`fornyelse_stoppet_at`,
   `fornyelse_stoppet_grund`) og i kørselsrapporten.

```
[betaling] ⚠ fornyelsen er STOPPET for sub_1abc…: Planen kunne ikke
bekræftes: fornyelsen er mindre end 120 minutter væk. …
Kunden beholder den betalte periode; der kommer ingen ny opkrævning.
```

**Hvorfor netop det.** Kunden beholder de 24 timer, hun betalte 9 kr.
for — `adgang_til` røres ikke. Og der kommer ingen opkrævning på
vilkår, vi ikke kan levere. Det er **ikke** en ændring af prismodellen;
det er en afvisning af at forny på en anden model end den aftalte.
Alternativet — at lade den løbe videre til 9 kr. om dagen — ville
*være* en anden model, og den har ingen bedt om.

**Udløseren er nærheden til fornyelsen**, ikke forsøgstælleren alene.
En plan, der fejler fem gange på fem minutter, har stadig 23 timer
tilbage; en, der fejler to gange lige før fornyelsen, har ikke.

**Hvad du gør.**

1. Find dem:
   ```sql
   select stripe_subscription_id, user_id, plan_status, plan_forsoeg,
          plan_fejl, adgang_til
   from subscriptions
   where plan_status is not null and plan_status <> 'konfigureret'
   order by adgang_til;
   ```
2. Læs `plan_fejl`. Er det en forbigående fejl hos Stripe, så nulstil
   tælleren, og lad tilsynet prøve igen i næste kørsel:
   ```sql
   update subscriptions set plan_forsoeg = 0, plan_status = 'mangler'
   where stripe_subscription_id = 'sub_…';
   ```
   Er fornyelsen allerede stoppet, og bliver planen lagt bagefter, så
   slå `cancel_at_period_end` fra i Stripe og ryd markeringen:
   ```sql
   update subscriptions
   set fornyelse_stoppet_at = null, fornyelse_stoppet_grund = null,
       cancel_at_period_end = false
   where stripe_subscription_id = 'sub_…';
   ```
3. Kan planen ikke lægges, så **lad være med at lade abonnementet
   fornyes på forkerte vilkår.** Sæt `cancel_at_period_end` på
   abonnementet i Stripes dashboard. Den betalte periode løber ud —
   kunden beholder det, hun har betalt for — og der kommer ingen
   9 kr.-fornyelse.
4. Skriv til kunden, og lav købet om, når planen kan lægges.

**Opsig aldrig med `cancel` i stedet for `cancel_at_period_end`.** Det
ville afslutte abonnementet med det samme og tage en periode, kunden
har betalt for. Det er samme regel som i `sigOp()`.

**Hvad du IKKE skal gøre:** lade en plan i `fejlet` stå og regne med,
at den løser sig. Det gør den ikke, og hvert døgn koster kunden 9 kr.
