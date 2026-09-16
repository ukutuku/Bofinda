// ═══════════════════════════════════════════════════════════════
//  Hvor mange RIGTIGE boliger rammer Home-rettelsens `rooms`?
//
//  `scripts/cloud/home-vaerelser.ts` maaler MEKANISMERNE paa et
//  syntetisk saet i den isolerede base. Den kan per konstruktion ikke
//  koere mod produktionen — den afviser enhver anden forbindelse — og
//  dens tal siger derfor intet om, hvor mange boliger der faktisk
//  rammes. Den her fil er det manglende led.
//
//  ── HVORFOR DEN KAN MAALE NOGET, FOER IMPORTEN HAR KOERT ──────
//  Produktionen har `rooms = null` paa hver eneste home-raekke, indtil
//  rettelsen er i importjobbets aktive kode OG jobbet har behandlet
//  annoncerne. Vi kan altsaa ikke se EFTER-tilstanden. Men vi kan maale
//  KANDIDATERNE: de raekker, hvor et vaerelsestal overhovedet KAN aendre
//  udfaldet. Det giver en OEVRE graense pr. mekanisme — ingen bolig uden
//  for de maengder kan skifte plads, uanset hvad kilden oplyser.
//
//  Det er en risikoopgoerelse, ikke en forudsigelse. Hvor mange af
//  kandidaterne der faktisk skifter, afhaenger af, om vaerelsestallene
//  STEMMER paa tvaers — og det kan foerst ses, naar tallene er hentet.
//
//  ── DE TRE MEKANISMER ────────────────────────────────────────
//    1 · GRUPPEKORT.  `KAN_GRUPPERES` kraever `rooms is not null`.
//        Kandidater: home-raekker hvor ALT ANDET er opfyldt (vej,
//        postnummer, pris), saa `rooms` er det eneste, der spaerrer.
//        Faerre kort, SAMME antal boliger.
//    2 · ACCESS-DEDUP.  Noeglen baerer `coalesce(rooms::text,'?')`.
//        Gaar BEGGE veje:
//          a) home kan begynde at matche en ANDEN kildes annonce
//             (en bolig SKJULES bag den anden kildes kort);
//          b) to home-raekker, der i dag begge er '?' og derfor dedupes
//             mod hinanden, kan SKILLES AD (en bolig kommer FREM).
//    3 · UNIT-DEDUP.  Noeglen er `unit:<uuid>` og intet andet.
//        Vaerelsestallet indgaar ikke. Kan per definition ikke aendres —
//        maales alligevel, saa paastanden har et tal bag sig.
//
//  ── KUN LAESNING ─────────────────────────────────────────────
//  Ingen insert, update eller delete. Ingen import. Der laeses kun de
//  felter, de tre noegler bruger — ingen kontaktfelter, ingen adresse-
//  streng ud over vej og husnummer, ingen beskrivelser.
//
//  ── BASEN NAVNGIVES I UDSKRIFTEN ─────────────────────────────
//  Et stagingtal maa aldrig laeses som et produktionstal, saa vaert,
//  databasenavn og projekt-ref skrives ud FOER tallene. Er du i tvivl
//  om, hvad du kiggede paa, staar det i hovedet af rapporten.
//
//      DATABASE_URL_DIRECT=… npx tsx --tsconfig tsconfig.scripts.json \
//        scripts/maal-home-rooms.ts
// ═══════════════════════════════════════════════════════════════
import { sql } from 'drizzle-orm'
import { db } from '../db/client'

const KILDE = process.env.HOME_SLUG ?? 'home'

/** Vaerten, databasen og Supabase-ref'en — saa tallene kan henfoeres. */
function hvilkenBase(): string {
  const raa = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
  if (!raa) return '(ingen DATABASE_URL — scriptet kan ikke koere)'
  try {
    const u = new URL(raa)
    // Supabase-projektets ref staar i brugernavnet (postgres.<ref>) eller
    // i vaertsnavnet. Adgangskoden roeres aldrig.
    const ref = /postgres\.([a-z0-9]+)/.exec(decodeURIComponent(u.username))?.[1]
      ?? /^([a-z0-9]{20})\./.exec(u.hostname)?.[1] ?? '(ukendt ref)'
    return `${u.hostname}:${u.port || '5432'}${u.pathname} · ref ${ref}`
  } catch { return '(ulaeselig DATABASE_URL)' }
}

// Noeglerne er skrevet af lib/soeg.ts's DEDUPNOEGLE og KAN_GRUPPERES.
// De to steder skal aendres sammen; staar de og driver, maaler vi noget
// andet end det, soegningen goer.
const NOEGLE_UDEN_ROOMS = sql`
  'access:' || l.access_address_uuid
    || ':' || coalesce(l.size_m2::text, '?')
    || ':' || coalesce(round(l.rent_monthly / 10000.0)::text, '?')`

