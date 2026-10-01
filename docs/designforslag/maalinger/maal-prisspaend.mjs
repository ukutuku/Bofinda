// ═══════════════════════════════════════════════════════════════
//  Prisspændet i søgesidens resultathoved: hvor meget af det er huslejer,
//  der står ved siden af «N med samlet pris til udlejer»?
//  SKRIVEBESKYTTET mod --base: kun select.
//
//  Genbruger søgesidens egne funktioner — soeg() og opsummering() går
//  begge gennem hvorVist(), så grundlaget er præcis det, siden viser, med
//  samme dedup. Et eget SQL-prædikat ville være et andet udtryk for samme
//  spørgsmål (CLAUDE.md: «Svarer to udtryk på det samme spørgsmål …»).
//  Områdesidernes tal kommer fra statistik() i lib/omraade.ts.
//
//  Kørsel fra roden af en checkout (migrationsstierne er relative):
//
//    ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json \
//      [--env-file=.env] <sti>/maal-prisspaend.mjs --maal test|prod | --proeve \
//      [--sted Attrapby] [--json ud.json] [--alle]
//
//  --proeve  rejser PGlite i processen, sår kendte tilfælde, tjekker facit.
//  --maal    test eller prod — NAVNGIVET, ingen standard (laast-base.mjs ›
//            kraevMaal): DATABASE_URL_DIRECT skal svare til navnet, ellers
//            exit 3. Read-only-session, afviser :6543 og kan ikke skrive.
//  --sted    én søgning, der gennemgås række for række (standard: den med
//            flest boliger blandt dem, hvor et endepunkt er en husleje).
//  --alle    skriv hver søgning og hvert område ud, ikke kun de værste.
// ═══════════════════════════════════════════════════════════════
const ROD = process.env.ROD
const argv = process.argv.slice(2)
// Alt andet end --proeve går mod en base og dermed gennem kraevMaal: uden
// `--maal test|prod` afbrydes der med exit 3. Der er ingen standard.
const BASE = !argv.includes('--proeve')
const PROEVE = argv.includes('--proeve')
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
if (!ROD) { console.error('ROD mangler (roden af checkout’en).'); process.exit(2) }
if (PROEVE && argv.includes('--maal')) { console.error('angiv præcis én af --maal test|prod og --proeve'); process.exit(2) }
if (PROEVE && (process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT)) {
  console.error('FEJL: --proeve med DATABASE_URL sat. Afbryder.'); process.exit(2)
}

// --base: skrivebeskyttelsen håndhæves af BASEN (read-only-session, SHOW
// før og efter, aldrig :6543) — ikke af, at filen kun indeholder select.
let maal = 'PGlite i processen (prøve)', laas = null
if (BASE) {
  laas = await (await import('./laast-base.mjs')).laastBase(ROD)
  maal = laas.navn
}
process.stdout.write(`mål: ${maal}${laas ? ` · read-only: ${await laas.laast()}` : ''}\n`)

let tb = null
if (PROEVE) tb = await (await import(`${ROD}/scripts/testbase.ts`)).rejsTestbase()
const { db } = await import(`${ROD}/db/client.ts`)
const { listings, sources, savedSearches, users } = await import(`${ROD}/db/schema.ts`)
const { soeg, opsummering, filtreFraParametre, harFiltre } = await import(`${ROD}/lib/soeg.ts`)
const { alleOmraader, statistik } = await import(`${ROD}/lib/omraade.ts`)
const { and, isNotNull, isNull, eq } = await import('drizzle-orm')

// Samme formatering som `kr` i app/Boligkort.tsx, som chippen bruger.
const kr = (o) => (o / 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })
const spaendTekst = (xs) => !xs.length ? null
  : Math.min(...xs) === Math.max(...xs) ? `${kr(xs[0])} kr/md`
  : `${kr(Math.min(...xs))}–${kr(Math.max(...xs))} kr/md`
const mm = (xs) => xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null

