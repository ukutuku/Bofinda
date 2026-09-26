// ═══════════════════════════════════════════════════════════════
//  Genskrivning af gemte beskrivelser.
//
//  `listings.description` skrev «Med varme og vand er den samlede
//  månedlige udgift 10.500 kr.» — en påstand om fuldstændighed om
//  nøjagtig det tal, kortet tager forbehold for. Rettet i
//  `genererBeskrivelse`, men teksten er PERSISTERET, så de gamle rækker
//  står tilbage med den gamle ordlyd.
//
//    npm run genskriv-beskrivelse            viser hvad der ville ske
//    npm run genskriv-beskrivelse -- --skriv skriver
//
//  ═══ HVORFOR EN BACKFILL OVERHOVEDET ═══
//
//  Målt 24. september 2026 (blok B6b), af 2.112 rækker med sætningen:
//
//      1.368  nås ved genimport   — aktive, ikke-native
//        744  kræver backfill     — inaktive
//          0  native              — holdes udenfor
//
//  De 744 er ikke en rest. En afmeldt bolig er ikke længere i
//  discovery, så den kommer ALDRIG ind i genopfriskningsløkken
//  (lib/ingest.ts:485 itererer `fundne`). Dens beskrivelse er frosset
//  for altid — og `hentBolig` filtrerer ikke på status (lib/soeg.ts:1603),
//  så siden vises stadig. En tredjedel af påstandene sidder der.
//
//  ═══ UDLEJERANNONCER RØRES ALDRIG ═══
//
//  `ne(sourceType, 'native')` står i SQL'en, ikke i en gren — samme
//  disciplin som alarmens native-spærring. Grunden er `||` på
//  lib/udlejer.ts:262: lader udlejeren beskrivelsesfeltet stå tomt,
//  gemmes VORES sætning som hendes, og lib/udlejer.ts:84 læser den
//  tilbage i hendes formular næste gang. Teksten er da hendes at rette,
//  ikke vores at skrive om. Klassen er nul i dag; én udlejer, der
//  gemmer i morgen, skaber den.
//
//  ═══ PROVENIENS: KUN DET, VI SELV HAR SKREVET ═══
//
//  Scriptet overskriver ikke alt det, der ikke er native. Det bærer en
//  FROSSEN kopi af den gamle generator, genberegner hvad den ville have
//  skrevet ud fra rækkens egne kolonner, og rører KUN rækker, hvor det
//  gemte stemmer ORDRET. Alt andet — håndskrevet tekst, en ældre
//  generator, en skrivesti vi ikke kender — tælles og listes, aldrig
//  røres.
//
//  Den frosne kopi er engangsgods. Den skal slettes, når backfillen har
//  kørt; den er der for at bevise herkomst, ikke for at vedligeholdes.
// ═══════════════════════════════════════════════════════════════

import { stat, readdir, readFile } from 'node:fs/promises'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db, sql as raw } from '../db/client'
import { listings, sources } from '../db/schema'
import { genererBeskrivelse } from '../lib/normalize'
import { oereTilKroner } from '../lib/money'

const skriv = process.argv.includes('--skriv')

const MDR = ['januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december']

/**
 * FROSSEN kopi af `genererBeskrivelse` som den stod i f3c3ca5 — commit'en
 * FØR rettelsen. Ordret, inklusive `?? k` og den hjemmerullede opremsning.
 *
 * ⚠ RET ALDRIG I DEN. Den er ikke en implementering, den er et bevis:
 * stemmer det gemte med dens output, er teksten vores. Bliver den
 * «forbedret», holder provenienskontrollen op med at kunne afgøre noget.
 * Slet filen, når backfillen har kørt.
 */
