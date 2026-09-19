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

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { cache } from 'react'
import { db } from '../db/client'
import { favorites, listings, sources } from '../db/schema'
import { hentBrugerId } from './auth'
import { type Gemoenske, type Gemudfald } from './gemoenske'
// Billedernes allowlist skrives ikke af i SQL her. `VISBAR_VAERT` er det
// ene udtryk, soegesiden taeller og vaelger forsidebilleder med; en kopi
// ville vaere praecis den form for dobbelthed, CLAUDE.md samler seks
// tilfaelde af — to rigtige udtryk, der driver fra hinanden.
import { VISBAR_VAERT } from './soeg'

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
 * Gennemfoer et ventende gemmeoenske — hjerteklikket fra foer login.
 *
 * ═══ HVORFOR DEN IKKE ER `skiftFavorit` ═══
 *
 * `skiftFavorit` slaar TIL ELLER FRA. Havde hun boligen gemt i forvejen
 * — fra telefonen, fra en anden fane, fra i gaar — ville et gennemfoert
 * oenske FJERNE den. Hun trykkede paa et tomt hjerte og ville have
 * boligen gemt; at logge ind maa ikke kunne koste hende en favorit.
 * Derfor `gemFavorit`, som er idempotent i kraft af
 * `unique(user_id, listing_id)`, og som derfor ogsaa taaler et
 * dobbeltklik paa login-knappen.
 *
 * ═══ EN BOLIG, DER IKKE FINDES, SKAL SIGES HOEJT ═══
 *
 * Fremmednoeglen ville kaste, og en kastende server action midt i et
 * login ville se ud som «login fejlede» for hende — mens hun faktisk ER
 * logget ind. Opslaget herunder er derfor ikke pynt: det er forskellen
 * paa en besked og en fejlside.
 *
 * Status tjekkes IKKE. En bolig kan vaere afmeldt, mellem hjerteklikket
 * og login, og den skal stadig kunne gemmes — Min side viser den med
 * «Ikke laengere tilgaengelig», som enhver anden afmeldt favorit. At
 * afvise den her ville skjule, at kilden tog den ned.
 *
 * `brugerId` kommer fra kalderens verificerede session, aldrig fra
 * klienten — som alt andet i denne fil.
 *
 * ═══ DEN TAGER DET LAESTE OENSKE, IKKE DEN RAA VAERDI ═══
 *
 * `laesGemOenske` koeres ét sted, i den handling der modtog formularen.
 * Gjorde den det OGSAA her, ville formen blive laest to gange, og de to
 * laesninger kunne drive fra hinanden — praecis den fejlform, CLAUDE.md's
 * tabel samler seks tilfaelde af. Kalderen skal desuden kunne skelne
 * «intet oenske» fra «ugyldigt oenske» FOER den spoerger basen: det
 * foerste er et almindeligt login, der intet skal sige.
 */
