// ═══════════════════════════════════════════════════════════════
//  Integrationsproeve: hvad HAANDHAEVER storage-politikken for bucket
//  'boliger' faktisk? Mod den rigtige Supabase Storage paa STAGING
//  (prgmenbwabwkgitjclrj) — aldrig produktionen, aldrig PGlite (som ikke
//  har Storage). Den prøve, CLAUDE.md siger mangler.
//
//  Den kan FEJLE: hver graense bevises ved, at politikken svaekkes
//  midlertidigt, saa proeven skifter fra "blokeret" til "aaben". En proeve,
//  der ikke kan bevises at fejle, tolkes ikke som groen (exit 2).
//
//  Alt maales paa body og paa sandheden i basen (proeve_storage_objekt),
//  aldrig paa HTTP-status alene: Storage svarer 400 paa naesten alt, og
//  flere afvisninger er TAVSE (200 med tom liste). En positiv kontrol
//  ledsager hver tavs proeve.
//
//  KOERSEL:  npm run proeve:storage:staging
//  Kraever:  db/staging/storage-proeve.sql koert én gang i stagings editor,
//            og STAGING_SUPABASE_PUBLISHABLE_KEY + STAGING_SUPABASE_SECRET_KEY
//            som Environment variables. Se docs/storage-proeve.md.
//
//  Exit: 0 alt bestaaet og bevist · 1 en graense holdt ikke / et hul har
//        aendret sig · 2 groent men ubevist · 3 kunne ikke koere.
// ═══════════════════════════════════════════════════════════════

import { Afbryd, laesMiljoe, BASE } from './proeve-storage/vagter'
import { kald, hentBytes, sha256, s3Koder, LILLE_JPEG, type Identitet, type Svar } from './proeve-storage/klient'
import { privilegeretV2, type Privilegeret } from './proeve-storage/privilegeret'
import { opretKonti, sletKonti, ryddForaeldreloese, type Konto } from './proeve-storage/konti'
import { koerProeve, rapport, type Proeve, type Resultat } from './proeve-storage/harness'

const skriv = (s: string) => process.stdout.write(s)

// ── Kontekst, som hver proeve faar ────────────────────────────────
interface Ctx {
  A: Konto
  B: Konto
  anon: Identitet
  publishable: string
  priv: Privilegeret
  runid: string
  taeller: { n: number }
}

const somKonto = (k: Konto, publishable: string): Identitet =>
  ({ navn: k.navn, apikey: publishable, bearer: k.jwt })

/** Unikt objektnavn i kontoens egen mappe. Andet mappeled er 'proeve',
 *  saa oprydningen kan kende det fra en rigtig upload (<uid>/<uuid>.jpg). */
function navnFor(ctx: Ctx, k: Konto, rel: string): string {
  ctx.taeller.n += 1
  return `${k.id}/proeve/${ctx.runid}/${ctx.taeller.n}-${rel}`
}

// ── Tynde Storage-API-hjaelpere ───────────────────────────────────
const objektSti = (navn: string) => `/storage/v1/object/boliger/${navn}`

function uploadObjekt(id: Identitet, navn: string, upsert = false, contentType = 'image/jpeg'): Promise<Svar> {
  const headers: Record<string, string> = { 'content-type': contentType }
  if (upsert) headers['x-upsert'] = 'true'
  return kald('POST', objektSti(navn), { identitet: id, headers, body: LILLE_JPEG as unknown as BodyInit })
}

const putObjekt = (id: Identitet, navn: string, upsert = false): Promise<Svar> =>
  kald('PUT', objektSti(navn), {
    identitet: id,
    headers: { 'content-type': 'image/jpeg', ...(upsert ? { 'x-upsert': 'true' } : {}) },
    body: LILLE_JPEG as unknown as BodyInit,
  })

const hentAuth = (id: Identitet, navn: string): Promise<Svar> =>
  kald('GET', `/storage/v1/object/authenticated/boliger/${navn}`, { identitet: id })

const info = (id: Identitet, navn: string): Promise<Svar> =>
  kald('GET', `/storage/v1/object/info/authenticated/boliger/${navn}`, { identitet: id })

