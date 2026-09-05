// ═══════════════════════════════════════════════════════════════
//  Adapter-kontrakten.
//  En ny kilde skal vaere EN fil i adapters/ — ikke en ombygning.
//  Adapteren henter og laeser. Den normaliserer ikke, vasker ikke
//  adresser og skriver ikke til databasen. Det ligger centralt.
// ═══════════════════════════════════════════════════════════════

/** Boligen som kilden praesenterer den. Ravarer, ikke faerdigvarer. */
export interface RawListing {
  /** Hash af kilde-URL. Stabil paa tvaers af koersler -> upsert, ikke duplikat. */
  externalKey: string
  sourceUrl: string

  /** Kildens egen adressestreng. Vaskes centralt bagefter. */
  address: string
  postalCode?: string

  sizeM2?: number
  rooms?: number
  propertyType?: string
  availableFrom?: string        // ISO-dato

  // Oekonomi. Alt i oere. Udelad feltet helt hvis kilden ikke oplyser det —
  // et gaet her forplanter sig til totalMonthly og goer alarmerne upaalidelige.
  rentMonthly?: number
  utilitiesHeat?: number
  utilitiesWater?: number
  utilitiesElectricity?: number
  /** Aconto kilden opkraever men ikke specificerer. Uden den bliver totalen
   *  lavere end det, lejeren faktisk betaler. */
  utilitiesOther?: number
  /** Sat kun naar kilden UDTRYKKELIGT siger, at lejeren selv afregner el. */
  electricityOwnMeter?: boolean
  moveInCost?: number

  /** Kildens egne koordinater. Er de der, geokoder vi ikke. */
  lat?: number
  lng?: number

  applicationType?: 'regular' | 'waiting_list'
  rentModel?: string
  /** Naeste aabne hus, ISO. */
  openHouseAt?: string
  /** Kildens egne tidsstempler, ISO. Ikke vores observationer. */
  sourceCreatedAt?: string
  sourceUpdatedAt?: string

  amenities?: string[]
  /** Kildens egne billed-URL'er. Hotlinkes, kopieres aldrig. */
  imageUrls: string[]
  /** Hvad kilden sagde om tilgaengelighed. Se lib/kildekontrakt.ts. */
  availability?: AvailabilityFacts
  /**
   * Kilden skriver SELV, at billederne kan vaere fra en anden bolig.
   * Saettes kun, naar kilden udtrykkeligt tager forbeholdet — aldrig som
   * vores egen vurdering af, om billederne ser rigtige ud.
   */
  imagesMayDiffer?: boolean
}

/**
 * Hvad kilden sagde om tilgaengelighed. Adapterens HELE ansvar — ingen
 * fortolkning. Saettet er LUKKET: et frit feltnavn ville vaere en skjult
 * kontrakt mellem adapter og domaene, hvor en omdoebning kunne goere
 * availability forkert uden en typefejl.
 *
 * Udeladt felt = kilden sagde intet. Det er IKKE det samme som `false`.
 */
export interface AvailabilityFacts {
  /** Kildens eget statusord, uoversat. Balder: "Ledig". Propstep: "Reserved". */
  rawStatus?: string | null
  /**
   * Kildens datofelt, som det stod. NEUTRALT navngivet med vilje: en
   * Propstep-dato fra 2002 viser, at et datofelt ikke noedvendigvis
   * betyder "ledig fra". Kontrakten afgoer betydningen.
   */
  sourceAvailabilityDate?: Date | null
  /** Kildens frie tekst om overtagelse. Dacas: "Snarest". Uoversat. */
  takeoverText?: string | null
  /** Kildens eget ja/nej. home.dk: availability.isRentalAvailableNow. */
  rentalAvailableNow?: boolean | null
  /** Kildens eget ord for ansoegningsform. findbolig: "Regular"/"WaitingList". */
  rawApplicationType?: string | null
  /** Propsteps markoerer. Gemmes raat, fortolkes ikke i adapteren. */
  upcomingProject?: boolean | null
  interestListId?: string | null
  deadlineDays?: number | null
  /** Krav om bopael eller medlemskab. home.dk: isResidenceRequired. */
  residencyRequired?: boolean | null
}

export interface DiscoveredListing {
  externalKey: string
  url: string
}

export interface SourceAdapter {
  /** Skal matche sources.slug i databasen. */
  id: string
  sourceType: 'feed' | 'spider'
  /** Domaene der rate-limites paa. Ét request/sekund per domaene. */
  host: string

  /** Find alle aktuelle boliger hos kilden. Kun noegle og URL. */
  discover(): Promise<DiscoveredListing[]>

  /** Hent én bolig. Kastes der, springes den bolig over — resten koerer videre. */
  extract(url: string): Promise<RawListing>
}

/** Kilde-URL ind, stabil noegle ud. Samme URL giver altid samme noegle. */
export async function keyFromUrl(url: string): Promise<string> {
  const u = new URL(url)
  // Sporingsparametre maa ikke aendre noeglen, ellers bliver alt en dublet.
  for (const p of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref$)/i.test(p)) u.searchParams.delete(p)
  }
  u.hash = ''
  const canonical = `${u.protocol}//${u.host}${u.pathname}${u.search}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
