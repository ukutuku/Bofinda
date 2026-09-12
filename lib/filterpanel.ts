// ═══════════════════════════════════════════════════════════════
//  Filterpanelets sammenfatning.
//
//  Panelet er lukket som udgangspunkt, og så er `<summary>` det ENESTE,
//  der er synligt af det. Derfor skal linjen kunne bære alt, panelet
//  skjuler — ellers er et aktivt filter usynligt, og det er samme fejl
//  som en total, der lader som om aconto er kendt.
//
//  Ren logik: ingen database, ingen next-import. Kun `import type` fra
//  lib/soeg og `antalFiltre` fra lib/maalingsoeg, så tallet på skærmen
//  ALDRIG kan drive fra `antal_filtre` i analytics.
// ═══════════════════════════════════════════════════════════════

import type { Filtre, Soegeparametre, Sortering } from './soeg'
import { antalFiltre } from './maalingsoeg'

/**
 * Hvor mange AVANCEREDE filtre er sat?
 *
 * Udledt af `antalFiltre` ved subtraktion, ikke skrevet af. Tilføjer nogen
 * et felt til `harFiltre`/`antalFiltre`, tæller det med her af sig selv.
 * To lister ville før eller siden svare forskelligt på det samme spørgsmål.
 *
 * Stedet trækkes fra. Det er sidens primære søgning og hører til i det
 * store felt over panelet, ikke blandt de avancerede valg — talte det med,
 * ville enhver almindelig bysøgning stå som «1 aktivt filter», og tallet
 * ville holde op med at betyde «noget er skjult i panelet».
 *
 * Kan ikke blive negativt: `antalFiltre` tæller `by` og `postnr` med
 * nøjagtig det samme prædikat, `Boolean(...)`, som fratrækket bruger.
 */
export function antalAvancerede(f: Filtre): number {
  return antalFiltre(f) - (f.by ? 1 : 0) - (f.postnr ? 1 : 0)
}

/** Er der sorteret på andet end standarden? */
export function erSorteret(f: Filtre): boolean {
  return (f.sorter ?? 'nyeste') !== 'nyeste'
}

/**
 * Sammenfatningens dele. Første led er altid navnet; resten er det, der
 * ellers ville være skjult.
 *
 * DELE, ikke én streng: teksten skal kunne sættes op med det aktive tal
 * fremhævet, og en streng ville tvinge markuppen til at bygge sin egen
 * udgave af den samme sætning. Så var der to udtryk for samme spørgsmål
 * igen — ét i prøven og ét på skærmen.
 *
 * Sorteringen står for sig og tælles ALDRIG med i tallet. `filterDiff` og
 * `antalFiltre` er begge enige om, at en sortering ikke er et filter, og
 * et tal her, der sagde noget andet, ville modsige analytics. Men
 * kontrollen bor inde i panelet, så en søgning sorteret efter pris ville
 * ellers være usynlig, når panelet er lukket.
 */
export function sammenfatFlere(f: Filtre): string[] {
  const n = antalAvancerede(f)
  const dele = ['Flere filtre']
  if (n > 0) dele.push(n === 1 ? '1 aktivt' : `${n} aktive`)
  if (erSorteret(f)) dele.push('sorteret')
  return dele
}

// ═══════════════════════════════════════════════════════════════
//  Sorteringens navne — ét sted, to længder.
//
//  Kontrollen bor i panelet, og panelet er lukket som udgangspunkt. Skal
//  sorteringen også kunne ses og skiftes i resultathovedet, findes den to
//  steder på skærmen — og så må teksten komme ét sted fra. Ellers er det
//  igen to udtryk for det samme spørgsmål, som driver fra hinanden.
//
//  `Record<Sortering, …>` er ikke pynt: tilføjer nogen en sortering til
//  `SORTERINGER` i lib/soeg uden at give den et navn her, er det en
//  TYPEFEJL — ikke en tom pille, ingen opdager.
//
//  Rækkefølgen er nøglernes: JavaScript bevarer indsættelsesordenen for
//  strengnøgler, og den her er den samme, som feltet altid har vist.
//  `SORTERINGER` i lib/soeg har en anden orden, fordi den er en
//  gyldighedsliste og ikke en visning.
// ═══════════════════════════════════════════════════════════════

export const SORTERINGSNAVN: Record<Sortering, { lang: string; kort: string }> = {
  nyeste: { lang: 'nyeste først', kort: 'Nyeste' },
  pris_op: { lang: 'md. udgift, lav til høj', kort: 'Billigst' },
  pris_ned: { lang: 'md. udgift, høj til lav', kort: 'Dyrest' },
  indflytning_op: { lang: 'indflytningspris, laveste først', kort: 'Indflytning lavest' },
  indflytning_ned: { lang: 'indflytningspris, højeste først', kort: 'Indflytning højest' },
  areal_ned: { lang: 'størst først', kort: 'Størst' },
}

/** Visningsrækkefølgen. Nøglernes orden ovenfor, ikke en anden liste. */
export const SORTERINGSVALG = Object.keys(SORTERINGSNAVN) as Sortering[]

// ═══════════════════════════════════════════════════════════════
//  De aktive filtre, som noget der kan VISES og FJERNES.
//
//  `sammenfatFlere` siger «3 aktive». Det er nok til en lukket
//  <summary>, men ikke til et resultathoved: står der tre, og hun kun
//  kan huske to, skal hun åbne panelet og lede. Her står hvert filter med
//  sit navn og med de URL-parametre, det består af — så visningen kan
//  bygge et link, der fjerner netop det ene og lader resten stå.
//
//  STEDET ER IKKE MED. Det er sidens primære søgning: det står i det
//  store felt og i overskriften over listen, og en chip mere ville sige
//  det samme tredje gang. Samme afgrænsning som `antalAvancerede`, af
//  samme grund — og de to skal blive ved med at være enige.
//
//  Parameternavnene er dem, `filtreFraParametre` LÆSER. `sted` står ved
//  siden af `by`/`postnr`, fordi det store felt skriver dertil: fjerner
//  man kun det ene, kommer filteret igen ved næste indsendelse.
// ═══════════════════════════════════════════════════════════════

