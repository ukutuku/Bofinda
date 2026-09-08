// ═══════════════════════════════════════════════════════════════
//  Syntetiske boliger til Cloud-testmiljøet.
//
//  REPRODUCERBART: én fast frø driver hele datasættet, så to kørsler
//  giver bit for bit det samme. IDEMPOTENT: kørslen rydder KUN rækker,
//  der hører til dens egne `test-`-kilder, og skriver dem igen. Den
//  rører aldrig en kilde, den ikke selv har oprettet.
//
//  Alt er tydeligt opdigtet — «Prøveby», «Attrapvænget», priser i runde
//  tal. Ingen række er kopieret fra produktionen, og ingen adresse er
//  en rigtig adresse.
// ═══════════════════════════════════════════════════════════════
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
if (!url) { console.error('FEJL: ingen DATABASE_URL. Der er ingen standardbase.'); process.exit(1) }
const u = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port !== '55432'
    || u.pathname !== '/bofinda_test') {
  console.error(`FEJL: ${u.hostname}:${u.port}${u.pathname} er ikke den isolerede testbase.`)
  console.error('      Seed skriver kun til 127.0.0.1:55432/bofinda_test.')
  process.exit(1)
}

// Billedværten. Skal være den, appen kender som EGEN_LAGERVAERT, ellers
// returnerer billedUrl() null og kortene står uden billede.
const AKTIV = process.env.BOFINDA_AKTIV_BASE ?? 'http://127.0.0.1:55433'

const sql = postgres(url, { ssl: false, max: 1, onnotice: () => {} })

