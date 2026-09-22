# Tilstandene og deres relationer

Denne fil findes, fordi **seks** gennemgange i træk har fundet fejl af
**samme art**: en tilstand blev behandlet som afgjort, før den var det.
Ikke seks forskellige fejl — den samme fejl seks steder.

Femte gennemgang gjorde det skarpere: det er ikke nok at skelne
«besluttet» fra «bekræftet». Der er en **tredje** kendsgerning —
*er der arbejde tilbage?* — og den må hverken udledes af de to andre
eller deles med dem. Se I15-I18.

Læs den, før du retter noget i `lib/abonnement.ts`, `lib/webhook.ts`
eller `lib/driftskift.ts`.

## Fire enheder, fire skrivere

| Enhed | Hvor | Hvem skriver |
|---|---|---|
| **Købsforsøg** | `checkout_forsoeg` | `startKoebFor`, `lukAlleAabneKoeb`, webhooken, tilsynet |
| **Checkout-session** | hos Stripe | Stripe. Vi kan kun `create`, `retrieve` og `expire` |
| **Abonnement** | `subscriptions` | webhooken (`kassen`, `betalt`, `spejl`, `mislykkedes`), `sigOp` |
| **Driftstilstand** | `drift.tilstand` | `saetTilstand`, og nødudgangen i Supabases dashboard |

Ingen af de fire er kilden til de andre. Det er hele vanskeligheden:
de skal afstemmes, ikke udledes.

## Sessionen har TO akser, ikke én

