# Bofinda

Dansk lejeboligportal. Aggregerer ledige lejeboliger fra flere kilder,
lader brugeren søge gratis, og tager betaling for at kontakte udlejeren.

Se `BRIEF.md` for produktet og `CLAUDE.md` for reglerne i mappen.

---

## Topologi

Alt undtagen frontenden ligger på Railway.

```
                       ┌─────────────────────────────────────┐
                       │  Railway-projekt                    │
   Vercel              │                                     │
   (serverless)        │   ┌───────────┐   privat net        │
   ┌──────────┐        │   │ PgBouncer │──────────┐          │
   │ Next.js  │───TCP──┼──▶│  :6432    │          ▼          │
   │ frontend │  proxy │   │ transaction│    ┌──────────┐    │
   └──────────┘        │   └───────────┘    │ Postgres │    │
                       │                     │  :5432   │    │
                       │   ┌───────────┐     └──────────┘    │
                       │   │  worker   │──────────▲          │
                       │   │ (scraper) │  direkte, privat net│
                       │   └───────────┘                     │
                       └─────────────────────────────────────┘
```

Workeren går **uden om** PgBouncer. Den er én lang proces med sin egen
pool, den har ingen brug for multipleksering, og direkte forbindelser
lader den beholde prepared statements.

## Hvorfor PgBouncer og ikke bare pooling i appen

Applikationslags-pooling løser ikke serverless. Hver Vercel-lambda er sin
egen proces med sin egen pool — `max: 10` i tyve samtidige lambdaer er 200
forbindelser mod en Railway-Postgres, der som standard tager omkring 100.
Poolen skal ligge **uden for** processerne.

Derfor: PgBouncer i transaction mode foran, og `max: 1` inde i hver
lambda. Lambdaerne får en billig klientforbindelse hver; PgBouncer
multiplekser dem ned på tyve rigtige server-forbindelser.

## Forbindelsesbudget

Tjek først hvad du faktisk har:

```sql
SHOW max_connections;
SHOW superuser_reserved_connections;
```

Railway leverer typisk 100. Med tre reserveret til superuser er der 97 at
gøre godt med:

| Forbruger | Server-forbindelser |
|---|---:|
| PgBouncer (`DEFAULT_POOL_SIZE`) | 20 |
| Worker (`max: 10`) | 10 |
| `drizzle-kit`, psql, ad hoc | 5 |
| **I alt** | **35** |
| Hovedrum | 62 |

Frontenden tæller ikke med: den rammer PgBouncers `MAX_CLIENT_CONN` (500),
ikke Postgres. 500 samtidige lambdaer på 20 server-forbindelser.

Rykker tallene sig, er `DEFAULT_POOL_SIZE` den knap, der skal drejes på —
ikke `max` i Drizzle-klienten.

## To connection strings, og de er ikke ombyttelige

| Variabel | Peger på | Bruges af |
|---|---|---|
| `DATABASE_URL` | PgBouncer, offentlig TCP-proxy `:6432` | Vercel-frontenden |
| `DATABASE_URL_DIRECT` | Postgres, `postgres.railway.internal:5432` | Workeren og `drizzle-kit` |

**Migrationer skal køre på `DATABASE_URL_DIRECT`.** DDL og advisory locks
kræver en session, og transaction pooling giver en tilfældig
server-forbindelse per transaktion. `drizzle.config.ts` peger derfor
bevidst på den direkte URL.

## Faldgruben: prepared statements

`postgres.js` bruger prepared statements som standard. Bag PgBouncer i
transaction mode lander næste transaktion måske på en anden
server-forbindelse, og så fejler den med *"prepared statement does not
exist"* — typisk først under belastning, hvilket gør den ubehagelig at
finde.

`db/client.ts` sætter derfor `prepare: false`, når koden kører på Vercel,
og lader dem være slået til i workeren. Bliver det nogensinde ét flag for
begge, skal det være `false`.

## Kom i gang

```bash
npm install
cp .env.example .env        # udfyld begge DATABASE_URL'er
npm run db:generate         # laver migration af db/schema.ts
npm run db:push             # kører den — mod DATABASE_URL_DIRECT
```

| Kommando | Gør |
|---|---|
| `npm run dev` | Next.js lokalt |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Migration ud fra skemaet |
| `npm run db:push` | Kører migrationer (direkte forbindelse) |
| `npm run import` | Kører importen én gang |

Lokalt sættes `VERCEL` ikke, så klienten vælger worker-profilen og går på
`DATABASE_URL_DIRECT`. Det er det rigtige til udvikling.