// ─── Deterministisk tilfældighed ───────────────────────────────
// mulberry32. Samme frø, samme datasæt — hver gang, på hver maskine.
function rng(fro) {
  let a = fro >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r = rng(20260908)
const vaelg = (xs) => xs[Math.floor(r() * xs.length)]
const heltal = (a, b) => a + Math.floor(r() * (b - a + 1))

// ─── Fiktiv geografi ───────────────────────────────────────────
const OMRAADER = [
  { postnr: '9001', by: 'Prøveby N' },
  { postnr: '9002', by: 'Prøveby S' },
  { postnr: '9003', by: 'Attrapby' },
  { postnr: '9004', by: 'Fiktivby' },
]
const VEJE = ['Prøvevej', 'Testagervej', 'Attrapvænget', 'Fiktivgade', 'Demostien',
  'Prøvehaven', 'Attrapallé', 'Testparken']
const TYPER = ['lejlighed', 'hus', 'raekkehus', 'vaerelse', 'studiebolig']

const KILDER = [
  { slug: 'test-alfa', navn: 'Prøvekilde Alfa', type: 'spider', tavs: false },
  { slug: 'test-beta', navn: 'Prøvekilde Beta', type: 'feed', tavs: false },
  // Tavs om faciliteter — så facilitetsgrundlagets tre grupper kan prøves.
  { slug: 'test-gamma', navn: 'Prøvekilde Gamma', type: 'spider', tavs: true },
]

const DAG = 86400_000
const nu = Date.now()

// ─── Økonomi: alle fire el-tilstande ───────────────────────────
// Skellet er dataenes eget, jf. lib/eloplysning.ts — ingen ny kolonne.
function oekonomi(slags) {
  const leje = heltal(600, 2400) * 1000        // øre, runde hundredkroner
  switch (slags) {
    case 'kun-leje':                            // total ukendt → grå prisblok
      return { leje, total: null, dele: null, varme: null, vand: null, el: null,
        andet: null, egenMaaler: null }
    case 'med-el': {                            // el er en navngiven post
      const varme = 40000, vand = 20000, el = 30000
      return { leje, varme, vand, el, andet: null, egenMaaler: null,
        total: leje + varme + vand + el, dele: ['rent', 'heat', 'water', 'electricity'] }
    }
    case 'egen-maaler': {                       // kilden siger det selv
      const varme = 45000, vand = 25000
      return { leje, varme, vand, el: null, andet: null, egenMaaler: true,
        total: leje + varme + vand, dele: ['rent', 'heat', 'water'] }
    }
    case 'ikke-med': {                          // udspecificeret, el ikke blandt dem
      const varme = 35000, vand = 15000
      return { leje, varme, vand, el: null, andet: null, egenMaaler: null,
        total: leje + varme + vand, dele: ['rent', 'heat', 'water'] }
    }
    case 'ukendt-daekning': {                   // ét samlet beløb uden specifikation
      const andet = 90000
      return { leje, varme: null, vand: null, el: null, andet, egenMaaler: null,
        total: leje + andet, dele: ['rent', 'other'] }
    }
  }
}

// Overtagelse: nu · senere · ukendt — alle tre repræsenteret.
function overtagelse(slags) {
  if (slags === 'ukendt') return null
  if (slags === 'nu') return new Date(nu - heltal(1, 60) * DAG)
  return new Date(nu + heltal(20, 200) * DAG)
}

const boliger = []
let n = 0

function bolig(o) {
  const id = randomUUID()
  n++
  const omr = o.omraade
  const husnr = String(o.husnr ?? heltal(1, 90))
  const adresse = `${o.vej} ${husnr}, ${omr.postnr} ${omr.by}`
  boliger.push({
    id,
    kilde: o.kilde,
    eksternNoegle: o.noegle,                    // stabil → idempotens
    url: `https://eksempel.invalid/${o.kilde}/${o.noegle}`,
    adresse, vej: o.vej, husnr,
    etage: o.etage ?? null, doer: o.doer ?? null,
    postnr: omr.postnr, by: omr.by,
    // Unikt pr. bolig, så intet skjules som utilsigtet dublet. Ét
    // bevidst par deler uuid nedenfor — dét skal skjules.
    unitUuid: o.unitUuid ?? `intern:v3:proeve:${id}`,
    type: o.type, areal: o.areal, vaerelser: o.vaerelser,
    ledig: o.ledig,
    ...o.oek,
    faciliteter: o.faciliteter,
    billeder: o.billeder,
    foerstSet: new Date(nu - o.alderDage * DAG),
    kildeOprettet: o.kildeOprettet ?? null,
    fakta: o.fakta ?? null,
  })
}

// ─── 1 · Gruppekort ────────────────────────────────────────────
// Nøglen er (kilde, postnr, vej, værelser, ejer, total-kendt). Hver
// gruppe får sin egen vej, så to grupper ikke smelter sammen.
const GRUPPER = 32
for (let g = 0; g < GRUPPER; g++) {
  const kilde = KILDER[g % KILDER.length]
  const omr = OMRAADER[g % OMRAADER.length]
  const vej = `${VEJE[g % VEJE.length]} ${Math.floor(g / VEJE.length) + 1}`
  const vaerelser = heltal(1, 5)
  const antal = heltal(2, 6)
  const type = vaelg(TYPER)
  // Hele gruppen deler total-kendt-status; ellers ville den dele sig i to.
  const slags = vaelg(['med-el', 'egen-maaler', 'ikke-med', 'ukendt-daekning'])
  const ensPris = g % 4 === 0          // ens priser → spænd på nul
  const stortSpaend = g % 4 === 1      // >25 % → hele spændet skal stå
  const basis = oekonomi(slags)
  const ledigSlags = ['nu', 'senere', 'ukendt'][g % 3]
  const blandetLedig = g % 5 === 0     // flere ledigdatoer i én gruppe

  for (let i = 0; i < antal; i++) {
    let oek = { ...basis }
    if (!ensPris) {
      const faktor = stortSpaend ? 1 + i * 0.18 : 1 + i * 0.02
      oek.leje = Math.round(basis.leje * faktor / 1000) * 1000
      if (oek.total != null) {
        oek.total = oek.leje + (oek.varme ?? 0) + (oek.vand ?? 0) + (oek.el ?? 0) + (oek.andet ?? 0)
      }
    }
    bolig({
      kilde: kilde.slug, noegle: `gruppe-${g}-${i}`,
      omraade: omr, vej, husnr: String(10 + i * 2),
      etage: String(i + 1), doer: ['tv', 'th', 'mf'][i % 3],
      type,
      // Areal varierer INDEN FOR gruppen — så et arealfilter rammer kun
      // nogle medlemmer, og kortet må sige «x af y matcher».
      areal: 45 + i * 14,
      vaerelser,
      ledig: overtagelse(blandetLedig ? ['nu', 'senere', 'ukendt'][i % 3] : ledigSlags),
      oek,
      faciliteter: kilde.tavs ? [] : (i % 2 === 0 ? ['elevator', 'kaeledyr'] : ['udeplads']),
      billeder: heltal(0, 4),
      alderDage: heltal(1, 18),
      kildeOprettet: new Date(nu - heltal(1, 18) * DAG),
    })
  }
}

// ─── 2 · Enkeltkort ────────────────────────────────────────────
const ENKELTE = 105
for (let e = 0; e < ENKELTE; e++) {
  const kilde = KILDER[e % KILDER.length]
  const omr = OMRAADER[(e + 1) % OMRAADER.length]
  const slags = ['kun-leje', 'med-el', 'egen-maaler', 'ikke-med', 'ukendt-daekning'][e % 5]
  bolig({
    kilde: kilde.slug, noegle: `enkelt-${e}`,
    omraade: omr,
    // Egen vej pr. bolig → ingen utilsigtet gruppering.
    vej: `Enkeltvej ${e + 1}`,
    type: vaelg(TYPER),
    // NULL-værdier med vilje: hver sjette uden areal.
    areal: e % 6 === 0 ? null : heltal(28, 160),
    vaerelser: heltal(1, 6),
    ledig: overtagelse(['nu', 'senere', 'ukendt'][e % 3]),
    oek: oekonomi(slags),
    faciliteter: kilde.tavs ? [] : vaelg([[], ['elevator'], ['kaeledyr', 'udeplads'], ['elevator', 'udeplads']]),
    billeder: e % 7 === 0 ? 0 : heltal(1, 5),
    alderDage: heltal(1, 25),
    kildeOprettet: e % 3 === 0 ? null : new Date(nu - heltal(1, 25) * DAG),
  })
}

// ─── 3 · Kort der IKKE kan grupperes (NULL i nøglen) ───────────
// Ukendt værelsestal er ikke «det samme» som et andet ukendt.
for (let k = 0; k < 6; k++) {
  bolig({
    kilde: 'test-alfa', noegle: `uden-noegle-${k}`,
    omraade: OMRAADER[k % OMRAADER.length],
    vej: 'Manglervej', husnr: String(k + 1),
    type: 'andet',
    areal: k % 2 === 0 ? null : 55,
    vaerelser: null,                              // ← ingen gruppering
    ledig: null,
    oek: oekonomi('kun-leje'),
    faciliteter: [], billeder: 1, alderDage: heltal(1, 10),
  })
}

// ─── 4 · Ét bevidst dublet-par ─────────────────────────────────
// Samme bolig hos to kilder: samme enhedsadresse. Én skal vises, én
// skjules af repræsentantvalget — det er dedup, ikke et tabt kort.
const delt = `intern:v3:proeve:delt-enhed-0001`
for (const [i, s] of ['test-alfa', 'test-beta'].entries()) {
  bolig({
    kilde: s, noegle: `dublet-${i}`,
    omraade: OMRAADER[0], vej: 'Dubletvej', husnr: '4',
    etage: '2', doer: 'tv',
    type: 'lejlighed', areal: 78, vaerelser: 3,
    ledig: overtagelse('nu'),
    oek: oekonomi('med-el'),
    faciliteter: ['elevator'],
    // Forskelligt billedantal: repræsentanten er den med flest.
    billeder: i === 0 ? 1 : 4,
    unitUuid: delt,
    alderDage: 5, kildeOprettet: new Date(nu - 5 * DAG),
  })
}

// ─── 5 · Overtagelse: nu · senere · ukendt ─────────────────────
// Timing kræver en KILDEKONTRAKT. En syntetisk kilde har ingen, og
// availabilityFor() giver den — bevidst — alt-unknown frem for at kaste.
// Derfor ligger de her boliger på `native`, hvis kontrakt er vores egen:
// udlejeren skriver selv «ledig fra», og datoens betydning kan ikke
// misforstås (lib/kildekontrakt.ts, native.datofelt).
//
// source_created_at bliver null, som formen kræver for native — se
// reglen om prøver, der låner en rigtig kildes historik, i CLAUDE.md.
const iso = (d) => new Date(d).toISOString().slice(0, 10)
const TIMING = [
  { navn: 'nu',     fakta: () => ({ sourceAvailabilityDate: iso(nu - heltal(5, 90) * DAG) }) },
  { navn: 'senere', fakta: () => ({ sourceAvailabilityDate: iso(nu + heltal(30, 240) * DAG) }) },
  { navn: 'ukendt', fakta: () => ({}) },
]

for (let i = 0; i < 24; i++) {
  const t = TIMING[i % 3]
  bolig({
    kilde: 'native', noegle: `native-enkelt-${i}`,
    omraade: OMRAADER[i % OMRAADER.length],
    vej: `Udlejervej ${i + 1}`, husnr: String(i + 1),
    type: vaelg(TYPER),
    areal: heltal(40, 130), vaerelser: heltal(1, 4),
    ledig: null,
    oek: oekonomi(['med-el', 'egen-maaler', 'ikke-med', 'ukendt-daekning'][i % 4]),
    faciliteter: i % 2 === 0 ? ['elevator'] : ['udeplads'],
    billeder: heltal(1, 3), alderDage: heltal(1, 12),
    fakta: t.fakta(),
  })
}

// Fire native-grupper. Én blander datoerne, så gruppekortet må skrive
// «flere ledigdatoer» i stedet for at udgive den tidligste for alles.
for (let g = 0; g < 4; g++) {
  const t = TIMING[g % 3]
  for (let i = 0; i < 3; i++) {
    bolig({
      kilde: 'native', noegle: `native-gruppe-${g}-${i}`,
      omraade: OMRAADER[g % OMRAADER.length],
      vej: `Udlejergaarden ${g + 1}`, husnr: String(2 + i * 2),
      etage: String(i + 1), doer: ['tv', 'th', 'mf'][i % 3],
      type: 'lejlighed', areal: 62 + i * 10, vaerelser: 3,
      ledig: null,
      oek: oekonomi('med-el'),
      faciliteter: ['elevator'],
      billeder: 2, alderDage: heltal(1, 10),
      // Gruppe 3 blander med vilje.
      fakta: (g === 3 ? TIMING[i % 3] : t).fakta(),
    })
  }
}

// ═══ Skrivning ═════════════════════════════════════════════════
console.log(`· datasæt bygget: ${boliger.length} boliger (frø 20260908)`)

const kildeId = {}
for (const k of KILDER) {
  const [row] = await sql`
    insert into sources (slug, name, source_type, base_url)
    values (${k.slug}, ${k.navn}, ${k.type}, 'https://eksempel.invalid')
    on conflict (slug) do update set name = excluded.name
    returning id`
  kildeId[k.slug] = row.id
}

// `native` sås af migration 0013 og oprettes ikke her — den slås op.
{
  const [row] = await sql`select id from sources where slug = 'native'`
  if (!row) { console.error('FEJL: native-kilden mangler. Kør klargoer.mjs.'); process.exit(1) }
  kildeId.native = row.id
}

// Rydder KUN egne test-kilders rækker. Andre kilder røres ikke.
const slettet = await sql`
  delete from listings where source_id in (
    select id from sources where slug in ${sql(KILDER.map((k) => k.slug))})`
// Native-rækkerne kan IKKE ryddes på kilden: `native` er også rigtige
// udlejerannoncer. Kun vores egne nøgler, og kun dem.
const slettetNative = await sql`
  delete from listings where source_id = ${kildeId.native}
    and external_key like 'native-%'`
console.log(`· ryddet ${slettet.count} test-boliger + ${slettetNative.count} native-prøver`)

// En kørsel pr. kilde, langt tilbage. Uden den er hver bolig
// «bagkatalog», og NYHEDSDATO bliver null for hele bestanden.
for (const k of KILDER) {
  await sql`delete from crawl_runs where source_id = ${kildeId[k.slug]}`
  await sql`
    insert into crawl_runs (source_id, started_at, finished_at, status,
      discovered_count, extracted_count, new_count, error_count, runner)
    values (${kildeId[k.slug]}, ${new Date(nu - 30 * DAG)}, ${new Date(nu - 30 * DAG + 60000)},
      'ok', 100, 100, 100, 0, 'cloud-testmiljoe')`
}

// amenities er jsonb. `sql.json()` og IKKE JSON.stringify: postgres.js
// koder en streng én gang til, og feltet bliver et jsonb *scalar* i
// stedet for et array. facetter() kalder jsonb_array_length på det, og
// hele forsiden falder med «cannot get array length of a scalar» —
// mens områdesiderne, der ikke tæller faciliteter, ser upåvirkede ud.
for (const b of boliger) {
  const [row] = await sql`
    insert into listings (
      source_id, source_type, external_key, source_url, address_raw,
      street, house_number, floor, door, postal_code, city,
      unit_address_uuid, address_match_level,
      property_type, size_m2, rooms, available_from,
      rent_monthly, utilities_heat, utilities_water, utilities_electricity,
      utilities_other, electricity_own_meter, total_monthly, total_monthly_components,
      amenities, status, first_seen_at, last_seen_at, source_created_at, description,
      availability_facts
    ) values (
      ${kildeId[b.kilde]},
      ${KILDER.find((k) => k.slug === b.kilde)?.type ?? 'native'},
      ${b.eksternNoegle}, ${b.url}, ${b.adresse},
      ${b.vej}, ${b.husnr}, ${b.etage}, ${b.doer}, ${b.postnr}, ${b.by},
      ${b.unitUuid}, 'unit',
      ${b.type}, ${b.areal}, ${b.vaerelser}, ${b.ledig},
      ${b.leje}, ${b.varme}, ${b.vand}, ${b.el},
      ${b.andet}, ${b.egenMaaler}, ${b.total}, ${b.dele},
      ${sql.json(b.faciliteter)}, 'active',
      ${b.foerstSet}, ${new Date(nu)}, ${b.kilde === 'native' ? null : b.kildeOprettet},
      ${'Syntetisk prøvebolig. Ikke en rigtig annonce.'},
      ${b.fakta === null ? null : sql.json(b.fakta)}
    )
    on conflict (source_id, external_key) do update set last_seen_at = excluded.last_seen_at
    returning id`
  for (let p = 0; p < b.billeder; p++) {
    await sql`
      insert into listing_images (listing_id, external_url, position)
      values (${row.id}, ${`${AKTIV}/bolig-${(p % 4) + 1}.png`}, ${p})`
  }
}

const [{ antal }] = await sql`select count(*)::int as antal from listings`
const [{ billeder }] = await sql`select count(*)::int as billeder from listing_images`
console.log(`✓ ${antal} boliger, ${billeder} billedrækker`)
await sql.end()
