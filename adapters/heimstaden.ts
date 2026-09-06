// ═══════════════════════════════════════════════════════════════
//  Heimstaden — https://www.heimstaden.dk/ledige-lejeboliger/
//
//  INGEN aftale endnu — kilden hentes efter robots.txt, som tillader
//  baade listesiden og /lejebolig/-detaljesiderne (kun /wp-admin/,
//  /api/, /forms/ og /*clean=true er forbudt, maalt 2026-09-06).
//  Rentals-SITEMAPPET ligger under /api/feed/ og er robots-forbudt,
//  selv om sitemap-indekset annoncerer det — det bruges IKKE.
//
//  ── Om kilden ────────────────────────────────────────────────
//  WordPress-site paa Unik Bolig-backend. Listesiden streamer hele
//  udbuddet som `var _rentals = [...]` — ét GET-kald, ~200 enheder,
//  alle med kildens egen `Status: "Klar til udlejning"`. Detaljesiden
//  er serverrenderet og baerer det, listen ikke har: A/C-poster,
//  depositum- og forudbetalt-BELOEB, kildens egen «Indflytningspris»
//  og galleriet. Derfor spider, ikke feed.
//
//  ── home.dk-reglen: naboer paa detaljesiden ──────────────────
//  Detaljesiden indeholder KORT FOR ANDRE BOLIGER (naboejendomme med
//  egne adresser, lejer og billeder). Alt fra detaljesiden parses
//  derfor BUNDET: oekonomien kun i udsnittet fra «<h3>Økonomi</h3>»
//  til galleriet/facilities-blokken, billederne kun fra galleriets
//  `swiper-slide slide-image` (naboernes billeder staar i andre
//  containere, plantegningen i `slide-plan` og holdes ude som hos
//  home.dk). Proeven beviser naboimmuniteten.
//
//  ── Hvad kilden IKKE oplyser / vi bevidst ikke tager ─────────
//  `Faciliteter`-listen er EJENDOMS-niveau («Ja, i nogle typer») og
//  ville paastaa noget om det enkelte lejemaal, kilden ikke siger —
//  kun de enheds-bundne `facilities`-booleans bruges. `BoligagentOnly`
//  (alle false maalt) og aabent hus-arrangementer hoestes ikke endnu.
//  Boligtype findes ikke i payloaden ud over UnikType Studiebolig/
//  Ungdomsbolig; resten staar uden type frem for et gaet.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere, parseDanskBeloebTilOere } from '../lib/money'

const BASE = 'https://www.heimstaden.dk'
const LISTE = `${BASE}/ledige-lejeboliger/`

/** Eneste billedvaert — baade listens `image` og detaljesidens galleri
 *  (talt paa alle 618 grundlags-URL'er ved kortlaegningen og 19 paa
 *  detaljesiden). Skal staa i TILLADTE_VAERTER. */
const BILLEDVAERT = 'boligspot.b-cdn.net'

export type Ukendt = Record<string, unknown>
const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
const objekt = (v: unknown): Ukendt =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Ukendt : {}

/** Kildens visningsdato «01-11-2026» → kalenderdag. LedigPrDato er
 *  autoritativ: den ER hvad kilden viser, og `availableDate`-tidsstemplet
 *  bekraeftede den 138 af 138 ved kortlaegningen. */
const dagFraDDMMYYYY = (s: string) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s)
  return m ? isoDato(`${m[3]}-${m[2]}-${m[1]}`) : null
}

/**
 * Ét element fra `var _rentals` → grundlaget for en RawListing.
 * Oekonomien ud over lejen og galleriet kommer fra detaljesiden.
 *
 * Eksporteret KUN til proeven.
 */
