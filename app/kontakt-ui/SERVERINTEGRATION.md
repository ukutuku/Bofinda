# Kontaktrejsen — hvad der mangler, før kunder kan bruge den

Brugerfladen er færdig og afprøvet mod en attrap. **Serverlaget findes
ikke**, og rejsen er ikke tilsluttet nogen produktionsrute: den lever kun
på `/kontakt-ui/proeve`, som svarer 404 uden `KONTAKT_PROEVE=1`.

Kontrakten er `app/kontakt-ui/kontrakt.ts`. Her står, hvad der skal til.

---

## 1 · Fra Supply

| # | Hvad | Hvorfor |
|---|---|---|
| 1.1 | **Adgangsbeslutningen pr. bolig**: en funktion, der for den aktuelle bruger og ét bolig-id svarer `adgang` / `login-kraevet` / `abonnement-kraevet` / `abonnement-udloebet`. | Brugerfladen afgør ingenting selv. Den kender ikke gratis fra betalt og skal ikke kunne det. |
| 1.2 | **Samtaleadgangen som et selvstændigt svar**: `kan-starte` / `i-gang` / `kraever-login`. | I gratis tilstand kan kontaktoplysningerne være åbne, mens en samtale kræver en konto. Login skal stå dér, hvor funktionen kræver det — og kun der. |
| 1.3 | **`ophoerer`** når en adgang er opsagt men løber videre. ISO 8601. | Rejsen viser datoen. Den **regner ikke** på den: adgangen er allerede afgjort af `tilstand`. `cancelAtPeriodEnd` + `currentPeriodEnd` hører til hos Supply. |
| 1.4 | **Abonnementsruten.** `Rejse` kræver `abonnementHref` og har med vilje ingen standardværdi. | En knap, der peger på en rute, der ikke findes, er værre end ingen knap. I prøven er den den synlige attrap `#abonnementsruten-leveres-af-supply`. |
| 1.6 | **Adgangsbeslutningen gælder OGSÅ eksterne annoncer.** Supply skal svare for en bolig fra home.dk, CEJ eller Propstep på præcis samme måde som for en udlejerannonce. | Brugerfladen spurgte før slet ikke for dem — den havde sin egen regel om, at «kildens link er offentligt, så det er altid åbent». Det er en betalingsregel, og den er ikke vores. Svarer Supply `adgang`, vises vejen videre; svarer den en låsegrund, står låsen og vejen videre er **væk**. |
| 1.7 | **`/go/<id>` har en statusvagt, men ingen adgangsvagt.** Ruten har `eq(listings.status, 'active')` i sit `where`-led og afviser en tilbagetrukket bolig med 404. Den spørger derimod ikke om KUNDENS adgang. | At panelet skjuler linket, er ikke en spærring: adressen kan dannes ud fra et bolig-id og kaldes direkte. Skal punkt 1.6 betyde noget for en betalende kunde, skal ruten stille det samme spørgsmål som panelet. Gør den ikke det, er 1.6 en kunderejse — ikke en mur. |
| 1.8 | **Beslut, om boligsiden skal følge med.** `app/bolig/[id]/page.tsx` viser i dag det eksterne link UBETINGET, uden noget adgangsopslag. | Det er den shippede adfærd, og den er i tråd med CLAUDE.md: «en scrapet bolig har en kilde at henvise til, og der linker vi». Efter 1.6 spørger rejsen — men boligsiden gør ikke. Tilsluttes rejsen uden at tage stilling, siger de to sider forskelligt om den samme bolig. **Det er en produktbeslutning, ikke en fejl**, og den hører til hos Supply. |
| 1.5 | **Prisforløbets tal.** `PRISFORLOEB` står i dag som én konstant i `kontrakt.ts`. | Tallene er Supplys, og de skal komme samme sted fra som det, Stripe fakturerer. Ellers kan sætningen og regningen komme fra hinanden. **Sætningen må aldrig deles i to** — «9 kr.» alene er sandt i 24 timer og vildledende bagefter. |

---

## 2 · Serverlaget for kontakt

### 2.1 · `hentAdgang(boligId)`

