// ═══════════════════════════════════════════════════════════════
//  Skift af driftstilstand.
//
//  Ejeren skifter mellem GRATIS og BETALING uden ny deployment. Der er
//  to veje, og de skriver den SAMME raekke:
//
//    1. `/admin/drift` i appen, bag rollen `admin`.
//    2. Supabases dashboard: `update drift set tilstand = 'gratis';`
//
//  Vej 2 er noedudgangen, hvis appen ikke kan naas. Den omgaar
//  vagten nedenfor — derfor staar den samme advarsel i
//  betjeningsvejledningen.
//
//  ── HVORFOR ET SKIFT TIL GRATIS KAN AFVISES ─────────────────
//  Muren og Stripes opkraevninger er to forskellige ting. Slaar man
//  muren fra, mens nogen har et loebende abonnement, faar man én af to
//  slemme tilstande:
//
//   · Vi bliver ved med at traekke 349 kr. hver 28. dag for noget,
//     alle andre faar gratis. Ingen har sagt ja til det.
//   · Eller vi opsiger dem automatisk — og saa har vi taget en
//     beslutning om fremmede menneskers penge uden at spoerge.
//
//  Ingen af delene maa ske ved et sideskift. Foerste version AFVISER
//  derfor skiftet og siger praecis hvor mange det gaelder, saa ejeren
//  kan tage stilling til dem hver for sig. Det er ikke en manglende
//  funktion; det er den funktion, der maatte bygges foerst.
// ═══════════════════════════════════════════════════════════════

import { count, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { drift, subscriptions, users } from '../db/schema'
import { LEVENDE } from './abonnement'
import type { Tilstand } from './adgang'

export type Skiftesvar =
  | { ok: true; fra: Tilstand; til: Tilstand }
  | { ok: false; fejl: 'ikke_admin' }
  | { ok: false; fejl: 'levende_abonnementer'; antal: number; forklaring: string }
  | { ok: false; fejl: 'ingen_raekke' }

/** Er den VERIFICEREDE bruger admin? Rollen laeses i basen, ikke i en cookie. */
export async function erAdmin(brugerId: string | null): Promise<boolean> {
  if (!brugerId) return false
  const [r] = await db.select({ rolle: users.role })
    .from(users).where(eq(users.id, brugerId)).limit(1)
  return r?.rolle === 'admin'
}

/** Hvor mange har et loebende abonnement? Tallet, vagten hviler paa. */
export async function levendeAbonnementer(): Promise<number> {
  const [r] = await db.select({ n: count() })
    .from(subscriptions)
    .where(inArray(subscriptions.status, [...LEVENDE]))
  return r?.n ?? 0
}

/**
 * Skifter tilstanden. `brugerId` SKAL komme fra den verificerede
 * session — funktionen slaar selv rollen op og stoler ikke paa kaldet.
 */
export async function saetTilstand(
  til: Tilstand, brugerId: string | null, note?: string,
): Promise<Skiftesvar> {
  if (!await erAdmin(brugerId)) return { ok: false, fejl: 'ikke_admin' }

  const [nu] = await db.select({ t: drift.tilstand }).from(drift).limit(1)
  if (!nu) return { ok: false, fejl: 'ingen_raekke' }
  if (nu.t === til) return { ok: true, fra: nu.t, til }

  if (til === 'gratis') {
    const n = await levendeAbonnementer()
    if (n > 0) {
      return {
        ok: false, fejl: 'levende_abonnementer', antal: n,
        forklaring:
          `${n} ${n === 1 ? 'konto har' : 'konti har'} et løbende abonnement. `
          + 'Slås muren fra nu, fortsætter Stripe med at trække 349 kr. hver '
          + '28. dag for noget, alle andre får gratis — og en automatisk '
          + 'opsigelse ville være en beslutning om deres penge, som ingen har '
          + 'bedt om. Tag stilling til hver enkelt først: sig dem op i Stripe '
          + '(adgangen løber perioden ud) eller lad dem løbe videre med et '
          + 'varsel. Skift derefter tilstanden.',
      }
    }
  }

  // BETALING slaas til uden vagt: det opretter INTET abonnement og
  // opkraever ingen. Gratis brugere bliver ikke abonnenter af et
  // sideskift — de moeder en betalingsboks og skal selv trykke.
  await db.update(drift).set({
    tilstand: til, aendretAf: brugerId, aendretAt: new Date(),
    note: note ?? null,
  }).where(eq(drift.id, true))
  return { ok: true, fra: nu.t, til }
}

/** Til adminsiden: hvad staar der nu, og hvad spaerrer et skift? */
export async function driftsbillede(brugerId: string | null) {
  const [r] = await db.select({
    tilstand: drift.tilstand, aendretAt: drift.aendretAt, note: drift.note,
  }).from(drift).limit(1)
  return {
    admin: await erAdmin(brugerId),
    tilstand: r?.tilstand ?? null,
    aendretAt: r?.aendretAt ?? null,
    note: r?.note ?? null,
    levende: await levendeAbonnementer(),
  }
}

