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
