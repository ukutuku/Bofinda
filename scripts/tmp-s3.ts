import { sql as s } from '@/db/client'
const rows = <T>(r: unknown): T[] => (r as { rows?: T[] }).rows ?? (r as T[])
for (let i = 0; i < 20; i++) {
  const r = rows<{ t: string; f: unknown }>(await s`
    select last_fetched_at::text as t, availability_facts as f
    from listings where id = 'beac3d9e-0b31-42c7-83b0-eba9c2179165'`)
  const frisk = new Date(r[0]!.t).getTime() > Date.now() - 3600_000
  if (frisk) {
    const ok = r[0]!.f !== null
    console.log(`  hentet ${r[0]!.t.slice(11, 19)} af Railway`)
    console.log(`  facts: ${JSON.stringify(r[0]!.f)}`)
    console.log(ok ? '\n  ✓✓ RAILWAY KØRER NY KODE — facts skrevet af den deployede import'
      : '\n  ✗✗ RAILWAY KØRER GAMMEL KODE — hentede uden at skrive facts')
    process.exit(ok ? 0 : 1)
  }
  await new Promise((res) => setTimeout(res, 300_000))
}
console.log('  TIMEOUT: sonden blev ikke hentet på 100 min'); process.exit(1)
