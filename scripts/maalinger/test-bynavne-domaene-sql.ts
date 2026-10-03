// ═══════════════════════════════════════════════════════════════
//  gruppe: kerne
//  Prøver de gengivne blokke fra skriv-bynavne-domaene-sql.ts mod et facit,
//  der er SKREVET UD HER, før blokkene køres.
//
//  Blokkene køres ordret, som de ville blive indsat i SQL-editoren, mod
//  boliger, hvis svar er konstrueret på forhånd: uafgjorte bynavne, hvor
//  vinderen skifter med collationen, og domænegrupper, hvor repræsentanten
//  passer eller ikke passer.
//
//  Facit findes for to motorer, fordi bynavnenes vindere AFHÆNGER af
//  collationen — det er netop det, blokkene måler:
//    · testbasen (PGlite): basens collation er C, og da-x-icu er attrappen
//      med ICU's rod (scripts/pglite-skema.mjs).
//    · en rigtig Postgres med ICU: basens collation er en-US, da-x-icu er dansk.
//  Hvilken motor prøven står på, afgøres ved at sortere — ikke ved kataloget.
//
//  Kører i npm test mod testbasen. Lægger en kilde med slug 'propstep' ind
//  for at få en kildekontrakt og sletter den igen; derfor kører den aldrig
//  mod produktionen.
// ═══════════════════════════════════════════════════════════════

import { createHash, randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { listingImages, listings, sources } from '../../db/schema'
import { blokke, INDSTILLINGER } from './skriv-bynavne-domaene-sql'
import { fortolk, type Annonce } from './fortolk-domaene'

if (process.env.BOFINDA_PROEV_PRODUKTION === '1') {
  console.error('test-bynavne-domaene-sql: kører kun mod en prøvebase — den lægger en kilde ind med en rigtig slug')
  process.exit(1)
}

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}
const raekker = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows: T[] }).rows)
const koer = async <T>(s: string) => raekker<T>(await db.execute(sql.raw(s.replace(/;\s*$/, ''))))

console.log('\n══ målingernes SQL: gengivet af appens udtryk, prøvet mod facit ══\n')

// ── Hvilken motor? Målt ved at sortere ─────────────────────────
const [orden] = await koer<{ std: string; da: string }>(`select
  (select string_agg(x, ',' order by x) from unnest(array['Brønshøj','amager']) x) as std,
  (select string_agg(x, ',' order by x collate "da-x-icu") from unnest(array['Aabenraa','Zealand']) x) as da`)
const MOTOR = orden!.std === 'Brønshøj,amager' && orden!.da === 'Aabenraa,Zealand' ? 'testbasen'
  : orden!.std === 'amager,Brønshøj' && orden!.da === 'Zealand,Aabenraa' ? 'icu'
    : null
tjek('motoren er en af de to, der er skrevet facit for', MOTOR !== null, `standard ${orden!.std} · da-x-icu ${orden!.da}`)
if (!MOTOR) process.exit(1)
console.log(`  (facit for ${MOTOR === 'testbasen' ? 'testbasen: C og attrappen' : 'Postgres med ICU: en-US og dansk'})\n`)
const F = <T>(testbasen: T, icu: T): T => (MOTOR === 'testbasen' ? testbasen : icu)

