# Den centrale adgangskontrol

Grænsefladen, alle betalte funktioner skal bruge. **Skriv aldrig dit eget
prædikat over `drift` + `subscriptions`** — to udtryk for det samme
spørgsmål driver fra hinanden, og begge ser rigtige ud hver for sig.

## Til beskedmodulet

```ts
import { FUNKTION, maaBruge } from '../lib/adgang'

const svar = await maaBruge(FUNKTION.beskeder)
if (!svar.ok) {
  // svar.grund: se GRUNDE i lib/adgangsgrunde.ts — fire vaerdier
  // svar.tilstand: 'gratis' | 'betaling'
  return svar
}
// svar.adgangTil: Date | null — hvornår den betalte periode udløber
```

Reglen for beskeder er **allerede indbygget** i `FUNKTION.beskeder`:

| Tilstand | Adfærd |
|---|---|
| GRATIS | login er nok — egne samtaler |
| BETALING | kræver gyldigt abonnement |
| opsagt, ikke udløbet | **adgang bevares** perioden ud |
| udløbet | nægtes med `abonnement_udloebet` — beskederne slettes ikke |

Ved udløb låses læsning og afsendelse. `maaBruge` siger kun *om* der er
adgang; at beskederne **bevares**, er visningens ansvar at sige.

## `adgang()` — oversætteren til beskedmodulet

`app/beskeder/DATAKONTRAKT.md` §5.1 beder Supply om en funktion, ikke om
en værdi. Den findes nu:

```ts
import { adgang } from '../lib/adgang'

const tilstand = await adgang()      // 'adgang' | Laasegrund | 'ukendt-tilstand'
```

**Skriv aldrig din egen `Grund → Laasegrund`.** Gør man det, er der to
steder, der afgør hvad brugeren ser — CLAUDE.md's dyreste regel, ét lag
højere oppe. Oversættelsen er et `Record<Grund, …>`, så en femte grund
ikke kan tilføjes uden at oversættelsen også bliver skrevet.

**Returtypen er kontraktens union plus ét ord.** Kontrakten blev skrevet
uden kendskab til `ukendt_tilstand`, og ingen af de tre låsegrunde kan
udtrykke den: «log ind» er forkert over for en, der *er* logget ind, og
«køb et abonnement» sender et menneske til kassen på grund af vores egen
fejl. Derfor `'ukendt-tilstand'`.

> ⚠ **Åben ende.** `Laast.tsx` mangler en tekst for `'ukendt-tilstand'`,
> før `/beskeder` kan gå i luften. Den står her i stedet for at blive
> lukket med en usandhed.

## Hvordan «udløbet» skelnes fra «aldrig haft»

Målt på `subscriptions.adgang_til`, **ikke** på om der findes en række:
en række i `incomplete`, hvor betalingen aldrig gik igennem, har
`adgang_til = null` og er altså «har aldrig haft».

`slaaAdgangOp` spørger derfor `where adgang_til is not null` og
sammenligner med `now()` i JS. Rækken med `MAX(adgang_til)` svarer på
begge spørgsmål på én gang — er den i fremtiden, er der adgang; er den i
fortiden, er den præcis den dato, adgangen løb ud. Stadig ét opslag og
ét udtryk for «har hun adgang».

**`isNotNull` er ikke et overflødigt filter.** `order by … desc` er
NULLS FIRST i Postgres, så en række uden betaling ville vinde over den
udløbne — og svaret blive «har aldrig haft» om en kunde, der *har* haft.
Kombinationen opstår af sig selv: `lib/webhook.ts` indsætter
`status = 'incomplete'` uden `adgang_til`, og 0023's delvise indeks
tillader «én levende plus vilkårligt mange afsluttede». Afsnit 8b i
`scripts/test-betaling.ts` har en prøve, der kun måler det.

**Udløbsdatoen bæres ikke ud i visningen.** Vi kender den, men intet
kaldested viser den, og et felt, ingen runtime-kode læser, er præcis den
form, CLAUDE.md's første «må aldrig ske» handler om. Tilføjes den, skal
formateringen afgøres først: serveren kører UTC på Vercel.

## Fire regler

1. **Spørg i handlingen, ikke i komponenten.** En server action kan
   kaldes direkte som POST. En mur i skabelonen er ingen mur.
2. **Spørg før opslaget.** Nægtes adgangen, må forespørgslen ikke køre —
   et felt, der aldrig forlader basen, kan ikke lække i en logline eller
   en fejlbesked.