Stripes Checkout Session bærer to felter, og de svarer på hvert sit
spørgsmål ([Sessions.d.ts:241 og :285](https://docs.stripe.com/api/checkout/sessions/object)):

```
status         : open | complete | expired
payment_status : unpaid | paid | no_payment_required
```

**`complete` betyder, at kassen blev gennemført — ikke at pengene er
modtaget, og ikke at intet abonnement opstod.** En session kan være
`complete` med `payment_status: unpaid`, mens betalingen behandles.

Den skelnen er fund 1 i tredje gennemgang: koden læste kun `status`,
så `complete` blev behandlet som «død betalingsside», og et nyt køb
blev åbnet oven i et, der netop var gennemført.

## Købsforsøgets tilstande

```
                  ┌──────────────────────────────────────┐
   startKoebFor → │ aaben                                │
                  │ kan stadig betales                   │
                  └───┬───────────┬──────────┬───────────┘
                      │           │          │
        Stripe: complete    Stripe: expired  vi expirede den
                      │        │  (eller sessionsløs   │
                      ▼        │   og udløbstid passeret)
        ┌─────────────────────┐│                       │
        │ afventer_afstemning ││                       │
        │ gennemført, men vi  ││                       │
        │ har ikke set        ││                       │
        │ abonnementet endnu  ││                       │
        └──────────┬──────────┘▼                       ▼
                   │      ┌──────────┐          ┌───────────┐
   abonnementet    │      │ udloebet │          │  afbrudt  │
   bogført lokalt  │      └──────────┘          └───────────┘
                   ▼
              ┌──────────┐
              │  betalt  │
              └──────────┘
```

`aaben` og `afventer_afstemning` er **ikke afgjorte**. Begge blokerer et
nyt køb, og begge blokerer et skift til GRATIS. `betalt`, `udloebet` og
`afbrudt` er terminale.

## De enogtyve invarianter

| # | Invariant |
|---|---|
| **I1** | Et forsøg, hvis session stadig kan have modtaget penge, tæller aldrig som lukket |
| **I2** | GRATIS skrives kun, når ingen betaling kan lande bagefter |
| **I3** | Et forsøg lukkes kun af sin **egen** betaling — aldrig af en anden med samme kunde |
| **I4** | En terminal abonnementsstatus genoplives ikke af en hændelse, der ikke er strengt nyere |
| **I5** | Ingen ubehandlet hændelse kan fortrænges permanent af andre |
| **I6** | Vi fornyer ikke på vilkår, vi ikke kan levere |
| **I8** | En modtaget betaling markeres aldrig færdig uden at være bogført |
| **I9** | Vi tager ikke en plan eller en fornyelse fra nogen på et grundlag, vi ikke kunne bekræfte |
| **I10** | En stoppet fornyelse startes kun igen af et menneske |
| **I11** | En hændelse markeres aldrig færdig, fordi dens forudsætning mangler |
| **I12** | En opsigelse er genoptagelig: beslutningen skrives før de eksterne kald |
| **I13** | En plan gælder kun, når Stripe siger, den styrer netop dette abonnement |
| **I14** | Kundens opsigelse ophæves hverken af en forsinket spejling eller af automatik |
| **I15** | En anmodning, en bekræftet sluttilstand og udestående arbejde er TRE kendsgerninger |
| **I16** | Udestående arbejde bæres af sit eget felt — det udledes aldrig af et flag |
| **I17** | «Skal fornyelsen stoppes?» beregnes ét sted, og alle sættere og betalere bruger dét |
| **I18** | Køen giver aldrig op, kan ikke udsulte, og vender ikke hastværket om |
| **I19** | Et dødt abonnement er en BEKRÆFTET sluttilstand — siden lover ikke en automatik, der ikke findes |
| **I20** | En gemt beslutning har ALTID en vej til udførelse — de to skrives i ét |
| **I21** | En kvittering dækker kun det arbejde, den har SET. Generation, ikke tidsstempel |
| **I22** | En kø behandler sine rækker hver for sig — også når bogføringen af en fejl fejler |
| **I23** | Ingen egen generation er ingen kvittering. Manglende ejerskab er ikke ejerskab |
| **I24** | «Bekræftet ikke gemt» og «ukendt udfald» er to svar. Et kast beviser ikke, at intet skete |
| **I7** | `adgang_til` flyttes kun frem. Altid. Uden undtagelse |

I7 står sidst, fordi den er den eneste, der aldrig har været brudt, og
den eneste der aldrig må blive det. Alle de andre rettelser skal kunne
laves **uden** at røre den.

**I8, I9 og I10 kom til efter modstandsgennemgangen af rettelserne
selv.** De hører sammen to og to med noget, vi allerede havde:

· **I8** er I5 vendt den anden vej. I5 siger, at en hændelse ikke må
  blive fortrængt; I8 siger, at den ikke må blive *afsluttet*, når
  arbejdet ikke blev gjort. `betalt()` kunne før få sin indsættelse
  afvist af `sub_en_levende_pr_bruger`, skrive ingenting og alligevel
  markere hændelsen færdig og slette nyttelasten. Pengene var modtaget,
  og der var ingen vej tilbage til dem.

· **I9** er «AFSTEM FØR DU OPRETTER» i `laegPlan`, gentaget for den
  modsatte handling. At oprette en plan for meget koster en oprydning.
  At slippe en plan, der var rigtig, koster kunden hendes overgang til
  normalprisen **og** en opsigelse, hun ikke har bedt om. Den dyreste
  af de to var den, der ikke afstemte.

**I11 til I14 kom til efter fjerde gennemgang**, og de hænger sammen
to og to med noget, vi allerede havde:

· **I11** er I5 ført ét skridt videre. I5 siger, at en hændelse ikke må
  fortrænges; I8, at den ikke må afsluttes, når arbejdet ikke blev
  gjort. I11 siger, at den heller ikke må afsluttes, når
  **forudsætningen ikke var der.** `spejl()` svarede `forael` både på
  «din spejling er forældet» og på «der er ingen række at spejle i» —
  to vidt forskellige ting, og den ene betyder «prøv igen senere».
  En `customer.subscription.deleted`, der ankom før sin checkout, blev
  derfor kvitteret og kasseret; bagefter stod rækken `active`, mens
  Stripe sagde `canceled`, og kontoen var låst ude med `har_allerede`.
  Stripe garanterer ingen rækkefølge.

· **I12** er «skriv skylden, før du udfører» — det samme som
  `planStatus: 'mangler'` — anvendt på opsigelsen. Uden et anker var
  der intet at genoptage fra: `release` lykkedes hos Stripe, den lokale
  skrivning fejlede, og hvert genforsøg døde på et `release` af den
  plan, Stripe allerede havde sluppet, længe før det nåede
  `cancel_at_period_end`. Kunden sad fast på et abonnement, hun havde
  sagt op.

· **I13** er I9 gjort præcis. I9 sagde «afstem, før du tager noget fra
  nogen». Men afstemningen målte kun **faserne** — og en frigivet plan
  beholder sine faser; Stripe fjerner kun dens `subscription`. Derfor
  svarede sikkerhedskontrollen «planen er rigtig» om en plan, der ikke
  styrede noget, og skrev `konfigureret` på den. En plan gælder, når
  dens status er `active` eller `not_started` **og** dens
  `subscription` er vores.

· **I14** er I10 for kunden i stedet for for systemet. I10 beskyttede
  systemets eget sikkerhedsstop mod at blive ophævet af automatikken.
  Kundens almindelige opsigelse havde ingen tilsvarende beskyttelse: en
  forsinket `subscription.updated` kunne skrive flaget tilbage til
  false, og både tilsynet og en forsinket faktura kunne sende nye
  `subscriptionSchedules.create`/`update` ind i den betalingsplan, hun
  netop havde afmeldt.

**I2 blev brudt igen, og på en ny måde.** Vagten var altid formuleret
som «ingen `aaben` række → ingen betaling kan lande». Men rækkens
`status` svarer på «må kontoen starte noget nyt?», mens sessionen hos
Stripe svarer på «kan der stadig komme penge?». De to kan stå
forskelligt: en reservation, der blev lukket under et kald i luften, er
afgjort **hos os** og stadig betalbar **hos Stripe**. Derfor er
prædikatet nu `SPAERRER_SKIFTET` — uafsluttet status ELLER en session,
vi ikke har fået bekræftet lukket — og sessions-id'et skrives FØR
kaldet, aldrig efter.

· **I10** følger af I9. Når et menneske — eller tilsynet — har stoppet
  en fornyelse, er det en beslutning. Tilsynet lagde før planen igen i
  næste time og markerede den `konfigureret`, mens basen og «Mit
  abonnement» blev ved med at sige, at der ikke bliver trukket mere. To
  kilder, der modsiger hinanden om kundens penge.

**I15 til I18 kom til efter femte gennemgang.** De fire hører sammen
om én ting: **en tilstand blev behandlet som afgjort, før den var det**
— filens egen åbningssætning, nu fjerde gang.

· **I15** er den, de andre tre står på. Rækken bærer tre kendsgerninger
  om en opsigelse, og de tre er ikke det samme spørgsmål:

  | felt | svarer på |
  |---|---|
  | `opsagt_af_kunde_at` | **hun har bedt om det** |
  | `fornyelse_stoppet_at` | **vi har besluttet det** |
  | `cancel_at_period_end` | **Stripe har bekræftet det** |
  | `afstemning_skyldig_at` | **der er arbejde tilbage** |

  Før blev de to første OR'et sammen til «opsagt», og det er kernen i
  fejlen: **et OR kan kun gøre et udsagn stærkere.** Den svageste
  oplysning — «hun trykkede» — kom ud som det stærkeste løfte —
  «der bliver ikke trukket mere». Et fejlet Stripe-kald gav
  «Opsagt / Intet — fornyes ikke» på skærmen, og knappen forsvandt, så
  hun ikke kunne prøve igen. Fejlteksten sagde oven i købet «der er
  ikke ændret noget», mens `opsagt_af_kunde_at` netop VAR skrevet.

  Nu: hendes anmodning gemmes altid, den bekræftede sluttilstand
  påstås aldrig uden Stripes svar, og skærmen siger «Opsigelse
  undervejs» med knappen stående og teksten «Prøv opsigelsen igen».

· **I16** er I12 ført videre. I12 siger, at beslutningen skrives før de
  eksterne kald, så den kan genoptages. I16 siger, at **genoptagelsen
  skal have sit eget felt.** Før hvilede den på en udledning —
  «besluttet, men `cancel_at_period_end` er false» — og den udledning
  svarer på et andet spørgsmål end det, den blev brugt til:
  `cancel_at_period_end` siger, om abonnementet fornyes, ikke om der er
  arbejde tilbage. Er opsigelsen bekræftet, mens en PLAN står uafklaret
  hos Stripe, er svaret på det første ja og på det andet nej — og
  rækken blev aldrig valgt af nogen kø. Den aktive plan var usynlig for
  hele modulet.

  I12 gælder nu også **vores eget** sikkerhedsstop, ikke kun kundens
  opsigelse. `fornyelse_stoppet_at` skrives, hvor beslutningen tages —
  efter planen er undersøgt og fundet forkert, før de eksterne kald.
  Stod det til sidst, var ankeret tomt præcis på fejlvejen, og skylden
  fra catch-grenen pegede på et felt, ingen havde skrevet.

· **I17** er CLAUDE.md's egen regel anvendt på netop dette prædikat:
  *«Svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted.»*
  «Skal fornyelsen stoppes?» stod tre steder med **tre forskellige
  mængder**: `laegPlan`s vagt spurgte `opsagtAf || cancel_at_period_end`,
  dens betingede skrivning spurgte alle tre felter, og afstemningen —
  den, der skal GØRE arbejdet — spurgte kun `opsagtAf ||
  fornyelse_stoppet_at`. Alle tre var rigtige hver for sig. Sætterens
  mængde var bare en ægte overmængde af betalerens, så en skyld sat på
  det spejlede flag alene blev ryddet med **nul** Stripe-kald, mens
  planen stod aktiv og bundet.

  Prædikatet er nu `skalFornyelsenStoppes` i `lib/opsigelse.ts`, og
  SQL-siden `INGEN_BESLUTNING` står lige under det. De to KAN ikke være
  ét udtryk — det ene skal køre i basen — så `npm test` prøver dem mod
  hinanden på **alle otte** kombinationer. En prøve, der kun tog de
  tilfælde, koden i dag frembringer, ville gå op per definition.

· **I18** er I5 for afstemningskøen. I5 siger, at ingen ubehandlet
  hændelse må kunne fortrænges permanent. Køen her havde samme fejl i
  to på hinanden følgende former, og den anden er værd at kunne
  genkende: først «de samme 25 hver gang, fordi intet ændrer
  prædikatet», og — efter en tilbagetrækning blev føjet til —
  «de samme 25 hver gang, fordi intet ændrer **rækkefølgen**».

  Rettelsen er ikke en større grænse. Den er, at **rotationen skal
  komme fra det felt, en fejl flytter.** Udvælgelsen ordner på
  `afstemning_forsoeg` stigende først; en række, der aldrig er prøvet,
  kommer altid foran en, der har fejlet. Derefter det mest presserende.
  Tilbagetrækningen giver aldrig op — loftet er en time — men lofter
  aldrig ud over **fristen minus ti minutter**, så en nær fornyelse
  altid når et forsøg mere.

  **Og rettelsen vendte hastværket om.** «Færrest forsøg først»
  kurerer udsultningen og STRAFFER derefter den række, køen lige har
  prioriteret rigtigt: fristen er anden nøgle, så den mest presserende
  vælges først — og fejler kørslen, forlader hun `forsoeg = 0`-laget,
  hvor alle uprøvede står. Målt: hundrede opsigelser under en
  Stripe-nedetid, én med fornyelse om fyrre minutter. Hun fik **nul**
  kald i den kørsel, hvor Stripe virkede, og blev nået fire timer
  senere.

  Fristloftet i `naesteAfstemning` redder hende ikke, og det er værd at
  forstå hvorfor: **loftet bestemmer HVORNÅR en række bliver klar,
  aldrig hvilken RANG den får.** Hun var klar; det var udelukkende
  sorteringen, der skar hende fra.

  Derfor en HASTEKLASSE før forsøgstallet, bevidst smal i **begge**
  ender: to timer frem, så der er tid til flere forsøg, og kun én time
  tilbage — en fornyelse, der allerede er sket, kan ikke forhindres, og
  en evigt forfalden række ville ellers ligge i hasteklassen for altid
  og udsulte resten. Inden for hver klasse gælder færrest forsøg
  uændret, så ingen af de to egenskaber køber den anden.

· **I19** er I15 anvendt på den anden ende. Dødsvagten rydder skylden,
  når Stripe selv siger, at abonnementet er lukket — rigtigt, for
  sluttilstanden ER nået. Men `opsigelseUndervejs` havde intet led om,
  hvorvidt abonnementet stadig lever, så siden blev stående og sagde
  *«Opsigelse undervejs … der kan blive trukket som normalt. Vi prøver
  automatisk igen»*, mens køen var tom. Begge sætninger var usande, og
  knappen stod for evigt.

  Det er I15's fejl **spejlvendt**: I15 lovede for MEGET om hendes
  penge ud fra en beslutning alene; det her lovede for LIDT — og lovede
  en automatik, der ikke fandtes. Samme svar begge veje: udsagnet skal
  hvile på den bekræftede sluttilstand, og et dødt abonnement ER en
  bekræftet sluttilstand. At abonnementet er slut, står nu først i
  statuskaskaden; «Opsagt» ville skjule det.

  Beregnes på serveren, ikke i klienten: et værdi-import fra `lib/` ind
  i en klientkomponent trækker `postgres` med ind i browserbundtet.

  Det samme mønster blev målt i to søskendekøer og rettet samme sted:
  `afstemGennemfoerteKoeb` (50 permanent knækkede rækker spærrede den
  51. i tre kørsler) og `iFareForForkertFornyelse` (`limit(100)` uden
  nogen `order by`).

**I20 og I21 kom til efter sjette gennemgang.** Begge er den samme sag
som I15-I19, ét lag dybere: dér handlede det om, hvad rækken BETYDER;
her om, hvad en enkelt skrivning må love.

· **I20** er I12 og I16 ført til ende. I12 siger, at beslutningen skrives
  før de eksterne kald, så den kan genoptages. I16 siger, at
  genoptagelsen skal have sit eget felt. **I20 siger, at de to ikke må
  kunne skilles ad.**

  `noterOpsigelse` lavede TO selvstændige `update`s — beslutningen og
  skylden. En enkelt databasefejl i den anden var nok: beslutningen stod
  tilbage uden en vej til udførelse. Målt: tre tilsynskørsler, nul
  Stripe-kald, ingen logline, `cancel_at_period_end` aldrig sat hos
  Stripe — mens «Mit abonnement» sagde *«Opsigelse undervejs … Vi prøver
  automatisk igen»* om en kø, der var tom. Hun kunne kun komme videre ved
  selv at trykke igen.

  Rettelsen er ÉT `update`. Ét statement er atomisk i PostgreSQL, så der
  er ingen transaktion — og dermed heller ingen transaktion, der holdes
  åben over et netværkskald. `coalesce` på beslutningen gør nøjagtig
  det, `isNull`-vagten gjorde: det FØRSTE tidspunkt vinder.

  **Og fristelsen skal modstås:** man kunne lade køen finde rækken uden
  en skyld — «besluttet, men ikke bekræftet» som reserveprædikat. Det
  ville være to udtryk for det samme spørgsmål, og det er netop den
  fejlform, I16 kom af. Ét sted, og det er skylden.

  De rækker, der allerede måtte stå forældreløse, samles op af 0029's
  backfill. Rettelsen gør tilstanden uopnåelig fremover; den fjerner
  ikke det, der allerede er sket.

· **I21** er K7 ført hele vejen rundt. K7 beskyttede rydningen i grenen
  UDEN en stopbeslutning. Grenen, der GENNEMFØRER en opsigelse, ryddede
  fortsat ubetinget — og mellem den afsluttende Stripe-læsning og
  skrivningen hjem ligger en netværkstur. I det vindue kan `laegPlan`
  vende tilbage fra et forsinket `create`, opdage opsigelsen og
  registrere ny, korrekt skyld. Den gamle kvittering slettede den.
  Målt: planen `active` hos Stripe, skyld null, tre tilsynskørsler med
  nul kald. Tavs og blivende.

  **Tidsstemplet kan ikke bruges til at se det.**
  `coalesce(afstemning_skyldig_at, now())` BEVARER med vilje det gamle
  tidspunkt, så en ny skyld oven i en gammel får præcis samme værdi. To
  generationer bliver umulige at skelne — målt i `npm test`.

  Derfor `afstemning_gen`, en tæller der stiger ved hver registrering.
  Afstemningen læser den ved start og kvitterer kun, hvis den står
  uændret. Det samme gælder planbindingen: den ryddes kun, hvis den
  stadig peger på den plan, VI undersøgte.

  Er generationen steget, er det ikke en fejl: vores arbejde ER gjort,
  og kunden får sit ja. Men vi har ikke set det nye, og så kan vi ikke
  sige, det er gjort.

**I22 til I24 kom til efter syvende gennemgang.** De tre handler om
det samme: hvad en fejl må rive med sig. I20 og I21 sikrede, at en
skrivning ikke lover for meget. Her går det på, at et KAST ikke må
lyve — hverken om de andre rækker, om hvem der ejer arbejdet, eller om
hvad der nåede at ske.

· **I22** er S5 ført over i søsterkøen. S5 rettede fornyelsesvagten, så
  én rækkes fejl ikke tog de øvrige med. `afstemSkyldige` havde samme
  form og blev ikke rettet: `afstemAbonnement` bogfører selv en
  Stripe-fejl, og fejler DEN skrivning også, kaster den. Løkken stod af.
  Målt: tre kunder, A forrest i køen med nærmest frist, A's opslag og
  A's fejlbogføring brudt — B og C fik **nul** Stripe-kald i tre
  kørsler. Deres skyld stod urørt, men ingen rørte den.

  Vagten dækker også det **diagnostiske** opslag. Det henter kun
  fejlteksten, så linjen kan sige, hvad der gik galt — men uvagtet er
  det lige så godt til at vælte køen med. Det koster en fejltekst, ikke
  en kø: linjen bærer stadig abonnementets id og siger, at teksten ikke
  kunne læses.

  **Skylden bevares i begge tilfælde.** En række, der kastede, er ikke
  afstemt, og køen skal tage den igen.

  Samme regel gælder det ENKELTE kald. `sigOpFor` kalder også
  `afstemAbonnement`, og også dér kan den kaste — så mødte kunden en
  ubehandlet fejl i stedet for en besked. Vagten sidder om hele
  kaldet, ikke kun om den vej, I24 åbnede, for to vagter om samme kald
  valgt efter hvordan man kom derhen ville være to udtryk for ét
  spørgsmål. Svaret er `afventer`, og det er målt: beslutningen og
  skylden står, så tilsynet tager rækken.

· **I23** er I21's vagt, dér hvor den blev sat ud af kraft.
  `stopForkertFornyelse` kvitterede med
  `vorGen !== null ? eq(gen, vorGen) : sql\`true\``. Den `true` er
  fejlen. `besluttetAfOs` returnerer null netop, når KUNDEN nåede at
  gemme sin opsigelse, mens vi var i luften — altså præcis når vi ikke
  ejer beslutningen. Og så valgte afslutningen en ubetinget kvittering
  og kunne slette køarbejde, en anden havde registreret. Målt: den nye
  skyld væk, planen `active` hos Stripe, tre tilsynskørsler med nul
  kald.

  Rettelsen er at skille de to kendsgerninger ad, som I15 kræver.
  `cancel_at_period_end` er Stripes BEKRÆFTEDE sluttilstand, og den
  bogføres ubetinget — den er sand, uanset hvem der ellers har skrevet
  på rækken. Kvitteringen er noget andet: den er en påstand om, at
  arbejdet er udført, og den må kun dække den generation, vi selv
  skrev. Ejer vi ingen, kvitterer vi ingenting.

  Nul ryddede rækker er ikke et bevis for, at alt er afstemt. Det
  betyder, at nogen har registreret arbejde, vi ikke har udført.

· **I24** er I20 læst ordentligt. I20 gjorde `noterOpsigelse` til ét
  statement, og fangsten omkring den konkluderede derfra: «skrivningen
  er atomisk, så når den kaster, landede der intet». Det følger ikke.
  Atomiciteten gælder BASEN, ikke forbindelsen. Et tabt svar — basen
  committer, klienten får det aldrig at vide — kaster præcis som en
  afvist skrivning.

  Så stod beslutningen, skylden stod, tilsynet fuldførte opsigelsen hos
  Stripe — og kunden havde fået at vide, at der **ikke** var sket noget
  med hendes abonnement. Det er I19's fejl spejlvendt endnu en gang: vi
  lovede for lidt om noget, vi faktisk havde gjort.

  Rettelsen er at spørge rækken. Det er netop atomiciteten, der gør den
  til et gyldigt svar: der findes ingen halv tilstand at fejllæse.
  Derfor skal skrivningen BLIVE ét statement — I20 er forudsætningen
  for I24, ikke et alternativ til den.

  Tre udfald, ikke ét:

  | Rækken siger | Hvad vi ved | Svaret |
  |---|---|---|
  | hverken beslutning eller skyld | skrivningen landede ikke | `ikke_gemt` — prøv igen |
  | begge står | svaret gik tabt, arbejdet er i køen | som efter et kald, der lykkedes |
  | kun den ene, eller rækken kan ikke læses | vi ved det ikke | `ukendt` |

  `ukendt` må hverken love en automatik eller sige, at intet er gemt.
  Teksten siger derfor præcis det, den kan stå inde for: vi kunne ikke
  få bekræftet, om opsigelsen blev gemt — se efter under «Status», prøv
  igen hvis der ikke står noget, eller skriv til os. Knappen bliver
  stående, og kaldet er idempotent.

  **Den tredje række er den, man overser.** Den ene uden den anden kan
  ikke komme af DENNE skrivning; den sætter begge i samme statement. Så
  ved vi ikke, hvad vi ser, og et gæt her er et udsagn om hendes penge.

## Hvornår en plan GÆLDER

Det er to spørgsmål, ikke ét, og de har hver sit svar:

| Spørgsmål | Svares af |
|---|---|
| Er faserne dem, vi bad om? | `faserErRigtige` / `planfejl` (`lib/webhook.ts`) |
| Styrer planen stadig dette abonnement? | `planGaelder` (`lib/opsigelse.ts`) |

En plan er kun gyldig, når **begge** svarer ja. Det står i Stripes egne
typer, ikke i en formodning: `release` virker kun på `not_started` og
`active`, og en frigivet plan får sin `subscription` fjernet — id'et
flyttes til `released_subscription`
(`SubscriptionSchedules.d.ts:39, :104-116, :267`).

Konsekvensen er, at `stripe_schedule_id` hos os er en **bogføring**,
ikke en kendsgerning. Før hver handling på en plan — slippe den,
bekræfte den, bygge videre på den — slås den op hos Stripe.

## Bindingerne mellem enhederne

Det, der gør afstemning mulig, er at hvert led har en **entydig** nøgle
til det næste:

| Fra | Til | Nøgle | Hvor den kommer fra |
|---|---|---|---|
| forsøg | session | `checkout_forsoeg.stripe_session_id` | skrives efter `sessions.create` |
| session | forsøg | sessionens `id` | `checkout.session.completed` |
| forsøg | abonnement | `checkout_forsoeg.stripe_subscription_id` | `kassen()` skriver den |
| faktura | forsøg | `parent.subscription_details.metadata.bofinda_forsoeg` | vi sætter den i `subscription_data.metadata` ved `sessions.create`; Stripe fastfryser den i fakturaen |
| abonnement | plan | `subscriptions.stripe_schedule_id` og Stripes egen `subscription.schedule` | to uafhængige kilder, og det er med vilje |

**Kunde-id er ikke en binding.** En kunde kan have et gammelt, opsagt
abonnement og et nyt købsforsøg samtidig. At lukke et forsøg på
kunde-id alene var fund 3 i tredje gennemgang.

## Hvornår et sessionsløst forsøg er harmløst

Et forsøg uden `stripe_session_id` kan betyde to ting: at kaldet til
Stripe aldrig blev lavet, eller at det **kører lige nu**. Vi kan ikke
se forskel udefra.

Men vi behøver ikke: sessionens `expires_at` er sat til præcis
forsøgets `udloeber_at`. Derfor gælder

```
sessionsløs  +  udloeber_at i fremtiden   →  UAFKLARET
sessionsløs  +  udloeber_at passeret      →  harmløs; luk som udloebet
```

Det er grunden til, at de to tidspunkter skal blive ved med at være det
samme tal. Bliver de forskellige, forsvinder argumentet.

Gratis-skiftet venter derfor højst ét forsøgs levetid (`CHECKOUT_LEVETID_MIN`,
35 minutter) på en uafklaret oprettelse — ikke for evigt, og ikke nul.

## Hændelsernes rækkefølge

Stripes `created` har **sekundopløsning**, og Stripe garanterer ikke
leveringsrækkefølgen. To hændelser i samme sekund siger derfor
ingenting om orden.

Derfor er statusafstemningen **ikke** ordnet på tid alene:

* Spejlingen (status, pris, periode) bruger `stripe_opdateret_at` med
  `<=`, så to hændelser i samme sekund stadig kan gøre fremskridt.
* **Men en terminal status forlades aldrig.** `canceled`,
  `incomplete_expired` og `expired` er endelige hos Stripe; en
  hændelse, der vil sætte noget andet, er ude af orden og afvises.

At ændre `<=` til `<` ville ikke løse det. Det ville genindføre fund 6
fra første runde, hvor `checkout.session.completed` og den første
`invoice.paid` deler sekund, og spejlingen aldrig blev skrevet.

## Hvad der IKKE hører sammen

Tre spørgsmål bliver hele tiden blandet sammen. De er forskellige:

1. **Kan sessionen stadig betales?** → Stripes `status`
2. **Er pengene modtaget?** → `invoice.paid`, og kun den
3. **Har kunden adgang?** → `subscriptions.adgang_til`, skrevet ét sted

Et svar på ét af dem er aldrig et svar på et andet.
