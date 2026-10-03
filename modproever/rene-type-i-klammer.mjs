// `import { type X }` i stedet for `import type { X }`. TypeScript fjerner
// den i dag; én værdi i klammerne gør den til et rigtigt import af basen.
export const forventning = {
  fil: 'app/udlejer/boliger/forklaring.ts',
  moenster: "import type { Repraesentant } from '../../../lib/soeg'",
  traeffere: 1,
  erstat: "import { type Repraesentant } from '../../../lib/soeg'",
}
