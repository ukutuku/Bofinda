---
navn: prøvens-eget-forlæg
form: 2
kort: og set udefra — prøven kan måle det rigtige sted, og sandheden kan bo et andet: journalen mod det, produktionen allerede har kørt.
---
Dækker slet ikke koden. Isoleringsflagene lå i trinlisten i
`scripts/import.ts`; prøven byggede sine egne trin med sine egne flag.
Vendes hvert eneste flag i koden, er sættet fortsat grønt — prøven så
aldrig på dem.
**Og set udefra:** prøven måler det rigtige sted, men det sted er ikke
der, hvor sandheden bor. Journalvagten, som #51 lægger i testbasen
(`koerMigrationer`), efterprøver INTERN konsistens: hver `.sql` har en
journalpost, og `when` stiger i journalens orden. Migrationssikkerhed
afhænger af EKSTERN tilstand: hvad produktionen allerede har kørt.
drizzle kører kun en migration, hvis dens `when` er større end den
senest kørte. Sættes en ny post FØR en, produktionen har kørt, er
journalen stigende og vagten grøn, mens produktionen springer den nye
over uden en fejl. Det ser kun `db:status`, og den navngiver den
forkerte. Fundet i vagten samme dag, den blev bygget, af den session,
der byggede den, ved en prøvefletning mod #57, der tager samme nummer
0021. Modtrækket er ikke en bedre vagt i testbasen, men at spørge dér,
hvor sandheden bor.
