---
navn: gentagelsesprøven
form: 1
faelde: mod et uafgjort `ORDER BY`
---
Beviser stabilitet i DENNE forespørgselsplan, ikke at det afgørende led
findes. Kald den samme forespørgsel fem gange, og Postgres svarer gerne
det samme — også når leddet er fjernet.
