// A2 tilbage: en ny pointerdown/keydown ophæver IKKE længere slugningen,
// så det næste klik på billedfeltet inden for 500 ms efter et swipe
// forsvinder — også et selvstændigt tryk for at åbne annoncen.
// `kortberoering.mjs` skal være rød på [A2].
//
//   node scripts/modproeve.mjs modproever/kortberoering-swipe-sluger-tryk.mjs -- <trin> A2
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'const nyHandling = () => { slugKlik.current = false }',
  traeffere: 1,
  naer: 'swipet SELV kan afføde',
  naerVindue: 10,
  erstat: 'const nyHandling = () => {}',
}
