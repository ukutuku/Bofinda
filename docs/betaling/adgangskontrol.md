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

---

## Webhookens udfald (tilføjet efter gennemgangen)

`behandl()` svarer med ét af seks udfald. Beskedmodulet rører dem ikke,
men de hører til kontrakten, fordi de afgør, hvornår adgang opstår:

| Udfald | Betydning | Markeres færdig? |
|---|---|---|
| `behandlet` | anvendt | ja |
| `gentagelse` | set og færdigbehandlet før | — |
| `i_gang` | en anden behandler har kravet | — |
| `ignoreret` | ikke en hændelse, vi lytter på | ja |
| `forael` | ældre end det, rækken bærer | ja |
| **`afventer`** | gyldig, men forudsætningen mangler | **nej** |

`afventer` er den vigtige. En `invoice.paid`, der overhaler sin
`checkout.session.completed`, må ikke markeres færdig — gør man det,
giver genleveringen `gentagelse`, og den betalte periode er tabt.

**Adgang opstår ét sted: `invoice.paid`.** Vagten dér er MONOTON —
`adgang_til` flyttes kun frem. En sent ankommen faktura kan ikke
forkorte en betalt periode, og en faktura i uorden kan stadig forlænge
den. Det fælles `stripe_opdateret_at`-filter bruges bevidst **ikke** på
adgangen: det beskytter statusspejlingen, og en nyere
`subscription.updated` ville ellers få en gyldig betaling afvist.
