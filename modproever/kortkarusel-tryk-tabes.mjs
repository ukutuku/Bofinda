// K13 tilbage: kun det SIDSTE tryk, mens billedlisten afventes, tæller.
// Det er den form, fejlen havde set udefra — næste+næste gav 2/5, og
// næste+forrige endte et andet sted end det første billede. Her skrives
// det ventende skridt over i stedet for at lægges til.
// `kortkarusel.mjs` skal være rød på [K13].
//
//   node scripts/modproeve.mjs modproever/kortkarusel-tryk-tabes.mjs -- <trin> K13
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'vent.current.skridt += retning',
  traeffere: 1,
  naer: 'vent.current.tryk++',
  naerVindue: 2,
  erstat: 'vent.current.skridt = retning',
}
