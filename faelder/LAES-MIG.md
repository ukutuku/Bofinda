# Fældetabellen — én fil pr. række

Tabellen «Dækker ét tilfælde mindre, end man tror» i CLAUDE.md er
**genereret** af filerne her. Ret filen, ikke tabellen.

## En ny række

1. Læg en fil `faelder/<slug>.md`. Filnavnet er `slug(navn)` fra
   `lib/slug.ts`: æ → ae, ø → oe, å → aa, alt andet end a-z0-9 → bindestreg.
   `værktøjets-kvittering` ligger i `vaerktoejets-kvittering.md`.
2. Kør `npm run faelder`. Den skriver blokken i CLAUDE.md.
3. `npm test` er rød, hvis du glemte trin 2, eller hvis filen ikke kan læses.

```
---
navn: værktøjets-kvittering
form: 3
faelde: `Successfully rebased and updated refs/heads/…`
kort: (valgfri) én sætning, der står efter navnet i formlisten
kostet: (valgfri) nej — fundet ved en måling, før nogen prøve var bygget på den
---
Teksten i kolonnen «Hvad den IKKE dækker». Linjeskift bliver til
mellemrum, så den må gerne brydes. En lodret streg skrives \| som i
tabellen — ellers splitter den rækken, og filen afvises.
```

- `form` er `1`, `2`, `3`, `4` eller `ikke-vaern`. Formernes overskrifter og
  beskrivelser står i `FORMER` i `scripts/faelder.ts`. En ny form er en
  bevidst ændring dér.
- `kostet` udelades for en fælde, der har kostet mindst én omgang. Den
  sætning står under formlisterne, med undtagelserne navngivet.
- Rækkefølgen i tabellen er form og derefter navn i dansk orden. Der er
  ingen numre: navnet er identifikatoren.

## Når to grene støder sammen

To grene, der hver lægger en fil, kolliderer kun i den genererede blok i
CLAUDE.md. Tag en af siderne og kør `npm run faelder`. Blokken er
bestemt af filerne alene, så resultatet er det samme, uanset hvilken side
du tog.

## Prosaen omkring tabellen

Afsnittene efter tabellen er stadig skrevet i hånden. Prøven tjekker, at
hvert navn med bindestreg, de nævner i `**…**` eller `` `…` ``, findes som
række. Omdøber du en række, skal teksten, der nævner den, med.
