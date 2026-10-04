#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  HENT LAROS' RAA LISTESVAR — til aarsagsundersoegelsen, intet andet.
//
//      node scripts/hent-laros-raasvar.mjs [udmappe]
//
//  Koeres fra et miljoe med tilladt kildeadgang. Den laeser, gemmer og
//  stopper: ingen database, ingen produktionsnoegler, ingen import af
//  repoets egen kode — kun node-indbyggede moduler.
//
//  Den laeser ÉN env-variabel, HTTPS_PROXY, og kun for at kunne skrive
//  ned, at et mellemled kan have svaret i vaertens sted. Se noten nede
//  ved PROXY. Ingen anden env-variabel roeres.
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Otte Laros-koersler i traek er `failed` med discovered_count 0 og
//  noten «AFMELDNING SPRUNGET OVER — for faa fundet: 0 mod en median paa
//  27». Noten er forenelig med, at discovery returnerede nul UDEN at
//  kaste — men den dokumenterer ikke HVORFOR der var nul. Det afgoeres
//  kun af kildens eget svar, og det er praecis det, filen her henter.
//
//  ── HVAD DEN IKKE GOER ───────────────────────────────────────
//  Den omgaar ingen adgangsspaerre: ingen cookies, ingen falsk
//  User-Agent, intet genforsoeg paa 403/429/503. Svarer vaerten med en
//  spaerring, ER det svaret, og det gemmes som sadan.
//
//  ── TAKTEN ER KILDENS ────────────────────────────────────────
//  robots.txt hos Laros siger `Crawl-delay: 20`. Der ventes derfor 20 s
//  foer HVERT kald — ogsaa foer hvert led i en omdirigeringskaede, som
//  foelges i haanden netop for at kunne overholde takten og skrive kaeden
//  ned. Et 302 er et kald mere til vaerten.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'BofindaBot (+https://bofinda.dk/om)'
const TAKT_MS = 20_000
const MAKS_HOP = 5
const URLER = [
  'https://www.laros.dk/ledige-lejemal/',
  'https://www.laros.dk/ledige-lejemal/?pg=2',
]

// ── ET MELLEMLED KAN SVARE I VAERTENS STED ───────────────────
// Foerste koersel af filen her gav «403, 99 B» paa begge URL'er — og
// bodyen var «Host not in allowlist: www.laros.dk», altsaa egress-
// proxyens eget afslag, ikke Laros'. Paa fetch-niveau ser de to ens ud.
// Derfor skrives proxy-indstillingen ned, og et svar, der KAN komme fra
// et mellemled, mærkes som sadan. Scriptet gaetter ikke paa bodyen: det
// oplyser forholdet og lader laeseren afgoere.
const PROXY = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null

const ud = process.argv[2] ?? 'laros-raasvar'
mkdirSync(ud, { recursive: true })
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const nu = () => new Date().toISOString()

/** Foelger omdirigeringer I HAANDEN, saa takten holdes ved hvert hop og
 *  kaeden kan skrives ned. `redirect: 'manual'` er hele pointen. */
async function hent(start) {
  const kaede = []
  let url = start
  for (let hop = 0; hop <= MAKS_HOP; hop++) {
    await vent(TAKT_MS)
    const sendt = nu()
    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' })
    } catch (e) {
      // NETVAERKSFEJL ER IKKE ET SVAR FRA LAROS. Den skelnen er hele
      // grunden til at filen findes: et tomt resultat maa ikke kunne
      // laeses som «kilden svarede tomt».
      return { slags: 'netvaerksfejl', url, sendt, kaede,
               fejl: { navn: e.name, besked: String(e.message), aarsag: String(e.cause ?? '') } }
    }
    const sted = res.headers.get('location')
    kaede.push({ hop, url, status: res.status, location: sted, tidspunktUtc: sendt })
    if (res.status >= 300 && res.status < 400 && sted) { url = new URL(sted, url).toString(); continue }
    const krop = Buffer.from(await res.arrayBuffer())
    return {
      // Uden proxy i miljoeet er svaret vaertens. MED proxy kan det vaere
      // mellemleddets, og saa maa det ikke staa som Laros' svar.
      slags: PROXY ? 'svar-muligvis-fra-mellemled' : 'svar',
      kanTilskrivesVaerten: PROXY == null,
      startUrl: start, endeligUrl: url, tidspunktUtc: sendt,
      status: res.status, contentType: res.headers.get('content-type'),
      bytelaengde: krop.length, sha256: createHash('sha256').update(krop).digest('hex'),
      // ALLE headere med: de er det eneste, der lader en laeser se, hvem
      // der svarede, naar bodyen er kort og intetsigende.
      headere: Object.fromEntries(res.headers),
      omdirigeringskaede: kaede, krop,
    }
  }
  return { slags: 'for-mange-hop', startUrl: start, tidspunktUtc: nu(), omdirigeringskaede: kaede }
}

const rapport = []
for (const [i, u] of URLER.entries()) {
  const r = await hent(u)
  if (r.slags.startsWith('svar')) {
    const navn = `svar-${i + 1}.body`
    // Bodyen gemmes UAENDRET — raa bytes, ingen afkodning, ingen trimning.
    writeFileSync(join(ud, navn), r.krop)
    const { krop, ...uden } = r
    rapport.push({ ...uden, kropFil: navn })
    console.log(`${r.tidspunktUtc}  ${r.status}  ${r.bytelaengde} B  ${r.sha256.slice(0, 16)}…  `
      + `${r.endeligUrl}${r.kanTilskrivesVaerten ? '' : '   ⚠ kan vaere fra et mellemled'}`)
  } else {
    rapport.push(r)
    console.log(`${r.tidspunktUtc}  ${r.slags.toUpperCase()}  ${r.startUrl ?? r.url}  ${r.fejl?.besked ?? ''}`)
  }
}
writeFileSync(join(ud, 'rapport.json'), JSON.stringify({
  hentetUtc: nu(), userAgent: UA, taktMs: TAKT_MS,
  proxyIMiljoeet: PROXY,
  bemaerk: PROXY
    ? 'HTTPS_PROXY var sat. Et svar herunder kan komme fra mellemleddet og '
      + 'ikke fra www.laros.dk — se `kanTilskrivesVaerten` og `headere`. '
      + 'Koer filen fra et miljoe UDEN proxy for et svar, der kan tilskrives kilden.'
    : 'Ingen proxy i miljoeet; svarene kan tilskrives vaerten.',
  svar: rapport,
}, null, 2))
console.log(`\nskrevet: ${join(ud, 'rapport.json')} + ${rapport.filter((r) => r.kropFil).length} body-fil(er)`)
