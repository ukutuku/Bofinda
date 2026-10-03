---
navn: leveret-men-ulæst
form: 6
faelde: wrapperen sætter `X`, det indpakkede læser `Y`
kilde: #56 på 1414a0c75f30e598a2d8180910f8f527d6dadc82, CLAUDE.md
---
At sikkerheden blev LEVERET. `scripts/cloud/kontrol.sh` kalder `krav_isoleret`, det består, og den eksporterer `DATABASE_URL_DIRECT=<isoleret>`. Seks scripts læste `DATABASE_URL` og så derfor det OMGIVENDE miljø — produktionens URL fra `.env` — mens de kørte under den wrapper, der netop havde efterprøvet isolationen. Intet opstrøms fejlede: værnet kørte, bestod og leverede. Det er `prøvens-eget-forlæg` vendt om, og tegnet er det samme: **samme værdi under to navne, hvor den ene side skriver det ene og den anden læser det andet.** Målbart — hold de nøgler, et script LÆSER, op mod dem, dets wrapper SÆTTER.
