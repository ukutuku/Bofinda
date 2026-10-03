// ═══════════════════════════════════════════════════════════════
//  Gengiver de RIGTIGE komponenter til statisk markup — uden server,
//  uden netværk og uden rigtig base. Samme vej som `npm test`:
//  PGlite i processen, rejst af scripts/testbase.ts.
//
//      ROD=<checkout> tsx --tsconfig <checkout>/tsconfig.scripts.json \
//        markup.mjs kort|side-kendt|side-klump|gruppe
//
//  Alle boliger er opdigtede: Prøvevej, Attrapgade, Eksempelalle.
//  Skriver markuppen til stdout. Filen er .mjs og ikke .tsx med vilje:
//  tsconfig.json typetjekker hver .ts/.tsx i repoet, også under docs/.
// ═══════════════════════════════════════════════════════════════
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const ROD = process.env.ROD
if (!ROD) { console.error('FEJL: sæt ROD til en checkout.'); process.exit(2) }
if (process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT) {
  console.error('FEJL: DATABASE_URL er sat. Gengivelsen kører kun mod PGlite.'); process.exit(2)
}
const hvad = process.argv[2]

const nu = new Date('2026-09-26T10:00:00Z')
const for2dage = new Date('2026-09-24T08:00:00Z')
const for40dage = new Date('2026-08-17T08:00:00Z')

// ─── Kortet: ren komponent, ingen base ─────────────────────────
if (hvad === 'kort') {
  const { Kort } = await import(`${ROD}/app/Boligkort.tsx`)
  const basis = {
    vej: null, husnr: null, etage: null, doer: null, ledigFra: null,
    varme: null, vand: null, el: null, elEgenMaaler: null, billedforbehold: false,
    oevrig: null, indflytning: null, ansoegning: null, match: 'unit', lat: null, lng: null,
    hosKilden: null, url: 'https://example.invalid/', kildetype: 'feed',
    availabilityFacts: null, billeder: 6,
    forside: 'https://images.ctfassets.net/demo/stue.jpg', ogsaaHos: [],
  }
  const BOLIGER = {
    // Kendt total, udspecificeret: husleje + varme + vand. El er ikke med.
    kendt: { ...basis, id: '11111111-1111-4111-8111-111111111111',
      adresse: 'Prøvevej 14, 3. tv, 2300 København S', vej: 'Prøvevej', husnr: '14', etage: '3', doer: 'tv',
      postnr: '2300', by: 'København S', type: 'lejlighed', areal: 78, vaerelser: 3,
      leje: 1235000, varme: 65000, vand: 25000, total: 1325000, poster: ['rent', 'heat', 'water'],
      indflytning: 4940000, foerstSet: for2dage, kilde: 'propstep', kildeNavn: 'Propstep', ogsaaHos: ['LokalBolig'] },
    // Ingen aconto oplyst: vi kender kun huslejen.
    ukendt: { ...basis, id: '22222222-2222-4222-8222-222222222222',
      adresse: 'Attrapgade 5, 1. th, 8000 Aarhus C', vej: 'Attrapgade', husnr: '5', etage: '1', doer: 'th',
      postnr: '8000', by: 'Aarhus C', type: 'lejlighed', areal: 64, vaerelser: 2,
      leje: 1165000, total: null, poster: null, foerstSet: for40dage,
      kilde: 'findbolig', kildeNavn: 'findbolig.nu', billeder: 4 },
    // Aconto som ét samlet beløb: el kan ligge i klumpen.
    klump: { ...basis, id: '33333333-3333-4333-8333-333333333333',
      adresse: 'Eksempelalle 22, st., 5000 Odense C', vej: 'Eksempelalle', husnr: '22', etage: 'st', doer: null,
      postnr: '5000', by: 'Odense C', type: 'raekkehus', areal: 96, vaerelser: 4,
      leje: 1310000, oevrig: 178300, total: 1488300, poster: ['rent', 'other'],
      foerstSet: for40dage, hosKilden: for40dage, kilde: 'lokalbolig', kildeNavn: 'LokalBolig',
      billeder: 0, forside: null },
  }
  const ud = {}
  for (const [navn, b] of Object.entries(BOLIGER)) {
    ud[navn] = renderToStaticMarkup(createElement(Kort, { b, nu, position: 1 }))
  }
  process.stdout.write(JSON.stringify(ud))
  process.exit(0)
}

// ─── Sider: PGlite i processen ─────────────────────────────────
const { rejsTestbase } = await import(`${ROD}/scripts/testbase.ts`)
const tb = await rejsTestbase()
const { db } = await import(`${ROD}/db/client.ts`)
const { listings, sources, listingImages } = await import(`${ROD}/db/schema.ts`)
const [k] = await db.insert(sources).values({
  slug: 'gengivelse', name: 'Propstep', sourceType: 'feed',
  baseUrl: 'https://proeve.invalid', enabled: false,
}).returning()

