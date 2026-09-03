'use server'

// ═══════════════════════════════════════════════════════════════
//  Udlejerens handlinger.
//
//  Alt ejerskab tjekkes i databasen mod den indloggede bruger — aldrig
//  mod noget, formularen har sendt med. En skjult `id`-felt i en HTML-form
//  er en anmodning, ikke et bevis.
// ═══════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache'
import { FACILITETER } from '../../lib/faciliteter'
import { byForPostnr } from '../../lib/omraade'
import { redirect } from 'next/navigation'
import { adgangstoken, hentUdlejer, supabase } from '../../lib/auth'
import { billedUrl } from '../../lib/billede'
import {
  fjernBolig, genudgivBolig, opdaterBolig, opretBolig, renTekst,
  tjekAdresse, type Boliginput,
} from '../../lib/udlejer'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const NOEGLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** Svaret en formular faar tilbage. Begge felter er valgfrie: en handling
 *  der lykkes og omdirigerer, naar aldrig at returnere noget. */
export interface Svar { fejl?: string; besked?: string }

// ─── Konto ─────────────────────────────────────────────────────

export async function tilmeld(_forrige: Svar, f: FormData): Promise<Svar> {
  const mail = String(f.get('mail') ?? '').trim()
  const kode = String(f.get('kode') ?? '')
  if (kode.length < 10) {
    return { fejl: 'Adgangskoden skal være mindst 10 tegn. Længde slår krøllede tegn.' }
  }
  const sb = await supabase()
  const { error } = await sb.auth.signUp({
    email: mail,
    password: kode,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/udlejer` },
  })
  if (error) return { fejl: oversaet(error.message) }
  return { besked: 'Tjek din mail. Vi har sendt et link, du skal trykke på, før kontoen er aktiv.' }
}

export async function login(_forrige: Svar, f: FormData): Promise<Svar> {
  const sb = await supabase()
  const { error } = await sb.auth.signInWithPassword({
    email: String(f.get('mail') ?? '').trim(),
    password: String(f.get('kode') ?? ''),
  })
  if (error) return { fejl: oversaet(error.message) }
  redirect('/udlejer/boliger')
}

export async function logUd() {
  const sb = await supabase()
  await sb.auth.signOut()
  redirect('/udlejer')
}

/** Supabases fejltekster er engelske og tekniske. Brugeren skal vide,
 *  hvad hun gør nu — ikke hvad tjenesten hedder. */
function oversaet(m: string): string {
  const t = m.toLowerCase()
  if (t.includes('invalid login')) return 'Forkert mailadresse eller adgangskode.'
  if (t.includes('already registered')) return 'Der findes allerede en konto på den mailadresse. Log ind i stedet.'
  if (t.includes('email address') && t.includes('invalid')) return 'Den mailadresse ser ikke rigtig ud.'
  if (t.includes('rate limit')) return 'For mange forsøg lige nu. Prøv igen om lidt.'
  if (t.includes('not confirmed')) return 'Kontoen er ikke bekræftet endnu — tryk på linket i mailen.'
  return m
}

// ─── Billeder ──────────────────────────────────────────────────
//
//  Filen gaar ALDRIG gennem vores server. Den skal ikke: en Server Action
//  har en kropsgraense paa 1 MB, og et telefonbillede sprænger den — det
//  gav 500 og en formular, der frøs. Graensen er heller ikke problemet,
//  den er symptomet. Arkitekturen i migration 0014 er, at udlejeren
//  uploader direkte til sin egen mappe i bucket'en.
//
//  Serveren gør to smaa ting, som klienten ikke kan:
//    1. udsteder en signeret upload-URL (kraever hendes token)
//    2. signerer en langtidsholdbar laese-URL bagefter
//  Begge er JSON paa nogle faa hundrede bytes.
// ─── ─────────────────────────────────────────────────────────

/** Ti aar. URL'en gemmes i basen og skal holde, saa laenge annoncen goer. */
const SIGNATUR_SEKUNDER = 10 * 365 * 24 * 3600

/** Filnavne fra en telefon kan indeholde hvad som helst. Stien er vores. */
function rensEndelse(navn: string): string {
  const e = (navn.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(e) ? e : 'jpg'
}

/** Udsteder en signeret upload-URL til udlejerens egen mappe. */
export async function signerUpload(
  filnavn: string,
): Promise<{ sti?: string; url?: string; fejl?: string }> {
  const u = await hentUdlejer()
  const token = await adgangstoken()
  if (!u || !token || !URL_ || !NOEGLE) return { fejl: 'Du skal være logget ind.' }

  // Mappen ER udlejerens auth-uid. Politikken i 0014 haandhaever det, saa
  // en signatur til en fremmed mappe bliver afvist af databasen.
  const sti = `${u.authUserId}/${crypto.randomUUID()}.${rensEndelse(filnavn)}`
  const r = await fetch(`${URL_}/storage/v1/object/upload/sign/boliger/${sti}`, {
    method: 'POST',
    headers: { apikey: NOEGLE, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!r.ok) {
    console.error(`[udlejer] signerUpload ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return { fejl: `Kunne ikke forberede uploaden (${r.status}).` }
  }
  const { url } = await r.json() as { url?: string }
  if (!url) return { fejl: 'Lageret svarede uden en upload-adresse.' }
  return { sti, url: `${URL_}/storage/v1${url.startsWith('/') ? '' : '/'}${url}` }
}

/**
 * Kaldes NAAR filen ligger i bucket'en. Signerer en laese-URL, som gemmes
 * i listing_images, og en forhaandsvisning gennem vores egen proxy.
 *
 * Stien tjekkes mod den indloggede brugers mappe. Klienten sender den, og
 * det klienten sender, er en anmodning — ikke et bevis.
 */
export async function registrerBillede(
  sti: string,
): Promise<{ url?: string; forhaandsvisning?: string; fejl?: string }> {
  const u = await hentUdlejer()
  const token = await adgangstoken()
  if (!u || !token || !URL_ || !NOEGLE) return { fejl: 'Du skal være logget ind.' }
  if (!sti.startsWith(`${u.authUserId}/`) || sti.includes('..')) {
    return { fejl: 'Ugyldig sti.' }
  }

  const r = await fetch(`${URL_}/storage/v1/object/sign/boliger/${sti}`, {
    method: 'POST',
    headers: { apikey: NOEGLE, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNATUR_SEKUNDER }),
  })
  if (!r.ok) {
    console.error(`[udlejer] registrerBillede ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return { fejl: `Billedet blev gemt, men kunne ikke gøres synligt (${r.status}).` }
  }
  const { signedURL, signedUrl } = await r.json() as { signedURL?: string; signedUrl?: string }
  const rel = signedUrl ?? signedURL
  if (!rel) return { fejl: 'Lageret svarede uden en signatur.' }
  const url = `${URL_}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`
  // Forhaandsvisningen skal ogsaa gennem vores proxy, og den kraever VORES
  // signatur. Den kan kun laves paa serveren, saa den foelger med tilbage.
  return { url, forhaandsvisning: billedUrl(url, 400) ?? undefined }
}

// ─── Annoncen ──────────────────────────────────────────────────

const oere = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
const heltal = (v: FormDataEntryValue | null): number | null => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

const GYLDIGE_FACILITETER = new Set<string>(FACILITETER.map((x) => x.vaerdi))

async function laesInput(f: FormData): Promise<Boliginput | string> {
  // Adskilte felter. De samles ALDRIG til en streng, der parses igen —
  // "Nørrebrogade 30, 2200" blev laest som etage 22, doer 00.
  const vej = renTekst(f.get('vej'))
  const husnr = renTekst(f.get('husnr'))
  const postnr = renTekst(f.get('postnr'))
  const husleje = oere(f.get('husleje'))
  const mail = renTekst(f.get('kontaktMail'))
  const tlf = renTekst(f.get('kontaktTlf'))
  const doer = renTekst(f.get('doer')) || null

  const galt = tjekAdresse({ vej, husnr, postnr, doer })
  if (galt) return galt
  if (husleje == null || husleje === 0) return 'Skriv huslejen.'
  if (!mail && !tlf) return 'Skriv en mailadresse eller et telefonnummer — lejeren skal kunne nå dig.'

  // Byen udledes, den indtastes ikke. `city` er praecis det, bysoegningen
  // og omraadesiderne filtrerer paa — en udlejer, der skriver "Kbh N" i
  // stedet for "København N", ville falde ud af hver eneste bysoegning
  // uden at kunne se hvorfor. Kender vi ikke postnummeret, bruger vi det,
  // hun har skrevet; er der heller ikke det, spoerger vi. Kolonnen maa
  // aldrig blive null.
  const udledtBy = await byForPostnr(postnr)
  const by = udledtBy ?? (renTekst(f.get('by')) || null)
  if (!by) return `Vi kender ikke byen for postnummer ${postnr}. Skriv den i feltet By.`

  return {
    vej,
    husnr,
    etage: renTekst(f.get('etage')) || null,
    doer,
    by,
    postnr,
    boligtype: renTekst(f.get('boligtype')) || 'lejlighed',
    areal: heltal(f.get('areal')),
    vaerelser: heltal(f.get('vaerelser')),
    husleje,
    varme: oere(f.get('varme')),
    vand: oere(f.get('vand')),
    el: oere(f.get('el')),
    oevrig: oere(f.get('oevrig')),
    depositum: oere(f.get('depositum')),
    forudbetalt: oere(f.get('forudbetalt')),
    ledigFra: renTekst(f.get('ledigFra')) || null,
    beskrivelse: renTekst(f.get('beskrivelse')),
    kontaktMail: mail || null,
    kontaktTlf: tlf || null,
    faciliteter: f.getAll('faciliteter').map(String).filter((v) => GYLDIGE_FACILITETER.has(v)),
    billeder: f.getAll('billeder').map(String).filter(Boolean),
  }
}

export async function gemBolig(_forrige: Svar, f: FormData): Promise<Svar> {
  const u = await hentUdlejer()
  if (!u) return { fejl: 'Du skal være logget ind.' }
  const input = await laesInput(f)
  if (typeof input === 'string') return { fejl: input }

  const id = String(f.get('id') ?? '')
  try {
    if (id) await opdaterBolig(u, id, input)
    else await opretBolig(u, input)
  } catch (e) {
    return { fejl: (e as Error).message }
  }
  revalidatePath('/udlejer/boliger')
  redirect('/udlejer/boliger')
}

export async function fjern(f: FormData) {
  const u = await hentUdlejer()
  if (!u) return
  await fjernBolig(u, String(f.get('id') ?? ''))
  revalidatePath('/udlejer/boliger')
}

export async function genudgiv(f: FormData) {
  const u = await hentUdlejer()
  if (!u) return
  await genudgivBolig(u, String(f.get('id') ?? ''))
  revalidatePath('/udlejer/boliger')
}