// ─── Prøvedata: fem postnumre med kendt facit ─────────────────
const FACIT = {}
if (PROEVE) {
  const [k] = await db.insert(sources).values({ slug: 'maal-prisspaend', name: 'Prøve', sourceType: 'feed',
    baseUrl: 'https://proeve.invalid', enabled: false }).returning()
  let n = 0
  const saa = async (postnr, by, leje, total) => db.insert(listings).values({
    sourceId: k.id, sourceType: 'feed', externalKey: `mp-${n}`, sourceUrl: `https://proeve.invalid/${n}`,
    addressRaw: `Prøvevej ${++n}, ${postnr} ${by}`, street: 'Prøvevej', houseNumber: String(n),
    postalCode: postnr, city: by, rooms: 2, sizeM2: 60, rentMonthly: leje, totalMonthly: total,
    totalMonthlyComponents: total == null ? null : ['rent', 'heat'], utilitiesHeat: total == null ? null : total - leje,
    addressMatchLevel: 'unit', unitAddressUuid: `intern:mp:${n}`, status: 'active',
  })
  // 9001: kun kendte totaler                                 → ren-total
  await saa('9001', 'Prøveby', 900000, 1000000); await saa('9001', 'Prøveby', 1100000, 1200000)
  // 9002: kun husleje                                         → ren-husleje
  await saa('9002', 'Prøveby', 700000, null); await saa('9002', 'Prøveby', 800000, null)
  // 9003: blandet, huslejen ligger inde i totalernes spænd    → blandet-inde
  await saa('9003', 'Attrapby', 800000, 900000); await saa('9003', 'Attrapby', 1300000, 1400000)
  await saa('9003', 'Attrapby', 1000000, null)
  // 9004: blandet, laveste er en husleje                      → blandet-nedre
  await saa('9004', 'Attrapby', 611000, null); await saa('9004', 'Attrapby', 2300000, 2401000)
  // 9005: én total, én husleje over den, én helt uden pris    → blandet-oevre, 1 uden pris
  await saa('9005', 'Fiktivby', 900000, 1000000); await saa('9005', 'Fiktivby', 1500000, null)
  await saa('9005', 'Fiktivby', null, null)
  const [u] = await db.insert(users).values({ email: 'maal-prisspaend@proeve.invalid' }).returning()
  await db.insert(savedSearches).values({ userId: u.id, criteria: { postnr: '9004' }, confirmedAt: new Date() })
  await db.insert(savedSearches).values({ userId: u.id, criteria: { postnr: '9001' },
    confirmedAt: new Date(), unsubscribedAt: new Date() })
  Object.assign(FACIT, {
    slags: { 9001: 'ren-total', 9002: 'ren-husleje', 9003: 'blandet-inde', 9004: 'blandet-nedre', 9005: 'blandet-oevre' },
    // Forslaget fra 26. september, gengivet af de samme tal.
    forslag: {
      9004: '1 med samlet pris til udlejer, 24.010 kr/md · 1 kun med husleje, 6.110 kr/md',
      9005: '1 med samlet pris til udlejer, 10.000 kr/md · 1 kun med husleje, 15.000 kr/md · 1 uden pris',
    },
  })
}

const nu = new Date()

