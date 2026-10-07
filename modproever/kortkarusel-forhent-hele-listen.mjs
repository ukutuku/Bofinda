// K11: hensigten forhenter HELE billedlisten i stedet for naboen. Det er
// netop den fejl, den gamle K11 ikke kunne se på et kort med fire
// billeder: forsidebilledet var hentet, før tællingen begyndte, så nr. 2–4
// gav tre nye — under grænsen på tre. `kortkarusel.mjs` skal være rød på
// [K11] i hensigtstrinnet — med mus og med berøring.
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'forhent(l[(nu.current + 1) % l.length])',
  traeffere: 1,
  naer: 'svar.billeder.length < 2',
  naerVindue: 3,
  erstat: 'l.forEach(forhent)',
}
