---
navn: konflikt-fødte-ændringer
form: 3
faelde: `git log -S` / `-G`
---
Ser **ikke merges**. En linje, der opstod i en merges konfliktløsning, har
ingen enkelt commit — og søgningen svarer TOMT. Det læses som «denne linje
har ingen historik», når det betyder «denne historik er usynlig for dette
værktøj». Brug `--diff-merges=first-parent`; `-m` finder den også, men
differ mod hver forælder og over-rapporterer. Målt: `.kort-maerkater {
right: 52px }` fandtes i nul commits, i én merge med flaget, og i fire med
`-m`.
