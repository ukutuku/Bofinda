// ═══════════════════════════════════════════════════════════════
//  Oprydningen i `ryd()` — hvem den maa slette, og hvem den ikke maa.
//
//  ═══ FEJLEN, DER BLEV RETTET ═══
//
//  Trin 4 slettede ENHVER `users`-raekke uden en gemt soegning:
//
//      delete from users
//      where not exists (select 1 from saved_searches ss
//                        where ss.user_id = users.id)
//
//  Begrundelsen i kommentaren var rigtig — «en mailadresse uden en
//  soegning bag er en oplysning uden formaal» — men praedikatet var
//  bredere end begrundelsen. `users` baerer ikke kun alarmens
//  mailadresser. Den baerer ogsaa konti (`auth_user_id`), udlejere,
//  favoritter, abonnementer og beskeder.
//
//  To udfald, og det stille er det vaerste:
//
//  · HOEJT. En udlejer med en annonce kan ikke slettes:
//    `listings.landlord_id` er ON DELETE NO ACTION. Postgres kaster,
//    `ryd()` bobler op gennem `scripts/import.ts`, og koerslen stopper
//    FOER `matchAlarmer()`. Ingen faar besked om nye boliger.
//
//  · STILLE. En konto med favoritter eller et abonnement HAR ingen
//    spaerring: `favorites` og `subscriptions` er ON DELETE CASCADE.
//    Raekken forsvinder, favoritterne med den, og intet kaster. Det er
//    ikke en fejl, nogen opdager — det er data, der bare ikke er der
//    naeste gang hun logger ind.
//
//  ═══ HVAD PROEVEN MAALER ═══
//
//  Alle syv fremmednoegler til `users`, plus kontobindingen og
//  Stripe-kunden. Og at de tre frister paa `saved_searches` er
//  uaendrede — en oprydning, der holder op med at rydde op, er ogsaa
//  en fejl.
//
//      koeres af scripts/testbase.ts mod PGlite
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  checkoutForsoeg, conversations, drift, favorites, listings, messages,
  savedSearches, sources, subscriptions, users,
} from '../db/schema'
import { ryd } from '../lib/alarm'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const STEMPEL = Date.now()
const post = (n: string) => `ryd-${n}-${STEMPEL}@proeve.invalid`

/**
 * Kontoen skal FINDES i `auth.users`, foer `public.users.auth_user_id`
 * kan pege paa den: migration 0013 laegger en fremmednoegle derover
 * (`users_auth_user_id_fkey`, on delete set null). Samme greb som
 * test-authbinding.ts. En prøve, der bare fandt paa et uuid, fik
 * 23503 — og det var proevens fejl, ikke oprydningens.
 */
async function nyAuthKonto(navn: string): Promise<string> {
  const id = randomUUID()
  await db.execute(sql`insert into auth.users (id, email)
    values (${id}, ${post(navn)}) on conflict (id) do nothing`)
  return id
}

async function nyBruger(navn: string, ekstra: Record<string, unknown> = {}) {
  const [u] = await db.insert(users)
    .values({ email: post(navn), ...ekstra })
    .returning({ id: users.id })
  return u!.id
}

/** Bruger MED konto: auth-raekken foerst, saa vores egen. */
async function nyKonto(navn: string, ekstra: Record<string, unknown> = {}) {
  return nyBruger(navn, { authUserId: await nyAuthKonto(navn), ...ekstra })
}

interface Rydsvar { ok: boolean; svar: Awaited<ReturnType<typeof ryd>> | null; fejl: string | null }

/** Kalder den RIGTIGE ryd() og fanger KUN for at kunne rapportere. */
async function koerRyd(): Promise<Rydsvar> {
  try {
    return { ok: true, svar: await ryd(), fejl: null }
  } catch (e) {
    return { ok: false, svar: null, fejl: (e as Error).message.split('\n')[0] ?? 'ukendt fejl' }
  }
}

