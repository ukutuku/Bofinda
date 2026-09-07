// ═══════════════════════════════════════════════════════════════
//  CEJ — https://udlejning.cej.dk/find-bolig/overblik
//
//  Mundtlig tilladelse pr. telefon, se docs/kildetilladelser.md.
//  Omfangskolonnen skal vaere udfyldt, foer kilden slaas til i drift.
//
//  ── Om kilden ────────────────────────────────────────────────
//  White-label paa platformen bolig.io (Remix). Hele udbuddet streames
//  inline i HTML'en som `__remixContext.r('routes/search/layout',
//  'searchResponse', {...})` — ingen JS-koersel, ingen noegle, to GET-kald
//  (32 pr. side, `?offset=`). Payloadens egen `pages`-liste er kildens
//  sideliste; vi foelger den og opfinder ikke vores egen pagination.
//
//  `udlejning.cej.dk/robots.txt` svarer 404 — der ER ingen robots-regler
//  paa subdomaenet (maalt 2026-09-06). Hovedsitet cej.dk forbyder kun
//  /wp-json/. Vi henter efter rettighedshaverens egen tilladelse.
//
//  ── PERSONDATA — grunden til formen paa denne fil ────────────
//  Kildens offentlige payload indeholder personoplysninger, der IKKE
//  vedkommer boligannoncen: `tenant` (NUVAERENDE lejers navn og private
//  e-mail — maalt paa 24 af 63), `reservation.lead` (boligsoegendes navn,
//  e-mail og telefon — 27 af 63), `contacts` og `assignees` (medarbejdere)
//  og `event` (fremvisninger med tilmelding).
//
//  Derfor er `laes()` en EKSPLICIT ALLOWLIST: hvert felt plukkes ved navn,
//  og raa items spredes, gemmes, returneres eller logges ALDRIG — heller
//  ikke "midlertidigt til fejlsoegning". Reglen bevises af persondata-
//  proeven i scripts/test-redigering.ts, som fejler, hvis et opdigtet navn,
//  en e-mail eller et telefonnummer fra fixturen overlever laes(),
//  normaliseringen, databasen eller konsollen.
//
//  Lejemaalsforholdene om den NUVAERENDE lejer (vacatingAt, liableUntil,
//  terminationNoticeDate) hoerer til samme kategori og hoestes ikke.
//
//  ── Hvad kilden ellers har, som vi bevidst IKKE tager ────────
//  `disableLeads` (om lead-formularen er aaben — uafklaret semantik),
//  `event` (tilmeldingskraevende fremvisning, ikke aabent hus),
//  `media.floorPlan` (plantegninger holdes ude, samme valg som home.dk),
//  `rentalPeriod` ("unlimited" paa alle 63 — ingen skelnen at gemme),
//  `energyLabel`/`yearBuilt` (ingen kolonner; tages op, hvis modellen
//  faar dem). UI'ets «Ledig: Snarest» er skabelontekst uanset dato og
//  hoestes ikke som takeoverText — se kontrakten i lib/kildekontrakt.ts.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'

const BASE = 'https://udlejning.cej.dk'
const OVERSIGT = `${BASE}/find-bolig/overblik`

/** Eneste billedvaert i payloaden — 618 af 618 URL'er maalt 2026-09-06.
 *  TAEL distinkte vaerter ved genbesoeg; find ikke bare den foerste
 *  (home.dk-reglen i CLAUDE.md). Skal staa i TILLADTE_VAERTER. */
const BILLEDVAERT = 'boligio-media-production.s3.eu-central-1.amazonaws.com'

/** Loft over sider, saa en defekt `pages`-liste ikke bliver en stormflod.
 *  63 boliger = 2 sider; 30 giver plads til det tidobbelte. */
const MAKS_SIDER = 30