export function laesListe(r: Ukendt): RawListing | null {
  const noegle = tekst(r['LejemaalNr'])
  const slug = tekst(r['slug'])
  const vej = tekst(r['Adresse1'])
  const postnr = tekst(r['PostNr'])
  if (!noegle || !slug || !vej) return null

  const koord = objekt(r['coordinates'])
  const fac = objekt(r['facilities'])
  const unikType = tekst(r['UnikType'])
  const ledig = tekst(r['LedigPrDato'])

  const faciliteter: string[] = []
  if (fac['petsAllowed'] === true) faciliteter.push('kæledyr tilladt')
  if (fac['studyHousing'] === true) faciliteter.push('studiebolig')
  if (fac['seniorFriendly'] === true) faciliteter.push('seniorbolig')

  // «Ledig nu» og datoen udelukker hinanden i feltet — samme moenster
  // som Dacas' «Snarest», og de to veje kan ikke dobbelt-taelle.
  const dato = ledig && ledig !== 'Ledig nu' ? dagFraDDMMYYYY(ledig) : null

  const billedUrl = tekst(objekt(objekt(r['image'])['urls'])['full'])

  return {
    // Unik Bolig-lejemaalsnummeret ("9-552-23"): stabilt; slug'en kan
    // aendres med adressen.
    externalKey: noegle,
    sourceUrl: `${BASE}/lejebolig/${slug}/`,
    address: [vej, [postnr, tekst(r['ByNavn'])].filter(Boolean).join(' ')]
      .filter(Boolean).join(', '),
    postalCode: postnr,
    sizeM2: tal(r['Areal']),
    rooms: tal(r['Rum']),
    propertyType: unikType === 'Studiebolig' || unikType === 'Ungdomsbolig'
      ? 'studiebolig'
      : undefined,
    rentMonthly: tal(r['Leje']) != null ? kronerTilOere(tal(r['Leje'])!) : undefined,
    lat: tal(koord['latitude']),
    lng: tal(koord['longitude']),
    amenities: faciliteter,
    availableFrom: dato ?? undefined,
    // Listens hovedbillede — erstattes af galleriet, naar detaljesiden
    // giver et. Ingen pladsholder: mangler begge, er listen tom.
    imageUrls: billedUrl && URL.canParse(billedUrl)
      && new URL(billedUrl).host === BILLEDVAERT ? [billedUrl] : [],
    availability: {
      rawStatus: tekst(r['Status']) ?? null,
      ...(dato ? { sourceAvailabilityDate: dato } : {}),
      ...(ledig === 'Ledig nu' ? { takeoverText: ledig } : {}),
    },
  }
}

/** Hvad detaljesiden laegger til. */
export interface Detalje {
  utilitiesHeat?: number
  utilitiesWater?: number
  utilitiesElectricity?: number
  utilitiesOther?: number
  moveInCost?: number
  deposit?: number
  prepaidRent?: number
  imageUrls: string[]
}

const RAEKKE = /<label[^>]*>([^<]+)<\/label>\s*<span[^>]*>([^<]+)<\/span>/g
const GALLERI = /<div class="swiper-slide slide-image">\s*<img[^>]+src="([^"]+)"/g

/**
 * Detaljesidens EGNE tal — bundet til udsnit, aldrig hele siden,
 * fordi naboboligernes kort ellers smitter (home.dk-reglen).
 *
 * Eksporteret KUN til proeven.
 */
