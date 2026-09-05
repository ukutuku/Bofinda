// ═══════════════════════════════════════════════════════════════
//  home.dk — https://home.dk/til-leje/…
//
//  Nuxt 3. Hele datasaettet ligger server-renderet i __NUXT_DATA__ paa
//  baade liste og detaljeside, saa der er hverken API-noegle eller
//  JS-kørsel involveret.
//
//  ── Om det flade format ──────────────────────────────────────
//  Nuxt serialiserer FLADT: payloaden er én liste, og hvert felt i et
//  objekt er et INDEKS ind i den. `los()` slaar op ÉN gang og rekurserer
//  derefter kun struktureIt. Det er ikke pedanteri: gør man opslaget igen
//  paa resultatet, bliver et areal paa 121 til `d[121]` — et vilkaarligt
//  andet objekt. Den fejl gav plausible tal, der var forkerte.
//
//  ── Om oekonomien ────────────────────────────────────────────
//  Kilden oplyser husleje, ét SAMLET aconto-beloeb, depositum og
//  forudbetalt leje. Den siger ikke, hvad acontoen daekker — hverken
//  overskrift, note eller specifikation. Beloebet lander derfor i
//  `utilitiesOther`, og boligen faar den fjerde el-tilstand:
//  "Aconto er ét samlet beloeb — det fremgaar ikke om el er med."
//  Den maa ALDRIG faa "El indgaar ikke i beloebet" — det ville paastaa
//  noget, kilden ikke har sagt.
//
//  Indflytningsprisen regnes ikke ud af depositum + forudbetalt + leje.
//  Kilden oplyser den ikke, og et tal, vi selv har lagt sammen, ville se
//  lige saa sikkert ud som et oplyst.
//
//  ── Om billederne ────────────────────────────────────────────
//  De ligger IKKE paa home.dk, og der er TO vaerter, ikke én. Hvilken
//  foelger sagstypen, og det kan ses paa sagsnummeret:
//
//    177P009058   projektlejemaal (dataSource 'estatetool')
//                 → alvis.b-cdn.net        ~201 boliger
//    1770021465   almindelig sag
//                 → home.mindworking.eu    ~26 boliger
//
//  Begge skal i TILLADTE_VAERTER — ellers forsvinder billederne uden en
//  fejl, og kortet mister sin billedkolonne. Den her note sagde foer kun
//  `alvis.b-cdn.net`, og saa stod 25 boliger med 249 billeder uden
//  billede. TAEL vaerterne i payloaden; find ikke den foerste.
//
//  Billederne tages fra DETALJESIDEN, ikke fra gitteret. Listesidens
//  raekker er skaaret af ved 10 — 193 af 228 boliger laa praecis paa det
//  loft — mens sagens eget `presentationMedia` baerer hele saettet, op
//  til 19 maalt. `floorPlanMedia` holdes udenfor: plantegninger er ikke
//  boligbilleder.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'

const ORIGIN = 'https://home.dk'
const LISTE = `${ORIGIN}/til-leje/lejlighed/region-hovedstaden/koebenhavn-kommune/`
/** Loft. Uden det kan en aendret paginering koere i ring. */
const MAKS_SIDER = 60

type Flad = unknown[]
type Ukendt = Record<string, unknown>

async function hentNuxt(url: string): Promise<Flad> {
  const res = await politeFetch(url, 3, { headers: { Accept: 'text/html' } })
  if (!res.ok) throw new Error(`home ${url} gav ${res.status}`)
  const m = /<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>(.*?)<\/script>/s
    .exec(await res.text())
  if (!m) throw new Error(`intet __NUXT_DATA__ paa ${url}`)
  return JSON.parse(m[1]!) as Flad
}

/** Ét opslag, derefter kun struktureI rekursion. Se noten i hovedet. */
function los(d: Flad, i: unknown, dyb = 0): unknown {
  if (dyb > 10) return null
  const v = typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < d.length ? d[i] : i
  if (Array.isArray(v)) return v.map((x) => los(d, x, dyb + 1))
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Ukendt).map(([k, x]) => [k, los(d, x, dyb + 1)]))
  }
  return v
}

const tal = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const tekst = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined
/** Kilden regner i kroner. Vi regner i oere. */
const oere = (v: unknown): number | undefined => {
  const n = tal((v as Ukendt | undefined)?.['amount'])
  return n == null ? undefined : kronerTilOere(n)
}

/** Alle objekter i payloaden der har et bestemt felt. */
const medFelt = (d: Flad, felt: string): Ukendt[] =>
  d.filter((x): x is Ukendt =>
    !!x && typeof x === 'object' && !Array.isArray(x) && felt in (x as Ukendt))

const TYPER: Record<string, string> = {
  condo: 'lejlighed', apartment: 'lejlighed', terracedhouse: 'raekkehus',
  villa: 'hus', house: 'hus', room: 'vaerelse',
}

interface Gitterrække {
  id: string
  url: string
  adresse: string
  postnr?: string
  areal?: number
  leje?: number
  type?: string
  billeder: string[]
}