if (hvad === 'side-kendt' || hvad === 'side-klump') {
  const Side = (await import(`${ROD}/app/bolig/[id]/page.tsx`)).default
  const oekonomi = hvad === 'side-kendt'
    ? { rentMonthly: 1235000, utilitiesHeat: 65000, utilitiesWater: 25000, totalMonthly: 1325000,
        totalMonthlyComponents: ['rent', 'heat', 'water'], moveInCost: 4940000, deposit: 3705000, prepaidRent: 0 }
    : { rentMonthly: 1310000, utilitiesOther: 178300, totalMonthly: 1488300,
        totalMonthlyComponents: ['rent', 'other'], moveInCost: null, deposit: 3930000, prepaidRent: null }
  const [hoved] = await db.insert(listings).values({
    sourceId: k.id, sourceType: 'feed', externalKey: 'gengivelse-hoved', sourceUrl: 'https://proeve.invalid/hoved',
    addressRaw: 'Prøvevej 14, 3. tv, 2300 København S', street: 'Prøvevej', houseNumber: '14',
    floor: '3', door: 'tv', postalCode: '2300', city: 'København S',
    propertyType: 'lejlighed', rooms: 3, sizeM2: 78, ...oekonomi,
    amenities: ['elevator', 'altan', 'opvaskemaskine'],
    description: 'Lejlighed på 78 m² med 3 værelser på 3. sal i København S. Den månedlige udgift til udlejeren er 13.250 kr. — husleje 12.350 kr. plus aconto varme 650 kr. og vand 250 kr. Elevator, altan og opvaskemaskine.',
    addressMatchLevel: 'unit', unitAddressUuid: 'intern:gengivelse:hoved', status: 'active',
    firstSeenAt: for2dage, sourceCreatedAt: new Date('2026-09-23T08:00:00Z'),
  }).returning({ id: listings.id })
  for (let i = 0; i < 6; i++) {
    await db.insert(listingImages).values({ listingId: hoved.id, position: i,
      externalUrl: `https://images.ctfassets.net/gengivelse/${i}.jpg` })
  }
  // Grundlaget for prissammenligningen: seks boliger i 2300 med kendt total
  // og areal. Uden dem vises sammenligningen ikke (MINDST_TIL_SAMMENLIGNING).
  const KVM = [17600, 18400, 18900, 19300, 19800, 20700]
  for (let i = 0; i < KVM.length; i++) {
    const areal = 60 + i * 7
    await db.insert(listings).values({
      sourceId: k.id, sourceType: 'feed', externalKey: `gengivelse-sml-${i}`,
      sourceUrl: `https://proeve.invalid/sml-${i}`,
      addressRaw: `Sammenligningsvej ${i + 1}, 2300 København S`, street: 'Sammenligningsvej',
      houseNumber: String(i + 1), postalCode: '2300', city: 'København S', rooms: 2, sizeM2: areal,
      rentMonthly: KVM[i] * areal - 80000, totalMonthly: KVM[i] * areal,
      totalMonthlyComponents: ['rent', 'heat'], utilitiesHeat: 80000,
      addressMatchLevel: 'unit', unitAddressUuid: `intern:gengivelse:sml-${i}`, status: 'active',
    })
  }
  const el = await Side({ params: Promise.resolve({ id: hoved.id }), searchParams: Promise.resolve({}) })
  process.stdout.write(renderToStaticMarkup(el))
} else if (hvad === 'gruppe') {
  const Side = (await import(`${ROD}/app/gruppe/page.tsx`)).default
  // Seks rækkehuse på samme vej. Den uden aconto har ukendt total og
  // lander i sin egen gruppe; de fem andre er gruppen.
  const RAEKKER = [
    { nr: '2', leje: 1180000, varme: 70000, vand: 25000, areal: 82, poster: ['rent', 'heat', 'water'] },
    { nr: '4', leje: 1195000, varme: 70000, vand: 25000, areal: 84, poster: ['rent', 'heat', 'water'], indflytning: 4780000 },
    { nr: '6', leje: 1210000, oevrig: 110000, areal: 86, poster: ['rent', 'other'] },
    { nr: '8', leje: 1240000, varme: 72000, vand: 26000, el: 45000, areal: 88, poster: ['rent', 'heat', 'water', 'electricity'] },
    { nr: '10', leje: 1265000, areal: 90, poster: null },
    { nr: '12', leje: 1290000, oevrig: 115000, areal: 92, poster: ['rent', 'other'] },
  ]
  let foerste = ''
  for (const [i, r] of RAEKKER.entries()) {
    const total = r.poster ? r.leje + (r.varme ?? 0) + (r.vand ?? 0) + (r.el ?? 0) + (r.oevrig ?? 0) : null
    const [row] = await db.insert(listings).values({
      sourceId: k.id, sourceType: 'feed', externalKey: `gengivelse-g-${i}`, sourceUrl: `https://proeve.invalid/g-${i}`,
      addressRaw: `Prøvevænget ${r.nr}, 2300 København S`, street: 'Prøvevænget', houseNumber: r.nr,
      postalCode: '2300', city: 'København S', propertyType: 'raekkehus', rooms: 4, sizeM2: r.areal,
      rentMonthly: r.leje, utilitiesHeat: r.varme ?? null, utilitiesWater: r.vand ?? null,
      utilitiesElectricity: r.el ?? null, utilitiesOther: r.oevrig ?? null,
      totalMonthly: total, totalMonthlyComponents: r.poster, moveInCost: r.indflytning ?? null,
      addressMatchLevel: 'unit', unitAddressUuid: `intern:gengivelse:g-${i}`, status: 'active',
      firstSeenAt: new Date(Date.UTC(2026, 8, 10 + i)),
    }).returning({ id: listings.id })
    if (!foerste) foerste = row.id
    for (let p = 0; p < 3; p++) {
      await db.insert(listingImages).values({ listingId: row.id, position: p,
        externalUrl: `https://images.ctfassets.net/gengivelse/g${i}-${p}.jpg` })
    }
  }
  const el = await Side({ searchParams: Promise.resolve({ b: foerste }) })
  process.stdout.write(renderToStaticMarkup(el))
} else {
  console.error(`FEJL: ukendt «${hvad}». Brug kort, side-kendt, side-klump eller gruppe.`)
  process.exitCode = 2
}
await tb.luk()
