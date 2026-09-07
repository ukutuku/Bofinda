import { sql } from 'drizzle-orm'
import {
  pgTable, uuid, text, integer, smallint, numeric, boolean,
  timestamp, jsonb, index, uniqueIndex, check, primaryKey, pgEnum,
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
  /**
   * Binder til Supabase Auth. NULLABLE med vilje: alarmens brugere
   * oprettes paa mailadressen alene og har ingen konto — de skal ikke
   * tvinges til at faa en for at kunne faa besked om nye boliger.
   *
   * Vi ejer ikke adgangskoder. Se BRIEF: "vi bygger ikke vores egen".
   */
  authUserId: uuid('auth_user_id').unique(),
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
  // Sat naar kilden UDTRYKKELIGT oplyser, at lejeren selv afregner el.
  // Null betyder "ikke oplyst" — ikke "udlejer opkraever el".
  //
  // Findes fordi det er forskellen paa at vide og at formode. Uden feltet
  // maatte boligsiden udlede af et tomt utilities_electricity, at el
  // afregnes direkte, og det er en antagelse praesenteret som en oplysning.
  // Dacas skriver "El: Eget ansvar" paa hver bolig; de oevrige kilder tier.
  electricityOwnMeter: boolean('electricity_own_meter'),
  // Summen. Udfyldes KUN naar husleje og samtlige aconto-poster for boligen
  // er kendt. Mangler ét beloeb, staar totalMonthly null — et gaet her ville
  // ramme praecis det loefte (fuld oekonomi), der skiller os fra de andre.
  totalMonthly: integer('total_monthly'),
  // Hvilke poster der faktisk er talt med, fx
  // ['rent','heat','water','electricity']. Gemmes sammen med summen, saa den
  // altid kan efterproeves. Null naar totalMonthly er null.
  totalMonthlyComponents: text('total_monthly_components').array().$type<string[]>(),
  moveInCost: integer('move_in_cost'),
  /**
   * Depositum og forudbetalt leje hver for sig, i oere.
   *
   * `move_in_cost` er summen. Den er nok for en scrapet bolig, hvor kilden
   * tit kun oplyser totalen — men en udlejer skal kunne aabne sin annonce
   * igen og se de tal, hun skrev. Uden kolonnerne var der intet at laese
   * tilbage, og et gem skrev tomt hen over summen.
   */
  deposit: integer('deposit'),
  prepaidRent: integer('prepaid_rent'),

  applicationType: applicationTypeEnum('application_type'),
  rentModel: text('rent_model'),

  // Kildens egne tidsstempler. IKKE det samme som first_seen_at/last_seen_at,
  // som er vores egne observationer. En annonce oprettet hos kilden for tre
  // dage siden er ikke ny, selv om vi foerst saa den i dag.
  sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),

  amenities: jsonb('amenities').$type<string[]>().default([]),

  /**
   * Kilden skriver SELV, at billederne kan vaere fra en anden bolig.
   * LokalBolig goer det paa 20 af 244; teksten staar i deres beskrivelse.
   *
   * Foer blev billederne kasseret, naar forbeholdet stod der. Men at fjerne
   * dem er ogsaa en paastand — den siger implicit "der er ingen", og det er
   * usandt: der er 115. Nu vises de med forbeholdet ved siden af.
   *
   * BEMAERK: her staar KUN at forbeholdet findes. Selve saetningen, vi
   * viser, er VORES egen tekst i app/Boligkort.tsx og app/bolig/[id],
   * skrevet ud fra kildens — den er ikke hentet herfra. Kildens braedtekst
   * gemmes ikke, jf. noten ved `description` nedenfor.
   */
  imagesMayDiffer: boolean('images_may_differ').notNull().default(false),

  /**
   * Detaljevagten — kun for kilder, hvis adapter kan levere listens
   * grundlag uden detaljehentning (SourceAdapter.listeGrundlag).
   *
   * `detail_signature` er adapterens fingeraftryk af de listefelter, der
   * skal udloese en ny detaljehentning (status, dato, leje …). AEndrer
   * signaturen sig, hentes detaljesiden igen.
   *
   * `detail_fetched_at` er hvornaar detaljesiden SIDST faktisk blev
   * hentet. NULL betyder «detaljer mangler» — raekken er skrevet fra
   * listen alene og samles op af en senere koersel. Staleness for
   * vagt-kilder maales HER og ikke paa last_fetched_at, som ogsaa
   * flyttes af grundlags-skrivninger.
   *
   * Begge er NULL for kilder uden vagt — vagten laeser dem aldrig dér.
   */
  detailSignature: text('detail_signature'),
  detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),

  /**
   * SNAPSHOT af hvad kilden sagde om tilgaengelighed — AvailabilityFacts
   * fra lib/adapter.ts, gemt lossless. Standardiserede NAVNE, kildens raa
   * VAERDIER: rawStatus = "Reserved", ikke market = "reserveret".
   * Fortolkningen bor i lib/kildekontrakt.ts + lib/availability.ts og
   * INGEN andre steder.
   *
   * NULL  = raekken er endnu ikke behandlet gennem availability-pipelinen.
   * {}    = behandlet, men kilden/adapteren gav ingen facts.
   * Skellet baerer udrulningen: NULL kan taelles som "mangler hoestning".
   *
   * ERSTATTES HELT ved hver vellykket behandling — aldrig merge. Et fact,
   * der forsvinder fra kildens naeste svar, skal forsvinde her.
   *
   * Typet som Record<string, unknown> MED VILJE: laesning SKAL gennem
   * laesAvailabilityFacts() i lib/fakta.ts. En `as AvailabilityFacts`
   * ville vaere praecis den ukontrollerede cast, lib/alarm.ts:15 allerede
   * har én af for `criteria` — det moenster skal ikke ét lag dybere.
   */
  availabilityFacts: jsonb('availability_facts').$type<Record<string, unknown>>(),
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

  // Udlejeren kan ikke baade opkraeve el aconto OG oplyse, at lejeren selv
  // afregner. Sker det, har vi laest kilden forkert.
  elEnten: check('listing_el_enten_eller', sql`
    ${t.electricityOwnMeter} is not true or ${t.utilitiesElectricity} is null`),

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
  // Boliger sprunget over, fordi de er i tilbagetraekning. Taelles adskilt
  // fra error_count: en side vi bevidst IKKE forsoegte, er ikke en fejl.
  skippedCount: integer('skipped_count'),
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