/** Én søgning, talt uafhængigt af opsummering() og krydstjekket mod den. */
async function klassificer(f) {
  const raekker = await soeg(f, 100000, nu)
  const K = raekker.filter((r) => r.total != null)
  const H = raekker.filter((r) => r.total == null && r.leje != null)
  const U = raekker.filter((r) => r.total == null && r.leje == null)
  const kt = K.map((r) => r.total), hl = H.map((r) => r.leje)
  const sum = await opsummering(f, nu)
  const alle = [...kt, ...hl]
  const passer = {
    antal: raekker.length === sum.antal,
    medTotal: K.length === sum.medTotal,
    spaend: alle.length === 0 ? sum.billigst == null
      : Math.min(...alle) === sum.billigst && Math.max(...alle) === sum.dyrest,
  }
  let slags, nedre = null, oevre = null
  if (!alle.length) slags = 'intet-spaend'
  else if (!hl.length) { slags = 'ren-total'; nedre = oevre = 'total' }
  else if (!kt.length) { slags = 'ren-husleje'; nedre = oevre = 'husleje' }
  else {
    // Uafgjort (samme beløb i begge grupper) tælles som total: så står
    // tallet på skærmen også for en bolig med kendt total.
    const n = Math.min(...hl) < Math.min(...kt), o = Math.max(...hl) > Math.max(...kt)
    nedre = n ? 'husleje' : 'total'; oevre = o ? 'husleje' : 'total'
    slags = n && o ? 'blandet-begge' : n ? 'blandet-nedre' : o ? 'blandet-oevre' : 'blandet-inde'
  }
  // Forslaget fra 26. september: hvert spænd ved sin egen optælling.
  const forslag = [
    kt.length ? `${K.length} med samlet pris til udlejer, ${spaendTekst(kt)}` : null,
    hl.length ? `${H.length} kun med husleje, ${spaendTekst(hl)}` : null,
    U.length ? `${U.length} uden pris` : null,
  ].filter(Boolean).join(' · ')
  return {
    slags, nedre, oevre, passer,
    antal: raekker.length, medTotal: sum.medTotal, medIndflytning: sum.medIndflytning,
    kendtTotal: K.length, kunHusleje: H.length, udenPris: U.length,
    vist: {
      billigst: sum.billigst, dyrest: sum.dyrest,
      tekst: sum.billigst != null && sum.dyrest != null ? `${kr(sum.billigst)}–${kr(sum.dyrest)} kr/md` : null,
      chips: [`${sum.medTotal} med samlet pris til udlejer`, `${sum.medIndflytning} med indflytningspris`,
        ...(sum.billigst != null && sum.dyrest != null ? [`${kr(sum.billigst)}–${kr(sum.dyrest)} kr/md`] : [])],
    },
    spaendKunTotal: mm(kt), spaendKunHusleje: mm(hl),
    forslag,
    _raekker: { K, H, U },
  }
}

// ─── Universet ─────────────────────────────────────────────────
const steder = await db.selectDistinct({ postnr: listings.postalCode, by: listings.city })
  .from(listings).where(eq(listings.status, 'active'))
const postnumre = [...new Set(steder.map((s) => s.postnr).filter(Boolean))].sort()
const byer = [...new Set(steder.map((s) => s.by).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'da'))
const gemte = await db.select({ id: savedSearches.id, criteria: savedSearches.criteria })
  .from(savedSearches).where(and(isNotNull(savedSearches.confirmedAt), isNull(savedSearches.unsubscribedAt)))

const ud = { postnr: [], by: [], gemt: [] }
for (const p of postnumre) ud.postnr.push({ navn: p, ...(await klassificer(filtreFraParametre({ sted: p }))) })
for (const b of byer) ud.by.push({ navn: b, ...(await klassificer(filtreFraParametre({ sted: b }))) })
let gemteUdenFiltre = 0
for (const g of gemte) {
  if (!harFiltre(g.criteria)) { gemteUdenFiltre++; continue }
  ud.gemt.push({ navn: g.id.slice(0, 8), ...(await klassificer(g.criteria)) })
}

