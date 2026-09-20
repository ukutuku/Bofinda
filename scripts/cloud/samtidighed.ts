// ═══════════════════════════════════════════════════════════════
//  Ægte samtidighed på bindingen af en auth-konto.
//
//  HVORFOR DEN IKKE KAN LIGGE I npm test. PGlite kører på én forbindelse
//  i processen: to «samtidige» kald bliver til to kald efter hinanden.
//  Det er nok til at prøve KONTRAKTEN — og det gør afsnit 5 i
//  scripts/test-authbinding.ts — men ikke til at prøve, om databasen
//  faktisk serialiserer to skrivninger, der rammer den samme række i det
//  samme øjeblik.
//
//  Den her kører mod den isolerede lokale PostgreSQL, hvor `db`-poolen
//  har flere forbindelser, og hvor `Promise.all` derfor giver rigtig
//  parallelitet.
//
//      scripts/cloud/samtidighed.sh
//
//  Ingen produktionsdatabase: værnet nedenfor afviser alt andet end
//  127.0.0.1:55432/bofinda_test.
// ═══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { users } from '../../db/schema'
import { bindKonto, type AuthKonto } from '../../lib/auth'

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || ''
const u = new URL(url || 'x://')
if (u.port !== '55432' || u.pathname !== '/bofinda_test') {
  console.error('FEJL: samtidighedsprøven kører kun mod den isolerede testbase.')
  process.exit(1)
}

let fejl = 0
const tjek = (navn: string, ok: boolean, note = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${navn}${note ? `  — ${note}` : ''}`)
  if (!ok) fejl++
}

const MRK = `samtidig-${Date.now()}`
const PARALLELLE = 12

async function konto(email: string): Promise<AuthKonto> {
  const id = randomUUID()
  await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})
    on conflict (id) do nothing`)
  return { id, email, mailBekraeftet: true }
}
const bind = (k: AuthKonto) => bindKonto(k, 'tenant', '/min-side')

console.log(`\n═══ Ægte samtidighed · ${PARALLELLE} parallelle forsøg pr. tilfælde ═══`)

// ═══ 1 · Samme konto, første gang ═══════════════════════════════
// Alle skal ende med den SAMME række. Ingen unikhedsfejl, ingen dublet.
console.log('\n══ 1 · samme konto rammer samtidig ══')
{
  const k = await konto(`en-${MRK}@example.invalid`)
  const svar = await Promise.all(Array.from({ length: PARALLELLE }, () => bind(k)))
  const ok = svar.filter((s) => s.slags === 'ok')
  const ider = new Set(ok.map((s) => (s.slags === 'ok' ? s.bruger.id : '')))

  tjek(`1 · alle ${PARALLELLE} lykkes`, ok.length === PARALLELLE, `${ok.length}/${PARALLELLE}`)
  tjek('1 · og peger på præcis én række', ider.size === 1, `${ider.size} forskellige`)
  const raekker = await db.select().from(users).where(eq(users.email, k.email))
  tjek('1 · databasen har én række', raekker.length === 1, `${raekker.length}`)
  tjek('1 · bundet til den rigtige konto', raekker[0]?.authUserId === k.id)
}

// ═══ 2 · Mange konti kapper om den samme ubundne række ══════════
// Det er dét, vagten i UPDATE'en findes for. Vinder mere end én, er
// bindingen ikke atomar, og en fremmeds gemte søgninger kan skifte ejer.
console.log('\n══ 2 · mange konti kapper om den samme ubundne række ══')
{
  const delt = `delt-${MRK}@example.invalid`
  const [r] = await db.insert(users).values({ email: delt, authUserId: null }).returning()
  const konti = await Promise.all(
    Array.from({ length: PARALLELLE }, () => konto(delt)),
  )
  const svar = await Promise.all(konti.map((k) => bind(k)))

  const vandt = svar.filter((s) => s.slags === 'ok')
  const konflikt = svar.filter((s) => s.slags === 'konflikt')
  tjek('2 · præcis ÉN vinder', vandt.length === 1,
    `${vandt.length} ok · ${konflikt.length} konflikt`)
  tjek('2 · alle andre får en konflikt — ingen får en fremmed række',
    konflikt.length === PARALLELLE - 1)
  tjek('2 · ingen svar er noget andet end ok eller konflikt',
    vandt.length + konflikt.length === PARALLELLE)

  const [efter] = await db.select().from(users).where(eq(users.id, r!.id))
  const vinder = vandt[0]?.slags === 'ok' ? vandt[0].bruger.id : null
  tjek('2 · rækken er bundet, og til vinderen',
    efter!.authUserId != null && vinder === r!.id)

  const bundne = await db.select().from(users)
    .where(inArray(users.authUserId, konti.map((k) => k.id)))
  tjek('2 · kun én af de konkurrerende konti har en brugerrække',
    bundne.length === 1, `${bundne.length}`)

  // Og ingen af taberne fik oprettet en raekke ved siden af.
  const paaMail = await db.select().from(users).where(eq(users.email, delt))
  tjek('2 · der opstod ingen ekstra række på adressen', paaMail.length === 1,
    `${paaMail.length}`)
}

// ═══ 3 · To konti, hver sin nye adresse ═════════════════════════
// Kontrolgruppe: uden konflikt skal parallelitet ikke koste noget.
console.log('\n══ 3 · parallelle bindinger uden konflikt ══')
{
  const konti = await Promise.all(
    Array.from({ length: PARALLELLE }, (_, i) => konto(`fri${i}-${MRK}@example.invalid`)),
  )
  const svar = await Promise.all(konti.map((k) => bind(k)))
  const ok = svar.filter((s) => s.slags === 'ok')
  const ider = new Set(ok.map((s) => (s.slags === 'ok' ? s.bruger.id : '')))
  tjek(`3 · alle ${PARALLELLE} får hver sin række`,
    ok.length === PARALLELLE && ider.size === PARALLELLE,
    `${ok.length} ok · ${ider.size} forskellige`)
}

// ─── Oprydning ─────────────────────────────────────────────────
const rest = await db.select().from(users)
for (const r of rest) {
  if (r.email.includes(MRK)) await db.delete(users).where(eq(users.id, r.id))
}
await db.execute(sql`delete from auth.users where email like ${'%' + MRK + '%'}`)

console.log(fejl === 0 ? '\n✓ ALT GRØNT\n' : `\n✗ ${fejl} FEJLEDE\n`)
process.exit(fejl === 0 ? 0 : 1)
