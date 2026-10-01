// ═══════════════════════════════════════════════════════════════
//  KAN DETTE FOTO BÆRE TEKSTEN?  Måles, før et foto sættes ind.
//
//      node maal-foto.mjs <udmappe> <foto> [<foto> …]
//      node maal-foto.mjs <udmappe> --selvproeve
//
//  <foto> er en billedfil (jpg/png/webp) eller et fotoobjekt (.json i
//  samme form som ../heltefoto.json, med "fil": stien til billedet).
//  Ligger der en <foto>.json ved siden af en billedfil, bruges dens
//  felter (kredit, licens, fokus, slør); ellers heltefoto.json's.
//
//  Kræver appen på 127.0.0.1:3100 (scripts/cloud/op.sh). Rører hverken
//  appen, public/ eller basen: kandidaten serveres gennem en opsnappet
//  rute og lægges ind via fotoobjektet — samme vej, som et nyt foto
//  skal ind i appen (HERO_STANDARD i page.tsx).
//
//  Hvad der måles, i 1440 (bred) og i HELE telefonintervallet, hvor B
//  gælder (320–900), plus A i 390 og 360:
//    · værste kontrast for øjenbryn, h1 og manchet mod de FAKTISKE
//      pixels bag dem, med det slør objektet angiver, linje for linje;
//    · værste kontrast over det VÆRST TÆNKELIGE foto (helt hvidt bag lys
//      tekst, helt sort bag mørk) — holder den, holder teksten over
//      ethvert foto, og så er det en egenskab ved laget, ikke ved fotoet;
//    · hvor meget slør fotoet KRÆVER (tyndeste ensartede slør, der får
//      teksten igennem på netop dette foto);
//    · hvor meget af fotoets egen tegning der står tilbage;
//    · hvor meget af FØRSTE BOLIGKORT der står over folden.
//
//  GULVET er det tyndeste slør, hvormed B's tekst holder AA over det
//  værst tænkelige foto (et helt hvidt). Det MÅLES (hero-maal.mjs ›
//  vaerstTaenkelige › gulv) og er i dag 0,60. B's slør skal være mindst
//  max(gulvet, krævet + 0,05) og højst loftet — én regel, ét sted.
//
//  DOMMEN, i denne rækkefølge:
//    AFVIST    rettighederne mangler (licens, kreditering, eller licensen
//              kræver kreditering VED billedet); eller krediteringen kan
//              ikke ses i en bredde, eller den brækker over flere linjer
//              (laget har plads til én); eller teksten falder under WCAG
//              AA (4,5:1; 3:1 for stor tekst) på bred skærm; eller B
//              falder under AA med objektets slør — grunden siger, om
//              sløret er for tyndt (og hvad det skal være), eller om
//              teksten står uden for gradientens fulde tæthed; eller
//              objektets slør er over loftet (fotoet forsvinder bag det).
//              Og: B kan kun bære teksten med et slør over SLOER_LOFT
//              (0,60). Telefonens hero ER B (valgt 1. oktober 2026;
//              variant A, fotobåndet, er fjernet), så et foto, der
//              kræver mere, er et foto, der ikke kan bruges.
//    B · OVERVÅGES  B består med objektets slør på DETTE foto, men ikke
//              over det værst tænkelige — objektets slør er under gulvet.
//              Kontrasten hænger da på netop dette fotos pixels, og et
//              fotoskift skal måles igen.
//    B         B består på dette foto OG over det værst tænkelige, i alle
//              bredder. Ingen foto kan bryde teksten med dette slør.
//  Exit 0 ved B og B · OVERVÅGES (overvågningen skrives ud), 1 ellers.
//
//  TÆRSKLEN FOR B er AA mod de faktiske pixels i alle telefonbredder —
//  ikke kun i 390 og 360, hvor runde 3 målte 5,48 på øjenbrynet. Og B's
//  slør har et loft på 0,60: over det afvises fotoet, ikke laget. Det er
//  overvågningen af B's kontrast: den måles ved hvert fotoskift, aldrig
//  antages.
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, basename, extname, resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { heroKontrast, fotoSynlig, vaerstTaenkelige, foersteKort, tekstBund, kreditering, aabn, gaaTil, laegPaa, skaermbillede, HOEJDE } from './hero-maal.mjs'

