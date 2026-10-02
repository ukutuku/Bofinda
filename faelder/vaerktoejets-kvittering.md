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
