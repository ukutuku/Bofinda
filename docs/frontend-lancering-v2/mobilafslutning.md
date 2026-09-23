# Mobil: informationshierarki og sidefod

Udgangspunkt: ef495ce. Rettelser efter gennemgang af mobilskærmbilleder.

- Fjernet det ekstra udlejerkort; det grønne annoncebånd beholdes.
- Filtrene opdeles visuelt med tre overskrifter. Alle felter, værdier,
  grundlagstal og forbehold er bevaret. Ingen søgelogik ændret.
- På mobil reduceres detaljens bundpadding fra 64 til 20 px og den ydre
  indholdsrammes fra 72 til 28 px. Desktopafstandene er uændrede.
- Filteretiketter kan ombrydes, og kontrollinjer er mindst 44 px høje.

Kontrol: npm run build bestod inklusive TypeScript; git diff --check bestod.
Den afsluttende ændring af rammens bundpadding blev tilføjet under bygget;
det er derfor ikke dokumentation for den færdige CSS i browseren.
Ingen nye browsermålinger eller screenshots: visuel kontrol af nyt preview
på mobil og desktop udestår. Ingen databaseændringer eller produktionsdeploy.