export const SLOER_LOFT = 0.60
// B gælder op til 900 px (greb.css § 6). Telefonerne, der findes i dag,
// ligger fra 320 til 430; 600, 768 og 900 dækker resten af intervallet.
const TELEFON = [320, 360, 375, 390, 414, 430, 600, 768, 900]
const BREDDER = [1440, ...TELEFON]
const VARIANTER = Object.fromEntries([[1440, ['bred']], ...TELEFON.map((w) => [w, ['B']])])

const [UD, ...kandidater] = process.argv.slice(2)
if (!UD || !kandidater.length) { console.error('brug: node maal-foto.mjs <udmappe> <foto|foto.json> … | --selvproeve'); process.exit(2) }
mkdirSync(UD, { recursive: true })
const HER = new URL('.', import.meta.url).pathname
const FORSLAG = join(HER, '..')
const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const STANDARD = JSON.parse(readFileSync(join(FORSLAG, 'heltefoto.json'), 'utf8'))

const FONTE = join(UD, '.fonte')
if (!existsSync(join(FONTE, 'fonte.css'))) {
  mkdirSync(FONTE, { recursive: true }); execFileSync('node', [join(HER, 'fonte.mjs'), FONTE], { stdio: 'inherit' })
}
const CSS = [readFileSync(join(FONTE, 'fonte.css'), 'utf8').replace(/url\(([^)]+)\)/g, 'url(/_forslag/$1)'),
  readFileSync(join(FORSLAG, 'forslag.css'), 'utf8'), readFileSync(join(FORSLAG, 'greb.css'), 'utf8')].join('\n')
const JS = readFileSync(join(FORSLAG, 'greb.js'), 'utf8')

const br = await pw.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium' })

/** Fotoobjektet for en kandidat: fil + felter, standard for det, der mangler. */
function objekt(k) {
  if (extname(k) === '.json') {
    const o = JSON.parse(readFileSync(k, 'utf8'))
    return { ...STANDARD, ...o, fil: resolve(dirname(k), o.fil) }
  }
  const side = k.replace(/\.[^.]+$/, '.json')
  const o = existsSync(side) ? JSON.parse(readFileSync(side, 'utf8')) : {}
  return { ...STANDARD, kredit: null, licens: null, ...o, fil: resolve(k) }
}

// Dansk decimalkomma i alt, der skrives til et menneske.
const dk = (x) => String(x).replace('.', ',')

