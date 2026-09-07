// ═══════════════════════════════════════════════════════════════
//  Skrivevejen for produktanalytics.
//
//  DENNE FIL MÅ IKKE IMPORTERE `next/server` ELLER `next/headers` PÅ
//  MODULNIVEAU. lib/alarm.ts kalder `spor()`, og lib/alarm.ts importeres
//  af scripts/import.ts og scripts/alarm.ts, som kører i tsx på Railway
//  UDEN Next omkring sig. Et topniveau-import ville vælte workeren ved
//  første kørsel — samme klasse som reglen om lib/faciliteter.ts og
//  databasen. Begge Next-moduler hentes derfor dynamisk bag
//  `process.env.NEXT_RUNTIME`.
//
//  FAIL-OPEN. Hele `spor()` ligger i try/catch, og skrivningen lægges
//  efter svaret. En fejl her må hverken kaste ind i en server action,
//  forsinke en sidevisning eller ændre et returneret resultat.
// ═══════════════════════════════════════════════════════════════

import { cache } from 'react'
import { sql as dsql } from 'drizzle-orm'
import { db } from '../db/client'
import { haendelser } from '../db/schema'
import {
  aktiv, iStikproeve, miljoe, rens,
  type Afvisning, type Haendelse, type Kontekst, type Raekke, type Rute,
} from './maaling'
import { C_ANONYM, C_FORSOEG, C_SESSION, laesForsoeg, laesSamtykke, type Laeser } from './samtykke'

// ─── Dedup pr. request ─────────────────────────────────────────

/**
 * React `cache()` memoiserer pr. request, så to kald til samme event i én
 * sidevisning bliver til én række.
 *
 * Bindingen kan sprøjtes ud for prøverne: PGlite har ingen React-request
 * at hænge `cache()` op i, og en prøve, der ikke kan blive rød, er et
 * grønt flueben uden dækning. Prøven måler altså dedup-LOGIKKEN; at
 * `cache()` faktisk er request-scoped er Reacts ansvar.
 */
const perRequest = cache(() => new Set<string>())
let _hukommelse: Set<string> | null = null
export function _saetDedup(s: Set<string> | null) { _hukommelse = s }
function husket(): Set<string> {
  if (_hukommelse) return _hukommelse
  try { return perRequest() } catch { return new Set() }
}

// ─── Afviste events ────────────────────────────────────────────

/**
 * Droppet er ikke stille. Der logges eventnavn og den NØGLE, der udløste
 * afvisningen — aldrig værdien. Ellers ville værnet skjule den fejl, det
 * findes for at afsløre.
 */
const _afvist: { navn: string; grund: string; detalje: string }[] = []
export function afvisninger() { return _afvist.slice() }
export function _nulstilAfvisninger() { _afvist.length = 0 }

function noterAfvist(navn: string, f: Afvisning) {
  _afvist.push({ navn, grund: f.grund, detalje: f.detalje })
  process.stdout.write(`[maaling] afvist ${navn}: ${f.grund} (${f.detalje})\n`)
}

// ─── Kontekst ──────────────────────────────────────────────────

/**
 * Identiteten kommer fra cookies, sat af middleware efter et ja.
 *
 * Er der ikke samtykke, er der ingen cookies, og så er der ingen kontekst
 * — og dermed intet event. Det er skærpelsen: der findes ikke et lag
 * nedenunder, som gemmer individuelle events uden identifikator.
 */
/**
 * Sprøjtes ind af prøverne, aldrig af produktionskode.
 *
 * `next/headers` findes ikke i tsx, så uden den her ville hvert eneste
 * serverside-event være uprøveligt — og en spærring, ingen har set fejle,
 * er ingen spærring. Samme greb som `indsaetBase` i db/client.ts.
 */
let _testkontekst: Kontekst | null = null
export function _saetKontekst(k: Kontekst | null) { _testkontekst = k }

