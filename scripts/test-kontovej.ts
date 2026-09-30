// ═══════════════════════════════════════════════════════════════
//  Kontoforløbets destination, callbacken og sessionens cookies.
//
//  ═══ HVOR ATTRAPPEN SIDDER ═══
//
//  På HTTP-grænsen ud til Auth-tjenesten — ikke på SDK'et. En lille
//  GoTrue-efterligning lytter på 127.0.0.1, og `NEXT_PUBLIC_SUPABASE_URL`
//  peger på den. Alt derfra og ind er den ægte kode: @supabase/ssr laver
//  sin egen PKCE-verifier, veksler den rigtigt, deler cookies i bidder og
//  skriver dem — og vores egen callback-rute, middleware og målbord er
//  dem, der kører.
//
//  Det er dét, der gør prøven værd at have: en attrap på SDK'et ville
//  bevise, at vi kalder en funktion. Den her beviser, at cookien
//  faktisk lander på det svar, browseren får.
//
//  ⚠ DET ER STADIG IKKE EN E2E-PRØVE. Efterligningen svarer, som vi
//  TROR GoTrue svarer. At det rigtige Supabase Auth opfører sig sådan —
//  og at «Confirm email» er slået til — kan kun afgøres i et rigtigt
//  Auth-miljø. Se docs/auth-binding.md.
//
//      npx tsx --tsconfig tsconfig.scripts.json scripts/test-kontovej.ts
// ═══════════════════════════════════════════════════════════════

import http from 'node:http'
import { NextRequest } from 'next/server'
import {
  F_PARAM, INTERNE_MAAL, KONTEKSTER, KVITTERINGER, KVITTERINGSCOOKIE,
  KVITTERINGSSEK, K_PARAM, LINKFEJL, STANDARDKONTEKST,
  callbackUrl, kontekstFra, vejFor,
} from '../lib/kontovej'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

// ─── GoTrue-efterligningen ─────────────────────────────────────

const tilstand = {
  /** Skal /token?grant_type=pkce afvise? Dækker ugyldig, udløbet og brugt. */
  vekslingFejler: false,
  /** Læg sessionen udløbet, så getUser() udløser en fornyelse. */
  udloebSek: 3600,
  /** Riv forbindelsen over midt i svaret — et netværksudfald. */
  netvaerksfejl: false,
}
const kald: string[] = []

