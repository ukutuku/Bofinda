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

## Næste ændring

Supply kan nu implementere de tre felter på sagens eget id-bundne offer/stats-objekt. Genbrug den eksisterende kronerTilOere-konvertering. Bevar nul og manglende værdier forskelligt; opfind ikke værdier.

Brug disse observationer til regressionstests for begge sagstyper. Tilføj særskilte, klart syntetiske tilfælde for manglende/nul-værdier og en nabosag med andre værdier. Lad ikke en testsyntese blive beskrevet som en ekstra kildeobservation.

Ingen produktionsimport, push eller deployment er udført eller godkendt med denne pakke.
