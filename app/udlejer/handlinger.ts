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
import { spor } from '../../lib/maaling-server'
import {
  NULSTILLET, callbackUrl, gendanUrl, kontekstFra, vejFor, type Kontekst,
} from '../../lib/kontovej'
import { FOR_KORT, tjekAdgangskode } from '../../lib/adgangskode'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const NOEGLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** Svaret en formular faar tilbage. Begge felter er valgfrie: en handling
 *  der lykkes og omdirigerer, naar aldrig at returnere noget. */
export interface Svar { fejl?: string; besked?: string }

// ─── Konto ─────────────────────────────────────────────────────

/**
 * Konteksten er FOERSTE argument, saa formularen kan binde den.
 *
 * `useActionState` giver os `(forrige, formData)`. Med `.bind(null, k)` i
 * komponenten bliver signaturen `(k, forrige, formData)`, og konteksten
 * kommer altsaa ikke fra et skjult inputfelt, brugeren kan rette i
 * devtools. Den ville i oevrigt vaere harmloes dér — den vaelger en
 * destination, ikke en rettighed, se lib/kontovej.ts — men et argument
 * bundet paa serveren er baade enklere og aerligere.
 *
 * `kontekstFra` koeres alligevel: en bunden vaerdi er stadig en vaerdi,
 * og bordet skal vaere det eneste, der afgoer maalet.
 */
export async function tilmeld(k: Kontekst, _forrige: Svar, f: FormData): Promise<Svar> {
  const kontekst = kontekstFra(k)
  const mail = String(f.get('mail') ?? '').trim()
  const kode = String(f.get('kode') ?? '')
  const kodefejl = tjekAdgangskode(kode)
  if (kodefejl) return { fejl: kodefejl }
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? ''
  const sb = await supabase()
  const { error } = await sb.auth.signUp({
    email: mail,
    password: kode,
    // Til callback-ruten, ikke til en side. Ruten veksler PKCE-koden til
    // en session og sender hende videre til KONTEKSTENS maal — foer laa
    // «/udlejer» hardkodet her, saa en boligsoegende blev sendt til
    // udlejersiden af sin egen bekraeftelsesmail.
    options: { emailRedirectTo: base ? callbackUrl(base, kontekst) : undefined },
  })
  if (error) {
    // Kun fejlKLASSEN, aldrig Supabases egen tekst: den kan baere
    // brugerinput og tekniske detaljer, vi ikke skal gemme.
    const klasse = fejlklasse(error.message)
    await spor({
      navn: 'server_action_failed',
      props: { handling: 'tilmeld', fejlklasse: klasse },
    }, rute(kontekst))
    // «Findes allerede» siges ALDRIG til den, der spoerger. Se
    // TILMELDT nedenfor. Klassen bogfoeres stadig — det er vores egen
    // statistik, ikke et svar til en fremmed.
    if (klasse === 'findes-allerede') return { besked: TILMELDT }
    return { fejl: oversaet(error.message) }
  }
  // «Startet», ikke «gennemfoert»: kontoen er ikke aktiv, foer linket i
  // mailen er trykket. signup_completed fyrer i lib/auth.ts ved foerste
  // binding af auth_user_id. Mailadressen naar aldrig et event.
  await spor({ navn: 'signup_started', props: {} }, rute(kontekst))
  return { besked: TILMELDT }
}

/**
 * ÉN besked, uanset om adressen var ledig.
 *
 * ═══ HVORFOR DEN ER FORMULERET SAADAN ═══
 *
 * En fejlfri `signUp()` er IKKE bevis for, at der blev sendt en mail. Med
 * «Confirm email» slaaet til svarer GoTrue uden fejl paa en adresse, der
 * allerede har en bekraeftet konto, og sender ingenting — beskyttelsen
 * mod at afsoege, hvem der er kunde hos os. Den beskyttelse maa vi ikke
 * ophaeve, og vi maa slet ikke slaa den op selv: et opslag i `auth.users`
 * med en secret-noegle ville flytte laekagen fra Supabase til os.
 *
 * Derfor siger vi det samme begge veje, og vi siger det som en
 * BETINGELSE til hende — ikke som en oplysning om adressen. Hun ved
 * selv, om hun har en konto; en fremmed, der proever sig frem, laerer
 * ingenting.
 *
 * Vejen videre er ikke «slet kontoen». Kom mailen ikke frem, sender
 * `signUp()` paa en UBEKRAEFTET konto den igen — at udfylde formularen en
 * gang til er altsaa den rigtige handling, og den er noget, hun selv kan
 * goere.
 */
