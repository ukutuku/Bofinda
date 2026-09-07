// ═══════════════════════════════════════════════════════════════
//  Alabu Bolig — https://alabubolig.dk/se-og-soeg-bolig/soeg-ledig-lejebolig/
//
//  Almen boligorganisation i Aalborg (familieboliger i 9000–9270 og
//  Terndrup). Fuld mundtlig tilladelse, givet pr. telefon 7. sep. 2026 og
//  optaget med samtykke — se docs/kildetilladelser.md.
//
//  ── Ikke en kopi af noget ────────────────────────────────────
//  Platformen (Umbraco + Incom) deles med andre almene selskaber, men
//  kontrakten er Alabus egen: hvert felt her er efterproevet mod DERES
//  payload og DERES skabeloner 2026-09-07 (lib/kildekontrakt.ts). Samme
//  platform er ikke samme kontrakt.
//
//  ── To kald: listen og «Mere om boligen» ─────────────────────
//  Listen er ét GET til det endpoint, listesiden selv bruger:
//  AvailableTenanciesPage/GetAllAvailableTenancies → Data.Tenancies[].
//  Den baerer adresse, koordinater, m2, vaerelser, netto husleje, indskud,
//  indflytningsdato og boligens egne billeder — nok til en brugbar bolig.
//  GetInfoForTenancy (~600 bytes pr. bolig) laegger aconto varme/vand,
//  boligart, faciliteter og plantegning til. Den hentes kun for nye,
//  aendrede og forfaldne boliger (detaljevagten) under ALABU_DETALJEBUDGET.
//
//  ── Noeglen er tre tal, ikke ét ──────────────────────────────
//  TenancyId er KUN unikt inden for en afdeling: 31 og 4 fandtes begge i
//  to afdelinger med hver sin adresse. Noeglen er derfor
//  CompanyId-DepartmentId-TenancyId, og boligsiden linkes som ?ten=C_D_T.
//
//  ── Hvad kilden IKKE oplyser ─────────────────────────────────
//  Forudbetalt leje, indflytningspris, statusord (ledig/reserveret/
//  udlejet) og ansoegningsform. De forbliver ukendte; intet regnes ud.
//  RentTotal («Husleje i alt») er kildens egen sum og bruges kun til at
//  kontrollere, at vi fik alle poster med — den gemmes ikke.
//
//  ── Billeder ─────────────────────────────────────────────────
//  TenancyImages er boligens egne og ligger i mappen <C>_<D>_<T>/.
//  DepartmentImages er AFDELINGENS — facade og gaardmiljoe, ikke
//  lejemaalet — og ligger i <C>_<D>/. De tages ikke med: et afdelings-
//  billede vist som boligbillede er en opdigtet oplysning. Mappen tjekkes
//  strukturelt, ikke kun feltnavnet. Plantegningen (FloorPlanUrls) er
//  boligens og kommer sidst. Én vaert: alabubolig.dk; den raa sti uden
//  ?definition= svarer 200 image/jpeg (maalt 2026-09-07).
//
//  ── Persondata ───────────────────────────────────────────────
//  Ingen i payloadet. `Description` (fritekst med Alabus eget
//  telefonnummer) gemmes ikke; billedernes Name/Description/Photographer
//  laeses ikke. laesListe() plukker kun boligfelter ved navn.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveredListing, RawListing, SourceAdapter } from '../lib/adapter'
import { isoDato, type IsoDate } from '../lib/dato'
import { politeFetch } from '../lib/fetch'
import { kronerTilOere } from '../lib/money'
import { laesDetaljeBudget } from './heimstaden'

const ORIGIN = 'https://alabubolig.dk'
const LISTE = `${ORIGIN}/umbraco/api/AvailableTenanciesPage/GetAllAvailableTenancies`
const DETALJE = `${ORIGIN}/umbraco/api/AvailableTenanciesPage/GetInfoForTenancy`
const BOLIGSIDE = `${ORIGIN}/se-og-soeg-bolig/soeg-ledig-lejebolig/`
const BILLEDVAERT = 'alabubolig.dk'
const BILLEDSTI = '/media/tempdepartmentimages/'
/** Web API'et forhandler XML, hvis Accept foretraekker det; vi beder om JSON. */
const JSON_HOVEDER: RequestInit = { headers: { Accept: 'application/json' } }
/** Detaljekaldet koster ~600 bytes og ét sekund; 30 daekker hele udbuddet
 *  (22 maalt 7/9) i én koersel med luft til vaekst. */
