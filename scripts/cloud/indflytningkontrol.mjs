// ═══════════════════════════════════════════════════════════════
//  «At betale ved indflytning» — den RENDEREDE visning.
//
//      node scripts/cloud/indflytningkontrol.mjs [udmappe]
//
//  ── HVORFOR DEN FINDES ───────────────────────────────────────
//  Blokken viste «Depositum og forudbetalt leje» som ÉT tal, regnet
//  baglæns af `move_in_cost − husleje − aconto`, og skrev under det:
//  «Kilden oplyser summen, ikke fordelingen mellem depositum og
//  forudbetalt leje».
//
//  Udsagnet var forkert. Kolonnerne `deposit` og `prepaid_rent` har
//  været der siden migration 0015; fem adaptere og hver eneste
//  udlejerannonce fylder dem. Siden kunne bare ikke se dem, fordi
//  `hentBolig` ikke hentede dem — så den regnede baglæns og kaldte sit
//  eget regnestykke for kildens oplysning.
//
//  ── HVORFOR EN BROWSERKONTROL OG IKKE `npm test` ─────────────
//  Datalaget måles i scripts/test-indflytning.ts, som kører mod
//  PGlite. Men boligsidens komponenttræ kan ikke indlæses under `tsx`:
//  `app/Landkort.tsx` importerer `leaflet/dist/leaflet.css`, og en
//  CSS-import uden en bundler giver ERR_UNKNOWN_FILE_EXTENSION.
//  Efterprøvet — ikke formodet. Den rigtige flade er derfor den
//  byggede app, og så kan de tre bredder måles i samme kørsel.
//
//  ── SEKS TILFÆLDE ────────────────────────────────────────────
//  Prøven sår sine EGNE rækker med eget nøglepræfiks og fjerner dem
//  igen — den rører aldrig scripts/cloud/saa.mjs' data. Samme mønster
//  som browserkontrol-pagination.mjs' canonical-afsnit.
//
//    begge            begge beløb kendt
//    kun-depositum    ét felt mangler — det andet skal stadig stå
//    kun-forudbetalt  spejlvendt
//    ingen            ingen af dem — teksten må ikke påstå noget
//    nul              begge oplyst som 0 kr.
//    uden-total       delene kendt, indflytningsprisen ikke (CEJ)
//
//  Exit: 0 = alt grønt · 1 = noget fejlede · 2 = intet at måle på
// ═══════════════════════════════════════════════════════════════
import pw from 'playwright-core'
import postgres from 'postgres'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const BASE = process.env.BOFINDA_APP_BASE ?? 'http://127.0.0.1:3100'
const UD = process.argv[2] ?? null
if (UD) mkdirSync(UD, { recursive: true })
if (!process.env.DATABASE_URL) {
  console.error('FEJL: DATABASE_URL mangler — prøven kan ikke så sine rækker.'); process.exit(2)
}

