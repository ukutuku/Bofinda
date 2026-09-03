// ═══════════════════════════════════════════════════════════════
//  Udlejerens egne annoncer.
//
//  En native bolig går gennem PRÆCIS samme normalisering som en
//  importeret: samme adressevask, samme totalberegning, samme
//  boligtyper. Ellers ville de to slags boliger opføre sig forskelligt i
//  søgning, dedup og alarm — og det ville vise sig et halvt år senere.
//
//  Én undtagelse: beskrivelsen. For importerede boliger skriver vi den
//  selv, fordi kildens brødtekst ikke er vores. Her ER teksten
//  udlejerens egen, og så er det hendes, der står.
//
//  Kontaktoplysningerne gemmes og bliver stående. `is_blurred` afgør i
//  QUERY-LAGET, om de kommer ud — de nulstilles ikke i UI'et. Se
//  hentBolig i lib/soeg.ts, hvor felterne ikke engang står i select.
// ═══════════════════════════════════════════════════════════════

import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { listingImages, listings, sources } from '../db/schema'
import { SimpelAdressevask } from './address'
import { normaliser } from './normalize'
import type { Udlejer } from './auth'

export interface Boliginput {
  /** Adskilte felter. De samles KUN til visning, aldrig til parsning. */
  vej: string
  husnr: string
  etage: string | null
  doer: string | null
  postnr: string
  by: string | null
  boligtype: string
  areal: number | null
  vaerelser: number | null
  /** Alt i øre. */
  husleje: number
  varme: number | null
  vand: number | null
  el: number | null
  oevrig: number | null
  depositum: number | null
  forudbetalt: number | null
  /** ISO-dato. */
  ledigFra: string | null
  beskrivelse: string
  kontaktMail: string | null
  kontaktTlf: string | null
  /** Signerede lager-URL'er, i den rækkefølge de skal vises. */
  billeder: string[]
}

/**
 * En gemt raekke tilbage til formularens felter.
 *
 * Ligger her og ikke i siden, saa testen kan bruge PRAECIS den samme
 * afbildning som redigeringen. Var den kun i skabelonen, ville en test af
 * rundturen teste noget andet end det, brugeren rammer.
 */
export function somFormular(b: typeof listings.$inferSelect): Boliginput {
  return {
    vej: b.street ?? '',
    husnr: b.houseNumber ?? '',
    etage: b.floor,
    doer: b.door,
    postnr: b.postalCode ?? '',
    by: b.city,
    boligtype: b.propertyType ?? 'lejlighed',
    areal: b.sizeM2,
    vaerelser: b.rooms,
    husleje: b.rentMonthly ?? 0,
    varme: b.utilitiesHeat,
    vand: b.utilitiesWater,
    el: b.utilitiesElectricity,
    oevrig: b.utilitiesOther,
    depositum: b.deposit,
    forudbetalt: b.prepaidRent,
    ledigFra: b.availableFrom ? b.availableFrom.toISOString().slice(0, 10) : null,
    beskrivelse: b.description ?? '',
    kontaktMail: b.contactEmail,
    kontaktTlf: b.contactPhone,
    billeder: [],
  }
}

async function nativeKilde(): Promise<string> {
  const [k] = await db.select({ id: sources.id })
    .from(sources).where(eq(sources.slug, 'native')).limit(1)
  if (!k) throw new Error('kilden `native` mangler — se migration 0013')
  return k.id
}

/**
 * Indflytningsprisen efter vores egen model: første måneds husleje plus
 * aconto, plus depositum og forudbetalt leje. Kun når alle tre beløb
 * kendes — der regnes ikke på halve oplysninger, præcis som i adapterne.
 */
function indflytning(i: Boliginput): number | undefined {
  if (i.depositum == null || i.forudbetalt == null) return undefined
  const aconto = [i.varme, i.vand, i.el, i.oevrig]
    .reduce<number>((a, v) => a + (v ?? 0), 0)
  return i.husleje + aconto + i.depositum + i.forudbetalt
}

/**
 * Adressen som ÉN linje — til visning og til `address_raw`. Nøglerne
 * bygges ikke af den; de bygges af de adskilte felter. Se `vasketAdresse`.
 */
