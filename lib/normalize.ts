// ═══════════════════════════════════════════════════════════════
//  Normalisering: RawListing -> raekke i listings.
//
//  Ligger centralt, ikke i adapteren. En ny kilde skal vaere én fil, der
//  laeser — ikke én der ogsaa fortolker.
//
//  Grundreglen hele vejen igennem: et felt kilden ikke oplyser, bliver
//  null. Ikke nul, ikke et estimat, ikke et eksempelbillede.
// ═══════════════════════════════════════════════════════════════

import type { Forbeholdsbelaeg } from './billedforbehold'
import type { AvailabilityFacts, RawListing } from './adapter'
import type { Overtagelsesudsagn } from './availability'
import { vaskAdresse } from './address'
import { oereTilKroner } from './money'
import { eltilstand } from './eloplysning'
import { POSTNAVN, elUdsagn } from './grundlag'
import { paaDansk } from './liste'
import { typenavn } from './boligtype'

export type Boligtype =
  | 'lejlighed' | 'hus' | 'raekkehus' | 'vaerelse' | 'studiebolig' | 'andet'

/**
 * Kildens ord -> vores enum. Kan typen ikke afgoeres, returneres null.
 * 'andet' betyder "kendt, og ingen af de andre" — ikke "vi ved det ikke".
 */
export function normaliserBoligtype(raw: string | null | undefined): Boligtype | null {
  if (!raw) return null
  const s = raw.toLowerCase().trim()
  const tabel: [RegExp, Boligtype][] = [
    [/r(æ|ae)kkehus|kaedehus|tv(æ|ae)rhus|townhouse/, 'raekkehus'],
    [/lejlighed|apartment|flat|etagebolig/, 'lejlighed'],
    [/studiebolig|kollegie|ungdomsbolig|student/, 'studiebolig'],
    [/v(æ|ae)relse|room|delebolig|bofaellesskab/, 'vaerelse'],
    [/villa|hus|house|bungalow|landejendom/, 'hus'],
  ]
  for (const [re, type] of tabel) if (re.test(s)) return type
  return null
}

const ACONTO = ['heat', 'water', 'electricity', 'other'] as const

export interface Total {
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
}

/**
 * Summen af husleje og aconto — og listen over hvad der faktisk er talt med.
 *
 * Saettes KUN naar huslejen er kendt OG mindst én aconto-post er kendt.
 * Kender vi kun huslejen, ville en "total" lig huslejen paastaa, at der
 * ikke er andre udgifter. Det ved vi ikke, saa totalen forbliver null.
 *
 * Det er hele forskellen paa vores loefte og konkurrenternes tal.
 */
export function beregnTotal(r: RawListing): Total {
  if (r.rentMonthly == null) return { totalMonthly: null, totalMonthlyComponents: null }

  const med: string[] = ['rent']
  let sum = r.rentMonthly
  const poster = {
    heat: r.utilitiesHeat,
    water: r.utilitiesWater,
    electricity: r.utilitiesElectricity,
    other: r.utilitiesOther,
  }
  for (const n of ACONTO) {
    const v = poster[n]
    if (v != null) { sum += v; med.push(n) }
  }

  if (med.length === 1) return { totalMonthly: null, totalMonthlyComponents: null }
  return { totalMonthly: sum, totalMonthlyComponents: med }
}

/**
 * "Fuld oekonomi" = huslejen og samtlige aconto-poster, UDLEJEREN opkraever.
 *
 * El indgaar med vilje ikke i kravet. I dansk udlejning har lejeren normalt
 * sin egen elmaaler og sin egen aftale med elselskabet — el er saa ikke
 * udlejerens opkraevning, og at kraeve den ville goere loeftet umuligt at
 * indfri. Opkraever udlejeren alligevel el aconto, taeller den med som
 * enhver anden post.
 *
 * Kravet er derfor: husleje kendt, og mindst én NAVNGIVEN aconto-post kendt.
 * Vi kan ikke skelne "ingen aconto" fra "aconto ikke oplyst", saa en bolig
 * med husleje alene regnes ikke som fuld.
 *
 * `other` alene taeller IKKE. Nogle kilder — Dacas og Lokalbolig — oplyser
 * kun "Aconto pr. md.: 900 kr." uden at sige hvad den daekker. Totalen bliver
 * rigtig, og den staar paa kortet som "i alt"; men vi ved ikke, OM varme og
 * vand er med, og "hele oekonomien oplyst" ville vaere en paastand om noget,
 * vi ikke har faaet at vide. Prisen er kendt; sammensaetningen er det ikke.
 */
