// ═══════════════════════════════════════════════════════════════
//  To ting sker her, og de er UAFHÆNGIGE af hinanden.
//
//  1 · Analytics-identifikatorerne sættes — kun efter et ja.
//  2 · Auth-sessionen fornyes — uanset hvad brugeren svarede på banneret.
//
//  ═══ HVORFOR DE TO IKKE MÅ HÆNGE SAMMEN ═══
//
//  Filen begyndte med `if (!plan) return NextResponse.next()`. Lå
//  auth-fornyelsen bag den linje, ville «kun det nødvendige» betyde «ingen
//  login-session, der holder» — og en cookiebanner-knap ville være blevet
//  til en adgangsspærring. En session er strengt nødvendig for at være
//  logget ind; den er ikke statistik.
//
//  ═══ HVORFOR AUTH SKAL FORNYES HER OG IKKE I SIDEN ═══
//
//  En server component kan LÆSE cookies, men ikke sætte dem — `setAll` i
//  lib/auth.ts sluger derfor skrivningen. Når access-tokenet udløber,
//  roterer `getUser()` refresh-tokenet, og det NYE token ville blive
//  kasseret. Bruges et forbrugt refresh-token igen uden for GoTrues
//  genbrugsinterval, tilbagekaldes HELE sessionen. Brugeren bliver logget
//  ud «af sig selv», og under en udløbsprøve ser det ud som om udløbet
//  virker efter hensigten. Middleware er det ene sted, hvor både
//  requestet og svaret kan skrives.
//
//  ═══ ÉT SVAR, ALDRIG TO ═══
//
//  Begge slags cookies skrives på det SAMME NextResponse. Byggede vi et
//  nyt svar undervejs, ville det, der allerede var sat, falde af.
// ═══════════════════════════════════════════════════════════════

import { NextResponse, type NextRequest } from 'next/server'
import { BASISCOOKIE, planFor, type Laeser } from './lib/samtykke'
import { harAuthCookie, klientMed, konfigureret } from './lib/supabase-klient'

/**
 * Skal sessionen fornyes for DENNE request?
 *
 * Tre betingelser, og alle tre sparer et netværkskald til Auth-serveren:
 *
 *  · Auth skal være sat op overhovedet.
 *  · Requesten skal bære en auth-cookie. Uden en session er der intet at
 *    forny, og de anonyme visninger af områdesiderne — langt de fleste —
 *    betaler dermed ingenting.
 *  · Ruten skal være en, hvor en session bruges til noget. `/api/*` er
 *    undtaget: målingsbeaconet har ingen brug for en bruger, og en
 *    logget ind bruger ville ellers betale et Auth-kald pr. beacon.
 *    Server actions POSTer til SIDENS rute, ikke til /api, så de er
 *    dækket — og de kan i øvrigt selv skrive cookies.
 */
function skalFornyes(req: NextRequest): boolean {
  if (!konfigureret()) return false
  if (req.nextUrl.pathname.startsWith('/api/')) return false
  return harAuthCookie(req.cookies.getAll().map((c) => c.name))
}