/**
 * Kildens eget billedforbehold, skrevet af boligadministratoren i
 * beskrivelsen i mange varianter — «Billederne i denne annonce er ikke
 * noedvendigvis fra den paagaeldende bolig», «Billederne er ikke fra det
 * praecise lejemaal», «... fra denne lejlighed, men en tilsvarende» osv.
 * Faellesnaevneren er billeder…ikke…fra den/denne/det. Maalt: 18 af 63,
 * inkl. alle med «AI-redigerede»-saetningen (den staar aldrig alene).
 * Saetningen alene om AI-redigering udloeser IKKE forbeholdet — den
 * paastaar ikke, at billederne er fra en anden bolig.
 */
const FORBEHOLD = /billeder\w*[^.]{0,60}?ikke[^.]{0,60}?fra\s+(den|denne|det)\b/i

/** Kildens engelske amenity-/appliance-tags → vores ord. Ordene staar paa
 *  boligsiden og skal derfor vaere dansk. `balconyOrTerrace` skelner ikke
 *  mellem altan og terrasse, saa ordet goer det heller ikke — at vaelge det
 *  ene ville vaere et gaet. */
const FACILITETSORD: Record<string, string> = {
  elevator: 'elevator',
  petsAllowed: 'kæledyr tilladt',
  balconyOrTerrace: 'altan eller terrasse',
  parking: 'parkering',
  courtyard: 'gårdhave',
  storage: 'depotrum',
  bicycle: 'cykelparkering',
  sharedLaundry: 'fællesvaskeri',
  sharing: 'delebolig',
  senior: 'seniorbolig',
  student: 'studiebolig',
  youth: 'ungdomsbolig',
  dishwasher: 'opvaskemaskine',
  washingMachine: 'vaskemaskine',
  dryer: 'tørretumbler',
  washerDryer: 'vaskemaskine', // kombimaskine: vasker OG toerrer
  oven: 'ovn',
  cookingPlate: 'kogeplade',
  exhaustHood: 'emhætte',
  fridgeFreezer: 'køle-/fryseskab',
  stove: 'komfur',
  fridge: 'køleskab',
  freezer: 'fryser',
}

export type Ukendt = Record<string, unknown>
const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
/** Kilden regner i hele kroner (price.amount: 16500 = 16.500 kr./md.,
 *  efterproevet mod detaljesidens «Foerste maaneds husleje»). */
const oere = (v: unknown): number | undefined => {
  const n = tal(v)
  return n == null ? undefined : kronerTilOere(n)
}
const objekt = (v: unknown): Ukendt =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Ukendt : {}

/**
 * Kilden serverer den SAMME searchResponse i to Remix-former, og valget
 * mellem dem er ikke vores. Maalt paa to svar fra samme URL med minutters
 * mellemrum — samme build (43 identiske byggeaktiver), samme payload
 * (byte-identisk JSON, samme sha256), 162 tegns forskel i indpakningen:
 *
 *   streamet   "searchResponse":__remixContext.n("…","searchResponse")
 *              …senere: <script>__remixContext.r("…","searchResponse",{…})</script>
 *   inlinet    "searchResponse":__remixContext.p({…})
 *
 * `.n()` er en ventende promise, `.r()` indfrier den, `.p()` er en
 * allerede indfriet vaerdi skrevet direkte ind. Var promiset indfriet i
 * Remix' egen bogfoering, da hydreringsscriptet blev skrevet, faar man
 * `.p()`, og der kommer ALDRIG et `.r()`-kald. Den gren stod for tre
 * fejlede koersler den 7. sep. 2026 (~23 % af kildens koersler), fordi
 * denne funktion kun kendte `.r()`. HTTP var 200 hver gang, og payloaden
 * var intakt — det var laesningen, der manglede en form.
 *
 * ── Hvorfor der ankres paa noeglen og ikke paa ordet ──────────
 * BEGGE dokumenter baerer i basiskonteksten en TOM pladsholder:
 *
 *   "routes/search/layout":{"searchResponse":{},"pageSize":32}
 *
 * En parser, der leder efter `"searchResponse"` og brace-matcher naeste
 * `{`, rammer den — i begge varianter — og faar `{}`. Saa er `items`
 * undefined og `pages` undefined, og en tavs tom import har afloest en
 * hoejlydt fejl. Derfor kraeves det, at noeglen er umiddelbart efterfulgt
 * af selve mekanismen, og at vaerdipladsen ER et objekt: baade `.p()` og
 * `.r()` har en fejlgren, hvor der staar noget andet end et objekt dér.
 *
 * Kan en gyldig searchResponse ikke udledes sikkert, returneres null, og
 * `discover()` kaster. Det er med vilje: en kastende discovery naar
 * aldrig afmeldningen, en tavst forkortet goer.
 *
 * Eksporteret KUN til proeven.
 */
