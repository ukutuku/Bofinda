---
navn: rød-af-en-anden-grund
form: 2
faelde: en modprøve, der kun kræver «rød»
kort: skærpelsen af `prøvens-eget-forlæg` — dér målte prøven en kopi; her måler modprøven den rigtige kode, men tæller ethvert rødt som sit eget.
---
At det var VÆRNET, der fangede den. En exitkode forskellig fra 0 siger, at
noget gik galt — ikke at det rigtige gik galt. Målt 1. oktober 2026 på
typevagten i `lib/maaling.ts`: `type-uddrag-annoteret` var rød af en
spredningsfejl ved siden af vagten, og `type-allowlist-annoteret` slap
igennem den samme vagt. Begge så ens ud, så længe kommandoen kun krævede
rødt. Målt igen 2. oktober: to migrationsmutationer gav «0 roede, exit 1»,
og modprøvekøreren viser ikke prøvens udskrift. Skærpelsen: lad
kommandoen kun være rød på værnets EGEN meddelelse — `sh -c "! <prøve>
2>&1 \| grep -q '<værnets meddelelse>'"` — og kør en KONTROL gennem samme
kommando: en mutation, som et ANDET værn fanger, skal slippe igennem.
Kør også kommandoen på den umuterede kode og se 0, ellers kan en prøve,
der aldrig kom i gang, give grønt. Her er det MED VILJE grep's exitkode,
der tæller (`rørets-exitkode` brugt som værktøj), og derfor kontrollen.
**Og den har fanget sin egen forfatter.** Rækken er skrevet af fejlene
ovenfor, af den session, der byggede `faelder/`. Samme eftermiddag
trådte samme session i den igen, to gange. Modprøverne af opløsningen i
`lib/alarm.ts` gav exit 1 med nul ✗, fordi `git checkout -m` skriver
markørerne som `ours`/`theirs`, mens regexet ledte efter `HEAD`, så filen
bar stadig konfliktmarkører. Og en prøvefletning gav ✓0 ✗0, fordi
worktree'et var lagt på den forkerte gren. Begge blev fanget af rækkens
egen regel, nemlig at exit 1 med nul ✗ er et nedbrud og ikke værnets
meddelelse, og tallene blev målt om. Det er første nedskrevne gang, en
række fanger sin forfatter, efter den stod i tabellen.
**Den anden af de to har en uafhængig forekomst samme dag:** en kontrol
kørt på den forkerte tilstand. Ejeren lavede den samme formiddag: `git
checkout` fejlede på en beskidt `package-lock.json`, `tsc` kørte på den
gamle gren og gav 0. Dér var svaret GRØNT, og det er den farlige
polaritet: et grønt svar fra den forkerte tilstand ligner et grønt svar.
To hænder, samme dag, samme fejl, så det er formens natur og ikke
uopmærksomhed. Modtrækket er at navngive tilstanden: læg worktree'et på
en SHA og ikke på `HEAD`, og skriv SHA'en ud ved siden af resultatet.
