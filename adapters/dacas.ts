// ═══════════════════════════════════════════════════════════════
//  Dacas (Dansk Administrationscenter)
//
//  Ren HTML. WordPress med Divi; posttypen `lejlighed` er IKKE eksponeret
//  i REST-API'et (/wp-json/wp/v2/lejlighed giver 404, og typen mangler i
//  /types), saa der er intet JSON at hente.
//
//    discover()  lejlighed-sitemap.xml — hele udbuddet, ét kald.
//    extract()   boligsiden, laest paa etiketter.
//
//  Kilden er lille (19 boliger) men praecis: den oplyser
//  Indflytningspris direkte, saa vi ikke skal regne den ud, og den er den
//  eneste kilde, der siger "El: Eget ansvar" — se electricityOwnMeter.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { politeFetch } from '../lib/fetch'
import { parseDanskBeloebTilOere } from '../lib/money'

const ORIGIN = 'https://dacas.dk'
const SITEMAP = `${ORIGIN}/lejlighed-sitemap.xml`

// ═══════════════════════════════════════════════════════════════
//  ALLOWLIST — laes dette foer du roerer noget herunder.
//
//  Siden laeses paa NAVNGIVNE ETIKETTER, ikke paa position i markuppen.
//  Kun etiketterne i ETIKETTER og felterne i `laesBolig` bruges; alt
//  andet paa siden kasseres ulaest.
//
//  Det er ikke ryddelighed. Hver boligside har en kontaktblok med en
//  navngiven udlejningskonsulent, hendes direkte mailadresse og hendes
//  telefonnummer i broedteksten. De personoplysninger har vi hverken ret
//  til eller brug for. Etiket-tilgangen goer, at de aldrig laeses: de
//  staar i en anden sektion og har ingen af vores etiketter.
//
//  Udvid ALDRIG med "tag alt i denne div" eller en loekke over alle
//  tekstblokke. Et nyt felt skal tilfoejes som en navngiven etiket, af en
//  der har set hvad der staar i den.
// ═══════════════════════════════════════════════════════════════

const ETIKETTER = {
  overtagelse: 'Overtagelsesdato',
  husleje: 'Månedlig husleje',
  aconto: 'Månedlig aconto',
  el: 'El',
  forudbetalt: 'Forudbetalt leje',
  depositum: 'Depositum',
  indflytning: 'Indflytningspris',
  vaerelser: 'Antal værelser',
} as const

/** Faciliteter vi kender. Ukendte logges og springes over — vi tager ikke
 *  vilkaarlig tekst med ind i basen. */
const FACILITETER = new Set([
  'delevenlig', 'køle- og fryseskab', 'opvaskemaskine', 'vaskemaskine',
  'gårdhave', 'fælles vaskeri', 'cykelparkering', 'depotrum',
  'plads til barnevogn', 'altan', 'elevator', 'terrasse', 'have',
  'kælderrum', 'tørretumbler', 'emhætte', 'komfur', 'ovn',
])
const ukendteFaciliteter = new Set<string>()

// ─── Hjaelpere ─────────────────────────────────────────────────

const afTags = (s: string) => s.replace(/<[^>]+>/g, ' ')

function afkod(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/** Hele sidens synlige tekst som én streng. Etiketterne slaas op i den,
 *  saa nestet markup og skjulte linjeskift ikke kan flytte en vaerdi. */
const rentekst = (html: string) =>
  afkod(afTags(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, ' ')))
    .replace(/\s+/g, ' ')

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Udtrækket er TYPEBESTEMT, ikke generisk.
 *
 * Foerste forsoeg laeste "alt efter etiketten indtil naeste etiket". Det
 * knaekker paa alt, kilden ikke har fortalt os om: "Indflytningspris" er
 * sidste etiket og loeb videre ind i kontaktblokken, og "Antal vaerelser"
 * loeb ind i "Husdyr". Beloeb matches derfor som beloeb og tal som tal —
 * saa kan der ikke sive noget med, som vi ikke bad om.
 */