const NOEGLE = 'searchResponse'

/** Springer blanktegn over fra `fra`. */
const spring = (html: string, fra: number): number => {
  let k = fra
  while (k < html.length && /\s/.test(html[k]!)) k++
  return k
}

/** Én strengliteral fra en JS-kaldeliste. Kilden bruger begge citattegn. */
function laesStrengArg(html: string, fra: number): { vaerdi: string; naeste: number } | null {
  const k = spring(html, fra)
  const q = html[k]
  if (q !== '"' && q !== "'") return null
  let ud = ''
  for (let j = k + 1; j < html.length; j++) {
    const c = html[j]!
    if (c === '\\') { ud += html[j + 1] ?? ''; j++; continue }
    if (c === q) return { vaerdi: ud, naeste: j + 1 }
    ud += c
  }
  return null
}

/** Positionen efter et komma, eller null hvis der ikke staar et. */
function efterKomma(html: string, fra: number): number | null {
  const k = spring(html, fra)
  return html[k] === ',' ? k + 1 : null
}

/**
 * Et OBJEKT paa vaerdipladsen. Brace-matcher frem for regex: payloaden
 * indeholder selv `}`-tegn i strenge. Staar der noget andet end `{`, er
 * det fejlgrenen (`.p(v,e)` / `.r(i,k,v,e)`), og vi gaetter ikke.
 */
function laesObjektArg(html: string, fra: number): Ukendt | null {
  const start = spring(html, fra)
  if (html[start] !== '{') return null
  let dybde = 0
  let iStreng = false
  let esc = false
  for (let j = start; j < html.length; j++) {
    const c = html[j]
    if (iStreng) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') iStreng = false
      continue
    }
    if (c === '"') iStreng = true
    else if (c === '{') dybde++
    else if (c === '}') {
      dybde--
      if (dybde === 0) {
        try { return JSON.parse(html.slice(start, j + 1)) as Ukendt } catch { return null }
      }
    }
  }
  return null
}

/** Formen `__remixContext.r(<rute>, "searchResponse", {…})`. */
function streametForm(html: string): Ukendt | null {
  const KALD = '__remixContext.r('
  let fra = 0
  for (;;) {
    const m = html.indexOf(KALD, fra)
    if (m < 0) return null
    fra = m + KALD.length
    const rute = laesStrengArg(html, fra)
    if (!rute) continue
    const k1 = efterKomma(html, rute.naeste)
    if (k1 == null) continue
    const noegle = laesStrengArg(html, k1)
    if (!noegle || noegle.vaerdi !== NOEGLE) continue
    const k2 = efterKomma(html, noegle.naeste)
    // Noeglen er vores. Baerer vaerdipladsen ikke et objekt, er det
    // fejlgrenen — og saa er svaret null, ikke det naeste kald.
    return k2 == null ? null : laesObjektArg(html, k2)
  }
}

/** Formen `"searchResponse":__remixContext.p({…})`. */
function inlinetForm(html: string): Ukendt | null {
  const ANKER = `"${NOEGLE}":`
  const KALD = '__remixContext.p('
  let fra = 0
  for (;;) {
    const m = html.indexOf(ANKER, fra)
    if (m < 0) return null
    fra = m + ANKER.length
    const k = spring(html, fra)
    // Her sorteres baade den tomme pladsholder (`{}`) og den ventende
    // `.n(`-form fra: kun `.p(` baerer en indfriet vaerdi.
    if (!html.startsWith(KALD, k)) continue
    return laesObjektArg(html, k + KALD.length)
  }
}