3. **Identiteten kommer fra `hentBrugerId()`**, aldrig fra browseren.
   `maaBruge(funktion, brugerId?)` tager et id med, hvis kaldet allerede
   har slået det op — men aldrig et, klienten har sendt.
4. **Fejl lukker.** Kan tilstanden eller abonnementet ikke læses, er
   grunden `ukendt_tilstand`, ikke `abonnement_kraeves`. Vis «vi kan
   ikke bekræfte din adgang» — send ikke nogen til kassen på grund af
   vores egen fejl.

## Ny funktion bag muren

Tilføj navnet til `FUNKTION` i `lib/adgang.ts` og giv den en regel i
`maaBruge`. Sættet er lukket med vilje: en funktion, der ikke står der,
kan ikke spørge.

`scripts/test-betaling.ts` afsnit 9 **kører** hvert kaldested og måler
det på SQL-båndet (`scripts/sqlbaand.ts`). Tilføj dit kaldested der.

> Her stod før, at afsnit 9 *læser kildeteksten*. Det gjorde den, og den
> prøve blev fjernet i `ceb159c`: påstanden var sand af to grunde, der
> begge var uafhængige af, hvor vagten stod, så den ville passere en
> vagt flyttet om **bag** det beskyttede opslag. Dokumentet stod tilbage
> og pegede på en prøve, der ikke fandtes.

Skriv prøven som de andre i afsnittet: kald indgangen, og mål på båndet,
at ingen sætning rører de beskyttede felter, når adgangen er nægtet — og
at den **gør det** på den tilladte vej, så måleren har bevist, at den
slår ud. En prøve, der kun læser kildetekst, kan ikke se, om vagten
faktisk fyrer.

## Noteret, ikke gjort

Fundet under arbejdet med `abonnement_udloebet`. Hver af dem er et
selvstændigt stykke arbejde, og ingen af dem blev lavet i den omgang.

1. ~~**`/min-side` siger «adgangen fortsætter indtil da» om en udløbet
   række.**~~ **Rettet.** `Abonnementsbillede.adgangTil: Date | null` er
   erstattet af `Betaltperiode` — `{loeber|udloebet|ingen}` — så
   sammenligningen med `now()` sker ét sted, i `abonnementForBruger`, og
   kalderne forgrener på svaret i stedet for på en rå dato. Det lukkede
   samtidig tre af de fem udtryk i punkt 4: `/abonnement/page.tsx` og
   `/abonnement/kvittering/page.tsx` regnede hver sin.

   Panelet siger nu to forskellige ting, fordi de to tilstande ikke er
   det samme: er fornyelsen **bekræftet stoppet**, står der «Dit
   abonnement er udløbet» — samme ord som kontaktboksen og låseskærmen.
   Lever abonnementet stadig hos Stripe (`past_due`, `unpaid`), står der
   «Din betalte periode er udløbet»; det andet ville stå lige over
   «Status: Betaling mislykkedes» og knappen «Sig abonnementet op».

   **Ikke gjort, med vilje:** der er ingen «Genaktivér»-knap på
   /min-side. `startKoebFor` kaster `har_allerede`, så snart der findes
   en `LEVENDE` række — og `incomplete` er levende. For netop den kunde,
   der lige har forsøgt et nyt køb, ville knappen være en blindgyde.
   Vejen videre findes på boligsiden, hvor muren selv stiller den.
2. ~~**`checkout_started` bærer ikke grunden.**~~ **Rettet.** `grund`
   udledes nu af basen med `koebsgrund()` — samme opslag, muren brugte til
   at stoppe hende — så tragten kan skelne et første køb fra en
   genaktivering. `funktion` udledes af den genopbyggede returvej og
   **udelades**, når ingen mur stod i vejen; den er derfor ikke længere
   `kraevet` på det event. `tilstand: 'betaling'` blev stående: den er sand
   ved konstruktion, fordi `startKoebFor` kaster `gratis_tilstand` inde i
   sin egen transaktion.

   **Fundet undervejs er lukket.** `subscription_activated` stod i
   allowlisten uden afsender, og det kunne ikke få en: adgangen opstår i
   `invoice.paid`, hvor webhookens request er Stripes (ingen
   samtykke-cookie) og tilsynet kører i workeren uden Next. Dertil er
   `haendelser.anonymous_id` og `session_id` `not null`. Eventet er
   **fjernet** fra taksonomien; aktiveringer tælles i `subscriptions`.
   Se docs/analytics-v1.md, «Aktiveringer tælles i subscriptions», for
   forespørgslen og for fælden: forholdet mellem de to tal er ikke en
   konverteringsrate.
