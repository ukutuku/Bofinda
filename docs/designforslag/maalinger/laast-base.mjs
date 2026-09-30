// ═══════════════════════════════════════════════════════════════
//  En skrivebeskyttet forbindelse, håndhævet af basen — ikke af, at
//  scriptet tilfældigvis kun indeholder select.
//
//  Samme mønster som maal-ny.mjs: DATABASE_URL_DIRECT (aldrig
//  transaction-pooleren på :6543, der ikke kan holde en session), én
//  forbindelse, `set session characteristics as transaction read only`,
//  og SHOW før og efter. Forbindelsen sættes ind i appens db/client.ts
//  med indsaetBase, så sidens egne funktioner (soeg, opsummering …)
//  kører gennem den.
// ═══════════════════════════════════════════════════════════════
export async function laastBase(ROD) {
  const url = process.env.DATABASE_URL_DIRECT
  if (!url) { console.error('FEJL: DATABASE_URL_DIRECT er ikke sat'); process.exit(2) }
  const u = new URL(url)
  if (u.port === '6543') {
    console.error('FEJL: transaction-pooleren (:6543) kan ikke holde en read-only-session.'); process.exit(2)
  }
  u.searchParams.delete('pgbouncer')
  const postgres = (await import('postgres')).default
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const schema = await import(`${ROD}/db/schema.ts`)
  const { indsaetBase, tlsFor } = await import(`${ROD}/db/client.ts`)
  const k = postgres(u.toString(), {
    max: 1, prepare: false, ssl: tlsFor(u.toString()),
    idle_timeout: 0, max_lifetime: null, connect_timeout: 15, onnotice: () => {},
  })
  await k`set session characteristics as transaction read only`
  const laast = async () => (await k`show default_transaction_read_only`)[0].default_transaction_read_only
  if (await laast() !== 'on') { console.error('FEJL: forbindelsen blev ikke read-only'); process.exit(1) }
  indsaetBase(drizzle(k, { schema }), () => k.end())
  const loop = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)
  return {
    // Aldrig brugernavn eller kode.
    navn: `${u.hostname}:${u.port || 5432}${u.pathname}${loop ? '  (loopback — ikke produktionen)' : ''}`,
    laast,
    slut: () => k.end(),
  }
}
