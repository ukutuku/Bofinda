// ═══════════════════════════════════════════════════════════════
//  DANSK ORDEN — tekst, et menneske læser som en liste.
//
//  Tre steder sorterer for et menneske, og prøven går gennem de RIGTIGE
//  funktioner, ikke gennem en afskrift af deres udtryk:
//
//    · kildenavnene på kortet       `ogsaaHos` i soeg()           SQL
//    · adresserne på /gruppe        hentGruppe()                  SQL
//    · navnene om tavse kilder      tavseKilder()                 JS
//
//  Navnene er de otte fra ejerens måling af produktionen. Dansk orden er
//  Amager, Brønshøj, Nørrebro, Zealand, Ærø, Østerbro, Åbenrå, Aalborg —
//  med Aalborg SIDST, fordi dansk læser «aa» som «å». Produktionens egen
//  en_US sætter Aalborg først og Å og Æ blandt A'erne; fjernes collationen
//  et af stederne, er prøven rød.
//
//  ═══ DE TO SQL-STEDER KAN IKKE MÅLES I npm test ═══
//
//  Testbasen er PGlite, og PGlite har kun ICU's roddata. Dens `da-x-icu` er
//  en attrap — roden under dansk navn, så forespørgslerne kan køre — og den
//  sorterer Aalborg først. Prøven ville være RØD dér af motorens grund, ikke
//  af kodens, og en dansk ordensprøve, der «rettes» til grøn, måler roden.
//  Det er fælde tolv i CLAUDE.md.
//
//  Hvorvidt basen KAN måles, afgøres derfor ved at måle, ikke ved et navn:
//  de otte navne sorteres med `dansk()`, og står Aalborg ikke sidst, er der
//  intet dansk at prøve imod. Så springes de to over, synligt og talt, med
//  den målte orden skrevet ved sig. Under `npm run test:prod`
//  (BOFINDA_PROEV_PRODUKTION=1) springes de ALDRIG over: er produktionens
//  collation ikke dansk, er det en rød linje, ikke en overspringning.
//
//  Navnene om tavse kilder sorteres i JS med Intl, uafhængigt af basen, og
//  prøves derfor her og nu — også i npm test.
//
//  ═══ I PRODUKTIONEN ═══
//
//  Prøven skriver sine egne kilder (egen slug pr. kørsel) og boliger i
//  postnummer 0001 og sletter dem igen. Kilderne har ingen kørsler i
//  crawl_runs, og `source_created_at` er null, så alarmens indkøringsvagt
//  (`foersteKoersel`) kasserer dem — ingen mail om en bolig, der ikke findes.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { listingImages, listings, sources } from '../db/schema'
import { dansk, gruppenoegleFraBolig, hentGruppe, soeg, tavseKilder } from '../lib/soeg'

const MOD_PRODUKTION = process.env.BOFINDA_PROEV_PRODUKTION === '1'

/** De otte navne, i den orden produktionens ejer målte dem ind. */
const NAVNE = ['Aalborg', 'Ærø', 'Åbenrå', 'Østerbro', 'Zealand', 'Brønshøj', 'Nørrebro', 'Amager']
/** Dansk orden, skrevet ud — ikke beregnet, for så ville prøven måle sig selv. */
const DANSK = ['Amager', 'Brønshøj', 'Nørrebro', 'Zealand', 'Ærø', 'Østerbro', 'Åbenrå', 'Aalborg']

const POSTNR = '0001'
const VIST_VAERT = 'https://app.propstep.com/api/image/find-public'

let fejl = 0
let sprunget = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}
const raekker = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows: T[] }).rows)

console.log('\n══ dansk orden: kildenavne, adresser og tavse kilder ══\n')

// ── 0 · KAN BASEN SORTERE DANSK? Målt, ikke læst af kataloget ─
// Kataloget ville lyve: PGlite gemmer `locale = 'da'` for en collation, den
// sorterer som roden. Derfor sorteres navnene, og svaret er ordenen.
const maalt = raekker<{ x: string }>(await db.execute(sql`
  select x from unnest(${sql.raw(`array[${NAVNE.map((n) => `'${n}'`).join(',')}]`)}) as x
  order by ${dansk(sql`x`)}`)).map((r) => r.x)
const baseErDansk = maalt.join() === DANSK.join()
const SQL_GRUND = `kan ikke måles her: basens da-x-icu sorterer ${maalt.join(', ')} — ikke dansk. `
  + 'Prøven ville være rød af motorens grund, ikke kodens (npm run test:prod)'
const sqlTjek = (navn: string, kald: () => [boolean, string]) => {
  if (!baseErDansk && !MOD_PRODUKTION) {
    sprunget++
    console.log(`  ⊘ ${navn}  — ${SQL_GRUND}`)
    return
  }
  const [ok, note] = kald()
  tjek(navn, ok, note)
}
if (MOD_PRODUKTION) {
  tjek('produktionens da-x-icu sorterer dansk', baseErDansk, maalt.join(', '))
}

// ── Prøvedata: egne kilder, egne boliger, slettes igen ───────
const koersel = Date.now()
const kilder = await db.insert(sources).values([
  ...NAVNE.map((navn, i) => ({ slug: `dansk-orden-${i}-${koersel}`, name: navn, sourceType: 'feed' as const })),
  { slug: `dansk-orden-rep-${koersel}`, name: 'Prøvekilde med billede', sourceType: 'feed' as const },
]).returning({ id: sources.id, navn: sources.name })
const kildeIder = kilder.map((k) => k.id)

