// ═══════════════════════════════════════════════════════════════
//  Proevekonti paa staging.
//
//  To udlejere, A og B, oprettes pr. koersel via Auth' admin-API (kraever
//  secret-noeglen) med email_confirm:true, saa der ikke sendes mail. De
//  logges ind for at faa hver sit access-token (JWT). De slettes igen i
//  finally. En doed koersel efterlader konti med proeve-praefiks, som
//  naeste koersels start rydder.
//
//  Mailadresserne er tydeligt opdigtede (eksempel.invalid) og baerer et
//  koersels-id, saa to samtidige koersler ikke rammer hinanden.
// ═══════════════════════════════════════════════════════════════

import { Afbryd, Miljoe } from './vagter'
import { kald } from './klient'

export interface Konto {
  navn: 'A' | 'B'
  id: string
  email: string
  jwt: string
}

const KODEORD = 'Proeve-kun-til-staging-9f3a!'
const PRAEFIKS = 'storage-proeve-'

async function opretEn(m: Miljoe, koerselsId: string, navn: 'A' | 'B'): Promise<Konto> {
  const admin = { navn: 'service_role', apikey: m.secret, bearer: m.secret }
  const email = `${PRAEFIKS}${koerselsId}-${navn.toLowerCase()}@eksempel.invalid`

  const oprettet = await kald('POST', '/auth/v1/admin/users', {
    identitet: admin,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: KODEORD, email_confirm: true }),
  })
  if (!oprettet.ok) {
    throw new Afbryd(3, `kunne ikke oprette proevekonto ${navn} (${oprettet.http}): ${oprettet.message ?? oprettet.tekst}`)
  }
  const id = (oprettet.json as { id?: string }).id
  if (!id) throw new Afbryd(3, `konto ${navn} kom uden id retur`)

  // Log ind med den offentlige noegle for at faa et rigtigt bruger-JWT.
  const login = await kald('POST', '/auth/v1/token', {
    identitet: { navn: 'anon', apikey: m.publishable },
    headers: { 'content-type': 'application/json' },
    query: { grant_type: 'password' },
    body: JSON.stringify({ email, password: KODEORD }),
  })
  const jwt = (login.json as { access_token?: string }).access_token
  if (!login.ok || !jwt) {
    throw new Afbryd(3, `kunne ikke logge proevekonto ${navn} ind (${login.http}): ${login.message ?? login.tekst}`)
  }
  return { navn, id, email, jwt }
}

export async function opretKonti(m: Miljoe, koerselsId: string): Promise<{ A: Konto; B: Konto }> {
  const A = await opretEn(m, koerselsId, 'A')
  const B = await opretEn(m, koerselsId, 'B')
  return { A, B }
}

async function slet(m: Miljoe, id: string): Promise<void> {
  const admin = { navn: 'service_role', apikey: m.secret, bearer: m.secret }
  await kald('DELETE', `/auth/v1/admin/users/${id}`, { identitet: admin })
}

export async function sletKonti(m: Miljoe, konti: Konto[]): Promise<void> {
  for (const k of konti) {
    try { await slet(m, k.id) } catch { /* bedst muligt; forældreløse ryddes naeste gang */ }
  }
}

/** Rydder forældreløse proevekonti fra en tidligere, afbrudt koersel. */
export async function ryddForaeldreloese(m: Miljoe): Promise<number> {
  const admin = { navn: 'service_role', apikey: m.secret, bearer: m.secret }
  const r = await kald('GET', '/auth/v1/admin/users', { identitet: admin, query: { per_page: '200' } })
  if (!r.ok) return 0
  const brugere = (r.json as { users?: Array<{ id: string; email?: string }> }).users ?? []
  let n = 0
  for (const u of brugere) {
    if (u.email?.startsWith(PRAEFIKS) && u.email.endsWith('@eksempel.invalid')) {
      try { await slet(m, u.id); n++ } catch { /* ignorér */ }
    }
  }
  return n
}
