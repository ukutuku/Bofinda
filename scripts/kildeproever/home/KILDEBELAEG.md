# Home: feltbelæg til Supply

Hentet 15. september 2026 fra to offentlige Home-detaljesider via almindelige HTTPS GET-kald. Ingen import, databaseændringer eller ændringer af Bofinda-koden.

## Verificeret feltmapping

| Bofinda RawListing | Home, fra sagens eget objekt | Enhed |
| --- | --- | --- |
| deposit | offer.rentalSecurityDeposit.amount | kroner i kilden; konvertér til øre |
| prepaidRent | offer.rentalPricePrePaid.amount | kroner i kilden; konvertér til øre |
| rooms | stats.rooms | antal |

Begge sager havde præcis ét objekt med matchende id og offer. Beløbene er direkte kildeværdier, ikke udledt af huslejen. Ingen samlet indflytningspris er beregnet.

## Filer og metode

`feltbelaeg.json` indeholder URL, sagstype, tidspunkt, SHA-256 og de observerede værdier.

De to `*-nuxt-minimal.json` er reducerede kopier af de hentede Nuxt-arrays. Sagens id, de fire anførte økonomifelter (inkl. husleje/aconto som kontekst), stats.rooms og stats.floorArea samt deres referencer er bevaret på deres oprindelige pladser. Andre pladser er sat til null, og øvrige objektfelter er fjernet. Ingen indekser er omnummereret, og ingen bevaret kildeværdi er ændret. Reduktionen er kontrolleret ved afkodning mod de samme felter i originalen. Hele HTML-siden og den fulde payload er ikke gemt i pakken.

Disse filer er begrænsede parserprøver, ikke komplette Nuxt-hydreringsdata eller fulde annoncefixtures. De dokumenterer ikke billeder, availability, adresse, status, øvrige nøgler eller alle mulige sager. De kan bruges som input til adapterens sagsparser med et separat gittergrundlag eller i den nye feltmåling, hvis den har en offline-indgang.

## Status: udført

Afsnittet herunder var pakkens overlevering til Supply. Arbejdet er gjort i
samme ændring som denne fil, og teksten står i datid, så den ikke læses som
en åben opgave:

- De tre felter blev implementeret på sagens eget id-bundne `offer`/`stats`
  (`adapters/home.ts`), med genbrug af den eksisterende `kronerTilOere`.
- Nul og manglende værdi holdes adskilt: `amount: 0` giver `0`, et
  fraværende eller `null` felt giver `undefined`. Ingen værdier er opfundet.
- Der beregnes ingen samlet indflytningspris af delbeløbene.
- Observationerne herover bruges som regressionsprøver for begge sagstyper,
  suppleret med klart syntetiske tilfælde for nul, manglende felter og en
  nabosag med andre værdier. De syntetiske tilfælde er mærket som sådan i
  prøvefilen og er ikke kildeobservationer.

Ingen produktionsimport, push eller deployment blev udført eller godkendt med
denne pakke.
