#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Billedkontrollen i npm test — uden browser, app eller database.
//
//      node docs/designforslag/gengivelse/proev-billedkontrol.mjs
//
//  1. Den rigtige kontrol: hvert billede i docs/ står på undtagelseslisten
//     (kontroller-billeder.mjs --repo docs). Et nyt bevisbillede i repoet
//     fejler her — også med kvittering. Det hører i artefaktet.
//  2. Beviset for, at kontrollen kan fejle, på en kopi i /tmp: en
//     kvittering under en ældre regel, uden version, for andre bytes; et
//     nyt billede, et ændret undtaget billede, en post dateret efter
//     lukningen, en død post, en uefterset herkomst efter fristen; og et
//     prædikat ændret uden ny version.
//     En kontrol, der kun er set grøn, er ikke prøvet.
//  Exit 1 ved afvigelse. Intet uden for /tmp skrives.
// ═══════════════════════════════════════════════════════════════
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { KVITTERING, PRAEDIKAT } from './billedkontrol.mjs'

const HER = dirname(fileURLToPath(import.meta.url))
const ROD = resolve(HER, '../../..')
const koer = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
let fejl = 0
const tjek = (navn, r, forventet, moenster) => {
  const ok = r.status === forventet && (!moenster || moenster.test(r.stdout))
  if (!ok) fejl++
  console.log(`${ok ? '✓' : '✗'} ${navn}: exit ${r.status} (forventet ${forventet})`)
  if (!ok) process.stdout.write(r.stdout + r.stderr)
}

// ── 1. Repoet ────────────────────────────────────────────────────
const rigtig = koer(join(HER, 'kontroller-billeder.mjs'), ['--repo', 'docs'], ROD)
process.stdout.write(rigtig.stdout)
tjek('billederne i docs/', rigtig, 0)

// ── 2. Kopien ────────────────────────────────────────────────────
const T = mkdtempSync(join(tmpdir(), 'billedkontrol-'))
try {
  const G = join(T, 'docs/designforslag/gengivelse')
  mkdirSync(G, { recursive: true })
  for (const f of ['kontroller-billeder.mjs', 'billedkontrol.mjs', 'hero-maal.mjs']) copyFileSync(join(HER, f), join(G, f))
  const K = join(G, 'kontroller-billeder.mjs')
  // 1×1 PNG og en variant med andre bytes.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  const ANDEN = Buffer.concat([PNG, Buffer.from([0])])
  const sha = (b) => createHash('sha256').update(b).digest('hex')

  // Artefaktet: én mappe pr. tilfælde, så hver dom står alene.
  const artefakt = (navn, kvittering, forventet, moenster) => {
    const d = join(T, 'artefakt', navn.replace(/\W+/g, '-'))
    mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'a.png'), PNG)
    if (kvittering) appendFileSync(join(d, KVITTERING), JSON.stringify({ fil: 'a.png', ...kvittering }) + '\n')
    tjek(`artefakt: ${navn}`, koer(K, [d], T), forventet, moenster)
  }
  artefakt(`kvittering under v${PRAEDIKAT.version}`, { sha256: sha(PNG), praedikat: PRAEDIKAT.version }, 0)
  artefakt(`kvittering under v${PRAEDIKAT.version - 1} (en ældre regel)`, { sha256: sha(PNG), praedikat: PRAEDIKAT.version - 1 }, 1, /anden regel \(v\d+\)/)
  artefakt('kvittering uden version', { sha256: sha(PNG) }, 1, /anden regel \(uden version\)/)
  artefakt('kvittering for andre bytes', { sha256: sha(ANDEN), praedikat: PRAEDIKAT.version }, 1, /ændret efter vagten/)
  artefakt('ingen kvittering', null, 1, /ingen kvittering/)

  // Repoet: en egen rod med egen liste.
  const repo = (navn, opsaet, forventet, moenster, lukket = '2026-10-01') => {
    const D = join(T, 'docs/billeder'); rmSync(D, { recursive: true, force: true }); mkdirSync(D, { recursive: true })
    const poster = opsaet(D)
    writeFileSync(join(G, 'billedundtagelser.json'), JSON.stringify({ lukket, filer: poster }))
    tjek(`repo: ${navn}`, koer(K, ['--repo', 'docs'], T), forventet, moenster)
  }
  const post = (fil, b, dato = '2026-09-30', herkomst = 'kendt') => ({ fil, sha256: sha(b), dato, herkomst, grund: 'prøve' })
  repo('et undtaget billede', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG)] }, 0)
  repo('et nyt billede med gyldig kvittering', (D) => {
    writeFileSync(join(D, 'n.png'), PNG)
    writeFileSync(join(D, KVITTERING), JSON.stringify({ fil: 'n.png', sha256: sha(PNG), praedikat: PRAEDIKAT.version }) + '\n')
    return []
  }, 1, /lever i artefaktet/)
  repo('et undtaget billede, ændret bagefter', (D) => { writeFileSync(join(D, 'u.png'), ANDEN); return [post('docs/billeder/u.png', PNG)] }, 1, /ændret efter undtagelsen/)
  repo('en undtagelse dateret efter lukningen', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG, '2026-10-02')] }, 1, /efter at listen blev lukket/)
  repo('en undtagelse uden grund', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [{ ...post('docs/billeder/u.png', PNG), grund: '' }] }, 1, /mangler grund/)
  repo('en undtagelse for en fil, der er væk', () => [post('docs/billeder/vaek.png', PNG)], 1, /slet posten/)
  // Fristen: en uefterset herkomst er rød 90 dage efter lukningen. Listen
  // her er lukket et år før i dag, så fristen er sikkert udløbet.
  const gammel = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)
  const foer = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)
  repo('ikke efterset, inden for fristen', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG, '2026-09-30', 'ikke efterset')] }, 0, null, new Date().toISOString().slice(0, 10))
  repo('ikke efterset, fristen udløbet', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG, foer, 'ikke efterset')] }, 1, /fristen udløb/, gammel)
  repo('kendt herkomst, lige så gammel', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG, foer, 'kendt')] }, 0, null, gammel)
  repo('en herkomst uden for de to', (D) => { writeFileSync(join(D, 'u.png'), PNG); return [post('docs/billeder/u.png', PNG, '2026-09-30', 'efterset senere')] }, 1, /skal være «kendt» eller «ikke efterset»/)

  // Prædikatet ændret, versionen ikke hævet: intet godkendes, heller ikke en gyldig kvittering.
  const hm = join(G, 'hero-maal.mjs')
  writeFileSync(hm, readFileSync(hm, 'utf8').replace("const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]']", "const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', 'images.ctfassets.net']"))
  artefakt('prædikatet ændret uden ny version', { sha256: sha(PNG), praedikat: PRAEDIKAT.version }, 1, /versionen er stadig v\d+/)
} finally {
  rmSync(T, { recursive: true, force: true })
}
console.log(fejl ? `\n${fejl} AFVIGELSE(R)` : '\nBilledkontrollen: alle tilfælde gav det forventede.')
process.exit(fejl ? 1 : 0)