const server = http.createServer((req, res) => {
  let krop = ''
  req.on('data', (c) => { krop += c })
  req.on('end', () => {
    const sti = req.url ?? ''
    kald.push(`${req.method} ${sti.split('?')[0]}${sti.includes('grant_type=') ? '?' + sti.split('grant_type=')[1] : ''}`)
    if (tilstand.netvaerksfejl) return res.destroy()
    res.setHeader('content-type', 'application/json')
    if (sti.includes('/signup')) return res.end(JSON.stringify({ id: 'u1', email: 'en@proeve.invalid' }))
    if (sti.includes('/user')) {
      return res.end(JSON.stringify({ id: 'u1', email: 'en@proeve.invalid', aud: 'authenticated' }))
    }
    if (sti.includes('grant_type=pkce') && tilstand.vekslingFejler) {
      res.statusCode = 403
      return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'code expired or already used' }))
    }
    res.end(JSON.stringify({
      access_token: `AT${kald.length}`, refresh_token: `RT${kald.length}`,
      expires_in: tilstand.udloebSek, token_type: 'bearer',
      user: { id: 'u1', email: 'en@proeve.invalid', aud: 'authenticated' },
    }))
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const PORT = (server.address() as { port: number }).port

// Miljøet SKAL stå, før modulerne indlæses: lib/supabase-klient.ts læser
// process.env paa modulniveau, praecis som i produktion.
const BASE = 'https://proeve.invalid'
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${PORT}`
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kun_til_proever'
process.env.NEXT_PUBLIC_BASE_URL = BASE

const { AUTHCOOKIE, harAuthCookie, klientMed } = await import('../lib/supabase-klient')
const { GET } = await import('../app/auth/callback/route')
const { middleware } = await import('../middleware')

/** SESSIONSCOOKIEN hedder sb-<vaert>-auth-token; her er vaerten 127.0.0.1. */
const SESSION = 'sb-127-auth-token'

/** En browsers cookiekrukke. */
type Krukke = Map<string, string>
const klientFor = (krukke: Krukke, skrevet?: string[]) => klientMed({
  getAll: () => [...krukke].map(([name, value]) => ({ name, value })),
  setAll: (sat) => { for (const c of sat) { krukke.set(c.name, c.value); skrevet?.push(c.name) } },
})

/**
 * En krukke, hvor SDK'et selv har lagt en aegte PKCE-verifier — praecis
 * som `tilmeld()` goer det, naar hun trykker «Opret konto».
 */
async function medVerifier(): Promise<Krukke> {
  const krukke: Krukke = new Map()
  await klientFor(krukke).auth.signUp({
    email: 'en@proeve.invalid',
    password: 'et-langt-kodeord',
    options: { emailRedirectTo: callbackUrl(BASE, 'bolig') },
  })
  return krukke
}

const req = (sti: string, krukke: Krukke | Record<string, string> = {}) => {
  const r = new NextRequest(new URL(sti, BASE))
  const par = krukke instanceof Map ? [...krukke] : Object.entries(krukke)
  for (const [n, v] of par) r.cookies.set(n, v)
  return r
}

function nulstil(t: Partial<typeof tilstand> = {}) {
  Object.assign(tilstand, { vekslingFejler: false, udloebSek: 3600, netvaerksfejl: false }, t)
  kald.length = 0
}

// ═══ 1 · Destinationen pr. kontekst ═════════════════════════════
// Fejlen, det hele handler om: en boligsoegende blev sendt til
// udlejersiden af sin egen formular og af sin egen bekraeftelsesmail.
console.log('\n══ 1 · hver kontekst har sit eget mål ══')
tjek('1A · boligsøgende logger ind på Min side', vejFor('bolig').efterLogin === '/min-side')
tjek('1B · udlejer logger ind på Mine annoncer', vejFor('udlejer').efterLogin === '/udlejer/boliger')
tjek('1C · og de to er IKKE det samme', vejFor('bolig').efterLogin !== vejFor('udlejer').efterLogin)
tjek('1D · logud fører hver sit sted hen',
  vejFor('bolig').efterLogud === '/min-side' && vejFor('udlejer').efterLogud === '/udlejer')
tjek('1E · udlejerens linkfejl vises dér, hvor formularen ER',
  vejFor('udlejer').vedLinkfejl === '/udlejer')
{
  // Hvert eneste maal staar i den lukkede liste. Det er dét, der goer et
  // aabent redirect umuligt: der er ingen vej fra en klientvaerdi til en
  // adresse, der ikke staar i lib/kontovej.ts.
  const alle = KONTEKSTER.flatMap((k) => Object.values(vejFor(k)))
  tjek(`1F · alle ${alle.length} mål står i INTERNE_MAAL`,
    alle.every((m) => (INTERNE_MAAL as readonly string[]).includes(m)))
  tjek('1G · og ingen er absolut eller protokolrelativ',
    alle.every((m) => m.startsWith('/') && !m.startsWith('//')))
}

// ═══ 2 · En klientvaerdi kan ikke pege ud af huset ══════════════
console.log('\n══ 2 · manipulerede mål ══')
for (const ondt of [
  'https://ondsindet.invalid', '//ondsindet.invalid', 'http://proeve.invalid.ondsindet.invalid',
  'javascript:alert(1)', '../../etc/passwd', '%2F%2Fondsindet.invalid', '/udlejer/boliger',
  'BOLIG', ' bolig', '', null, undefined, 42, {}, ['udlejer'],
]) {
  tjek(`2 · ${JSON.stringify(ondt) ?? 'undefined'} → ${kontekstFra(ondt)}`,
    kontekstFra(ondt) === STANDARDKONTEKST)
}
tjek('2Z · standarden er det mindst privilegerede mål', STANDARDKONTEKST === 'bolig')

// ═══ 3 · Bekraeftelseslinkets adresse ═══════════════════════════
console.log('\n══ 3 · det, der står i mailen ══')
{
  const u = new URL(callbackUrl(BASE, 'udlejer'))
  tjek('3A · peger på callback-ruten', u.pathname === '/auth/callback')
  tjek('3B · bærer konteksten', u.searchParams.get(K_PARAM) === 'udlejer')
  tjek('3C · og bliver på vores egen oprindelse', u.origin === BASE)
}

// ═══ 4 · Callbacken · den lykkelige vej ═════════════════════════
console.log('\n══ 4 · gyldig kode, ægte PKCE-veksling ══')
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=udlejer&code=en-gyldig-kode`, await medVerifier()))
  const sted = svar.headers.get('location') ?? ''
  tjek('4A · omdirigerer til konteksten mål', sted === `${BASE}/udlejer/boliger`, sted)
  tjek('4B · koden blev faktisk vekslet hos Auth',
    kald.some((k) => k.includes('pkce')), kald.join(' · '))
  // Kernen i hele opgaven: naaede sessionen ud paa det svar, browseren faar?
  tjek('4C · sessionscookien står på redirect-svaret', Boolean(svar.cookies.get(SESSION)?.value))
  tjek('4D · svaret caches ikke', (svar.headers.get('cache-control') ?? '').includes('no-store'))
  tjek('4E · hverken kode eller token i Location',
    !sted.includes('en-gyldig-kode') && !sted.includes('AT'))
}
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=k`, await medVerifier()))
  tjek('4F · boligsøgende lander på Min side', svar.headers.get('location') === `${BASE}/min-side`)
  tjek('4G · og med en session', Boolean(svar.cookies.get(SESSION)?.value))
}
{
  nulstil()
  const svar = await GET(req('/auth/callback?code=k', await medVerifier()))
  tjek('4H · uden kontekst bruges standarden', svar.headers.get('location') === `${BASE}/min-side`)
}

// ═══ 5 · Callbacken · fejlvejene ════════════════════════════════
// Fem aarsager, brugeren ikke kan skelne — og heller ikke behoever.
// Ingen af dem maa give en 500 eller en loekke.
console.log('\n══ 5 · manglende, ugyldig, brugt, udløbet eller fremmed browser ══')
{
  const sager: [string, string, Krukke, Partial<typeof tilstand>][] = [
    ['5A · ingen code overhovedet', `/auth/callback?${K_PARAM}=bolig`, new Map(), {}],
    ['5B · tom code', `/auth/callback?${K_PARAM}=bolig&code=`, new Map(), {}],
    ['5C · PKCE-verifieren mangler (åbnet i en anden browser)',
      `/auth/callback?${K_PARAM}=bolig&code=x`, new Map(), {}],
    ['5D · Auth afviser koden (udløbet eller brugt)',
      `/auth/callback?${K_PARAM}=bolig&code=x`, await medVerifier(), { vekslingFejler: true }],
    ['5E · Auth-serveren river forbindelsen over',
      `/auth/callback?${K_PARAM}=bolig&code=x`, await medVerifier(), { netvaerksfejl: true }],
  ]
  for (const [navn, sti, krukke, t] of sager) {
    nulstil(t)
    let svar: Awaited<ReturnType<typeof GET>> | null = null
    let kastede = false
    try { svar = await GET(req(sti, krukke)) } catch { kastede = true }
    const sted = svar?.headers.get('location') ?? ''
    tjek(navn, !kastede && sted === `${BASE}/min-side?${LINKFEJL}=1`,
      kastede ? 'KASTEDE' : sted)
  }
}
{
  nulstil({ vekslingFejler: true })
  const svar = await GET(req(`/auth/callback?${K_PARAM}=udlejer&code=x`, await medVerifier()))
  tjek('5F · udlejerens fejl lander på /udlejer, ikke bag et redirect',
    svar.headers.get('location') === `${BASE}/udlejer?${LINKFEJL}=1`)
}
{
  nulstil({ vekslingFejler: true })
  const svar = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=hemmelig-kode-42`, await medVerifier()))
  // Kun sti og parametre proeves — testvaerten hedder «proeve.invalid»,
  // og et moenster paa hele URL'en ville ramme dens eget navn.
  const u = new URL(svar.headers.get('location') ?? '', BASE)
  const baerer = u.pathname + u.search
  tjek('5G · hverken kode eller Auth-fejltekst i redirect\'et',
    !baerer.includes('hemmelig-kode-42') && !/invalid|expired|grant|error/i.test(baerer), baerer)
  tjek('5G2 · og der er præcis ét fast parameter med', [...u.searchParams].length === 1
    && u.searchParams.get(LINKFEJL) === '1')
  tjek('5H · og ingen session sat på en fejlet veksling', svar.cookies.get(SESSION) === undefined)
}
tjek('5I · ingen fejlvej peger tilbage på callbacken',
  KONTEKSTER.every((k) => !vejFor(k).vedLinkfejl.startsWith('/auth/callback')))