export function findSearchResponse(html: string): Ukendt | null {
  return streametForm(html) ?? inlinetForm(html)
}

/**
 * Ét item → RawListing. EKSPLICIT ALLOWLIST — se filhovedet. Raa items
 * maa aldrig spredes ind i resultatet eller naa en log.
 *
 * Eksporteret KUN til proeven.
 */
export function laes(item: Ukendt): RawListing | null {
  const id = tekst(item['id'])
  const lokation = objekt(item['location'])
  const adresse = tekst(lokation['formatted'])
  if (!id || !adresse) return null

  const dawa = objekt(lokation['dawa'])
  const geo = objekt(lokation['geo'])
  const medie = objekt(item['media'])

  // Kun fotos, kun den maalte vaert. En fremmed vaert i payloaden er
  // ikke en fejl her — den er bare ikke vores at hotlinke fra.
  const billeder = (Array.isArray(medie['photos']) ? medie['photos'] : [])
    .map((p) => tekst(objekt(p)['url']))
    .filter((u): u is string => {
      if (!u) return false
      try { return new URL(u).host === BILLEDVAERT } catch { return false }
    })

  const typeRaa = tekst(item['type'])
  const boligtype = typeRaa === 'terracedHouse' ? 'rækkehus'
    : typeRaa === 'apartment' ? 'lejlighed'
    : typeRaa

  const faciliteter = [...new Set(
    ([] as unknown[])
      .concat(Array.isArray(item['amenities']) ? item['amenities'] : [])
      .concat(Array.isArray(item['appliances']) ? item['appliances'] : [])
      .map((a) => (typeof a === 'string' ? FACILITETSORD[a] : undefined))
      .filter((x): x is string => !!x),
  )]

  // Beskrivelsen bruges KUN til forbeholdet og gemmes ikke — braedtekst
  // er kildens, og vores beskrivelse genereres centralt.
  const beskrivelse = tekst(item['description']) ?? ''

  // priceType er 'monthly' paa alle 63 maalte; skulle kilden indfoere en
  // anden, er beloebet ikke en maanedsleje, og saa udelades det frem for
  // at blive til en forkert total.
  const maanedlig = tekst(item['priceType']) === 'monthly'

  return {
    // bolig.io's 32-tegns hex-id: stabilt paa tvaers af koersler.
    externalKey: id,
    sourceUrl: `${BASE}/boliger/${id}`,
    // location.formatted staar allerede i vaskeform:
    // "Nordre Teglkaj 42, 2. th, 2450 Koebenhavn SV".
    address: adresse,
    postalCode: tekst(dawa['postnr']) ?? tekst(lokation['zipCode']),
    sizeM2: tal(item['floorSize']),
    rooms: tal(item['numberOfRooms']),
    propertyType: boligtype,
    availableFrom: tekst(item['availableFrom']),
    rentMonthly: maanedlig ? oere(objekt(item['price'])['amount']) : undefined,
    // Kilden specificerer ikke, hvad acontoen daekker — saa den er "other",
    // ikke et gaet paa varme eller vand.
    utilitiesOther: oere(objekt(item['onAccountMonthly'])['amount']),
    // Kildens EGNE beloeb, hver for sig. Summen (deres "Indflytningspris")
    // beregner vi ikke — se moveInCost-noten i lib/adapter.ts.
    deposit: oere(objekt(item['securityDeposit'])['amount']),
    prepaidRent: oere(objekt(item['prepaidRent'])['amount']),
    lat: tal(geo['latitude']),
    lng: tal(geo['longitude']),
    sourceCreatedAt: tekst(item['created']),
    sourceUpdatedAt: tekst(item['updated']),
    amenities: faciliteter,
    imageUrls: billeder,
    imagesMayDiffer: FORBEHOLD.test(beskrivelse),
    // Hvad kilden SAGDE — fortolkningen bor i lib/kildekontrakt.ts.
    // Datoen er date-only; eksplicit null bevares, misdannet udelades.
    availability: {
      rawStatus: tekst(item['status']) ?? null,
      ...(item['availableFrom'] === null
        ? { sourceAvailabilityDate: null }
        : (() => {
            const d = isoDato(item['availableFrom'])
            return d ? { sourceAvailabilityDate: d } : {}
          })()),
    },
  }
}

