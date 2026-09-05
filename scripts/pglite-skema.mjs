// ═══════════════════════════════════════════════════════════════
//  Et Bofinda-skema på en tom PGlite.
//
//  To kaldere deler den her, og det er med vilje:
//
//    scripts/proev-genskab.mjs   beviser, at et backup-dump kan læses
//                                tilbage. Henter auth.users' kolonner ud
//                                af dumpet selv.
//    scripts/testbase.ts         rejser basen, npm test kører mod.
//
//  Var stubben skrevet to steder, ville de skride fra hinanden, og den
//  dag en migration begynder at kræve noget nyt af Supabase, ville kun
//  den ene af dem opdage det.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from 'node:fs'

/**
 * Supabase-delene, som vores migrationer regner med, men som Supabase selv
 * ejer. STUBBE: nok til at migrationerne kan køre, ikke en efterligning.
 *
 * `auth.uid()` returnerer null. Det er ærligt — der er ingen JWT at læse —
 * men det betyder også, at RLS-politikkerne i 0014 oprettes uden at kunne
 * håndhæve noget her. Se CLAUDE.md under «Testbasen».
 */
export async function stubSupabase(db, authKolonner = ['id', 'email']) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (${authKolonner
      .map((k) => (k === 'id' ? '"id" uuid primary key' : `"${k}" text`))
      .join(', ')});
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create schema storage;
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(t text) returns text[]
      language sql as $$ select string_to_array(t, '/') $$;
    alter table storage.objects enable row level security;
  `)
}

/**
 * Migrationerne i JOURNALENS rækkefølge — ikke filnavnenes på disk. Det er
 * netop den forskel, `npm run db:status` findes for.
 *
 * Kaster ved første fejl. Kan en migration ikke køre på en tom base, kan
 * basen heller ikke genskabes, og så er det migrationen, der skal rettes.
 */
export async function koerMigrationer(db, mappe = 'db/migrations') {
  const journal = JSON.parse(readFileSync(`${mappe}/meta/_journal.json`, 'utf8')).entries
  const filer = readdirSync(mappe).filter((f) => f.endsWith('.sql'))
  for (const post of journal) {
    const fil = filer.find((f) => f.startsWith(post.tag))
    if (!fil) throw new Error(`journalen nævner ${post.tag}, men filen mangler`)
    try {
      await db.exec(readFileSync(`${mappe}/${fil}`, 'utf8'))
    } catch (e) {
      throw new Error(`${fil} kunne ikke køre på en tom base: ${e.message}`)
    }
  }
  return journal.length
}