async function maalEt(o, navn, lagTillaeg = '') {
  const mappe = join(UD, navn); mkdirSync(mappe, { recursive: true })
  const foto = { ...o, url: `/_forslag/foto/${encodeURIComponent(basename(o.fil))}` }
  const raekker = []
  for (const w of BREDDER) {
    const c = await br.newContext({ viewport: { width: w, height: HOEJDE(w) } })
    await c.route('**/_forslag/foto/**', (r) => r.fulfill({ path: o.fil }))
    await c.route('**/_forslag/*.woff2', (r) => r.fulfill({ path: join(FONTE, r.request().url().split('/_forslag/')[1]) }))
    const p = await aabn(c, BASE)
    for (const variant of VARIANTER[w]) {
      await gaaTil(p, BASE + '/')
      await laegPaa(p, { css: CSS + lagTillaeg, js: JS, valg: { foto } })
      // Fotoet er skiftet i browseren; der måles først, når det er tegnet.
      await p.waitForFunction(() => { const i = document.querySelector('.hero-billede img'); return i && i.complete && i.naturalWidth > 0 && i.src.includes('/_forslag/foto/') }, null, { timeout: 30000 })
      const k = await heroKontrast(p)
      const v = await vaerstTaenkelige(p)
      const f = await fotoSynlig(p)
      const kort = await foersteKort(p)
      const bund = await tekstBund(p)
      const kredit = await kreditering(p)
      const hero = await p.evaluate(() => { const h = document.querySelector('.hero'); const r = h.getBoundingClientRect(); return Math.round(r.bottom + scrollY + 60) })
      const fil = `${variant}-${w}.jpg`
      await skaermbillede(p, { path: join(mappe, fil), type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: w, height: Math.min(hero, HOEJDE(w)) } })
      const TEKSTER = ['øjenbryn', 'h1', 'manchet']
      const tekster = Object.fromEntries(TEKSTER.map((t) => [t, k[t]]))
      const paaFoto = Object.values(tekster).some((m) => m?.paaFoto)
      const kraevet = Object.values(tekster).map((t) => t?.alfaMin).filter((a) => typeof a === 'number')
      const kraevetMax = Object.values(tekster).some((t) => t?.alfaMin === '>1') ? '>1' : kraevet.length ? Math.max(...kraevet) : null
      const vaerst = v ? Object.fromEntries(TEKSTER.filter((t) => v[t]).map((t) => [t, v[t]])) : {}
      const vaerstMin = Object.values(vaerst).length ? Math.min(...Object.values(vaerst).map((m) => m.vaerst)) : null
      const fotosikker = Object.values(vaerst).length ? Object.values(vaerst).every((m) => m.bestaar) : true
      const konfig = variant === 'B' ? o.sloerSmal : variant === 'bred' ? o.sloer : null
      const fejlTekst = Object.entries(tekster).filter(([, m]) => m && !m.bestaar).map(([t, m]) => `${t} ${dk(m.vaerst)}:1 < ${dk(m.taerskel)}:1`)
      const overLoft = variant === 'B' && (kraevetMax === '>1' || (kraevetMax != null && kraevetMax > SLOER_LOFT))
      raekker.push({ bredde: w, variant, fil, tekster, paaFoto, vaerstTaenkelige: vaerst, vaerstMin, fotosikker, gulv: v?.gulv ?? null,
        tekstBund: bund, kredit: { dom: kredit.dom, linjer: kredit.linjer, kontrast: kredit.kontrast },
        sloerKonfig: konfig, sloerKraevet: kraevetMax, overLoft, fejlTekst,
        tegningBevaret: f.tegningBevaret, frihoejde: f.frihoejde, foersteKort: kort })
    }
    await c.close()
  }
  // ── Dommen ──────────────────────────────────────────────────────
  // Rettighederne er en del af dommen, ikke en fodnote til den: et foto,
  // der ikke må vises lovligt, er afvist, uanset hvor godt det bærer tekst.
  const grunde = [], noter = []
  if (!o.kredit) grunde.push('Ingen kreditering i fotoobjektet. Kreditering er et krav — udfyld «kredit».')
  if (!o.licens) grunde.push('Ingen licens i fotoobjektet. Uden licens bruges fotoet ikke.')
  if (o.kreditVedBilledet) grunde.push('Licensen kræver kreditering VED billedet. Laget sætter den under søgekortet; det skal afklares, før fotoet kan bruges.')
  const bred = raekker.filter((r) => r.variant === 'bred'), B = raekker.filter((r) => r.variant === 'B')
  // Krediteringen er en del af dommen: den skal kunne ses i hver bredde og
  // stå på én linje — laget har ikke plads til to (GREB-4.md § 2).
  for (const r of raekker) {
    if (r.kredit.dom !== 'OK') grunde.push(`kreditering ${r.variant} ${r.bredde}: ${r.kredit.dom}`)
    else if (r.kredit.linjer > 1) grunde.push(`kreditering ${r.variant} ${r.bredde}: brækker over ${r.kredit.linjer} linjer; laget har plads til én — forkort den`)
  }
  for (const r of bred) if (r.fejlTekst.length) grunde.push(`bred ${r.bredde}: ${r.fejlTekst.join('; ')}`)
  // Gulvet: ét tal for hele telefonintervallet — det største, der måltes.
  const gulve = B.map((r) => r.gulv).filter((g) => g != null)
  const gulv = gulve.includes('>1') ? '>1' : gulve.length ? Math.max(...gulve) : null
  const anvis = (kraevet) => dk(Math.min(SLOER_LOFT, Math.max(typeof gulv === 'number' ? gulv : 0, +(kraevet + 0.05).toFixed(2))))
  const overLoft = B.filter((r) => r.overLoft)
  for (const r of B.filter((x) => !x.overLoft && x.fejlTekst.length)) {
    if (typeof r.sloerKraevet === 'number' && r.sloerKraevet > r.sloerKonfig) {
      grunde.push(`B ${r.bredde}: ${r.fejlTekst.join('; ')} — objektets slør ${dk(r.sloerKonfig)} er for tyndt; fotoet kræver ${dk(r.sloerKraevet)}, så sæt sloerSmal til ${anvis(r.sloerKraevet)}`)
    } else {
      grunde.push(`B ${r.bredde}: ${r.fejlTekst.join('; ')} — teksten står uden for gradientens fulde tæthed (nederste linje ved ${dk(r.tekstBund)} % af heroen; fuld tæthed til 58 %)`)
    }
  }
  const konfigB = o.sloerSmal
  if (typeof konfigB === 'number' && konfigB > SLOER_LOFT && !overLoft.length) {
    grunde.push(`objektets slør ${dk(konfigB)} er over loftet ${dk(SLOER_LOFT)}: fotoet forsvinder bag sløret — sæt sloerSmal til ${anvis(Math.max(...B.map((r) => typeof r.sloerKraevet === 'number' ? r.sloerKraevet : 0)))}`)
  }
  // Der er ingen variant at falde tilbage på: kræver fotoet mere end
  // loftet, kan det ikke bære B's tekst, og det er en afvisning.
  for (const r of overLoft) grunde.push(`B ${r.bredde}: kræver slør ${dk(r.sloerKraevet)} > loftet ${dk(SLOER_LOFT)} — fotoet kan ikke bære teksten; vælg et andet foto`)
  let dom
  if (grunde.length) dom = 'AFVIST'
  else if (B.some((r) => !r.fotosikker)) {
    dom = 'B · OVERVÅGES'
    const v = B.filter((r) => !r.fotosikker).sort((a, b) => a.vaerstMin - b.vaerstMin)[0]
    noter.unshift(`B består på dette foto, men ikke over det værst tænkelige (${dk(v.vaerstMin)}:1 i ${v.bredde}): objektets slør ${dk(konfigB)} er under gulvet ${dk(gulv)}. Kontrasten hænger på netop dette fotos pixels; mål igen ved hvert fotoskift.`)
  } else dom = 'B'
  noter.push(`Gulvet for B's slør: ${dk(gulv)} (det tyndeste slør, hvormed teksten holder AA over et helt hvidt foto, målt i alle telefonbredder).`)
  for (const r of bred) if (!r.fotosikker && !r.fejlTekst.length) noter.push(`Bred skærm består på dette foto, men ikke over det værst tænkelige (${dk(r.vaerstMin)}:1).`)
  for (const w of [390, 360]) {
    const b = raekker.find((r) => r.bredde === w && r.variant === 'B')?.foersteKort
    if (b) noter.push(`Første boligkort over folden i ${w}: ${Math.round(b.andel * 100)} %.`)
  }
  return { navn, fil: basename(o.fil), kredit: o.kredit, licens: o.licens, dom, gulv, grunde, noter, raekker }
}

