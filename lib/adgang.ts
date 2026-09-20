// ═══════════════════════════════════════════════════════════════
//  DEN CENTRALE ADGANGSKONTROL
//
//  Ét sted afgoer, om en bruger maa naa en betalt funktion. Alle
//  indgange spoerger den samme funktion — `maaBruge()` — og ingen af
//  dem bygger sit eget praedikat.
//
//  Hvorfor ét sted: CLAUDE.md's dyreste regel er, at to udtryk for det
//  samme spoergsmaal driver fra hinanden, og at BEGGE ser rigtige ud
//  hver for sig. En mur, der staar tre steder, er tre mure, og den ene
//  bliver glemt. Derfor er `maaBruge()` den eneste, der laeser baade
//  driftstilstanden og abonnementet.
//
//  ── Graensefladen, beskedmodulet skal bruge ──────────────────
//  Beskedmodulet bygges i en anden gren og maa IKKE lave sin egen
//  regel. Den bruger:
//
//      import { maaBruge, FUNKTION } from '../lib/adgang'
//      const svar = await maaBruge(FUNKTION.beskeder)
//      if (!svar.ok) return svar        // svar.grund siger hvorfor
//
//  Den besluttede adfaerd for beskeder er allerede indbygget i
//  `FUNKTION.beskeder`: GRATIS kraever login (egne samtaler), BETALING
//  kraever et gyldigt abonnement, og en OPSAGT men endnu ikke udloebet
//  periode giver stadig adgang. Ved udloeb laases laesning og
//  afsendelse — beskederne slettes ikke; det er visningens ansvar at
//  sige det.
//
//  ── Fejl lukker, den aabner ikke ─────────────────────────────
//  GRATIS er den AABNE tilstand. Kan tilstanden ikke laeses, ville et
//  fallback til gratis vaere at give adgangen vaek, fordi databasen
//  hikkede. Derfor falder vi tilbage til BETALING og naegter — med en
//  fejltekst, der siger at vi ikke kunne bekraefte adgangen, ikke at
//  hun skal koebe. At sende et menneske til kassen paa grund af vores
//  egen fejl ville vaere den samme loegn som et gaettet aconto-beloeb.
// ═══════════════════════════════════════════════════════════════

import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '../db/client'
import { drift, subscriptions } from '../db/schema'
import { hentBrugerId } from './auth'

export type Tilstand = 'gratis' | 'betaling'

/**
 * De funktioner, muren kan staa foran. Et LUKKET saet: en ny indgang
 * skal navngives her, ikke opfindes paa stedet.
 */
export const FUNKTION = {
  /** Udlejerens mail og telefon paa en native annonce. */
  kontakt: 'kontakt',
  /** Videresendelse til kildens egen annonce, /go/[id]. */
  kildelink: 'kildelink',
  /** Beskedmodulet. Bygges senere; reglen staar her allerede. */
  beskeder: 'beskeder',
} as const
export type Funktion = typeof FUNKTION[keyof typeof FUNKTION]

/** Hvorfor adgangen blev naegtet. Visningen vaelger tekst ud fra den. */
export type Grund =
  | 'abonnement_kraeves'   // BETALING, ingen gyldig adgang → vis koeb
  | 'login_kraeves'        // funktionen kraever en konto
  | 'ukendt_tilstand'      // vi kunne ikke laese tilstanden → vores fejl

export type Adgangssvar =
  | { ok: true; tilstand: Tilstand; adgangTil: Date | null }
  | { ok: false; tilstand: Tilstand; grund: Grund; adgangTil: null }

/**
 * Driftstilstanden, laest paa serveren.
 *
 * Ikke cachet. Tilstanden er en NOEDBREMSE: bliver den slaaet til,
 * skal den virke i samme sekund, og en femminutters cache ville
 * betyde, at muren stod aaben i fem minutter efter, nogen lukkede den.
 * Prisen er ét indeksopslag paa en tabel med én raekke — og den koeres
 * kun paa de faa ruter, der faktisk spoerger.
 *
 * KASTER IKKE. Kan raekken ikke laeses, returneres null, og kaldet
 * ovenfor behandler det som «betaling» (=naegt).
 */
