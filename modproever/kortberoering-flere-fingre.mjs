// A5 tilbage: en ny berøring afbryder IKKE en igangværende gestus, og et
// fingerløft regnes, selv om andre fingre stadig er nede eller det er en
// anden finger end den, der startede. Begge værn fjernes — hver for sig
// dækker de det andet ind. `kortberoering.mjs` skal være rød på [A5].
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'if (e.touches.length !== 1 || !feltet(e)) { afbryd(); return }',
  traeffere: 1,
  naer: 'const start = (e: TouchEvent)',
  naerVindue: 2,
}
export default function muter(indhold) {
  const a = 'if (e.touches.length !== 1 || !feltet(e)) { afbryd(); return }'
  const b = 'if (!s || e.touches.length !== 0) return\n      const t = [...e.changedTouches].find((x) => x.identifier === s.id)\n      if (!t) return'
  if (!indhold.includes(a) || !indhold.includes(b)) throw new Error('mønstrene findes ikke')
  return indhold
    .replace(a, 'if (e.touches.length !== 1 || !feltet(e)) return')
    .replace(b, 'if (!s) return\n      const t = e.changedTouches[0]!')
}
