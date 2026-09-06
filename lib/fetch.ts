// ═══════════════════════════════════════════════════════════════
//  Hoeflig HTTP.
//  Bofinda praesenterer sig altid, holder ét request i sekundet per
//  domaene og trapper ned paa 429 og 503. Der er ingen omgaaelse af
//  bot-beskyttelse her, og der skal ikke komme nogen.
// ═══════════════════════════════════════════════════════════════

import { laesRetryAfter, spaer, SPAERRE_MS, spaerretTil, VaertBlokeretFejl } from './vaertsspaerre'

const UA = process.env.CRAWLER_USER_AGENT
  ?? 'BofindaBot/1.0 (+https://bofinda.dk/bot; kontakt@bofinda.dk)'
const RATE_MS = Number(process.env.CRAWLER_RATE_MS ?? 1000)

/**
 * Vaerter der skal have mere luft end standardtakten. Heimstadens CDN
 * droevler VEDVARENDE crawl: maalt 2026-09-06 blev alle kald fra denne
 * IP moedt med 503 efter ~17 minutter ved ét kald i sekundet — uanset
 * User-Agent. Ikke bot-beskyttelse af enkeltkald, men af moensteret.
 */
const VAERTSTAKT: Record<string, number> = {
  'www.heimstaden.dk': 5000,
}
const takt = (host: string) => VAERTSTAKT[host] ?? RATE_MS

// ── Vaertsspaerre ──────────────────────────────────────────────
// 429 og 503 er vaertens besked om at stoppe — ikke en invitation til at
// proeve igen med det samme. Efter ét hoefligt genforsoeg spaerres HELE
// vaerten, og alle videre kald kaster VaertBlokeretFejl uden at roere
// netvaerket. Spaerren er pr. VAERT (og pr. runner-egress), ikke pr.
// kilde: deler to kilder samme CDN, rammes de samlet — det er meningen.
//
// SELVE tilstanden bor i lib/vaertsspaerre.ts, som holder den i basen med
// en kort lokal cache foran. Denne fil kalder den; den ejer den ikke.
// Uden det ville en Railway-proces og den lokale import ikke kunne se
// hinandens spaerrer, og et redeploy ville glemme alt.
//
// Fejlen kastes paa SELVE UDLOESNINGSKALDET — ikke foerst ved det naeste.
// Ellers ville udloesningen se ud som en almindelig sidefejl: boligen kom
// i tilbagetraekning for noget, vaerten gjorde, og en spaerre udloest paa
// koerslens sidste kald blev aldrig skrevet nogen steder.
export { VaertBlokeretFejl } from './vaertsspaerre'

/** Svar der betyder "kom igen", ikke "findes ikke". */
const MIDLERTIDIGE = new Set([429, 502, 503, 504])

/** Loft over ét enkelt ophold. Uden det bliver 2^n absurd ved mange forsoeg. */
const MAX_BACKOFF_MS = 60_000

/** Sidste kald per domaene. Koeen er per proces — én worker ad gangen. */
const lastHit = new Map<string, number>()

async function pace(host: string) {
  const prev = lastHit.get(host) ?? 0
  const wait = prev + takt(host) - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastHit.set(host, Date.now())
}

export async function politeFetch(
  url: string,
  tries = 3,
  init: RequestInit = {},
): Promise<Response> {
  const host = new URL(url).host

  for (let attempt = 1; attempt <= tries; attempt++) {
    // Tjekkes foer HVERT kald, ikke kun ved indgangen: en anden proces kan
    // have spaerret vaerten imens, og cachen henter den ved sit naeste
    // TTL-udloeb. Det er den eneste vej, tilstanden naar herind — der er
    // hverken Redis eller notifikationer.
    const til = await spaerretTil(host)
    if (til) throw new VaertBlokeretFejl(host, til)

    await pace(host)

    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        'User-Agent': UA,
        // Uden disse afviser flere danske hosts (Simply.com foran laros og
        // dacas) forespoergslen med 454. Det er ikke omgaaelse — det er at
        // tale HTTP ordentligt.
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })

    // 502/504 kom til, da lokalbolig.dk laa nede bag Varnish. En kilde,
    // hvis backend blinker, skal ikke se ud som en kilde, der har droppet
    // hele sit udbud — den skal proeves igen.
    if (MIDLERTIDIGE.has(res.status)) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Math.min(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RATE_MS * 2 ** attempt,
        MAX_BACKOFF_MS,
      )
      // 429/503 er "stop" — ét hoefligt genforsoeg, saa spaerres vaerten.
      // 502/504 er "backend blinker" (lokalbolig bag Varnish) og beholder
      // den fulde genforsoegsraekke uden spaerre.
      if (res.status === 429 || res.status === 503) {
        if (attempt >= Math.min(2, tries)) {
          // Kildens eget Retry-After er et MINIMUM, ikke et loft: beder
          // den om en time, venter vi en time. Ugyldig eller fortidig
          // vaerdi giver null og forkorter derfor aldrig standarden.
          // (Bemaerk: `backoff` ovenfor er soevnen mellem to forsoeg og
          // clampes til 60 s. Det har intet med blokvarigheden at goere.)
          const sek = Math.max(
            Math.round(SPAERRE_MS / 1000),
            laesRetryAfter(res.headers.get('retry-after')) ?? 0,
          )
          const til = await spaer(host, sek,
            `HTTP ${res.status} paa ${url.slice(0, 200)}`)
          throw new VaertBlokeretFejl(host, til)
        }
      } else if (attempt === tries) {
        return res
      }
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }

    return res
  }

  throw new Error(`uopnaaelig efter ${tries} forsoeg: ${url}`)
}
