#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Må disse billeder udgives? Kør det på ALT, en bygger samler — et
//  artefakt, en mappe i docs/, en commit — før det forlader maskinen.
//
//      node kontroller-billeder.mjs <fil eller mappe> …
//
//  Et billede godkendes KUN, hvis vagten (hero-maal.mjs › skaermbillede)
//  har kvitteret for netop disse bytes: filens SHA-256 står i
//  .billedkontrol.jsonl i samme mappe. Ellers er herkomsten ukendt — det
//  kan være skrevet før vagten fandtes, af et værktøj, der ikke går
//  gennem den, eller ændret bagefter — og så er svaret nej. Reglen holder
//  derfor, uanset hvem der tilføjer et nyt skrivested.
//
//  Exit 0, hvis hvert billede har en gyldig kvittering; 1 ellers, med en
//  linje pr. afvist fil. Ingen afhængigheder ud over node.
// ═══════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, extname } from 'node:path'

const BILLEDE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const KVITTERING = '.billedkontrol.jsonl'
const stier = process.argv.slice(2)
if (!stier.length) { console.error('brug: node kontroller-billeder.mjs <fil eller mappe> …'); process.exit(2) }

const filer = []
const saml = (s) => {
  const st = statSync(s)
  if (st.isDirectory()) for (const n of readdirSync(s)) saml(join(s, n))
  else if (BILLEDE.has(extname(s).toLowerCase())) filer.push(s)
}
for (const s of stier) saml(s)

const kvitteringer = new Map()   // mappe → Map(fil → Set(sha256))
const kvitteret = (mappe) => {
  if (!kvitteringer.has(mappe)) {
    const m = new Map(), sti = join(mappe, KVITTERING)
    if (existsSync(sti)) for (const l of readFileSync(sti, 'utf8').split('\n').filter(Boolean)) {
      try { const k = JSON.parse(l); if (!m.has(k.fil)) m.set(k.fil, new Set()); m.get(k.fil).add(k.sha256) } catch {}
    }
    kvitteringer.set(mappe, m)
  }
  return kvitteringer.get(mappe)
}

const afvist = []
for (const f of filer) {
  const sha = createHash('sha256').update(readFileSync(f)).digest('hex')
  const k = kvitteret(dirname(f)).get(basename(f))
  if (!k) afvist.push(`${f}: ingen kvittering — herkomsten er ukendt`)
  else if (!k.has(sha)) afvist.push(`${f}: kvitteringen passer ikke til filens indhold — ændret efter vagten`)
}
for (const a of afvist) console.log(`AFVIST  ${a}`)
console.log(`${filer.length - afvist.length} af ${filer.length} billeder har en gyldig kvittering.`)
process.exit(afvist.length ? 1 : 0)