// ═══════════════════════════════════════════════════════════════════════════
//  Detaljesider vi ikke kunne hente.
//
//  Findes af én grund: en side, der aldrig kan hentes, maa ikke koste kald i
//  al fremtid. Propstep viser seks lejemaal i sit soegegitter, hvis
//  detaljesider svarer 404. De faar aldrig en raekke i `listings`, saa de
//  saa nye ud ved hver eneste koersel og blev forsoegt hentet hver time —
//  144 spildte kald i doegnet, og seks fejl i hver rapport.
//
//  Tabellen husker noeglen paa tvaers af koersler og traekker sig tilbage:
//    1.-2. fejl  proev igen naeste koersel
//    3.-4. fejl  proev igen om et doegn
//    5. fejl og derefter  proev igen om en uge
//  Foerste succes sletter raekken, saa en midlertidig fejl ikke haenger ved.
//
//  En bolig i tilbagetraekning taelles IKKE som fejl i koerselsrapporten.
//  Ellers ville stoejen bare vaere flyttet i stedet for fjernet.
// ═══════════════════════════════════════════════════════════════════════════
export const fetchFailures = pgTable('fetch_failures', {
  sourceId: uuid('source_id').notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  externalKey: text('external_key').notNull(),
  url: text('url').notNull(),
  attempts: integer('attempts').notNull().default(0),
  firstFailedAt: timestamp('first_failed_at', { withTimezone: true }).notNull().defaultNow(),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
  /** Foer dette tidspunkt forsoeges den ikke igen. */
  retryAfter: timestamp('retry_after', { withTimezone: true }).notNull(),
  lastError: text('last_error'),
}, (t) => ({
  pk: primaryKey({ columns: [t.sourceId, t.externalKey] }),
  // Baerer opslaget "hvilke noegler er i tilbagetraekning lige nu".
  retryIdx: index('fetch_failure_retry_idx').on(t.sourceId, t.retryAfter),
}))

