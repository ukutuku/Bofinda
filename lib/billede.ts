// ═══════════════════════════════════════════════════════════════
//  Billed-proxy: signering og URL-bygning.
//
//  Billeder hotlinkes, kopieres aldrig. Vi gemmer kildens egen URL i
//  listing_images og henter den gennem vores egen rute, som skalerer og
//  konverterer til WebP undervejs. Nul lagerplads, aldrig foraeldede
//  billeder — og kilden faar ikke vores brugeres IP-adresser.
//
//  Signaturen er der, saa fremmede ikke kan bruge proxyen som gratis
//  billedtjeneste for vilkaarlige URL'er. Vaertslisten er andet lag:
//  slipper hemmeligheden ud, kan den stadig kun pege paa de to vaerter,
//  vi allerede hotlinker fra.
// ═══════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Vaerter vi henter billeder fra. SKAL foelge kilderne i adapters/.
 *
 * Glemmes en vaert, returnerer billedUrl() null, og billederne forsvinder
 * uden en fejl nogen steder — det skete for dacas.dk, hvor 177 billeder
 * bare ikke blev vist. Tilfoej vaerten i SAMME aendring som adapteren.
 */
export const TILLADTE_VAERTER = new Set([
  'app.propstep.com',
  'findbolig.nu',
  'dacas.dk',
  'lokalbolig.io',
])

/** Bredder vi overhovedet udleverer. Frit valg ville lade en fremmed
 *  bede om tusind varianter og fylde cachen. */
export const BREDDER = [400, 800, 1600] as const
export type Bredde = (typeof BREDDER)[number]

/**
 * Vaerter der har bedt om mindre, end vi ellers udleverer.
 *
 * lokalbolig.io svarer med Cloudflares Content Signals:
 *
 *     Content-Signal: search=yes,ai-train=no,use=reference
 *
 * og filen definerer selv `search` som "returning hyperlinks and short
 * excerpts". Et billede i 1600 px er ikke et kort uddrag. De har taget
 * udtrykkeligt stilling, og saa retter vi os efter den, ogsaa hvor
 * robots.txt teknisk set tillader os alt (`User-agent: *` er `Allow: /`,
 * og BofindaBot staar ikke blandt de ni AI-crawlere, de afviser).
 *
 * Andre vaerter beholder alle tre bredder.
 */
const BREDDER_PR_VAERT: Record<string, readonly Bredde[]> = {
  'lokalbolig.io': [400, 800],
}

const breddeListe = (host: string): readonly Bredde[] =>
  BREDDER_PR_VAERT[host] ?? BREDDER

/** Maa denne vaert levere netop denne bredde? Haandhaeves i ruten. */
export function breddeTilladt(url: string, bredde: number): boolean {
  try {
    return breddeListe(new URL(url).host).includes(bredde as Bredde)
  } catch {
    return false
  }
}

function hemmelighed(): string {
  const s = process.env.BILLED_HEMMELIGHED
  if (!s || s.length < 16) {
    throw new Error('BILLED_HEMMELIGHED mangler eller er for kort (mindst 16 tegn)')
  }
  return s
}

const signer = (url: string, bredde: number): string =>
  createHmac('sha256', hemmelighed()).update(`${url}|${bredde}`).digest('base64url').slice(0, 24)

/** Sammenlign i konstant tid — ellers kan signaturen gaettes tegn for tegn. */
export function signaturOk(url: string, bredde: number, givet: string): boolean {
  const vores = Buffer.from(signer(url, bredde))
  const deres = Buffer.from(givet)
  if (vores.length !== deres.length) return false
  return timingSafeEqual(vores, deres)
}

export function vaertTilladt(url: string): boolean {
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && TILLADTE_VAERTER.has(u.host)
  } catch {
    return false
  }
}

/**
 * Kildens billed-URL -> vores signerede rute.
 *
 * Beder kalderen om en bredde, vaerten ikke leverer, skaeres der NED til
 * den stoerste, den leverer — der returneres ikke null. Lysbordet paa
 * boligsiden beder om 1600; svarede vi null, ville billedet forsvinde
 * helt, og en kilde der har bedt om mindre ville blive straffet med
 * ingenting i stedet for lidt mindre.
 */
export function billedUrl(eksternUrl: string, bredde: Bredde = 800): string | null {
  if (!vaertTilladt(eksternUrl)) return null
  const tilladte = breddeListe(new URL(eksternUrl).host)
  const valgt = tilladte.includes(bredde)
    ? bredde
    : tilladte.reduce((a, b) => (b <= bredde && b > a ? b : a), tilladte[0]!)
  const p = new URLSearchParams({
    u: eksternUrl,
    b: String(valgt),
    s: signer(eksternUrl, valgt),
  })
  return `/api/billede?${p}`
}
