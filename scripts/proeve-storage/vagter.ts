// ═══════════════════════════════════════════════════════════════
//  Sikkerhedsvagter for storage-proeven.
//
//  Spaerringen mod produktionen ligger HER, i kode — ikke som en aftale
//  om at lade vaere. Samme filosofi som testbasen (npm test naar aldrig
//  produktionen, fordi DATABASE_URL ikke er sat) og som krav_isoleret i
//  scripts/cloud/miljoe.sh.
//
//  Fire ting skal holde, ellers afbrydes med exit 3, foer noget kald:
//    1. Projekt-ref'en er en KONSTANT. Vaerten kan ikke pege andre steder.
//    2. Secret-noeglen er en sb_secret-noegle, aldrig en JWT eller legacy.
//    3. Der maa ikke ligge en DATABASE_URL eller RESEND_API_KEY i
//       processen — saa kan proeven hverken naa produktions-basen eller
//       sende mail.
//    4. Publishable-noeglen er en sb_publishable-noegle.
// ═══════════════════════════════════════════════════════════════

/** Stagings projekt-ref. Aldrig produktionens. Aldrig fra en variabel. */
export const STAGING_REF = 'prgmenbwabwkgitjclrj'
export const BASE = `https://${STAGING_REF}.supabase.co`
const STAGING_VAERT = `${STAGING_REF}.supabase.co`

/** Afbryder proeven med en exit-kode. 3 = kunne ikke koere. */
export class Afbryd extends Error {
  constructor(public kode: number, besked: string) {
    super(besked)
    this.name = 'Afbryd'
  }
}

export interface Miljoe {
  base: string
  publishable: string
  secret: string
}

/**
 * Laeser og efterproever miljoeet. Kaster Afbryd(3), hvis noget ikke
 * holder — INTET kald sendes, foer alle fire vagter er bestaaet.
 */
export function laesMiljoe(env: NodeJS.ProcessEnv = process.env): Miljoe {
  // Vagt 3: ingen forbindelse til produktionen i processen.
  for (const forbudt of ['DATABASE_URL', 'DATABASE_URL_DIRECT', 'RESEND_API_KEY']) {
    if (env[forbudt]) {
      throw new Afbryd(3,
        `${forbudt} er sat i processen. Proeven maa aldrig kunne naa produktionen `
        + `eller sende mail. Koer den uden .env (npm-scriptet loader den ikke).`)
    }
  }

  const publishable = env.STAGING_SUPABASE_PUBLISHABLE_KEY
  const secret = env.STAGING_SUPABASE_SECRET_KEY
  if (!publishable || !secret) {
    throw new Afbryd(3,
      'STAGING_SUPABASE_PUBLISHABLE_KEY og STAGING_SUPABASE_SECRET_KEY skal '
      + 'ligge som Environment variables (ikke API credentials — dem kan '
      + 'scriptet ikke laese). Se docs/storage-proeve.md.')
  }

  // Vagt 2 og 4: noegletyperne. Den nye standard (sb_publishable_ / sb_secret_).
  if (!/^sb_publishable_/.test(publishable)) {
    throw new Afbryd(3, 'STAGING_SUPABASE_PUBLISHABLE_KEY ser ikke ud som en sb_publishable_-noegle.')
  }
  if (!/^sb_secret_/.test(secret)) {
    throw new Afbryd(3,
      'STAGING_SUPABASE_SECRET_KEY ser ikke ud som en sb_secret_-noegle. '
      + 'Brug en dedikeret secret-noegle til staging, som kan tilbagekaldes alene.')
  }

  return { base: BASE, publishable, secret }
}

/**
 * Enhver URL, proeven henter, SKAL ligge paa staging-vaerten. En tastefejl
 * i en sti kan derfor ikke pege væk fra staging. Bruges paa hvert kald,
 * ogsaa paa de signerede URL'er, der kommer retur fra API'et.
 */
export function sikkerUrl(u: string): string {
  let vaert: string
  try {
    vaert = new URL(u).host
  } catch {
    throw new Afbryd(3, `ugyldig URL: ${u}`)
  }
  if (vaert !== STAGING_VAERT) {
    throw new Afbryd(3, `URL peger paa ${vaert}, ikke paa staging (${STAGING_VAERT}). Afbrudt.`)
  }
  return u
}
