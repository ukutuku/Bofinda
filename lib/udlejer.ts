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
import { normaliser } from './normalize'
import type { Udlejer } from './auth'

export interface Boliginput {
  adresse: string
  postnr: string
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

/** Boliginput -> den samme form som en adapter leverer. */
function somRaa(i: Boliginput, id: string, url: string) {
  return {
    externalKey: id,
    sourceUrl: url,
    address: i.adresse,
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

export async function opretBolig(u: Udlejer, i: Boliginput): Promise<string> {
  // Id'et laves foerst, saa sourceUrl kan pege paa boligens egen side.
  // Kolonnen er NOT NULL, og en native bolig har ingen kilde at pege paa.
  const id = crypto.randomUUID()
  const n = await normaliser(somRaa(i, id, `${base()}/bolig/${id}`))

  await db.insert(listings).values({
    ...n,
    id,
    sourceId: await nativeKilde(),
    sourceType: 'native',
    landlordId: u.id,
    // Udlejerens egen tekst, ikke vores genererede.
    description: i.beskrivelse.trim() || n.description,
    contactEmail: i.kontaktMail,
    contactPhone: i.kontaktTlf,
    // Muren staar ved kontakt. Feltet er sandt fra foerste sekund.
    isBlurred: true,
    status: 'active',
    lastSeenAt: new Date(),
    lastFetchedAt: new Date(),
  })
  await skrivBilleder(id, i.billeder)
  return id
}

export async function opdaterBolig(u: Udlejer, id: string, i: Boliginput): Promise<void> {
  await minEllerKast(u, id)
  const n = await normaliser(somRaa(i, id, `${base()}/bolig/${id}`))
  await db.update(listings).set({
    ...n,
    description: i.beskrivelse.trim() || n.description,
    contactEmail: i.kontaktMail,
    contactPhone: i.kontaktTlf,
    lastFetchedAt: new Date(),
  }).where(eq(listings.id, id))
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
