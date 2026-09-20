// ═══════════════════════════════════════════════════════════════
//  Supabase-klienten, uden databasen.
//
//  ═══ HVORFOR DEN IKKE BARE LIGGER I lib/auth.ts ═══
//
//  `lib/auth.ts` importerer `db` på modulniveau, og `db` trækker
//  `postgres` med. Middleware kører i edge-runtime, hvor den pakke ikke
//  hører hjemme — et enkelt import derfra ville vælte bundtet. Samme
//  klasse som reglen om `lib/faciliteter.ts` og databasen, og som
//  `lib/maaling-server.ts` og `next/headers`.
//
//  Filen er derfor REN: `@supabase/ssr` og intet andet.
//
//  ═══ COOKIEKURVEN KOMMER IND UDEFRA ═══
//
//  De tre kaldere skriver cookies tre forskellige steder, og kun de
//  steder virker:
//
//    server action / server component   next/headers `cookies()`
//    middleware                         request OG response
//    rutehandler                        det NextResponse, den returnerer
//
//  Klienten skal ikke kende forskellen. Den får en kurv med `getAll` og
//  `setAll` og bruger den.
// ═══════════════════════════════════════════════════════════════

import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
export const SUPABASE_NOEGLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/** Er der overhovedet et Auth-miljø? Sider spørger, før de viser en formular. */
export function konfigureret(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_NOEGLE)
}

export function klientMed(kurv: CookieMethodsServer) {
  if (!SUPABASE_URL || !SUPABASE_NOEGLE) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL eller _PUBLISHABLE_KEY mangler')
  }
  return createServerClient(SUPABASE_URL, SUPABASE_NOEGLE, { cookies: kurv })
}

/**
 * Bærer requesten en session overhovedet?
 *
 * ═══ HVORFOR SPØRGSMÅLET STILLES ═══
 *
 * `getUser()` er et netværkskald til Auth-serveren. Kørte middleware det
 * på hver eneste request, ville hver anonym visning af en områdeside
 * betale for en session, der ikke findes — og de sider er langt de
 * fleste. Uden en auth-cookie er der ingenting at forny, og så springes
 * kaldet over.
 *
 * Navnet er `sb-<projektref>-auth-token`, og @supabase/ssr deler værdien
 * i `.0`, `.1` … når den bliver for lang til én cookie. Mønstret dækker
 * begge former. Rammer det ved siden af — skifter SDK'et navneskik —
 * fornyes sessionen ikke, og det ville vise sig som en bruger, der
 * pludselig bliver logget ud. Prøven i scripts/test-kontovej.ts holder
 * derfor mønstret op mod begge former.
 */
export const AUTHCOOKIE = /^sb-.+-auth-token(\.\d+)?$/

export const harAuthCookie = (navne: readonly string[]): boolean =>
  navne.some((n) => AUTHCOOKIE.test(n))