const SLAGS = ['ren-total', 'ren-husleje', 'blandet-inde', 'blandet-nedre', 'blandet-oevre', 'blandet-begge', 'intet-spaend']
const opsum = {}
for (const [univers, liste] of Object.entries(ud)) {
  const blandede = liste.filter((x) => x.slags.startsWith('blandet'))
  const usande = liste.filter((x) => /nedre|oevre|begge/.test(x.slags))
  opsum[univers] = {
    soegninger: liste.length,
    viserSpaend: liste.filter((x) => x.slags !== 'intet-spaend').length,
    blandet: blandede.length,
    endepunktErHusleje: usande.length,
    fordeling: Object.fromEntries(SLAGS.map((s) => [s, liste.filter((x) => x.slags === s).length])),
    boligerBagBlandede: blandede.reduce((a, x) => a + x.antal, 0),
    krydstjekAfviger: liste.filter((x) => !x.passer.antal || !x.passer.medTotal || !x.passer.spaend).map((x) => x.navn),
  }
  const o = opsum[univers]
  process.stdout.write(`\n══ ${univers}: ${o.soegninger} søgninger, ${o.viserSpaend} viser et spænd\n`)
  process.stdout.write(`   blandet: ${o.blandet} · heraf mindst ét endepunkt en husleje: ${o.endepunktErHusleje}\n`)
  process.stdout.write(`   fordeling: ${SLAGS.map((s) => `${s} ${o.fordeling[s]}`).join(' · ')}\n`)
  process.stdout.write(`   krydstjek mod opsummering(): ${o.krydstjekAfviger.length ? 'AFVIGER for ' + o.krydstjekAfviger.join(', ') : 'antal, medTotal og spænd stemmer alle'}\n`)
  // Alle med --alle; ellers kun dem, hvor et endepunkt ER en husleje (de største
  // først). Hele listen står altid i --json.
  const vis = argv.includes('--alle') ? liste
    : liste.filter((y) => /nedre|oevre|begge/.test(y.slags)).sort((a, b) => b.antal - a.antal).slice(0, 15)
  for (const x of vis) {
    process.stdout.write(`   · ${x.navn.padEnd(12)} ${x.slags.padEnd(14)} vist «${x.vist.tekst ?? '—'}» · ${x.kendtTotal} total ${x.spaendKunTotal ? kr(x.spaendKunTotal.min) + '–' + kr(x.spaendKunTotal.max) : '—'} · ${x.kunHusleje} husleje ${x.spaendKunHusleje ? kr(x.spaendKunHusleje.min) + '–' + kr(x.spaendKunHusleje.max) : '—'} · ${x.udenPris} uden pris\n`)
  }
}
if (gemteUdenFiltre) process.stdout.write(`   (${gemteUdenFiltre} gemte søgninger uden filtre sprunget over — de gemmes ikke, jf. harFiltre)\n`)

// ─── Én søgning række for række ───────────────────────────────
const alleSoeg = [...ud.postnr, ...ud.by]
const stedNavn = arg('--sted') ?? [...alleSoeg].filter((x) => /nedre|oevre|begge/.test(x.slags))
  .sort((a, b) => b.antal - a.antal)[0]?.navn
