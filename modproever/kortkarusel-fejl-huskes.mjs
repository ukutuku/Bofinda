// K14 tilbage: et fejlet listekald bliver liggende i `liste`, så hvert
// senere tryk genbruger fejlen og aldrig henter igen. `kortkarusel.mjs`
// skal være rød på [K14] — «det næste eksplicitte tryk henter igen».
export const forventning = {
  fil: 'app/KortBilleder.tsx',
  moenster: 'if (liste.current === kald) liste.current = null',
  traeffere: 1,
  naer: 'fejlet.current = true',
  naerVindue: 2,
  erstat: '',
}
