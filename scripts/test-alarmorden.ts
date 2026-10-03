// ═══════════════════════════════════════════════════════════════
//  gruppe: besked
//  ALARMENS ORDEN — hvem får mail først?
//
//  Den søgning, hvis ældste VENTENDE træf er ældst. Rækkefølgen afgør
//  ikke, om nogen får mail (mailen sendes før `sent_at`, og det usendte
//  bliver i køen), men hvem der venter en time ekstra, når en kørsel
//  afbrydes. Før var den søgningens navn, og de samme navne kom sidst
//  hver gang. Se `aeldsteVentendeFoerst` i lib/alarm.ts.
//
//  Navnene er valgt, så navneordenen er den OMVENDTE af venteordenen:
//  «Aaa» har ventet kortest, «Zzz» længst. Prøven går gennem både
//  `ventende()` og den rigtige `sendAlarmer()`, som sender i den orden.
//
//  Kører kun mod testbasen. `sendAlarmer` kalder `sendMail`; uden
//  RESEND_API_KEY sendes intet. Er nøglen sat, nægter prøven at køre.
// ═══════════════════════════════════════════════════════════════

import { inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { alertMatches, listings, savedSearches, sources, users } from '../db/schema'
import { sendAlarmer, ventende } from '../lib/alarm'

if (process.env.RESEND_API_KEY) {
  console.error('test-alarmorden: RESEND_API_KEY er sat — prøven kalder sendAlarmer() og kører ikke med en rigtig nøgle')
  process.exit(1)
}

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

console.log('\n══ alarmens orden: ældste ventende først ══\n')

const koersel = Date.now()
const [kilde] = await db.insert(sources).values({
  slug: `alarmorden-${koersel}`, name: 'Prøvekilde (alarmorden)', sourceType: 'feed',
}).returning()
const [bruger] = await db.insert(users).values({ email: `alarmorden-${koersel}@example.invalid` }).returning()
const boliger = await db.insert(listings).values(Array.from({ length: 6 }, (_, i) => ({
  sourceId: kilde!.id, sourceType: 'feed' as const, externalKey: `ao-${koersel}-${i}`,
  sourceUrl: `https://example.invalid/ao/${koersel}/${i}`, addressRaw: `Ordensvej ${i + 1}, 0001 Prøveby`,
  postalCode: '0001', city: 'Prøveby', status: 'active' as const, rentMonthly: 800000,
}))).returning({ id: listings.id })
const B = boliger.map((b) => b.id)

try {
  const nu = Date.now()
  const for_ = (timer: number) => new Date(nu - timer * 3600_000)
  const soegning = async (navn: string) => (await db.insert(savedSearches).values({
    userId: bruger!.id, name: navn, criteria: { postnr: '0001' },
    createdAt: for_(100), confirmedAt: for_(100), notifyEmail: true,
  }).returning())[0]!
  const aaa = await soegning('Aaa — først i alfabetet, ventet kortest')
  const bbb = await soegning('Bbb — gammelt træf er SENDT, nyt venter')
  const mmm = await soegning('Mmm — i midten')
  const zzz = await soegning('Zzz — sidst i alfabetet, ventet længst')
  const lige1 = await soegning('Lige-1 — samme øjeblik som Lige-2')
  const lige2 = await soegning('Lige-2 — samme øjeblik som Lige-1')

  const traef = (s: { id: string }, bolig: string, timer: number, sendt = false) =>
    ({ savedSearchId: s.id, listingId: bolig, matchedAt: for_(timer), sentAt: sendt ? for_(timer - 0.5) : null })
  await db.insert(alertMatches).values([
    traef(aaa, B[0]!, 1),
    traef(bbb, B[0]!, 90, true),        // gammelt, men sendt — tæller ikke
    traef(bbb, B[1]!, 2),
    traef(mmm, B[0]!, 5),
    traef(zzz, B[0]!, 10),              // ældst ventende
    traef(zzz, B[2]!, 3),               // nyere i samme mail
    traef(lige1, B[3]!, 7),
    traef(lige2, B[4]!, 7),             // samme øjeblik som lige1
  ])
  const vores = new Set([aaa, bbb, mmm, zzz, lige1, lige2].map((s) => s.id))
  const [foerst, sidst] = [lige1, lige2].map((s) => s.id).sort()
  const navn = (id: string) => [aaa, bbb, mmm, zzz, lige1, lige2].find((s) => s.id === id)!.name!.split(' ')[0]!
  // Ventet: Zzz 10 t · Lige 7 t (to ens) · Mmm 5 t · Bbb 2 t (det sendte på 90 t
  // tæller ikke) · Aaa 1 t. Navneordenen ville være den omvendte.
  const forventet = [zzz.id, foerst!, sidst!, mmm.id, bbb.id, aaa.id].map(navn)

  // ── 1 · ventende() ────────────────────────────────────────
  const grupper = (await ventende()).filter((g) => vores.has(g[0]!.soegningId))
  const orden = grupper.map((g) => navn(g[0]!.soegningId))
  tjek('ventende(): søgningerne står efter ældste ventende træf — ikke efter navn',
    orden.join() === forventet.join(), `${orden.join(' → ')} (forventet ${forventet.join(' → ')})`)
  // Talte Bbbs sendte træf (90 t), stod Bbb først.
  tjek('… et SENDT træf tæller ikke som ventende', orden.indexOf('Bbb') > orden.indexOf('Mmm'),
    `Bbb på plads ${orden.indexOf('Bbb') + 1}`)
  tjek('… to lige gamle afgøres af søgningens id, ens fra kørsel til kørsel',
    orden.indexOf(navn(foerst!)) < orden.indexOf(navn(sidst!)))
  const z = grupper.find((g) => g[0]!.soegningId === zzz.id) ?? []
  tjek('inde i mailen står det nyeste træf øverst',
    z.length === 2 && +z[0]!.matchetKl > +z[1]!.matchetKl, z.map((r) => r.matchetKl.toISOString()).join(' · '))

  // ── 2 · sendAlarmer() sender i den orden ──────────────────
  // Uden nøgle sendes intet, men resultatet kommer i afsendelsesordenen.
  const sendt = (await sendAlarmer()).filter((r) => [aaa, bbb, mmm, zzz, lige1, lige2].some((s) => s.name === r.soegning))
  const sendOrden = sendt.map((r) => r.soegning.split(' ')[0]!)
  tjek('sendAlarmer() går søgningerne igennem i samme orden', sendOrden.join() === forventet.join(),
    sendOrden.join(' → '))
  tjek('… og sendte intet uden nøgle', sendt.every((r) => !r.sendt), sendt.map((r) => r.grund).filter(Boolean)[0] ?? '')

  // ── 3 · to træf fra SAMME øjeblik i én mail: id afgør ─────
  // Det sidste led i `orderBy`, og det eneste, en fletning med #48 kan tabe,
  // uden at noget andet bliver rødt: tages #48's side i begge konfliktblokke,
  // er ordenen `name, desc(matchedAt)` — ens på alt undtagen id. Rækkerne
  // lægges i den MODSATTE fysiske orden af id'erne (største id først, på den
  // først oprettede bolig), så en plan, der følger indsætningen eller
  // indekset på (sent_at, matched_at), giver den forkerte. `gentagelsesprøven`:
  // en plan, der tilfældigvis gav id-orden, ville gøre påstanden grøn uden
  // leddet — derfor den modsatte orden, og derfor er den modprøvet.
  const tie = await soegning('Tie — to træf i samme sekund')
  const id = (n: number) => `${koersel.toString(16).slice(-8)}-0000-4000-8000-${String(n).padStart(12, '0')}`
  await db.insert(alertMatches).values([
    { id: id(2), ...traef(tie, B[4]!, 4) },
    { id: id(1), ...traef(tie, B[5]!, 4) },
  ])
  const t = (await ventende()).find((g) => g[0]!.soegningId === tie.id) ?? []
  tjek('inde i mailen: to træf fra samme øjeblik står i id-orden, ens fra kørsel til kørsel',
    t.length === 2 && +t[0]!.matchetKl === +t[1]!.matchetKl && t[0]!.matchId === id(1) && t[1]!.matchId === id(2),
    t.map((r) => r.matchId.slice(-2)).join(' → '))
} finally {
  await db.delete(users).where(inArray(users.id, [bruger!.id]))           // søgninger og træf følger med
  await db.delete(listings).where(inArray(listings.id, B))
  await db.delete(sources).where(inArray(sources.id, [kilde!.id]))
}

console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl ? 1 : 0)