const signEnkelt = (id: Identitet, navn: string, expiresIn: number): Promise<Svar> =>
  kald('POST', `/storage/v1/object/sign/boliger/${navn}`, {
    identitet: id, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn }),
  })

const signFlere = (id: Identitet, paths: string[], expiresIn: number): Promise<Svar> =>
  kald('POST', '/storage/v1/object/sign/boliger', {
    identitet: id, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn, paths }),
  })

const uploadSign = (id: Identitet, navn: string): Promise<Svar> =>
  kald('POST', `/storage/v1/object/upload/sign/boliger/${navn}`, {
    identitet: id, headers: { 'content-type': 'application/json' }, body: '{}',
  })

const listMappe = (id: Identitet, prefix: string): Promise<Svar> =>
  kald('POST', '/storage/v1/object/list/boliger', {
    identitet: id, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
  })

const listV2 = (id: Identitet, prefix: string): Promise<Svar> =>
  kald('POST', '/storage/v1/object/list-v2/boliger', {
    identitet: id, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix, limit: 100 }),
  })

const sletEnkelt = (id: Identitet, navn: string): Promise<Svar> =>
  kald('DELETE', objektSti(navn), { identitet: id })

const sletBulk = (id: Identitet, prefixes: string[]): Promise<Svar> =>
  kald('DELETE', '/storage/v1/object/boliger', {
    identitet: id, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes }),
  })

const flyt = (id: Identitet, sourceKey: string, destinationKey: string): Promise<Svar> =>
  kald('POST', '/storage/v1/object/move', {
    identitet: id, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bucketId: 'boliger', sourceKey, destinationKey }),
  })

const kopier = (id: Identitet, sourceKey: string, destinationKey: string): Promise<Svar> =>
  kald('POST', '/storage/v1/object/copy', {
    identitet: id, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bucketId: 'boliger', sourceKey, destinationKey }),
  })

/** Sign som ejer og faa den absolutte, signerede URL retur. */
async function signeretUrl(id: Identitet, navn: string, expiresIn: number): Promise<string | null> {
  const r = await signEnkelt(id, navn, expiresIn)
  const rel = (r.json as { signedURL?: string; signedUrl?: string })?.signedURL
    ?? (r.json as { signedUrl?: string })?.signedUrl
  return rel ? `${BASE}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}` : null
}

// Seed et offerobjekt ejet af en konto; returnér objektnavnet.
async function saaObjekt(ctx: Ctx, ejer: Konto, rel: string): Promise<string> {
  const navn = navnFor(ctx, ejer, rel)
  const r = await uploadObjekt(somKonto(ejer, ctx.publishable), navn)
  if (!r.ok) throw new Error(`kunne ikke saa offerobjekt som ${ejer.navn}: ${r.http} ${r.message ?? r.tekst}`)
  return navn
}

const ok = (note: string) => ({ somVentet: true, note })
const nej = (note: string) => ({ somVentet: false, note })

