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
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Otte Laros-koersler i traek er `failed` med discovered_count 0 og
//  noten «AFMELDNING SPRUNGET OVER — for faa fundet: 0 mod en median paa
//  27». Noten er forenelig med, at discovery returnerede nul UDEN at
//  kaste — men den dokumenterer ikke HVORFOR der var nul. Det afgoeres
//  kun af kildens eget svar, og det er praecis det, filen her henter.
//
//  ── HVEM DER SVAREDE, VED DEN IKKE ───────────────────────────
//  Foerste udgave satte `kanTilskrivesVaerten: true`, naar HTTPS_PROXY
//  ikke var sat. Det er en konfigurationsvaerdi, ikke en maaling af
//  afsenderen: en modproeve gav samme gateway-afslag uden variablerne og
//  fik det stemplet som Laros' eget svar.
//
//  Derfor staar afsenderen nu som UAFKLARET paa hvert eneste svar, med
//  og uden proxyvariabel. Fravaer af en variabel, en header eller en
//  bestemt body-tekst er ikke belaeg for oprindelse; filen her maaler
//  ikke netvaersvejen og kan derfor ikke udtale sig om den. Den gemmer
//  status, headere og den raa body, saa et menneske kan afgoere det.
//
//  ── TAKTEN ER KILDENS ────────────────────────────────────────
//  robots.txt hos Laros siger `Crawl-delay: 20`. Der ventes derfor mindst
//  20 s foer HVERT kald — ogsaa foer hvert led i en omdirigeringskaede,
//  som foelges i haanden netop for at kunne overholde takten og skrive
//  kaeden ned. Beder svaret om laengere (`Retry-After`), vinder det
//  laengste af de to; over MAKS_VENT_MS afsluttes indsamlingen med hoppet
//  udtrykkeligt UDSKUDT i stedet for at blive fulgt for tidligt.
//
//  ── STOP VED AFSLAG, INGEN GENFORSOEG ────────────────────────
//  403, 429 og 503 stopper alle videre kald til vaerten i DENNE koersel.
//  Hvad der saa ikke blev hentet, skrives ned. Ingen genforsoeg, ingen
//  omgaaelse af spaerrer: ingen cookies, ingen falsk User-Agent.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'BofindaBot (+https://bofinda.dk/om)'
const TAKT_MS = 20_000
/** Over dette udskydes hoppet frem for at vente. 10 min er laengere end
 *  nogen rimelig indsamling, og en `Retry-After: 600` skal ikke kunne
 *  binde en koersel i ti minutter — men den maa heller ikke ignoreres. */
const MAKS_VENT_MS = 120_000
const MAKS_HOP = 5
/** Vaertens afslag. Ikke en fejl at prøve sig ud af — et svar at stoppe paa. */
const AFSLAG = new Set([403, 429, 503])
const URLER = [
  'https://www.laros.dk/ledige-lejemal/',
  'https://www.laros.dk/ledige-lejemal/?pg=2',
]

// Kun NAVNENE paa de proxyvariabler, der er sat — aldrig vaerdien. En
// proxy-URL kan baere bruger og adgangskode (`http://bruger:kode@vaert`),
// og en rapport, der deles, maa ikke baere dem videre. En modproeve med
// opdigtede credentials skrev dem foer i rapport.json.
const PROXYVARIABLER = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']
  .filter((n) => (process.env[n] ?? '') !== '')

const ud = process.argv[2] ?? 'laros-raasvar'
mkdirSync(ud, { recursive: true })
const vent = (ms) => new Promise((r) => setTimeout(r, ms))
const nu = () => new Date().toISOString()

/** `Retry-After` er sekunder ELLER en HTTP-dato (RFC 9110 § 10.2.3). */
function retryAfterMs(raa, nuMs) {
  if (!raa) return null
  const sek = Number(raa.trim())
  if (Number.isFinite(sek) && sek >= 0) return Math.round(sek * 1000)
  const t = Date.parse(raa)
  return Number.isNaN(t) ? null : Math.max(0, t - nuMs)
}

const rapport = []
/** Skrives efter HVERT svar. Fejler det naeste, staar det foerste der
 *  stadig — med sine metadata, ikke kun som en body uden ophav. */
function gem(ekstra = {}) {
  writeFileSync(join(ud, 'rapport.json'), JSON.stringify({
    hentetUtc: nu(), userAgent: UA, grundtaktMs: TAKT_MS, maksVentMs: MAKS_VENT_MS,
    // Ufoelsomt: NAVNENE, ikke vaerdierne.
    proxyvariablerSat: PROXYVARIABLER,
    omAfsender:
      'Afsenderen af hvert svar staar som «uafklaret». Scriptet maaler ikke '
      + 'netvaersvejen, og hverken tilstedevaer eller fravaer af en '
      + 'proxyvariabel er belaeg for, hvem der svarede. Afgoer det paa '
      + 'status, headere og den gemte body.',
    svar: rapport, ...ekstra,
  }, null, 2))
}

/** Foelger omdirigeringer I HAANDEN, saa takten holdes ved hvert hop og
 *  kaeden kan skrives ned. `redirect: 'manual'` er hele pointen. */
