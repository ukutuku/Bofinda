// ═══════════════════════════════════════════════════════════════
//  Glemt adgangskode: linket, vekslingen, kravet og vagten.
//
//  ═══ HVOR ATTRAPPEN SIDDER ═══
//
//  Samme sted som i test-kontovej.ts: på HTTP-grænsen ud til
//  Auth-tjenesten, ikke på SDK'et. @supabase/ssr laver derfor sin egen
//  PKCE-verifier ved `resetPasswordForEmail`, og vores egen
//  callback-rute og målbord er dem, der kører.
//
//  ⚠ DET ER IKKE EN E2E-PRØVE. Efterligningen svarer, som vi TROR
//  GoTrue svarer. At Supabase faktisk sender recovery-mailen, og at
//  linket lander som her, kan kun afgøres i et rigtigt Auth-miljø.
//
//  De to server actions kalder `redirect()` og `revalidatePath()` og
//  kan ikke køres uden for en Next-request. Deres SIKKERHEDSEGENSKABER
//  prøves derfor på kilden — samme greb som sektion 10 i
//  test-kontovej.ts. Det står udtrykkeligt ved hver enkelt, så ingen
//  tror, de er kørt.
//
//      npx tsx --tsconfig tsconfig.scripts.json scripts/test-gendannelse.ts
// ═══════════════════════════════════════════════════════════════

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import {
  FORLOEB, INTERNE_MAAL, KONTEKSTER, K_PARAM, F_PARAM, KVITTERINGER, LINKFEJL,
  STANDARDFORLOEB, callbackUrl, forloebFra, gendanUrl, kontekstFra,
  kvitteringFra, vejFor,
} from '../lib/kontovej'
import { FOR_KORT, IKKE_ENS, MINDST_TEGN, tjekAdgangskode } from '../lib/adgangskode'