const TILMELDT = 'Kan adressen bruges til en ny konto, har vi sendt et link til den — '
  + 'tryk på det, så er kontoen aktiv. Har du allerede en konto, er der ikke sendt noget; '
  + 'så log ind i stedet. Er mailen ikke dukket op om et par minutter, så kig i spam og '
  + 'udfyld formularen igen — så sender vi linket på ny.'

export async function login(k: Kontekst, _forrige: Svar, f: FormData): Promise<Svar> {
  const kontekst = kontekstFra(k)
  const sb = await supabase()
  const { error } = await sb.auth.signInWithPassword({
    email: String(f.get('mail') ?? '').trim(),
    password: String(f.get('kode') ?? ''),
  })
  if (error) {
    await spor({
      navn: 'server_action_failed',
      props: { handling: 'login', fejlklasse: fejlklasse(error.message) },
    }, rute(kontekst))
    return { fejl: oversaet(error.message) }
  }
  // Raekken, der syr det anonyme forloeb sammen med det indloggede: den
  // baerer BAADE anonymous_id og user_id. Brugerraekken hentes ikke her —
  // hentUdlejer() koster et Supabase-kald, og id'et kommer med paa de
  // efterfoelgende events fra udlejersiden.
  await spor({ navn: 'login_completed', props: {} }, rute(kontekst))
  redirect(vejFor(kontekst).efterLogin)
}

export async function logUd(k: Kontekst) {
  const kontekst = kontekstFra(k)
  const sb = await supabase()
  await sb.auth.signOut()
  redirect(vejFor(kontekst).efterLogud)
}

/**
 * Hvilken rute et event bogfoeres paa.
 *
 * Kontekstens EGEN side, ikke maalet: `login_completed` hoerer hjemme
 * dér, hvor formularen stod. Begge staar i RUTER-allowlisten i
 * lib/maaling.ts, saa der kommer ingen nye ruter og ingen nye events.
 */

// ─── Glemt adgangskode ─────────────────────────────────────────

/**
 * Svaret paa en anmodning. ALTID det samme, uanset om adressen findes.
 *
 * ═══ HVORFOR DEN IKKE MAA AFSLOERE NOGET ═══
 *
 * «Vi har sendt en mail» over for «den adresse kender vi ikke» goer
 * formularen til et opslagsvaerk: enhver kan afproeve en liste og faa at
 * vide, hvem der har en konto hos os. Det er den samme grund, som
 * `TILMELDT` findes af — og de to beskeder skal derfor ogsaa taale at
 * blive set ved siden af hinanden uden at kunne skelnes.
 *
 * Teksten lover derfor ikke, at der ER sendt noget. Den siger, hvad der
 * sker, HVIS adressen har en konto.
 */
const GENDAN_SENDT = 'Har adressen en konto hos os, har vi sendt et link til den — '
  + 'tryk på det, så kan du vælge en ny adgangskode. Linket kan kun bruges én gang '
  + 'og udløber efter kort tid. Er mailen ikke dukket op om et par minutter, så kig '
  + 'i spam og prøv igen.'

/** Naar linket er brugt, udloebet, eller aabnet i en anden browser. */
const INGEN_SESSION = 'Linket er ikke længere gyldigt. Bed om et nyt herunder — '
  + 'gendannelseslinks kan kun bruges én gang og udløber efter kort tid.'

/**
 * Bed om et gendannelseslink.
 *
 * Kalder `resetPasswordForEmail`, som — praecis som `signUp` — laegger en
 * PKCE-verifier i hendes cookies og sender hende en mail, der peger
 * tilbage paa vores callback. Derfor `gendanUrl()` og ikke
 * `callbackUrl()`: linket skal baere forloebet, saa callbacken ved, at
 * hun skal videre til «Vaelg ny adgangskode» og ikke ind paa Min side.
 *
 * ⚠ VERIFIEREN LIGGER I DEN BROWSER, DER SPURGTE. Aabner hun mailen paa
 * telefonen efter at have spurgt paa computeren, kan koden ikke veksles.
 * Det er PKCE'ens vaesen og ikke en fejl — callbacken sender hende
 * tilbage hertil med en forklaring.
 */
