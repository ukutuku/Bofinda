# Beskedmodulet — datakontrakt og det, der mangler

Brugerfladen er færdig og afprøvet. **Serverlaget findes ikke endnu**, og
modulet kan derfor ikke bruges af kunder. Her står præcis, hvad det skal
levere, og hvorfor formen er, som den er.

Typerne er den egentlige kontrakt og står i `app/beskeder/kontrakt.ts`.
Dette dokument forklarer dem.

---

## 1 · Adgangsreglerne ejes af Supply — og typerne er ikke sikkerhed

**Ingen komponent regner en adgangsregel.** Der er ikke ét sted i
`app/beskeder/`, hvor der står, om nogen har betalt, hvornår et abonnement
udløber, eller hvad der er gratis. Serverlaget sender **én eksplicit
visningstilladelse**, og brugerfladen adlyder den.

Derfor er `Indbakke` og `Samtaletraad` diskriminerede unioner og ikke
objekter med et `laast`-flag ved siden af indholdet:

```ts
export type Indbakke =
  | { tilstand: 'adgang'; samtaler: Samtalehoved[] }
  | { tilstand: Laasegrund }          // ← ingen samtaler. Feltet FINDES ikke.
```

### ⚠ Hvad det er — og hvad det ikke er

Unionen gør det svært at komme til at gengive indhold i en låst tilstand,
og den gør det tydeligt, hvad serveren skal sende. **Det er alt, den gør.**
Den er:

* **ikke autorisation.** Typer findes ikke ved kørselstid. Enhver kan kalde
  en server action eller en rute direkte, uden vores klient.
* **ikke en filtrering af svar.** Der er ingen kode, der fjerner felter på
  vej ud. Et serverlag, der lægger `samtaler` ved siden af en låst tilstand,
  sender dem — typen er væk, når JSON'en pakkes.
* **ikke et bevis for, at private data ikke forlader serveren.**

**Serverintegrationen skal derfor selv:**

1. **Kontrollere adgangen** for den aktuelle bruger ved hver eneste
   forespørgsel — ikke stole på en tilstand, klienten har med.
2. **Kontrollere ejerskabet** i selve forespørgslen: en samtale skal
   tilhøre brugeren som `tenantId` eller `landlordId`, og kravet hører til i
   `where`-leddet, ikke i en kontrol bagefter.
3. **Eksplicit bygge svaret uden private felter, når adgangen afvises.**
   Ikke hente hele objektet og returnere det «bare med en anden tilstand».
   Returnér `{ tilstand: 'abonnement-udloebet' }` som en ny værdi, bygget af
   ingenting.

Det, typen giver os, er at `{ tilstand: 'login-kraevet' }` ikke **har** et
`samtaler`-felt, så den vej ind er lukket ved et uheld. Vejen ind ved en
fejl i serverlaget er ikke lukket af noget her.

---

## 2 · De fire tilstande

| `tilstand` | Hvornår | Hvad brugeren ser |
|---|---|---|
| `adgang` | Supply siger ja | Listen og tråden |
| `login-kraevet` | Ingen session | «Log ind for at se dine beskeder» + knappen **Log ind** |
| `abonnement-kraevet` | Har aldrig haft abonnement | «Beskeder kræver abonnement» + **Se abonnement** |
| `abonnement-udloebet` | Har haft et, og det er udløbet | «Dit abonnement er udløbet» + **Genaktivér** |

De to sidste er skilt ad med vilje: det er to forskellige situationer for
den, der står i dem, og de får derfor forskellig tekst og forskelligt
knapnavn. **Teksterne bor i brugerfladen** (`Laast.tsx`), ikke i
serverlaget — serveren sender ét ord fra en union, brugerfladen skriver
sætningen. Sendte serveren selve teksten, ville brugervendt dansk ligge
spredt over to lag, og den ene kopi ville blive rettet uden den anden.

