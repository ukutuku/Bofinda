---
navn: sammenlagte-påstande
form: 1
faelde: to prøver lagt i én for hastighedens skyld
kilde: #59 (hotfix/referrer-og-osm-beredskab) på 99a8c30, CLAUDE.md linje 1120
---
**Evnen til at SKELNE.** En prøve, der dækker tre tilfælde i ét forlæg, er
stadig rød når noget fejler — men den kan ikke sige hvilket, og prisen er
usynlig indtil noget fejler. Målt: fire `tsc`-kørsler i
`scripts/test-adapterkontrakt.ts` kostede 38 s; lagt i to blev modvægten ÉN
påstand, der kan fejle af tre grunde. **21 sekunder for at kunne se forskel
på tre fejl er billigt** — og noten skal da sige hvilken af de tre brækkede.
Samme familie som `prøvens-eget-forlæg` og `dommen-uden-port`: et værn, der
er korrekt rødt, men ikke brugbart rødt.
