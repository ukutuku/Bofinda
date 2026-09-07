// ═══════════════════════════════════════════════════════════════
//  Laros A/S — https://www.laros.dk/ledige-lejemal/
//
//  Privat ejendomsadministrator i Aarhus med boliger i Aarhus,
//  Storkoebenhavn, Horsens m.fl. Bred mundtlig tilladelse, givet pr.
//  telefon 7. sep. 2026 og optaget med samtykke — se
//  docs/kildetilladelser.md. Den daekker hentning, behandling og visning
//  af deres offentlige boligannoncer og billeder.
//
//  ── Takten er kildens, ikke vores ────────────────────────────
//  robots.txt siger `Crawl-delay: 20`. Det staar i VAERTSTAKT i
//  lib/fetch.ts som 20.000 ms, og ingen kald her gaar udenom politeFetch.
//  En bred tilladelse til at hente er ikke en tilladelse til at hente
//  hurtigt. Hele udbuddet er ~5 listesider = ~100 s; detaljesider hentes
//  kun for nye, aendrede og forfaldne boliger (detaljevagten), under et
//  budget pr. koersel — se LAROS_DETALJEBUDGET nedenfor.
//
//  ── Hvad listen giver, og hvad detaljesiden giver ────────────
//  Listen (?pg=N, 9 kort pr. side) baerer adresse, type, m2, vaerelser,
//  leje, LEDIG-dato og depositum — nok til en brugbar bolig. Detaljesiden
//  laegger aconto (VARME, VAND), FORUDBETALT, INDFLYTNINGSPRIS og det
//  fulde galleri til. Indflytningsprisen er KILDENS eget tal og gemmes som
//  det; vi regner den ikke ud (Balder-reglen i lib/adapter.ts).
//
//  ── Billeder ─────────────────────────────────────────────────
//  Boligbillederne ligger paa hos.laros.dk under /lejere/billeder/. Der er
//  ogsaa billeder paa www.laros.dk, men det er temaets bannere og
//  partner-badges — ikke boliger. Derfor kun hos.laros.dk.
//
//  ── Hvad vi bevidst IKKE tager ───────────────────────────────
//  Knappen «Ansoeg via Boligportal» og dens BoligPortal-URL (vi linker til
//  Laros' egen side), Parkering og Erhverv (ikke boliger), og feltet
//  DELEVENLIG gemmes kun som facilitetsord. Ingen persondata set i
//  payloaden; laes() plukker alligevel kun boligfelter ved navn.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'
import { laesDetaljeBudget } from './heimstaden'

const BASE = 'https://www.laros.dk'
const LISTE = `${BASE}/ledige-lejemal/`
const BILLEDVAERT = 'hos.laros.dk'
const KORT_PR_SIDE = 9
/** Loft over listesider — 38 boliger er 5 sider; 20 giver rigelig plads. */
const MAKS_SIDER = 20
/** Konservativt: hver detaljeside koster 20 sekunder hos Laros. */
export const STANDARD_DETALJEBUDGET_LAROS = 5

/** Kildens typeord → vores boligtype. Parkering og Erhverv er ikke med:
 *  de er ikke boliger. `Bolig` er kildens samleord — typen afgoeres af
 *  adressen (etage/doer = lejlighed), ellers ukendt. */
const BOLIGTYPER: Record<string, string | null> = {
  'Bolig': null,
  'Rækkehus': 'rækkehus',
  'Værelse': 'værelse',
}

