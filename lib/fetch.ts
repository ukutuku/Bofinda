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
/**
 * «Standardtakt» er ikke en beslutning. Markoeren siger, at der ikke er
 * taget stilling, saa det kan SES — og saa optaellingen kan falde.
 *
 * Den giver samme takt som foer (RATE_MS). Det er med vilje: at skrue otte
 * kilder ned paa én gang er en driftsaendring, ingen har besluttet, og
 * reglen her handler om, at beslutningen skal vaere SKREVET — ikke om at
 * jeg vaelger tallene. Anbefalingerne pr. kilde staar i
 * `docs/kildetilladelser.md`; naar de er godkendt, erstattes markoeren af
 * et tal eller af `standardtakt(...)` med en begrundelse.
 */
export const IKKE_BESLUTTET = Symbol('takt ikke besluttet')

/** En bevidst beslutning om at bruge standardtakten, med dato og grund. */
export function standardtakt(besluttet: string, fordi: string) {
  return { standard: true as const, besluttet, fordi }
}

type Taktbeslutning = number | typeof IKKE_BESLUTTET | ReturnType<typeof standardtakt>

/**
 * Takten pr. vaert — og HVER vaert, `politeFetch` rammer, skal staa her.
 *
 * ── Hvorfor tabellen ikke maa have en standard ────────────────────
 * Tabellen havde foer to poster, og begge var REAKTIONER: Heimstaden 5000
 * efter deres 503, Laros 20000 fra deres robots.txt. Alt andet faldt til
 * `RATE_MS` — ét kald i sekundet.
 *
 * **Og ét kald i sekundet er praecis den takt, der fik os spaerret.**
 * Heimstadens CDN moedte os med 503 efter ~17 minutter ved den takt (maalt
 * 2026-09-06). Standardtakten er altsaa ikke en sikker vaerdi, vi falder
 * tilbage paa — den er den vaerdi, vi har et maalt modeksempel paa.
 *
 * Svaret er ikke en langsommere `RATE_MS`. Det er, at en vaert uden en
 * nedskrevet beslutning skal vaere en FEJL og ikke en standard — samme
 * skranke som `detaljeBudgetPrKoersel`, hvor et manglende `listeGrundlag`
 * nu er en oversaetterfejl. Se `det-staerkeste-faldback` i CLAUDE.md:
 * faldbacket her var ogsaa det staerkeste mulige udsagn, bare om en takt.
 *
 * `scripts/test-takt.ts` fejler, hvis en registreret kildes vaert mangler
 * en linje. Den koerer i `npm test`.
 *
 * ── HVAD TABELLEN IKKE DAEKKER ─────────────────────────────────────
 * **Kun crawlen.** `app/api/billede/route.ts:47` henter billeder med plain
 * `fetch` — ingen takt, ingen spaerre, ingen linje her. Og vaerterne er
 * ikke adskilte: maalt 2026-10-02 er FIRE af de tolv i `TILLADTE_VAERTER`
 * de samme vaerter, denne tabel pacer — `dacas.dk`, `findbolig.nu`,
 * `birchejendomme.dk`, `alabubolig.dk`.
 *
 * Saettes `dacas.dk` til 20 sekunder her, gaelder det altsaa crawlen og
 * ikke billedproxyen. Afboedningen er reel (`cache-control: immutable` i
 * et aar paa billedsvarene), men tabellen daekker én af to veje, og det
 * skal staa, hvor tallene saettes. Se «Hvilke VEJE reglen daekker» i
 * `docs/kildetilladelser.md`.
 */
