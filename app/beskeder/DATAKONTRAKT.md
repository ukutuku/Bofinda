# Beskedmodulet — datakontrakt og det, der mangler

Brugerfladen er færdig og afprøvet. **Serverlaget findes ikke endnu**, og
modulet kan derfor ikke bruges af kunder. Her står præcis, hvad det skal
levere, og hvorfor formen er, som den er.

Typerne er den egentlige kontrakt og står i `app/beskeder/kontrakt.ts`.
Dette dokument forklarer dem.

---

## 1 · Den ene regel, der bærer resten

**Adgangsreglerne ejes af Supply. Komponenterne regner dem ikke.**

Der er ikke ét sted i `app/beskeder/`, hvor der står, om nogen har betalt,
hvornår et abonnement udløber, eller hvad der er gratis. Serverlaget
sender **én eksplicit visningstilladelse**, og brugerfladen adlyder den.

Det er derfor `Indbakke` og `Samtaletraad` er diskriminerede unioner og
ikke objekter med et `laast`-flag ved siden af indholdet:

```ts
export type Indbakke =
  | { tilstand: 'adgang'; samtaler: Samtalehoved[] }
  | { tilstand: Laasegrund }          // ← ingen samtaler. Feltet FINDES ikke.
```

I de låste varianter findes beskedfelterne ikke. En komponent kan ikke
komme til at gengive indhold, den ikke har fået, og «skjul det med CSS»
kan ikke skrives ned uden at slå typen fra. Kravet — *beskedindhold må
ikke blot skjules med CSS* — står altså i typen og ikke i en aftale,
nogen skal huske.

**Serverlaget skal returnere `{ tilstand: 'login-kraevet' }` uden
`samtaler`.** Ikke et tomt array, ikke et flag ved siden af indholdet.
Kompilatoren håndhæver det, og `scripts/cloud/beskedkontrol.mjs` måler
det bagefter på den rå HTML (se afsnit 6).

---

## 2 · De fire tilstande

| `tilstand` | Hvornår | Hvad brugeren ser |
|---|---|---|
| `adgang` | Supply siger ja | Listen og tråden |
| `login-kraevet` | Ingen session | «Log ind for at se dine beskeder» + knappen **Log ind** |
| `abonnement-kraevet` | Har aldrig haft abonnement | «Beskeder kræver abonnement» + **Se abonnement** |
| `abonnement-udloebet` | Har haft et | «Dit abonnement er udløbet» + **Genaktivér** |

De to sidste er skilt ad med vilje: det er to forskellige situationer for
den, der står i dem, og de får derfor forskellig tekst og forskelligt
knapnavn. **Teksterne bor i brugerfladen** (`Laast.tsx`), ikke i
serverlaget — serveren sender ét ord fra en union, brugerfladen skriver
sætningen. Sendte serveren selve teksten, ville brugervendt dansk ligge
spredt over to lag, og den ene kopi ville blive rettet uden den anden.

**Ingen pris nogen steder i modulet.** Prisen ejes af Supply og ville
blive forkert den dag, den ændrer sig ét sted.

---

## 3 · Skrivning er en selvstændig tilladelse

```ts
export type Skrivetilstand = 'kan-skrive' | 'skrivebeskyttet'
```

Skemaets egen note siger det: *«Spær ved AFSENDELSE, server-side. Udløbet
abonnement betyder skrivebeskyttet historik — slet aldrig beskeder.»*

Derfor er `skriv` et selvstændigt felt på `Samtaletraad` og ikke en
afledning af `tilstand`. Supply kan give læseadgang til historikken uden
at give skriveadgang, og brugerfladen kan vise begge dele uden at gætte,
hvilken regel der gjaldt. Ved `skrivebeskyttet` er der intet skrivefelt i
DOM'en — ikke et slukket felt.

**Spærringen skal håndhæves igen ved afsendelse.** `skriv` er en
visningstilladelse, ikke en adgangskontrol: adgangen kan være ændret,
siden tråden blev hentet. `send()` må derfor svare `{ ok: false, fejl:
'laast' }`, og brugerfladen viser «Din adgang er ændret, mens du skrev.
Genindlæs siden.»

---

## 4 · Grænsefladen, serverlaget skal opfylde

```ts
export interface Beskedport {
  hentIndbakke(signal?: AbortSignal): Promise<Indbakke>
  hentTraad(samtaleId: string, signal?: AbortSignal): Promise<Samtaletraad>
  send(samtaleId: string, tekst: string): Promise<Sendesvar>
  markerLaest(samtaleId: string): Promise<void>
}
```

Komponenterne kalder aldrig `fetch` eller en server action direkte. De får
en port ind. Det er dét, der gør modulet afprøvbart med syntetiske
samtaler uden et midlertidigt produktions-API — og det, der gør den
rigtige serverintegration til **én fil**.

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

### Tre ting, der er lette at gøre forkert

1. **`uddrag` skal forkortes af serveren.** Sendte vi hele beskeden og
   klippede med `text-overflow`, ville hele teksten stå i markuppen — samme
   fejl som at skjule et låst indhold med `display: none`.
2. **Svaret skal være en kopi, ikke en levende reference.** Modulet regner
   med at eje det, det får, og lægger nye beskeder i med
   `[...beskeder, ny]`. Attrappen udleverede først sin egen liste, og så
   stod den sendte besked to gange. Et serverlag, der serialiserer, har
   ikke problemet — men en in-process implementering har.