// ═══ 6 · Genkendelsen af en session ═════════════════════════════
// Rammer moenstret ved siden af, fornyes sessionen aldrig — og det ville
// vise sig som en bruger, der bliver logget ud uden grund.
// ═══ 5B · Kvitteringen for bekraeftelsen ════════════════════════
//
// ═══ HVAD DEN ER, OG HVAD DEN IKKE ER ═══
//
// Vekslingen er det eneste sted, hvor bekraeftelsen faktisk er
// verificeret. Siden laengere fremme ser kun en session — og en session
// har hun ogsaa dagen efter. Derfor saettes kvitteringen HER, af
// serveren, som en HttpOnly-cookie, og ikke af en parameter, nogen kan
// skrive i adresselinjen.
//
// Den siger KUN, at bekraeftelsen gik igennem. Den siger ikke hvem, og
// den aabner ingenting: siderne spoerger stadig Auth-serveren selv.
console.log('\n══ 5B · kvitteringen efter en verificeret bekræftelse ══')
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=k`, await medVerifier()))
  const k = svar.cookies.get(KVITTERINGSCOOKIE)
  tjek('5B-A · en gennemført veksling sætter kvitteringen',
    k?.value === 'bekraeftet', String(k?.value))
  tjek('5B-B · den er HttpOnly — ingen skal kunne skrive den fra en konsol',
    k?.httpOnly === true)
  tjek('5B-C · og lever kun kort', k?.maxAge === KVITTERINGSSEK, String(k?.maxAge))
  tjek('5B-D · værdien er ét af de kendte ord og bærer intet om hvem',
    (KVITTERINGER as readonly string[]).includes(k?.value ?? '')
    && !/@|proeve\.invalid|u1/.test(k?.value ?? ''))
}
{
  // Gendannelseslinket gaar til «Vaelg ny adgangskode». Den bruger har
  // haft kontoen laenge, og «Velkommen til BOFINDA» ville vaere forkert.
  nulstil()
  const svar = await GET(req(
    `/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan&code=k`, await medVerifier()))
  tjek('5B-E · gendannelsen fører til sit eget forløb',
    svar.headers.get('location') === `${BASE}/nulstil?${K_PARAM}=bolig`,
    svar.headers.get('location') ?? '')
  tjek('5B-F · og sætter INGEN bekræftelseskvittering',
    svar.cookies.get(KVITTERINGSCOOKIE) === undefined,
    String(svar.cookies.get(KVITTERINGSCOOKIE)?.value))
}
{
  // Kunne linket ikke veksles, er der intet at kvittere for. Siden siger
  // det ligeud i stedet for at byde velkommen.
  nulstil({ vekslingFejler: true })
  const svar = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=k`, await medVerifier()))
  tjek('5B-G · en mislykket veksling giver ingen kvittering',
    svar.cookies.get(KVITTERINGSCOOKIE) === undefined)
  tjek('5B-H · og fører til fejlbeskeden',
    (svar.headers.get('location') ?? '').includes(LINKFEJL))
  nulstil()
  const uden = await GET(req(`/auth/callback?${K_PARAM}=bolig`))
  tjek('5B-I · ingen kode, ingen kvittering',
    uden.cookies.get(KVITTERINGSCOOKIE) === undefined)
}

