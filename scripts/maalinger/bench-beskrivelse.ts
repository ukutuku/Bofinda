import { genererBeskrivelse } from '../../lib/normalize'
const raekker = Array.from({ length: 2000 }, (_, i) => ({
  propertyType: (['lejlighed', 'raekkehus', 'vaerelse'] as const)[i % 3],
  rooms: (i % 5) + 1, sizeM2: 40 + (i % 90),
  street: 'Nørrebrogade', houseNumber: String(i % 200), postalCode: '2200', city: 'København N',
  rentMonthly: 800000 + i * 137,
  totalMonthly: i % 4 === 0 ? null : 950000 + i * 137,
  totalMonthlyComponents: i % 3 === 0 ? ['rent', 'other'] : ['rent', 'heat', 'water'],
  utilitiesElectricity: i % 7 === 0 ? 30000 : null,
  electricityOwnMeter: i % 11 === 0 ? true : null,
  overtagelse: i % 2 ? { slags: 'senere' as const, dato: '2026-11-01' } : { slags: 'ukendt' as const },
}))
// Varm op, saa JIT'en ikke maales med.
for (let r = 0; r < 5; r++) for (const f of raekker) genererBeskrivelse(f as never)
const maalinger: number[] = []
for (let r = 0; r < 9; r++) {
  const t0 = process.hrtime.bigint()
  for (const f of raekker) genererBeskrivelse(f as never)
  maalinger.push(Number(process.hrtime.bigint() - t0) / raekker.length / 1000) // µs
}
maalinger.sort((a, b) => a - b)
const med = maalinger[Math.floor(maalinger.length / 2)]!
console.log(`genererBeskrivelse: median ${med.toFixed(2)} µs/kald`
  + ` (bedste ${maalinger[0]!.toFixed(2)}, værste ${maalinger.at(-1)!.toFixed(2)}; 9 runder à ${raekker.length} kald)`)
console.log(`48 kort (en sidevisning): ${(med * 48 / 1000).toFixed(3)} ms`)
console.log(`node ${process.version}`)