async function findes(id: string) {
  const [r] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  return !!r
}
async function harFavorit(id: string) {
  const [r] = await db.select({ u: favorites.userId })
    .from(favorites).where(eq(favorites.userId, id))
  return !!r
}
async function harAbonnement(id: string) {
  const [r] = await db.select({ u: subscriptions.userId })
    .from(subscriptions).where(eq(subscriptions.userId, id))
  return !!r
}
async function harSamtale(id: string) {
  const [r] = await db.select({ id: conversations.id })
    .from(conversations).where(eq(conversations.id, id))
  return !!r
}
async function harBesked(afsender: string) {
  const [r] = await db.select({ s: messages.senderId })
    .from(messages).where(eq(messages.senderId, afsender))
  return !!r
}
async function lever(id: string) {
  const [r] = await db.select({ id: savedSearches.id })
    .from(savedSearches).where(eq(savedSearches.id, id))
  return !!r
}

/** Gemt soegning med et datofelt sat bagud, saa fristen kan maales. */
async function nySoegning(bruger: string, navn: string, saet: ReturnType<typeof sql>) {
  const [r] = await db.insert(savedSearches)
    .values({ userId: bruger, name: navn, criteria: { postnr: ['9900'] } })
    .returning({ id: savedSearches.id })
  await db.execute(sql`update saved_searches set ${saet} where id = ${r!.id}`)
  return r!.id
}