const NAVNGIVNE_POSTER = ['heat', 'water', 'electricity'] as const

export const erFuldOekonomi = (k: string[] | null): boolean =>
  k != null && k.includes('rent')
  && k.some((n) => (NAVNGIVNE_POSTER as readonly string[]).includes(n))

const MDR = ['januar','februar','marts','april','maj','juni',
             'juli','august','september','oktober','november','december']

/**
 * Beskrivelsen bygges af vores egne strukturerede felter. Kildens
 * broedtekst kopieres aldrig — fakta er frie, prosa er ikke. Sidegevinsten
 * er ensartet tone paa tvaers af alle kilder.
 *
 * Kun saetninger for felter vi faktisk har. Ingen udfyldning.
 */
/**
 * Beskrivelsen: GEMT for udlejerens egne ord, UDLEDT for alt andet.
 *
 * ── HVORFOR UDLEDT OG IKKE GEMT ───────────────────────────────
 *
 * For en importeret bolig er beskrivelsen en funktion af rækkens egne
 * kolonner og intet andet. En GEMT udledning af en rækkes egne felter er
 * to udtryk for ét spørgsmål ved konstruktion: den kan ikke andet end at
 * drive fra hinanden, så snart noget skriver et af felterne uden at
 * skrive teksten med. Og vi kender raten — 2.125 rækker skrevet om 27.
 * september, 22 drevet fra hinanden fire dage senere.
 *
 * En synkroniseringsvagt ville have holdt de to ens. Men en vagt mod et
 * problem, der ikke behøver findes, er et dårligere resultat end ikke at
 * have problemet. Målingen afgjorde det:
 *
 *   · ÉT læsested — `hentBolig` → app/bolig/[id]/page.tsx. Ikke i
 *     KORTFELTER, så søgesiden og områdesiderne henter den aldrig.
 *   · INTET indeks, ingen tsvector, ingen fritekstsøgning. Projektets
 *     eneste `ilike` står på `city`.
 *   · Ikke i noget meta-tag (boligsiden har ingen generateMetadata),
 *     ikke i JSON-LD, ikke i sitemap.ts, ikke i alarmmailen.
 *   · 2,91 µs pr. kald, målt (median af 9 runder à 2.000 kald). Ét kald
 *     pr. visning af en boligside.
 *
 * ── UNDTAGELSEN, SOM IKKE MÅ FALDE VÆK ────────────────────────
 *
 * For `native` er feltet BRUGERINDHOLD. `lib/udlejer.ts:263` lader
 * udlejerens egne ord vinde over den udledte tekst, og de ord findes
 * intet andet sted. Udleder vi dem, er de væk. Lader hun feltet stå
 * tomt, har samme linje allerede lagt udledningen i kolonnen, så det
 * gemte er rigtigt i begge tilfælde.
 *
 * Delingen er `sourceType = 'native'` — præcis den, backfillen brugte.
 *
 * Inputtypen er bundet til `genererBeskrivelse`s egen med
 * `Parameters<...>[0]`. Får generatoren et felt mere, kan det her ikke
 * oversættes uden at få det med.
 */
export function beskrivelseFor(
  r: Parameters<typeof genererBeskrivelse>[0] & {
    /** `sourceType === 'native'`. Udlejerens egne ord er ikke en udledning. */
    erUdlejerannonce: boolean
    gemtBeskrivelse: string | null
  },
): string | null {
  if (r.erUdlejerannonce) return r.gemtBeskrivelse
  return genererBeskrivelse(r)
}