export const STANDARD_DETALJEBUDGET_ALABU = 30

/** Kildens «Boligart» → vores type. KUN ord, vi har set. Et ukendt ord
 *  giver ingen type og siges hoejt, saa det kan foejes til med vilje. */
const BOLIGARTER: Record<string, string> = {
  Etagebyggeri: 'lejlighed',
  // Set ved den kontrollerede import 7. sep. 2026 (4 boliger i Terndrup).
  'Rækkehuse - 1 plan': 'rækkehus',
}
/** Posterne i GetInfoForTenancy.Rents, ved navn. KUN navne, vi har set.
 *  «Husleje» er RentNet fra listen og taelles ikke igen; et navn, der ikke
 *  staar her, bliver uspecificeret aconto (utilitiesOther) — beloebet er
 *  kildens, kun rubrikken er ukendt. */
const ACONTOPOSTER: Record<string, 'utilitiesHeat' | 'utilitiesWater' | 'utilitiesElectricity'> = {
  'Aconto varme': 'utilitiesHeat',
  'Aconto vand': 'utilitiesWater',
  // Set ved den kontrollerede import 7. sep. 2026 — ikke i den foerst
  // efterproevede bolig, men kildens eget ord, saa snart den brugte det.
  'Aconto el': 'utilitiesElectricity',
}
const HUSLEJEPOST = 'Husleje'