console.log('\n══ 6 · hvad der tæller som en auth-cookie ══')
tjek('6A · hel cookie', AUTHCOOKIE.test('sb-prgmenbwabwkgitjclrj-auth-token'))
tjek('6B · delt cookie .0', AUTHCOOKIE.test('sb-prgmenbwabwkgitjclrj-auth-token.0'))
tjek('6C · delt cookie .1', AUTHCOOKIE.test('sb-prgmenbwabwkgitjclrj-auth-token.1'))
tjek('6D · og den, SDK\'et faktisk skrev her', AUTHCOOKIE.test(SESSION))
tjek('6E · vores egne cookies tæller ikke med',
  !harAuthCookie(['bofinda_samtykke', 'bofinda_aid', 'bofinda_sid', 'bofinda_forsoeg']))

// ═══ 7 · Login virker UDEN statistiksamtykke ════════════════════
// Den vigtigste raekke i filen. Laa fornyelsen bag samtykket, ville
// «kun det noedvendige» vaere blevet til en adgangsspaerring.
console.log('\n══ 7 · auth er uafhængig af samtykke ══')
for (const [navn, samtykke] of [
  ['7A · uden noget valg truffet', null],
  ['7B · med et udtrykkeligt NEJ', 'nej'],
  ['7C · med et ja', 'ja'],
] as const) {
  nulstil({ udloebSek: -100 })          // udloebet session ⇒ skal fornyes
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const c: Record<string, string> = Object.fromEntries(krukke)
  if (samtykke) c['bofinda_samtykke'] = samtykke
  kald.length = 0
  const svar = await middleware(req('/min-side', c))
  tjek(navn,
    kald.some((k) => k.includes('refresh_token')) && Boolean(svar.cookies.get(SESSION)),
    kald.join(' · ') || 'ingen kald')
}
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side',
    { ...Object.fromEntries(krukke), bofinda_samtykke: 'nej' }))
  tjek('7D · og et nej sætter stadig ingen analytics-cookies',
    !svar.cookies.get('bofinda_aid') && !svar.cookies.get('bofinda_sid'))
}

