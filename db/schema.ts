import { sql } from 'drizzle-orm'
import {
  pgTable, uuid, text, integer, numeric, boolean,
  timestamp, jsonb, index, uniqueIndex, check, pgEnum,
} from 'drizzle-orm/pg-core'

export const sourceTypeEnum = pgEnum('source_type', ['feed', 'spider', 'native'])
export const listingStatusEnum = pgEnum('listing_status', ['active', 'delisted'])
export const userRoleEnum = pgEnum('user_role', ['tenant', 'landlord', 'admin'])
export const subStatusEnum = pgEnum('sub_status', [
  'trialing', 'active', 'past_due', 'canceled', 'expired',
])

// Hvor praecist adressen kunne slaas op i det officielle register.
//   unit   = enhedsadresse, inkl. etage og doer. Én bestemt bolig.
//   access = adgangsadresse, opgangen. Vi ved hvilken opgang, ikke hvilken doer.
//   failed = ingen traeffer. Boligen vises ikke.
export const addressMatchLevelEnum = pgEnum('address_match_level', [
  'unit', 'access', 'failed',
])

// Fast liste, ikke fritekst. Kildens egne ord mappes centralt i normaliseringen.
// Kan typen ikke afgoeres, forbliver feltet null — 'andet' betyder "kendt og
// ingen af de andre", ikke "vi ved det ikke".
export const propertyTypeEnum = pgEnum('property_type', [
  'lejlighed', 'hus', 'raekkehus', 'vaerelse', 'studiebolig', 'andet',
])

export const crawlRunStatusEnum = pgEnum('crawl_run_status', [
  'running', 'ok', 'failed',
])

