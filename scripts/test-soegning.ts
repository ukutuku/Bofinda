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

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { crawlRuns, listings, sources } from '../db/schema'
import { Gruppekort } from '../app/Boligkort'
import {
  _saetGruppeloft, antalBoliger, availabilityFor, filtreFraParametre,
  gruppenoegleFraBolig, harFiltre, hentGruppe, matcherDomaene,
  opsummering, soegGrupperet, type Filtre,
} from '../lib/soeg'
import { antalFiltre, filterDiff, forrigeFiltre } from '../lib/maalingsoeg'
import { sideUrl, sidevindue } from '../app/Sider'
import { KILDEKONTRAKTER } from '../lib/kildekontrakt'

/** Kortets synlige tekst — det brugeren faktisk læser. */
const kortTekst = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

let fejl = 0
/** Stille assertion inde i en loekke. Taelles op og rapporteres samlet —
 *  en linje pr. iteration ville drukne resten af proeven. */
let forStore = 0
const tjek0 = (ok: boolean) => { if (!ok) forStore++ }
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

  // ═══ 10 · Blandede gruppekort ═══
  //
  // Kortet står i listen, fordi MINDST ét medlem matcher — gruppens regel
  // er uændret. Men så må de øvrige tal ikke tale, som om de også gjorde.
  console.log('\n══ 10 · blandet gruppekort: hvad står der faktisk ══')
  await saa([
    { navn: 'bl-dyr-nu', vej: 'Blandvej', husnr: '1', postnr: '6000', by: 'Prøveby',
      vaerelser: 3, areal: 90, leje: 2_000_000, total: 2_100_000,
      fakta: { sourceAvailabilityDate: FORTID }, alder: 600 },
    { navn: 'bl-billig-1', vej: 'Blandvej', husnr: '2', postnr: '6000', by: 'Prøveby',
      vaerelser: 3, areal: 50, leje: 800_000, total: 900_000,
      fakta: { sourceAvailabilityDate: FREMTID }, alder: 599 },
    { navn: 'bl-billig-2', vej: 'Blandvej', husnr: '3', postnr: '6000', by: 'Prøveby',
      vaerelser: 3, areal: 55, leje: 850_000, total: 950_000,
      fakta: { sourceAvailabilityDate: FREMTID }, alder: 598 },
    { navn: 'bl-ukendt', vej: 'Blandvej', husnr: '4', postnr: '6000', by: 'Prøveby',
      vaerelser: 3, areal: 60, leje: 900_000, total: 1_000_000,
      fakta: {}, alder: 597 },
  ])
  {
    const f = filtreFraParametre({ postnr: '6000', overtagelse: 'nu' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = g.visninger[0]
    tjek('10A · gruppen vises, fordi ét medlem matcher',
      g.kortIAlt === 1 && v?.slags === 'gruppe')
    if (v?.slags === 'gruppe') {
      const gr = v.gruppe
      tjek('10A · gruppemedlemskabet er UÆNDRET — alle fire er med',
        gr.antal === 4)
      tjek('10A · matchende er talt og er 1', gr.matchende === 1)
      tjek('10A · prisintervallet dækker stadig hele gruppen',
        gr.prisMin === 900_000 && gr.prisMax === 2_100_000,
        `${gr.prisMin}–${gr.prisMax}`)
      tjek('10A · arealspændet ligeså', gr.arealMin === 50 && gr.arealMax === 90)
      tjek('10A · availability-tællingerne går op med antal',
        gr.availability.timing.nu === 1 && gr.availability.timing.senere === 2
        && gr.availability.timing.unknown === 1)
      const t = kortTekst(createElement(Gruppekort, { g: gr, nu }))
      tjek('10A · kortet siger hvor mange der matcher',
        t.includes('1 af 4 boliger matcher din søgning'), t.slice(0, 150))
      tjek('10A · og at prisen dækker alle fire',
        t.includes('Pris og areal dækker alle 4'))
      tjek('10A · linket siger ALLE adresser, ikke bare «de»',
        t.includes('Se alle 4 adresser'))
      // Den billigste bolig matcher IKKE. Uden linjen ovenfor ville
      // «9.000 kr» læses som en bolig, der kan overtages nu.
      tjek('10A · den billigste i intervallet matcher ikke — derfor linjen',
        gr.prisMin === 900_000 && gr.matchende === 1)
      // Hvad kommer brugeren frem til efter klik?
      const noegle = await gruppenoegleFraBolig(gr.repraesentant.id)
      const efterKlik = noegle ? await hentGruppe(noegle) : []
      tjek('10A · efter klik ses hele gruppen — og kortet sagde det',
        efterKlik.length === 4 && t.includes('Se alle 4 adresser'),
        `${efterKlik.length} boliger`)
    }
    tjek('10A · matchende BOLIGER er 1, ikke 4', s.antal === 1)
  }

  // 10B · To filtre, ingen enkelt bolig opfylder begge.
  console.log('\n══ 10B · to filtre, ingen bolig opfylder begge ══')
  await saa([
    { navn: 'to-nu', vej: 'Tovej', husnr: '1', postnr: '6100', by: 'Prøveby',
      vaerelser: 2, leje: 1_000_000,
      fakta: { sourceAvailabilityDate: FORTID, rawApplicationType: 'Regular' }, alder: 610 },
    { navn: 'to-vent', vej: 'Tovej', husnr: '2', postnr: '6100', by: 'Prøveby',
      vaerelser: 2, leje: 1_100_000,
      fakta: { sourceAvailabilityDate: FREMTID, rawApplicationType: 'WaitingList' }, alder: 609 },
  ])
  {
    const kun1 = await soegGrupperet(filtreFraParametre({ postnr: '6100', overtagelse: 'nu' }), 48, nu)
    const kun2 = await soegGrupperet(filtreFraParametre({ postnr: '6100', venteliste: '1' }), 48, nu)
    const begge = filtreFraParametre({ postnr: '6100', overtagelse: 'nu', venteliste: '1' })
    const b = await soegGrupperet(begge, 48, nu)
    const sb = await opsummering(begge, nu)
    tjek('10B · hvert filter for sig giver gruppen', kun1.kortIAlt === 1 && kun2.kortIAlt === 1)
    tjek('10B · begge filtre giver INTET — ingen bolig opfylder hele søgningen',
      b.kortIAlt === 0 && b.visninger.length === 0, `${b.kortIAlt} kort`)
    tjek('10B · og optællingen er også nul', sb.antal === 0)
    tjek('10B · facit er enig', facit(begge, nu).kort === 0 && facit(begge, nu).boliger === 0)
  }

  // 10C · Ukendt status bliver ikke et positivt match.
  console.log('\n══ 10C · ukendt status ved siden af en matchende ══')
  await saa([
    { navn: 'uk-res', vej: 'Ukendtvej', husnr: '1', postnr: '6200', by: 'Prøveby',
      vaerelser: 2, leje: 1_000_000, fakta: { rawStatus: 'Reserveret' }, alder: 620 },
    { navn: 'uk-ukendt', vej: 'Ukendtvej', husnr: '2', postnr: '6200', by: 'Prøveby',
      vaerelser: 2, leje: 1_050_000, fakta: {}, alder: 619 },
  ])
  {
    const f = filtreFraParametre({ postnr: '6200', reserveret: '1' })
    const g = await soegGrupperet(f, 48, nu)
    const s = await opsummering(f, nu)
    const v = g.visninger[0]
    tjek('10C · den ukendte tæller IKKE som match', s.antal === 1 && facit(f, nu).boliger === 1)
    if (v?.slags === 'gruppe') {
      const gr = v.gruppe
      tjek('10C · matchende er 1 af 2', gr.matchende === 1 && gr.antal === 2)
      tjek('10C · markedsstatus: én reserveret, én ukendt',
        gr.availability.marked.reserveret === 1 && gr.availability.marked.unknown === 1)
      const t = kortTekst(createElement(Gruppekort, { g: gr, nu }))
      tjek('10C · kortet siger det', t.includes('1 af 2 boliger matcher din søgning'))
      tjek('10C · og mærkatet «reserveret» står IKKE, fordi det ikke gælder alle',
        !t.includes('reserveret Sonde') && t.includes('1 af 2 reserveret'))
    }
  }

  // 10D · Er hele gruppen med, skal linjen IKKE stå.
  console.log('\n══ 10D · en gruppe hvor alle matcher ══')
  await saa([
    { navn: 'alle-1', vej: 'Allevej', husnr: '1', postnr: '6300', by: 'Prøveby',
      vaerelser: 2, leje: 1_000_000, fakta: { sourceAvailabilityDate: FORTID }, alder: 630 },
    { navn: 'alle-2', vej: 'Allevej', husnr: '2', postnr: '6300', by: 'Prøveby',
      vaerelser: 2, leje: 1_100_000, fakta: { sourceAvailabilityDate: FORTID }, alder: 629 },
  ])
  {
    const f = filtreFraParametre({ postnr: '6300', overtagelse: 'nu' })
    const g = await soegGrupperet(f, 48, nu)
    const v = g.visninger[0]
    if (v?.slags === 'gruppe') {
      const t = kortTekst(createElement(Gruppekort, { g: v.gruppe, nu }))
      tjek('10D · matchende == antal', v.gruppe.matchende === 2 && v.gruppe.antal === 2)
      tjek('10D · ingen forbeholdslinje, når intet er blandet',
        !t.includes('matcher din søgning'), t.slice(0, 120))
      tjek('10D · og linket siger «de», ikke «alle»', t.includes('Se de 2 adresser'))
    }
    // Uden domænefilter stilles spørgsmålet slet ikke.
    const uden = await soegGrupperet(filtreFraParametre({ postnr: '6300' }), 48, nu)
    const u = uden.visninger[0]
    tjek('10D · uden domænefilter er matchende null — spørgsmålet er ikke stillet',
      u?.slags === 'gruppe' && u.gruppe.matchende === null)
    if (u?.slags === 'gruppe') {
      tjek('10D · og kortet nævner det ikke',
        !kortTekst(createElement(Gruppekort, { g: u.gruppe, nu })).includes('matcher din søgning'))
    }
  }

  // ═══ 11 · Partigennemgangen ═══
  //
  // En partistoerrelse er en ARBEJDSGRAENSE, ikke et katalogloft. Foer
  // stoppede soegningen ved loftet og skrev «mindst N»; nu gennemgaas
  // kandidaterne i partier, indtil de slipper op.
  console.log('\n══ 11 · partigennemgangen naar hele udbuddet ══')
  {
    const f = filtreFraParametre({ postnr: '2000', overtagelse: 'nu' })   // 55 matchende kort
    // Partistoerrelsen maa ikke aendre svaret. `MAKS_PARTIER` haeves
    // eksplicit, saa vaernet mod en uendelig loekke ikke forveksles med
    // partistoerrelsen: 55 kandidater i partier a 1 kraever 56 runder.
    for (const parti of [1000, 55, 20, 7, 1]) {
      _saetGruppeloft(parti, 1000)
      const g = await soegGrupperet(f, 48, nu, 1)
      tjek(`11 · parti=${parti}: alle 55 findes, og svaret er komplet`,
        g.kortIAlt === 55 && g.komplet === true && g.visninger.length === 48,
        `kortIAlt=${g.kortIAlt} komplet=${g.komplet}`)
    }
    _saetGruppeloft(null)
  }

  // 11B · DEN VIGTIGSTE: intet match i foerste parti, match senere.
  console.log('\n══ 11B · intet match i foerste parti, match senere ══')
  {
    // 60 «Støjvej» i 1000 matcher ikke; 6 «Guldvej» gør, og de er ældst.
    const f = filtreFraParametre({ postnr: '1000', overtagelse: 'nu' })
    for (const parti of [10, 30, 61]) {
      _saetGruppeloft(parti)
      const g = await soegGrupperet(f, 48, nu, 1)
      const s = await opsummering(f, nu)
      tjek(`11B · parti=${parti}: de seks bag de 60 er naabare`,
        g.kortIAlt === 6 && g.visninger.length === 6 && g.komplet === true && s.antal === 6,
        `kortIAlt=${g.kortIAlt} vist=${g.visninger.length} komplet=${g.komplet}`)
    }
    _saetGruppeloft(null)
  }

  // 11C · Bliver gennemgangen AFBRUDT, maa den ikke se komplet ud.
  console.log('\n══ 11C · afbrudt gennemgang er ikke et komplet svar ══')
  {
    const f = filtreFraParametre({ postnr: '1000', overtagelse: 'nu' })
    // Parti 10, hoejst 2 partier = 20 kandidater af 66. De 60 foerste
    // matcher ikke, saa der findes intet — men vi VED det ikke.
    _saetGruppeloft(10, 2)
    const g = await soegGrupperet(f, 48, nu, 1)
    tjek('11C · afbrudt: nul kort, men komplet er FALSK',
      g.kortIAlt === 0 && g.komplet === false)
    tjek('11C · et afbrudt nul er ikke et sikkert nulresultat — optællingen er uafkortet',
      (await opsummering(f, nu)).antal === 6)
    // Halvvejs: 9 x 7 = 63 kandidater af 66. De 60 foerste matcher ikke,
    // saa netop 3 af de 6 er naaet — og gennemgangen er afbrudt midt i
    // dem. Tallet er sandt saa langt vi kom, og maa ikke se komplet ud.
    _saetGruppeloft(9, 7)
    const halv = await soegGrupperet(f, 48, nu, 1)
    tjek('11C · delvis gennemgang: fundet noget, men komplet er stadig FALSK',
      halv.kortIAlt > 0 && halv.kortIAlt < 6 && halv.komplet === false,
      `kortIAlt=${halv.kortIAlt}`)
    _saetGruppeloft(null)
  }

  // 11D · Aegte nul ved fuldt gennemgaaet saet.
  console.log('\n══ 11D · ægte nul ved fuldt gennemgået sæt ══')
  {
    const f = filtreFraParametre({ postnr: '1000', venteliste: '1' })
    const g = await soegGrupperet(f, 48, nu, 1)
    tjek('11D · nul OG komplet — «Ingen boliger matcher» må stå',
      g.kortIAlt === 0 && g.komplet === true && (await opsummering(f, nu)).antal === 0)
  }

  // ═══ 12 · Paginering ═══
  console.log('\n══ 12 · alle sider gennemløbes uden mangler eller gentagelser ══')
  for (const sorter of ['nyeste', 'pris_op', 'pris_ned', 'areal_ned',
    'indflytning_op', 'indflytning_ned'] as const) {
    for (const [navn, sp] of [
      ['uden domænefilter', { sorter }],
      ['med domænefilter', { sorter, overtagelse: 'senere' }],
    ] as [string, Record<string, string>][]) {
      const f = filtreFraParametre(sp)
      const set = new Set<string>()
      let raekker = 0; let ialt = 0; let sider = 0
      for (let side = 1; side <= 60; side++) {
        const g = await soegGrupperet(f, 48, nu, side)
        ialt = g.kortIAlt
        if (g.visninger.length === 0) break
        sider++
        tjek0(g.visninger.length <= 48)
        for (const v of g.visninger) {
          set.add(v.slags === 'gruppe' ? v.gruppe.repraesentant.id : v.bolig.id)
          raekker++
        }
      }
      tjek(`12 · ${sorter} ${navn}: ${ialt} kort, ${sider} sider`,
        raekker === ialt && set.size === ialt,
        `raekker=${raekker} unikke=${set.size} kortIAlt=${ialt}`)
    }
  }
  tjek('12 · og ingen side viste mere end 48 kort', forStore === 0, `${forStore} for store`)

  console.log('\n══ 12B · sidetal: gyldige og ugyldige ══')
  {
    const f = filtreFraParametre({ postnr: '2000' })
    const s1 = await soegGrupperet(f, 48, nu, 1)
    const s2 = await soegGrupperet(f, 48, nu, 2)
    const id = (g: Awaited<ReturnType<typeof soegGrupperet>>) =>
      g.visninger[0] && (g.visninger[0].slags === 'gruppe'
        ? g.visninger[0].gruppe.repraesentant.id : g.visninger[0].bolig.id)
    tjek('12B · side 2 er et andet udsnit end side 1', id(s1) !== id(s2))
    tjek('12B · side 1 og 2 overlapper ikke',
      s1.visninger.length === 48 && s2.visninger.length === 7)
    // Uden for raekkevidde: tomt udsnit, men totalen staar fast.
    const s9 = await soegGrupperet(f, 48, nu, 9)
    tjek('12B · side uden for rækkevidde: tomt udsnit, total uændret',
      s9.visninger.length === 0 && s9.kortIAlt === s1.kortIAlt && s9.kortIAlt === 55)
    tjek('12B · og det er IKKE et nulresultat',
      (await opsummering(f, nu)).antal > 0)
  }

  console.log('\n══ 12C · en gruppe deles ikke mellem sider ══')
  {
    // Blandetvej i 3000 er én gruppe paa fem. Uanset sidestoerrelse maa
    // den staa helt paa én side — grupperingen sker i SQL, saa et vindue
    // kan kun ramme hele grupperaekker.
    const f = filtreFraParametre({})
    const set = new Map<string, number>()
    for (let side = 1; side <= 60; side++) {
      const g = await soegGrupperet(f, 5, nu, side)
      if (g.visninger.length === 0) break
      for (const v of g.visninger) {
        if (v.slags !== 'gruppe') continue
        const k = v.gruppe.repraesentant.id
        set.set(k, (set.get(k) ?? 0) + 1)
        tjek0(v.gruppe.antal >= 2)
      }
    }
    tjek('12C · hvert gruppekort optræder præcis én gang',
      [...set.values()].every((n) => n === 1), `${set.size} gruppekort`)
  }

  console.log('\n══ 12D · side er navigation, ikke et filter ══')
  {
    const medSide = { postnr: '2300', side: '3' }
    const uden = { postnr: '2300' }
    tjek('12D · side når ikke Filtre',
      JSON.stringify(filtreFraParametre(medSide)) === JSON.stringify(filtreFraParametre(uden)))
    tjek('12D · ?side=2 alene gør ikke forsiden til en søgning',
      harFiltre(filtreFraParametre({ side: '2' })) === false)
    tjek('12D · side ændrer ikke antal_filtre',
      antalFiltre(filtreFraParametre(medSide)) === antalFiltre(filtreFraParametre(uden)))
    const kender = () => true
    tjek('12D · et sideskift giver ingen filterevents',
      filterDiff(filtreFraParametre(uden), filtreFraParametre(medSide), kender).length === 0
      && filterDiff(filtreFraParametre(medSide), filtreFraParametre(uden), kender).length === 0)
    tjek('12D · ?side i Referer giver heller ingen',
      filterDiff(
        forrigeFiltre('https://bofinda.dk/?postnr=2300&side=5', 'https://bofinda.dk',
          filtreFraParametre),
        filtreFraParametre(uden), kender).length === 0)
    // Gem-formularen sender `JSON.stringify(filtreFraParametre(sp))`, saa
    // et felt, `filtreFraParametre` ikke laeser, kan ikke naa en alarm.
    tjek('12D · side kan ikke havne i en boligalarms kriterier',
      !JSON.stringify(filtreFraParametre({ ...medSide, sorter: 'pris_op' })).includes('side'))
  }

  console.log('\n══ 12E · pagineringens adresser ══')
  {
    const sp = { by: 'København S', type: ['hus', 'raekkehus'], kort: '0', flere: '1', side: '4' }
    const u2 = sideUrl('/', sp, 2)
    tjek('12E · alle parametre bevares, også flerværdi',
      u2.includes('by=K') && (u2.match(/type=/g) ?? []).length === 2
      && u2.includes('kort=0') && u2.includes('flere=1'), u2)
    tjek('12E · den gamle side udskiftes, ikke tilføjes',
      (u2.match(/side=/g) ?? []).length === 1 && u2.includes('side=2'))
    tjek('12E · side 1 udelader parameteren helt',
      !sideUrl('/', sp, 1).includes('side='), sideUrl('/', sp, 1))
    tjek('12E · områdesidens basis bevares',
      sideUrl('/lejeboliger/2300', {}, 3) === '/lejeboliger/2300?side=3')
    tjek('12E · og side 1 dér er den bare slug',
      sideUrl('/lejeboliger/2300', {}, 1) === '/lejeboliger/2300')
    // Vinduet
    tjek('12E · faa sider vises alle', JSON.stringify(sidevindue(3, 5)) === '[1,2,3,4,5]')
    const v = sidevindue(10, 21)
    tjek('12E · mange sider giver et kompakt vindue med huller',
      v[0] === 1 && v[v.length - 1] === 21 && v.includes(null) && v.includes(10),
      JSON.stringify(v))
    tjek('12E · den aktuelle side er altid med',
      [1, 2, 5, 11, 20, 21].every((n) => sidevindue(n, 21).includes(n)))
  }

  console.log('\n══ 12F · filtre anvendes før sideudsnittet ══')
  {
    // 55 matchende i 2000 bag 60 ikke-matchende i 1000. Side 2 af det
    // filtrerede saet maa vaere matchende kort 49-55, ikke «de naeste 48
    // raekker efter de foerste 48 ufiltrerede».
    const f = filtreFraParametre({ overtagelse: 'nu' })
    const alle = new Set<string>()
    for (let side = 1; side <= 20; side++) {
      const g = await soegGrupperet(f, 48, nu, side)
      if (!g.visninger.length) break
      for (const v of g.visninger) {
        const b = v.slags === 'gruppe' ? v.gruppe.repraesentant : v.bolig
        alle.add(b.id)
        // Hvert eneste viste kort SKAL have mindst ét matchende medlem.
        if (v.slags === 'gruppe') tjek0((v.gruppe.matchende ?? 0) > 0)
      }
    }
    const facitKort = facit(f, nu).kort
    tjek('12F · alle sider tilsammen = præcis det filtrerede sæt',
      alle.size === facitKort, `${alle.size} = ${facitKort}`)
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
