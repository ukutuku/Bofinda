// Modproeve: et skift til det billede, der allerede vises, stopper kaeden.
// Kom hovedbilledets load fra cachen FOER skift-effekten, ville effekten
// saa stoppe den kaede, load lige havde startet.
// scripts/test-galleri-forhentning.ts skal blive roed.
export const forventning = {
  fil: 'app/bolig/[id]/forhentning.ts',
  moenster: '      if (til === vist) return\n',
  traeffere: 1,
  naer: 'skift(til, stor) {',
  erstat: '',
}