3. **`MAKS_TEGN` (2000) står i `kontrakt.ts` og skal bruges begge steder.**
   Tælleren i skrivefeltet og serverens afvisning svarer på det samme
   spørgsmål. To tal ville drive fra hinanden, og brugeren ville se et
   felt, der sagde god for en tekst, serveren kastede væk. Se CLAUDE.md:
   *«Svarer to udtryk på det samme spørgsmål, skal de beregnes ét sted.»*

---

## 5 · Det, der mangler, før modulet kan bruges af kunder

Rækkefølgen er den, tingene spærrer for hinanden i.

### 5.1 · Fra Supply

1. **En funktion, der afgør adgangstilstanden** for den aktuelle bruger:
   `adgang(): Promise<'adgang' | Laasegrund>`. Den skal kende sessionen,
   abonnementets status og gyldighedsdato — alt sammen Supplys.
2. **Ruten til abonnement/genaktivering.** `Beskedmodul` kræver
   `abonnementHref` og har med vilje **ingen** standardværdi: en knap, der
   peger på en rute, der ikke findes, er værre end ingen knap. I dag findes
   ruten ikke, og prøvevisningen sender en synlig attrap
   (`#abonnementsruten-leveres-af-supply`).
3. **Beslutningen om, hvad `abonnement-udloebet` betyder for læsning.**
   Skemaet siger «skrivebeskyttet historik». Opgaven siger, at låst adgang
   ikke må udlevere indhold. Begge dele kan lade sig gøre i kontrakten —
   `{ tilstand: 'abonnement-udloebet' }` (intet indhold) eller
   `{ tilstand: 'adgang', skriv: 'skrivebeskyttet' }` (historik, ingen
   skrivning) — og **valget er Supplys, ikke brugerfladens.**

### 5.2 · Serverlaget for beskeder

4. **Fire server actions eller en rute, der opfylder `Beskedport`.**
   Tabellerne findes allerede i `db/schema.ts` (`conversations`,
   `messages`) og er ikke rørt i denne opgave.
   - `hentIndbakke` — samtaler hvor brugeren er `tenantId` eller
     `landlordId`, sorteret på `lastMessageAt`, med `ulaeste` talt af
     `messages.readAt is null and senderId <> mig`.
   - `hentTraad` — beskederne på `conversationId`, og **ejerskabet
     efterprøvet i selve forespørgslen**. En samtale, der ikke er
     brugerens, skal svare `{ tilstand: 'findes-ikke' }` — samme svar som
     en, der ikke findes, så eksistensen ikke kan aflæses.
   - `send` — indsæt beskeden, opdatér `conversations.lastMessageAt`.
     Spær ved afsendelse, server-side, som skemaet siger.
   - `markerLaest` — `messages.readAt = now()` for modpartens ulæste.
5. **Oprettelsen af en samtale.** Modulet viser samtaler; det starter dem
   ikke. Knappen «Skriv til udlejeren» hører til på boligsiden, og den
   findes ikke endnu. Uden den kan en boligsøgende aldrig få sin første
   samtale. Kun `source_type = 'native'` — der er ingen at skrive til på en
   importeret bolig.
6. **Ruten `/beskeder`.** Modulet har ingen offentlig rute i dag; der er
   kun prøvevisningen, som 404'er uden `BESKEDER_PROEVE=1`. Ruten skal
   hente adgangstilstanden på serveren og give modulet en port, der kalder
   server actions.
7. **En vej ind til modulet.** Hverken den øverste bjælke eller Min side
   linker til beskeder. Layoutets egen note siger hvorfor der ikke bare
   kan hænges et link op: bjælken er statisk med vilje, og et
   ulæst-tal i toppen ville gøre hver eneste side dynamisk.
8. **RLS på `conversations` og `messages`** efterprøvet mod den rigtige
   Supabase. `public` eksponeres gennem PostgREST; en tabel uden RLS kan
   læses med den offentlige nøgle, og så er muren pynt.

### 5.3 · Kendt, men ikke bygget

9. **Adresser pr. samtale.** Valget er i dag intern tilstand, ikke
   `/beskeder/<id>`. Det betyder, at en samtale ikke kan deles, bogmærkes
   eller nås med browserens tilbageknap. `Samtaleliste` tager `vaelg` som
   en prop netop for at gøre det til én ændring.
10. **Nye beskeder undervejs.** Der er ingen polling, ingen websocket og
    ingen notifikation. Tråden opdateres kun, når man selv sender.
11. **Moderation.** Beskederne er umodereret brugerindhold mellem to
    mennesker. Det er ikke det samme som alarmmailenes spamvej — de går
    ikke ud i fremmedes indbakker — men en rapportér-vej hører til, før
    modulet møder rigtige brugere.
12. **Vedhæftninger** findes ikke, og `messages.body` er ren tekst.

---

## 6 · Hvordan låsningen er efterprøvet

`scripts/cloud/beskedkontrol.mjs` læser den **rå `page.content()`** — hele
HTML-teksten, også det `display: none` ville gemme — og forlanger, at
ingen af seks tekststumper fra de syntetiske samtaler står i den, når
modulet er låst.

Prøven er efterprøvet i begge retninger:

- **Grøn** på den rigtige kode: ingen af de seks stumper findes.
- **Rød** på en udgave, hvor indholdet blev gengivet og skjult med
  `display: none`: `LÆKKET: Prøvegade 12, Mette Attrup, fællesvaskeri` på
  alle tre låste tilstande.

En prøve, der kun spurgte `isVisible()`, ville være grøn på præcis den
fejl, kravet findes for at forhindre.