**Ingen pris nogen steder i modulet.** Prisen ejes af Supply og ville blive
forkert den dag, den ændrer sig ét sted.

### Et udløbet abonnement låser begge veje

Besluttet. I betalingstilstand låser `abonnement-udloebet` **både læsning og
skrivning**: beskederne vises ikke, og der kan ikke skrives. De **bevares i
basen** og bliver tilgængelige igen ved genaktivering — der slettes
ingenting.

**En opsigelse med resterende betalt adgang låser ikke.** Adgangen løber til
periodens udløb, og først derefter er tilstanden `abonnement-udloebet`.
Regnestykket — `cancelAtPeriodEnd` sammen med `currentPeriodEnd` — hører til
hos Supply og ikke her.

**I gratis tilstand** er det Supplys centrale adgangsbeslutning, der afgør
tilstanden. Brugerfladen kender ikke forskel på de to tilstande; den får ét
ord og viser det.

> Skemaets gamle kommentar ved `messages` — *«Udløbet abonnement betyder
> skrivebeskyttet historik»* — er **ikke** gældende produktkrav. Forløbet
> «læs historikken, men genaktivér for at skrive» findes ikke længere i
> modulet: der er ingen `Skrivetilstand`, intet skrivebeskyttet panel og
> intet scenarie for det. Kommentaren i `db/schema.ts` er ikke rettet her,
> fordi databasen ligger uden for denne opgave.

### En låsning er endelig for visningen

Melder porten, at adgangen er lukket — fra indbakken, fra en tråd eller fra
en afsendelse — går **hele modulet** i låst visning, også hvis en samtale
allerede er åben. Samtalelisten, uddragene og beskederne bliver ikke stående
bag en besked om at genindlæse: tilstanden **erstattes** med den låste
variant, og de ventende kvitteringer (afsnit 4) ryddes.

> ⚠ Det rydder **visningen og modulets tilstand**. Det er ikke det samme som,
> at data er væk fra browserens hukommelse. Svarene har været igennem
> netværkslaget, har ligget i JS-objekter og kan stå i alt fra
> `performance`-bufferen til en heap snapshot, og hverken vi eller JavaScript
> kan garantere, hvornår en opsamler rydder dem. Det, koden lover, er at
> modulet ikke **viser** eller **bruger** dem igen — ikke at de er slettet.

Og låsningen er en lås: **et forsinket svar, der siger «adgang», åbner ikke
op igen.** Kald, der var undervejs, da låsen faldt, kasseres.

Derfor bærer en afvist afsendelse sin grund med:

```ts
| { ok: false; fejl: 'laast'; grund: Laasegrund }
```

Uden grunden ville brugerfladen vide, at adgangen var lukket, men ikke kunne
sige hvorfor — og så ville den eneste ærlige besked være «genindlæs»,
hvilket er at bede brugeren om at gøre vores arbejde.

---

## 3 · Grænsefladen, serverlaget skal opfylde

```ts
export interface Beskedport {
  hentIndbakke(signal?: AbortSignal): Promise<Indbakke>
  hentTraad(samtaleId: string, signal?: AbortSignal): Promise<Samtaletraad>
  send(samtaleId: string, tekst: string): Promise<Sendesvar>
  markerLaest(samtaleId: string): Promise<void>
}
```

Komponenterne kalder aldrig `fetch` eller en server action direkte. De får
en port ind. Det er dét, der gør modulet afprøvbart med syntetiske samtaler
uden et midlertidigt produktions-API — og det, der gør den rigtige
serverintegration til **én fil**.

**Alle fire må afvise deres løfte.** En afvist Promise er ikke det samme som
et svar, der siger nej, og begge dele sker i virkeligheden: en afbrudt
forbindelse, en 500'er uden krop og en server action, der kaster, ser alle
sådan ud. Modulet håndterer begge.

### Felter, der skal fyldes

`Samtalehoved` — én række i oversigten:

