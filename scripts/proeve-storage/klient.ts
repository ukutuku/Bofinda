// ═══════════════════════════════════════════════════════════════
//  HTTP-klient pr. identitet.
//
//  Storage-API'ets REST-ruter svarer HTTP 400 paa NAESTEN ALT — NoSuchKey,
//  NoSuchBucket, AccessDenie, InvalidSignature, InvalidJWT. Den egentlige
//  kode staar i body (`statusCode` og `code`/`error`). Og flere afvisninger
//  er tavse: 200 med tom liste eller med en fejl pr. element. Derfor laeser
//  vi ALTID body, aldrig kun HTTP-status — og sandheden efterproeves
//  desuden i basen (se privilegeret.ts) og paa filens sha256.
// ═══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { BASE, sikkerUrl } from './vagter'

/** Hvem sender kaldet. Bestemmer apikey og Authorization. */
export interface Identitet {
  navn: string
  apikey?: string
  bearer?: string
}

export interface Svar {
  http: number
  ok: boolean
  /** body.statusCode — Storages egen "rigtige" kode som streng, fx '403'. */
  statusCode: string | null
  /** body.code eller body.error — fx 'NoSuchKey', 'InvalidSignature'. */
  code: string | null
  message: string | null
  tekst: string
  json: unknown
  headers: Headers
  bytes?: Uint8Array
}

export interface KaldValg {
  identitet?: Identitet
  headers?: Record<string, string>
  body?: BodyInit
  query?: Record<string, string>
  /** hent raa bytes i stedet for at tolke JSON (til download). */
  raa?: boolean
}

function byg(sti: string, query?: Record<string, string>): string {
  const u = sti.startsWith('http') ? sti : `${BASE}${sti}`
  const url = new URL(u)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return sikkerUrl(url.toString())
}

function headers(valg: KaldValg): Record<string, string> {
  const h: Record<string, string> = { ...(valg.headers ?? {}) }
  const id = valg.identitet
  if (id?.apikey) h.apikey = id.apikey
  if (id?.bearer) h.Authorization = `Bearer ${id.bearer}`
  return h
}

export async function kald(metode: string, sti: string, valg: KaldValg = {}): Promise<Svar> {
  const url = byg(sti, valg.query)
  const r = await fetch(url, {
    method: metode,
    headers: headers(valg),
    body: valg.body,
    signal: AbortSignal.timeout(20_000),
  })

  if (valg.raa) {
    const buf = new Uint8Array(await r.arrayBuffer())
    return {
      http: r.status, ok: r.ok, statusCode: null, code: null, message: null,
      tekst: '', json: null, headers: r.headers, bytes: buf,
    }
  }

  const tekst = await r.text()
  let json: unknown = null
  try { json = tekst ? JSON.parse(tekst) : null } catch { /* ikke JSON (fx XML fra S3) */ }

  const o = (json ?? {}) as Record<string, unknown>
  const statusCode = o.statusCode != null ? String(o.statusCode) : null
  const code = (o.code ?? o.error) != null ? String(o.code ?? o.error) : null
  const message = o.message != null ? String(o.message) : null

  return { http: r.status, ok: r.ok, statusCode, code, message, tekst, json, headers: r.headers }
}

/** Henter raa bytes fra en (absolut) URL uden nogen headers — fx en signeret URL. */
export async function hentBytes(url: string, headers: Record<string, string> = {}): Promise<Svar> {
  return kald('GET', url, { headers, raa: true })
}

export const sha256 = (b: Uint8Array): string =>
  createHash('sha256').update(b).digest('hex')

/** En XML-krop fra S3 indeholder <Code>…</Code> pr. noegle. Traek dem ud. */
export function s3Koder(xml: string): string[] {
  return [...xml.matchAll(/<Code>([^<]+)<\/Code>/g)].map((m) => m[1]!)
}

/** Et lille, gyldigt 1x1 JPEG. Nok til at komme forbi content-type-tjek. */
export const LILLE_JPEG: Uint8Array = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
), (c) => c.charCodeAt(0))