// Hvordan man faar boligen. 'regular' er foerst til moelle og er det eneste,
// hastighedsloeftet giver mening for; 'waiting_list' gaar efter anciennitet,
// hvor det er ligegyldigt, om man ser annoncen fem minutter foer alle andre.
export const applicationTypeEnum = pgEnum('application_type', [
  'regular', 'waiting_list',
])

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  baseUrl: text('base_url'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Historikken over koersler ligger i crawl_runs. Der staar bevidst ikke et
  // lastRunCount her — det ville friste alarmen til at sammenligne mod sidste
  // koersel i stedet for mod medianen.
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  role: userRoleEnum('role').notNull().default('tenant'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Spejlet fra Stripe via webhooks. Kald aldrig Stripe ved hver request.
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  status: subStatusEnum('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sub_user_idx').on(t.userId),
}))

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),

  sourceId: uuid('source_id').notNull().references(() => sources.id),
  sourceType: sourceTypeEnum('source_type').notNull(),
  // Hash af kilde-URL. Stabil paa tvaers af koersler -> upsert, ikke duplikat.
  externalKey: text('external_key').notNull(),
  sourceUrl: text('source_url').notNull(),
  // Sat naar sourceType = 'native'
  landlordId: uuid('landlord_id').references(() => users.id),

  // ── Adresse ────────────────────────────────────────────────────────────
  // addressRaw er kildens streng. Resten kommer fra adressevask mod det
  // officielle register (Datafordeleren/DAR, lokal tabel — se noten nederst).
  addressRaw: text('address_raw').notNull(),
  street: text('street'),
  houseNumber: text('house_number'),
  floor: text('floor'),
  door: text('door'),
  postalCode: text('postal_code'),
  city: text('city'),
  // Enhedsadresse: én bestemt bolig, inkl. etage og doer.
  unitAddressUuid: text('unit_address_uuid'),
  // Adgangsadresse: opgangen. Saettes ogsaa naar enhedsadressen er fundet.
  accessAddressUuid: text('access_address_uuid'),
  // Hvor langt vasken naaede. Default 'failed': en bolig der endnu ikke er
  // vasket, er ikke matchet — og vises derfor ikke.
  addressMatchLevel: addressMatchLevelEnum('address_match_level')
    .notNull().default('failed'),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),

  propertyType: propertyTypeEnum('property_type'),
  sizeM2: integer('size_m2'),
  rooms: integer('rooms'),
  availableFrom: timestamp('available_from', { withTimezone: false }),

  // ── Oekonomi ───────────────────────────────────────────────────────────
  // Alt i oere. Aldrig float. Et felt kilden ikke oplyser, forbliver null.
  rentMonthly: integer('rent_monthly'),
  utilitiesHeat: integer('utilities_heat'),
  utilitiesWater: integer('utilities_water'),
  utilitiesElectricity: integer('utilities_electricity'),
  // Aconto som kilden opkraever, men ikke specificerer. Findes fordi
  // findbolig.nu oplyser en samlet aconto plus en delvis opdeling: uden
  // resten ville totalen vaere lavere end det, lejeren faktisk betaler.
  utilitiesOther: integer('utilities_other'),
  // Summen. Udfyldes KUN naar husleje og samtlige aconto-poster for boligen
  // er kendt. Mangler ét beloeb, staar totalMonthly null — et gaet her ville
  // ramme praecis det loefte (fuld oekonomi), der skiller os fra de andre.
  totalMonthly: integer('total_monthly'),
  // Hvilke poster der faktisk er talt med, fx
  // ['rent','heat','water','electricity']. Gemmes sammen med summen, saa den
  // altid kan efterproeves. Null naar totalMonthly er null.
  totalMonthlyComponents: text('total_monthly_components').array().$type<string[]>(),
  moveInCost: integer('move_in_cost'),

  applicationType: applicationTypeEnum('application_type'),
  rentModel: text('rent_model'),

  // Kildens egne tidsstempler. IKKE det samme som first_seen_at/last_seen_at,
  // som er vores egne observationer. En annonce oprettet hos kilden for tre
  // dage siden er ikke ny, selv om vi foerst saa den i dag.
  sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),

  amenities: jsonb('amenities').$type<string[]>().default([]),
  openHouseAt: timestamp('open_house_at', { withTimezone: true }),

  // Genereret af egne felter. Aldrig kildens braedtekst.
  description: text('description'),

  // Kontakt nulles paa feed/spider. Kun udfyldt naar sourceType = 'native'.
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  // Afgoer server-side om kontakt returneres. Haandhaev i query, ikke i UI.
  isBlurred: boolean('is_blurred').notNull().default(true),

  status: listingStatusEnum('status').notNull().default('active'),
  // Saettes ved foerste indsaettelse og roeres aldrig igen. Driver alarmen.
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  delistedAt: timestamp('delisted_at', { withTimezone: true }),
  // Sidst vi faktisk hentede detaljesiden. last_seen_at betyder kun "set i
  // discovery". Adskillelsen er det, der goer inkrementel import mulig:
  // vi kan bekraefte at boligen stadig findes uden at hente den igen.
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  viewCount: integer('view_count').notNull().default(0),
}, (t) => ({
  sourceKeyIdx: uniqueIndex('listing_source_key_idx').on(t.sourceId, t.externalKey),

  // ── Dedup i to niveauer ────────────────────────────────────────────────
  // Ikke unikke: to kilder maa gerne have den samme bolig. Indekserne er der,
  // for at dedup kan finde gruppen — ikke for at afvise den anden kilde.
  // 'unit': enhedsadressen er noeglen alene. Samme UUID = samme bolig.
  dedupUnitIdx: index('listing_dedup_unit_idx')
    .on(t.unitAddressUuid)
    .where(sql`${t.addressMatchLevel} = 'unit'`),
  // 'access': opgangen alene er ikke nok — der kan ligge otte lejligheder.
  // Noeglen er opgang + areal + vaerelser + husleje.
  dedupAccessIdx: index('listing_dedup_access_idx')
    .on(t.accessAddressUuid, t.sizeM2, t.rooms, t.rentMonthly)
    .where(sql`${t.addressMatchLevel} = 'access'`),
  // 'failed' dedupes ikke og vises ikke.

  // "Fuld oekonomi kendt" — filteret bag det ene af de to loefter.
  fullEconomyIdx: index('listing_full_economy_idx')
    .on(t.status, t.totalMonthly)
    .where(sql`${t.totalMonthly} is not null`),

  freshIdx: index('listing_fresh_idx').on(t.status, t.firstSeenAt),
  geoIdx: index('listing_geo_idx').on(t.postalCode, t.status),

  // Databasen haandhaever, at der ikke gaettes: en total uden husleje eller
  // uden liste over hvad der er talt med, kan ikke skrives.
  totalMonthlyHonest: check('listing_total_monthly_honest', sql`
    ${t.totalMonthly} is null
    or (${t.rentMonthly} is not null
        and cardinality(${t.totalMonthlyComponents}) > 0)`),

  // Et matchniveau uden det UUID, det bygger paa, er ikke et match.
  addressLevelHonest: check('listing_address_level_honest', sql`
    (${t.addressMatchLevel} = 'unit' and ${t.unitAddressUuid} is not null)
    or (${t.addressMatchLevel} = 'access' and ${t.accessAddressUuid} is not null)
    or ${t.addressMatchLevel} = 'failed'`),
}))