let detalje = null
if (stedNavn) {
  const x = alleSoeg.find((y) => y.navn === stedNavn) ?? { navn: stedNavn, ...(await klassificer(filtreFraParametre({ sted: stedNavn }))) }
  const { K, H, U } = x._raekker
  const kMin = K.length ? K.reduce((a, r) => r.total < a.total ? r : a) : null
  const kMax = K.length ? K.reduce((a, r) => r.total > a.total ? r : a) : null
  detalje = {
    sted: x.navn, url: `/?sted=${encodeURIComponent(x.navn)}`,
    antal: x.antal, medTotal: x.medTotal, kendtTotal: x.kendtTotal, kunHusleje: x.kunHusleje, udenPris: x.udenPris,
    vist: x.vist, slags: x.slags, nedreEndepunkt: x.nedre, oevreEndepunkt: x.oevre,
    spaendKunTotal: x.spaendKunTotal, spaendKunHusleje: x.spaendKunHusleje,
    kunHuslejeRaekker: H.map((r) => ({ id: r.id, adresse: r.adresse, kilde: r.kilde, husleje: r.leje,
      endepunkt: r.leje === x.vist.billigst ? 'nedre' : r.leje === x.vist.dyrest ? 'oevre' : null }))
      .sort((a, b) => a.husleje - b.husleje),
    udenPrisRaekker: U.map((r) => ({ id: r.id, adresse: r.adresse, kilde: r.kilde })),
    totalEndepunkter: { laveste: kMin && { id: kMin.id, adresse: kMin.adresse, total: kMin.total, husleje: kMin.leje },
      hoejeste: kMax && { id: kMax.id, adresse: kMax.adresse, total: kMax.total, husleje: kMax.leje } },
    passer: x.passer, forslag: x.forslag,
  }
  // Ingen gæt om de seks: kun hvad de ANDRE boligers aconto er, og hvor
  // meget plads der er op til spændets øvre ende. Det er to målte tal.
  const aconto = K.filter((r) => r.leje != null).map((r) => r.total - r.leje).sort((a, b) => a - b)
  detalje.acontoBlandtKendte = aconto.length ? {
    antal: aconto.length, min: aconto[0], median: aconto[Math.floor((aconto.length - 1) / 2)], max: aconto.at(-1),
  } : null
  detalje.kunHuslejeRaekker = detalje.kunHuslejeRaekker.map((r) => {
    const plads = x.vist.dyrest - r.husleje
    return { ...r, pladsTilOevreEndepunkt: plads, kendteMedStoerreAconto: aconto.filter((a) => a > plads).length }
  })
  process.stdout.write(`\n══ ${x.navn} række for række (${detalje.url})\n`)
  process.stdout.write(`   i dag:   ${x.vist.chips.join(' · ')}\n`)
  process.stdout.write(`   ${x.antal} boliger: ${x.kendtTotal} med kendt total · ${x.kunHusleje} kun husleje · ${x.udenPris} uden pris\n`)
  process.stdout.write(`   nedre endepunkt er en ${x.nedre}, øvre en ${x.oevre}\n`)
  for (const r of detalje.kunHuslejeRaekker)
    process.stdout.write(`   · kun husleje ${kr(r.husleje).padStart(7)} kr/md  ${r.kilde.padEnd(14)} ${r.adresse}${r.endepunkt ? '  ← ' + r.endepunkt + ' endepunkt' : ''} · ${kr(r.pladsTilOevreEndepunkt)} kr op til øvre ende; ${r.kendteMedStoerreAconto} af de kendte har større aconto\n`)
  if (detalje.acontoBlandtKendte) {
    const a = detalje.acontoBlandtKendte
    process.stdout.write(`   aconto blandt de ${a.antal} med kendt total: ${kr(a.min)}–${kr(a.max)} kr/md, median ${kr(a.median)}\n`)
  }
  process.stdout.write(`   kun totaler:  ${spaendTekst(K.map((r) => r.total)) ?? '—'}\n`)
  process.stdout.write(`   kun husleje:  ${spaendTekst(H.map((r) => r.leje)) ?? '—'}\n`)
  process.stdout.write(`   forslag:  ${x.forslag} · ${x.medIndflytning} med indflytningspris\n`)
}