const ER_ACCESS = sql`
  l.status = 'active' and l.delisted_at is null
  and l.address_match_level = 'access'
  and l.access_address_uuid is not null
  and l.house_number is not null`

async function tal(q: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(q) as unknown as { rows?: { n: number }[] } & { n: number }[]
  const raekker = (r.rows ?? r) as { n: number | string }[]
  return Number(raekker[0]?.n ?? 0)
}

async function koer() {
  console.log(`\n══ Datagrundlag ══`)
  console.log(`  base: ${hvilkenBase()}`)
  console.log(`  kilde-slug: ${KILDE}`)
  console.log(`  maalt: LAESNING ALENE — ingen skrivning, ingen import\n`)

  // ── 0 · Hvor mange annoncer kan overhovedet faa et vaerelsestal ──
  const aktive = await tal(sql`
    select count(*)::int as n from listings l
    join sources s on s.id = l.source_id
    where s.slug = ${KILDE} and l.status = 'active' and l.delisted_at is null`)
  const udenRooms = await tal(sql`
    select count(*)::int as n from listings l
    join sources s on s.id = l.source_id
    where s.slug = ${KILDE} and l.status = 'active' and l.delisted_at is null
      and l.rooms is null`)
  const medRooms = aktive - udenRooms

  console.log(`══ 1 · Hvor mange annoncer faar et vaerelsestal ══`)
  console.log(`  aktive ${KILDE}-annoncer:            ${aktive}`)
  console.log(`  heraf UDEN vaerelsestal i dag:      ${udenRooms}   ← oevre graense`)
  console.log(`  heraf MED vaerelsestal i dag:       ${medRooms}`)
  console.log(`  · Hvor mange af de ${udenRooms} der faktisk faar et tal, afhaenger af,`)
  console.log(`    om kilden oplyser stats.rooms paa den enkelte sag. Begge`)
  console.log(`    kildeproever (15. sep.) havde feltet — to sager er ikke et grundlag.\n`)

  // ── 1 · Gruppekort ──────────────────────────────────────────
  // Kandidater: alt andet i KAN_GRUPPERES er opfyldt, saa `rooms` er
  // det ENESTE, der holder boligen ude af en gruppe.
  const grKand = await tal(sql`
    select count(*)::int as n from listings l
    join sources s on s.id = l.source_id
    where s.slug = ${KILDE} and l.status = 'active' and l.delisted_at is null
      and l.rooms is null
      and l.street is not null and l.postal_code is not null
      and coalesce(l.total_monthly, l.rent_monthly) is not null`)
  // Af dem: hvor mange deler vej + postnummer med mindst én anden, saa
  // der faktisk KAN dannes en gruppe (en gruppe paa én er ikke en gruppe).
  const grFaellesskab = await tal(sql`
    select coalesce(sum(antal), 0)::int as n from (
      select count(*)::int as antal from listings l
      join sources s on s.id = l.source_id
      where s.slug = ${KILDE} and l.status = 'active' and l.delisted_at is null
        and l.rooms is null
        and l.street is not null and l.postal_code is not null
        and coalesce(l.total_monthly, l.rent_monthly) is not null
      group by l.source_id, l.landlord_id, l.postal_code, l.street
      having count(*) > 1) t`)

  console.log(`══ 2 · Gruppekort ══`)
  console.log(`  kandidater (kun rooms spaerrer):     ${grKand}`)
  console.log(`  heraf paa en vej med mindst én anden: ${grFaellesskab}   ← oevre graense`)
  console.log(`  · De ${grFaellesskab} kan blive til faerre kort. ANTALLET AF BOLIGER`)
  console.log(`    aendrer sig ikke — et gruppekort daekker dem, det taler for.`)
  console.log(`  · De rammes kun, hvis vaerelsestallene er ENS inden for vejen;`)
  console.log(`    er de forskellige, bliver der flere grupper, ikke én.\n`)

  // ── 2a · Access-dedup: home kan blive SKJULT ────────────────
  // Home-raekker der deler noeglen UDEN rooms med en anden kildes
  // raekke. I dag spaerrer '?' mod tallet; med et tal kan de matche.
  const skjulKand = await tal(sql`
    select count(*)::int as n from listings l
    join sources s on s.id = l.source_id
    where s.slug = ${KILDE} and ${ER_ACCESS} and l.rooms is null
      and exists (
        select 1 from listings a
        join sources sa on sa.id = a.source_id
        where sa.slug <> ${KILDE}
          and a.status = 'active' and a.delisted_at is null
          and a.address_match_level = 'access'
          and a.access_address_uuid = l.access_address_uuid
          and a.house_number is not null
          and coalesce(a.size_m2, -1) = coalesce(l.size_m2, -1)
          and round(coalesce(a.rent_monthly, 0) / 10000.0)
              = round(coalesce(l.rent_monthly, 0) / 10000.0))`)

  // ── 2b · Access-dedup: en home-bolig kan komme FREM ─────────
  // To eller flere home-raekker med samme noegle uden rooms er i dag
  // dedupet mod hinanden (alle '?'). Faar de forskellige tal, skilles de.
  const fremKand = await tal(sql`
    select coalesce(sum(antal - 1), 0)::int as n from (
      select count(*)::int as antal from listings l
      join sources s on s.id = l.source_id
      where s.slug = ${KILDE} and ${ER_ACCESS} and l.rooms is null
      group by ${NOEGLE_UDEN_ROOMS}
      having count(*) > 1) t`)

  console.log(`══ 3 · Dedup paa tvaers af kilder (access) ══`)
  console.log(`  kan blive SKJULT bag en anden kilde:  ${skjulKand}   ← oevre graense`)
  console.log(`    · deler opgang, areal og husleje med en anden kildes annonce.`)
  console.log(`      Skjules KUN hvis vaerelsestallene ogsaa stemmer.`)
  console.log(`  kan komme FREM igen:                  ${fremKand}   ← oevre graense`)
  console.log(`    · home-raekker, der i dag dedupes mod HINANDEN, fordi begge`)
  console.log(`      er '?'. Skilles ad, hvis deres vaerelsestal er forskellige.`)
  console.log(`  · De to traekker hver sin vej. Et uaendret NETTOTAL kan daekke`)
  console.log(`    over, at det ikke er de samme boliger, der vises.\n`)

  // ── 3 · Unit-dedup: kan ikke paavirkes ──────────────────────
  const unit = await tal(sql`
    select count(*)::int as n from listings l
    join sources s on s.id = l.source_id
    where s.slug = ${KILDE} and l.status = 'active' and l.delisted_at is null
      and l.address_match_level = 'unit' and l.unit_address_uuid is not null`)
  console.log(`══ 4 · Praecist boligmatch (unit) ══`)
  console.log(`  ${KILDE}-annoncer paa unit-niveau:     ${unit}`)
  console.log(`  · Noeglen er 'unit:<uuid>' og INTET andet. Vaerelsestallet`)
  console.log(`    indgaar ikke, saa ingen af dem kan skifte plads.\n`)

  // ── Konkrete eksempler, saa tallene kan efterses ────────────
  const eks = await db.execute(sql`
    select l.street, l.house_number, l.postal_code, l.size_m2,
           round(l.rent_monthly / 10000.0) as leje_hundrede,
           sa.slug as anden_kilde, a.rooms as anden_vaerelser
    from listings l
    join sources s on s.id = l.source_id
    join listings a on a.access_address_uuid = l.access_address_uuid
      and a.address_match_level = 'access' and a.house_number is not null
      and a.status = 'active' and a.delisted_at is null
      and coalesce(a.size_m2, -1) = coalesce(l.size_m2, -1)
      and round(coalesce(a.rent_monthly, 0) / 10000.0)
          = round(coalesce(l.rent_monthly, 0) / 10000.0)
    join sources sa on sa.id = a.source_id and sa.slug <> ${KILDE}
    where s.slug = ${KILDE} and ${ER_ACCESS} and l.rooms is null
    limit 10`) as unknown as { rows?: Record<string, unknown>[] }
  const raekker = (eks.rows ?? eks) as Record<string, unknown>[]
  console.log(`══ 5 · Eksempler paa dublet-kandidater (hoejst 10) ══`)
  if (!raekker.length) console.log(`  (ingen)`)
  for (const r of raekker) {
    console.log(`  ${String(r.street)} ${String(r.house_number)}, ${String(r.postal_code)}`
      + ` · ${String(r.size_m2)} m² · ${String(r.leje_hundrede)}00 kr.`
      + ` · modpart: ${String(r.anden_kilde)} med ${r.anden_vaerelser ?? '?'} vaer.`)
  }
  console.log(`  · Stemmer modpartens vaerelsestal med det, home begynder at`)
  console.log(`    oplyse, skjules home-annoncen bag den andens kort.\n`)

  console.log(`══ Hvad tallene IKKE siger ══`)
  console.log(`  Alle tal ovenfor er OEVRE GRAENSER. Hvor mange der faktisk`)
  console.log(`  skifter, kan foerst maales, naar importen har koert med den nye`)
  console.log(`  kode — og skal maales som FOER/EFTER paa de samme raekker.\n`)
}

await koer()
