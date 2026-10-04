// ═══════════════════════════════════════════════════════════════
//  Forsidefotoets varianter: WebP i de bredder, srcset'en tilbyder.
//
//      npx tsx scripts/hero-varianter.ts      skriver public/hero/
//
//  ── HVORFOR ───────────────────────────────────────────────────
//  `public/hero-stue.jpg` er 2048x1365 og 636.485 bytes, og alle skærme
//  fik den samme fil. Fotoet er forsidens LCP-element, og på en simuleret
//  telefonforbindelse (1,6 Mbit/s) tog originalen alene over fem sekunder
//  at hente. Målingerne står i docs/hastighed-2026-10.md.
//
//  ── ORIGINALEN RØRES IKKE ─────────────────────────────────────
//  Originalen er dokumenteret som «uændrede bytes fra kilden» med sin
//  sha256 (app/page.tsx og docs/kildetilladelser.md). Den bliver liggende
//  og er stadig `src` på <img>, så en browser uden srcset eller WebP får
//  præcis det, den fik før. Varianterne er AFLEDTE filer — skaleret og
//  kodet som WebP. Pexels-licensen tillader bearbejdning.
//  Scriptet nægter at køre, hvis originalen ikke har den dokumenterede
//  sha256: ellers kunne en udskiftet fil stille give nye varianter.
//
//  ── KVALITETEN ────────────────────────────────────────────────
//  WebP kvalitet 90. Målt med ffmpegs ssim-filter mod originalen i 2048
//  (yuv444p): Y 0,982, alle kanaler 0,990, 387 kB. Kvalitet 85 gav Y
//  0,969 og blev fravalgt; mozjpeg 90 gav Y 0,986 ved 472 kB. Hvilken
//  bredde en skærm får, afgør HERO_SIZES i lib/hero.ts — og den er sat,
//  så ingen skærm får færre pixel, end den kan vise.
// ═══════════════════════════════════════════════════════════════
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERO_BREDDER, heroVariant } from '../lib/hero'

const KILDE = 'public/hero-stue.jpg'
const SHA256 = 'a2b2795193c96f2508593dc1dca77f62ea986a10dd2600cef331e64e245d5b5f'
const KVALITET = 90

const raa = readFileSync(KILDE)
const sha = createHash('sha256').update(raa).digest('hex')
if (sha !== SHA256) {
  console.error(`FEJL: ${KILDE} har sha256 ${sha}, ikke den dokumenterede ${SHA256}.`)
  process.exit(1)
}

mkdirSync('public/hero', { recursive: true })
for (const b of HERO_BREDDER) {
  const ud = await sharp(raa)
    .resize({ width: b, withoutEnlargement: true })
    .webp({ quality: KVALITET, effort: 6, smartSubsample: true })
    .toBuffer()
  const fil = join('public', heroVariant(b))
  writeFileSync(fil, ud)
  console.log(`${fil}  ${(ud.length / 1024).toFixed(0)} kB`)
}