| Felt | Krav |
|---|---|
| `id` | Samtalens id |
| `bolig.adresse` | **Uden** postnummer og by — som boligkortene gør det |
| `bolig.sted` | «2300 København S», eller `null` |
| `modpart.navn` | `null` når det ikke er oplyst. Brugerfladen skriver så rollen |
| `modpart.rolle` | `'udlejer' \| 'boligsoegende'` |
| `sidsteAktivitet` | ISO 8601. Formateres med `siden()` fra `lib/dato.ts` |
| `uddrag` | **Forkortet af serveren.** `null` er i orden |
| `ulaeste` | Antal. `0` = ingen markering |

`Besked`:

| Felt | Krav |
|---|---|
| `fra` | `'mig' \| 'modpart'` — **afgøres af serveren** ud fra sessionen, aldrig af klienten |
| `tekst` | Ren tekst. Modulet gengiver den som tekst, aldrig som markup |
| `tidspunkt` | ISO 8601 |

### Fire ting, der er lette at gøre forkert

1. **`uddrag` skal forkortes af serveren.** Sendte vi hele beskeden og
   klippede med `text-overflow`, ville hele teksten stå i markuppen — samme
   fejl som at skjule et låst indhold med `display: none`.
2. **Svaret skal være en kopi, ikke en levende reference.** Modulet regner
   med at eje det, det får, og lægger nye beskeder i med `[...beskeder, ny]`.
   Attrappen udleverede først sin egen liste, og så stod den sendte besked to
   gange. Et serverlag, der serialiserer, har ikke problemet — men en
   in-process implementering har.
3. **`MAKS_TEGN` (2000) står i `kontrakt.ts` og skal bruges begge steder.**
   Tælleren i skrivefeltet og serverens afvisning svarer på det samme
   spørgsmål. To tal ville drive fra hinanden, og brugeren ville se et felt,
   der sagde god for en tekst, serveren kastede væk. Se CLAUDE.md: *«Svarer
   to udtryk på det samme spørgsmål, skal de beregnes ét sted.»*
4. **`send` skal spærre igen, server-side.** `hentTraad` gav en
   visningstilladelse, ikke en adgangskontrol: adgangen kan være ændret,
   siden tråden blev hentet. Svar `{ ok: false, fejl: 'laast', grund }`.

---

## 4 · Hvordan modulet binder svar til samtaler

Det hører til kontrakten, fordi serverlaget kan udløse det:

* **Læsning og skrivning koordineres.** `send` og `hentTraad` er to kald, og
  de kan overhale hinanden. Modulet husker derfor hver besked, serveren har
  **kvitteret** for, indtil en læsning selv har vist os den — og fletter den
  ind i hver læsning, der ikke har den med. To forløb, begge målt:
  * *Kvitteringen kommer efter genlæsningen.* Serveren har allerede gemt
    beskeden, så læsningen har den med; kvitteringen må ikke lægge den i
    igen. Sammenligningen er på **id**: samme id er samme besked.
  * *Læsningen tog et ældre øjebliksbillede.* Kvitteringen lander, mens
    tråden henter, og der er ingen visning at lægge den i. Uden den huskede
    kvittering forsvandt beskeden, når det gamle billede landede bagefter.
  Brugeren skal ikke genindlæse for at se det rigtige. Den dag et
  øjebliksbillede indeholder beskeden, bæres den ikke videre — og en låsning
  rydder listen.
* **Hver åbning har et nummer.** Et svar, hvis nummer ikke længere er det
  aktuelle, hører til noget, brugeren har forladt, og kasseres. Uden det
  vandt det *langsomste* svar: A åbnes, B åbnes, A's svar kommer sidst — og
  B blev overskrevet af A.
* **Vejen tilbage tæller også op.** Et svar, der lander efter, må ikke skubbe
  tråden frem igen.