function laesGitter(d: Flad, raa: Ukendt): Gitterrække | null {
  const s = los(d, raa) as Ukendt
  const id = tekst(s['id'])
  const sti = tekst(s['url'])
  const adr = (s['address'] ?? {}) as Ukendt
  const fuld = tekst(adr['full'])
  if (!id || !sti || !fuld) return null
  const medier = Array.isArray(s['presentationMedia']) ? s['presentationMedia'] as Ukendt[] : []
  return {
    id,
    url: `${ORIGIN}/${sti.replace(/^\//, '')}`,
    adresse: fuld,
    postnr: tekst(adr['postalCode']),
    areal: tal((s['stats'] as Ukendt | undefined)?.['floorArea']),
    leje: oere((s['offer'] as Ukendt | undefined)?.['rentPerMonth']),
    type: TYPER[String(s['type'] ?? '').toLowerCase()],
    billeder: medier.map((m) => tekst(m['url'])).filter((x): x is string => !!x),
  }
}

/**
 * Parsningen af en detaljeside, uden netvaerk. Eksporteret KUN til
 * proeven: den skal kunne koere mod en frossen payload, hvor en global
 * laesning ville vaelge naboens dato.
 */
export function laesSag(d: Flad, g: Gitterrække, url: string): RawListing {

  // Detaljesiden baerer OGSAA de beslaegtede annoncer, hver med sit
  // eget tilbudsobjekt — fem paa den side vi maalte. Tilbuddet findes
  // derfor paa sagens ID, ikke som "det foerste med rentalPricePerMonth".
  // Ellers kan naboens oekonomi lande paa den her bolig, og tallet ser
  // lige saa rigtigt ud som et rigtigt.
  const sag = medFelt(d, 'offer')
    .map((x) => los(d, x) as Ukendt)
    .find((x) => tekst(x['id']) === g.id)
  if (!sag) throw new Error(`fandt ikke sag ${g.id} i payloaden paa ${url}`)
  const tilbud = (sag['offer'] ?? {}) as Ukendt

  // Billederne fra SAGEN, ikke fra gitteret. `g.billeder` kommer fra
  // listesiden, som er skaaret af ved 10; sagens eget
  // `presentationMedia` har hele saettet. Samme objektform, samme
  // felt (`url`), og samme id-binding som tilbuddet ovenfor — saa en
  // nabosags billeder kan ikke lande her.
  //
  // Fald tilbage paa gitteret, hvis sagen ingen har: to boliger har
  // aegte nul hos kilden, og for dem skal der ikke opfindes noget.
  const fraSagen = (Array.isArray(sag['presentationMedia'])
    ? sag['presentationMedia'] as Ukendt[]
    : []).map((m) => tekst(m['url'])).filter((x): x is string => !!x)
  const leje = oere(tilbud['rentalPricePerMonth']) ?? g.leje

  // Ledigdatoen fra SAGENS EGET availability-objekt — samme id-binding
  // som tilbuddet og billederne. Foer blev feltet laest globalt:
  // foerste objekt i payloaden med en rentalAvailableFrom. Siden
  // baerer de beslaegtede annoncers availability-objekter ogsaa, og
  // saa kunne NABOENS dato lande paa den her bolig og se lige saa
  // rigtig ud som den rigtige. Maalt paa 25 sider var der kun ét
  // befolket objekt — men det er et tilfaelde, ikke en garanti.
  const avail = (sag['availability'] ?? {}) as Ukendt
  const ledig = tekst(avail['rentalAvailableFrom'])

  return {
    externalKey: g.id,
    sourceUrl: url,
    address: g.adresse,
    postalCode: g.postnr,
    sizeM2: g.areal,
    propertyType: g.type,
    availableFrom: ledig ? ledig.slice(0, 10) : undefined,
    rentMonthly: leje,
    // ÉT samlet beloeb. Kilden siger ikke hvad det daekker, saa det er
    // uspecificeret rest — ikke varme, ikke vand, ikke el.
    utilitiesOther: oere(tilbud['rentalUtilitiesPerMonth']),
    amenities: [],
    imageUrls: fraSagen.length ? fraSagen : g.billeder,
  }
}

export function homeAdapter(): SourceAdapter {
  const gitter = new Map<string, Gitterrække>()

  return {
    id: 'home',
    sourceType: 'spider',
    host: 'home.dk',

    async discover(): Promise<DiscoveredListing[]> {
      gitter.clear()
      const ud: DiscoveredListing[] = []
      for (let side = 1; side <= MAKS_SIDER; side++) {
        const d = await hentNuxt(side === 1 ? LISTE : `${LISTE}?page=${side}`)
        const raekker = medFelt(d, 'isRentalCase')
          .map((x) => laesGitter(d, x))
          .filter((x): x is Gitterrække => !!x)
        // Tom side = vi er forbi den sidste. Sidetallet staar i markup'en,
        // men et loft plus en tom side holder ogsaa, hvis de laver det om.
        if (!raekker.length) break
        let nye = 0
        for (const r of raekker) {
          if (gitter.has(r.url)) continue
          gitter.set(r.url, r)
          ud.push({ externalKey: r.id, url: r.url })
          nye++
        }
        // Samme side igen betyder, at pagineringen ikke flytter sig.
        if (!nye) break
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const g = gitter.get(url)
      if (!g) throw new Error(`ikke i gitteret: ${url} (koer discover foerst)`)
      return laesSag(await hentNuxt(url), g, url)
    },
  }
}
