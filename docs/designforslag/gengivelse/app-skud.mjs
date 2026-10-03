// ═══════════════════════════════════════════════════════════════
//  Den RIGTIGE app i en rigtig browser — ikke komponenter enkeltvis.
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh: next dev mod den
//  isolerede lokale Postgres). Rører hverken base eller kode: laget og
//  mockuppen lægges på i browseren, kun til skærmbilledet.
//
//      node app-skud.mjs <udmappe> <variant> [png|jpeg] [dpr] [flag]
//
//  variant   foer         siden, som den er
//            efter        forslag.css + greb.css + greb.js
//            efter-haand  samme, med håndskriften
//  --mobil moerk          kun til runde 3's lag (telefonvariant B dengang).
//                         Dette lags telefon ER B; variant A er fjernet.
//  --lag <mappe>          tag forslag.css/greb.css/greb.js herfra i stedet
//                         (fx et tidligere lag, til sammenligning)
//  --foto <json>          fotoobjektet (standard: ../heltefoto.json)
//  --bredder 1440,390,360 --sider forside,soegning,bolig-billeder,bolig-uden
//
//  Skærmbilleder pr. side og bredde, forsidens bund, og maal.json:
//  billedforhold i nettet, korthøjder, første korts placering, og på
//  forsiden kontrasten mod det FAKTISKE foto, hvor meget af fotoet der
//  står tilbage, linjebruddet i «Populære søgninger», krediteringen, og
//  hvor meget af FØRSTE BOLIGKORT der står over folden — efter samtykke
//  (folden = vinduets bund) og ved første besøg (folden = samtykke-
//  bannerets top, eget skærmbillede *-foerste-besoeg).
//
//  Exit 1, hvis forsiden har et foto og ikke præcis én synlig, læselig
//  kreditering (hero-maal.mjs › kreditering). Et skud uden kreditering
//  er en fejl, ikke et billede.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { heroKontrast, fotoSynlig, populaere, kreditering, vaerstTaenkelige, foersteKort, aabn, gaaTil, laegPaa, skaermbillede, HOEJDE } from './hero-maal.mjs'

const arg = process.argv.slice(2)
const flag = (n, d) => { const i = arg.indexOf(n); return i < 0 ? d : arg.splice(i, 2)[1] }
const MOBIL = flag('--mobil', null)
const LAGMAPPE = flag('--lag', null)
const BREDDER = flag('--bredder', '1440,390').split(',').map(Number)
const SIDENAVNE = flag('--sider', 'forside,soegning,bolig-billeder,bolig-uden').split(',')
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const FOTOFIL = flag('--foto', join(FORSLAG, 'heltefoto.json'))
const [UD, VARIANT = 'foer', FORMAT = 'png', DPR = '1'] = arg
if (!UD) { console.error('brug: node app-skud.mjs <udmappe> foer|efter|efter-haand [png|jpeg] [dpr] [--mobil baand|moerk] [--lag mappe] [--bredder …] [--sider …]'); process.exit(2) }

// MÅLET FØRST — før noget skrives eller hentes. Det er ALTID den isolerede
// testbase: appen på :3100 kører mod den. kraevMaal afviser andet end
// 127.0.0.1:55432/bofinda_test og andre forespørgselsparametre end sslmode
// (psql ville følge ?dbname= og ?host=), og basen spørges bagefter selv,
// som scripts/cloud/app-op.sh gør. Exit 3.
const { kraevMaal } = await import(join(FORSLAG, 'maalinger/laast-base.mjs'))
const MAAL = await kraevMaal(['--maal', 'test'])   // await: async på main (#39), synkron her — virker begge steder
const url = MAAL.url.toString()
const hent = (q) => execFileSync('psql', [url, '-Atc', q]).toString().trim()
{
  const svar = hent(`select current_database() || '|' || inet_server_port()`)
  if (svar !== `${MAAL.forventet.base}|${MAAL.forventet.port}`) { console.error(`FEJL: basen svarer «${svar}», ikke testbasen.`); process.exit(3) }
}
mkdirSync(UD, { recursive: true })
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const efter = VARIANT !== 'foer'
const LAG_FRA = LAGMAPPE ?? FORSLAG

// Skrifterne: hentes én gang og serveres gennem en opsnappet rute, så
// siden kan bruge dem uden at noget lægges i appens public/.
const FONTE = join(UD, '.fonte')
if (efter && !existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE, '--haand'], { stdio: 'inherit' })
}
const LAG = efter ? [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(LAG_FRA, 'forslag.css'), 'utf8'), readFileSync(join(LAG_FRA, 'greb.css'), 'utf8')].join('\n') : ''
const JS = efter ? readFileSync(join(LAG_FRA, 'greb.js'), 'utf8') : ''
// Et ældre lag kender ikke fotoobjektet; det får det heller ikke.
const FOTO = efter && !LAGMAPPE ? JSON.parse(readFileSync(FOTOFIL, 'utf8')) : null
const VALG = { haand: VARIANT === 'efter-haand', mobil: MOBIL, foto: FOTO }

// Boliger med og uden billeder slås op i testbasen (målet er sat øverst).
const medBilleder = hent(`select l.id from listings l join listing_images i on i.listing_id=l.id where l.status='active' group by l.id order by count(*) desc, l.id limit 1`)
const udenBilleder = hent(`select l.id from listings l where l.status='active' and not exists(select 1 from listing_images i where i.listing_id=l.id) order by l.id limit 1`)
const by = hent(`select city from listings where status='active' group by 1 having count(*) >= 12 order by count(*) desc limit 1`)
const SIDER = [['forside', '/'], ['soegning', `/?sted=${encodeURIComponent(by)}`],
  ['bolig-billeder', `/bolig/${medBilleder}`], ['bolig-uden', `/bolig/${udenBilleder}`]].filter(([n]) => SIDENAVNE.includes(n))

