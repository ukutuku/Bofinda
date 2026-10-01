// Modproeve af det, test-soegnings vagt 13 PAASTAAR: at Hastighed.tsx
// ikke naar databasen eller soegelaget.
//
// Fejlen indfoeres som en DYNAMISK import, fordi det er den eneste
// realistiske vej i en fil uden en eneste `from`-linje — og fordi det
// er netop den form, den gamle parser ikke kunne se. Koer den mod
// `git stash`'et af denne gren, og vagten bliver GROEN: det er beviset
// paa, at linjen ikke maalte noget, saa laenge `importer` var tom.
export const forventning = {
  fil: 'app/Hastighed.tsx',
  moenster: 'export function Hastighedspunkt(',
  traeffere: 1,
  naer: 'minutterP90',
  erstat: `const _laek = () => import('../lib/soeg')
export function Hastighedspunkt(`,
}
