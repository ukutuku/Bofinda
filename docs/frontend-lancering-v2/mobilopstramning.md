# Mobilopstramning efter telefonbilleder

Udgangspunkt: 2e94aae. Ændringen omfatter kun CSS.

- Hjælpetekstens farve ændres fra #9aa1ac til #626975.
- Under 521 px deler størrelse og værelser en række; sted og pris har fuld bredde. Inputskriften forbliver 16 px og søgeknappens minimumshøjde 48 px.
- Statistik beholder to kolonner på telefon. Dekorative ikoner fjernes på denne bredde; alle tal og forklaringer bevares.
- Afsnitsnavigation bryder over flere rækker under 681 px, med mindst 44 px høje links. Ingen afsnit skjules.
- Kort og informationssektioner får mindre afstande. Billedforbehold får indrykning under fotoet på smalle lister.

Kontroller: `npm run build` gennemført med exit 0, inklusive TypeScript-kontrol. `git diff --check` bestået. Ingen ændringer i data, filterlogik, miljøvariabler eller deploymentindstillinger.

Afgrænsning: Der er endnu ikke taget browserbilleder af denne ændring. De indsendte telefonbilleder viser udgangspunktet, ikke resultatet. Visuel kontrol af ny preview på telefon og desktop udestår; dette er ikke en fuld godkendelse af mobiloplevelsen eller hjemmesidens funktioner.
