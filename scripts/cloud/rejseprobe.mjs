// ═══════════════════════════════════════════════════════════════
//  Kapløbsprobe for `Rejse`. Kører callbacks'ene DIREKTE.
//
//  ═══ HVORFOR DEN FINDES VED SIDEN AF BROWSERKONTROLLEN ═══
//
//  `kontaktkontrol.mjs` måler gennem brugerfladen, og det er den rigtige
//  måling — men den kan kun nå de kapløb, der kan FREMPROVOKERES med en
//  knap. Panelet har kun ét genforsøg, og det står kun i fejlvisningen.
//  To kapløb er derfor uden for dens rækkevidde:
//
//   · en lås fra `startSamtale` mens et adgangsopslag er undervejs
//     (der er ingen genforsøgsknap på det åbne panel), og
//   · at en NY gyldig adgang stadig kan åbne et låst panel
//     (der er ingen genforsøgsknap på det låste panel).
//
//  Begge er ægte: et skift af `annonce`-proppen eller en senere
//  genhentning udløser dem i produktet. Proben kører derfor de faktiske
//  callbacks med simulerede hooks.
//
//  ⚠ DEN ER IKKE REACT OG IKKE EN BROWSER. Den måler callback-adfærd,
//  ikke gengivelse, ikke markup og ikke fokus. Den beviser INGEN
//  serverbeskyttelse. Browserkontrollen er stadig den primære måling.
//
//  Teknikken — træk callbacks ud af kilden og kør dem med attrap-hooks —
//  er lånt fra en ekstern gennemgangs egen probe, som fandt fejlen.
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'

const ROD = process.env.REJSE_ROD ?? process.cwd()
const src = readFileSync(ROD + '/app/kontakt-ui/Rejse.tsx', 'utf8')
const fra = src.indexOf('  const hent = useCallback(')
const til = src.indexOf('\n  return (', fra)
if (fra < 0 || til < fra) {
  console.error('AFVIST: kunne ikke finde callbacks i Rejse.tsx.')
  console.error('Er filen bygget om, skal udtrækket rettes — et loadernedbrud er IKKE et grønt resultat.')
  process.exit(2)
}
const kode = stripTypeScriptTypes(src.slice(fra, til))

const p = (t) => process.stdout.write(t + '\n')
try {
  const rev = execSync('git rev-parse HEAD', { cwd: ROD }).toString().trim()
  const trae = execSync('git rev-parse HEAD^{tree}', { cwd: ROD }).toString().trim()
  const snavs = execSync('git status --porcelain', { cwd: ROD }).toString().trim()
  p(`revision:    ${rev}`)
  p(`trae:        ${trae}`)
  p(`arbejdstrae: ${snavs ? 'ÆNDRET —\n  ' + snavs.split('\n').join('\n  ') : 'rent'}`)
} catch { p('revision:    (ukendt — ikke et git-arbejdstræ)') }
p('')

const udskudt = () => {
  let loes, afvis
  const lofte = new Promise((a, b) => { loes = a; afvis = b })
  return { lofte, loes, afvis }
}
const toem = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

const ADGANG = {
  tilstand: 'adgang',
  indhold: { slags: 'native', kontakt: { harMail: true, harTelefon: true }, samtale: { slags: 'kan-starte' } },
  ophoerer: null,
}

function model(port, slags = 'native') {
  const t = { svar: null, venter: false, melding: '', starter: false, startfejl: false, aaben: false }
  const set = Object.fromEntries(Object.keys(t).map((k) => [
    'set' + k[0].toUpperCase() + k.slice(1),
    (v) => { t[k] = typeof v === 'function' ? v(t[k]) : v },
  ]))
  const miljoe = {
    ...set,
    annonce: { id: 'syntetisk-bolig', slags, kilde: 'home.dk', videreHref: '/go/x' },
    port,
    levende: { current: true },
    iGang: { current: false },
    anmodning: { current: 0 },
    undervejs: { current: 0 },
    useCallback: (f) => f,
    useEffect: () => {},
  }
  // `nytNummer` og `gaelder` er defineret i komponentkroppen OVER
  // udtrækket, så de gendannes her med samme semantik.
  const forord = 'const nytNummer = () => ++anmodning.current;\n'
    + 'const gaelder = (nr) => anmodning.current === nr;\n'
  const f = new Function(...Object.keys(miljoe), forord + kode + '\nreturn { hent, start }')(
    ...Object.values(miljoe))
  return { t, ...f }
}

let roede = 0
const proev = async (navn, fn) => {
  try { await fn(); p('  ✓ ' + navn) } catch (e) { roede++; p('  ✗ ' + navn + '\n      ' + e.message) }
}

p('K1 · begge annoncetyper spørger adapteren')
for (const slags of ['native', 'ekstern']) {
  await proev(`${slags}: ét adgangsopslag, og svaret gemmes`, async () => {
    let kald = 0
    const m = model({ hentAdgang: async () => { kald++; return { tilstand: 'abonnement-kraevet' } } }, slags)
    m.hent(); await toem()
    assert.equal(kald, 1, `forventede 1 opslag, fik ${kald}`)
    assert.equal(m.t.svar?.tilstand ?? null, 'abonnement-kraevet',
      `svaret blev ${JSON.stringify(m.t.svar)}`)
  })
}