const ext = FORMAT === 'jpeg' ? 'jpg' : 'png'
const opt = FORMAT === 'jpeg' ? { type: 'jpeg', quality: 84 } : { type: 'png' }
const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

const maal = {}
const afviste = []   // skærmbilleder, der ville have vist en kildes billede
const kreditFejl = []
for (const w of BREDDER) {
  const c = await br.newContext({ viewport: { width: w, height: HOEJDE(w) }, deviceScaleFactor: Number(DPR) })
  if (efter) await c.route('**/_forslag/**', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
  const p = await aabn(c, BASE)
  for (const [navn, sti] of SIDER) {
    await gaaTil(p, BASE + sti)
    await laegPaa(p, { css: LAG, js: JS, valg: VALG })
    await skaermbillede(p, { path: join(UD, `${navn}-${w}.${ext}`), ...opt }, afviste)
    const m = await p.evaluate(() => {
      const kort = [...document.querySelectorAll('a.kort')].slice(0, 12)
      const img = kort.map((k) => k.querySelector('.kort-billede img')).filter(Boolean)
      const f = (e) => { const b = e.getBoundingClientRect(); return b.height ? +(b.width / b.height).toFixed(3) : null }
      return {
        kort: kort.length, medFoto: img.length,
        rammeForhold: [...new Set(img.map((i) => f(i.parentElement)))],
        kildeForhold: [...new Set(img.map((i) => (i.naturalHeight ? +(i.naturalWidth / i.naturalHeight).toFixed(3) : null)))],
        objectFit: [...new Set(img.map((i) => getComputedStyle(i).objectFit))],
        korthoejder: kort.map((k) => Math.round(k.getBoundingClientRect().height)),
        foersteKortY: kort[0] ? Math.round(kort[0].getBoundingClientRect().top + scrollY) : null,
        overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    if (navn === 'forside') {
      m.kontrast = await heroKontrast(p)
      m.foto = await fotoSynlig(p)
      m.vaerstTaenkelige = await vaerstTaenkelige(p)
      m.kreditering = await kreditering(p)
      m.harFoto = await p.evaluate(() => !!document.querySelector('.hero.har-foto .hero-billede img'))
      if (m.harFoto && m.kreditering.dom !== 'OK') kreditFejl.push(`${navn}-${w}: ${m.kreditering.dom}`)
      m.foersteKort = await foersteKort(p)
      // FØRSTE BESØG: samme side i en ny kontekst UDEN samtykke. Banneret
      // står fast i bunden, og folden er dér, hvor det begynder.
      {
        const c2 = await br.newContext({ viewport: { width: w, height: HOEJDE(w) }, deviceScaleFactor: Number(DPR) })
        if (efter) await c2.route('**/_forslag/**', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
        const p2 = await c2.newPage()
        await p2.goto(BASE + sti, { waitUntil: 'networkidle', timeout: 120000 })
        await p2.getByRole('button', { name: 'Kun det nødvendige' }).first().waitFor({ timeout: 15000 })
        await laegPaa(p2, { css: LAG, js: JS, valg: VALG })
        m.foersteKortFoersteBesoeg = await foersteKort(p2, { samtykke: true })
        await skaermbillede(p2, { path: join(UD, `${navn}-${w}-foerste-besoeg.${ext}`), ...opt }, afviste)
        await c2.close()
      }
      m.populaere = await populaere(p)
      // Luften mellem søgekortet og «Nyeste boliger» — det, folden købes med.
      m.luftUnderKort = await p.evaluate(() => {
        const k = document.querySelector('.hero-soeg form') || document.querySelector('.hero-soeg')
        const t = document.querySelector('.listetitel')
        return k && t ? Math.round(t.getBoundingClientRect().top - k.getBoundingClientRect().bottom) : null
      })
      // Forsidens bund: talstribe, sektioner, båndet og fodnoten.
      const top = await p.evaluate(() => { const e = document.querySelector('.sider') || document.querySelector('.talstribe'); return e ? e.getBoundingClientRect().top + scrollY - 40 : 0 })
      const h = await p.evaluate(() => document.documentElement.scrollHeight)
      await skaermbillede(p, { path: join(UD, `forside-${w}-bund.${ext}`), fullPage: true, clip: { x: 0, y: top, width: w, height: h - top }, ...opt }, afviste)
      // Søgekortet med seks lange bynavne: en belastningsprøve af
      // linjebruddet (seedets byer er for korte til at vise det).
      m.populaereBelastet = await populaere(p, true)
      const kb = await p.evaluate(() => { const e = document.querySelector('.hero-soeg'); const r = e.getBoundingClientRect(); return { x: 0, y: r.top + scrollY - 8, width: innerWidth, height: r.height + 16 } })
      await skaermbillede(p, { path: join(UD, `soegekort-belastet-${w}.${ext}`), clip: kb, fullPage: true, ...opt }, afviste)
    }
    maal[`${navn}-${w}`] = m
  }
  await c.close()
}
writeFileSync(join(UD, 'maal.json'), JSON.stringify({ variant: VARIANT, mobil: MOBIL, lag: LAGMAPPE ? 'andet lag' : 'dette lag', foto: FOTO, afviste, maal }, null, 1))
for (const [k, v] of Object.entries(maal)) console.log(k, JSON.stringify(v))
await br.close()
if (kreditFejl.length) { console.error('FEJL — krediteringen:\n  ' + kreditFejl.join('\n  ')); process.exit(1) }