// ═══════════════════════════════════════════════════════════════════════════
//  Én raekke per discovery-koersel. Grundlaget for alarmen.
//  Alarmen sammenligner discoveredCount mod den loebende median af de
//  seneste 10 FAERDIGE koersler (status = 'ok') for samme kilde — ikke mod
//  sidste koersel. En enkelt daarlig koersel skal ikke kunne flytte
//  referencen og dermed skjule, at kilden er ved at doe.
//    select discovered_count from crawl_runs
//     where source_id = $1 and status = 'ok'
//     order by started_at desc limit 10
//  Taellerne er null indtil koerslen er faerdig. En koersel der styrtede,
//  bidrager ikke til medianen.
// ═══════════════════════════════════════════════════════════════════════════
export const crawlRuns = pgTable('crawl_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // Antal URL'er discovery fandt hos kilden.
  discoveredCount: integer('discovered_count'),
  // Antal boliger der faktisk kunne laeses og skrives.
  extractedCount: integer('extracted_count'),
  newCount: integer('new_count'),
  updatedCount: integer('updated_count'),
  delistedCount: integer('delisted_count'),
  // Set i discovery, men ikke hentet — kun last_seen_at flyttet.
  touchedCount: integer('touched_count'),
  errorCount: integer('error_count').notNull().default(0),
  status: crawlRunStatusEnum('status').notNull().default('running'),
  // Fri tekst til drift: hvad der gik galt, hvilken side den stoppede paa.
  notes: text('notes'),
  // HVEM koerte den. Uden det kan to importoerer ikke skelnes i basen, og
  // saa kan man ikke afgoere om en fjern kilde overhovedet naaede at koere.
  // Saettes af RUNNER, ellers maskinens vaertsnavn.
  runner: text('runner'),
}, (t) => ({
  // Baerer opslaget "seneste 10 for denne kilde".
  sourceRecentIdx: index('crawl_run_source_recent_idx')
    .on(t.sourceId, t.startedAt.desc()),
}))

// Billeder hotlinkes. externalUrl gaar gennem signeret proxy ved visning.
export const listingImages = pgTable('listing_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  externalUrl: text('external_url').notNull(),
  position: integer('position').notNull().default(0),
}, (t) => ({
  listingIdx: index('img_listing_idx').on(t.listingId, t.position),
}))

export const savedSearches = pgTable('saved_searches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  criteria: jsonb('criteria').$type<Record<string, unknown>>().notNull(),
  notifyPush: boolean('notify_push').notNull().default(true),
  notifyEmail: boolean('notify_email').notNull().default(true),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('search_user_idx').on(t.userId),
}))

export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: uniqueIndex('fav_pk').on(t.userId, t.listingId),
}))

// Kun mulig paa sourceType = 'native' — der er ingen at skrive til paa en
// importeret bolig.
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').notNull().references(() => listings.id),
  tenantId: uuid('tenant_id').notNull().references(() => users.id),
  landlordId: uuid('landlord_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('conv_tenant_idx').on(t.tenantId),
  landlordIdx: index('conv_landlord_idx').on(t.landlordId),
}))

// Spaer ved AFSENDELSE, server-side. Udloebet abonnement betyder
// skrivebeskyttet historik — slet aldrig beskeder.
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  convIdx: index('msg_conv_idx').on(t.conversationId, t.createdAt),
}))

// ═══════════════════════════════════════════════════════════════════════════
//  Adressevask — beslutning, ikke kode endnu.
//  Byg mod Datafordeleren, ikke DAWA: DAWA lukker 1. oktober 2026.
//  Hent DAR som fildownload til en lokal tabel og slaa op lokalt. Ét kald per
//  adresse mod en ekstern tjeneste ville goere importen langsom og goere
//  hastighedsloeftet afhaengigt af en andens oppetid.
//  DAR-tabellen ligger her, naar den bygges — sammen med opslaget, der saetter
//  unitAddressUuid / accessAddressUuid / addressMatchLevel.
// ═══════════════════════════════════════════════════════════════════════════