export async function gemOenske(brugerId: string, oenske: Gemoenske): Promise<Gemudfald> {
  if (oenske.slags !== 'id') return 'ugyldigt-link'
  const [r] = await db.select({ id: listings.id }).from(listings)
    .where(eq(listings.id, oenske.id)).limit(1)
  if (!r) return 'ukendt-bolig'
  await gemFavorit(brugerId, oenske.id)
  return 'gemt'
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

/**
 * Én gemt bolig, som Min side viser den.
 *
 * ═══ HVORFOR DER IKKE ER ÉT `pris`-FELT ═══
 *
 * Feltet hed foer `pris` og blev udregnet som `total ?? leje`. Udtrykket
 * er rigtigt — det er det samme som `PRIS` i lib/soeg.ts — men det
 * kastede SVARET vaek: modtageren kunne ikke laengere se, om tallet var
 * hele beloebet til udlejeren eller bare huslejen. Kommentaren lovede at
 * «kortet siger selv hvilken af delene det er», og det kunne kortet ikke,
 * for det havde kun ét tal. Begge dele baeres derfor hver for sig, og
 * kortet skelner dem med ord — som soegekortet goer.
 *
 * Felterne herunder er VISNINGSFELTER. De laeses af Min side og ingen
 * andre steder; ingen af dem aendrer, hvad der gemmes eller fjernes.
 */
export interface GemtBolig {
  listingId: string
  gemtDen: Date
  /** Null naar boligen er slettet under os. Raekken staar stadig. */
  adresse: string | null
  postnr: string | null
  by: string | null
  kilde: string | null

  // ── Hvad boligen ER ────────────────────────────────────────
  // Null = ikke oplyst. Kortet udelader leddet; en pladsholder som
  // «— vaer.» ville vaere et opdigtet tal.
  type: string | null
  vaerelser: number | null
  areal: number | null

  // ── Oekonomien ─────────────────────────────────────────────
  /** Huslejen alene. */
  leje: number | null
  /** Husleje + den aconto, kilden opkraever. Null = ikke kendt. */
  total: number | null
  // Til `eltilstand()`. El-forbeholdet stilles ÉT sted for alle tre
  // korttyper — se `Ellinje` i app/Boligkort.tsx. Uden de tre felter
  // kunne Min side vise en groen total uden at goere rede for el, og
  // det er praecis den fejl, der stod paa 171 gruppekort.
  el: number | null
  elEgenMaaler: boolean | null
  poster: string[] | null

  // ── Billedet ───────────────────────────────────────────────
  /** Kildens egen URL paa foerste VISBARE billede. Null = intet. */
  forside: string | null
  /** Antal billeder vi faktisk kan vise. Samme filter som `forside`. */
  billeder: number
  /** Kilden tager forbehold for, at billederne kan vaere af en anden bolig. */
  billedforbehold: boolean

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
      type: listings.propertyType,
      vaerelser: listings.rooms,
      areal: listings.sizeM2,
      leje: listings.rentMonthly,
      total: listings.totalMonthly,
      el: listings.utilitiesElectricity,
      elEgenMaaler: listings.electricityOwnMeter,
      poster: listings.totalMonthlyComponents,
      billedforbehold: listings.imagesMayDiffer,
      // Kun billeder vi FAKTISK kan vise, og forsidebilledet som
      // `position` bestemmer det. Ordret de to underforespoergsler fra
      // `KOLONNER` i lib/soeg.ts, med det samme `VISBAR_VAERT`:
      // taellingen og billedet skal svare paa det samme spoergsmaal, og
      // kortet skal ikke kunne skrive «3 billeder» over et tomt felt.
      //
      // Noeglen er `favorites.listingId` og ikke `listings.id`: joinet er
      // et LEFT JOIN, saa `listings.id` er null for en bolig, der er
      // forsvundet under os — og en underforespoergsel paa null ville
      // vaere en stille null frem for et aerligt nul.
      billeder: sql<number>`(select count(*)::int from listing_images i
        where i.listing_id = ${favorites.listingId} and ${VISBAR_VAERT})`,
      forside: sql<string | null>`(
        select i.external_url from listing_images i
        where i.listing_id = ${favorites.listingId} and ${VISBAR_VAERT}
        order by i.position limit 1)`,
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
    type: r.type,
    vaerelser: r.vaerelser,
    areal: r.areal,
    // Huslejen og totalen hver for sig. Se noten paa `GemtBolig`.
    leje: r.leje,
    total: r.total,
    el: r.el,
    elEgenMaaler: r.elEgenMaaler,
    poster: r.poster,
    forside: r.forside,
    billeder: r.billeder ?? 0,
    // `imagesMayDiffer` er NOT NULL i skemaet, men joinet er et LEFT
    // JOIN: er boligen forsvundet, er hele raekken null. Fravaer af en
    // bolig er ikke et forbehold.
    billedforbehold: r.billedforbehold ?? false,
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
