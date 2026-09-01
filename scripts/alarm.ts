// Gemte søgninger og alarmkøen. Sender intet.
//
//   npm run alarm                                  vis køen
//   npm run alarm -- liste                         vis søgninger
//   npm run alarm -- match                         kør matchningen nu
//   npm run alarm -- opret <mail> "<navn>" k=v ...
//     fx: opret mig@x.dk "3 vær i 2300" postnr=2300 vaerelserMin=3 prisMax=18000
import { beskrivFiltre, matchAlarmer, opretSoegning, soegninger, ventende } from '../lib/alarm'
import type { Filtre } from '../lib/soeg'
import { sql } from '../db/client'

const ud = (s = '') => process.stdout.write(s + '\n')
const kr = (o: number | null) => o == null ? '—' : (o / 100).toLocaleString('da-DK')
const klokken = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

const TAL = new Set(['prisMin', 'prisMax', 'vaerelserMin', 'arealMin'])
const KRONER = new Set(['prisMin', 'prisMax'])

function laesFiltre(args: string[]): Filtre {
  const f: Record<string, unknown> = {}
  for (const a of args) {
    const [k, ...rest] = a.split('=')
    const v = rest.join('=')
    if (!k || !v) continue
    if (k === 'kilder') f[k] = v.split(',')
    else if (k === 'fuldOekonomi') f[k] = v === '1' || v === 'true'
    else if (TAL.has(k)) f[k] = Number(v) * (KRONER.has(k) ? 100 : 1)
    else f[k] = v
  }
  return f as Filtre
}

const kmd = process.argv[2] ?? 'vis'

if (kmd === 'opret') {
  const [mail, navn, ...rest] = process.argv.slice(3)
  if (!mail || !navn) { ud('brug: opret <mail> "<navn>" k=v ...'); process.exit(1) }
  const f = laesFiltre(rest)
  const id = await opretSoegning(mail, navn, f)
  ud(`oprettet ${id.slice(0, 8)} · ${navn} · ${mail}`)
  ud(`  ${beskrivFiltre(f as Record<string, unknown>)}`)
  ud('\nSøgningen varsler kun om boliger, vi ser FRA NU AF.')

} else if (kmd === 'liste') {
  const s = await soegninger()
  if (!s.length) ud('ingen gemte søgninger')
  for (const x of s) {
    ud(`${x.navn}  ·  ${x.mail}  ·  oprettet ${klokken(x.oprettet)}`)
    ud(`  ${beskrivFiltre(x.kriterier)}`)
    ud(`  ${x.ventende} i kø`)
    ud()
  }

} else if (kmd === 'match') {
  const r = await matchAlarmer()
  ud(r.length ? r.map((x) => `  ${x.soegning}: ${x.nyeTraef} nye træf`).join('\n')
    : '  ingen nye træf')

} else {
  // ── Hvad VILLE være sendt ──────────────────────────────────────
  const grupper = await ventende()
  if (!grupper.length) { ud('Køen er tom — intet ville være sendt.') }
  for (const g of grupper) {
    const f = g[0]!
    ud('━'.repeat(74))
    ud(`TIL:      ${f.modtager}${f.paaMail ? '' : '   (mail slået fra — ville IKKE blive sendt)'}`)
    ud(`EMNE:     ${g.length} ${g.length === 1 ? 'ny bolig' : 'nye boliger'} matcher "${f.soegning}"`)
    ud(`SØGNING:  ${beskrivFiltre(f.kriterier)}`)
    ud('━'.repeat(74))
    for (const b of g) {
      const forsinkelse = b.hosKilden
        ? Math.round((+b.foerstSet - +b.hosKilden) / 60000)
        : null
      ud(`  ${b.adresse}`)
      ud(`    ${[b.areal && `${b.areal} m²`, b.vaerelser && `${b.vaerelser} vær.`]
        .filter(Boolean).join(' · ')}`)
      ud(`    ${b.total != null
        ? `${kr(b.total)} kr/md i alt`
        : `${kr(b.leje)} kr/md i husleje — aconto ikke oplyst`}`
        + (b.indflytning != null ? `   ·   indflytning ${kr(b.indflytning)} kr.` : ''))
      ud(`    ${b.kilde} · set ${klokken(b.foerstSet)}`
        + (forsinkelse != null ? ` · ${forsinkelse} min. efter kilden oprettede den` : '')
        + (b.status === 'delisted' ? '  ⚠ IKKE LÆNGERE LEDIG' : ''))
      ud(`    http://localhost:3000/bolig/${b.boligId}`)
      ud()
    }
  }
  const i = grupper.reduce((a, g) => a + g.length, 0)
  ud(`${grupper.length} ${grupper.length === 1 ? 'besked' : 'beskeder'} med ${i} boliger i alt.`)
  ud('Intet er sendt. sent_at er urørt.')
}

await sql.end()
