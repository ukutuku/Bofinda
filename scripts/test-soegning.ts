// ═══════════════════════════════════════════════════════════════
//  Søgningens korrekthed: domænefilteret, udsnittet og optællingerne.
//
//  Kører mod PGlite gennem scripts/testbase.ts — ingen produktion,
//  intet netværk, ingen mail. Data er syntetiske og sås her i filen,
//  så hvert tilfælde er skrevet ud og kan læses.
//
//  ── HVORFOR DEN HER FIL FINDES ────────────────────────────────
//  `soegGrupperet` skar med `.limit(graense)` i SQL og anvendte
//  DEREFTER domænefiltrene i JS. De kan ikke oversættes til SQL — de
//  kræver kildekontrakten og et referencetidspunkt — så rækkefølgen
//  betød, at et kort kun kunne findes, hvis det i forvejen lå blandt de
//  48 første i den UFILTREREDE sortering. Målt på produktionen 8.
//  september 2026: `overtagelse=nu` viste 0 kort ud af 139 matchende,
//  mens overskriften samtidig skrev «1.814 boliger».
//
//  ── FACIT ER UAFHÆNGIGT ───────────────────────────────────────
//  Prøverne måler ikke `soegGrupperet` mod sig selv. `facit()` bygger
//  det forventede resultat af de SÅEDE rækker: den grupperer i JS efter
//  den nøgle, skemaet dokumenterer, og afgør domænefilteret med
//  `availabilityFor` + `matcherDomaene` direkte. Det er med vilje et
//  ANDET udtryk for samme spørgsmål — det er hele pointen med et facit.
//  Driver de fra hinanden, er det dét, prøven skal fange.
// ═══════════════════════════════════════════════════════════════

import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, listings, sources } from '../db/schema'
import {
  antalBoliger, availabilityFor, filtreFraParametre, matcherDomaene,
  opsummering, soegGrupperet, type Filtre,
} from '../lib/soeg'
import { KILDEKONTRAKTER } from '../lib/kildekontrakt'

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
  if (!ok) fejl++
}

// ─── Kilden ────────────────────────────────────────────────────
//
//  EGEN slug pr. kørsel — prøven låner aldrig en rigtig kildes identitet,
//  jf. reglen i CLAUDE.md. Men kontrakten SKAL være ægte, ellers prøver
//  vi vores egen efterligning af domænet i stedet for domænet.
//  Derfor sættes de rigtige kontrakters dele ind under prøvens slug:
//  datofeltet fra `native` (nu/senere), ansøgningsformen fra `findbolig`
//  (WaitingList → venteliste) og statusordene fra `balder` (Reserveret).
//  Semantikken er altså kildernes egen; kun navnet er prøvens.

const SLUG = `proeve-soeg-${Date.now()}`

KILDEKONTRAKTER[SLUG] = {
  kilde: SLUG,
  statusser: KILDEKONTRAKTER.balder!.statusser,
  datofelt: KILDEKONTRAKTER.native!.datofelt,
  ansoegningsform: KILDEKONTRAKTER.findbolig!.ansoegningsform,
  overtagelsestekst: null,
  direkteSignaler: {},
}

// ─── Såning ────────────────────────────────────────────────────

interface Frø {
  /** Til fejlbeskeder — står aldrig i basen. */
  navn: string
  vej: string
  husnr: string
  postnr: string
  by: string
  vaerelser: number | null
  areal?: number | null
  leje: number          // øre
  total?: number | null
  /** Rå availability-fakta, som en adapter ville have skrevet dem. */
  fakta: Record<string, unknown>
  /** Styrer «nyeste»-rækkefølgen. Lavere tal = ældre = længere nede. */
  alder: number
}

let kildeId = ''
const saaede: (Frø & { id: string })[] = []

async function saa(froe: Frø[]) {
  for (const f of froe) {
    const [r] = await db.insert(listings).values({
      sourceId: kildeId,
      sourceType: 'feed',
      externalKey: `${SLUG}-${f.navn}`,
      sourceUrl: `https://proeve.invalid/${f.navn}`,
      addressRaw: `${f.vej} ${f.husnr}, ${f.postnr} ${f.by}`,
      street: f.vej,
      houseNumber: f.husnr,
      postalCode: f.postnr,
      city: f.by,
      rooms: f.vaerelser,
      sizeM2: f.areal ?? 60,
      rentMonthly: f.leje,
      totalMonthly: f.total ?? null,
      // 'unit' med en UNIK nøgle pr. række. Skemaet kræver nøglen
      // (`listing_address_level_honest`), og fordi den er unik, giver
      // dedup-prædikatet `count(*) > 1` aldrig træf — prøvens rækker kan
      // altså ikke forsvinde som dubletter af hinanden. 'failed' ville
      // have skjult dem helt.
      addressMatchLevel: 'unit',
      unitAddressUuid: `intern:proeve:${SLUG}:${f.navn}`,
      availabilityFacts: f.fakta,
      status: 'active',
      sourceCreatedAt: new Date(Date.UTC(2026, 0, 1) + f.alder * 86_400_000),
    }).returning({ id: listings.id })
    saaede.push({ ...f, id: r!.id })
  }
}