async function hent(start) {
  const kaede = []
  let url = start
  let ventFoerNaeste = TAKT_MS
  for (let hop = 0; hop <= MAKS_HOP; hop++) {
    if (ventFoerNaeste > MAKS_VENT_MS) {
      return { slags: 'hop-udskudt', startUrl: start, tidspunktUtc: nu(),
        svarafsender: 'uafklaret', naesteUrl: url, ventKraevetMs: ventFoerNaeste,
        grund: `Retry-After bad om ${Math.round(ventFoerNaeste / 1000)} s, over loftet paa `
          + `${MAKS_VENT_MS / 1000} s. Hoppet er IKKE fulgt.`, omdirigeringskaede: kaede }
    }
    await vent(ventFoerNaeste)
    const sendt = nu()
    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' })
    } catch (e) {
      // FOER HEADERE: en netvaerksfejl, ikke et svar fra nogen.
      return { slags: 'netvaerksfejl', startUrl: start, url, tidspunktUtc: sendt,
        fase: 'foer-headere', omdirigeringskaede: kaede,
        fejl: { navn: e.name, besked: String(e.message), aarsag: String(e.cause ?? '') } }
    }
    const sted = res.headers.get('location')
    const ra = retryAfterMs(res.headers.get('retry-after'), Date.parse(sendt))
    kaede.push({ hop, url, status: res.status, location: sted,
      retryAfterMs: ra, tidspunktUtc: sendt })

    if (res.status >= 300 && res.status < 400 && sted) {
      // Grundtakten er gulvet; en laengere Retry-After vinder.
      ventFoerNaeste = Math.max(TAKT_MS, ra ?? 0)
      url = new URL(sted, url).toString()
      continue
    }

    const faelles = { startUrl: start, endeligUrl: url, tidspunktUtc: sendt,
      svarafsender: 'uafklaret', status: res.status,
      contentType: res.headers.get('content-type'),
      retryAfterMs: ra, headere: Object.fromEntries(res.headers),
      omdirigeringskaede: kaede }

    let krop
    try {
      krop = Buffer.from(await res.arrayBuffer())
    } catch (e) {
      // EFTER HEADERE: vi har et svar, men ikke hele bodyen. Metadata
      // bevares, og den ufuldstaendige body maa ikke kunne laeses som en
      // komplet tom body — derfor ingen laengde og ingen hash.
      return { ...faelles, slags: 'svar-ufuldstaendig-body', bodyModtaget: false,
        bytelaengde: null, sha256: null, fase: 'under-body',
        fejl: { navn: e.name, besked: String(e.message), aarsag: String(e.cause ?? '') } }
    }
    return { ...faelles, slags: 'svar', bodyModtaget: true,
      bytelaengde: krop.length, sha256: createHash('sha256').update(krop).digest('hex'),
      krop }
  }
  return { slags: 'for-mange-hop', startUrl: start, tidspunktUtc: nu(),
    svarafsender: 'uafklaret', omdirigeringskaede: kaede }
}

let stoppetAf = null
for (const [i, u] of URLER.entries()) {
  if (stoppetAf) {
    rapport.push({ slags: 'ikke-hentet', startUrl: u, tidspunktUtc: nu(),
      grund: `Indsamlingen stoppede efter ${stoppetAf.status} paa ${stoppetAf.url}. `
        + 'Ingen videre kald til vaerten i denne koersel, ingen genforsoeg.' })
    console.log(`${nu()}  IKKE HENTET  ${u}  (stoppet efter ${stoppetAf.status})`)
    gem(); continue
  }
  const r = await hent(u)
  if (r.slags === 'svar') {
    const navn = `svar-${i + 1}.body`
    // Bodyen gemmes UAENDRET — raa bytes, ingen afkodning, ingen trimning.
    writeFileSync(join(ud, navn), r.krop)
    const { krop, ...uden } = r
    rapport.push({ ...uden, kropFil: navn })
    console.log(`${r.tidspunktUtc}  ${r.status}  ${r.bytelaengde} B  `
      + `${r.sha256.slice(0, 16)}…  ${r.endeligUrl}   afsender: uafklaret`)
  } else {
    rapport.push(r)
    console.log(`${r.tidspunktUtc}  ${r.slags.toUpperCase()}  `
      + `${r.endeligUrl ?? r.naesteUrl ?? r.url ?? r.startUrl}  `
      + `${r.fejl?.besked ?? r.grund ?? ''}`)
  }
  gem()
  if (AFSLAG.has(r.status)) {
    stoppetAf = { slags: 'afslag', status: r.status, url: r.endeligUrl ?? r.startUrl }
    console.log(`  → ${r.status} er et afslag. Stopper alle videre kald til vaerten.`)
  } else if (r.slags === 'hop-udskudt') {
    // Vaerten har bedt om en laengere pause end loftet. At hente den
    // NAESTE listeside 20 s senere ville vaere at se bort fra netop den
    // anmodning — bare paa en anden sti. Indsamlingen stopper.
    stoppetAf = { slags: 'retry-after', status: `Retry-After ${Math.round(r.ventKraevetMs / 1000)} s`,
      url: r.naesteUrl }
    console.log('  → Retry-After er laengere end loftet. Stopper alle videre kald til vaerten.')
  }
}
gem(stoppetAf ? { stoppetAf } : {})
const hentede = rapport.filter((r) => r.kropFil).length
console.log(`\nskrevet: ${join(ud, 'rapport.json')} + ${hentede} body-fil(er)`
  + `${stoppetAf ? `  — indsamlingen er UFULDSTAENDIG, stoppet af ${stoppetAf.status}` : ''}`)