let fejl = 0
function tjek(navn: string, ok: boolean, note = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

// ─── GoTrue-efterligningen ─────────────────────────────────────

const tilstand = { vekslingFejler: false, ingenBruger: false }
const kald: string[] = []

const server = http.createServer((req, res) => {
  let krop = ''
  req.on('data', (c) => { krop += c })
  req.on('end', () => {
    const sti = req.url ?? ''
    kald.push(`${req.method} ${sti.split('?')[0]}`)
    res.setHeader('content-type', 'application/json')
    if (sti.includes('/recover')) return res.end(JSON.stringify({}))
    if (sti.includes('/logout')) { res.statusCode = 204; return res.end() }
    if (sti.includes('/user')) {
      if (tilstand.ingenBruger) { res.statusCode = 401; return res.end(JSON.stringify({ msg: 'invalid claim' })) }
      return res.end(JSON.stringify({ id: 'u1', email: 'en@proeve.invalid', aud: 'authenticated' }))
    }
    if (sti.includes('grant_type=pkce') && tilstand.vekslingFejler) {
      res.statusCode = 403
      return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'code expired or already used' }))
    }
    res.end(JSON.stringify({
      access_token: `AT${kald.length}`, refresh_token: `RT${kald.length}`,
      expires_in: 3600, token_type: 'bearer',
      user: { id: 'u1', email: 'en@proeve.invalid', aud: 'authenticated' },
    }))
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
const PORT = (server.address() as { port: number }).port

const BASE = 'https://proeve.invalid'
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${PORT}`
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kun_til_proever'
process.env.NEXT_PUBLIC_BASE_URL = BASE

const { klientMed } = await import('../lib/supabase-klient')
const { GET } = await import('../app/auth/callback/route')

type Krukke = Map<string, string>
const klientFor = (krukke: Krukke) => klientMed({
  getAll: () => [...krukke].map(([name, value]) => ({ name, value })),
  setAll: (sat) => { for (const c of sat) krukke.set(c.name, c.value) },
})

/**
 * En krukke, hvor SDK'et selv har lagt en ægte PKCE-verifier — præcis
 * som `anmodGendannelse()` gør, når hun beder om linket.
 */
async function medGendanVerifier(k: 'bolig' | 'udlejer' = 'bolig'): Promise<Krukke> {
  const krukke: Krukke = new Map()
  await klientFor(krukke).auth.resetPasswordForEmail('en@proeve.invalid', {
    redirectTo: gendanUrl(BASE, k),
  })
  return krukke
}

const req = (sti: string, krukke: Krukke = new Map()) => {
  const r = new NextRequest(new URL(sti, BASE))
  for (const [n, v] of krukke) r.cookies.set(n, v)
  return r
}
const nulstil = (t: Partial<typeof tilstand> = {}) => {
  Object.assign(tilstand, { vekslingFejler: false, ingenBruger: false }, t)
  kald.length = 0
}

// ═══ 1 · Bordet kender gendannelsens to sider ═══════════════════
console.log('\n══ 1 · målene står i den lukkede liste ══')
{
  const alle = KONTEKSTER.flatMap((k) => Object.values(vejFor(k)))
  tjek(`1A · alle ${alle.length} mål står i INTERNE_MAAL`,
    alle.every((m) => (INTERNE_MAAL as readonly string[]).includes(m)))
  tjek('1B · og ingen er absolut eller protokolrelativ',
    alle.every((m) => m.startsWith('/') && !m.startsWith('//')))
  tjek('1C · begge kontekster ender samme sted ved gendannelse',
    vejFor('bolig').efterGendannelse === '/nulstil'
    && vejFor('udlejer').efterGendannelse === '/nulstil')
  tjek('1D · og fejlen fører tilbage til anmodningen, ikke til log ind',
    KONTEKSTER.every((k) => vejFor(k).vedGendannelsesfejl === '/glemt'))
  tjek('1E · gendannelsesfejl er IKKE det samme som bekræftelsesfejl',
    KONTEKSTER.every((k) => vejFor(k).vedGendannelsesfejl !== vejFor(k).vedLinkfejl))
}

// ═══ 2 · Forloebsordet kan ikke pege ud af huset ════════════════
console.log('\n══ 2 · manipuleret forløb ══')
for (const ondt of [
  'https://ondsindet.invalid', '//ondsindet.invalid', 'javascript:alert(1)',
  '../../etc/passwd', 'GENDAN', ' gendan', '', null, undefined, 42, {}, ['gendan'],
]) {
  tjek(`2 · ${JSON.stringify(ondt) ?? 'undefined'} → ${forloebFra(ondt)}`,
    forloebFra(ondt) === STANDARDFORLOEB)
}
tjek('2Z · standarden er bekræftelsen, så gamle links opfører sig som før',
  STANDARDFORLOEB === 'bekraeft' && FORLOEB.length === 2)

// ═══ 3 · Det, der staar i gendannelsesmailen ════════════════════
console.log('\n══ 3 · linkets adresse ══')
{
  const u = new URL(gendanUrl(BASE, 'udlejer'))
  tjek('3A · peger på callback-ruten', u.pathname === '/auth/callback')
  tjek('3B · bærer konteksten', u.searchParams.get(K_PARAM) === 'udlejer')
  tjek('3C · bærer forløbet', u.searchParams.get(F_PARAM) === 'gendan')
  tjek('3D · og bliver på vores egen oprindelse', u.origin === BASE)
  tjek('3E · adskiller sig fra bekræftelseslinket',
    gendanUrl(BASE, 'bolig') !== callbackUrl(BASE, 'bolig'))
}

// ═══ 4 · Den lykkelige vej · aegte PKCE-veksling ════════════════
console.log('\n══ 4 · gyldigt gendannelseslink ══')
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan&code=en-gyldig-kode`,
    await medGendanVerifier('bolig')))
  const sted = svar.headers.get('location') ?? ''
  tjek('4A · fører til «Vælg ny adgangskode»', sted === `${BASE}/nulstil?${K_PARAM}=bolig`, sted)
  tjek('4B · koden blev faktisk vekslet hos Auth',
    kald.some((k) => k.includes('/token')), kald.join(' · '))
  tjek('4C · sessionscookien står på redirect-svaret',
    [...svar.cookies.getAll()].some((c) => /^sb-.+-auth-token/.test(c.name)))
  tjek('4D · svaret caches ikke', (svar.headers.get('cache-control') ?? '').includes('no-store'))
  tjek('4E · hverken kode eller token i Location',
    !sted.includes('en-gyldig-kode') && !sted.includes('AT'))
}
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=udlejer&${F_PARAM}=gendan&code=k`,
    await medGendanVerifier('udlejer')))
  tjek('4F · udlejerens kontekst bæres med til nulstillingen',
    svar.headers.get('location') === `${BASE}/nulstil?${K_PARAM}=udlejer`)
}

// ═══ 5 · Ugyldigt, brugt, udloebet, fremmed browser ═════════════
console.log('\n══ 5 · linket duer ikke ══')
{
  const sager: [string, string, Krukke, Partial<typeof tilstand>][] = [
    ['5A · ingen code', `/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan`, new Map(), {}],
    ['5B · tom code', `/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan&code=`, new Map(), {}],
    ['5C · udløbet eller allerede brugt', `/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan&code=k`,
      await medGendanVerifier(), { vekslingFejler: true }],
    ['5D · åbnet i en anden browser (ingen verifier)',
      `/auth/callback?${K_PARAM}=bolig&${F_PARAM}=gendan&code=k`, new Map(), {}],
  ]
  for (const [navn, sti, krukke, t] of sager) {
    nulstil(t)
    const svar = await GET(req(sti, krukke))
    const sted = svar.headers.get('location') ?? ''
    tjek(navn, sted === `${BASE}/glemt?${LINKFEJL}=1&${K_PARAM}=bolig`, sted)
  }
  nulstil({ vekslingFejler: true })
  const svar = await GET(req(`/auth/callback?${K_PARAM}=udlejer&${F_PARAM}=gendan&code=k`,
    await medGendanVerifier('udlejer')))
  tjek('5E · konteksten overlever fejlvejen',
    svar.headers.get('location') === `${BASE}/glemt?${LINKFEJL}=1&${K_PARAM}=udlejer`)
  tjek('5F · ingen session på et mislykket forsøg',
    ![...svar.cookies.getAll()].some((c) => /^sb-.+-auth-token/.test(c.name) && c.value))
}

// ═══ 6 · REGRESSION · signup-callbacken er uroert ═══════════════
// Uden `f` skal ruten opfoere sig NOEJAGTIG som foer aendringen.
console.log('\n══ 6 · bekræftelseslinket virker som før ══')
{
  nulstil()
  const svar = await GET(req(`/auth/callback?${K_PARAM}=udlejer&code=k`, await medGendanVerifier('udlejer')))
  tjek('6A · uden f= lander udlejeren på Mine annoncer',
    svar.headers.get('location') === `${BASE}/udlejer/boliger`)
  nulstil()
  const b = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=k`, await medGendanVerifier()))
  tjek('6B · uden f= lander den boligsøgende på Min side',
    b.headers.get('location') === `${BASE}/min-side`)
  nulstil({ vekslingFejler: true })
  const f2 = await GET(req(`/auth/callback?${K_PARAM}=bolig&code=k`, await medGendanVerifier()))
  tjek('6C · og fejlvejen er stadig den gamle',
    f2.headers.get('location') === `${BASE}/min-side?${LINKFEJL}=1`)
  nulstil()
  const u = await GET(req(`/auth/callback?${K_PARAM}=bolig&${F_PARAM}=vroevl&code=k`, await medGendanVerifier()))
  tjek('6D · et ukendt forløb falder tilbage til bekræftelsen',
    u.headers.get('location') === `${BASE}/min-side`)
}