function gammelBeskrivelse(f: {
  propertyType: string | null
  rooms: number | null
  sizeM2: number | null
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  rentMonthly: number | null
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
  availableFrom: Date | null
}): string | null {
  const kr = (o: number) => oereTilKroner(o).toLocaleString('da-DK')
  const s: string[] = []

  const type = f.propertyType ? ({ lejlighed: 'Lejlighed', hus: 'Hus', raekkehus: 'Rækkehus',
    vaerelse: 'Værelse', studiebolig: 'Studiebolig', andet: 'Bolig' } as Record<string, string>)[f.propertyType] : 'Bolig'
  const dele = [
    f.rooms != null ? `${f.rooms} ${f.rooms === 1 ? 'værelse' : 'værelser'}` : null,
    f.sizeM2 != null ? `${f.sizeM2} m²` : null,
  ].filter(Boolean)
  const sted = [f.street, f.houseNumber].filter(Boolean).join(' ')
  const bydel = [f.postalCode, f.city].filter(Boolean).join(' ')

  let f1 = type ?? 'Bolig'
  if (dele.length) f1 += ` på ${dele.join(' og ')}`
  if (sted) f1 += ` på ${sted}`
  if (bydel) f1 += sted ? ` i ${bydel}` : ` i ${bydel}`
  s.push(f1 + '.')

  if (f.rentMonthly != null) {
    if (f.totalMonthly != null && f.totalMonthlyComponents) {
      const navne: Record<string, string> = {
        heat: 'varme', water: 'vand', electricity: 'el', other: 'øvrig aconto',
      }
      const aconto = f.totalMonthlyComponents.filter((k) => k !== 'rent').map((k) => navne[k] ?? k)
      const liste = aconto.length > 1
        ? `${aconto.slice(0, -1).join(', ')} og ${aconto.at(-1)}`
        : aconto[0]
      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Med ${liste} er den samlede månedlige udgift `
        + `${kr(f.totalMonthly)} kr.`)
    } else {
      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Kilden oplyser ikke aconto, så den samlede udgift kendes ikke.`)
    }
  }

  if (f.availableFrom) {
    const d = f.availableFrom
    s.push(`Ledig fra ${d.getDate()}. ${MDR[d.getMonth()]} ${d.getFullYear()}.`)
  }

  return s.length ? s.join(' ') : null
}

/**
 * De to oekonomisaetninger, den frosne generator kan skrive.
 *
 * Den AERLIGE er udledt: den indeholder ingen tal, saa den kan hentes
 * ordret ud af generatoren selv ved at kalde den uden total. Den anden
 * baerer beloeb og postnavne, saa af den kan kun det faste led staa her
 * — og `scripts/test-genskriv.ts` kraever, at netop den streng findes i
 * den frosne generator. Driver de fra hinanden, bliver proeven roed.
 */
const MARKOER_AERLIG = (() => {
  const t = gammelBeskrivelse({
    propertyType: null, rooms: null, sizeM2: null, street: null, houseNumber: null,
    postalCode: null, city: null, rentMonthly: 100, totalMonthly: null,
    totalMonthlyComponents: null, availableFrom: null,
  }) ?? ''
  return t.slice(t.indexOf('Kilden oplyser'))
})()
const MARKOER_TOTAL = 'er den samlede månedlige udgift'

/**
 * En backup, ingen har taget, er ikke en backup — og en halv fil er
 * heller ikke. `scripts/backup.mjs` afslutter med «-- FÆRDIG», så den
 * linje er beviset for, at dumpet løb færdigt.
 *
 * CLAUDE.md: backup FØR en genparse eller anden masseopdatering. Det er
 * en spærring her, ikke en påmindelse — der er ingen anden kopi af
 * basen end den, nogen selv har taget.
 */
async function backupErTaget(): Promise<{ ok: boolean; note: string }> {
  let filer: string[]
  try {
    filer = (await readdir('backup')).filter((f) => /^bofinda-.*\.sql$/.test(f))
  } catch {
    return { ok: false, note: 'mappen backup/ findes ikke' }
  }
  if (!filer.length) return { ok: false, note: 'ingen backup/bofinda-*.sql' }

  const med = await Promise.all(filer.map(async (f) => ({ f, t: (await stat(`backup/${f}`)).mtimeMs })))
  med.sort((a, b) => b.t - a.t)
  const nyeste = med[0]!
  const timer = (Date.now() - nyeste.t) / 3_600_000
  if (timer > 24) return { ok: false, note: `nyeste dump er ${timer.toFixed(1)} timer gammelt (${nyeste.f})` }

  const hale = (await readFile(`backup/${nyeste.f}`, 'utf8')).trimEnd().slice(-40)
  if (!hale.includes('FÆRDIG')) return { ok: false, note: `${nyeste.f} slutter ikke med «-- FÆRDIG» — dumpet løb ikke færdigt` }

  return { ok: true, note: `${nyeste.f}, ${timer.toFixed(1)} timer gammel` }
}

