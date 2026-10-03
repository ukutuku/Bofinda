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
  // Rollerne er KLYNGEomfattende, ikke databaseomfattende. I PGlite er
  // klyngen ny hver gang, men paa en rigtig server deles den af flere
  // databaser — og der findes rollerne allerede, naar nabodatabasen har
  // faaet skemaet. `create role` ville da fejle med 42710 og tage hele
  // opstillingen med sig.
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon')
        then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated')
        then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role')
        then create role service_role; end if;
    end $$;
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

  // ── De to former, drizzle springer over i tavshed ───────────────
  // Tallet «N migrationer» tæller journalposter. Uden de to tjek nedenfor
  // kunne det se ud som et svar på «er migrationerne dækket» og dække
  // mindre: en fil uden post blev hverken kørt eller talt.
  //
  // 1. En .sql-fil uden journalpost køres aldrig — hverken her eller af
  //    drizzle-kit i produktionen.
  const udenPost = filer.filter((f) => !journal.some((e) => f.startsWith(e.tag)))
  if (udenPost.length) {
    throw new Error(`${udenPost.join(', ')} har ingen post i meta/_journal.json og ville aldrig blive kørt`)
  }
  // 2. drizzle-orm kører kun en migration, hvis dens `when` er større end
  //    den senest kørte (pg-core/dialect.js:62). Falder `when` i journalens
  //    rækkefølge, springes den senere post over i produktionen. Se CLAUDE.md
  //    under «Migrationer køres IKKE af Vercel-bygget». Hvad der ALLEREDE er
  //    kørt i produktionen, kan testbasen ikke se — det kan kun db:status.
  for (let i = 1; i < journal.length; i++) {
    if (!(journal[i].when > journal[i - 1].when)) {
      throw new Error(`${journal[i].tag} har when ${journal[i].when}, ikke efter ${journal[i - 1].tag} (${journal[i - 1].when}) — drizzle ville springe den over`)
    }
  }
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
