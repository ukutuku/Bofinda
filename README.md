# Bofinda

Dansk lejeboligportal. Aggregerer ledige lejeboliger fra flere kilder,
lader brugeren søge gratis, og tager betaling for at kontakte udlejeren.

Se `BRIEF.md` for produktet og `CLAUDE.md` for reglerne i mappen.

---

## Topologi

Databasen ligger på Supabase. Railway beholdes udelukkende til
scraper-workeren.

```
   Vercel                    Supabase
   ┌──────────┐              ┌─────────────────────────┐
   │ Next.js  │──── :6543 ──▶│ Supavisor               │
   │ frontend │  transaction │  transaction mode       │
   └──────────┘              │         │               │
                             │         ▼               │
   Railway                   │   ┌───────────┐         │
   ┌──────────┐              │   │ Postgres  │         │
   │  worker  │──── :5432 ──▶│   │           │         │
   │ (scraper)│ session/direct   └───────────┘         │
   └──────────┘              └─────────────────────────┘
```

Supavisor er indbygget, så der skal ikke køre en pooler-service nogen
steder. Workeren går uden om den: den er én lang proces med sin egen
pool, den har intet at multiplekse, og session/direct lader den beholde
prepared statements.

## To connection strings, og de er ikke ombyttelige

| Variabel | Port | Peger på | Bruges af |
|---|---|---|---|
| `DATABASE_URL` | 6543 | Supavisor, transaction mode | Vercel-frontenden |
| `DATABASE_URL_DIRECT` | 5432 | Session pooler eller direct | Worker og `drizzle-kit` |

**Migrationer skal køre på `DATABASE_URL_DIRECT`.** DDL og advisory locks
kræver en session, og transaction mode giver en tilfældig
server-forbindelse per transaktion. `drizzle.config.ts` peger derfor
bevidst på 5432.

Direct connection (`db.<ref>.supabase.co:5432`) er IPv6-only på nye
Supabase-projekter. Virker din maskine eller Railway ikke på IPv6, så tag
**session pooleren** på port 5432 i stedet — den er IPv4 og kan lige så
godt holde en session.

## Faldgruben: prepared statements

`postgres.js` bruger prepared statements som standard. Bag Supavisor i
transaction mode lander næste transaktion måske på en anden
server-forbindelse, og så fejler den med *"prepared statement does not
exist"* — typisk først under belastning, hvilket gør den ubehagelig at
finde.

`db/client.ts` sætter derfor `prepare: false`, når koden kører på Vercel,
og lader dem være slået til i workeren.

## RLS er ikke valgfrit her

Supabase eksponerer `public`-skemaet gennem PostgREST. En tabel uden RLS
kan læses af enhver med den offentlige publishable-nøgle — også
`listings.contact_email`, som er præcis det, betalingsmuren sælger.

Migration `0001_enable_rls.sql` slår RLS til på samtlige tabeller og
opretter med vilje **ingen** politikker: Bofinda taler med databasen over
en almindelig Postgres-forbindelse som ejer-rollen, og den går uden om
RLS. `anon` og `authenticated` får dermed adgang til ingenting.

Ny tabel skal have `enable row level security` i samme migration.

## Forbindelsesbudget

Tallene afhænger af Supabase-planen. Slå dem op under
**Project Settings → Database**, og fordel dem sådan:

| Forbruger | Går på | Forbindelser |
|---|---|---:|
| Vercel-lambdaer | Supavisor `:6543` | 1 hver, mange klienter |
| Worker på Railway | `:5432` | 10 |
| `drizzle-kit`, psql, ad hoc | `:5432` | 5 |

Frontenden tæller mod Supavisors klientgrænse, ikke mod Postgres'
`max_connections`. Rykker tallene sig, er pool size i Supabase-dashboardet
knappen der skal drejes på — ikke `max` i Drizzle-klienten.

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