3. **`?grund=` må aldrig læses som en kendsgerning.** `/go/[id]` lægger
   den i adressen til `/abonnement`, og siden læser den ikke i dag.
   Begynder den at gøre det, kan enhver sende et link, der påstår noget
   om en fremmeds betalingshistorik. Udled det af basen, ikke af URL'en.
4. ~~**To udtryk tilbage for «har hun (haft) adgang».**~~ **Rettet** — og
   tallet var forkert. «Tre lukket, to tilbage» var talt i SIDER, ikke i
   spørgsmål: `/abonnement/page.tsx` og `/abonnement/kvittering/page.tsx`
   bruger ikke ét eneste af `Abonnementsbillede`'s ti øvrige felter. De var
   aldrig paneler. Rettelsen fjernede deres egne sammenligninger — rigtigt
   — men førte to rene adgangsspørgsmål over på det opslag, der beskriver
   en **kontrakt**. Antallet af sammenligninger faldt; antallet af steder,
   der spurgte det svagere udtryk, steg fra ét til tre.

   Nu spørger alle tre `betaltPeriode()` i `lib/adgang.ts` — murens eget
   opslag, `MAX(adgang_til)` over alle hendes rækker.
   `abonnementForBruger` beholder sit rækkevalg og sine ti kontraktfelter:
   status, fase, næste, fornyesAt, opsagt, opsigelseUndervejs, fornyesIkke,
   afsluttet og fornyelseStoppet er egenskaber ved én kontrakt hos Stripe
   og kan ikke udledes af `MAX(adgang_til)`. **Muren må aldrig læse
   panelets række, og panelets ti felter må aldrig komme fra murens.**

   **Prøven på, at det var ÉT spørgsmål:** svarene kunne ORDNES. Panelet
   sagde aldrig mere adgang end muren gav, og nogle gange mindre — derfor
   var det ikke et sikkerhedshul, men kunder der fik for lidt at vide.
   To uenigheder målt over ni tilstande, begge i afsnit 8f:

   | tilstand | muren | panelet |
   |---|---|---|
   | udløbet + nyere ubetalt | `udloebet` | `ingen` |
   | ældre række rækker længst frem | `loeber` | `udloebet` |

   Den anden var ikke forudset, og der er ikke fundet en vej, der
   producerer tilstanden — `har_allerede` spærrer for et køb, mens en række
   er levende. Men `order by oprettet_at` udelukker den ikke, hvor
   `order by adgang_til` ville, og prøven koster ingenting.

   **En fælles `periodeFor()`-hjælper blev fravalgt.** Sammenligningen var
   allerede ordret den samme begge steder; uenigheden lå i ARGUMENTET. En
   delt funktion ville have ladet to uenige rækkevalg svare gennem samme
   kodelinje og samme ord — og gjort fejlen sværere at se, ikke mindre.

   **Fejludfaldet kom med.** `kvittering/page.tsx` læste hverken `drift`
   eller et fejludfald: kunne tilstanden ikke læses, sagde hver boligside
   «det er en fejl hos os», mens kvitteringen i samme sekund sagde «Tak —
   du har adgang». Sætningen bor nu ét sted, `ADGANG_UKENDT` i
   `lib/adgangsgrunde.ts`, og alle fire flader bruger den.

   **To ubrugte funktioner er slettet:** `maaKoebe` havde nul kaldere, og
   `harBetaltAdgang` havde nul i produktionen — kun prøven. Begge var
   eksporteret, prøvet og ubrugt, mens spørgsmålet blev besvaret ved siden
   af. Det er `sources.enabled`-formen, og en funktion, ingen kalder, er en
   fælde for den næste.

   **Tilbage står `gaeldendeTilbud()`**, der udleder «har hun betalt før»
   af `users.intro_brugt_at` — et beslægtet spørgsmål besvaret af en anden
   kolonne i en anden tabel, på selvsamme købsside. Det er ikke det samme
   spørgsmål (pris mod adgang), og de to kan være uenige: intro er brugt
   for evigt, adgang løber ud.

5. **Datoformatet.** `app/admin/drift/page.tsx` formaterer stadig med
   `toLocaleString('da-DK')` uden zone. `lib/dato.ts` har `dansk()` med
   `KALENDERZONE`, og filens egen regel er, at zonen er eksplicit
   overalt. På Vercel kører serveren UTC, så et tidspunkt kl. 00.30
   dansk tid skrives med dagen før.

---

## Webhookens udfald (tilføjet efter gennemgangen)

