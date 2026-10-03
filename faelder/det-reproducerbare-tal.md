---
navn: det-reproducerbare-tal
form: 1
faelde: «jeg kørte den to gange og fik det samme»
kilde: #59 (hotfix/referrer-og-osm-beredskab) på 99a8c30, CLAUDE.md linje 1119
---
**Korrekthed.** Et tal kan reproducere præcist, fordi begge kørsler var
forkerte på **hver sin** måde. Målt: en par-tabel over 228 PR-par gav **142
i konflikt** i to kørsler — én på en shallow klon (282 commits, 5 podede
grænser), én på fuld historik (432). Totalen var identisk; `diff` på
resultatfilerne afviger fra **fjerde linje**. Havde valideringen været
«gentag og sammenlign totalen», var målingen blevet kaldt robust. **Det er
den eneste fælde, der slår det normale forsvar mod målefejl, for gentagelsen
ER forsvaret.** Modtrækket er ikke at gentage, men at **ændre
forudsætningen** og se, om tallet flytter sig — her ville `git rev-list
--all --count` alene have afsløret det. Se `.git/shallow`-kontrollen under
Arbejdsform.