Skal kontrollere adgangen for den aktuelle bruger ved **hvert** kald og
bygge svaret eksplicit. Den låste variant har hverken `kontakt` eller
`samtale` — og det skal være, fordi svaret er **bygget uden dem**, ikke
fordi en type siger det. Se advarslen i `kontrakt.ts` og den tilsvarende
i `app/beskeder/DATAKONTRAKT.md` afsnit 1: typerne er udviklerhjælp, ikke
autorisation, ikke filtrering og intet bevis for, at private data ikke
forlader serveren.

### 2.2 · `hentKontakt(boligId)` — og adgangen skal tjekkes IGEN

`hentAdgang` gav en visningstilladelse, ikke en adgangskontrol. Adgangen
kan være ændret siden. Kaldet skal derfor:

* kontrollere adgangen på ny,
* kontrollere at boligen er `source_type = 'native'` og `active` — det
  gør `app/bolig/[id]/kontakthandling.ts` allerede, i selve `where`-leddet,
* og afvise uden at udlevere noget.

Attrappen **opfører sig allerede sådan**: `hentKontakt` kaster, når
scenariet ikke er `adgang`. Ellers ville prøven vænne os til et
serverlag, der ikke gør.

> Adressen må aldrig ligge i `hentAdgang`-svaret. CLAUDE.md:
> *«Mailadresser står aldrig som rå tekst på en offentlig side.»*
> Derfor er `kontakt` to booleans, og værdierne kommer først, når et
> menneske trykker.

### 2.3 · `startSamtale(boligId)`

Skal spærre server-side. Er adgangen ændret, svares
`{ ok: false, grund: <Laasegrund> }`, og rejsen låser hele panelet. En
teknisk fejl er `{ ok: false, grund: 'fejl' }` — **aldrig** en låsning,
for så ville en fejl hos os blive til en opfordring til at betale.

Samtalen skal oprettes med ejerskabet på plads (`tenantId`,
`landlordId`, `listingId`), og kun for `source_type = 'native'`: der er
ingen at skrive til på en importeret bolig.

### 2.4 · Ejerskab i `where`-leddet

En samtale skal tilhøre brugeren som `tenantId` eller `landlordId`, og
kravet hører til i forespørgslen — ikke i en kontrol bagefter. En
samtale, der ikke er brugerens, skal svare som en, der ikke findes.

### 2.5 · RLS

`conversations` og `messages` skal have Row Level Security efterprøvet
mod den rigtige Supabase. `public` eksponeres gennem PostgREST; en tabel
uden RLS kan læses med den offentlige nøgle, og så er muren pynt.

---

## 3 · I beskedmodulet

**Forvalg af samtale.** `Samtaleadgang.i-gang` bærer et `samtaleId`, og
serveren har det — men `Beskedmodul` tager kun
`{ port, loginHref, abonnementHref }` og har ingen prop til en forvalgt
samtale. «Åbn beskeder» åbner derfor **indbakken**, ikke tråden.

Handlingen hedder med vilje «Åbn beskeder» og ikke «Åbn samtalen»:
knappen lover dét, den gør. Skal den love mere, er det én prop i
beskedmodulet — og det er modulets egen opgave, ikke kontaktrejsens.

---

## 4 · Tilslutning til produktet

Intet af det her er tilsluttet. Før det kan bruges:

1. **Boligsiden** (`app/bolig/[id]/page.tsx`) skal kalde adapteren og
   gengive `Kontaktpanel` i stedet for den nuværende `Kontakt`-boks.
   Den eksisterende boks har ingen adgangstilstand i kontrakten i dag.
2. **En rute til samtalen.** Rejsen viser indbakken på siden; produktet
   skal beslutte, om den skal ligge på boligsiden eller på `/beskeder`
   (som heller ikke findes endnu — se `app/beskeder/DATAKONTRAKT.md`).
3. **Målingen.** Boligsiden måler i dag `contact_reveal` og `source_click`.
   Rejsen måler **ingenting** — der er ingen `meld()`-kald i
   `app/kontakt-ui/`. Skal den måle, er det en bevidst tilføjelse, og
   den skal følge de eksisterende regler: kun **at** der blev trykket,
   aldrig adressen.
4. **Prøveruten fjernes eller bliver.** `/kontakt-ui/proeve` er
   måleudstyr. Den svarer 404 uden `KONTAKT_PROEVE=1`, og variablen står
   ikke i deploykonfigurationen.

