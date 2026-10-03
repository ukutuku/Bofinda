---
navn: gitignore-skråstregen
form: 1
faelde: et gitignore-mønster, læst i stedet for prøvet
kilde: #55 (claude/to-raekkeudvidelser) på b8e7809ab0d16d0a66bb5425668fbe28096babef, CLAUDE.md; tilpasset ved integration
---
Hvad det FAKTISK rammer. Et mønster er en påstand om matchning, og et mønster, der rammer nul, er **tavst**: ingen fejl, ingen advarsel, kun en fil der ikke blev ignoreret. Spørg git — `git status --porcelain --ignored` skriver `!!` for det ignorerede — læs ikke mønstret. **To tilfælde, samme form:** `node_modules/` med skråstreg matcher kun en MAPPE, så et symlink slap forbi og kom i versionsstyringen (`abad7ae`). Løst: mønstret står nu uden skråstreg. Og `proever-modproev` ramte ingenting, fordi mappen hedder `.proever-modproev` — det bogstavelige navn uden punktum matcher ikke navnet med punktum. Wildcard-mønstret `**/*` matcher derimod også skjulte mapper; det er målt med `git check-ignore -v .skjult/x`. Skråstregen og punktummet er ét tegn hver, der ændrer hvad mønstret rammer, uden at ændre hvad det ser ud som. Efterprøves af `scripts/proev-kvitteringen.sh`, afsnit C.
