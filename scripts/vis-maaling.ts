// Viser, hvordan raekkerne faktisk ser ud — mod testbasen, aldrig produktionen.
import { db } from '../db/client'
import { haendelser } from '../db/schema'
import { saetAktiv, type Haendelse } from '../lib/maaling'
import { _saetDedup, _saetKontekst, spor } from '../lib/maaling-server'

saetAktiv(true)
_saetKontekst({
  miljoe: 'proeve',
  anonymousId: 'a1b2c3d4-0000-4000-8000-000000000001',
  sessionId: 'a1b2c3d4-0000-4000-8000-000000000002',
  userId: null, researchSessionId: 'p07', rute: '/',
})

const eksempler: [Haendelse, string][] = [
  [{ navn: 'homepage_view', props: { boliger_i_alt: 1446, kilder_i_alt: 6, referrer_vaert: 'www.google.com' } }, '/'],
  [{ navn: 'search', props: {
    result_count: 129, antal_filtre: 3, sorter: 'pris_op', sted_slags: 'by_kendt',
    canonical_city: 'København S', price_max: 1500000, rooms_min: 3,
    property_types: ['lejlighed'], full_economy: true, kort_vist: true,
    result_view_id: 'f00dcafe-0000-4000-8000-000000000003',
  } }, '/'],
  [{ navn: 'search_results_view', props: {
    result_count: 129, viste_antal: 48, sted_slags: 'by_kendt', canonical_city: 'København S',
    viste_pr_kilde: { propstep: 31, home: 9, lokalbolig: 8 },
    result_view_id: 'f00dcafe-0000-4000-8000-000000000003',
  } }, '/'],
  [{ navn: 'empty_results', props: { antal_filtre: 4, sted_slags: 'by_ukendt', price_max: 400000 } }, '/'],
  [{ navn: 'filter_applied', props: { felt: 'prisMax', til: '1500000', fra: '2000000', antal_filtre_efter: 3 } }, '/'],
  [{ navn: 'filter_cleared', props: { felt: 'alle', antal_ryddet: 4 } }, '/'],
  [{ navn: 'sort_changed', props: { til: 'pris_op', fra: 'nyeste' } }, '/'],
  [{ navn: 'listing_impression', listingId: 'b0b0b0b0-0000-4000-8000-000000000004', sourceSlug: 'propstep',
    props: { result_view_id: 'f00dcafe-0000-4000-8000-000000000003', position: 12, sample_andel: 0.25, er_gruppe: false } }, '/'],
  [{ navn: 'listing_view', listingId: 'b0b0b0b0-0000-4000-8000-000000000004', sourceSlug: 'propstep',
    props: { postnr: '2300', property_type: 'lejlighed', timing_status: 'nu',
      ansoegning_status: 'normal', marked_status: 'unknown', egen_annonce: false,
      total_kendt: true, antal_billeder: 14 } }, '/bolig/[id]'],
  [{ navn: 'source_click', listingId: 'b0b0b0b0-0000-4000-8000-000000000004', sourceSlug: 'propstep',
    props: { maal: 'kilde', postnr: '2300', property_type: 'lejlighed' } }, '/go/[id]'],
  [{ navn: 'contact_reveal', listingId: 'c0c0c0c0-0000-4000-8000-000000000005',
    props: { har_mail: true, har_telefon: false } }, '/bolig/[id]'],
  [{ navn: 'alert_created', props: { filtertyper: ['by', 'prisMax', 'vaerelserMin'], antal_filtre: 3 } }, '/'],
  [{ navn: 'alert_confirmed', props: { filtertyper: ['by', 'prisMax', 'vaerelserMin'] } }, '/bekraeft/[token]'],
  [{ navn: 'signup_started', props: {} }, '/udlejer'],
  [{ navn: 'signup_completed', props: { bandt_eksisterende: true } }, '/udlejer'],
  [{ navn: 'server_action_failed', props: { handling: 'login', fejlklasse: 'forkert-login' } }, '/udlejer'],
]

const pctFoer = process.env.MAALING_IMPRESSION_PCT
process.env.MAALING_IMPRESSION_PCT = '100'
for (const [h, rute] of eksempler) {
  _saetDedup(new Set())
  await spor(h, rute as never)
}
process.env.MAALING_IMPRESSION_PCT = pctFoer

const raekker = await db.select().from(haendelser)
console.log(`\n  ${raekker.length} raekker skrevet\n`)
for (const r of raekker) {
  console.log(`  ${r.eventName.padEnd(20)} ${r.route.padEnd(18)} ${(r.sourceSlug ?? '—').padEnd(11)} ${JSON.stringify(r.properties)}`)
}

console.log('\n  ── Envelope paa foerste raekke ──')
const f = raekker[0]!
for (const [k, v] of Object.entries(f)) {
  if (k === 'properties') continue
  console.log(`  ${k.padEnd(20)} ${v instanceof Date ? v.toISOString() : String(v)}`)
}

console.log('\n  ── PII-scanning af ALT indhold ──')
// Uuid'er er identifikatorer, ikke oplysninger. De fjernes foer scanningen,
// ellers laeser et cifferloeb som '…-4180-8947-8' som et telefonnummer —
// praecis den falske positiv, der kostede result_view_id foerste gang.
const alt = JSON.stringify(raekker)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
  .replace(/"(?:occurredAt|expiresAt)":"[^"]+"/g, '"<tid>"')
const moenstre: [string, RegExp][] = [
  ['mailadresse', /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i],
  ['telefonnummer', /(?:\+?\d[\s\-.]?){8,}/],
  ['token', /Bearer |eyJ|sb_secret|sb_publishable/],
  ['fremmed URL', /https?:\/\/(?!(?:[a-z0-9-]+\.)*bofinda\.dk)/i],
  ['vejnavn-agtig fritekst', /[A-ZÆØÅ][a-zæøå]+(?:vej|gade|alle|boulevard)\b/],
]
let fundet = 0
for (const [navn, re] of moenstre) {
  const m = alt.match(re)
  console.log(`  ${m ? '✗' : '✓'} ingen ${navn}${m ? ` — FANDT «${m[0]}»` : ''}`)
  if (m) fundet++
}
console.log(`\n  ${fundet === 0 ? 'INGEN PII I NOGEN RAEKKE' : `${fundet} TRAEF`}\n`)
if (fundet) process.exit(1)