const VAERTSTAKT: Record<string, Taktbeslutning> = {
  // ── Besluttet paa et maalt eller oplyst grundlag ────────────────
  // Heimstadens CDN droevler VEDVARENDE crawl: maalt 2026-09-06 blev alle
  // kald fra denne IP moedt med 503 efter ~17 minutter ved ét kald i
  // sekundet — uanset User-Agent. Ikke bot-beskyttelse af enkeltkald, men
  // af moensteret.
  'www.heimstaden.dk': 5000,
  // Laros' robots.txt siger Crawl-delay: 20. Det er deres tal, ikke vores,
  // og tilladelsen (docs/kildetilladelser.md) aendrer det ikke: en bred
  // tilladelse til at hente er ikke en tilladelse til at hente hurtigt.
  'www.laros.dk': 20000,
  // home.dk har ikke sagt noget til os, og vi har ikke spurgt. Tallet er
  // derfor ikke maalt paa kilden — det er Heimstadens, overtaget bevidst:
  // 5 s er den takt, vi bruger til den ene kilde, hvis taalmodighed vi
  // KENDER graensen for, og home.dk's kender vi ikke. Reglen staar i
  // docs/kildetilladelser.md: en kilde uden nedskrevet grundlag faar den
  // strammeste takt, ikke den loeseste.
  'home.dk': 5000,

  // ── IKKE besluttet. Linjen findes, saa fravaeret kan taelles ─────
  //  Alle otte koerer paa standardtakten i dag, og ingen har taget
  //  stilling til det. Anbefalingerne staar i docs/kildetilladelser.md —
  //  Propstep og LokalBolig har ogsaa brug for et detaljeloft, og
  //  Propstep er den med stoerst eksponering: ~736 nye boliger ved ét
  //  kald i sekundet er ~12,3 minutter, mod Heimstadens maalte ~17.
  'propstep.com': IKKE_BESLUTTET,
  'www.lokalbolig.dk': IKKE_BESLUTTET,
  'findbolig.nu': IKKE_BESLUTTET,
  'dacas.dk': IKKE_BESLUTTET,
  'api.balder.dk': IKKE_BESLUTTET,
  'udlejning.cej.dk': IKKE_BESLUTTET,
  'birchejendomme.dk': IKKE_BESLUTTET,
  'alabubolig.dk': IKKE_BESLUTTET,
}

/** Er der taget stilling til vaerten? Bruges af tjekket, ikke af pacingen. */
export const taktBesluttet = (host: string): boolean =>
  host in VAERTSTAKT && VAERTSTAKT[host] !== IKKE_BESLUTTET
/** Vaerterne i tabellen — tjekket sammenligner dem med registret. */
export const taktTabellensVaerter = (): string[] => Object.keys(VAERTSTAKT)
/** Staar vaerten i tabellen overhovedet? Et manglende navn er en fejl. */
export const taktStaarITabellen = (host: string): boolean => host in VAERTSTAKT

const takt = (host: string) => {
  const b = VAERTSTAKT[host]
  return typeof b === 'number' ? b : RATE_MS
}
/** Takten for en vaert — eksporteret, saa proeven kan se, at Laros' 20 s
 *  faktisk staar her og ikke kun i et kommentarfelt. */
export const taktFor = (host: string) => takt(host)
/** KUN til proeven: en kunstig vaert med kort takt, saa pacingen kan
 *  maales paa faa hundrede millisekunder i stedet for 20 sekunder. */
export const _saetTakt = (host: string, ms: number) => { VAERTSTAKT[host] = ms }

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
        // Uden disse afviser flere danske hosts (Simply.com foran laros og
        // dacas) forespoergslen med 454. Det er ikke omgaaelse — det er at
        // tale HTTP ordentligt.
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
        // Kaldets egne hoveder vinder over standarderne. Alabus Web API
        // forhandler XML, naar Accept foretraekker application/xml (maalt
        // 2026-09-07), saa en adapter SKAL kunne bede om JSON.
        ...(init.headers as Record<string, string> | undefined),
        // User-Agent staar SIDST og kan ikke overskrives af et kald: den er
        // vores navn, ikke en indstilling. Se EDC-laeren i docs.
        'User-Agent': UA,
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
