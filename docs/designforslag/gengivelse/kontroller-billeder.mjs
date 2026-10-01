#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Må disse billeder udgives? Kør det på ALT, en bygger samler — et
//  artefakt, en mappe i docs/, en commit — før det forlader maskinen.
//
//      node kontroller-billeder.mjs <fil eller mappe> …          artefakt
//      node kontroller-billeder.mjs --repo <fil eller mappe> …   repoet
//
//  ARTEFAKT: et billede godkendes KUN, hvis vagten (hero-maal.mjs ›
//  skaermbillede) har kvitteret for netop disse bytes UNDER DEN NUVÆRENDE
//  REGEL: filens SHA-256 står i .billedkontrol.jsonl i samme mappe med
//  prædikatets nuværende version (billedkontrol.mjs › PRAEDIKAT). Ellers
//  er herkomsten ukendt — skrevet før vagten fandtes, af et værktøj, der
//  ikke går gennem den, ændret bagefter, eller godkendt af en ældre regel
//  — og så er svaret nej.
//
//  REPO (npm test): bevisbilleder lever i artefaktet, ikke i git (GREB-5
//  § 5). Et billede i repoet godkendes KUN, hvis det står i
//  billedundtagelser.json med sine bytes, en grund og en dato — også et
//  billede med gyldig kvittering afvises. Listen er lukket: en post dateret
//  efter `lukket` afvises, og en post for en fil, der ikke findes længere,
//  afvises, så listen skrumper med vilje og aldrig står med døde poster.
//
//  Begge veje: kontrollen nægter at køre, hvis prædikatet er ændret, uden
//  at versionen er hævet. Exit 0, hvis alt er godkendt; 1 ellers, med en
//  linje pr. afvist fil; 2 ved forkert brug. Ingen afhængigheder ud over node.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KVITTERING, PRAEDIKAT } from './billedkontrol.mjs'
import { fremmedeBilleder } from './hero-maal.mjs'

const HER = dirname(fileURLToPath(import.meta.url))
const ROD = resolve(HER, '../../..')
const UNDTAGELSER = join(HER, 'billedundtagelser.json')
const BILLEDE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const sha = (b) => createHash('sha256').update(b).digest('hex')

const argv = process.argv.slice(2)
const repo = argv[0] === '--repo'
const stier = repo ? argv.slice(1) : argv
if (!stier.length) { console.error('brug: node kontroller-billeder.mjs [--repo] <fil eller mappe> …'); process.exit(2) }

// Prædikatet og versionen hænger sammen, eller intet godkendes.
const aftryk = sha(fremmedeBilleder.toString())
if (aftryk !== PRAEDIKAT.aftryk) {
  console.log(`AFVIST  prædikatet (hero-maal.mjs › fremmedeBilleder) er ændret, men versionen er stadig v${PRAEDIKAT.version}.`)
  console.log(`        Hæv PRAEDIKAT.version i billedkontrol.mjs, skriv linjen i historikken, og sæt aftryk: '${aftryk}'.`)
  console.log('        Kvitteringer fra den gamle regel bliver dermed ugyldige — det er meningen.')
  process.exit(1)
}

const filer = []
const saml = (s) => {
  const st = statSync(s)
  if (st.isDirectory()) for (const n of readdirSync(s)) saml(join(s, n))
  else if (BILLEDE.has(extname(s).toLowerCase())) filer.push(s)
}
for (const s of stier) saml(s)

const afvist = []

if (repo) {
  const { lukket, filer: poster } = JSON.parse(readFileSync(UNDTAGELSER, 'utf8'))
  const undtaget = new Map(poster.map((p) => [p.fil, p]))
  const set = new Set()
  for (const f of filer) {
    const r = relative(ROD, resolve(f)), p = undtaget.get(r)
    set.add(r)
    if (!p) afvist.push(`${r}: et nyt billede i repoet — bevisbilleder lever i artefaktet (GREB-5 § 5), også med kvittering`)
    else if (!p.grund || !p.dato) afvist.push(`${r}: undtagelsen mangler grund eller dato`)
    else if (p.dato > lukket) afvist.push(`${r}: undtagelsen er dateret ${p.dato}, efter at listen blev lukket ${lukket}`)
    else if (p.sha256 !== sha(readFileSync(f))) afvist.push(`${r}: ændret efter undtagelsen — undtagelsen gælder de bytes, der lå der`)
  }
  // Kun poster under de stier, der faktisk blev kontrolleret, kan være døde.
  const under = stier.map((s) => relative(ROD, resolve(s)))
  for (const r of undtaget.keys()) {
    if (set.has(r) || !under.some((u) => u === '' || r === u || r.startsWith(u + '/'))) continue
    if (!existsSync(join(ROD, r))) afvist.push(`${r}: undtagelse for en fil, der ikke findes — slet posten`)
  }
  for (const a of afvist) console.log(`AFVIST  ${a}`)
  console.log(`${filer.length - afvist.filter((a) => !/slet posten$/.test(a)).length} af ${filer.length} billeder i repoet står på undtagelseslisten (lukket ${lukket}).`)
  process.exit(afvist.length ? 1 : 0)
}

const kvitteringer = new Map()   // mappe → Map(fil → [{sha256, praedikat}])
const kvitteret = (mappe) => {
  if (!kvitteringer.has(mappe)) {
    const m = new Map(), sti = join(mappe, KVITTERING)
    if (existsSync(sti)) for (const l of readFileSync(sti, 'utf8').split('\n').filter(Boolean)) {
      try { const k = JSON.parse(l); if (!m.has(k.fil)) m.set(k.fil, []); m.get(k.fil).push(k) } catch {}
    }
    kvitteringer.set(mappe, m)
  }
  return kvitteringer.get(mappe)
}

for (const f of filer) {
  const s = sha(readFileSync(f))
  const ks = kvitteret(dirname(f)).get(basename(f))
  const forBytes = (ks ?? []).filter((k) => k.sha256 === s)
  if (!ks) afvist.push(`${f}: ingen kvittering — herkomsten er ukendt`)
  else if (!forBytes.length) afvist.push(`${f}: kvitteringen passer ikke til filens indhold — ændret efter vagten`)
  else if (!forBytes.some((k) => k.praedikat === PRAEDIKAT.version)) {
    const v = forBytes.map((k) => (k.praedikat == null ? 'uden version' : `v${k.praedikat}`)).join(', ')
    afvist.push(`${f}: kvitteret under en anden regel (${v}); den nuværende er v${PRAEDIKAT.version} — skriv billedet igen gennem vagten`)
  }
}
for (const a of afvist) console.log(`AFVIST  ${a}`)
console.log(`${filer.length - afvist.length} af ${filer.length} billeder har en gyldig kvittering (prædikat v${PRAEDIKAT.version}).`)
process.exit(afvist.length ? 1 : 0)
