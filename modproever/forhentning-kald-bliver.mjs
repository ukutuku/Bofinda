// Modproeve: afbrydelsen fjerner ikke kaldene fra det, der stadig hentes.
// Det er den ENESTE mekanisme, der forhindrer et faerdig-kald fra en
// foraeldet kaede i at starte den naeste nabo — efter et billedskift, en
// lukning eller en afmontering. scripts/test-galleri-forhentning.ts skal
// blive roed.
//
// Den afloeser en modproeve af et kaedenummer, der stod oven i: den slap
// igennem, fordi nummeret aldrig kunne afgoere noget, saa laenge kaldene
// blev fjernet. Nummeret er derfor taget ud.
export const forventning = {
  fil: 'app/bolig/[id]/forhentning.ts',
  moenster: '      h.billede.onload = null\n      h.billede.onerror = null\n',
  traeffere: 1,
  naer: 'const afbryd = (...behold: (string | undefined)[]) => {',
  erstat: '',
}
