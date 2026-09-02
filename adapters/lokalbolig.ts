// ═══════════════════════════════════════════════════════════════
//  LokalBolig — mæglerkæde med 232 lejemål ved siden af salgsudbuddet.
//
//    discover()  /api/cases/map?caseType=rented — hele udbuddet, ét kald.
//    extract()   boligsiden, læst i Next.js' RSC-payload.
//
//  Sitemap'et duer ikke som indgang: dets 2.186 URL'er er overvejende
//  boliger til SALG, og det skelner ikke. Map-endpointet gør, og det
//  leverer alle lejemål på én gang med `lastUpdated` — så vi henter kun
//  detaljesiden på dem, der faktisk har ændret sig.
//
//  Kilden er ustabil: www.lokalbolig.dk svarede 503 "Backend is unhealthy"
//  fra Varnish i hele undersøgelsen. Derfor tålmodige forsøg her, og
//  derfor er det vigtigt, at afmeldningsvagten tåler, at alle 232
//  forsvinder i en time. Det gør den — se noten i lib/ingest.ts.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere, parseDanskBeloebTilOere } from '../lib/money'

const ORIGIN = 'https://www.lokalbolig.dk'
const MAP = `${ORIGIN}/api/cases/map?caseType=rented`

/** Kilden er nede i perioder. Fem forsøg med voksende ophold frem for tre. */
const FORSOEG = 5

// ═══════════════════════════════════════════════════════════════
//  ALLOWLIST — læs dette før du rører noget herunder.
//
//  Boligsiden er Next.js App Router. Hele sagen ligger som JSON i
//  `self.__next_f`-brudstykkerne, og der ligger MEGET mere end vi må have:
//
//    caseAgent       navngiven mægler. Aldrig.
//    shop            butikkens navn, adresse og telefon. Aldrig.
//    caseAnalytics   deres egne visnings- og henvendelsestal. Aldrig.
//    project         projektets egne billeder — ikke af DENNE bolig.
//    description     kildens brødtekst. Vi skriver vores egen.
//
//  Derfor læses payloaden ikke generisk. Hvert felt hentes ved NAVN via
//  `jsonEfter`, og kun de navne, der står i `laesBolig`, forlader filen.
//
//  Udvid ALDRIG med en løkke over objektets nøgler eller et spread. Et nyt
//  felt tilføjes ved navn, af en der har set hvad der står i det.
// ═══════════════════════════════════════════════════════════════

/**
 * Alt før `"relatedCases"` hører til DENNE bolig.
 *
 * Payloaden indeholder elleve andre sager i et "lignende boliger"-felt, og
 * de har de samme nøgler: address, coordinates, roomCount, floorArea. Uden
 * grænsen ville et regex lige så gerne ramme naboens tal som boligens egne.
 * Efterprøvet: i hoveddelen findes hver af de nøgler, vi læser, præcis én
 * gang — se `ENTYDIGE` og tjekket i `laesBolig`.
 */
const GRAENSE = '"relatedCases"'

const ENTYDIGE = ['"address":{', '"caseDataFinancial":{', '"caseDataGeneral":{',
  '"pictures":[', '"coordinates":{'] as const

/** RSC-brudstykkerne samlet til én streng. */
function flight(html: string): string {
  let ud = ''
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { ud += JSON.parse(m[1]!) as string } catch { /* et brudstykke vi ikke kan læse */ }
  }
  return ud
}

/**
 * Værdien efter en navngiven nøgle, som ægte JSON.
 *
 * Klammerne tælles med respekt for strenge og escapes — et regex ville
 * stoppe ved den første `}` inde i en tekst og give os halvdelen af et
 * objekt.
 */
function jsonEfter<T>(s: string, noegle: string): T | undefined {
  const i = s.indexOf(noegle)
  if (i < 0) return undefined
  const start = i + noegle.length - 1
  const aaben = s[start]!
  const luk = aaben === '{' ? '}' : ']'
  let dybde = 0, iStreng = false, escaped = false
  for (let k = start; k < s.length; k++) {
    const c = s[k]!
    if (iStreng) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') iStreng = false
      continue
    }
    if (c === '"') iStreng = true
    else if (c === aaben) dybde++
    else if (c === luk && --dybde === 0) {
      try { return JSON.parse(s.slice(start, k + 1)) as T } catch { return undefined }
    }
  }
  return undefined
}

