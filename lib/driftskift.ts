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

import { count, eq, inArray, sql } from 'drizzle-orm'
import { db, raekker } from '../db/client'
import { drift, subscriptions, users } from '../db/schema'
import { LEVENDE, aabneKoeb, lukAlleAabneKoeb } from './abonnement'
import type { Tilstand } from './adgang'

export type Skiftesvar =
  | { ok: true; fra: Tilstand; til: Tilstand }
  | { ok: false; fejl: 'ikke_admin' }
  | { ok: false; fejl: 'levende_abonnementer'; antal: number; forklaring: string }
  | { ok: false; fejl: 'aabne_koeb'; antal: number; forklaring: string }
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

  const [findes] = await db.select({ t: drift.tilstand }).from(drift).limit(1)
  if (!findes) return { ok: false, fejl: 'ingen_raekke' }

  // ── BETALING slaas til uden vagt ──────────────────────────
  // Det opretter INTET abonnement og opkraever ingen. Gratis brugere
  // bliver ikke abonnenter af et sideskift — de moeder en betalingsboks
  // og skal selv trykke.
  if (til === 'betaling') {
    if (findes.t === til) return { ok: true, fra: findes.t, til }
    await skriv(til, brugerId, note)
    return { ok: true, fra: findes.t, til }
  }

  // ── GRATIS ────────────────────────────────────────────────
  // Bemaerk: der er INGEN tidlig udgang paa «staar der allerede».
  // Lykkes lukningen af en paabegyndt betaling ikke, skrives
  // tilstanden alligevel ikke — og saa staar der maaske GRATIS med en
  // betalbar session tilbage. Et nyt tryk paa knappen skal kunne goere
  // arbejdet faerdigt, og det kan det kun, hvis afstemningen koerer
  // uanset hvad raekken siger.
  const r = await db.transaction(async (tx) => {
    // `for update` paa drift-raekken er koordineringen med `startKoeb()`,
    // som tager `for share` paa den samme raekke. Saa laenge vi holder
    // den, kan ingen ny reservation komme til, og en reservation, der
    // var i gang, er enten committet (og synlig for lukningen nedenfor)
    // eller venter paa os (og moeder GRATIS, naar den faar lov).
    const [d] = raekker<{ tilstand: Tilstand }>(await tx.execute(
      sql`select tilstand from drift where id = true for update`,
    ))
    const fra = d?.tilstand ?? findes.t

    const [lev] = await tx.select({ n: count() }).from(subscriptions)
      .where(inArray(subscriptions.status, [...LEVENDE]))
    const n = lev?.n ?? 0
    if (n > 0) return { slags: 'levende' as const, fra, antal: n }

    // En kunde kan staa med betalingssiden aaben i netop det sekund —
    // betaler hun bagefter, har hun et loebende abonnement i gratis
    // tilstand, og det var hele pointen med vagten ovenfor. Sessionerne
    // lukkes derfor HOS STRIPE, foer tilstanden skrives: raekken
    // herhjemme er kun vores bogfoering af det.
    const l = await lukAlleAabneKoeb(tx)
    if (l.uafklarede > 0) {
      return { slags: 'uafklaret' as const, fra, antal: l.uafklarede, detaljer: l.detaljer }
    }

    // Stod der GRATIS i forvejen, var trykket en AFSTEMNING af de
    // aabne betalinger, ikke et skift. Saa skrives raekken ikke: et
    // nyt `aendret_at` ville paastaa paa adminsiden, at tilstanden
    // blev aendret, og det blev den ikke.
    if (fra !== til) {
      await tx.update(drift).set({
        tilstand: til, aendretAf: brugerId, aendretAt: new Date(), note: note ?? null,
      }).where(eq(drift.id, true))
    }
    return { slags: 'ok' as const, fra }
  })

  if (r.slags === 'levende') {
    const n = r.antal
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
  if (r.slags === 'uafklaret') {
    const n = r.antal
    return {
      ok: false, fejl: 'aabne_koeb', antal: n,
      forklaring:
        `${n} påbegyndt${n === 1 ? ' betaling' : 'e betalinger'} kunne ikke `
        + 'lukkes hos Stripe, så tilstanden er IKKE skiftet. Bliver muren '
        + 'slået fra, mens de står åbne, kan de betales bagefter, og kunden '
        + 'ender med et løbende abonnement i gratis tilstand. Tryk igen, når '
        + 'Stripe svarer — eller luk sessionerne i Stripe først.'
        + (r.detaljer.length ? ` Stripe svarede: ${r.detaljer.join(' · ')}` : ''),
    }
  }
  return { ok: true, fra: r.fra, til }
}

const skriv = (til: Tilstand, brugerId: string | null, note?: string) =>
  db.update(drift).set({
    tilstand: til, aendretAf: brugerId, aendretAt: new Date(), note: note ?? null,
  }).where(eq(drift.id, true))

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
    // Staar der aabne betalinger, er «slå muren FRA» ikke et no-op,
    // heller ikke naar tilstanden allerede ER gratis: knappen er saa
    // afstemningen. Derfor skal siden kunne se tallet.
    aabneKoeb: await aabneKoeb(),
  }
}