export function adresselinje(i: Boliginput): string {
  const etageDoer = [i.etage ? `${i.etage}.` : null, i.doer].filter(Boolean).join(' ')
  return [
    [`${i.vej} ${i.husnr}`.trim(), etageDoer].filter(Boolean).join(', '),
    [i.postnr, i.by].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

/** De adskilte felter gennem vasken, uden at gaa vejen om en streng. */
const vasketAdresse = (i: Boliginput) => new SimpelAdressevask().afDele({
  street: i.vej.trim() || null,
  houseNumber: i.husnr.trim() || null,
  floor: i.etage?.trim() || null,
  door: i.doer?.trim() || null,
  postalCode: i.postnr,
  city: i.by?.trim() || null,
})

/** Boliginput -> den samme form som en adapter leverer. */
function somRaa(i: Boliginput, id: string, url: string) {
  return {
    externalKey: id,
    sourceUrl: url,
    address: adresselinje(i),
    postalCode: i.postnr,
    sizeM2: i.areal ?? undefined,
    rooms: i.vaerelser ?? undefined,
    propertyType: i.boligtype,
    availableFrom: i.ledigFra ?? undefined,
    rentMonthly: i.husleje,
    utilitiesHeat: i.varme ?? undefined,
    utilitiesWater: i.vand ?? undefined,
    utilitiesElectricity: i.el ?? undefined,
    utilitiesOther: i.oevrig ?? undefined,
    moveInCost: indflytning(i),
    imageUrls: i.billeder,
  }
}

const base = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'https://bofinda.dk'

/**
 * PRAECIS de kolonner, udlejerens formular styrer.
 *
 * Foer skrev opdateringen `...normaliser(...)` — hele objektet. Det er
 * farligt paa to maader: felter formularen ikke kender (faciliteter,
 * aabent hus, kildens datoer) blev nulstillet af en rettelse, og felter
 * formularen ikke kunne INDLAESE blev skrevet tomme hen over det gemte.
 * Det sidste kostede en udlejer sin indflytningspris.
 *
 * Listen her er derfor eksplicit. Staar en kolonne ikke i den, kan en
 * redigering ikke roere den — uanset hvad normaliseringen returnerer.
 */
function fraFormular(n: Awaited<ReturnType<typeof normaliser>>, i: Boliginput) {
  return {
    addressRaw: n.addressRaw,
    street: n.street, houseNumber: n.houseNumber, floor: n.floor, door: n.door,
    postalCode: n.postalCode, city: n.city,
    unitAddressUuid: n.unitAddressUuid, accessAddressUuid: n.accessAddressUuid,
    addressMatchLevel: n.addressMatchLevel,
    propertyType: n.propertyType,
    sizeM2: n.sizeM2, rooms: n.rooms, availableFrom: n.availableFrom,
    rentMonthly: n.rentMonthly,
    utilitiesHeat: n.utilitiesHeat, utilitiesWater: n.utilitiesWater,
    utilitiesElectricity: n.utilitiesElectricity, utilitiesOther: n.utilitiesOther,
    totalMonthly: n.totalMonthly, totalMonthlyComponents: n.totalMonthlyComponents,
    // Gemmes hver for sig OG som sum. Summen er det, siden viser; delene
    // er det, formularen skal kunne laese tilbage.
    deposit: i.depositum, prepaidRent: i.forudbetalt,
    moveInCost: n.moveInCost,
    // Udlejerens egen tekst, ikke vores genererede.
    description: i.beskrivelse.trim() || n.description,
    contactEmail: i.kontaktMail, contactPhone: i.kontaktTlf,
    lastFetchedAt: new Date(),
  }
}

export async function opretBolig(u: Udlejer, i: Boliginput): Promise<string> {
  // Id'et laves foerst, saa sourceUrl kan pege paa boligens egen side.
  // Kolonnen er NOT NULL, og en native bolig har ingen kilde at pege paa.
  const id = crypto.randomUUID()
  const n = await normaliser(somRaa(i, id, `${base()}/bolig/${id}`), await vasketAdresse(i))

  await db.insert(listings).values({
    ...fraFormular(n, i),
    id,
    externalKey: n.externalKey,
    sourceUrl: n.sourceUrl,
    sourceId: await nativeKilde(),
    sourceType: 'native',
    landlordId: u.id,
    // Muren staar ved kontakt. Feltet er sandt fra foerste sekund.
    isBlurred: true,
    status: 'active',
    lastSeenAt: new Date(),
  })
  await skrivBilleder(id, i.billeder)
  return id
}

export async function opdaterBolig(u: Udlejer, id: string, i: Boliginput): Promise<void> {
  await minEllerKast(u, id)
  const n = await normaliser(somRaa(i, id, `${base()}/bolig/${id}`), await vasketAdresse(i))
  await db.update(listings)
    .set(fraFormular(n, i))
    .where(eq(listings.id, id))
  await db.delete(listingImages).where(eq(listingImages.listingId, id))
  await skrivBilleder(id, i.billeder)
}

/** Fjernelse er blød: annoncen afmeldes, som en importeret bolig der
 *  forsvinder. Så beholder vi historikken, og udlejeren kan sætte den op
 *  igen uden at skrive alt ind på ny. */
export async function fjernBolig(u: Udlejer, id: string): Promise<void> {
  await minEllerKast(u, id)
  await db.update(listings)
    .set({ status: 'delisted', delistedAt: new Date() })
    .where(eq(listings.id, id))
}

export async function genudgivBolig(u: Udlejer, id: string): Promise<void> {
  await minEllerKast(u, id)
  await db.update(listings)
    .set({ status: 'active', delistedAt: null, lastSeenAt: new Date() })
    .where(eq(listings.id, id))
}

/** Kaster, hvis boligen ikke er udlejerens. Ejerskabet tjekkes i
 *  databasen, aldrig paa noget UI'et har sendt med. */
async function minEllerKast(u: Udlejer, id: string) {
  const [r] = await db.select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.landlordId, u.id)))
    .limit(1)
  if (!r) throw new Error('boligen findes ikke, eller den er ikke din')
}

async function skrivBilleder(id: string, urler: string[]) {
  if (!urler.length) return
  await db.insert(listingImages).values(
    urler.map((url, i) => ({ listingId: id, externalUrl: url, position: i })),
  )
}

export async function mineBoliger(u: Udlejer) {
  return db.select({
    id: listings.id,
    adresse: listings.addressRaw,
    postnr: listings.postalCode,
    by: listings.city,
    status: listings.status,
    leje: listings.rentMonthly,
    total: listings.totalMonthly,
    areal: listings.sizeM2,
    vaerelser: listings.rooms,
    oprettet: listings.firstSeenAt,
  })
    .from(listings)
    .where(eq(listings.landlordId, u.id))
    .orderBy(desc(listings.firstSeenAt))
}