let fejl = 0
const tjek = (ok, navn, note = '') => {
  if (!ok) fejl++
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? '  — ' + note : ''}`)
}

const KR = 100                    // øre pr. krone
const LEJE = 10_000 * KR
const VARME = 2_000 * KR
const TOTAL = LEJE + VARME
const DEPOSITUM = 25_000 * KR
const FORUDBETALT = 20_000 * KR
const INDFLYTNING = 55_000 * KR

const SAG = [
  { navn: 'begge', depositum: DEPOSITUM, forudbetalt: FORUDBETALT, indflytning: INDFLYTNING },
  { navn: 'kun-depositum', depositum: DEPOSITUM, forudbetalt: null, indflytning: INDFLYTNING },
  { navn: 'kun-forudbetalt', depositum: null, forudbetalt: FORUDBETALT, indflytning: INDFLYTNING },
  { navn: 'ingen', depositum: null, forudbetalt: null, indflytning: INDFLYTNING },
  { navn: 'nul', depositum: 0, forudbetalt: 0, indflytning: LEJE + VARME },
  { navn: 'uden-total', depositum: DEPOSITUM, forudbetalt: FORUDBETALT, indflytning: null },
]

const PRAEFIKS = `indflytning-proeve-${Date.now()}`
const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })

const [kilde] = await sql`select id from sources where slug = 'test-alfa'`
if (!kilde) {
  console.error('FEJL: kilden test-alfa findes ikke — kør scripts/cloud/op.sh først.')
  await sql.end(); process.exit(2)
}

const ider = {}
const br = await pw.chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
})

try {
  for (const s of SAG) {
    const noegle = `${PRAEFIKS}-${s.navn}`
    const [r] = await sql`
      insert into listings (source_id, source_type, external_key, source_url, address_raw,
        street, house_number, postal_code, city, unit_address_uuid, address_match_level,
        property_type, size_m2, rooms, rent_monthly, utilities_heat,
        total_monthly, total_monthly_components,
        move_in_cost, deposit, prepaid_rent,
        status, first_seen_at, last_seen_at)
      values (${kilde.id}, 'spider', ${noegle}, ${'https://eksempel.invalid/' + noegle},
        ${`Depositumvej ${s.navn}, 9003 Attrapby`}, ${`Depositumvej ${s.navn}`}, '1',
        '9003', 'Attrapby', ${'intern:v3:proeve:' + randomUUID()}, 'unit',
        'lejlighed', 70, 3, ${LEJE}, ${VARME},
        ${TOTAL}, ${sql.array(['rent', 'heat'])},
        ${s.indflytning}, ${s.depositum}, ${s.forudbetalt},
        'active', now(), now())
      returning id`
    ider[s.navn] = r.id
  }
  console.log(`sået ${Object.keys(ider).length} prøveboliger under «${PRAEFIKS}»\n`)

  /** Blokken, som den står på skærmen. */
  const laes = (p) => p.evaluate(() => {
    // `.oek-indflytning` og ikke et nyt data-attribut: klassen findes i
    // BEGGE udgaver af markuppen. Et attribut, kun den nye har, ville
    // faa den negative kontrol til at stoppe ved «blokken vises» og
    // aldrig maale de paastande, den er skrevet for.
    const blok = document.querySelector('.oek-indflytning')
    if (!blok) return { findes: false }
    const post = (navn) => {
      const li = blok.querySelector(`li[data-post="${navn}"]`)
      if (!li) return null
      return {
        etiket: li.querySelector('span')?.textContent?.trim() ?? '',
        beloeb: li.querySelector('b')?.textContent?.trim() ?? '',
      }
    }
    const note = (navn) =>
      blok.querySelector(`p[data-note="${navn}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null
    return {
      findes: true,
      overskrift: blok.querySelector('.oek-etiket')?.textContent?.trim() ?? '',
      total: blok.querySelector('.oek-tal2')?.textContent?.trim() ?? null,
      poster: [...blok.querySelectorAll('.oek-poster li')]
        .map((li) => `${li.querySelector('span')?.textContent?.trim()}=${li.querySelector('b')?.textContent?.trim()}`),
      depositum: post('depositum'),
      forudbetalt: post('forudbetalt'),
      noteMangler: note('mangler'),
      noteUdenTotal: note('uden-total'),
      tekst: blok.textContent.replace(/\s+/g, ' ').trim(),
      overloeb: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      klippet: [...blok.querySelectorAll('.oek-poster span, .oek-poster b, .oek-etiket, .oek-tal2')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.className || e.tagName}:${e.scrollWidth}>${e.clientWidth}`),
    }
  })

  for (const bredde of [1440, 768, 390]) {
    const merke = bredde === 390 ? 'mobil' : bredde === 768 ? 'tablet' : 'desktop'
    console.log(`── ${merke} (${bredde} px) ──`)
    const c = await br.newContext({
      viewport: { width: bredde, height: bredde === 390 ? 844 : 1000 },
    })
    const p = await c.newPage()
    await p.goto(BASE + '/', { waitUntil: 'networkidle' })
    const k = p.getByRole('button', { name: 'Kun det nødvendige' })
    if (await k.count()) { await k.first().click(); await p.waitForTimeout(500) }

    for (const s of SAG) {
      await p.goto(`${BASE}/bolig/${ider[s.navn]}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(250)
      const m = await laes(p)
      const n = `${merke} · ${s.navn}`

      tjek(m.findes, `${n}: blokken vises`)
      if (!m.findes) continue

      // ── De to felter, hver for sig ──────────────────────────
      if (s.depositum != null) {
        tjek(m.depositum != null && m.depositum.etiket === 'Depositum',
          `${n}: depositum står som sin egen post`, m.depositum?.etiket ?? 'mangler')
        tjek(m.depositum?.beloeb === (s.depositum / KR).toLocaleString('da-DK'),
          `${n}: depositummets beløb er kildens eget`,
          `«${m.depositum?.beloeb}» — ventet «${(s.depositum / KR).toLocaleString('da-DK')}»`)
      } else {
        tjek(m.depositum == null, `${n}: intet depositum opfundet`, m.depositum?.beloeb ?? '')
      }
      if (s.forudbetalt != null) {
        tjek(m.forudbetalt != null && m.forudbetalt.etiket === 'Forudbetalt leje',
          `${n}: forudbetalt leje står som sin egen post`, m.forudbetalt?.etiket ?? 'mangler')
        tjek(m.forudbetalt?.beloeb === (s.forudbetalt / KR).toLocaleString('da-DK'),
          `${n}: den forudbetalte lejes beløb er kildens eget`,
          `«${m.forudbetalt?.beloeb}» — ventet «${(s.forudbetalt / KR).toLocaleString('da-DK')}»`)
      } else {
        tjek(m.forudbetalt == null, `${n}: ingen forudbetalt leje opfundet`, m.forudbetalt?.beloeb ?? '')
      }

      // ── Den gamle, sammenslåede post må være væk ────────────
      tjek(!/Depositum og forudbetalt leje/i.test(m.tekst),
        `${n}: den sammenslåede post findes ikke længere`)
      // ── Og påstanden om kilden må være væk ──────────────────
      tjek(!/[Kk]ilden oplyser summen/.test(m.tekst),
        `${n}: der påstås ikke noget om, hvad kilden oplyser`)
      tjek(!/kilden oplyser ikke/i.test(m.tekst),
        `${n}: teksten siger «vi har ikke», ikke «kilden oplyser ikke»`,
        m.noteMangler ?? '(ingen note)')

      // ── Forbeholdet, når noget mangler ──────────────────────
      const manglerNoget = s.depositum == null || s.forudbetalt == null
      tjek((m.noteMangler != null) === manglerNoget,
        `${n}: forbeholdet står ${manglerNoget ? 'når noget mangler' : 'ikke, når intet mangler'}`,
        m.noteMangler ?? '(ingen)')
      if (manglerNoget) {
        const venter = [
          s.depositum == null ? 'depositummet' : null,
          s.forudbetalt == null ? 'den forudbetalte leje' : null,
        ].filter(Boolean).join(' og ')
        tjek(m.noteMangler?.includes(venter),
          `${n}: forbeholdet navngiver præcis det, vi mangler`,
          `«${m.noteMangler}» — ventet «… ${venter} …»`)
      }

      // ── Den oplyste indflytningspris bevares ────────────────
      if (s.indflytning != null) {
        tjek(m.overskrift === 'At betale ved indflytning',
          `${n}: overskriften er bevaret`, `«${m.overskrift}»`)
        tjek(m.total?.startsWith((s.indflytning / KR).toLocaleString('da-DK')),
          `${n}: indflytningsprisen står uændret`,
          `«${m.total}» — ventet «${(s.indflytning / KR).toLocaleString('da-DK')} kr.»`)
        tjek(m.poster.some((x) => x.startsWith('Første måneds husleje=')),
          `${n}: opdelingen af totalen er bevaret`, m.poster.join(' · '))
        tjek(m.noteUdenTotal == null,
          `${n}: ingen note om en manglende total, når totalen står`)
      } else {
        // Delene må ALDRIG præsenteres som hele indflytningsprisen.
        tjek(m.total == null, `${n}: der vises ingen samlet pris`, m.total ?? '(ingen)')
        tjek(m.overskrift === 'Ved indflytning',
          `${n}: overskriften lover ikke en total`, `«${m.overskrift}»`)
        tjek(m.noteUdenTotal != null && /ikke hele det, der skal betales/.test(m.noteUdenTotal),
          `${n}: der står, at beløbene ikke er hele regningen`, m.noteUdenTotal ?? '(ingen)')
        tjek(!m.poster.some((x) => x.startsWith('Første måneds husleje=')),
          `${n}: husleje og aconto står ikke som dele af en total, vi ikke har`,
          m.poster.join(' · '))
      }

      // ── 0 er et oplyst beløb ────────────────────────────────
      if (s.navn === 'nul') {
        tjek(m.depositum?.beloeb === '0' && m.forudbetalt?.beloeb === '0',
          `${n}: 0 kr. vises som 0, ikke som et fravær`,
          `depositum «${m.depositum?.beloeb}», forudbetalt «${m.forudbetalt?.beloeb}»`)
        tjek(m.noteMangler == null,
          `${n}: 0 udløser ikke forbeholdet om manglende oplysninger`,
          m.noteMangler ?? '(ingen)')
      }

      tjek(m.overloeb <= 0, `${n}: intet vandret overløb`, `${m.overloeb} px`)
      tjek(m.klippet.length === 0, `${n}: ingen klippet tekst i blokken`,
        m.klippet.join(' · ') || '0')

      if (UD) {
        const boks = p.locator('.oek-kort').first()
        if (await boks.count()) {
          await boks.scrollIntoViewIfNeeded()
          await p.waitForTimeout(150)
          await boks.screenshot({ path: `${UD}/${s.navn}-${merke}.png` })
        }
      }
    }
    await c.close()
    console.log('')
  }
} finally {
  await br.close()
  // KUN prøvens egne rækker, og linjen tæller efter — en oprydning, der
  // ikke er efterprøvet, er et løfte.
  const v = await sql`delete from listings where external_key like ${PRAEFIKS + '%'}`
  const [{ n }] = await sql`
    select count(*)::int as n from listings where external_key like ${PRAEFIKS + '%'}`
  console.log(`  · ryddet ${v.count} prøverækker (${n} tilbage)`)
  if (n !== 0) fejl++
  await sql.end()
}

console.log(fejl === 0
  ? '✓ depositum og forudbetalt leje står hver for sig'
  : `✗ ${fejl} kontrol(ler) fejlede`)
process.exit(fejl === 0 ? 0 : 1)