function rapport(res) {
  const t = (m) => (m ? `${String(m.vaerst).replace('.', ',')}${m.bestaar ? '' : ' ✗'}` : '–')
  const a = (x) => (x == null ? '–' : String(x).replace('.', ','))
  const pct = (k) => (k ? `${Math.round(k.andel * 100)} %` : '–')
  let md = `# Fotomåling\n\nVærste kontrast mod de faktiske pixels bag teksten, linje for linje. Tærskel 4,5:1, for h1 3:1. «Værst tænkelige» er laveste kontrast over et helt hvidt foto (lys tekst) eller helt sort (mørk tekst) med objektets slør: holder den, holder teksten over ethvert foto. «Slør krævet» er det tyndeste ensartede slør, der får al tekst igennem på netop dette foto. «Tegning tilbage» er fotoets egne kanter, som siden tegner dem, delt med det rå fotos, over den del, der står fri af søgekortet. «Første kort» er den andel af første boligkort, der står over folden.\n`
  for (const r of res) {
    md += `\n## ${r.navn} — **${r.dom}**\n\n${r.kredit ?? '(ingen kreditering)'} · ${r.licens ?? '(ingen licens)'}\n\n`
    md += '| Bredde | Variant | Øjenbryn | h1 | Manchet | Værst tænkelige | Slør (objekt) | Slør krævet | Tegning tilbage | Første kort |\n|---|---|---|---|---|---|---|---|---|---|\n'
    for (const x of r.raekker) {
      md += `| ${x.bredde} | ${x.variant} | ${t(x.tekster['øjenbryn'])} | ${t(x.tekster.h1)} | ${t(x.tekster.manchet)} | ${x.vaerstMin == null ? '–' : a(x.vaerstMin) + (x.fotosikker ? '' : ' ✗')} | ${a(x.sloerKonfig)} | ${a(x.sloerKraevet)} | ${a(x.tegningBevaret)} | ${pct(x.foersteKort)} |\n`
    }
    for (const g of r.grunde) md += `\n- **Grund:** ${g}`
    for (const n of r.noter) md += `\n- ${n}`
    md += '\n'
  }
  return md
}

