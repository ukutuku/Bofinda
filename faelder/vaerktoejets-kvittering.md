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
**Anden forekomst, 3. oktober: `mergeable_state: clean` på en PR, hvis
base har flyttet sig.** #60 svarede `clean`, regnet mod `base.sha`
`9aa215c`, mens base-grenen (#57's) stod to commits længere fremme på
`6bebccb`. Prøvefletningens første forælder var stadig `9aa215c`; #56 og
#63 var regnet mod deres aktuelle baser. Svaret var sandt om GitHubs egen
sidste beregning og tavst om, at den var forældet. At det tilfældigvis
også holdt mod `6bebccb` (`git merge-tree`, exit 0), gør det ikke til et
svar på det spørgsmål. Samme felt havde tre skikkelser samme weekend:
fraværende i list-svaret, hvor `jq '.mergeable'` gør fraværet til `null`;
`dirty` på seks PR'er, og det var sandt; og `clean` her. Af de tre er
`clean` den farlige. Fraværet ligner ingenting, og `dirty` er en advarsel,
men `clean` er en BEKRÆFTENDE påstand om en sammenligning, hvis base
ingen spørger efter. Modtrækket: læs `base.sha` ved siden af og hold den
op mod basens gren, eller regn fletningen selv med `git merge-tree` mod
basens hoved.
