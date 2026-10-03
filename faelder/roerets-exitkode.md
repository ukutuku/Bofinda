---
navn: rørets-exitkode
form: 3
faelde: `$?` efter en pipeline
---
Kommandoen. `$?` er den SIDSTE kommandos exitkode, ikke roerets. Maalt:
`false \| head -1` giver **0**. Det er sket to gange paa én dag — en
modproeve meldt som `exit=0`, hvor nullet var `head`s, og en byggekontrol
laest som groen, hvor nullet var `tail`s. **Mekanisk loeseligt, og begge
veje har en haage:** `set -o pipefail` giver 1 paa `false \| head -1` —
men ogsaa **141** (SIGPIPE) paa `yes \| head -1`, hvor intet gik galt, saa
den goer en VIRKENDE pipeline roed. Robust er derfor `${PIPESTATUS[0]}`
(maalt: `1` mens `$?` er `0`), eller at koere kommandoen for sig og
filtrere bagefter: `ud=$(kommando 2>&1); k=$?`. Samme familie som
`transpilerede-positioner`: svaret er sandt om roeret og laeses som et
svar om kommandoen.