`behandl()` svarer med ét udfald. Beskedmodulet rører dem ikke, men de
hører til kontrakten, fordi de afgør, hvornår adgang opstår.

**Denne tabel er en HÅNDHOLDT KOPI, og den eneste der er tilbage.**
Sandheden er `UDFALD` i `lib/webhook.ts`; porten i `behandl()`, rutens
statuskode og tilsynets optælling læser alle tre dét opslag, og
`scripts/test-udfald.ts` kræver en prøvesag for hver nøgle i det. Ingen
oversætter kan holde markdown i takt — tilføjes et udfald, skal linjen
her skrives i hånden. Prøven fejler på det manglende udfald, ikke på
den manglende tabelrække.

**Kolonnen «Markeres færdig?» har TRE tilstande, opslagets boolean har
to.** `—` er `gentagelse`: rækken ER færdig, men blev det af en tidligere
levering, ikke af denne. For ruten er `ja` og `—` det samme (200), og
derfor er `UDFALD.gentagelse.faerdig = true` rigtigt — men fladningen er
et tab af oplysning, og den står her.

| Udfald | Betydning | Markeres færdig? | `UDFALD` | HTTP |
|---|---|---|---|---|
| `behandlet` | anvendt | ja | `faerdig: true` | 200 |
| `gentagelse` | set og færdigbehandlet før | — | `faerdig: true` | 200 |
| `ignoreret` | ikke en hændelse, vi lytter på | ja | `faerdig: true` | 200 |
| `forael` | adgangen flyttede sig ikke | ja | `faerdig: true` | 200 |
| **`i_gang`** | en anden behandler har kravet | **nej** | `kravet: 'andens'` | **409** |
| **`afventer`** | gyldig, men forudsætningen mangler | **nej** | `kravet: 'vores'` | **409** |

**Hvorfor opslaget ikke er en boolean.** «Ikke færdig» dækker to
tilstande, og den forkerte efterbehandling er dyr begge veje. Er kravet
en andens, må vi ikke frigive det — så kunne to behandlere arbejde på
samme hændelse. Er det vores, skal alle tre skrivninger med:
`paabegyndt_at = null` (ellers svarer de næste fem minutter `i_gang`),
`fejl` som `coalesce`-faldback (den præcise grund vinder over den
generelle), og `naeste_forsoeg_at` — uden den står rækken permanent som
«klar», ligger forrest i køen og optager én af tilsynets 50 pladser i
hver eneste kørsel. En boolean leverer ingen af dem, og en nøgle, der
ser fuldstændig ud, er præcis det, der får dem oversprunget.

**Og ruten må ikke i stedet læse `behandlet_at`.** Kolonnen er referatet
af portens beslutning, skrevet af `faerdig()` NEDSTRØMS for den. Et
udfald, porten har misforstået, har allerede fået kolonnen sat — en rute,
der læser den, ville svare 200 alligevel. Samme tabte betaling, én
forespørgsel mere.

`afventer` er den vigtige. En `invoice.paid`, der overhaler sin
`checkout.session.completed`, må ikke markeres færdig — gør man det,
giver genleveringen `gentagelse`, og den betalte periode er tabt.

**Statuskoden er en del af rettelsen.** Over for Stripe betyder 2xx
«modtaget, prøv ikke igen». En 200 på `afventer` kvitterede derfor for
noget, vi ikke havde gjort: hændelsen stod ubehandlet i basen, og
Stripe leverede den aldrig igen. Nu svarer ruten 409, og Stripe prøver
forfra.

**Men en HTTP-kode kan ikke stå alene**, for Stripes genforsøg holder
op efter sit vindue. Derfor gemmes hændelsen i
`stripe_events.nyttelast`, og `behandlUbehandlede()` kan køre den om
fra basen — uden Stripe. Den kaldes af `betalingstilsyn()`, som
`scripts/import.ts` kører hver time. To veje, fordi den ene ikke kan
stå alene.

**Nyttelasten er en allowlist, ikke hele objektet.** Et
Stripe-hændelsesobjekt bærer kundens navn, mailadresse,
faktureringsadresse, kortets sidste fire cifre og udstederland.
Ingen af dem læses af `behandl()`, og de skal derfor heller ikke i vores
base. `kunDetViLaeser()` bygger et minimalt objekt af **præcis de stier,
behandlerne læser** — samme disciplin som adapternes allowlist, og af
samme grund: en denylist dækker i dag og svigter i morgen, når Stripe
tilføjer et felt.