// ═══ FACIT — skrevet før blokkene køres ═══════════════════════
//
//  Bynavne (postnummer: stavemåder, alle aktive og unikke boliger):
//    9001  Åbenrå 2 · Zealand 2 · Aarhus 1        uafgjort i begge sæt
//    9002  København N 3 · Kbh N 1                ikke uafgjort
//    9003  Brønshøj 2 · amager 2                  uafgjort i begge sæt
//    9004  Østerbro 2 · Nørrebro 1 (+1 AFMELDT)   uafgjort KUN i «alle»
//    9005  Aabenraa 1 · Zealand 1                 uafgjort i begge sæt
//    9006  Zealand 2 · Aabenraa 1 + udlejer 1     uafgjort i begge sæt
//    9007  udlejer Ølstykke 1                     én stavemåde — med i B1, ikke i B3
//
//  Vinder ved uafgjort:      C (testbasen)   rod (attrappen)   en-US      dansk
//    Åbenrå/Zealand          Zealand         Åbenrå            Åbenrå     Zealand
//    Brønshøj/amager         Brønshøj        amager            amager     amager
//    Nørrebro/Østerbro       Nørrebro        Nørrebro          Nørrebro   Nørrebro
//    Aabenraa/Zealand        Aabenraa        Aabenraa          Aabenraa   Zealand
const B1_FACIT = {
  synlige: { postnumre: 7, flere: 6, uafgjort: 4, dansk: F(2, 3), testbasen: F(0, 2) },
  alle: { postnumre: 7, flere: 6, uafgjort: 5, dansk: F(2, 3), testbasen: F(0, 2) },
}
const B2_FACIT: Record<string, { lige: string; idag: string; dansk: string; c: string }> = {
  'synlige 9001': { lige: 'Zealand | Åbenrå', idag: F('Zealand', 'Åbenrå'), dansk: F('Åbenrå', 'Zealand'), c: 'Zealand' },
  'synlige 9003': { lige: 'Brønshøj | amager', idag: F('Brønshøj', 'amager'), dansk: 'amager', c: 'Brønshøj' },
  'synlige 9005': { lige: 'Aabenraa | Zealand', idag: 'Aabenraa', dansk: F('Aabenraa', 'Zealand'), c: 'Aabenraa' },
  'synlige 9006': { lige: 'Aabenraa | Zealand', idag: 'Aabenraa', dansk: F('Aabenraa', 'Zealand'), c: 'Aabenraa' },
  'alle 9001': { lige: 'Zealand | Åbenrå', idag: F('Zealand', 'Åbenrå'), dansk: F('Åbenrå', 'Zealand'), c: 'Zealand' },
  'alle 9003': { lige: 'Brønshøj | amager', idag: F('Brønshøj', 'amager'), dansk: 'amager', c: 'Brønshøj' },
  'alle 9004': { lige: 'Nørrebro | Østerbro', idag: 'Nørrebro', dansk: 'Nørrebro', c: 'Nørrebro' },
  'alle 9005': { lige: 'Aabenraa | Zealand', idag: 'Aabenraa', dansk: F('Aabenraa', 'Zealand'), c: 'Aabenraa' },
  'alle 9006': { lige: 'Aabenraa | Zealand', idag: 'Aabenraa', dansk: F('Aabenraa', 'Zealand'), c: 'Aabenraa' },
}
// Kun 9006 — 9007 har én stavemåde.
const B3_FACIT = [{
  postnr: '9006', gemt_by: 'Aabenraa', udlejerannoncer: 1, heraf_aktive: 1, uafgjort_oeverst_i_dag: true,
  vinder_i_dag: 'Aabenraa', vinder_dansk: F('Aabenraa', 'Zealand'),
  gemt_er_dagens_vinder: true, dansk_ville_vaelge_andet: F(false, true),
}]
//  Domæne (uden postnummer, så de ikke tæller i bynavnene):
//    U1  propstep «Reserved», 0 billeder  +  prøvekilde uden kontrakt, 2 billeder (repræsentant)
//    U2  propstep «Reserved», 3 billeder (repræsentant)  +  prøvekilde 2, 0 billeder
//    U3  propstep «Reserved» alene
//    U4  to prøvekilder uden kontrakt
//  Under «reserveret»: U1 TABT (repræsentanten passer ikke, propstep gør),
//  U2 vist, U1 og U2 står på hver sin side. U4 kan ikke skilles.
//  U1 og U2 har hver sin kilde uden kontrakt, så en vendt rangering — der
//  ville lade U2 tabe i stedet — ikke kan give samme svar.
const D1_FACIT = { flere: 3, kontrakt: 2, hoejst: 2, ugyldige: 0 }
const D2_FACIT = { boliger: 2, annoncer: 4, reserveretDelte: 2, reserveretTabte: 1, andreTabte: 0 }
//  FULD-NULL: én kilde med tre totaler uden poster — to aktive, én af dem med el.
const F1_FACIT = { kilder: 1, total_uden_poster: 3, heraf_aktive: 2, heraf_med_linjen_el_indgaar_ikke: 1 }
//  S1: hver navngiven indstilling som sin egen række, og alle findes i begge
//  motorer (målt). Dertil fire rækker om basens collation, tre om da-x-icu
//  og fire om statistikken på listings og listing_images. Collationen er
//  det, motorerne skal være UENIGE om.
const S1_FACIT = {
  rækker: INDSTILLINGER.reduce((n, [, navne]) => n + navne.length, 0) + 4 + 3 + 4,
  udbyder: F('libc', 'icu'), skema: F('attrap', 'pg_catalog'), locale: F('und', 'da'),
}