// ═══ 8 · De to slags cookies taber ikke hinanden ════════════════
console.log('\n══ 8 · analytics og auth på det samme svar ══')
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side',
    { ...Object.fromEntries(krukke), bofinda_samtykke: 'ja' }))
  tjek('8A · den fornyede session er der', Boolean(svar.cookies.get(SESSION)))
  tjek('8B · analytics-sessionen er der også', Boolean(svar.cookies.get('bofinda_sid')))
  tjek('8C · og det anonyme id blev sat', Boolean(svar.cookies.get('bofinda_aid')))
}
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side', Object.fromEntries(krukke)))
  tjek('8D · auth alene skaber ingen analytics-cookies',
    !svar.cookies.get('bofinda_sid') && !svar.cookies.get('bofinda_aid'))
}
{
  // Et bestaaende anonymt id maa ikke skifte, fordi auth ogsaa skrev.
  const AID = '11111111-1111-4111-8111-111111111111'
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side',
    { ...Object.fromEntries(krukke), bofinda_samtykke: 'ja', bofinda_aid: AID }))
  const sat = svar.cookies.get('bofinda_aid')
  tjek('8E · et bestående anonymt id bevares urørt', !sat || sat.value === AID)
  tjek('8F · og sessionen fornyes ved siden af', Boolean(svar.cookies.get('bofinda_sid')))
}

