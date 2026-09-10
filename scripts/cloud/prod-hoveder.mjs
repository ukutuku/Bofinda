// ═══════════════════════════════════════════════════════════════
//  Cachebeskyttelsen på det ENDELIGE HTTP-svar — i produktionstilstand.
//
//  ═══ HVORFOR next start OG IKKE next dev ═══
//
//  `next dev` sætter selv `Cache-Control: no-store` på alting. En fejl,
//  hvor vi taber SDK'ets headere, er derfor USYNLIG i udviklingsserveren
//  og til stede i produktionen. Kontrollen her kører mod `next start`.
//
//  ═══ HVAD DEN MÅLER ═══
//
//  Appens eget svar. Der lægges ingen headere på undervejs: den lille
//  GoTrue-efterligning svarer kun på /auth/v1/* og står ikke mellem
//  browseren og appen.
//
//      node scripts/cloud/prod-hoveder.mjs
//
//  Kræver en base på 127.0.0.1:55432/bofinda_test (scripts/cloud/db-op.sh)
//  og et build i .next (npm run build). Bygger ikke selv — buildet
//  genbruges fra gaten.
//
//  Der logges ALDRIG cookieværdier eller tokens; kun cookienavne og de
//  headere, der er selve målingen.
// ═══════════════════════════════════════════════════════════════

import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import postgres from 'postgres'
import { createServerClient } from '@supabase/ssr'

const DB = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
{
  const u = new URL(DB || 'x://')
  if (u.hostname !== '127.0.0.1' || u.port !== '55432' || u.pathname !== '/bofinda_test') {
    console.error('FEJL: kontrollen kører kun mod den isolerede testbase '
      + '(127.0.0.1:55432/bofinda_test). Kør scripts/cloud/db-op.sh.')
    process.exit(1)
  }
}
if (!existsSync('.next/BUILD_ID')) {
  console.error('FEJL: intet build i .next. Kør `npm run build` først — '
    + 'kontrollen bygger ikke selv, den genbruger gatens build.')
  process.exit(1)
}

let fejl = 0
const tjek = (navn, ok, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const BRUGER = '00000000-0000-4000-8000-00000000c0de'
const MAIL = 'prod-hoveder@example.invalid'

// ─── 1 · GoTrue-efterligningen ─────────────────────────────────
// Svarer KUN på /auth/v1/*. Den er ikke en proxy foran appen og kan
// derfor ikke komme til at tilføje de headere, vi måler efter.
const gotrue = http.createServer((req, res) => {
  let krop = ''
  req.on('data', (c) => { krop += c })
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    const sti = req.url ?? ''
    if (sti.includes('/signup')) return res.end(JSON.stringify({ id: BRUGER, email: MAIL }))
    if (sti.includes('/user')) {
      return res.end(JSON.stringify({
        id: BRUGER, email: MAIL, aud: 'authenticated',
        email_confirmed_at: '2026-01-01T00:00:00Z',
      }))
    }
    res.end(JSON.stringify({
      access_token: `at-${Date.now()}`, refresh_token: `rt-${Date.now()}`,
      // Udløbet med vilje: det er dét, der udløser en fornyelse — og
      // dermed den cookieskrivning, hele kontrollen handler om.
      expires_in: -100, token_type: 'bearer',
      user: { id: BRUGER, email: MAIL, aud: 'authenticated',
        email_confirmed_at: '2026-01-01T00:00:00Z' },
    }))
  })
})
await new Promise((r) => gotrue.listen(0, '127.0.0.1', r))
const AUTHPORT = gotrue.address().port

// ─── 2 · En udløbet session, lavet af det rigtige SDK ──────────
const krukke = new Map()
const klient = () => createServerClient(`http://127.0.0.1:${AUTHPORT}`, 'sb_publishable_kun_til_proever', {
  cookies: {
    getAll: () => [...krukke].map(([name, value]) => ({ name, value })),
    setAll: (sat) => { for (const c of sat) krukke.set(c.name, c.value) },
  },
})
await klient().auth.signUp({
  email: MAIL, password: 'et-langt-testkodeord',
  options: { emailRedirectTo: 'http://127.0.0.1/auth/callback' },
})
await klient().auth.exchangeCodeForSession('kode')
const AUTHCOOKIES = [...krukke].filter(([n]) => /-auth-token(\.\d+)?$/.test(n))
if (AUTHCOOKIES.length === 0) { console.error('FEJL: SDK\'et skrev ingen sessionscookie.'); process.exit(1) }
console.log(`\n  sessionscookies: ${AUTHCOOKIES.map(([n]) => n).join(', ')}  (værdier logges ikke)`)

// Brugerraekken i auth-stubben, saa /min-side kan binde uden at falde
// paa fremmednoeglen. Samme greb som scripts/test-authbinding.ts.
const sql = postgres(DB, { max: 1 })
await sql`insert into auth.users (id, email) values (${BRUGER}, ${MAIL})
  on conflict (id) do nothing`