// ── Proevelisten ─────────────────────────────────────────────────
const PROEVER: Proeve<Ctx>[] = [
  // ─ Grundlag: mål basen, ikke filerne ─
  {
    id: 'grundlag-politik', gruppe: 'Grundlag', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'bucket privat, praecis 3 politikker (INSERT/SELECT/DELETE for authenticated), RLS til',
    koer: async (ctx) => {
      const m = await ctx.priv.metadata()
      const problemer: string[] = []
      if (!m.bucket.findes) problemer.push('bucket boliger findes ikke')
      if (m.bucket.public !== false) problemer.push(`bucket public=${m.bucket.public} (ventet false)`)
      if (m.objekt_rls !== true) problemer.push('RLS er ikke slaaet til paa storage.objects')
      const cmds = m.politikker.map((p) => p.cmd).sort().join(',')
      if (cmds !== 'DELETE,INSERT,SELECT') problemer.push(`politikker: [${m.politikker.map((p) => `${p.navn}:${p.cmd}`).join(', ')}] (ventet netop INSERT+SELECT+DELETE)`)
      const forkertRolle = m.politikker.filter((p) => !(p.roller.length === 1 && p.roller[0] === 'authenticated'))
      if (forkertRolle.length) problemer.push(`politik(ker) ikke kun for authenticated: ${forkertRolle.map((p) => p.navn).join(', ')}`)
      const mime = m.bucket.allowed_mime_types ? `mime=[${m.bucket.allowed_mime_types}]` : 'INGEN mime-begraensning (◆ vilkaarligt indhold kan uploades)'
      const note = `version-migrationer=[${m.migrationer.join(', ')}]; ${mime}; grants=${JSON.stringify(m.objekt_grants)}`
      return problemer.length ? nej(problemer.join(' · ')) : ok(note)
    },
  },

  // ─ Ejeren (A): baseline og ejer-graenser ─
  {
    id: 'ejer-upload-ny', gruppe: 'Ejer', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'A kan uploade til en ny sti i sin egen mappe',
    koer: async (ctx) => {
      const navn = navnFor(ctx, ctx.A, 'egen.jpg')
      const r = await uploadObjekt(somKonto(ctx.A, ctx.publishable), navn)
      const sandhed = await ctx.priv.objekt(navn)
      return r.ok && sandhed ? ok(`upload ${r.http}, ligger i basen`) : nej(`upload ${r.http} ${r.code ?? r.message}, i basen: ${!!sandhed}`)
    },
  },
  {
    id: 'ejer-sign-10aar', gruppe: 'Ejer', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'A kan signere sit eget billede med ti aars udloeb',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'sign.jpg')
      const TI_AAR = 10 * 365 * 24 * 3600
      const url = await signeretUrl(somKonto(ctx.A, ctx.publishable), navn, TI_AAR)
      if (!url) return nej('ingen signeret URL retur')
      const token = new URL(url).searchParams.get('token')
      if (!token) return nej('ingen token i URL')
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { iat: number; exp: number }
      const levetid = payload.exp - payload.iat
      return Math.abs(levetid - TI_AAR) <= 2
        ? ok(`token accepteret med levetid ${levetid}s (~10 aar), payload: {url, scope, iat, exp}`)
        : nej(`levetid ${levetid}s afveg fra ${TI_AAR}s`)
    },
  },
  {
    id: 'ejer-overskriv', gruppe: 'Ejer', slags: 'graense', bevis: { via: 'mutation', kommando: 'update' },
    beskriv: 'A kan IKKE overskrive sin egen fil paa stedet (ingen UPDATE-politik)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'optaget.jpg')
      const foer = await ctx.priv.objekt(navn)
      const r = await putObjekt(somKonto(ctx.A, ctx.publishable), navn, true)
      const efter = await ctx.priv.objekt(navn)
      const uaendret = foer?.version === efter?.version
      // blokeret = kaldet mislykkedes ELLER versionen er uaendret
      return (!r.ok && uaendret)
        ? ok(`overskrivning afvist (${r.statusCode ?? r.http} ${r.code ?? ''}), version uaendret`)
        : nej(`overskrivning gik igennem: http ${r.http}, version foer=${foer?.version} efter=${efter?.version}`)
    },
  },

  // ─ Anden udlejer (B) skriver mod A's mappe ─
  {
    id: 'B-upload-post', gruppe: 'B skriver mod A', slags: 'graense', bevis: { via: 'mutation', kommando: 'insert' },
    beskriv: 'B kan ikke uploade (POST) i A\'s mappe',
    koer: async (ctx) => {
      const navn = navnFor(ctx, ctx.A, 'fremmed-post.jpg')
      const r = await uploadObjekt(somKonto(ctx.B, ctx.publishable), navn)
      const findes = await ctx.priv.objekt(navn)
      return (!r.ok && !findes)
        ? ok(`afvist (${r.statusCode ?? r.http} ${r.code ?? ''}), ingen raekke skrevet`)
        : nej(`http ${r.http}, raekke skrevet: ${!!findes}`)
    },
  },
  {
    id: 'B-upload-upsert', gruppe: 'B skriver mod A', slags: 'graense', bevis: { via: 'mutation', kommando: 'insert' },
    beskriv: 'B kan ikke PUT/x-upsert i A\'s mappe',
    koer: async (ctx) => {
      const navn = navnFor(ctx, ctx.A, 'fremmed-put.jpg')
      const r = await putObjekt(somKonto(ctx.B, ctx.publishable), navn, true)
      const findes = await ctx.priv.objekt(navn)
      return (!r.ok && !findes) ? ok(`afvist (${r.statusCode ?? r.http}), ingen raekke`) : nej(`http ${r.http}, raekke: ${!!findes}`)
    },
  },
  {
    id: 'B-upload-sign', gruppe: 'B skriver mod A', slags: 'graense', bevis: { via: 'mutation', kommando: 'insert' },
    beskriv: 'B kan ikke faa en signeret upload-URL til A\'s mappe',
    koer: async (ctx) => {
      const navn = navnFor(ctx, ctx.A, 'fremmed-signupload.jpg')
      const r = await uploadSign(somKonto(ctx.B, ctx.publishable), navn)
      return !r.ok ? ok(`afvist ved udstedelse (${r.statusCode ?? r.http} ${r.code ?? ''})`) : nej(`fik et upload-token: http ${r.http}`)
    },
  },
  {
    id: 'B-copy-ind', gruppe: 'B skriver mod A', slags: 'graense', bevis: { via: 'mutation', kommando: 'insert' },
    beskriv: 'B kan ikke kopiere sin egen fil ind i A\'s mappe',
    koer: async (ctx) => {
      const kilde = await saaObjekt(ctx, ctx.B, 'egen-til-kopi.jpg')
      const maal = navnFor(ctx, ctx.A, 'plantet-kopi.jpg')
      const r = await kopier(somKonto(ctx.B, ctx.publishable), kilde, maal)
      const findes = await ctx.priv.objekt(maal)
      return (!r.ok && !findes) ? ok(`afvist (${r.statusCode ?? r.http} ${r.code ?? ''})`) : nej(`http ${r.http}, raekke i A's mappe: ${!!findes}`)
    },
  },
  {
    id: 'B-move-ind', gruppe: 'B skriver mod A', slags: 'graense', bevis: { via: 'mutation', kommando: 'update' },
    beskriv: 'B kan ikke flytte sin egen fil ind i A\'s mappe',
    koer: async (ctx) => {
      const kilde = await saaObjekt(ctx, ctx.B, 'egen-til-flyt.jpg')
      const maal = navnFor(ctx, ctx.A, 'plantet-flyt.jpg')
      const r = await flyt(somKonto(ctx.B, ctx.publishable), kilde, maal)
      const findes = await ctx.priv.objekt(maal)
      return (!r.ok && !findes) ? ok(`afvist (${r.statusCode ?? r.http} ${r.code ?? ''})`) : nej(`http ${r.http}, raekke i A's mappe: ${!!findes}`)
    },
  },

  // ─ Anden udlejer (B) laeser/signerer A's fil ─
  {
    id: 'B-download', gruppe: 'B laeser A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'B kan ikke hente A\'s fil (og A kan — positiv kontrol)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'laes.jpg')
      const bDl = await hentAuth(somKonto(ctx.B, ctx.publishable), navn)
      const aDl = await hentAuth(somKonto(ctx.A, ctx.publishable), navn)
      // blokeret: B naegtes OG A kan (ellers maaler vi paa en forkert sti)
      return (!bDl.ok && aDl.ok)
        ? ok(`B ${bDl.statusCode ?? bDl.http} ${bDl.code ?? ''}; A henter (${aDl.http})`)
        : nej(`B http ${bDl.http} (ok=${bDl.ok}); A http ${aDl.http} (ok=${aDl.ok})`)
    },
  },
  {
    id: 'B-sign-enkelt', gruppe: 'B laeser A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'B kan ikke signere en URL til A\'s fil',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'bsign.jpg')
      const r = await signEnkelt(somKonto(ctx.B, ctx.publishable), navn, 600)
      const fik = !!((r.json as { signedURL?: string })?.signedURL)
      return (!fik) ? ok(`ingen signatur (${r.statusCode ?? r.http} ${r.code ?? ''})`) : nej(`B fik en signatur til A's fil: http ${r.http}`)
    },
  },
  {
    id: 'B-list', gruppe: 'B laeser A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'TAVS: B lister A\'s mappe → 200 tom (A ser sin egen — positiv kontrol)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'listet.jpg')
      const prefix = navn.slice(0, navn.lastIndexOf('/') + 1)
      const bList = await listMappe(somKonto(ctx.B, ctx.publishable), prefix)
      const aList = await listMappe(somKonto(ctx.A, ctx.publishable), prefix)
      const bAntal = Array.isArray(bList.json) ? (bList.json as unknown[]).length : -1
      const aAntal = Array.isArray(aList.json) ? (aList.json as unknown[]).length : -1
      // blokeret: B's liste tom, A's ikke-tom. Maalt paa INDHOLD, ikke status.
      return (bAntal === 0 && aAntal >= 1)
        ? ok(`B ser 0 (http ${bList.http}), A ser ${aAntal}`)
        : nej(`B ser ${bAntal}, A ser ${aAntal}`)
    },
  },
  {
    id: 'B-list-v2', gruppe: 'B laeser A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'TAVS: B lister A\'s mappe via list-v2 → 200 tom',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'listetv2.jpg')
      const prefix = navn.slice(0, navn.lastIndexOf('/') + 1)
      const b = await listV2(somKonto(ctx.B, ctx.publishable), prefix)
      const a = await listV2(somKonto(ctx.A, ctx.publishable), prefix)
      const antal = (s: Svar) => {
        const o = s.json as { objects?: unknown[] } | unknown[]
        if (Array.isArray(o)) return o.length
        return Array.isArray(o?.objects) ? o.objects.length : -1
      }
      return (antal(b) === 0 && antal(a) >= 1) ? ok(`B ser 0, A ser ${antal(a)}`) : nej(`B ${antal(b)}, A ${antal(a)}`)
    },
  },
  {
    id: 'B-multisign', gruppe: 'B laeser A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'TAVS: B batch-signerer A\'s stier → 200 med signedURL:null pr. sti',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'multisign.jpg')
      const b = await signFlere(somKonto(ctx.B, ctx.publishable), [navn], 600)
      const a = await signFlere(somKonto(ctx.A, ctx.publishable), [navn], 600)
      const bNull = Array.isArray(b.json) && (b.json as Array<{ signedURL: string | null }>).every((x) => !x.signedURL)
      const aSat = Array.isArray(a.json) && (a.json as Array<{ signedURL: string | null }>).every((x) => !!x.signedURL)
      return (bNull && aSat) ? ok(`B: alle signedURL=null (http ${b.http}); A: alle sat`) : nej(`B json=${JSON.stringify(b.json)}`)
    },
  },

  // ─ Anden udlejer (B) sletter A's fil ─
  {
    id: 'B-slet-enkelt', gruppe: 'B sletter A', slags: 'graense', bevis: { via: 'mutation', kommando: 'delete' },
    beskriv: 'B kan ikke slette A\'s fil (enkelt-DELETE)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'bslet1.jpg')
      const foer = await ctx.priv.objekt(navn)
      const r = await sletEnkelt(somKonto(ctx.B, ctx.publishable), navn)
      const efter = await ctx.priv.objekt(navn)
      return (!!efter && foer?.version === efter?.version)
        ? ok(`afvist (${r.statusCode ?? r.http} ${r.code ?? ''}), fil uaendret`)
        : nej(`fil vaek eller aendret efter B's sletning (http ${r.http})`)
    },
  },
  {
    id: 'B-slet-bulk', gruppe: 'B sletter A', slags: 'graense', bevis: { via: 'mutation', kommando: 'delete' },
    beskriv: 'TAVS: B batch-sletter A\'s fil → 200 [], men filen staar uaendret',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'bsletbulk.jpg')
      const foer = await ctx.priv.objekt(navn)
      const r = await sletBulk(somKonto(ctx.B, ctx.publishable), [navn])
      const efter = await ctx.priv.objekt(navn)
      const tom = Array.isArray(r.json) && (r.json as unknown[]).length === 0
      return (!!efter && foer?.etag === efter?.etag)
        ? ok(`svar ${tom ? '200 []' : `http ${r.http}`}, men filen staar (etag uaendret)`)
        : nej(`filen forsvandt/aendrede sig efter bulk-delete (http ${r.http})`)
    },
  },
  {
    id: 'B-copy-ud', gruppe: 'B sletter A', slags: 'graense', bevis: { via: 'mutation', kommando: 'select' },
    beskriv: 'B kan ikke kopiere A\'s fil ud i sin egen mappe',
    koer: async (ctx) => {
      const kilde = await saaObjekt(ctx, ctx.A, 'kopiud.jpg')
      const maal = navnFor(ctx, ctx.B, 'stjaalet.jpg')
      const r = await kopier(somKonto(ctx.B, ctx.publishable), kilde, maal)
      const findes = await ctx.priv.objekt(maal)
      return (!r.ok && !findes) ? ok(`afvist (${r.statusCode ?? r.http} ${r.code ?? ''})`) : nej(`http ${r.http}, kopi i B's mappe: ${!!findes}`)
    },
  },

  // ─ Anon ─
  {
    id: 'anon-list', gruppe: 'Anon', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'anon kan ikke liste (A kan — positiv kontrol)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'anonlist.jpg')
      const prefix = navn.slice(0, navn.lastIndexOf('/') + 1)
      const anon = await listMappe(ctx.anon, prefix)
      const a = await listMappe(somKonto(ctx.A, ctx.publishable), prefix)
      const anonAntal = Array.isArray(anon.json) ? (anon.json as unknown[]).length : (anon.ok ? -1 : 0)
      const aAntal = Array.isArray(a.json) ? (a.json as unknown[]).length : -1
      return (anonAntal === 0 && aAntal >= 1)
        ? ok(`anon ser 0 (http ${anon.http}), A ser ${aAntal}`)
        : nej(`anon ser ${anonAntal}, A ser ${aAntal}`)
    },
  },
  {
    id: 'anon-token-binding', gruppe: 'Anon', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'et token fra HTML\'en virker KUN paa sin egen sti (anden sti → InvalidSignature)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'binding.jpg')
      const andet = await saaObjekt(ctx, ctx.A, 'binding-andet.jpg')
      const url = await signeretUrl(somKonto(ctx.A, ctx.publishable), navn, 600)
      if (!url) return nej('ingen signeret URL')
      // positiv kontrol: rigtig sti henter uden headers
      const rigtig = await hentBytes(url)
      // negativ: samme token, anden sti
      const forfalsket = url.replace(encodeURIComponent(navn), encodeURIComponent(andet)).replace(navn, andet)
      const forkert = await hentBytes(forfalsket)
      const rigtigOk = rigtig.http === 200 && !!rigtig.bytes && rigtig.bytes.length > 0
      const forkertAfvist = forkert.http !== 200
      return (rigtigOk && forkertAfvist)
        ? ok(`rigtig sti 200 (${rigtig.bytes!.length} bytes); anden sti ${forkert.http} (bundet til stien)`)
        : nej(`rigtig http ${rigtig.http}; anden sti http ${forkert.http}`)
    },
  },

  // ─ Selvudloebet: det loefte, der baerer SQL-filen ─
  {
    id: 'selvudloeb-fyrer', gruppe: 'Selvudloeb', slags: 'graense', bevis: { via: 'positiv-kontrol' },
    beskriv: 'en svaekkelse med udloeb i FORTIDEN gaelder IKKE (og en gyldig aabner — kontrol)',
    koer: async (ctx) => {
      // Uden dette loefte staar staging aaben, hvis en doed koersel ikke naar
      // at rydde op. Bevis at fristen fyrer: en udloebet select-svaekkelse maa
      // ikke aabne, mens en gyldig skal. Er de ens, maaler proeven intet —
      // og fjernes 'now() < frist' fra SQL'en, aabner den udloebede ogsaa.
      const navn = await saaObjekt(ctx, ctx.A, 'selvudloeb.jpg')
      const b = somKonto(ctx.B, ctx.publishable)
      let udloebetBlokeret = false
      let gyldigAaben = false
      await ctx.priv.svaekk('select', -1) // frist i fortiden
      try {
        udloebetBlokeret = !(await hentAuth(b, navn)).ok
      } finally {
        await ctx.priv.fjern()
      }
      await ctx.priv.svaekk('select', 3) // gyldig
      try {
        gyldigAaben = (await hentAuth(b, navn)).ok
      } finally {
        await ctx.priv.fjern()
      }
      return (udloebetBlokeret && gyldigAaben)
        ? ok('udloebet svaekkelse blokerede, gyldig aabnede — fristen fyrer')
        : nej(`udloebet blokerede=${udloebetBlokeret}, gyldig aabnede=${gyldigAaben} `
          + `(er begge ens, maaler proeven ikke udloebet — tjek 'now() < frist' i SQL'en)`)
    },
  },

  // ─ KENDTE HULLER (fund, ikke groenne proever) ─
  {
    id: 'hul-token-uden-om-rls', gruppe: 'Kendte huller', slags: 'hul',
    beskriv: 'signeret URL omgaar politikken: en anonym uden JWT henter A\'s fil',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'kapabilitet.jpg')
      const url = await signeretUrl(somKonto(ctx.A, ctx.publishable), navn, 600)
      if (!url) return nej('ingen signeret URL')
      const r = await hentBytes(url) // ingen apikey, ingen JWT
      return (r.http === 200 && !!r.bytes?.length)
        ? ok('en URL fra HTML\'en henter filen uden apikey og uden JWT — 0014 spoerges aldrig')
        : nej(`uventet: http ${r.http} (politikken ser nu ud til at gaelde ved brug)`)
    },
  },
  {
    id: 'hul-fremmed-url-kaede', gruppe: 'Kendte huller', slags: 'hul',
    beskriv: 'en URL hoestet fra A\'s annonce serverer sit indhold til en ANDEN konto (B)',
    koer: async (ctx) => {
      // Storage-leddet i fund 4: en signeret URL fra A's offentlige HTML
      // virker for B. At B derefter kan MONTERE den paa sin egen annonce er
      // app-leddet (gemBolig/skrivBilleder validerer ikke oprindelsen) — se
      // issue om fund 4. Her maales det, staging kan maale: at kapabiliteten
      // ikke er bundet til A's session.
      const navn = await saaObjekt(ctx, ctx.A, 'hoestet.jpg')
      const url = await signeretUrl(somKonto(ctx.A, ctx.publishable), navn, 600)
      if (!url) return nej('ingen signeret URL')
      const forventet = await hentBytes(url)
      const forventetHash = forventet.bytes ? sha256(forventet.bytes) : ''
      // B henter A's URL, som var den hoestet fra HTML'en. Bearer=B's JWT.
      const bHent = await hentBytes(url, { apikey: ctx.publishable, Authorization: `Bearer ${ctx.B.jwt}` })
      const bHash = bHent.bytes ? sha256(bHent.bytes) : ''
      return (bHent.http === 200 && bHash === forventetHash && !!bHash)
        ? ok('B henter A\'s billede via den hoestede URL — kapabiliteten er ikke kontobundet')
        : nej(`B fik http ${bHent.http}, indhold matcher=${bHash === forventetHash}`)
    },
  },
  {
    id: 'hul-token-efter-sletning', gruppe: 'Kendte huller', slags: 'hul',
    beskriv: 'token er bundet til STIEN, ikke versionen: en ny fil paa samme sti serveres af det gamle token',
    koer: async (ctx) => {
      const idA = somKonto(ctx.A, ctx.publishable)
      const navn = await saaObjekt(ctx, ctx.A, 'genskab.jpg')
      const url = await signeretUrl(idA, navn, 600)
      if (!url) return nej('ingen signeret URL')
      const foer = await hentBytes(url)
      const foerHash = foer.bytes ? sha256(foer.bytes) : ''
      // A sletter (kun ejeren kan) og lægger en ANDEN fil paa samme sti
      await sletEnkelt(idA, navn)
      const nyBytes = new Uint8Array([...LILLE_JPEG, 0, 1, 2, 3])
      const genupload = await kald('POST', objektSti(navn), {
        identitet: idA, headers: { 'content-type': 'image/jpeg' }, body: nyBytes as unknown as BodyInit,
      })
      if (!genupload.ok) return nej(`kunne ikke genuploade: ${genupload.http}`)
      const efter = await hentBytes(url) // SAMME gamle token
      const efterHash = efter.bytes ? sha256(efter.bytes) : ''
      return (efter.http === 200 && efterHash !== foerHash)
        ? ok('det gamle token serverer nu det NYE indhold — kan ikke tilbagekaldes ved at slette')
        : nej(`efter genupload: http ${efter.http}, indhold ${efterHash === foerHash ? 'uaendret' : 'aendret'}`)
    },
  },
  {
    id: 'hul-uid-i-sti', gruppe: 'Kendte huller', slags: 'hul',
    beskriv: 'udlejerens auth-uid staar i den signerede URL (samme klasse som landlord_id-reglen)',
    koer: async (ctx) => {
      const navn = await saaObjekt(ctx, ctx.A, 'uid.jpg')
      const url = await signeretUrl(somKonto(ctx.A, ctx.publishable), navn, 600)
      if (!url) return nej('ingen signeret URL')
      return url.includes(ctx.A.id)
        ? ok(`A's auth-uid (${ctx.A.id.slice(0, 8)}…) staar i URL'en, som ellers lander i offentlig HTML`)
        : nej('uid staar ikke laengere i URL\'en — stiskemaet er maaske aendret')
    },
  },
]