// ── Selvprøven: målingen skal kunne sige nej ─────────────────────
// Et foto, der altid består, beviser ingenting om målingen. Otte
// tilfælde med kendt facit — ét for hver dom og hver vej til AFVIST:
//   nuvaerende           det nuværende foto med sit objekt         → B
//   tyndere-sloer-050    samme foto, B's slør 0,50: holder på DETTE
//                        foto, ikke over et hvidt                  → B · OVERVÅGES
//   tyndt-sloer-020      samme foto, B's slør 0,20                 → AFVIST (for tyndt)
//   moerkt-foto          mørklagt attrap, bred skærms underlag 0,20 → AFVIST (bred)
//   tykt-sloer-090       samme foto, B's slør 0,90: over loftet    → AFVIST (for tykt)
//   loftet               overbelyst attrap, og laget med runde 3's
//                        øjenbryn (hvid à .84): kræver over 0,60   → AFVIST (over loftet)
//   uden-licens          det nuværende foto uden licens            → AFVIST (rettigheder)
//   lang-kredit          det nuværende foto med en CC BY-kreditering
//                        på 67 tegn: brækker på en telefon         → AFVIST (krediteringen)
// Attrapperne er prøveattrapper, ikke kandidater. «loftet» bryder LAGET
// — dér, hvor appen læser — fordi intet foto kan kræve over 0,60, så
// længe teksten er ren hvid (det er hele pointen med § 6).
async function selvproeve() {
  const std = resolve(FORSLAG, '../../public/hero-stue.jpg')
  const mappe = join(UD, '_attrapper'); mkdirSync(mappe, { recursive: true })
  const p = await (await br.newContext()).newPage()
  const filter = async (f) => p.evaluate(async ([b64, f]) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.filter = f; g.drawImage(img, 0, 0)
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]
  }, [readFileSync(std).toString('base64'), f])
  const moerkFil = join(mappe, 'moerklagt-attrap.jpg'); writeFileSync(moerkFil, Buffer.from(await filter('brightness(0.22)'), 'base64'))
  const lysFil2 = join(mappe, 'overbelyst-attrap.jpg'); writeFileSync(lysFil2, Buffer.from(await filter('brightness(1.6)'), 'base64'))
  const lysFil = join(mappe, 'hero-stue.jpg'); copyFileSync(std, lysFil)
  const RUNDE3_OEJENBRYN = '\n@media (max-width: 900px) { .hero.har-foto .hero-oejenbryn { color: rgb(255 255 255 / .84); } }'
  const tilfaelde = [
    { navn: 'nuvaerende', o: { ...STANDARD, fil: lysFil }, facit: 'B' },
    { navn: 'tyndere-sloer-050', o: { ...STANDARD, fil: lysFil, sloerSmal: 0.5 }, facit: 'B · OVERVÅGES' },
    { navn: 'tyndt-sloer-020', o: { ...STANDARD, fil: lysFil, sloerSmal: 0.2 }, facit: 'AFVIST', grund: /^B \d+: .*for tyndt.*sæt sloerSmal til 0,6$/ },
    { navn: 'tykt-sloer-090', o: { ...STANDARD, fil: lysFil, sloerSmal: 0.9 }, facit: 'AFVIST', grund: /over loftet/, eneste: true },
    { navn: 'moerkt-foto', o: { ...STANDARD, fil: moerkFil, sloer: 0.2 }, facit: 'AFVIST', grund: /^bred 1440/ },
    { navn: 'loftet', o: { ...STANDARD, fil: lysFil2, sloerSmal: 0.6 }, lag: RUNDE3_OEJENBRYN, facit: 'AFVIST', grund: /kræver slør .* > loftet 0,6 — fotoet kan ikke bære teksten/ },
    { navn: 'uden-licens', o: { ...STANDARD, fil: lysFil, licens: null }, facit: 'AFVIST', grund: /licens/, eneste: true },
    { navn: 'lang-kredit', o: { ...STANDARD, fil: lysFil, kredit: 'Stemningsfoto: Jens Peter Hansen / Wikimedia Commons, CC BY-SA 4.0' }, facit: 'AFVIST', grund: /^kreditering .*linjer/ },
  ]
  const res = [], fejl = []
  for (const x of tilfaelde) {
    const r = await maalEt(x.o, x.navn, x.lag ?? ''); res.push(r)
    if (r.dom !== x.facit) fejl.push(`${x.navn}: ${r.dom}, facit ${x.facit}`)
    if (x.grund && !r.grunde.some((g) => x.grund.test(g))) fejl.push(`${x.navn}: ${r.dom}, men ikke af den grund, der skulle (${x.grund})`)
    if (x.eneste && r.grunde.length !== 1) fejl.push(`${x.navn}: skulle afvises af netop én grund, fik ${r.grunde.length}`)
  }
  return { res, fejl }
}

let res = [], fejl = []
if (kandidater[0] === '--selvproeve') ({ res, fejl } = await selvproeve())
else for (const k of kandidater) res.push(await maalEt(objekt(k), basename(k).replace(/\.[^.]+$/, '')))
await br.close()
writeFileSync(join(UD, 'fotomaaling.json'), JSON.stringify(res, null, 1))
writeFileSync(join(UD, 'fotomaaling.md'), rapport(res))
process.stdout.write(rapport(res))
if (kandidater[0] === '--selvproeve') {
  process.stdout.write(`\nSELVPRØVE: ${fejl.length ? 'FEJL\n  ' + fejl.join('\n  ') : 'alle otte tilfælde fik deres facit — B, B · OVERVÅGES, og AFVIST ad seks veje (for tyndt slør, for tykt slør, over loftet, bred skærm, rettighederne, krediteringen)'}\n`)
  process.exit(fejl.length ? 1 : 0)
}
process.exit(res.every((r) => r.dom === 'B' || r.dom === 'B · OVERVÅGES') ? 0 : 1)
