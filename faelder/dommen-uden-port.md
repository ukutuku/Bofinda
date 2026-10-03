---
navn: dommen-uden-port
form: dom-uden-port
faelde: en validering, hvis exitkode intet læser
kilde: #38 paa 659ba3c, CLAUDE.md
---
Intet — og det er pointen. Den dækker rigtigt og dømmer rigtigt; der er bare ingen port, dommen lukker. Valideringen af en konfliktløsning stoppede korrekt på ugyldig JSON, men `git add` stod som næste sætning i samme kald og kørte **alligevel**: filen blev staged MED konfliktmarkører, og `rebase --continue` gik igennem. Rettelsen er ikke at validere bedre — den er at gøre handlingen AFHÆNGIG af exitkoden i stedet for at lade den stå efter den. To sætninger efter hinanden lader rækkefølgen i filen afgøre resultatet frem for dommen. Mekanisk i `scripts/stage-gyldig.sh`, som beviser sig selv med `--modproev`.
