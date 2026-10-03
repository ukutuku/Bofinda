---
navn: værktøjets-kvittering
form: 3
faelde: `Successfully rebased and updated refs/heads/…`
---
Indholdet. Kvitteringen er sand om værktøjets egen bogføring og **tavs om
arbejdet**: `rebase --continue` spørger, om indeksposten er opmærket som
løst — ikke om løsningen er rigtig. Målt: samme fil med byte-identisk
indhold giver `needs merge` ustaged og `Successfully rebased` staged, og
commit'en bærer tre konfliktmarkører, mens `git status` er tom.
**Anden forekomst, 3. oktober: `base.sha` er et øjebliksbillede, og svaret siger ikke, hvilken base det gælder.** Målt 3. oktober: #60 svarer `mergeable_state: clean` med `base.ref` `skive/faciliteter-og-spaend` og `base.sha` `9aa215c`, mens den gren står på `fc7887c`, **3 commits længere fremme** — `9aa215c` er forfader til den. **Hvad der IKKE er målt: hvilken base GitHub regnede svaret mod.** `base.sha` er et felt i svaret, ikke en oplysning om beregningen, og denne sag kan ikke afgøre det: `git merge-tree` giver **exit 0 mod begge** baser, så der er intet afvigende udfald at skelne på. Netop derfor er `clean` den farlige af feltets tre skikkelser. Fraværet ligner ingenting — på liste-endpointet beregnes `mergeable` ikke, og `jq '.mergeable'` gør fraværet til `null`. `dirty` er en advarsel. Men `clean` er en BEKRÆFTENDE påstand om en sammenligning, hvis base ingen spørger efter, og som svaret ikke lader sig efterprøve på. Modtrækket: læs `base.ref` og `base.sha` ved siden af og hold dem op mod basens gren, eller regn fletningen selv med `git merge-tree` mod basens hoved.