* **Afsendelsen bærer sit samtale-id med.** Kvitteringen lægges kun i
  tråden, hvis det stadig er dén tråd, der vises. Den lægges altid i den
  rigtige række i listen — beskeden er sendt, og det skal kunne ses.
* **En låsning slår alt andet.** Den gælder, også hvis svaret er forældet:
  en lukket adgang er en oplysning om kontoen, ikke om denne ene
  forespørgsel, og at lukke for meget er den rigtige vej at fejle.

---

## 5 · Det, der mangler, før modulet kan bruges af kunder

Rækkefølgen er den, tingene spærrer for hinanden i.

### 5.1 · Fra Supply

1. **En funktion, der afgør adgangstilstanden** for den aktuelle bruger:
   `adgang(): Promise<'adgang' | Laasegrund>`. Den skal kende sessionen,
   abonnementets status, `cancelAtPeriodEnd` og `currentPeriodEnd` — og den
   centrale beslutning for gratis tilstand. Alt sammen Supplys.
2. **Ruten til abonnement/genaktivering.** `Beskedmodul` kræver
   `abonnementHref` og har med vilje **ingen** standardværdi: en knap, der
   peger på en rute, der ikke findes, er værre end ingen knap. I dag findes
   ruten ikke, og prøvevisningen sender en synlig attrap
   (`#abonnementsruten-leveres-af-supply`).

### 5.2 · Serverlaget for beskeder

3. **Fire server actions eller en rute, der opfylder `Beskedport`.**
   Tabellerne findes allerede i `db/schema.ts` (`conversations`, `messages`)
   og er ikke rørt i denne opgave. Adgang og ejerskab kontrolleres i hver
   enkelt, og afviste svar bygges eksplicit uden private felter — se afsnit 1.
   - `hentIndbakke` — samtaler hvor brugeren er `tenantId` eller
     `landlordId`, sorteret på `lastMessageAt`, med `ulaeste` talt af
     `messages.readAt is null and senderId <> mig`.
   - `hentTraad` — beskederne på `conversationId`, med ejerskabet i selve
     `where`. En samtale, der ikke er brugerens, skal svare
     `{ tilstand: 'findes-ikke' }` — samme svar som en, der ikke findes, så
     eksistensen ikke kan aflæses.
   - `send` — indsæt beskeden, opdatér `conversations.lastMessageAt`. Spær
     ved afsendelse, server-side, og svar med `grund`, når det er en låsning.
   - `markerLaest` — `messages.readAt = now()` for modpartens ulæste.
4. **Oprettelsen af en samtale.** Modulet viser samtaler; det starter dem
   ikke. Knappen «Skriv til udlejeren» hører til på boligsiden, og den findes
   ikke endnu. Uden den kan en boligsøgende aldrig få sin første samtale. Kun
   `source_type = 'native'` — der er ingen at skrive til på en importeret
   bolig.
5. **Ruten `/beskeder`.** Modulet har ingen offentlig rute i dag; der er kun
   prøvevisningen, som 404'er uden `BESKEDER_PROEVE=1`. Ruten skal hente
   adgangstilstanden på serveren og give modulet en port, der kalder server
   actions.
6. **En vej ind til modulet.** Hverken den øverste bjælke eller Min side
   linker til beskeder. Layoutets egen note siger hvorfor der ikke bare kan
   hænges et link op: bjælken er statisk med vilje, og et ulæst-tal i toppen
   ville gøre hver eneste side dynamisk.
7. **RLS på `conversations` og `messages`** efterprøvet mod den rigtige
   Supabase. `public` eksponeres gennem PostgREST; en tabel uden RLS kan
   læses med den offentlige nøgle, og så er muren pynt.
8. **Skemakommentaren ved `messages`** siger stadig «skrivebeskyttet
   historik». Den er ikke rettet her, fordi databasen ligger uden for denne
   opgave — men den er i modstrid med beslutningen i afsnit 2 og bør med, når
   nogen alligevel rører `db/schema.ts`.