try {
  const enhed = randomUUID()
  let nr = 0
  const bolig = (kilde: string, felter: Record<string, unknown>) => ({
    sourceId: kilde, sourceType: 'feed', externalKey: `dansk-${koersel}-${nr}`,
    sourceUrl: `https://example.invalid/dansk/${koersel}/${nr++}`, status: 'active',
    postalCode: POSTNR, city: 'Prøveby', addressMatchLevel: 'unit',
    rooms: 2, sizeM2: 60, rentMonthly: 800000, sourceCreatedAt: null, ...felter,
  })

  // Én bolig, annonceret hos alle ni. Repræsentanten er den med et visbart
  // billede, så kortets `ogsaaHos` er præcis de otte navne.
  const rep = kilder.at(-1)!
  const samme = await db.insert(listings).values(kilder.map((k) => bolig(k.id, {
    addressRaw: `Ordensvej 1, 1. tv, ${POSTNR} Prøveby`, street: 'Ordensvej', houseNumber: '1',
    floor: '1', door: 'tv', unitAddressUuid: enhed,
  })) as never).returning({ id: listings.id, kilde: listings.sourceId })
  await db.insert(listingImages).values({
    listingId: samme.find((x) => x.kilde === rep.id)!.id, externalUrl: `${VIST_VAERT}/dansk.jpg`, position: 0,
  } as never)

  // Tre grupper hos én kilde, én pr. tekstnøgle i hentGruppes orden. I
  // hver gruppe er de to andre nøgler ens, så det er netop den ene, der
  // afgør listen — og fjernes collationen på den, er dens linje rød.
  // Husnummerets TAL er ens («2…»), for tallet sorteres før teksten.
  const NOEGLER = {
    husnr: (navn: string) => ({ houseNumber: `2${navn}`, floor: '1', door: 'tv' }),
    etage: (navn: string) => ({ houseNumber: '2', floor: navn, door: 'tv' }),
    doer: (navn: string) => ({ houseNumber: '2', floor: '1', door: navn }),
  } as const
  const grupper: Record<string, string> = {}
  for (const [noegle, felter] of Object.entries(NOEGLER)) {
    const ind = await db.insert(listings).values(NAVNE.map((navn) => bolig(rep.id, {
      addressRaw: `Gruppevej ${noegle} ${navn}, ${POSTNR} Prøveby`, street: `Gruppevej ${noegle}`,
      unitAddressUuid: randomUUID(), ...felter(navn),
    })) as never).returning({ id: listings.id })
    grupper[noegle] = ind[0]!.id
  }

  // Og én bolig for sig hos hver af de otte. `tavseKilder` tæller de
  // SYNLIGE boliger, og ni annoncer for samme bolig er én bolig — vist
  // gennem repræsentanten. Uden disse havde de otte intet at miste.
  await db.insert(listings).values(kilder.slice(0, NAVNE.length).map((k, i) => bolig(k.id, {
    addressRaw: `Tavsvej ${i + 1}, ${POSTNR} Prøveby`, street: 'Tavsvej', houseNumber: String(i + 1),
    unitAddressUuid: randomUUID(),
  })) as never)

  // ── 1 · ogsaaHos ──────────────────────────────────────────
  const kort = (await soeg({ postnr: POSTNR }, 50)).find((b) => b.id === samme.find((x) => x.kilde === rep.id)!.id)
  const hos = kort?.ogsaaHos ?? []
  sqlTjek('kortets «også hos» står i dansk orden', () =>
    [hos.join() === DANSK.join(), JSON.stringify(hos)])
  sqlTjek('… med Aalborg sidst, fordi «aa» er «å»', () => [hos.at(-1) === 'Aalborg', `sidst: ${hos.at(-1)}`])

  // ── 2 · hentGruppe, én nøgle ad gangen ────────────────────
  for (const noegle of Object.keys(NOEGLER) as (keyof typeof NOEGLER)[]) {
    const n = await gruppenoegleFraBolig(grupper[noegle]!)
    const adresser = n ? await hentGruppe(n) : []
    const vaerdier = adresser.map((a) => (noegle === 'husnr' ? a.husnr?.slice(1) : a[noegle]))
    sqlTjek(`gruppesidens adresser står i dansk orden — efter ${noegle === 'husnr' ? 'husnummer' : noegle === 'doer' ? 'dør' : 'etage'}`,
      () => [vaerdier.join() === DANSK.join(), `${adresser.length} adresser: ${JSON.stringify(vaerdier)}`])
  }

  // ── 3 · tavseKilder (JS) — måles også her ─────────────────
  tjek('Node kender dansk orden (fuld ICU)', Intl.Collator.supportedLocalesOf(['da']).includes('da'),
    `ICU ${process.versions.icu}`)
  const tavse = await tavseKilder({ postnr: POSTNR, elevator: true })
  const vores = tavse.navne.filter((n) => NAVNE.includes(n))
  tjek('navnene om tavse kilder står i dansk orden', vores.join() === DANSK.join(), JSON.stringify(vores))
} finally {
  await db.delete(listings).where(inArray(listings.sourceId, kildeIder))
  await db.delete(sources).where(inArray(sources.id, kildeIder))
}

if (sprunget) console.log(`\n  ${sprunget} sprunget over — basens da-x-icu er ikke dansk; de kører i npm run test:prod`)
console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
process.exit(fejl ? 1 : 0)