// ─── Facit ─────────────────────────────────────────────────────

/**
 * Det forventede resultat, bygget af de såede rækker.
 *
 * Grupperingsnøglen er skrevet ud i JS efter skemaets dokumenterede
 * regel: kilde + postnummer + vej + værelser + ejer + «er totalen kendt»
 * — og en bolig, hvor værelser, vej eller postnummer mangler, står altid
 * alene (`ALENE` i lib/soeg.ts). Ejeren er null på alt her.
 */
function facit(f: Filtre, nu: Date) {
  const synlige = saaede.filter((s) => {
    if (f.postnr && s.postnr !== f.postnr) return false
    if (f.by && !s.by.toLowerCase().includes(f.by.toLowerCase())) return false
    const pris = s.total ?? s.leje
    if (f.prisMin != null && pris < f.prisMin) return false
    if (f.prisMax != null && pris > f.prisMax) return false
    if (f.vaerelserMin != null && (s.vaerelser ?? -1) < f.vaerelserMin) return false
    return true
  })

  const noegle = (s: (typeof saaede)[number]) =>
    s.vaerelser != null && s.vej != null && s.postnr != null
      ? [SLUG, s.postnr, s.vej, s.vaerelser, 'null', String(s.total != null)].join('|')
      : `alene:${s.id}`

  const grupper = new Map<string, (typeof saaede)[number][]>()
  for (const s of synlige) {
    const k = noegle(s)
    const g = grupper.get(k)
    if (g) g.push(s)
    else grupper.set(k, [s])
  }

  const matcher = (s: (typeof saaede)[number]) =>
    matcherDomaene(f, availabilityFor({ availabilityFacts: s.fakta, kilde: SLUG }, nu))

  const domaene = f.overtagelse != null || f.ansoegningsform != null || f.markedsstatus != null

  // Et gruppekort kræver mindst to medlemmer OG kendte nøgledele OG en
  // kendt pris i begge ender — ellers står repræsentanten alene.
  const priser = (m: (typeof saaede)[number][]) =>
    m.map((x) => x.total ?? x.leje).filter((p): p is number => p != null)
  const erGruppekort = (m: (typeof saaede)[number][]) =>
    m.length >= 2 && m[0]!.vaerelser != null && priser(m).length === m.length

  const kort = [...grupper.values()].filter((m) => {
    if (!domaene) return true
    if (erGruppekort(m)) return m.some(matcher)
    // Enkeltkort afgøres på repræsentanten: den nyeste i rækken.
    const rep = [...m].sort((a, b) => b.alder - a.alder)[0]!
    return matcher(rep)
  })

  return {
    /** Matchende BOLIGER — det tal overskriften skal vise. */
    boliger: (domaene ? synlige.filter(matcher) : synlige).length,
    /** Matchende KORT efter gruppering. */
    kort: kort.length,
    /** Boliger dækket af de matchende kort — ikke det samme som `boliger`. */
    boligerIKort: kort.reduce((n, m) => n + m.length, 0),
  }
}

// ─── Kørslen ───────────────────────────────────────────────────

