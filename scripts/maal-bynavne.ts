// ═══════════════════════════════════════════════════════════════
//  Uafgjorte bynavne — hvor afgør collationen, hvad et postnummer hedder?
//
//  `mode() within group (order by city)` vælger den hyppigste stavemåde.
//  Står to lige, vinder den, der sorterer FØRST — og ordenen er basens
//  collation: C i testbasen, ICU en-US i produktionen. Ingen har valgt
//  den til formålet.
//
//  Tre steder bruger det, over to sæt:
//    · synlige (`synlig` i lib/omraade.ts, dedupet): navnet på
//      postnummersiden og i dens meta-beskrivelse (`alleOmraader`), og
//      hvilken byside der linkes til som nabo (`naboer`). URL'en er
//      postnummeret alene og rammes ikke.
//    · alle rækker med postnummer og by, uanset status: den by, en
//      udlejerannonce får GEMT (`byForPostnr`, kaldt fra opretBolig).
//
//  For hvert sæt: postnumre med mindst to stavemåder, postnumre hvor to
//  eller flere står LIGE øverst, og hvem der vinder under basens egen
//  collation, under C og — findes den — under da-x-icu.
//
//  Kun SELECT. Kør mod produktionen:
//    npx tsx --tsconfig tsconfig.scripts.json --env-file=.env scripts/maal-bynavne.ts
// ═══════════════════════════════════════════════════════════════

import { and, isNotNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { listings } from '../db/schema'
import { MINDST_BOLIGER } from '../lib/slug'
import { synlig } from '../lib/omraade'

const raekker = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows: T[] }).rows)

export interface Uafgjort {
  postnr: string
  antal: number            // rækker i postnummeret i dette sæt
  lige: string[]           // stavemåderne, der står lige øverst
  hver: number             // deres fælles antal
  basen: string            // mode() under basens collation — det, siden viser i dag
  c: string                // mode() under C — det, testbasen ville vise
  dansk: string | null     // mode() under da-x-icu, hvis den findes
}

export interface Saetmaaling {
  saet: string
  postnumre: number
  flereStavemaader: number
  uafgjorte: Uafgjort[]
}

async function maalSaet(navn: string, hvor: SQL, harDansk: boolean): Promise<Saetmaaling> {
  const by = listings.city
  const optaelling = await db
    .select({ postnr: listings.postalCode, by, n: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(hvor, isNotNull(listings.postalCode), isNotNull(by)))
    .groupBy(listings.postalCode, by)
  const vindere = await db
    .select({
      postnr: listings.postalCode,
      basen: sql<string>`mode() within group (order by ${by})`,
      c: sql<string>`mode() within group (order by ${by} collate "C")`,
      dansk: harDansk
        ? sql<string>`mode() within group (order by ${by} collate "da-x-icu")`
        : sql<null>`null::text`,
    })
    .from(listings)
    .where(and(hvor, isNotNull(listings.postalCode), isNotNull(by)))
    .groupBy(listings.postalCode)

  const pr = new Map<string, { by: string; n: number }[]>()
  for (const r of optaelling) {
    const l = pr.get(r.postnr!) ?? []
    l.push({ by: r.by!, n: r.n })
    pr.set(r.postnr!, l)
  }
  const vinder = new Map(vindere.map((v) => [v.postnr!, v]))
  const uafgjorte: Uafgjort[] = []
  let flere = 0
  for (const [postnr, l] of pr) {
    if (l.length >= 2) flere++
    const top = Math.max(...l.map((x) => x.n))
    const lige = l.filter((x) => x.n === top).map((x) => x.by)
    if (lige.length < 2) continue
    const v = vinder.get(postnr)!
    uafgjorte.push({
      postnr, antal: l.reduce((s, x) => s + x.n, 0), lige: lige.sort(), hver: top,
      basen: v.basen, c: v.c, dansk: v.dansk,
    })
  }
  uafgjorte.sort((a, b) => a.postnr.localeCompare(b.postnr))
  return { saet: navn, postnumre: pr.size, flereStavemaader: flere, uafgjorte }
}

export async function maalBynavne() {
  const [info] = raekker<{ v: string; collate: string; udbyder: string; dansk: boolean }>(await db.execute(sql`
    select current_setting('server_version') as v, datcollate as collate,
           case datlocprovider when 'c' then 'libc' when 'i' then 'icu'
                               when 'b' then 'builtin' end as udbyder,
           exists (select 1 from pg_collation where collname = 'da-x-icu') as dansk
    from pg_database where datname = current_database()`))
  const saet = [
    await maalSaet('synlige (alleOmraader, naboer)', synlig!, info!.dansk),
    await maalSaet('alle med postnummer og by (byForPostnr)', sql`true`, info!.dansk),
  ]
  return { info: info!, saet }
}

if (process.argv[1]?.endsWith('maal-bynavne.ts')) {
  const { info, saet } = await maalBynavne()
  console.log(`\nbasen: Postgres ${info.v}, ${info.udbyder} ${info.collate}, da-x-icu ${info.dansk ? 'findes' : 'findes ikke'}`)
  for (const s of saet) {
    const anderledes = s.uafgjorte.filter((u) => u.basen !== u.c)
    const medSide = s.uafgjorte.filter((u) => u.antal >= MINDST_BOLIGER)
    console.log(`\n══ ${s.saet} ══`)
    console.log(`  postnumre: ${s.postnumre}`)
    console.log(`  med mindst to stavemåder: ${s.flereStavemaader}`)
    console.log(`  med to eller flere LIGE øverst: ${s.uafgjorte.length}`
      + ` (heraf ${medSide.length} med mindst ${MINDST_BOLIGER} rækker)`)
    console.log(`  … hvor basens collation og C vælger forskelligt: ${anderledes.length}`)
    for (const u of s.uafgjorte) {
      console.log(`    ${u.postnr}  ${u.antal} rækker · lige med ${u.hver}: ${u.lige.map((x) => `«${x}»`).join(', ')}`
        + `  → basen «${u.basen}» · C «${u.c}»${u.dansk == null ? '' : ` · da «${u.dansk}»`}`)
    }
  }
  console.log('')
  process.exit(0)
}