---

## 5 · Hvad prøven måler — og hvad den ikke beviser

`scripts/cloud/kontaktkontrol.mjs` læser den rå markup for rejsen og
forlanger, at hverken mailadresse, telefonnummer (i **begge** former —
vist og i `tel:`-href'en) eller beskedtekst står der, når adgangen er
lukket. Den måler også overgangen: oplysninger, der ER afsløret, skal
være væk igen, når adgangen lukker.

**Men den måler prøvevisningens markup.** Der er ingen server bag,
adapteren er en attrap i hukommelsen, og et netværkssvar er ikke en DOM.
Den siger:

* **ja** til: brugerfladen gengiver ikke privat indhold i en låst
  tilstand, og en teknisk fejl fører ikke til betaling;
* **intet** om: hvad et rigtigt serverlag ville sende over ledningen.

Den påstand kan kun en prøve mod den rigtige serverintegration give, og
den skal måle **svaret**, ikke DOM'en.

### 5.1 · Kapløbene måles to steder, og ingen af dem er nok alene

Rækkefølgefejlen (K2) kan ikke ses i en enkelt tilstand — panelet er
rigtigt i hver af dem og forkert alligevel, fordi to svar var undervejs
samtidig.

* **Browserkontrollen** fremprovokerer kapløbet gennem `«Prøv igen»`:
  to tryk, hvor det ældste svar lander sidst. Det er den rigtige måling,
  fordi den går gennem brugerfladen — men den når kun de kapløb, en knap
  kan udløse.
* **`scripts/cloud/rejseprobe.mjs`** kører `Rejse`s callbacks direkte og
  dækker de to, der ikke kan trykkes frem: en lås fra `startSamtale`
  mens et adgangsopslag er undervejs, og at en **ny** gyldig adgang
  stadig kan åbne et låst panel. Begge er ægte — et skift af
  `annonce`-proppen eller en senere genhentning udløser dem — men
  panelet har ingen genforsøgsknap i de tilstande.

Proben er **ikke** React og ikke en browser. Den måler callback-adfærd,
ikke gengivelse, markup eller fokus, og den beviser ingen
serverbeskyttelse. Brækkes udtrækket af en omskrivning, **afviser den
med exit 2** — et loadernedbrud må aldrig kunne læses som et grønt
resultat.

---

## 6 · Registreret under rettelsesrunden — IKKE rettet her

Fundet under gennemgangen af K1/K2/K3 og bevidst holdt uden for den
runde, fordi opgaven bad om en afgrænset rettelse. De er skrevet ned med
den konkrete rettelse, så næste runde er billig.

### 6.1 · `hentKontakt` har ingen kanal til at sige «adgangen er lukket» — mellem

Punkt 2.2 gør en adgangskontrol ved hvert `hentKontakt` obligatorisk.
Men signaturen er `Promise<Kontaktoplysninger>`, så et nej kan kun
udtrykkes som en **afvist Promise** — og panelet oversætter enhver
afvisning til «Oplysningerne kunne ikke hentes. Prøv igen.» Altså
præcis den sammenblanding af *teknisk fejl* og *ingen adgang*, som hele
resten af rejsen er bygget for at undgå, bare ét niveau nede.

Retningen at fejle i er den sikre — en lukket adgang bliver til en
neutral fejl og ikke til en betalingsopfordring — men brugeren får
noget at vide, der ikke er sandt.

**Rettelse:** giv `hentKontakt` samme form som `startSamtale`:
`{ ok: true; ... } | { ok: false; grund: Laasegrund } | { ok: false; grund: 'fejl' }`.
Så kan panelet låse på en låsegrund og kun sige «vores fejl», når det
er vores fejl.

### 6.2 · To svar på «har hun oplyst en mail?» — mellem

`harMail`/`harTelefon` kommer fra `hentAdgang`; `mail`/`telefon` kommer
fra `hentKontakt`. To kald, to svar, ét spørgsmål — CLAUDE.md's
«svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted».

Svarer boolen `true` og værdien `null`, står der «Udlejeren har oplyst
mailadresse», knappen forsvinder efter trykket, og `Oplysninger`
gengiver en **tom** `<dl>`. Brugeren står med ingenting og ingen
forklaring.

**Rettelse:** lad `Oplysninger` sige det, når begge er null, og lad
serverlaget bygge begge svar af samme forespørgsel.

### 6.3 · De afslørede kontaktlinks er under 44 px — lav

`.kui-handling` og `.kui-sekundaer` har `min-height: 44px` i
`kontakt-ui.css`. Men mail- og telefonlinket arver `.kontaktliste a`
fra `app/globals.css` — 15 px indlejret tekst uden polstring, ca. 20 px
høj, med 8 px luft imellem. På en telefon er et tryk på nummeret lige
så sandsynligt at ramme mailen.

**Rettelse:** giv dem en trykflade i `kontakt-ui.css`. `globals.css`
er fælles og rørte denne opgave ikke.

### 6.4 · `vis()` har hverken monterings- eller anmodningsvagt — lav

Samme familie som K2, men i `Kontaktpanel`. To hurtige tryk sender to
`hentKontakt`-kald, og det sidst ankomne vinder. I dag reddes den af
`key` på panelets tilstand; det er en bivirkning, ikke en vagt.

**Modargument, værd at kende:** `key` gør faktisk arbejdet, og en
dobbeltklikket knap koster to `hentKontakt`-kald og ikke et forkert
resultat. Fundet blev derfor afvist i den adversariske efterprøvning
som en smagssag. Det står her alligevel, fordi rettelsen er billig og
fordi en vagt, der virker ved et uheld, holder op med at virke, når
nogen fjerner `key`.

**Rettelse:** samme billetnummer som i `Rejse`, plus en spærre mens
kaldet er undervejs.

### 6.5 · Fokus flyttes ikke, når en knap erstattes af sit resultat — lav

Trykker en tastaturbruger «Vis kontaktoplysninger», forsvinder knappen
og listen kommer. Fokus falder til `<body>`, og det permanente
live-område i `Rejse` er tomt på det tidspunkt. Samme mønster, når
«Skriv til udlejeren» bliver til beskedafsnittet — dér flyttes fokus
korrekt, så retningen er kendt.

**Rettelse:** flyt fokus til listen, og skriv en linje i det
permanente live-område i stedet for at indsætte et nyt `role="status"`
sammen med sin egen tekst (et live-område, der fødes med sit indhold,
annonceres upålideligt).

### 6.6 · Overskriftsniveauerne beskriver ikke strukturen — lav

`h1` → `h2` annonce → **`h3`** kontaktpanel → `h2` «Beskeder» →
`h2` beskedmodulets egne. Kontaktpanelet ser ud som en del af
boligannoncen, og modulets overskrifter som sideordnede med «Beskeder»
i stedet for som dens indhold.

### 6.7 · To porte svarer uafhængigt på «har hun adgang?» — mellem

`Kontaktsvar.tilstand` og beskedmodulets egen `Indbakke.tilstand`
hentes af hver sin port uden noget, der forener dem, og kan gengives i
samme forløb. Svarer kontaktporten `adgang` og beskedporten
`abonnement-kraevet`, trykker brugeren «Åbn beskeder» og møder en lås,
hun lige har fået at vide, hun ikke havde. Hører til i serverlaget:
begge porte skal bygge deres svar af samme beslutning.

### 6.8 · Attraptelefonnummeret er ikke en reserveret prøveserie — lav

Se noten i `proeve/attrap.ts`. `+45 20 00 00 00` er opdigtet af os, men
20-serien er en almindelig dansk mobilserie og kan være tildelt en
rigtig abonnent. Skal skiftes til noget beviseligt ikke-tildeleligt,
før prøvevisningen bruges i materiale, andre ser.

### 6.9 · Samme forkerte StrictMode-påstand står i beskedmodulet — lav

`app/beskeder/proeve/Proeve.tsx` bærer på denne gren den samme
slutning, K3 retter her: at manglende `reactStrictMode` betyder, at
Next 15 ikke slår StrictMode til. Efter det oplyste er den allerede
rettet på kandidatgrenen (`9387f85`, `df15d65`), så den rettes **ikke**
her — to rettelser af samme linje ville kollidere ved integration.