/**
 * Vaertsspaerren — 429/503 er vaertens besked om at holde op, og den
 * besked skal overleve processen.
 *
 * Noeglen er (runner, host), IKKE host alene: en blokering hoerer til den
 * egress, der faktisk blev droevlet. Mac'ens launchd-import og Railway
 * gaar ud ad hver sin IP, saa en blok det ene sted siger intet om det
 * andet — mens to koersler med SAMME runner-identitet deler baade IP og
 * blok, og det er praecis rigtigt.
 *
 * `blocked_until` forlaenges kun opad (GREATEST), aldrig nedad: en senere,
 * kortere blok maa ikke ophaeve en laengere, kilden allerede har bedt om.
 */
export const hostBlocks = pgTable('host_blocks', {
  runner: text('runner').notNull(),
  host: text('host').notNull(),
  /** Foer dette tidspunkt kaldes vaerten ikke. */
  blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
  reason: text('reason'),
  /** Hvor mange koersler spaerren har sprunget over. Uden det er
   *  «blokeret» og «scheduleren er doed» ikke til at skelne i basen. */
  skipCount: integer('skip_count').notNull().default(0),
  lastSkippedAt: timestamp('last_skipped_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.runner, t.host] }),
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
  /** Samme form som `Filtre` i lib/soeg.ts. Gemmes som den blev valgt. */
  criteria: jsonb('criteria').$type<Record<string, unknown>>().notNull(),
  notifyPush: boolean('notify_push').notNull().default(true),
  notifyEmail: boolean('notify_email').notNull().default(true),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  // Gulvet for hvad der er "nyt". En gemt soegning varsler om boliger, vi
  // saa EFTER den blev oprettet — ikke om hele det bestaaende udbud.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Afmelding uden login. Uudregnelig, egen pr. soegning, og den eneste
  // noegle der skal til — modtageren skal ikke oprette en konto for at
  // slippe af med os.
  unsubscribeToken: text('unsubscribe_token').notNull()
    .default(sql`gen_random_uuid()::text`),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  // Dobbelt tilmelding. Null = ikke bekraeftet, og saa varsles der IKKE.
  // Uden det kunne enhver tilmelde en fremmed adresse til en stroem af mail.
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmToken: text('confirm_token').notNull().default(sql`gen_random_uuid()::text`),
}, (t) => ({
  userIdx: index('search_user_idx').on(t.userId),
  token: uniqueIndex('search_token_unik').on(t.unsubscribeToken),
  bekraeft: uniqueIndex('search_confirm_unik').on(t.confirmToken),
}))

// ═══════════════════════════════════════════════════════════════════════════
//  Alarmkoeen. Én raekke per (soegning, bolig).
//
//  Matchning og afsendelse er adskilt med vilje. Raekken skabes, naar
//  boligen matcher; sent_at saettes foerst, naar beskeden faktisk er sendt.
//  Saa kan traefsikkerheden efterses, foer nogen faar mails — og en
//  afsendelse der fejler, mister ikke traeffet.
//
//  Den unikke noegle er (saved_search_id, listing_id): den samme bolig
//  varsles aldrig to gange for den samme soegning, uanset hvor mange gange
//  matchningen koerer.
// ═══════════════════════════════════════════════════════════════════════════
export const alertMatches = pgTable('alert_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  savedSearchId: uuid('saved_search_id').notNull()
    .references(() => savedSearches.id, { onDelete: 'cascade' }),
  listingId: uuid('listing_id').notNull()
    .references(() => listings.id, { onDelete: 'cascade' }),
  matchedAt: timestamp('matched_at', { withTimezone: true }).notNull().defaultNow(),
  /** Null = endnu ikke sendt. Under indkoeringen er den altid null. */
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => ({
  enGang: uniqueIndex('alert_match_unik').on(t.savedSearchId, t.listingId),
  ventende: index('alert_match_ventende_idx').on(t.sentAt, t.matchedAt),
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

// ═══════════════════════════════════════════════════════════════
//  Produktanalytics. Se docs/analytics-v1.md for hele designet.
//
//  INGEN FREMMEDNOEGLER, med vilje. Loggen er append-only, ikke
//  relationel tilstand, og den maa aldrig kunne laase eller fejle en
//  produktskrivning. Joins hoerer til i forespoergslerne, og sletteretten
//  loeses eksplicit: `update haendelser set user_id = null where ...`
//  af-identificerer, saa aggregatet overlever, mens personen forsvinder.
// ═══════════════════════════════════════════════════════════════

export const haendelser = pgTable('haendelser', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  eventName: text('event_name').notNull(),
  schemaVersion: smallint('schema_version').notNull().default(1),
  environment: text('environment').notNull(),

  /**
   * NOT NULL er skaerpelsen udtrykt som en spaerring, ikke som en aftale.
   *
   * Uden analytics-samtykke maa der ikke gemmes ÉT individuelt event. Med
   * kolonnerne nullable ville en fejl i samtykkelaesningen skrive rækker
   * med null-identifikatorer, og ingen ville opdage det. Med NOT NULL kan
   * raekken fysisk ikke skrives. Se lib/maaling-server.ts, som alligevel
   * stopper foer — men en spaerring, der kun findes ét sted, er ingen
   * spaerring.
   */
  anonymousId: uuid('anonymous_id').notNull(),
  sessionId: uuid('session_id').notNull(),

  /** Vores egen brugerraekke. ALDRIG mailadressen. Nulstilles ved sletteret. */
  userId: uuid('user_id'),
  /** Ekstra tag under modererede brugertests. Et loebenummer, aldrig initialer. */
  researchSessionId: text('research_session_id'),

  /** MOENSTERET, /bolig/[id] — aldrig den faktiske URL. Den baerer fritekst. */
  route: text('route').notNull(),

  /** Forfremmet ud af properties: hvert bolig- og kildejoin gaar gennem dem. */
  listingId: uuid('listing_id'),
  sourceSlug: text('source_slug'),

  properties: jsonb('properties').notNull().default(sql`'{}'::jsonb`),
  /** Retention pr. raekke. Sat ved insert ud fra eventets klasse. */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  miljoe: check('haendelser_miljoe',
    sql`${t.environment} in ('produktion','preview','udvikling','proeve')`),
  navnLaengde: check('haendelser_navn_laengde',
    sql`char_length(${t.eventName}) between 1 and 40`),
  forsoegLaengde: check('haendelser_forsoeg_laengde',
    sql`${t.researchSessionId} is null or char_length(${t.researchSessionId}) between 1 and 40`),

  // Alle tidsserier og taellinger. Den ledende kolonne goer ogsaa, at et
  // vindue for ét miljoe kan scannes uden event_name.
  navnTid: index('haendelser_navn_tid').on(t.environment, t.eventName, t.occurredAt.desc()),
  // Funnel-rekonstruktion.
  session: index('haendelser_session').on(t.sessionId, t.occurredAt),
  // Kildeperformance. I basen er den PARTIEL (`where source_slug is not
  // null`) — de fleste events har ingen kilde. DDL'en er haandskrevet i
  // 0020, som for alle migrationer efter 0012; definitionen her er til
  // forespoergselslaget, ikke til skemaet.
  kilde: index('haendelser_kilde').on(t.sourceSlug, t.eventName, t.occurredAt.desc()),
  // Oprydningen. Uden den scanner hver time hele tabellen.
  udloeb: index('haendelser_udloeb').on(t.expiresAt),
}))

/**
 * Dagsaggregat. Ingen identifikatorer overhovedet, derfor ingen udloebsdato.
 * Uden den mister vi trenden, naar de raa events slettes.
 *
 * `sample_andel` er IKKE pynt: listing_impression er stikproevet, og et
 * aggregat, der gemmer 25 % af sandheden som om det var 100 %, er en loegn,
 * ingen opdager. For alle andre events er den 1.
 */
export const haendelserDaglig = pgTable('haendelser_daglig', {
  dato: text('dato').notNull(),
  environment: text('environment').notNull(),
  eventName: text('event_name').notNull(),
  sourceSlug: text('source_slug').notNull().default(''),
  antal: integer('antal').notNull(),
  sampleAndel: numeric('sample_andel', { precision: 5, scale: 4 }).notNull().default('1'),
}, (t) => ({
  pk: primaryKey({ columns: [t.dato, t.environment, t.eventName, t.sourceSlug] }),
}))