export interface Filterchip {
  /** Det, der står på skærmen. */
  navn: string
  /** URL-parametre, der skal væk, for at netop dette filter forsvinder. */
  fjern: string[]
}

const kr = (oere: number) => `${(oere / 100).toLocaleString('da-DK')} kr.`

/**
 * ÉN CHIP PR. FILTER — samme opdeling som `antalFiltre`.
 *
 * Fristelsen er at slå prisgrænserne sammen til «8.000–20.000 kr.»: det
 * læser pænere. Men `antalFiltre` tæller dem hver for sig, og
 * `sammenfatFlere` skriver sit tal af den — så stod der «4 aktive» over
 * tre chips, og læseren måtte selv gætte, hvad den fjerde var.
 *
 * To grænser er også to valg i praksis: man vil tit slække på loftet
 * uden at røre bunden, og med ét kryds pr. grænse kan man det.
 *
 * `npm test` tæller de to uafhængigt og sammenligner. Går de fra
 * hinanden, er det dét, prøven skal fange.
 */
export function aktiveFiltre(
  f: Filtre,
  navne: { type?: (t: string) => string; kilde?: (s: string) => string } = {},
): Filterchip[] {
  const c: Filterchip[] = []
  const typenavn = navne.type ?? ((t: string) => t)
  const kildenavn = navne.kilde ?? ((s: string) => s)

  if (f.prisMin != null) c.push({ navn: `fra ${kr(f.prisMin)}/md.`, fjern: ['prisMin'] })
  if (f.prisMax != null) c.push({ navn: `op til ${kr(f.prisMax)}/md.`, fjern: ['prisMax'] })
  if (f.vaerelserMin != null) {
    c.push({
      navn: `mindst ${f.vaerelserMin} ${f.vaerelserMin === 1 ? 'værelse' : 'værelser'}`,
      fjern: ['vaerelser'],
    })
  }
  if (f.arealMin != null) c.push({ navn: `mindst ${f.arealMin} m²`, fjern: ['areal'] })
  if (f.kilder?.length) c.push({ navn: f.kilder.map(kildenavn).join(', '), fjern: ['kilde'] })
  if (f.fuldOekonomi) c.push({ navn: 'hele økonomien oplyst', fjern: ['fuld'] })
  if (f.boligtyper?.length) {
    c.push({ navn: f.boligtyper.map(typenavn).join(', '), fjern: ['type'] })
  }
  if (f.kaeledyr) c.push({ navn: 'kæledyr tilladt', fjern: ['kaeledyr'] })
  if (f.elevator) c.push({ navn: 'elevator', fjern: ['elevator'] })
  if (f.udeplads) c.push({ navn: 'altan eller terrasse', fjern: ['udeplads'] })
  if (f.overtagelse != null) {
    c.push({
      navn: f.overtagelse === 'nu' ? 'kan overtages nu' : 'kan overtages senere',
      fjern: ['overtagelse'],
    })
  }
  if (f.ansoegningsform != null) c.push({ navn: 'venteliste', fjern: ['venteliste'] })
  if (f.markedsstatus != null) c.push({ navn: 'reserveret', fjern: ['reserveret'] })
  return c
}

// ═══════════════════════════════════════════════════════════════
//  Adresser til den samme søgning, ændret ét sted.
//
//  Her og ikke i `page.tsx`, af to grunde. Den ene er, at de hører
//  sammen med `aktiveFiltre`: chippen siger HVILKE parametre der
//  udgør filteret, og den her bygger adressen uden dem — svarer de to
//  ikke ens, fjerner krydset ikke det, chippen lover.
//  Den anden er, at en prøve skal kunne kalde dem. En side i App
//  Router må kun eksportere det, Next kender; et hjælpe-eksport dér
//  fældede en byggevalidering i en tidligere omgang.
//
//  `side` ryger altid med ud. Færre filtre eller en anden orden lægger
//  andre boliger på side 7, og et sidetal fra det gamle sæt peger
//  ingen steder i det nye. Samme regel som en ny indsendelse følger.
// ═══════════════════════════════════════════════════════════════

/** Parametrene igen, uden dem der navngives — og uden `side`. */
function udenNavne(sp: Soegeparametre, fjern: string[]): URLSearchParams {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v == null || k === 'side' || fjern.includes(k)) continue
    for (const x of Array.isArray(v) ? v : [v]) q.append(k, x)
  }
  return q
}

/** Den samme søgning uden ét eller flere filtre. */
export function soegeUrlUden(basis: string, sp: Soegeparametre, fjern: string[]): string {
  const s = udenNavne(sp, fjern).toString()
  return s ? `${basis}?${s}` : basis
}

/**
 * Den samme søgning, sorteret på en anden måde.
 *
 * `nyeste` udelader parameteren helt: den er standarden, og
 * `/?by=X` og `/?by=X&sorter=nyeste` er den samme side. To adresser
 * for ét indhold er præcis det, canonical rydder op i — vi laver dem
 * ikke selv. Samme regel som `sideUrl` følger for side 1.
 */
export function soegeUrlSorteret(basis: string, sp: Soegeparametre, valgt: Sortering): string {
  const q = udenNavne(sp, ['sorter'])
  if (valgt !== 'nyeste') q.set('sorter', valgt)
  const s = q.toString()
  return s ? `${basis}?${s}` : basis
}
