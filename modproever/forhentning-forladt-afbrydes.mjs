// Modproeve: skiftet afbryder det billede, brugeren lige har forladt.
// Saa skal det hentes forfra, naar brugeren gaar tilbage (naeste, naeste,
// forrige) — maalt 1.064 mod 453 ms paa telefonprofilen (median af tre).
// scripts/test-galleri-forhentning.ts skal blive roed.
export const forventning = {
  fil: 'app/bolig/[id]/forhentning.ts',
  moenster: 'else afbryd(stor[til], forlader)',
  traeffere: 1,
  naer: 'const forlader = vist == null ? undefined : stor[vist]',
  erstat: 'else afbryd(stor[til])',
}