async function koer() {
  const [k] = await db.insert(sources).values({
    slug: SLUG, name: 'Prøve: søgning', sourceType: 'feed',
    baseUrl: 'https://proeve.invalid', enabled: false,
  }).returning()
  kildeId = k!.id
  // En kørsel langt tilbage, så rækkerne ikke er «bagkatalog» og
  // «nyeste» sorterer på sourceCreatedAt, som prøven selv styrer.
  await db.insert(crawlRuns).values({
    sourceId: kildeId, status: 'ok', startedAt: new Date(Date.UTC(2020, 0, 1)),
  })

  const nu = new Date(Date.UTC(2026, 5, 15, 12, 0, 0))
  const FORTID = '2020-01-01'   // → timing 'nu'
  const FREMTID = '2099-01-01'  // → timing 'senere'

  console.log('\n── Søgningens korrekthed ─────────────────────────────\n')

  // ═══ 1 · De første 48 kandidater matcher ikke ═══
  //
  // 60 boliger, der IKKE kan overtages nu, og som alle er nyere end de
  // 6, der kan. Med den gamle rækkefølge — skær 48, filtrér bagefter —
  // var svaret nul. Det er præcis produktionsfejlen i lille format.
  console.log('══ 1 · matchende boliger efter de 48 første kandidater ══')
  await saa([
    ...Array.from({ length: 60 }, (_, i) => ({
      navn: `stoej-${i}`, vej: `Støjvej ${i}`, husnr: '1', postnr: '1000', by: 'Prøveby',
      vaerelser: 2, leje: 1_000_000, fakta: { sourceAvailabilityDate: FREMTID },
      alder: 500 + i,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      navn: `guld-${i}`, vej: `Guldvej ${i}`, husnr: '1', postnr: '1000', by: 'Prøveby',
      vaerelser: 2, leje: 900_000, fakta: { sourceAvailabilityDate: FORTID },
      alder: 100 + i,
    })),
  ])
  {
    const f = filtreFraParametre({ postnr: '1000', overtagelse: 'nu' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek('1 · resultatet er IKKE falsk tomt',
      g.visninger.length > 0, `${g.visninger.length} kort`)
    tjek('1 · matchende kort stemmer med facit',
      g.kortIAlt === v.kort, `${g.kortIAlt} = ${v.kort}`)
    tjek('1 · matchende boliger stemmer med facit',
      s.antal === v.boliger, `${s.antal} = ${v.boliger}`)
    tjek('1 · alle 6 matchende er med — ingen tabt bag de 60 første',
      g.kortIAlt === 6 && s.antal === 6)
    tjek('1 · og de viste kort er netop de matchende',
      g.visninger.every((x) => x.slags === 'bolig'
        && String(x.bolig.vej).startsWith('Guldvej')))
  }

  // ═══ 2 · Flere end 48 matchende kort ═══
  //
  // Visningsgrænsen holder, men totalen tæller hele det matchende sæt.
  console.log('\n══ 2 · flere end 48 matchende kort ══')
  await saa(Array.from({ length: 55 }, (_, i) => ({
    navn: `mange-${i}`, vej: `Mangevej ${i}`, husnr: '1', postnr: '2000', by: 'Prøveby',
    vaerelser: 3, leje: 1_100_000, fakta: { sourceAvailabilityDate: FORTID },
    alder: 200 + i,
  })))
  {
    const f = filtreFraParametre({ postnr: '2000', overtagelse: 'nu' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek('2 · visningsgrænsen holder', g.visninger.length === 48)
    tjek('2 · totalen tæller hele det matchende sæt',
      g.kortIAlt === 55 && g.kortIAlt === v.kort, `${g.kortIAlt}`)
    tjek('2 · matchende boliger stemmer', s.antal === 55 && s.antal === v.boliger)
    tjek('2 · de tre tal er forskellige og bruges ikke som ét',
      g.kortIAlt !== g.visninger.length && s.antal !== g.visninger.length)
    tjek('2 · komplet er sand — loftet blev ikke ramt', g.komplet === true)
  }

  // ═══ 3 · Blandet gruppe ═══
  //
  // Fem boliger på samme vej, samme værelsestal, samme kilde: ÉT
  // gruppekort. To kan overtages nu, tre ikke. Kortet vises, fordi
  // mindst ét medlem matcher — og det skal blive ved at tælle HELE
  // gruppen, så `antal`, prisspændet og availability-tællingerne
  // stemmer indbyrdes. Filtreres medlemmerne væk, begynder kortet at
  // lyve om sin egen størrelse.
  console.log('\n══ 3 · gruppe med både matchende og ikke-matchende ══')
  await saa([
    ...Array.from({ length: 2 }, (_, i) => ({
      navn: `blandet-nu-${i}`, vej: 'Blandetvej', husnr: String(i + 1),
      postnr: '3000', by: 'Prøveby', vaerelser: 3, leje: 1_000_000 + i * 1000,
      fakta: { sourceAvailabilityDate: FORTID }, alder: 300 + i,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      navn: `blandet-senere-${i}`, vej: 'Blandetvej', husnr: String(i + 10),
      postnr: '3000', by: 'Prøveby', vaerelser: 3, leje: 2_000_000 + i * 1000,
      fakta: { sourceAvailabilityDate: FREMTID }, alder: 310 + i,
    })),
  ])
  {
    const f = filtreFraParametre({ postnr: '3000', overtagelse: 'nu' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    const kort = g.visninger[0]
    tjek('3 · den blandede gruppe vises som ÉT kort',
      g.visninger.length === 1 && g.kortIAlt === 1 && v.kort === 1)
    tjek('3 · kortet er et gruppekort', kort?.slags === 'gruppe')
    if (kort?.slags === 'gruppe') {
      const gr = kort.gruppe
      tjek('3 · antal er HELE gruppen, ikke kun de matchende',
        gr.antal === 5, `${gr.antal}`)
      tjek('3 · availability-tællingerne går op med antal',
        gr.availability.timing.nu + gr.availability.timing.senere
        + gr.availability.timing.unknown + gr.availability.timing.conflict === gr.antal,
        `nu=${gr.availability.timing.nu} senere=${gr.availability.timing.senere}`)
      tjek('3 · og de viser den rigtige fordeling',
        gr.availability.timing.nu === 2 && gr.availability.timing.senere === 3)
      tjek('3 · prisspændet dækker hele gruppen — samme sæt som antal',
        gr.prisMin === 1_000_000 && gr.prisMax === 2_002_000,
        `${gr.prisMin}–${gr.prisMax}`)
    }
    tjek('3 · matchende BOLIGER er 2, ikke 5 — kortet er ikke boligtallet',
      s.antal === 2 && v.boliger === 2, `${s.antal}`)
    tjek('3 · og boliger dækket af de viste kort er 5',
      antalBoliger(g.visninger) === 5 && v.boligerIKort === 5)
  }

  // ═══ 4 · Ingen matcher ═══
  console.log('\n══ 4 · ingen boliger matcher ══')
  {
    const f = filtreFraParametre({ postnr: '1000', venteliste: '1' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek('4 · nulresultat', g.visninger.length === 0 && g.kortIAlt === 0 && v.kort === 0)
    tjek('4 · nuloptælling — overskriften siger ikke 66', s.antal === 0 && v.boliger === 0,
      `${s.antal}`)
    tjek('4 · og de øvrige tal er også nul',
      s.medTotal === 0 && s.medIndflytning === 0 && s.fuld === 0
      && s.billigst === null && s.dyrest === null)
  }

  // ═══ 5 · Venteliste og reserveret ═══
  console.log('\n══ 5 · venteliste og reserveret ══')
  await saa([
    { navn: 'vent-1', vej: 'Ventevej', husnr: '1', postnr: '4000', by: 'Prøveby',
      vaerelser: 1, leje: 500_000, fakta: { rawApplicationType: 'WaitingList' }, alder: 400 },
    { navn: 'vent-2', vej: 'Ventevej', husnr: '2', postnr: '4000', by: 'Prøveby',
      vaerelser: 1, leje: 510_000, fakta: { rawApplicationType: 'Regular' }, alder: 401 },
    { navn: 'res-1', vej: 'Reservevej', husnr: '1', postnr: '4000', by: 'Prøveby',
      vaerelser: 4, leje: 700_000, fakta: { rawStatus: 'Reserveret' }, alder: 402 },
    { navn: 'res-2', vej: 'Reservevej', husnr: '2', postnr: '4000', by: 'Prøveby',
      vaerelser: 4, leje: 710_000, fakta: { rawStatus: 'Ledig' }, alder: 403 },
  ])
  for (const [navn, sp, forventet] of [
    ['venteliste', { postnr: '4000', venteliste: '1' }, 1],
    ['reserveret', { postnr: '4000', reserveret: '1' }, 1],
    ['overtagelse=senere', { postnr: '3000', overtagelse: 'senere' }, 1],
  ] as [string, Record<string, string>, number][]) {
    const f = filtreFraParametre(sp)
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek(`5 · ${navn}: kort stemmer med facit`,
      g.kortIAlt === v.kort && g.kortIAlt === forventet, `${g.kortIAlt} = ${v.kort}`)
    tjek(`5 · ${navn}: boliger stemmer med facit`,
      s.antal === v.boliger, `${s.antal} = ${v.boliger}`)
  }

  // ═══ 6 · Kombinationer med sted, pris og værelser ═══
  console.log('\n══ 6 · kombinationer af sted, pris, værelser og domæne ══')
  for (const [navn, sp] of [
    ['sted + nu', { postnr: '1000', overtagelse: 'nu' }],
    ['sted + pris + nu', { postnr: '2000', prisMax: '12000', overtagelse: 'nu' }],
    ['pris der udelukker alt + nu', { postnr: '2000', prisMax: '1', overtagelse: 'nu' }],
    ['by + nu', { by: 'Prøveby', overtagelse: 'nu' }],
    ['by + værelser + senere', { by: 'Prøveby', vaerelser: '3', overtagelse: 'senere' }],
    ['sted uden domænefilter', { postnr: '3000' }],
    ['by uden domænefilter', { by: 'Prøveby' }],
    ['alt uden filtre', {}],
  ] as [string, Record<string, string>][]) {
    const f = filtreFraParametre(sp)
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek(`6 · ${navn}`,
      g.kortIAlt === v.kort && s.antal === v.boliger
      && g.visninger.length === Math.min(48, v.kort),
      `kort ${g.kortIAlt}/${v.kort} · boliger ${s.antal}/${v.boliger} · vist ${g.visninger.length}`)
  }

  // ═══ 7 · Samme klokke i hele søgningen ═══
  //
  // En bolig, der kan overtages i morgen, er 'senere' i dag. Læste
  // listen og optællingen hver sin klokke, kunne den være med i det ene
  // tal og ude af det andet.
  console.log('\n══ 7 · samme referencetidspunkt i liste og optælling ══')
  await saa([{
    navn: 'graense', vej: 'Grænsevej', husnr: '1', postnr: '5000', by: 'Prøveby',
    vaerelser: 2, leje: 800_000,
    fakta: { sourceAvailabilityDate: '2026-06-16' }, alder: 450,
  }])
  {
    const foer = new Date(Date.UTC(2026, 5, 15, 12, 0, 0))
    const efter = new Date(Date.UTC(2026, 5, 16, 12, 0, 0))
    const f = filtreFraParametre({ postnr: '5000', overtagelse: 'nu' })
    const a = await soegGrupperet(f, 48, foer)
    const sa = await opsummering(f, foer)
    const b = await soegGrupperet(f, 48, efter)
    const sb = await opsummering(f, efter)
    tjek('7 · dagen før: hverken kort eller optælling har den',
      a.kortIAlt === 0 && sa.antal === 0)
    tjek('7 · på dagen: begge har den',
      b.kortIAlt === 1 && sb.antal === 1)
    tjek('7 · liste og optælling er aldrig uenige',
      (a.kortIAlt > 0) === (sa.antal > 0) && (b.kortIAlt > 0) === (sb.antal > 0))
  }

  // ═══ 8 · Uden domænefilter er alt uændret ═══
  console.log('\n══ 8 · søgninger uden domænefilter ══')
  {
    const f = filtreFraParametre({})
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = facit(f, nu)
    tjek('8 · kort i alt stemmer med facit', g.kortIAlt === v.kort, `${g.kortIAlt} = ${v.kort}`)
    tjek('8 · boliger stemmer med facit', s.antal === v.boliger, `${s.antal} = ${v.boliger}`)
    tjek('8 · udsnittet er stadig højst 48', g.visninger.length === 48)
    tjek('8 · komplet', g.komplet === true)
    // Prisspændet i optællingen skal komme fra det samme sæt som listen.
    tjek('8 · billigst/dyrest er sat', s.billigst != null && s.dyrest != null)
  }

  // ═══ 9 · Overskriftens tal må aldrig modsige listen ═══
  //
  // Det var kernen i fejlen: «1.814 boliger» over en tom liste.
  console.log('\n══ 9 · overskrift og liste kan ikke modsige hinanden ══')
  {
    let uenige = 0
    for (const sp of [
      {}, { overtagelse: 'nu' }, { overtagelse: 'senere' }, { venteliste: '1' },
      { reserveret: '1' }, { postnr: '1000', overtagelse: 'nu' },
      { postnr: '9999', overtagelse: 'nu' }, { by: 'Findesikke' },
      { postnr: '4000', venteliste: '1' }, { postnr: '4000', reserveret: '1' },
    ] as Record<string, string>[]) {
      const f = filtreFraParametre(sp)
      const g = await soegGrupperet(f, 48, nu)
      const s = await opsummering(f, nu)
      if ((s.antal === 0) !== (g.visninger.length === 0)) uenige++
      if ((s.antal === 0) !== (g.kortIAlt === 0)) uenige++
    }
    tjek('9 · ti søgninger: aldrig «N boliger» over en tom liste', uenige === 0)
  }

  // ─── Oprydning ───────────────────────────────────────────────
  await db.delete(listings).where(inArray(listings.id, saaede.map((s) => s.id)))
  await db.delete(crawlRuns).where(eq(crawlRuns.sourceId, kildeId))
  await db.delete(sources).where(eq(sources.id, kildeId))
  delete KILDEKONTRAKTER[SLUG]

  console.log(fejl === 0 ? '\n  ALT GRØNT\n' : `\n  ${fejl} FEJLEDE\n`)
  if (fejl) process.exit(1)
}

await koer()