// ═══ 7 · Kravet til adgangskoden ════════════════════════════════
console.log('\n══ 7 · valideringen ══')
{
  const lang = 'a'.repeat(MINDST_TEGN)
  tjek('7A · for kort afvises', tjekAdgangskode('kort') === FOR_KORT)
  tjek('7B · præcis på grænsen godtages', tjekAdgangskode(lang) === null)
  tjek('7C · tom afvises', tjekAdgangskode('') === FOR_KORT)
  tjek('7D · uens gentagelse afvises', tjekAdgangskode(lang, lang + 'x') === IKKE_ENS)
  tjek('7E · ens gentagelse godtages', tjekAdgangskode(lang, lang) === null)
  tjek('7F · for kort siges FØR uens', tjekAdgangskode('kort', 'andet') === FOR_KORT)
  tjek('7G · uden gentagelse prøves kun længden', tjekAdgangskode(lang, undefined) === null)
}
{
  // Kravet maa findes ÉT sted. Se CLAUDE.md om to udtryk for ét spoergsmaal.
  const h = readFileSync(new URL('../app/udlejer/handlinger.ts', import.meta.url), 'utf8')
  tjek('7H · tilmeld() har ikke sit eget længdetal',
    !/kode\.length\s*<\s*\d+/.test(h), 'hardkodet længde fundet')
  tjek('7I · begge handlinger bruger tjekAdgangskode()',
    (h.match(/tjekAdgangskode\(/g) ?? []).length >= 2)
}

// ═══ 8 · Hvad der autoriserer aendringen ════════════════════════
// KILDEKONTROL, ikke koert kode: begge actions kalder redirect() og kan
// ikke koeres uden for en Next-request.
console.log('\n══ 8 · kilden til gemNyKode() (kildekontrol, ikke kørt) ══')
{
  const kilde = readFileSync(new URL('../app/udlejer/handlinger.ts', import.meta.url), 'utf8')
  const krop = (navn: string): string => {
    const start = kilde.indexOf(`export async function ${navn}(`)
    if (start < 0) return ''
    const efter = kilde.indexOf('\nexport ', start + 1)
    return kilde.slice(start, efter < 0 ? undefined : efter)
  }
  /**
   * Kilden UDEN kommentarer.
   *
   * En prøve, der leder i prosaen, måler det forkerte: ordet «findes
   * ikke» står i en kommentar om, hvorfor svaret er neutralt — og ville
   * få en korrekt funktion til at fejle.
   */
  const udenKommentarer = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  const g = udenKommentarer(krop('gemNyKode'))
  tjek('8A · funktionen findes', g.length > 0)
  tjek('8B · identiteten hentes med getUser(), ikke getSession()',
    g.includes('auth.getUser()') && !g.includes('getSession'))
  tjek('8C · ingen mail eller bruger-id fra formularen',
    !/f\.get\(\s*['"](mail|id|user_id|bruger|email)['"]\s*\)/.test(g))
  tjek('8D · kun kode og gentagelse læses fra formularen',
    (g.match(/f\.get\(/g) ?? []).length === 2)
  tjek('8E · koden skiftes med updateUser()', g.includes('auth.updateUser({ password:'))
  tjek('8F · sessionen lukkes efter skiftet', g.includes('auth.signOut()'))
  tjek('8G · og logud sker EFTER updateUser, ikke før',
    g.indexOf('updateUser') < g.indexOf('signOut'))
  tjek('8H · kvitteringen sættes efter kaldet, så succes ikke kan vises for tidligt',
    g.indexOf('updateUser') < g.indexOf('KVITTERINGSCOOKIE'))
  tjek('8H3 · udfaldet af signOut aflæses, ikke ignoreret',
    /signOut\(\)[\s\S]{0,120}kvittering = 'skiftet-uden-logud'/.test(g))
  tjek('8H4 · og et kast fra signOut giver samme delvise udfald',
    (g.match(/skiftet-uden-logud/g) ?? []).length >= 2)
  tjek('8H5 · getUser og updateUser er begge omgivet af try',
    (g.match(/try \{/g) ?? []).length >= 3)
  tjek('8H2 · og der returneres intet «det lykkedes» før kaldet',
    !/besked:/.test(g.slice(0, g.indexOf('updateUser'))))
  tjek('8I · destinationen hentes i bordet', g.includes('vejFor(kontekst)'))
  tjek('8J · ingen skrevet sti i redirect', g.match(/redirect\(\s*['"`]\//) === null)
  tjek('8K · ingen service-role-nøgle i nærheden',
    !/service_role|SERVICE_ROLE|sb_secret_/.test(kilde))

  const a = udenKommentarer(krop('anmodGendannelse'))
  tjek('8L · anmodningen bygger linket med gendanUrl()', a.includes('gendanUrl(base, kontekst)'))
  tjek('8M · og peger ikke på en skrevet side', !/redirectTo:\s*['"`]/.test(a))
  // Neutraliteten maales paa KODEN: ét eneste svar med en besked, og
  // kun to navngivne fejlklasser, der overhovedet kan bryde tavsheden.
  tjek('8N · der findes kun ÉT svar med en besked',
    (a.match(/besked:/g) ?? []).length === 1)
  tjek('8O · og den er den neutrale', a.includes('besked: GENDAN_SENDT'))
  tjek('8P · kun ratebegrænsning og ugyldig adresse bryder tavsheden',
    /klasse === 'for-mange-forsoeg' \|\| klasse === 'ugyldig-mail'/.test(a))
  tjek('8Q · «findes allerede» kan ikke lække fra anmodningen',
    !/findes-allerede/.test(a))
}

// ═══ 8R · Kvitteringen er serverens, ikke adressens ═════════════
console.log('\n══ 8R · kvitteringens grundlag ══')
{
  for (const ondt of ['ja', '1', 'nulstillet', '', null, undefined, 42, {}, ['skiftet']]) {
    tjek(`8R · ${JSON.stringify(ondt) ?? 'undefined'} → ingen kvittering`,
      kvitteringFra(ondt) === null)
  }
  tjek('8R · kun de to kendte udfald godtages',
    KVITTERINGER.every((k) => kvitteringFra(k) === k) && KVITTERINGER.length === 2)
  // Kommentarerne strippes foerst: de FORKLARER, at kvitteringen ikke
  // laengere kommer fra «?nulstillet=1», og en proeve, der leder i
  // prosaen, ville faa en korrekt side til at fejle.
  const renKode = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
  const sider = [
    '../app/udlejer/page.tsx', '../app/min-side/page.tsx',
    // Mine annoncer er den side, en INDLOGGET udlejer faktisk lander paa:
    // /udlejer omdirigerer hende dertil, foer cookien overhovedet laeses.
    '../app/udlejer/boliger/page.tsx',
  ]
  for (const sti of sider) {
    const navn = sti.split('/').slice(-2).join('/')
    const s2 = renKode(readFileSync(new URL(sti, import.meta.url), 'utf8'))
    tjek(`8R · ${navn} læser kvitteringen af en cookie`,
      s2.includes('KVITTERINGSCOOKIE') && s2.includes('kvitteringFra'))
    tjek(`8R · ${navn} bygger den ikke på searchParams`, !/nulstillet/i.test(s2))
  }
}

// ═══ 8S · Kvitteringen naar ogsaa den, der stadig er logget ind ═
//
// ═══ HVAD DER GIK GALT ═══
//
// Kvitteringen stod inde i kontoformularen, og formularen vises kun for
// en, der IKKE er logget ind. Men det udfald, den vigtigste af de to
// beskeder handler om — «koden er skiftet, men udlogningen fejlede» —
// betyder jo netop, at hun STADIG er logget ind. Beskeden kunne altsaa
// ikke naa den eneste, der havde brug for den.
//
// Proeven her er en KILDEKONTROL og maaler kun, at de tre landingssider
// bruger den samme ene visning. At den faktisk STAAR paa skaermen for en
// bundet, indlogget bruger, maales i browseren af
// scripts/test-gendannelse-actions.mjs (scenarie 4 og 4b).
console.log('\n══ 8S · én kvitteringsvisning, brugt alle vegne ══')
{
  const ren = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
  const fil = (sti: string) => ren(readFileSync(new URL(sti, import.meta.url), 'utf8'))

  const blok = fil('../app/udlejer/Kvitteringsblok.tsx')
  tjek('8S-A · visningen findes som én komponent', blok.includes('export function Kvitteringsblok'))
  tjek('8S-B · og kender forskel paa udlogget og indlogget',
    blok.includes("'udlogget'") && blok.includes("'indlogget'"))
  tjek('8S-C · den laeser hverken cookies, database eller session',
    !/next\/headers|db\b|supabase/.test(blok))

  // Teksten maa findes ÉT sted. To kopier driver fra hinanden — se
  // CLAUDE.md om to udtryk for ét spoergsmaal.
  const brugere = [
    '../app/udlejer/Konto.tsx', '../app/min-side/page.tsx',
    '../app/udlejer/boliger/page.tsx',
  ]
  for (const sti of brugere) {
    const navn = sti.split('/').slice(-2).join('/')
    const t = fil(sti)
    tjek(`8S · ${navn} bruger den faelles visning`, t.includes('<Kvitteringsblok'))
    tjek(`8S · ${navn} har ikke sin egen kopi af teksten`,
      !t.includes('Din adgangskode er skiftet'))
  }

  // De to sider, en INDLOGGET bruger kan lande paa, skal bruge
  // «indlogget» — «log ind herunder» ville pege paa en formular, der
  // ikke staar der.
  for (const sti of ['../app/min-side/page.tsx', '../app/udlejer/boliger/page.tsx']) {
    const navn = sti.split('/').slice(-2).join('/')
    tjek(`8S · ${navn} viser den indloggede udgave`,
      /<Kvitteringsblok[^>]*visning="indlogget"/.test(fil(sti)))
  }
  tjek('8S · kontoformularen viser den udloggede udgave',
    /<Kvitteringsblok[^>]*visning="udlogget"/.test(fil('../app/udlejer/Konto.tsx')))

  // Adgangen maa ikke afhaenge af cookien. Paa Mine annoncer staar
  // `hentUdlejer()` og dens redirect FOER kvitteringen laeses.
  //
  // Maalt paa KALDENE, ikke paa navnene: `KVITTERINGSCOOKIE` staar ogsaa
  // i importlinjen oeverst, og et indexOf paa ordet ville pege paa den —
  // altsaa foer alt andet, uanset hvordan funktionen er skrevet.
  const mine = fil('../app/udlejer/boliger/page.tsx')
  const hent = mine.indexOf('await hentUdlejer()')
  const vaern = mine.indexOf("redirect('/udlejer')")
  const laes = mine.indexOf('kvitteringFra(')
  tjek('8S-D · adgangen afgoeres foer kvitteringen laeses',
    hent >= 0 && vaern > hent && laes > vaern, `hent=${hent} vaern=${vaern} laes=${laes}`)
}

// ═══ 8T · De to statusformuleringer ═════════════════════════════
console.log('\n══ 8T · hvad teksterne lover ══')
{
  const kilde = readFileSync(new URL('../app/udlejer/handlinger.ts', import.meta.url), 'utf8')
  const udenKommentarer = kilde
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  // R2 · et mistet svar er et UKENDT udfald, ikke et kendt uaendret et.
  tjek('8T-A · ingen garanti om, at den gamle kode stadig virker',
    !/virker stadig/.test(udenKommentarer))
  tjek('8T-B · teksten siger, at udfaldet er ukendt',
    /Vi kunne ikke bekræfte, om adgangskoden blev ændret/.test(udenKommentarer))
  tjek('8T-C · og peger paa begge veje videre',
    /logge ind med den nye/.test(udenKommentarer) && /gendannelseslink/.test(udenKommentarer))
  // SDK'et RETURNERER et tabt svar som en AuthError i stedet for at kaste.
  // En vagt, der kun sad i catch, ville aldrig fyre paa det udfald.
  tjek('8T-D · den returnerede netvaerksfejl faar samme svar som et kast',
    /AuthRetryableFetchError/.test(udenKommentarer)
    && (udenKommentarer.match(/UKENDT_UDFALD/g) ?? []).length >= 3)
  tjek('8T-E · og skiftet gentages ikke af sig selv',
    (udenKommentarer.match(/auth\.updateUser\(/g) ?? []).length === 1)

  // R3 · ét svar, stadig neutralt, men uden et loefte om levering.
  tjek('8T-F · mailsvaret lover ikke en mail, vi ikke kan staa inde for',
    !/kommer der en mail/.test(udenKommentarer))
  tjek('8T-G · afsendelsen er gjort betinget',
    /kan gennemføres/.test(udenKommentarer))
  tjek('8T-H · og der er stadig kun ÉT svar med en besked',
    (udenKommentarer.match(/besked: GENDAN_SENDT/g) ?? []).length === 1)
}

// ═══ 9 · Siderne aendrer intet ved at blive AABNET ══════════════
console.log('\n══ 9 · ingen ændring på GET ══')
{
  for (const [navn, sti] of [['/nulstil', '../app/nulstil/page.tsx'], ['/glemt', '../app/glemt/page.tsx']] as const) {
    const s = readFileSync(new URL(sti, import.meta.url), 'utf8')
    tjek(`9 · ${navn} kalder ikke updateUser ved rendering`, !s.includes('updateUser'))
    tjek(`9 · ${navn} er force-dynamic`, s.includes("dynamic = 'force-dynamic'"))
    tjek(`9 · ${navn} holdes ude af søgeresultater`, s.includes('index: false'))
  }
  const n = readFileSync(new URL('../app/nulstil/page.tsx', import.meta.url), 'utf8')
  tjek('9D · /nulstil viser kun formularen med en verificeret session',
    n.includes('harAuthSession()'))
  tjek('9E · og bruger ikke URL-parametre som adgang',
    !/searchParams.*(token|code|access)/.test(n))
}

server.close()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