export async function hentTilstand(): Promise<Tilstand | null> {
  try {
    const [r] = await db.select({ t: drift.tilstand }).from(drift).limit(1)
    return r?.t ?? null
  } catch {
    return null
  }
}

/**
 * Har brugeren en BETALT, endnu ikke udloebet adgangsperiode?
 *
 * Maalt paa `adgangTil`, ikke paa `status`. En opsagt bruger har
 * `cancel_at_period_end = true` og status `active` indtil perioden
 * loeber ud — hun har betalt for den tid og beholder den. En bruger,
 * hvis fornyelse MISLYKKEDES, har `past_due` og en `adgangTil`, der
 * ikke blev flyttet: hun falder ud, naar den gamle periode udloeber,
 * og ikke et sekund foer.
 */
export async function harBetaltAdgang(brugerId: string): Promise<Date | null> {
  const svar = await adgangEller(brugerId)
  return svar === 'fejl' ? null : svar
}

/**
 * Som `harBetaltAdgang`, men skelner «ingen adgang» fra «vi kunne ikke
 * finde ud af det».
 *
 * Forskellen er ikke teknisk pedanteri: «ingen adgang» sender et
 * menneske til kassen, «vi kunne ikke finde ud af det» siger undskyld.
 * Blandes de to, opkraever vi nogen for vores egen databasefejl.
 */
async function adgangEller(brugerId: string): Promise<Date | null | 'fejl'> {
  try {
    return await slaaAdgangOp(brugerId)
  } catch {
    return 'fejl'
  }
}

async function slaaAdgangOp(brugerId: string): Promise<Date | null> {
  const [r] = await db
    .select({ til: subscriptions.adgangTil })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.userId, brugerId),
      gt(subscriptions.adgangTil, new Date()),
    ))
    .orderBy(desc(subscriptions.adgangTil))
    .limit(1)
  return r?.til ?? null
}

/**
 * DEN ENESTE adgangsbeslutning. Alle indgange gaar gennem den.
 *
 * `brugerId` kan gives med, naar kaldet allerede har slaaet den op —
 * ellers hentes den fra den VERIFICEREDE session. Den maa aldrig komme
 * fra browseren.
 */
export async function maaBruge(
  funktion: Funktion,
  brugerId?: string | null,
): Promise<Adgangssvar> {
  const tilstand = await hentTilstand()
  if (tilstand === null) {
    // Vores fejl, ikke brugerens. Naegt, men sig hvad der er galt.
    return { ok: false, tilstand: 'betaling', grund: 'ukendt_tilstand', adgangTil: null }
  }

  if (tilstand === 'gratis') {
    // Muren er fra. Beskeder kraever STADIG login — gratis tilstand
    // aendrer ikke kontoejerskab eller beskyttelsen af private data.
    if (funktion === FUNKTION.beskeder) {
      const id = brugerId ?? await hentBrugerId()
      return id
        ? { ok: true, tilstand, adgangTil: null }
        : { ok: false, tilstand, grund: 'login_kraeves', adgangTil: null }
    }
    return { ok: true, tilstand, adgangTil: null }
  }

  // BETALING. Alt herunder kraever baade en konto og en betalt periode.
  const id = brugerId ?? await hentBrugerId()
  if (!id) return { ok: false, tilstand, grund: 'login_kraeves', adgangTil: null }

  const til = await adgangEller(id)
  // Kunne opslaget ikke laves, er det VORES fejl — ikke en manglende
  // betaling. Fail-closed gaelder begge led: baade tilstanden og
  // abonnementet naegter ved fejl, men de siger hver sin sandhed om
  // hvorfor.
  if (til === 'fejl') {
    return { ok: false, tilstand, grund: 'ukendt_tilstand', adgangTil: null }
  }
  return til
    ? { ok: true, tilstand, adgangTil: til }
    : { ok: false, tilstand, grund: 'abonnement_kraeves', adgangTil: null }
}

/**
 * Maa vi overhovedet VISE en betalingsboks?
 *
 * Kun i BETALING. I gratis tilstand findes der ingen koebsvej — hverken
 * en boks, en knap eller en checkout-handling, der kan kaldes direkte.
 */
export async function maaKoebe(): Promise<boolean> {
  return (await hentTilstand()) === 'betaling'
}