// ─── 3 · next start ────────────────────────────────────────────
const APPPORT = 3111
const app = spawn('npx', ['next', 'start', '-p', String(APPPORT), '-H', '127.0.0.1'], {
  env: {
    ...process.env,
    DATABASE_URL: DB,
    DATABASE_URL_DIRECT: DB,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTHPORT}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_kun_til_proever',
    NEXT_PUBLIC_BASE_URL: `http://127.0.0.1:${APPPORT}`,
    BILLED_HEMMELIGHED: process.env.BILLED_HEMMELIGHED || 'proeve-hemmelighed-kun-til-proever',
    VERCEL: undefined, VERCEL_ENV: undefined,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  // Egen procesgruppe. `npx next start` er en kæde: en TERM til toppen
  // efterlader next-server kørende og porten optaget — samme fælde, som
  // scripts/cloud/app-ned.sh er skrevet for. Gruppen dræbes samlet.
  detached: true,
})
let log = ''
app.stdout.on('data', (d) => { log += d })
app.stderr.on('data', (d) => { log += d })

const BASE = `http://127.0.0.1:${APPPORT}`
async function hent(sti, medSession) {
  const cookie = medSession
    ? AUTHCOOKIES.map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ')
    : ''
  const r = await fetch(`${BASE}${sti}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
  await r.text()
  return {
    status: r.status,
    cc: r.headers.get('cache-control'),
    expires: r.headers.get('expires'),
    pragma: r.headers.get('pragma'),
    satte: (r.headers.getSetCookie?.() ?? []).map((c) => c.split('=')[0]),
  }
}

let klar = false
for (let i = 0; i < 90; i++) {
  try { await fetch(`${BASE}/privatliv`); klar = true; break } catch { /* endnu ikke */ }
  await new Promise((r) => setTimeout(r, 500))
}
if (!klar) {
  try { process.kill(-app.pid, 'SIGTERM') } catch { app.kill('SIGTERM') }
  gotrue.close()
  console.error('FEJL: next start svarede ikke.\n' + log.slice(-1500))
  process.exit(1)
}

// ─── 4 · Målingerne ────────────────────────────────────────────
const BESKYTTET = /no-store/
const OFFENTLIG = /\bpublic\b|\bs-maxage\b/

for (const sti of ['/privatliv', '/min-side']) {
  console.log(`\n══ ${sti} ══`)
  const uden = await hent(sti, false)
  console.log(`  anonym:      status=${uden.status}  cache-control=${uden.cc ?? '(ingen)'}`
    + `  expires=${uden.expires ?? '(ingen)'}  pragma=${uden.pragma ?? '(ingen)'}`)
  const med = await hent(sti, true)
  console.log(`  med session: status=${med.status}  cache-control=${med.cc ?? '(ingen)'}`
    + `  expires=${med.expires ?? '(ingen)'}  pragma=${med.pragma ?? '(ingen)'}`)
  console.log(`  Set-Cookie:  ${med.satte.length ? med.satte.join(', ') : '(ingen)'}  (værdier logges ikke)`)

  tjek(`${sti} · svarer i produktionstilstand`, uden.status < 500 && med.status < 500,
    `${uden.status} / ${med.status}`)
  // Selve blockeren: skriver appen en sessionscookie, SKAL svaret være
  // beskyttet mod at blive gemt af en CDN eller en omvendt proxy.
  const skrev = med.satte.some((n) => /-auth-token/.test(n))
  tjek(`${sti} · en auth-cookie blev faktisk skrevet`, skrev, med.satte.join(', ') || 'ingen')
  tjek(`${sti} · og svaret er beskyttet mod caching`, BESKYTTET.test(med.cc ?? ''), med.cc ?? '(ingen)')
  tjek(`${sti} · uden modstridende offentlig/delt caching`, !OFFENTLIG.test(med.cc ?? ''), med.cc ?? '')
}

// Den anden halvdel: anonyme svar maa ikke have faaet en NY begraensning
// af rettelsen. /privatliv er den offentlige side, kontrollen maaler paa.
{
  const uden = await hent('/privatliv', false)
  tjek('/privatliv · anonym beholder sin egen cacheadfærd (ingen no-store fra rettelsen)',
    !(uden.pragma === 'no-cache' && uden.expires === '0'),
    `cc=${uden.cc ?? '(ingen)'} expires=${uden.expires ?? '(ingen)'} pragma=${uden.pragma ?? '(ingen)'}`)
}

// ─── 5 · Oprydning: kun vores egne processer ───────────────────
await sql`delete from auth.users where id = ${BRUGER}`.catch(() => {})
await sql`delete from users where email = ${MAIL}`.catch(() => {})
await sql.end()
// Hele gruppen, ikke kun npx-processen — og KUN vores egen.
try { process.kill(-app.pid, 'SIGTERM') } catch { app.kill('SIGTERM') }
gotrue.close()
console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