// ── Orkestrering ──────────────────────────────────────────────────
async function main() {
  const m = laesMiljoe()
  const priv = privilegeretV2(m.secret)

  // Bekraeft at vi taler med staging, FOER nogen mutation.
  const meta = await priv.metadata()
  skriv('  storage-proeve mod staging (prgmenbwabwkgitjclrj)\n')
  skriv(`  bruger=${meta.bruger} omgaar_rls=${meta.omgaar_rls} bucket.public=${meta.bucket.public}\n`)
  skriv(`  migrationer: ${meta.migrationer.join(', ')}\n`)
  if (meta.omgaar_rls !== true) {
    throw new Afbryd(3, 'den privilegerede rolle omgaar ikke RLS — sandhedsmaalingen ville selv vaere filtreret. Afbrudt.')
  }

  // Ryd rester fra en evt. doed tidligere koersel FOER alt andet.
  const drop = await priv.fjern()
  if (drop.length) skriv(`  ryddede ${drop.length} efterladt(e) svaekkelse(r): ${drop.join(', ')}\n`)
  const ryddetRaekker = await priv.ryd()
  if (ryddetRaekker) skriv(`  ryddede ${ryddetRaekker} efterladt(e) proeve-objektraekke(r)\n`)
  const ryddetKonti = await ryddForaeldreloese(m)
  if (ryddetKonti) skriv(`  ryddede ${ryddetKonti} efterladt(e) proevekonto(er)\n`)

  const runid = `${Date.now()}`
  const { A, B } = await opretKonti(m, runid)
  skriv(`  proevekonti oprettet: A=${A.id.slice(0, 8)}… B=${B.id.slice(0, 8)}…\n`)

  const ctx: Ctx = { A, B, anon: { navn: 'anon', apikey: m.publishable }, publishable: m.publishable, priv, runid, taeller: { n: 0 } }

  const resultater: Resultat[] = []
  try {
    for (const p of PROEVER) {
      const r = await koerProeve(p, ctx, priv)
      resultater.push(r)
    }
  } finally {
    // Oprydning: svaekkelser, proeve-objekter og konti — uanset udfald.
    const restSvag = await priv.fjern()
    const restObj = await priv.ryd()
    await sletKonti(m, [A, B])
    skriv(`\n  oprydning: svaekkelser ${restSvag.length ? 'FANDT ' + restSvag.join(',') : 'ingen'}; `
      + `objektraekker ${restObj}; konti slettet\n`)
    // Bekraeft at ingen svaekkelse staar tilbage.
    const efter = await priv.metadata()
    const rester = efter.politikker.filter((p) => p.navn.startsWith('proeve_svag_'))
    if (rester.length) skriv(`  ⚠ ADVARSEL: svaekkelser staar stadig: ${rester.map((p) => p.navn).join(', ')}\n`)
  }

  const kode = rapport(resultater)
  process.exit(kode)
}

main().catch((e) => {
  if (e instanceof Afbryd) {
    skriv(`\n  ✗ afbrudt: ${e.message}\n`)
    process.exit(e.kode)
  }
  skriv(`\n  ✗ uventet fejl: ${(e as Error).stack ?? (e as Error).message}\n`)
  process.exit(1)
})
