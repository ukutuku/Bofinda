// ═══════════════════════════════════════════════════════════════
//  Scheduleren. Koerer i workeren paa Railway, ikke paa Vercel:
//  en discovery-koersel tager minutter, en serverless-funktion doer
//  efter sekunder.
//
//  Én kilde ad gangen inden for samme kilde — to samtidige koersler mod
//  samme kilde ville kappes om afmeldningen og afmelde hinandens boliger.
//  Forskellige kilder koerer gerne parallelt.
// ═══════════════════════════════════════════════════════════════

import { KILDER, type Registreret } from '../adapters'
import { koerKilde, type KoerselsResultat } from './ingest'

const INTERVAL_MS = Number(process.env.DISCOVERY_INTERVAL_MS ?? 15 * 60 * 1000)

export function formatResultat(r: KoerselsResultat): string {
  const hoved = `[${r.kilde}] ${r.status === 'ok' ? '✓' : '✗'} `
    + `fandt ${r.fundet} · ${r.nye} nye · ${r.opdaterede} opdateret `
    + `· ${r.afmeldte} afmeldt · ${r.fejl} fejl`
  return r.noter.length ? `${hoved}\n${r.noter.map((n) => `    ${n}`).join('\n')}` : hoved
}

const sov = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Koerer alle aktive kilder én gang. Én kildes fejl stopper ikke de andre. */
export async function koerAlle(kilder: Registreret[] = KILDER): Promise<KoerselsResultat[]> {
  const ud: KoerselsResultat[] = []
  for (const k of kilder) {
    if (k.kunUdvikling && process.env.NODE_ENV === 'production') continue
    try {
      ud.push(await koerKilde(k.adapter, k.navn, { baseUrl: k.baseUrl }))
    } catch (e) {
      ud.push({
        kilde: k.adapter.id, fundet: 0, nye: 0, opdaterede: 0, afmeldte: 0,
        fejl: 1, status: 'failed', noter: [`uventet: ${(e as Error).message}`],
      })
    }
  }
  return ud
}

/** Uendelig loekke. Stoppes med SIGINT/SIGTERM. */
export async function start(): Promise<void> {
  let stop = false
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { console.log(`\n${sig} — stopper efter denne runde`); stop = true })
  }
  console.log(`scheduler startet, interval ${Math.round(INTERVAL_MS / 1000)} s`)
  while (!stop) {
    const t0 = Date.now()
    for (const r of await koerAlle()) console.log(formatResultat(r))
    const rest = INTERVAL_MS - (Date.now() - t0)
    if (rest > 0 && !stop) await sov(rest)
  }
}