export function laesDetalje(html: string): Detalje {
  const ud: Detalje = { imageUrls: [] }

  // Oekonomiblokken: fra overskriften til naeste sektionsskel.
  const fra = html.indexOf('<h3>Økonomi</h3>')
  if (fra >= 0) {
    const efter = html.slice(fra)
    const til = efter.search(/class="(facilities|row)"/)
    const blok = til > 0 ? efter.slice(0, til) : efter
    // Ukendte A/C-poster samles i "other" — det er stadig aconto,
    // kilden opkraever, og at tabe dem ville goere totalen for lav.
    let andet: number | undefined
    for (const m of blok.matchAll(RAEKKE)) {
      const navn = m[1]!.trim()
      const beloeb = parseDanskBeloebTilOere(m[2])
      if (beloeb == null) continue
      if (/^A\/C varme/i.test(navn)) ud.utilitiesHeat = beloeb
      else if (/^A\/C vand/i.test(navn)) ud.utilitiesWater = beloeb
      else if (/^A\/C el/i.test(navn)) ud.utilitiesElectricity = beloeb
      else if (/^A\/C /i.test(navn)) andet = (andet ?? 0) + beloeb
      else if (/^- Depositum/i.test(navn)) ud.deposit = beloeb
      else if (/^- Forudbetalt leje/i.test(navn)) ud.prepaidRent = beloeb
      // «Husleje (pr. md.)» laeses IKKE her — lejen kommer fra listen,
      // og to kilder til samme tal ville kunne gaa hver sin vej stille.
    }
    if (andet != null) ud.utilitiesOther = andet

    // «Indflytningspris» staar IKKE som label/span-raekke: dens label
    // indeholder selv et <span> (og et svg-ikon), saa raekke-regexen
    // rammer forbi. Kildens eget sumtal ankres i stedet paa moveinToggle.
    const mi = /id="moveinToggle"[\s\S]*?<\/label>\s*<span[^>]*>([^<]+)</.exec(blok)
    const miBeloeb = mi ? parseDanskBeloebTilOere(mi[1]) : null
    if (miBeloeb != null) ud.moveInCost = miBeloeb
  }

  // Galleriet: kun `slide-image`. Plantegningen (`slide-plan`) holdes
  // ude, og naboernes billeder staar slet ikke i galleri-slides.
  const set = new Set<string>()
  for (const m of html.matchAll(GALLERI)) {
    const u = m[1]!
    try { if (new URL(u).host === BILLEDVAERT) set.add(u) } catch { /* ugyldig URL */ }
  }
  ud.imageUrls = [...set]
  return ud
}

/** Loftet over detaljehentninger pr. koersel, naar intet andet er sat. */
export const STANDARD_DETALJEBUDGET = 25

/**
 * `HEIMSTADEN_DETALJEBUDGET` — env-overstyring til KONTROLLEREDE proever.
 *
 * Kun denne kilde. Variablen er navngivet efter kilden med vilje: et
 * faelles `DETALJEBUDGET` ville skrue ned for alle kilder paa én gang,
 * og det er aldrig det, nogen mener, naar de vil proeve én ting af.
 *
 * ALT, DER IKKE ER ET HELT IKKE-NEGATIVT TAL, AFVISES. Grunden er
 * konkret: budgettet bruges som `skalHentes.splice(budget)`, og JavaScript
 * laeser et negativt tal dér som «fra enden» — `splice(-1)` ville fjerne
 * ÉN post fra koeen og hente alle de oevrige. En tastefejl som `-1` ville
 * altsaa betyde naesten-fuld crawl mod en vaert, der droevler os. Derfor
 * falder vi tilbage paa standarden og siger det hoejt.
 *
 * `0` er derimod en gyldig vaerdi: ingen detaljehentninger, ren discovery.
 * Den er sikker — den kan kun goere koerslen mindre, aldrig stoerre.
 */
export function laesDetaljeBudget(raa: string | undefined): {
  budget: number
  /** Sat, naar vaerdien blev ignoreret. Teksten forklarer hvorfor. */
  afvist?: string
} {
  if (raa == null || raa.trim() === '') return { budget: STANDARD_DETALJEBUDGET }
  const t = raa.trim()
  // Kun cifre: afviser «-1», «2.5», «1e9», «Infinity», «tre» og « ».
  if (!/^\d+$/.test(t)) {
    return {
      budget: STANDARD_DETALJEBUDGET,
      afvist: `«${t}» er ikke et helt, ikke-negativt tal`,
    }
  }
  const n = Number(t)
  if (!Number.isSafeInteger(n)) {
    return { budget: STANDARD_DETALJEBUDGET, afvist: `«${t}» er for stort` }
  }
  return { budget: n }
}

/** Sagt én gang pr. proces. En advarsel pr. koersel ville drukne i loggen. */
let budgetAdvaret = false
/** KUN til proeven. */
export const _nulstilBudgetAdvarsel = () => { budgetAdvaret = false }