// ═══ 9 · Naar der IKKE skal fornyes ═════════════════════════════
// Hvert sparet kald er et netvaerkskald til Auth pr. sidevisning.
console.log('\n══ 9 · ingen session, intet kald ══')
{
  nulstil()
  await middleware(req('/lejeboliger/2300', { bofinda_samtykke: 'ja' }))
  tjek('9A · anonym visning koster intet Auth-kald', kald.length === 0, kald.join(' · '))
}
{
  nulstil()
  await middleware(req('/api/maaling', { [SESSION]: 'noget' }))
  tjek('9B · målingsbeaconet fornyer ikke', kald.length === 0, kald.join(' · '))
}
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  kald.length = 0
  await middleware(req('/min-side', Object.fromEntries(krukke)))
  tjek('9C · men en logget ind sidevisning gør', kald.length > 0, kald.join(' · '))
}
{
  // Et Auth-udfald maa ikke vaelte en offentlig side.
  nulstil({ netvaerksfejl: true })
  let kastede = false
  try { await middleware(req('/min-side', { [SESSION]: 'noget' })) } catch { kastede = true }
  tjek('9D · et Auth-udfald kaster ikke ind i sidevisningen', !kastede)
}

// ═══ 9B · SDK'ets cache-headere skal NAA SVARET ════════════════
//
// @supabase/ssr giver setAll et ANDET argument: de headere, svaret skal
// baere, naar det saetter auth-cookies. Vi tog kun imod cookierne.
//
// Hvorfor det er en blocker og ikke en formalitet: et svar med
// Set-Cookie paa en sessionscookie, der havner i en CDN eller en omvendt
// proxy, kan udleveres til den NAESTE bruger. Vercel Edge, CloudFront og
// Cloudflare ligger alle paa den vej.
//
// Proeven maaler det RIGTIGE middleware-svar efter en aegte fornyelse
// gennem det installerede SDK — ikke en hjaelpefunktion, der kopierer
// headere.
console.log('\n══ 9B · cachebeskyttelsen følger med ud på svaret ══')
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  kald.length = 0
  const svar = await middleware(req('/min-side', Object.fromEntries(krukke)))

  // Auth-cookien for sig. En analytics-cookie er ikke bevis for, at der
  // blev fornyet noget som helst.
  const fornyet = svar.cookies.get(SESSION)
  tjek('9B-1 · sessionscookien er faktisk fornyet',
    Boolean(fornyet?.value) && kald.some((k) => k.includes('refresh_token')),
    kald.join(' · ') || 'ingen kald')

  // Ordret det, SDK'et leverer i 0.12.5. Staar der noget andet, er
  // kontrakten skiftet, og det skal ses — ikke glattes ud.
  const forventet: Record<string, string> = {
    'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0',
    expires: '0',
    pragma: 'no-cache',
  }
  for (const [navn, vaerdi] of Object.entries(forventet)) {
    tjek(`9B · ${navn} videreført ordret`, svar.headers.get(navn) === vaerdi,
      svar.headers.get(navn) ?? 'MANGLER')
  }

  // Og svaret maa ikke samtidig love det modsatte.
  const cc = svar.headers.get('cache-control') ?? ''
  tjek('9B · svaret annoncerer ikke offentlig eller delt caching',
    !/\bpublic\b|\bs-maxage\b/.test(cc), cc)

  // Det aktuelle server-request skal se den fornyede session, ellers
  // renderer siden paa den udloebne.
  tjek('9B · det aktuelle request ser den fornyede cookie',
    Boolean(svar.headers.get('x-middleware-override-headers')))
}
{
  // Samtykke maa ikke aendre noget af det.
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side',
    { ...Object.fromEntries(krukke), bofinda_samtykke: 'ja' }))
  tjek('9B · med samtykke: både auth-cookie, analytics-cookie og headere',
    Boolean(svar.cookies.get(SESSION)) && Boolean(svar.cookies.get('bofinda_sid'))
    && svar.headers.get('expires') === '0')
}
{
  nulstil({ udloebSek: -100 })
  const krukke = await medVerifier()
  await klientFor(krukke).auth.exchangeCodeForSession('k')
  const svar = await middleware(req('/min-side',
    { ...Object.fromEntries(krukke), bofinda_samtykke: 'nej' }))
  tjek('9B · uden statistik-samtykke: fornyelse OG beskyttelse alligevel',
    Boolean(svar.cookies.get(SESSION)) && svar.headers.get('pragma') === 'no-cache')
}
{
  // ═══ DEN ANDEN HALVDEL AF RETTELSEN ═══
  // Beskyttelsen hoerer til de svar, der baerer en sessionscookie. Blev
  // den sat ubetinget, ville hver eneste anonyme visning af en
  // omraadeside blive ucachebar — og det er de sider, der er flest af.
  nulstil()
  const svar = await middleware(req('/lejeboliger/2300', { bofinda_samtykke: 'ja' }))
  tjek('9B · en anonym request får INGEN ny cachebegrænsning',
    svar.headers.get('cache-control') === null && svar.headers.get('pragma') === null
    && svar.headers.get('expires') === null,
    `cc=${svar.headers.get('cache-control')} pragma=${svar.headers.get('pragma')}`)
  tjek('9B · og den kostede stadig intet Auth-kald', kald.length === 0)
}