/** Skalar efter en navngiven nøgle. Kun tal, tekst og boolean — intet andet. */
function felt(s: string, navn: string): string | number | boolean | undefined {
  const m = s.match(new RegExp(`"${navn}":(null|true|false|-?\\d+(?:\\.\\d+)?|"(?:[^"\\\\]|\\\\.)*")`))
  if (!m) return undefined
  const raa = m[1]!
  if (raa === 'null') return undefined
  try { return JSON.parse(raa) as string | number | boolean } catch { return undefined }
}

const tekst = (s: string, navn: string) => {
  const v = felt(s, navn)
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
const tal = (s: string, navn: string) => {
  const v = felt(s, navn)
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Kilden skriver selv, når billederne ikke er af boligen:
 *
 *   "Bemærk venligst, at billederne kan være fra en anden bolig, hvorfor
 *    indretning, beliggenhed og udsigt kan variere."
 *
 * Så viser vi ingen. Et billede af noget andet end den bolig, brugeren
 * kigger på, er værre end intet billede — hun tror, hun har set den.
 * Teksten står i `description`, som vi ellers ikke bruger til noget.
 */
const FORBEHOLD = /billederne\s+kan\s+v(æ|ae)re\s+fra\s+en\s+anden\s+bolig/i

/** Kun værten vi hotlinker fra. Deres CDN-URL'er (esoftsystems, diakrit)
 *  står også i payloaden, men dem har vi hverken lov til eller grund til. */
const BILLEDVAERT = 'lokalbolig.io'

interface Billede { url?: unknown }

/** Sagsnummeret ud af URL'en. Samme nøgle i begge led — se discover(). */
export function noegleFraUrl(url: string): string | null {
  const sidste = new URL(url).pathname.replace(/\/$/, '').split('/').pop() ?? ''
  return /^\d+-x\d+$/i.test(sidste) ? sidste.toLowerCase() : null
}

const ukendteTyper = new Set<string>()

// ─── Allowlisten ───────────────────────────────────────────────

function laesBolig(html: string, url: string): RawListing | null {
  const hele = flight(html)
  const i = hele.indexOf(GRAENSE)
  const s = i > 0 ? hele.slice(0, i) : hele

  // Kildens eget indeks indeholder sager, hvis side er væk: den viser
  // "Boligen kunne ikke findes", men svarer 200 og bærer stadig elleve
  // lignende boliger. Uden dette tjek slog entydighedsvagten til og meldte
  // "payloaden har ændret form" — sandt om det, den så, men ikke om det,
  // der var galt. `caseDataFinancial` findes kun paa en rigtig boligside.
  if (!s.includes('"caseDataFinancial":{')) return null

  // Er en af nøglerne der to gange, er grænsen flyttet, og vi kan ikke
  // vide, hvis tal vi læser. Så hellere springe boligen over end gætte.
  for (const n of ENTYDIGE) {
    const antal = s.split(n).length - 1
    if (antal > 1) throw new Error(`${n} findes ${antal} gange i hoveddelen — payloaden har ændret form`)
  }

  // Kun udlejning. `caseType` er kildens eget felt; er den ikke CaseRented,
  // er det en bolig til salg, og den hører ikke til hos os.
  if (tekst(s, 'caseType') !== 'CaseRented') return null
  // "Kommer snart" er ikke ledig endnu.
  if (felt(s, 'isComingSoon') === true) return null

  const a = jsonEfter<Record<string, unknown>>(s, '"address":{')
  if (!a) return null
  const postnr = typeof a.zip === 'number' ? String(a.zip) : undefined
  const vejnr = [a.streetName, a.streetNumber].filter((x) => typeof x === 'string').join(' ').trim()
  const etageDoer = [a.floor, a.doorLocation].filter((x) => typeof x === 'string' && x).join('. ')
  const adresse = [
    [vejnr, etageDoer].filter(Boolean).join(', '),
    [postnr, a.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  if (!vejnr || !postnr) return null

  // Beløbene findes både som tal (kroner) og som tekst ("10.400 kr.").
  // Tallene bruges — teksten skal ikke parses, når kilden har givet os tallet.
  const leje = tal(s, 'monthlyRent')
  const depositum = tal(s, 'deposit')
  const forudbetalt = tal(s, 'prepaidRent')

  // Acontoen findes KUN som tekst, og kun som én klump: "Aconto pr. md.".
  // Kilden siger ikke, hvad den dækker, så den lander som uspecificeret
  // rest. Totalen bliver rigtig; sammensætningen kendes ikke, og derfor
  // tæller den ikke som fuld økonomi — se erFuldOekonomi i normalize.ts.
  const fin = jsonEfter<Record<string, unknown>>(s, '"caseDataFinancial":{')
  const acontoTekst = fin?.['Aconto pr. md.']
  const aconto = typeof acontoTekst === 'string'
    ? parseDanskBeloebTilOere(acontoTekst) ?? undefined
    : undefined

  // Indflytningspris: første måneds leje + depositum + forudbetalt + aconto.
  // Kun når alle tre beløb kendes — der regnes ikke på halve oplysninger.
  const moveInCost = leje != null && depositum != null && forudbetalt != null
    ? kronerTilOere(leje + depositum + forudbetalt) + (aconto ?? 0)
    : undefined

  const gen = jsonEfter<Record<string, unknown>>(s, '"caseDataGeneral":{')
  const boligtype = typeof gen?.['Boligtype'] === 'string' ? gen['Boligtype'] : tekst(s, 'propertyTypeText')
  if (boligtype && !/lejlighed|hus|v(æ|ae)relse|villa/i.test(boligtype) && !ukendteTyper.has(boligtype)) {
    ukendteTyper.add(boligtype)
  }

  const koord = jsonEfter<Record<string, unknown>>(s, '"coordinates":{')
  const lat = typeof koord?.latitude === 'number' ? koord.latitude : undefined
  const lng = typeof koord?.longitude === 'number' ? koord.longitude : undefined

  // Forbeholdet står i `description`, som ligger EFTER grænsen — og der er
  // MERE end én description i payloaden: hvert billede har også et felt af
  // det navn. Første forsøg læste et billedes og fandt ingenting.
  //
  // Derfor prøves hele payloaden. Den er stadig kun DENNE bolig: de lignende
  // sager i relatedCases har ingen beskrivelse, kun tal og adresse.
  const billeder = FORBEHOLD.test(hele)
    ? []
    : (jsonEfter<Billede[]>(s, '"pictures":[') ?? [])
        .map((b) => (typeof b?.url === 'string' ? b.url : null))
        .filter((u): u is string => {
          if (!u) return false
          try { return new URL(u).host === BILLEDVAERT } catch { return false }
        })

  return {
    externalKey: noegleFraUrl(url) ?? url,
    sourceUrl: url,
    address: adresse,
    postalCode: postnr,
    sizeM2: tal(s, 'floorArea'),
    rooms: tal(s, 'roomCount'),
    propertyType: boligtype,
    // ISO fra kilden selv. Den danske tekstdato i caseDataGeneral
    // ("1. september 2026") siger det samme og skal ikke parses.
    availableFrom: tekst(s, 'acquisitionDate'),
    rentMonthly: leje != null ? kronerTilOere(leje) : undefined,
    utilitiesOther: aconto,
    moveInCost,
    lat,
    lng,
    sourceCreatedAt: tekst(s, 'createdDate'),
    sourceUpdatedAt: tekst(s, 'lastUpdated'),
    imageUrls: billeder,
  }
}

// ═══════════════════════════════════════════════════════════════

interface MapSag {
  caseNumber?: unknown
  relativeUrl?: unknown
}

export function lokalboligAdapter(): SourceAdapter {
  return {
    id: 'lokalbolig',
    sourceType: 'spider',
    host: 'www.lokalbolig.dk',

    async discover(): Promise<DiscoveredListing[]> {
      const res = await politeFetch(MAP, FORSOEG, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`lokalbolig map gav ${res.status}`)
      const sager = await res.json() as MapSag[]
      if (!Array.isArray(sager)) throw new Error('lokalbolig map svarede ikke med en liste')

      const ud: DiscoveredListing[] = []
      for (const s of sager) {
        if (typeof s?.relativeUrl !== 'string' || typeof s?.caseNumber !== 'string') continue
        // Nøglen er sagsnummeret, ikke URL'en: rettes adressen, skifter
        // URL'en, og en URL-nøgle ville gøre boligen til en ny bolig.
        ud.push({ externalKey: s.caseNumber.toLowerCase(), url: ORIGIN + s.relativeUrl })
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const res = await politeFetch(url, FORSOEG, { headers: { Accept: 'text/html' } })
      if (!res.ok) throw new Error(`lokalbolig ${url} gav ${res.status}`)
      const b = laesBolig(await res.text(), url)
      // Kildens eget indeks indeholder sager, hvis side er væk — den første
      // i map-svaret var det. De springes over og afmeldes af sig selv.
      if (!b) throw new Error(`ingen aktiv lejebolig paa siden: ${url}`)
      if (ukendteTyper.size) {
        console.warn(`  lokalbolig: ukendt Boligtype (sendes videre til normaliseringen): `
          + [...ukendteTyper].slice(0, 10).join(', '))
        ukendteTyper.clear()
      }
      return b
    },
  }
}