async function main() {
  if (skriv) {
    const b = await backupErTaget()
    if (!b.ok) {
      console.error(`\n  STOP: ${b.note}.`)
      console.error('  Kør «npm run db:backup», se at den siger FÆRDIG, og prøv igen.')
      console.error('  Der er ingen anden kopi af basen end den, nogen selv har taget.\n')
      process.exit(1)
    }
    console.log(`  Backup fundet: ${b.note}\n`)
  }

  const raekker = await db
    .select({
      id: listings.id,
      slug: sources.slug,
      status: listings.status,
      description: listings.description,
      propertyType: listings.propertyType,
      rooms: listings.rooms,
      sizeM2: listings.sizeM2,
      street: listings.street,
      houseNumber: listings.houseNumber,
      postalCode: listings.postalCode,
      city: listings.city,
      rentMonthly: listings.rentMonthly,
      totalMonthly: listings.totalMonthly,
      totalMonthlyComponents: listings.totalMonthlyComponents,
      utilitiesElectricity: listings.utilitiesElectricity,
      electricityOwnMeter: listings.electricityOwnMeter,
      availableFrom: listings.availableFrom,
    })
    .from(listings)
    .innerJoin(sources, eq(sources.id, listings.sourceId))
    // Spærringen står HER, i forespørgslen — ikke i en gren nedenfor.
    // Et felt, der aldrig forlader basen, kan ikke skrives ved et uheld.
    .where(and(ne(listings.sourceType, 'native'), isNotNull(listings.description)))

  let uaendret = 0
  // Skip-grundene holdes ADSKILT. «Ikke vores» er ikke ét faenomen: en
  // raekke, hvor den gamle generator slet intet ville have skrevet, er
  // noget andet end en raekke, hvis tekst BAERER vores gamle saetning,
  // men hvor felterne siden har flyttet sig — og begge er noget andet
  // end en haandskrevet beskrivelse. Slaas de sammen til ét tal, kan
  // man ikke se, om reglen er for snaever eller helt rigtig.
  type Grund = 'ingen-gammel-tekst' | 'vores-saetning-men-felterne-flyttet'
    | 'vores-aerlige-gren-men-felterne-flyttet' | 'fremmed-tekst'
  const fremmed: { id: string; slug: string; status: string; grund: Grund; gemt: string }[] = []
  const aendringer: { id: string; slug: string; status: string; foer: string; efter: string }[] = []

  for (const r of raekker) {
    const felter = { ...r, propertyType: r.propertyType as string | null }
    const gammel = gammelBeskrivelse(felter)

    // Provenienskontrollen. Stemmer det gemte ikke ORDRET med den gamle
    // generators output, er teksten ikke vores at skrive om.
    if (gammel == null || r.description !== gammel) {
      // Baerer teksten VORES gamle saetning? Saa er den vores — men
      // felterne stemmer ikke laengere med den, og saa ved vi ikke,
      // hvilken version af dem saetningen blev skrevet af.
      // ⚠ GENERATOREN HAR TO OEKONOMIGRENE, IKKE ÉN.
      //
      // Foerste udgave saa kun efter totalgrenens saetning, og en raekke
      // med den AERLIGE gren — «Kilden oplyser ikke aconto …» — hvor et
      // felt siden var flyttet, landede derfor under «fremmed-tekst»
      // med forklaringen «haandskrevet eller anden herkomst». Det er
      // faktuelt forkert: teksten ER vores.
      //
      // Efterproevet i PGlite med tre raekker — vores aerlige tekst med
      // felterne i orden, samme tekst med vejnavnet flyttet, og en
      // rigtig haandskrevet. De to sidste blev slaaet sammen til ét tal
      // og var ikke til at skelne i rapporten.
      const gemt = r.description ?? ''
      const grund: Grund = gammel == null
        ? 'ingen-gammel-tekst'
        : gemt.includes(MARKOER_TOTAL)
          ? 'vores-saetning-men-felterne-flyttet'
          : gemt.includes(MARKOER_AERLIG)
            ? 'vores-aerlige-gren-men-felterne-flyttet'
            : 'fremmed-tekst'
      fremmed.push({ id: r.id, slug: r.slug, status: r.status, grund, gemt: (r.description ?? '').slice(0, 90) })
      continue
    }

    const ny = genererBeskrivelse(felter as Parameters<typeof genererBeskrivelse>[0])
    if (ny == null || ny === r.description) { uaendret++; continue }
    aendringer.push({ id: r.id, slug: r.slug, status: r.status, foer: r.description!, efter: ny })
  }

  const baererSaetningen = raekker.filter((r) => (r.description ?? '').includes('er den samlede månedlige udgift')).length

  console.log(`\n  gennemgået            ${raekker.length} rækker (ikke-native, med beskrivelse)`)
  console.log(`  heraf med sætningen   ${baererSaetningen}`)
  console.log('  ' + '─'.repeat(52))
  console.log(`  matcher ordret        ${aendringer.length}   -> ville skrives`)
  console.log(`  matcher, men ens      ${uaendret}   -> ingen ændring nødvendig`)
  console.log(`  springes over         ${fremmed.length}   -> RØRES IKKE`)

  const grunde = new Map<string, number>()
  for (const f of fremmed) grunde.set(f.grund, (grunde.get(f.grund) ?? 0) + 1)
  if (grunde.size) {
    console.log('\n  hvorfor de springes over:')
    for (const [g2, n2] of [...grunde].sort((a, b) => b[1] - a[1])) {
      const forklaring = g2 === 'ingen-gammel-tekst'
        ? 'den gamle generator ville intet have skrevet'
        : g2 === 'vores-saetning-men-felterne-flyttet'
          ? 'bærer VORES totalsætning, men felterne stemmer ikke længere'
          : g2 === 'vores-aerlige-gren-men-felterne-flyttet'
            ? 'bærer VORES ærlige gren — den lover intet, så den er harmløs'
            : 'teksten er ikke vores — håndskrevet eller anden herkomst'
      console.log(`    ${String(n2).padStart(5)}  ${g2.padEnd(38)} ${forklaring}`)
    }
  }

  const prSlug = new Map<string, { aktiv: number; inaktiv: number }>()
  for (const a of aendringer) {
    const t = prSlug.get(a.slug) ?? { aktiv: 0, inaktiv: 0 }
    if (a.status === 'active') t.aktiv++; else t.inaktiv++
    prSlug.set(a.slug, t)
  }
  const spr = new Map<string, number>()
  for (const f of fremmed) spr.set(f.slug, (spr.get(f.slug) ?? 0) + 1)

  const alleSlugs = [...new Set([...prSlug.keys(), ...spr.keys()])]
  if (alleSlugs.length) {
    console.log('\n  pr. kilde:')
    console.log(`    ${'kilde'.padEnd(16)} ${'skrives'.padStart(8)} ${'(aktive'.padStart(8)} ${'inaktive)'.padStart(10)} ${'springes over'.padStart(14)}`)
    const raek = alleSlugs.map((slug) => {
      const t = prSlug.get(slug) ?? { aktiv: 0, inaktiv: 0 }
      return { slug, aktiv: t.aktiv, inaktiv: t.inaktiv, skip: spr.get(slug) ?? 0 }
    }).sort((a, b) => (b.aktiv + b.inaktiv + b.skip) - (a.aktiv + a.inaktiv + a.skip))
    for (const r of raek) {
      console.log(`    ${r.slug.padEnd(16)} ${String(r.aktiv + r.inaktiv).padStart(8)} ${String(r.aktiv).padStart(8)} ${String(r.inaktiv).padStart(10)} ${String(r.skip).padStart(14)}`)
    }
    const sum = raek.reduce((a, r) => ({
      skriv: a.skriv + r.aktiv + r.inaktiv, aktiv: a.aktiv + r.aktiv,
      inaktiv: a.inaktiv + r.inaktiv, skip: a.skip + r.skip,
    }), { skriv: 0, aktiv: 0, inaktiv: 0, skip: 0 })
    console.log(`    ${'I ALT'.padEnd(16)} ${String(sum.skriv).padStart(8)} ${String(sum.aktiv).padStart(8)} ${String(sum.inaktiv).padStart(10)} ${String(sum.skip).padStart(14)}`)
  }

  if (fremmed.length) {
    console.log('\n  eksempler paa de sprungne — TRE PR. GRUND, saa ingen grund skjules')
    console.log('  af en anden, der tilfaeldigvis er hyppigere:')
    for (const g2 of grunde.keys()) {
      const af = fremmed.filter((f) => f.grund === g2)
      console.log(`\n    ── ${g2} (${af.length}) ──`)
      for (const f of af.slice(0, 3)) console.log(`      [${f.slug}/${f.status}] ${f.gemt}…`)
      if (af.length > 3) console.log(`      … og ${af.length - 3} til`)
    }
  }

  if (aendringer.length) {
    console.log('\n  eksempler:')
    for (const a of aendringer.slice(0, 3)) {
      console.log(`    [${a.slug}] før : ${a.foer.split('. ').slice(1).join('. ')}`)
      console.log(`    ${' '.repeat(a.slug.length + 4)}efter: ${a.efter.split('. ').slice(1).join('. ')}`)
    }
  }

  if (skriv) {
    for (const a of aendringer) {
      await db.update(listings).set({ description: a.efter }).where(eq(listings.id, a.id))
    }
    console.log(`\nSKREVET. ${aendringer.length} rækker.`)
  } else {
    console.log('\nIntet skrevet. Kør med --skriv.')
  }

  // Mod produktionen lukker den en rigtig forbindelse. Mod testbasen
  // findes der ingen socket at lukke, og et kast HER ville komme EFTER
  // hele rapporten er skrevet ud — altsaa en roed slutlinje under et
  // resultat, der var i orden. Scriptet skal kunne toerkoeres mod
  // testbasen uden at se ud som om det fejlede.
  try { await raw.end() } catch { /* testbasen har ingen socket */ }
}

main().catch((e) => { console.error(e); process.exit(1) })