### 5.3 · Kendt, men ikke bygget

9. **Adresser pr. samtale.** Valget er i dag intern tilstand, ikke
   `/beskeder/<id>`. Det betyder, at en samtale ikke kan deles, bogmærkes
   eller nås med browserens tilbageknap. `Samtaleliste` tager `vaelg` som en
   prop netop for at gøre det til én ændring.
10. **Nye beskeder undervejs.** Der er ingen polling, ingen websocket og
    ingen notifikation. Tråden opdateres kun, når man selv sender.
11. **Moderation.** Beskederne er umodereret brugerindhold mellem to
    mennesker. Det er ikke det samme som alarmmailenes spamvej — de går ikke
    ud i fremmedes indbakker — men en rapportér-vej hører til, før modulet
    møder rigtige brugere.
12. **Vedhæftninger** findes ikke, og `messages.body` er ren tekst.

---

### 5.4 · ⚠ BLOKERENDE: `ukendt-tilstand` har ingen tekst i `Laast`

**Oplyst af Supply.** Deres funktion er

```ts
adgang(): Promise<'adgang' | Laasegrund | 'ukendt-tilstand'>
```

— kontraktens union **plus ét ord**. Det fjerde ord kan ikke udtrykkes i
de tre låsegrunde:

* «Log ind» er forkert over for en, der **er** logget ind.
* «Se abonnement» sender et menneske til kassen for **vores** fejl.

Det er ikke en manglende oversættelse. Der er ingen rigtig af de tre.

**Hvad der sker i dag, hvis ordet når frem.** `Laast` tager
`grund: Laasegrund`, og teksterne står i et `Record<Laasegrund, Tekst>`.
Et fjerde ord giver `undefined`, og `t.overskrift` **kaster**. Skulle
nogen «løse» det ved at udvide typen uden at tilføje en tekst, falder
`href`-udtrykket (`grund === 'login-kraevet' ? loginHref : abonnementHref`)
igennem til abonnementsruten — altså netop kassen, for vores egen fejl.
Den sikre fejl og den farlige ligger én linje fra hinanden.

**Der findes allerede et svar i repoet.** Kontaktrejsen mødte samme
spørgsmål og besvarede det: `tilLaasegrund` i
`app/kontakt-ui/server/handlinger.ts` oversætter `ukendt_tilstand` til
**ingen** låsegrund, og visningen viser den neutrale fejl med et
genforsøg — aldrig en pris, aldrig en abonnementsknap. Beskedmodulet
skal svare det samme; ellers giver de to flader forskellige svar på
samme tilstand, og det er CLAUDE.md's dyreste fejltype.

**Det, der mangler:** ikke en fjerde låsetekst, men en **femte
visning** — den neutrale «vi kunne ikke bekræfte din adgang, prøv
igen». En lås forklarer, hvad kunden skal gøre for at få adgang. Her
er der intet, hun kan gøre; fejlen er vores.

### Valget: `Beskedmodul` tager den bredere union — `Laasegrund` udvides IKKE

Supply har overladt valget til os. Svaret er den bredere union, og
grunden er ikke smag:

**1 · `ukendt-tilstand` er ikke en låsegrund.** En lås siger «du må
ikke», og den har altid en handling: log ind, køb, genaktivér. Det her
siger «vi ved det ikke», og der er intet, hun kan gøre. Kalder vi den
en låsegrund, lyver typenavnet — og det er typenavnet, den næste
udvikler læser.

**2 · `Laasegrund` er IKKE kun beskedmodulets.**
`app/kontakt-ui/kontrakt.ts:37-39` importerer og **gen-eksporterer**
den. Udvider vi unionen her, udvides kontaktrejsens kontrakt i samme
sekund — og dér er beslutningen allerede truffet den modsatte vej:
`tilLaasegrund` i `app/kontakt-ui/server/handlinger.ts` oversætter
`ukendt_tilstand` til **ingen** låsegrund, og
`scripts/test-kontaktmur.ts` efterprøver netop det. De to flader ville
komme til at modsige hinanden, og prøven ville fange det som en fejl i
kontaktrejsen — hvor fejlen slet ikke var.

