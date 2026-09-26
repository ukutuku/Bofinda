// ═══════════════════════════════════════════════════════════════
//  Det privilegerede lag — det ENESTE sted med forhoejet kapabilitet.
//
//  Det gaar over HTTPS til PostgREST' RPC som service_role (staging-only
//  secret-noegle), fordi cloud-miljoeet ikke har en raa databaseforbindelse
//  til staging. Funktionerne er installeret én gang af ejeren fra
//  db/staging/storage-proeve.sql. De kan KUN: svaekke bucket 'boliger'
//  midlertidigt, fjerne svaekkelserne igen, og laese storage.objects uden
//  om RLS (sandhedsmaaling). Se SQL-filens hoved.
//
//  Laget bag ét interface, saa privilegie-vejen kan skiftes (fx til en
//  header-baseret variant) uden at roere selve proeverne.
// ═══════════════════════════════════════════════════════════════

import { Afbryd } from './vagter'
import { kald } from './klient'

export type Kommando = 'select' | 'insert' | 'delete' | 'update' | 'all'

export interface ObjektSandhed {
  id: string
  name: string
  version: string | null
  etag: string | null
  size: string | null
  updated_at: string
  foerste_mappe: string | null
}

export interface Metadata {
  bruger: string
  omgaar_rls: boolean | null
  bucket: { findes: boolean; public: boolean | null; file_size_limit: number | null; allowed_mime_types: string | null }
  objekt_grants: Record<string, string> | null
  objekt_rls: boolean | null
  politikker: Array<{ navn: string; cmd: string; roller: string[]; using: string | null; with_check: string | null }>
  migrationer: string[]
}

export interface Privilegeret {
  metadata(): Promise<Metadata>
  svaekk(kommando: Kommando, minutter?: number): Promise<string[]>
  fjern(): Promise<string[]>
  objekt(navn: string): Promise<ObjektSandhed | null>
  tael(praefiks: string): Promise<number>
  ryd(): Promise<number>
}

/** V2: kalder RPC som service_role med stagings secret-noegle. */
export function privilegeretV2(secret: string): Privilegeret {
  const id = { navn: 'service_role', apikey: secret, bearer: secret }

  async function rpc<T>(navn: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await kald('POST', `/rest/v1/rpc/${navn}`, {
      identitet: id,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (r.http === 404 || r.code === 'PGRST202') {
      throw new Afbryd(3,
        `RPC ${navn} findes ikke paa staging. Koer db/staging/storage-proeve.sql `
        + `i stagings SQL-editor foerst. Se docs/storage-proeve.md.`)
    }
    if (!r.ok) {
      throw new Afbryd(3, `RPC ${navn} fejlede (${r.http}): ${r.message ?? r.tekst}`)
    }
    return r.json as T
  }

  return {
    metadata: () => rpc<Metadata>('proeve_storage_metadata'),
    svaekk: (kommando, minutter = 3) => rpc<string[]>('proeve_storage_svaekk', { kommando, minutter }),
    fjern: () => rpc<string[]>('proeve_storage_fjern'),
    objekt: (navn) => rpc<ObjektSandhed | null>('proeve_storage_objekt', { p_navn: navn }),
    tael: (praefiks) => rpc<number>('proeve_storage_tael', { p_praefiks: praefiks }),
    ryd: () => rpc<number>('proeve_storage_ryd'),
  }
}