// ═══ 10 · Bruger handlingerne bordet — eller deres egen mening? ═══
//
// STRUKTUREL, ikke adfaerdsmaessig. `login()`, `logUd()` og `tilmeld()`
// kan ikke kaldes herfra: de gaar gennem `cookies()` fra next/headers,
// som kun findes inde i en Next-request. Prøven laeser derfor kilden.
//
// Det er ikke pynt. Fejlen, hele opgaven handler om, var netop et
// hardkodet maal i de tre funktioner — `redirect('/udlejer/boliger')` og
// `emailRedirectTo: ${base}/udlejer`. Uden det her kan praecis den fejl
// komme tilbage, uden at et eneste af de 63 tjek ovenfor bliver roedt.
console.log('\n══ 10 · destinationen hentes i bordet, ikke skrevet i handlingen ══')
{
  const { readFileSync } = await import('node:fs')
  const kilde = readFileSync(new URL('../app/udlejer/handlinger.ts', import.meta.url), 'utf8')
  const krop = (navn: string): string => {
    const start = kilde.indexOf(`export async function ${navn}(`)
    if (start < 0) return ''
    // Til naeste toplinjes `export ` eller filens slutning.
    const efter = kilde.indexOf('\nexport ', start + 1)
    return kilde.slice(start, efter < 0 ? undefined : efter)
  }
  for (const navn of ['login', 'logUd'] as const) {
    const k = krop(navn)
    tjek(`10 · ${navn}() henter målet i vejFor()`, k.includes('vejFor(kontekst)'), k ? '' : 'FUNKTIONEN BLEV IKKE FUNDET')
    const hardkodet = k.match(/redirect\(\s*['"`]\//)
    tjek(`10 · ${navn}() omdirigerer ikke til en skrevet sti`, hardkodet === null,
      hardkodet ? hardkodet[0] : '')
  }
  const t = krop('tilmeld')
  tjek('10 · tilmeld() bygger bekræftelseslinket med callbackUrl()', t.includes('callbackUrl(base, kontekst)'))
  tjek('10 · tilmeld() peger ikke på en skrevet side',
    !/emailRedirectTo:\s*`?\$?\{?[^}]*\/udlejer/.test(t))
  tjek('10 · alle tre validerer konteksten med kontekstFra()',
    ['login', 'logUd', 'tilmeld'].every((n) => krop(n).includes('kontekstFra(k)')))
}

server.close()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