function detaljeBudget(): number {
  const { budget, afvist } = laesDetaljeBudget(process.env.HEIMSTADEN_DETALJEBUDGET)
  if (afvist && !budgetAdvaret) {
    budgetAdvaret = true
    console.warn(`[heimstaden] HEIMSTADEN_DETALJEBUDGET IGNORERET: ${afvist}. `
      + `Bruger standarden ${STANDARD_DETALJEBUDGET}.`)
  }
  return budget
}

/** Fingeraftrykket af de listefelter, der skal udloese en ny
 *  detaljehentning: status, overtagelse (dato eller «Ledig nu») og leje.
 *  Areal/vaerelser/adresse aendrer sig ikke for et lejemaalsnummer uden
 *  at noget af de tre ogsaa goer det. Eksporteret KUN til proeven. */
export function detaljesignatur(b: RawListing): string {
  return JSON.stringify([
    b.availability?.rawStatus ?? null,
    b.availability?.sourceAvailabilityDate ?? b.availability?.takeoverText ?? null,
    b.rentMonthly ?? null,
  ])
}

export function heimstadenAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  return {
    id: 'heimstaden',
    sourceType: 'spider',
    host: 'www.heimstaden.dk',

    // Detaljevagten: kildens CDN droevler vedvarende crawl (maalt
    // 2026-09-06 — 503 paa alt efter ~17 min ved 1 kald/s). Listen alene
    // baerer status, dato, leje, adresse og ét billede, saa langt de
    // fleste koersler behoever slet ingen detaljehentninger.
    // Laeses ved HVER koersel, ikke ved modulindlaesning: en kontrolleret
    // proeve skal kunne saette den uden at bygge om.
    get detaljeBudgetPrKoersel() { return detaljeBudget() },
    listeGrundlag(url: string) {
      const grundlag = cache.get(url)
      return grundlag ? { grundlag, detaljesignatur: detaljesignatur(grundlag) } : null
    },

    async discover(): Promise<DiscoveredListing[]> {
      cache.clear()
      const res = await politeFetch(LISTE)
      if (!res.ok) throw new Error(`heimstaden ${LISTE} gav ${res.status}`)
      const html = await res.text()

      const m = /var _rentals\s*=\s*(\[[\s\S]*?\]);/.exec(html)
      if (!m) throw new Error('heimstaden: `var _rentals` ikke fundet — har sitet aendret form?')
      let raa: unknown
      try { raa = JSON.parse(m[1]!) } catch {
        throw new Error('heimstaden: `var _rentals` kunne ikke parses')
      }

      const ud: DiscoveredListing[] = []
      const set = new Set<string>()
      for (const r of Array.isArray(raa) ? raa : []) {
        const b = laesListe(objekt(r))
        if (!b || set.has(b.externalKey)) continue
        set.add(b.externalKey)
        cache.set(b.sourceUrl, b)
        ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const grund = cache.get(url)
      if (!grund) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)

      const res = await politeFetch(url)
      if (!res.ok) throw new Error(`heimstaden ${url} gav ${res.status}`)
      const d = laesDetalje(await res.text())

      return {
        ...grund,
        ...(d.utilitiesHeat != null ? { utilitiesHeat: d.utilitiesHeat } : {}),
        ...(d.utilitiesWater != null ? { utilitiesWater: d.utilitiesWater } : {}),
        ...(d.utilitiesElectricity != null ? { utilitiesElectricity: d.utilitiesElectricity } : {}),
        ...(d.utilitiesOther != null ? { utilitiesOther: d.utilitiesOther } : {}),
        ...(d.moveInCost != null ? { moveInCost: d.moveInCost } : {}),
        ...(d.deposit != null ? { deposit: d.deposit } : {}),
        ...(d.prepaidRent != null ? { prepaidRent: d.prepaidRent } : {}),
        ...(d.imageUrls.length ? { imageUrls: d.imageUrls } : {}),
      }
    },
  }
}
