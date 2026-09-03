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

import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { listingImages, listings, sources } from '../db/schema'
import { kanonisk, paenDoer, SimpelAdressevask } from './address'
import { normaliser } from './normalize'
import type { Udlejer } from './auth'
import { repraesentantFor, type Repraesentant } from './soeg'

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
  /** Kun værdier fra `FACILITETER`. Tom liste = udlejeren sagde nej. */
  faciliteter: string[]
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
    faciliteter: Array.isArray(b.amenities) ? (b.amenities as string[]) : [],
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
/**
 * Usynlige tegn. `trim()` fjerner mellemrum — ogsaa NBSP — men IKKE tegn
 * der er nul enheder brede. Et vejnavn paa ét zero-width space (U+200B)
 * er derfor "ikke tomt" for valideringen, mens der ikke staar noget.
 *
 * Det er ikke en skoenhedsfejl. `kanonisk()` i adressevasken smider tegnet
 * vaek, saa noeglen bliver `intern:v3:2200::30` — uden vejnavn. To saadanne
 * annoncer i samme postnummer med samme husnummer faar den SAMME noegle og
 * bliver slaaet sammen som den samme bolig.
 *
 * Med i listen: bloedt bindestreg, zero-width space/non-joiner/joiner,
 * de usynlige retningsmarkoerer, linje- og afsnitsseparator, word joiner
 * og BOM. Alle sammen tegn der ikke saetter blaek paa skaermen.
 */
const USYNLIGE = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** Formularvaerdi -> streng uden usynlige tegn og uden mellemrum i enderne. */
export const renTekst = (v: unknown) =>
  String(v ?? '').replace(USYNLIGE, '').trim()

/**
 * Doerbetegnelser vi kan staa inde for.
 *
 * En doer haever adressens niveau til 'unit', og en unit-noegle bestaar
 * KUN af enhedsadressen — areal, vaerelser og leje falder ud. Et "-" i
 * feltet ville derfor slaa to vidt forskellige boliger paa samme adresse
 * sammen, og den ene ville forsvinde fra soegningen. Feltet maa ikke vaere
 * fri tekst. Er der ingen doerbetegnelse, lades feltet tomt — saa bliver
 * niveauet 'access', hvilket er sandt.
 *
 * Maalt mod basen daekker listen 758 af 783 gemte doere; resten er
 * bygningsformer, kilderne selv leverer, og som ingen udlejer taster.
 */
const DOER_OK = /^(tv|th|mf|[0-9]{1,4}|[a-zæøå])$/

/**
 * Adressefelterne fra udlejerformularen. Returnerer en dansk fejl, eller
 * null hvis de kan bruges.
 *
 * Ligger her og ikke i server action'en af to grunde: en `'use server'`-fil
 * maa kun eksportere handlinger, og reglerne skal kunne proeves af testen
 * uden at gaa gennem en formular.
 */
export function tjekAdresse(
  i: { vej: string; husnr: string; postnr: string; doer: string | null },
): string | null {
  // Bogstav-kravet er \p{L}, ikke [a-z]: "Østerbrogade" og ethvert andet
  // alfabet skal kunne staa. Men noeglen bygges af kanonisk(), som kun
  // beholder a-z0-9 — saa der skal OGSAA vaere noget tilbage bagefter.
  // Ellers faar vi noeglen `intern:v3:2200::30`, uden vej, og to saadanne
  // annoncer bliver til den samme bolig i dedup.
  if (!i.vej) return 'Skriv vejnavnet.'
  if (!/\p{L}/u.test(i.vej)) return 'Vejnavnet skal indeholde mindst ét bogstav.'
  if (!kanonisk(i.vej))
    return 'Vejnavnet kan vi ikke læse. Skriv det med latinske bogstaver — æ, ø og å er fine.'

  // Husnummeret er ikke pynt: uden det falder access-dedup tilbage til hele
  // vejen. Nordskovvej i 7184 Vandel er 30 boliger med den samme
  // adressestreng, og uden husnummerkravet skjulte reglen 26 af dem som
  // dubletter af hinanden. Et husnummer paa "-" er kolonnen ikke-null, men
  // bidrager intet til noeglen — praecis den samme fejl.
  if (!i.husnr) return 'Skriv husnummeret.'
  if (!/\p{Nd}/u.test(i.husnr)) return 'Husnummeret skal indeholde mindst ét tal.'
  if (!kanonisk(i.husnr)) return 'Husnummeret kan vi ikke læse. Skriv det som 56 eller 56 B.'

  if (!/^\d{4}$/.test(i.postnr)) return 'Postnummeret skal være fire cifre.'

  if (i.doer && !DOER_OK.test(paenDoer(i.doer))) {
    return 'Døren skal være tv, th, mf, et nummer eller et enkelt bogstav.'
      + ' Lad feltet stå tomt, hvis boligen ikke har en dørbetegnelse.'
  }

  return null
}

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
    amenities: i.faciliteter,
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
    // Uden den her kolonne var udlejerannoncer usynlige for elevator-,
    // altan- og kaeledyrsfiltrene for altid — de filtrerer paa `amenities`,
    // og den var tom, fordi ingen spurgte.
    amenities: i.faciliteter,
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

/**
 * Hvad udlejeren faar at vide om sin annonce.
 *
 *   udgivet       den kan findes i soegningen
 *   fjernet       hun har taget den ned selv
 *   dublet        den findes, men vi viser en anden annonce for samme
 *                 bolig i stedet — se `af`
 *   uden-adresse  adressen kunne ikke stedfaestes, saa vi ved ikke hvor
 *                 boligen ligger og viser den ingen steder
 *
 * `status` alene kunne ikke skelne de tre sidste. Den sagde "udgivet" om
 * alt, der var 'active' — ogsaa naar boligen ikke kunne findes nogen
 * steder. En udlejer, der tror hun er synlig, mens hun ikke er, er samme
 * fejl som en total, der lader som om aconto er kendt.
 */
export type Synlighed =
  | { slags: 'udgivet' }
  | { slags: 'fjernet' }
  | { slags: 'dublet'; af: Repraesentant }
  | { slags: 'uden-adresse' }

export async function mineBoliger(u: Udlejer) {
  const raekker = await db.select({
    id: listings.id,
    adresse: listings.addressRaw,
    postnr: listings.postalCode,
    by: listings.city,
    status: listings.status,
    niveau: listings.addressMatchLevel,
    leje: listings.rentMonthly,
    total: listings.totalMonthly,
    areal: listings.sizeM2,
    vaerelser: listings.rooms,
    oprettet: listings.firstSeenAt,
    billeder: sql<number>`(select count(*)::int from ${listingImages} i
      where i.listing_id = ${listings.id})`,
  })
    .from(listings)
    .where(eq(listings.landlordId, u.id))
    .orderBy(desc(listings.firstSeenAt))

  // Kun de udgivne kan tabe et repraesentantvalg — de oevrige er allerede
  // ude af grundlaget, og saa er dedup ikke grunden til at de ikke ses.
  const skjulte = await repraesentantFor(
    raekker.filter((r) => r.status === 'active' && r.niveau !== 'failed').map((r) => r.id))

  return raekker.map((r) => {
    const synlighed: Synlighed =
      r.status !== 'active' ? { slags: 'fjernet' }
      : r.niveau === 'failed' ? { slags: 'uden-adresse' }
      : skjulte.has(r.id) ? { slags: 'dublet', af: skjulte.get(r.id)! }
      : { slags: 'udgivet' }
    return { ...r, synlighed }
  })
}