**3 · Compilerens hjælp forsvinder ikke.** Indvendingen mod den brede
union er, at `Record<Laasegrund, …>` ellers tvinger hvert sted frem.
Den holder, hvis modulet tager imod `Adgangstilstand` og **narrower**
til `Laasegrund` ét sted — så peger compileren stadig på hvert
`Record`, og det ene sted, der skal håndtere det fjerde ord, er
synligt.

Formen:

```ts
// kontrakt.ts — Laasegrund er UÆNDRET
export type Laasegrund = 'login-kraevet' | 'abonnement-kraevet' | 'abonnement-udloebet'

/** Svaret fra adgangskontrollen. Ikke en låsegrund — en tilstand. */
export type Adgangstilstand = 'adgang' | Laasegrund | 'ukendt-tilstand'
```

`Laast` beholder `grund: Laasegrund` og bliver ved med at være
lås-visningen: én forklaring, ÉN knap. Den neutrale tilstand får sin
**egen** komponent uden knap.

**Hvorfor ikke bare en fjerde gren inde i `Laast`:** fordi `Laast`s
hele kontrakt er «forklaring + knap». En tilstand uden knap er ikke en
lås, og lægger vi den ind, står `href`-udtrykket
(`grund === 'login-kraevet' ? loginHref : abonnementHref`) stadig én
linje væk fra den. Den fælde lukkes ved at holde de to visninger
adskilt, ikke ved at huske på den.

**Teksten er allerede skrevet** — den står på boligsiden i dag,
`app/bolig/[id]/Kontakt.tsx` på `claude/betaling-og-adgangskontrol`:

> **Vi kan ikke bekræfte din adgang lige nu.**
> Prøv igen om lidt — det er en fejl hos os, ikke hos dig.

Ingen knap. Den skal genbruges ordret, ikke skrives om: det er samme
tilstand, og to formuleringer af den ville drive fra hinanden.

**Ikke bygget.** Noteret efter besked, bevidst udskudt. **`/beskeder`
må ikke gå i luften før den findes** — et kast i låst visning er
værre end den lås, den skulle erstatte.

## 6 · Hvad prøven måler — og hvad den ikke beviser

`scripts/cloud/beskedkontrol.mjs` læser den **rå `page.content()`** — hele
HTML-teksten, også det `display: none` ville gemme — og forlanger, at ingen
af seks tekststumper fra de syntetiske samtaler står i den, når modulet er
låst.

Prøven er efterprøvet i begge retninger:

* **Grøn** på den rigtige kode: ingen af de seks stumper findes.
* **Rød** på en udgave, hvor indholdet blev gengivet og skjult med
  `display: none`: `LÆKKET: Prøvegade 12, Mette Attrup, fællesvaskeri` på
  alle tre låste tilstande.

En prøve, der kun spurgte `isVisible()`, ville være grøn på præcis den fejl,
kravet findes for at forhindre.

**⚠ Men den måler prøvevisningens markup, og intet andet.** Der er ingen
server bag; porten er en attrap i hukommelsen, og et netværkssvar er ikke en
DOM. Målingen siger altså:

* **ja** til: brugerfladen gengiver ikke indhold i en låst tilstand, heller
  ikke skjult.
* **intet** om: hvad et rigtigt serverlag ville sende over ledningen.

Den påstand kan kun en prøve mod den rigtige serverintegration give — og den
skal måle **svaret**, ikke DOM'en: hent som en bruger uden adgang, og
efterprøv at kroppen ikke indeholder samtaler, uddrag eller beskeder. Det
hører til den opgave, der bygger serverlaget.