async function koer() {
  // ─── Grundlag ────────────────────────────────────────────────
  // Egen kilde pr. koersel, aldrig en rigtig kildes id: en proeve, der
  // laaner en kildes historik, arver ogsaa dens plads i alarmens
  // indkoeringsvagt. Se noten om test-redigering i CLAUDE.md.
  const [kilde] = await db.insert(sources)
    .values({ slug: `test-ryd-${STEMPEL}`, name: 'Prøvekilde ryd', sourceType: 'spider' })
    .returning({ id: sources.id })
  const kildeId = kilde!.id

  async function nyBolig(udlejer: string | null) {
    const [l] = await db.insert(listings).values({
      sourceId: kildeId,
      sourceType: udlejer ? 'native' : 'spider',
      externalKey: `ryd-${STEMPEL}-${Math.random().toString(36).slice(2)}`,
      sourceUrl: 'http://127.0.0.1/ryd',
      addressRaw: 'Prøvevej 1, 9900 Prøveby',
      street: 'Prøvevej', houseNumber: '1', postalCode: '9900', city: 'Prøveby',
      status: 'active', landlordId: udlejer, sourceCreatedAt: null,
    }).returning({ id: listings.id })
    return l!.id
  }

  // ═══════════════════════════════════════════════════════════
  //  RUNDE 1 — den STILLE skade
  //
  //  Kun relationer med ON DELETE CASCADE. Der er ingen spaerring, saa
  //  `ryd()` gennemfoerer — og netop derfor er det her den grimme
  //  halvdel: ingen fejl, ingen log, bare data der ikke er der mere.
  // ═══════════════════════════════════════════════════════════

  // 1 · Konto med KUN favoritter.
  const kontoFav = await nyKonto('konto-fav')
  const favBolig = await nyBolig(null)
  await db.insert(favorites).values({ userId: kontoFav, listingId: favBolig })

  // 2 · Ny, TOM konto. Oprettet i gaar, har ikke naaet noget endnu.
  const kontoTom = await nyKonto('konto-tom')

  // 4a · Abonnement (cascade) og Stripe-kunde uden abonnementsraekke.
  const medAbo = await nyKonto('abonnent')
  await db.insert(subscriptions).values({
    userId: medAbo, stripeSubscriptionId: `sub_ryd_${STEMPEL}`,
    status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000),
  })
  const medStripe = await nyBruger('stripe', { stripeCustomerId: `cus_ryd_${STEMPEL}` })

  // 5 · REELT overfloedig alarmbrugerraekke: ingen konto, ingen Stripe,
  //     ingen raekker nogen steder. Praecis det, trin 4 findes for.
  const overfloedig = await nyBruger('overfloedig')

  // 6 · Fristerne. Én bruger pr. frist, saa en slettet soegning ikke
  //     goer brugeren overfloedig midt i maalingen af en anden frist.
  const uBruger = await nyKonto('frist-ubekraeftet')
  const uGammel = await nySoegning(uBruger, 'ubekræftet, 31 dage',
    sql`created_at = now() - interval '31 days'`)
  const uUng = await nySoegning(uBruger, 'ubekræftet, 29 dage',
    sql`created_at = now() - interval '29 days'`)

  const aBruger = await nyKonto('frist-afmeldt')
  const aGammel = await nySoegning(aBruger, 'afmeldt, 91 dage',
    sql`confirmed_at = now(), unsubscribed_at = now() - interval '91 days'`)
  const aUng = await nySoegning(aBruger, 'afmeldt, 89 dage',
    sql`confirmed_at = now(), unsubscribed_at = now() - interval '89 days'`)

  const gBruger = await nyKonto('frist-gammel')
  const gGammel = await nySoegning(gBruger, 'gammel, 25 måneder',
    sql`confirmed_at = now(), created_at = now() - interval '25 months'`)

  // Undtagelsen er per BRUGER: har hun en nyere soegning, roeres ingen.
  const nBruger = await nyKonto('frist-nyere')
  const nGammel = await nySoegning(nBruger, 'gammel, men bruger har nyere',
    sql`confirmed_at = now(), created_at = now() - interval '25 months'`)
  await db.insert(savedSearches).values({
    userId: nBruger, name: 'nyere søgning', criteria: { postnr: ['9900'] },
  })

  console.log('\n══ RUNDE 1 · ryd() med kun cascade-relationer ══')
  const r1 = await koerRyd()
  tjek('runde 1 · ryd() gennemfoeres', r1.ok,
    r1.fejl ? `kastede: ${r1.fejl}` : `foraeldreloese=${r1.svar?.foraeldreloese}`)

  if (r1.ok) {
    console.log('\n  ── bevaret ──')
    tjek('1 · konto med kun favoritter: brugeren bevaret', await findes(kontoFav))
    tjek('1 · konto med kun favoritter: favoritten bevaret',
      await harFavorit(kontoFav))
    tjek('2 · ny, tom konto bevaret', await findes(kontoTom))
    tjek('4 · bruger med abonnement bevaret', await findes(medAbo))
    tjek('4 · abonnementet bevaret', await harAbonnement(medAbo))
    tjek('4 · bruger med stripe_customer_id bevaret', await findes(medStripe))
    tjek('6 · bruger med gemt soegning bevaret', await findes(uBruger))

    console.log('\n  ── ryddet ──')
    tjek('5 · reelt overfloedig alarmbrugerraekke slettet',
      !(await findes(overfloedig)))
    // PRAECIS én. Et `>= 1` var groent paa den gamle kode med
    // foraeldreloese=6, mens fem konti blev slettet — altsaa et tal, der
    // gav tryghed uden at kunne skelne oprydning fra hærværk. Efter
    // trin 1-3 er `gBruger` ogsaa uden soegning, men hun har en konto;
    // den eneste reelt overfloedige er `overfloedig`.
    tjek('5 · og talt som PRAECIS én overfloedig', r1.svar!.foraeldreloese === 1,
      `foraeldreloese=${r1.svar!.foraeldreloese}`)

    console.log('\n  ── frister paa saved_searches (uaendrede) ──')
    tjek('6 · ubekraeftet 31 dage slettet', !(await lever(uGammel)))
    tjek('6 · ubekraeftet 29 dage bevaret', await lever(uUng))
    tjek('6 · afmeldt 91 dage slettet', !(await lever(aGammel)))
    tjek('6 · afmeldt 89 dage bevaret', await lever(aUng))
    tjek('6 · 25 maaneder gammel slettet', !(await lever(gGammel)))
    tjek('6 · 25 maaneder, men bruger har nyere: bevaret', await lever(nGammel))
    tjek('6 · taellerne stemmer',
      r1.svar!.ubekraeftede === 1 && r1.svar!.afmeldte === 1 && r1.svar!.forgamle === 1,
      `ubekraeftede=${r1.svar!.ubekraeftede} afmeldte=${r1.svar!.afmeldte} `
      + `forgamle=${r1.svar!.forgamle}`)
  }

  // ═══════════════════════════════════════════════════════════
  //  RUNDE 2 — den HOEJE fejl
  //
  //  Relationer med ON DELETE NO ACTION: listings.landlord_id,
  //  conversations.tenant_id/landlord_id og messages.sender_id.
  //  Her kan Postgres ikke andet end at kaste.
  // ═══════════════════════════════════════════════════════════

  // 3 · Udlejer med annonce.
  const udlejer = await nyKonto('udlejer', { role: 'landlord' })
  const udlejerBolig = await nyBolig(udlejer)

  // 4b · Lejer med samtale og besked.
  const lejer = await nyKonto('lejer-samtale')
  const [samtale] = await db.insert(conversations).values({
    listingId: udlejerBolig, tenantId: lejer, landlordId: udlejer,
  }).returning({ id: conversations.id })
  await db.insert(messages).values({
    conversationId: samtale!.id, senderId: lejer, body: 'Er den ledig?',
  })

  // Og en frisk overfloedig raekke, saa runde 2 ogsaa har noget at rydde.
  const overfloedig2 = await nyBruger('overfloedig-2')

  console.log('\n══ RUNDE 2 · ryd() med annonce, samtale og besked ══')
  const r2 = await koerRyd()
  tjek('3b · ryd() gennemfoeres uden at kaste', r2.ok,
    r2.fejl ? `kastede: ${r2.fejl}` : '')

  if (!r2.ok) {
    console.log('\n  ↑ scripts/import.ts kalder ryd() FOER matchAlarmer(), saa en')
    console.log('    kastet fejl her stopper hele koerslen: ingen alarmmails.')
  } else {
    tjek('3 · udlejer med annonce bevaret', await findes(udlejer))
    const [bolig] = await db.select({ l: listings.landlordId })
      .from(listings).where(eq(listings.id, udlejerBolig))
    tjek('3 · annoncens ejer staar stadig paa boligen', bolig?.l === udlejer)
    tjek('4 · bruger med samtale bevaret', await findes(lejer))
    tjek('4 · samtalen bevaret', await harSamtale(samtale!.id))
    tjek('4 · beskeden bevaret', await harBesked(lejer))
    tjek('5 · oprydningen virker fortsat', !(await findes(overfloedig2)))
  }

  // ═══════════════════════════════════════════════════════════
  //  RUNDE 3 — hvert led for sig
  //
  //  Runde 1 og 2 gav alle deres brugere en KONTO, og saa er det
  //  `isNull(users.authUserId)` alene, der redder dem. En
  //  mutationsmaaling viste det: fjerner man ét af de syv
  //  `not exists`-led, bliver proeven ikke roed. Syv af vagtens ni
  //  betingelser var altsaa udokumenterede.
  //
  //  Her faar hver relation en bruger UDEN konto og UDEN Stripe, saa
  //  det eneste, der staar mellem hende og sletning, er praecis det
  //  ene led. Falder leddet, falder proeven.
  // ═══════════════════════════════════════════════════════════
  console.log('\n══ RUNDE 3 · hvert not-exists-led baerer alene ══')

  const kunSoegning = await nyBruger('kun-soegning')
  await db.insert(savedSearches).values({
    userId: kunSoegning, name: 'eneste søgning', criteria: { postnr: ['9900'] },
  })

  const kunFavorit = await nyBruger('kun-favorit')
  await db.insert(favorites).values({ userId: kunFavorit, listingId: await nyBolig(null) })

  const kunAbo = await nyBruger('kun-abo')
  await db.insert(subscriptions).values({
    userId: kunAbo, stripeSubscriptionId: `sub_ryd_solo_${STEMPEL}`,
    status: 'active', currentPeriodEnd: new Date(Date.now() + 86400000),
  })

  const kunAnnonce = await nyBruger('kun-annonce')
  const soloBolig = await nyBolig(kunAnnonce)

  // Samtalen kraever to parter. Hver af dem proever SIT led, saa
  // baade tenant_id og landlord_id er daekket hver for sig.
  const kunLejer = await nyBruger('kun-lejer')
  const kunUdlejer = await nyBruger('kun-udlejer')
  const [soloSamtale] = await db.insert(conversations).values({
    listingId: soloBolig, tenantId: kunLejer, landlordId: kunUdlejer,
  }).returning({ id: conversations.id })

  // Afsenderen er en TREDJE bruger, saa `messages.sender_id` ikke bare
  // arver beskyttelsen fra samtalens to parter.
  const kunAfsender = await nyBruger('kun-afsender')
  await db.insert(messages).values({
    conversationId: soloSamtale!.id, senderId: kunAfsender, body: 'Hej',
  })

  // Driftstilstandens revisionsspor. Samme krav som de oevrige:
  // uden konto og uden andet skal leddet alene holde raekken i live.
  const kunDrift = await nyBruger('kun-drift')
  await db.update(drift).set({ aendretAf: kunDrift }).where(eq(drift.id, true))

  // Et paabegyndt koeb. Cascade ville slette det i TAVSHED sammen med
  // brugeren — derfor skal leddet ogsaa baere alene.
  const kunKoeb = await nyBruger('kun-koeb')
  await db.insert(checkoutForsoeg).values({
    userId: kunKoeb, stripeSessionId: `cs_ryd_${STEMPEL}`, prisId: 'price_x',
    udloeberAt: new Date(Date.now() + 1800000),
  })

  // Og en frisk overfloedig, saa runden ogsaa maaler, at der RYDDES.
  const overfloedig3 = await nyBruger('overfloedig-3')

  const r3 = await koerRyd()
  tjek('runde 3 · ryd() gennemfoeres', r3.ok, r3.fejl ? `kastede: ${r3.fejl}` : '')

  if (r3.ok) {
    const led: [string, string][] = [
      ['saved_searches.user_id', kunSoegning],
      ['favorites.user_id', kunFavorit],
      ['subscriptions.user_id', kunAbo],
      ['listings.landlord_id', kunAnnonce],
      ['conversations.tenant_id', kunLejer],
      ['conversations.landlord_id', kunUdlejer],
      ['messages.sender_id', kunAfsender],
      ['drift.aendret_af', kunDrift],
      ['checkout_forsoeg.user_id', kunKoeb],
    ]
    for (const [navn, id] of led)
      tjek(`  uden konto, kun ${navn}: bevaret`, await findes(id))

    tjek('  overfloedig raekke ryddet i samme koersel', !(await findes(overfloedig3)))
    tjek('  og PRAECIS én — ikke en af de syv',
      r3.svar!.foraeldreloese === 1, `foraeldreloese=${r3.svar!.foraeldreloese}`)
  }

  // ═══════════════════════════════════════════════════════════
  //  RUNDE 4 — listen maa ikke blive for gammel
  //
  //  Vagten opregner syv fremmednoegler. Tilfoejer nogen en tabel med
  //  en FK til `users`, er den IKKE paa listen, og saa er vi tilbage
  //  ved den samme fejl: cascade sletter stille, no-action kaster.
  //  Det her tjek spoerger BASEN, ikke koden, saa en ny tabel goer
  //  proeven roed med det samme og navngiver den.
  // ═══════════════════════════════════════════════════════════
  console.log('\n══ RUNDE 4 · relationslisten mod basens egen katalog ══')
  const kendte = [
    'checkout_forsoeg.user_id', 'conversations.landlord_id',
    'conversations.tenant_id', 'drift.aendret_af', 'favorites.user_id',
    'listings.landlord_id', 'messages.sender_id', 'saved_searches.user_id',
    'subscriptions.user_id',
  ]
  // PGlite og postgres-js giver resultatet i hver sin form. Samme greb
  // som `raekker()` i scripts/tjek-rettigheder.ts.
  const raekker = <T,>(r: unknown): T[] => (r as { rows?: T[] }).rows ?? (r as T[])
  const fundne = raekker<{ rel: string }>(await db.execute(sql`
    select (c.conrelid::regclass)::text || '.' || a.attname as rel
    from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.users'::regclass
    order by 1`)).map((r) => r.rel)

  const mangler = fundne.filter((r) => !kendte.includes(r))
  const forael = kendte.filter((r) => !fundne.includes(r))
  tjek('alle fremmednoegler til users staar i vagten', mangler.length === 0,
    mangler.length ? `IKKE paa listen: ${mangler.join(', ')} — tilfoej den til ryd()` : '')
  tjek('vagten opregner ingen relation, der ikke findes', forael.length === 0,
    forael.length ? `staar i vagten, men ikke i basen: ${forael.join(', ')}` : '')
  console.log(`  basen har ${fundne.length}: ${fundne.join(', ')}`)
}

await koer()
console.log(fejl === 0 ? '\n  ALT GROENT\n' : `\n  ${fejl} FEJLEDE\n`)
if (fejl) process.exit(1)