function beloeb(tekst: string, etiket: string): number | undefined {
  const m = tekst.match(new RegExp(`\\b${esc(etiket)}\\s*:\\s*(-?[\\d.]+(?:,\\d+)?)\\s*kr`, 'i'))
  return m ? parseDanskBeloebTilOere(m[1]!) ?? undefined : undefined
}

function heltal(tekst: string, etiket: string): number | undefined {
  const m = tekst.match(new RegExp(`\\b${esc(etiket)}\\s*:\\s*(\\d{1,3})\\b`, 'i'))
  return m ? Number(m[1]) : undefined
}

/** Korte tekstvaerdier. Kappet ved 40 tegn: en vaerdi laengere end det er
 *  ikke en vaerdi, men begyndelsen paa noget andet. */
function tekstVaerdi(tekst: string, etiket: string): string | undefined {
  const m = tekst.match(
    new RegExp(`\\b${esc(etiket)}\\s*:\\s*([A-Za-zÆØÅæøå0-9./ ]{1,40}?)\\s*(?=[A-ZÆØÅ][A-Za-zÆØÅæøå]*\\s*:|$)`),
  )
  return m?.[1]?.trim() || undefined
}

const MAANEDER = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
]

/**
 * "1. november 2026" -> ISO. Kilden skriver datoer som dansk tekst, ikke
 * som tal — de oevrige kilder giver ISO. Kan strengen ikke laeses, gives
 * undefined; der gaettes ikke paa en dato.
 */
function parseDanskDato(s: string): string | undefined {
  const m = s.match(/(\d{1,2})\.?\s+([a-zæøå]+)\s+(\d{4})/i)
  if (!m) return undefined
  const md = MAANEDER.indexOf(m[2]!.toLowerCase())
  if (md < 0) return undefined
  const d = new Date(Date.UTC(Number(m[3]), md, Number(m[1])))
  return isNaN(+d) ? undefined : d.toISOString()
}

// ─── Allowlisten ───────────────────────────────────────────────