export async function middleware(req: NextRequest) {
  const faa: Laeser = (n) => req.cookies.get(n)?.value
  const plan = planFor(faa, new Date())

  // ── 1 · Analytics, kun efter et ja ──────────────────────────
  // Skriv ind i REQUESTET også, så den sidevisning, der lige nu bliver
  // renderet, ser den nye session — ikke først den næste.
  if (plan) for (const c of plan.saet) req.cookies.set(c.navn, c.vaerdi)

  // ── 2 · Auth, uanset samtykke ───────────────────────────────
  // Begge samlinger er REQUEST-LOKALE. Lå de på modulniveau, ville to
  // samtidige requests i den samme instans dele dem — og den enes
  // sessionscookie kunne havne på den andens svar.
  const authSat: { name: string; value: string; options: Record<string, unknown> }[] = []
  const authHoveder: Record<string, string> = {}
  if (skalFornyes(req)) {
    const sb = klientMed({
      getAll: () => req.cookies.getAll(),
      setAll: (sat, hoveder) => {
        for (const { name, value, options } of sat) {
          // Requestet: så siden, der renderes NU, ser den fornyede
          // session i stedet for den udløbne.
          req.cookies.set(name, value)
          authSat.push({ name, value, options: options as Record<string, unknown> })
        }
        // ═══ ANDET ARGUMENT — OG DET SKAL PÅ SVARET ═══
        //
        // @supabase/ssr leverer her de headere, svaret SKAL bære, når det
        // sætter auth-cookies:
        //
        //     Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0
        //     Expires: 0
        //     Pragma: no-cache
        //
        // Vi tog kun imod cookierne og smed headerne væk. Det er ikke en
        // formalitet: et svar med Set-Cookie på en sessionscookie, der
        // ender i en CDN eller en omvendt proxy, kan udleveres til den
        // NÆSTE bruger — altså én persons session i en fremmeds browser.
        // Vercel Edge, CloudFront og Cloudflare ligger alle på den vej.
        //
        // De opsamles her og sættes på det ENDELIGE svar. At skrive dem
        // ind i requestet ville ikke gøre noget: det er browserens og
        // mellemleddenes svar, der skal bære dem.
        //
        // SDK'et sender dem også, når det RYDDER ugyldige cookies —
        // `applyServerStorage` kalder setAll med både removeCookiesToWrite
        // og setCookiesToWrite. En oprydning skal beskyttes lige så meget
        // som en fornyelse, så der skelnes ikke.
        Object.assign(authHoveder, hoveder)
      },
    })
    // getUser() og ikke getSession(): den spørger Auth-serveren og er
    // dét, der udløser fornyelsen. Fejler kaldet — netværk, nedetid — er
    // svaret at lade requesten gå videre urørt. Siderne afgør selv, hvad
    // en manglende session betyder; middleware må ikke blokere en
    // offentlig side, fordi Auth har en dårlig dag.
    //
    // Bemærk at `authSat` og `authHoveder` beholdes, hvis kaldet kaster
    // EFTER at setAll er fyret: er beskyttelsen først leveret, må en
    // senere fejlvej ikke tabe den igen.
    try { await sb.auth.getUser() } catch { /* uroert videre */ }
  }

  // ── 3 · Ét svar med begge dele ──────────────────────────────
  const roert = Boolean(plan) || authSat.length > 0
  const svar = roert
    ? NextResponse.next({ request: { headers: req.headers } })
    : NextResponse.next()

  if (plan) {
    for (const c of plan.saet) {
      svar.cookies.set(c.navn, c.vaerdi, {
        ...BASISCOOKIE,
        maxAge: c.maxAge,
        secure: req.nextUrl.protocol === 'https:',
      })
    }
  }
  // Auth-cookiernes indstillinger kommer fra SDK'et og skrives ordret.
  // At sætte vores egne ville betyde, at to steder bestemte levetid,
  // Secure og SameSite for den samme cookie.
  for (const c of authSat) svar.cookies.set(c.name, c.value, c.options)

  // Og headerne, SDK'et bad om — kun dem, det faktisk leverede. Et
  // ubetinget `no-store` her ville gøre HVER eneste anonyme visning af en
  // områdeside ucachebar, og de sider er langt de fleste. Beskyttelsen
  // hører til de svar, der bærer en sessionscookie, og kun dem.
  for (const [navn, vaerdi] of Object.entries(authHoveder)) svar.headers.set(navn, vaerdi)

  return svar
}

export const config = {
  // Billed-proxyen og statiske filer skal ikke gennem noget som helst.
  // /go/[id] SKAL med: klikket hører til sessionen.
  matcher: ['/((?!_next/static|_next/image|api/billede|favicon.ico|robots.txt|sitemap.xml).*)'],
}
