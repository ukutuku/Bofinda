// ═══════════════════════════════════════════════════════════════
//  Ingen tabel i public må stå åben for anon eller authenticated.
//
//  HVORFOR DEN FINDES: Supabase har ALTER DEFAULT PRIVILEGES i skema
//  public, der giver anon, authenticated og service_role `arwdDxtm` —
//  læs, indsæt, opdatér, slet — på FREMTIDIGE tabeller. Migrationerne
//  køres som `postgres`, så enhver ny tabel arver det i samme sekund,
//  den oprettes. Og `pgrst_ddl_watch` genindlæser PostgREST' skemacache
//  automatisk ved DDL, så den er eksponeret uden forsinkelse.
//
//  De 12 tabeller, der findes i dag, er kun dækket, fordi 0002, 0007 og
//  0010 huskede at skrive revoke. 0007 og 0010 måtte gentage det per
//  tabel — mønstret har allerede ramt to gange.
//
//  30. OKTOBER 2026 VENDER GRUNDEN, men kontrollen bliver stående. Fra da
//  anvender Supabase den nye standard på eksisterende projekter: nye
//  tabeller er IKKE eksponeret. Faren er så ikke længere en glemt revoke,
//  men at nogen GIVER anon en grant for at «løse» en manglende adgang.
//  Kontrollen fanger begge dele, fordi den måler rettigheder — ikke om
//  nogen huskede noget. Kilde: supabase.com/changelog, 28. april 2026.
//
//  MÅLER BASEN, IKKE FILERNE. En migration kan se rigtig ud og alligevel
//  ikke være kørt; en rettighed kan være sat i dashboardet. Derfor
//  has_table_privilege mod den kørende base og intet andet.
//
//      npm run tjek:rettigheder     mod produktionen
//      npm test                     mod testbasen, som del af prøven
// ═══════════════════════════════════════════════════════════════

import { db } from '../db/client'
import { sql } from 'drizzle-orm'

/** Enhver rettighed på en tabel er for meget. Vi lister dem alle. */
const TABELRET = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'

export interface Fund {
  navn: string
  slags: string
  grund: string
}

interface Raekke {
  navn: string
  slags: string
  rls: boolean | null
  anon: boolean
  auth: boolean
}

const raekker = <T>(r: unknown): T[] =>
  (r as { rows?: T[] }).rows ?? (r as T[])

/**
 * Alt i public, målt med rigtige privilegie-opslag.
 *
 * Tabeller skal BÅDE have RLS slået til OG være uden rettigheder til de
 * to offentlige roller. Views og sekvenser kan ikke have RLS — for dem er
 * kravet kun rettighederne. Funktioner giver som standard EXECUTE til
 * PUBLIC, så de skal revokes udtrykkeligt.
 */
export async function tjekRettigheder(): Promise<Fund[]> {
  const fund: Fund[] = []

  const objekter = raekker<Raekke>(await db.execute(sql`
    select c.relname::text as navn,
           case c.relkind when 'r' then 'tabel' when 'p' then 'tabel'
                when 'v' then 'view' when 'm' then 'matview'
                when 'S' then 'sekvens' end as slags,
           case when c.relkind in ('r','p') then c.relrowsecurity else null end as rls,
           case when c.relkind = 'S'
                then has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
                else has_table_privilege('anon', c.oid, ${TABELRET}) end as anon,
           case when c.relkind = 'S'
                then has_sequence_privilege('authenticated', c.oid, 'USAGE, SELECT, UPDATE')
                else has_table_privilege('authenticated', c.oid, ${TABELRET}) end as auth
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
    order by c.relname`))

  for (const o of objekter) {
    const aabne = [o.anon && 'anon', o.auth && 'authenticated'].filter(Boolean)
    if (aabne.length) {
      fund.push({
        navn: o.navn, slags: o.slags,
        grund: `har stadig rettigheder til ${aabne.join(' og ')}`
          + ` — skriv: revoke all on ${o.navn} from anon, authenticated;`,
      })
    }
    if (o.rls === false) {
      fund.push({
        navn: o.navn, slags: o.slags,
        grund: 'mangler row level security'
          + ` — skriv: alter table "${o.navn}" enable row level security;`,
      })
    }
  }

  const funktioner = raekker<{ navn: string; anon: boolean; auth: boolean }>(await db.execute(sql`
    select p.proname::text as navn,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname`))

  for (const f of funktioner) {
    const aabne = [f.anon && 'anon', f.auth && 'authenticated'].filter(Boolean)
    if (aabne.length) {
      fund.push({
        navn: f.navn, slags: 'funktion',
        grund: `må køres af ${aabne.join(' og ')}`
          + ` — skriv: revoke all on function ${f.navn} from anon, authenticated, public;`,
      })
    }
  }
  return fund
}

/** Kørt direkte: mod hvad end DATABASE_URL peger på. */
if (process.argv[1]?.endsWith('tjek-rettigheder.ts')) {
  const { luk } = await import('../db/client')
  const fund = await tjekRettigheder()
  if (fund.length === 0) {
    console.log('  ✓ Intet i public er åbent for anon eller authenticated,'
      + ' og alle tabeller har RLS.')
  } else {
    console.log(`  ✗ ${fund.length} problem(er):\n`)
    for (const f of fund) console.log(`    ${f.slags} ${f.navn}\n      ${f.grund}`)
  }
  await luk()
  process.exit(fund.length ? 1 : 0)
}