function laesBolig(html: string, url: string): RawListing | null {
  // postid bruges som gyldighedstjek: er den der ikke, er siden ikke en
  // boligside. Den kan IKKE vaere noeglen — discovery kender kun URL'en,
  // og noeglen skal vaere den samme i begge led, ellers ser hver bolig ny
  // ud ved hver koersel og hentes igen.
  if (!/\bpostid-\d+\b/.test(html)) return null

  const t = rentekst(html)

  // Adressen staar i <h1>, ikke i <title>. Titlen har to formater — nogle
  // boliger faar "Adresse | Dansk Administrationscenter" uden postnummer,
  // og fire af nitten faldt paa det. <h1> har postnummeret paa dem alle.
  //
  //   <h1>Søren Møllers Gade 32, 1. sal – 8900 Randers C</h1>
  //
  // Tankestregen erstattes KUN naar den staar med mellemrum omkring og
  // efterfoelges af et postnummer. En bindestreg inde i et vejnavn maa
  // ikke rammes.
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]
  const adresse = afkod(afTags(h1 ?? '')).replace(/\s+/g, ' ')
    .replace(/\s+[–—-]\s+(?=\d{4}\b)/, ', ')
    .trim()
  if (!adresse || !/\b\d{4}\b/.test(adresse)) return null

  const husleje = beloeb(t, ETIKETTER.husleje)
  const aconto = beloeb(t, ETIKETTER.aconto)
  const indflytning = beloeb(t, ETIKETTER.indflytning)

  // "El: Eget ansvar" — den eneste kilde der siger det. Alt andet end
  // netop den formulering laeses ikke som noget.
  // Testet direkte paa formuleringen, ikke via en generisk etiket-laesning.
  // Vi leder efter én bestemt oplysning; alt andet efter "El:" er ikke
  // noget, vi laeser. Det er ogsaa det mest robuste: hvad der staar EFTER
  // vaerdien, kan ikke flytte resultatet.
  const elEgenMaaler = /\bEl\s*:\s*(eget ansvar|egen m(å|aa)ler)\b/i.test(t)

  // Areal staar som "54 m 2" i markuppen.
  const areal = Number(t.match(/(\d{1,4})\s*m\s*2\b/)?.[1])
  const vaerelser = heltal(t, ETIKETTER.vaerelser)

  // "Snarest" betyder ledig nu. Det er kildens egen oplysning, ikke et gaet.
  // Ellers laeses den danske tekstdato.
  const overtagelse = tekstVaerdi(t, ETIKETTER.overtagelse)
  const ledigFra = !overtagelse ? undefined
    : /snarest|straks|omg/i.test(overtagelse) ? new Date().toISOString()
    : parseDanskDato(overtagelse)

  // Galleriet er scopet af sliderens egen klasse, saa hverken logo eller
  // sidefod kommer med.
  const billeder = [...html.matchAll(
    /class="slider-img-no-lazy-load"[^>]*data-lazy-src="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((u) => u.includes('/uploads/'))

  const faciliteter: string[] = []
  for (const m of html.matchAll(/<div class="et_pb_text_inner">([^<]{2,40})<\/div>/g)) {
    const f = afkod(m[1]!).trim().toLowerCase()
    if (FACILITETER.has(f)) faciliteter.push(f)
    else if (f && !f.includes(':') && !/\d/.test(f) && f.length > 3) ukendteFaciliteter.add(f)
  }

  return {
    // URL'en er noeglen. Den er stabil, saa laenge adressen ikke rettes;
    // sker det, opdager dedup det paa adressen.
    externalKey: url,
    sourceUrl: url,
    address: adresse,
    sizeM2: Number.isFinite(areal) ? areal : undefined,
    rooms: vaerelser,
    // Kilden har kun lejligheder — posttypen hedder 'lejlighed'.
    propertyType: 'lejlighed',
    availableFrom: ledigFra,
    rentMonthly: husleje,
    // Acontoen er ikke specificeret paa poster, saa den staar som
    // uspecificeret rest. Totalen bliver rigtig; opdelingen kendes ikke.
    utilitiesOther: aconto,
    electricityOwnMeter: elEgenMaaler || undefined,
    // Kilden oplyser indflytningsprisen selv. Vi regner den ikke ud.
    moveInCost: indflytning,
    amenities: [...new Set(faciliteter)],
    imageUrls: billeder,
  }
}

// ═══════════════════════════════════════════════════════════════

export function dacasAdapter(): SourceAdapter {
  return {
    id: 'dacas',
    sourceType: 'spider',
    host: 'dacas.dk',

    async discover(): Promise<DiscoveredListing[]> {
      const res = await politeFetch(SITEMAP, 3, { headers: { Accept: 'application/xml' } })
      if (!res.ok) throw new Error(`dacas sitemap gav ${res.status}`)
      const xml = await res.text()
      return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((m) => m[1]!.trim())
        .filter((u) => u.includes('/lejlighed/'))
        .map((url) => ({ externalKey: url, url }))
    },

    async extract(url: string): Promise<RawListing> {
      const res = await politeFetch(url, 3, { headers: { Accept: 'text/html' } })
      if (!res.ok) throw new Error(`dacas ${url} gav ${res.status}`)
      const b = laesBolig(await res.text(), url)
      if (!b) throw new Error(`kunne ikke laese bolig: ${url}`)
      if (ukendteFaciliteter.size) {
        console.warn(`  dacas: ukendte faciliteter (springes over): `
          + [...ukendteFaciliteter].slice(0, 10).join(', '))
        ukendteFaciliteter.clear()
      }
      return b
    },
  }
}