export type Ukendt = Record<string, unknown>
const tekst = (v: string | undefined | null) => (v ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
/** "13.800", "41.400 Kr.", "500 kr." → 13800 osv. Ingen decimaler set. */
const kroner = (v: string | undefined): number | undefined => {
  const m = tekst(v).match(/(\d[\d.]*)/)
  if (!m?.[1]) return undefined
  const n = Number(m[1].replace(/\./g, ''))
  return Number.isFinite(n) ? n : undefined
}
const oere = (v: string | undefined) => {
  const k = kroner(v)
  return k == null ? undefined : kronerTilOere(k)
}
/** "01-11-2026" → IsoDate "2026-11-01" (date-only, valideret). */
const datoFraDk = (v: string | undefined) => {
  const m = tekst(v).match(/^(\d{2})-(\d{2})-(\d{4})$/)
  return m ? isoDato(`${m[3]!}-${m[2]!}-${m[1]!}`) : null
}
/** Kortets adresse: "Skovvejen 1, 3. 3 , 8000 Aarhus C" → mellemrum foer
 *  komma fjernes, saa adressevasken laeser den som alle andre. */
const adresse = (v: string) => tekst(v).replace(/\s+,/g, ',').replace(/,\s*/g, ', ')
const postnrAf = (adr: string) => adr.match(/\b(\d{4})\s+[^,]+$/)?.[1]
const idAf = (url: string) => url.replace(/\/+$/, '').split('/').pop() ?? ''
const erBoligbillede = (u: string) => {
  try { const x = new URL(u); return x.host === BILLEDVAERT && x.pathname.startsWith('/lejere/billeder/') } catch { return false }
}

/** Label/vaerdi-parrene, som baade kortet og detaljesiden bruger. Foerste
 *  forekomst pr. label — der er kun én blok pr. side. */
function felter(html: string): Record<string, string> {
  const ud: Record<string, string> = {}
  for (const m of html.matchAll(/<label>([^<]+)<\/label>\s*<div class="value">([\s\S]*?)<\/div>/g)) {
    const k = tekst(m[1]).toUpperCase()
    if (!(k in ud)) ud[k] = tekst(m[2])
  }
  return ud
}

/**
 * Listesiden → grundlag pr. bolig. EKSPLICIT: hvert felt plukkes ved navn.
 * Eksporteret KUN til proeven.
 */
export function laesListe(html: string): RawListing[] {
  const ud: RawListing[] = []
  // Hvert kort begynder med sin adresse-blok; alt frem til naeste er kortet.
  const dele = html.split(/<div class="address[^"]*">/).slice(1)
  for (const del of dele) {
    const url = del.match(/href="(https?:\/\/www\.laros\.dk\/ledige-detaljer\/[^"]+?)\/?"/)?.[1]
    const adrRaa = del.match(/<span class="text">([^<]+)<\/span>/)?.[1]
    if (!url || !adrRaa) continue
    const f = felter(del)
    const type = f['TYPE'] ?? ''
    if (!(type in BOLIGTYPER)) continue          // Parkering, Erhverv — ikke boliger
    const adr = adresse(adrRaa)
    const dato = datoFraDk(f['LEDIG'])
    const harEtage = /\b\d+\.\s|\bst\.|\bkl\./i.test(adr)
    const billeder = [...del.matchAll(/background-image:url\('?(https?:\/\/[^'")]+)'?\)/g)]
      .map((m) => m[1] ?? '').filter(erBoligbillede)
    ud.push({
      externalKey: idAf(url),
      sourceUrl: url.replace(/\/?$/, '/'),
      address: adr,
      postalCode: postnrAf(adr),
      sizeM2: kroner(f['STØRRELSE']),
      rooms: kroner(f['VÆRELSER']),
      propertyType: BOLIGTYPER[type] ?? (harEtage ? 'lejlighed' : undefined),
      availableFrom: dato ?? undefined,
      rentMonthly: oere(f['LEJE']),
      deposit: oere(f['DEPOSITUM']),
      imageUrls: [...new Set(billeder)],
      availability: {
        rawStatus: f['LEDIG'] != null ? 'LEDIG' : null,
        ...(dato ? { sourceAvailabilityDate: dato } : {}),
      },
    })
  }
  return ud
}

/**
 * Detaljesiden laegger til det, listen ikke har. Grundlaget kommer fra
 * listen og overskrives kun med det, siden faktisk viser.
 * Eksporteret KUN til proeven.
 */
export function laesDetalje(html: string, grundlag: RawListing): RawListing {
  const f = felter(html)
  const galleri = [...new Set(
    [...html.matchAll(/https?:\/\/hos\.laros\.dk\/lejere\/billeder\/[^"'\s)]+/g)].map((m) => m[0]).filter(erBoligbillede),
  )]
  const dato = datoFraDk(f['LEDIG PR.'])
  const faciliteter = [...(grundlag.amenities ?? [])]
  if (f['DELEVENLIG']) faciliteter.push(f['DELEVENLIG'].toLowerCase())
  return {
    ...grundlag,
    utilitiesHeat: oere(f['VARME']) ?? grundlag.utilitiesHeat,
    utilitiesWater: oere(f['VAND']) ?? grundlag.utilitiesWater,
    prepaidRent: oere(f['FORUDBETALT']) ?? grundlag.prepaidRent,
    // Kildens egen sum — gemmes som den staar, regnes aldrig ud.
    moveInCost: oere(f['INDFLYTNINGSPRIS']) ?? grundlag.moveInCost,
    amenities: [...new Set(faciliteter)],
    imageUrls: galleri.length ? galleri : grundlag.imageUrls,
    ...(dato ? { availableFrom: dato, availability: { ...grundlag.availability, rawStatus: 'LEDIG', sourceAvailabilityDate: dato } } : {}),
  }
}

/** Signaturen af de listefelter, der skal udloese ny detaljehentning.
 *  Eksporteret KUN til proeven. */
export function detaljesignatur(b: RawListing): string {
  return JSON.stringify([b.availability?.sourceAvailabilityDate ?? null, b.rentMonthly ?? null, b.deposit ?? null])
}

let budgetAdvaret = false
export const _nulstilBudgetAdvarsel = () => { budgetAdvaret = false }
function detaljeBudget(): number {
  const { budget, afvist } = laesDetaljeBudget(process.env.LAROS_DETALJEBUDGET, STANDARD_DETALJEBUDGET_LAROS)
  if (afvist && !budgetAdvaret) {
    budgetAdvaret = true
    console.warn(`[laros] LAROS_DETALJEBUDGET IGNORERET: ${afvist}. Bruger standarden ${STANDARD_DETALJEBUDGET_LAROS}.`)
  }
  return budget
}

export function larosAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  return {
    id: 'laros',
    sourceType: 'spider',
    host: 'www.laros.dk',

    get detaljeBudgetPrKoersel() { return detaljeBudget() },
    listeGrundlag(url: string) {
      const grundlag = cache.get(url)
      return grundlag ? { grundlag, detaljesignatur: detaljesignatur(grundlag) } : null
    },

    async discover(): Promise<DiscoveredListing[]> {
      cache.clear()
      const ud: DiscoveredListing[] = []
      // Sidetallet kendes ikke paa forhaand: vi bladrer, indtil en side ikke
      // er fuld. /page/N/ er IKKE pagination hos Laros (den giver side 1
      // igen) — det er ?pg=N.
      for (let side = 1; side <= MAKS_SIDER; side++) {
        const res = await politeFetch(side === 1 ? LISTE : `${LISTE}?pg=${side}`)
        if (!res.ok) throw new Error(`laros liste side ${side} gav ${res.status}`)
        const html = await res.text()
        for (const b of laesListe(html)) {
          if (cache.has(b.sourceUrl)) continue
          cache.set(b.sourceUrl, b)
          ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
        }
        // Sidste side kendes paa, at den ikke er fuld. Kortene taelles FOER
        // typefilteret: en side fuld af parkering er stadig en fuld side,
        // og der kan ligge boliger paa den naeste.
        if (sidstSideVarKort(html)) break
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const grundlag = cache.get(url)
      if (!grundlag) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)
      const res = await politeFetch(url)
      if (!res.ok) throw new Error(`laros ${url} gav ${res.status}`)
      return laesDetalje(await res.text(), grundlag)
    },
  }
}

/** En side med faerre end 9 kort er den sidste. Taelles paa adresse-
 *  blokkene, ikke paa boligerne — parkering fylder ogsaa et kort. */
function sidstSideVarKort(html: string): boolean {
  return (html.match(/<div class="address[^"]*">/g) ?? []).length < KORT_PR_SIDE
}
