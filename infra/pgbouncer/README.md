# PgBouncer som Railway-service

Deploy `edoburu/pgbouncer` som en ny service i samme Railway-projekt som
Postgres. Konfigureres udelukkende med miljøvariabler:

| Variabel | Værdi | Hvorfor |
|---|---|---|
| `DB_HOST` | `postgres.railway.internal` | Privat net. Ingen egress, lavere latenstid. |
| `DB_PORT` | `5432` | |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | fra Postgres-servicen | |
| `POOL_MODE` | `transaction` | Det er transaction mode, der giver multiplekseringen. `session` ville binde én server-forbindelse per lambda og løse ingenting. |
| `MAX_CLIENT_CONN` | `500` | Klientforbindelser er billige. Det er dem, Vercels lambdaer lander på. |
| `DEFAULT_POOL_SIZE` | `20` | Server-forbindelser mod Postgres. Se forbindelsesbudgettet i rod-README. |
| `AUTH_TYPE` | `scram-sha-256` | Matcher moderne Postgres. |

Eksponér servicen som **TCP proxy på port 6432** — det er den adresse,
Vercel skal have i `DATABASE_URL`.

## Efter deploy

Sundhedstjek fra en psql mod PgBouncer på databasen `pgbouncer`:

```sql
SHOW POOLS;     -- cl_active / sv_active per pool
SHOW STATS;     -- forespørgsler, ventetid
```

Står `cl_waiting` vedvarende over nul, er `DEFAULT_POOL_SIZE` for lav.
