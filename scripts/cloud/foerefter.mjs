// ═══════════════════════════════════════════════════════════════
//  Foer/efter: hvor langt nede staar det foerste boligkort?
//
//      node scripts/cloud/foerefter.mjs <udmappe>
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  «Boligerne skal tidligere frem» er en paastand om et TAL, og tallet
//  er, hvor mange pixels en bruger skal rulle, foer det foerste
//  boligkort begynder. Uden en maaling foer og efter er en forkortet
//  top en fornemmelse.
//
//  ── HVAD DER SKAL VAERE ENS MELLEM DE TO KOERSLER ────────────
//  Samme base, samme boliger, samme soegning, samme viewport — og
//  INGEN gensaaning imellem. Derfor vaelger proeven ikke selv en bolig
//  ud fra tilfaeldighed: gruppesiden findes ved at klikke paa det
//  foerste gruppekort i den samme soegning hver gang, og id'et skrives
//  i resultatet, saa de to koersler kan sammenlignes linje for linje.
//
//  Maalingen er `getBoundingClientRect().top + scrollY` paa det foerste
//  `a.kort[data-bolig]`. Det er dokumentkoordinater, ikke skaermens, saa
//  tallet er uafhaengigt af, hvor siden tilfaeldigvis var rullet hen.
//
//  Skaermbillederne er BEGGE slags: `-fold` er det, en bruger ser uden
//  at rulle; `-hele` er hele siden. Et fuldsides billede af 48 kort kan
//  ikke bruges til at vurdere en top, og et foldbillede viser ikke, om
//  noget faldt paa gulvet laengere nede.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2]
if (!UD) { console.error('FEJL: angiv en udmappe.'); process.exit(2) }
mkdirSync(UD, { recursive: true })

// Den SAMME soegning i begge koersler. Skrevet ind med vilje: et
// tilfaeldigt valg ville goere de to tal usammenlignelige.
const SOEGNING = '/?sted=Attrapby'

const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

/** Dokumentafstanden ned til det foerste boligkort, plus toppens dele. */
const maal = (p) => p.evaluate(() => {
  const kort = document.querySelector('a.kort[data-bolig]')
  const h = (s) => {
    const e = document.querySelector(s)
    return e ? Math.round(e.getBoundingClientRect().height) : null
  }
  return {
    foersteKort: kort
      ? Math.round(kort.getBoundingClientRect().top + window.scrollY) : null,
    antalKort: document.querySelectorAll('a.kort[data-bolig]').length,
    top: h('header.top'),
    hero: h('.hero'),
    talstribe: h('.talstribe'),
    grundlagsnote: h('.grundlagsnote'),
    sidetitel: h('.sidetitel'),
    optaelling: h('.optaelling'),
    broedkrumme: h('.broedkrumme'),
    overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

const resultat = {}

for (const bredde of [1440, 768, 390]) {
  const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
  const c = await br.newContext({
    viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
    deviceScaleFactor: 1,
  })
  const p = await c.newPage()

  // Samtykkebanneret daekker bunden og ville forskyde intet — men det
  // staar paa billedet og goer de to saet svaere at sammenligne.
  await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90_000 })
  const k = p.getByRole('button', { name: 'Kun det nødvendige' })
  if (await k.count()) { await k.first().click(); await p.waitForTimeout(600) }

  // ── Forsiden ───────────────────────────────────────────────
  await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90_000 })
  await p.waitForTimeout(500)
  resultat[`forside-${merke}`] = await maal(p)
  await p.screenshot({ path: `${UD}/forside-${merke}-fold.png` })
  await p.screenshot({ path: `${UD}/forside-${merke}-hele.png`, fullPage: true })

  // ── Gruppesiden ────────────────────────────────────────────
  //  Fundet ved at FOELGE linket fra den samme soegning, ikke ved at
  //  slaa et id op: saa peger de to koersler paa den samme gruppe,
  //  ogsaa hvis rangeringen skulle aendre sig.
  await p.goto(BASE + SOEGNING, { waitUntil: 'networkidle', timeout: 90_000 })
  await p.waitForTimeout(400)
  const gruppelink = await p.evaluate(() => {
    const a = document.querySelector('a[href^="/gruppe"]')
    return a ? a.getAttribute('href') : null
  })
  if (gruppelink) {
    await p.goto(BASE + gruppelink, { waitUntil: 'networkidle', timeout: 90_000 })
    await p.waitForTimeout(500)
    resultat[`gruppe-${merke}`] = { ...await maal(p), sti: gruppelink }
    await p.screenshot({ path: `${UD}/gruppe-${merke}-fold.png` })
    await p.screenshot({ path: `${UD}/gruppe-${merke}-hele.png`, fullPage: true })
  } else {
    resultat[`gruppe-${merke}`] = { fejl: 'intet gruppekort i søgningen' }
  }

  // ── Boligsiden ─────────────────────────────────────────────
  //  Ikke for at maale toppen, men for at have det samme billede foer
  //  og efter af prisblokken og «Pris pr. kvadratmeter».
  const boliglink = await (async () => {
    await p.goto(BASE + SOEGNING, { waitUntil: 'networkidle', timeout: 90_000 })
    return p.evaluate(() => {
      const a = [...document.querySelectorAll('a.kort[data-bolig]')]
        .find((x) => (x.getAttribute('href') ?? '').startsWith('/bolig/'))
      return a ? a.getAttribute('href') : null
    })
  })()
  if (boliglink) {
    await p.goto(BASE + boliglink, { waitUntil: 'networkidle', timeout: 90_000 })
    await p.waitForTimeout(500)
    resultat[`bolig-${merke}`] = { sti: boliglink, ...await maal(p) }
    await p.screenshot({ path: `${UD}/bolig-${merke}-fold.png` })
    await p.screenshot({ path: `${UD}/bolig-${merke}-hele.png`, fullPage: true })
    // Kvadratmeterblokken for sig — den er langt nede paa en fuld side.
    const blok = p.locator('#kvadratmeterpris')
    if (await blok.count()) {
      await blok.scrollIntoViewIfNeeded()
      await p.waitForTimeout(250)
      await blok.screenshot({ path: `${UD}/kvm-${merke}.png` })
    }
    // Prisblokken for sig.
    const oek = p.locator('.oek-kort').first()
    if (await oek.count()) {
      await oek.scrollIntoViewIfNeeded()
      await p.waitForTimeout(250)
      await oek.screenshot({ path: `${UD}/oekonomi-${merke}.png` })
    }
  }

  await c.close()
}

await br.close()
writeFileSync(`${UD}/maal.json`, JSON.stringify(resultat, null, 2))
for (const [navn, m] of Object.entries(resultat)) {
  if (m.fejl) { console.log(`${navn.padEnd(18)} — ${m.fejl}`); continue }
  console.log(
    `${navn.padEnd(18)} første kort ${String(m.foersteKort ?? '—').padStart(5)} px`
    + ` · top ${m.top} · hero ${m.hero ?? '—'} · talstribe ${m.talstribe ?? '—'}`
    + ` · sidetitel ${m.sidetitel ?? '—'} · optælling ${m.optaelling ?? '—'}`
    + ` · overløb ${m.overloeb}`,
  )
}
console.log(`\n✓ ${UD}/maal.json`)