Tilføjer du en ny læsning i en behandler, skal stien med i
`kunDetViLaeser()`. Gør du ikke det, ser en genbehandling ikke feltet —
og det er den rigtige vej at svigte: et manglende felt opdages, et gemt
felt gør ikke.

**Nyttelasten kasseres, når hændelsen er færdig.** Er der intet at køre
om, er der heller ingen grund til at gemme den.

`forael` betyder **kun**, at `adgang_til` ikke flyttede sig. Det
betyder ikke, at behandlingen sprang noget over: introregistreringen og
planskylden gøres færdige uanset, netop så en genlevering kan reparere
en halvt gennemført behandling.

### De tre skrivninger i `invoice.paid`

De er adskilte med vilje, og hver har sin egen betingelse:

| # | Skriver | Betingelse |
|---|---|---|
| 1 | `adgang_til` | **monoton** — kun frem, intet tidsfilter |
| 2 | status, pris, periode, kunde | `nyereEnd()` — kun hvis hændelsen er nyere |
| 3 | `intro_brugt_at`, `plan_status`, planen | feltets eget «mangler stadig» |

Skrivning 1 og 2 var før ÉN `update`. Det gjorde, at en **ældre**
faktura, der med rette måtte registrere betalt adgang, samtidig skrev
`status = 'active'` hen over en **nyere** `customer.subscription.deleted`.
Adgangens monotoni og spejlingens rækkefølge er to forskellige
spørgsmål, og de skal derfor beregnes hver for sig.

### Rækkefølgen mellem hændelser

`created` har **sekundopløsning**, og Stripes `EventBase` bærer intet
andet ordningsfelt (`Events.d.ts`). To hændelser i samme sekund siger
derfor ingenting om orden — og det gælder begge veje:

* En faktura i samme sekund som sin checkout skal stadig kunne **skrive
  spejlingen**. Derfor er tidsvagten `<=`.
* En faktura i samme sekund som en **opsigelse** må ikke skrive
  `canceled` tilbage til `active`. Derfor er der en **anden** vagt.

`TERMINALE` er `canceled`, `incomplete_expired` og `expired`. En række i
en af dem forlades kun af en hændelse, der selv er terminal. Køber
kunden igen, får hun et nyt abonnements-id og dermed en ny række — en
terminal række skal aldrig genoplives.

De to vagter er adskilte, fordi de svarer på forskellige spørgsmål: den
ene om **tid**, den anden om hvilke tilstande der overhovedet kan
forlades. At bytte `<=` ud med `<` ville bare have byttet den ene fejl
for den anden.

**Adgangens monotoni er urørt af begge.** En gammel faktura registrerer
stadig sin betalte periode.

### Køen fortrænger ikke

`behandlUbehandlede()` tog før «de 50 ældste ubehandlede». Det var nok
til at spærre køen for altid: femoghalvtreds hændelser, hvis
forudsætning aldrig kommer, blev valgt hver gang.

Nu bærer hver hændelse en `naeste_forsoeg_at`, og kun de klare vælges —
ældste først **blandt dem**. Trinene er 0 · 0 · 10 min · 10 min · 1 t ·
… · 6 t. De to første venter ikke, så tilsynet kan gøre en hændelse
færdig i samme kørsel, som forudsætningen ankom.

**En betalingshændelse opgives aldrig.** Der er ingen «giv op efter
fem» her — den prøves bare sjældnere, og den bliver stående i basen med
sin fejl.

### Planstart, betalingsforsøg og betaling er tre ting

| Begreb | Hvad det er | Giver adgang? |
|---|---|---|
| **Betalingsforsøg** | en række i `checkout_forsoeg` + en Checkout Session hos Stripe | nej |
| **Betaling** | `invoice.paid` fra Stripe | **ja** — eneste kilde |
| **Planstart** | `SubscriptionSchedule` lagt og faserne **læst tilbage** (`plan_status = 'konfigureret'`) | nej |

De tre kan lykkes hver for sig og i vilkårlig rækkefølge. En betaling
uden plan er en kunde med adgang, hvis abonnement fornyes til 9 kr.
**om dagen** hos Stripe — se `docs/betaling/betjening.md`.

**Adgang opstår ét sted: `invoice.paid`.** Vagten dér er MONOTON —
`adgang_til` flyttes kun frem. En sent ankommen faktura kan ikke
forkorte en betalt periode, og en faktura i uorden kan stadig forlænge
den. Det fælles `stripe_opdateret_at`-filter bruges bevidst **ikke** på
adgangen: det beskytter statusspejlingen, og en nyere
`subscription.updated` ville ellers få en gyldig betaling afvist.
