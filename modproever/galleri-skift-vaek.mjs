// Modproeve: lysbordet melder ikke billedskift og lukning til forhentningen.
// Saa stopper en foraeldet kaede foerst ved det naeste hovedbilledes load —
// fejlen fra kontrollen af 440c73e. scripts/test-galleri-forhentning.ts
// skal blive roed (miniature, piletast, swipe, luk-knap og Esc).
export const forventning = {
  fil: 'app/bolig/[id]/Galleri.tsx',
  moenster: '    forhent().skift(aaben, store())\n',
  traeffere: 1,
  naer: 'useEffect(() => {',
  erstat: '',
}
