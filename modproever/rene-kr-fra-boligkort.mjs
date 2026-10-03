// Fletteopskriftens fejl: `kr` fra app/Boligkort ind i forklaring.ts.
// Boligkort importerer lib/soeg og dermed basen. Importen bruges ikke, så
// TypeScript ville fjerne den — vagten skal alligevel se den.
export const forventning = {
  fil: 'app/udlejer/boliger/forklaring.ts',
  moenster: "import type { Repraesentant } from '../../../lib/soeg'",
  traeffere: 1,
  erstat: "import type { Repraesentant } from '../../../lib/soeg'\nimport { kr } from '../../Boligkort'",
}
