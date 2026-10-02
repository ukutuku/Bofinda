// Vagten vaek fra indflytningkontrol. Den her SLETTER raekker til sidst,
// saa det er den af de seks, hvor en manglende vagt koster mest.
//
// Prøven, der skal blive rød: scripts/test-isolation.mjs' strukturelle
// del. Filen får igen sin EGEN forbindelse og står ikke på
// `TILLADT_EGEN_FORBINDELSE` — og det er netop den form, der skabte de
// seks huller: ni kopier, hver især rigtig nok.
//
// ÉN ting brydes: den her fils rute gennem modulet. Ikke vagtens logik,
// ikke de andre fem.
export const forventning = {
  fil: 'scripts/cloud/indflytningkontrol.mjs',
  moenster: 'const sql = await aabnIsoleretEllerStop()',
  traeffere: 1,
  naer: 'PRAEFIKS',
  erstat: 'const sql = postgres(process.env.DATABASE_URL, { ssl: false, max: 1, onnotice: () => {} })',
}