export function genererBeskrivelse(f: {
  propertyType: Boligtype | null
  rooms: number | null
  sizeM2: number | null
  street: string | null
  houseNumber: string | null
  postalCode: string | null
  city: string | null
  rentMonthly: number | null
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
  // De to felter er her UDELUKKENDE for at kunne kalde `eltilstand`.
  // Uden dem maatte beskrivelsen afgoere el-spoergsmaalet selv, og saa
  // havde vi et udtryk mere for noget, der allerede er beregnet ét sted.
  utilitiesElectricity: number | null
  electricityOwnMeter: boolean | null
  /**
   * DOMAENETS svar paa overtagelsen — ikke `listings.available_from`.
   * Feltet er bevidst ikke valgfrit: en kalder, der ikke kan skaffe
   * domaenet, skal SKRIVE `{ slags: 'ukendt' }` og dermed vaelge tavshed.
   * Et valgfrit felt ville lade den samme udeladelse ske ved et uheld.
   */
  overtagelse: Overtagelsesudsagn
}): string | null {
  const kr = (o: number) => oereTilKroner(o).toLocaleString('da-DK')
  const s: string[] = []

  // Typen aabner saetningen, saa den skal have stort forbogstav. Navnet
  // kommer fra lib/boligtype.ts; det er den sjette kopi, der laa her.
  // «Bolig» er IKKE `andet`s navn — det er faldbacken for en raekke
  // UDEN en type, og de to faldt foer sammen i det samme ord.
  const type = f.propertyType ? typenavn(f.propertyType) : 'Bolig'
  const dele = [
    f.rooms != null ? `${f.rooms} ${f.rooms === 1 ? 'værelse' : 'værelser'}` : null,
    f.sizeM2 != null ? `${f.sizeM2} m²` : null,
  ].filter(Boolean)
  const sted = [f.street, f.houseNumber].filter(Boolean).join(' ')
  const bydel = [f.postalCode, f.city].filter(Boolean).join(' ')

  let f1 = type
  if (dele.length) f1 += ` på ${dele.join(' og ')}`
  if (sted) f1 += ` på ${sted}`
  if (bydel) f1 += sted ? ` i ${bydel}` : ` i ${bydel}`
  s.push(f1 + '.')

  if (f.rentMonthly != null) {
    if (f.totalMonthly != null && f.totalMonthlyComponents) {
      // ═══ «TIL UDLEJEREN», IKKE «DEN SAMLEDE UDGIFT» ═══
      //
      // Her stod «Med varme og vand er den samlede månedlige udgift
      // 10.500 kr.» Det er en påstand om fuldstændighed om NØJAGTIG det
      // tal, kortet tager forbehold for — og det er den «i alt», som
      // prisetiketten blev døbt om for at undgå (el står uden for
      // beløbet hos næsten alle kilder).
      //
      // Målt 24. september 2026: 2.090 rækker bar sætningen. 2.064 af
      // dem i en el-tilstand, hvor den lover for meget; kun de 26 med el
      // som navngiven post kunne bære den. Værst er de 28 egen-måler-
      // boliger: detaljesiden skriver ordret «Det indgår ikke i
      // beløbet», og beskrivelsen kaldte samme tal samlet. Modsatte
      // påstande, samme skærm.
      const tilstand = eltilstand({
        total: f.totalMonthly,
        el: f.utilitiesElectricity,
        elEgenMaaler: f.electricityOwnMeter,
        poster: f.totalMonthlyComponents,
      })
      // Forbeholdet er IKKE formuleret her. `elUdsagn` er de tre
      // formuleringer, der findes, og kortet bruger de samme. Et femte
      // udtryk for noget, der allerede er beregnet ét sted, er præcis
      // det, denne ændring findes for at undgå.
      const forbehold = elUdsagn(tilstand)

      // Hvad dækker beløbet? Samme tre svar som grundlagslinjen giver,
      // og ordret dens ord for klumpen.
      let grundlag: string
      if (tilstand === 'ukendt-daekning') {
        grundlag = 'ét samlet acontobeløb'
      } else {
        const navne = f.totalMonthlyComponents
          .filter((k) => k !== 'rent')
          .map((k) => POSTNAVN[k])
        // Kan ét led ikke oversættes — eller er der intet led — kan
        // listen ikke opregnes. «aconto» er sandt uanset hvad det
        // ukendte led er. Det gamle `?? k` skrev nøglen råt ud, og den
        // tomme liste gav ordet «undefined» midt i sætningen.
        grundlag = navne.length > 0 && !navne.some((x) => x == null)
          ? paaDansk(navne)
          : 'aconto'
      }

      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Med ${grundlag} betales ${kr(f.totalMonthly)} kr. om måneden `
        + `til udlejeren${forbehold ? ` — ${forbehold}` : ''}.`)
    } else {
      s.push(`Husleje ${kr(f.rentMonthly)} kr. om måneden. `
        + `Kilden oplyser ikke aconto, så den samlede udgift kendes ikke.`)
    }
  }

  // Samme udsagn som faktablokken paa boligsiden — kun ordene er en
  // saetning i stedet for en etiket. `ukendt` giver INGEN saetning: en
  // tekst, der tier, modsiger ikke en faktablok, der siger «vi kan ikke
  // fastslaa det». En tekst, der gaetter, goer. Se noten ved
  // `Overtagelsesudsagn` i lib/availability.ts.
  const o = f.overtagelse
  if (o.slags === 'nu') s.push('Kan overtages nu.')
  else if (o.slags === 'snarest') s.push('Kilden skriver, at boligen kan overtages snarest.')
  else if (o.slags === 'senere') {
    const [aar, md, dag] = o.dato.split('-').map(Number)
    s.push(`Ledig fra ${dag}. ${MDR[md! - 1]} ${aar}.`)
  } else if (o.slags === 'senere-uden-dato') {
    s.push('Boligen kan overtages senere; kilden oplyser ikke hvornår.')
  } else if (o.slags === 'conflict') {
    s.push('Kilden oplyser modstridende ting om, hvornår boligen kan overtages.')
  }

  return s.length ? s.join(' ') : null
}

export interface NormaliseretBolig {
  externalKey: string
  sourceUrl: string
  addressRaw: string
  street: string | null
  houseNumber: string | null
  floor: string | null
  door: string | null
  postalCode: string | null
  city: string | null
  unitAddressUuid: string | null
  accessAddressUuid: string | null
  addressMatchLevel: 'unit' | 'access' | 'failed'
  lat: string | null
  lng: string | null
  propertyType: Boligtype | null
  sizeM2: number | null
  rooms: number | null
  availableFrom: Date | null
  rentMonthly: number | null
  utilitiesHeat: number | null
  utilitiesWater: number | null
  utilitiesElectricity: number | null
  utilitiesOther: number | null
  electricityOwnMeter: boolean | null
  totalMonthly: number | null
  totalMonthlyComponents: string[] | null
  moveInCost: number | null
  /** Kildens egne beloeb, hver for sig — se noten i RawListing. */
  deposit: number | null
  prepaidRent: number | null
  applicationType: 'regular' | 'waiting_list' | null
  rentModel: string | null
  openHouseAt: Date | null
  sourceCreatedAt: Date | null
  sourceUpdatedAt: Date | null
  amenities: string[]
  description: string | null
  imageUrls: string[]
  /** Kilden oplyser selv, at billederne kan vaere fra en anden bolig. */
  imagesMayDiffer: boolean
  imagesMayDifferEvidence: Forbeholdsbelaeg | undefined
  /** Ren gennemstilling — normalisering FORTOLKER ikke availability. */
  availability: AvailabilityFacts | null
}

const dato = (s: string | undefined | null): Date | null => {
  if (!s) return null
  const d = new Date(s)
  return isNaN(+d) ? null : d
}

/**
 * `vasket` gives, naar adressen ALLEREDE er adskilt i felter — en udlejer
 * taster vej, husnummer, etage og doer hver for sig. At samle dem til én
 * streng og parse den igen er at kaste oplysninger vaek og gaette dem
 * tilbage. Se SimpelAdressevask.afDele.
 */
export async function normaliser(
  r: RawListing,
  vasket?: Awaited<ReturnType<typeof vaskAdresse>>,
): Promise<NormaliseretBolig> {
  // Kildens eget postnummer bruges som fallback, hvis strengen ikke bar det.
  const adr = vasket ?? await vaskAdresse(r.address, { postalCode: r.postalCode })
  const postalCode = adr.postalCode ?? r.postalCode ?? null

  const propertyType = normaliserBoligtype(r.propertyType)
  const { totalMonthly, totalMonthlyComponents } = beregnTotal(r)
  const availableFrom = r.availableFrom ? new Date(r.availableFrom) : null

  return {
    externalKey: r.externalKey,
    sourceUrl: r.sourceUrl,
    addressRaw: r.address,
    street: adr.street,
    houseNumber: adr.houseNumber,
    floor: adr.floor,
    door: adr.door,
    postalCode,
    city: adr.city,
    unitAddressUuid: adr.unitAddressUuid,
    accessAddressUuid: adr.accessAddressUuid,
    addressMatchLevel: adr.addressMatchLevel,
    // Kildens egne koordinater vinder. Vaskeren har dem ikke endnu.
    lat: r.lat != null ? String(r.lat) : adr.lat,
    lng: r.lng != null ? String(r.lng) : adr.lng,
    propertyType,
    // Kilder oplyser areal med decimal (findbolig: "134.5"). Kolonnen er
    // heltal, og et kvadratmeter-komma har ingen betydning for hverken
    // soegning eller visning. Rundes centralt, saa ingen adapter skal huske
    // det — og saa en decimal aldrig kan vaelte en hel raekke igen.
    sizeM2: r.sizeM2 == null ? null : Math.round(r.sizeM2),
    rooms: r.rooms == null ? null : Math.round(r.rooms),
    availableFrom: availableFrom && !isNaN(+availableFrom) ? availableFrom : null,
    rentMonthly: r.rentMonthly ?? null,
    utilitiesHeat: r.utilitiesHeat ?? null,
    utilitiesWater: r.utilitiesWater ?? null,
    utilitiesElectricity: r.utilitiesElectricity ?? null,
    utilitiesOther: r.utilitiesOther ?? null,
    electricityOwnMeter: r.electricityOwnMeter ?? null,
    totalMonthly,
    totalMonthlyComponents,
    moveInCost: r.moveInCost ?? null,
    deposit: r.deposit ?? null,
    prepaidRent: r.prepaidRent ?? null,
    applicationType: r.applicationType ?? null,
    rentModel: r.rentModel ?? null,
    openHouseAt: dato(r.openHouseAt),
    sourceCreatedAt: dato(r.sourceCreatedAt),
    sourceUpdatedAt: dato(r.sourceUpdatedAt),
    // Ingen pladsholder. Fandt adapteren ingen billeder, er listen tom.
    imageUrls: r.imageUrls ?? [],
    // Standard er false: de fleste kilder tager intet forbehold, og et
    // forbehold, ingen har oplyst, ville vaere vores egen paastand.
    // ÉT UDTRYK. Booleanen udledes af belaegget, saa de to ikke kan
    // saettes hver for sig og drive fra hinanden. Et faktum uden
    // spaend findes ikke — og en boolean uden faktum gaar ikke ind.
    imagesMayDiffer: r.imagesMayDifferEvidence != null,
    imagesMayDifferEvidence: r.imagesMayDifferEvidence,
    availability: r.availability ?? null,
    amenities: r.amenities ?? [],
    description: genererBeskrivelse({
      propertyType, rooms: r.rooms ?? null, sizeM2: r.sizeM2 ?? null,
      street: adr.street, houseNumber: adr.houseNumber, postalCode, city: adr.city,
      rentMonthly: r.rentMonthly ?? null, totalMonthly, totalMonthlyComponents,
      utilitiesElectricity: r.utilitiesElectricity ?? null,
      electricityOwnMeter: r.electricityOwnMeter ?? null,
      // DEN GEMTE tekst siger INTET om overtagelsen, og det er et valg.
      // Domaenets svar afhaenger af `referenceNow` — «senere» bliver «nu»,
      // naar dagen kommer — saa en saetning, der stoebes ved importen, er
      // en gemt udledning, der begynder at drive samme sekund. Den viste
      // tekst regnes i `hentBolig` af domaenet; se `beskrivelseFor`.
      overtagelse: { slags: 'ukendt' },
    }),
  }
}
