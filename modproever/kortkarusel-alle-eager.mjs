// Alle kortbilleder hentes straks: forsidebilledet på den kompakte front
// mister `hentning()` og bliver eager. `kortkarusel.mjs` skal være rød på
// [K10] — både på attributten og på antallet af hentede billeder ved
// 390 px, før der rulles.
export const forventning = {
  fil: 'app/Boligkort.tsx',
  moenster: '{...hentning(prioritet)}',
  traeffere: 1,
  naer: 'Ingen billeder',
  naerVindue: 3,
  erstat: 'loading="eager"',
}
