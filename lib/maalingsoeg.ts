// ═══════════════════════════════════════════════════════════════
//  Søgesidens events, udledt af filtrene.
//
//  Ren logik: ingen database, ingen next-import. Kun `import type` fra
//  lib/soeg, som forsvinder ved oversættelse.
//
//  ── REFERER-FÆLDEN ────────────────────────────────────────────
//  Filter- og sorteringsevents måles ved at sammenligne den indsendte
//  søgning med den forrige URL fra `Referer`. Det virker uden
//  JavaScript, uden cookie og uden samtykke, og det tæller kun filtre,
//  brugeren FAKTISK sendte af sted — ikke en dropdown, hun rørte og
//  fortrød.
//
//  MEN VORES EGEN URL BÆRER BRUGERENS RÅ `sted`- OG `by`-FRITEKST.
//  Et søgefelt med «Anna Hansen, Vestergade 12» står i ?sted= og dermed
//  i næste requests Referer. Referer-strengen og dens parametre må
//  derfor ALDRIG ind i et event. Kun feltnavne og typede, kanoniske
//  værdier kommer ud herfra — `by` bliver til `by_kendt`/`by_ukendt`,
//  aldrig til teksten selv. Værnet i lib/maaling.ts ville afvise resten,
//  men koden skal ikke læne sig på det.
// ═══════════════════════════════════════════════════════════════

import type { Filtre } from './soeg'
import type { Filteruddrag, Filterfelt, Haendelse, StedSlags } from './maaling'

/** Byer, vi selv kender. Kun en træffer her må gemmes som `canonical_city`. */
export type Bykender = (by: string) => boolean

/**
 * Det kategoriske uddrag af en søgning.
 *
 * `by` gemmes KUN, hvis den matcher en by i vores egen bestand
 * (`facetter().byer`). Så er værdien ikke længere fritekst, men et element
 * i en lukket mængde, vi selv ejer. Rammer den ikke, gemmes den ikke —
 * og `sted_slags` fortæller, at nogen søgte på et sted, vi ikke kender,
 * hvilket i sig selv er værd at vide.
 */
export function uddrag(f: Filtre, kender: Bykender): Filteruddrag & { sted_slags: StedSlags } {
  const kendtBy = f.by ? kender(f.by) : false
  const sted_slags: StedSlags = f.postnr ? 'postnr'
    : f.by ? (kendtBy ? 'by_kendt' : 'by_ukendt')
      : 'ingen'
  const faciliteter = [
    f.kaeledyr && 'kaeledyr', f.elevator && 'elevator', f.udeplads && 'udeplads',
  ].filter((x): x is string => typeof x === 'string')

  return {
    sted_slags,
    ...(kendtBy && f.by ? { canonical_city: f.by } : {}),
    ...(f.postnr ? { postnr: f.postnr } : {}),
    ...(f.prisMin != null ? { price_min: f.prisMin } : {}),
    ...(f.prisMax != null ? { price_max: f.prisMax } : {}),
    ...(f.vaerelserMin != null ? { rooms_min: f.vaerelserMin } : {}),
    ...(f.arealMin != null ? { area_min: f.arealMin } : {}),
    ...(f.boligtyper?.length ? { property_types: f.boligtyper.slice(0, 10) } : {}),
    ...(f.kilder?.length ? { kilde: f.kilder[0] } : {}),
    ...(f.overtagelse ? { overtagelse: f.overtagelse } : {}),
    ...(f.ansoegningsform ? { venteliste: true } : {}),
    ...(f.markedsstatus ? { reserveret: true } : {}),
    ...(f.fuldOekonomi ? { full_economy: true } : {}),
    ...(faciliteter.length ? { facilities: faciliteter } : {}),
  }
}

/**
 * Hvor mange filtre er sat?
 *
 * Præcis de samme felter som `harFiltre` i lib/soeg.ts spørger om — ellers
 * ville «har hun filtreret?» og «hvor mange filtre?» svare på hver sit
 * spørgsmål, og de to ville drive fra hinanden uden at nogen så det.
 */
export function antalFiltre(f: Filtre): number {
  const sat: boolean[] = [
    Boolean(f.by), Boolean(f.postnr),
    f.prisMin != null, f.prisMax != null,
    f.vaerelserMin != null, f.arealMin != null,
    Boolean(f.kilder?.length), Boolean(f.fuldOekonomi),
    Boolean(f.boligtyper?.length),
    Boolean(f.kaeledyr), Boolean(f.elevator), Boolean(f.udeplads),
    f.overtagelse != null, f.ansoegningsform != null, f.markedsstatus != null,
  ]
  return sat.filter(Boolean).length
}

