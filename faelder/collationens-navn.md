---
navn: collationens-navn
form: 1
faelde: `create collation … (provider = icu, locale = 'da')` i PGlite
kort: filteret står i et NAVN: en collation, der hedder dansk, og som ikke er det.
kilde: #50 på e33db622386019c92c8d3450abdeb43078d33e4f, CLAUDE.md
kostet: nej — fundet ved en måling, før nogen prøve var bygget på den
---
Dansk. Kaldet lykkes uden fejl, men PGlite har kun ICU's roddata, så collationen sorterer som roden: Aalborg først, Å og Æ blandt A'erne. Navnet lover en orden, motoren ikke har. En dansk ordensprøve i testbasen kan ikke blive grøn — og «rettes» forventningen, til den er grøn, måler prøven roden. **Den brugbare halvdel: om en base KAN sortere dansk, afgøres ved at sortere navnene — ikke ved kataloget.** `pg_collation` siger `locale = 'da'` om PGlites collation, mens motoren sorterer som roden; det er fælden anvendt på betingelsen selv. `scripts/test-dansk-orden.ts` og `scripts/maalinger/test-bynavne-domaene-sql.ts` afgør det begge ved at sortere. Se «Version og collation» under Testbasen.