// ── Prøvedata ───────────────────────────────────────────────────
const koersel = Date.now()
const [kilde] = await db.insert(sources).values({ slug: `maal-${koersel}`, name: 'Prøvekilde (måling)', sourceType: 'feed' }).returning()
const [kilde2] = await db.insert(sources).values({ slug: `maal2-${koersel}`, name: 'Prøvekilde 2 (måling)', sourceType: 'feed' }).returning()
const [kontrakt] = await db.insert(sources).values({ slug: 'propstep', name: 'Prøvekilde med kontrakt (kun til prøver)', sourceType: 'spider' }).returning()
const [fuld] = await db.insert(sources).values({ slug: `maal-fuld-${koersel}`, name: 'Prøvekilde (FULD-NULL)', sourceType: 'feed' }).returning()
const [native] = await db.select().from(sources).where(eq(sources.slug, 'native'))
const vores = [kilde!.id, kilde2!.id, kontrakt!.id, fuld!.id]
let nr = 0
const bolig = (k: { id: string; sourceType: string }, felter: Record<string, unknown>) => ({
  sourceId: k.id, sourceType: k.sourceType, externalKey: `maal-${koersel}-${nr}`,
  sourceUrl: `https://example.invalid/maal/${koersel}/${nr++}`, addressRaw: 'Prøvegade 1',
  status: 'active', addressMatchLevel: 'unit', unitAddressUuid: randomUUID(), rentMonthly: 800000, ...felter,
})
const nativeIder: string[] = []
try {
  const by = (postnr: string, navn: string, antal: number, ekstra: Record<string, unknown> = {}) =>
    Array.from({ length: antal }, () => bolig(kilde!, { postalCode: postnr, city: navn, ...ekstra }))
  await db.insert(listings).values([
    ...by('9001', 'Åbenrå', 2), ...by('9001', 'Zealand', 2), ...by('9001', 'Aarhus', 1),
    ...by('9002', 'København N', 3), ...by('9002', 'Kbh N', 1),
    ...by('9003', 'Brønshøj', 2), ...by('9003', 'amager', 2),
    ...by('9004', 'Østerbro', 2), ...by('9004', 'Nørrebro', 1), ...by('9004', 'Nørrebro', 1, { status: 'delisted' }),
    ...by('9005', 'Aabenraa', 1), ...by('9005', 'Zealand', 1),
    ...by('9006', 'Zealand', 2), ...by('9006', 'Aabenraa', 1),
  ] as never)
  const nat = await db.insert(listings).values([
    bolig(native!, { postalCode: '9006', city: 'Aabenraa' }),
    bolig(native!, { postalCode: '9007', city: 'Ølstykke' }),
  ] as never).returning({ id: listings.id })
  nativeIder.push(...nat.map((x) => x.id))

  // Domæne. Billederne afgør repræsentanten (UNIKKE_BILLEDER).
  const dom = async (k: { id: string; sourceType: string }, enhed: string, fakta: object, billeder: number) => {
    const [l] = await db.insert(listings).values(bolig(k, { unitAddressUuid: enhed, availabilityFacts: fakta }) as never).returning()
    for (let i = 0; i < billeder; i++) {
      await db.insert(listingImages).values({ listingId: l!.id, externalUrl: `https://app.propstep.com/api/image/find-public/maal/${l!.id}/${i}.jpg`, position: i } as never)
    }
  }
  const [u1, u2, u3, u4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  await dom(kontrakt!, u1, { rawStatus: 'Reserved' }, 0); await dom(kilde!, u1, {}, 2)
  await dom(kontrakt!, u2, { rawStatus: 'Reserved' }, 3); await dom(kilde2!, u2, {}, 0)
  await dom(kontrakt!, u3, { rawStatus: 'Reserved' }, 0)
  await dom(kilde!, u4, {}, 1); await dom(kilde2!, u4, {}, 0)

  // FULD-NULL.
  await db.insert(listings).values([
    bolig(fuld!, { totalMonthly: 1000000, totalMonthlyComponents: null }),
    bolig(fuld!, { totalMonthly: 1000000, totalMonthlyComponents: null, status: 'delisted' }),
    bolig(fuld!, { totalMonthly: 1000000, totalMonthlyComponents: null, utilitiesElectricity: 50000 }),
    bolig(fuld!, { totalMonthly: 1000000, totalMonthlyComponents: ['rent', 'heat'] }),
  ] as never)

  // ── Blokkene, ordret ────────────────────────────────────────
  const B = Object.fromEntries(blokke().map((b) => [b.navn, b.sql]))
  for (const b of blokke()) {
    tjek(`${b.navn} indeholder kun læsning`, !/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy)\b/i
      .test(b.sql.replace(/--[^\n]*/g, '')), '')
  }

  const b1 = await koer<Record<string, number | string>>(B.B1!)
  for (const [navn, f] of Object.entries(B1_FACIT)) {
    const r = b1.find((x) => String(x.saet).startsWith(navn))
    const faktisk = r && { postnumre: +r.postnumre!, flere: +r.med_flere_stavemaader!, uafgjort: +r.med_uafgjort_oeverst!,
      dansk: +r.dansk_ville_vaelge_andet!, testbasen: +r.testbasen_vaelger_andet! }
    tjek(`B1 ${navn}`, JSON.stringify(faktisk) === JSON.stringify(f), `${JSON.stringify(faktisk)} · facit ${JSON.stringify(f)}`)
  }

  const b2 = await koer<Record<string, string | number>>(B.B2!)
  tjek('B2 har præcis de uafgjorte postnumre', b2.length === Object.keys(B2_FACIT).length, `${b2.length} rækker`)
  for (const [noegle, f] of Object.entries(B2_FACIT)) {
    const r = b2.find((x) => `${x.saet} ${x.postnr}` === noegle)
    const faktisk = r && { lige: r.lige_oeverst, idag: r.vinder_i_dag, dansk: r.vinder_dansk, c: r.vinder_i_testbasen }
    tjek(`B2 ${noegle}`, JSON.stringify(faktisk) === JSON.stringify(f), `${JSON.stringify(faktisk)}`)
  }

  const b3 = await koer<Record<string, unknown>>(B.B3!)
  const b3n = b3.map((r) => ({ postnr: r.postnr, gemt_by: r.gemt_by, udlejerannoncer: Number(r.udlejerannoncer),
    heraf_aktive: Number(r.heraf_aktive), uafgjort_oeverst_i_dag: r.uafgjort_oeverst_i_dag, vinder_i_dag: r.vinder_i_dag,
    vinder_dansk: r.vinder_dansk, gemt_er_dagens_vinder: r.gemt_er_dagens_vinder, dansk_ville_vaelge_andet: r.dansk_ville_vaelge_andet }))
  tjek('B3 udlejernes gemte bynavne', JSON.stringify(b3n) === JSON.stringify(B3_FACIT), JSON.stringify(b3n))

  const [d1] = await koer<Record<string, number>>(B.D1!)
  const d1f = { flere: +d1!.boliger_med_flere_annoncer!, kontrakt: +d1!.heraf_med_en_kildekontrakt!,
    hoejst: +d1!.heraf_kan_staa_paa_hver_sin_side_hoejst!, ugyldige: +d1!.uden_praecis_en_repraesentant! }
  tjek('D1 øvre grænse', JSON.stringify(d1f) === JSON.stringify(D1_FACIT), JSON.stringify(d1f))

  const [d2] = await koer<{ boliger: number; annoncer: number; til_fortolkning: unknown }>(B.D2!)
  const celle = typeof d2!.til_fortolkning === 'string' ? JSON.parse(d2!.til_fortolkning) : d2!.til_fortolkning
  const f = fortolk(celle as Annonce[], new Date())
  const res = f.find((x) => x.filter === 'markedsstatus = reserveret')!
  const d2f = { boliger: +d2!.boliger, annoncer: +d2!.annoncer, reserveretDelte: res.delte, reserveretTabte: res.tabte.length,
    andreTabte: f.filter((x) => x !== res).reduce((s, x) => s + x.tabte.length, 0) }
  tjek('D2 + appens fortolkning', JSON.stringify(d2f) === JSON.stringify(D2_FACIT), JSON.stringify(d2f))
  // D2 kalder boligen md5(dedup-nøglen); på enhedsniveau er nøglen 'unit:' + uuid.
  const u1noegle = createHash('md5').update(`unit:${u1}`).digest('hex')
  tjek('… den tabte bolig er U1, hvor kilden uden kontrakt er repræsentant',
    res.tabte.length === 1 && res.tabte[0]!.bolig === u1noegle && res.tabte[0]!.rep === kilde!.slug
      && res.tabte[0]!.passer.join() === 'propstep',
    JSON.stringify(res.tabte.map((t) => [t.bolig === u1noegle ? 'U1' : t.bolig.slice(0, 8), t.rep, t.passer])))

  const f1 = await koer<Record<string, unknown>>(B.F1!)
  const vf = f1.find((r) => r.kilde === fuld!.name)
  const f1f = { kilder: f1.length, total_uden_poster: Number(vf?.total_uden_poster), heraf_aktive: Number(vf?.heraf_aktive),
    heraf_med_linjen_el_indgaar_ikke: Number(vf?.heraf_med_linjen_el_indgaar_ikke) }
  tjek('F1 total uden poster', JSON.stringify(f1f) === JSON.stringify(F1_FACIT), JSON.stringify(f1f))

  const s1 = await koer<{ gruppe: string; navn: string; vaerdi: string | null; findes: boolean }>(B.S1!)
  const v = (navn: string) => s1.find((r) => r.navn === navn)?.vaerdi
  const mangler = s1.filter((r) => !r.findes).map((r) => r.navn)
  tjek('S1 har én række pr. navngiven indstilling og de elleve om collation og statistik',
    s1.length === S1_FACIT.rækker, `${s1.length} rækker · facit ${S1_FACIT.rækker}`)
  tjek('… og hver navngiven indstilling findes her', mangler.length === 0, mangler.join(', ') || 'alle')
  const [nu] = await koer<{ jit: string }>(`select current_setting('jit') as jit`)
  tjek('… jit-rækken er sessionens egen værdi', v('jit') === nu!.jit, `${v('jit')}`)
  const s1f = { udbyder: v('database: udbyder'), skema: v('da-x-icu: skema'), locale: v('da-x-icu: locale') }
  tjek('… collationen er den, motoren har', JSON.stringify(s1f) === JSON.stringify(
    { udbyder: S1_FACIT.udbyder, skema: S1_FACIT.skema, locale: S1_FACIT.locale }), JSON.stringify(s1f))
} finally {
  await db.delete(listings).where(inArray(listings.sourceId, vores))
  if (nativeIder.length) await db.delete(listings).where(inArray(listings.id, nativeIder))
  await db.delete(sources).where(inArray(sources.id, vores))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl ? 1 : 0)
