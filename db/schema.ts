import {
  pgTable, uuid, text, integer, numeric, boolean,
  timestamp, jsonb, index, uniqueIndex, pgEnum,
} from 'drizzle-orm/pg-core'

export const sourceTypeEnum = pgEnum('source_type', ['feed', 'spider', 'native'])
export const listingStatusEnum = pgEnum('listing_status', ['active', 'delisted'])
export const userRoleEnum = pgEnum('user_role', ['tenant', 'landlord', 'admin'])
export const subStatusEnum = pgEnum('sub_status', [
  'trialing', 'active', 'past_due', 'canceled', 'expired',
])

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  baseUrl: text('base_url'),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunCount: integer('last_run_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

  // Adresse. addressRaw er kildens streng; resten kommer fra adressevask.
  addressRaw: text('address_raw').notNull(),
  street: text('street'),
  houseNumber: text('house_number'),
  floor: text('floor'),
  door: text('door'),
  postalCode: text('postal_code'),
  city: text('city'),
  // Officielt adresse-UUID. Dedup-noeglen. Null = vask fejlede, skjul boligen.
  addressUuid: text('address_uuid'),
  addressMatchQuality: text('address_match_quality'),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),

  propertyType: text('property_type'),
  sizeM2: integer('size_m2'),
  rooms: integer('rooms'),
  availableFrom: timestamp('available_from', { withTimezone: false }),

  // Oekonomi. Alt i oere for at undgaa float-fejl.
  rentMonthly: integer('rent_monthly'),
  utilitiesHeat: integer('utilities_heat'),
  utilitiesWater: integer('utilities_water'),
  utilitiesElectricity: integer('utilities_electricity'),
  // Beregnet ved skrivning: rent + alle aconto. Konkurrenterne viser kun rent.
  totalMonthly: integer('total_monthly'),
  moveInCost: integer('move_in_cost'),

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
  viewCount: integer('view_count').notNull().default(0),
}, (t) => ({
  sourceKeyIdx: uniqueIndex('listing_source_key_idx').on(t.sourceId, t.externalKey),
  dedupIdx: index('listing_dedup_idx').on(t.addressUuid, t.rentMonthly),
  freshIdx: index('listing_fresh_idx').on(t.status, t.firstSeenAt),
  geoIdx: index('listing_geo_idx').on(t.postalCode, t.status),
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