async function kontekst(rute: Rute, brugerId?: string | null): Promise<Kontekst | null> {
  if (_testkontekst) return { ..._testkontekst, rute, userId: brugerId ?? _testkontekst.userId ?? null }
  if (!process.env.NEXT_RUNTIME) return null // worker/tsx: ingen browser, ingen cookies
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  const faa: Laeser = (n) => jar.get(n)?.value
  if (laesSamtykke(faa) !== 'ja') return null
  const anonymousId = faa(C_ANONYM)
  const sessionId = faa(C_SESSION)?.split('.')[0]
  if (!anonymousId || !sessionId) return null
  const m = miljoe()
  if (!m) return null
  return {
    miljoe: m,
    anonymousId,
    sessionId,
    userId: brugerId ?? null,
    researchSessionId: laesForsoeg(faa),
    rute,
  }
}

/** `after()` findes kun i Next. I workeren skrives der direkte. */
async function efter(fn: () => Promise<void>): Promise<void> {
  if (process.env.NEXT_RUNTIME) {
    try {
      const { after } = await import('next/server')
      after(fn)
      return
    } catch { /* uden for en request: skriv direkte */ }
  }
  await fn()
}

// ─── Sporing ───────────────────────────────────────────────────

export interface SporOptioner {
  /** Vores egen brugerrække. ALDRIG mailadressen. */
  brugerId?: string | null
  /** Sat af /api/maaling, som har konteksten fra sit eget request. */
  kontekst?: Kontekst
  nu?: Date
}

/**
 * Registrér et event. Kaster aldrig.
 *
 * Rækkefølgen er: tændt? → miljø? → samtykke? → renset? → dedup? → skriv.
 * Falder ét af leddene, sker der ingenting, og produktet mærker det ikke.
 */
export async function spor(
  h: Haendelse, rute: Rute, o: SporOptioner = {},
): Promise<void> {
  try {
    if (!aktiv()) return
    const k = o.kontekst ?? await kontekst(rute, o.brugerId)
    if (!k) return

    // Impressions findes kun for stikprøvens sessioner. Tjekket ligger
    // ogsaa her, ikke kun i browseren: klienten kan ikke stoles paa, og
    // sample_andel skal svare til den andel, raekken faktisk blev
    // optaget under.
    if (h.navn === 'listing_impression' && !iStikproeve(k.sessionId)) return

    const nu = o.nu ?? new Date()
    const r = rens(h, k, nu)
    if (!r.ok) { noterAfvist(h.navn, r.fejl); return }
    for (const n of r.renset.droppedeNoegler) {
      noterAfvist(h.navn, { grund: 'ukendt-property', detalje: n })
    }

    const noegle = dedupnoegle(r.renset.raekke)
    const set = husket()
    if (set.has(noegle)) return
    set.add(noegle)

    await efter(() => skriv(r.renset.raekke))
  } catch {
    // Fail-open. Målingen må aldrig kunne vælte søgning, boligvisning,
    // source-click, alarm eller login.
  }
}

/**
 * Hvad der gør to events til "det samme" i én request.
 *
 * Impressions dedupes på (session, listing, result_view) — også på tværs
 * af requests, hvilket klienten selv håndhæver med sin egen Set. Her
 * fanges kun dubletten inden for samme sidevisning.
 */
function dedupnoegle(r: Raekke): string {
  if (r.eventName === 'listing_impression') {
    return `imp:${r.sessionId}:${r.listingId}:${String(r.properties.result_view_id)}`
  }
  return `${r.eventName}:${r.route}:${r.listingId ?? ''}:${JSON.stringify(r.properties)}`
}

async function skriv(r: Raekke): Promise<void> {
  try {
    await db.insert(haendelser).values({
      eventName: r.eventName,
      environment: r.environment,
      anonymousId: r.anonymousId,
      sessionId: r.sessionId,
      userId: r.userId,
      researchSessionId: r.researchSessionId,
      route: r.route,
      listingId: r.listingId,
      sourceSlug: r.sourceSlug,
      properties: r.properties,
      expiresAt: r.expiresAt,
    })
  } catch (e) {
    // En databasefejl i analytics er stadig fail-open. Den skal ses i
    // loggen, ikke i brugerens svar.
    process.stdout.write(`[maaling] skrivning fejlede: ${(e as Error).message}\n`)
  }
}

