// ═══════════════════════════════════════════════════════════════
//  Gruppekortet, som brugeren møder det: kan hun komme TIL boligerne?
//
//      node scripts/cloud/gruppeadgang.mjs
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  `home-vaerelser.ts` måler i databasen, at tre enkeltkort bliver til
//  ét gruppekort, når `rooms` kommer med. Det tal er kun godt, hvis
//  boligerne stadig kan nås. Et gruppekort, der lukker af for de
//  boliger, det taler for, er ikke en bedre visning — det er to
//  boliger, der forsvandt, med et pænere kort som undskyldning.
//
//  Prøven kræver derfor, at hver enkelt bolig bag kortet kan åbnes,
//  og at listen og landkortet fortæller det samme. Reglen for kortet
//  er ét mærke pr. KORT, ikke pr. bolig, så en gruppe tæller én gang:
//      antal mærker         ≤ antal kort
//      sum(mærkernes antal) ≤ sum(kortenes antal)
//
//  ── DATAGRUNDLAG ─────────────────────────────────────────────
//  Postnummer 9900 i den isolerede testbase, sat af
//  `home-vaerelser.ts --behold`. Syntetisk. Findes rækkerne ikke,
//  springes prøven over — den meldes ikke grøn.
//
//  Exit: 0 = alt grønt · 1 = noget fejlede
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const POSTNR = '9900'

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

if (!process.env.DATABASE_URL) {
  console.log('sprunget over: ingen DATABASE_URL')
  process.exit(0)
}
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })
const raekker = await sql`
  select external_key, street, house_number, rooms
  from listings where postal_code = ${POSTNR} and status = 'active'
  order by external_key`
await sql.end()
if (raekker.length === 0) {
  console.log(`sprunget over: ingen rækker i ${POSTNR}.`)
  console.log('  kør først:  … home-vaerelser.ts --behold')
  process.exit(0)
}
console.log(`målegrundlag: ${raekker.length} syntetiske annoncer i ${POSTNR}\n`)

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})
const c = await br.newContext({ viewport: { width: 1280, height: 1100 } })
const p = await c.newPage()

// Samtykkeboksen står i vejen for et klik på kortet.
await p.goto(BASE + '/', { waitUntil: 'networkidle' })
const k = p.getByRole('button', { name: 'Kun det nødvendige' })
if (await k.count()) { await k.first().click(); await p.waitForTimeout(600) }

// ── 1 · Listen og landkortet ─────────────────────────────────
await p.goto(`${BASE}/?postnr=${POSTNR}&kort=1`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)   // Leaflet skal nå at sætte mærkerne

const liste = await p.evaluate(() => {
  // Antallet laeses af kortets eget `data-gruppe-antal`, ikke af en
  // overskrift, der skal tolkes. Kortet og maerket skal svare paa det
  // SAMME tal, og et regex over en overskrift ville vaere et andet
  // udtryk for det spoergsmaal.
  const kort = [...document.querySelectorAll('.liste a.kort')].map((e) => ({
    gruppe: !!e.dataset.gruppe,
    antal: e.dataset.gruppeAntal ? Number(e.dataset.gruppeAntal) : 1,
    titel: [
      e.querySelector('.kort-overskrift')?.textContent?.trim(),
      e.querySelector('.adresse')?.textContent?.trim(),
    ].filter(Boolean).join(' · ').slice(0, 60),
  }))
  const maerker = [...document.querySelectorAll('.maerke-boble')]
    .map((e) => { const n = (e.textContent ?? '').trim(); return n === '' ? 1 : Number(n) })
  const gruppelink = [...document.querySelectorAll('.liste a')]
    .map((a) => a.getAttribute('href') ?? '').filter((h) => h.startsWith('/gruppe'))
  return {
    kort, maerker, gruppelink,
    kortAntal: kort.reduce((a, x) => a + x.antal, 0),
    maerkeAntal: maerker.reduce((a, n) => a + n, 0),
    kortnote: document.querySelector('.kortnote')?.textContent?.trim().slice(0, 100) ?? null,
  }
})

console.log('listen og landkortet')
for (const x of liste.kort) console.log(`    ${x.gruppe ? 'GRUPPE' : 'enkelt'}  ${x.titel}`)
tjek(liste.kort.length === 7, `7 kort i ${POSTNR}`, `fik ${liste.kort.length}`)
tjek(liste.kort.filter((x) => x.gruppe).length === 1, 'ét gruppekort',
  `fik ${liste.kort.filter((x) => x.gruppe).length}`)
tjek(liste.kortAntal === 9, 'kortene dækker 9 boliger', `fik ${liste.kortAntal}`)
tjek(liste.maerker.length > 0, 'landkortet har mærker', `${liste.maerker.length} mærker`)
tjek(liste.maerker.length <= liste.kort.length, 'højst ét mærke pr. kort',
  `${liste.maerker.length} mærker mod ${liste.kort.length} kort`)
tjek(liste.maerkeAntal <= liste.kortAntal, 'mærkernes antal ≤ kortenes antal',
  `${liste.maerkeAntal} mod ${liste.kortAntal}`)
tjek(liste.maerker.includes(3), 'gruppens mærke bærer antallet 3',
  `mærker: ${JSON.stringify(liste.maerker)}`)

// ── 2 · Adgang til gruppens boliger ──────────────────────────
console.log('\nadgang til gruppens boliger')
const link = liste.gruppelink[0] ?? null
tjek(!!link, 'gruppekortet linker til /gruppe', link ?? 'intet link')
if (link) {
  tjek(link.includes('b='), 'adressen bærer repræsentantens bolig-id, ikke nøglen', link.slice(0, 70))
  tjek(!/landlord/i.test(link), 'ingen konto-id i adressen')

  await p.goto(BASE + link, { waitUntil: 'networkidle' })
  const grp = await p.evaluate(() => ({
    overskrift: document.querySelector('h1')?.textContent?.trim() ?? '',
    boliglinks: [...document.querySelectorAll('a[href^="/bolig/"]')]
      .map((a) => a.getAttribute('href')),
    adresser: [...document.querySelectorAll('.liste a.kort .adresse')]
      .map((e) => e.textContent?.trim() ?? ''),
  }))
  const unikke = [...new Set(grp.boliglinks)]
  console.log(`    overskrift: ${grp.overskrift}`)
  for (const a of grp.adresser) console.log(`    ${a}`)
  tjek(unikke.length === 3, 'alle tre boliger kan åbnes hver for sig', `fik ${unikke.length}`)
  for (const nr of ['1', '3', '5']) {
    tjek(grp.adresser.some((a) => new RegExp(`Målevej ${nr}\\b`).test(a)),
      `Målevej ${nr} står på siden`, grp.adresser.join(' | ').slice(0, 80))
  }
  // Et link, der svarer 404, er ikke adgang.
  for (const href of unikke) {
    const r = await p.request.get(BASE + href)
    tjek(r.status() === 200, `${href} svarer 200`, `fik ${r.status()}`)
  }
}

await br.close()
console.log(fejl === 0 ? '\n✓ alt grønt' : `\n✗ ${fejl} fejlede`)
process.exit(fejl === 0 ? 0 : 1)