export async function anmodGendannelse(
  k: Kontekst, _forrige: Svar, f: FormData,
): Promise<Svar> {
  const kontekst = kontekstFra(k)
  const mail = String(f.get('mail') ?? '').trim()
  if (!mail) return { fejl: 'Skriv den mailadresse, kontoen er oprettet med.' }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? ''
  const sb = await supabase()
  const { error } = await sb.auth.resetPasswordForEmail(mail, {
    redirectTo: base ? gendanUrl(base, kontekst) : undefined,
  })

  if (error) {
    const klasse = fejlklasse(error.message)
    await spor({
      navn: 'server_action_failed',
      props: { handling: 'gendan-anmod', fejlklasse: klasse },
    }, rute(kontekst))

    // To fejl maa hun se, fordi ingen af dem siger noget om, hvorvidt
    // adressen har en konto:
    //
    //   · ratebegraensning er en egenskab ved VORES forsoeg. Tav vi om
    //     den, ville hun vente paa en mail, der aldrig blev sendt.
    //   · en syntaktisk umulig adresse er ren tastefejl.
    //
    // ALT andet — ogsaa «findes ikke», hvis Supabase en dag begynder at
    // sige det — falder igennem til den neutrale besked. Standarden er
    // altsaa tavshed, og kun to navngivne klasser bryder den.
    if (klasse === 'for-mange-forsoeg' || klasse === 'ugyldig-mail') {
      return { fejl: oversaet(error.message) }
    }
  }
  return { besked: GENDAN_SENDT }
}

/**
 * Gem den nye adgangskode.
 *
 * ═══ HVEM HUN ER, KOMMER FRA AUTH-SERVEREN ═══
 *
 * `getUser()` og ikke `getSession()`, og hverken bruger-id eller mail
 * fra formularen. Et skjult felt er en anmodning, ikke et bevis — og
 * her ville et bevis-frit felt betyde, at enhver kunne skifte en
 * fremmeds adgangskode ved at skrive hendes adresse i devtools.
 *
 * `updateUser` skifter koden paa DEN konto, sessionen tilhoerer. Der er
 * derfor ingen parameter at forfalske: kender vi ikke sessionen, er der
 * ingen konto at pege paa.
 *
 * ⚠ URL'ens `?k=` giver ingen adgang. Den vaelger kun, hvor hun sendes
 * hen bagefter. Uden session sker der intet, uanset hvad der staar i
 * adresselinjen.
 */
export async function gemNyKode(
  k: Kontekst, _forrige: Svar, f: FormData,
): Promise<Svar> {
  const kontekst = kontekstFra(k)
  const kode = String(f.get('kode') ?? '')
  const gentag = String(f.get('gentag') ?? '')

  // Samme krav som ved oprettelsen, fordi det er den samme funktion.
  const kodefejl = tjekAdgangskode(kode, gentag)
  if (kodefejl) return { fejl: kodefejl }

  const sb = await supabase()
  const { data, error: sessionsfejl } = await sb.auth.getUser()
  if (sessionsfejl || !data.user) return { fejl: INGEN_SESSION }

  const { error } = await sb.auth.updateUser({ password: kode })
  if (error) {
    const klasse = fejlklasse(error.message)
    await spor({
      navn: 'server_action_failed',
      props: { handling: 'gendan-gem', fejlklasse: klasse },
    }, rute(kontekst))
    return { fejl: oversaet(error.message) }
  }

  // FOERST her er koden skiftet. Kvitteringen ligger efter kaldet og
  // ikke foer, saa «det lykkedes» aldrig kan staa paa skaermen, mens
  // Supabase har afvist aendringen.
  //
  // Sessionen lukkes med vilje: linket gav hende en session uden at
  // kraeve den gamle kode, og den skal ikke leve videre. Er mailen
  // kommet paa afveje, mister den, der aabnede den, adgangen igen i
  // samme sekund — og hun logger ind med den kode, KUN hun kender.
  await sb.auth.signOut()
  redirect(`${vejFor(kontekst).efterLogud}?${NULSTILLET}=1`)
}


const rute = (k: Kontekst): '/udlejer' | '/min-side' =>
  k === 'udlejer' ? '/udlejer' : '/min-side'

/**
 * Fejlens KLASSE, aldrig dens tekst.
 *
 * Beskeden fra Supabase kan indeholde brugerinput, mailadresser og
 * tekniske detaljer. Et lukket sæt kategorier siger det, en rapport har
 * brug for, uden at gemme noget af det.
 */
function fejlklasse(m: string): string {
  const t = m.toLowerCase()
  if (t.includes('invalid login')) return 'forkert-login'
  if (t.includes('already registered')) return 'findes-allerede'
  if (t.includes('email address') && t.includes('invalid')) return 'ugyldig-mail'
  if (t.includes('rate limit')) return 'for-mange-forsoeg'
  if (t.includes('not confirmed')) return 'ikke-bekraeftet'
  // De to, `updateUser` kan svare med, naar den nye kode ikke duer.
  if (t.includes('should be different')) return 'samme-kode'
  if (t.includes('password') && t.includes('at least')) return 'for-svag'
  return 'andet'
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
  if (t.includes('should be different')) {
    return 'Den nye adgangskode skal være en anden end den, du havde.'
  }
  if (t.includes('password') && t.includes('at least')) return FOR_KORT
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
