// samtykke.ts lover i sit hoved, at den ikke importerer «noget andet».
// En ren hjælper er også noget andet.
export const forventning = {
  fil: 'lib/samtykke.ts',
  moenster: "export const C_SAMTYKKE = 'bofinda_samtykke'",
  traeffere: 1,
  erstat: "import { KALENDERZONE } from './dato'\nexport const _z = KALENDERZONE\nexport const C_SAMTYKKE = 'bofinda_samtykke'",
}