// ─── Oprydning ─────────────────────────────────────────────────

/**
 * Bundet oprydning. Kører hver time efter importen, sammen med `ryd()`.
 *
 * Bundet med vilje: en ubundet delete på en tabel med millioner af rækker
 * holder låsen længe og risikerer Supabases statement timeout. Med 20.000
 * ad gangen og højst fem runder er loftet 100.000 rækker i timen —
 * rigeligt over tilvæksten i ethvert af scenarierne i docs.
 *
 * «Et expires_at-felt uden en faktisk sletteproces er ikke retention.»
 */
export async function ryddHaendelser(): Promise<number> {
  let slettet = 0
  for (let runde = 0; runde < 5; runde++) {
    const r = await db.execute(dsql`
      delete from haendelser
      where id in (select id from haendelser where expires_at < now() limit 20000)
    `)
    const n = antalAf(r)
    slettet += n
    if (n < 20000) break
  }
  return slettet
}

/**
 * Dagsaggregatet. Uden det er trenden væk, når de rå events slettes, og
 * så kan september ikke sammenlignes med september.
 *
 * `sample_andel` følger med, fordi listing_impression er stikprøvet: et
 * aggregat, der gemmer 25 % af sandheden som om det var 100 %, er en
 * løgn, ingen opdager.
 */
export async function opdaterDagsaggregat(dage = 2): Promise<number> {
  const r = await db.execute(dsql`
    insert into haendelser_daglig (dato, environment, event_name, source_slug, antal, sample_andel)
    select to_char(occurred_at, 'YYYY-MM-DD'),
           environment,
           event_name,
           coalesce(source_slug, ''),
           count(*)::int,
           coalesce(avg((properties->>'sample_andel')::numeric), 1)
    from haendelser
    where occurred_at >= now() - make_interval(days => ${dage})
    group by 1, 2, 3, 4
    on conflict (dato, environment, event_name, source_slug)
    do update set antal = excluded.antal, sample_andel = excluded.sample_andel
  `)
  return antalAf(r)
}

/** postgres-js og PGlite tæller på hver sin måde. */
function antalAf(r: unknown): number {
  const x = r as { count?: number; rowCount?: number; affectedRows?: number }
  return x?.count ?? x?.rowCount ?? x?.affectedRows ?? 0
}

/**
 * Sletteretten, udøvet af browseren selv.
 *
 * Vi kender ikke personen bag `anonymous_id`, og det er netop pointen:
 * hun kan bede om sletning uden først at identificere sig. Indekset på
 * (session_id, occurred_at) hjælper ikke her, men mængden pr. browser er
 * lille nok til at en scanning er ligegyldig.
 */
export async function sletForAnonym(anonymId: string): Promise<number> {
  const r = await db.execute(dsql`
    delete from haendelser where anonymous_id = ${anonymId}::uuid
  `)
  return antalAf(r)
}

/**
 * Hvad siden skal fortælle klienttrackeren.
 *
 * `impressions` afgøres SERVERSIDE af stikprøven, ikke i browseren:
 * sessions-id'et er HttpOnly, og valget skal være det samme ved hver
 * request i sessionen. Ruten /api/maaling tjekker det igen, fordi en
 * klient aldrig er et bevis.
 */
export async function maalingstilstand(): Promise<{ aktiv: boolean; impressions: boolean }> {
  const fra = { aktiv: false, impressions: false }
  try {
    if (!aktiv() || !process.env.NEXT_RUNTIME) return fra
    const { cookies } = await import('next/headers')
    const jar = await cookies()
    const faa: Laeser = (n) => jar.get(n)?.value
    if (laesSamtykke(faa) !== 'ja') return fra
    const sid = faa(C_SESSION)?.split('.')[0]
    if (!sid || !faa(C_ANONYM) || !miljoe()) return fra
    return { aktiv: true, impressions: iStikproeve(sid) }
  } catch {
    return fra
  }
}
