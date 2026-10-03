// ═══════════════════════════════════════════════════════════════
//  Målværnet for staging.
//
//  ADSKILT fra scripts/cloud/miljoe.sh med vilje. Det værn beskytter mod
//  at skrive andre steder end i den LOKALE testbase, og det skal blive
//  præcis så stramt, som det er. Det her er et ANDET værn til et andet
//  mål — ikke en opblødning af det første.
//
//  ═══ HVORFOR DET IKKE ER NOK AT SE PÅ VÆRTEN ═══
//
//  Alle Supabase-projekter i samme region deler poolervært, og de hedder
//  alle sammen «postgres». En forbindelsesstreng, der PEGER det rigtige
//  sted, ser derfor ud præcis som en, der peger på produktionen. Værnet
//  her identificerer projektet på dets REF og kræver, at den samme ref
//  kommer fra tre uafhængige kanaler:
//
//    1 · databasens forbindelsesstreng   (brugernavn eller vært)
//    2 · den offentlige API-URL          (NEXT_PUBLIC_SUPABASE_URL)
//    3 · en udtrykkelig bekræftelse      (BOFINDA_STAGING_BEKRAEFT)
//
//  Den tredje findes, fordi de to første kan sættes af den samme
//  fejlkopierede blok. En operatør, der skal skrive ref'en igen i et
//  felt, der ikke bruges til andet, har set på den mindst én gang.
//
//  Oveni står en LEVENDE prøve: produktionens ref må ikke optræde nogen
//  steder, og basen må ikke se ud som produktionen.
// ═══════════════════════════════════════════════════════════════

export const STAGING_REF = 'prgmenbwabwkgitjclrj'
export const PRODUKTION_REF = 'musbnojvamcihazcljpp'

export class Maalfejl extends Error {}

/**
 * Projektets ref, læst ud af en Supabase-forbindelsesstreng.
 *
 * To former, og begge bærer ref'en:
 *   pooler   postgres://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:5432/postgres
 *   direct   postgres://postgres:…@db.<ref>.supabase.co:5432/postgres
 *
 * Kan den ikke læses, er svaret null — ALDRIG et gæt. En streng, vi ikke
 * kan henføre til et projekt, er en streng, vi ikke skriver i.
 */
export function refFraDatabaseUrl(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }

  // Pooler: brugernavnet er postgres.<ref>
  const bruger = decodeURIComponent(u.username || '')
  const iBruger = /^postgres\.([a-z0-9]{20})$/.exec(bruger)
  if (iBruger) return iBruger[1]!

  // Direct: db.<ref>.supabase.co
  const iVaert = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)
  if (iVaert) return iVaert[1]!

  return null
}

/**
 * Projektets ref fra den offentlige API-URL: https://<ref>.supabase.co
 *
 * `https` kraeves. En nedgradering til `http` ville sende Auth-tokens
 * ukrypteret, og en URL, der ikke er den, vi tror, er praecis det, vaernet
 * her findes for at fange. Vaertsnavnet er ANKRET i begge ender, saa
 * `https://<ref>.supabase.co.example.invalid` ikke laeses som vores projekt.
 */
export function refFraApiUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)
    return m ? m[1]! : null
  } catch { return null }
}

/** Kun det, vaernet laeser. `process.env` passer, og det goer en proeves
 *  haandlavede blok ogsaa — uden en cast, der kunne skjule en tastefejl. */
export type Miljoe = Record<string, string | undefined>

export interface Maal {
  databaseUrl: string
  apiUrl: string
  ref: string
}

/**
 * Afgør målet, eller kast.
 *
 * Kaster hellere end at returnere et «måske». Alt herefter skriver i en
 * rigtig database, og et forkert mål kan ikke fortrydes.
 */
export function kraevStaging(env: Miljoe = process.env): Maal {
  const databaseUrl = env.STAGING_DATABASE_URL ?? ''
  const apiUrl = env.STAGING_SUPABASE_URL ?? ''
  const bekraeft = env.BOFINDA_STAGING_BEKRAEFT ?? ''

  const mangler = [
    !databaseUrl && 'STAGING_DATABASE_URL',
    !apiUrl && 'STAGING_SUPABASE_URL',
    !bekraeft && 'BOFINDA_STAGING_BEKRAEFT',
  ].filter(Boolean)
  if (mangler.length) {
    throw new Maalfejl(
      `Mangler: ${mangler.join(', ')}. Der er ingen standardværdi — et manglende `
      + 'mål må aldrig blive til produktionen.',
    )
  }

  // ── Produktionen må ikke optræde nogen steder ────────────────
  // Ordret tekstsøgning, ikke kun en parsning: står produktionens ref
  // ét sted i en af strengene, er noget kopieret forkert.
  for (const [navn, v] of [['STAGING_DATABASE_URL', databaseUrl],
    ['STAGING_SUPABASE_URL', apiUrl], ['BOFINDA_STAGING_BEKRAEFT', bekraeft]] as const) {
    if (v.includes(PRODUKTION_REF)) {
      throw new Maalfejl(`${navn} indeholder PRODUKTIONENS projekt-ref. Stoppet.`)
    }
  }

  // ── Tre uafhængige kanaler skal sige det samme ───────────────
  const fraDb = refFraDatabaseUrl(databaseUrl)
  const fraApi = refFraApiUrl(apiUrl)

  if (!fraDb) {
    throw new Maalfejl(
      'STAGING_DATABASE_URL kan ikke henføres til et Supabase-projekt. '
      + 'Forventet enten postgres.<ref>@…pooler.supabase.com eller db.<ref>.supabase.co. '
      + 'En poolervært og databasenavnet «postgres» identificerer ikke et projekt.',
    )
  }
  if (!fraApi) {
    throw new Maalfejl('STAGING_SUPABASE_URL er ikke på formen https://<ref>.supabase.co')
  }
  if (fraDb !== STAGING_REF) {
    throw new Maalfejl(`Databasen peger på projekt ${fraDb}, ikke på staging (${STAGING_REF}).`)
  }
  if (fraApi !== STAGING_REF) {
    throw new Maalfejl(`API-URL'en peger på projekt ${fraApi}, ikke på staging (${STAGING_REF}).`)
  }
  if (bekraeft !== STAGING_REF) {
    throw new Maalfejl(
      'BOFINDA_STAGING_BEKRAEFT stemmer ikke. Skriv projekt-ref\'en selv — '
      + 'den findes for at tvinge et menneske til at se på målet én gang til.',
    )
  }

  return { databaseUrl, apiUrl, ref: fraDb }
}

/**
 * Ligner basen produktionen?
 *
 * Sidste værn, og det eneste, der ser på INDHOLDET. Alle de andre kan
 * narres af en forkert kopieret streng; det her kan kun narres af en
 * staging-base, nogen har fyldt med produktionsdata — og så er den ikke
 * en staging-base længere.
 *
 * Kaldes med tællinger, kalderen har hentet, så modulet her ikke selv
 * skal kende databasen.
 */
export function kraevTom(tal: { boliger: number; brugere: number }, loft = 200): void {
  if (tal.boliger > loft || tal.brugere > loft) {
    throw new Maalfejl(
      `Basen indeholder ${tal.boliger} boliger og ${tal.brugere} brugere. `
      + `Over ${loft} ligner det ikke en staging-base. Stoppet — kontrollér målet.`,
    )
  }
}