/** Feltnavn i URL'en → værdien, som den må se ud i et event. */
type Felter = Partial<Record<Filterfelt, string | number | boolean>>

function felter(f: Filtre, kender: Bykender): Felter {
  const u: Felter = {}
  // `by` bliver til en KATEGORI, aldrig til teksten. Det er her fælden
  // ovenfor lukkes — resten af filtrene er tal og lukkede enums.
  if (f.by) u.by = kender(f.by) ? 'by_kendt' : 'by_ukendt'
  if (f.postnr) u.postnr = f.postnr
  if (f.prisMin != null) u.prisMin = f.prisMin
  if (f.prisMax != null) u.prisMax = f.prisMax
  if (f.vaerelserMin != null) u.vaerelser = f.vaerelserMin
  if (f.arealMin != null) u.areal = f.arealMin
  if (f.boligtyper?.length) u.type = f.boligtyper.join(',')
  if (f.kilder?.length) u.kilde = f.kilder.join(',')
  if (f.overtagelse) u.overtagelse = f.overtagelse
  if (f.ansoegningsform) u.venteliste = true
  if (f.markedsstatus) u.reserveret = true
  if (f.fuldOekonomi) u.fuld = true
  if (f.kaeledyr) u.kaeledyr = true
  if (f.elevator) u.elevator = true
  if (f.udeplads) u.udeplads = true
  return u
}

/**
 * Hvad brugeren ændrede mellem den forrige URL og denne.
 *
 * Er `foer` null — direkte link, bogmærke, streng browserindstilling —
 * fyrer der intet. Det er det rigtige: så ændrede hun ikke et filter,
 * hun åbnede en adresse.
 *
 * Ryddes ALLE filtre på én gang («Nulstil» går til `/`), kollapser det
 * til ÉT `filter_cleared` med `felt: 'alle'` i stedet for en byge på fem.
 */
export function filterDiff(
  foer: Filtre | null, nu: Filtre, kender: Bykender,
): Haendelse[] {
  if (!foer) return []
  const a = felter(foer, kender)
  const b = felter(nu, kender)
  const ud: Haendelse[] = []

  const ryddede = (Object.keys(a) as Filterfelt[]).filter((k) => b[k] === undefined)
  const efter = Object.keys(b).length

  if (ryddede.length > 1 && efter === 0) {
    ud.push({
      navn: 'filter_cleared',
      props: { felt: 'alle', antal_ryddet: ryddede.length },
    })
  } else {
    for (const k of ryddede) {
      ud.push({ navn: 'filter_cleared', props: { felt: k, fra: String(a[k]) } })
    }
  }

  for (const k of Object.keys(b) as Filterfelt[]) {
    if (a[k] === b[k]) continue
    ud.push({
      navn: 'filter_applied',
      props: {
        felt: k,
        til: String(b[k]),
        ...(a[k] !== undefined ? { fra: String(a[k]) } : {}),
        antal_filtre_efter: efter,
      },
    })
  }

  // Sorteringen er ikke et filter og tælles ikke som ét, men den er en
  // handling, brugeren udførte, og den har sit eget event.
  const s1 = foer.sorter ?? 'nyeste'
  const s2 = nu.sorter ?? 'nyeste'
  if (s1 !== s2) ud.push({ navn: 'sort_changed', props: { til: s2, fra: s1 } })

  return ud
}

/**
 * Filtrene i den forrige URL, hvis den var vores egen.
 *
 * Kun stien og query'en bruges, og kun gennem `filtreFraParametre` — den
 * samme parsing, siden selv bruger. Strengen forlader aldrig denne
 * funktion.
 */
export function forrigeFiltre(
  referer: string | null,
  base: string | undefined,
  parse: (sp: Record<string, string | string[] | undefined>) => Filtre,
): Filtre | null {
  if (!referer) return null
  let u: URL
  try { u = new URL(referer) } catch { return null }
  if (base) {
    try { if (new URL(base).host !== u.host) return null } catch { /* ingen base */ }
  }
  if (u.pathname !== '/') return null
  const sp: Record<string, string | string[]> = {}
  for (const [k, v] of u.searchParams) {
    const nu = sp[k]
    if (nu === undefined) sp[k] = v
    else if (Array.isArray(nu)) nu.push(v)
    else sp[k] = [nu, v]
  }
  return parse(sp)
}