export function cejAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  const hentSide = async (sti: string): Promise<Ukendt | null> => {
    const res = await politeFetch(`${OVERSIGT}${sti}`)
    if (!res.ok) throw new Error(`cej ${OVERSIGT}${sti} gav ${res.status}`)
    return findSearchResponse(await res.text())
  }

  return {
    id: 'cej',
    sourceType: 'feed',
    host: 'udlejning.cej.dk',

    async discover(): Promise<DiscoveredListing[]> {
      cache.clear()

      const foerste = await hentSide('')
      if (!foerste) throw new Error('cej: searchResponse ikke fundet — har bolig.io aendret buildformat?')

      // Kildens egen sideliste: ['', '?offset=32', …]. Vi foelger den —
      // og vi VALIDERER den. Faldt vi tilbage til [''], naar listen
      // mangler eller er misdannet, ville de 32 boliger paa side 1 blive
      // behandlet som hele kataloget, og de oevrige ville staa til
      // afmeldning. Forskellen paa de to udgange er hele sagen: en
      // KASTENDE discovery naar aldrig afmeldningskoden (lib/ingest.ts
      // vender om i discovery-catchen), mens en tavst forkortet liste gaar
      // hele vejen igennem og kun stoppes af 50 %-sikringen — som ved 32
      // af 63-66 boliger ligger paa vippen. Vi gaetter aldrig paa sider.
      const raaSider: unknown = foerste['pages']
      if (!Array.isArray(raaSider) || raaSider.length === 0
        || !raaSider.every((p) => typeof p === 'string')) {
        throw new Error('cej: pages-kontrakten kunne ikke valideres '
          + `(${JSON.stringify(raaSider) ?? 'undefined'}) — gaetter ikke paa antal sider`)
      }
      const sider = raaSider as string[]
      if (sider.length > MAKS_SIDER) {
        throw new Error(`cej: ${sider.length} sider — over loftet paa ${MAKS_SIDER}, noget er galt`)
      }
      // Siger payloaden selv, at udbuddet er stoerre end den foerste side
      // baerer, SKAL sidelisten have mere end én side. Ellers er
      // pagineringskontrakten ukendt, og et komplet katalog er en paastand
      // vi ikke har daekning for.
      const ialt = tal(foerste['size'])
      const paaFoerste = Array.isArray(foerste['items']) ? foerste['items'].length : 0
      if (ialt != null && ialt > paaFoerste && sider.length < 2) {
        throw new Error(`cej: payloaden siger ${ialt} boliger, men side 1 baerer ${paaFoerste}`
          + ` og pages har ${sider.length} side — pagineringskontrakten holder ikke`)
      }

      const ud: DiscoveredListing[] = []
      const set = new Set<string>()
      for (const [nr, sti] of sider.entries()) {
        const svar = nr === 0 ? foerste : await hentSide(sti)
        if (!svar) throw new Error(`cej: searchResponse ikke fundet paa side ${sti}`)
        for (const raa of Array.isArray(svar['items']) ? svar['items'] : []) {
          const b = laes(objekt(raa))
          if (!b || set.has(b.externalKey)) continue
          set.add(b.externalKey)
          cache.set(b.sourceUrl, b)
          ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
        }
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const b = cache.get(url)
      if (!b) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)
      return b
    },
  }
}
