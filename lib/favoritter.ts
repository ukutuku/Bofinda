// ═══════════════════════════════════════════════════════════════
//  Favoritter.
//
//  Tabellen fandtes i forvejen — `favorites` er med i migration 0000 med
//  `unique(user_id, listing_id)` og fremmednoegler til begge sider. Der
//  bygges altsaa ingen ny datamodel her; der tages den i brug.
//
//  ═══ EJERSKABET ═══
//
//  `brugerId` kommer ALTID fra auth-sessionen paa serveren og ALDRIG fra
//  klienten. Ingen af funktionerne her tager imod et bruger-id, som en
//  browser har valgt — kalderen skal hente det med `hentBrugerId()` eller
//  `hentBruger()`, som begge laeser Supabase-sessionens cookie.
//
//  Det er ikke et ekstra lag oven paa RLS; det ER laget. Migration 0002
//  goer `revoke all ... from anon, authenticated` paa hele public og
//  opretter med vilje INGEN politikker: browseren kan overhovedet ikke naa
//  tabellen gennem PostgREST, og alt gaar gennem vores egen server som
//  ejer-rollen. En politik her ville vaere et lag foran en doer, der ikke
//  findes — og den kunne ikke proeves, for testbasens `auth.uid()` er en
//  stub, der giver null. Se CLAUDE.md under «RLS er ikke daekket».
//
//  Derfor proeves ejerskabet dér, hvor det faktisk haandhaeves: hver
//  skrivning og hver sletning baerer `user_id` i sin egen WHERE.
// ═══════════════════════════════════════════════════════════════

import { and, desc, eq, inArray } from 'drizzle-orm'
import { cache } from 'react'
import { db } from '../db/client'
import { favorites, listings, sources } from '../db/schema'
import { hentBrugerId } from './auth'

/** Hvad et boligkort skal vide for at tegne knappen. */
export type Favoritstatus =
  | { logget: false }
  | { logget: true; gemt: boolean }

/**
 * Brugerens gemte bolig-id'er — ét opslag pr. request.
 *
 * `cache()` deduplikerer pr. request, saa en side med 48 kort spoerger én
 * gang, ikke 48. Er ingen logget ind, spoerges der slet ikke.
 */
export const favoritIder = cache(async (): Promise<{
  logget: boolean; ider: ReadonlySet<string>
}> => {
  const brugerId = await hentBrugerId()
  if (!brugerId) return { logget: false, ider: new Set() }
  const raekker = await db.select({ id: favorites.listingId })
    .from(favorites).where(eq(favorites.userId, brugerId))
  return { logget: true, ider: new Set(raekker.map((r) => r.id)) }
})

/** Status for ét kort, udledt af opslaget ovenfor. */
export function statusFor(
  k: { logget: boolean; ider: ReadonlySet<string> }, listingId: string,
): Favoritstatus {
  return k.logget ? { logget: true, gemt: k.ider.has(listingId) } : { logget: false }
}

/**
 * Gem en bolig. Idempotent.
 *
 * `unique(user_id, listing_id)` findes allerede i skemaet, saa det andet
 * klik paa den samme bolig maa ikke blive en fejl — hverken for brugeren
 * eller for to faner aabne paa én gang. `onConflictDoNothing` lader
 * spaerringen goere sit arbejde i stedet for at lade os gaette, om raekken
 * var der i forvejen.
 */
export async function gemFavorit(brugerId: string, listingId: string): Promise<void> {
  await db.insert(favorites)
    .values({ userId: brugerId, listingId })
    .onConflictDoNothing({ target: [favorites.userId, favorites.listingId] })
}

/**
 * Fjern en bolig igen.
 *
 * `user_id` staar i WHERE. Uden det ville et gaettet bolig-id kunne slette
 * en fremmeds raekke — og det er praecis den fejl, der ikke maa kunne
 * skrives ved et uheld.
 */
export async function fjernFavorit(brugerId: string, listingId: string): Promise<void> {
  await db.delete(favorites)
    .where(and(eq(favorites.userId, brugerId), eq(favorites.listingId, listingId)))
}

export async function erFavorit(brugerId: string, listingId: string): Promise<boolean> {
  const [r] = await db.select({ id: favorites.listingId }).from(favorites)
    .where(and(eq(favorites.userId, brugerId), eq(favorites.listingId, listingId)))
    .limit(1)
  return Boolean(r)
}

/** Én gemt bolig, som Min side viser den. */
export interface GemtBolig {
  listingId: string
  gemtDen: Date
  /** Null naar boligen er slettet under os. Raekken staar stadig. */
  adresse: string | null
  postnr: string | null
  by: string | null
  kilde: string | null
  pris: number | null
  /** Er den til at leje endnu? Se noten ved `tilgaengelig`. */
  status: 'aktiv' | 'afmeldt' | 'forsvundet'
}

/**
 * Brugerens gemte boliger, nyeste foerst.
 *
 * ═══ EN AFMELDT BOLIG SKJULES IKKE ═══
 *
 * Boligen kan vaere blevet afmeldt, siden hun gemte den. Det er fristende
 * bare at lade den falde ud af listen — men saa forsvinder noget, hun selv
 * har lagt der, uden at nogen siger hvorfor, og hun kan ikke vide, om hun
 * kom til at fjerne den. Den bliver staaende med sin rigtige tilstand og
 * kan stadig fjernes.
 *
 * Tre tilstande, ikke to:
 *   aktiv       til at leje endnu
 *   afmeldt     kilden har taget den ned
 *   forsvundet  raekken i `listings` findes ikke mere
 *
 * `forsvundet` kan i praksis kun opstaa, hvis nogen sletter en bolig
 * direkte i basen — fremmednoeglen er `on delete cascade`, saa favoritten
 * ville normalt forsvinde med den. Tilstanden findes alligevel, fordi
 * kortet ellers skulle gaette paa et null.
 */
export async function hentFavoritter(brugerId: string): Promise<GemtBolig[]> {
  const raekker = await db
    .select({
      listingId: favorites.listingId,
      gemtDen: favorites.createdAt,
      adresse: listings.addressRaw,
      postnr: listings.postalCode,
      by: listings.city,
      kilde: sources.name,
      leje: listings.rentMonthly,
      total: listings.totalMonthly,
      listingStatus: listings.status,
    })
    .from(favorites)
    .leftJoin(listings, eq(listings.id, favorites.listingId))
    .leftJoin(sources, eq(sources.id, listings.sourceId))
    .where(eq(favorites.userId, brugerId))
    .orderBy(desc(favorites.createdAt))

  return raekker.map((r) => ({
    listingId: r.listingId,
    gemtDen: r.gemtDen,
    adresse: r.adresse,
    postnr: r.postnr,
    by: r.by,
    kilde: r.kilde,
    // Samme udtryk som `PRIS` i lib/soeg.ts: totalen naar vi har den,
    // ellers huslejen. Kortet siger selv hvilken af delene det er.
    pris: r.total ?? r.leje,
    status: r.adresse == null ? 'forsvundet'
      : r.listingStatus === 'active' ? 'aktiv' : 'afmeldt',
  }))
}

/** Bolig-id'er der stadig kan lejes. Til proever og til taellinger. */
export async function aktiveBlandt(ider: string[]): Promise<Set<string>> {
  if (!ider.length) return new Set()
  const r = await db.select({ id: listings.id }).from(listings)
    .where(and(inArray(listings.id, ider), eq(listings.status, 'active')))
  return new Set(r.map((x) => x.id))
}
