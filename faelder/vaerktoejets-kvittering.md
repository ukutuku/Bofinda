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
**Anden forekomst, 3. oktober: et FORÆLDET METADATAFELT, læst som en oplysning om en beregning.** Målt: #60 svarer `mergeable_state: clean` med `base.ref` `skive/faciliteter-og-spaend` og `base.sha` `9aa215c`, mens den gren står på `fc7887c`, 3 commits længere fremme. **Men GitHubs egen prøvefletning er bygget på basens AKTUELLE hoved:** `refs/pull/60/merge` er `e757b3f` med forældrene `fc7887c` og `d9918c6` — basegrenens hoved og #60's hoved. Det dokumenterede er altså, at `base.sha` er forældet metadata; det er **ikke** dokumenteret, at der blev prøveflettet mod den forladte base. **Og `mergeable_state`s beregningsgrundlag skal ikke udledes af feltet** i nogen retning: svaret oplyser det ikke, og `base.sha` er ikke den oplysning. Feltet er stadig det farlige af sine tre skikkelser — fraværet ligner ingenting, fordi `mergeable` ikke beregnes på liste-endpointet og `jq '.mergeable'` gør fraværet til `null`; `dirty` er en advarsel; men `clean` læses som en påstand om en sammenligning, hvis grundlag svaret ikke nævner. Modtrækket er derfor ikke at læse `base.sha`, men at læse **flettereferencens forældre** (`git log -1 --format=%p refs/pull/<n>/merge`) eller at regne fletningen selv med `git merge-tree` mod basens hoved. **Tidligere udgave af denne celle** skrev, at svaret var «regnet mod `9aa215c`» og dermed forældet. Det var en forklaring uden måling bag, flettereferencen modsiger den, og tallene i den (to commits, `6bebccb`) var desuden overhalet.
