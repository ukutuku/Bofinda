// ═══════════════════════════════════════════════════════════════
//  Hoeflig HTTP.
//  Bofinda praesenterer sig altid, holder ét request i sekundet per
//  domaene og trapper ned paa 429 og 503. Der er ingen omgaaelse af
//  bot-beskyttelse her, og der skal ikke komme nogen.
// ═══════════════════════════════════════════════════════════════

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
// vaerten i SPAERRE_MS, og alle videre kald kaster VaertBlokeretFejl uden
// at roere netvaerket. Spaerren er pr. VAERT, ikke pr. kilde: deler to
// kilder samme CDN, rammes de samlet — det er meningen. Naeste koersel
// efter udloeb proever forfra. Ingen omgaaelse, ingen aggressive genforsoeg.
const SPAERRE_MS = Number(process.env.VAERTSSPAERRE_MS ?? 30 * 60_000)
const spaerret = new Map<string, number>()

export class VaertBlokeretFejl extends Error {
  constructor(public host: string, public til: Date) {
    super(`vaerten ${host} er spaerret til ${til.toISOString().slice(0, 16)} `
      + 'efter 429/503 — proeves igen ved en senere koersel')
  }
}

export const erVaertSpaerret = (host: string) =>
  Date.now() < (spaerret.get(host) ?? 0)

/** KUN til proeven — spaerretilstand maa ikke smitte mellem tests. */
export const _nulstilVaertsspaerre = () => spaerret.clear()

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

  const til = spaerret.get(host)
  if (til && Date.now() < til) throw new VaertBlokeretFejl(host, new Date(til))

  for (let attempt = 1; attempt <= tries; attempt++) {
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
          spaerret.set(host, Date.now() + SPAERRE_MS)
          return res
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
