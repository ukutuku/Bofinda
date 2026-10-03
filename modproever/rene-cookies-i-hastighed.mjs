// Hastighed.tsx lover i sit hoved at holde sig fra cookies og `headers()`.
// next/headers er vejen til begge.
export const forventning = {
  fil: 'app/Hastighed.tsx',
  moenster: 'export function Hastighedspunkt(',
  traeffere: 1,
  erstat: "import { cookies } from 'next/headers'\nexport const _c = cookies\nexport function Hastighedspunkt(",
}
