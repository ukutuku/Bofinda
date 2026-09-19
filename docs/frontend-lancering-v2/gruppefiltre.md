# Gruppekortets adresser følger søgningen

Rettelse oven på `9647860e2e58cfcf8319fd3c7b2c8296a055d893`.

## Fejl og rettelse

I previewet gav Fiktivby med makspris 8.000 kr. et kort med to boliger
til 5.800–7.600 kr. Linket «Se de 2 adresser» åbnede fire, herunder boliger
til 9.400 og 11.200 kr. Linket bar kun repræsentantens id.

Nu følger pris, areal, sted, værelser, kilder, boligtyper og faciliteter med
i gruppelinket. Gruppesiden bruger søgelistens filter og dubletfravalg.
Søgesiden og områdesiderne sender begge deres filtre videre til kortet.
Ejeren udledes fortsat på serveren; intet konto-id tilføjes til linket.

Reglen for blandede indflytningsdatoer er bevaret: kortet kan sige
«1 af 2 matcher» og «Se alle 2 adresser». Begge boliger opfylder stadig
pris- og arealfiltrene. Indflytning, venteliste og reserveret afgør, om
gruppen vises, og indsnævrer ikke dens medlemmer yderligere.

## Kontrol udført på rettelsen

- Den nye regressionstest fejlede før rettelsen: fire adresser efter klik,
  selv om kortet viste to. Fem nye assertions var røde.
- Efter rettelsen er hele `test-soegning.ts` grøn. Prøven følger det
  serverrenderede korts faktiske href ind i gruppesidens serverfunktion og
  sammenligner bolig-id'er med det forventede sæt.
- Seks søgninger er dækket: makspris, begge prisgrænser, areal,
  pris sammen med indflytning, flere typer/kilder sammen med faciliteter,
  samt uden prisfilter. En skjult dublet er med i testdatabasen.
- `test-redigering.ts` og `test-maaling.ts` er også grønne. Redigeringsprøvens
  seks kontroller, der kræver det rigtige produktionsudbud, blev sprunget
  over som tilsigtet af testkørslen.
- TypeScript uden emit og `next build` afsluttede begge med exit 0.

Alle databaseprøver kørte mod PGlite med projektets migrationer og
syntetiske data. Ingen SQL blev kørt mod staging eller produktion.

Kommandoerne til de tre testfiler var den samme runner og de samme filer
som i `npm test`, men startet via `node --import tsx`:

```sh
BILLED_HEMMELIGHED=proeve-hemmelighed-kun-til-proever \
TSX_TSCONFIG_PATH=tsconfig.scripts.json \
node --import tsx scripts/testbase.ts scripts/test-soegning.ts
```

De øvrige to kørsler erstatter kun det sidste filnavn. Bygningen brugte
`NODE_OPTIONS=--use-system-ca NEXT_TELEMETRY_DISABLED=1 npm run build`.
Logfiler fra denne omgang ligger i `gruppefiltre-kontrol/`. Før-loggen er
fra den første regressionstest; dublet- og facilitetstilfældet blev tilføjet
derefter og indgår i efter-loggen.

## Åbent: nyt preview og mobilkontrol

Rettelsen er ikke browserafprøvet på et nyt Vercel-deployment endnu.
Det eksisterende preview på `9647860` har fortsat den gamle linkadfærd.
Push til denne gren udløser ikke et Git-deployment, da spærringen i
`vercel.json` fortsat er slået til.

Der er heller ikke udført en ny mobilmåling i denne omgang. Den tilgængelige
browser har ingen kontrol til skærmbredde; forsøg på at åbne enhedssimulering
og ændre zoom ændrede ikke visningen. En lokal testside kunne ikke åbnes
(`ERR_BLOCKED_BY_CLIENT`). Desktopvisningen var 1363 × 936 CSS-pixels.
Tidligere mobilbilleder og testresultater tæller ikke som kontrol af denne rettelse.

Efter et nyt **Preview**-deployment fra udviklingsgrenen skal følgende prøves:

1. Fiktivby, makspris 8.000 kr.: to på kortet og de samme to på gruppesiden.
2. På 390 og 768 px: forside, søgeresultat og gruppeside uden vandret overløb;
   søgeknappen mindst 48 px høj, filtrene og alle links anvendelige.
3. Åbn boligdetaljen og et stående foto i lysbordet; foto og luk-knap skal
   være synlige, og næste/forrige skal virke.

Der kræves ingen ny SQL-kørsel til denne rettelse. Produktionsdomæne,
miljøvariabler, database, mail og betalingsopsætning er ikke ændret.