type Ukendt = Record<string, unknown>
const obj = (v: unknown): Ukendt =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Ukendt : {})
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const tal = (v: unknown): number | undefined =>
  (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const heltal = (v: unknown): number | undefined => {
  const n = tal(v)
  return n != null && Number.isInteger(n) ? n : undefined
}
const tekst = (v: unknown): string | undefined =>
  (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : undefined)
const oere = (v: unknown): number | undefined => {
  const n = tal(v)
  return n == null ? undefined : kronerTilOere(n)
}
/** "2026-11-15T00:00:00" → 2026-11-15. Kilden siger en dag; klokkeslaettet
 *  er altid 00:00:00 og kasseres. Ugyldig dag giver ingen dato. */
const kalenderdagAf = (v: unknown): IsoDate | null => {
  const s = tekst(v)
  return s ? isoDato(s.slice(0, 10)) : null
}

/** Eksporteret KUN til proeven. */
export const noegle = (c: number, d: number, t: number) => `${c}-${d}-${t}`
const boligside = (c: number, d: number, t: number) => `${BOLIGSIDE}?ten=${c}_${d}_${t}`
const idsAf = (key: string): [number, number, number] | null => {
  const m = key.match(/^(\d+)-(\d+)-(\d+)$/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Boligens EGEN billedmappe: /Media/TempDepartmentImages/<C>_<D>_<T>/.
 *  Afdelingens mappe hedder <C>_<D>/ og er ikke boligen. Relative stier
 *  goeres absolutte; fremmede vaerter falder fra. */
function boligbillede(u: unknown, c: number, d: number, t: number): string | null {
  const s = tekst(u)
  if (!s) return null
  let url: URL
  try { url = new URL(s, ORIGIN) } catch { return null }
  if (url.host !== BILLEDVAERT) return null
  if (!url.pathname.toLowerCase().startsWith(`${BILLEDSTI}${c}_${d}_${t}/`)) return null
  return `${url.origin}${url.pathname}`
}
function plantegning(u: unknown): string | null {
  const s = tekst(u)
  if (!s) return null
  try {
    const url = new URL(s, ORIGIN)
    return url.host === BILLEDVAERT ? `${url.origin}${url.pathname}` : null
  } catch { return null }
}

// Ting, kilden kan finde paa at sige, som vi ikke har en plads til. Siges
// hoejt én gang pr. noegle — ikke gemt, ikke gaettet paa.
const advaret = new Set<string>()
export const _nulstilAdvarsler = () => advaret.clear()
function sigHoejt(id: string, besked: string) {
  if (advaret.has(id)) return
  advaret.add(id)
  console.warn(`[alabu] ${besked}`)
}
function ventetidSet(x: Ukendt, key: string) {
  const t = tekst(x.WaitTimeTypeText)
  if (t || x.MinWaitTimeInMonths != null) {
    sigHoejt(`ventetid:${key}`, `${key}: kilden oplyser «Forventet ventetid» `
      + `(${t ?? String(x.MinWaitTimeInMonths)}) — ansoegningsaksen er ikke modelleret `
      + 'for Alabu; se lib/kildekontrakt.ts. Oplysningen gemmes ikke.')
  }
}

/**
 * Listepayloadet → grundlag pr. bolig. EKSPLICIT: hvert felt plukkes ved
 * navn; Description, DepartmentImages, DepartmentUrl og VideoUrl laeses
 * ikke. Eksporteret KUN til proeven.
 */
export function laesListe(payload: unknown): RawListing[] {
  const ud: RawListing[] = []
  for (const raa of liste(obj(obj(payload).Data).Tenancies)) {
    const x = obj(raa)
    const c = heltal(x.CompanyId), d = heltal(x.DepartmentId), t = heltal(x.TenancyId)
    const adr = obj(x.Address)
    const gade = tekst(adr.Street), sted = tekst(adr.Location)
    const postnr = tekst(adr.ZipCode), by = tekst(adr.City)
    // Uden noegle eller adresse er det ikke en bolig, vi kan vise.
    if (c == null || d == null || t == null || !gade || !postnr || !by) continue
    const key = noegle(c, d, t)
    const koord = obj(adr.Coordinates)
    const dato = kalenderdagAf(x.MoveInDate)
    // Etage eller doer i Location («52, 4. tv», «17, st. tv») = lejlighed.
    // «28A» alene siger ingenting — typen kommer saa fra detaljens Boligart.
    const harEtage = !!sted && /\b(\d+\.|st\.|kl\.)/i.test(sted)
    const m2 = tal(x.Sqm)
    const billeder = liste(x.TenancyImages).map(obj)
      .sort((a, b) => (tal(a.SortOrder) ?? 0) - (tal(b.SortOrder) ?? 0))
      .map((b) => boligbillede(b.Url, c, d, t))
      .filter((u): u is string => u !== null)
    ventetidSet(x, key)
    ud.push({
      externalKey: key,
      sourceUrl: boligside(c, d, t),
      address: `${gade}${sted ? ' ' + sted : ''}, ${postnr} ${by}`,
      postalCode: postnr,
      // Kilden skriver m2 med én decimal (49,7); kolonnen er heltal.
      sizeM2: m2 == null ? undefined : Math.round(m2),
      rooms: heltal(x.Rooms),
      propertyType: harEtage ? 'lejlighed' : undefined,
      availableFrom: dato ?? undefined,
      // «Netto husleje» paa kortet; kildens beloeb har oerer (6046,73).
      rentMonthly: oere(x.RentNet),
      // Kortet kalder det «Indskud», praesentationsvinduet «Depositum» —
      // begge er kildens egne ord for det samme beloeb (beboerindskud).
      deposit: oere(x.Deposit),
      lat: tal(koord.Lat),
      lng: tal(koord.Lng),
      imageUrls: [...new Set(billeder)],
      // Kilden har intet statusord — kun datoen. Kontrakten afgoer resten.
      availability: dato ? { sourceAvailabilityDate: dato } : {},
    })
  }
  return ud
}

/**
 * «Mere om boligen» laegger til det, listen ikke har. Grundlaget kommer
 * fra listen og overskrives kun med det, kaldet faktisk viser.
 * Eksporteret KUN til proeven.
 */
export function laesDetalje(payload: unknown, grundlag: RawListing): RawListing {
  const x = obj(obj(payload).Data)
  const key = grundlag.externalKey
  const ud: RawListing = { ...grundlag }

  let sum = grundlag.rentMonthly ?? 0
  let andre = 0
  const ukendte: string[] = []
  for (const p of liste(x.Rents).map(obj)) {
    const navn = tekst(p.Name), beloeb = oere(p.Amount)
    if (!navn || beloeb == null) continue
    if (navn === HUSLEJEPOST) {
      if (grundlag.rentMonthly != null && beloeb !== grundlag.rentMonthly) {
        sigHoejt(`leje:${key}`, `${key}: detaljens Husleje (${beloeb}) ≠ listens RentNet `
          + `(${grundlag.rentMonthly}) — listens tal beholdes`)
      }
      continue
    }
    const felt = ACONTOPOSTER[navn]
    if (felt) ud[felt] = beloeb
    else { andre += beloeb; ukendte.push(navn) }
    sum += beloeb
  }
  if (ukendte.length) {
    ud.utilitiesOther = andre
    sigHoejt(`poster:${ukendte.join('|')}`, `ukendt(e) post(er) i Rents: ${ukendte.join(', ')} `
      + '— talt som uspecificeret aconto (utilitiesOther), ikke som varme/vand')
  }
  const total = oere(x.RentTotal)
  if (total != null && grundlag.rentMonthly != null && Math.abs(total - sum) > 100) {
    sigHoejt(`total:${key}`, `${key}: kildens «Husleje i alt» ${total} ≠ husleje + poster ${sum} øre`)
  }

  const art = tekst(x.ApartmentType)
  if (art) {
    const type = BOLIGARTER[art]
    if (type) ud.propertyType = type
    else sigHoejt(`boligart:${art}`, `ukendt Boligart «${art}» — ingen type sat; `
      + 'foej den til BOLIGARTER, naar nogen har set, hvad den daekker')
  }

  const faciliteter = liste(x.Premises).map(tekst)
    .filter((s): s is string => !!s).map((s) => s.toLowerCase())
  if (faciliteter.length) ud.amenities = [...new Set([...(grundlag.amenities ?? []), ...faciliteter])]

  const planer = liste(x.FloorPlanUrls).map(plantegning).filter((u): u is string => u !== null)
  ud.imageUrls = [...new Set([...grundlag.imageUrls, ...planer])]

  ventetidSet(x, key)
  return ud
}

/** Signaturen af de listefelter, der skal udloese ny detaljehentning.
 *  Eksporteret KUN til proeven. */
export function detaljesignatur(b: RawListing): string {
  return JSON.stringify([b.availability?.sourceAvailabilityDate ?? null, b.rentMonthly ?? null, b.deposit ?? null])
}

let budgetAdvaret = false
export const _nulstilBudgetAdvarsel = () => { budgetAdvaret = false }
function detaljeBudget(): number {
  const { budget, afvist } = laesDetaljeBudget(process.env.ALABU_DETALJEBUDGET, STANDARD_DETALJEBUDGET_ALABU)
  if (afvist && !budgetAdvaret) {
    budgetAdvaret = true
    console.warn(`[alabu] ALABU_DETALJEBUDGET IGNORERET: ${afvist}. Bruger standarden ${STANDARD_DETALJEBUDGET_ALABU}.`)
  }
  return budget
}

export function alabuAdapter(): SourceAdapter {
  const cache = new Map<string, RawListing>()

  return {
    id: 'alabu',
    sourceType: 'feed',
    host: 'alabubolig.dk',

    get detaljeBudgetPrKoersel() { return detaljeBudget() },
    listeGrundlag(url: string) {
      const grundlag = cache.get(url)
      return grundlag ? { grundlag, detaljesignatur: detaljesignatur(grundlag) } : null
    },

    async discover(): Promise<DiscoveredListing[]> {
      cache.clear()
      const res = await politeFetch(LISTE, 3, JSON_HOVEDER)
      if (!res.ok) throw new Error(`alabu liste gav ${res.status}`)
      const ud: DiscoveredListing[] = []
      for (const b of laesListe(await res.json())) {
        if (cache.has(b.sourceUrl)) continue
        cache.set(b.sourceUrl, b)
        ud.push({ externalKey: b.externalKey, url: b.sourceUrl })
      }
      return ud
    },

    async extract(url: string): Promise<RawListing> {
      const grundlag = cache.get(url)
      if (!grundlag) throw new Error(`ikke i cachen: ${url} (koer discover foerst)`)
      const ids = idsAf(grundlag.externalKey)
      if (!ids) throw new Error(`ugyldig noegle: ${grundlag.externalKey}`)
      const [c, d, t] = ids
      const res = await politeFetch(`${DETALJE}?companyId=${c}&departmentId=${d}&tenancyId=${t}`, 3, JSON_HOVEDER)
      if (!res.ok) throw new Error(`alabu detalje ${grundlag.externalKey} gav ${res.status}`)
      return laesDetalje(await res.json(), grundlag)
    },
  }
}