// ─── Områdesiderne: samme udtryk, kaldt «husleje» ─────────────
// statistik() i lib/omraade.ts regner sit eget coalesce(total, husleje) og
// skriver det som «Huslejen går fra … til …» og «Husleje …» i beskrivelsen.
// Her er fejlen den omvendte: et endepunkt, der er en TOTAL, kaldes husleje.
const omraader = []
for (const o of await alleOmraader()) {
  const s = await statistik(o)
  // Genbrug søgningen for samme sted, hvis den allerede er talt.
  const x = (o.slags === 'by' ? ud.by : ud.postnr).find((y) => y.navn === o.vaerdi)
    ?? await klassificer(filtreFraParametre(o.slags === 'by' ? { by: o.vaerdi } : { postnr: o.vaerdi }))
  omraader.push({
    slug: o.slug, slags: o.slags, vaerdi: o.vaerdi, antal: s.antal, medTotal: s.medTotal,
    vist: s.billigst != null ? `Huslejen går fra ${kr(s.billigst)} kr. til ${kr(s.dyrest)} kr.` : null,
    nedre: x.nedre, oevre: x.oevre,
    // Samme mængde? statistik() filtrerer med eq på byen, søgningen med ilike.
    sammeGrundlag: s.antal === x.antal && s.billigst === x.vist.billigst && s.dyrest === x.vist.dyrest,
    spaendAfHuslejeAlle: mm(x._raekker.H.map((r) => r.leje).concat(x._raekker.K.map((r) => r.leje).filter((v) => v != null))),
  })
}
const omraadeOpsum = {
  sider: omraader.length,
  klassificeret: omraader.filter((o) => o.sammeGrundlag).length,
  // «Huslejen går fra A til B», hvor A eller B er en total og ikke en husleje.
  endepunktErTotal: omraader.filter((o) => o.sammeGrundlag && (o.nedre === 'total' || o.oevre === 'total')).length,
  beggeEndepunkterTotal: omraader.filter((o) => o.sammeGrundlag && o.nedre === 'total' && o.oevre === 'total').length,
}
process.stdout.write(`\n══ områdesider: ${omraadeOpsum.sider} · klassificeret ${omraadeOpsum.klassificeret} · «husleje»-endepunkt der er en total: ${omraadeOpsum.endepunktErTotal} (begge ender: ${omraadeOpsum.beggeEndepunkterTotal})\n`)
for (const o of argv.includes('--alle') ? omraader : [...omraader].sort((a, b) => b.antal - a.antal).slice(0, 10))
  process.stdout.write(`   · ${o.slug.padEnd(12)} «${o.vist}» · nedre ${o.nedre}, øvre ${o.oevre}${o.sammeGrundlag ? '' : ' · (grundlag afviger fra søgningen — ikke klassificeret)'} · huslejen (alle boliger) ${o.spaendAfHuslejeAlle ? kr(o.spaendAfHuslejeAlle.min) + "–" + kr(o.spaendAfHuslejeAlle.max) : "—"}\n`)

// ─── JSON ─────────────────────────────────────────────────────
const jsonSti = arg('--json')
if (jsonSti) {
  const { writeFileSync } = await import('node:fs')
  const renset = Object.fromEntries(Object.entries(ud).map(([k, l]) => [k, l.map(({ _raekker, ...r }) => r)]))
  writeFileSync(jsonSti, JSON.stringify({ maal, maalt: nu.toISOString(), opsummering: opsum, gemteUdenFiltre,
    detalje, soegninger: renset, omraadeOpsum, omraader }, null, 2))
  process.stdout.write(`\nskrevet: ${jsonSti}\n`)
}

if (PROEVE) {
  const fejl = []
  for (const x of ud.postnr) {
    if (FACIT.slags[x.navn] && FACIT.slags[x.navn] !== x.slags) fejl.push(`${x.navn}: ${x.slags}, facit ${FACIT.slags[x.navn]}`)
    if (FACIT.forslag[x.navn] && FACIT.forslag[x.navn] !== x.forslag) fejl.push(`${x.navn}: forslag «${x.forslag}», facit «${FACIT.forslag[x.navn]}»`)
    if (!x.passer.antal || !x.passer.medTotal || !x.passer.spaend) fejl.push(`${x.navn}: krydstjek ${JSON.stringify(x.passer)}`)
  }
  const attrap = ud.by.find((x) => x.navn === 'Attrapby')
  if (attrap?.slags !== 'blandet-nedre') fejl.push(`Attrapby: ${attrap?.slags}`)
  const gs = ud.gemt.map((x) => x.slags).join(',')
  if (gs !== 'blandet-nedre') fejl.push(`gemte: [${gs}], facit [blandet-nedre]`)
  process.stdout.write(`\n══ PRØVE: ${fejl.length ? 'FEJL\n   ' + fejl.join('\n   ') : 'alle fem postnumre, byen, forslagsteksten og den ene gemte søgning som facit'}\n`)
  await tb.luk()
  process.exitCode = fejl.length ? 1 : 0
} else {
  process.stdout.write(`\nread-only til sidst, samme forbindelse: ${await laas.afslut()}\n`)
  process.exit(0)
}