p('\nK2 · det nyeste svar vinder')
await proev('ordnet levering: låsen bliver stående', async () => {
  const a = udskudt(), b = udskudt(); let n = 0
  const m = model({ hentAdgang: () => (++n === 1 ? a.lofte : b.lofte) })
  m.hent(); a.loes(ADGANG); await toem()
  m.hent(); b.loes({ tilstand: 'abonnement-udloebet' }); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet')
})
await proev('et GAMMELT «adgang» ophæver ikke en nyere lås', async () => {
  const gammel = udskudt(), ny = udskudt(); let n = 0
  const m = model({ hentAdgang: () => (++n === 1 ? gammel.lofte : ny.lofte) })
  m.t.svar = { tilstand: 'fejl' }
  m.hent(); m.hent()
  ny.loes({ tilstand: 'abonnement-udloebet' }); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet', 'den nyere lås landede ikke')
  gammel.loes(ADGANG); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet',
    `det forældede svar ophævede låsen — tilstanden er nu «${m.t.svar.tilstand}»`)
})
await proev('en lås fra startSamtale overlever et forældet adgangsopslag', async () => {
  const gammel = udskudt()
  const m = model({
    hentAdgang: () => gammel.lofte,
    startSamtale: async () => ({ ok: false, grund: 'abonnement-udloebet' }),
  })
  m.t.svar = ADGANG
  m.hent()
  m.start(); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet', 'start låste ikke')
  gammel.loes(ADGANG); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet',
    `det forældede opslag ophævede startens lås — nu «${m.t.svar.tilstand}»`)
})
await proev('et FORAELDET startsvar låser ikke et panel, serveren lige har åbnet', async () => {
  // Den modsatte retning af testen ovenfor, og den blev fundet af en
  // modprøve: da `gaelder(nr)` blev fjernet fra `start()`, var BEGGE
  // målinger grønne. Et forældet «nej» fra samtalestarten kunne altså
  // låse et panel, adgangsopslaget lige havde sagt god for.
  const sen = udskudt()
  const m = model({
    hentAdgang: async () => ADGANG,
    startSamtale: () => sen.lofte,
  })
  m.t.svar = ADGANG
  m.start()                       // nummer 1 — undervejs
  m.hent(); await toem()          // nummer 2 — nyere, og den siger adgang
  assert.equal(m.t.svar.tilstand, 'adgang')
  sen.loes({ ok: false, grund: 'abonnement-kraevet' })
  await toem()
  assert.equal(m.t.svar.tilstand, 'adgang',
    `et forældet startsvar låste panelet — tilstanden er nu «${m.t.svar.tilstand}»`)
})
await proev('et forældet startsvar melder heller ikke «Samtalen er åbnet»', async () => {
  const sen = udskudt()
  const m = model({
    hentAdgang: async () => ({ tilstand: 'abonnement-udloebet' }),
    startSamtale: () => sen.lofte,
  })
  m.t.svar = ADGANG
  m.start()
  m.hent(); await toem()          // nyere svar: laast
  sen.loes({ ok: true, samtaleId: 's9' })
  await toem()
  assert.equal(m.t.aaben, false, 'beskedafsnittet blev aabnet af et forældet startsvar')
  assert.notEqual(m.t.melding, 'Samtalen er åbnet.',
    'live-omraadet meldte en aabnet samtale, mens panelet var laast')
})
await proev('en NY gyldig adgang kan stadig åbne et låst panel', async () => {
  const m = model({ hentAdgang: async () => ADGANG })
  m.t.svar = { tilstand: 'abonnement-udloebet' }
  m.hent(); await toem()
  assert.equal(m.t.svar.tilstand, 'adgang',
    'en permanent klientlås er ikke løsningen — en frisk, gyldig adgang skal kunne åbne igen')
})
await proev('et overhalet svar efterlader ikke «Henter …» stående', async () => {
  const a = udskudt(), b = udskudt(); let n = 0
  const m = model({ hentAdgang: () => (++n === 1 ? a.lofte : b.lofte) })
  m.hent(); m.hent()
  b.loes({ tilstand: 'abonnement-udloebet' }); await toem()
  a.loes(ADGANG); await toem()
  assert.equal(m.t.venter, false, 'venter hang — skelettet ville staa for evigt')
})

p('\nUændrede positive kontroller')
await proev('startafvisning låser og lukker beskedafsnittet', async () => {
  const m = model({ startSamtale: async () => ({ ok: false, grund: 'abonnement-udloebet' }) })
  m.t.svar = ADGANG; m.t.aaben = true
  m.start(); await toem()
  assert.equal(m.t.svar.tilstand, 'abonnement-udloebet')
  assert.equal(m.t.aaben, false)
})
await proev('en afvist Promise bliver teknisk fejl, ikke en lås', async () => {
  const m = model({ hentAdgang: async () => { throw new Error('syntetisk nedbrud') } })
  m.hent(); await toem()
  assert.deepEqual(m.t.svar, { tilstand: 'fejl' })
})
await proev('en teknisk START-fejl låser ikke og sender ikke til betaling', async () => {
  const m = model({ startSamtale: async () => ({ ok: false, grund: 'fejl' }) })
  m.t.svar = ADGANG
  m.start(); await toem()
  assert.equal(m.t.svar.tilstand, 'adgang', 'en teknisk fejl må ikke låse panelet')
  assert.equal(m.t.startfejl, true)
})

p(`\n── ${roede} røde ──`)
process.exit(roede ? 1 : 0)
