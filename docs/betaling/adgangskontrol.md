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
