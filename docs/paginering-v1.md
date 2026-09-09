# Paginering v1 — hvad den kan, og hvad den ikke kan

Søgesiden og områdesiderne har `Forrige · sidetal · Næste`. Før kunne kun
de første 48 kort nås; resten af udbuddet var utilgængeligt.

Kontrakten står i `app/Sider.tsx` og `lib/soeg.ts`, og prøves af afsnit
11–12G i `scripts/test-soegning.ts` samt af
`scripts/cloud/browserkontrol-pagination.mjs` i en rigtig browser.

## URL-kontrakten

    ?side=N     N ∈ [1, 9999], regex ^[1-9][0-9]{0,3}$
    fravær      → side 1, og links til side 1 udelader parameteren

`side` når **aldrig** `filtreFraParametre`, og dermed hverken `Filtre`,
`harFiltre`, `antalFiltre`, `filterDiff`, `hvor()` eller en gemt
boligalarms kriterier. `/?side=2` alene er stadig forsiden.

## De tre tilstande, der skal kunne skelnes

Et tomt sideudsnit er ikke ét svar, men tre — og de må aldrig blandes:

| Tilstand | Hvad brugeren ser | Måling |
|---|---|---|
| Ingen boliger matcher | «Ingen boliger matcher» | `empty_results` |
| Sidetal uden for rækkevidde | «Side N findes ikke. Søgningen har M sider» | **intet** `empty_results` |
| Ufuldstændig gennemgang | «Vi nåede ikke hele udbuddet igennem — mindst N sider» | `komplet: false` |

`empty_results` afgøres af `sum.antal` fra `opsummering()` — den eksakte
optælling, uden loft og uafhængig af hvilken side der bedes om. Et
sidetal uden for rækkevidde kan derfor aldrig udløse den.

## Indeksering

**Gyldige sider beholder self-canonical.** Pegede side 2 og frem alle på
side 1, ville hver side erklære sig selv en dublet, og boligerne længere
inde kunne falde ud af indekset — netop dem, pagineringen findes for at
gøre nåbare.

**En områdeside efter sidste gyldige side er ikke en resultatside.** Den
svarer stadig `200` og beholder sin forklaring, fordi et menneske, der
lander der, skal kunne se hvad der skete og komme videre. Men den er
`noindex, follow` og har **ingen** canonical — hverken sig selv eller
side 1. En self-canonical ville erklære en tom side kanonisk; en
canonical til side 1 sammen med `noindex` sender to modstridende
signaler, og risikoen er, at noindex'et smitter af på den side, der
peges på. Det utvetydige er at sige én ting: indeksér mig ikke.

`generateMetadata` og siden deler ét søgekald gennem React's `cache()`,
så metadata kan vide, om sidetallet er uden for rækkevidde, **uden** en
ekstra forespørgsel.

## Kendte begrænsninger i v1

Begge er bevidste. De skal stå her, indtil de er væk — ikke opdages af
den næste, der læser tallene.

### 1 · Kandidatværnet: 50.000 grupper

`PARTI = 2000` × `MAKS_PARTIER = 25` er et **loft på 50.000
kandidatgrupper**, ikke en uendelighed. Gennemgangen må ikke beskrives
som ubegrænset.

Bestanden er 986 grupper i dag — 50 gange hovedrum — og nås i ét parti.
Men hovedrum er ikke det samme som ingen grænse. Rammes loftet, ved hele
kæden det: `komplet` er falsk, sidetallet er et **mindstetal**, og
pageren skriver «der er mindst N sider» i stedet for at lade tallet stå
som en total. Der tilbydes aldrig en side ud over dem, der faktisk er
fundet.

Afsnit 12G i `scripts/test-soegning.ts` sænker loftet med
`_saetGruppeloft()` og fælder hvert af de tre led hver for sig. Grænsen
kan kun sænkes af prøver, aldrig af konfiguration: en grænse, ingen har
set fyre, er ingen grænse.

### 2 · Intet fast snapshot mellem sideskift

Importen kører hver time. Skifter bestanden mellem to sideskift, kan en
bolig i teorien nå at flytte sig mellem to sider — så en enkelt kan blive
set to gange eller slet ikke.

Der er **ikke** et fast snapshot pr. søgning i v1, og det er et bevidst
valg: et snapshot ville kræve enten en gemt søgetilstand pr. bruger eller
et tidsstempel-filter, der gør søgningen forældet, mens hun bladrer.
Rækkefølgen er til gengæld deterministisk inden for ét datasæt —
`GRUPPEORDEN` ender altid på et entydigt led — så uden en importkørsel
imellem er alle sider stabile. Det er dét, afsnit 12 i
`scripts/test-soegning.ts` måler for hver af de seks sorteringer.

## Analytics

`search_submitted` er en **observeret** formularindsendelse. Serveren kan
ikke se forskel på en indsendelse og et klik på «Næste» — begge er en
GET-navigation med de samme headere — så handlingen observeres dér, hvor
den sker, eller slet ikke.

Efter «Tillad statistik» genindlæser banneret ruten
(`window.location.reload()` i `app/Samtykke.tsx`). Uden det tabtes den
**første** søgeindsendelse: server action'en sætter kun samtykkecookien,
mens `bofinda_aid` og `bofinda_sid` sættes af middleware ved næste
request — og `maalingstilstand()` kræver begge. Siden stod derfor tilbage
med `aktiv: false`, klientlytterne var aldrig koblet på, og indsendelsen
nåede ikke engang køen. Den var ikke forsinket; den var væk.

**To forsøg, og kun det andet holdt.** Først en `router.refresh()`:
cookierne kom med det samme, men genrenderingen med `aktiv: true` kom
senere. Vinduet blev målt til **500–1000 ms efter at cookien var sat**, og
en indsendelse i det vindue var stadig tabt:

| Pause efter at cookien var sat | `search_submitted` |
|---|---|
| 0 ms | 0 |
| 250 ms | 0 |
| 500 ms | 0 |
| 1000 ms | 1 |
| 2000 ms | 1 |

En rettelse, der virker, hvis brugeren er langsom nok, er ikke en
rettelse. En fuld genindlæsning lukker vinduet: det nye dokument renderes
på serveren MED identiteten, `aktiv` beregnes rigtigt — tændknappen
`MAALING_AKTIV` respekteres stadig — og lytterne kobles på under helt
almindelig hydrering. Tilbage er kun det hydreringsvindue, enhver
sideindlæsning har, og det er ikke noget samtykket indfører.

Det er en **genindlæsning, ikke en omdirigering**: `location.reload()`
bruger den adresse, der allerede står i linjen. Der er intet mål at
validere, ingen vej til et åbent redirect, intet at loope i, og brugerens
sti, filtre og sidetal er præcis de samme bagefter.

**En gentagen indsendelse med de samme filtre er en ny indsendelse** —
også når den navigerer til præcis den samme adresse. Browserkontrollen
udøver netop det tilfælde og fælder, hvis det ikke længere sker.

`position` på `listing_impression` er **global**: `(side − 1) × 48 + i +
1`. Side 2 begynder ved 49, ikke ved 1.
