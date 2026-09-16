# Kontrol af revisionen

Udgangspunkt: `e010922b5b9937c55a2f95dc74253ced129e6029`.

- TypeScript: `tsc --noEmit` bestået; produktionsbyggets typekontrol bestået.
- Produktionsbyg: Next.js 15.5.24, 18 ruter, bestået med
  `NODE_OPTIONS=--use-system-ca NEXT_TELEMETRY_DISABLED=1 npm run build`.
  Systemets CA bruges med normal certifikatkontrol; TLS er ikke slået fra.
- Alle tre eksisterende testsuiter (`test-redigering.ts`, `test-maaling.ts`,
  `test-soegning.ts`) bestået i PGlite. Den normale `npm test`-starter blev
  afvist ved oprettelse af en lokal IPC-pipe. De samme uændrede testfiler blev
  derfor kørt med `node --import tsx scripts/testbase.ts ...` og
  `TSX_TSCONFIG_PATH=tsconfig.scripts.json`. Ingen test blev fjernet.
- Demodata afprøvet to gange i samme isolerede database, oprettet med repoets
  migrationer: fortsat præcis 16 boliger og 48 billedrækker. Ingen kontakter
  eller `source_created_at`-værdier. Første forsøg fangede et manglende
  internt adresse-id; det er rettet til eksplicitte prøve-id'er.
- Fire miljøgrænser kontrolleret: staging+preview aktiverer demo;
  production, andet projekt og manglende variabler gør ikke.
- Fire fotoaktiver er hentet og set: to liggende og to stående. Det er
  stockfotos, ikke faktiske annoncebilleder. Galleriet og kortene skal stadig
  gennemgås i det nye preview, når demodataene er indsat.
- Hero-fotoets SHA256 er uændret:
  `a2b2795193c96f2508593dc1dca77f62ea986a10dd2600cef331e64e245d5b5f`.
- `git diff --check` bestået.

## Status for staging og visuel kontrol

Supabase-forbindelsen afviste indsættelsen med
`cannot execute INSERT in a read-only transaction`. Transaktionen blev ikke
anvendt. Staging har fortsat den eksisterende favoritprøve. SQL-filen skal
køres i projektets SQL Editor eller en godkendt skriveforbindelse.

Der er endnu ikke taget screenshots af den nye revision eller målt ny
hero-tekstkontrast. De gamle skærmbilleder og målinger under `designloeft/`
og i `designloeft.md` gælder stadig deres oprindelige commits, ikke denne
revision. Der påstås ikke nye grønne resultater fra `hero.sh` eller
`lancering.mjs`.

Produktion, `vercel.json`, databasens skema og importadapterne er urørte.
