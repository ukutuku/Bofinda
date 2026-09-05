// ═══════════════════════════════════════════════════════════════
//  Testbasen — rigtig Postgres, ikke produktionen.
//
//  PGlite er PostgreSQL oversat til WASM. Den kører i processen, har
//  ingen socket, ingen TLS og intet netværk, og den forsvinder, når
//  processen gør. Docker er ikke installeret på maskinen, og Supabase
//  Free tillader kun ét projekt — så det her er vejen.
//
//  Skemaet er de RIGTIGE migrationer i journalens rækkefølge, delt med
//  scripts/proev-genskab.mjs. Ikke en håndskrevet efterligning: en
//  testbase, der er noget andet end produktionen, prøver noget andet
//  end produktionen.
//
//      npm test                    prøven mod den her
//      tsx scripts/testbase.ts X   kører X mod den her
//
//  HVAD DEN IKKE KAN: RLS. `auth.uid()` er en stub, der giver null, og
//  storage.objects er en attrap med tre kolonner. Politikkerne i 0014
//  OPRETTES her, men de kan ikke håndhæve noget. Se CLAUDE.md.
// ═══════════════════════════════════════════════════════════════

import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../db/schema'
import { indsaetBase } from '../db/client'
import { koerMigrationer, stubSupabase } from './pglite-skema.mjs'

export interface Testbase {
  luk: () => Promise<void>
  migrationer: number
}

/**
 * Rejser basen og SÆTTER den ind i db/client, så alt, der importerer `db`,
 * rammer den — uden at nogen af de moduler ved det.
 *
 * Kilderne sås ikke. `sources` er et register, hvis sandhed ligger i
 * KILDER i adapters/index.ts; rækkerne materialiseres af sikreKilde() i
 * lib/ingest.ts, når importen kører. At lægge dem i SQL her ville
 * duplikere registret et sted mere. Migration 0013 sår `native`, fordi den
 * er den eneste kilde uden adapter, og prøven laver selv den fremmede
 * kilde, den skal bruge. Får en prøve brug for det rigtige register, er
 * svaret sikreKilde() over KILDER — ikke ny SQL.
 */
export async function rejsTestbase(): Promise<Testbase> {
  const pg = await PGlite.create()
  await stubSupabase(pg)
  const migrationer = await koerMigrationer(pg)
  // Samme forespørgsels-API, anden driver. drizzle-orm/pglite og
  // drizzle-orm/postgres-js deler grænseflade, men ikke type.
  indsaetBase(drizzle(pg, { schema }) as never, () => pg.close())
  return { luk: () => pg.close(), migrationer }
}

// Kørt direkte: rejs basen, og kør så den fil, der står som argument.
// Rækkefølgen er hele pointen — basen skal være sat ind, FØR prøven
// importeres, ellers når dens `db` at blive produktionens.
if (process.argv[1]?.endsWith('testbase.ts')) {
  const maal = process.argv[2]
  if (!maal) {
    console.error('brug: tsx scripts/testbase.ts <fil>')
    process.exit(1)
  }
  const t = await rejsTestbase()
  console.log(`  testbase: PGlite, ${t.migrationer} migrationer, ingen forbindelse ud af processen\n`)
  await import(`../${maal}`)
}
