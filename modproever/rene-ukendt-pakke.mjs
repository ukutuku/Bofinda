// En pakke, ingen har klassificeret. Under et løfte, der kun nævner
// databasen, skal den stadig være rød: det kunne være en ny vej til basen.
export const forventning = {
  fil: 'lib/maaling.ts',
  moenster: 'export const MILJOEER = ',
  traeffere: 1,
  erstat: "import 'et-nyt-drev'\nexport const MILJOEER = ",
}
