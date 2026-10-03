---
navn: import-prøven
form: 2
faelde: en import-prøve af en fil, der lover ingen database
kort: måler noget sandt — at importen lykkes — og læses som om den målte løftet om ingen database.
kilde: #50 på e33db622386019c92c8d3450abdeb43078d33e4f, CLAUDE.md
---
Databasen. `db/client.ts` forbinder først ved første brug, så `await import()` af filen lykkes uden `DATABASE_URL` — også når den trækker `lib/soeg` og `postgres` med sig. Prøven måler, at importen lykkes, og læses som om den målte, at basen ikke nås. Mål grafen, ikke kørslen: `scripts/test-rene-filer.ts`.
