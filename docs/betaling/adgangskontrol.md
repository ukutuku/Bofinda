# Den centrale adgangskontrol

Grænsefladen, alle betalte funktioner skal bruge. **Skriv aldrig dit eget
prædikat over `drift` + `subscriptions`** — to udtryk for det samme
spørgsmål driver fra hinanden, og begge ser rigtige ud hver for sig.

## Til beskedmodulet

```ts
import { FUNKTION, maaBruge } from '../lib/adgang'

const svar = await maaBruge(FUNKTION.beskeder)
if (!svar.ok) {
  // svar.grund: 'login_kraeves' | 'abonnement_kraeves' | 'ukendt_tilstand'
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
| udløbet | nægtes — beskederne slettes ikke |

Ved udløb låses læsning og afsendelse. `maaBruge` siger kun *om* der er
adgang; at beskederne **bevares**, er visningens ansvar at sige.

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

`scripts/test-betaling.ts` afsnit 9 læser kildeteksten på hvert
kaldested og fejler, hvis vagten forsvinder. Tilføj dit kaldested der.

Kildelæsningen er en **supplerende** kontrol, ikke prøven. Den kan ikke
se, om vagten faktisk fyrer — kun at den står der. Købsvejens egen
kontrol i samme afsnit kalder derfor `startKoebFor()` og måler, at
GRATIS-afvisningen sker **før** noget eksternt kald. Skriv din prøve
sådan, hvis du kan.

---

## Webhookens udfald (tilføjet efter gennemgangen)

`behandl()` svarer med ét af seks udfald. Beskedmodulet rører dem ikke,
men de hører til kontrakten, fordi de afgør, hvornår adgang opstår:

| Udfald | Betydning | Markeres færdig? | HTTP |
|---|---|---|---|
| `behandlet` | anvendt | ja | 200 |
| `gentagelse` | set og færdigbehandlet før | — | 200 |
| `ignoreret` | ikke en hændelse, vi lytter på | ja | 200 |
| `forael` | adgangen flyttede sig ikke | ja | 200 |
| **`i_gang`** | en anden behandler har kravet | **nej** | **409** |
| **`afventer`** | gyldig, men forudsætningen mangler | **nej** | **409** |

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
