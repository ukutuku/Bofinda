// ═══════════════════════════════════════════════════════════════
//  Hoeflig HTTP.
//  Bofinda praesenterer sig altid, holder ét request i sekundet per
//  domaene og trapper ned paa 429 og 503. Der er ingen omgaaelse af
//  bot-beskyttelse her, og der skal ikke komme nogen.
// ═══════════════════════════════════════════════════════════════

const UA = process.env.CRAWLER_USER_AGENT
  ?? 'BofindaBot/1.0 (+https://bofinda.dk/bot; kontakt@bofinda.dk)'
const RATE_MS = Number(process.env.CRAWLER_RATE_MS ?? 1000)

/** Sidste kald per domaene. Koeen er per proces — én worker ad gangen. */
const lastHit = new Map<string, number>()

async function pace(host: string) {
  const prev = lastHit.get(host) ?? 0
  const wait = prev + RATE_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastHit.set(host, Date.now())
}

export async function politeFetch(url: string, tries = 3): Promise<Response> {
  const host = new URL(url).host

  for (let attempt = 1; attempt <= tries; attempt++) {
    await pace(host)

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        // Uden disse afviser flere danske hosts (Simply.com foran laros og
        // dacas) forespoergslen med 454. Det er ikke omgaaelse — det er at
        // tale HTTP ordentligt.
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })

    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RATE_MS * 2 ** attempt
      if (attempt === tries) return res
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }

    return res
  }

  throw new Error(`uopnaaelig efter ${tries} forsoeg: ${url}`)
}
