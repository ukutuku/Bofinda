'use server'

// ═══════════════════════════════════════════════════════════════
//  Udlejerens handlinger.
//
//  Alt ejerskab tjekkes i databasen mod den indloggede bruger — aldrig
//  mod noget, formularen har sendt med. En skjult `id`-felt i en HTML-form
//  er en anmodning, ikke et bevis.
// ═══════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { adgangstoken, hentUdlejer, supabase } from '../../lib/auth'
import { billedUrl } from '../../lib/billede'
import {
  fjernBolig, genudgivBolig, opdaterBolig, opretBolig, type Boliginput,
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

/** Ti år. URL'en gemmes i basen og skal holde, så længe annoncen gør. */
const SIGNATUR_SEKUNDER = 10 * 365 * 24 * 3600

/**
 * Uploader ét billede til udlejerens egen mappe og returnerer en signeret
 * URL. Bucket'en er privat: hverken browseren eller en fremmed kan hente
 * filen uden signaturen, og signaturen når kun frem gennem vores proxy.
 */
export async function uploadBillede(
  f: FormData,
): Promise<{ url?: string; forhaandsvisning?: string; fejl?: string }> {
  const u = await hentUdlejer()
  const token = await adgangstoken()
  if (!u || !token || !URL_ || !NOEGLE) return { fejl: 'Du skal være logget ind.' }

  const fil = f.get('fil')
  if (!(fil instanceof File) || fil.size === 0) return { fejl: 'Ingen fil.' }
  if (!fil.type.startsWith('image/')) return { fejl: 'Kun billeder.' }
  if (fil.size > 8 * 1024 * 1024) return { fejl: 'Billedet må højst fylde 8 MB.' }

  const endelse = (fil.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  // Mappen er udlejerens auth-uid. Politikken i migration 0014 kraever det.
  const sti = `${u.authUserId}/${crypto.randomUUID()}.${endelse || 'jpg'}`

  const op = await fetch(`${URL_}/storage/v1/object/boliger/${sti}`, {
    method: 'POST',
    headers: { apikey: NOEGLE, Authorization: `Bearer ${token}`, 'content-type': fil.type },
    body: await fil.arrayBuffer(),
  })
  if (!op.ok) return { fejl: `Kunne ikke gemme billedet (${op.status}).` }

  const sig = await fetch(`${URL_}/storage/v1/object/sign/boliger/${sti}`, {
    method: 'POST',
    headers: { apikey: NOEGLE, Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn: SIGNATUR_SEKUNDER }),
  })
  if (!sig.ok) return { fejl: `Kunne ikke signere billedet (${sig.status}).` }
  const { signedURL, signedUrl } = await sig.json() as { signedURL?: string; signedUrl?: string }
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

function laesInput(f: FormData): Boliginput | string {
  const adresse = String(f.get('adresse') ?? '').trim()
  const postnr = String(f.get('postnr') ?? '').trim()
  const husleje = oere(f.get('husleje'))
  const mail = String(f.get('kontaktMail') ?? '').trim()
  const tlf = String(f.get('kontaktTlf') ?? '').trim()

  if (!adresse) return 'Skriv adressen.'
  if (!/^\d{4}$/.test(postnr)) return 'Postnummeret skal være fire cifre.'
  if (husleje == null || husleje === 0) return 'Skriv huslejen.'
  if (!mail && !tlf) return 'Skriv en mailadresse eller et telefonnummer — lejeren skal kunne nå dig.'

  return {
    adresse: adresse.includes(postnr) ? adresse : `${adresse}, ${postnr}`,
    postnr,
    boligtype: String(f.get('boligtype') ?? 'lejlighed'),
    areal: heltal(f.get('areal')),
    vaerelser: heltal(f.get('vaerelser')),
    husleje,
    varme: oere(f.get('varme')),
    vand: oere(f.get('vand')),
    el: oere(f.get('el')),
    oevrig: oere(f.get('oevrig')),
    depositum: oere(f.get('depositum')),
    forudbetalt: oere(f.get('forudbetalt')),
    ledigFra: String(f.get('ledigFra') ?? '').trim() || null,
    beskrivelse: String(f.get('beskrivelse') ?? '').trim(),
    kontaktMail: mail || null,
    kontaktTlf: tlf || null,
    billeder: f.getAll('billeder').map(String).filter(Boolean),
  }
}

export async function gemBolig(_forrige: Svar, f: FormData): Promise<Svar> {
  const u = await hentUdlejer()
  if (!u) return { fejl: 'Du skal være logget ind.' }
  const input = laesInput(f)
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
