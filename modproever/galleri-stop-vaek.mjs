// Modproeve: lysbordet stopper ikke forhentningen ved afmontering. En
// kaede, der er i gang, naar brugeren forlader boligsiden, ville hente
// videre. scripts/test-galleri-forhentning.ts skal blive roed.
export const forventning = {
  fil: 'app/bolig/[id]/Galleri.tsx',
  moenster: '  useEffect(() => () => forhentning.current?.stop(), [])\n',
  traeffere: 1,
  naer: 'forhent().skift(aaben, store())',
  erstat: '',
}
