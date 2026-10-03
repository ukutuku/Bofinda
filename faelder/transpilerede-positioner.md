---
navn: transpilerede-positioner
form: 3
faelde: V8-dækning (`NODE_V8_COVERAGE`) over en `.ts`-fil
---
At positionerne peger i DEN FIL, du læser. `tsx` oversætter først, så
dækningens `startOffset` er tegnpositioner i den TRANSPILEREDE JS. Et
opslag «hvilken `tjek(`-linje ligger i en nul-range» rammer derfor ved
siden af, og afvigelsen vokser med filens kommentarer. Målt: **187 af 485
påstande meldt udækkede i `test-redigering.ts` — alle 485 var kørt.**
Stakspor ER kildekortlagt; tegnpositioner er ikke.
