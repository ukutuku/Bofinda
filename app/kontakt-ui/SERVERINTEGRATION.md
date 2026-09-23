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
